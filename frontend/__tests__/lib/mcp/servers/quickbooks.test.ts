/**
 * Why this test exists
 * --------------------
 * `lib/mcp/servers/quickbooks.ts` is the canonical "mock → real" promotion
 * promised in DEPLOYMENT.md §6. This test pins down the three regressions
 * most likely to silently break the integration:
 *
 *  1. A tool that throws `QuickBooksNotConnectedError` must return a
 *     structured `connected:false` payload, NOT propagate the exception.
 *     If this regresses, the chat surface goes from "click here to connect"
 *     to a 500 visible to the user.
 *  2. `list_invoices` and `list_customers` must clamp `limit` into [1, 100]
 *     before interpolating it into a QBO query string. If this regresses,
 *     a tenant could craft a chat message that issues a SELECT MAXRESULTS
 *     10_000 (or worse, smuggle SQL fragments via a non-numeric value).
 *  3. The legacy `list_synced` and `sync_invoice` aliases must still resolve,
 *     because the deterministic MockLLMProvider references them by name
 *     (lib/llm/mock.ts) and removing them would break the zero-API-key demo.
 *
 * The test stubs the underlying integration helper so no real Intuit call
 * is made. The shape of the stub matches `quickBooksFetch`'s signature.
 */

import { QuickBooksMCPServer } from '@/lib/mcp/servers/quickbooks';
import {
  QuickBooksAuthExpiredError,
  QuickBooksNotConnectedError,
} from '@/lib/integrations/quickbooks';

jest.mock('@/lib/integrations/quickbooks', () => {
  const actual = jest.requireActual('@/lib/integrations/quickbooks');
  return {
    ...actual,
    quickBooksFetch: jest.fn(),
  };
});

import * as qbo from '@/lib/integrations/quickbooks';

const ctx = {
  tenantId: 't1',
  departmentId: 'd1',
  userId: 'u1',
  role: 'employee',
};

function describeTools(server: QuickBooksMCPServer) {
  return server.describe().tools.map((t) => t.name);
}

async function invoke(
  server: QuickBooksMCPServer,
  tool: string,
  args: Record<string, unknown> = {},
) {
  // The MCP server handler accepts a generic JsonValue params shape; the
  // BaseMCPServer dispatcher destructures `name`, `arguments`, and the
  // private `_context` channel out of it. Cast through `unknown` because
  // _context isn't part of the public JSON-RPC params type — it's the
  // policy gate's side channel for passing the resolved request context.
  const res = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args, _context: ctx } as unknown as never,
  });
  if ('error' in res) throw new Error(res.error.message);
  return res.result;
}

describe('QuickBooksMCPServer (real integration)', () => {
  beforeEach(() => {
    (qbo.quickBooksFetch as jest.Mock).mockReset();
  });

  it('exposes the expected tool surface including legacy aliases (threat 3)', () => {
    const tools = describeTools(new QuickBooksMCPServer());
    expect(tools).toEqual(
      expect.arrayContaining([
        'get_company_info',
        'list_invoices',
        'list_customers',
        'create_invoice',
        'sync_invoice',
        'list_synced',
      ]),
    );
  });

  it('returns connected:false instead of throwing when not connected (threat 1)', async () => {
    (qbo.quickBooksFetch as jest.Mock).mockRejectedValue(
      new QuickBooksNotConnectedError(),
    );
    const server = new QuickBooksMCPServer();
    const result = (await invoke(server, 'list_invoices')) as {
      connected: boolean;
      reconnectUrl?: string;
    };
    expect(result.connected).toBe(false);
    expect(result.reconnectUrl).toBe('/api/integrations/quickbooks/start');
  });

  it('also handles expired-auth as a structured result, not a 500 (threat 1)', async () => {
    (qbo.quickBooksFetch as jest.Mock).mockRejectedValue(
      new QuickBooksAuthExpiredError(),
    );
    const server = new QuickBooksMCPServer();
    const result = (await invoke(server, 'get_company_info')) as {
      connected: boolean;
      message: string;
    };
    expect(result.connected).toBe(false);
    expect(result.message).toMatch(/expired/i);
  });

  it('clamps list_invoices.limit into [1, 100] and refuses non-numeric (threat 2)', async () => {
    (qbo.quickBooksFetch as jest.Mock).mockResolvedValue({
      QueryResponse: { Invoice: [] },
    });
    const server = new QuickBooksMCPServer();
    await invoke(server, 'list_invoices', { limit: 999_999 });
    await invoke(server, 'list_invoices', { limit: -5 });
    await invoke(server, 'list_invoices', { limit: 'drop table' });

    const queries = (qbo.quickBooksFetch as jest.Mock).mock.calls.map(
      (c) => c[1].query.query,
    );
    expect(queries.every((q: string) => /MAXRESULTS \d+/.test(q))).toBe(true);
    expect(queries.every((q: string) => !/9999/.test(q))).toBe(true);
    // negative + non-numeric must fall back to the default (20).
    expect(queries[1]).toMatch(/MAXRESULTS 1\b/);
    expect(queries[2]).toMatch(/MAXRESULTS 20\b/);
  });

  it('list_invoices passes a status filter through to the QBO query', async () => {
    (qbo.quickBooksFetch as jest.Mock).mockResolvedValue({
      QueryResponse: { Invoice: [] },
    });
    const server = new QuickBooksMCPServer();
    await invoke(server, 'list_invoices', { status: 'unpaid' });
    const q = (qbo.quickBooksFetch as jest.Mock).mock.calls[0][1].query.query;
    expect(q).toMatch(/WHERE Balance > '0'/);
  });

  it('create_invoice validates customerId + amount', async () => {
    const server = new QuickBooksMCPServer();
    await expect(
      invoke(server, 'create_invoice', { customerId: '', amount: 50 }),
    ).rejects.toThrow(/customerId/);
    await expect(
      invoke(server, 'create_invoice', { customerId: 'c1', amount: -1 }),
    ).rejects.toThrow(/positive/);
  });

  it('list_synced is a working alias for list_invoices', async () => {
    (qbo.quickBooksFetch as jest.Mock).mockResolvedValue({
      QueryResponse: { Invoice: [{ Id: '1', TotalAmt: 10, Balance: 0 }] },
    });
    const server = new QuickBooksMCPServer();
    const result = (await invoke(server, 'list_synced')) as { count: number };
    expect(result.count).toBe(1);
  });
});
