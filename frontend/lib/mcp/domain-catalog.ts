export type ChatDomain = 'finance' | 'customer' | 'agent';

export interface McpDomainDefinition {
  id: ChatDomain;
  label: string;
  description: string;
  servers: string[];
}

export const MCP_DOMAINS: McpDomainDefinition[] = [
  {
    id: 'finance',
    label: 'Finance',
    description: 'NetSuite invoice lookup and QuickBooks invoice sync workflows.',
    servers: ['netsuite', 'quickbooks'],
  },
  {
    id: 'customer',
    label: 'Customer',
    description: 'Square customer profile search and customer insights.',
    servers: ['square'],
  },
  {
    id: 'agent',
    label: 'Agent workspace',
    description: 'KindAI resources, files, audit context, and calendar scheduling.',
    servers: ['sqlite', 'files', 'calendar'],
  },
];

export const DEFAULT_ACTIVE_DOMAIN_IDS: ChatDomain[] = MCP_DOMAINS.map((d) => d.id);

export function isChatDomain(value: unknown): value is ChatDomain {
  return typeof value === 'string' && MCP_DOMAINS.some((d) => d.id === value);
}

export function getDomainDefinition(id: ChatDomain): McpDomainDefinition {
  const domain = MCP_DOMAINS.find((d) => d.id === id);
  if (!domain) {
    throw new Error(`Unknown MCP domain: ${id}`);
  }
  return domain;
}
