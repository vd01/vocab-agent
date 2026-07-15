'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { MessageList } from './message-list';
import { ChatInput } from './chat-input';
import { DebugPanel, notifyDebugPanel } from '@/components/debug/debug-panel';
import { useGroup } from '@/lib/groups/group-context';
import { NotificationManager } from '@/lib/notification/notification-manager';
import { ReviewPromptBanner, useAutoReviewPrompt } from '@/components/notification/review-prompt-banner';
import { useState, useCallback, useEffect, useRef } from 'react';

// Read at module level so Next.js can tree-shake when disabled
const DEBUG_PANEL_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PANEL === 'true';

// Dynamic re-import to get the latest loadGeneratedComponents after HMR
async function reloadComponents() {
  try {
    const mod = await import('@/components/generative/component-registry?t=' + Date.now());
    mod.loadGeneratedComponents();
  } catch {
    const mod = await import('@/components/generative/component-registry');
    mod.loadGeneratedComponents();
  }
}

export function ChatPanel() {
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Load initial messages from DB on mount
  useEffect(() => {
    fetch('/api/messages?limit=20')
      .then(r => r.json())
      .then(data => {
        // DB returns DESC (newest first), reverse to chronological order
        setInitialMessages(data.messages?.reverse() || []);
        setHasMore(data.hasMore ?? false);
      })
      .catch(() => {
        setInitialMessages([]); // proceed even if load fails
      });
  }, []);

  // Show loading until initial messages are fetched
  if (initialMessages === null) {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-muted-foreground">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <ChatInner
      initialMessages={initialMessages}
      initialHasMore={hasMore}
    />
  );
}

/**
 * Inner component that renders useChat only after initial messages are loaded.
 * This ensures useChat's Chat is initialized with the correct messages.
 */
