/**
 * Square MCP Server (mock): exposes customer-facing tools so the chat can
 * operate in Customer mode without touching finance systems.
 */

import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';

type Tool = ToolDescriptor & { impl: ToolImpl };

interface Customer {
  id: string;
  name: string;
  email: string;
  lifetimeValue: number;
}

export class SquareMCPServer extends BaseMCPServer {
  protected info = {
    name: 'square',
    version: '1.0.0',
    description: 'Square customer adapter (mock). Customer insights and search.',
  };

  private readonly customers: Customer[] = [
    { id: 'CUST-101', name: 'Avery Quinn', email: 'avery@example.com', lifetimeValue: 5100 },
    { id: 'CUST-102', name: 'Jordan Lee', email: 'jordan@example.com', lifetimeValue: 2200 },
    { id: 'CUST-103', name: 'Taylor Fox', email: 'taylor@example.com', lifetimeValue: 8900 },
    { id: 'CUST-104', name: 'Morgan Diaz', email: 'morgan@example.com', lifetimeValue: 3500 },
  ];

  protected tools: Record<string, Tool> = {
    list_customers: {
      name: 'list_customers',
      description: 'List customer profiles available in Square.',
      capability: 'read',
      dataScope: 'own_department',
      inputSchema: { type: 'object', properties: {} },
      impl: this.listCustomers.bind(this),
    },
    find_customer: {
      name: 'find_customer',
      description: 'Find a customer by id, name, or email.',
      capability: 'read',
      dataScope: 'own_department',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Customer id, name, or email' },
        },
        required: ['query'],
      },
      impl: this.findCustomer.bind(this),
    },
  };

  private async listCustomers(
    _args: Record<string, unknown>,
    _ctx: ToolCallContext,
  ): Promise<JsonValue> {
    return { records: this.customers as unknown as JsonValue };
  }

  private async findCustomer(
    args: Record<string, unknown>,
    _ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const query = String(args.query ?? '').trim().toLowerCase();
    if (!query) {
      throw new Error('query is required');
    }
    const record = this.customers.find((c) => {
      return (
        c.id.toLowerCase() === query ||
        c.email.toLowerCase().includes(query) ||
        c.name.toLowerCase().includes(query)
      );
    });
    if (!record) {
      throw new Error(`No customer found for "${query}"`);
    }
    return record as unknown as JsonValue;
  }
}
