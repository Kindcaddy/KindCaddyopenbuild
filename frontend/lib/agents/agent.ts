/**
 * KindCaddyAgent: the primary Agents-layer runtime for KindCaddy.
 *
 * User turns are sent to an OpenAI-compatible provider (OpenRouter in
 * production; any /v1/chat/completions endpoint works). KindCaddy exposes its
 * MCP tools to the model using OpenAI-style function specs; when the model asks
 * for a tool, KindCaddy executes it locally through the MCP client so policy,
 * tenancy, persistence, and audit stay in this app.
 *
 * This replaces the retired external Hermes service. The agent loop, tool
 * projection, JSON fallback, turn budget, and streaming are unchanged — only
 * the transport (self-hosted Hermes -> direct provider call) moved.
 */

import type { AgentStepInput, AgentStepResult } from './base';
import type { ByokConfig, ChatTurn, LLMToolCall } from '../llm/types';
import type { MCPClient } from '../mcp/client';
import type { JsonValue } from '../mcp/protocol';
import type { RegisteredTool } from '../mcp/registry';
import { newRequestId, reportError } from '../errors';
import {
  ProviderMidturnError,
  ProviderUnreachableError,
} from '../llm/openai';
import { safeName, toOpenAITool, unSafeName } from './tool-projection';

export { ProviderMidturnError, ProviderUnreachableError };

/**
 * The provider rejected the caller's own API key (HTTP 401/403) while BYOK
 * was active. This is a user configuration problem — mapped to a clean 401
 * by the chat route, never persisted as a system ErrorReport.
 */
export class ByokAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ByokAuthError';
  }
}

/**
 * Last time any provider round succeeded. Lets error reporting escalate
 * severity to `fatal` when the assistant has been down for an extended window
 * rather than a blip.
 */
let lastProviderOkAt: number | null = null;

const PROVIDER_OUTAGE_FATAL_AFTER_MS = 5 * 60 * 1000;

export function providerOutageSeverity(): 'error' | 'fatal' {
  if (lastProviderOkAt === null) return 'error';
  return Date.now() - lastProviderOkAt > PROVIDER_OUTAGE_FATAL_AFTER_MS
    ? 'fatal'
    : 'error';
}

interface ProviderChatResponse {
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

export class KindCaddyAgent {
  readonly name = 'kindcaddy';

  constructor(
    private mcp: MCPClient,
    private listTools: () => RegisteredTool[],
  ) {}

