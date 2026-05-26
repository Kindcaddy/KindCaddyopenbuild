/**
 * Unit test: lib/auth.ts cookie parsing.
 *
 * Why this test exists
 * --------------------
 * `auth.ts` is the gateway that turns an inbound `auth_session` cookie into
 * the `(userId, tenantId?)` pair every downstream layer trusts. A bug here is
 * Tier-0 by definition:
 *
 *   - A wrong-shape parse that swaps userId/tenantId would log every user in
 *     as someone else — the textbook "authenticate-as-anyone" bug.
 *   - A missing/null check that returns `{ userId: '', ... }` would let an
 *     attacker present a blank cookie and have downstream code happily look
 *     up "user with id ''".
 *   - A change to the cookie format (e.g. dropping the `:` separator)
 *     without a coordinated change in `getRequestContext` would silently
 *     drop tenantId from every session and revert callers to "first
 *     membership wins" — which crosses tenants for any user with > 1.
 *
 * Coverage targets the *parser* directly. Cookie I/O is mocked via
 * `next/headers` (same pattern as the existing __tests__/api/resources.test.ts).
 *
 * What's NOT covered here (covered elsewhere or out of scope):
 *   - End-to-end "missing cookie → 401" — that's the auth-guard integration
 *     test row in the §1 surface map (S2, integration tier, separate file).
 *   - `getRequestContext()` itself (the parser's caller) — covered by the
 *     existing /api/resources.test.ts cross-tenant cases.
 */

import { getAuthCookie, setAuthCookie, clearAuthCookie } from '@/lib/auth';
import { cookies } from 'next/headers';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

const mockCookieStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
  getAll: jest.fn(),
  toString: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (cookies as jest.Mock).mockReturnValue(mockCookieStore);
});

describe('getAuthCookie — parser correctness', () => {
  it('parses the canonical "userId:tenantId" shape', () => {
    mockCookieStore.get.mockReturnValue({ value: 'user_abc:tenant_xyz' });
    const result = getAuthCookie();
    expect(result).toEqual({ userId: 'user_abc', tenantId: 'tenant_xyz' });
  });

  it('parses a userId-only cookie (legacy/single-tenant fallback)', () => {
    // The function deliberately tolerates a bare userId without a colon, so
    // that pre-multi-tenant sessions (or `setAuthCookie(userId)` calls
    // without a tenantId) still resolve. If this ever changes to "must have
    // tenantId" the change should be deliberate — break this test on
    // purpose, don't silently widen.
    mockCookieStore.get.mockReturnValue({ value: 'user_abc' });
    const result = getAuthCookie();
    expect(result).toEqual({ userId: 'user_abc' });
    // Critically: tenantId must be `undefined`, not the empty string.
    // Downstream code uses `if (auth.tenantId)` to branch — an empty string
    // would be falsy too, but a future refactor to `auth.tenantId !== undefined`
    // would silently change behavior, so we pin the type here.
    expect(result?.tenantId).toBeUndefined();
  });

  it('returns null when no cookie is present', () => {
    mockCookieStore.get.mockReturnValue(undefined);
    expect(getAuthCookie()).toBeNull();
  });

  it('returns null when the cookie value is the empty string', () => {
    // A blank cookie value must NOT be treated as `userId: ''`. If this
    // test ever fails, every Prisma `findUnique({ where: { id: '' } })`
    // call downstream becomes attacker-controlled.
    mockCookieStore.get.mockReturnValue({ value: '' });
    expect(getAuthCookie()).toBeNull();
  });

  it('accepts a passed-in cookie store (the request-scoped path)', () => {
    // API routes call `getAuthCookie(cookies())` instead of letting the
    // function call `cookies()` itself — this is the path used by every
    // /api route. We pin both branches to make sure they agree.
    const localStore = { ...mockCookieStore, get: jest.fn() };
    localStore.get.mockReturnValue({ value: 'u1:t1' });
    const result = getAuthCookie(localStore as unknown as ReturnType<typeof cookies>);
    expect(result).toEqual({ userId: 'u1', tenantId: 't1' });
    // And it must NOT have fallen back to the global cookies() store.
    expect(mockCookieStore.get).not.toHaveBeenCalled();
  });
});

describe('setAuthCookie / clearAuthCookie — side-effect contract', () => {
  it('setAuthCookie writes the canonical "userId:tenantId" value with hardened flags', () => {
    setAuthCookie('user_abc', 'tenant_xyz');
    expect(mockCookieStore.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe('auth_session');
    expect(value).toBe('user_abc:tenant_xyz');
    // Security flags — these are part of the contract, not implementation
    // detail. httpOnly defends against XSS-stolen sessions; sameSite=lax
    // defends against CSRF on state-changing requests.
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    // 7-day expiry per the architecture doc §4.
    expect(options.maxAge).toBe(60 * 60 * 24 * 7);
  });

  it('setAuthCookie omits the colon when no tenantId is provided', () => {
    setAuthCookie('user_abc');
    const [, value] = mockCookieStore.set.mock.calls[0];
    expect(value).toBe('user_abc');
    // Round-trip invariant: what setAuthCookie writes, getAuthCookie must
    // parse back identically. This is the contract that ties the two
    // functions together.
    mockCookieStore.get.mockReturnValue({ value });
    expect(getAuthCookie()).toEqual({ userId: 'user_abc' });
  });

  it('clearAuthCookie deletes the auth_session cookie by name', () => {
    clearAuthCookie();
    expect(mockCookieStore.delete).toHaveBeenCalledWith('auth_session');
  });
});
