'use client';

import { useState, useEffect, useCallback } from 'react';

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

/** A single chat request, containing multiple steps */
interface RequestRound {
  id: string;
  agent: string;
  model: string;
  timestamp: number;
  steps: StepLog[];
}

const STORAGE_KEY = 'llm-debug-rounds';

/**
 * Fire this event when a chat response finishes, so DebugPanel can fetch logs.
 */
export function notifyDebugPanel(debugId: string) {
  window.dispatchEvent(new CustomEvent('chat-response-finished', { detail: { debugId } }));
}

/**
 * Temporary debug panel — Ctrl+D to toggle.
 * Accumulates LLM interaction logs across multiple requests.
 */
export function DebugPanel() {
  const [visible, setVisible] = useState(false);
  const [rounds, setRounds] = useState<RequestRound[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [expandedRound, setExpandedRound] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  // Listen for chat-response-finished event to fetch debug logs
  useEffect(() => {
    const handler = async (e: Event) => {
      const { debugId } = (e as CustomEvent).detail;
      if (!debugId) return;

      setLoading(true);
      await new Promise(r => setTimeout(r, 500));

      try {
        const res = await fetch(`/api/debug-logs?id=${debugId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.logs?.length) {
            const round: RequestRound = {
              id: debugId,
              agent: data.logs[0]?.agent ?? 'unknown',
              model: data.logs[0]?.model ?? 'unknown',
              timestamp: data.createdAt ?? Date.now(),
              steps: data.logs,
            };
            setRounds(prev => {
              const next = [...prev, round];
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              } catch {}
              return next;
            });
            // Auto-expand the latest round
            setExpandedRound(round.id);
          }
        }
      } catch (err) {
        console.error('[DebugPanel] Failed to fetch debug logs:', err);
      } finally {
        setLoading(false);
      }
    };

    window.addEventListener('chat-response-finished', handler);
    return () => window.removeEventListener('chat-response-finished', handler);
  }, []);

  // Load persisted rounds on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) {
          setRounds(parsed);
          // Auto-expand the last round
          setExpandedRound(parsed[parsed.length - 1]?.id ?? null);
        }
      }
    } catch {}
  }, []);

  // Clear logs
  const clearLogs = useCallback(() => {
    setRounds([]);
    setExpandedStep(null);
    setExpandedRound(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  // Total steps across all rounds
  const totalSteps = rounds.reduce((sum, r) => sum + r.steps.length, 0);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 right-0 w-[520px] max-h-[70vh] bg-zinc-950 text-zinc-200 border-l border-t border-zinc-700 z-50 flex flex-col shadow-2xl font-mono text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 font-bold">LLM Debug</span>
          <span className="text-zinc-500">{rounds.length} rounds, {totalSteps} steps</span>
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
        {rounds.length === 0 ? (
          <div className="p-4 text-zinc-500 text-center">
            {loading ? 'Waiting for LLM interaction...' : 'No LLM interactions yet. Send a message to see debug logs.'}
          </div>
        ) : (
          rounds.map((round, roundIdx) => {
            const isExpanded = expandedRound === round.id;
            const isDeveloper = round.agent === 'developer';
            const timeStr = new Date(round.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const stepKey = (stepIdx: number) => `${round.id}-${stepIdx}`;

            return (
              <div key={round.id} className={roundIdx > 0 ? 'border-t-2 border-amber-900/30' : ''}>
                {/* Round header */}
                <button
                  onClick={() => setExpandedRound(isExpanded ? null : round.id)}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800/50 transition-colors bg-zinc-900/30"
                >
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      isDeveloper ? 'bg-purple-900 text-purple-300' : 'bg-blue-900 text-blue-300'
                    }`}>
                      {round.agent.toUpperCase()}
                    </span>
                    <span className="text-zinc-400 font-semibold">#{roundIdx + 1}</span>
                    <span className="text-zinc-500 truncate">{round.model}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-zinc-600">{round.steps.length} steps</span>
                      <span className="text-zinc-700">{timeStr}</span>
                      <svg
                        className={`w-3 h-3 text-zinc-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </div>
                </button>

                {/* Steps within this round */}
                {isExpanded && round.steps.map((log, stepIdx) => {
                  const stepExpanded = expandedStep === stepKey(stepIdx);
                  return (
                    <div key={stepIdx} className="border-b border-zinc-800/50">
                      {/* Step header */}
                      <button
                        onClick={() => setExpandedStep(stepExpanded ? null : stepKey(stepIdx))}
                        className="w-full text-left px-3 py-1.5 pl-6 hover:bg-zinc-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded text-[10px] flex items-center justify-center font-bold shrink-0 ${
                            isDeveloper ? 'bg-purple-900/60 text-purple-400' : 'bg-blue-900/60 text-blue-400'
                          }`}>
                            {log.step}
                          </span>
                          <span className="text-zinc-500">{log.response.usage ? `${log.response.usage.inputTokens ?? '?'}+${log.response.usage.outputTokens ?? '?'}` : ''}</span>
                          {log.response.toolCalls?.length ? (
                            <span className="text-cyan-400">{log.response.toolCalls.length} tool{log.response.toolCalls.length > 1 ? 's' : ''}</span>
                          ) : log.response.reasoningText ? (
                            <span className="text-purple-400">reason</span>
                          ) : log.response.text ? (
                            <span className="text-green-400">text</span>
                          ) : null}
                          {log.response.finishReason && (
                            <span className="text-zinc-700 ml-auto">{log.response.finishReason}</span>
                          )}
                          <svg
                            className={`w-3 h-3 text-zinc-600 transition-transform ${stepExpanded ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {stepExpanded && (
                        <div className="px-3 pb-3 pl-6 space-y-2">
                          {/* System instructions */}
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
                          {/* Request messages */}
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
                          {/* Available tools */}
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
                              {log.response.reasoningText && (
                                <div>
                                  <span className="text-purple-400 font-bold">reasoning: </span>
                                  <pre className="text-zinc-500 ml-2 whitespace-pre-wrap break-all mt-0.5 max-h-32 overflow-y-auto">
                                    {log.response.reasoningText.slice(0, 1000)}{log.response.reasoningText.length > 1000 ? '...' : ''}
                                  </pre>
                                </div>
                              )}
                              {log.response.text && (
                                <div>
                                  <span className="text-green-400 font-bold">text: </span>
                                  <span className="text-zinc-300">{log.response.text.slice(0, 300)}{log.response.text.length > 300 ? '...' : ''}</span>
                                </div>
                              )}
                              {log.response.toolCalls?.map((tc: any, i: number) => (
                                <div key={i}>
                                  <span className="text-cyan-400 font-bold">{tc.toolName}</span>
                                  <pre className="text-zinc-400 ml-2 whitespace-pre-wrap break-all mt-0.5">
                                    {JSON.stringify(tc.args, null, 2).slice(0, 500)}
                                  </pre>
                                </div>
                              ))}
                              {log.response.toolResults?.map((tr: any, i: number) => (
                                <div key={i}>
                                  <span className="text-amber-400 font-bold">{tr.toolName} result: </span>
                                  <pre className="text-zinc-500 ml-2 whitespace-pre-wrap break-all mt-0.5">
                                    {tr.result}
                                  </pre>
                                </div>
                              ))}
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
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
