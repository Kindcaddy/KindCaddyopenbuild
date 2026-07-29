import { decodeByok, encodeByok } from '@/lib/byok';

/**
 * BYOK cookie codec. Round-trips work whether or not RESOURCE_ENCRYPTION_KEY
 * is set (the crypto helper passes plaintext through in dev/test), and every
 * malformed input degrades to null so a bad cookie becomes a clean
 * `byok_required` instead of breaking chat.
 */
describe('BYOK cookie codec', () => {
  it('round-trips a full config', () => {
    const config = {
      apiKey: 'sk-tes...cdef',
      provider: 'openrouter' as const,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-4',
    };
    expect(decodeByok(encodeByok(config))).toEqual(config);
  });

  it('round-trips a key-only config', () => {
    const decoded = decodeByok(encodeByok({ apiKey: 'sk-abc...xyz' }));
    expect(decoded).toEqual({
      apiKey: 'sk-abc...xyz',
      provider: undefined,
      baseUrl: undefined,
      model: undefined,
    });
  });

  it('drops an unrecognized provider but keeps the key', () => {
    const decoded = decodeByok(
      JSON.stringify({ apiKey: 'sk-abc...xyz', provider: 'not-a-provider' }),
    );
    expect(decoded).toEqual({
      apiKey: 'sk-abc...xyz',
      provider: undefined,
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
