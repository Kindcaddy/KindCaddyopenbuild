import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { db } from '@/lib/db';
import { decryptResourceData, encrypt } from '@/lib/crypto';

const GOOGLE_CALENDAR_RESOURCE_NAME = 'google_calendar_connection';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
];

export interface GoogleCalendarScope {
  tenantId: string;
  departmentId: string;
  userId: string;
}

interface StoredGoogleCalendarConnection {
  refreshToken: string;
  calendarId: string;
  connectedAt: string;
  email?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Google Calendar integration`);
  }
  return value;
}

export function createGoogleOAuthClient(): OAuth2Client {
  const clientId = requiredEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requiredEnv('GOOGLE_CLIENT_SECRET');
  const redirectUri = requiredEnv('GOOGLE_REDIRECT_URI');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function parseConnectionData(raw: string): StoredGoogleCalendarConnection | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGoogleCalendarConnection>;
    if (!parsed || typeof parsed.refreshToken !== 'string') return null;
    return {
      refreshToken: parsed.refreshToken,
      calendarId:
        typeof parsed.calendarId === 'string' && parsed.calendarId.trim()
          ? parsed.calendarId
          : 'primary',
      connectedAt:
        typeof parsed.connectedAt === 'string' && parsed.connectedAt.trim()
          ? parsed.connectedAt
          : new Date().toISOString(),
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
    };
  } catch {
    return null;
  }
}

async function findConnection(scope: GoogleCalendarScope) {
  return db.resource.findFirst({
    where: {
      tenantId: scope.tenantId,
      departmentId: scope.departmentId,
      createdBy: scope.userId,
      name: GOOGLE_CALENDAR_RESOURCE_NAME,
    },
  });
}

export async function getStoredGoogleCalendarConnection(
  scope: GoogleCalendarScope,
): Promise<StoredGoogleCalendarConnection | null> {
  const row = await findConnection(scope);
  if (!row) return null;
  const plaintext = await decryptResourceData(row.data);
  return parseConnectionData(plaintext);
}

export async function saveGoogleCalendarConnection(
  scope: GoogleCalendarScope,
  input: {
    refreshToken: string;
    calendarId?: string;
    email?: string;
  },
): Promise<void> {
  const existing = await findConnection(scope);
  const data: StoredGoogleCalendarConnection = {
    refreshToken: input.refreshToken,
    calendarId: input.calendarId?.trim() || 'primary',
    connectedAt: new Date().toISOString(),
    email: input.email,
  };
  const encrypted = await encrypt(JSON.stringify(data));

  if (existing) {
    await db.resource.update({
      where: { id: existing.id },
      data: { data: encrypted },
    });
    return;
  }

  await db.resource.create({
    data: {
      tenantId: scope.tenantId,
      departmentId: scope.departmentId,
      createdBy: scope.userId,
      name: GOOGLE_CALENDAR_RESOURCE_NAME,
      data: encrypted,
    },
  });
}

export async function getGoogleCalendarClient(
  scope: GoogleCalendarScope,
): Promise<{
  calendar: ReturnType<typeof google.calendar>;
  calendarId: string;
}> {
  const stored = await getStoredGoogleCalendarConnection(scope);
  if (!stored?.refreshToken) {
    throw new Error(
      'Google Calendar is not connected for this user. Visit /api/integrations/google/start first.',
    );
  }

  const oauth = createGoogleOAuthClient();
  oauth.setCredentials({ refresh_token: stored.refreshToken });

  return {
    calendar: google.calendar({ version: 'v3', auth: oauth }),
    calendarId: stored.calendarId || 'primary',
  };
}
