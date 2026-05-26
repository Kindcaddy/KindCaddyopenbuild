import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomBytes } from 'node:crypto';
import { withGuard } from '@/lib/guard';
import { buildAuthorizeUrl } from '@/lib/integrations/quickbooks';

/**
 * Sign the OAuth `state` so the callback can prove this flow originated from
 * a real authenticated session of *this* user, not a CSRF-forged callback.
 *
 * Format: `<userId>.<nonce>.<hmac>`
 * The HMAC key is APP_ENC_KEY (already required for envelope encryption).
 */
function signState(userId: string): string {
  const secret = process.env.APP_ENC_KEY;
  if (!secret) {
    throw new Error('APP_ENC_KEY is required to sign OAuth state');
  }
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}.${nonce}`;
  const mac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

export const GET = withGuard(async (_req: NextRequest, context) => {
  try {
    const state = signState(context.user.id);
    const url = buildAuthorizeUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to start QuickBooks OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
