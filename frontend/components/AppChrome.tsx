"use client";

import { usePathname } from "next/navigation";
import AppShell, { type ShellVariant } from "@/components/AppShell";

/**
 * The authenticated chrome is selected here rather than from `app/app/layout.tsx`.
 * A `layout.tsx` inside a segment named `app` takes over the root layout's entry
 * in the Linux production build, so `<html>`, `globals.css` and next/font drop
 * out of the output and every page ships without a stylesheet. It does not
 * reproduce on macOS. See POSTMORTEM-ROOT-LAYOUT-COLLISION.md.
 */
function variantFor(pathname: string): ShellVariant | null {
  if (pathname === "/app" || pathname.startsWith("/app/")) return "app";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const variant = variantFor(usePathname() ?? "");

  if (!variant) return <>{children}</>;

  return <AppShell variant={variant}>{children}</AppShell>;
}
