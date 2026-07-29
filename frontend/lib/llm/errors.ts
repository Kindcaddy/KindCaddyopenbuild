/**
 * Shared provider transport error types. Thrown by every wire adapter
 * (OpenAI-compatible, Anthropic) so callers can distinguish a provider that
 * is unreachable (fast 503) from one that accepted the connection but failed
 * mid-turn. The chat route maps these to `assistant_unavailable`.
 */

/** Provider could not be reached at all (connection refused, DNS, TLS). */
export class ProviderUnreachableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderUnreachableError';
  }
}

/** Provider was reachable but a round failed (HTTP error or timeout). */
export class ProviderMidturnError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderMidturnError';
  }
}
