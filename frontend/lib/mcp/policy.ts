/**
 * Policy & Guardrails: rate-limits, capability checks, and audit decisions
 * applied before any tool call is routed to an MCP server.
 */

import type { RequestContext } from '../context';
import type { DataScope } from './protocol';
import type { RegisteredTool } from './registry';

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
  /**
   * Which gate produced this decision. Present on denials so that audit logs
   * and the refusal UX can branch deterministically on the category, instead
   * of regex-matching `reason`. Omitted on allows.
   */
  gate?: 'role' | 'scope' | 'rate';
}

/** Map MCP tool capability -> roles that may invoke tools at that capability. */
const CAPABILITY_MIN_ROLE: Record<
  RegisteredTool['capability'],
  Array<RequestContext['role']>
> = {
  read: ['admin', 'employee'],
  write: ['admin', 'employee'],
  admin: ['admin'],
};

/**
 * Token-bucket rate limiter scoped per (tenant, user).
 * Kept in-process for simplicity; production would back this with Redis.
 */
class RateLimiter {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();
  constructor(
    private capacity: number,
    private refillPerSec: number,
  ) {}

  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? {
      tokens: this.capacity,
      updatedAt: now,
    };
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(
      this.capacity,
      b.tokens + elapsed * this.refillPerSec,
    );
    b.updatedAt = now;
    if (b.tokens < cost) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= cost;
    this.buckets.set(key, b);
    return true;
  }
}

const toolCallLimiter = new RateLimiter(30, 1); // 30 burst, 1 rps

export interface PolicyInput {
  tool: RegisteredTool;
  context: RequestContext;
  params: unknown;
}

/**
 * Canonical form for department-name comparisons across the policy gate.
 *
 * This is THE place that defines how department names are matched. Every
 * dataScope check that compares a tool's declared department against the
 * caller's department MUST route through this function — never re-derive
 * the rule inline. Keeping it in one spot means a rename like
 * "Finance → FinOps" or a capitalization drift ("finance" vs "Finance")
 * has exactly one knob to turn.
 *
 * Rules:
 *  - `trim()` to absorb stray whitespace from seed data or admin edits.
 *  - `toLowerCase()` so capitalization drift doesn't silently deny.
 *
 * Tenant-scoped uniqueness of department names is assumed (enforced at the
 * DB layer); this normalizer is not a security boundary on its own.
 */
export function normalizeDepartmentName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Canonical department name that carries `tenant_admin` data scope (i.e.
 * company-wide clearance). Compared via {@link normalizeDepartmentName}, so
 * seeds may use any capitalization. Defined here — not in seeds, not in
 * tools — so the gate has one place to look and one place to change.
 *
 * Membership in this department is the ONLY thing that grants tenant_admin
 * scope. Role is intentionally not consulted: a department admin in
 * Procurement must not be able to read company-wide P&L just because they
 * were promoted within their own department.
 */
const EXECUTIVE_DEPARTMENT_LABEL = 'Executive';
const EXECUTIVE_DEPARTMENT_NAME = normalizeDepartmentName(
  EXECUTIVE_DEPARTMENT_LABEL,
);

/**
 * Pure data-axis check: does the caller's department satisfy the tool's
 * declared `dataScope`?
 *
 * Intentionally a free top-level function, not a method:
 *  - no I/O, no async, no hidden state — trivially unit-testable
 *  - depends only on its two arguments, so it's safe to call anywhere
 *  - keeps the policy module flat; a 20-line pure function does not need a
 *    PolicyEngine class wrapping it
 *
 * `undefined` dataScope is treated as `'public'` so existing tools without
 * the new field continue to pass through unchanged.
 *
 * The `{ department: string }` variant is matched by **normalized name**
 * (see {@link normalizeDepartmentName}), not by id. This keeps tool source
 * readable (`dataScope: { department: 'finance' }`) and decouples the gate
 * from opaque department ids, at the cost of needing to update the literal
 * when a department is renamed.
 */
export function scopeGate(
  tool: RegisteredTool,
  context: RequestContext,
): PolicyDecision {
  const scope: DataScope = tool.dataScope ?? 'public';

  if (scope === 'public') {
    return { allow: true };
  }

  if (scope === 'own_department') {
    // Caller may only touch data belonging to their own department.
    // The tool itself is still responsible for actually filtering by
    // department; this gate just blocks the call from being routed when
    // the caller has no department context to scope against.
    if (!context.department?.id) {
      return {
        allow: false,
        reason: `Tool ${tool.name} requires a department context, but caller has none`,
        gate: 'scope',
      };
    }
    return { allow: true };
  }

  if (scope === 'tenant_admin') {
    // Company-wide clearance is carried by membership in the Executive
    // department, NOT by `role === 'admin'`. The two axes must stay
    // independent: a Procurement *admin* still cannot see company-wide P&L,
    // and a Finance *employee* in the Executive group still can. Reading
    // role here would re-collapse the role/scope axes — exactly the
    // collision this design exists to prevent.
    const callerDept = context.department?.name;
    if (
      !callerDept ||
      normalizeDepartmentName(callerDept) !== EXECUTIVE_DEPARTMENT_NAME
    ) {
      return {
        allow: false,
        reason: `Tool ${tool.name} is restricted to the ${EXECUTIVE_DEPARTMENT_LABEL} department`,
        gate: 'scope',
      };
    }
    return { allow: true };
  }

  // { department: string } — pinned to one specific department, matched by
  // normalized name (see normalizeDepartmentName). Never compare raw strings
  // here; always go through the normalizer so capitalization/whitespace
  // drift can't accidentally deny a legitimate caller.
  const callerDept = context.department?.name;
  if (
    !callerDept ||
    normalizeDepartmentName(callerDept) !==
      normalizeDepartmentName(scope.department)
  ) {
    return {
      allow: false,
      reason: `Tool ${tool.name} is restricted to department "${scope.department}"`,
      gate: 'scope',
    };
  }
  return { allow: true };
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { tool, context } = input;

  // 1. Capability check against RBAC role.
  const allowedRoles = CAPABILITY_MIN_ROLE[tool.capability];
  if (!allowedRoles.includes(context.role)) {
    return {
      allow: false,
      reason: `Role "${context.role}" lacks capability "${tool.capability}" for tool ${tool.name}`,
      gate: 'role',
    };
  }

  // 2. Data-axis (department) scope check.
  const scope = scopeGate(tool, context);
  if (!scope.allow) {
    return scope;
  }

  // 3. Rate limit per user.
  const key = `${context.tenantId}:${context.userId}`;
  if (!toolCallLimiter.take(key)) {
    return {
      allow: false,
      reason: `Rate limit exceeded for tool calls. Try again shortly.`,
      gate: 'rate',
    };
  }

  return { allow: true };
}
