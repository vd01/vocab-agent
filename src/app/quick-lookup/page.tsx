"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────

interface LookupResult {
  type: string;
  word: string;
  inLibrary: boolean;
  wordId: string | null;
  groups: string[];
  isPinned: boolean;
  fsrsState: number | null;
  fsrsStateLabel: string | null;
  fsrsDue: string | null;
  phonetic: string | null;
  audioUrl: string | null;
  translation: string | null;
  definitions: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[];
  collins: number | null;
  tag: string | null;
  bnc: number | null;
  exchange: string | null;
  synonyms: string[];
  actions: string[];
  allGroups: { id: string; name: string }[];
}

interface ActionResult {
  type: string;
  message: string;
  [key: string]: unknown;
}

// ── English Detection ──────────────────────────────────────────────

function isEnglishWordOrPhrase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 100) return false;
  // 1-6 English words (letters only, separated by spaces/hyphens)
  return /^[a-zA-Z]+(?:[-\s][a-zA-Z]+){0,5}$/.test(trimmed);
}

// ── FSRS State Labels ─────────────────────────────────────────────

const FSRS_STATE_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "新词", color: "text-blue-400" },
  1: { label: "学习中", color: "text-yellow-400" },
  2: { label: "复习中", color: "text-green-400" },
  3: { label: "重学中", color: "text-red-400" },
};

// ── Main Component ─────────────────────────────────────────────────

