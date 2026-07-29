/**
 * Health endpoint: reports db status. Chat is BYOK-only — the platform holds
 * no LLM credential, so `llm` is permanently 'skipped' (there is no provider
 * dependency to probe). This pins that deliberate contract.
 */

import { db } from '@/lib/db';

describe('GET /api/health', () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it('returns 200 with db=ok and llm=skipped (BYOK-only, no platform key)', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = (await res.json()) as { ok: boolean; db: string; llm: string };
    expect(res.status).toBe(200);
    expect(body.db).toBe('ok');
    expect(body.llm).toBe('skipped');
    expect(body).not.toHaveProperty('hermes');
  });
});
