import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';
import { listUserMcpDomains } from '@/lib/mcp/user-domain-settings';

/**
 * Lists every member of the current tenant, split by role.
 * Admin-only.
 *
 * - `employees` carry their full per-domain MCP access state so the access
 *   control page can render toggles inline (no per-row round trip).
 * - `admins` are returned read-only for display: admins always have full MCP
 *   access and the policy surface intentionally offers no way to edit them.
 */
export const GET = withGuard(async (_req: NextRequest, context) => {
  if (context.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: admin role required' },
      { status: 403 },
    );
  }

  const memberships = await db.membership.findMany({
    where: { tenantId: context.tenantId },
    include: {
      user: true,
      department: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const admins = memberships
    .filter((m) => m.role === 'admin')
    .map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      departmentName: m.department.name,
      role: m.role,
    }));

  // One findMany per employee; tenant sizes make this preferable over the
  // added complexity of a grouped join.
  const employees = await Promise.all(
    memberships
      .filter((m) => m.role !== 'admin')
      .map(async (m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        departmentName: m.department.name,
        role: m.role,
        domains: await listUserMcpDomains(m.user.id, context.tenantId),
      })),
  );

  return NextResponse.json({ employees, admins });
});
