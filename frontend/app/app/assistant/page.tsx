"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Database,
  FileUp,
  FileText,
  Layers,
  Loader2,
  MessageSquarePlus,
  Send,
  Server,
  Square,
  Sparkles,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import UserProfileDropdown from "@/components/UserProfileDropdown";
import type { ChatDomain } from "@/lib/mcp/domain-catalog";

type AgentId = "kindcaddy";
type MemoryMode = "smart" | "explicit" | "off";

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface ToolInvocation {
  id: string;
  server: string;
  tool: string;
  status: string;
  latencyMs: number;
  params: unknown;
  result: unknown;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  agent: string | null;
  content: string;
  metadata: {
    agent?: string;
    llm?: string;
    trace?: Array<{
      type: "llm" | "tool";
      label: string;
      summary: string;
      durationMs: number;
    }>;
  };
  createdAt: string;
  invocations: ToolInvocation[];
}

interface ServerInfo {
  id: string;
  name: string;
  description: string;
  allowed: boolean;
  tools: Array<{ name: string; description: string; capability: string }>;
}

interface DomainInfo {
  id: ChatDomain;
  label: string;
  description: string;
  servers: string[];
  active: boolean;
}

const SERVER_ICONS: Record<string, JSX.Element> = {
  sqlite: <Database className="h-4 w-4" />,
  files: <FileText className="h-4 w-4" />,
  netsuite: <Server className="h-4 w-4" />,
  quickbooks: <Zap className="h-4 w-4" />,
  square: <Square className="h-4 w-4" />,
  calendar: <Bot className="h-4 w-4" />,
};

const EXAMPLES: Record<ChatDomain, string[]> = {
  finance: [
    "List all synced invoices in QuickBooks",
    "Create a new invoice sync for INV-2201, customer ACME, amount 1300",
    "Summarize finance activity from recent sync operations",
  ],
  customer: [
    "List all customers from Square",
    "Find customer information for jordan@example.com",
    "Who is the highest lifetime value customer?",
  ],
  agent: [
    "Summarize what tools are available and when you would use each one",
    "Find the relevant business system for invoice sync work",
    "Use the right available tools to summarize current customer and finance context",
  ],
};

interface StreamStatusEvent {
  kind: "thinking" | "tool_start" | "tool_result" | "composing";
  tool?: string;
  ok?: boolean;
  summary?: string;
}

function statusLabel(e: StreamStatusEvent): string {
  switch (e.kind) {
    case "thinking":
      return "Thinking…";
    case "tool_start":
      return `Using ${e.tool}…`;
    case "tool_result":
      return e.ok ? `Finished ${e.tool}` : `${e.tool} did not succeed`;
    case "composing":
      return "Composing reply…";
  }
}

/** Minimal SSE reader over fetch — keeps us off EventSource (POST body). */
async function readSse(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) {
        try {
          onEvent(event, JSON.parse(data));
        } catch {
          // Malformed frame; skip it rather than killing the stream.
        }
      }
    }
  }
}

const draftKey = (sessionId: string | null) => `kc_draft_${sessionId ?? "new"}`;

