/**
 * Health endpoint: reports db + llm status. After retiring Hermes the field is
 * `llm`, and it reports 'skipped' when no provider key is configured (the app
 * runs on the mock provider), so the probe stays green in that mode.
 */

import { db } from '@/lib/db';

describe('GET /api/health', () => {
  const prevKey = process.env.OPENAI_API_KEY;

  afterAll(async () => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    await db.$disconnect();
  });

  it('returns 200 with db=ok and llm=skipped when no provider key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = (await res.json()) as { ok: boolean; db: string; llm: string };
    expect(res.status).toBe(200);
    expect(body.db).toBe('ok');
    expect(body.llm).toBe('skipped');
    expect(body).not.toHaveProperty('hermes');
  });
});
