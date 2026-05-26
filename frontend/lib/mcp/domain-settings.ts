import { db } from '../db';
import {
  DEFAULT_ACTIVE_DOMAIN_IDS,
  MCP_DOMAINS,
  type ChatDomain,
  isChatDomain,
} from './domain-catalog';

export interface TenantMcpDomainState {
  id: ChatDomain;
  label: string;
  description: string;
  servers: string[];
  active: boolean;
}

export async function listTenantMcpDomains(
  tenantId: string,
): Promise<TenantMcpDomainState[]> {
  await ensureTenantMcpDomains(tenantId);
  const rows = await db.tenantMcpDomain.findMany({
    where: { tenantId },
  });
  const activeByDomain = new Map(rows.map((row) => [row.domain, row.active]));

  return MCP_DOMAINS.map((domain) => ({
    ...domain,
    active: activeByDomain.get(domain.id) ?? true,
  }));
}

export async function activeTenantMcpDomains(
  tenantId: string,
): Promise<TenantMcpDomainState[]> {
  return (await listTenantMcpDomains(tenantId)).filter((domain) => domain.active);
}

export async function setTenantMcpDomains(
  tenantId: string,
  activeDomainIds: ChatDomain[],
  actorUserId: string,
): Promise<TenantMcpDomainState[]> {
  const uniqueIds = Array.from(new Set(activeDomainIds));
  if (uniqueIds.length === 0) {
    throw new Error('At least one MCP domain must remain active');
  }
  const invalid = uniqueIds.filter((id) => !isChatDomain(id));
  if (invalid.length > 0) {
    throw new Error(`Unknown MCP domain(s): ${invalid.join(', ')}`);
  }

  await ensureTenantMcpDomains(tenantId);
  await db.$transaction([
    ...MCP_DOMAINS.map((domain) =>
      db.tenantMcpDomain.upsert({
        where: { tenantId_domain: { tenantId, domain: domain.id } },
        update: { active: uniqueIds.includes(domain.id) },
        create: {
          tenantId,
          domain: domain.id,
          active: uniqueIds.includes(domain.id),
        },
      }),
    ),
    db.auditEvent.create({
      data: {
        userId: actorUserId,
        tenantId,
        action: 'mcp.domains.updated',
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: JSON.stringify({ activeDomainIds: uniqueIds }),
      },
    }),
  ]);

  return listTenantMcpDomains(tenantId);
}

async function ensureTenantMcpDomains(tenantId: string): Promise<void> {
  const existing = await db.tenantMcpDomain.findMany({
    where: { tenantId },
    select: { domain: true },
  });
  const existingIds = new Set(existing.map((row) => row.domain));
  const missing = MCP_DOMAINS.filter((domain) => !existingIds.has(domain.id));
  if (missing.length === 0) return;

  await db.tenantMcpDomain.createMany({
    data: missing.map((domain) => ({
      tenantId,
      domain: domain.id,
      active: DEFAULT_ACTIVE_DOMAIN_IDS.includes(domain.id),
    })),
  });
}
