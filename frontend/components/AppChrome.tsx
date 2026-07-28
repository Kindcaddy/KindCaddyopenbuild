"use client";

import { usePathname } from "next/navigation";
import AppShell, { type ShellVariant } from "@/components/AppShell";

/**
 * The authenticated chrome is selected here instead of from `app/app/layout.tsx`.
 * A `layout.tsx` inside a segment named `app` collides with the root layout on
 * case-sensitive filesystems: Next builds the root entry from the nested layout,
 * so `<html>`, `globals.css` and next/font are dropped from the output entirely.
 * It reproduces on Linux (the production image) and not on macOS.
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
