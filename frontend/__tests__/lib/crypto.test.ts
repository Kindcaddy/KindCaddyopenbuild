/**
 * Why this test exists
 * --------------------
 * `lib/crypto.ts` is the load-bearing wall between "an attacker dumps the
 * database and reads every OAuth refresh token" and "the dump is useless
 * without the KEK." If any of the following regress, that wall falls:
 *
 *  1. The same plaintext encrypts to a *different* ciphertext every time
 *     (random IV + random DEK). If this regresses, an attacker who controls
 *     one known-plaintext encryption can confirm/deny matches across the table.
 *  2. The auth tag must reject tampered ciphertext. If this regresses, an
 *     attacker who has write access to `Resource.data` can swap one tenant's
 *     ciphertext for another's and we'd hand back the wrong plaintext.
 *  3. A row written under one KEK provider must not silently decrypt under
 *     another (catches accidental misconfiguration that would make the
 *     "encryption" effectively no-op).
 *  4. Legacy plaintext rows (from before this module shipped) must still be
 *     readable so the migration is non-breaking.
 */

import {
  __resetKekForTests,
  decrypt,
  decryptResourceData,
  encrypt,
  isEnvelope,
} from '@/lib/crypto';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.APP_ENC_KEY = 'test-key-please-do-not-use-in-prod-1234567890';
  process.env.ENC_PROVIDER = 'local';
  __resetKekForTests();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
  __resetKekForTests();
});

describe('crypto envelope', () => {
  it('round-trips a plaintext', async () => {
    const plaintext = JSON.stringify({ refreshToken: 'abc.def.ghi' });
    const enc = await encrypt(plaintext);
    expect(enc).not.toContain('abc.def.ghi');
    const dec = await decrypt(enc);
    expect(dec).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (threat 1)', async () => {
    const plaintext = 'identical plaintext';
    const a = await encrypt(plaintext);
    const b = await encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(await decrypt(a)).toBe(plaintext);
    expect(await decrypt(b)).toBe(plaintext);
  });

  it('rejects tampered ciphertext (threat 2)', async () => {
    const enc = await encrypt('sensitive');
    const parsed = JSON.parse(enc);
    // Flip one byte in the ciphertext.
    const ct = Buffer.from(parsed.ct, 'base64');
    ct[0] = ct[0] ^ 0xff;
    parsed.ct = ct.toString('base64');
    await expect(decrypt(JSON.stringify(parsed))).rejects.toThrow();
  });

  it('refuses to decrypt across KEK providers (threat 3)', async () => {
    const enc = await encrypt('hello');
    // Simulate a row that says it was wrapped by aws-kms.
    const parsed = JSON.parse(enc);
    parsed.kek = 'aws-kms';
    await expect(decrypt(JSON.stringify(parsed))).rejects.toThrow(
      /wrapped by aws-kms/,
    );
  });

  it('isEnvelope distinguishes encrypted from legacy plaintext', async () => {
    const enc = await encrypt('payload');
    expect(isEnvelope(enc)).toBe(true);

    // Legacy plaintext JSON (what Resource.data used to look like).
    const legacy = JSON.stringify({ refreshToken: 'plain' });
    expect(isEnvelope(legacy)).toBe(false);

    // Garbage.
    expect(isEnvelope('not-json')).toBe(false);
    expect(isEnvelope('')).toBe(false);
  });

  it('decryptResourceData passes through legacy plaintext rows (threat 4)', async () => {
    const legacy = JSON.stringify({ refreshToken: 'old-format' });
    expect(await decryptResourceData(legacy)).toBe(legacy);

    const enc = await encrypt(legacy);
    expect(await decryptResourceData(enc)).toBe(legacy);
  });

  it('local provider refuses to run without APP_ENC_KEY', async () => {
    delete process.env.APP_ENC_KEY;
    __resetKekForTests();
    await expect(encrypt('x')).rejects.toThrow(/APP_ENC_KEY/);
  });
});
