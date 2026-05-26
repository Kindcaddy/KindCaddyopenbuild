/**
 * SQLite MCP Server: exposes read-only access to the live KindAI Prisma
 * database, scoped to the caller's tenant. Real data, real isolation.
 */

import { db } from '../../db';
import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';

type Tool = ToolDescriptor & { impl: ToolImpl };

export class SQLiteMCPServer extends BaseMCPServer {
  protected info = {
    name: 'sqlite',
    version: '1.0.0',
    description:
      'Read-only access to the KindAI SQLite database (tenant-scoped).',
  };

  protected tools: Record<string, Tool> = {
    list_resources: {
      name: 'list_resources',
      description:
        'List resources belonging to the current tenant & department. Returns id, name, and parsed data.',
      capability: 'read',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max rows to return (default 20).' },
        },
      },
      impl: this.listResources.bind(this),
    },
    count_resources: {
      name: 'count_resources',
      description: 'Count resources visible to the caller.',
      capability: 'read',
      dataScope: 'public',
      inputSchema: { type: 'object', properties: {} },
      impl: this.countResources.bind(this),
    },
    search_users: {
      name: 'search_users',
      description:
        'Search users whose email or name matches a substring. Returns members of the caller\'s tenant only.',
      capability: 'read',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Substring to match (case-insensitive).' },
        },
        required: ['q'],
      },
      impl: this.searchUsers.bind(this),
    },
    recent_audit: {
      name: 'recent_audit',
      description: 'Return the most recent audit events for the current tenant.',
      capability: 'read',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max events (default 10).' },
        },
      },
      impl: this.recentAudit.bind(this),
    },
  };

  private async listResources(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const limit = Math.min(Number(args.limit ?? 20), 100);
    const rows = await db.resource.findMany({
      where: { tenantId: ctx.tenantId, departmentId: ctx.departmentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        data: safeJson(r.data),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  private async countResources(
    _args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const n = await db.resource.count({
      where: { tenantId: ctx.tenantId, departmentId: ctx.departmentId },
    });
    return { count: n };
  }

  private async searchUsers(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const q = String(args.q ?? '').toLowerCase();
    if (!q) return { rows: [] };
    const memberships = await db.membership.findMany({
      where: { tenantId: ctx.tenantId },
      include: { user: true },
      take: 50,
    });
    const rows = memberships
      .filter(
        (m) =>
          m.user.email.toLowerCase().includes(q) ||
          m.user.name.toLowerCase().includes(q),
      )
      .map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
      }));
    return { rows };
  }

  private async recentAudit(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const limit = Math.min(Number(args.limit ?? 10), 50);
    const rows = await db.auditEvent.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      rows: rows.map((e) => ({
        id: e.id,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        metadata: safeJson(e.metadata),
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}

function safeJson(s: string): JsonValue {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
