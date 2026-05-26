import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { mcp } from '@/lib/mcp';
import { activeTenantMcpDomains } from '@/lib/mcp/domain-settings';
import { listUserMcpDomains } from '@/lib/mcp/user-domain-settings';

export const GET = withGuard(async (_req: NextRequest, context) => {
  const tenantActiveDomains = await activeTenantMcpDomains(context.tenantId);
  const tenantActiveServers = new Set(
    tenantActiveDomains.flatMap((domain) => domain.servers),
  );

  // Compute the set of servers the current user is actually allowed to use.
  // Admins: tenant active set. Employees: intersect with per-user allow-list.
  let userAllowedServers = tenantActiveServers;
  if (context.role !== 'admin') {
    const userDomains = await listUserMcpDomains(context.userId, context.tenantId);
    const userAllowedDomainIds = new Set(
      userDomains.filter((d) => d.allowed).map((d) => d.id),
    );
    const tenantActiveById = new Map(tenantActiveDomains.map((d) => [d.id, d]));
    userAllowedServers = new Set(
      Array.from(userAllowedDomainIds)
        .map((id) => tenantActiveById.get(id))
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .flatMap((d) => d.servers),
    );
  }

  const servers = mcp.registry.listServers().map(({ id, handler }) => {
    const desc = handler.describe();
    return {
      id,
      name: desc.name,
      version: desc.version,
      description: desc.description,
      allowed: userAllowedServers.has(id),
      tools: desc.tools.map((t) => ({
        name: t.name,
        description: t.description,
        capability: t.capability,
        inputSchema: t.inputSchema,
      })),
    };
  });
  const tools = mcp.registry.listTools().map((t) => ({
    name: t.name,
    server: t.server,
    localName: t.localName,
    description: t.description,
    capability: t.capability,
    allowed: userAllowedServers.has(t.server),
  }));
  return NextResponse.json({ servers, tools });
});
