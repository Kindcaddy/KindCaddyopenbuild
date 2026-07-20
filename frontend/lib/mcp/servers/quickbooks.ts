/**
 * QuickBooks MCP Server: real QBO Accounting API adapter.
 *
 * Replaces the previous in-memory mock. Tools call the Intuit QBO v3 API
 * via lib/integrations/quickbooks.ts, which handles OAuth token refresh
 * and encrypted credential storage automatically.
 *
 * Tools exposed:
 *  - query       : run a QBO query (e.g. "SELECT * FROM Invoice WHERE Balance > 0")
 *  - get_invoice : fetch a single invoice by Id
 *  - create_invoice : create a new invoice
 *  - list_customers : list all customers (or filter by DisplayName)
 *  - sync_invoice   : create or update an invoice (upsert by DocNumber)
 *
 * All tools are scoped to own_department and require the user to have
 * connected their QuickBooks account via /api/integrations/quickbooks/start.
 */

import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';
import {
  qboApiCall,
  getStoredQuickBooksConnection,
  type QuickBooksScope,
} from '@/lib/integrations/quickbooks';

type Tool = ToolDescriptor & { impl: ToolImpl };

function ctxToScope(ctx: ToolCallContext): QuickBooksScope {
  return {
    tenantId: ctx.tenantId,
    departmentId: ctx.departmentId,
    userId: ctx.userId,
  };
}

export class QuickBooksMCPServer extends BaseMCPServer {
  protected info = {
    name: 'quickbooks',
    version: '2.0.0',
    description:
      'QuickBooks Online Accounting API adapter. Requires OAuth connection.',
  };

  protected tools: Record<string, Tool> = {
    query: {
      name: 'query',
      description:
        'Run a QuickBooks Online query (SQL-like). E.g. "SELECT * FROM Invoice WHERE Balance > 0 MAXRESULTS 50".',
      capability: 'read',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'QBO query string (Intuit Query Language). See https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-qbo-data-model',
          },
        },
        required: ['query'],
      },
      impl: this.query.bind(this),
    },

    get_invoice: {
      name: 'get_invoice',
      description: 'Fetch a single QuickBooks invoice by its Id.',
      capability: 'read',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'QBO invoice Id' },
        },
        required: ['invoiceId'],
      },
      impl: this.getInvoice.bind(this),
    },

    create_invoice: {
      name: 'create_invoice',
      description:
        'Create a new invoice in QuickBooks. Pass a minimal QBO Invoice JSON object.',
      capability: 'write',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: {
        type: 'object',
        properties: {
          invoice: {
            type: 'object',
            description:
              'QBO Invoice object (see Intuit docs). Must include CustomerRef.Id and at least one Line.',
          },
        },
        required: ['invoice'],
      },
      impl: this.createInvoice.bind(this),
    },

    list_customers: {
      name: 'list_customers',
      description:
        'List QuickBooks customers. Optionally filter by DisplayName substring.',
      capability: 'read',
      dataScope: 'own_department',
      domain: 'customers',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description:
              'Optional: filter customers by DisplayName (QBO STARTS WITH syntax).',
          },
          maxResults: {
            type: 'number',
            description: 'Max results (default 100, max 1000).',
          },
        },
      },
      impl: this.listCustomers.bind(this),
    },

    sync_invoice: {
      name: 'sync_invoice',
      description:
        'Create or update an invoice in QuickBooks by DocNumber (upsert).',
      capability: 'write',
      dataScope: 'own_department',
      domain: 'invoices',
      inputSchema: {
        type: 'object',
        properties: {
          invoice: {
            type: 'object',
            description:
              'QBO Invoice object. If DocNumber matches an existing invoice, it is updated; otherwise a new invoice is created.',
          },
        },
        required: ['invoice'],
      },
      impl: this.syncInvoice.bind(this),
    },

    get_connection_status: {
      name: 'get_connection_status',
      description:
        'Check whether QuickBooks is connected for the current user and return the realm ID.',
      capability: 'read',
      dataScope: 'own_department',
      inputSchema: { type: 'object', properties: {} },
      impl: this.getConnectionStatus.bind(this),
    },
  };

  // ─── tool implementations ──────────────────────────────────

  private async query(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const q = String(args.query);
    const params = new URLSearchParams({ query: q });
    const result = await qboApiCall(ctxToScope(ctx), 'GET', 'query', {
      query: params,
    });
    return result as unknown as JsonValue;
  }

  private async getInvoice(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const invoiceId = String(args.invoiceId);
    const result = await qboApiCall(
      ctxToScope(ctx),
      'GET',
      `invoice/${invoiceId}`,
    );
    return result as unknown as JsonValue;
  }

  private async createInvoice(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const invoice = args.invoice as Record<string, unknown>;
    const result = await qboApiCall(ctxToScope(ctx), 'POST', 'invoice', {
      body: JSON.stringify(invoice),
    });
    return result as unknown as JsonValue;
  }

  private async listCustomers(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const filter = args.filter as string | undefined;
    const maxResults = Math.min(Number(args.maxResults ?? 100), 1000);

    let q = 'SELECT * FROM Customer';
    if (filter) {
      // Escape single quotes for QBO query language.
      const escaped = filter.replace(/'/g, "\\'");
      q += ` WHERE DisplayName STARTS WITH '${escaped}'`;
    }
    q += ` MAXRESULTS ${maxResults}`;

    const params = new URLSearchParams({ query: q });
    const result = await qboApiCall(ctxToScope(ctx), 'GET', 'query', {
      query: params,
    });
    return result as unknown as JsonValue;
  }

  private async syncInvoice(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const invoice = args.invoice as Record<string, unknown>;
    const docNumber = invoice.DocNumber as string | undefined;

    // If DocNumber is provided, try to find an existing invoice to update.
    if (docNumber) {
      const escaped = docNumber.replace(/'/g, "\\'");
      const params = new URLSearchParams({
        query: `SELECT Id FROM Invoice WHERE DocNumber = '${escaped}' MAXRESULTS 1`,
      });
      const existing = await qboApiCall(ctxToScope(ctx), 'GET', 'query', {
        query: params,
      });
      const queryResponse = existing.QueryResponse as
        | { Invoice?: Array<{ Id: string }> }
        | undefined;
      const existingInvoice = queryResponse?.Invoice?.[0];

      if (existingInvoice) {
        // Update: merge the existing Id into the invoice object.
        const updatePayload = { ...invoice, Id: existingInvoice.Id, sparse: true };
        const result = await qboApiCall(ctxToScope(ctx), 'POST', 'invoice', {
          body: JSON.stringify(updatePayload),
        });
        return { ok: true, action: 'updated', result: result as unknown as JsonValue };
      }
    }

    // Create new invoice.
    const result = await qboApiCall(ctxToScope(ctx), 'POST', 'invoice', {
      body: JSON.stringify(invoice),
    });
    return { ok: true, action: 'created', result: result as unknown as JsonValue };
  }

  private async getConnectionStatus(
    _args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const stored = await getStoredQuickBooksConnection(ctxToScope(ctx));
    if (!stored) {
      return { connected: false };
    }
    return {
      connected: true,
      realmId: stored.realmId,
      connectedAt: stored.connectedAt,
    };
  }
}
