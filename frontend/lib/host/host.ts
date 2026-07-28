/**
 * Host / Application layer: owns the Chat UI-facing surface, the session
 * store, authN/Z enforcement, and routing to the right agent.
 *
 * Flow (mirrors the architecture diagram):
 *   1. User prompt arrives with a RequestContext.
 *   2. Host ensures a ChatSession, persists the user message.
 *   3. Host routes the request to the KindCaddy agent (direct provider call).
 *   4. The agent decides whether to call KindCaddy MCP tools.
 *   5. Host persists the assistant message + trace, then (smart mode) distills
 *      per-user memory from the turn.
 */

import { db } from '../db';
import type { RequestContext } from '../context';
import { AppError } from '../errors';
import { mcp } from '../mcp';
import { activeTenantMcpDomains } from '../mcp/domain-settings';
import { listUserMcpDomains } from '../mcp/user-domain-settings';
import {
  getDomainDefinition,
  isChatDomain,
  type ChatDomain,
} from '../mcp/domain-catalog';
import { KindCaddyAgent } from '../agents/agent';
import type { AgentProgressEvent, AgentTraceEntry } from '../agents/base';
import type { ByokConfig } from '../llm/types';
import {
  extractAndSaveSmartMemory,
  getMemoryMode,
  listMemoryForInjection,
} from '../memory/store';
import { SessionManager } from './session';

export type AgentId = 'kindcaddy';

/** Human-friendly label for the model that answered, recorded on messages. */
function llmLabel(byok?: ByokConfig): string {
  return byok?.model ?? process.env.OPENAI_MODEL ?? 'kindcaddy';
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
  /** Reserved for compatibility; the KindCaddy agent is always used. */
  agent?: AgentId;
  /** Limit exposed tools to a domain-specific MCP slice. */
  domain?: ChatDomain;
  /** Per-user BYOK override for this turn (session-held; see lib/byok.ts). */
  byok?: ByokConfig;
  /** Correlation id from withGuard; rides into traces and error reports. */
  requestId?: string;
}

export interface ChatResponse {
  sessionId: string;
  assistantMessageId: string;
  agent: AgentId;
  reply: string;
  trace: AgentTraceEntry[];
}

export class Host {
  private sessions = new SessionManager();

  async listSessions(ctx: RequestContext) {
    return this.sessions.list(ctx);
  }

  async getMessages(ctx: RequestContext, sessionId: string) {
    return this.sessions.listMessages(ctx, sessionId);
  }

  async createSession(ctx: RequestContext, title?: string) {
    return this.sessions.create(ctx, title);
  }

