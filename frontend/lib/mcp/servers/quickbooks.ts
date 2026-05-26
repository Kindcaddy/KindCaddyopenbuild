/**
 * QuickBooks MCP Server — real Intuit QuickBooks Online integration.
 *
 * This is the canonical example of the "mock → real" swap promised in
 * `DEPLOYMENT.md §6`. The replacement is contained to this one file plus its
 * integration helper (`lib/integrations/quickbooks.ts`) and its OAuth routes
 * (`app/api/integrations/quickbooks/{start,callback}`); the rest of the system
 * (policy gate, registry, audit, rate limiter, department scope) is untouched.
 *
 * Tool surface — kept compatible with the mock so existing chat sessions and
 * the deterministic MockLLMProvider (which references `quickbooks.list_synced`)
 * continue to work:
 *
 *   list_invoices     read   own_department   List unpaid/paid invoices
 *   list_customers    read   own_department   List customers
 *   get_company_info  read   public           Verify the connection
 *   create_invoice    write  own_department   Create a new invoice
 *   sync_invoice      write  own_department   Legacy alias for create_invoice
 *   list_synced       read   own_department   Legacy alias for list_invoices
 *
 * Every tool body resolves the per-user QuickBooks connection via
 * `quickBooksFetch()` which transparently handles access-token refresh.
 * If the user hasn't connected QuickBooks, the tool throws a typed error and
 * the policy gate / runtime turns it into a structured `ok:false` result on
 * the tool-result channel (NOT a 500) — same shape as a denied call.
 */

import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';
import {
  quickBooksFetch,
  QuickBooksAuthExpiredError,
  QuickBooksNotConnectedError,
} from '@/lib/integrations/quickbooks';

type Tool = ToolDescriptor & { impl: ToolImpl };

interface QboInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: { value: string; name?: string };
}

interface QboCustomer {
  Id: string;
  DisplayName?: string;
  PrimaryEmailAddr?: { Address?: string };
  Balance?: number;
}

interface QboCompanyInfo {
  CompanyName?: string;
  LegalName?: string;
  Country?: string;
  FiscalYearStartMonth?: string;
}

interface QboQueryResponse<K extends string, T> {
  QueryResponse: {
    [key in K]?: T[];
  } & { totalCount?: number; maxResults?: number; startPosition?: number };
}

export class QuickBooksMCPServer extends BaseMCPServer {
  protected info = {
    name: 'quickbooks',
    version: '2.0.0',
    description:
      'QuickBooks Online adapter. Lists invoices/customers, creates invoices, ' +
      'and reports company info using the connected QBO account.',
  };

