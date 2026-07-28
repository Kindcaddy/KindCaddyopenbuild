/**
 * QuickBooks Online (QBO) integration — OAuth 2.0 + encrypted token storage.
 *
 * Mirrors the Google Calendar pattern (lib/integrations/google-calendar.ts):
 *  - Tokens (access + refresh + realmId) are AES-256-GCM encrypted at rest
 *    in Resource.data via lib/crypto.ts.
 *  - OAuth `state` is HMAC-signed and bound to the originating user + tenant.
 *  - No Intuit SDK dependency — raw fetch to the Intuit OAuth + Accounting API.
 *
 * Required env vars:
 *   QBO_CLIENT_ID     — Intuit app client ID
 *   QBO_CLIENT_SECRET — Intuit app client secret
 *   QBO_REDIRECT_URI  — OAuth redirect URI (must match Intuit app config)
 *   QBO_ENV           — 'sandbox' or 'production' (default: sandbox)
 *
 * Intuit API docs:
 *   https://developer.intuit.com/app/developer/qbo/docs/develop
 */

import { db } from '@/lib/db';
import { decryptString, encryptString } from '@/lib/crypto';

const QBO_RESOURCE_NAME = 'quickbooks_connection';

/** Short-lived nonce cookie for the OAuth `state` round-trip. */
export const QBO_OAUTH_STATE_COOKIE = 'qbo_oauth_state';

/** OAuth scopes for QBO accounting. */
export const QBO_SCOPES = ['com.intuit.quickbooks.accounting'];

export interface QuickBooksScope {
  tenantId: string;
  departmentId: string;
  userId: string;
}

interface StoredQuickBooksConnection {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  /** ISO timestamp of when the access token was obtained. */
  tokenObtainedAt: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** When the refresh token itself expires (seconds from tokenObtainedAt). */
  refreshExpiresIn: number;
  connectedAt: string;
}

