"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/AppShell";

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
  warning: "kc-chip--accent",
  error: "kc-chip--danger",
  fatal: "kc-chip--danger uppercase tracking-[0.1em]",
};

const STATUS_STYLES: Record<string, string> = {
  open: "kc-chip--danger",
  acknowledged: "kc-chip--accent",
  resolved: "kc-chip--sage",
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
    <div className="kc-container py-8">
      <PageHeader
        eyebrow="Admin"
        title="Error Reports"
        description={`Every unexpected failure, persisted until someone resolves it. ${
          counts.open ?? 0
        } open · ${counts.acknowledged ?? 0} acknowledged · ${
          counts.resolved ?? 0
        } resolved`}
        actions={
          <button
            onClick={() => void load()}
            className="kc-btn kc-btn-secondary kc-btn--sm"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            Refresh
          </button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["open", "acknowledged", "resolved", "all"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
            className={`kc-btn kc-btn--sm ${
              statusFilter === s ? "kc-btn-primary" : "kc-btn-secondary"
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="kc-note kc-note--danger mb-6">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 flex-none"
            strokeWidth={1.8}
            aria-hidden
          />
          <span>{loadError}</span>
        </div>
      )}

      <div className="kc-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[var(--kc-muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-[var(--kc-muted)]">
            <CheckCircle2
              className="mx-auto mb-2 h-8 w-8 text-[var(--kc-sage)]"
              strokeWidth={1.6}
              aria-hidden
            />
            No {statusFilter === "all" ? "" : statusFilter + " "}error reports.
          </div>
        ) : (
          <div className="kc-scroll overflow-x-auto">
            <table className="kc-table">
              <thead>
                <tr>
                  {["When", "Code", "Route", "Message", "Severity", "Status", ""].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
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
      <tr>
        <td className="whitespace-nowrap">
          {new Date(row.createdAt).toLocaleString()}
        </td>
        <td className="kc-mono text-[0.78rem]">{row.code}</td>
        <td className="whitespace-nowrap">{row.route}</td>
        <td className="max-w-md truncate">{row.message}</td>
        <td>
          <span className={`kc-chip ${SEVERITY_STYLES[row.severity] ?? ""}`}>
            {row.severity}
          </span>
        </td>
        <td>
          <span className={`kc-chip ${STATUS_STYLES[row.status] ?? ""}`}>
            {row.status}
          </span>
        </td>
        <td className="text-right">
          <button
            onClick={onToggle}
            className="rounded-lg p-1.5 text-[var(--kc-muted)] transition-colors hover:bg-white/60 hover:text-[var(--kc-ink)]"
            title="View details"
            aria-expanded={expanded}
          >
            <Eye className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-white/45">
          <td colSpan={7}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-[var(--kc-muted)]">
                <div>
                  <span className="font-medium text-[var(--kc-ink)]">Request ID:</span>{" "}
                  <span className="kc-mono">{row.requestId}</span>
                </div>
                <div>
                  <span className="font-medium text-[var(--kc-ink)]">User:</span>{" "}
                  {row.userId ?? "—"}
                </div>
              </div>
              {row.context != null && Object.keys(row.context as object).length > 0 && (
                <pre className="kc-pre kc-scroll">
                  {JSON.stringify(row.context, null, 2)}
                </pre>
              )}
              {row.stack && (
                <pre className="kc-pre kc-scroll max-h-64 overflow-y-auto">
                  {row.stack}
                </pre>
              )}
              {row.status === "resolved" ? (
                <div className="kc-note kc-note--sage">
                  Resolved {row.resolvedAt ? new Date(row.resolvedAt).toLocaleString() : ""}:{" "}
                  {row.resolution}
                </div>
              ) : (
                <div className="flex flex-wrap items-start gap-2">
                  <input
                    type="text"
                    value={resolutionDraft}
                    onChange={(e) => setResolutionDraft(e.target.value)}
                    placeholder="Resolution note (required to resolve)…"
                    className="kc-input kc-input--sm flex-1"
                  />
                  {row.status === "open" && (
                    <button
                      onClick={() => onTriage(row.id, "acknowledge")}
                      className="kc-btn kc-btn-secondary kc-btn--sm"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => onTriage(row.id, "resolve")}
                    disabled={!resolutionDraft.trim()}
                    className="kc-btn kc-btn-primary kc-btn--sm"
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
