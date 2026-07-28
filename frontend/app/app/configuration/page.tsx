"use client";

import { Save, Trash2, Plus, Brain, KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/AppShell";

type MemoryMode = "smart" | "explicit" | "off";

interface MemoryItem {
  id: string;
  content: string;
  label: string | null;
  source: string;
  createdAt: string;
}

const MODE_COPY: Record<MemoryMode, string> = {
  smart:
    "KindCaddy automatically remembers durable facts and preferences from your chats. Saved silently — review or delete anything below.",
  explicit:
    "KindCaddy only remembers when you explicitly ask it to in chat (e.g. \"remember that I prefer concise answers\").",
  off: "KindCaddy will not save any new memory. Existing items below are kept until you delete them.",
};

export default function ConfigurationPage() {
  const [chatStyle, setChatStyle] = useState("Concise and professional");
  const [frequentQuestions, setFrequentQuestions] = useState(
    "What invoices are overdue?\nWhich customer has the highest lifetime value?\nWhat changed in this tenant this week?",
  );
  const [saved, setSaved] = useState(false);

  const [mode, setMode] = useState<MemoryMode>("smart");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [newMemory, setNewMemory] = useState("");
  const [memoryErr, setMemoryErr] = useState<string | null>(null);
  const [loadingMemory, setLoadingMemory] = useState(true);

  // ---- BYOK (bring your own key) state ----
  interface ByokState {
    configured: boolean;
    baseUrl: string | null;
    model: string | null;
    keyPreview?: string;
  }
  const [byok, setByok] = useState<ByokState | null>(null);
  const [byokKey, setByokKey] = useState("");
  const [byokBaseUrl, setByokBaseUrl] = useState("");
  const [byokModel, setByokModel] = useState("");
  const [byokSaving, setByokSaving] = useState(false);
  const [byokMsg, setByokMsg] = useState<string | null>(null);
  const [byokErr, setByokErr] = useState<string | null>(null);

  const loadByok = useCallback(async () => {
    try {
      const res = await fetch("/api/me/byok", { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as ByokState;
        setByok(j);
        if (j.configured) {
          setByokBaseUrl(j.baseUrl ?? "");
          setByokModel(j.model ?? "");
        }
      }
    } catch {
      // Non-fatal: card just shows the form.
    }
  }, []);

  const saveByok = useCallback(async () => {
    if (!byokKey.trim() || byokSaving) return;
    setByokSaving(true);
    setByokErr(null);
    setByokMsg(null);
    try {
      const res = await fetch("/api/me/byok", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: byokKey.trim(),
          baseUrl: byokBaseUrl.trim() || undefined,
          model: byokModel.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as ByokState & {
        message?: string;
      };
      if (!res.ok) {
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      setByok(j);
      setByokKey("");
      setByokMsg("Key saved for this browser session.");
    } catch (err) {
      setByokErr(err instanceof Error ? err.message : "Could not save key");
    } finally {
      setByokSaving(false);
    }
  }, [byokKey, byokBaseUrl, byokModel, byokSaving]);

  const clearByok = useCallback(async () => {
    setByokSaving(true);
    setByokErr(null);
    setByokMsg(null);
    try {
      await fetch("/api/me/byok", { method: "DELETE" });
      setByok({ configured: false, baseUrl: null, model: null });
      setByokKey("");
      setByokBaseUrl("");
      setByokModel("");
      setByokMsg("Key removed. Chats now use the platform default model.");
    } finally {
      setByokSaving(false);
    }
  }, []);

  useEffect(() => {
    void loadByok();
  }, [loadByok]);

  const loadMemory = useCallback(async () => {
    try {
      const [modeRes, itemsRes] = await Promise.all([
        fetch("/api/memory/mode", { cache: "no-store" }),
        fetch("/api/memory", { cache: "no-store" }),
      ]);
      if (modeRes.ok) {
        const j = (await modeRes.json()) as { mode: MemoryMode };
        setMode(j.mode);
      }
      if (itemsRes.ok) {
        const j = (await itemsRes.json()) as { items: MemoryItem[] };
        setItems(j.items);
      }
    } finally {
      setLoadingMemory(false);
    }
  }, []);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const changeMode = useCallback(async (next: MemoryMode) => {
    setMode(next);
    await fetch("/api/memory/mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
  }, []);

  const addMemory = useCallback(async () => {
    const content = newMemory.trim();
    if (!content) return;
    setMemoryErr(null);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      const j = (await res.json()) as { item: MemoryItem };
      setItems((prev) => [j.item, ...prev]);
      setNewMemory("");
    } else {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      setMemoryErr(j.message ?? "Could not save that item.");
    }
  }, [newMemory]);

  const removeMemory = useCallback(async (id: string) => {
    const res = await fetch("/api/memory", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }
  }, []);

  return (
    <div className="kc-container py-8">
      <PageHeader
        eyebrow="Configuration"
        title="Configuration"
        description="Memory, model provider, and assistant behaviour for your account."
      />

      {/* Memory (real, persisted) */}
      <div
        className="kc-panel kc-rise mb-6 p-5 sm:p-7"
        style={{ "--kc-delay": "0.06s" } as React.CSSProperties}
      >
        <h2 className="kc-display flex items-center gap-2 text-[1.35rem]">
          <Brain
            className="h-5 w-5 text-[var(--kc-accent)]"
            strokeWidth={1.8}
            aria-hidden
          />
          Memory
        </h2>
        <p className="kc-subtitle mb-6 mt-2">
          Control how KindCaddy remembers things about you. Memory is private to
          your account and never shared.
        </p>

        <div className="space-y-6">
          <div>
            <label className="kc-label mb-2">Memory mode</label>
            <div className="flex flex-wrap gap-2">
              {(["smart", "explicit", "off"] as MemoryMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => void changeMode(m)}
                  aria-pressed={mode === m}
                  className={`kc-btn kc-btn--sm capitalize ${
                    mode === m ? "kc-btn-primary" : "kc-btn-secondary"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--kc-muted)]">
              {MODE_COPY[mode]}
            </p>
          </div>

          <div>
            <label className="kc-label mb-2">Add a memory</label>
            <div className="flex flex-wrap gap-2">
              <input
                value={newMemory}
                onChange={(e) => setNewMemory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addMemory();
                }}
                placeholder="e.g. I prefer concise, bulleted answers"
                className="kc-input flex-1"
              />
              <button
                onClick={() => void addMemory()}
                className="kc-btn kc-btn-primary"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                Add
              </button>
            </div>
            {memoryErr && (
              <div className="kc-note kc-note--danger mt-3">{memoryErr}</div>
            )}
          </div>

          <div>
            <label className="kc-label mb-2">
              Saved memory {items.length > 0 && `(${items.length})`}
            </label>
            {loadingMemory ? (
              <p className="text-sm text-[var(--kc-muted)]">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-[var(--kc-muted)]">
                Nothing saved yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-[14px] border border-[var(--kc-line)] bg-[rgba(255,255,255,0.55)] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm text-[var(--kc-ink)]">
                        {item.content}
                      </p>
                      <span className="kc-mono mt-1.5 inline-block text-[10px] uppercase tracking-[0.16em] text-[var(--kc-muted)]">
                        {item.source}
                      </span>
                    </div>
                    <button
                      onClick={() => void removeMemory(item.id)}
                      className="shrink-0 rounded-full p-1.5 text-[var(--kc-muted)] transition-colors hover:bg-[rgba(196,74,48,0.08)] hover:text-[#8f2f1c]"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Model provider (BYOK) */}
      <div
        className="kc-panel kc-rise mb-6 p-5 sm:p-7"
        style={{ "--kc-delay": "0.12s" } as React.CSSProperties}
      >
        <h2 className="kc-display flex items-center gap-2 text-[1.35rem]">
          <KeyRound
            className="h-5 w-5 text-[var(--kc-accent)]"
            strokeWidth={1.8}
          />
          Model provider (BYOK)
        </h2>
        <p className="kc-subtitle mb-6 mt-2">
          Bring your own API key for chat answers. The key is stored only as
          an encrypted cookie in this browser session — never in our
          database — and is cleared when you close the browser. Leave the
          optional fields blank to use the platform defaults.
        </p>

        {byok?.configured && (
          <div className="kc-note kc-note--sage mb-5">
            <span>
              Using your key {byok.keyPreview}
              {byok.model
                ? ` · model ${byok.model}`
                : " · platform default model"}
              {byok.baseUrl ? ` · ${byok.baseUrl}` : ""}
            </span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="kc-label mb-2">API key</label>
            <input
              type="password"
              value={byokKey}
              onChange={(e) => setByokKey(e.target.value)}
              placeholder={
                byok?.configured
                  ? `Current key ${byok.keyPreview} — enter a new key to replace`
                  : "sk-or-… (OpenRouter, OpenAI, or any OpenAI-compatible provider)"
              }
              autoComplete="off"
              className="kc-input"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="kc-label mb-2">Base URL (optional)</label>
              <input
                value={byokBaseUrl}
                onChange={(e) => setByokBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
                className="kc-input"
              />
            </div>
            <div>
              <label className="kc-label mb-2">Model (optional)</label>
              <input
                value={byokModel}
                onChange={(e) => setByokModel(e.target.value)}
                placeholder="anthropic/claude-sonnet-4"
                className="kc-input"
              />
            </div>
          </div>

          {byokErr && <div className="kc-note kc-note--danger">{byokErr}</div>}
          {byokMsg && <div className="kc-note kc-note--sage">{byokMsg}</div>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void saveByok()}
              disabled={byokSaving || !byokKey.trim()}
              className="kc-btn kc-btn-primary"
            >
              {byokSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save key
            </button>
            {byok?.configured && (
              <button
                onClick={() => void clearByok()}
                disabled={byokSaving}
                className="kc-btn kc-btn-secondary"
              >
                Remove key
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Assistant style (demo, not persisted yet) */}
      <div
        className="kc-panel kc-rise p-5 sm:p-7"
        style={{ "--kc-delay": "0.18s" } as React.CSSProperties}
      >
        <h2 className="kc-display text-[1.35rem]">Assistant style</h2>
        <p className="kc-subtitle mb-8 mt-2">
          Configure how the chat agent responds.
        </p>

        <div className="space-y-6">
          <div>
            <label className="kc-label mb-2">Chat style</label>
            <input
              value={chatStyle}
              onChange={(e) => setChatStyle(e.target.value)}
              className="kc-input"
              placeholder="e.g. concise and friendly"
            />
          </div>

          <div>
            <label className="kc-label mb-2">Frequent questions</label>
            <textarea
              value={frequentQuestions}
              onChange={(e) => setFrequentQuestions(e.target.value)}
              rows={5}
              className="kc-textarea"
              placeholder="One frequently asked question per line."
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--kc-muted)]">
              Demo mode: these style fields are local and not persisted yet.
            </p>
            <button
              onClick={() => {
                setSaved(true);
                setTimeout(() => setSaved(false), 1800);
              }}
              className="kc-btn kc-btn-primary"
            >
              <Save className="h-4 w-4" strokeWidth={2} />
              {saved ? "Saved" : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
