import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';

/**
 * Self-service data export (privacy launch requirement, pairs with
 * DELETE /api/me). One JSON file containing everything the caller owns:
 * profile, conversations (every prompt + answer with the model that produced
 * it), tool-call audit per message, and personal memory.
 *
 * Scoped strictly to the authenticated userId — the same keying DELETE
 * /api/me uses — so an export can never include another user's data.
 */
export const GET = withGuard(async (_req: NextRequest, context) => {
  const userId = context.userId;

  const [sessions, memories, memorySetting] = await Promise.all([
    db.chatSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { invocations: true },
        },
      },
    }),
    db.userMemory.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.userMemorySetting.findFirst({ where: { userId } }),
  ]);

  const data = {
    exportedAt: new Date().toISOString(),
    user: {
      id: context.user.id,
      email: context.user.email,
      name: context.user.name,
    },
    memoryMode: memorySetting?.mode ?? 'smart',
    memories: memories.map((m) => ({
      id: m.id,
      content: m.content,
      label: m.label,
      source: m.source,
      createdAt: m.createdAt.toISOString(),
      archivedAt: m.archivedAt?.toISOString() ?? null,
    })),
    conversations: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messages: s.messages.map((m) => {
        const meta = safeParseMetadata(m.metadata);
        return {
          id: m.id,
          role: m.role,
          // Which model produced this message. `llm` is recorded on
          // assistant turns (BYOK model when the caller used their own key);
          // prompts carry no model.
          model:
            m.role === 'assistant'
              ? ((meta.llm as string | undefined) ?? m.agent)
              : null,
          agent: m.agent,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
          toolCalls: m.invocations.map((t) => ({
            server: t.server,
            tool: t.tool,
            status: t.status,
            latencyMs: t.latencyMs,
            createdAt: t.createdAt.toISOString(),
          })),
        };
      }),
    })),
  };

  await db.auditEvent.create({
    data: {
      userId,
      tenantId: context.tenantId,
      action: 'me.export',
      resourceType: 'user',
      resourceId: userId,
      metadata: JSON.stringify({
        conversations: sessions.length,
        memories: memories.length,
      }),
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="kindcaddy-data-export-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
});

function safeParseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
