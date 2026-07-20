import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';

const STATUSES = new Set(['open', 'acknowledged', 'resolved']);
const SEVERITIES = new Set(['warning', 'error', 'fatal']);

/**
 * Lists error reports for admin triage. Admin-only. Visibility: reports
 * attributed to the caller's tenant plus unattributed system reports
 * (tenantId null) — never another tenant's reports.
 *
 * Canonical triage query (PRODUCTION-PLAN.md Phase 0.5) for operators with
 * direct DB access — mirrors ARCHITECTURE.md §6.6 for tools:
 *
 *   SELECT code, route, COUNT(*) FROM "ErrorReport"
 *   WHERE status = 'open' GROUP BY 1, 2 ORDER BY 3 DESC;
 */
export const GET = withGuard(async (req: NextRequest, context) => {
  if (context.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: admin role required' },
      { status: 403 },
    );
  }

  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const severity = params.get('severity');
  const take = Math.min(Number(params.get('take')) || 50, 200);

  const rows = await db.errorReport.findMany({
    where: {
      OR: [{ tenantId: context.tenantId }, { tenantId: null }],
      ...(status && STATUSES.has(status) ? { status } : {}),
      ...(severity && SEVERITIES.has(severity) ? { severity } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
  });

  const counts = await db.errorReport.groupBy({
    by: ['status'],
    where: { OR: [{ tenantId: context.tenantId }, { tenantId: null }] },
    _count: { _all: true },
  });

  return NextResponse.json({
    errors: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      requestId: r.requestId,
      route: r.route,
      userId: r.userId,
      tenantId: r.tenantId,
      code: r.code,
      message: r.message,
      stack: r.stack,
      context: safeJson(r.context),
      severity: r.severity,
      status: r.status,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedBy,
      resolution: r.resolution,
    })),
    counts: Object.fromEntries(
      counts.map((c) => [c.status, c._count._all]),
    ),
  });
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
