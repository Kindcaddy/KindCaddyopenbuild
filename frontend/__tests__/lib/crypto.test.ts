describe('crypto (token encryption at rest + OAuth state, Phase 3)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  async function loadCrypto() {
    return import('@/lib/crypto');
  }

  it('round-trips AES-256-GCM with RESOURCE_ENCRYPTION_KEY set', async () => {
    process.env.RESOURCE_ENCRYPTION_KEY = 'unit-test-key';
    const { encryptString, decryptString, isEncrypted } = await loadCrypto();
    const secret = JSON.stringify({ refreshToken: '1//abc', calendarId: 'primary' });
    const stored = encryptString(secret);
    expect(stored).not.toContain('refreshToken');
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptString(stored)).toBe(secret);
  });

  it('passes legacy plaintext rows through decryptString unchanged', async () => {
    process.env.RESOURCE_ENCRYPTION_KEY = 'unit-test-key';
    const { decryptString } = await loadCrypto();
    expect(decryptString('{"refreshToken":"plain"}')).toBe('{"refreshToken":"plain"}');
  });

  it('rejects tampered ciphertext (GCM auth tag)', async () => {
    process.env.RESOURCE_ENCRYPTION_KEY = 'unit-test-key';
    const { encryptString, decryptString } = await loadCrypto();
    const stored = encryptString('sensitive');
    const parts = stored.split(':');
    // Flip a character in the ciphertext segment.
    const last = parts[parts.length - 1];
    parts[parts.length - 1] = last.startsWith('A') ? `B${last.slice(1)}` : `A${last.slice(1)}`;
    expect(() => decryptString(parts.join(':'))).toThrow();
  });

  it('signs and verifies OAuth state, rejecting forgeries', async () => {
    process.env.AUTH_SECRET = 'unit-test-auth-secret';
    const { signState, verifyState } = await loadCrypto();
    const payload = 'user1:tenant1:nonce123';
    const mac = signState(payload);
    expect(verifyState(payload, mac)).toBe(true);
    expect(verifyState('user2:tenant1:nonce123', mac)).toBe(false);
    expect(verifyState(payload, `${mac.slice(0, -1)}x`)).toBe(false);
  });
});
