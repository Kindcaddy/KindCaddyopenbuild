/**
 * Memory MCP Server: lets the agent save / list / delete the current user's
 * personal memory when the user explicitly asks (Explicit mode). Smart mode
 * writes to the same store from Host.chat, not through these tools.
 *
 * Every operation is scoped to (userId, tenantId) via the `_context` the MCP
 * client injects, so one user can never read or delete another's memory — the
 * same isolation guarantee the rest of the MCP servers rely on.
 */

import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';
import { deleteMemory, listMemories, saveMemory } from '../../memory/store';

type Tool = ToolDescriptor & { impl: ToolImpl };

export class MemoryMCPServer extends BaseMCPServer {
  protected info = {
    name: 'memory',
    version: '1.0.0',
    description:
      "The user's personal, private memory. Save durable facts/preferences the user asks you to remember; list or delete them on request.",
  };

  protected tools: Record<string, Tool> = {
    save: {
      name: 'save',
      description:
        'Save a durable fact or preference to the current user\'s memory. Use only when the user explicitly asks you to remember something.',
      capability: 'write',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact or preference to remember.' },
          label: { type: 'string', description: 'Optional short category label.' },
        },
        required: ['content'],
      },
      impl: this.save.bind(this),
    },
    list: {
      name: 'list',
      description: "List everything saved in the current user's memory.",
      capability: 'read',
      dataScope: 'public',
      inputSchema: { type: 'object', properties: {} },
      impl: this.list.bind(this),
    },
    delete: {
      name: 'delete',
      description: 'Delete one saved memory item by its id.',
      capability: 'write',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The id of the memory item to delete.' },
        },
        required: ['id'],
      },
      impl: this.delete.bind(this),
    },
  };

  private async save(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const content = String(args.content ?? '').trim();
    if (!content) throw new Error('content is required');
    const label = typeof args.label === 'string' ? args.label : null;
    const item = await saveMemory(
      { userId: ctx.userId, tenantId: ctx.tenantId },
      { content, label, source: 'explicit' },
    );
    if (!item) {
      return { saved: false, reason: 'duplicate_or_limit' };
    }
    return { saved: true, id: item.id, content: item.content, label: item.label };
  }

  private async list(
    _args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const items = await listMemories({ userId: ctx.userId, tenantId: ctx.tenantId });
    return {
      count: items.length,
      items: items.map((i) => ({
        id: i.id,
        content: i.content,
        label: i.label,
        source: i.source,
        createdAt: i.createdAt,
      })),
    };
  }

  private async delete(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const id = String(args.id ?? '');
    if (!id) throw new Error('id is required');
    const deleted = await deleteMemory(
      { userId: ctx.userId, tenantId: ctx.tenantId },
      id,
    );
    return { deleted };
  }
}
