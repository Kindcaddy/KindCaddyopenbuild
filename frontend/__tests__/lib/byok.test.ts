import { decodeByok, encodeByok } from '@/lib/byok';

/**
 * BYOK cookie codec. Round-trips work whether or not RESOURCE_ENCRYPTION_KEY
 * is set (the crypto helper passes plaintext through in dev/test), and every
 * malformed input degrades to null so a bad cookie falls back to the
 * platform key instead of breaking chat.
 */
describe('BYOK cookie codec', () => {
  it('round-trips a full config', () => {
    const config = {
      apiKey: 'sk-test-1234567890abcdef',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-4',
    };
    expect(decodeByok(encodeByok(config))).toEqual(config);
  });

  it('round-trips a key-only config', () => {
    const decoded = decodeByok(encodeByok({ apiKey: 'sk-only-key-98765' }));
    expect(decoded).toEqual({
      apiKey: 'sk-only-key-98765',
      baseUrl: undefined,
      model: undefined,
    });
  });

  it('returns null for missing or garbage values', () => {
    expect(decodeByok(undefined)).toBeNull();
    expect(decodeByok(null)).toBeNull();
    expect(decodeByok('')).toBeNull();
    expect(decodeByok('not-json-at-all')).toBeNull();
    expect(decodeByok('{"foo":"bar"}')).toBeNull();
    expect(decodeByok('{"apiKey":""}')).toBeNull();
    expect(decodeByok('{"apiKey":123}')).toBeNull();
  });

  it('never throws on tampered input', () => {
    expect(() => decodeByok('enc:v1:tampered:tampered:tampered')).not.toThrow();
    expect(decodeByok('enc:v1:tampered:tampered:tampered')).toBeNull();
  });
});
