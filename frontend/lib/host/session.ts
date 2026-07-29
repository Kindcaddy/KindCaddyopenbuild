/**
 * Session Manager: reads and writes chat sessions, enforcing tenant/user
 * ownership. Every call through the Host is scoped to the caller.
 */

import { db } from '../db';
import type { RequestContext } from '../context';
import type { ChatTurn } from '../llm/types';

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export class SessionManager {
  async list(ctx: RequestContext): Promise<SessionSummary[]> {
    const rows = await db.chatSession.findMany({
      where: { userId: ctx.userId, tenantId: ctx.tenantId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      messageCount: r._count.messages,
    }));
  }

  async create(ctx: RequestContext, title?: string): Promise<SessionSummary> {
    const s = await db.chatSession.create({
      data: {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        title: title || 'New conversation',
      },
    });
    return {
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messageCount: 0,
    };
  }

  async getOwned(
    ctx: RequestContext,
    sessionId: string,
  ): Promise<{ id: string; title: string; memory: string } | null> {
    const s = await db.chatSession.findFirst({
      where: { id: sessionId, userId: ctx.userId, tenantId: ctx.tenantId },
      select: { id: true, title: true, memory: true },
    });
    return s ?? null;
  }

  /**
   * Delete one of the caller's own sessions. ChatMessage rows cascade with
   * the session and ToolInvocation rows cascade with their message, so one
   * delete purges the whole conversation. Returns false when the session
   * isn't owned by (userId, tenantId) — same refusal boundary as getOwned,
   * so a forged cross-tenant id is a no-op, never a delete.
   */
  async delete(ctx: RequestContext, sessionId: string): Promise<boolean> {
    const owned = await this.getOwned(ctx, sessionId);
    if (!owned) return false;
    await db.chatSession.delete({ where: { id: owned.id } });
    await db.auditEvent.create({
      data: {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        action: 'chat_session.deleted',
        resourceType: 'chat_session',
        resourceId: owned.id,
        metadata: JSON.stringify({ title: owned.title }),
      },
    });
    return true;
  }

  async listMessages(
    ctx: RequestContext,
    sessionId: string,
  ): Promise<Array<{
    id: string;
    role: string;
    agent: string | null;
    content: string;
    metadata: unknown;
    createdAt: string;
    invocations: Array<{
      id: string;
      server: string;
      tool: string;
      status: string;
      latencyMs: number;
      params: unknown;
      result: unknown;
    }>;
  }>> {
    const session = await this.getOwned(ctx, sessionId);
    if (!session) return [];
    const rows = await db.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: { invocations: true },
    });
    return rows.map((m) => ({
      id: m.id,
      role: m.role,
      agent: m.agent,
      content: m.content,
      metadata: safeJson(m.metadata),
      createdAt: m.createdAt.toISOString(),
      invocations: m.invocations.map((i) => ({
        id: i.id,
        server: i.server,
        tool: i.tool,
        status: i.status,
        latencyMs: i.latencyMs,
        params: safeJson(i.params),
        result: safeJson(i.result),
      })),
    }));
  }

  async loadHistoryAsTurns(sessionId: string): Promise<ChatTurn[]> {
    const rows = await db.chatMessage.findMany({
      where: { sessionId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });
    return rows.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      name: m.agent ?? undefined,
    }));
  }

  async createMessage(input: {
    sessionId: string;
    role: string;
    content: string;
    agent?: string;
    metadata?: string;
  }): Promise<{ id: string }> {
    const row = await db.chatMessage.create({
      data: {
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        agent: input.agent,
        metadata: input.metadata ?? '{}',
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async updateMessage(
    id: string,
    data: { content: string; metadata: string },
  ): Promise<void> {
    await db.chatMessage.update({
      where: { id },
      data,
    });
  }

  async touch(sessionId: string, title?: string): Promise<void> {
    await db.chatSession.update({
      where: { id: sessionId },
      data: title ? { title, updatedAt: new Date() } : { updatedAt: new Date() },
    });
  }

  async updateMemory(
    sessionId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const row = await db.chatSession.findUnique({ where: { id: sessionId } });
    if (!row) return;
    const current = safeJson(row.memory) as Record<string, unknown>;
    const merged = { ...current, ...patch };
    await db.chatSession.update({
      where: { id: sessionId },
      data: { memory: JSON.stringify(merged) },
    });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
