import { db } from '@/lib/db';
import { ensureOnboarded } from '@/lib/onboarding';
import { DEFAULT_ACTIVE_DOMAIN_IDS } from '@/lib/mcp/domain-catalog';

describe('ensureOnboarded (tenant onboarding, Phase 1.2)', () => {
  const EMAIL = 'onboarding-test@example.com';
  let userId: string;

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: EMAIL, name: 'Onboarding Test' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    const memberships = await db.membership.findMany({ where: { userId } });
    const tenantIds = Array.from(new Set(memberships.map((m) => m.tenantId)));
    // Tenant cascade removes departments/memberships/domains.
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.user.delete({ where: { id: userId } });
  });

  it('creates tenant + Executive department + default domains + admin membership on first sign-in', async () => {
    const { tenantId } = await ensureOnboarded({
      userId,
      email: EMAIL,
      name: 'Onboarding Test',
    });

    const membership = await db.membership.findFirst({
      where: { userId, tenantId },
      include: { department: true },
    });
    expect(membership?.role).toBe('admin');
    expect(membership?.department.name).toBe('Executive');

    const domains = await db.tenantMcpDomain.findMany({ where: { tenantId } });
    expect(domains.map((d) => d.domain).sort()).toEqual(
      [...DEFAULT_ACTIVE_DOMAIN_IDS].sort(),
    );
    expect(domains.every((d) => d.active)).toBe(true);
  });

  it('is idempotent: second sign-in reuses the same tenant', async () => {
    const first = await ensureOnboarded({ userId, email: EMAIL });
    const second = await ensureOnboarded({ userId, email: EMAIL });
    expect(second.tenantId).toBe(first.tenantId);
    expect(await db.membership.count({ where: { userId } })).toBe(1);
  });

  it('deduplicates concurrent onboarding attempts for the same user', async () => {
    const tempUser = await db.user.create({
      data: { email: 'onboarding-parallel@example.com', name: 'Parallel User' },
    });

    const [a, b] = await Promise.all([
      ensureOnboarded({ userId: tempUser.id, email: tempUser.email }),
      ensureOnboarded({ userId: tempUser.id, email: tempUser.email }),
    ]);

    expect(a.tenantId).toBe(b.tenantId);
    expect(await db.membership.count({ where: { userId: tempUser.id } })).toBe(1);

    await db.tenant.delete({ where: { id: a.tenantId } });
    await db.user.delete({ where: { id: tempUser.id } });
  });
});
