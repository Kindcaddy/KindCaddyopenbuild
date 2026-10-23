import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync } from 'node:zlib';
import type { LookupAddress } from 'node:dns';
import { createGuardedLookup, providerFetch } from '@/lib/llm/provider-fetch';
import { ProviderMidturnError, ProviderUnreachableError } from '@/lib/llm/errors';

/**
 * Outbound BYOK transport. Production refuses non-public destinations before
 * and during connect (DNS rebinding), never follows redirects, and caps the
 * decoded body so a compressed bomb can't exhaust memory.
 */
const post = { method: 'POST' as const, headers: { 'content-type': 'application/json' }, body: '{}' };

function lookupWith(addresses: LookupAddress[]) {
  return createGuardedLookup((_host, _opts, cb) => cb(null, addresses));
}

function runLookup(lookup: ReturnType<typeof createGuardedLookup>, all: boolean) {
  return new Promise<{ err: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
    lookup('provider.example', { all }, (err, address) => resolve({ err, result: address }));
  });
}

describe('createGuardedLookup', () => {
  it('passes public resolutions through in both lookup shapes', async () => {
    const lookup = lookupWith([{ address: '104.18.2.161', family: 4 }]);
    expect((await runLookup(lookup, false)).result).toBe('104.18.2.161');
    expect((await runLookup(lookup, true)).result).toEqual([{ address: '104.18.2.161', family: 4 }]);
  });

  it('refuses a hostname that resolves to a private address (DNS rebinding)', async () => {
    const { err } = await runLookup(lookupWith([{ address: '169.254.169.254', family: 4 }]), false);
    expect(err?.code).toBe('ERR_PROVIDER_ADDRESS_BLOCKED');
  });

  it('refuses mixed public + private answers', async () => {
    const { err } = await runLookup(
      lookupWith([
        { address: '104.18.2.161', family: 4 },
        { address: '10.0.0.7', family: 4 },
      ]),
      true,
    );
    expect(err?.code).toBe('ERR_PROVIDER_ADDRESS_BLOCKED');
  });
});

describe('providerFetch', () => {
  let server: Server;
  let base: string;
  const big = 'x'.repeat(2 * 1024 * 1024);

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"choices":[]}');
      } else if (req.url === '/redirect') {
        res.writeHead(307, { location: '/ok' });
        res.end();
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(big);
      } else if (req.url === '/bomb') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' });
        res.end(brotliCompressSync(Buffer.from(big)));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects a private destination in production without connecting', async () => {
    await expect(providerFetch(`${base}/ok`, post, { allowPrivate: false })).rejects.toBeInstanceOf(
      ProviderUnreachableError,
    );
  });

  it('returns a buffered standard Response for an allowed destination', async () => {
    const res = await providerFetch(`${base}/ok`, post, { allowPrivate: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ choices: [] });
  });

  it('refuses to follow redirects', async () => {
    await expect(
      providerFetch(`${base}/redirect`, post, { allowPrivate: true }),
    ).rejects.toThrow();
  });

  it('caps the response body', async () => {
    await expect(
      providerFetch(`${base}/big`, post, { allowPrivate: true, maxResponseBytes: 1024 * 1024 }),
    ).rejects.toBeInstanceOf(ProviderMidturnError);
  });

  it('caps the DECODED size of a compressed response', async () => {
    await expect(
      providerFetch(`${base}/bomb`, post, { allowPrivate: true, maxResponseBytes: 1024 * 1024 }),
    ).rejects.toBeInstanceOf(ProviderMidturnError);
  });
});
