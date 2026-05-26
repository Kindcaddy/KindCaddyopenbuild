/**
 * MockLLMProvider: deterministic, offline "LLM" that implements the same
 * tool-calling contract as real providers. It parses the latest user turn
 * with simple heuristics, emits tool calls, and synthesizes a short reply
 * from tool results. Good enough to exercise the whole Host -> LLM ->
 * Agents -> MCP loop without API keys.
 */

import type { LLMProvider, LLMResponse, LLMToolCall, ChatTurn } from './types';

let callCounter = 0;
function makeCallId(): string {
  callCounter += 1;
  return `call_${Date.now()}_${callCounter}`;
}

export class MockLLMProvider implements LLMProvider {
  name = 'mock-kindcaddy-v1';

  async chat(input: {
    system: string;
    messages: ChatTurn[];
    tools: Array<{ name: string }>;
  }): Promise<LLMResponse> {
    const lastUser = [...input.messages]
      .reverse()
      .find((m) => m.role === 'user');

    // If the last message is a tool result, we are in "synthesis" mode:
    // summarize what tools returned so far.
    const lastMsg = input.messages[input.messages.length - 1];
    if (lastMsg?.role === 'tool') {
      return {
        content: synthesize(input.messages, input.tools.map((t) => t.name)),
        toolCalls: [],
        model: this.name,
      };
    }

    const userText = (lastUser?.content ?? '').toLowerCase();
    const available = new Set(input.tools.map((t) => t.name));
    const calls: LLMToolCall[] = planToolCalls(userText, available);

    if (calls.length === 0) {
      return {
        content: defaultReply(userText, input.tools.map((t) => t.name)),
        toolCalls: [],
        model: this.name,
      };
    }

    return {
      content: '',
      toolCalls: calls,
      model: this.name,
    };
  }
}

function planToolCalls(text: string, available: Set<string>): LLMToolCall[] {
  const out: LLMToolCall[] = [];
  const want = (name: string, args: Record<string, unknown> = {}) => {
    if (available.has(name)) {
      out.push({ id: makeCallId(), name, arguments: args });
    }
  };

  // --- NetSuite: list / outstanding / invoice detail ---
  const invoiceMatch = text.match(/inv-?(\d{3,6})/i);
  if (invoiceMatch) {
    want('netsuite.get_invoice', { id: `INV-${invoiceMatch[1]}` });
  } else if (/\b(unpaid|outstanding|overdue)\b.*invoice|invoice.*\b(unpaid|outstanding|overdue)\b/.test(text)) {
    want('netsuite.list_invoices', { status: 'unpaid' });
  } else if (/\binvoices?\b/.test(text)) {
    want('netsuite.list_invoices', { status: 'all' });
  }
  if (/total|outstanding|how much.*owed/.test(text)) {
    want('netsuite.total_outstanding');
  }

  // --- QuickBooks sync workflow (the canonical diagram example) ---
  if (/sync.*quickbooks|push.*quickbooks|quickbooks.*sync/.test(text)) {
    // The Host will expand this into one sync per unpaid invoice; here we
    // just request the list first. The orchestrator handles the fan-out.
    want('netsuite.list_invoices', { status: 'unpaid' });
  }
  if (/quickbooks.*synced|view.*synced|list.*synced/.test(text)) {
    want('quickbooks.list_synced');
  }

  // --- Files ---
  if (/\b(list|show|what).*files?\b/.test(text)) {
    want('files.list');
  }
  const readMatch = text.match(/read\s+(\S+\.(md|txt))/);
  if (readMatch) {
    want('files.read', { path: readMatch[1] });
  }

  // --- SQLite / internal DB ---
  if (/\bresources?\b/.test(text) && !/quickbooks|invoice/.test(text)) {
    want('sqlite.list_resources', { limit: 20 });
  }
  if (/\b(users?|members?)\b/.test(text)) {
    const qMatch = text.match(/users?\s+(?:named|matching|like)\s+(\w+)/);
    want('sqlite.search_users', { q: qMatch?.[1] ?? '' });
  }
  if (/audit|activity|recent events/.test(text)) {
    want('sqlite.recent_audit', { limit: 10 });
  }

  return out;
}

