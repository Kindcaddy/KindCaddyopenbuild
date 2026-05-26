import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequestContext } from '@/lib/context';
import { db } from '@/lib/db';
import {
  listUserMcpDomains,
  setUserMcpDomains,
} from '@/lib/mcp/user-domain-settings';
import { isChatDomain, type ChatDomain } from '@/lib/mcp/domain-catalog';

interface RouteContext {
  params: { id: string };
}

async function ensureEmployeeBelongsToTenant(
  employeeId: string,
  tenantId: string,
): Promise<boolean> {
  const membership = await db.membership.findFirst({
    where: { userId: employeeId, tenantId, role: 'employee' },
  });
  return Boolean(membership);
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const ctx = await getRequestContext(cookies());
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (ctx.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: admin role required' },
      { status: 403 },
    );
  }
  const ok = await ensureEmployeeBelongsToTenant(params.id, ctx.tenantId);
  if (!ok) {
    return NextResponse.json(
      { error: 'Employee not found in this tenant' },
      { status: 404 },
    );
  }
  const domains = await listUserMcpDomains(params.id, ctx.tenantId);
  return NextResponse.json({ domains });
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const ctx = await getRequestContext(cookies());
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (ctx.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: admin role required' },
      { status: 403 },
    );
  }
  const ok = await ensureEmployeeBelongsToTenant(params.id, ctx.tenantId);
  if (!ok) {
    return NextResponse.json(
      { error: 'Employee not found in this tenant' },
      { status: 404 },
    );
  }

  const body = (await req.json()) as { allowedDomainIds?: unknown };
  if (!Array.isArray(body.allowedDomainIds)) {
    return NextResponse.json(
      { error: 'allowedDomainIds must be an array' },
      { status: 400 },
    );
  }
  const allowedDomainIds = body.allowedDomainIds.filter(isChatDomain) as ChatDomain[];
  if (allowedDomainIds.length !== body.allowedDomainIds.length) {
    return NextResponse.json(
      { error: 'allowedDomainIds contains an unknown MCP domain' },
      { status: 400 },
    );
  }

  try {
    const domains = await setUserMcpDomains(
      params.id,
      ctx.tenantId,
      allowedDomainIds,
      ctx.userId,
    );
    return NextResponse.json({ domains });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to update MCP access',
      },
      { status: 400 },
    );
  }
}
