import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { reportError } from '@/lib/errors';
import { verifyState } from '@/lib/crypto';
import {
  createGoogleOAuthClient,
  getStoredGoogleCalendarConnection,
  saveGoogleCalendarConnection,
  GOOGLE_OAUTH_STATE_COOKIE,
} from '@/lib/integrations/google-calendar';

export const GET = withGuard(async (req: NextRequest, context, { requestId }) => {
  const code = req.nextUrl.searchParams.get('code');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError) {
    const redirect = new URL('/app/assistant', req.url);
    redirect.searchParams.set('google_calendar', `error:${oauthError}`);
    return NextResponse.redirect(redirect);
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing "code" in Google OAuth callback.' },
      { status: 400 },
    );
  }

  // Verify the `state` parameter against the nonce cookie and the current
  // session before exchanging the code (PRODUCTION-PLAN.md Phase 3.2).
  const state = req.nextUrl.searchParams.get('state') ?? '';
  const cookieNonce = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  const [stateNonce, stateMac] = state.split('.');
  const stateValid =
    Boolean(stateNonce && stateMac && cookieNonce) &&
    stateNonce === cookieNonce &&
    verifyState(
      `${context.userId}:${context.tenantId}:${stateNonce}`,
      stateMac,
    );
  if (!stateValid) {
    return NextResponse.json(
      { error: 'invalid_oauth_state', requestId },
      { status: 403 },
    );
  }

  try {
    const oauth = createGoogleOAuthClient();
    const tokenResult = await oauth.getToken(code);
    const tokens = tokenResult.tokens;

    const scope = {
      tenantId: context.tenant.id,
      departmentId: context.department.id,
      userId: context.user.id,
    };
    const existing = await getStoredGoogleCalendarConnection(scope);
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken;

    if (!refreshToken) {
      return NextResponse.json(
        {
          error:
            'Google did not return a refresh token. Reconnect with consent and offline access.',
        },
        { status: 400 },
      );
    }

    await saveGoogleCalendarConnection(scope, {
      refreshToken,
      calendarId: 'primary',
    });

    const redirect = new URL('/app/assistant', req.url);
    redirect.searchParams.set('google_calendar', 'connected');
    const res = NextResponse.redirect(redirect);
    res.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    return res;
  } catch (err) {
    // Token exchange / persistence failed — needs operator review, and the
    // raw provider message must not leak to the browser.
    await reportError(err, {
      requestId,
      route: `GET ${req.nextUrl.pathname}`,
      code: 'google_oauth_callback_failed',
      userId: context.userId,
      tenantId: context.tenantId,
    });
    return NextResponse.json(
      { error: 'google_oauth_callback_failed', requestId },
      { status: 500 },
    );
  }
});
