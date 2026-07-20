/**
 * App-level crypto helpers (PRODUCTION-PLAN.md Phase 3).
 *
 *  - encryptString / decryptString: AES-256-GCM for per-tenant integration
 *    secrets stored in `Resource.data` (Google refresh tokens today;
 *    NetSuite TBA tokens / iCloud app passwords follow the same pattern).
 *    Key comes from RESOURCE_ENCRYPTION_KEY (KMS-managed in AWS).
 *  - signState / verifyState: HMAC-SHA256 over AUTH_SECRET, used for the
 *    OAuth `state` parameter on integration connect flows.
 *
 * Ciphertext format: `enc:v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 * decryptString passes non-prefixed values through unchanged so legacy
 * plaintext rows keep working until scripts/encrypt-resources.ts migrates
 * them.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const ENC_PREFIX = 'enc:v1:';

let warnedMissingKey = false;

function encryptionKey(): Buffer | null {
  const secret = process.env.RESOURCE_ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // Failing loudly beats silently persisting plaintext tokens in prod.
      throw new Error(
        'RESOURCE_ENCRYPTION_KEY is required in production to store integration secrets',
      );
    }
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        '[crypto] RESOURCE_ENCRYPTION_KEY not set — integration secrets are stored unencrypted (dev only).',
      );
    }
    return null;
  }
  // SHA-256 of the secret => always a valid 32-byte AES key regardless of
  // how the operator formatted the env value.
  return createHash('sha256').update(secret).digest();
}

export function encryptString(plain: string): string {
  const key = encryptionKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export function decryptString(value: string): string {
  if (!isEncrypted(value)) return value;
  const key = encryptionKey();
  if (!key) {
    throw new Error(
      'Encountered encrypted data but RESOURCE_ENCRYPTION_KEY is not set',
    );
  }
  const [ivB64, tagB64, ctB64] = value.slice(ENC_PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function hmacSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production');
  }
  return 'kindcaddy-dev-secret';
}

function hmac(payload: string): string {
  return createHmac('sha256', hmacSecret()).update(payload).digest('base64url');
}

/** HMAC-sign a payload for OAuth `state` round-trips. */
export function signState(payload: string): string {
  return hmac(payload);
}

export function verifyState(payload: string, mac: string): boolean {
  const expected = Buffer.from(hmac(payload));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
