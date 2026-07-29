/**
 * BYOK provider presets + resolution.
 *
 * KindCaddy chat is BYOK-only: every turn runs on the caller's own key.
 * Three providers are supported out of the box — OpenRouter and OpenAI speak
 * the OpenAI chat-completions wire format; Anthropic (Claude) uses the
 * Messages API via lib/llm/anthropic.ts. A custom baseUrl always overrides
 * the preset endpoint; the provider id decides the WIRE FORMAT.
 *
 * Provider inference: when the user doesn't pick a provider explicitly, the
 * key shape decides (`sk-or-…` → OpenRouter, `sk-ant-…` → Anthropic,
 * anything else → OpenAI-compatible).
 */

import type { ByokConfig } from './types';
import { anthropicChat } from './anthropic';
import { ProviderMidturnError, ProviderUnreachableError } from './errors';

export type ByokProviderId = 'openrouter' | 'openai' | 'anthropic';

export interface ProviderPreset {
  id: ByokProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
  /** Wire format the provider speaks. */
  wire: 'openai-compatible' | 'anthropic';
  keyPlaceholder: string;
}

export const PROVIDER_PRESETS: Record<ByokProviderId, ProviderPreset> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
    wire: 'openai-compatible',
    keyPlaceholder: 'sk-or-v1-…',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    wire: 'openai-compatible',
    keyPlaceholder: 'sk-…',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    wire: 'anthropic',
    keyPlaceholder: 'sk-ant-…',
  },
};

export const BYOK_PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ByokProviderId[];

export function isByokProviderId(value: unknown): value is ByokProviderId {
  return (
    typeof value === 'string' &&
    (BYOK_PROVIDER_IDS as string[]).includes(value)
  );
}

/** Infer the provider from the key shape when the user didn't choose one. */
export function inferProviderFromKey(apiKey: string): ByokProviderId {
  if (apiKey.startsWith('sk-or-')) return 'openrouter';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  return 'openai';
}

export interface ResolvedByok {
  provider: ByokProviderId;
  wire: 'openai-compatible' | 'anthropic';
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Fully resolve a stored BYOK config: explicit fields win, preset fills the rest. */
export function resolveByok(config: ByokConfig): ResolvedByok {
  const provider = config.provider ?? inferProviderFromKey(config.apiKey);
  const preset = PROVIDER_PRESETS[provider];
  const raw = (config.baseUrl ?? preset.baseUrl).replace(/\/+$/, '');
  // OpenAI-compatible endpoints live at <base>/v1/chat/completions — keep the
  // historical normalization so a bare host:port works too. The Anthropic
  // adapter appends /v1/messages itself, so it takes the host root instead.
  const baseUrl =
    preset.wire === 'openai-compatible' && !raw.endsWith('/v1')
      ? `${raw}/v1`
      : raw;
  return {
    provider,
    wire: preset.wire,
    apiKey: config.apiKey,
    baseUrl,
    model: config.model ?? preset.defaultModel,
  };
}

/**
 * One-shot, tool-free completion — used by smart-memory extraction, which
 * needs a cheap single round on the SAME key the chat turn ran on. Returns
 * the text content. Errors are plain typed provider errors; the caller
 * (memory extraction) treats every failure as best-effort.
 */
export async function completeOnce(
  resolved: ResolvedByok,
  opts: {
    system: string;
    prompt: string;
    timeoutMs: number;
    maxTokens?: number;
    requestId?: string;
  },
): Promise<string> {
  if (resolved.wire === 'anthropic') {
    const res = await anthropicChat({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      system: opts.system,
      turns: [{ role: 'user', content: opts.prompt }],
      tools: [],
      maxTokens: opts.maxTokens ?? 800,
      timeoutMs: opts.timeoutMs,
      requestId: opts.requestId,
    });
    return res.content;
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${resolved.apiKey}`,
  };
  if (opts.requestId) headers['x-request-id'] = opts.requestId;

  let res: Response;
  try {
    res = await fetch(`${resolved.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: resolved.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.prompt },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ProviderMidturnError(
        `LLM provider timed out after ${opts.timeoutMs}ms`,
        err,
      );
    }
    throw new ProviderUnreachableError(
      `LLM provider is unreachable at ${resolved.baseUrl}`,
      err,
    );
  }
  if (!res.ok) {
    throw new ProviderMidturnError(
      `LLM provider API error: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}
