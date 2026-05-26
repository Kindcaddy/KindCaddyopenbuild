/**
 * App-layer envelope encryption for secrets at rest.
 *
 * Why this exists
 * ----------------
 * `Resource.data` historically stored OAuth refresh tokens as plaintext JSON.
 * That is acceptable for a localhost demo and unacceptable for any tenant who
 * cares about a security review. This module turns every write into envelope-
 * encrypted ciphertext while keeping the column type (TEXT) and the read path
 * identical from the caller's perspective.
 *
 * The model
 * ---------
 *   plaintext JSON
 *      │
 *      ▼
 *   AES-256-GCM   <── DEK (32 random bytes, generated per encrypt call)
 *      │
 *      ▼
 *   ciphertext + iv + tag
 *
 *   DEK
 *      │
 *      ▼
 *   KEK wrap     <── KEK provider:
 *      │              - production: AWS KMS Encrypt/Decrypt (CMK)
 *      │              - dev/test:   local symmetric key from APP_ENC_KEY
 *      ▼
 *   wrappedKey
 *
 *   Stored value (base64-utf8 JSON):
 *     { v:1, alg:'AES-256-GCM', kek:'aws-kms'|'local', wk, iv, ct, tag }
 *
 * Properties
 * ----------
 *  - The same plaintext encrypts to different ciphertexts every time (random IV
 *    and random DEK), so frequency analysis on stored values is impossible.
 *  - Compromise of the database alone does not reveal any plaintext: an
 *    attacker also needs the KEK (KMS key, or the APP_ENC_KEY env var).
 *  - Key rotation is supported through KMS key aliases without re-encrypting
 *    rows — KMS resolves the alias to the right key version on decrypt.
 *  - `decrypt` is also tolerant of legacy plaintext rows so migration from
 *    older deployments doesn't break the first read. See `decryptResourceData`.
 *
 * Threat model — what this does NOT defend against
 * -------------------------------------------------
 *  - A compromised app process. Plaintext lives in process memory between
 *    `decrypt` and use; this is an unavoidable consequence of any app-layer
 *    crypto. RDS-side encryption-at-rest does not help here either.
 *  - A leaked KEK / APP_ENC_KEY. The KEK is the load-bearing secret; rotate it
 *    via KMS key rotation (annual minimum, immediate on suspected compromise).
 *  - Cross-tenant data theft by a privileged operator with KMS access. Restrict
 *    `kms:Decrypt` to the ECS task role only; revoke for humans.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const VERSION = 1 as const;
const ALG = 'AES-256-GCM' as const;
const DEK_BYTES = 32;
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

type KekProvider = 'aws-kms' | 'local';

interface EnvelopePayload {
  v: typeof VERSION;
  alg: typeof ALG;
  /** Which KEK encrypted the DEK. */
  kek: KekProvider;
  /** For 'aws-kms', the CMK id/alias the wrap was performed against. */
  keyId?: string;
  /** base64(wrapped DEK) */
  wk: string;
  /** base64(IV) */
  iv: string;
  /** base64(ciphertext) */
  ct: string;
  /** base64(GCM auth tag) */
  tag: string;
}

// -------------------- KEK providers --------------------
//
// Both providers are async because AWS KMS is. The local provider is sync
// underneath but exposes the same shape so the call sites are identical.

interface Kek {
  provider: KekProvider;
  keyId?: string;
  wrap(dek: Buffer): Promise<{ wrapped: Buffer; keyId?: string }>;
  unwrap(wrapped: Buffer, keyId?: string): Promise<Buffer>;
}

function getLocalKek(): Kek {
  // In dev / CI / test, derive a 32-byte key from APP_ENC_KEY so engineers
  // can opt in without pulling AWS into the loop. SHA-256 on a passphrase is
  // fine here because the KEK never leaves this process and the only attack
  // surface is "did the engineer pick a short passphrase" — which is exactly
  // what a real KMS deployment prevents.
  const secret = process.env.APP_ENC_KEY;
  if (!secret) {
    throw new Error(
      'APP_ENC_KEY is required for envelope encryption in non-prod environments. ' +
        'Generate one with `openssl rand -base64 32` and put it in frontend/.env.',
    );
  }
  const key = createHash('sha256').update(secret, 'utf8').digest();

  return {
    provider: 'local',
    async wrap(dek: Buffer) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Pack IV||TAG||CT into a single buffer so the on-disk shape is one
      // base64 blob. Unwrap reverses the layout.
      return { wrapped: Buffer.concat([iv, tag, ct]) };
    },
    async unwrap(wrapped: Buffer) {
      const iv = wrapped.subarray(0, IV_BYTES);
      const tag = wrapped.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ct = wrapped.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    },
  };
}

// Minimal structural type for the bits of `@aws-sdk/client-kms` we use. This
// keeps `tsc --noEmit` happy in environments where the SDK isn't installed
// yet (e.g. before `npm ci`) and avoids pulling SDK types into every build.
// At runtime the dynamic import resolves to the real module.
interface KmsModule {
  KMSClient: new (config?: Record<string, unknown>) => {
    send: (cmd: unknown) => Promise<{
      CiphertextBlob?: Uint8Array;
      Plaintext?: Uint8Array;
    }>;
  };
  EncryptCommand: new (input: {
    KeyId: string;
    Plaintext: Buffer;
    EncryptionContext?: Record<string, string>;
  }) => unknown;
  DecryptCommand: new (input: {
    CiphertextBlob: Buffer;
    EncryptionContext?: Record<string, string>;
  }) => unknown;
}

