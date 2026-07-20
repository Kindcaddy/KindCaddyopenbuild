"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowLeft, AlertTriangle, CheckCircle2, Eye, RefreshCw } from "lucide-react";

type ErrorReportRow = {
  id: string;
  createdAt: string;
  requestId: string;
  route: string;
  userId: string | null;
  tenantId: string | null;
  code: string;
  message: string;
  stack: string | null;
  context: unknown;
  severity: "warning" | "error" | "fatal";
  status: "open" | "acknowledged" | "resolved";
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
};

type StatusFilter = "all" | "open" | "acknowledged" | "resolved";

const SEVERITY_STYLES: Record<string, string> = {
  warning: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300",
  error: "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300",
  fatal: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-300",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300",
  acknowledged: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300",
  resolved: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300",
};

export default function AdminErrorsPage() {
  const [rows, setRows] = useState<ErrorReportRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/admin/errors${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setRows(data.errors);
      setCounts(data.counts ?? {});
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load error reports");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function triage(id: string, action: "acknowledge" | "resolve") {
    const res = await fetch(`/api/admin/errors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "resolve" ? { action, resolution: resolutionDraft } : { action },
      ),
    });
    if (res.ok) {
      setResolutionDraft("");
      setExpandedId(null);
      void load();
    } else {
      const body = await res.json().catch(() => ({}));
      setLoadError(body.message ?? body.error ?? "Triage action failed");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Sparkles className="h-8 w-8 text-blue-600" />
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                KindCaddy Admin
              </span>
            </div>
            <Link
              href="/admin"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Error Reports
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Every unexpected failure, persisted until someone resolves it.
              {" "}
              {counts.open ?? 0} open · {counts.acknowledged ?? 0} acknowledged ·{" "}
              {counts.resolved ?? 0} resolved
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
        </div>

        <div className="flex items-center space-x-2 mb-6">
          {(["open", "acknowledged", "resolved", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loadError && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300">
            {loadError}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
              No {statusFilter === "all" ? "" : statusFilter + " "}error reports.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {["When", "Code", "Route", "Message", "Severity", "Status", ""].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((row) => (
                    <ErrorRow
                      key={row.id}
                      row={row}
                      expanded={expandedId === row.id}
                      onToggle={() =>
                        setExpandedId(expandedId === row.id ? null : row.id)
                      }
                      resolutionDraft={resolutionDraft}
                      setResolutionDraft={setResolutionDraft}
                      onTriage={triage}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorRow({
  row,
  expanded,
  onToggle,
  resolutionDraft,
  setResolutionDraft,
  onTriage,
}: {
  row: ErrorReportRow;
  expanded: boolean;
  onToggle: () => void;
  resolutionDraft: string;
  setResolutionDraft: (v: string) => void;
  onTriage: (id: string, action: "acknowledge" | "resolve") => void;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
          {new Date(row.createdAt).toLocaleString()}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">
          {row.code}
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
          {row.route}
        </td>
        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-md truncate">
          {row.message}
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${SEVERITY_STYLES[row.severity] ?? ""}`}>
            {row.severity}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[row.status] ?? ""}`}>
            {row.status}
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={onToggle}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            title="View details"
          >
            <Eye className="h-4 w-4" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-900/40">
          <td colSpan={7} className="px-6 py-4">
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-gray-600 dark:text-gray-400">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Request ID:</span>{" "}
                  <span className="font-mono">{row.requestId}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">User:</span>{" "}
                  {row.userId ?? "—"}
                </div>
              </div>
              {row.context != null && Object.keys(row.context as object).length > 0 && (
                <pre className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto text-xs text-gray-800 dark:text-gray-300">
                  {JSON.stringify(row.context, null, 2)}
                </pre>
              )}
              {row.stack && (
                <pre className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto text-xs text-gray-800 dark:text-gray-300 max-h-64">
                  {row.stack}
                </pre>
              )}
              {row.status === "resolved" ? (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-800 dark:text-green-300">
                  Resolved {row.resolvedAt ? new Date(row.resolvedAt).toLocaleString() : ""}:{" "}
                  {row.resolution}
                </div>
              ) : (
                <div className="flex items-start space-x-3">
                  <input
                    type="text"
                    value={resolutionDraft}
                    onChange={(e) => setResolutionDraft(e.target.value)}
                    placeholder="Resolution note (required to resolve)…"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {row.status === "open" && (
                    <button
                      onClick={() => onTriage(row.id, "acknowledge")}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => onTriage(row.id, "resolve")}
                    disabled={!resolutionDraft.trim()}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"
                  >
                    Resolve
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
