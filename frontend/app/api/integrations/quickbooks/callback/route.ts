import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { reportError } from '@/lib/errors';
import { verifyState } from '@/lib/crypto';
import {
  exchangeCodeForTokens,
  saveQuickBooksConnection,
  QBO_OAUTH_STATE_COOKIE,
} from '@/lib/integrations/quickbooks';

export const GET = withGuard(async (req: NextRequest, context, { requestId }) => {
  const code = req.nextUrl.searchParams.get('code');
  const realmId = req.nextUrl.searchParams.get('realmId');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError) {
    const redirect = new URL('/app/integrations', req.url);
    redirect.searchParams.set('quickbooks', `error:${oauthError}`);
    return NextResponse.redirect(redirect);
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing "code" in QuickBooks OAuth callback.' },
      { status: 400 },
    );
  }

  if (!realmId) {
    return NextResponse.json(
      { error: 'Missing "realmId" in QuickBooks OAuth callback.' },
      { status: 400 },
    );
  }

  // Verify the `state` parameter against the nonce cookie and the current
  // session before exchanging the code (PRODUCTION-PLAN.md Phase 3.2).
  const state = req.nextUrl.searchParams.get('state') ?? '';
  const cookieNonce = req.cookies.get(QBO_OAUTH_STATE_COOKIE)?.value;
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
    const tokens = await exchangeCodeForTokens(code);

    const scope = {
      tenantId: context.tenant.id,
      departmentId: context.department.id,
      userId: context.user.id,
    };

    await saveQuickBooksConnection(scope, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      realmId,
      expiresIn: tokens.expires_in,
      refreshExpiresIn: tokens.x_refresh_token_expires_in,
    });

    const redirect = new URL('/app/integrations', req.url);
    redirect.searchParams.set('quickbooks', 'connected');
    const res = NextResponse.redirect(redirect);
    res.cookies.delete(QBO_OAUTH_STATE_COOKIE);
    return res;
  } catch (err) {
    await reportError(err, {
      requestId,
      route: `GET ${req.nextUrl.pathname}`,
      code: 'qbo_oauth_callback_failed',
      userId: context.userId,
      tenantId: context.tenantId,
    });
    return NextResponse.json(
      { error: 'qbo_oauth_callback_failed', requestId },
      { status: 500 },
    );
  }
});
