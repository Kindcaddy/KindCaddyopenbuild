"use client";

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
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";
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
    <div className="kc-container py-6">
      <PageHeader
        eyebrow="Assistant"
        title="Ask KindCaddy"
        actions={
          <>
            <span className="kc-chip kc-chip--accent capitalize">
              {roleView} view
            </span>
            <span className="kc-chip">
              <Server className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {allowedServerCount} of {filteredServers.length} MCP servers
            </span>
            <span className="kc-chip">
              <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {totalTools} tools
            </span>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT: sessions */}
        <aside className="kc-rise col-span-12 md:col-span-3">
          <button
            onClick={newSession}
            className="kc-btn kc-btn-primary kc-btn--block mb-3"
          >
            <MessageSquarePlus className="h-4 w-4" strokeWidth={1.8} /> New chat
          </button>
          <div className="kc-panel overflow-hidden">
            <div className="kc-panel-head">
              <span className="kc-panel-title">Sessions</span>
            </div>
            <ul
              role="listbox"
              aria-label="Chat sessions"
              className="kc-scroll max-h-[60vh] overflow-y-auto"
            >
              {sessions.length === 0 && (
                <li
                  role="presentation"
                  className="px-3 py-4 text-sm text-[var(--kc-muted)]"
                >
                  No sessions yet.
                </li>
              )}
              {sessions.map((s) => (
                <li key={s.id} role="presentation">
                  <button
                    role="option"
                    aria-selected={currentId === s.id}
                    onClick={() => setCurrentId(s.id)}
                    className="kc-row text-sm"
                  >
                    <div className="truncate text-[var(--kc-ink)]">
                      {s.title}
                    </div>
                    <div className="text-xs text-[var(--kc-muted)]">
                      {s.messageCount} msg · {new Date(s.updatedAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* CENTER: chat */}
        <main
          className="kc-rise kc-panel col-span-12 flex min-h-[70vh] flex-col md:col-span-6"
          style={{ "--kc-delay": "0.06s" } as React.CSSProperties}
        >
          <div className="kc-panel-head">
            <div className="flex items-center gap-2 text-sm text-[var(--kc-text)]">
              <Bot
                className="h-4 w-4 text-[var(--kc-accent)]"
                strokeWidth={1.8}
                aria-hidden
              />
              <span className="font-medium">
                Chat · {selectedDomain?.label ?? "No active domain"} mode
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className="kc-mono hidden text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[var(--kc-muted)] sm:inline">
                  Memory
                </span>
                <select
                  value={memoryMode}
                  onChange={(e) => changeMemoryMode(e.target.value as MemoryMode)}
                  title="How KindCaddy remembers things about you"
                  className="kc-select !w-auto"
                >
                  <option value="smart">Smart</option>
                  <option value="explicit">Explicit</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <span className="kc-chip kc-chip--muted">KindCaddy</span>
            </div>
          </div>

          {banner && (
            <div className="kc-note kc-note--accent mx-4 mt-3 justify-between">
              <p>{banner}</p>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="kc-btn kc-btn-ghost kc-btn--sm shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          <div
            ref={scrollerRef}
            className="kc-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && !loading && (
              <div className="space-y-3 text-sm text-[var(--kc-muted)]">
                <p>Ask a question to kick off the MCP loop. Try:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedDomain && isSelectedDomainActive ? (
                    EXAMPLES[selectedDomain.id].map((ex) => (
                      <button
                        key={ex}
                        onClick={() => send(ex)}
                        className="kc-btn kc-btn-secondary kc-btn--sm max-w-full text-left !whitespace-normal"
                      >
                        {ex}
                      </button>
                    ))
                  ) : (
                    <p className="kc-note kc-note--accent">
                      {selectedDomain
                        ? `The "${selectedDomain.label}" domain is disabled for your account. Ask an admin to enable it.`
                        : "No MCP domains are available. Ask an admin to grant access."}
                    </p>
                  )}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <MessageView key={m.id} m={m} />
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-[var(--kc-muted)]">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--kc-accent)]" />
                {statusText ?? "Thinking…"}
              </div>
            )}
            {retryCountdown !== null && (
              <div className="flex items-center gap-2 text-sm text-[var(--kc-accent)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                You&apos;re sending messages quickly — retrying in {retryCountdown}s…
              </div>
            )}
            {err && (
              <div className="flex items-center gap-3 text-sm text-[#8f2f1c]">
                <span>Error: {err}</span>
                {lastFailedMessage && !loading && (
                  <button
                    type="button"
                    onClick={() => send(lastFailedMessage)}
                    className="kc-btn kc-btn-secondary kc-btn--sm"
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
            className="space-y-2 border-t border-[var(--kc-line)] p-3"
          >
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f, idx) => (
                  <span key={`${f.name}-${idx}`} className="kc-chip">
                    <FileUp className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                    {f.name}
                  </span>
                ))}
              </div>
            )}
            {/* Wraps on narrow screens so the message field keeps full width. */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="kc-btn kc-btn-secondary"
              >
                <Upload className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                Upload
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDomainMenuOpen((open) => !open)}
                  disabled={domains.length === 0}
                  aria-haspopup="listbox"
                  aria-expanded={domainMenuOpen}
                  className="kc-btn kc-btn-secondary min-w-36"
                >
                  <span className="flex-1 text-left font-normal">
                    {selectedDomain?.label ?? "No domains"}
                  </span>
                  <ChevronDown className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                </button>
                {domainMenuOpen && domains.length > 0 && (
                  <div className="kc-panel absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden">
                    <div className="kc-panel-head">
                      <span className="kc-panel-title">MCP domains</span>
                    </div>
                    <div role="listbox" aria-label="MCP domains">
                      {domains.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          role="option"
                          aria-selected={d.id === domain}
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
                          className="kc-row disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="flex items-center justify-between text-sm font-medium text-[var(--kc-ink)]">
                            <span>{d.label}</span>
                            {!d.active && (
                              <span className="kc-mono text-[10px] uppercase tracking-wide text-[var(--kc-muted)]">
                                disabled
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--kc-muted)]">
                            {d.description}
                          </div>
                        </button>
                      ))}
                    </div>
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
                className="kc-input order-first w-full min-w-0 sm:order-none sm:w-auto sm:flex-1"
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
                className="kc-btn kc-btn-primary"
              >
                <Send className="h-4 w-4" strokeWidth={1.8} aria-hidden /> Send
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
        <aside
          className="kc-rise col-span-12 space-y-3 md:col-span-3"
          style={{ "--kc-delay": "0.12s" } as React.CSSProperties}
        >
          <div className="kc-panel overflow-hidden">
            <div className="kc-panel-head">
              <span className="kc-panel-title inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden /> MCP
                servers
              </span>
            </div>
            <ul className="divide-y divide-[var(--kc-line)]">
              {filteredServers.length === 0 && (
                <li className="px-3 py-4 text-sm text-[var(--kc-muted)]">
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
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--kc-ink)]">
                    <span
                      className={
                        s.allowed
                          ? "text-[var(--kc-accent)]"
                          : "text-[var(--kc-muted)]"
                      }
                    >
                      {SERVER_ICONS[s.id] ?? <Server className="h-4 w-4" />}
                    </span>
                    <span className="flex-1">{s.name}</span>
                    {!s.allowed && (
                      <span className="kc-mono text-[10px] uppercase tracking-wide text-[var(--kc-muted)]">
                        disabled
                      </span>
                    )}
                  </div>
                  <div className="mb-1 text-xs text-[var(--kc-muted)]">
                    {s.description}
                  </div>
                  <ul className="space-y-0.5 text-xs text-[var(--kc-muted)]">
                    {s.tools.map((t) => (
                      <li key={t.name} className="flex items-center gap-1.5">
                        <code className="kc-code">{t.name}</code>
                        <CapabilityBadge cap={t.capability} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          <div className="kc-panel p-3 text-xs text-[var(--kc-muted)]">
            <div className="kc-panel-title mb-1.5">Request flow</div>
            <ol className="list-decimal space-y-0.5 pl-4">
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
        <div className="kc-bubble kc-bubble--user">{m.content}</div>
      </div>
    );
  }
  const agent = m.agent ?? m.metadata?.agent ?? "assistant";
  const trace = m.metadata?.trace ?? [];
  return (
    <div className="flex max-w-[90%] flex-col items-start gap-2">
      <div className="flex items-center gap-2 text-xs text-[var(--kc-muted)]">
        <Bot
          className="h-3.5 w-3.5 text-[var(--kc-accent)]"
          strokeWidth={1.8}
          aria-hidden
        />
        <span className="kc-mono font-medium uppercase tracking-wide">
          {agent}
        </span>
        {m.metadata?.llm && (
          <span className="kc-mono rounded bg-[rgba(31,41,36,0.06)] px-1.5 py-0.5 text-[10px]">
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
        <div key={denial.tool} className="kc-note kc-note--accent">
          <p>
            I can&apos;t access <code className="kc-code">{denial.tool}</code>{" "}
            with your current permissions
            {denial.alternative ? (
              <>
                , but I can use{" "}
                <code className="kc-code">{denial.alternative}</code> instead —
                try asking for that.
              </>
            ) : (
              ". Ask an admin if you need this."
            )}
          </p>
        </div>
      ))}
      {trace.length > 0 && (
        <details className="text-[11px] text-[var(--kc-muted)]">
          <summary className="cursor-pointer">trace ({trace.length} steps)</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {trace.map((t, i) => (
              <li key={i}>
                <span className="kc-mono">
                  [{t.type}] {t.label}
                </span>{" "}
                — {t.summary} · {t.durationMs}ms
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="kc-bubble kc-bubble--agent">
        {m.content || (
          <span className="italic text-[var(--kc-muted)]">(no reply)</span>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({ inv }: { inv: ToolInvocation }) {
  const color =
    inv.status === "ok"
      ? "border-l-[var(--kc-sage)] text-[var(--kc-sage)]"
      : inv.status === "denied"
        ? "border-l-[var(--kc-accent)] text-[var(--kc-accent)]"
        : inv.status === "error"
          ? "border-l-[#8f2f1c] text-[#8f2f1c]"
          : "border-l-[var(--kc-line)] text-[var(--kc-muted)]";
  return (
    <details
      className={`overflow-hidden rounded-xl border border-l-4 border-[var(--kc-line)] bg-[rgba(255,255,255,0.72)] text-xs ${color}`}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5">
        <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        <code className="kc-mono">
          {inv.server}.{inv.tool}
        </code>
        <span className="text-[var(--kc-muted)]">· {inv.status}</span>
        <span className="ml-auto text-[var(--kc-muted)]">{inv.latencyMs}ms</span>
      </summary>
      <div className="space-y-2 border-t border-[var(--kc-line)] px-2.5 py-2">
        <div>
          <div className="kc-label mb-1">params</div>
          <pre className="kc-pre">{JSON.stringify(inv.params, null, 2)}</pre>
        </div>
        <div>
          <div className="kc-label mb-1">result</div>
          <pre className="kc-pre max-h-60 overflow-y-auto">
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
      ? "bg-[var(--kc-sage-soft)] text-[#3f4d38]"
      : cap === "write"
        ? "bg-[var(--kc-accent-soft)] text-[#7d4227]"
        : "bg-[rgba(196,74,48,0.12)] text-[#8f2f1c]";
  return (
    <span className={`rounded px-1 text-[10px] font-semibold ${color}`}>
      {cap}
    </span>
  );
}
