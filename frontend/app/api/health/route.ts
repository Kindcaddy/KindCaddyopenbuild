/**
 * Liveness/readiness probe (PRODUCTION-PLAN.md Phase 4).
 *
 * Unauthenticated by design: it leaks nothing beyond up/down status and is
 * consumed by uptime checks (manualplugs §10) and the assistant UI banner.
 * Returns 200 when both dependencies answer, 503 otherwise.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const HERMES_PING_TIMEOUT_MS = 2000;

function hermesBaseUrl(): string {
  const base = (process.env.HERMES_AGENT_BASE_URL ?? 'http://127.0.0.1:8642/v1')
    .replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

async function checkDb(): Promise<'ok' | 'error'> {
  try {
    await db.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkHermes(): Promise<'ok' | 'error'> {
  try {
    const headers: Record<string, string> = {};
    if (process.env.HERMES_AGENT_API_KEY) {
      headers.authorization = `Bearer ${process.env.HERMES_AGENT_API_KEY}`;
    }
    const res = await fetch(`${hermesBaseUrl()}/models`, {
      headers,
      signal: AbortSignal.timeout(HERMES_PING_TIMEOUT_MS),
      cache: 'no-store',
    });
    // Any HTTP answer (even 401/404) proves the gateway is up and reachable.
    return res.status < 500 ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

export async function GET() {
  const [dbStatus, hermesStatus] = await Promise.all([checkDb(), checkHermes()]);
  const ok = dbStatus === 'ok' && hermesStatus === 'ok';
  return NextResponse.json(
    { ok, db: dbStatus, hermes: hermesStatus },
    { status: ok ? 200 : 503 },
  );
}
