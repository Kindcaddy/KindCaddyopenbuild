import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequestContext } from '@/lib/context';

// Dev-only endpoint - should be disabled in production
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development' },
      { status: 403 }
    );
  }

  const cookieStore = cookies();
  const context = await getRequestContext(cookieStore);

  if (!context) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    user: context.user,
    tenant: context.tenant,
    department: context.department,
    role: context.role,
  });
}
