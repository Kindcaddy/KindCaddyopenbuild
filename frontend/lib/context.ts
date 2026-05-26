import { db } from './db';
import { getAuthCookie } from './auth';
import { getPermissions, Permission } from './rbac';
import { cookies } from 'next/headers';

export type RequestContext = {
  userId: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenantId: string;
  tenant: {
    id: string;
    name: string;
  };
  department: {
    id: string;
    name: string;
  };
  membership: {
    id: string;
    userId: string;
    tenantId: string;
    departmentId: string;
    role: string;
  };
  role: 'admin' | 'employee';
  permissions: Permission[];
};

// ReadonlyRequestCookies type (equivalent to ReturnType<typeof cookies>)
type ReadonlyRequestCookies = ReturnType<typeof cookies>;

export async function getRequestContext(
  cookies: ReadonlyRequestCookies
): Promise<RequestContext | null> {
  const auth = getAuthCookie(cookies);
  
  if (!auth?.userId) {
    return null;
  }

  // Get user
  const user = await db.user.findUnique({
    where: { id: auth.userId },
  });

  if (!user) {
    return null;
  }

  // Get membership - use tenantId from cookie if provided, otherwise get first membership
  let membership;
  if (auth.tenantId) {
    membership = await db.membership.findFirst({
      where: {
        userId: auth.userId,
        tenantId: auth.tenantId,
      },
      include: {
        tenant: true,
        department: true,
      },
    });
  } else {
    membership = await db.membership.findFirst({
      where: {
        userId: auth.userId,
      },
      include: {
        tenant: true,
        department: true,
      },
    });
  }

  if (!membership) {
    return null;
  }

  const rawRole = membership.role;
  const role: 'admin' | 'employee' = rawRole === 'admin' ? 'admin' : 'employee';
  const permissions = getPermissions(role);

  return {
    userId: user.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    tenantId: membership.tenant.id,
    tenant: {
      id: membership.tenant.id,
      name: membership.tenant.name,
    },
    department: {
      id: membership.department.id,
      name: membership.department.name,
    },
    membership: {
      id: membership.id,
      userId: membership.userId,
      tenantId: membership.tenantId,
      departmentId: membership.departmentId,
      role: membership.role,
    },
    role,
    permissions,
  };
}
