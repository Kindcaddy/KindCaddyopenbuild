/**
 * OpenAI-compatible LLM adapter. Used when OPENAI_API_KEY is configured.
 * Works with any OpenAI /v1/chat/completions-compatible endpoint including
 * local llama.cpp servers (set OPENAI_BASE_URL to override).
 */

import type {
  ChatTurn,
  LLMProvider,
  LLMResponse,
  LLMToolCall,
  LLMToolSpec,
} from './types';

export class OpenAILLMProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(opts: { apiKey: string; baseUrl?: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1';
    this.model = opts.model ?? 'gpt-4o-mini';
    this.name = `openai:${this.model}`;
  }

  async chat(input: {
    system: string;
    messages: ChatTurn[];
    tools: LLMToolSpec[];
  }): Promise<LLMResponse> {
    const body = {
      model: this.model,
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
      tool_choice: 'auto',
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
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
      model: this.model,
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

// OpenAI function names must match /^[a-zA-Z0-9_-]+$/, so "a.b" -> "a__b".
function safeName(name: string): string {
  return name.replace(/\./g, '__');
}
function unSafeName(name: string): string {
  return name.replace(/__/g, '.');
}
function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
