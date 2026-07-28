/**
 * Abstract LLM interface. Both the mock provider and a real OpenAI /
 * Anthropic / local-llama adapter implement the same surface so the Host
 * orchestrator is provider-agnostic.
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

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  usage?: { promptTokens?: number; completionTokens?: number };
  /** Human-friendly label identifying the model that answered. */
  model: string;
}

/**
 * Per-user "bring your own key" override. Session-held only: stored as an
 * encrypted browser cookie, never in the database. When present on a chat
 * request it replaces the platform's OPENAI_API_KEY / OPENAI_BASE_URL /
 * OPENAI_MODEL for that turn.
 */
export interface ByokConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface LLMChatInput {
  system: string;
  messages: ChatTurn[];
  tools: LLMToolSpec[];
  /** Per-request model override (e.g. a cheaper model for memory extraction). */
  model?: string;
  /** Per-request timeout; falls back to the provider default when omitted. */
  timeoutMs?: number;
  /** Per-request key override — enables session-held BYOK without persistence. */
  apiKey?: string;
  /** Per-request base URL override (pairs with apiKey for BYOK). */
  baseUrl?: string;
  /** Correlation id; forwarded as x-request-id for cross-log tracing. */
  requestId?: string;
}

export interface LLMProvider {
  name: string;
  chat(input: LLMChatInput): Promise<LLMResponse>;
}
