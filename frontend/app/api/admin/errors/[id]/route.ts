import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { AppError } from '@/lib/errors';
import { db } from '@/lib/db';

/**
 * Triage action on a single error report: acknowledge or resolve.
 * Resolving requires a resolution note; both actions are themselves audited.
 */
export function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return withGuard(async (request: NextRequest, context) => {
    if (context.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: admin role required' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      resolution?: string;
    };
    if (body.action !== 'acknowledge' && body.action !== 'resolve') {
      throw new AppError(
        'invalid_request',
        'action must be "acknowledge" or "resolve"',
        400,
      );
    }
    const resolution = (body.resolution ?? '').trim();
    if (body.action === 'resolve' && !resolution) {
      throw new AppError(
        'invalid_request',
        'A resolution note is required to resolve an error report',
        400,
      );
    }

    // Same visibility rule as the list: own tenant or unattributed.
    const report = await db.errorReport.findFirst({
      where: {
        id: params.id,
        OR: [{ tenantId: context.tenantId }, { tenantId: null }],
      },
    });
    if (!report) {
      throw new AppError('not_found', 'Error report not found', 404);
    }

    const updated = await db.errorReport.update({
      where: { id: report.id },
      data:
        body.action === 'resolve'
          ? {
              status: 'resolved',
              resolvedAt: new Date(),
              resolvedBy: context.userId,
              resolution,
            }
          : { status: 'acknowledged' },
    });

    // The fix itself is audited (PRODUCTION-PLAN.md Phase 0.5).
    await db.auditEvent.create({
      data: {
        userId: context.userId,
        tenantId: context.tenantId,
        action:
          body.action === 'resolve' ? 'error.resolved' : 'error.acknowledged',
        resourceType: 'error_report',
        resourceId: report.id,
        metadata: JSON.stringify({
          code: report.code,
          requestId: report.requestId,
          ...(resolution ? { resolution } : {}),
        }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      resolvedBy: updated.resolvedBy,
      resolution: updated.resolution,
    });
  })(req);
}
