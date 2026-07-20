import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { reportError } from '@/lib/errors';
import { signState } from '@/lib/crypto';
import {
  createGoogleOAuthClient,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_OAUTH_STATE_COOKIE,
} from '@/lib/integrations/google-calendar';

export const GET = withGuard(async (req: NextRequest, context, { requestId }) => {
  try {
    // CSRF protection for the connect flow (PRODUCTION-PLAN.md Phase 3.2):
    // `state` binds the callback to this user + tenant + a nonce that also
    // rides in a short-lived httpOnly cookie. The callback verifies both.
    const nonce = crypto.randomUUID();
    const mac = signState(`${context.userId}:${context.tenantId}:${nonce}`);
    const state = `${nonce}.${mac}`;

    const oauth = createGoogleOAuthClient();
    const url = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_CALENDAR_SCOPES,
      state,
    });

    const res = NextResponse.redirect(url);
    res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/api/integrations/google',
    });
    return res;
  } catch (err) {
    // Almost always missing/invalid GOOGLE_CLIENT_ID|SECRET|REDIRECT_URI —
    // a config problem an operator must fix, so it goes in the review queue.
    await reportError(err, {
      requestId,
      route: `GET ${req.nextUrl.pathname}`,
      code: 'google_oauth_start_failed',
      userId: context.userId,
      tenantId: context.tenantId,
    });
    return NextResponse.json(
      { error: 'google_oauth_start_failed', requestId },
      { status: 500 },
    );
  }
});
