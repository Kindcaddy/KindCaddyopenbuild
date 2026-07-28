import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';
import {
  clearByokCookie,
  readByokFromCookies,
  setByokCookie,
} from '@/lib/byok';
import { cookies } from 'next/headers';

/**
 * BYOK management. The key is stored ONLY as an encrypted session cookie on
 * the caller's browser (see lib/byok.ts). GET never returns the key itself —
 * only a last-4 preview so the UI can confirm which key is active.
 */
export const GET = withGuard(async (_req: NextRequest, context) => {
  void context;
  const config = readByokFromCookies(cookies());
  if (!config) {
    return NextResponse.json({ configured: false });
  }
  return NextResponse.json({
    configured: true,
    baseUrl: config.baseUrl ?? null,
    model: config.model ?? null,
    keyPreview: `…${config.apiKey.slice(-4)}`,
  });
});

export const PUT = withGuard(async (req: NextRequest, context) => {
  const body = (await req.json().catch(() => ({}))) as {
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
  };

  if (typeof body.apiKey !== 'string' || body.apiKey.trim().length < 8) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'apiKey must be at least 8 characters' },
      { status: 400 },
    );
  }
  const apiKey = body.apiKey.trim();

  let baseUrl: string | undefined;
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim().length > 0) {
    const candidate = body.baseUrl.trim();
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('bad protocol');
      }
    } catch {
      return NextResponse.json(
        { error: 'invalid_request', message: 'baseUrl must be a valid http(s) URL' },
        { status: 400 },
      );
    }
    baseUrl = candidate;
  }

  const model =
    typeof body.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : undefined;

  setByokCookie({ apiKey, baseUrl, model });
  await db.auditEvent.create({
    data: {
      userId: context.userId,
      tenantId: context.tenantId,
      action: 'me.byok.updated',
      resourceType: 'user',
      resourceId: context.userId,
      // Never log key material — preview only.
      metadata: JSON.stringify({
        keyPreview: `…${apiKey.slice(-4)}`,
        baseUrl: baseUrl ?? null,
        model: model ?? null,
      }),
    },
  });
  return NextResponse.json({
    configured: true,
    baseUrl: baseUrl ?? null,
    model: model ?? null,
    keyPreview: `…${apiKey.slice(-4)}`,
  });
});

export const DELETE = withGuard(async (_req: NextRequest, context) => {
  clearByokCookie();
  await db.auditEvent.create({
    data: {
      userId: context.userId,
      tenantId: context.tenantId,
      action: 'me.byok.cleared',
      resourceType: 'user',
      resourceId: context.userId,
      metadata: '{}',
    },
  });
  return NextResponse.json({ configured: false });
});
