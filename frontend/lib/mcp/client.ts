/**
 * MCP Clients / Broker:
 * - MCPServerClient: one client per registered MCP server.
 * - MCPClient: aggregate client kept for compatibility with qualified names.
 *
 * Both paths share the same policy checks, JSON-RPC dispatch, normalization,
 * persistence, and audit logging.
 */

import { db } from '../db';
import type { RequestContext } from '../context';
import type { RegisteredTool, ToolRegistry } from './registry';
import { evaluatePolicy } from './policy';
import { normalize, type NormalizedResult } from './normalize';
import {
  RpcErrorCode,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonValue,
} from './protocol';

let rpcCounter = 0;
function nextRpcId(): string {
  rpcCounter += 1;
  return `rpc_${Date.now()}_${rpcCounter}`;
}

export interface InvokeOptions {
  /** Attach the call to a chat message so we can render it in the UI. */
  messageId?: string;
  sessionId?: string;
}

export interface InvokeResult extends NormalizedResult {
  invocationId?: string;
  server: string;
  tool: string;
  latencyMs: number;
}

class MCPInvokeRuntime {
  constructor(private registry: ToolRegistry) {}

  async invokeResolved(
    tool: RegisteredTool,
    params: JsonValue,
    context: RequestContext,
    opts: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const start = Date.now();

    const decision = evaluatePolicy({ tool, context, params });
    if (!decision.allow) {
      // Only scope denials produce an alternative hint today. Role and
      // rate denials don't have a "try this instead" answer that lives
      // in the registry — a role denial means the caller is too junior
      // for the whole capability tier, and a rate denial just needs the
      // caller to wait. Keeping the lookup gated on `scope` also keeps
      // the cost off the happy path of the other gates.
      const suggestedAlternative =
        decision.gate === 'scope'
          ? this.registry.findScopeAlternative(tool, context)
          : undefined;
      const res: InvokeResult = {
        ok: false,
        summary: `denied: ${decision.reason}`,
        data: null,
        // `code` stays Forbidden for transport — every denial is one RPC
        // category. `gate` is metadata so dashboards/tests can filter by
        // category (e.g. all `scope` denials) without regex on `reason`.
        // Nothing should switch on `gate` for control flow.
        error: {
          code: RpcErrorCode.Forbidden,
          message: decision.reason ?? 'Denied',
          ...(decision.gate ? { gate: decision.gate } : {}),
          ...(suggestedAlternative
            ? { suggested_alternative: suggestedAlternative }
            : {}),
        },
        server: tool.server,
        tool: tool.localName,
        latencyMs: Date.now() - start,
      };
      res.invocationId = await this.persist(
        tool.server,
        tool.localName,
        params,
        res,
        'denied',
        opts,
      );
      await this.audit(context, tool, 'denied', decision.reason ?? '', opts);
      return res;
    }

    const handler = this.registry.getServer(tool.server);
    if (!handler) {
      return this.failed(
        tool.server,
        tool.localName,
        RpcErrorCode.InternalError,
        `Server "${tool.server}" not running`,
        params,
        opts,
        Date.now() - start,
      );
    }

    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: nextRpcId(),
      method: `tools/call`,
      params: {
        name: tool.localName,
        arguments: params,
        // pass context so servers can scope by tenant/department
        _context: {
          tenantId: context.tenant.id,
          departmentId: context.department.id,
          userId: context.user.id,
          role: context.role,
        },
      } as unknown as JsonValue,
    };

