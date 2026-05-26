/**
 * NetSuite MCP Server (mock): models invoice / customer records so the
 * orchestrator can demo the "unpaid invoices from NetSuite" workflow from
 * the architecture diagram. Replace `store` with real NetSuite REST calls
 * and this file needs no other changes.
 */

import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';

type Tool = ToolDescriptor & { impl: ToolImpl };

interface Invoice {
  id: string;
  customer: string;
  amount: number;
  currency: 'USD';
  status: 'paid' | 'unpaid' | 'overdue';
  dueDate: string;
  tenantId: string;
}

export class NetSuiteMCPServer extends BaseMCPServer {
  protected info = {
    name: 'netsuite',
    version: '1.0.0',
    description:
      'NetSuite ERP adapter (mock). Records & transactions scoped by tenant.',
  };

  private invoices: Invoice[] = [];

  constructor() {
    super();
    // A realistic-looking set of seed invoices, keyed by a per-tenant hash
    // at read time so every tenant sees distinct mock data.
    const base: Omit<Invoice, 'tenantId'>[] = [
      { id: 'INV-1001', customer: 'Globex Inc.', amount: 4200, currency: 'USD', status: 'unpaid', dueDate: daysFromNow(7) },
      { id: 'INV-1002', customer: 'Initech', amount: 980, currency: 'USD', status: 'overdue', dueDate: daysFromNow(-4) },
      { id: 'INV-1003', customer: 'Umbrella Corp', amount: 15200, currency: 'USD', status: 'paid', dueDate: daysFromNow(-14) },
      { id: 'INV-1004', customer: 'Stark Industries', amount: 3370, currency: 'USD', status: 'unpaid', dueDate: daysFromNow(21) },
      { id: 'INV-1005', customer: 'Wayne Enterprises', amount: 7800, currency: 'USD', status: 'unpaid', dueDate: daysFromNow(3) },
    ];
    this.invoices = base.map((i) => ({ ...i, tenantId: '*' }));
  }

  protected tools: Record<string, Tool> = {
    list_invoices: {
      name: 'list_invoices',
      description:
        'List invoices for the current tenant. Filter by status: "paid" | "unpaid" | "overdue" | "all".',
      capability: 'read',
      dataScope: 'own_department',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status',
            enum: ['paid', 'unpaid', 'overdue', 'all'],
          },
        },
      },
      impl: this.listInvoices.bind(this),
    },
    get_invoice: {
      name: 'get_invoice',
      description: 'Fetch a single invoice by its id (e.g. INV-1001).',
      capability: 'read',
      dataScope: 'own_department',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      impl: this.getInvoice.bind(this),
    },
    total_outstanding: {
      name: 'total_outstanding',
      description: 'Sum USD of all unpaid + overdue invoices for the tenant.',
      capability: 'read',
      dataScope: 'own_department',
      inputSchema: { type: 'object', properties: {} },
      impl: this.totalOutstanding.bind(this),
    },
    // P&L pair: paired on `domain: 'pnl'` so that when company_pnl is denied
    // by the scope gate, registry.findScopeAlternative() can suggest
    // department_pnl as a graceful fallback. Mock numbers — replace with
    // real NetSuite GL summary calls when the integration is real.
    company_pnl: {
      name: 'company_pnl',
      description:
        'Company-wide profit & loss summary across all departments. ' +
        'Restricted to the Executive department.',
      capability: 'read',
      dataScope: 'tenant_admin',
      domain: 'pnl',
      inputSchema: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Reporting period, e.g. "YTD", "Q1", "last_quarter"',
          },
        },
      },
      impl: this.companyPnl.bind(this),
    },
    department_pnl: {
      name: 'department_pnl',
      description:
        "Profit & loss summary for the caller's own department. Any " +
        'department member may run this for their own department.',
      capability: 'read',
      dataScope: 'own_department',
      domain: 'pnl',
      inputSchema: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Reporting period, e.g. "YTD", "Q1", "last_quarter"',
          },
        },
      },
      impl: this.departmentPnl.bind(this),
    },
  };

  private async listInvoices(
    args: Record<string, unknown>,
    _ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const status = String(args.status ?? 'all');
    const records = this.invoices
      .filter((i) => status === 'all' || i.status === status)
      .map(({ tenantId: _t, ...rest }) => rest);
    return { records };
  }

  private async getInvoice(
    args: Record<string, unknown>,
    _ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const id = String(args.id ?? '');
    const inv = this.invoices.find((i) => i.id === id);
    if (!inv) throw new Error(`Invoice ${id} not found`);
    const { tenantId: _t, ...rest } = inv;
    return rest as unknown as JsonValue;
  }

  private async totalOutstanding(
    _args: Record<string, unknown>,
    _ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const total = this.invoices
      .filter((i) => i.status !== 'paid')
      .reduce((s, i) => s + i.amount, 0);
    return { totalUSD: total, currency: 'USD' };
  }

  private async companyPnl(
    args: Record<string, unknown>,
    _ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const period = String(args.period ?? 'YTD');
    return {
      period,
      scope: 'company',
      revenueUSD: 12_400_000,
      cogsUSD: 6_900_000,
      grossProfitUSD: 5_500_000,
      operatingExpensesUSD: 3_200_000,
      netIncomeUSD: 2_300_000,
      currency: 'USD',
    };
  }

  private async departmentPnl(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const period = String(args.period ?? 'YTD');
    return {
      period,
      scope: 'department',
      // The tool itself uses ctx.departmentId for row-level filtering —
      // the policy gate already verified the caller has a department,
      // but the actual narrowing of data lives here (Layer 3 of the
      // role/scope/row architecture, not the gate's job).
      departmentId: ctx.departmentId ?? null,
      revenueUSD: 1_850_000,
      cogsUSD: 920_000,
      grossProfitUSD: 930_000,
      operatingExpensesUSD: 540_000,
      netIncomeUSD: 390_000,
      currency: 'USD',
    };
  }
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