async function loadKmsModule(): Promise<KmsModule> {
  // Indirect through a variable so TypeScript doesn't try to resolve the
  // module specifier at type-check time. The package is listed in
  // package.json dependencies and is resolved at runtime.
  const specifier = '@aws-sdk/client-kms';
  return (await import(/* webpackIgnore: true */ specifier)) as KmsModule;
}

function getAwsKmsKek(): Kek {
  // We import lazily so the AWS SDK isn't pulled into the bundle when the
  // local provider is in use (which is the common dev path). If a deployment
  // chose KMS and the SDK isn't installed, we want a clear error at first
  // encrypt, not a silent fallback to plaintext.
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) {
    throw new Error(
      'KMS_KEY_ID is required when ENC_PROVIDER=aws-kms. Set it to the KMS ' +
        'CMK ARN or alias used to wrap data encryption keys.',
    );
  }

  return {
    provider: 'aws-kms',
    keyId,
    async wrap(dek: Buffer) {
      const { KMSClient, EncryptCommand } = await loadKmsModule();
      const client = new KMSClient({});
      const out = await client.send(
        new EncryptCommand({
          KeyId: keyId,
          Plaintext: dek,
          EncryptionContext: { purpose: 'kindcaddy-resource' },
        }),
      );
      if (!out.CiphertextBlob) {
        throw new Error('KMS Encrypt returned no ciphertext');
      }
      return { wrapped: Buffer.from(out.CiphertextBlob), keyId };
    },
    async unwrap(wrapped: Buffer) {
      const { KMSClient, DecryptCommand } = await loadKmsModule();
      const client = new KMSClient({});
      const out = await client.send(
        new DecryptCommand({
          CiphertextBlob: wrapped,
          EncryptionContext: { purpose: 'kindcaddy-resource' },
        }),
      );
      if (!out.Plaintext) {
        throw new Error('KMS Decrypt returned no plaintext');
      }
      return Buffer.from(out.Plaintext);
    },
  };
}

let cachedKek: Kek | null = null;
function selectKek(): Kek {
  if (cachedKek) return cachedKek;
  const provider = (process.env.ENC_PROVIDER ?? 'local').toLowerCase();
  cachedKek = provider === 'aws-kms' ? getAwsKmsKek() : getLocalKek();
  return cachedKek;
}

/** Test-only: reset the cached KEK so a test can flip ENC_PROVIDER. */
export function __resetKekForTests(): void {
  cachedKek = null;
}

// -------------------- Public API --------------------

/**
 * Encrypt a plaintext string (typically a JSON-stringified object) and return
 * the on-disk encoded envelope. Safe to write directly into `Resource.data`.
 */
export async function encrypt(plaintext: string): Promise<string> {
  const kek = selectKek();
  const dek = randomBytes(DEK_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const { wrapped, keyId } = await kek.wrap(dek);

  const payload: EnvelopePayload = {
    v: VERSION,
    alg: ALG,
    kek: kek.provider,
    keyId,
    wk: wrapped.toString('base64'),
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
  return JSON.stringify(payload);
}

/**
 * Decrypt an on-disk envelope back to its plaintext. Throws if the envelope is
 * malformed, the tag doesn't authenticate, or the KEK cannot unwrap the DEK.
 */
export async function decrypt(stored: string): Promise<string> {
  const payload = JSON.parse(stored) as EnvelopePayload;
  if (payload.v !== VERSION || payload.alg !== ALG) {
    throw new Error(
      `Unsupported envelope: v=${payload.v} alg=${payload.alg}`,
    );
  }
  const kek = selectKek();
  if (payload.kek !== kek.provider) {
    // We intentionally do NOT silently switch providers: if a row was wrapped
    // by AWS KMS and the runtime is configured for local, the operator made a
    // mistake and we want them to see it now, not after a partial migration.
    throw new Error(
      `Envelope was wrapped by ${payload.kek}, but ENC_PROVIDER is ${kek.provider}. ` +
        'Configure the matching KEK provider or run a re-wrap migration.',
    );
  }
  const dek = await kek.unwrap(
    Buffer.from(payload.wk, 'base64'),
    payload.keyId,
  );
  const iv = Buffer.from(payload.iv, 'base64');
  const ct = Buffer.from(payload.ct, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}

/**
 * Detect whether a stored `Resource.data` value is an envelope-encrypted
 * payload (vs legacy plaintext JSON). Used by the read path during the
 * cutover window so old rows continue to work until they are re-saved.
 */
export function isEnvelope(stored: string): boolean {
  if (!stored || stored[0] !== '{') return false;
  try {
    const parsed = JSON.parse(stored);
    return (
      parsed &&
      typeof parsed === 'object' &&
      parsed.v === VERSION &&
      parsed.alg === ALG &&
      typeof parsed.ct === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Backwards-compatible read helper: returns plaintext from either an envelope
 * or a legacy plaintext row. Writes should always go through `encrypt()`.
 */
export async function decryptResourceData(stored: string): Promise<string> {
  if (isEnvelope(stored)) {
    return decrypt(stored);
  }
  return stored;
}
