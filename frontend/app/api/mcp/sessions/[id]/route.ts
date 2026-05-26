import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequestContext } from '@/lib/context';
import { host } from '@/lib/host/host';

/**
 * Dynamic route params aren't compatible with the generic withGuard
 * wrapper, so we inline the auth check here.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getRequestContext(cookies());
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const messages = await host.getMessages(ctx, params.id);
  return NextResponse.json({ sessionId: params.id, messages });
}
