import type { ReactNode } from "react";

/**
 * Segment config for the entire /app tree.
 *
 * Why: every page under /app branches on live session state (fetched from
 * /api/me after hydration), so no page here may be prerendered into the
 * build cache — a cached render serves every visitor the same frozen shell
 * (x-nextjs-cache: HIT, s-maxage=31536000), the same incident class as
 * POSTMORTEM-ROOT-LAYOUT-COLLISION.md. `dynamic` exported from a layout is
 * inherited by all child segments, so this one export covers every current
 * and future /app page.
 *
 * Verify in `npx next build` output: /app/* routes must show ƒ (dynamic),
 * never ○ (static). Post-deploy: `curl -sI /app` must NOT show
 * `x-nextjs-cache: HIT` or `s-maxage=31536000`.
 */
export const dynamic = "force-dynamic";

export default function AppSegmentLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
