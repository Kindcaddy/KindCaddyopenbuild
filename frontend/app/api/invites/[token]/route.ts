import { NextRequest, NextResponse } from 'next/server';
import { getInviteForDisplay } from '@/lib/invites';
import { newRequestId, reportError } from '@/lib/errors';

interface RouteContext {
  params: { token: string };
}

/**
 * GET — public, pre-sign-in invite lookup for the login page. Intentionally
 * NOT wrapped in withGuard: the invitee hits this before they have a session.
 * The token is the capability; the response only reveals what the link holder
 * already knows (target email) plus workspace/inviter display names.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const view = await getInviteForDisplay(params.token);
    if (!view) {
      return NextResponse.json({ error: 'invite_invalid' }, { status: 404 });
    }
    return NextResponse.json(view);
  } catch (err) {
    const requestId = newRequestId();
    await reportError(err, {
      requestId,
      route: 'GET /api/invites/[token]',
      code: 'invite_lookup_failed',
    });
    return NextResponse.json({ error: 'internal', requestId }, { status: 500 });
  }
}
