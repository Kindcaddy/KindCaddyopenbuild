/**
 * BYOK (bring-your-own-key) session storage.
 *
 * The user's API key lives ONLY in an encrypted httpOnly cookie on their
 * browser (`kc_byok`) — never in the database. The cookie is a session
 * cookie (no maxAge): closing the browser clears it. Encryption reuses the
 * same AES-256-GCM helper as integration tokens (RESOURCE_ENCRYPTION_KEY);
 * in dev, where that key is unset, the value is stored as plain JSON (the
 * crypto helper's documented pass-through).
 */

import { cookies } from 'next/headers';
import { decryptString, encryptString } from './crypto';
import type { ByokConfig } from './llm/types';
import { isByokProviderId } from './llm/byok-provider';

export const BYOK_COOKIE = 'kc_byok';

export function encodeByok(config: ByokConfig): string {
  return encryptString(
    JSON.stringify({
      apiKey: config.apiKey,
      provider: config.provider ?? null,
      baseUrl: config.baseUrl ?? null,
      model: config.model ?? null,
    }),
  );
}

/** Tolerates missing / malformed / undecryptable values by returning null —
 *  a bad cookie degrades to `byok_required`, never a 500. */
export function decodeByok(value: string | undefined | null): ByokConfig | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decryptString(value)) as {
      apiKey?: unknown;
      provider?: unknown;
      baseUrl?: unknown;
      model?: unknown;
    };
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey.length === 0) {
      return null;
    }
    return {
      apiKey: parsed.apiKey,
      provider: isByokProviderId(parsed.provider) ? parsed.provider : undefined,
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0
          ? parsed.baseUrl
          : undefined,
      model:
        typeof parsed.model === 'string' && parsed.model.length > 0
          ? parsed.model
          : undefined,
    };
  } catch {
    return null;
  }
}

/** Read the BYOK config from the current request's cookie store. */
export function readByokFromCookies(
  cookieStore: ReturnType<typeof cookies>,
): ByokConfig | null {
  return decodeByok(cookieStore.get(BYOK_COOKIE)?.value);
}

/** Session cookie on purpose: no maxAge/expires => cleared when the browser
 *  session ends. httpOnly so XSS can never exfiltrate the key. */
export function setByokCookie(config: ByokConfig): void {
  cookies().set(BYOK_COOKIE, encodeByok(config), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export function clearByokCookie(): void {
  cookies().delete(BYOK_COOKIE);
}
