/**
 * MCP Protocol (JSON-RPC 2.0) wire types.
 *
 * This is a faithful subset of the Model Context Protocol: each MCPServer
 * exposes tools / resources, and the Host talks to them through a Client
 * using JSON-RPC 2.0 request/response envelopes.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest<P = JsonValue> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcSuccess<R = JsonValue> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: R;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

export type JsonRpcResponse<R = JsonValue> = JsonRpcSuccess<R> | JsonRpcError;

// Standard JSON-RPC error codes + MCP extensions
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // MCP-specific
  Unauthorized: -32001,
  Forbidden: -32002,
  RateLimited: -32003,
  ToolError: -32010,
} as const;

// ---------- MCP Tool / Resource descriptors ----------

export interface ToolParamSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      description?: string;
      enum?: string[];
    }
  >;
  required?: string[];
}

/**
 * Data axis for a tool, orthogonal to its capability axis.
 *
 * Declares *which slice of tenant data* the tool reads/writes, so the policy
 * gate can enforce department isolation independently of read/write/admin.
 *
 * Discriminated union (not free-form string) so the gate is forced by the
 * compiler to handle every case — prevents "oops, I forgot tenant_admin" bugs.
 *
 * Semantics:
 *  - 'public'              → tenant-wide data, any department may access
 *  - 'own_department'      → restricted to the caller's own department
 *  - { department: string} → restricted to one explicitly named department,
 *                            matched by *normalized name* (trim +
 *                            lowercase) — see `normalizeDepartmentName` in
 *                            `lib/mcp/policy.ts` for the single source of
 *                            truth. Use the human-readable name here
 *                            (e.g. `{ department: 'finance' }`), not an id.
 *  - 'tenant_admin'        → company-wide clearance; carried by membership
 *                            in the Executive department (not by role).
 *                            See `EXECUTIVE_DEPARTMENT_*` constants in
 *                            `lib/mcp/policy.ts` — that file is the one
 *                            place that names the carrying department.
 *
 * A missing/`undefined` value is treated as `'public'` by the gate, so every
 * existing tool keeps working unchanged. This is what makes adding the field
 * a non-breaking change.
 */
export type DataScope =
  | 'public'
  | 'own_department'
  | { department: string }
  | 'tenant_admin';

export interface ToolDescriptor {
  /** Fully qualified tool name, e.g. "sqlite.query" */
  name: string;
  /** Human-readable description shown to the LLM */
  description: string;
  /** JSON-Schema-ish input shape */
  inputSchema: ToolParamSchema;
  /** Coarse capability tag, used for policy/guardrails */
  capability: 'read' | 'write' | 'admin';
  /**
   * Data axis tag. Optional — when omitted, gate treats this tool as 'public'.
   * See {@link DataScope}.
   */
  dataScope?: DataScope;
  /**
   * Loose grouping tag for "tools that answer the same kind of question"
   * (e.g. `pnl`, `invoices`, `customers`). Orthogonal to `capability`
   * (read/write/admin) and `dataScope` (which slice of data).
   *
   * Used ONLY by the registry to suggest a `suggested_alternative` when a
   * scope denial happens: if the caller can't run `pnl.company_wide` but
   * `pnl.department_pnl` shares the same domain tag and would pass scope,
   * the denial payload can hint at it. Not consulted by the gate itself —
   * the policy decision still depends only on capability + dataScope.
   *
   * Free-form on purpose: cheap to add, no central enum to keep in sync.
   * Tools that don't share a hint domain with anyone simply omit it.
   */
  domain?: string;
}

export interface ServerDescriptor {
  name: string;
  version: string;
  description: string;
  tools: ToolDescriptor[];
}

// ---------- Handler contract implemented by every MCPServer ----------

export interface MCPServerHandler {
  describe(): ServerDescriptor;
  handle(req: JsonRpcRequest): Promise<JsonRpcResponse>;
}
