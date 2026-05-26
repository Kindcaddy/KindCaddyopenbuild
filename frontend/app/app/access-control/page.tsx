"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Home,
  Loader2,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import UserProfileDropdown from "@/components/UserProfileDropdown";
import type { ChatDomain } from "@/lib/mcp/domain-catalog";

interface UserMe {
  role: string;
}

interface Employee {
  id: string;
  email: string;
  name: string;
  departmentName: string;
  role: string;
}

interface DomainState {
  id: ChatDomain;
  label: string;
  description: string;
  servers: string[];
  allowed: boolean;
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
    return <div className="min-h-screen bg-gray-50 dark:bg-gray-900" />;
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
          <Shield className="h-10 w-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Admin access required
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            This page is only available to admin accounts.
          </p>
          <Link
            href="/app"
            className="inline-flex mt-5 items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            Back to landing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Sparkles className="h-8 w-8 text-blue-600" />
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                KindCaddy
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/app"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                <Home className="h-5 w-5" />
              </Link>
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/app"
          className="inline-flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6 sm:p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Access Control
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Manage role-based access and per-employee MCP server permissions.
          </p>

          <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 mb-6">
            <TabButton active={tab === "roles"} onClick={() => setTab("roles")}>
              <Shield className="h-4 w-4" />
              Roles
            </TabButton>
            <TabButton
              active={tab === "employees"}
              onClick={() => setTab("employees")}
            >
              <Users className="h-4 w-4" />
              Employees
            </TabButton>
          </div>

          {tab === "roles" ? <RolesView /> : <EmployeesView />}
        </div>
      </div>
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
      className={`flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-blue-600 text-blue-600 dark:text-blue-400"
          : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function RolesView() {
  return (
    <div className="space-y-3">
      {ROLE_ROWS.map((row) => (
        <div
          key={row.role}
          className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3"
        >
          <div className="font-medium text-gray-900 dark:text-white">
            {row.role}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {row.scopes}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmployeesView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
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
      const j = (await r.json()) as { employees: Employee[] };
      setEmployees(j.employees);
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
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading employees…
      </div>
    );
  }

  if (err) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400">Error: {err}</div>
    );
  }

  if (selected) {
    return (
      <EmployeeMcpEditor
        employee={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (employees.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        No employees in this tenant yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Select an employee to manage which MCP servers they can access on the
        chat dashboard.
      </p>
      <ul className="divide-y divide-gray-200 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {employees.map((emp) => (
          <li key={emp.id}>
            <button
              onClick={() => setSelected(emp)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
            >
              <div>
                <div className="font-medium text-gray-900 dark:text-white">
                  {emp.name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {emp.email} · {emp.departmentName}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmployeeMcpEditor({
  employee,
  onBack,
}: {
  employee: Employee;
  onBack: () => void;
}) {
  const [domains, setDomains] = useState<DomainState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/admin/employees/${employee.id}/mcp-domains`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { domains: DomainState[] };
      setDomains(j.domains);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load access");
    } finally {
      setLoading(false);
    }
  }, [employee.id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (domainId: ChatDomain, nextAllowed: boolean) => {
    if (saving) return;
    const nextAllowedIds = domains
      .filter((d) => (d.id === domainId ? nextAllowed : d.allowed))
      .map((d) => d.id);

    setSaving(true);
    setErr(null);
    setDomains((prev) =>
      prev.map((d) =>
        d.id === domainId ? { ...d, allowed: nextAllowed } : d,
      ),
    );
    try {
      const r = await fetch(
        `/api/admin/employees/${employee.id}/mcp-domains`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowedDomainIds: nextAllowedIds }),
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
      setErr(e instanceof Error ? e.message : "Failed to save");
      load();
    } finally {
      setSaving(false);
    }
  };

  const allowedCount = useMemo(
    () => domains.filter((d) => d.allowed).length,
    [domains],
  );

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to employees
      </button>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50/50 dark:bg-gray-900/30">
        <div className="font-medium text-gray-900 dark:text-white">
          {employee.name}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {employee.email} · {employee.departmentName}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            MCP server access
          </h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              {allowedCount} of {domains.length} enabled
            </span>
            {saving && (
              <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </span>
            )}
            {!saving && savedAt && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Saved
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Toggle which MCP server groups this employee can use. Disabled
          servers will appear grayed out on their chat dashboard.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <ul className="space-y-2">
            {domains.map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {d.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {d.description}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
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
        )}

        {err && (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            {err}
          </div>
        )}
      </div>
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
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
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
