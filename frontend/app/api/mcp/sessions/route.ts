import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { host } from '@/lib/host/host';

export const GET = withGuard(async (_req: NextRequest, context) => {
  const sessions = await host.listSessions(context);
  return NextResponse.json({ sessions });
});

export const POST = withGuard(async (req: NextRequest, context) => {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const session = await host.createSession(context, body.title);
  return NextResponse.json({ session }, { status: 201 });
});
