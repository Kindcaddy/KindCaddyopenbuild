/**
 * Chat-turn admission control (PRODUCTION-PLAN.md Phase 2).
 *
 * Two gates protect the long, blocking chat pipeline:
 *
 *  1. chatTurnLimiter — per-(tenant, user) token bucket. Stops one user from
 *     spawning unbounded multi-round agent loops.
 *  2. chatTurnSemaphore — global counting semaphore sized to Hermes's
 *     executor thread pool / local-model batch capacity. This is the actual
 *     crash guard: when full, requests fail fast with 429 `busy` instead of
 *     queueing until sockets hang.
 *
 * Both are in-process and therefore only correct while running a single app
 * instance. Move them behind Redis (same `take(key)` interface) when
 * replicas are introduced (Phase 6).
 */

import { RateLimiter } from './mcp/policy';

// 10 burst, refill 0.2/s ≈ 12 sustained turns per minute per user.
export const chatTurnLimiter = new RateLimiter(10, 0.2);

export class Semaphore {
  private inFlight = 0;
  constructor(private readonly capacity: number) {}

  tryAcquire(): boolean {
    if (this.inFlight >= this.capacity) return false;
    this.inFlight += 1;
    return true;
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  get active(): number {
    return this.inFlight;
  }
}

function maxConcurrentChatTurns(): number {
  const value = Number(process.env.MAX_CONCURRENT_CHAT_TURNS ?? 8);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 8;
}

export const chatTurnSemaphore = new Semaphore(maxConcurrentChatTurns());
