/**
 * Outbound transport for every BYOK provider call (OpenAI-compatible and
 * Anthropic). The destination is user-controlled (see provider-url.ts), so
 * in production each request:
 *
 *   - re-validates the URL (cookies saved before validation existed, or
 *     tampered values, never reach the network),
 *   - checks every resolved IP at connect time, so a public hostname that
 *     re-resolves to a private address (DNS rebinding) is refused,
 *   - refuses redirects (a public host must not bounce us inward),
 *   - caps the DECODED response body, so a compressed decompression bomb
 *     cannot exhaust memory.
 *
 * Returns a fully-buffered standard Response; callers keep using
 * res.ok / res.status / res.text() / res.json().
 */

import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { ProviderMidturnError, ProviderUnreachableError } from './errors';
import {
  allowPrivateProviderHosts,
  checkProviderBaseUrl,
  isBlockedAddress,
} from './provider-url';

export const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;

type ResolveAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

export function createGuardedLookup(resolve: ResolveAll = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, '');
        return;
      }
      if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
        const blocked: NodeJS.ErrnoException = new Error(
          `LLM provider host ${hostname} resolves to a non-public address`,
        );
        blocked.code = 'ERR_PROVIDER_ADDRESS_BLOCKED';
        callback(blocked, '');
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const guardedAgent = new Agent({ connect: { lookup: createGuardedLookup() } });
const openAgent = new Agent();

export interface ProviderRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<ArrayBuffer | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderMidturnError(`LLM provider response exceeded ${limit} bytes`);
    }
    chunks.push(value);
  }
  const out = new ArrayBuffer(total);
  const view = new Uint8Array(out);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function providerFetch(
  url: string,
  init: ProviderRequestInit,
  opts: { allowPrivate?: boolean; maxResponseBytes?: number } = {},
): Promise<Response> {
  const allowPrivate = opts.allowPrivate ?? allowPrivateProviderHosts();
  const check = checkProviderBaseUrl(url, { allowPrivate });
  if (!check.ok) {
    throw new ProviderUnreachableError(`LLM provider address rejected: ${check.message}`);
  }

  const res = await undiciFetch(url, {
    ...init,
    redirect: 'error',
    dispatcher: allowPrivate ? openAgent : guardedAgent,
  });
  const body = await readCapped(
    res.body as ReadableStream<Uint8Array> | null,
    opts.maxResponseBytes ?? MAX_PROVIDER_RESPONSE_BYTES,
  );

  const headers = new Headers();
  const contentType = res.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  return new Response(NULL_BODY_STATUSES.has(res.status) ? null : body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