    let resp: JsonRpcResponse;
    try {
      resp = await handler.handle(req);
    } catch (err) {
      resp = {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: RpcErrorCode.InternalError,
          message: err instanceof Error ? err.message : 'Unknown tool error',
        },
      };
    }

    const normalized = normalize(resp);
    const latencyMs = Date.now() - start;
    const result: InvokeResult = {
      ...normalized,
      server: tool.server,
      tool: tool.localName,
      latencyMs,
    };
    result.invocationId = await this.persist(
      tool.server,
      tool.localName,
      params,
      result,
      normalized.ok ? 'ok' : 'error',
      opts,
    );
    await this.audit(
      context,
      tool,
      normalized.ok ? 'ok' : 'error',
      normalized.summary,
      opts,
    );
    return result;
  }

  async failedUnknownTool(
    toolName: string,
    params: JsonValue,
    opts: InvokeOptions,
  ): Promise<InvokeResult> {
    return this.failed(
      'unknown',
      toolName,
      RpcErrorCode.MethodNotFound,
      `Tool "${toolName}" is not registered`,
      params,
      opts,
      0,
    );
  }

  private async failed(
    server: string,
    tool: string,
    code: number,
    message: string,
    params: JsonValue,
    opts: InvokeOptions,
    latencyMs: number,
  ): Promise<InvokeResult> {
    const res: InvokeResult = {
      ok: false,
      summary: `error: ${message}`,
      data: null,
      error: { code, message },
      server,
      tool,
      latencyMs,
    };
    res.invocationId = await this.persist(server, tool, params, res, 'error', opts);
    return res;
  }

  private async persist(
    server: string,
    tool: string,
    params: JsonValue,
    result: InvokeResult,
    status: 'pending' | 'ok' | 'error' | 'denied',
    opts: InvokeOptions,
  ): Promise<string | undefined> {
    if (!opts.messageId || !opts.sessionId) return undefined;
    const row = await db.toolInvocation.create({
      data: {
        messageId: opts.messageId,
        sessionId: opts.sessionId,
        server,
        tool,
        params: JSON.stringify(params ?? {}),
        result: JSON.stringify({
          ok: result.ok,
          summary: result.summary,
          data: result.data,
          error: result.error,
        }),
        status,
        latencyMs: result.latencyMs,
      },
    });
    return row.id;
  }

  private async audit(
    context: RequestContext,
    tool: { name: string; capability: string },
    outcome: string,
    detail: string,
    opts: InvokeOptions,
  ): Promise<void> {
    await db.auditEvent.create({
      data: {
        userId: context.user.id,
        tenantId: context.tenant.id,
        action: `mcp.tool.${outcome}`,
        resourceType: 'tool',
        resourceId: tool.name,
        metadata: JSON.stringify({
          capability: tool.capability,
          detail,
          sessionId: opts.sessionId,
          messageId: opts.messageId,
        }),
      },
    });
  }
}

export class MCPServerClient {
  constructor(
    readonly serverId: string,
    private registry: ToolRegistry,
    private runtime: MCPInvokeRuntime,
  ) {}

  async invoke(
    localToolName: string,
    params: JsonValue,
    context: RequestContext,
    opts: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const tool = this.resolveLocalTool(localToolName);
    if (!tool) {
      return this.runtime.failedUnknownTool(
        `${this.serverId}.${localToolName}`,
        params,
        opts,
      );
    }
    return this.runtime.invokeResolved(tool, params, context, opts);
  }

  private resolveLocalTool(localToolName: string): RegisteredTool | undefined {
    const qualified = localToolName.includes('.')
      ? `${this.serverId}.${localToolName}`
      : `${this.serverId}.${localToolName}`;
    return this.registry.findTool(qualified);
  }
}

export class MCPClient {
  private runtime: MCPInvokeRuntime;
  private serverClients: Record<string, MCPServerClient>;

  constructor(private registry: ToolRegistry) {
    this.runtime = new MCPInvokeRuntime(registry);
    this.serverClients = Object.fromEntries(
      this.registry
        .listServers()
        .map(({ id }) => [id, new MCPServerClient(id, this.registry, this.runtime)]),
    );
  }

  /**
   * Backward-compatible entry point: expects a qualified name such as
   * "quickbooks.list_synced" or "netsuite.list_invoices".
   */
  async invoke(
    toolName: string,
    params: JsonValue,
    context: RequestContext,
    opts: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const tool = this.registry.findTool(toolName);
    if (!tool) {
      return this.runtime.failedUnknownTool(toolName, params, opts);
    }
    return this.runtime.invokeResolved(tool, params, context, opts);
  }

  getServerClient(serverId: string): MCPServerClient | undefined {
    return this.serverClients[serverId];
  }

  getServerClients(): Record<string, MCPServerClient> {
    return this.serverClients;
  }
}
