/**
 * Integration test: cross-tenant isolation for chat data.
 *
 * Why this test exists
 * --------------------
 * ARCHITECTURE.md §3 states the load-bearing invariant:
 *
 *   "Tenant isolation — every DB query through SessionManager and Host filters
 *    by ctx.tenantId; cross-tenant access is impossible without forging the
 *    cookie."
 *
 * That claim should have a test signing its name. The existing
 * `__tests__/api/resources.test.ts` covers the `Resource` table at the API
 * surface. This test covers the *more sensitive* surface — `ChatSession`,
 * `ChatMessage`, `ToolInvocation` — and goes one step further than the
 * cookie boundary by *forging the session id directly* with an otherwise-valid
 * `RequestContext` from a different tenant. The system must still refuse,
 * because the `tenantId` filter inside SessionManager / Host is a defense in
 * depth that does not depend on the cookie being honest.
 *
 * What's covered (4 cases, all Tier-0):
 *   1. SessionManager.list() returns only the caller's tenant's sessions.
 *   2. SessionManager.getOwned() returns null when the session belongs to
 *      another tenant — even when the session id is correct.
 *   3. SessionManager.listMessages() returns [] for a session owned by another
 *      tenant — proves you can't enumerate messages by guessing IDs.
 *   4. Host.chat({ sessionId: <other tenant's session> }) throws
 *      'Session not found' — proves the chat path itself enforces ownership
 *      and won't append messages to a stranger's session.
 *
 * What's deliberately NOT covered here (covered elsewhere):
 *   - The cookie/auth boundary itself (will be `__tests__/integration/auth-guard.test.ts`).
 *   - Cross-department denials (covered by chat-procurement-vs-finance.test.ts).
 *   - The `Resource` table specifically (covered by api/resources.test.ts).
 */

// The Host.chat() case needs the same MCP domain mocks as the existing
// procurement-vs-finance integration test, because Host.chat() asks
// `activeTenantMcpDomains` before doing anything. We never actually reach
// the agent in this test (the session-not-found check happens earlier in
// Host.chat()), but the import of `host` triggers MCP module evaluation,
// so we mock defensively to keep the test hermetic.
jest.mock('@/lib/mcp/domain-catalog', () => {
  const fakeDomain = {
    id: 'agent' as const,
    label: 'Agent (test)',
    description: 'Synthetic domain for the tenant-isolation test',
    servers: [],
  };
  return {
    MCP_DOMAINS: [fakeDomain],
    DEFAULT_ACTIVE_DOMAIN_IDS: ['agent'],
    isChatDomain: (value: unknown) => value === 'agent',
    getDomainDefinition: (_id: string) => fakeDomain,
  };
});

jest.mock('@/lib/mcp/domain-settings', () => ({
  activeTenantMcpDomains: jest.fn(async () => [
    { id: 'agent', label: 'Agent (test)', description: '', servers: [], active: true },
  ]),
}));

jest.mock('@/lib/mcp/user-domain-settings', () => ({
  listUserMcpDomains: jest.fn(async () => [{ id: 'agent', allowed: true }]),
}));

import { db } from '@/lib/db';
import { SessionManager } from '@/lib/host/session';
import { host } from '@/lib/host/host';
import type { RequestContext } from '@/lib/context';

// ---- Fixtures: two tenants, each with one user, one department, one session ----

