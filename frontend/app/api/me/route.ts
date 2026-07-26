import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { db } from '@/lib/db';

export const GET = withGuard(
  async (req: NextRequest, context) => {
    return NextResponse.json({
      user: context.user,
      tenant: context.tenant,
      department: context.department,
      role: context.role,
      permissions: context.permissions,
    });
  },
  { requireAuth: true }
);

/**
 * Self-service account deletion (privacy launch requirement, Section A.2).
 * Purges everything owned by the caller — chat sessions/messages/tool
 * invocations (cascade), personal memory + memory mode, per-user domain
 * access, memberships, and finally the User row (cascades Auth.js
 * accounts/sessions). Tenants are intentionally left intact because they may
 * be shared with other members.
 *
 * All deletes are keyed on the authenticated userId, so a user can only ever
 * delete their own data.
 */
export const DELETE = withGuard(
  async (req: NextRequest, context) => {
    const userId = context.userId;
    await db.$transaction([
      db.chatSession.deleteMany({ where: { userId } }),
      db.userMemory.deleteMany({ where: { userId } }),
      db.userMemorySetting.deleteMany({ where: { userId } }),
      db.userMcpDomainAccess.deleteMany({ where: { userId } }),
      db.membership.deleteMany({ where: { userId } }),
      db.user.delete({ where: { id: userId } }),
    ]);
    return NextResponse.json({ deleted: true });
  },
  { requireAuth: true }
);
