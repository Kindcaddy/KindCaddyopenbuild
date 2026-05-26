/**
 * ExternalHermesAgent: the primary Agents-layer runtime for KindAI.
 *
 * User turns are sent to the downloaded Nous Hermes Gateway. KindAI exposes
 * its MCP tools to Hermes using OpenAI-style function specs; when Hermes asks
 * for a tool, KindAI executes it locally through the MCP client so policy,
 * tenancy, persistence, and audit stay in this app.
 */

import type { AgentStepInput, AgentStepResult } from './base';
import type { ChatTurn, LLMToolCall } from '../llm/types';
import type { MCPClient } from '../mcp/client';
import type { JsonValue } from '../mcp/protocol';
import type { RegisteredTool } from '../mcp/registry';

interface HermesChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class ExternalHermesAgent {
  readonly name = 'hermes';

  constructor(
    private mcp: MCPClient,
    private listTools: () => RegisteredTool[],
  ) {}

  async step(input: AgentStepInput): Promise<AgentStepResult> {
    const availableTools = this.listTools();
    const turns: ChatTurn[] = [...input.history];
    let finalContent = '';

    for (let round = 0; round < this.maxRounds(); round++) {
      const t0 = Date.now();
      const response = await this.chat(turns, availableTools, input);
      const toolCalls =
        response.toolCalls.length > 0
          ? response.toolCalls
          : parseKindAIToolCalls(response.content, availableTools);
      const requestedToolCalls =
        toolCalls.length > 0
          ? toolCalls
          : inferExplicitKindAIToolCalls(turns, availableTools);
      input.trace.push({
        type: 'llm',
        at: new Date().toISOString(),
        label: `${this.name} · ${this.model()}`,
        summary:
          requestedToolCalls.length > 0
            ? `requested ${requestedToolCalls.length} tool call(s)`
            : 'final reply',
        durationMs: Date.now() - t0,
      });

      turns.push({
        role: 'assistant',
        name: this.name,
        content: requestedToolCalls.length > 0 ? '' : response.content,
        toolCalls: requestedToolCalls,
      });

      if (requestedToolCalls.length === 0) {
        finalContent = response.content || finalContent;
        break;
      }

      for (const call of requestedToolCalls) {
        const tStart = Date.now();
        const result = await this.mcp.invoke(
          call.name,
          call.arguments as JsonValue,
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

    if (!finalContent) {
      const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
      finalContent = lastAssistant?.content || 'Done.';
    }

    return { finalContent, turns };
  }

  private async chat(
    turns: ChatTurn[],
    tools: RegisteredTool[],
    input: AgentStepInput,
  ): Promise<{ content: string; toolCalls: LLMToolCall[] }> {
    const res = await fetch(`${this.apiBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model(),
        messages: [
          { role: 'system', content: this.systemPrompt(input, tools) },
          ...turns.map(toOpenAIMessage),
          ...(turns.at(-1)?.role === 'tool'
            ? [{
                role: 'user',
                content: 'Use the preceding KindAI tool result to answer the original user request.',
              }]
            : []),
        ],
        tools: tools.map(toOpenAITool),
        tool_choice: tools.length > 0 ? 'auto' : undefined,
      }),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });

    if (!res.ok) {
      throw new Error(`Hermes Agent API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as HermesChatResponse;
    const message = data.choices?.[0]?.message;
    return {
      content: message?.content ?? '',
      toolCalls: (message?.tool_calls ?? []).map(toToolCall).filter(isToolCall),
    };
  }

  private systemPrompt(input: AgentStepInput, tools: RegisteredTool[]): string {
    return [
      'You are Nous Hermes Agent, the primary workflow agent inside KindAI.',
      'Choose and call the provided KindAI MCP tools when they are useful.',
      'If you need a KindAI tool and native tool calling is unavailable, reply with only JSON in this shape:',
      '{"kindai_tool_call":{"name":"server.tool_name","arguments":{}}}',
      'For multiple tools, use {"kindai_tool_calls":[{"name":"server.tool_name","arguments":{}}]}.',
      'After a tool result is provided, answer the user normally.',
      'Only perform writes when the user intent is clear. Report side effects clearly.',
      `KindAI tenant: ${input.context.tenantId}. User: ${input.context.userId}. Role: ${input.context.role}.`,
      `Available KindAI MCP tools: ${formatToolCatalog(tools)}`,
    ].join(' ');
  }

  private apiBaseUrl(): string {
    const base = (process.env.HERMES_AGENT_BASE_URL ?? 'http://127.0.0.1:8642/v1')
      .replace(/\/+$/, '');
    return base.endsWith('/v1') ? base : `${base}/v1`;
  }

  private model(): string {
    return process.env.HERMES_AGENT_MODEL ?? 'hermes-agent';
  }

  private timeoutMs(): number {
    const value = Number(process.env.HERMES_AGENT_TIMEOUT_MS ?? 120000);
    return Number.isFinite(value) && value > 0 ? value : 120000;
  }

  private maxRounds(): number {
    const value = Number(process.env.HERMES_AGENT_MAX_TOOL_ROUNDS ?? 8);
    return Number.isFinite(value) && value > 0 ? value : 8;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (process.env.HERMES_AGENT_API_KEY) {
      headers.authorization = `Bearer ${process.env.HERMES_AGENT_API_KEY}`;
    }
    return headers;
  }
}

/**
 * Project a RegisteredTool into the OpenAI tool-calling shape sent on the wire
 * to Hermes. ARCHITECTURE.md §6.4 declares an invariant: `dataScope`, `domain`,
 * and `capability` MUST NOT cross the wire. Exported so the unit test suite
 * (`__tests__/lib/agents/hermes-projection.test.ts`) can assert that invariant
 * directly. Treat any change to this function as security-relevant.
 */
export function toOpenAITool(tool: RegisteredTool): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: safeName(tool.name),
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.inputSchema.properties,
        required: tool.inputSchema.required,
      },
    },
  };
}

