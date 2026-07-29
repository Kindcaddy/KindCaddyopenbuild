/**
 * Shared agent-step contracts. KindCaddyAgent (lib/agents/agent.ts) is the
 * sole agent implementation: one reasoning step = ask the LLM -> execute any
 * tool calls through MCP -> feed results back -> return the assistant turn.
 */

import type { RequestContext } from '../context';
import type { ChatTurn, ByokConfig } from '../llm/types';

export interface AgentStepInput {
  context: RequestContext;
  history: ChatTurn[];
  sessionId: string;
  assistantMessageId: string;
  /** Correlation id from withGuard; forwarded to the provider and tool calls. */
  requestId?: string;
  /** The parent orchestrator trace (tool calls are appended here). */
  trace: AgentTraceEntry[];
  /**
   * The caller's saved memory items (already scoped to userId + tenantId and
   * bounded by the Host). Injected into the system prompt. Empty when the
   * user's memory mode is off or nothing has been saved.
   */
  memory?: string[];
  /**
   * The caller's own provider key for this turn (session-held encrypted
   * cookie, never persisted). Chat is BYOK-only: a step without it fails
   * with ByokMissingError before any provider call.
   */
  byok?: ByokConfig;
  /** Optional live-progress callback (SSE streaming, Phase 5). */
  onEvent?: (event: AgentProgressEvent) => void;
}

/**
 * Interim progress emitted while a turn is running. Consumed by the SSE
 * stream in /api/mcp/chat; persistence (messages/trace) is unaffected.
 */
export type AgentProgressEvent =
  | { kind: 'thinking' }
  | { kind: 'tool_start'; tool: string }
  | { kind: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { kind: 'composing' };

export interface AgentTraceEntry {
  type: 'llm' | 'tool';
  at: string;
  /** For 'llm': model name. For 'tool': qualified tool name. */
  label: string;
  summary: string;
  durationMs: number;
}

export interface AgentStepResult {
  finalContent: string;
  turns: ChatTurn[];
}
