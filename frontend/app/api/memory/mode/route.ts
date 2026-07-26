/**
 * Read / update the caller's memory capture mode (smart | explicit | off).
 * Scoped per (userId, tenantId). Backs the chat-interface mode selector and
 * the configuration page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { AppError } from '@/lib/errors';
import { getMemoryMode, isMemoryMode, setMemoryMode } from '@/lib/memory/store';

export const GET = withGuard(
  async (_req: NextRequest, context) => {
    const mode = await getMemoryMode(context);
    return NextResponse.json({ mode });
  },
  { requireAuth: true },
);

export const PUT = withGuard(
  async (req: NextRequest, context) => {
    let body: { mode?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new AppError('invalid_request', 'Request body must be valid JSON', 400);
    }
    if (!isMemoryMode(body.mode)) {
      throw new AppError(
        'invalid_request',
        'mode must be one of: smart, explicit, off',
        400,
      );
    }
    const mode = await setMemoryMode(context, body.mode);
    return NextResponse.json({ mode });
  },
  { requireAuth: true },
);
