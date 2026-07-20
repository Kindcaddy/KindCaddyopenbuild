import { cookies } from 'next/headers';

const COOKIE_NAME = 'auth_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function setAuthCookie(userId: string, tenantId?: string) {
  const cookieStore = cookies();
  const cookieValue = tenantId ? `${userId}:${tenantId}` : userId;
  
  cookieStore.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Strict in production (CSRF hardening). Dev stays lax so OAuth redirect
    // flows on localhost keep working. The post-sign-in hop to /app is a
    // client-side navigation (see /api/auth/bridge) so strict is safe.
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

export function getAuthCookie(cookieStore?: ReturnType<typeof cookies>): { userId: string; tenantId?: string } | null {
  const cookiesToUse = cookieStore || cookies();
  const cookie = cookiesToUse.get(COOKIE_NAME);
  
  if (!cookie?.value) {
    return null;
  }

  const parts = cookie.value.split(':');
  if (parts.length === 1) {
    return { userId: parts[0] };
  }
  return { userId: parts[0], tenantId: parts[1] };
}

export function clearAuthCookie() {
  const cookieStore = cookies();
  cookieStore.delete(COOKIE_NAME);
}
