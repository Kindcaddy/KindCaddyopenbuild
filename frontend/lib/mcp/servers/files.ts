/**
 * Files MCP Server: a sandboxed virtual filesystem per tenant. Files live
 * in-memory for demo purposes. In production, swap this implementation for
 * S3 / Google Drive / SharePoint clients -- the tool surface stays identical.
 */

import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';

type Tool = ToolDescriptor & { impl: ToolImpl };

interface StoredFile {
  content: string;
  updatedAt: string;
}

export class FilesMCPServer extends BaseMCPServer {
  protected info = {
    name: 'files',
    version: '1.0.0',
    description:
      'Per-tenant sandboxed file store (in-memory). Swap with S3/Drive in prod.',
  };

  // tenantId -> path -> file
  private store = new Map<string, Map<string, StoredFile>>();

  constructor() {
    super();
    // Seed a few files so the demo has something to read.
    const seed = new Map<string, StoredFile>();
    seed.set('welcome.md', {
      content:
        '# Welcome to KindAI\n\nThis is a sample tenant document exposed through the Files MCP server.',
      updatedAt: new Date().toISOString(),
    });
    seed.set('roadmap.md', {
      content:
        '# Roadmap\n\n- Q1: ship MCP broker\n- Q2: ship NetSuite adapter\n- Q3: SOC2',
      updatedAt: new Date().toISOString(),
    });
    // Stamp onto every tenant lazily via getStore, but also provide a sane default.
    this.defaultSeed = seed;
  }

  private defaultSeed: Map<string, StoredFile>;

  private getStore(tenantId: string): Map<string, StoredFile> {
    let s = this.store.get(tenantId);
    if (!s) {
      s = new Map(this.defaultSeed);
      this.store.set(tenantId, s);
    }
    return s;
  }

  protected tools: Record<string, Tool> = {
    list: {
      name: 'list',
      description: 'List file paths available in the tenant\'s file store.',
      capability: 'read',
      dataScope: 'public',
      inputSchema: { type: 'object', properties: {} },
      impl: this.list.bind(this),
    },
    read: {
      name: 'read',
      description: 'Read the text contents of a single file by path.',
      capability: 'read',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file, e.g. "welcome.md"' },
        },
        required: ['path'],
      },
      impl: this.read.bind(this),
    },
    write: {
      name: 'write',
      description: 'Create or overwrite a file with the given text content.',
      capability: 'write',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      impl: this.write.bind(this),
    },
  };

  private async list(
    _args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const store = this.getStore(ctx.tenantId);
    return {
      files: Array.from(store.entries()).map(([path, f]) => ({
        path,
        size: f.content.length,
        updatedAt: f.updatedAt,
      })),
    };
  }

  private async read(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const path = String(args.path ?? '');
    const store = this.getStore(ctx.tenantId);
    const f = store.get(path);
    if (!f) throw new Error(`File not found: ${path}`);
    return { path, content: f.content, updatedAt: f.updatedAt };
  }

  private async write(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const path = String(args.path ?? '');
    const content = String(args.content ?? '');
    if (!path) throw new Error('path is required');
    const store = this.getStore(ctx.tenantId);
    const updatedAt = new Date().toISOString();
    store.set(path, { content, updatedAt });
    return { ok: true, path, size: content.length, updatedAt };
  }
}
