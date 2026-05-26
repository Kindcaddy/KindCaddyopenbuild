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

export interface LLMProvider {
  name: string;
  chat(input: {
    system: string;
    messages: ChatTurn[];
    tools: LLMToolSpec[];
  }): Promise<LLMResponse>;
}
