import { NextRequest, NextResponse } from 'next/server';

/**
 * Route `/` by session state, before any page rendering happens.
 *
 * Why middleware: the Linux production build serves app/app/page.tsx's output
 * at `/` (root/app segment shadowing — same family as
 * POSTMORTEM-ROOT-LAYOUT-COLLISION.md; verified 2026-07-28 at the artifact
 * level: .next/server/app/index.html and app.html ship identical role-landing
 * markup on Linux, while macOS builds are correct). No root page.tsx — static
 * or dynamic — survives that, so the routing decision lives here, in front of
 * the renderer.
 *
 * Cookie-presence routing (no DB at the edge):
 *   auth_session cookie          -> /app   (live app session)
 *   authjs session-token cookie  -> /api/auth/bridge (app cookie expired,
 *                                   Auth.js session alive: silent re-mint)
 *   neither                      -> /login
 * A stale auth_session (deleted user) lands on /app, whose API calls 401 —
 * the same end state as an unauthenticated direct hit, no worse.
 */
export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();

  if (req.cookies.get('auth_session')?.value) {
    url.pathname = '/app';
    return NextResponse.redirect(url);
  }

  const authJsToken =
    req.cookies.get('__Secure-authjs.session-token')?.value ??
    req.cookies.get('authjs.session-token')?.value;
  if (authJsToken) {
    url.pathname = '/api/auth/bridge';
    return NextResponse.redirect(url);
  }

  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: '/',
};