// ─── env helpers ──────────────────────────────────────────────

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for QuickBooks integration`);
  }
  return value;
}

function qboEnv(): 'sandbox' | 'production' {
  return process.env.QBO_ENV === 'production' ? 'production' : 'sandbox';
}

/** Intuit OAuth 2.0 authorize URL. */
export function qboAuthorizeUrl(): string {
  return 'https://appcenter.intuit.com/connect/oauth2';
}

/** Intuit OAuth 2.0 token endpoint. */
export function qboTokenUrl(): string {
  return 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
}

/** QBO Accounting API base URL (environment-aware). */
export function qboApiBaseUrl(): string {
  return qboEnv() === 'production'
    ? 'https://quickbooks.api.intuit.com/v3/company'
    : 'https://sandbox-quickbooks.api.intuit.com/v3/company';
}

// ─── OAuth flow ───────────────────────────────────────────────

/**
 * Build the Intuit OAuth 2.0 authorize redirect URL.
 * Caller is responsible for setting the `state` cookie.
 */
export function buildAuthorizeUrl(state: string): string {
  const clientId = requiredEnv('QBO_CLIENT_ID');
  const redirectUri = requiredEnv('QBO_REDIRECT_URI');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: QBO_SCOPES.join(' '),
    state,
  });
  return `${qboAuthorizeUrl()}?${params.toString()}`;
}

interface QboTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(
  code: string,
): Promise<QboTokenResponse> {
  const clientId = requiredEnv('QBO_CLIENT_ID');
  const clientSecret = requiredEnv('QBO_CLIENT_SECRET');
  const redirectUri = requiredEnv('QBO_REDIRECT_URI');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(qboTokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${authHeader}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QBO token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<QboTokenResponse>;
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<QboTokenResponse> {
  const clientId = requiredEnv('QBO_CLIENT_ID');
  const clientSecret = requiredEnv('QBO_CLIENT_SECRET');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(qboTokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${authHeader}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QBO token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<QboTokenResponse>;
}

// ─── token storage (encrypted) ───────────────────────────────

function parseConnectionData(
  raw: string,
): StoredQuickBooksConnection | null {
  try {
    const parsed = JSON.parse(
      decryptString(raw),
    ) as Partial<StoredQuickBooksConnection>;
    if (
      !parsed ||
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.realmId !== 'string'
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      realmId: parsed.realmId,
      tokenObtainedAt: parsed.tokenObtainedAt ?? new Date().toISOString(),
      expiresIn: parsed.expiresIn ?? 3600,
      refreshExpiresIn: parsed.refreshExpiresIn ?? 0,
      connectedAt: parsed.connectedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function findConnection(scope: QuickBooksScope) {
  return db.resource.findFirst({
    where: {
      tenantId: scope.tenantId,
      departmentId: scope.departmentId,
      createdBy: scope.userId,
      name: QBO_RESOURCE_NAME,
    },
  });
}

export async function getStoredQuickBooksConnection(
  scope: QuickBooksScope,
): Promise<StoredQuickBooksConnection | null> {
  const row = await findConnection(scope);
  if (!row) return null;
  return parseConnectionData(row.data);
}

export async function saveQuickBooksConnection(
  scope: QuickBooksScope,
  input: {
    accessToken: string;
    refreshToken: string;
    realmId: string;
    expiresIn: number;
    refreshExpiresIn: number;
  },
): Promise<void> {
  const existing = await findConnection(scope);
  const data: StoredQuickBooksConnection = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    realmId: input.realmId,
    tokenObtainedAt: new Date().toISOString(),
    expiresIn: input.expiresIn,
    refreshExpiresIn: input.refreshExpiresIn,
    connectedAt: new Date().toISOString(),
  };

  const payload = encryptString(JSON.stringify(data));

  if (existing) {
    await db.resource.update({
      where: { id: existing.id },
      data: { data: payload },
    });
    return;
  }

  await db.resource.create({
    data: {
      tenantId: scope.tenantId,
      departmentId: scope.departmentId,
      createdBy: scope.userId,
      name: QBO_RESOURCE_NAME,
      data: payload,
    },
  });
}

export async function deleteQuickBooksConnection(
  scope: QuickBooksScope,
): Promise<void> {
  const existing = await findConnection(scope);
  if (existing) {
    await db.resource.delete({ where: { id: existing.id } });
  }
}

// ─── API client ───────────────────────────────────────────────

/**
 * Get a valid access token, refreshing if expired.
 * Returns the access token + realmId for making QBO API calls.
 */
export async function getValidAccessToken(
  scope: QuickBooksScope,
): Promise<{ accessToken: string; realmId: string }> {
  const stored = await getStoredQuickBooksConnection(scope);
  if (!stored) {
    throw new Error(
      'QuickBooks is not connected for this user. Visit /api/integrations/quickbooks/start first.',
    );
  }

  const obtainedAt = new Date(stored.tokenObtainedAt).getTime();
  const now = Date.now();
  const elapsedSec = (now - obtainedAt) / 1000;

  // Refresh if the access token is expired or will expire within 60 seconds.
  if (elapsedSec >= stored.expiresIn - 60) {
    const refreshed = await refreshAccessToken(stored.refreshToken);
    await saveQuickBooksConnection(scope, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      realmId: stored.realmId,
      expiresIn: refreshed.expires_in,
      refreshExpiresIn: refreshed.x_refresh_token_expires_in,
    });
    return { accessToken: refreshed.access_token, realmId: stored.realmId };
  }

  return { accessToken: stored.accessToken, realmId: stored.realmId };
}

/**
 * Make a QBO Accounting API call with automatic token refresh.
 *
 * @param scope  - tenant/department/user scope
 * @param method - HTTP method
 * @param path   - API path after /v3/company/{realmId}/ (e.g. 'query')
 * @param body   - request body (for POST/PUT)
 * @param query  - URLSearchParams for query requests
 */
/** Typed QBO API failure: carries the HTTP status, the API path, the raw
 *  Intuit fault body, and the intuit_tid response header (Intuit support's
 *  correlation id — captured per their production-review recommendation) so
 *  callers can classify and triage instead of parsing one flat message. */
export class QboApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly fault: string,
    message: string,
    readonly tid?: string | null,
  ) {
    super(message);
    this.name = 'QboApiError';
  }
}

export async function qboApiCall(
  scope: QuickBooksScope,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options?: {
    body?: string;
    query?: URLSearchParams;
    contentType?: string;
  },
): Promise<Record<string, unknown>> {
  const { accessToken, realmId } = await getValidAccessToken(scope);
  const base = `${qboApiBaseUrl()}/${realmId}/${path}`;

  let url = base;
  if (options?.query) {
    url = `${base}?${options.query.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  if (options?.body) {
    headers['Content-Type'] = options.contentType ?? 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body,
  });

  if (!res.ok) {
    const text = await res.text();
    // Intuit support's correlation id — lands in the ErrorReport message so
    // any production failure can be handed to Intuit support as-is.
    const tid = res.headers.get('intuit_tid');
    throw new QboApiError(
      res.status,
      path,
      text.slice(0, 500),
      `QBO API call failed (${res.status} ${method} ${path})${tid ? ` [intuit_tid: ${tid}]` : ''}: ${text}`,
      tid,
    );
  }

  return res.json() as Promise<Record<string, unknown>>;
}
