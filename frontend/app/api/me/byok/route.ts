import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';
import {
  clearByokCookie,
  readByokFromCookies,
  setByokCookie,
} from '@/lib/byok';
import {
  isByokProviderId,
  PROVIDER_PRESETS,
  resolveByok,
} from '@/lib/llm/byok-provider';
import type { ByokConfig } from '@/lib/llm/types';
import { cookies } from 'next/headers';

/**
 * BYOK management. The key is stored ONLY as an encrypted session cookie on
 * the caller's browser (see lib/byok.ts). GET never returns the key itself —
 * only a last-4 preview plus the resolved provider/model so the UI can show
 * exactly what chat will run on.
 */
function describe(config: ByokConfig) {
  const resolved = resolveByok(config);
  return {
    configured: true as const,
    provider: resolved.provider,
    providerLabel: PROVIDER_PRESETS[resolved.provider].label,
    // null = inferred from the key shape, not an explicit user choice.
    providerExplicit: config.provider ?? null,
    baseUrl: config.baseUrl ?? null,
    model: config.model ?? null,
    resolvedModel: resolved.model,
    keyPreview: `…${config.apiKey.slice(-4)}`,
  };
}

export const GET = withGuard(async (_req: NextRequest, context) => {
  void context;
  const config = readByokFromCookies(cookies());
  if (!config) {
    return NextResponse.json({ configured: false });
  }
  return NextResponse.json(describe(config));
});

export const PUT = withGuard(async (req: NextRequest, context) => {
  const body = (await req.json().catch(() => ({}))) as {
    apiKey?: unknown;
    provider?: unknown;
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

  let provider: ByokConfig['provider'];
  if (body.provider !== undefined && body.provider !== null && body.provider !== '') {
    if (!isByokProviderId(body.provider)) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          message: `provider must be one of: ${Object.keys(PROVIDER_PRESETS).join(', ')}`,
        },
        { status: 400 },
      );
    }
    provider = body.provider;
  }

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

  const config: ByokConfig = { apiKey, provider, baseUrl, model };
  setByokCookie(config);
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
        provider: provider ?? null,
        baseUrl: baseUrl ?? null,
        model: model ?? null,
      }),
    },
  });
  return NextResponse.json(describe(config));
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
