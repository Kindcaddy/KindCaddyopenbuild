import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';
import { notFoundInProduction } from '@/lib/dev-only';

// Dev-only endpoint - 404s in production
export async function POST() {
  const blocked = notFoundInProduction();
  if (blocked) return blocked;

  clearAuthCookie();

  return NextResponse.json({ success: true });
}
