import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { withGuard } from '@/lib/guard';
import { saveQuickBooksConnection } from '@/lib/integrations/quickbooks';

/**
 * Verify the signed `state` returned by Intuit. Three things must hold:
 *   1. It parses as `userId.nonce.hmac`.
 *   2. The HMAC verifies against APP_ENC_KEY (proves we minted it).
 *   3. The userId in the state matches the currently-authenticated user
 *      (so a stolen state from one user can't be replayed by another).
 */
function verifyState(rawState: string, currentUserId: string): boolean {
  const secret = process.env.APP_ENC_KEY;
  if (!secret) return false;
  const parts = rawState.split('.');
  if (parts.length !== 3) return false;
  const [userId, nonce, mac] = parts;
  if (userId !== currentUserId) return false;
  const expected = createHmac('sha256', secret)
    .update(`${userId}.${nonce}`)
    .digest('hex');
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const GET = withGuard(async (req: NextRequest, context) => {
  const code = req.nextUrl.searchParams.get('code');
  const realmId = req.nextUrl.searchParams.get('realmId');
  const state = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError) {
    const redirect = new URL('/app/configuration', req.url);
    redirect.searchParams.set('quickbooks', `error:${oauthError}`);
    return NextResponse.redirect(redirect);
  }

  if (!code || !realmId || !state) {
    return NextResponse.json(
      { error: 'Missing required parameters in QuickBooks OAuth callback.' },
      { status: 400 },
    );
  }

  if (!verifyState(state, context.user.id)) {
    return NextResponse.json(
      { error: 'Invalid OAuth state. Restart the connection from /app/configuration.' },
      { status: 400 },
    );
  }

  try {
    await saveQuickBooksConnection(
      {
        tenantId: context.tenant.id,
        departmentId: context.department.id,
        userId: context.user.id,
      },
      { code, realmId },
    );

    const redirect = new URL('/app/configuration', req.url);
    redirect.searchParams.set('quickbooks', 'connected');
    return NextResponse.redirect(redirect);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to complete QuickBooks OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
