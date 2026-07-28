import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { AppError, reportError } from '@/lib/errors';
import { db } from '@/lib/db';
import type { RequestContext } from '@/lib/context';
import { host, type ChatResponse } from '@/lib/host/host';
import { chatTurnLimiter, chatTurnSemaphore } from '@/lib/rate-limit';
import { RateLimiter } from '@/lib/mcp/policy';
import {
  ByokAuthError,
  ProviderMidturnError,
  ProviderUnreachableError,
  providerOutageSeverity,
} from '@/lib/agents/agent';
import { BYOK_COOKIE, decodeByok } from '@/lib/byok';
import type { ChatDomain } from '@/lib/mcp/domain-catalog';

interface ChatBody {
  sessionId?: string;
  message?: string;
  agent?: 'kindcaddy';
  domain?: ChatDomain;
  /** When true the response is an SSE stream (Phase 5.1). */
  stream?: boolean;
}

/**
 * Denials are expected AppErrors, not ErrorReports — but they must not be
 * invisible: every 429 leaves a `chat.rate_limited` AuditEvent so abuse
 * patterns are reviewable. PRODUCTION-PLAN.md Phase 2.4.
 */
const auditLimiter = new RateLimiter(1, 1 / 30); // 1 audit row per 30s per key

async function auditRateDenial(
  context: RequestContext,
  reason: 'rate_limited' | 'busy',
  extra: Record<string, unknown> = {},
): Promise<void> {
  const key = `${context.tenantId}:${context.userId}:${reason}`;
  if (!auditLimiter.take(key)) return;
  await db.auditEvent.create({
    data: {
      userId: context.userId,
      tenantId: context.tenantId,
      action: 'chat.rate_limited',
      resourceType: 'chat',
      metadata: JSON.stringify({ reason, ...extra }),
    },
  });
}

/**
 * A BYOK key the provider rejected is a user-configuration problem, not a
 * system failure: clean 401 with an actionable message, no ErrorReport.
 * Returns null for any other error so the caller falls through.
 */
function mapByokFailure(err: unknown): AppError | null {
  if (!(err instanceof ByokAuthError)) return null;
  return new AppError(
    'byok_key_invalid',
    'Your saved API key was rejected by the model provider. Update or remove it under Configuration.',
    401,
  );
}

/**
 * Map LLM provider transport failures to a clean 503 with a persisted
 * ErrorReport (Phase 4). Returns null for errors that are not provider-related.
 */
async function mapProviderFailure(
  err: unknown,
  meta: { requestId: string; context: RequestContext; sessionId?: string },
): Promise<AppError | null> {
  const byok = mapByokFailure(err);
  if (byok) return byok;
  const code =
    err instanceof ProviderUnreachableError
      ? 'llm_unreachable'
      : err instanceof ProviderMidturnError
        ? 'llm_error'
        : null;
  if (!code) return null;

  await reportError(err, {
    requestId: meta.requestId,
    route: 'POST /api/mcp/chat',
    code,
    severity: providerOutageSeverity(),
    userId: meta.context.userId,
    tenantId: meta.context.tenantId,
    context: { sessionId: meta.sessionId ?? null },
  });
  return new AppError(
    'assistant_unavailable',
    'The assistant is temporarily unavailable. Please try again shortly.',
    503,
  );
}

export const POST = withGuard(async (req: NextRequest, context, { requestId }) => {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    throw new AppError('invalid_request', 'Request body must be valid JSON', 400);
  }
  if (!body.message || typeof body.message !== 'string') {
    throw new AppError('invalid_request', 'message is required', 400);
  }

  const wantsStream =
    body.stream === true ||
    (req.headers.get('accept') ?? '').includes('text/event-stream');

  // ---- Admission control (Phase 2) — checked before any work starts. ----
  if (!chatTurnSemaphore.tryAcquire()) {
    // Fail fast instead of queueing forever — this is the crash guard.
    await auditRateDenial(context, 'busy', {
      active: chatTurnSemaphore.active,
    });
    return NextResponse.json(
      { error: 'busy', retryAfterSec: 5, requestId },
      { status: 429, headers: { 'retry-after': '5' } },
    );
  }
  const limiterKey = `${context.tenantId}:${context.userId}`;
  if (!chatTurnLimiter.take(limiterKey)) {
    chatTurnSemaphore.release();
    const retryAfterSec = chatTurnLimiter.retryAfterSec(limiterKey);
    await auditRateDenial(context, 'rate_limited', { retryAfterSec });
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec, requestId },
      { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
    );
  }

  const chatRequest = {
    sessionId: body.sessionId,
    message: body.message,
    agent: body.agent,
    domain: body.domain,
    // Session-held BYOK: replaces the platform provider key for this turn.
    byok: decodeByok(req.cookies.get(BYOK_COOKIE)?.value) ?? undefined,
    requestId,
  };

  // ---- Non-streaming JSON path (also the fallback branch). ----
  if (!wantsStream) {
    try {
      const result = await host.chat(context, chatRequest);
      return NextResponse.json(result);
    } catch (err) {
      const mapped = await mapProviderFailure(err, {
        requestId,
        context,
        sessionId: body.sessionId,
      });
      if (mapped) throw mapped;
      throw err;
    } finally {
      chatTurnSemaphore.release();
    }
  }

  // ---- SSE streaming path (Phase 5.1). ----
  // The guard's catch-all can no longer help once the stream is open, so all
  // error handling lives inside the stream: a mid-stream failure emits an
  // `error` event carrying { code, requestId }, is persisted via
  // reportError, and Host.chat has already finalized the pending assistant
  // message — never a stream that just goes quiet.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Client disconnected; the turn keeps running so persistence
          // completes, but there is nobody left to notify.
        }
      };

      void (async () => {
        try {
          const result: ChatResponse = await host.chat(
            context,
            chatRequest,
            (event) => send('status', event),
          );
          send('done', result);
        } catch (err) {
          if (err instanceof AppError) {
            send('error', { code: err.code, message: err.message, requestId });
          } else {
            const mapped = await mapProviderFailure(err, {
              requestId,
              context,
              sessionId: body.sessionId,
            });
            if (mapped) {
              send('error', {
                code: mapped.code,
                message: mapped.message,
                requestId,
              });
            } else {
              await reportError(err, {
                requestId,
                route: 'POST /api/mcp/chat',
                userId: context.userId,
                tenantId: context.tenantId,
                context: { sessionId: body.sessionId ?? null, stream: true },
              });
              send('error', { code: 'internal', requestId });
            }
          }
        } finally {
          chatTurnSemaphore.release();
          try {
            controller.close();
          } catch {
            // Already closed by a client disconnect.
          }
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
});
