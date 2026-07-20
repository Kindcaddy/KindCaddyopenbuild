import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequestContext } from '@/lib/context';
import { notFoundInProduction } from '@/lib/dev-only';

// Dev-only endpoint - 404s in production
export async function GET() {
  const blocked = notFoundInProduction();
  if (blocked) return blocked;

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
