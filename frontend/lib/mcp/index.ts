/**
 * Process-wide MCP registry and client. Every MCP server is instantiated
 * once and registered here. The registry is attached to `globalThis` so
 * Next.js dev-mode HMR does not re-create it on every reload (which would
 * reset in-memory file / invoice state).
 */

import { MCPClient, MCPServerClient } from './client';
import { ToolRegistry } from './registry';
import { GoogleCalendarMCPServer } from './servers/calendar';
import { FilesMCPServer } from './servers/files';
import { NetSuiteMCPServer } from './servers/netsuite';
import { QuickBooksMCPServer } from './servers/quickbooks';
import { SquareMCPServer } from './servers/square';
import { SQLiteMCPServer } from './servers/sqlite';

const globalForMcp = globalThis as unknown as {
  __kindcaddy_mcp__?: {
    registry: ToolRegistry;
    client: MCPClient;
    serverClients: Record<string, MCPServerClient>;
  };
};

function build(): {
  registry: ToolRegistry;
  client: MCPClient;
  serverClients: Record<string, MCPServerClient>;
} {
  const registry = new ToolRegistry();
  registry.register('sqlite', new SQLiteMCPServer());
  registry.register('files', new FilesMCPServer());
  registry.register('calendar', new GoogleCalendarMCPServer());
  registry.register('netsuite', new NetSuiteMCPServer());
  registry.register('quickbooks', new QuickBooksMCPServer());
  registry.register('square', new SquareMCPServer());
  const client = new MCPClient(registry);
  const serverClients = client.getServerClients();
  return { registry, client, serverClients };
}

export const mcp = globalForMcp.__kindcaddy_mcp__ ?? build();
if (process.env.NODE_ENV !== 'production') {
  globalForMcp.__kindcaddy_mcp__ = mcp;
}

export { MCPClient } from './client';
export { MCPServerClient } from './client';
export { ToolRegistry } from './registry';
export * from './protocol';
export type { InvokeResult } from './client';
export type { RegisteredTool } from './registry';
