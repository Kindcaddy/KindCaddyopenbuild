/**
 * Tool Registry: discovers every tool exposed by every registered MCP server
 * and produces the flat list the LLM sees as "available tools".
 */

import type { RequestContext } from '../context';
import { scopeGate } from './policy';
import type { MCPServerHandler, ToolDescriptor } from './protocol';

export interface RegisteredTool extends ToolDescriptor {
  /** Server name that owns this tool (short id, e.g. "sqlite") */
  server: string;
  /** Local name of the tool on that server (e.g. "query") */
  localName: string;
}

export class ToolRegistry {
  private servers = new Map<string, MCPServerHandler>();

  register(serverId: string, handler: MCPServerHandler): void {
    this.servers.set(serverId, handler);
  }

  getServer(serverId: string): MCPServerHandler | undefined {
    return this.servers.get(serverId);
  }

  listServers(): Array<{ id: string; handler: MCPServerHandler }> {
    return Array.from(this.servers.entries()).map(([id, handler]) => ({
      id,
      handler,
    }));
  }

  /** Flatten every server's tools, prefixed with its short server id. */
  listTools(): RegisteredTool[] {
    const out: RegisteredTool[] = [];
    this.servers.forEach((handler, serverId) => {
      const desc = handler.describe();
      for (const tool of desc.tools) {
        const qualifiedName = tool.name.includes('.')
          ? tool.name
          : `${serverId}.${tool.name}`;
        const localName = qualifiedName.includes('.')
          ? qualifiedName.split('.').slice(1).join('.')
          : qualifiedName;
        out.push({
          ...tool,
          name: qualifiedName,
          server: serverId,
          localName,
        });
      }
    });
    return out;
  }

  findTool(qualifiedName: string): RegisteredTool | undefined {
    return this.listTools().find((t) => t.name === qualifiedName);
  }

  /**
   * Find another tool sharing `denied.domain` whose `dataScope` would let
   * `context` through. Returns the qualified tool name, or `undefined` when
   * no hint applies. Returns `undefined` when:
   *  - the denied tool has no `domain` tag (most tools today),
   *  - no sibling in that domain passes the scope gate for this caller, or
   *  - the only siblings are the denied tool itself.
   *
   * Deliberately stable + first-match: tools are scanned in registration
   * order so the hint is deterministic across requests (no Map iteration
   * order surprises in tests). The cost is O(N) over the registered tool
   * list per denial, which is fine — denials are rare and the list is small.
   *
   * Only the scope axis is checked, not capability or rate. A `read` tool
   * is a fine fallback hint for a denied `write` tool; the agent will
   * re-issue, and the full policy gate will run again on that call.
   */
  findScopeAlternative(
    denied: RegisteredTool,
    context: RequestContext,
  ): string | undefined {
    if (!denied.domain) return undefined;
    const domain = denied.domain;
    for (const candidate of this.listTools()) {
      if (candidate.name === denied.name) continue;
      if (candidate.domain !== domain) continue;
      if (scopeGate(candidate, context).allow) {
        return candidate.name;
      }
    }
    return undefined;
  }
}
