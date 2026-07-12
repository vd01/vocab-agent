'use client';

import { type UIMessage } from 'ai';
import { MessageItem } from './message-item';
import { useRef, useEffect, useCallback } from 'react';

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

export function MessageList({ messages, isLoading, hasMore, loadingMore, onLoadMore }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const scrollHeightBeforeLoadRef = useRef<number | null>(null);
  const initialScrollDoneRef = useRef(false);

  // Initial scroll to bottom when messages first load
  useEffect(() => {
    if (messages.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      // Use requestAnimationFrame to ensure DOM layout is complete
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      });
    }
  }, [messages.length]);

  // Auto-scroll to bottom when new messages are appended at the end
  // Only auto-scroll if user is already near the bottom
  useEffect(() => {
    if (!initialScrollDoneRef.current) return; // Skip until initial scroll is done

    const count = messages.length;
    const prevCount = prevMessageCountRef.current;

    if (count > prevCount) {
      // Check if new messages were prepended (load more) or appended (new message)
      if (scrollHeightBeforeLoadRef.current !== null) {
        // Restoring position after load-more prepend
        const container = containerRef.current;
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - scrollHeightBeforeLoadRef.current;
        }
        scrollHeightBeforeLoadRef.current = null;
      } else if (isNearBottomRef.current) {
        // New message at bottom — auto-scroll
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }

    prevMessageCountRef.current = count;
  }, [messages]);

  // Auto-scroll during streaming — content grows within the same message
  useEffect(() => {
    if (!isLoading || !isNearBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }); // No deps — runs on every render while streaming

  // Track whether user is near the bottom + detect scroll to top
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isNearBottomRef.current = distanceFromBottom < 100;

    // Detect scroll to top → load more
    if (scrollTop <= 50 && hasMore && !loadingMore && onLoadMore) {
      // Record scroll height before loading so we can restore position after
      scrollHeightBeforeLoadRef.current = scrollHeight;
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // Show "思考中..." only when loading but no assistant message has appeared yet
  const lastMsg = messages[messages.length - 1];
  const waitingForResponse = isLoading && (messages.length === 0 || lastMsg?.role !== 'assistant');

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full overflow-y-auto scrollbar-thin"
      onScroll={handleScroll}
    >
      {/* Top loading indicator */}
      {hasMore && (
        <div className="flex items-center justify-center py-3">
          {loadingMore ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              加载更多消息...
            </div>
          ) : (
            <div className="text-xs text-muted-foreground/50">上滑加载更多</div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-6">
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold text-foreground tracking-tight">
                英语学习助手
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto text-sm leading-relaxed">
                输入单词开始学习，或使用 /review 开始复习。
                你也可以用自然语言和我聊天！
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center text-sm">
              <span className="px-4 py-2 bg-muted rounded-xl text-foreground/80 hover:bg-muted/80 transition-colors cursor-default">/review 复习</span>
              <span className="px-4 py-2 bg-muted rounded-xl text-foreground/80 hover:bg-muted/80 transition-colors cursor-default">/add 添加单词</span>
              <span className="px-4 py-2 bg-muted rounded-xl text-foreground/80 hover:bg-muted/80 transition-colors cursor-default">/pin 置顶单词</span>
              <span className="px-4 py-2 bg-muted rounded-xl text-foreground/80 hover:bg-muted/80 transition-colors cursor-default">/stats 统计</span>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col">
        {messages.map((message, i) => {
          // Find the last message that contains a review session (due-words)
          const isLastReview = (() => {
            // Check if this message has a due-words tool output (AI SDK v7: type starts with 'tool-')
            const hasReview = message.parts?.some(
              (p: any) => typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'output-available' && p.output?.type === 'due-words'
            );
            if (!hasReview) return true; // Not a review — pass through (doesn't matter)

            // Check if any later message also has a review
            for (let j = i + 1; j < messages.length; j++) {
              const laterHasReview = messages[j].parts?.some(
                (p: any) => typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'output-available' && p.output?.type === 'due-words'
              );
              if (laterHasReview) return false;
            }
            return true; // No later review — this is the latest
          })();

          return (
            <MessageItem
              key={message.id}
              message={message}
              isLastAssistant={message.role === 'assistant' && i === messages.length - 1}
              isStreaming={isLoading}
              isLastReview={isLastReview}
            />
          );
        })}
      </div>
      {waitingForResponse && (
        <div className="flex items-start gap-3 px-4 py-5">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground pt-1">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" />
            </div>
            <span className="text-sm">思考中...</span>
          </div>
        </div>
      )}
      {/* Anchor for auto-scroll */}
      <div ref={bottomRef} />
    </div>
  );
}
