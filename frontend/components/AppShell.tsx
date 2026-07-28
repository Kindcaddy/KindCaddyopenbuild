"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  LayoutGrid,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import UserProfileDropdown from "@/components/UserProfileDropdown";

interface ShellNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Nav lives here rather than in the layouts because icons are functions, and
 * functions cannot cross the server -> client component boundary as props.
 */
const NAV: Record<ShellVariant, ShellNavItem[]> = {
  app: [
    { href: "/app/assistant", label: "Assistant", icon: Bot },
    { href: "/app/integrations", label: "Integrations", icon: Plug },
    { href: "/app/access-control", label: "Access", icon: ShieldCheck },
    {
      href: "/app/configuration",
      label: "Configuration",
      icon: SlidersHorizontal,
    },
    { href: "/app/profile", label: "Profile", icon: User },
  ],
  admin: [
    { href: "/admin", label: "Overview", icon: LayoutGrid },
    { href: "/admin/users", label: "Users", icon: Users },
    { href: "/admin/errors", label: "Errors", icon: AlertTriangle },
  ],
};

const HOME: Record<ShellVariant, string> = { app: "/app", admin: "/admin" };
const SECTION: Record<ShellVariant, string | undefined> = {
  app: undefined,
  admin: "Admin",
};

export type ShellVariant = "app" | "admin";

interface AppShellProps {
  variant: ShellVariant;
  children: React.ReactNode;
}

/**
 * Branded chrome shared by every authenticated page: warm canvas, ambient
 * decor, and the glass app bar. Replaces the per-page <nav> blocks the app
 * used to duplicate.
 */
export default function AppShell({ variant, children }: AppShellProps) {
  const pathname = usePathname();
  const navItems = NAV[variant];
  const homeHref = HOME[variant];
  const section = SECTION[variant];

  return (
    <div className="kc-theme kc-canvas kc-shell">
      <div
        aria-hidden
        className="kc-orbit -right-[24vw] -top-[46vh] w-[min(820px,120vw)]"
      />
      <div
        aria-hidden
        className="kc-orbit kc-orbit--sage -bottom-[42vh] -left-[26vw] w-[min(680px,108vw)]"
      />

      <header className="kc-appbar">
        <div className="kc-container flex h-16 items-center justify-between gap-4">
          <Link href={homeHref} className="inline-flex items-center gap-2.5">
            <span className="kc-mark h-9 w-9 text-[0.78rem]" aria-hidden>
              KC
            </span>
            <span className="flex items-baseline gap-2">
              <span className="kc-display text-[1.1rem] leading-none">
                KindCaddy
              </span>
              {section && (
                <span className="kc-mono hidden text-[0.58rem] uppercase leading-none tracking-[0.2em] text-[var(--kc-muted)] sm:inline">
                  {section}
                </span>
              )}
            </span>
          </Link>

          <div className="flex items-center gap-1.5">
            <nav aria-label="Primary" className="flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href !== homeHref && pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="kc-nav-link"
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                    <span className="hidden lg:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <span className="mx-1 hidden h-6 w-px bg-[var(--kc-line)] sm:block" />
            <UserProfileDropdown />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">{children}</main>
    </div>
  );
}

/** Standard page heading used across authenticated pages. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="kc-rise mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <span className="kc-eyebrow">{eyebrow}</span>}
        <h1 className={`kc-title ${eyebrow ? "mt-2.5" : ""}`}>{title}</h1>
        {description && (
          <p className="kc-subtitle mt-2 max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
