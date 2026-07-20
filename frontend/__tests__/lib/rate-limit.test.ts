import { RateLimiter } from '@/lib/mcp/policy';
import { Semaphore } from '@/lib/rate-limit';

describe('RateLimiter (chat-turn admission control, Phase 2)', () => {
  it('allows a burst up to capacity then denies', () => {
    const limiter = new RateLimiter(3, 0.001); // effectively no refill in-test
    const key = 'tenant:user';
    expect(limiter.take(key)).toBe(true);
    expect(limiter.take(key)).toBe(true);
    expect(limiter.take(key)).toBe(true);
    expect(limiter.take(key)).toBe(false);
  });

  it('isolates keys from each other', () => {
    const limiter = new RateLimiter(1, 0.001);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    expect(limiter.take('b')).toBe(true);
  });

  it('reports a sane Retry-After estimate', () => {
    const limiter = new RateLimiter(1, 0.2); // one token per 5s
    const key = 'k';
    limiter.take(key);
    expect(limiter.take(key)).toBe(false);
    const retry = limiter.retryAfterSec(key);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(5);
  });
});

describe('Semaphore (global concurrency cap, Phase 2.2)', () => {
  it('caps concurrent acquisitions and releases correctly', () => {
    const sem = new Semaphore(2);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(false);
    sem.release();
    expect(sem.tryAcquire()).toBe(true);
  });

  it('never goes negative on extra releases', () => {
    const sem = new Semaphore(1);
    sem.release();
    sem.release();
    expect(sem.active).toBe(0);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(false);
  });
});
