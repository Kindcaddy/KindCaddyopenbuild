import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import {
  createGoogleOAuthClient,
  GOOGLE_CALENDAR_SCOPES,
} from '@/lib/integrations/google-calendar';

export const GET = withGuard(async (_req: NextRequest) => {
  try {
    const oauth = createGoogleOAuthClient();
    const url = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_CALENDAR_SCOPES,
    });
    return NextResponse.redirect(url);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to start Google OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