function synthesize(messages: ChatTurn[], _available: string[]): string {
  // Collect every tool turn from this reasoning step.
  const toolTurns = messages.filter((m) => m.role === 'tool');
  if (toolTurns.length === 0) return 'Done.';

  const parts: string[] = [];
  for (const t of toolTurns) {
    try {
      const parsed = JSON.parse(t.content) as {
        ok: boolean;
        summary: string;
        server: string;
        tool: string;
        data: unknown;
      };
      parts.push(formatToolResult(parsed));
    } catch {
      parts.push(`- ${t.content}`);
    }
  }
  return parts.join('\n\n');
}

function formatToolResult(r: {
  ok: boolean;
  summary: string;
  server: string;
  tool: string;
  data: unknown;
}): string {
  const head = `**${r.server}.${r.tool}** → ${r.summary}`;
  if (!r.ok) return head;
  const d = r.data as Record<string, unknown> | null;
  if (!d) return head;

  if (Array.isArray((d as { rows?: unknown[] }).rows)) {
    const rows = (d as { rows: Array<Record<string, unknown>> }).rows;
    const preview = rows.slice(0, 5).map((row) => `- ${describe(row)}`).join('\n');
    const more = rows.length > 5 ? `\n…and ${rows.length - 5} more.` : '';
    return `${head}\n${preview}${more}`;
  }
  if (Array.isArray((d as { records?: unknown[] }).records)) {
    const recs = (d as { records: Array<Record<string, unknown>> }).records;
    const preview = recs.slice(0, 5).map((row) => `- ${describe(row)}`).join('\n');
    const more = recs.length > 5 ? `\n…and ${recs.length - 5} more.` : '';
    return `${head}\n${preview}${more}`;
  }
  if (Array.isArray((d as { files?: unknown[] }).files)) {
    const files = (d as { files: Array<{ path: string; size: number }> }).files;
    return `${head}\n${files.map((f) => `- ${f.path} (${f.size}b)`).join('\n')}`;
  }
  if (typeof (d as { content?: unknown }).content === 'string') {
    const content = (d as { content: string }).content;
    const preview = content.length > 400 ? content.slice(0, 400) + '…' : content;
    return `${head}\n\n${preview}`;
  }
  if (typeof (d as { totalUSD?: unknown }).totalUSD === 'number') {
    return `${head}: **$${(d as { totalUSD: number }).totalUSD.toLocaleString()} USD outstanding**`;
  }
  if (typeof (d as { count?: unknown }).count === 'number') {
    return `${head}: ${(d as { count: number }).count}`;
  }
  return `${head}\n\`\`\`json\n${JSON.stringify(d, null, 2).slice(0, 600)}\n\`\`\``;
}

function describe(row: Record<string, unknown>): string {
  // Show the 2-3 most useful keys.
  const preferred = ['id', 'name', 'email', 'customer', 'amount', 'status', 'action', 'path'];
  const parts: string[] = [];
  for (const k of preferred) {
    if (row[k] !== undefined) parts.push(`${k}: ${String(row[k])}`);
    if (parts.length >= 3) break;
  }
  if (parts.length === 0) return JSON.stringify(row).slice(0, 120);
  return parts.join(', ');
}

function defaultReply(userText: string, toolNames: string[]): string {
  if (!userText.trim()) {
    return 'Hi! Ask me about invoices, resources, users, files, or audit events.';
  }
  const byServer = new Map<string, string[]>();
  for (const n of toolNames) {
    const [server, tool] = n.split('.');
    const list = byServer.get(server) ?? [];
    list.push(tool);
    byServer.set(server, list);
  }
  const menu = Array.from(byServer.entries())
    .map(([server, tools]) => `- **${server}**: ${tools.join(', ')}`)
    .join('\n');
  return `I don't have a tool that matches that request yet. Available tools:\n\n${menu}`;
}
