'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface ReviewPromptBannerProps {
  dueCount: number;
  newDue?: number;
  reviewDue?: number;
  newQueued?: number;
  onStartReview: () => void;
  onDismiss: () => void;
}

/**
 * A system-prompt banner that appears in the chat when there are due words.
 * Styled distinctly from normal messages — amber/yellow background.
 * Not sent to the LLM — purely a frontend UI element.
 */
export function ReviewPromptBanner({ dueCount, newDue, reviewDue, newQueued, onStartReview, onDismiss }: ReviewPromptBannerProps) {
  const hasBreakdown = newDue !== undefined && reviewDue !== undefined && (newDue > 0 || reviewDue > 0);

  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-4 py-1.5 sm:py-2">
      <div className="flex items-center gap-2 sm:gap-3 rounded-lg sm:rounded-xl border border-amber-200/70 bg-amber-50/80 px-3 sm:px-4 py-2 sm:py-3 dark:border-amber-800/70 dark:bg-amber-950/40">
        <div className="flex-shrink-0 hidden sm:block">
          <span className="inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-amber-100 dark:bg-amber-900">
            <svg className="size-3.5 sm:size-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm font-medium text-amber-800 dark:text-amber-200">
            <span className="sm:hidden">⏱ </span>
            你有 <span className="font-bold">{dueCount}</span> 个单词待复习
            {hasBreakdown && (
              <span className="ml-1 font-normal text-amber-600/80 dark:text-amber-400/80">
                （新词 {newDue} · 复习 {reviewDue}）
              </span>
            )}
          </p>
          <p className="text-[10px] sm:text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5 hidden sm:block">
            {newQueued && newQueued > 0
              ? `还有 ${newQueued} 个新词排队中，将按每日配额逐步释放`
              : '及时复习能显著提升记忆效果'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <button
            onClick={onStartReview}
            className="inline-flex items-center gap-1 rounded-md sm:rounded-lg bg-amber-600 px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors dark:bg-amber-700 dark:hover:bg-amber-600"
          >
            <svg className="size-3 sm:size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 4v-5h-.581m0 0a8.003 8.003 0 01-15.357 2m15.357-2H15" />
            </svg>
            <span className="hidden sm:inline">开始复习</span>
          </button>
          <button
            onClick={onDismiss}
            className="inline-flex items-center justify-center rounded-md sm:rounded-lg p-1 sm:p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-100 transition-colors dark:text-amber-400 dark:hover:text-amber-300 dark:hover:bg-amber-900"
            title="暂时忽略"
          >
            <svg className="size-3.5 sm:size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage the auto-review prompt logic:
 * - Show banner when dueCount > 0
 * - Don't re-show in the same session after dismissal
 * - Re-show if dueCount increases after a review session
 */
export function useAutoReviewPrompt(dueCount: number) {
  const [showPrompt, setShowPrompt] = useState(false);
  const dismissedAtRef = useRef(0);       // timestamp when last dismissed
  const lastShownDueRef = useRef(0);      // dueCount when last shown
  const lastReviewDoneRef = useRef(0);    // timestamp when last review completed

  useEffect(() => {
    if (dueCount <= 0) {
      setShowPrompt(false);
      return;
    }

    const now = Date.now();
    const timeSinceDismiss = now - dismissedAtRef.current;

    // Show prompt if:
    // 1. Never shown before (lastShownDueRef === 0)
    // 2. Due count increased since last shown (new words became due)
    // 3. A review was completed and there are still due words
    // 4. Not dismissed in the last 10 minutes
    const shouldShow =
      (lastShownDueRef.current === 0 && timeSinceDismiss > 10 * 60 * 1000) ||
      (dueCount > lastShownDueRef.current && timeSinceDismiss > 10 * 60 * 1000) ||
      (lastReviewDoneRef.current > dismissedAtRef.current);

    if (shouldShow) {
      setShowPrompt(true);
      lastShownDueRef.current = dueCount;
    }
  }, [dueCount]);

  const dismiss = useCallback(() => {
    setShowPrompt(false);
    dismissedAtRef.current = Date.now();
  }, []);

  const markReviewDone = useCallback(() => {
    lastReviewDoneRef.current = Date.now();
    // Don't immediately re-show — let the next dueCount change trigger it
  }, []);

  return { showPrompt, dismiss, markReviewDone };
}
