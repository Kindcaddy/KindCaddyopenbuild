import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/context";
import { auth } from "@/lib/auth-provider";

// Session-dependent routing must run per request: without this the build
// prerenders the page once and serves the frozen render from the full-route
// cache (prod served a cached /app render to signed-out users, 2026-07-28).
export const dynamic = "force-dynamic";

/**
 * The app subdomain has no landing page of its own — marketing lives at
 * kindcaddy.com. Route the root by session state (same contract as /login):
 *   signed in                 -> /app
 *   app cookie expired but    -> /api/auth/bridge (silent re-mint, no email)
 *     Auth.js session alive
 *   signed out / stale cookie -> /login
 * This page replaced the stale Next.js template boilerplate that used to
 * greet anyone who clicked the logo (found 2026-07-28, prod).
 */
export default async function Home() {
  const context = await getRequestContext(cookies());
  if (context) {
    redirect("/app");
  }

  const session = await auth();
  if (session?.user?.id) {
    redirect("/api/auth/bridge");
  }

  redirect("/login");
}
