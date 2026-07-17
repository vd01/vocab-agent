'use client';

import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CommandSuggestions } from './command-suggestions';
import { ReviewReminderToggle } from '@/components/notification/review-reminder-toggle';

const MAX_ROWS = 5;
const LINE_HEIGHT = 24; // px, matches text-sm line-height roughly

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  handleSubmit: (e: FormEvent) => void;
  isLoading: boolean;
  onStop: () => void;
  onCommand: (command: string) => void;
  onReview?: () => void;
  onStats?: () => void;
  onClearChat?: () => void;
  devMode?: boolean;
  onDevModeChange?: (v: boolean) => void;
  dueCount?: number;
}

export function ChatInput({
  input,
  setInput,
  handleSubmit,
  isLoading,
  onStop,
  onCommand,
  onReview,
  onStats,
  onClearChat,
  devMode = false,
  onDevModeChange,
  dueCount,
}: ChatInputProps) {
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastActionRef = useRef(0);

  // Auto-resize textarea: grows with content, max 5 rows then scroll
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // Reset to auto to shrink if text was deleted
    el.style.height = 'auto';
    // Calculate max height = MAX_ROWS * line-height
    const maxHeight = MAX_ROWS * LINE_HEIGHT;
    // Set height to scrollHeight, capped at maxHeight
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    // Show scrollbar only when content exceeds max
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  // Compute filter from current input
  const commandFilter = input?.startsWith('/') && !input.includes(' ')
    ? input.slice(1)
    : '';

  // Debounced action handler — prevents rapid repeated clicks / keypresses
  const debouncedAction = useCallback((fn: () => void) => {
    const now = Date.now();
    if (now - lastActionRef.current < 1000) return; // 1s debounce
    lastActionRef.current = now;
    fn();
  }, []);

  useEffect(() => {
    if (input?.startsWith('/') && !input.includes(' ')) {
      setShowCommands(true);
    } else {
      setShowCommands(false);
    }
    setSelectedIndex(0);
  }, [input]);

  // Global keyboard shortcuts
  // Alt+R = review, Alt+S = stats, Ctrl+/ = focus input, Esc = clear input
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // Ctrl+/ → focus input (works even when input is not focused)
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Esc → clear input (only when input is focused)
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        e.preventDefault();
        setInput('');
        inputRef.current?.focus();
        return;
      }

      if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        debouncedAction(() => onReview?.());
      } else if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        debouncedAction(() => onStats?.());
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [onReview, onStats, debouncedAction, setInput]);

  const handleCommandSelect = useCallback((command: string) => {
    setInput('/' + command + ' ');
    setShowCommands(false);
    inputRef.current?.focus();
  }, [setInput]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter = newline (default textarea behavior), plain Enter = submit
    if (e.key === 'Enter' && !e.shiftKey && !showCommands) {
      e.preventDefault();
      if (input?.trim()) {
        onSubmit(e);
      }
      return;
    }

    if (!showCommands) return;

    // Get filtered count from DOM data attribute
    const listEl = document.querySelector('[data-command-list]');
    const count = listEl ? Number(listEl.getAttribute('data-command-count')) : 0;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % count);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + count) % count);
        break;
      case 'Tab':
      case 'Enter':
        if (count > 0) {
          e.preventDefault();
          const items = listEl?.querySelectorAll('[data-command-name]');
          const target = items?.[selectedIndex] as HTMLElement | undefined;
          const cmdName = target?.getAttribute('data-command-name');
          if (cmdName) {
            handleCommandSelect(cmdName);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowCommands(false);
        break;
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input?.trim()) return;
    handleSubmit(e);
    setShowCommands(false);
  };

  return (
    <div className="relative border-t bg-background">
      {/* Quick action buttons */}
      <div className="flex items-center gap-1.5 px-3 sm:px-4 pt-2 sm:pt-4 pb-1.5 sm:pb-2">
        <button
          type="button"
          onClick={() => debouncedAction(() => onReview?.())}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          title="开始复习"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 4v-5h-.581m0 0a8.003 8.003 0 01-15.357 2m15.357-2H15" />
          </svg>
          <span className="hidden sm:inline">复习</span>
          {dueCount !== undefined && dueCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
              {dueCount > 99 ? '99+' : dueCount}
            </span>
          )}
        </button>
        <div className="hidden sm:block">
          <ReviewReminderToggle
            onReviewFromNotification={() => onReview?.()}
            dueCount={dueCount}
          />
        </div>
        <button
          type="button"
          onClick={() => debouncedAction(() => onStats?.())}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          title="统计"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
          <span className="hidden sm:inline">统计</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('确定要清空所有聊天记录吗？此操作不可撤销。')) {
              onClearChat?.();
            }
          }}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          title="清空聊天记录"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span className="hidden sm:inline">清空</span>
        </button>
        {/* Dev mode switch — right-aligned, disabled during streaming */}
        <div className="ml-auto flex items-center gap-1">
          <Switch
            size="sm"
            checked={devMode}
            onCheckedChange={isLoading ? undefined : onDevModeChange}
            disabled={isLoading}
            className={devMode ? 'bg-orange-500 dark:bg-orange-500' : ''}
          />
          <span className={`hidden sm:inline text-xs font-medium ${devMode ? 'text-orange-600 dark:text-orange-400' : isLoading ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
            {devMode ? '开发中' : '开发'}
          </span>
        </div>
      </div>
      <div className="relative px-3 sm:px-4 pb-3 sm:pb-5">
        {showCommands && (
          <CommandSuggestions
            filter={commandFilter}
            onSelect={handleCommandSelect}
            selectedIndex={selectedIndex}
          />
        )}
        <form onSubmit={onSubmit} className="flex gap-2" autoComplete="off">
          <textarea
            ref={inputRef}
            value={input ?? ''}
            onChange={(e) => {
              setInput(e.target.value);
              // Sync adjust for paste/IME to avoid visual lag
              requestAnimationFrame(() => adjustHeight());
            }}
            onKeyDown={handleKeyDown}
            placeholder={devMode ? '描述你想添加或修改的功能...' : '输入消息或 / 命令...'}
            disabled={isLoading}
            autoComplete="off"
            rows={1}
            className="flex w-full min-w-0 resize-none rounded-2xl border border-input bg-transparent px-4 py-2.5 text-base leading-6 transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80"
          />
          {isLoading ? (
            <Button type="button" variant="outline" size="icon" onClick={onStop} className="h-10 w-10 shrink-0 self-end rounded-2xl">
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </Button>
          ) : (
            <Button type="submit" disabled={!input?.trim()} size="icon" className="h-10 w-10 shrink-0 self-end rounded-2xl">
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L6 12z" />
              </svg>
            </Button>
          )}
        </form>
        {/* 底部提示 */}
        <p className="text-[10px] text-muted-foreground/60 text-center mt-1.5">
          按 Enter 发送，Shift+Enter 换行
        </p>
      </div>
    </div>
  );
}