interface TenantFixture {
  tenantId: string;
  userId: string;
  departmentId: string;
  membershipId: string;
  sessionId: string;
  context: RequestContext;
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let createdToolInvocationIds: string[] = [];

async function seedTenant(label: string): Promise<TenantFixture> {
  const tenant = await db.tenant.create({
    data: { name: `Tenant Isolation Test — ${label}` },
  });
  const department = await db.department.create({
    data: { tenantId: tenant.id, name: `${label} Engineering` },
  });
  const user = await db.user.create({
    data: {
      // Timestamp + label keeps emails unique across reruns.
      email: `iso-${label.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      name: `${label} User`,
    },
  });
  const membership = await db.membership.create({
    data: {
      userId: user.id,
      tenantId: tenant.id,
      departmentId: department.id,
      role: 'admin',
    },
  });
  const session = await db.chatSession.create({
    data: {
      userId: user.id,
      tenantId: tenant.id,
      title: `${label} Private Session`,
    },
  });
  // Add one message + one tool invocation so listMessages has something to
  // *fail* to leak. If the tenantId filter is missing, this row would show up
  // when the wrong tenant queries.
  const message = await db.chatMessage.create({
    data: {
      sessionId: session.id,
      role: 'assistant',
      agent: 'hermes',
      content: `secret-${label}-content`,
    },
  });
  const inv = await db.toolInvocation.create({
    data: {
      messageId: message.id,
      sessionId: session.id,
      server: 'sqlite',
      tool: 'sqlite.query',
      status: 'ok',
      result: JSON.stringify({ ok: true, summary: `secret-${label}-result` }),
    },
  });
  createdToolInvocationIds.push(inv.id);

  return {
    tenantId: tenant.id,
    userId: user.id,
    departmentId: department.id,
    membershipId: membership.id,
    sessionId: session.id,
    context: {
      userId: user.id,
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: tenant.id,
      tenant: { id: tenant.id, name: tenant.name },
      department: { id: department.id, name: department.name },
      membership: {
        id: membership.id,
        userId: user.id,
        tenantId: tenant.id,
        departmentId: department.id,
        role: 'admin',
      },
      role: 'admin',
      permissions: [],
    },
  };
}

async function cleanupTenant(t: TenantFixture | undefined) {
  if (!t) return;
  // Order: audit → invocations are cascaded via message → tenant cascade
  // covers session/message/membership/department; user is independent.
  await db.auditEvent.deleteMany({ where: { tenantId: t.tenantId } });
  await db.tenant.deleteMany({ where: { id: t.tenantId } });
  await db.user.deleteMany({ where: { id: t.userId } });
}

describe('Cross-tenant isolation (chat surface)', () => {
  beforeAll(async () => {
    tenantA = await seedTenant('A');
    tenantB = await seedTenant('B');
  });

  afterAll(async () => {
    await cleanupTenant(tenantA);
    await cleanupTenant(tenantB);
    await db.$disconnect();
  });

  describe('SessionManager.list()', () => {
    it('returns only the caller-tenant sessions', async () => {
      const sm = new SessionManager();
      const aSessions = await sm.list(tenantA.context);
      const bSessions = await sm.list(tenantB.context);

      const aIds = new Set(aSessions.map((s) => s.id));
      const bIds = new Set(bSessions.map((s) => s.id));

      expect(aIds.has(tenantA.sessionId)).toBe(true);
      expect(aIds.has(tenantB.sessionId)).toBe(false);
      expect(bIds.has(tenantB.sessionId)).toBe(true);
      expect(bIds.has(tenantA.sessionId)).toBe(false);
    });
  });

  describe('SessionManager.getOwned()', () => {
    it('returns the session for its rightful owner', async () => {
      const sm = new SessionManager();
      const own = await sm.getOwned(tenantA.context, tenantA.sessionId);
      expect(own).not.toBeNull();
      expect(own!.id).toBe(tenantA.sessionId);
    });

    it('returns null when the session id belongs to a different tenant', async () => {
      // This is the core invariant: even when an attacker presents a *valid*
      // session id from another tenant, the tenantId filter on getOwned()
      // refuses. If this test ever fails, every tool/message in the system
      // is one cookie-edit away from cross-tenant readability.
      const sm = new SessionManager();
      const stolen = await sm.getOwned(tenantA.context, tenantB.sessionId);
      expect(stolen).toBeNull();
    });
  });

  describe('SessionManager.listMessages()', () => {
    it('returns messages for the rightful owner', async () => {
      const sm = new SessionManager();
      const msgs = await sm.listMessages(tenantA.context, tenantA.sessionId);
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs.some((m) => m.content === 'secret-A-content')).toBe(true);
    });

    it('returns an empty array — NOT the messages — when the session belongs to another tenant', async () => {
      // Implementation detail worth pinning: listMessages internally calls
      // getOwned() first. If a future refactor "optimizes" by querying
      // ChatMessage directly without the ownership check, this test catches
      // the regression. We assert both: no rows leak, AND the secret string
      // never appears in the result.
      const sm = new SessionManager();
      const leaked = await sm.listMessages(tenantA.context, tenantB.sessionId);
      expect(leaked).toEqual([]);
      const serialized = JSON.stringify(leaked);
      expect(serialized).not.toMatch(/secret-B-content/);
      expect(serialized).not.toMatch(/secret-B-result/);
    });
  });

  describe('Host.chat() with a forged sessionId from another tenant', () => {
    it("rejects with 'Session not found' rather than appending to the stranger's session", async () => {
      // Defense-in-depth verification: even if every layer above Host
      // (cookie, guard, RBAC) were bypassed and an attacker called Host.chat
      // directly with their own RequestContext but someone else's sessionId,
      // Host.chat must still refuse. This is the architecture's stated
      // contract in §3 ("RequestContext is verified") combined with §3 step 7
      // ("getOwned(sessionId) or create()").
      await expect(
        host.chat(tenantA.context, {
          sessionId: tenantB.sessionId,
          message: 'hello',
          domain: 'agent',
        }),
      ).rejects.toThrow(/Session not found/);

      // And — critically — no new ChatMessage was appended to tenant B's
      // session as a side effect of the failed attempt. If the throw happened
      // *after* the user message was persisted, we'd have a write-leak even
      // though the response is an error.
      const messagesAfter = await db.chatMessage.findMany({
        where: { sessionId: tenantB.sessionId },
      });
      // Tenant B's session was seeded with exactly one assistant message in
      // seedTenant(). The tenant-A intrusion attempt must not have added rows.
      expect(messagesAfter).toHaveLength(1);
      expect(messagesAfter[0].content).toBe('secret-B-content');
    });
  });
});
