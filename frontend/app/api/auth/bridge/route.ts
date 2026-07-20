/**
 * Post-sign-in bridge (PRODUCTION-PLAN.md Phase 1.2).
 *
 * Auth.js redirects here after any successful sign-in. This is the single
 * seam where the Auth.js identity becomes the app's own session: ensure the
 * user is onboarded (tenant / Executive department / default MCP domains /
 * Membership), then set the legacy `auth_session` cookie that
 * getAuthCookie() / withGuard depend on.
 *
 * The final hop to /app is a client-side navigation (not a 302) so that the
 * production `sameSite: strict` cookie is sent on the first request even
 * when the OAuth redirect chain originated cross-site.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-provider';
import { setAuthCookie } from '@/lib/auth';
import { ensureOnboarded, OnboardingError } from '@/lib/onboarding';
import { newRequestId, reportError } from '@/lib/errors';

function clientRedirect(to: string): NextResponse {
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><title>Signing you in…</title></head>
  <body>
    <p style="font-family: system-ui, sans-serif; color: #555; padding: 2rem;">Signing you in…</p>
    <script>window.location.replace(${JSON.stringify(to)});</script>
  </body>
</html>`;
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function GET(req: NextRequest) {
  const requestId = newRequestId();
  const route = 'GET /api/auth/bridge';

  let session;
  try {
    session = await auth();
  } catch (err) {
    await reportError(err, { requestId, route, code: 'auth_callback_failed' });
    return NextResponse.redirect(new URL('/login?error=signin_failed', req.url));
  }

  const user = session?.user;
  if (!user?.id || !user.email) {
    // No Auth.js session: the user landed here without completing sign-in.
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { tenantId } = await ensureOnboarded({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
    setAuthCookie(user.id, tenantId);
    return clientRedirect('/app');
  } catch (err) {
    // A user stuck unable to sign up is exactly the class of bug the error
    // trail exists to catch — never a silent redirect to a generic error.
    await reportError(err, {
      requestId,
      route,
      code:
        err instanceof OnboardingError
          ? 'tenant_onboarding_failed'
          : 'auth_callback_failed',
      userId: user.id,
      context: { email: user.email },
    });
    return NextResponse.redirect(new URL('/login?error=signin_failed', req.url));
  }
}
