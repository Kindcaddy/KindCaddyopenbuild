import { NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { clearAuthCookie } from '@/lib/auth';
import { signOut } from '@/lib/auth-provider';
import { reportError } from '@/lib/errors';

// Guarded (PRODUCTION-PLAN.md Phase 3.6): logout is a state-changing POST,
// so it gets the same CSRF origin check as every other mutating route.
export const POST = withGuard(async (_req, context, { requestId }) => {
  // Terminate the Auth.js session too. Clearing only the app cookie leaves
  // the 30-day Auth.js database session alive, and the /login short-circuit
  // silently re-mints the app cookie through the bridge — logout looks broken
  // (found 2026-07-28, prod Safari). signOut deletes the DB session row and
  // expires the __Secure-authjs.session-token cookie.
  try {
    await signOut({ redirect: false });
  } catch (err) {
    // Auth.js sign-out must not block logout: the app cookie is the primary
    // session contract, so still clear it — but leave a reviewable trail.
    await reportError(err, {
      requestId,
      route: 'POST /api/logout',
      userId: context?.userId ?? null,
      tenantId: context?.tenantId ?? null,
    });
  }
  clearAuthCookie();
  return NextResponse.json({ success: true });
});
