/**
 * Per-user memory management API. Every operation is scoped to the caller's
 * (userId, tenantId) inside lib/memory/store, so a user can only ever see or
 * change their own memory. Used by the configuration page and the chat UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { AppError } from '@/lib/errors';
import { deleteMemory, listMemories, saveMemory } from '@/lib/memory/store';

export const GET = withGuard(
  async (_req: NextRequest, context) => {
    const items = await listMemories(context);
    return NextResponse.json({ items });
  },
  { requireAuth: true },
);

export const POST = withGuard(
  async (req: NextRequest, context) => {
    let body: { content?: unknown; label?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new AppError('invalid_request', 'Request body must be valid JSON', 400);
    }
    if (typeof body.content !== 'string' || !body.content.trim()) {
      throw new AppError('invalid_request', 'content is required', 400);
    }
    const item = await saveMemory(context, {
      content: body.content,
      label: typeof body.label === 'string' ? body.label : null,
      source: 'explicit',
    });
    if (!item) {
      throw new AppError(
        'memory_not_saved',
        'That item was a duplicate or your memory is full.',
        409,
      );
    }
    return NextResponse.json({ item }, { status: 201 });
  },
  { requireAuth: true },
);

export const DELETE = withGuard(
  async (req: NextRequest, context) => {
    let body: { id?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new AppError('invalid_request', 'Request body must be valid JSON', 400);
    }
    if (typeof body.id !== 'string' || !body.id) {
      throw new AppError('invalid_request', 'id is required', 400);
    }
    const deleted = await deleteMemory(context, body.id);
    if (!deleted) {
      throw new AppError('not_found', 'Memory item not found', 404);
    }
    return NextResponse.json({ deleted: true });
  },
  { requireAuth: true },
);
