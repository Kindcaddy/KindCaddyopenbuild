/**
 * Unit tests for scopeGate(): the pure data-axis check used by the policy
 * gate. Covers all four DataScope variants × allow/deny so that any change
 * to the gate has to update an assertion deliberately rather than slip
 * through silently. No DB, no IO — runs in milliseconds.
 */

import { scopeGate } from '@/lib/mcp/policy';
import type { RequestContext } from '@/lib/context';
import type { DataScope } from '@/lib/mcp/protocol';
import type { RegisteredTool } from '@/lib/mcp/registry';

function makeTool(dataScope: DataScope | undefined): RegisteredTool {
  return {
    name: 'pnl.company_pnl',
    server: 'pnl',
    localName: 'company_pnl',
    description: 'Company-wide P&L',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    dataScope,
  };
}

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  const base: RequestContext = {
    userId: 'u1',
    user: { id: 'u1', email: 'u@x', name: 'U' },
    tenantId: 't1',
    tenant: { id: 't1', name: 'T' },
    department: { id: 'd-fin', name: 'Finance' },
    membership: {
      id: 'm1',
      userId: 'u1',
      tenantId: 't1',
      departmentId: 'd-fin',
      role: 'employee',
    },
    role: 'employee',
    permissions: [],
  };
  return { ...base, ...overrides };
}

describe('scopeGate()', () => {
  describe("'public'", () => {
    it('allows any caller', () => {
      const decision = scopeGate(makeTool('public'), makeContext());
      expect(decision.allow).toBe(true);
      expect(decision.gate).toBeUndefined();
    });
  });

  describe("'own_department'", () => {
    it('allows when caller has a department', () => {
      const decision = scopeGate(
        makeTool('own_department'),
        makeContext({
          department: { id: 'd-proc', name: 'Procurement' },
        }),
      );
      expect(decision.allow).toBe(true);
    });

    it('denies (gate=scope) when caller has no department id', () => {
      const decision = scopeGate(
        makeTool('own_department'),
        makeContext({
          // simulate context built from an admin without a department row
          department: { id: '', name: '' },
        }),
      );
      expect(decision.allow).toBe(false);
      expect(decision.gate).toBe('scope');
      expect(decision.reason).toContain('department context');
    });
  });

  describe("'tenant_admin'", () => {
    // Clearance is carried by membership in the Executive department —
    // not by role. These cases pin that contract: role must NOT influence
    // the tenant_admin decision in either direction.
    it('allows an Executive-department employee', () => {
      const decision = scopeGate(
        makeTool('tenant_admin'),
        makeContext({
          role: 'employee',
          department: { id: 'd-exec', name: 'Executive' },
        }),
      );
      expect(decision.allow).toBe(true);
    });

    it('allows an Executive-department admin (capitalization-tolerant)', () => {
      const decision = scopeGate(
        makeTool('tenant_admin'),
        makeContext({
          role: 'admin',
          department: { id: 'd-exec', name: '  EXECUTIVE  ' },
        }),
      );
      expect(decision.allow).toBe(true);
    });

    it('denies a Procurement admin (role does NOT bypass scope)', () => {
      // The headline regression test for the gap fix: a department admin
      // outside Executive must not be able to read company-wide data just
      // because they were promoted within their own department.
      const decision = scopeGate(
        makeTool('tenant_admin'),
        makeContext({
          role: 'admin',
          department: { id: 'd-proc', name: 'Procurement' },
        }),
      );
      expect(decision.allow).toBe(false);
      expect(decision.gate).toBe('scope');
      expect(decision.reason).toContain('Executive');
    });

    it('denies a Finance employee (Finance is not Executive)', () => {
      const decision = scopeGate(
        makeTool('tenant_admin'),
        makeContext({
          role: 'employee',
          department: { id: 'd-fin', name: 'Finance' },
        }),
      );
      expect(decision.allow).toBe(false);
      expect(decision.gate).toBe('scope');
    });
  });

  describe("{ department: '...' }", () => {
    it('allows when caller department matches by normalized name', () => {
      // Tool wants "finance" (lowercase); caller is in "Finance" with
      // surrounding whitespace. Normalization (trim + lowercase) should
      // make them equal.
      const decision = scopeGate(
        makeTool({ department: 'finance' }),
        makeContext({
          department: { id: 'd-fin', name: '  Finance  ' },
        }),
      );
      expect(decision.allow).toBe(true);
    });

    it('denies (gate=scope) when caller is in a different department', () => {
      // Procurement asking for the Finance-pinned tool is the canonical
      // Procurement-vs-Finance denial that drives the integration test.
      const decision = scopeGate(
        makeTool({ department: 'finance' }),
        makeContext({
          department: { id: 'd-proc', name: 'Procurement' },
        }),
      );
      expect(decision.allow).toBe(false);
      expect(decision.gate).toBe('scope');
      expect(decision.reason).toContain('finance');
    });
  });
});
