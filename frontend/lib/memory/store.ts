/**
 * Per-user memory store (Smart / Explicit modes).
 *
 * Every read and write is scoped to (userId, tenantId) — the same invariant
 * SessionManager relies on — so one user's memory can never surface in
 * another user's prompt, even under concurrent load. Capture mode only affects
 * WRITES; injection (reads) is identical regardless of mode.
 *
 *   - explicit: the agent saves via the `memory.*` MCP tools when the user asks.
 *   - smart:    Host.chat runs a best-effort extraction pass after each turn.
 *   - off:      nothing is captured.
 */

import { db } from '../db';
import { getLLM } from '../llm';
import { newRequestId, reportError } from '../errors';

/**
 * Minimal scope every memory operation is filtered by. Both `RequestContext`
 * (API routes) and `ToolCallContext` (MCP server) satisfy this shape, so the
 * store has one code path regardless of caller.
 */
export interface MemoryScope {
  userId: string;
  tenantId: string;
}

export const MEMORY_MODES = ['smart', 'explicit', 'off'] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];
export const DEFAULT_MEMORY_MODE: MemoryMode = 'smart';

export function isMemoryMode(value: unknown): value is MemoryMode {
  return typeof value === 'string' && (MEMORY_MODES as readonly string[]).includes(value);
}

/** Hard caps keep the prompt bounded and the store from growing unbounded. */
const MAX_MEMORIES_PER_USER = 200;
const INJECTION_LIMIT = 20;
const SMART_MAX_PER_TURN = 3;
const MEMORY_CONTENT_MAX = 500;

export interface MemoryItem {
  id: string;
  content: string;
  label: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

function normalize(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function getMemoryMode(ctx: MemoryScope): Promise<MemoryMode> {
  const row = await db.userMemorySetting.findUnique({
    where: { userId_tenantId: { userId: ctx.userId, tenantId: ctx.tenantId } },
    select: { mode: true },
  });
  return isMemoryMode(row?.mode) ? (row!.mode as MemoryMode) : DEFAULT_MEMORY_MODE;
}

export async function setMemoryMode(
  ctx: MemoryScope,
  mode: MemoryMode,
): Promise<MemoryMode> {
  await db.userMemorySetting.upsert({
    where: { userId_tenantId: { userId: ctx.userId, tenantId: ctx.tenantId } },
    update: { mode },
    create: { userId: ctx.userId, tenantId: ctx.tenantId, mode },
  });
  return mode;
}

export async function listMemories(ctx: MemoryScope): Promise<MemoryItem[]> {
  const rows = await db.userMemory.findMany({
    where: { userId: ctx.userId, tenantId: ctx.tenantId, archivedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    label: r.label,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * The bounded, most-recent-first slice injected into the system prompt. Read
 * side is independent of capture mode: previously saved items remain usable
 * even if the user later switches to 'off'.
 */
export async function listMemoryForInjection(
  ctx: MemoryScope,
  limit = INJECTION_LIMIT,
): Promise<string[]> {
  const rows = await db.userMemory.findMany({
    where: { userId: ctx.userId, tenantId: ctx.tenantId, archivedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { content: true },
  });
  return rows.map((r) => r.content);
}

/**
 * Save one item, scoped to the caller. De-dupes against existing non-archived
 * content (normalized) and enforces the per-user cap. Returns the created item,
 * or null when it was a duplicate / over cap / empty.
 */
export async function saveMemory(
  ctx: MemoryScope,
  input: { content: string; label?: string | null; source?: 'smart' | 'explicit' },
): Promise<MemoryItem | null> {
  const content = (input.content ?? '').trim().slice(0, MEMORY_CONTENT_MAX);
  if (!content) return null;

  const existing = await db.userMemory.findMany({
    where: { userId: ctx.userId, tenantId: ctx.tenantId, archivedAt: null },
    select: { content: true },
  });
  if (existing.length >= MAX_MEMORIES_PER_USER) return null;
  const seen = new Set(existing.map((e) => normalize(e.content)));
  if (seen.has(normalize(content))) return null;

  const row = await db.userMemory.create({
    data: {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      content,
      label: input.label ?? null,
      source: input.source ?? 'explicit',
    },
  });
  return {
    id: row.id,
    content: row.content,
    label: row.label,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Delete one item, scoped to the caller. Returns true when a row was removed. */
export async function deleteMemory(ctx: MemoryScope, id: string): Promise<boolean> {
  const res = await db.userMemory.deleteMany({
    where: { id, userId: ctx.userId, tenantId: ctx.tenantId },
  });
  return res.count > 0;
}

/**
 * Smart-mode capture: distill durable facts/preferences/patterns from the just
 * -completed turn and save them silently. Best-effort by design — it must never
 * take the request down, so all failures are swallowed into an ErrorReport.
 *
 * Runs only when a real provider is configured (the mock provider cannot
 * extract). Uses a cheap model override when OPENAI_MEMORY_MODEL is set.
 */
export async function extractAndSaveSmartMemory(
  ctx: MemoryScope,
  input: { userMessage: string; assistantReply: string; requestId?: string },
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return; // mock provider: nothing to extract
  try {
    const llm = getLLM();
    const timeoutMs = Number(process.env.LLM_MEMORY_TIMEOUT_MS ?? 15000);
    const resp = await llm.chat({
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            'Conversation turn to analyze:',
            `USER: ${input.userMessage}`,
            `ASSISTANT: ${input.assistantReply}`,
            '',
            'Return the JSON array now.',
          ].join('\n'),
        },
      ],
      tools: [],
      model: process.env.OPENAI_MEMORY_MODEL || undefined,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
      requestId: input.requestId,
    });

    const candidates = parseCandidates(resp.content).slice(0, SMART_MAX_PER_TURN);
    for (const candidate of candidates) {
      await saveMemory(ctx, { content: candidate, source: 'smart' });
    }
  } catch (err) {
    await reportError(err, {
      requestId: input.requestId ?? newRequestId(),
      route: 'memory.extract',
      code: 'memory_extraction_failed',
      severity: 'warning',
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    });
  }
}

const EXTRACTION_SYSTEM_PROMPT = [
  'You extract durable, user-specific memory from a single conversation turn for a business assistant.',
  'Capture only stable facts, preferences, goals, or recurring patterns that would help in FUTURE conversations',
  '(e.g. "Prefers concise answers", "Works in the finance department", "Main vendor is Acme Corp").',
  'Do NOT capture: one-off questions, transient task details, tool output values, secrets, API keys, passwords, or anything the user did not actually state about themselves or their work.',
  'Each item must be a single concise sentence in the third person, under 200 characters.',
  'Respond with ONLY a JSON array of strings. If there is nothing worth remembering, respond with [].',
].join(' ');

function parseCandidates(content: string): string[] {
  const trimmed = (content ?? '').trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('[');
    const end = unfenced.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
      parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
