/**
 * OpenAI-compatible LLM adapter. Used when OPENAI_API_KEY is configured.
 * Works with any OpenAI /v1/chat/completions-compatible endpoint including
 * OpenRouter (set OPENAI_BASE_URL=https://openrouter.ai/api/v1) and local
 * llama.cpp / Ollama servers.
 *
 * Transport failures are surfaced as typed errors so callers can distinguish a
 * provider that is unreachable (fast 503) from one that accepted the connection
 * but failed mid-turn. The chat route maps these to `assistant_unavailable`.
 */

import type {
  ChatTurn,
  LLMChatInput,
  LLMProvider,
  LLMResponse,
  LLMToolCall,
} from './types';
import { safeName, unSafeName } from '../agents/tool-projection';

/** Provider could not be reached at all (connection refused, DNS, TLS). */
export class ProviderUnreachableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderUnreachableError';
  }
}

/** Provider was reachable but a round failed (HTTP error or timeout). */
export class ProviderMidturnError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderMidturnError';
  }
}

const DEFAULT_TIMEOUT_MS = 60000;

export class OpenAILLMProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(opts: { apiKey: string; baseUrl?: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = opts.model ?? 'gpt-4o-mini';
    this.name = `openai:${this.model}`;
  }

  async chat(input: LLMChatInput): Promise<LLMResponse> {
    const model = input.model ?? this.model;
    const apiKey = input.apiKey ?? this.apiKey;
    const baseUrl = (input.baseUrl ?? this.baseUrl).replace(/\/+$/, '');
    const timeoutMs =
      Number.isFinite(input.timeoutMs) && (input.timeoutMs ?? 0) > 0
        ? (input.timeoutMs as number)
        : DEFAULT_TIMEOUT_MS;

    const body = {
      model,
      messages: [
        { role: 'system', content: input.system },
        ...input.messages.map(toOpenAIMessage),
      ],
      tools: input.tools.map((t) => ({
        type: 'function',
        function: {
          name: safeName(t.name),
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: input.tools.length > 0 ? 'auto' : undefined,
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    };
    if (input.requestId) headers['x-request-id'] = input.requestId;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderMidturnError(
          `LLM provider timed out after ${timeoutMs}ms`,
          err,
        );
      }
      throw new ProviderUnreachableError(
        `LLM provider is unreachable at ${baseUrl}`,
        err,
      );
    }

    if (!res.ok) {
      throw new ProviderMidturnError(
        `LLM provider error: ${res.status} ${await res.text()}`,
      );
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0]?.message;
    const toolCalls: LLMToolCall[] = (choice?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: unSafeName(c.function.name),
      arguments: safeParse(c.function.arguments),
    }));
    return {
      content: choice?.content ?? '',
      toolCalls,
      model,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  }
}

function toOpenAIMessage(m: ChatTurn): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
  }
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: {
          name: safeName(c.name),
          arguments: JSON.stringify(c.arguments),
        },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
