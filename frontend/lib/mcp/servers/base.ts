/**
 * BaseMCPServer: small helper that implements JSON-RPC dispatch and lets
 * subclasses declare a tool map. It is NOT part of the protocol itself --
 * any class that implements MCPServerHandler works.
 */

import {
  RpcErrorCode,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonValue,
  type MCPServerHandler,
  type ServerDescriptor,
  type ToolDescriptor,
} from '../protocol';

export interface ToolCallContext {
  tenantId: string;
  departmentId: string;
  userId: string;
  role: string;
}

export type ToolImpl = (
  args: Record<string, unknown>,
  ctx: ToolCallContext,
) => Promise<JsonValue>;

export abstract class BaseMCPServer implements MCPServerHandler {
  protected abstract info: Omit<ServerDescriptor, 'tools'>;
  protected abstract tools: Record<string, ToolDescriptor & { impl: ToolImpl }>;

  describe(): ServerDescriptor {
    return {
      ...this.info,
      tools: Object.values(this.tools).map(({ impl: _impl, ...t }) => t),
    };
  }

  async handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (req.method !== 'tools/call') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: RpcErrorCode.MethodNotFound,
          message: `Unsupported method "${req.method}"`,
        },
      };
    }
    const params = (req.params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
      _context?: ToolCallContext;
    };
    const toolName = params.name ?? '';
    const tool = this.tools[toolName];
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: RpcErrorCode.MethodNotFound,
          message: `Tool "${toolName}" not found on server "${this.info.name}"`,
        },
      };
    }
    try {
      const result = await tool.impl(
        params.arguments ?? {},
        params._context ?? {
          tenantId: '',
          departmentId: '',
          userId: '',
          role: 'employee',
        },
      );
      return { jsonrpc: '2.0', id: req.id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: RpcErrorCode.ToolError,
          message: err instanceof Error ? err.message : 'Tool execution failed',
        },
      };
    }
  }
}
