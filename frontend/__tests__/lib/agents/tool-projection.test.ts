/**
 * Unit test: the LLM-catalog projection invariant from ARCHITECTURE.md §6.4.
 *
 * Why this test exists
 * --------------------
 * The architecture document states (and the policy gate depends on) the
 * following contract for what crosses the wire to the OpenAI-compatible LLM:
 *
 *   "Specifically NOT exposed to the LLM: dataScope, domain, capability.
 *    The single source of truth for who can call what stays in
 *    lib/mcp/policy.ts."
 *
 * If a future contributor `...spread`s a `RegisteredTool` into the function
 * spec, those three fields will silently leak. That is a §6.4 violation: it
 * lets the model self-police in subtly wrong ways, masks gate behavior in
 * traces, and lets a curious end user exfiltrate scope topology by asking
 * the model what tools it sees.
 *
 * This file pins the invariant at its source (`lib/agents/tool-projection.ts`,
 * shared by the agent and the provider client) so regression cannot ship.
 */

import { toOpenAITool, safeName } from '@/lib/agents/tool-projection';
import type { RegisteredTool } from '@/lib/mcp/registry';

function makeMaximalRegisteredTool(): RegisteredTool {
  // Deliberately populate every gate-side field so a regression that spreads
  // the whole object will leak on this fixture.
  return {
    name: 'pnl.company_pnl',
    server: 'pnl',
    localName: 'company_pnl',
    description: 'Company-wide P&L. Finance-only.',
    capability: 'admin',
    dataScope: { department: 'finance' },
    domain: 'pnl',
    inputSchema: {
      type: 'object',
      properties: {
        quarter: { type: 'string', description: 'YYYY-Qn' },
      },
      required: ['quarter'],
    },
  };
}

describe('toOpenAITool — LLM catalog projection invariant (ARCHITECTURE.md §6.4)', () => {
  it('produces exactly the OpenAI tool-call envelope shape', () => {
    const projected = toOpenAITool(makeMaximalRegisteredTool());

    expect(Object.keys(projected).sort()).toEqual(['function', 'type']);
    expect(projected.type).toBe('function');

    const fn = projected.function as Record<string, unknown>;
    expect(Object.keys(fn).sort()).toEqual(['description', 'name', 'parameters']);
    expect(fn.name).toBe('pnl__company_pnl');
    expect(fn.description).toBe('Company-wide P&L. Finance-only.');
    expect(fn.parameters).toEqual({
      type: 'object',
      properties: { quarter: { type: 'string', description: 'YYYY-Qn' } },
      required: ['quarter'],
    });
  });

  it('does NOT leak dataScope, domain, or capability anywhere in the projection', () => {
    const projected = toOpenAITool(makeMaximalRegisteredTool());

    // Top-level structural assertion.
    expect(projected).not.toHaveProperty('dataScope');
    expect(projected).not.toHaveProperty('domain');
    expect(projected).not.toHaveProperty('capability');

    const fn = projected.function as Record<string, unknown>;
    expect(fn).not.toHaveProperty('dataScope');
    expect(fn).not.toHaveProperty('domain');
    expect(fn).not.toHaveProperty('capability');

    // Belt-and-suspenders: walk the entire JSON-serialized object and
    // ensure none of the forbidden field names appear *anywhere*. This
    // catches the most likely regression — `function: { ...tool }` or
    // `parameters: { ...tool.inputSchema, dataScope: tool.dataScope }`
    // — even if the offender renames a wrapper key.
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toMatch(/"dataScope"/);
    expect(serialized).not.toMatch(/"domain"/);
    expect(serialized).not.toMatch(/"capability"/);

    // And the *values* themselves must not appear, since a future bug
    // could rename the key but still embed the value (e.g. a "scope"
    // alias). 'finance' is the only string-literal in the fixture that
    // would only come from dataScope; if it shows up in the wire shape
    // we've leaked even though we renamed the key.
    expect(serialized).not.toMatch(/"finance"/);
    // 'pnl' appears legitimately in the qualified tool name `pnl__company_pnl`,
    // so we cannot blanket-ban it. Instead, ensure 'pnl' never appears as a
    // standalone JSON value (i.e. quoted with no surrounding identifier
    // characters) — that would only happen if `domain` itself leaked.
    expect(serialized).not.toMatch(/:\s*"pnl"/);
  });

  it('handles tools without dataScope/domain/capability identically (no field appears)', () => {
    // Sanity: even when the source object has the fields *missing*, the
    // projection shape is unchanged. Locks the converse direction so a
    // refactor that conditionally adds fields can't pass.
    const minimal: RegisteredTool = {
      name: 'files.list',
      server: 'files',
      localName: 'list',
      description: 'List files',
      capability: 'read',
      inputSchema: { type: 'object', properties: {} },
    };
    const projected = toOpenAITool(minimal);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toMatch(/"dataScope"/);
    expect(serialized).not.toMatch(/"domain"/);
    expect(serialized).not.toMatch(/"capability"/);
  });

  it('safeName replaces every dot, not just the first', () => {
    // OpenAI-compatible function names cannot contain dots. The registry
    // and the agent agree on `__` as the replacement. If this drifts, the
    // round-trip through `unSafeName` breaks and tool calls silently fail.
    expect(safeName('a.b')).toBe('a__b');
    expect(safeName('a.b.c')).toBe('a__b__c');
    expect(safeName('no_dots_here')).toBe('no_dots_here');
    expect(safeName('')).toBe('');
  });
});
