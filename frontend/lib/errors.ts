/**
 * Error handling seam (PRODUCTION-PLAN.md Phase 0).
 *
 * Two kinds of failure, two paths:
 *
 *  - AppError      — *expected* failures (bad input, missing session, rate
 *                    limited…). They map to clean HTTP responses and are NOT
 *                    persisted: they are the system saying "no", not the
 *                    system being broken.
 *  - reportError() — everything unexpected. Persists an ErrorReport row that
 *                    stays `open` until an admin resolves it in /admin/errors,
 *                    and emits a structured log line carrying the same
 *                    requestId as the HTTP response header.
 *
 * Rule of engagement: every `catch` in lib/ and app/api/ must rethrow, return
 * a typed AppError response, or call reportError() and degrade explicitly.
 */

import { db } from './db';

export type ErrorSeverity = 'warning' | 'error' | 'fatal';

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export interface ReportErrorInput {
  requestId: string;
  /** e.g. "POST /api/mcp/chat" for routes, "mcp.invoke" for subsystems. */
  route: string;
  /** Stable machine code; defaults to 'internal'. */
  code?: string;
  userId?: string | null;
  tenantId?: string | null;
  severity?: ErrorSeverity;
  /** Extra JSON-serializable breadcrumbs (sessionId, tool, round…). */
  context?: Record<string, unknown>;
}

export interface ReportedError {
  id?: string;
  requestId: string;
  code: string;
}

/**
 * Persist an unexpected failure as a reviewable ErrorReport row.
 *
 * Best-effort by design: the reporter must never take the request down with
 * it, so a failed DB write falls back to stderr instead of throwing.
 */
export async function reportError(
  err: unknown,
  input: ReportErrorInput,
): Promise<ReportedError> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? null) : null;
  const code = input.code ?? (err instanceof AppError ? err.code : 'internal');
  const severity: ErrorSeverity = input.severity ?? 'error';

  const logLine = {
    level: severity,
    requestId: input.requestId,
    route: input.route,
    code,
    message,
    userId: input.userId ?? null,
    tenantId: input.tenantId ?? null,
  };

  try {
    const row = await db.errorReport.create({
      data: {
        requestId: input.requestId,
        route: input.route,
        userId: input.userId ?? null,
        tenantId: input.tenantId ?? null,
        code,
        message,
        stack,
        context: JSON.stringify(input.context ?? {}),
        severity,
      },
      select: { id: true },
    });
    console.error(JSON.stringify({ ...logLine, errorReportId: row.id }));
    return { id: row.id, requestId: input.requestId, code };
  } catch (persistErr) {
    // Last-resort channel: stderr only. Losing the row is better than
    // turning one failure into two.
    console.error(
      JSON.stringify({ ...logLine, errorReportFallback: true }),
      persistErr,
    );
    return { requestId: input.requestId, code };
  }
}

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
