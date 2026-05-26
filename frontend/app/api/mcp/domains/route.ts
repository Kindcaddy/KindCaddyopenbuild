import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { listTenantMcpDomains } from '@/lib/mcp/domain-settings';
import { listUserMcpDomains } from '@/lib/mcp/user-domain-settings';

/**
 * Returns the MCP domains visible to the current user, with an `active` flag
 * indicating whether they may use the domain.
 *
 * - Admins see every domain as active (admins are not restricted).
 * - Employees see every domain, but `active` reflects the intersection of:
 *     (a) the tenant-level activation, AND
 *     (b) the per-user allow-list configured by an admin.
 *   This lets the UI render disallowed domains as grayed-out.
 */
export const GET = withGuard(async (_req: NextRequest, context) => {
  const tenantDomains = await listTenantMcpDomains(context.tenantId);

  if (context.role === 'admin') {
    return NextResponse.json({
      domains: tenantDomains.map((d) => ({ ...d, active: true })),
    });
  }

  const userDomains = await listUserMcpDomains(context.userId, context.tenantId);
  const userAllowed = new Map(userDomains.map((d) => [d.id, d.allowed]));

  const merged = tenantDomains.map((d) => ({
    ...d,
    active: d.active && (userAllowed.get(d.id) ?? true),
  }));

  return NextResponse.json({ domains: merged });
});
