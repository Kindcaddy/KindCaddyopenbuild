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
import { providerFetch } from './provider-fetch';
import { inferProviderFromKey, PROVIDER_PRESETS, type ByokProviderId } from './byok-presets';

export {
  BYOK_PROVIDER_IDS,
  inferProviderFromKey,
  isByokProviderId,
  PROVIDER_PRESETS,
  type ByokProviderId,
  type ProviderPreset,
} from './byok-presets';

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
    res = await providerFetch(`${resolved.baseUrl}/chat/completions`, {
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
    if (err instanceof ProviderUnreachableError || err instanceof ProviderMidturnError) {
      throw err;
    }
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