function ChatInner({ initialMessages, initialHasMore }: {
  initialMessages: UIMessage[];
  initialHasMore: boolean;
}) {
  // devMode ref — used by transport body to read current mode at request time
  const devModeRef = useRef(false);
  const { activeGroup } = useGroup();
  // Track activeGroup via ref so tryExecuteCommand always reads the latest value
  const activeGroupRef = useRef(activeGroup);
  activeGroupRef.current = activeGroup;

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => {
        const switched = modeSwitchedRef.current;
        modeSwitchedRef.current = false;
        return { mode: devModeRef.current ? 'develop' : 'teach', modeSwitched: switched, activeGroup: activeGroup || null };
      },
    }),
    messages: initialMessages,
    onFinish: () => {
      // Debounced save: wait 500ms after last finish to batch saves
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveMessagesToDb();
      }, 500);
      // Notify debug panel to fetch logs (now that stream has ended)
      if (DEBUG_PANEL_ENABLED && debugIdRef.current) {
        notifyDebugPanel(debugIdRef.current);
        debugIdRef.current = null;
      }
    },
  });

  const [input, setInput] = useState('');
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [devMode, setDevModeState] = useState(false);
  const modeSwitchedRef = useRef(false);
  const setDevMode = useCallback((v: boolean) => {
    if (devModeRef.current !== v) {
      modeSwitchedRef.current = true;
    }
    devModeRef.current = v;
    setDevModeState(v);
  }, []);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const [dueBreakdown, setDueBreakdown] = useState<{ newDue: number; reviewDue: number; newQueued: number }>({ newDue: 0, reviewDue: 0, newQueued: 0 });
  const { showPrompt, dismiss: dismissPrompt, markReviewDone } = useAutoReviewPrompt(dueCount);
  const prevStatusRef = useRef<string>(status);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(messages);
  const debugIdRef = useRef<string | null>(null);
  messagesRef.current = messages;

  // Intercept fetch to capture X-Debug-Id from /api/chat responses (only when debug panel is enabled)
  useEffect(() => {
    if (!DEBUG_PANEL_ENABLED) return;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url;
      if (typeof url === 'string' && url.includes('/api/chat')) {
        const debugId = response.headers.get('X-Debug-Id');
        if (debugId) {
          debugIdRef.current = debugId;
        }
      }
      return response;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  // Load generated components on mount
  useEffect(() => {
    reloadComponents();
  }, []);

  // Initialize NotificationManager and fetch initial due count
  useEffect(() => {
    const nm = NotificationManager.getInstance();
    nm.init();

    // Fetch initial due count with breakdown
    const fetchDueInfo = async () => {
      try {
        const res = await fetch('/api/review-due');
        if (res.ok) {
          const data = await res.json();
          setDueCount(data.due ?? 0);
          setDueBreakdown({ newDue: data.newDue ?? 0, reviewDue: data.reviewDue ?? 0, newQueued: data.newQueued ?? 0 });
        }
      } catch {}
    };
    fetchDueInfo();

    // Subscribe to due words changes from scheduler
    const unsub = nm.onDueWords((count) => {
      setDueCount(count);
    });

    // Periodically refresh due count (every 5 minutes, lightweight)
    const dueCountTimer = setInterval(fetchDueInfo, 5 * 60 * 1000);

    // Listen for review events from ReviewSession — refresh due count immediately
    const onWordRated = () => {
      // Debounce: wait 1s after last rate to batch rapid keypresses
      if (rateRefreshTimerRef.current) clearTimeout(rateRefreshTimerRef.current);
      rateRefreshTimerRef.current = setTimeout(fetchDueInfo, 1000);
    };
    const onSessionCompleted = () => {
      // Immediate refresh on session complete
      fetchDueInfo();
    };
    window.addEventListener('review-word-rated', onWordRated);
    window.addEventListener('review-session-completed', onSessionCompleted);

    return () => {
      unsub();
      clearInterval(dueCountTimer);
      if (rateRefreshTimerRef.current) clearTimeout(rateRefreshTimerRef.current);
      window.removeEventListener('review-word-rated', onWordRated);
      window.removeEventListener('review-session-completed', onSessionCompleted);
    };
  }, []);

  // Reload components after each Agent conversation ends
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === 'streaming' && status === 'ready') {
      reloadComponents();
    }
  }, [status]);

  const isLoading = status === 'submitted' || status === 'streaming';

  // Save current messages to DB
  const saveMessagesToDb = useCallback(async () => {
    try {
      const currentMessages = messagesRef.current;
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: currentMessages, agentType: devModeRef.current ? 'developer' : 'teacher' }),
      });
      const result = await res.json();
      if (result.saved > 0) {
        console.log(`[ChatPanel] Saved ${result.saved} messages to DB`);
      }
    } catch (err) {
      console.error('[ChatPanel] Failed to save messages:', err);
    }
  }, []);

  // Load more (older) messages on scroll to top
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);

    try {
      // Use the oldest message's seq as cursor
      const oldest = messages[0];
      const cursor = (oldest as any)?.seq;

      const res = await fetch(`/api/messages?cursor=${cursor}&limit=20`);
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        // DB returns DESC, reverse to chronological, then prepend
        const older = data.messages.reverse();
        setMessages(prev => [...older, ...prev]);
        setHasMore(data.hasMore ?? false);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('[ChatPanel] Failed to load more messages:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages, setMessages]);

  /**
   * Try to execute a / command directly. Returns true if the command exists
   * and was executed (or attempted), false if the command is unknown
   * (caller should then send to LLM Agent).
   */
  const tryExecuteCommand = useCallback(async (command: string): Promise<boolean> => {
    const cmdName = command.split(/\s+/)[0].slice(1); // strip leading /

    // Inject active group into /review and /stats if not already specified
    let finalCommand = command;
    const currentGroup = activeGroupRef.current;
    if (currentGroup) {
      if (cmdName === 'review') {
        // /review → /review <group>, /review 5 → /review 5 <group>
        // Only inject if group name not already present as an arg
        const args = command.split(/\s+/).slice(1);
        const hasGroupArg = args.some(a => !/^\d+$/.test(a));
        if (!hasGroupArg) {
          const numArg = args.find(a => /^\d+$/.test(a));
          finalCommand = numArg
            ? `/review ${numArg} ${currentGroup}`
            : `/review ${currentGroup}`;
        }
      } else if (cmdName === 'stats') {
        // /stats → /stats <group> (only if no args yet)
        const args = command.split(/\s+/).slice(1);
        if (args.length === 0) {
          finalCommand = `/stats ${currentGroup}`;
        }
      }
    }

    // Add user message to chat
    const userMsg = {
      id: `cmd-user-${Date.now()}`,
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: command }],
    };
    setMessages(prev => [...prev, userMsg as any]);

    try {
      // Call command API
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: finalCommand }),
      });

      let result: any;
      const contentType = res.headers.get('content-type');
      const responseText = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${responseText.slice(0, 200)}`);
      }
      if (contentType?.includes('application/json')) {
        result = JSON.parse(responseText);
      } else {
        throw new Error(`Expected JSON, got ${contentType}: ${responseText.slice(0, 200)}`);
      }

      // If command is unknown, remove the user message and return false
      // so the caller can send it to the LLM Agent instead
      if (result.type === 'unknown-command') {
        setMessages(prev => prev.filter(m => m.id !== userMsg.id));
        return false;
      }

      // Wrap result as assistant message with AI SDK V7 tool part
      // type = 'tool-<name>', state = 'output-available', output = result
      const assistantMsg = {
        id: `cmd-result-${Date.now()}`,
        role: 'assistant' as const,
        parts: [{
          type: `tool-${cmdName}` as const,
          toolCallId: `cmd-${Date.now()}`,
          toolName: cmdName,
          state: 'output-available' as const,
          input: {},
          output: result,
        }],
      };
      setMessages(prev => [...prev, assistantMsg as any]);

      // Save command messages to DB
      setTimeout(() => {
        fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [userMsg, assistantMsg], agentType: devModeRef.current ? 'developer' : 'teacher' }),
        }).catch(err => console.error('[ChatPanel] Failed to save command messages:', err));
      }, 100);

      return true;
    } catch (err) {
      // Show error as assistant message
      const errorMsg = {
        id: `cmd-error-${Date.now()}`,
        role: 'assistant' as const,
        parts: [{
          type: 'text' as const,
          text: `命令执行失败: ${err instanceof Error ? err.message : String(err)}`,
        }],
      };
      setMessages(prev => [...prev, errorMsg as any]);
      return true; // Command existed but failed — don't send to Agent
    }
  }, [setMessages]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input?.trim()) return;

    const trimmed = input.trim();

    // / commands → try direct execution first; if unknown, fall through to LLM
    if (trimmed.startsWith('/')) {
      if (!devModeRef.current) {
        // Teach mode: always execute directly (no LLM fallback for unknown commands)
        tryExecuteCommand(trimmed);
        setInput('');
        return;
      }
      // Dev mode: try direct execution; if command doesn't exist, send to Agent
      // (so Developer can handle requests like "帮我创建一个 /xxx 命令")
      tryExecuteCommand(trimmed).then(executed => {
        if (!executed) {
          // Unknown command — send to Developer Agent
          sendMessage({ text: input });
        }
      });
      setInput('');
      return;
    }

    // Natural language → LLM Agent
    sendMessage({ text: input });
    setInput('');
  }, [input, sendMessage, tryExecuteCommand]);

  const handleCommand = useCallback((command: string) => {
    setInput(command + ' ');
  }, []);

  const handleReview = useCallback(() => {
    markReviewDone();
    tryExecuteCommand('/review');
  }, [tryExecuteCommand, markReviewDone]);

  const handleStats = useCallback(() => {
    tryExecuteCommand('/stats');
  }, [tryExecuteCommand]);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Auto-review prompt banner */}
      {showPrompt && dueCount > 0 && !devMode && (
        <ReviewPromptBanner
          dueCount={dueCount}
          newDue={dueBreakdown.newDue}
          reviewDue={dueBreakdown.reviewDue}
          newQueued={dueBreakdown.newQueued}
          onStartReview={() => {
            markReviewDone();
            tryExecuteCommand('/review');
          }}
          onDismiss={dismissPrompt}
        />
      )}
      <div className="flex-1 overflow-hidden">
        <div className="max-w-3xl mx-auto h-full">
          <MessageList
            messages={messages}
            isLoading={isLoading}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
          />
        </div>
      </div>
      <div className="max-w-3xl mx-auto w-full">
        <ChatInput
          input={input}
          setInput={setInput}
          handleSubmit={handleSubmit}
          isLoading={isLoading}
          onStop={stop}
          onCommand={handleCommand}
          onReview={handleReview}
          onStats={handleStats}
          devMode={devMode}
          onDevModeChange={setDevMode}
          dueCount={dueCount}
        />
      </div>
      {/* Debug panel — Ctrl+D to toggle, only when NEXT_PUBLIC_DEBUG_PANEL=true */}
      {DEBUG_PANEL_ENABLED && <DebugPanel />}
    </div>
  );
}
