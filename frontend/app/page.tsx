"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The app subdomain has no landing page of its own — marketing lives at
 * kindcaddy.com. Route the root by session state:
 *   signed in                 -> /app
 *   app cookie expired but    -> /api/auth/bridge (silent re-mint, no email)
 *     Auth.js session alive
 *   signed out / stale cookie -> /login
 *
 * This is deliberately a STATIC client page. The Linux production build
 * prerenders the root route even with `export const dynamic =
 * "force-dynamic"` (the `app`-segment module-graph quirk from
 * POSTMORTEM-ROOT-LAYOUT-COLLISION.md — does not reproduce on macOS), which
 * froze a server-side session branch into the full-route cache and served it
 * to everyone (2026-07-28). A static shell + client-side routing has no
 * server dynamic APIs, so no build on any platform can cache a wrong branch.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const route = async () => {
      // Live app session? /api/me is the app's only session read path.
      const me = await fetch("/api/me", { cache: "no-store" }).catch(() => null);
      if (me?.ok) {
        router.replace("/app");
        return;
      }

      // App cookie expired but the 30-day Auth.js session still alive?
      // Hand the browser to the bridge for a silent re-mint (no email).
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const session = (await res.json()) as { user?: { id?: string } };
        if (session?.user?.id) {
          window.location.href = "/api/auth/bridge";
          return;
        }
      } catch {
        // Fall through to /login.
      }

      router.replace("/login");
    };
    void route();
  }, [router]);

  return (
    <div className="kc-theme kc-canvas flex min-h-screen min-h-[100svh] items-center justify-center">
      <span className="kc-mark h-11 w-11 text-[0.92rem]" aria-hidden>
        KC
      </span>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
