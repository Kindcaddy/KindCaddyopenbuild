import { NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { clearAuthCookie } from '@/lib/auth';

// Guarded (PRODUCTION-PLAN.md Phase 3.6): logout is a state-changing POST,
// so it gets the same CSRF origin check as every other mutating route.
export const POST = withGuard(async () => {
  clearAuthCookie();
  return NextResponse.json({ success: true });
});
