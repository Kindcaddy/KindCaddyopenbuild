import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe (PRODUCTION-PLAN.md Phase 4).
 *
 * Unauthenticated by design: it leaks nothing beyond up/down status and is
 * consumed by uptime checks and the assistant UI banner. Returns 200 when
 * the database answers, 503 otherwise.
 *
 * Chat is BYOK-only: the platform holds no LLM credential, so there is no
 * provider dependency to probe — `llm` reports 'skipped' permanently.
 * Per-user key health is surfaced in-product (byok_required /
 * byok_key_invalid errors), not here.
 */
async function checkDb(): Promise<'ok' | 'error'> {
  try {
    await db.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function GET() {
  const dbStatus = await checkDb();
  return NextResponse.json(
    { ok: dbStatus === 'ok', db: dbStatus, llm: 'skipped' },
    { status: dbStatus === 'ok' ? 200 : 503 },
  );
}
