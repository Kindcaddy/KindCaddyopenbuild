/**
 * Shared projection of a KindCaddy MCP tool into the OpenAI tool-calling wire
 * shape, plus the dot<->__ name encoding both the agent and the provider agree
 * on.
 *
 * ARCHITECTURE.md §6.4 declares a load-bearing invariant: `dataScope`,
 * `domain`, and `capability` MUST NOT cross the wire to the model. The single
 * source of truth for who can call what stays in lib/mcp/policy.ts. This module
 * is the one place the projection happens, so the invariant is asserted here by
 * `__tests__/lib/agents/tool-projection.test.ts`. Treat any change to
 * `toOpenAITool` as security-relevant.
 */

import type { RegisteredTool } from '../mcp/registry';
import type { LLMToolSpec } from '../llm/types';

/**
 * Project a RegisteredTool into the provider-neutral spec. Only
 * name/description/parameters are emitted — never the gate-side fields.
 * The Anthropic adapter (lib/llm/anthropic.ts) consumes this shape.
 */
export function toToolSpec(tool: RegisteredTool): LLMToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: tool.inputSchema.properties,
      required: tool.inputSchema.required,
    },
  };
}

/**
 * Project a RegisteredTool into the OpenAI tool spec sent on the wire. Only
 * name/description/parameters are emitted — never the gate-side fields.
 */
export function toOpenAITool(tool: RegisteredTool): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: safeName(tool.name),
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.inputSchema.properties,
        required: tool.inputSchema.required,
      },
    },
  };
}

// OpenAI-compatible function names cannot contain dots, so "a.b" -> "a__b".
export function safeName(name: string): string {
  return name.replace(/\./g, '__');
}

export function unSafeName(name: string): string {
  return name.replace(/__/g, '.');
}
