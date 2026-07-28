"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Briefcase, Users, ArrowRight, Lock } from "lucide-react";

interface UserContext {
  user: {
    id: string;
    email: string;
    name: string;
  };
  role: "admin" | "employee";
}

export default function RoleLandingPage() {
  const [userCtx, setUserCtx] = useState<UserContext | null>(null);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as UserContext;
      setUserCtx(data);
    };
    load();
  }, []);

  const isAdmin = userCtx?.role === "admin";
  const inferredRole = isAdmin ? "Admin" : "Employee";
  return (
    <div className="kc-container flex min-h-[calc(100svh-4rem)] items-center py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="kc-rise text-center">
          <span className="kc-eyebrow justify-center">Workspace</span>
          <h1 className="kc-title mt-3">Select workspace role</h1>
          <p className="kc-subtitle mx-auto mt-2">
            Role-based access detected from your login email:{" "}
            <span className="font-semibold text-[var(--kc-accent)]">
              {inferredRole}
            </span>
          </p>
        </div>

        <div className="mt-9 grid gap-5 sm:grid-cols-2">
          <RoleCard
            href="/app/assistant?role=admin"
            icon={Briefcase}
            title="Admin"
            body="Full workspace control: access rules, department scope, integrations, and the audit trail."
            status={isAdmin ? "Allowed for this login" : "Not available"}
            enabled={isAdmin}
            delay={0.08}
          />
          <RoleCard
            href="/app/assistant?role=employee"
            icon={Users}
            title="Employee"
            body="Day-to-day assistant scoped to your department, with every tool call recorded."
            status="Available for all users"
            enabled
            delay={0.16}
          />
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  href,
  icon: Icon,
  title,
  body,
  status,
  enabled,
  delay,
}: {
  href: string;
  icon: typeof Briefcase;
  title: string;
  body: string;
  status: string;
  enabled: boolean;
  delay: number;
}) {
  const content = (
    <>
      <span className="kc-mark h-12 w-12" aria-hidden>
        <Icon
          className="h-[22px] w-[22px] text-[var(--kc-accent)]"
          strokeWidth={1.7}
        />
      </span>
      <h2 className="kc-display mt-4 text-[1.4rem]">{title}</h2>
      <p className="mt-2 text-[0.9rem] leading-relaxed text-[var(--kc-muted)]">
        {body}
      </p>
      <span
        className={`kc-chip mt-4 ${enabled ? "kc-chip--sage" : "kc-chip--muted"}`}
      >
        {!enabled && <Lock className="h-3 w-3" />}
        {status}
      </span>
      {enabled && (
        <span className="mt-4 inline-flex items-center gap-1.5 text-[0.86rem] font-bold text-[var(--kc-accent)]">
          Open assistant
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </span>
      )}
    </>
  );

  if (!enabled) {
    return (
      <div
        className="kc-surface kc-rise cursor-not-allowed p-6 opacity-65 hover:translate-y-0 hover:shadow-[var(--kc-shadow-soft),inset_0_1px_0_var(--kc-hairline)]"
        style={{ "--kc-delay": `${delay}s` } as React.CSSProperties}
        aria-disabled
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="kc-surface kc-rise group block p-6"
      style={{ "--kc-delay": `${delay}s` } as React.CSSProperties}
    >
      {content}
    </Link>
  );
}
