/**
 * Validation for user-supplied LLM provider base URLs (BYOK `baseUrl`).
 *
 * The server fetches whatever address a signed-in user saves, and sign-up is
 * open — so in production a custom base URL must be public HTTPS. Loopback,
 * private, link-local (incl. cloud metadata at 169.254.169.254), CGNAT,
 * multicast, documentation and IPv4-embedding IPv6 ranges are refused, as are
 * single-label and internal-only hostnames (Docker service names like `app`,
 * `*.internal`, `*.local`).
 *
 * This check runs when the URL is saved AND before every request; the
 * request path additionally re-checks the resolved IP at connect time
 * (provider-fetch.ts), because DNS can change between save and use.
 *
 * Outside production, http:// and private hosts are allowed so local mock
 * providers (e.g. http://127.0.0.1:3199) keep working.
 */

import { BlockList, isIP } from 'node:net';

const BLOCKED_IPV4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

// No ::ffff:0:0/96 rule: BlockList already checks IPv4-mapped addresses
// against the IPv4 rules, and an explicit mapped rule matches EVERY IPv4.
const BLOCKED_IPV6: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

const blockList = new BlockList();
for (const [net, prefix] of BLOCKED_IPV4) blockList.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of BLOCKED_IPV6) blockList.addSubnet(net, prefix, 'ipv6');

const INTERNAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

const NON_PUBLIC_MESSAGE =
  'baseUrl must be a public provider address, not a private or internal network host';

export type ProviderUrlCheck = { ok: true } | { ok: false; message: string };

export function allowPrivateProviderHosts(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** True for any address that is not a routable public unicast IP. Unparseable input is blocked. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(ip);
  if (family === 4) return blockList.check(ip, 'ipv4');
  if (family === 6) return blockList.check(ip, 'ipv6');
  return true;
}

export function checkProviderBaseUrl(
  raw: string,
  opts: { allowPrivate?: boolean } = {},
): ProviderUrlCheck {
  const allowPrivate = opts.allowPrivate ?? allowPrivateProviderHosts();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: 'baseUrl must be a valid URL' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'baseUrl must not contain credentials' };
  }

  if (allowPrivate) {
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? { ok: true }
      : { ok: false, message: 'baseUrl must be a valid http(s) URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, message: 'baseUrl must use https://' };
  }

  // WHATWG URL parsing already canonicalizes decimal/hex/octal IPv4 forms
  // (e.g. https://2130706433 → 127.0.0.1), so isIP sees the real address.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) {
    return isBlockedAddress(host) ? { ok: false, message: NON_PUBLIC_MESSAGE } : { ok: true };
  }
  if (
    !host.includes('.') ||
    host === 'localhost' ||
    INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return { ok: false, message: NON_PUBLIC_MESSAGE };
  }
  return { ok: true };
}
