import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

// Dev-only endpoint - should be disabled in production
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development' },
      { status: 403 }
    );
  }

  clearAuthCookie();

  return NextResponse.json({ success: true });
}
