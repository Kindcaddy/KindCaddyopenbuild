/**
 * Result Normalizer: every MCP server may return heterogeneous shapes
 * (rows, file blobs, records). We fold them into a single envelope so agents
 * and the LLM can reason uniformly.
 */

import type { JsonRpcResponse, JsonValue } from './protocol';

export interface NormalizedResult {
  ok: boolean;
  /** Short human summary suitable for LLM context ("3 rows", "file 12KB"). */
  summary: string;
  /** Structured payload (rows, records, text). */
  data: JsonValue;
  /** Optional error info when !ok */
  error?: {
    code: number;
    message: string;
    /**
     * Policy gate label, present only when the call was denied by a policy
     * gate. Pure metadata for audits/dashboards — control flow stays binary
     * on `ok`/`code`. Mirrors `PolicyDecision['gate']`.
     */
    gate?: 'role' | 'scope' | 'rate';
    /**
     * Optional hint: the fully-qualified name of another tool the caller
     * *would* be allowed to run, used to power graceful refusals like
     * "I can't show company-wide P&L, but I can show department-level
     * P&L." Populated by the registry on scope denials when the denied
     * tool declares a `domain` and another tool in the same domain passes
     * the scope gate. Never authoritative — the agent must still call the
     * suggested tool and have it re-checked by the policy gate.
     */
    suggested_alternative?: string;
  };
}

export function normalize(resp: JsonRpcResponse): NormalizedResult {
  if ('error' in resp) {
    return {
      ok: false,
      summary: `error: ${resp.error.message}`,
      data: null,
      error: { code: resp.error.code, message: resp.error.message },
    };
  }

  const data = resp.result as JsonValue;
  let summary = 'ok';

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, JsonValue>;
    if (Array.isArray(obj.rows)) {
      summary = `${obj.rows.length} row${obj.rows.length === 1 ? '' : 's'}`;
    } else if (typeof obj.content === 'string') {
      summary = `${obj.content.length} chars`;
    } else if (Array.isArray(obj.files)) {
      summary = `${obj.files.length} file${obj.files.length === 1 ? '' : 's'}`;
    } else if (Array.isArray(obj.records)) {
      summary = `${obj.records.length} record${obj.records.length === 1 ? '' : 's'}`;
    } else {
      summary = 'ok';
    }
  } else if (Array.isArray(data)) {
    summary = `${data.length} items`;
  }

  return { ok: true, summary, data };
}
