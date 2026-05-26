import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { host } from '@/lib/host/host';
import type { ChatDomain } from '@/lib/mcp/domain-catalog';

export const POST = withGuard(async (req: NextRequest, context) => {
  try {
    const body = (await req.json()) as {
      sessionId?: string;
      message?: string;
      agent?: 'hermes';
      domain?: ChatDomain;
    };
    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      );
    }
    const result = await host.chat(context, {
      sessionId: body.sessionId,
      message: body.message,
      agent: body.agent,
      domain: body.domain,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Chat failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
