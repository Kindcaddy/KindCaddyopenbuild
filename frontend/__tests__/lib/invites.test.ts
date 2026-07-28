import { db } from '@/lib/db';
import { ensureOnboarded } from '@/lib/onboarding';
import {
  acceptInvite,
  createInvite,
  getInviteForDisplay,
  InviteError,
} from '@/lib/invites';

describe('invites (send-invite flow)', () => {
  const INVITER_EMAIL = 'invite-inviter@example.com';
  const INVITEE_EMAIL = 'invite-invitee@example.com';

  let inviterId: string;
  let tenantId: string;
  let departmentId: string;
  const createdUserIds: string[] = [];

  async function makeUser(email: string): Promise<string> {
    const user = await db.user.create({
      data: { email, name: email.split('@')[0] },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    inviterId = await makeUser(INVITER_EMAIL);
    ({ tenantId } = await ensureOnboarded({
      userId: inviterId,
      email: INVITER_EMAIL,
      name: 'Inviter',
    }));
    const membership = await db.membership.findFirstOrThrow({
      where: { userId: inviterId, tenantId },
    });
    departmentId = membership.departmentId;
  });

  afterAll(async () => {
    // Tenant cascade removes invites, memberships, departments, domains.
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it('creates an invite with a unique token and 7-day expiry', async () => {
    const invite = await createInvite({
      email: INVITEE_EMAIL,
      inviterId,
      tenantId,
      departmentId,
    });
    expect(invite.token.length).toBeGreaterThan(20);
    expect(invite.role).toBe('employee');
    const ttlMs = invite.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);

    const view = await getInviteForDisplay(invite.token);
    expect(view?.email).toBe(INVITEE_EMAIL);
    expect(view?.expired).toBe(false);
    expect(view?.accepted).toBe(false);
  });

  it('registers the invitee as an employee of the inviter\'s tenant on accept', async () => {
    const invite = await createInvite({
      email: INVITEE_EMAIL,
      inviterId,
      tenantId,
      departmentId,
    });
    const inviteeId = await makeUser(INVITEE_EMAIL);

    const result = await acceptInvite({
      token: invite.token,
      userId: inviteeId,
      email: INVITEE_EMAIL,
    });
    expect(result.tenantId).toBe(tenantId);

    const membership = await db.membership.findFirst({
      where: { userId: inviteeId, tenantId },
    });
    expect(membership?.role).toBe('employee');
    expect(membership?.departmentId).toBe(departmentId);

    const stored = await db.invite.findUnique({ where: { id: invite.id } });
    expect(stored?.acceptedAt).not.toBeNull();

    // Idempotent for the same user (bridge retries / double clicks).
    const again = await acceptInvite({
      token: invite.token,
      userId: inviteeId,
      email: INVITEE_EMAIL,
    });
    expect(again.tenantId).toBe(tenantId);
    expect(await db.membership.count({ where: { userId: inviteeId } })).toBe(1);
  });

  it('rejects a different user reusing an accepted invite', async () => {
    const invite = await db.invite.findFirstOrThrow({
      where: { tenantId, email: INVITEE_EMAIL },
    });
    const otherId = await makeUser('invite-other@example.com');
    await expect(
      acceptInvite({
        token: invite.token,
        userId: otherId,
        email: 'invite-other@example.com',
      }),
    ).rejects.toMatchObject({ code: 'invite_used' });
  });

  it('rejects sign-in with a different email than the invite target', async () => {
    const invite = await createInvite({
      email: 'invite-target@example.com',
      inviterId,
      tenantId,
      departmentId,
    });
    const wrongId = await makeUser('invite-wrong@example.com');
    await expect(
      acceptInvite({
        token: invite.token,
        userId: wrongId,
        email: 'invite-wrong@example.com',
      }),
    ).rejects.toMatchObject({ code: 'invite_email_mismatch' });
    // The invite must remain unconsumed for the real recipient.
    const stored = await db.invite.findUnique({ where: { id: invite.id } });
    expect(stored?.acceptedAt).toBeNull();
  });

  it('rejects expired invites', async () => {
    const invite = await createInvite({
      email: 'invite-expired@example.com',
      inviterId,
      tenantId,
      departmentId,
    });
    await db.invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const userId = await makeUser('invite-expired@example.com');
    await expect(
      acceptInvite({
        token: invite.token,
        userId,
        email: 'invite-expired@example.com',
      }),
    ).rejects.toMatchObject({ code: 'invite_expired' });
  });

  it('rejects unknown tokens and blocks inviting existing members', async () => {
    const userId = await makeUser('invite-unknown@example.com');
    await expect(
      acceptInvite({
        token: 'does-not-exist',
        userId,
        email: 'invite-unknown@example.com',
      }),
    ).rejects.toMatchObject({ code: 'invite_invalid' });

    await expect(
      createInvite({
        email: INVITER_EMAIL, // already a member (admin) of this tenant
        inviterId,
        tenantId,
        departmentId,
      }),
    ).rejects.toMatchObject({ code: 'already_member' });
  });

  it('rotates the token when re-inviting the same email', async () => {
    const first = await createInvite({
      email: 'invite-rotate@example.com',
      inviterId,
      tenantId,
      departmentId,
    });
    const second = await createInvite({
      email: 'invite-rotate@example.com',
      inviterId,
      tenantId,
      departmentId,
    });
    expect(second.id).toBe(first.id);
    expect(second.token).not.toBe(first.token);

    const view = await getInviteForDisplay(first.token);
    expect(view).toBeNull(); // old token is dead
    expect(await getInviteForDisplay(second.token)).not.toBeNull();
  });

  it('InviteError carries a stable machine code', () => {
    const err = new InviteError('invite_invalid', 'nope');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('invite_invalid');
  });
});