export default function AssistantPage() {
  const [roleView, setRoleView] = useState<"admin" | "employee">("employee");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [agent] = useState<AgentId>("kindcaddy");
  const [memoryMode, setMemoryMode] = useState<MemoryMode>("smart");
  const [domain, setDomain] = useState<ChatDomain>("finance");
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [domainMenuOpen, setDomainMenuOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadSessions = useCallback(async () => {
    const r = await fetch("/api/mcp/sessions", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { sessions: SessionSummary[] };
    setSessions(j.sessions);
  }, []);

  const loadTools = useCallback(async () => {
    const r = await fetch("/api/mcp/tools", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { servers: ServerInfo[] };
    setServers(j.servers);
  }, []);

  const loadDomains = useCallback(async () => {
    const r = await fetch("/api/mcp/domains", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { domains: DomainInfo[] };
    setDomains(j.domains);
    const active = j.domains.filter((d) => d.active);
    if (active.length > 0 && !active.some((d) => d.id === domain)) {
      setDomain(active[0].id);
    }
  }, [domain]);

  const loadMessages = useCallback(async (id: string) => {
    const r = await fetch(`/api/mcp/sessions/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { messages: ChatMessage[] };
    setMessages(j.messages);
  }, []);

  const loadMemoryMode = useCallback(async () => {
    const r = await fetch("/api/memory/mode", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { mode: MemoryMode };
    setMemoryMode(j.mode);
  }, []);

  const changeMemoryMode = useCallback(async (next: MemoryMode) => {
    setMemoryMode(next);
    await fetch("/api/memory/mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRoleView(params.get("role") === "admin" ? "admin" : "employee");
  }, []);

  useEffect(() => {
    loadSessions();
    loadTools();
    loadDomains();
    loadMemoryMode();
  }, [loadSessions, loadTools, loadDomains, loadMemoryMode]);

  useEffect(() => {
    if (currentId) loadMessages(currentId);
  }, [currentId, loadMessages]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  // Session resilience (Phase 5.3): the draft survives reloads and network
  // failures; it is only cleared on a successful send.
  useEffect(() => {
    const saved = window.localStorage.getItem(draftKey(currentId));
    if (saved) setInput(saved);
  }, [currentId]);

  useEffect(() => {
    if (input) window.localStorage.setItem(draftKey(currentId), input);
    else window.localStorage.removeItem(draftKey(currentId));
  }, [input, currentId]);

  const finishTurn = useCallback(
    async (sessionId: string) => {
      setCurrentId(sessionId);
      window.localStorage.removeItem(draftKey(currentId));
      window.localStorage.removeItem(draftKey(sessionId));
      setLastFailedMessage(null);
      await Promise.all([loadMessages(sessionId), loadSessions()]);
    },
    [currentId, loadMessages, loadSessions],
  );

  const send = async (text: string, opts: { isRetry?: boolean } = {}) => {
    const message = text.trim();
    if (!message || loading) return;
    if (!selectedDomain) {
      setErr("No MCP domains are available. Ask an admin to grant access.");
      return;
    }
    if (!selectedDomain.active) {
      setErr(
        `The "${selectedDomain.label}" domain is disabled for your account. Ask an admin to enable it.`,
      );
      return;
    }
    setInput("");
    setLoading(true);
    setErr(null);
    setBanner(null);
    setRetryCountdown(null);
    setStatusText("Sending…");

    // Optimistic user bubble.
    const optimisticId = `tmp_${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      role: "user",
      agent: null,
      content: message,
      metadata: {},
      createdAt: new Date().toISOString(),
      invocations: [],
    };
    setMessages((m) => [...m, optimistic]);
    const removeOptimistic = () =>
      setMessages((m) => m.filter((msg) => msg.id !== optimisticId));

    const payload = JSON.stringify({
      sessionId: currentId ?? undefined,
      message: withAttachmentContext(message, files),
      agent,
      domain: selectedDomain.id,
      stream: true,
    });

    const failTurn = (errorText: string) => {
      removeOptimistic();
      setErr(errorText);
      setLastFailedMessage(message);
    };

    try {
      let r: Response;
      try {
        r = await fetch("/api/mcp/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: payload,
        });
      } catch {
        // Stream failed to open (network hiccup): fall back to plain JSON.
        r = await fetch("/api/mcp/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload.replace('"stream":true', '"stream":false'),
        });
      }

      if (r.status === 429) {
        const j = (await r.json().catch(() => ({}))) as {
          error?: string;
          retryAfterSec?: number;
        };
        const wait = Math.min(Math.max(j.retryAfterSec ?? 5, 1), 60);
        removeOptimistic();
        if (!opts.isRetry) {
          // Graceful rate-limit feedback (Phase 5.2): countdown + one
          // automatic retry instead of a raw error.
          setInput(message);
          setRetryCountdown(wait);
          let remaining = wait;
          const timer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
              clearInterval(timer);
              setRetryCountdown(null);
              void send(message, { isRetry: true });
            } else {
              setRetryCountdown(remaining);
            }
          }, 1000);
        } else {
          failTurn(
            j.error === "busy"
              ? "The assistant is at capacity right now. Please try again in a moment."
              : "You're sending messages quickly. Please wait a moment and try again.",
          );
        }
        return;
      }

      if (r.status === 503) {
        removeOptimistic();
        setBanner(
          "The assistant is temporarily unavailable. Your message wasn't lost — try sending it again in a moment.",
        );
        setInput(message);
        setLastFailedMessage(message);
        return;
      }

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        failTurn((j as { error?: string }).error ?? `HTTP ${r.status}`);
        return;
      }

      const contentType = r.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        let finished = false;
        await readSse(r, (event, data) => {
          if (event === "status") {
            setStatusText(statusLabel(data as StreamStatusEvent));
          } else if (event === "done") {
            finished = true;
            const j = data as { sessionId: string };
            void finishTurn(j.sessionId);
          } else if (event === "error") {
            finished = true;
            const j = data as { code?: string; requestId?: string };
            if (j.code === "assistant_unavailable") {
              removeOptimistic();
              setBanner(
                "The assistant is temporarily unavailable. Try again in a moment.",
              );
              setInput(message);
              setLastFailedMessage(message);
            } else {
              failTurn(
                `Something went wrong${j.requestId ? ` (reference: ${j.requestId})` : ""}. Please try again.`,
              );
            }
          }
        });
        if (!finished) {
          // The stream closed without done/error — treat as a failed turn.
          failTurn("The connection dropped mid-reply. Please retry.");
        }
      } else {
        const j = (await r.json()) as { sessionId: string };
        await finishTurn(j.sessionId);
      }
    } catch (e) {
      failTurn(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setLoading(false);
      setStatusText(null);
      setFiles([]);
    }
  };

  const newSession = async () => {
    const r = await fetch("/api/mcp/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { session: SessionSummary };
    setCurrentId(j.session.id);
    setMessages([]);
    loadSessions();
  };

  const activeDomains = useMemo(
    () => domains.filter((d) => d.active),
    [domains],
  );
  const selectedDomain = useMemo(
    () => domains.find((d) => d.id === domain) ?? activeDomains[0],
    [activeDomains, domains, domain],
  );
  const isSelectedDomainActive = Boolean(selectedDomain?.active);
  // Servers belonging to the currently selected domain. We keep disallowed
  // ones in the list so they render grayed-out, mirroring the chat dashboard
  // requirement.
  const filteredServers = useMemo(
    () =>
      selectedDomain
        ? servers.filter((s) => selectedDomain.servers.includes(s.id))
        : [],
    [selectedDomain, servers],
  );
  const allowedServerCount = useMemo(
    () => filteredServers.filter((s) => s.allowed).length,
    [filteredServers],
  );
  const totalTools = useMemo(
    () =>
      filteredServers
        .filter((s) => s.allowed)
        .reduce((n, s) => n + s.tools.length, 0),
    [filteredServers],
  );

  const onFilesSelected = (nextFiles: FileList | null) => {
    if (!nextFiles) return;
    setFiles((prev) => [...prev, ...Array.from(nextFiles)]);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link href="/app" className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-blue-600" />
              <span className="font-semibold text-gray-900 dark:text-white">
                KindCaddy · Assistant
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 capitalize">
                {roleView} view
              </span>
              <span className="flex items-center gap-1">
                <Server className="h-3.5 w-3.5" />
                {allowedServerCount} of {filteredServers.length} MCP servers
              </span>
              <span className="flex items-center gap-1">
                <Wrench className="h-3.5 w-3.5" />
                {totalTools} tools
              </span>
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-12 gap-4">
        {/* LEFT: sessions */}
        <aside className="col-span-12 md:col-span-3">
          <button
            onClick={newSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium mb-3"
          >
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </button>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
              Sessions
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {sessions.length === 0 && (
                <li className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                  No sessions yet.
                </li>
              )}
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setCurrentId(s.id)}
                    className={`w-full text-left px-3 py-2 text-sm border-l-2 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      currentId === s.id
                        ? "border-blue-600 bg-blue-50 dark:bg-blue-950"
                        : "border-transparent"
                    }`}
                  >
                    <div className="truncate text-gray-900 dark:text-white">
                      {s.title}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {s.messageCount} msg · {new Date(s.updatedAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* CENTER: chat */}
        <main className="col-span-12 md:col-span-6 flex flex-col bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 min-h-[70vh]">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Bot className="h-4 w-4 text-blue-600" />
              <span className="font-medium">
                Chat · {selectedDomain?.label ?? "No active domain"} mode
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <span className="hidden sm:inline">Memory</span>
                <select
                  value={memoryMode}
                  onChange={(e) => changeMemoryMode(e.target.value as MemoryMode)}
                  title="How KindCaddy remembers things about you"
                  className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-gray-700 dark:text-gray-200"
                >
                  <option value="smart">Smart</option>
                  <option value="explicit">Explicit</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <span className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-200">
                KindCaddy
              </span>
            </div>
          </div>

          {banner && (
            <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-start justify-between gap-3">
              <p className="text-sm text-amber-800 dark:text-amber-300">{banner}</p>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="text-xs text-amber-700 dark:text-amber-400 hover:underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && !loading && (
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-3">
                <p>Ask a question to kick off the MCP loop. Try:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedDomain && isSelectedDomainActive ? (
                    EXAMPLES[selectedDomain.id].map((ex) => (
                      <button
                        key={ex}
                        onClick={() => send(ex)}
                        className="text-xs px-2.5 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                      >
                        {ex}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      {selectedDomain
                        ? `The "${selectedDomain.label}" domain is disabled for your account. Ask an admin to enable it.`
                        : "No MCP domains are available. Ask an admin to grant access."}
                    </span>
                  )}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <MessageView key={m.id} m={m} />
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {statusText ?? "Thinking…"}
              </div>
            )}
            {retryCountdown !== null && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                You&apos;re sending messages quickly — retrying in {retryCountdown}s…
              </div>
            )}
            {err && (
              <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-3">
                <span>Error: {err}</span>
                {lastFailedMessage && !loading && (
                  <button
                    type="button"
                    onClick={() => send(lastFailedMessage)}
                    className="text-xs px-2 py-1 rounded border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/30"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="p-3 border-t border-gray-200 dark:border-gray-800 space-y-2"
          >
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f, idx) => (
                  <span
                    key={`${f.name}-${idx}`}
                    className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    <FileUp className="h-3 w-3" />
                    {f.name}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm flex items-center gap-1.5"
              >
                <Upload className="h-4 w-4" />
                Upload
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDomainMenuOpen((open) => !open)}
                  disabled={domains.length === 0}
                  className="min-w-36 px-2 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2 disabled:opacity-50"
                >
                  <span>{selectedDomain?.label ?? "No domains"}</span>
                  <ChevronDown className="h-4 w-4" />
                </button>
                {domainMenuOpen && domains.length > 0 && (
                  <div className="absolute bottom-full mb-2 left-0 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-20 overflow-hidden">
                    <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                      MCP domains
                    </div>
                    {domains.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        disabled={!d.active}
                        onClick={() => {
                          setDomain(d.id);
                          setDomainMenuOpen(false);
                        }}
                        title={
                          d.active
                            ? d.description
                            : "Disabled for your account. Ask an admin to enable it."
                        }
                        className={`w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                          d.id === domain ? "bg-blue-50 dark:bg-blue-950" : ""
                        }`}
                      >
                        <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center justify-between">
                          <span>{d.label}</span>
                          {!d.active && (
                            <span className="text-[10px] uppercase tracking-wide text-gray-400">
                              disabled
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {d.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  selectedDomain && isSelectedDomainActive
                    ? `Ask ${selectedDomain.label.toLowerCase()}...`
                    : selectedDomain
                      ? `${selectedDomain.label} is disabled for your account`
                      : "No MCP domains available"
                }
                className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading || !selectedDomain || !isSelectedDomainActive}
              />
              <button
                type="submit"
                disabled={
                  loading ||
                  !input.trim() ||
                  !selectedDomain ||
                  !isSelectedDomainActive
                }
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm flex items-center gap-1.5"
              >
                <Send className="h-4 w-4" /> Send
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => onFilesSelected(e.target.files)}
            />
          </form>
        </main>

        {/* RIGHT: system / tools panel */}
        <aside className="col-span-12 md:col-span-3 space-y-3">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> MCP servers
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredServers.length === 0 && (
                <li className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                  No MCP servers for this domain.
                </li>
              )}
              {filteredServers.map((s) => (
                <li
                  key={s.id}
                  className={`px-3 py-2 ${s.allowed ? "" : "opacity-50"}`}
                  title={
                    s.allowed
                      ? undefined
                      : "Disabled for your account. Ask an admin to enable it."
                  }
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                    <span className={s.allowed ? "text-blue-600" : "text-gray-400"}>
                      {SERVER_ICONS[s.id] ?? <Server className="h-4 w-4" />}
                    </span>
                    <span className="flex-1">{s.name}</span>
                    {!s.allowed && (
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">
                        disabled
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {s.description}
                  </div>
                  <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                    {s.tools.map((t) => (
                      <li key={t.name} className="flex items-center gap-1.5">
                        <code className="text-[11px] bg-gray-100 dark:bg-gray-800 px-1 rounded">
                          {t.name}
                        </code>
                        <CapabilityBadge cap={t.capability} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 text-xs text-gray-600 dark:text-gray-400">
            <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
              Request flow
            </div>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>UI → Host (auth + session)</li>
              <li>Host → LLM with tool specs</li>
              <li>LLM emits tool calls</li>
              <li>MCP Broker: policy → {selectedDomain?.label ?? "active"} server(s)</li>
              <li>Normalized results → LLM</li>
              <li>Final reply → UI</li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

function withAttachmentContext(message: string, files: File[]): string {
  if (files.length === 0) return message;
  const lines = files.map((file) => `- ${file.name} (${file.type || "unknown"})`);
  return `${message}\n\nAttached files:\n${lines.join("\n")}`;
}

interface DenialInfo {
  tool: string;
  alternative?: string;
}

/**
 * Surface scope denials with the policy gate's suggested alternative
 * (Phase 5.2) — the gate already computes this; it used to be buried in the
 * trace JSON.
 */
function scopeDenials(m: ChatMessage): DenialInfo[] {
  return m.invocations
    .filter((inv) => {
      if (inv.status !== "denied") return false;
      const result = inv.result as { error?: { gate?: string } } | null;
      return result?.error?.gate === "scope";
    })
    .map((inv) => {
      const result = inv.result as {
        error?: { suggested_alternative?: string };
      } | null;
      return {
        tool: `${inv.server}.${inv.tool}`,
        alternative: result?.error?.suggested_alternative,
      };
    });
}

function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3 py-2 rounded-2xl bg-blue-600 text-white text-sm whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }
  const agent = m.agent ?? m.metadata?.agent ?? "assistant";
  const trace = m.metadata?.trace ?? [];
  return (
    <div className="flex flex-col items-start gap-2 max-w-[90%]">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Bot className="h-3.5 w-3.5 text-blue-600" />
        <span className="font-medium uppercase tracking-wide">{agent}</span>
        {m.metadata?.llm && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
            {m.metadata.llm}
          </span>
        )}
      </div>
      {m.invocations.length > 0 && (
        <div className="space-y-1 w-full">
          {m.invocations.map((inv) => (
            <ToolCallCard key={inv.id} inv={inv} />
          ))}
        </div>
      )}
      {scopeDenials(m).map((denial) => (
        <div
          key={denial.tool}
          className="text-xs px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
        >
          I can&apos;t access <code className="font-mono">{denial.tool}</code> with
          your current permissions
          {denial.alternative ? (
            <>
              , but I can use{" "}
              <code className="font-mono">{denial.alternative}</code> instead —
              try asking for that.
            </>
          ) : (
            ". Ask an admin if you need this."
          )}
        </div>
      ))}
      {trace.length > 0 && (
        <details className="text-[11px] text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer">trace ({trace.length} steps)</summary>
          <ul className="mt-1 pl-3 space-y-0.5">
            {trace.map((t, i) => (
              <li key={i}>
                <span className="font-mono">
                  [{t.type}] {t.label}
                </span>{" "}
                — {t.summary} · {t.durationMs}ms
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="px-3 py-2 rounded-2xl bg-gray-100 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
        {m.content || <span className="italic text-gray-500">(no reply)</span>}
      </div>
    </div>
  );
}

function ToolCallCard({ inv }: { inv: ToolInvocation }) {
  const color =
    inv.status === "ok"
      ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
      : inv.status === "denied"
        ? "border-amber-500 text-amber-700 dark:text-amber-400"
        : inv.status === "error"
          ? "border-red-500 text-red-700 dark:text-red-400"
          : "border-gray-300 text-gray-500";
  return (
    <details className={`text-xs rounded-lg border-l-4 ${color} bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800`}>
      <summary className="cursor-pointer px-2.5 py-1.5 flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5" />
        <code className="font-mono">
          {inv.server}.{inv.tool}
        </code>
        <span className="text-gray-500">· {inv.status}</span>
        <span className="ml-auto text-gray-400">{inv.latencyMs}ms</span>
      </summary>
      <div className="px-2.5 py-2 border-t border-gray-200 dark:border-gray-800 space-y-2">
        <div>
          <div className="text-gray-500 mb-0.5">params</div>
          <pre className="bg-gray-50 dark:bg-gray-950 p-2 rounded overflow-x-auto">
            {JSON.stringify(inv.params, null, 2)}
          </pre>
        </div>
        <div>
          <div className="text-gray-500 mb-0.5">result</div>
          <pre className="bg-gray-50 dark:bg-gray-950 p-2 rounded overflow-x-auto max-h-60">
            {JSON.stringify(inv.result, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  );
}

function CapabilityBadge({ cap }: { cap: string }) {
  const color =
    cap === "read"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
      : cap === "write"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400";
  return (
    <span className={`text-[10px] px-1 rounded ${color}`}>{cap}</span>
  );
}
