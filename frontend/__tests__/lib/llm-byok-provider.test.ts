import {
  inferProviderFromKey,
  isByokProviderId,
  PROVIDER_PRESETS,
  resolveByok,
} from '@/lib/llm/byok-provider';
import {
  buildAnthropicBody,
  buildAnthropicMessages,
  parseAnthropicResponse,
} from '@/lib/llm/anthropic';
import type { ChatTurn } from '@/lib/llm/types';

/**
 * BYOK provider presets + resolution. Chat is BYOK-only: the key shape (or an
 * explicit choice) decides the provider, the provider decides the wire
 * format, and explicit baseUrl/model fields always win over preset defaults.
 */
describe('inferProviderFromKey', () => {
  it('maps key shapes to providers', () => {
    expect(inferProviderFromKey('sk-or-v1-abc123')).toBe('openrouter');
    expect(inferProviderFromKey('sk-ant-api03-abc123')).toBe('anthropic');
    expect(inferProviderFromKey('sk-proj-abc123')).toBe('openai');
    expect(inferProviderFromKey('anything-else')).toBe('openai');
  });
});

describe('isByokProviderId', () => {
  it('accepts known ids and rejects everything else', () => {
    expect(isByokProviderId('openrouter')).toBe(true);
    expect(isByokProviderId('openai')).toBe(true);
    expect(isByokProviderId('anthropic')).toBe(true);
    expect(isByokProviderId('gemini')).toBe(false);
    expect(isByokProviderId('')).toBe(false);
    expect(isByokProviderId(undefined)).toBe(false);
    expect(isByokProviderId(42)).toBe(false);
  });
});

describe('resolveByok', () => {
  it('applies the OpenRouter preset for an sk-or key', () => {
    const r = resolveByok({ apiKey: 'sk-or-v1-abc' });
    expect(r.provider).toBe('openrouter');
    expect(r.wire).toBe('openai-compatible');
    expect(r.baseUrl).toBe(PROVIDER_PRESETS.openrouter.baseUrl);
    expect(r.model).toBe(PROVIDER_PRESETS.openrouter.defaultModel);
  });

  it('applies the Anthropic preset for an sk-ant key', () => {
    const r = resolveByok({ apiKey: 'sk-ant-api03-abc' });
    expect(r.provider).toBe('anthropic');
    expect(r.wire).toBe('anthropic');
    expect(r.baseUrl).toBe('https://api.anthropic.com');
    expect(r.model).toBe('claude-sonnet-4-5');
  });

  it('honors an explicit provider over the key shape', () => {
    const r = resolveByok({ apiKey: 'sk-plain', provider: 'anthropic' });
    expect(r.provider).toBe('anthropic');
    expect(r.wire).toBe('anthropic');
  });

  it('lets explicit baseUrl/model win over the preset', () => {
    const r = resolveByok({
      apiKey: 'local',
      baseUrl: 'http://127.0.0.1:8080/v1/',
      model: 'my-local-model',
    });
    expect(r.wire).toBe('openai-compatible');
    expect(r.baseUrl).toBe('http://127.0.0.1:8080/v1'); // trailing slash stripped
    expect(r.model).toBe('my-local-model');
  });

  it('appends /v1 to a bare OpenAI-compatible host but not to Anthropic', () => {
    const openai = resolveByok({ apiKey: 'local', baseUrl: 'http://127.0.0.1:3199' });
    expect(openai.baseUrl).toBe('http://127.0.0.1:3199/v1');
    const anthropic = resolveByok({
      apiKey: 'local',
      provider: 'anthropic',
      baseUrl: 'http://127.0.0.1:3201',
    });
    expect(anthropic.baseUrl).toBe('http://127.0.0.1:3201'); // adapter adds /v1/messages
  });
});

/**
 * Anthropic Messages API translation. The agent loop speaks ChatTurn; the
 * wire speaks content blocks. Tool results from consecutive internal turns
 * must merge into ONE user message of tool_result blocks.
 */
describe('buildAnthropicMessages', () => {
  it('translates a tool round-trip into Anthropic blocks', () => {
    const turns: ChatTurn[] = [
      { role: 'user', content: 'List unpaid invoices' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'netsuite.list_invoices', arguments: { status: 'unpaid' } },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', content: '{"ok":true,"data":[]}' },
      { role: 'assistant', content: 'You have no unpaid invoices.' },
    ];
    const messages = buildAnthropicMessages(turns);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'List unpaid invoices' }],
    });
    expect(messages[1].role).toBe('assistant');
    const assistantBlocks = messages[1].content as Array<Record<string, unknown>>;
    expect(assistantBlocks).toContainEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'netsuite__list_invoices', // dots are projected to __ on the wire
      input: { status: 'unpaid' },
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: '{"ok":true,"data":[]}' },
      ],
    });
    expect(messages[3].role).toBe('assistant');
  });

  it('merges consecutive tool results into a single user message', () => {
    const turns: ChatTurn[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'netsuite.list_invoices', arguments: {} },
          { id: 'b', name: 'netsuite.total_outstanding', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: 'a', content: '{"ok":true}' },
      { role: 'tool', toolCallId: 'b', content: '{"ok":true}' },
    ];
    const messages = buildAnthropicMessages(turns);
    expect(messages).toHaveLength(2);
    const blocks = messages[1].content as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'a' });
    expect(blocks[1]).toMatchObject({ type: 'tool_result', tool_use_id: 'b' });
  });

  it('keeps system out of the messages array', () => {
    const body = buildAnthropicBody({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-5',
      system: 'You are KindCaddy.',
      turns: [{ role: 'user', content: 'hi' }],
      tools: [],
      timeoutMs: 1000,
    });
    expect(body.system).toBe('You are KindCaddy.');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe('parseAnthropicResponse', () => {
  it('extracts text and tool calls and un-projects names', () => {
    const result = parseAnthropicResponse(
      {
        model: 'claude-sonnet-4-5',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'netsuite__list_invoices',
            input: { status: 'overdue' },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      'fallback-model',
    );
    expect(result.content).toBe('Let me check.');
    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', name: 'netsuite.list_invoices', arguments: { status: 'overdue' } },
    ]);
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('handles a text-only reply', () => {
    const result = parseAnthropicResponse(
      { content: [{ type: 'text', text: 'Hello!' }] },
      'fallback-model',
    );
    expect(result.content).toBe('Hello!');
    expect(result.toolCalls).toEqual([]);
    expect(result.model).toBe('fallback-model');
  });
});
