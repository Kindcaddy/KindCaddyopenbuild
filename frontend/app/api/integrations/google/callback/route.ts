import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import {
  createGoogleOAuthClient,
  getStoredGoogleCalendarConnection,
  saveGoogleCalendarConnection,
} from '@/lib/integrations/google-calendar';

export const GET = withGuard(async (req: NextRequest, context) => {
  const code = req.nextUrl.searchParams.get('code');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError) {
    const redirect = new URL('/app/assistant', req.url);
    redirect.searchParams.set('google_calendar', `error:${oauthError}`);
    return NextResponse.redirect(redirect);
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing "code" in Google OAuth callback.' },
      { status: 400 },
    );
  }

  try {
    const oauth = createGoogleOAuthClient();
    const tokenResult = await oauth.getToken(code);
    const tokens = tokenResult.tokens;

    const scope = {
      tenantId: context.tenant.id,
      departmentId: context.department.id,
      userId: context.user.id,
    };
    const existing = await getStoredGoogleCalendarConnection(scope);
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken;

    if (!refreshToken) {
      return NextResponse.json(
        {
          error:
            'Google did not return a refresh token. Reconnect with consent and offline access.',
        },
        { status: 400 },
      );
    }

    await saveGoogleCalendarConnection(scope, {
      refreshToken,
      calendarId: 'primary',
    });

    const redirect = new URL('/app/assistant', req.url);
    redirect.searchParams.set('google_calendar', 'connected');
    return NextResponse.redirect(redirect);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to complete Google OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
