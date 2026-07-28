"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Lock,
  Plug,
  Shield,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import type { ChatDomain } from "@/lib/mcp/domain-catalog";

interface UserMe {
  role: string;
}

interface DomainState {
  id: ChatDomain;
  label: string;
  description: string;
  servers: string[];
  allowed: boolean;
}

interface Employee {
  id: string;
  email: string;
  name: string;
  departmentName: string;
  role: string;
  domains: DomainState[];
}

interface AdminMember {
  id: string;
  email: string;
  name: string;
  departmentName: string;
  role: string;
}

type Tab = "roles" | "employees";

const ROLE_ROWS = [
  {
    role: "Admin",
    scopes:
      "Manage users, MCP access, and system configuration. Sees every MCP server.",
  },
  {
    role: "Employee",
    scopes:
      "Chat usage limited to MCP servers an admin has enabled for them.",
  },
];

export default function AccessControlPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<Tab>("roles");

  useEffect(() => {
    const check = async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) {
        router.push("/login");
        return;
      }
      const data = (await response.json()) as UserMe;
      setAllowed(data.role === "admin");
      setLoading(false);
    };
    check();
  }, [router]);

  if (loading) {
    return (
      <div className="kc-container py-8">
        <div className="kc-skeleton h-8 w-56" />
        <div className="kc-skeleton mt-3 h-4 w-full max-w-md" />
        <div className="kc-skeleton mt-8 h-56 w-full" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="kc-container flex min-h-[60vh] items-center justify-center py-8">
        <div className="kc-panel kc-rise w-full max-w-md p-8 text-center">
          <Shield
            className="mx-auto mb-3 h-10 w-10 text-[var(--kc-accent)]"
            strokeWidth={1.6}
          />
          <h1 className="kc-display text-[1.35rem]">Admin access required</h1>
          <p className="mt-2 text-[var(--kc-muted)]">
            This page is only available to admin accounts.
          </p>
          <Link href="/app" className="kc-btn kc-btn-primary kc-btn--sm mt-5">
            Back to landing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="kc-container py-8">
      <PageHeader
        eyebrow="Access"
        title="Access Control"
        description="Manage role-based access and per-employee MCP server permissions."
      />

      <div
        className="kc-rise mb-6 flex gap-1 border-b border-[var(--kc-line)]"
        style={{ "--kc-delay": "0.06s" } as React.CSSProperties}
      >
        <TabButton active={tab === "roles"} onClick={() => setTab("roles")}>
          <Shield className="h-4 w-4" strokeWidth={1.8} />
          Roles
        </TabButton>
        <TabButton
          active={tab === "employees"}
          onClick={() => setTab("employees")}
        >
          <Users className="h-4 w-4" strokeWidth={1.8} />
          Employees
        </TabButton>
      </div>

      {tab === "roles" ? <RolesView /> : <EmployeesView />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? "border-[var(--kc-accent)] text-[var(--kc-accent)]"
          : "border-transparent text-[var(--kc-muted)] hover:text-[var(--kc-ink)]"
      }`}
    >
      {children}
    </button>
  );
}

function RolesView() {
  return (
    <div
      className="kc-panel kc-rise overflow-hidden"
      style={{ "--kc-delay": "0.1s" } as React.CSSProperties}
    >
      <table className="kc-table">
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Scopes</th>
          </tr>
        </thead>
        <tbody>
          {ROLE_ROWS.map((row) => (
            <tr key={row.role}>
              <td>
                <span
                  className={`kc-chip ${
                    row.role === "Admin" ? "kc-chip--accent" : "kc-chip--sage"
                  }`}
                >
                  {row.role}
                </span>
              </td>
              <td>{row.scopes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeesView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [admins, setAdmins] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/employees", { cache: "no-store" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as {
        employees: Employee[];
        admins?: AdminMember[];
      };
      setEmployees(j.employees);
      setAdmins(j.admins ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load employees");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  if (loading) {
    return (
      <div className="kc-panel flex items-center gap-2 p-5 text-sm text-[var(--kc-muted)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--kc-accent)]" />
        Loading employees…
      </div>
    );
  }

  if (err) {
    return <div className="kc-note kc-note--danger">Error: {err}</div>;
  }

  return (
    <div className="space-y-6">
      <ConnectedIntegrations />

      <div
        className="kc-panel kc-rise overflow-hidden"
        style={{ "--kc-delay": "0.12s" } as React.CSSProperties}
      >
        <div className="kc-panel-head">
          <div className="flex items-center gap-2">
            <Lock
              className="h-4 w-4 text-[var(--kc-muted)]"
              strokeWidth={1.8}
            />
            <h3 className="kc-panel-title">Admins</h3>
          </div>
        </div>
        <p className="px-4 pt-3 text-xs text-[var(--kc-muted)]">
          Admins have full access to every MCP server and cannot be edited.
        </p>
        <table className="kc-table mt-1">
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.id}>
                <td>
                  <div className="font-semibold text-[var(--kc-ink)]">
                    {admin.name}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--kc-muted)]">
                    {admin.email} · {admin.departmentName}
                  </div>
                </td>
                <td>
                  <div className="flex justify-end">
                    <span className="kc-chip kc-chip--muted">
                      <Lock className="h-3 w-3" strokeWidth={2} />
                      Full access
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="kc-rise"
        style={{ "--kc-delay": "0.16s" } as React.CSSProperties}
      >
        <h3 className="kc-display text-[1.05rem]">
          Employees — MCP server access
        </h3>
        <p className="mb-3 mt-1 text-xs text-[var(--kc-muted)]">
          Toggle which connected MCP server groups each employee can use on the
          chat dashboard. Changes save immediately.
        </p>
        {employees.length === 0 ? (
          <p className="text-sm text-[var(--kc-muted)]">
            No employees in this tenant yet. Use &quot;Send invite&quot; in the
            profile menu to add teammates.
          </p>
        ) : (
          <div className="space-y-3">
            {employees.map((emp) => (
              <EmployeeAccessRow key={emp.id} employee={emp} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Which MCP servers are currently signed in (connected) for this admin. */
function ConnectedIntegrations() {
  const [qbo, setQbo] = useState<{
    connected: boolean;
    realmId?: string;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/integrations/quickbooks/status", {
          cache: "no-store",
        });
        if (r.ok) {
          setQbo((await r.json()) as { connected: boolean; realmId?: string });
        }
      } catch {
        // Status strip is informational only.
      }
    };
    void load();
  }, []);

  return (
    <div className="kc-panel kc-rise p-5">
      <div className="mb-3 flex items-center gap-2">
        <Plug className="h-4 w-4 text-[var(--kc-muted)]" strokeWidth={1.8} />
        <h3 className="kc-panel-title">Signed-in MCP servers</h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`kc-chip ${
            qbo?.connected ? "kc-chip--sage" : "kc-chip--muted"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              qbo?.connected
                ? "bg-[var(--kc-sage)]"
                : "bg-[rgba(31,41,36,0.28)]"
            }`}
          />
          QuickBooks
          {qbo?.connected
            ? ` · connected${qbo.realmId ? ` (realm ${qbo.realmId})` : ""}`
            : " · not connected"}
        </span>
        {!qbo?.connected && (
          <Link
            href="/app/integrations"
            className="text-xs font-semibold text-[var(--kc-accent)] hover:underline"
          >
            Connect on the Integrations page →
          </Link>
        )}
      </div>
      <p className="mt-3 text-[11px] text-[var(--kc-muted)]">
        Connections are signed in per user. The toggles below control which
        employees may use each MCP server group.
      </p>
    </div>
  );
}

function EmployeeAccessRow({ employee }: { employee: Employee }) {
  const [domains, setDomains] = useState<DomainState[]>(employee.domains);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async (domainId: ChatDomain, nextAllowed: boolean) => {
    if (saving) return;
    const previous = domains;
    const next = domains.map((d) =>
      d.id === domainId ? { ...d, allowed: nextAllowed } : d,
    );
    setDomains(next);
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/admin/employees/${employee.id}/mcp-domains`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            allowedDomainIds: next.filter((d) => d.allowed).map((d) => d.id),
          }),
        },
      );
      const j = (await r.json().catch(() => ({}))) as {
        domains?: DomainState[];
        error?: string;
      };
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      if (j.domains) setDomains(j.domains);
      setSavedAt(Date.now());
    } catch (e) {
      setDomains(previous);
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const allowedCount = domains.filter((d) => d.allowed).length;

  return (
    <div className="kc-panel p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--kc-ink)]">
            {employee.name}
          </div>
          <div className="truncate text-xs text-[var(--kc-muted)]">
            {employee.email} · {employee.departmentName}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 text-xs">
          <span className="text-[var(--kc-muted)]">
            {allowedCount} of {domains.length} enabled
          </span>
          {saving && (
            <span className="inline-flex items-center gap-1 text-[var(--kc-muted)]">
              <Loader2 className="h-3 w-3 animate-spin text-[var(--kc-accent)]" />
              Saving…
            </span>
          )}
          {!saving && savedAt && !err && (
            <span className="inline-flex items-center gap-1 text-[var(--kc-sage)]">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
              Saved
            </span>
          )}
        </div>
      </div>

      <ul className="space-y-2">
        {domains.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-4 rounded-[14px] border border-[var(--kc-line)] bg-[rgba(255,255,255,0.55)] px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--kc-ink)]">
                {d.label}
              </div>
              <div className="kc-mono text-[11px] text-[var(--kc-muted)]">
                Servers: {d.servers.join(", ")}
              </div>
            </div>
            <Toggle
              checked={d.allowed}
              onChange={(next) => toggle(d.id, next)}
              disabled={saving}
            />
          </li>
        ))}
      </ul>

      {err && <div className="kc-note kc-note--danger mt-3">{err}</div>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--kc-accent)] focus:ring-offset-2 focus:ring-offset-[var(--kc-bg)] ${
        checked ? "bg-[var(--kc-accent)]" : "bg-[rgba(31,41,36,0.16)]"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
