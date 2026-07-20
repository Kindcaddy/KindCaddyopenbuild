import { NextResponse } from 'next/server';

/**
 * Dev-only routes must be indistinguishable from non-existent routes in
 * production (404, not 403 — a 403 confirms the endpoint exists).
 * PRODUCTION-PLAN.md Phase 1.2.
 */
export function notFoundInProduction(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
