import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequestContext } from './context';
import { authorize, Permission } from './rbac';
import { AppError, newRequestId, reportError } from './errors';

export type GuardExtras = {
  /** Correlates the response header, server logs, and ErrorReport rows. */
  requestId: string;
};

export type GuardedHandler = (
  req: NextRequest,
  context: NonNullable<Awaited<ReturnType<typeof getRequestContext>>>,
  extras: GuardExtras
) => Promise<NextResponse>;

export type GuardOptions = {
  permission?: Permission;
  requireAuth?: boolean;
};

function withRequestId(res: NextResponse, requestId: string): NextResponse {
  res.headers.set('x-request-id', requestId);
  return res;
}

/**
 * CSRF origin check (PRODUCTION-PLAN.md Phase 3.1). One change point covers
 * every guarded route; Auth.js routes are not wrapped in withGuard and carry
 * their own CSRF protection.
 *
 * Non-GET requests must originate from the app itself: the `Origin` header
 * (when present) must match APP_ORIGIN (or this deployment's own origin),
 * and `Sec-Fetch-Site` (when present) must not be cross-site. Requests with
 * neither header are non-browser clients — they cannot carry ambient cookie
 * credentials from a victim's browser, so they pass.
 */
function passesCsrfCheck(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  const allowedOrigin = process.env.APP_ORIGIN ?? req.nextUrl.origin;
  const origin = req.headers.get('origin');
  if (origin) {
    return origin === allowedOrigin;
  }

  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite) {
    return secFetchSite !== 'cross-site';
  }

  return true;
}

export function withGuard(
  handler: GuardedHandler,
  options: GuardOptions = {}
): (req: NextRequest) => Promise<NextResponse> {
  const { permission, requireAuth = true } = options;

  return async (req: NextRequest) => {
    const requestId = newRequestId();
    const route = `${req.method} ${req.nextUrl.pathname}`;
    let context: Awaited<ReturnType<typeof getRequestContext>> = null;

    try {
      if (!passesCsrfCheck(req)) {
        return withRequestId(
          NextResponse.json(
            { error: 'csrf_origin_mismatch', requestId },
            { status: 403 }
          ),
          requestId
        );
      }

      const cookieStore = cookies();
      context = await getRequestContext(cookieStore);

      // If authentication is required OR a permission check is needed, we must have context
      // (permission checks require authentication to determine the user's role)
      if ((requireAuth || permission) && !context) {
        return withRequestId(
          NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 }),
          requestId
        );
      }

      // If a permission is specified and we have context, check authorization
      if (permission && context) {
        if (!authorize(context, permission)) {
          return withRequestId(
            NextResponse.json(
              { error: 'Forbidden: Insufficient permissions', requestId },
              { status: 403 }
            ),
            requestId
          );
        }
      }

      // At this point, if requireAuth is true or permission is specified, context must exist
      // The handler type signature requires a non-null context, so ensure it exists
      if (!context) {
        return withRequestId(
          NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 }),
          requestId
        );
      }

      return withRequestId(await handler(req, context, { requestId }), requestId);
    } catch (err) {
      // Expected failures: clean mapped response, no ErrorReport — the
      // system said "no", it didn't break.
      if (err instanceof AppError) {
        return withRequestId(
          NextResponse.json(
            { error: err.code, message: err.message, requestId },
            { status: err.status }
          ),
          requestId
        );
      }

      // Everything else: persist a reviewable report, return an opaque 500.
      // No message or stack crosses to the client; the requestId is the
      // support lookup key.
      await reportError(err, {
        requestId,
        route,
        userId: context?.userId ?? null,
        tenantId: context?.tenantId ?? null,
      });
      return withRequestId(
        NextResponse.json({ error: 'internal', requestId }, { status: 500 }),
        requestId
      );
    }
  };
}
