import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';

/**
 * Lists every non-admin (employee) member of the current tenant.
 * Admin-only.
 */
export const GET = withGuard(async (_req: NextRequest, context) => {
  if (context.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: admin role required' },
      { status: 403 },
    );
  }

  const memberships = await db.membership.findMany({
    where: {
      tenantId: context.tenantId,
      role: 'employee',
    },
    include: {
      user: true,
      department: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const employees = memberships.map((m) => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
    departmentName: m.department.name,
    role: m.role,
  }));

  return NextResponse.json({ employees });
});
