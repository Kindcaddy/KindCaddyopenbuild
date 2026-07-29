/**
 * Anthropic Messages API wire adapter (BYOK).
 *
 * Translates the app's OpenAI-shaped internal chat model (ChatTurn /
 * LLMToolSpec / LLMToolCall) to Anthropic's /v1/messages format and back.
 * The builder and parser are pure functions so the translation is unit-test
 * -able without network; `anthropicChat` is the thin fetch wrapper.
 *
 * Wire differences that matter:
 *  - Auth is `x-api-key` + `anthropic-version`, not a Bearer token.
 *  - `system` is a top-level field, not a message.
 *  - Tool specs are { name, description, input_schema }; tool calls arrive as
 *    `tool_use` content blocks; results are `tool_result` blocks inside a
 *    USER message. Consecutive tool results must ride in ONE user message.
 *  - `max_tokens` is required.
 */

import type { ChatTurn, LLMToolCall, LLMToolSpec } from './types';
import { safeName, unSafeName } from '../agents/tool-projection';
import { ProviderMidturnError, ProviderUnreachableError } from './errors';

export const ANTHROPIC_API_VERSION = '2023-06-01';
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicChatInput {
  baseUrl: string; // e.g. https://api.anthropic.com (no trailing slash)
  apiKey: string;
  model: string;
  system: string;
  turns: ChatTurn[];
  tools: LLMToolSpec[];
  maxTokens?: number;
  timeoutMs: number;
  requestId?: string;
}

export interface AnthropicChatResult {
  content: string;
  toolCalls: LLMToolCall[];
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

type AnthropicBlock = Record<string, unknown>;

/** Translate internal turns to Anthropic messages (user/assistant only). */
export function buildAnthropicMessages(turns: ChatTurn[]): Array<{
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> = [];

  const pushBlocks = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
    const last = messages.at(-1);
    if (last && last.role === role && Array.isArray(last.content)) {
      last.content.push(...blocks); // merge consecutive same-role (e.g. tool results)
    } else {
      messages.push({ role, content: blocks });
    }
  };

  for (const turn of turns) {
    if (turn.role === 'system') continue; // system rides the top-level field
    if (turn.role === 'tool') {
      pushBlocks('user', [
        {
          type: 'tool_result',
          tool_use_id: turn.toolCallId ?? '',
          content: turn.content,
        },
      ]);
      continue;
    }
    if (turn.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (turn.content.trim().length > 0) {
        blocks.push({ type: 'text', text: turn.content });
      }
      for (const call of turn.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: safeName(call.name),
          input: call.arguments,
        });
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
      pushBlocks('assistant', blocks);
      continue;
    }
    // plain user text
    pushBlocks('user', [{ type: 'text', text: turn.content }]);
  }
  return messages;
}

export function buildAnthropicTools(tools: LLMToolSpec[]): AnthropicBlock[] {
  return tools.map((t) => ({
    name: safeName(t.name),
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function buildAnthropicBody(input: AnthropicChatInput): Record<string, unknown> {
  return {
    model: input.model,
    max_tokens: input.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    system: input.system,
    messages: buildAnthropicMessages(input.turns),
    tools: input.tools.length > 0 ? buildAnthropicTools(input.tools) : undefined,
    tool_choice: input.tools.length > 0 ? { type: 'auto' } : undefined,
  };
}

/** Parse an Anthropic messages response back into the internal shape. */
export function parseAnthropicResponse(data: unknown, modelFallback: string): AnthropicChatResult {
  const d = data as {
    model?: string;
    content?: Array<Record<string, unknown>>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  let content = '';
  const toolCalls: LLMToolCall[] = [];
  for (const block of d.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') {
      content += (content ? '\n' : '') + block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: typeof block.id === 'string' ? block.id : `toolu_${toolCalls.length}`,
        name: unSafeName(typeof block.name === 'string' ? block.name : ''),
        arguments:
          typeof block.input === 'object' && block.input !== null
            ? (block.input as Record<string, unknown>)
            : {},
      });
    }
  }
  return {
    content,
    toolCalls,
    model: d.model ?? modelFallback,
    usage: {
      promptTokens: d.usage?.input_tokens,
      completionTokens: d.usage?.output_tokens,
    },
  };
}

export class AnthropicHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AnthropicHttpError';
  }
}

/** One round against /v1/messages. Throws typed transport errors. */
export async function anthropicChat(input: AnthropicChatInput): Promise<AnthropicChatResult> {
  const base = input.baseUrl.replace(/\/+$/, '');
  const url = `${base}/v1/messages`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': input.apiKey,
    'anthropic-version': ANTHROPIC_API_VERSION,
  };
  if (input.requestId) headers['x-request-id'] = input.requestId;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildAnthropicBody(input)),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ProviderMidturnError(
        `LLM provider timed out after ${input.timeoutMs}ms`,
        err,
      );
    }
    throw new ProviderUnreachableError(`LLM provider is unreachable at ${base}`, err);
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new AnthropicHttpError(res.status, `Anthropic rejected the API key: ${res.status}`);
    }
    throw new ProviderMidturnError(`LLM provider API error: ${res.status} ${text}`);
  }

  return parseAnthropicResponse(await res.json(), input.model);
}
