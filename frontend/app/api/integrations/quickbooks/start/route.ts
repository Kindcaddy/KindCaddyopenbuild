import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { reportError } from '@/lib/errors';
import { signState } from '@/lib/crypto';
import {
  buildAuthorizeUrl,
  QBO_OAUTH_STATE_COOKIE,
} from '@/lib/integrations/quickbooks';

export const GET = withGuard(async (req: NextRequest, context, { requestId }) => {
  try {
    // CSRF protection: `state` binds the callback to this user + tenant + nonce.
    // Same pattern as Google Calendar OAuth (PRODUCTION-PLAN.md Phase 3.2).
    const nonce = crypto.randomUUID();
    const mac = signState(`${context.userId}:${context.tenantId}:${nonce}`);
    const state = `${nonce}.${mac}`;

    const url = buildAuthorizeUrl(state);

    const res = NextResponse.redirect(url);
    res.cookies.set(QBO_OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/api/integrations/quickbooks',
    });
    return res;
  } catch (err) {
    await reportError(err, {
      requestId,
      route: `GET ${req.nextUrl.pathname}`,
      code: 'qbo_oauth_start_failed',
      userId: context.userId,
      tenantId: context.tenantId,
    });
    return NextResponse.json(
      { error: 'qbo_oauth_start_failed', requestId },
      { status: 500 },
    );
  }
});
