import { checkProviderBaseUrl, isBlockedAddress } from '@/lib/llm/provider-url';

/**
 * BYOK base URL policy. In production the server only talks to public HTTPS
 * providers; every form of loopback / private / metadata / internal address
 * is refused. Outside production, local mock providers stay usable.
 */
const prod = { allowPrivate: false };
const dev = { allowPrivate: true };

describe('checkProviderBaseUrl (production)', () => {
  it.each([
    'https://openrouter.ai/api/v1',
    'https://api.openai.com/v1',
    'https://api.anthropic.com',
    'https://llm.example.com:8443/v1',
    'https://8.8.8.8/v1',
    'https://[2606:4700:4700::1111]/v1',
  ])('accepts public https %s', (url) => {
    expect(checkProviderBaseUrl(url, prod)).toEqual({ ok: true });
  });

  it.each([
    ['http://api.openai.com/v1', 'https://'],
    ['ftp://api.openai.com', 'https://'],
    ['not a url', 'valid URL'],
    ['https://user:pass@api.openai.com/v1', 'credentials'],
  ])('rejects %s', (url, fragment) => {
    const result = checkProviderBaseUrl(url, prod);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(fragment);
  });

  it.each([
    'https://127.0.0.1:3000',
    'https://127.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://0177.0.0.1',
    'https://0.0.0.0',
    'https://10.0.0.5',
    'https://172.20.0.2',
    'https://192.168.1.10',
    'https://100.64.0.1',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]',
    'https://[::]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:a9fe:a9fe]',
    'https://[64:ff9b::a9fe:a9fe]',
    'https://[fd00::1]',
    'https://[fe80::1]',
    'https://localhost',
    'https://localhost.',
    'https://api.localhost',
    'https://app',
    'https://caddy:2019',
    'https://metadata.google.internal',
    'https://printer.local',
  ])('rejects non-public host %s', (url) => {
    const result = checkProviderBaseUrl(url, prod);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('public provider address');
  });
});

describe('checkProviderBaseUrl (non-production)', () => {
  it('allows http and local mock providers', () => {
    expect(checkProviderBaseUrl('http://127.0.0.1:3199', dev)).toEqual({ ok: true });
    expect(checkProviderBaseUrl('http://localhost:3201', dev)).toEqual({ ok: true });
  });

  it('still rejects non-http schemes and embedded credentials', () => {
    expect(checkProviderBaseUrl('file:///etc/passwd', dev).ok).toBe(false);
    expect(checkProviderBaseUrl('http://u:p@127.0.0.1:3199', dev).ok).toBe(false);
  });
});

describe('isBlockedAddress', () => {
  it('blocks non-public addresses and garbage', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:10.0.0.1', 'fe80::1%en0', 'nope']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('allows public unicast addresses', () => {
    for (const ip of ['8.8.8.8', '104.18.2.161', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });
});
