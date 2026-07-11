'use client';

import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CommandSuggestions } from './command-suggestions';

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
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-2">
        <button
          type="button"
          onClick={() => debouncedAction(() => onReview?.())}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          title="开始复习 (Alt+R)"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 4v-5h-.581m0 0a8.003 8.003 0 01-15.357 2m15.357-2H15" />
          </svg>
          复习
          <kbd className="hidden sm:inline-flex items-center rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
            Alt+R
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => debouncedAction(() => onStats?.())}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          title="统计 (Alt+S)"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
          统计
          <kbd className="hidden sm:inline-flex items-center rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
            Alt+S
          </kbd>
        </button>
      </div>
      <div className="relative px-4 pb-5">
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
            placeholder="输入消息或 / 命令... (Shift+Enter 换行, Ctrl+/ 聚焦, Esc 清空)"
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
      </div>
    </div>
  );
}