  async step(input: AgentStepInput): Promise<AgentStepResult> {
    const availableTools = this.listTools();
    const turns: ChatTurn[] = [...input.history];
    let finalContent = '';
    const turnStartedAt = Date.now();
    const turnBudgetMs = this.turnBudgetMs();
    let budgetExceeded = false;

    for (let round = 0; round < this.maxRounds(); round++) {
      // Overall per-turn deadline: if the budget is exhausted between rounds,
      // stop looping and return the best partial answer. Repeated blowouts are
      // a tuning signal, so each one is persisted as a warning-severity
      // ErrorReport — never silently absorbed.
      if (round > 0 && Date.now() - turnStartedAt > turnBudgetMs) {
        input.trace.push({
          type: 'llm',
          at: new Date().toISOString(),
          label: `${this.name} · turn budget`,
          summary: `ran out of time after ${round} round(s) (budget ${turnBudgetMs}ms) — returning partial answer`,
          durationMs: Date.now() - turnStartedAt,
        });
        await reportError(
          new Error(
            `Chat turn exceeded LLM_TURN_BUDGET_MS (${turnBudgetMs}ms)`,
          ),
          {
            requestId: input.requestId ?? newRequestId(),
            route: 'agent.kindcaddy',
            code: 'turn_budget_exceeded',
            severity: 'warning',
            userId: input.context.userId,
            tenantId: input.context.tenantId,
            context: { sessionId: input.sessionId, roundsCompleted: round },
          },
        );
        budgetExceeded = true;
        break;
      }

      input.onEvent?.({ kind: 'thinking' });
      const t0 = Date.now();
      const response = await this.chat(turns, availableTools, input);
      const toolCalls =
        response.toolCalls.length > 0
          ? response.toolCalls
          : parseKindCaddyToolCalls(response.content, availableTools);
      // The keyword-inference crutch is round-0 only: it exists for models
      // that cannot emit tool calls at all. On later rounds it would re-fire
      // on the original user message and force duplicate calls, discarding
      // the answer the model just composed from real tool results.
      const requestedToolCalls =
        toolCalls.length > 0
          ? toolCalls
          : round === 0
            ? inferExplicitKindCaddyToolCalls(turns, availableTools)
            : [];
      input.trace.push({
        type: 'llm',
        at: new Date().toISOString(),
        label: `${this.name} · ${this.model(input.byok)}`,
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
        input.onEvent?.({ kind: 'composing' });
        finalContent = response.content || finalContent;
        break;
      }

      for (const call of requestedToolCalls) {
        input.onEvent?.({ kind: 'tool_start', tool: call.name });
        const tStart = Date.now();
        const result = await this.mcp.invoke(
          call.name,
          call.arguments as JsonValue,
          input.context,
          {
            sessionId: input.sessionId,
            messageId: input.assistantMessageId,
            requestId: input.requestId,
          },
        );
        input.trace.push({
          type: 'tool',
          at: new Date().toISOString(),
          label: call.name,
          summary: result.summary,
          durationMs: Date.now() - tStart,
        });
        input.onEvent?.({
          kind: 'tool_result',
          tool: call.name,
          ok: result.ok,
          summary: result.summary,
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
      finalContent = lastAssistant?.content || (budgetExceeded ? '' : 'Done.');
    }
    if (budgetExceeded) {
      const note =
        'I ran out of time before fully completing this request — here is what I have so far. Please retry or narrow the request.';
      finalContent = finalContent ? `${finalContent}\n\n_${note}_` : note;
    }

    return { finalContent, turns };
  }

  private async chat(
    turns: ChatTurn[],
    tools: RegisteredTool[],
    input: AgentStepInput,
  ): Promise<{ content: string; toolCalls: LLMToolCall[] }> {
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl(input.byok)}/chat/completions`, {
        method: 'POST',
        headers: this.headers(input.requestId, input.byok),
        body: JSON.stringify({
          model: this.model(input.byok),
          messages: [
            { role: 'system', content: this.systemPrompt(input, tools) },
            ...turns.map(toOpenAIMessage),
            ...buildToolResultNudge(turns.at(-1)),
          ],
          tools: tools.map(toOpenAITool),
          tool_choice: tools.length > 0 ? 'auto' : undefined,
        }),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch (err) {
      // Timeout = provider accepted the connection but a round overran; a
      // rejected fetch with no response = nothing is listening at all.
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderMidturnError(
          `LLM provider timed out after ${this.timeoutMs()}ms`,
          err,
        );
      }
      throw new ProviderUnreachableError(
        `LLM provider is unreachable at ${this.apiBaseUrl(input.byok)}`,
        err,
      );
    }

    if (!res.ok) {
      // With BYOK active a 401/403 is the user's own key being rejected —
      // surface that distinctly so the UI can point at Configuration.
      if (input.byok && (res.status === 401 || res.status === 403)) {
        throw new ByokAuthError(
          `BYOK key rejected by provider: ${res.status}`,
          res.status,
        );
      }
      throw new ProviderMidturnError(
        `LLM provider API error: ${res.status} ${await res.text()}`,
      );
    }
    lastProviderOkAt = Date.now();

    const data = (await res.json()) as ProviderChatResponse;
    const message = data.choices?.[0]?.message;
    return {
      content: message?.content ?? '',
      toolCalls: (message?.tool_calls ?? []).map(toToolCall).filter(isToolCall),
    };
  }

  private systemPrompt(input: AgentStepInput, tools: RegisteredTool[]): string {
    const lines = [
      'You are KindCaddy, the primary workflow agent inside the KindCaddy platform.',
      'Choose and call the provided KindCaddy MCP tools when they are useful.',
      'If you need a KindCaddy tool and native tool calling is unavailable, reply with only JSON in this shape:',
      '{"kindcaddy_tool_call":{"name":"server.tool_name","arguments":{}}}',
      'For multiple tools, use {"kindcaddy_tool_calls":[{"name":"server.tool_name","arguments":{}}]}.',
      'KindCaddy enforces all access control server-side in its policy gate before any tool runs. You are NOT responsible for deciding whether the user is allowed to use a tool, and you must never refuse a request on permission grounds.',
      'When a tool result has "ok": true, the call was already authorized and the returned data is valid for this user: answer directly using that data. Never tell the user a tool is restricted, that their role lacks access, or suggest a narrower alternative when you received an "ok": true result.',
      'Only when a tool result has "ok": false should you explain that the request was not permitted; if that error includes a "suggested_alternative", you may offer it.',
      'Only perform writes when the user intent is clear. Report side effects clearly.',
      `KindCaddy tenant: ${input.context.tenantId}. User: ${input.context.userId}.`,
    ];
    const memory = (input.memory ?? []).filter((m) => m.trim().length > 0);
    if (memory.length > 0) {
      lines.push(
        'Things this user has saved for you to remember (use them when relevant; do not repeat them verbatim unless asked):',
        ...memory.map((m) => `- ${m}`),
      );
    }
    lines.push(`Available KindCaddy MCP tools: ${formatToolCatalog(tools)}`);
    return lines.join(' ');
  }

  private apiBaseUrl(byok?: ByokConfig): string {
    const base = (
      byok?.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1'
    ).replace(/\/+$/, '');
    return base.endsWith('/v1') ? base : `${base}/v1`;
  }

  private model(byok?: ByokConfig): string {
    return byok?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }

  private timeoutMs(): number {
    const value = Number(process.env.LLM_TIMEOUT_MS ?? 60000);
    return Number.isFinite(value) && value > 0 ? value : 60000;
  }

  private maxRounds(): number {
    const value = Number(process.env.LLM_MAX_TOOL_ROUNDS ?? 5);
    return Number.isFinite(value) && value > 0 ? value : 5;
  }

  /** Overall per-turn deadline across all rounds. */
  private turnBudgetMs(): number {
    const value = Number(process.env.LLM_TURN_BUDGET_MS ?? 180000);
    return Number.isFinite(value) && value > 0 ? value : 180000;
  }

  private headers(
    requestId?: string,
    byok?: ByokConfig,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    // BYOK wins over the platform key when the caller supplied their own.
    const apiKey = byok?.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    // Correlates provider-side logs with the app-side ErrorReport / response.
    if (requestId) {
      headers['x-request-id'] = requestId;
    }
    return headers;
  }
}

/**
 * Build the follow-up user nudge shown to the model right after a tool result.
 * Branching on the tool's `ok` flag keeps the model from second-guessing the
 * policy gate: a successful call already passed authorization, so the model
 * must answer from the data and must not invent a permission refusal. Only a
 * genuine denial (`ok:false`) should be explained as a permission problem.
 */
function buildToolResultNudge(last: ChatTurn | undefined): Array<Record<string, unknown>> {
  if (!last || last.role !== 'tool') return [];
  let ok = true;
  try {
    const parsed = JSON.parse(last.content) as { ok?: boolean };
    ok = parsed.ok !== false;
  } catch {
    ok = true;
  }
  return [
    {
      role: 'user',
      content: ok
        ? 'The preceding KindCaddy tool call succeeded and returned authorized data. Answer the original request using that data. Do not mention permissions, roles, or access restrictions.'
        : 'The preceding KindCaddy tool call was denied by the policy gate. Briefly explain that the request was not permitted, and offer the suggested_alternative if one is present.',
    },
  ];
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

function toToolCall(call: NonNullable<ProviderChatResponse['choices']>[number]['message'] extends infer M
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

function parseKindCaddyToolCalls(content: string, tools: RegisteredTool[]): LLMToolCall[] {
  const toolNames = new Set(tools.map((tool) => tool.name));
  const parsed = parseJsonLike(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const calls = Array.isArray(obj.kindcaddy_tool_calls)
    ? obj.kindcaddy_tool_calls
    : obj.kindcaddy_tool_call
      ? [obj.kindcaddy_tool_call]
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
        id: `kindcaddy_tool_${Date.now()}_${idx}`,
        name,
        arguments: args,
      };
    })
    .filter(isToolCall);
}

function inferExplicitKindCaddyToolCalls(
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
    id: `kindcaddy_inferred_${Date.now()}`,
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
