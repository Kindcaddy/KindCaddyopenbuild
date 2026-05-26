import 'dotenv/config';
import { db } from '../lib/db';
import { DEFAULT_ACTIVE_DOMAIN_IDS } from '../lib/mcp/domain-catalog';

async function main() {
  console.log('🌱 Seeding database...');

  await db.auditEvent.deleteMany();
  await db.userMcpDomainAccess.deleteMany();
  await db.tenantMcpDomain.deleteMany();
  await db.resource.deleteMany();
  await db.membership.deleteMany();
  await db.department.deleteMany();
  await db.user.deleteMany();
  await db.tenant.deleteMany();

  const tenant1 = await db.tenant.create({ data: { name: 'Acme Corp' } });
  const tenant2 = await db.tenant.create({ data: { name: 'TechStart Inc' } });

  console.log('✅ Created tenants');

  await db.tenantMcpDomain.createMany({
    data: [tenant1, tenant2].flatMap((tenant) =>
      DEFAULT_ACTIVE_DOMAIN_IDS.map((domain) => ({
        tenantId: tenant.id,
        domain,
        active: true,
      })),
    ),
  });

  console.log('✅ Activated MCP domains');

  const alice = await db.user.create({
    data: { email: 'alice@example.com', name: 'Alice Smith' },
  });
  const bob = await db.user.create({
    data: { email: 'bob@example.com', name: 'Bob Johnson' },
  });
  const charlie = await db.user.create({
    data: { email: 'charlie@example.com', name: 'Charlie Brown' },
  });
  const demo = await db.user.create({
    data: { email: 'demo@kindcaddy.com', name: 'Demo User' },
  });

  console.log('✅ Created users');

  const dept1 = await db.department.create({
    data: { tenantId: tenant1.id, name: 'Engineering' },
  });
  const dept2 = await db.department.create({
    data: { tenantId: tenant2.id, name: 'Engineering' },
  });

  // RBAC × data-scope matrix departments (Tenant 1 only — Tenant 2 stays
  // single-department to keep the simpler dev path uncluttered).
  //
  // 'Executive' is the carrier of `tenant_admin` data scope; see
  // `lib/mcp/policy.ts` for the canonical rule. Finance and Procurement
  // exist so the Procurement-vs-Finance P&L scenario can be reproduced
  // manually in a browser, not just in the integration test.
  const financeDept = await db.department.create({
    data: { tenantId: tenant1.id, name: 'Finance' },
  });
  const procurementDept = await db.department.create({
    data: { tenantId: tenant1.id, name: 'Procurement' },
  });
  const executiveDept = await db.department.create({
    data: { tenantId: tenant1.id, name: 'Executive' },
  });

  console.log('✅ Created departments');

  // Memberships in the simplified two-role model: 'admin' | 'employee'.
  // Alice is an admin in both tenants.
  await db.membership.create({
    data: { userId: alice.id, tenantId: tenant1.id, departmentId: dept1.id, role: 'admin' },
  });
  await db.membership.create({
    data: { userId: alice.id, tenantId: tenant2.id, departmentId: dept2.id, role: 'admin' },
  });

  // Bob and Charlie are employees.
  await db.membership.create({
    data: { userId: bob.id, tenantId: tenant1.id, departmentId: dept1.id, role: 'employee' },
  });
  await db.membership.create({
    data: { userId: bob.id, tenantId: tenant2.id, departmentId: dept2.id, role: 'employee' },
  });
  await db.membership.create({
    data: { userId: charlie.id, tenantId: tenant1.id, departmentId: dept1.id, role: 'employee' },
  });

  // Demo user is admin in Tenant 1 so reviewers land on the admin experience.
  await db.membership.create({
    data: { userId: demo.id, tenantId: tenant1.id, departmentId: dept1.id, role: 'admin' },
  });

  // Demo accounts for the RBAC × data-scope matrix. Each one corresponds
  // to a row in the `Procurement-vs-Finance P&L` design walkthrough so a
  // developer can log in as any of them and reproduce the gate decisions
  // by hand.
  const finance = await db.user.create({
    data: { email: 'finance@example.com', name: 'Finance Fran' },
  });
  const procurement = await db.user.create({
    data: { email: 'procurement@example.com', name: 'Procurement Pat' },
  });
  const executive = await db.user.create({
    data: { email: 'executive@example.com', name: 'Executive Eli' },
  });

  await db.membership.create({
    data: {
      userId: finance.id,
      tenantId: tenant1.id,
      departmentId: financeDept.id,
      role: 'employee',
    },
  });
  await db.membership.create({
    data: {
      userId: procurement.id,
      tenantId: tenant1.id,
      departmentId: procurementDept.id,
      // 'admin' on purpose: proves a department admin still cannot read
      // tenant_admin-scoped tools — role does NOT bypass scope.
      role: 'admin',
    },
  });
  await db.membership.create({
    data: {
      userId: executive.id,
      tenantId: tenant1.id,
      departmentId: executiveDept.id,
      // 'employee' on purpose: proves Executive-dept membership alone is
      // what carries tenant_admin clearance, regardless of role.
      role: 'employee',
    },
  });

  console.log('✅ Created memberships');
  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
