import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequestContext } from './context';
import { authorize, Permission } from './rbac';

export type GuardedHandler = (
  req: NextRequest,
  context: NonNullable<Awaited<ReturnType<typeof getRequestContext>>>
) => Promise<NextResponse>;

export type GuardOptions = {
  permission?: Permission;
  requireAuth?: boolean;
};

export function withGuard(
  handler: GuardedHandler,
  options: GuardOptions = {}
): (req: NextRequest) => Promise<NextResponse> {
  const { permission, requireAuth = true } = options;

  return async (req: NextRequest) => {
    const cookieStore = cookies();
    const context = await getRequestContext(cookieStore);

    // If authentication is required OR a permission check is needed, we must have context
    // (permission checks require authentication to determine the user's role)
    if ((requireAuth || permission) && !context) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // If a permission is specified and we have context, check authorization
    if (permission && context) {
      if (!authorize(context, permission)) {
        return NextResponse.json(
          { error: 'Forbidden: Insufficient permissions' },
          { status: 403 }
        );
      }
    }

    // At this point, if requireAuth is true or permission is specified, context must exist
    // The handler type signature requires a non-null context, so ensure it exists
    if (!context) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    return handler(req, context);
  };
}
