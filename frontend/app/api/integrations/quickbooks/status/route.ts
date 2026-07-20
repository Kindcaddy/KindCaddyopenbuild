import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import {
  getStoredQuickBooksConnection,
  deleteQuickBooksConnection,
} from '@/lib/integrations/quickbooks';

/**
 * GET  — check QuickBooks connection status for the current user.
 * DELETE — disconnect QuickBooks (removes stored tokens).
 */
export const GET = withGuard(async (_req: NextRequest, context) => {
  const stored = await getStoredQuickBooksConnection({
    tenantId: context.tenant.id,
    departmentId: context.department.id,
    userId: context.user.id,
  });

  if (!stored) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    realmId: stored.realmId,
    connectedAt: stored.connectedAt,
  });
});

export const DELETE = withGuard(async (_req: NextRequest, context) => {
  await deleteQuickBooksConnection({
    tenantId: context.tenant.id,
    departmentId: context.department.id,
    userId: context.user.id,
  });

  return NextResponse.json({ connected: false });
});
