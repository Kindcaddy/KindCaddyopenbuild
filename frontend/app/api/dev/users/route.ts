import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Dev-only endpoint - returns list of users with their tenants for dev login page
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development' },
      { status: 403 }
    );
  }

  try {
    const users = await db.user.findMany({
      include: {
        memberships: {
          include: {
            tenant: true,
            department: true,
          },
        },
      },
    });

    const usersWithTenants = users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      tenants: user.memberships.map((membership) => ({
        id: membership.tenantId,
        name: membership.tenant.name,
        departmentId: membership.departmentId,
        departmentName: membership.department.name,
        role: membership.role,
      })),
    }));

    return NextResponse.json({ users: usersWithTenants });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
