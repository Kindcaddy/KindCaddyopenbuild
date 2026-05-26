import { db } from '../db';
import {
  MCP_DOMAINS,
  type ChatDomain,
  isChatDomain,
} from './domain-catalog';

export interface UserMcpDomainState {
  id: ChatDomain;
  label: string;
  description: string;
  servers: string[];
  allowed: boolean;
}

/**
 * Returns the per-user (employee) MCP domain access list for a given tenant.
 * If no row exists for a domain, it defaults to allowed=true.
 */
export async function listUserMcpDomains(
  userId: string,
  tenantId: string,
): Promise<UserMcpDomainState[]> {
  const rows = await db.userMcpDomainAccess.findMany({
    where: { userId, tenantId },
  });
  const allowedByDomain = new Map(rows.map((row) => [row.domain, row.allowed]));

  return MCP_DOMAINS.map((domain) => ({
    ...domain,
    allowed: allowedByDomain.get(domain.id) ?? true,
  }));
}

/**
 * Replace the allow-list for a single employee within a tenant.
 * `allowedDomainIds` is the canonical set of domains the employee may use.
 * Any domain not in the set is recorded as `allowed=false`.
 *
 * The actor (admin) is recorded in the audit log.
 */
export async function setUserMcpDomains(
  userId: string,
  tenantId: string,
  allowedDomainIds: ChatDomain[],
  actorUserId: string,
): Promise<UserMcpDomainState[]> {
  const uniqueIds = Array.from(new Set(allowedDomainIds));
  const invalid = uniqueIds.filter((id) => !isChatDomain(id));
  if (invalid.length > 0) {
    throw new Error(`Unknown MCP domain(s): ${invalid.join(', ')}`);
  }

  await db.$transaction([
    ...MCP_DOMAINS.map((domain) =>
      db.userMcpDomainAccess.upsert({
        where: {
          userId_tenantId_domain: {
            userId,
            tenantId,
            domain: domain.id,
          },
        },
        update: { allowed: uniqueIds.includes(domain.id) },
        create: {
          userId,
          tenantId,
          domain: domain.id,
          allowed: uniqueIds.includes(domain.id),
        },
      }),
    ),
    db.auditEvent.create({
      data: {
        userId: actorUserId,
        tenantId,
        action: 'mcp.user_access.updated',
        resourceType: 'user',
        resourceId: userId,
        metadata: JSON.stringify({ allowedDomainIds: uniqueIds }),
      },
    }),
  ]);

  return listUserMcpDomains(userId, tenantId);
}
