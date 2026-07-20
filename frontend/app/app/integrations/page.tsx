"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Sparkles,
  Home,
  ArrowLeft,
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import UserProfileDropdown from "@/components/UserProfileDropdown";

interface ConnectionStatus {
  connected: boolean;
  realmId?: string;
  connectedAt?: string;
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Sparkles className="h-8 w-8 text-blue-600" />
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                KindCaddy
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/app"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                title="Home"
              >
                <Home className="h-5 w-5" />
              </Link>
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/app"
          className="inline-flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex items-center gap-3 mb-2">
            <Plug className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Integrations
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            Connect external services to power MCP tools. Tokens are encrypted at
            rest and scoped to your department.
          </p>

          {/* Toast */}
          {toast && (
            <div
              className={`mb-6 flex items-center gap-2 rounded-lg p-4 text-sm ${
                toast.type === "success"
                  ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                  : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300"
              }`}
            >
              {toast.type === "success" ? (
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
              )}
              {toast.message}
            </div>
          )}

          {/* QuickBooks Card */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    QuickBooks Online
                  </h2>
                  {loading ? (
                    <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
                  ) : qboStatus?.connected ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40 rounded-full px-2 py-0.5">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-0.5">
                      <XCircle className="h-3 w-3" />
                      Not connected
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Sync invoices, query customers, and manage accounting data
                  through the QuickBooks Online API.
                </p>
                {qboStatus?.connected && qboStatus.realmId && (
                  <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                    Company realm ID:{" "}
                    <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      {qboStatus.realmId}
                    </code>
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

            <div className="flex items-center gap-3 mt-4">
              {!loading && !qboStatus?.connected && (
                <a
                  href="/api/integrations/quickbooks/start"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                >
                  <Plug className="h-4 w-4" />
                  Connect QuickBooks
                </a>
              )}
              {!loading && qboStatus?.connected && (
                <>
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {disconnecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Disconnect
                  </button>
                  <button
                    onClick={fetchQboStatus}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Google Calendar Card (existing integration) */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Google Calendar
                  </h2>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-0.5">
                    Manage via Assistant
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Connect Google Calendar to let the agent read and create
                  calendar events.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <a
                href="/api/integrations/google/start"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                <Plug className="h-4 w-4" />
                Connect Google Calendar
              </a>
            </div>
          </div>

          {/* MCP Tools Info */}
          <div className="mt-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">
              Available MCP tools after connecting QuickBooks
            </h3>
            <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
              <li>
                <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                  quickbooks.query
                </code>{" "}
                — Run QBO queries (SQL-like)
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                  quickbooks.get_invoice
                </code>{" "}
                — Fetch invoice by ID
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                  quickbooks.create_invoice
                </code>{" "}
                — Create a new invoice
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                  quickbooks.sync_invoice
                </code>{" "}
                — Upsert invoice by DocNumber
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                  quickbooks.list_customers
                </code>{" "}
                — List/filter customers
              </li>
              <li>
                <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                  quickbooks.get_connection_status
                </code>{" "}
                — Check connection
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
