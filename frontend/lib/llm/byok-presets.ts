/**
 * BYOK provider presets — pure data, safe to import from client components.
 * Keep server-only imports (network transport, node:*) out of this file;
 * resolution and transport live in byok-provider.ts.
 */

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