  async chat(
    ctx: RequestContext,
    req: ChatRequest,
    onEvent?: (event: AgentProgressEvent) => void,
  ): Promise<ChatResponse> {
    const message = (req.message ?? '').trim();
    if (!message) throw new AppError('invalid_request', 'message is required', 400);

    // 1. Resolve / create session, enforce ownership.
    let session = req.sessionId
      ? await this.sessions.getOwned(ctx, req.sessionId)
      : null;
    if (req.sessionId && !session) {
      throw new AppError('session_not_found', 'Session not found', 404);
    }
    if (!session) {
      const created = await this.sessions.create(ctx, deriveTitle(message));
      session = { id: created.id, title: created.title, memory: '{}' };
    }

    // 2. Persist user message.
    await this.sessions.createMessage({
      sessionId: session.id,
      role: 'user',
      content: message,
    });

    // 3. Route (single KindCaddy agent runtime).
    const agentId: AgentId = req.agent ?? 'kindcaddy';

    // 4. Load history and create a placeholder assistant message so tool
    //    invocations have a foreign key to hang off of.
    const history = await this.sessions.loadHistoryAsTurns(session.id);
    const assistant = await this.sessions.createMessage({
      sessionId: session.id,
      role: 'assistant',
      agent: agentId,
      content: '',
      metadata: JSON.stringify({ pending: true }),
    });

    const tenantDomains = await activeTenantMcpDomains(ctx.tenantId);
    if (tenantDomains.length === 0) {
      throw new AppError(
        'no_active_domains',
        'No MCP domains are active for this tenant',
        409,
      );
    }
    // Employees are further restricted by per-user admin-managed allow-list.
    let activeDomains = tenantDomains;
    if (ctx.role !== 'admin') {
      const userDomains = await listUserMcpDomains(ctx.userId, ctx.tenantId);
      const allowedIds = new Set(
        userDomains.filter((d) => d.allowed).map((d) => d.id),
      );
      activeDomains = tenantDomains.filter((d) => allowedIds.has(d.id));
      if (activeDomains.length === 0) {
        throw new AppError(
          'domain_access_denied',
          'You do not have access to any MCP domains. Ask an admin to grant access.',
          403,
        );
      }
    }
    const requestedDomain = isChatDomain(req.domain)
      ? req.domain
      : activeDomains[0].id;
    const activeDomain = activeDomains.find((domain) => domain.id === requestedDomain);
    if (!activeDomain) {
      throw new AppError(
        'domain_unavailable',
        `MCP domain "${requestedDomain}" is not available for your account`,
        403,
      );
    }
    const domainDefinition = getDomainDefinition(activeDomain.id);
    const allowedServers = new Set(domainDefinition.servers);

    // 4b. Load the caller's memory mode + injected items (scoped to userId +
    //     tenantId). Injection is independent of capture mode.
    const [memoryMode, memory] = await Promise.all([
      getMemoryMode(ctx),
      listMemoryForInjection(ctx),
    ]);

    // 5. Run the KindCaddy agent as the primary agent layer.
    const trace: AgentTraceEntry[] = [];
    const agent = new KindCaddyAgent(
      mcp.client,
      () => mcp.registry.listTools().filter((tool) => allowedServers.has(tool.server)),
    );
    let finalContent: string;
    try {
      const result = await agent.step({
        context: ctx,
        // history already ends with the just-persisted user message (step 2
        // wrote it before step 4 loaded history) — appending it again sent
        // every request to the provider twice and made some models treat the
        // second copy as an unanswered request (re-call loops).
        history,
        sessionId: session.id,
        assistantMessageId: assistant.id,
        requestId: req.requestId,
        trace,
        memory,
        byok: req.byok,
        onEvent,
      });
      finalContent = result.finalContent;
    } catch (err) {
      // The turn died mid-flight. Finalize the placeholder so the session
      // never shows a forever-pending assistant message; the guard's
      // catch-all persists the ErrorReport when this rethrows.
      await this.sessions.updateMessage(assistant.id, {
        content: '',
        metadata: JSON.stringify({
          agent: agentId,
          error: true,
          requestId: req.requestId ?? null,
          domain: activeDomain.id,
          trace,
        }),
      });
      throw err;
    }

    // 6. Update assistant message, session memory, audit log.
    await this.sessions.updateMessage(assistant.id, {
      content: finalContent,
      metadata: JSON.stringify({
        agent: agentId,
        trace,
        llm: llmLabel(req.byok),
        domain: activeDomain.id,
      }),
    });
    await this.sessions.touch(
      session.id,
      session.title === 'New conversation' ? deriveTitle(message) : undefined,
    );
    await this.sessions.updateMemory(session.id, {
      lastAgent: agentId,
      lastTurnAt: new Date().toISOString(),
    });

    await db.auditEvent.create({
      data: {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        action: 'mcp.chat.turn',
        resourceType: 'session',
        resourceId: session.id,
        metadata: JSON.stringify({
          agent: agentId,
          llm: llmLabel(req.byok),
          domain: activeDomain.id,
          toolCalls: trace.filter((t) => t.type === 'tool').length,
        }),
      },
    });

    // 7. Smart mode: distill durable per-user memory from this turn. Fire and
    //    forget — the reply is already finalized, so extraction adds no latency
    //    and its failures never affect the response (they self-report).
    if (memoryMode === 'smart') {
      void extractAndSaveSmartMemory(ctx, {
        userMessage: message,
        assistantReply: finalContent,
        requestId: req.requestId,
      });
    }

    return {
      sessionId: session.id,
      assistantMessageId: assistant.id,
      agent: agentId,
      reply: finalContent,
      trace,
    };
  }
}

export const host = new Host();

function deriveTitle(message: string): string {
  const one = message.trim().replace(/\s+/g, ' ');
  return one.length > 60 ? one.slice(0, 57) + '…' : one;
}
