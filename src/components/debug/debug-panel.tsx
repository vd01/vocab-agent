'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface StepLog {
  step: number;
  agent: string;
  model: string;
  request: { instructions?: string; messages: any[]; tools: string[] };
  response: {
    text?: string;
    reasoningText?: string;
    toolCalls?: any[];
    toolResults?: any[];
    finishReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };
}

const STORAGE_KEY = 'llm-debug-logs';

/**
 * Temporary debug panel — Ctrl+D to toggle.
 *
 * How it works:
 * 1. Intercepts fetch to /api/chat, reads X-Debug-Id from response header
 * 2. After the stream finishes, fetches /api/debug-logs?id=<debugId> to get logs
 * 3. Also persists to localStorage for inspection after page reload
 */
export function DebugPanel() {
  const [visible, setVisible] = useState(false);
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const pendingDebugIdsRef = useRef<string[]>([]);

  // Ctrl+D to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Fetch debug logs for a given ID
  const fetchDebugLogs = useCallback(async (debugId: string) => {
    // Small delay to ensure the server has stored the logs
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`/api/debug-logs?id=${debugId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.logs?.length) {
          setLogs(data.logs);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
              timestamp: Date.now(),
              logs: data.logs,
            }));
          } catch {}
        }
      }
    } catch (err) {
      console.error('[DebugPanel] Failed to fetch debug logs:', err);
    }
  }, []);

  // Intercept fetch to capture X-Debug-Id from /api/chat responses
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);

      // Only intercept /api/chat responses
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url;
      if (typeof url === 'string' && url.includes('/api/chat')) {
        const debugId = response.headers.get('X-Debug-Id');
        if (debugId) {
          // We need to wait for the stream to finish before fetching logs.
          // Clone the response to read the body without consuming it for the caller.
          // But we can't clone a streaming response — instead, track the debugId
          // and poll for logs after a delay.
          pendingDebugIdsRef.current.push(debugId);
          setLoading(true);

          // Poll for logs — the stream may take a while to finish
          const pollForLogs = async () => {
            for (let attempt = 0; attempt < 30; attempt++) {
              await new Promise(r => setTimeout(r, 1000));
              try {
                const res = await originalFetch(`/api/debug-logs?id=${debugId}`);
                if (res.ok) {
                  const data = await res.json();
                  if (data.logs?.length) {
                    setLogs(data.logs);
                    try {
                      localStorage.setItem(STORAGE_KEY, JSON.stringify({
                        timestamp: Date.now(),
                        logs: data.logs,
                      }));
                    } catch {}
                    setLoading(false);
                    return;
                  }
                }
              } catch {}
            }
            setLoading(false);
          };
          pollForLogs();
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // Load persisted logs on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.logs?.length) {
          setLogs(parsed.logs);
        }
      }
    } catch {}
  }, []);

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([]);
    setExpandedStep(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 right-0 w-[520px] max-h-[70vh] bg-zinc-950 text-zinc-200 border-l border-t border-zinc-700 z-50 flex flex-col shadow-2xl font-mono text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 font-bold">LLM Debug</span>
          <span className="text-zinc-500">{logs.length} steps</span>
          {loading && (
            <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearLogs}
            className="px-2 py-0.5 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => setVisible(false)}
            className="px-2 py-0.5 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Ctrl+D
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="p-4 text-zinc-500 text-center">
            {loading ? 'Waiting for LLM interaction...' : 'No LLM interactions yet. Send a message to see debug logs.'}
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.step} className="border-b border-zinc-800">
              {/* Step header */}
              <button
                onClick={() => setExpandedStep(expandedStep === log.step ? null : log.step)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded text-[10px] flex items-center justify-center font-bold shrink-0 ${
                    log.agent === 'developer' ? 'bg-purple-900 text-purple-300' : 'bg-blue-900 text-blue-300'
                  }`}>
                    {log.step}
                  </span>
                  <span className="text-zinc-300 font-semibold">{log.agent}</span>
                  <span className="text-zinc-600">|</span>
                  <span className="text-zinc-500 truncate">{log.model}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {log.response.usage && (
                      <span className="text-zinc-600">
                        {log.response.usage.inputTokens ?? '?'}+{log.response.usage.outputTokens ?? '?'}
                      </span>
                    )}
                    {log.response.toolCalls?.length ? (
                      <span className="text-cyan-400">
                        {log.response.toolCalls.length} tool{log.response.toolCalls.length > 1 ? 's' : ''}
                      </span>
                    ) : log.response.reasoningText ? (
                      <span className="text-purple-400">reason</span>
                    ) : log.response.text ? (
                      <span className="text-green-400">text</span>
                    ) : null}
                    <svg
                      className={`w-3 h-3 text-zinc-600 transition-transform ${expandedStep === log.step ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </div>
              </button>

              {/* Expanded detail */}
              {expandedStep === log.step && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Request: system instructions */}
                  {log.request.instructions && (
                    <div>
                      <div className="text-zinc-500 mb-1">System Instructions</div>
                      <details className="bg-zinc-900 rounded">
                        <summary className="px-2 py-1 cursor-pointer text-amber-400 hover:text-amber-300">
                          {log.request.instructions.slice(0, 80)}...
                        </summary>
                        <pre className="px-2 pb-2 text-zinc-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {log.request.instructions}
                        </pre>
                      </details>
                    </div>
                  )}
                  {/* Request: messages */}
                  <div>
                    <div className="text-zinc-500 mb-1">Request Messages ({log.request.messages.length})</div>
                    <div className="bg-zinc-900 rounded p-2 max-h-40 overflow-y-auto">
                      {log.request.messages.length === 0 ? (
                        <div className="text-zinc-600 italic">No messages captured</div>
                      ) : (
                        log.request.messages.map((msg: any, i: number) => (
                          <div key={i} className="mb-1 last:mb-0">
                            <span className={`font-bold ${
                              msg.role === 'user' ? 'text-blue-400' :
                              msg.role === 'assistant' ? 'text-green-400' :
                              msg.role === 'system' ? 'text-amber-400' :
                              'text-zinc-400'
                            }`}>
                              {msg.role}
                            </span>
                            <span className="text-zinc-500 ml-1">
                              {typeof msg.content === 'string'
                                ? msg.content.slice(0, 150) + (msg.content.length > 150 ? '...' : '')
                                : JSON.stringify(msg.content).slice(0, 150)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Request: tools available */}
                  <div>
                    <div className="text-zinc-500 mb-1">Available Tools ({log.request.tools.length})</div>
                    <div className="bg-zinc-900 rounded p-2 flex flex-wrap gap-1">
                      {log.request.tools.map((t: string) => (
                        <span key={t} className="px-1.5 py-0.5 bg-zinc-800 rounded text-cyan-400">{t}</span>
                      ))}
                    </div>
                  </div>

                  {/* Response */}
                  <div>
                    <div className="text-zinc-500 mb-1">Response</div>
                    <div className="bg-zinc-900 rounded p-2 max-h-60 overflow-y-auto space-y-1.5">
                      {/* Reasoning */}
                      {log.response.reasoningText && (
                        <div>
                          <span className="text-purple-400 font-bold">reasoning: </span>
                          <pre className="text-zinc-500 ml-2 whitespace-pre-wrap break-all mt-0.5 max-h-32 overflow-y-auto">
                            {log.response.reasoningText.slice(0, 1000)}{log.response.reasoningText.length > 1000 ? '...' : ''}
                          </pre>
                        </div>
                      )}
                      {/* Text */}
                      {log.response.text && (
                        <div>
                          <span className="text-green-400 font-bold">text: </span>
                          <span className="text-zinc-300">{log.response.text.slice(0, 300)}{log.response.text.length > 300 ? '...' : ''}</span>
                        </div>
                      )}
                      {/* Tool calls */}
                      {log.response.toolCalls?.map((tc: any, i: number) => (
                        <div key={i}>
                          <span className="text-cyan-400 font-bold">{tc.toolName}</span>
                          <pre className="text-zinc-400 ml-2 whitespace-pre-wrap break-all mt-0.5">
                            {JSON.stringify(tc.args, null, 2).slice(0, 500)}
                          </pre>
                        </div>
                      ))}
                      {/* Tool results */}
                      {log.response.toolResults?.map((tr: any, i: number) => (
                        <div key={i}>
                          <span className="text-amber-400 font-bold">{tr.toolName} result: </span>
                          <pre className="text-zinc-500 ml-2 whitespace-pre-wrap break-all mt-0.5">
                            {tr.result}
                          </pre>
                        </div>
                      ))}
                      {/* Finish reason & usage */}
                      <div className="flex items-center gap-3 text-zinc-600">
                        {log.response.finishReason && <span>finish: {log.response.finishReason}</span>}
                        {log.response.usage && (
                          <span>
                            tokens: {log.response.usage.inputTokens ?? '?'} in / {log.response.usage.outputTokens ?? '?'} out
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