  protected tools: Record<string, Tool> = {
    get_company_info: {
      name: 'get_company_info',
      description:
        'Return the connected QuickBooks company profile. Useful to confirm ' +
        'the integration is wired up correctly.',
      capability: 'read',
      dataScope: 'public',
      domain: 'quickbooks',
      inputSchema: { type: 'object', properties: {} },
      impl: this.getCompanyInfo.bind(this),
    },
    list_invoices: {
      name: 'list_invoices',
      description:
        'List QuickBooks invoices for the connected company. Filter by ' +
        '`status` (`unpaid` | `paid` | `all`) and `limit` (default 20, max 100).',
      capability: 'read',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'unpaid | paid | all (default: all)',
          },
          limit: {
            type: 'number',
            description: 'Max rows to return (1–100, default 20)',
          },
        },
      },
      impl: this.listInvoices.bind(this),
    },
    list_customers: {
      name: 'list_customers',
      description:
        'List QuickBooks customers for the connected company.',
      capability: 'read',
      dataScope: 'own_department',
      domain: 'customers',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max rows to return (1–100, default 20)',
          },
          query: {
            type: 'string',
            description: 'Optional DisplayName substring filter',
          },
        },
      },
      impl: this.listCustomers.bind(this),
    },
    create_invoice: {
      name: 'create_invoice',
      description:
        'Create an invoice in QuickBooks for an existing customer. ' +
        '`customerId` must be a QBO Customer.Id; `amount` is in USD.',
      capability: 'write',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          amount: { type: 'number' },
          description: {
            type: 'string',
            description: 'Optional line-item description',
          },
        },
        required: ['customerId', 'amount'],
      },
      impl: this.createInvoice.bind(this),
    },
    // ---- Legacy compatibility shims (do not extend) ----
    sync_invoice: {
      name: 'sync_invoice',
      description:
        '[Deprecated] Alias for create_invoice. Provided so existing chat ' +
        'history and the mock LLM continue to resolve. Prefer create_invoice.',
      capability: 'write',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          customer: {
            type: 'string',
            description: 'Customer display name (used if customerId missing)',
          },
          amount: { type: 'number' },
          invoiceId: {
            type: 'string',
            description: 'Ignored by the real integration; QBO assigns the id.',
          },
        },
        required: ['amount'],
      },
      impl: this.syncInvoice.bind(this),
    },
    list_synced: {
      name: 'list_synced',
      description:
        '[Deprecated] Alias for list_invoices. Lists recently synced ' +
        'invoices from QuickBooks.',
      capability: 'read',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: { type: 'object', properties: {} },
      impl: this.listSynced.bind(this),
    },
  };

  // -------------------- Tool implementations --------------------

  private async getCompanyInfo(
    _args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    return this.guard(ctx, async (scope) => {
      // The `/query` endpoint avoids needing the realmId in the path — the
      // helper already injects it. SELECT * pulls the single CompanyInfo row.
      const res = await quickBooksFetch<
        QboQueryResponse<'CompanyInfo', QboCompanyInfo>
      >(scope, {
        path: '/query',
        query: { query: 'SELECT * FROM CompanyInfo' },
      });
      const info = res.QueryResponse.CompanyInfo?.[0] ?? {};
      return {
        connected: true,
        companyName: info.CompanyName ?? null,
        legalName: info.LegalName ?? null,
        country: info.Country ?? null,
        fiscalYearStartMonth: info.FiscalYearStartMonth ?? null,
      };
    });
  }

  private async listInvoices(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    return this.guard(ctx, async (scope) => {
      const limit = clampLimit(args.limit);
      const status = String(args.status ?? 'all').toLowerCase();
      const where =
        status === 'unpaid'
          ? "WHERE Balance > '0'"
          : status === 'paid'
            ? "WHERE Balance = '0'"
            : '';
      const query =
        `SELECT Id, DocNumber, TxnDate, DueDate, TotalAmt, Balance, CustomerRef ` +
        `FROM Invoice ${where} ORDER BY TxnDate DESC MAXRESULTS ${limit}`;
      const res = await quickBooksFetch<
        QboQueryResponse<'Invoice', QboInvoice>
      >(scope, { path: '/query', query: { query } });
      const rows = res.QueryResponse.Invoice ?? [];
      return {
        status,
        count: rows.length,
        invoices: rows.map((r) => ({
          id: r.Id,
          docNumber: r.DocNumber ?? null,
          txnDate: r.TxnDate ?? null,
          dueDate: r.DueDate ?? null,
          total: r.TotalAmt ?? 0,
          balance: r.Balance ?? 0,
          customer: r.CustomerRef?.name ?? r.CustomerRef?.value ?? null,
        })) as unknown as JsonValue,
      };
    });
  }

  private async listCustomers(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    return this.guard(ctx, async (scope) => {
      const limit = clampLimit(args.limit);
      const q = String(args.query ?? '').trim().replace(/'/g, "''");
      const where = q ? `WHERE DisplayName LIKE '%${q}%'` : '';
      const query =
        `SELECT Id, DisplayName, PrimaryEmailAddr, Balance ` +
        `FROM Customer ${where} ORDER BY DisplayName MAXRESULTS ${limit}`;
      const res = await quickBooksFetch<
        QboQueryResponse<'Customer', QboCustomer>
      >(scope, { path: '/query', query: { query } });
      const rows = res.QueryResponse.Customer ?? [];
      return {
        count: rows.length,
        customers: rows.map((c) => ({
          id: c.Id,
          name: c.DisplayName ?? null,
          email: c.PrimaryEmailAddr?.Address ?? null,
          balance: c.Balance ?? 0,
        })) as unknown as JsonValue,
      };
    });
  }

  private async createInvoice(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    return this.guard(ctx, async (scope) => {
      const customerId = String(args.customerId ?? '').trim();
      const amount = Number(args.amount);
      if (!customerId) throw new Error('customerId is required');
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('amount must be a positive number');
      }
      const description = String(args.description ?? 'Service').slice(0, 256);

      const body = {
        Line: [
          {
            Amount: amount,
            DetailType: 'SalesItemLineDetail',
            Description: description,
            SalesItemLineDetail: {
              ItemRef: { value: '1', name: 'Services' },
            },
          },
        ],
        CustomerRef: { value: customerId },
      };
      const res = await quickBooksFetch<{ Invoice: QboInvoice }>(scope, {
        path: '/invoice',
        method: 'POST',
        body,
      });
      const inv = res.Invoice;
      return {
        id: inv.Id,
        docNumber: inv.DocNumber ?? null,
        total: inv.TotalAmt ?? amount,
        balance: inv.Balance ?? amount,
        customer: inv.CustomerRef?.name ?? customerId,
      };
    });
  }

  // ---- Legacy shims ----

  private async syncInvoice(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    // Old shape allowed { customer: name, amount }. The real API needs a
    // CustomerRef id; if only a name was provided we resolve it via query.
    if (!args.customerId && typeof args.customer === 'string') {
      const lookup = await this.listCustomers(
        { query: args.customer, limit: 1 },
        ctx,
      );
      const list = lookup as { customers?: Array<{ id: string }> };
      const first = list.customers?.[0]?.id;
      if (!first) {
        throw new Error(
          `No QuickBooks customer matched "${args.customer}". Provide customerId explicitly.`,
        );
      }
      return this.createInvoice(
        { customerId: first, amount: args.amount, description: 'Sync' },
        ctx,
      );
    }
    return this.createInvoice(args, ctx);
  }

  private async listSynced(
    _args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    return this.listInvoices({ status: 'all', limit: 20 }, ctx);
  }

  // -------------------- Helpers --------------------

  /**
   * Wrap every tool body in the same "connection required" check so the
   * agent always gets a structured, non-throwing answer when the user hasn't
   * connected QuickBooks. We turn typed integration errors into normal JSON
   * results so the LLM can say "you haven't connected QuickBooks yet, click
   * here" instead of the runtime emitting a tool-error trace.
   */
  private async guard<T extends JsonValue>(
    ctx: ToolCallContext,
    fn: (scope: {
      tenantId: string;
      departmentId: string;
      userId: string;
    }) => Promise<T>,
  ): Promise<JsonValue> {
    const scope = {
      tenantId: ctx.tenantId,
      departmentId: ctx.departmentId,
      userId: ctx.userId,
    };
    try {
      return await fn(scope);
    } catch (err) {
      if (err instanceof QuickBooksNotConnectedError) {
        return {
          connected: false,
          message:
            'QuickBooks is not connected for this user. Visit /app/configuration to connect.',
          reconnectUrl: '/api/integrations/quickbooks/start',
        };
      }
      if (err instanceof QuickBooksAuthExpiredError) {
        return {
          connected: false,
          message:
            'QuickBooks authorization has expired. Please reconnect.',
          reconnectUrl: '/api/integrations/quickbooks/start',
        };
      }
      throw err;
    }
  }
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(100, Math.floor(n)));
}
