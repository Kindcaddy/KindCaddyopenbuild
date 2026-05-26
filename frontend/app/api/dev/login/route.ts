import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookie } from '@/lib/auth';
import { db } from '@/lib/db';

// Dev-only endpoint - should be disabled in production
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { email, tenantId } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Find user by email
    const user = await db.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // If tenantId is provided, verify membership exists
    if (tenantId) {
      const membership = await db.membership.findFirst({
        where: {
          userId: user.id,
          tenantId,
        },
      });

      if (!membership) {
        return NextResponse.json(
          { error: 'User is not a member of this tenant' },
          { status: 403 }
        );
      }
    }

    // Set auth cookie
    setAuthCookie(user.id, tenantId);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
