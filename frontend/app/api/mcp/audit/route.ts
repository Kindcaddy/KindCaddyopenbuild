import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';

export const GET = withGuard(async (req: NextRequest, context) => {
  const limit = Math.min(
    Number(new URL(req.url).searchParams.get('limit') ?? 25),
    100,
  );
  const rows = await db.auditEvent.findMany({
    where: { tenantId: context.tenantId, action: { startsWith: 'mcp.' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return NextResponse.json({
    events: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      metadata: safeJson(r.metadata),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
