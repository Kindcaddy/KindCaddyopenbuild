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

const LLM_PING_TIMEOUT_MS = 2000;

function llmBaseUrl(): string {
  const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
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

async function checkLlm(): Promise<'ok' | 'error' | 'skipped'> {
  // Without a key the app runs on the deterministic mock provider, so there is
  // no external dependency to probe — report 'skipped' rather than failing.
  if (!process.env.OPENAI_API_KEY) return 'skipped';
  try {
    const res = await fetch(`${llmBaseUrl()}/models`, {
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(LLM_PING_TIMEOUT_MS),
      cache: 'no-store',
    });
    // Any HTTP answer (even 401/404) proves the provider is up and reachable.
    return res.status < 500 ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

export async function GET() {
  const [dbStatus, llmStatus] = await Promise.all([checkDb(), checkLlm()]);
  const ok = dbStatus === 'ok' && llmStatus !== 'error';
  return NextResponse.json(
    { ok, db: dbStatus, llm: llmStatus },
    { status: ok ? 200 : 503 },
  );
}
