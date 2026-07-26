"use client";

import Link from "next/link";
import { Sparkles, ArrowLeft, Home, Save, Trash2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import UserProfileDropdown from "@/components/UserProfileDropdown";

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

        {/* Memory (real, persisted) */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Memory
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Control how KindCaddy remembers things about you. Memory is private
            to your account and never shared.
          </p>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Memory mode
              </label>
              <div className="flex gap-2">
                {(["smart", "explicit", "off"] as MemoryMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => void changeMode(m)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${
                      mode === m
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-blue-400"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {MODE_COPY[mode]}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Add a memory
              </label>
              <div className="flex gap-2">
                <input
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addMemory();
                  }}
                  placeholder="e.g. I prefer concise, bulleted answers"
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <button
                  onClick={() => void addMemory()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
              {memoryErr && (
                <p className="text-xs text-red-500 mt-2">{memoryErr}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Saved memory {items.length > 0 && `(${items.length})`}
              </label>
              {loadingMemory ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Nothing saved yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white break-words">
                          {item.content}
                        </p>
                        <span className="inline-block mt-1 text-[10px] uppercase tracking-wide text-gray-400">
                          {item.source}
                        </span>
                      </div>
                      <button
                        onClick={() => void removeMemory(item.id)}
                        className="text-gray-400 hover:text-red-500 shrink-0"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Assistant style (demo, not persisted yet) */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Assistant style
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            Configure how the chat agent responds.
          </p>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Chat style
              </label>
              <input
                value={chatStyle}
                onChange={(e) => setChatStyle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="e.g. concise and friendly"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Frequent questions
              </label>
              <textarea
                value={frequentQuestions}
                onChange={(e) => setFrequentQuestions(e.target.value)}
                rows={5}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="One frequently asked question per line."
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Demo mode: these style fields are local and not persisted yet.
              </p>
              <button
                onClick={() => {
                  setSaved(true);
                  setTimeout(() => setSaved(false), 1800);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
              >
                <Save className="h-4 w-4" />
                {saved ? "Saved" : "Save settings"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
