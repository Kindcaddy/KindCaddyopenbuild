/**
 * Shared LLM chat model. The agent loop and the wire adapters
 * (OpenAI-compatible in lib/agents/agent.ts, Anthropic in
 * lib/llm/anthropic.ts) both speak these types; each adapter translates to
 * its provider's wire format at the boundary.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatTurn {
  role: ChatRole;
  content: string;
  /** For role === 'tool': the call id the content answers. */
  toolCallId?: string;
  /** For role === 'assistant': tool calls the LLM decided to make. */
  toolCalls?: LLMToolCall[];
  /** For role === 'assistant': which agent produced it. */
  name?: string;
}

export interface LLMToolCall {
  id: string;
  name: string; // fully-qualified, e.g. "netsuite.list_invoices"
  arguments: Record<string, unknown>;
}

export interface LLMToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

/** Model providers supported for bring-your-own-key chat. */
export type ByokProviderId = 'openrouter' | 'openai' | 'anthropic';

/**
 * Per-user "bring your own key" config. Session-held only: stored as an
 * encrypted browser cookie, never in the database. Chat is BYOK-only — every
 * turn runs on the caller's key; there is no platform fallback key.
 *
 * `provider` is the user's explicit choice; when absent it is inferred from
 * the key shape (see lib/llm/byok-provider.ts). `baseUrl` / `model` override
 * the provider preset when set.
 */
export interface ByokConfig {
  apiKey: string;
  provider?: ByokProviderId;
  baseUrl?: string;
  model?: string;
}
