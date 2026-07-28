"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";

interface ConnectionStatus {
  connected: boolean;
  realmId?: string;
  connectedAt?: string;
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="kc-container flex min-h-[50vh] items-center justify-center py-8">
          <Loader2
            className="h-8 w-8 animate-spin text-[var(--kc-accent)]"
            strokeWidth={1.8}
          />
        </div>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}

function IntegrationsContent() {
  const searchParams = useSearchParams();
  const [qboStatus, setQboStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchQboStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/quickbooks/status", {
        cache: "no-store",
      });
      if (res.ok) {
        setQboStatus(await res.json());
      } else {
        setQboStatus({ connected: false });
      }
    } catch {
      setQboStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQboStatus();
  }, [fetchQboStatus]);

  // Handle OAuth callback redirect params.
  useEffect(() => {
    const qboParam = searchParams.get("quickbooks");
    if (qboParam === "connected") {
      setToast({ type: "success", message: "QuickBooks connected successfully." });
      fetchQboStatus();
    } else if (qboParam?.startsWith("error:")) {
      setToast({
        type: "error",
        message: `QuickBooks connection failed: ${qboParam.slice(6)}`,
      });
    }
  }, [searchParams, fetchQboStatus]);

  // Auto-dismiss toast after 5 seconds.
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/quickbooks/status", {
        method: "DELETE",
      });
      if (res.ok) {
        setQboStatus({ connected: false });
        setToast({ type: "success", message: "QuickBooks disconnected." });
      } else {
        setToast({ type: "error", message: "Failed to disconnect QuickBooks." });
      }
    } catch {
      setToast({ type: "error", message: "Failed to disconnect QuickBooks." });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="kc-container py-8">
      <Link
        href="/app"
        className="kc-mono mb-5 inline-flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-[var(--kc-muted)] transition-colors hover:text-[var(--kc-accent)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        Back to workspace
      </Link>

      <PageHeader
        eyebrow="Connected systems"
        title="Integrations"
        description="Connect external services to power MCP tools. Tokens are encrypted at rest and scoped to your department."
      />

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`mb-6 ${
            toast.type === "success"
              ? "kc-toast kc-toast--sage"
              : "kc-toast kc-toast--danger"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2
              className="h-5 w-5 flex-shrink-0 text-[var(--kc-sage)]"
              strokeWidth={1.8}
              aria-hidden
            />
          ) : (
            <AlertCircle
              className="h-5 w-5 flex-shrink-0 text-[#8f2f1c]"
              strokeWidth={1.8}
              aria-hidden
            />
          )}
          {toast.message}
        </div>
      )}

      <div className="space-y-4">
        {/* QuickBooks Card */}
        <section
          className="kc-panel kc-rise p-5 sm:p-6"
          style={{ "--kc-delay": "0.06s" } as React.CSSProperties}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <h2 className="kc-display text-lg text-[var(--kc-ink)]">
                  QuickBooks Online
                </h2>
                {loading ? (
                  <Loader2
                    className="h-4 w-4 animate-spin text-[var(--kc-accent)]"
                    strokeWidth={1.8}
                    aria-hidden
                  />
                ) : qboStatus?.connected ? (
                  <span className="kc-chip kc-chip--sage">
                    <CheckCircle2 className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                    Connected
                  </span>
                ) : (
                  <span className="kc-chip kc-chip--muted">
                    <XCircle className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                    Not connected
                  </span>
                )}
              </div>
              <p className="mb-3 text-sm text-[var(--kc-muted)]">
                Sync invoices, query customers, and manage accounting data
                through the QuickBooks Online API.
              </p>
              {qboStatus?.connected && qboStatus.realmId && (
                <p className="mb-3 text-xs text-[var(--kc-muted)]">
                  Company realm ID:{" "}
                  <code className="kc-code">{qboStatus.realmId}</code>
                  {qboStatus.connectedAt && (
                    <>
                      {" "}
                      · Connected{" "}
                      {new Date(qboStatus.connectedAt).toLocaleDateString()}
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!loading && !qboStatus?.connected && (
              <a
                href="/api/integrations/quickbooks/start"
                className="kc-btn kc-btn-primary kc-btn--sm"
              >
                <Plug className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                Connect QuickBooks
              </a>
            )}
            {!loading && qboStatus?.connected && (
              <>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="kc-btn kc-btn-danger kc-btn--sm"
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                  )}
                  Disconnect
                </button>
                <button
                  onClick={fetchQboStatus}
                  className="kc-btn kc-btn-secondary kc-btn--sm"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                  Refresh
                </button>
              </>
            )}
          </div>
        </section>

        {/* Google Calendar Card (existing integration) */}
        <section
          className="kc-panel kc-rise p-5 sm:p-6"
          style={{ "--kc-delay": "0.12s" } as React.CSSProperties}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <h2 className="kc-display text-lg text-[var(--kc-ink)]">
                  Google Calendar
                </h2>
                <span className="kc-chip kc-chip--muted">
                  Manage via Assistant
                </span>
              </div>
              <p className="mb-3 text-sm text-[var(--kc-muted)]">
                Connect Google Calendar to let the agent read and create
                calendar events.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <a
              href="/api/integrations/google/start"
              className="kc-btn kc-btn-primary kc-btn--sm"
            >
              <Plug className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Connect Google Calendar
            </a>
          </div>
        </section>
      </div>

      {/* MCP Tools Info */}
      <section
        className="kc-panel kc-rise mt-8 p-5"
        style={{ "--kc-delay": "0.18s" } as React.CSSProperties}
      >
        <h3 className="kc-display mb-3 text-sm text-[var(--kc-ink)]">
          Available MCP tools after connecting QuickBooks
        </h3>
        <ul className="space-y-2 text-xs text-[var(--kc-muted)]">
          <li>
            <code className="kc-code">quickbooks.query</code>{" "}
            — Run QBO queries (SQL-like)
          </li>
          <li>
            <code className="kc-code">quickbooks.get_invoice</code>{" "}
            — Fetch invoice by ID
          </li>
          <li>
            <code className="kc-code">quickbooks.create_invoice</code>{" "}
            — Create a new invoice
          </li>
          <li>
            <code className="kc-code">quickbooks.sync_invoice</code>{" "}
            — Upsert invoice by DocNumber
          </li>
          <li>
            <code className="kc-code">quickbooks.list_customers</code>{" "}
            — List/filter customers
          </li>
          <li>
            <code className="kc-code">quickbooks.get_connection_status</code>{" "}
            — Check connection
          </li>
        </ul>
      </section>
    </div>
  );
}