export default function QuickLookupPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();

    // Try to read clipboard and auto-fill
    (async () => {
      try {
        // @ts-expect-error Tauri internal API
        const { invoke } = window.__TAURI_INTERNALS__;
        const clipboardText = await invoke("read-clipboard");
        if (typeof clipboardText === "string" && isEnglishWordOrPhrase(clipboardText)) {
          setInput(clipboardText.trim());
        }
      } catch {
        // Not in Tauri or clipboard access denied — ignore
      }
    })();
  }, []);

  // Listen for quick-lookup-activated event (re-focus, re-read clipboard)
  useEffect(() => {
    const handler = async () => {
      inputRef.current?.focus();
      setResult(null);
      setActionMessage(null);
      setShowGroupSelector(false);
      try {
        // @ts-expect-error Tauri internal API
        const { invoke } = window.__TAURI_INTERNALS__;
        const clipboardText = await invoke("read-clipboard");
        if (typeof clipboardText === "string" && isEnglishWordOrPhrase(clipboardText)) {
          setInput(clipboardText.trim());
        }
      } catch {
        // ignore
      }
    };

    // Tauri event listener
    try {
      // @ts-expect-error Tauri internal API
      const { listen } = window.__TAURI_INTERNALS__;
      if (listen) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unlisten = (listen as any)(
          "quick-lookup-activated",
          handler
        );
        return () => {
          unlisten.then((fn: () => void) => fn()).catch(() => {});
        };
      }
    } catch {
      // Not in Tauri
    }
  }, []);

  // ESC to close window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        try {
          // @ts-expect-error Tauri internal API
          const { invoke } = window.__TAURI_INTERNALS__;
          invoke("plugin:window|hide");
        } catch {
          // Not in Tauri
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const doLookup = useCallback(async (word: string) => {
    const trimmed = word.trim();
    if (!trimmed) return;

    setLoading(true);
    setResult(null);
    setActionMessage(null);
    setShowGroupSelector(false);

    try {
      // Get the server URL from Tauri config or use relative path
      let baseUrl = "";
      try {
        // @ts-expect-error Tauri internal API
        const { invoke } = window.__TAURI_INTERNALS__;
        const cfg = await invoke("config-get");
        if (cfg?.server_url) {
          baseUrl = cfg.server_url.replace(/\/+$/, "");
        }
      } catch {
        // Not in Tauri, use relative path
      }

      const url = baseUrl
        ? `${baseUrl}/api/quick-lookup?word=${encodeURIComponent(trimmed)}`
        : `/api/quick-lookup?word=${encodeURIComponent(trimmed)}`;

      const res = await fetch(url);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({
        type: "error",
        word: trimmed,
        inLibrary: false,
        wordId: null,
        groups: [],
        isPinned: false,
        fsrsState: null,
        fsrsStateLabel: null,
        fsrsDue: null,
        phonetic: null,
        audioUrl: null,
        translation: "查询失败，请检查网络连接",
        definitions: [],
        collins: null,
        tag: null,
        bnc: null,
        exchange: null,
        synonyms: [],
        actions: [],
        allGroups: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doLookup(input);
  };

  const doAction = async (action: string, extra?: Record<string, string>) => {
    setActionLoading(action);
    setActionMessage(null);

    try {
      let baseUrl = "";
      try {
        // @ts-expect-error Tauri internal API
        const { invoke } = window.__TAURI_INTERNALS__;
        const cfg = await invoke("config-get");
        if (cfg?.server_url) {
          baseUrl = cfg.server_url.replace(/\/+$/, "");
        }
      } catch {
        // Not in Tauri
      }

      const url = baseUrl
        ? `${baseUrl}/api/quick-lookup-action`
        : "/api/quick-lookup-action";

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, word: input.trim(), ...extra }),
      });

      const data: ActionResult = await res.json();
      setActionMessage(data.message || "操作完成");

      // If the action changed the library status, re-lookup
      if (
        data.type === "added" ||
        data.type === "added-and-pinned" ||
        data.type === "pinned" ||
        data.type === "added-to-group"
      ) {
        // Brief delay to let DB settle, then re-lookup
        setTimeout(() => doLookup(input.trim()), 300);
      }
    } catch {
      setActionMessage("操作失败，请检查网络连接");
    } finally {
      setActionLoading(null);
    }
  };

  // Play pronunciation
  const playAudio = (url: string | null) => {
    if (!url) return;
    const audio = new Audio(url);
    audio.play().catch(() => {});
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden select-none">
      {/* Search Input */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 p-3 pb-2">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入单词或短语..."
            className="w-full pl-10 pr-4 py-2.5 bg-muted/50 border border-border rounded-xl
                       text-foreground text-sm placeholder:text-muted-foreground
                       focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
                       transition-all"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </form>

      {/* Result Area */}
      <div ref={resultRef} className="flex-1 overflow-y-auto px-3 pb-3">
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            查询中...
          </div>
        )}

        {result && !loading && (
          <div className="space-y-3">
            {/* Word Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-foreground">
                    {result.word}
                  </span>
                  {result.audioUrl && (
                    <button
                      onClick={() => playAudio(result.audioUrl)}
                      className="p-1 rounded-md hover:bg-muted transition-colors"
                      title="播放发音"
                    >
                      <svg
                        className="w-4 h-4 text-muted-foreground"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-1.464a5 5 0 010-7.072M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </button>
                  )}
                  {result.phonetic && (
                    <span className="text-sm text-muted-foreground">
                      {result.phonetic}
                    </span>
                  )}
                </div>
                {/* Status Badges */}
                <div className="flex items-center gap-1.5 mt-1">
                  {result.inLibrary ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                      ✓ 已入库
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                      未入库
                    </span>
                  )}
                  {result.fsrsState !== null && FSRS_STATE_LABELS[result.fsrsState] && (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted ${FSRS_STATE_LABELS[result.fsrsState].color}`}
                    >
                      {FSRS_STATE_LABELS[result.fsrsState].label}
                    </span>
                  )}
                  {result.isPinned && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">
                      📌 置顶
                    </span>
                  )}
                  {result.groups.length > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                      {result.groups.join(", ")}
                    </span>
                  )}
                  {result.tag && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                      {result.tag}
                    </span>
                  )}
                  {result.collins && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
                      ★ {result.collins}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Translation */}
            {result.translation && (
              <div className="text-sm text-foreground/90 leading-relaxed">
                {result.translation}
              </div>
            )}

            {/* English Definitions */}
            {result.definitions && result.definitions.length > 0 && (
              <div className="space-y-1.5">
                {result.definitions.slice(0, 3).map((group, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-muted-foreground font-medium">
                      {group.partOfSpeech}
                    </span>
                    <div className="mt-0.5 space-y-0.5">
                      {group.definitions.slice(0, 2).map((def, j) => (
                        <div key={j} className="text-foreground/80 pl-2">
                          {def.definition}
                          {def.example && (
                            <div className="text-muted-foreground italic mt-0.5">
                              &quot;{def.example}&quot;
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Word Forms */}
            {result.exchange && (
              <div className="text-xs text-muted-foreground">
                词形变化: {result.exchange}
              </div>
            )}

            {/* Action Message */}
            {actionMessage && (
              <div className="text-xs px-2 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                {actionMessage}
              </div>
            )}

            {/* Action Buttons */}
            {result.actions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {result.actions.includes("add-to-library") && (
                  <ActionButton
                    label="入库"
                    icon="📚"
                    loading={actionLoading === "add-to-library"}
                    onClick={() => doAction("add-to-library")}
                  />
                )}
                {result.actions.includes("add-and-pin") && (
                  <ActionButton
                    label="入库并置顶"
                    icon="📌"
                    loading={actionLoading === "add-and-pin"}
                    onClick={() => doAction("add-and-pin")}
                  />
                )}
                {result.actions.includes("pin") && (
                  <ActionButton
                    label="置顶"
                    icon="📌"
                    loading={actionLoading === "pin"}
                    onClick={() => doAction("pin")}
                  />
                )}
                {result.actions.includes("add-to-group") && (
                  <ActionButton
                    label="加入分组"
                    icon="📂"
                    loading={actionLoading === "add-to-group"}
                    onClick={() => setShowGroupSelector(!showGroupSelector)}
                  />
                )}
              </div>
            )}

            {/* Group Selector */}
            {showGroupSelector && (
              <div className="space-y-1.5 border border-border rounded-lg p-2">
                <div className="text-xs text-muted-foreground">选择分组：</div>
                <div className="flex flex-wrap gap-1">
                  {result.allGroups.map((g) => (
                    <button
                      key={g.id}
                      className="px-2 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
                      onClick={() => {
                        doAction("add-to-group", { groupId: g.id });
                        setShowGroupSelector(false);
                      }}
                      disabled={actionLoading !== null}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="新建分组名..."
                    className="flex-1 px-2 py-1 text-xs bg-muted/50 border border-border rounded-md
                               text-foreground placeholder:text-muted-foreground focus:outline-none
                               focus:ring-1 focus:ring-primary/50"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newGroupName.trim()) {
                        doAction("add-to-group", {
                          groupName: newGroupName.trim(),
                        });
                        setShowGroupSelector(false);
                        setNewGroupName("");
                      }
                    }}
                  />
                  <button
                    className="px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    disabled={!newGroupName.trim() || actionLoading !== null}
                    onClick={() => {
                      if (newGroupName.trim()) {
                        doAction("add-to-group", {
                          groupName: newGroupName.trim(),
                        });
                        setShowGroupSelector(false);
                        setNewGroupName("");
                      }
                    }}
                  >
                    创建
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-xs">
            <svg
              className="w-8 h-8 mb-2 opacity-30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            输入单词后按回车查询
            <span className="mt-1 opacity-60">Ctrl+Shift+X 快速打开</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Action Button ──────────────────────────────────────────────────

function ActionButton({
  label,
  icon,
  loading,
  onClick,
}: {
  label: string;
  icon: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium
                 rounded-lg bg-primary/10 text-primary hover:bg-primary/20
                 border border-primary/20 transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={loading}
      onClick={onClick}
    >
      {loading ? (
        <svg
          className="animate-spin h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : (
        <span>{icon}</span>
      )}
      {label}
    </button>
  );
}
