/**
 * Tenant onboarding (PRODUCTION-PLAN.md Phase 1.2).
 *
 * First sign-in of a brand-new user creates their workspace:
 *   - a Tenant,
 *   - the tenant's `Executive` department (the `tenant_admin` scope
 *     convention in lib/mcp/policy.ts depends on this exact name),
 *   - default TenantMcpDomain rows so Host.chat() doesn't throw
 *     "No MCP domains are active for this tenant",
 *   - an `admin` Membership for the founding user.
 *
 * Subsequent sign-ins are a single findFirst. Invited users (memberships
 * created by an admin) skip tenant creation entirely.
 */

import { createHash } from 'crypto';
import { db } from './db';
import { DEFAULT_ACTIVE_DOMAIN_IDS } from './mcp/domain-catalog';

export class OnboardingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'OnboardingError';
  }
}

export async function ensureOnboarded(input: {
  userId: string;
  email: string;
  name?: string | null;
}): Promise<{ tenantId: string }> {
  const existing = await db.membership.findFirst({
    where: { userId: input.userId },
    select: { tenantId: true },
  });
  if (existing) return { tenantId: existing.tenantId };

  const display =
    input.name?.trim() || input.email.split('@')[0] || 'New user';

  try {
    const tenantId = await db.$transaction(async (tx) => {
      // Serialize onboarding per user to avoid duplicate tenants when the
      // sign-in callback is hit twice (e.g. email scanners / double-clicks).
      const { key1, key2 } = advisoryKey(input.userId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}, ${key2})`;
      const lockedExisting = await tx.membership.findFirst({
        where: { userId: input.userId },
        select: { tenantId: true },
      });
      if (lockedExisting) return lockedExisting.tenantId;

      const tenant = await tx.tenant.create({
        data: { name: `${display}'s workspace` },
      });
      const executive = await tx.department.create({
        data: { tenantId: tenant.id, name: 'Executive' },
      });
      await tx.tenantMcpDomain.createMany({
        data: DEFAULT_ACTIVE_DOMAIN_IDS.map((domain) => ({
          tenantId: tenant.id,
          domain,
          active: true,
        })),
      });
      await tx.membership.create({
        data: {
          userId: input.userId,
          tenantId: tenant.id,
          departmentId: executive.id,
          role: 'admin',
        },
      });
      return tenant.id;
    });
    return { tenantId };
  } catch (err) {
    throw new OnboardingError(
      `Tenant onboarding failed for user ${input.userId}`,
      err,
    );
  }
}

function advisoryKey(userId: string): { key1: number; key2: number } {
  const hash = createHash('sha256').update(userId).digest('hex');
  // Split into two signed 32-bit integers for pg_advisory_xact_lock(int, int).
  const key1 = parseInt(hash.slice(0, 8), 16) | 0;
  const key2 = parseInt(hash.slice(8, 16), 16) | 0;
  return { key1, key2 };
}
