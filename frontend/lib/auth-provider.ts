/**
 * Real authentication (PRODUCTION-PLAN.md Phase 1.2).
 *
 * Auth.js (NextAuth v5) handles the sign-in ceremony only:
 *   - Email magic links (Resend HTTP API; logs the link in dev when no key).
 *   - Google OAuth (when AUTH_GOOGLE_ID / GOOGLE_CLIENT_ID is configured).
 *
 * The app's own session contract is untouched: after Auth.js establishes who
 * the user is, /api/auth/bridge runs tenant onboarding and calls
 * setAuthCookie(userId, tenantId). getAuthCookie() / withGuard /
 * getRequestContext() never see Auth.js. That cookie remains the seam.
 */

import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import type { Provider } from 'next-auth/providers';
import { db } from './db';

export const EMAIL_FROM =
  process.env.EMAIL_FROM ?? 'KindCaddy <onboarding@resend.dev>';

const googleClientId =
  process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret =
  process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
const allowEmailLinking = process.env.AUTH_ALLOW_EMAIL_LINKING === 'true';

export const googleSignInEnabled = Boolean(googleClientId && googleClientSecret);

/**
 * Send the magic-link email through Resend's HTTP API. Without a key we log
 * the link to the server console in dev (so local sign-in works with zero
 * setup) and refuse loudly in production — a silently dropped sign-in email
 * is exactly the class of failure Phase 0 exists to prevent.
 */
async function sendMagicLink(params: {
  identifier: string;
  url: string;
}): Promise<void> {
  const { identifier, url } = params;
  const apiKey = process.env.AUTH_RESEND_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_RESEND_KEY is not set: cannot send sign-in emails in production',
      );
    }
    console.log(`[auth] Magic sign-in link for ${identifier}: ${url}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: identifier,
      subject: 'Sign in to KindCaddy',
      html: [
        '<p>Click the link below to sign in to KindCaddy.</p>',
        `<p><a href="${url}">Sign in to KindCaddy</a></p>`,
        '<p>If you did not request this email, you can safely ignore it.</p>',
      ].join('\n'),
      text: `Sign in to KindCaddy: ${url}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
  }
}

/**
 * The schema keeps User.name required (the rest of the app reads it
 * unconditionally), but magic-link sign-ups arrive with no name. Derive one
 * from the email's local part at creation time.
 */
function adapterWithDerivedName(): Adapter {
  const base = PrismaAdapter(db) as Adapter;
  return {
    ...base,
    async createUser(user: AdapterUser) {
      return base.createUser!({
        ...user,
        name: user.name ?? user.email.split('@')[0],
      });
    },
  };
}

const providers: Provider[] = [
  Resend({
    apiKey: process.env.AUTH_RESEND_KEY,
    from: EMAIL_FROM,
    sendVerificationRequest: ({ identifier, url }) =>
      sendMagicLink({ identifier, url }),
  }),
];

if (googleSignInEnabled) {
  providers.push(
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      // Safe only when every enabled provider verifies email ownership.
      // Gate behind an explicit env so production must opt in deliberately.
      allowDangerousEmailAccountLinking: allowEmailLinking,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: adapterWithDerivedName(),
  providers,
  session: { strategy: 'database' },
  trustHost: true,
  pages: {
    signIn: '/login',
    verifyRequest: '/login?verify=1',
    error: '/login',
  },
  callbacks: {
    session({ session, user }) {
      // Expose the DB user id so /api/auth/bridge can onboard + set the
      // legacy auth cookie without an extra lookup by email.
      session.user.id = user.id;
      return session;
    },
  },
});
