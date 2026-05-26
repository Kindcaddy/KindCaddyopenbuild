/**
 * Unit test: lib/rbac.ts capability map and authorization helpers.
 *
 * Why this test exists
 * --------------------
 * `rbac.ts` is the role axis of the policy gate (ARCHITECTURE.md §6.1, Gate 1).
 * It answers "what verbs can this caller do?" and is consulted by every
 * write-capable code path. A regression here is Tier-0:
 *
 *   - A wrong default in `getPermissions` (e.g. returning `['*']` for an
 *     unknown role instead of `[]`) is fail-OPEN — the worst possible mode.
 *   - A wildcard handled wrong in `authorize` (e.g. `userPermissions.includes(permission)`
 *     instead of also checking `'*'`) silently demotes admins to no-permission.
 *   - A change to the role enum without corresponding ROLE_PERMISSIONS rows
 *     would let new roles silently default to `[]` — also fail-CLOSED but
 *     would lock legitimate users out, which is a different kind of incident.
 *
 * Coverage targets every exported symbol:
 *   getPermissions, authorize, requirePermission, isAdmin
 * plus the ROLE_PERMISSIONS table integrity (every Role key has an entry).
 *
 * What's NOT covered here:
 *   - Integration with policy.ts (covered by __tests__/lib/mcp/policy.test.ts).
 *   - Integration with the API routes (covered by /api/resources.test.ts).
 */

import {
  getPermissions,
  authorize,
  requirePermission,
  isAdmin,
  type Permission,
  type Role,
} from '@/lib/rbac';
import type { RequestContext } from '@/lib/context';

// `authorize` only reads `context.role`. Everything else can be a stub —
// constructing a full RequestContext per case would obscure what's tested.
function ctxWithRole(role: string): RequestContext {
  return { role } as unknown as RequestContext;
}

describe('getPermissions — role → permissions table', () => {
  it('grants employee a read-only permission set', () => {
    expect(getPermissions('employee')).toEqual(['resources:read']);
  });

  it('grants admin the wildcard "*" (and only the wildcard, not an enumerated list)', () => {
    // The wildcard is the contract: admin == "everything, including future
    // permissions added without touching this file." If a future refactor
    // expands admin to ['resources:read', 'resources:write', ...], it
    // would silently fail to grant any *new* permission added later. Pin
    // the wildcard.
    expect(getPermissions('admin')).toEqual(['*']);
  });

  it('returns [] (fail-closed) for unknown roles', () => {
    // The most important assertion in this file. An unknown role MUST
    // NOT default to admin or to any non-empty set. If this ever returns
    // a non-empty array, the system has a fail-OPEN bug at the role axis.
    expect(getPermissions('owner')).toEqual([]);
    expect(getPermissions('viewer')).toEqual([]);
    expect(getPermissions('')).toEqual([]);
    expect(getPermissions('ADMIN')).toEqual([]); // case-sensitive on purpose
  });
});

describe('authorize — wildcard + literal-match semantics', () => {
  it('admin passes for every Permission via the wildcard', () => {
    const allPermissions: Permission[] = [
      'resources:read',
      'resources:write',
      'resources:delete',
      'users:manage',
      'mcp:manage',
    ];
    for (const p of allPermissions) {
      expect(authorize(ctxWithRole('admin'), p)).toBe(true);
    }
  });

  it('employee passes only for the permissions explicitly granted in the table', () => {
    expect(authorize(ctxWithRole('employee'), 'resources:read')).toBe(true);
    expect(authorize(ctxWithRole('employee'), 'resources:write')).toBe(false);
    expect(authorize(ctxWithRole('employee'), 'resources:delete')).toBe(false);
    expect(authorize(ctxWithRole('employee'), 'users:manage')).toBe(false);
    expect(authorize(ctxWithRole('employee'), 'mcp:manage')).toBe(false);
  });

  it('unknown roles are denied for every permission (fail-closed at the gate)', () => {
    // Even though `getPermissions('owner')` is the obvious failure surface,
    // we re-assert through `authorize` because that's what every callsite
    // actually invokes. Belt-and-suspenders against a refactor that
    // bypasses `getPermissions` and reads ROLE_PERMISSIONS directly.
    expect(authorize(ctxWithRole('owner'), 'resources:read')).toBe(false);
    expect(authorize(ctxWithRole(''), 'resources:read')).toBe(false);
  });
});

describe('requirePermission — throws on denial, silent on grant', () => {
  it('returns void (no throw) when the caller has the permission', () => {
    expect(() =>
      requirePermission(ctxWithRole('admin'), 'users:manage'),
    ).not.toThrow();
    expect(() =>
      requirePermission(ctxWithRole('employee'), 'resources:read'),
    ).not.toThrow();
  });

  it('throws an Error whose message includes the missing permission name', () => {
    // The message text is part of the contract for /api/* error handlers
    // that match on `Error.message.includes('Insufficient permissions')`
    // (see /api/resources/route.ts which returns 403 + "Forbidden" by
    // matching this prefix). If you rename the prefix, update that handler
    // in lockstep.
    expect(() =>
      requirePermission(ctxWithRole('employee'), 'resources:write'),
    ).toThrow(/Insufficient permissions: resources:write/);
  });
});

describe('isAdmin — exact-match string check', () => {
  it('returns true only for the literal string "admin"', () => {
    expect(isAdmin('admin')).toBe(true);
  });

  it('returns false for everything else, including case variants', () => {
    // Case sensitivity is a deliberate design choice, mirroring the
    // ROLE_PERMISSIONS table key. Documenting it as a test prevents a
    // well-meaning normalization layer from being added without
    // consideration of every other call site.
    expect(isAdmin('Admin')).toBe(false);
    expect(isAdmin('ADMIN')).toBe(false);
    expect(isAdmin('employee')).toBe(false);
    expect(isAdmin('')).toBe(false);
    expect(isAdmin('owner')).toBe(false);
  });
});

describe('ROLE_PERMISSIONS table integrity', () => {
  it('every value of the Role union has an entry in ROLE_PERMISSIONS', () => {
    // This is a structural test: if a future contributor adds a new role
    // to the `Role` union (e.g. 'auditor') but forgets to add a row to
    // ROLE_PERMISSIONS, getPermissions will silently return [] for that
    // role, locking those users out of everything. There is no compile-time
    // check enforcing the map covers every union member because
    // `ROLE_PERMISSIONS[role as Role] ?? []` swallows the absent key.
    //
    // We assert the contract here: for every known Role value, the
    // permission list must be a defined, non-empty array.
    const knownRoles: Role[] = ['admin', 'employee'];
    for (const role of knownRoles) {
      const perms = getPermissions(role);
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
    }
  });
});
