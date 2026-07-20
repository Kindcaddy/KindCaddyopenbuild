import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { notFoundInProduction } from '@/lib/dev-only';

// Dev-only endpoint - 404s in production
export async function POST(req: NextRequest) {
  const blocked = notFoundInProduction();
  if (blocked) return blocked;

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
