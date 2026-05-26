import { RequestContext } from './context';

export type Permission =
  | 'resources:read'
  | 'resources:write'
  | 'resources:delete'
  | 'users:manage'
  | 'mcp:manage'
  | '*';

export type Role = 'admin' | 'employee';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  employee: ['resources:read'],
  admin: ['*'],
};

export function getPermissions(role: string): Permission[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}

export function authorize(context: RequestContext, permission: Permission): boolean {
  const userPermissions = getPermissions(context.role);

  if (userPermissions.includes('*')) {
    return true;
  }

  return userPermissions.includes(permission);
}

export function requirePermission(context: RequestContext, permission: Permission): void {
  if (!authorize(context, permission)) {
    throw new Error(`Insufficient permissions: ${permission}`);
  }
}

export function isAdmin(role: string): boolean {
  return role === 'admin';
}
