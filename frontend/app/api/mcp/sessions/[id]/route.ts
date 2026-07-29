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

/**
 * Delete a chat session (and, via FK cascade, its messages and tool
 * invocations). Ownership is enforced inside SessionManager.delete by the
 * (userId, tenantId) filter — an id belonging to someone else is a 404,
 * indistinguishable from a session that never existed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getRequestContext(cookies());
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const deleted = await host.deleteSession(ctx, params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