function toOpenAIMessage(turn: ChatTurn): Record<string, unknown> {
  if (turn.role === 'tool') {
    return { role: 'tool', content: turn.content, tool_call_id: turn.toolCallId };
  }
  if (turn.role === 'assistant' && turn.toolCalls && turn.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: turn.content || null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: safeName(call.name),
          arguments: JSON.stringify(call.arguments),
        },
      })),
    };
  }
  return { role: turn.role, content: turn.content };
}

function toToolCall(call: NonNullable<HermesChatResponse['choices']>[number]['message'] extends infer M
  ? M extends { tool_calls?: Array<infer T> }
    ? T
    : never
  : never): LLMToolCall | null {
  const id = typeof call.id === 'string' ? call.id : `call_${Date.now()}`;
  const name = call.function?.name;
  if (!name) return null;
  return {
    id,
    name: unSafeName(name),
    arguments: safeParse(call.function?.arguments ?? '{}'),
  };
}

function isToolCall(call: LLMToolCall | null): call is LLMToolCall {
  return call !== null;
}

// OpenAI-compatible function names cannot contain dots, so "a.b" -> "a__b".
export function safeName(name: string): string {
  return name.replace(/\./g, '__');
}

function unSafeName(name: string): string {
  return name.replace(/__/g, '.');
}

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function formatToolCatalog(tools: RegisteredTool[]): string {
  return tools
    .map((tool) => {
      const required = tool.inputSchema.required?.length
        ? ` Required: ${tool.inputSchema.required.join(', ')}.`
        : '';
      return `${tool.name} (${tool.capability}) - ${tool.description}.${required}`;
    })
    .join('\n');
}

function parseKindAIToolCalls(content: string, tools: RegisteredTool[]): LLMToolCall[] {
  const toolNames = new Set(tools.map((tool) => tool.name));
  const parsed = parseJsonLike(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const calls = Array.isArray(obj.kindai_tool_calls)
    ? obj.kindai_tool_calls
    : obj.kindai_tool_call
      ? [obj.kindai_tool_call]
      : obj.tool
        ? [obj]
        : [];

  return calls
    .map((call, idx) => {
      if (!call || typeof call !== 'object' || Array.isArray(call)) return null;
      const item = call as Record<string, unknown>;
      const name = typeof item.name === 'string'
        ? item.name
        : typeof item.tool === 'string'
          ? item.tool
          : '';
      if (!name) return null;
      if (!toolNames.has(name)) return null;
      const args = item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
        ? (item.arguments as Record<string, unknown>)
        : {};
      return {
        id: `kindai_tool_${Date.now()}_${idx}`,
        name,
        arguments: args,
      };
    })
    .filter(isToolCall);
}

function inferExplicitKindAIToolCalls(
  turns: ChatTurn[],
  tools: RegisteredTool[],
): LLMToolCall[] {
  const latestUser = [...turns].reverse().find((turn) => turn.role === 'user');
  const text = latestUser?.content.toLowerCase() ?? '';
  if (!text) return [];

  for (const tool of tools) {
    if (text.includes(tool.name.toLowerCase())) {
      return [makeInferredToolCall(tool.name, inferArguments(tool, text))];
    }
  }

  if (/quickbooks/.test(text) && /list|synced|invoice/.test(text)) {
    return findTool(tools, 'quickbooks.list_synced');
  }
  if (/netsuite/.test(text) && /outstanding|total/.test(text)) {
    return findTool(tools, 'netsuite.total_outstanding');
  }
  if (/netsuite|invoice/.test(text) && /list|unpaid|overdue|paid/.test(text)) {
    const status = text.includes('overdue')
      ? 'overdue'
      : text.includes('paid') && !text.includes('unpaid')
        ? 'paid'
        : text.includes('unpaid')
          ? 'unpaid'
          : 'all';
    return findTool(tools, 'netsuite.list_invoices', { status });
  }

  return [];
}

function findTool(
  tools: RegisteredTool[],
  name: string,
  args: Record<string, unknown> = {},
): LLMToolCall[] {
  return tools.some((tool) => tool.name === name) ? [makeInferredToolCall(name, args)] : [];
}

function makeInferredToolCall(
  name: string,
  args: Record<string, unknown>,
): LLMToolCall {
  return {
    id: `kindai_inferred_${Date.now()}`,
    name,
    arguments: args,
  };
}

function inferArguments(tool: RegisteredTool, text: string): Record<string, unknown> {
  if (tool.name === 'netsuite.list_invoices') {
    if (text.includes('overdue')) return { status: 'overdue' };
    if (text.includes('unpaid')) return { status: 'unpaid' };
    if (text.includes('paid')) return { status: 'paid' };
    return { status: 'all' };
  }
  return {};
}

function parseJsonLike(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
