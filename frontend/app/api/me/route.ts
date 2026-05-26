import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';

export const GET = withGuard(
  async (req: NextRequest, context) => {
    return NextResponse.json({
      user: context.user,
      tenant: context.tenant,
      department: context.department,
      role: context.role,
      permissions: context.permissions,
    });
  },
  { requireAuth: true }
);
