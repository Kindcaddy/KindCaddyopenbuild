/**
 * Invite links: any signed-in user can bring a teammate into their tenant.
 *
 * Flow:
 *   1. Inviter clicks "Send invite" in the profile dropdown ->
 *      POST /api/invites creates an Invite row and returns a link
 *      (/login?invite=<token>).
 *   2. The invitee opens the link; the login page stashes the token in a
 *      short-lived `kc_invite` cookie and shows who invited them.
 *   3. After sign-in, /api/auth/bridge redeems the token via acceptInvite():
 *      the invitee gets an `employee` Membership in the inviter's tenant +
 *      department and tenant provisioning is skipped entirely.
 *
 * Safety properties:
 *   - The invite email must match the sign-in email (a forwarded link is
 *     useless to a different inbox).
 *   - Redemption is claimed atomically (updateMany on acceptedAt IS NULL) so
 *     two concurrent sign-ins can't both consume the same link.
 *   - Re-accepting your own invite is idempotent (double-click safe).
 */

import { randomBytes } from 'crypto';
import { db } from './db';

export const INVITE_COOKIE = 'kc_invite';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class InviteError extends Error {
  constructor(
    readonly code:
      | 'already_member'
      | 'invite_invalid'
      | 'invite_used'
      | 'invite_expired'
      | 'invite_email_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'InviteError';
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/login?invite=${token}`;
}

/**
 * Create (or rotate) the single live invite for (tenant, email). The invitee
 * lands in the inviter's department as an employee.
 */
export async function createInvite(input: {
  email: string;
  inviterId: string;
  tenantId: string;
  departmentId: string;
}) {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new InviteError('invite_invalid', 'A valid email address is required');
  }

  // Inviting someone who is already a member of this tenant is a no-op the
  // UI should surface, not silently re-link.
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    const membership = await db.membership.findFirst({
      where: { userId: existingUser.id, tenantId: input.tenantId },
    });
    if (membership) {
      throw new InviteError(
        'already_member',
        `${email} is already a member of this workspace`,
      );
    }
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  return db.invite.upsert({
    where: { tenantId_email: { tenantId: input.tenantId, email } },
    update: {
      token,
      expiresAt,
      acceptedAt: null,
      inviterId: input.inviterId,
      departmentId: input.departmentId,
      role: 'employee',
    },
    create: {
      token,
      email,
      tenantId: input.tenantId,
      departmentId: input.departmentId,
      inviterId: input.inviterId,
      role: 'employee',
      expiresAt,
    },
  });
}

/** Pre-sign-in display data for the login page. Token is the capability, so
 *  this is safe to read unauthenticated: it only reveals what the link holder
 *  already knows (the email it was sent to) plus workspace/inviter names. */
export async function getInviteForDisplay(token: string) {
  const invite = await db.invite.findUnique({
    where: { token },
    include: { tenant: true },
  });
  if (!invite) return null;
  const inviter = await db.user.findUnique({
    where: { id: invite.inviterId },
    select: { name: true, email: true },
  });
  return {
    email: invite.email,
    tenantName: invite.tenant.name,
    inviterName: inviter?.name || inviter?.email || 'A teammate',
    expiresAt: invite.expiresAt.toISOString(),
    expired: invite.expiresAt.getTime() < Date.now(),
    accepted: invite.acceptedAt !== null,
  };
}

/**
 * Redeem an invite at sign-in. Creates the employee membership and marks the
 * invite accepted. Returns the tenant the bridge should bind the session to.
 */
export async function acceptInvite(input: {
  token: string;
  userId: string;
  email: string;
}): Promise<{ tenantId: string }> {
  const invite = await db.invite.findUnique({ where: { token: input.token } });
  if (!invite) {
    throw new InviteError('invite_invalid', 'That invite link is invalid.');
  }
  if (invite.acceptedAt) {
    // Idempotent for the SAME user re-signing-in (bridge retries, double
    // clicks); anyone else gets a hard no.
    const own = await db.membership.findFirst({
      where: { userId: input.userId, tenantId: invite.tenantId },
    });
    if (own) return { tenantId: invite.tenantId };
    throw new InviteError(
      'invite_used',
      'That invite link has already been used. Ask for a new one.',
    );
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new InviteError(
      'invite_expired',
      'That invite link has expired. Ask for a new one.',
    );
  }
  if (normalizeEmail(input.email) !== invite.email) {
    throw new InviteError(
      'invite_email_mismatch',
      `This invite was sent to ${invite.email}. Sign in with that email to accept it.`,
    );
  }

  try {
    await db.$transaction(async (tx) => {
      // Atomic claim: only the first concurrent redemption wins.
      const claim = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new InviteError(
          'invite_used',
          'That invite link has already been used. Ask for a new one.',
        );
      }
      const existing = await tx.membership.findFirst({
        where: { userId: input.userId, tenantId: invite.tenantId },
      });
      if (!existing) {
        await tx.membership.create({
          data: {
            userId: input.userId,
            tenantId: invite.tenantId,
            departmentId: invite.departmentId,
            role: invite.role,
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          userId: input.userId,
          tenantId: invite.tenantId,
          action: 'invite.accepted',
          resourceType: 'invite',
          resourceId: invite.id,
          metadata: JSON.stringify({ email: invite.email }),
        },
      });
    });
  } catch (err) {
    if (err instanceof InviteError) throw err;
    // Unique-violation on (userId, tenantId, departmentId) means the user is
    // already a member — treat as a successful join.
    await db.invite
      .update({ where: { id: invite.id }, data: { acceptedAt: new Date() } })
      .catch(() => undefined);
  }
  return { tenantId: invite.tenantId };
}
