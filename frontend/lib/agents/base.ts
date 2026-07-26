/**
 * BaseAgent: one reasoning step = ask LLM -> execute any tool calls through
 * MCP -> feed results back to LLM -> return the assistant turn. Agents
 * differ only in their system prompt and which tool subset they expose.
 */

import type { RequestContext } from '../context';
import type { LLMProvider, ChatTurn, LLMToolSpec } from '../llm/types';
import type { MCPClient } from '../mcp/client';
import type { RegisteredTool } from '../mcp/registry';

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

export interface AgentOptions {
  name: string;
  systemPrompt: string;
  /** Predicate selecting which registry tools this agent may use. */
  toolFilter: (tool: RegisteredTool) => boolean;
  /** Hard cap on reasoning rounds (LLM -> tools -> LLM -> tools ...). */
  maxRounds?: number;
}

export class BaseAgent {
  readonly name: string;
  private systemPrompt: string;
  private toolFilter: (tool: RegisteredTool) => boolean;
  private maxRounds: number;

  constructor(
    private llm: LLMProvider,
    private mcp: MCPClient,
    private listTools: () => RegisteredTool[],
    opts: AgentOptions,
  ) {
    this.name = opts.name;
    this.systemPrompt = opts.systemPrompt;
    this.toolFilter = opts.toolFilter;
    this.maxRounds = opts.maxRounds ?? 4;
  }

  async step(input: AgentStepInput): Promise<AgentStepResult> {
    const available = this.listTools().filter(this.toolFilter);
    const toolSpecs: LLMToolSpec[] = available.map(toSpec);

    const turns: ChatTurn[] = [...input.history];
    let finalContent = '';

    for (let round = 0; round < this.maxRounds; round++) {
      const t0 = Date.now();
      const resp = await this.llm.chat({
        system: this.systemPrompt,
        messages: turns,
        tools: toolSpecs,
      });
      input.trace.push({
        type: 'llm',
        at: new Date().toISOString(),
        label: `${this.name} · ${resp.model}`,
        summary:
          resp.toolCalls.length > 0
            ? `planned ${resp.toolCalls.length} tool call(s)`
            : 'final reply',
        durationMs: Date.now() - t0,
      });

      turns.push({
        role: 'assistant',
        name: this.name,
        content: resp.content,
        toolCalls: resp.toolCalls,
      });

      if (resp.toolCalls.length === 0) {
        finalContent = resp.content || finalContent;
        break;
      }

      for (const call of resp.toolCalls) {
        const tStart = Date.now();
        const result = await this.mcp.invoke(
          call.name,
          call.arguments as Parameters<MCPClient['invoke']>[1],
          input.context,
          { sessionId: input.sessionId, messageId: input.assistantMessageId },
        );
        input.trace.push({
          type: 'tool',
          at: new Date().toISOString(),
          label: call.name,
          summary: result.summary,
          durationMs: Date.now() - tStart,
        });
        turns.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({
            ok: result.ok,
            summary: result.summary,
            server: result.server,
            tool: result.tool,
            data: result.data,
            error: result.error,
          }),
        });
      }
    }

    // Fallback if we exited the loop without a final assistant text.
    if (!finalContent) {
      const lastAssist = [...turns].reverse().find((m) => m.role === 'assistant');
      finalContent = lastAssist?.content || 'Done.';
    }
    return { finalContent, turns };
  }
}

function toSpec(tool: RegisteredTool): LLMToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: tool.inputSchema.properties,
      required: tool.inputSchema.required,
    },
  };
}
