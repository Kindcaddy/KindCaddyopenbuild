import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';
import {
  createInvite,
  inviteUrl,
  InviteError,
} from '@/lib/invites';

interface InviteRow {
  id: string;
  token: string;
  email: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

function serialize(invite: InviteRow, origin: string) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    url: inviteUrl(origin, invite.token),
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    expired:
      invite.acceptedAt === null && invite.expiresAt.getTime() < Date.now(),
    createdAt: invite.createdAt.toISOString(),
  };
}

/**
 * GET — list invites for the current tenant. Admins see every invite in the
 * tenant; employees see the ones they created. Any authenticated role may
 * invite (per product decision: every signed-in user gets "Send invite").
 */
export const GET = withGuard(async (req: NextRequest, context) => {
  const origin = process.env.APP_ORIGIN ?? req.nextUrl.origin;
  const invites = await db.invite.findMany({
    where:
      context.role === 'admin'
        ? { tenantId: context.tenantId }
        : { tenantId: context.tenantId, inviterId: context.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({
    invites: invites.map((i) => serialize(i, origin)),
  });
});

/**
 * POST — create (or rotate) an invite for an email address. The invitee joins
 * the inviter's tenant + department as an employee.
 */
export const POST = withGuard(async (req: NextRequest, context) => {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  if (typeof body.email !== 'string' || !body.email.trim()) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'email is required' },
      { status: 400 },
    );
  }

  try {
    const invite = await createInvite({
      email: body.email,
      inviterId: context.userId,
      tenantId: context.tenantId,
      departmentId: context.department.id,
    });
    await db.auditEvent.create({
      data: {
        userId: context.userId,
        tenantId: context.tenantId,
        action: 'invite.created',
        resourceType: 'invite',
        resourceId: invite.id,
        metadata: JSON.stringify({ email: invite.email }),
      },
    });
    const origin = process.env.APP_ORIGIN ?? req.nextUrl.origin;
    return NextResponse.json(
      { invite: serialize(invite, origin) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof InviteError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }
});
