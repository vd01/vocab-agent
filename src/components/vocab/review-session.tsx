'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { WordCard } from '@/components/vocab/word-card';
import { FsrsButtons } from '@/components/vocab/fsrs-buttons';
import { PinButton } from '@/components/pinned/pin-button';

interface ReviewWord {
  wordId: string;
  word: string;
  phonetic: string | null;
  definition: string;
  examples: string | null;
}

interface RateResult {
  wordId: string;
  word: string;
  rating: number;
  ratingLabel: string;
  scheduledDays: number;
}

const RATING_LABELS: Record<number, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

interface ReviewSessionProps {
  words: ReviewWord[];
}

// Global counter: only the most recently mounted ReviewSession handles keyboard
let activeSessionId = 0;

export function ReviewSession({ words }: ReviewSessionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<RateResult[]>([]);
  const [phase, setPhase] = useState<'reviewing' | 'completed'>('reviewing');
  const [rating, setRating] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);

  // Each instance gets a unique id; only the latest one handles keys
  // Use mountedRef to ensure ++activeSessionId runs exactly once per instance
  const sessionIdRef = useRef(0);
  const mountedRef = useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
    sessionIdRef.current = ++activeSessionId;
  }

  // Refs for keyboard handler to always access latest state
  const ratingRef = useRef(rating);
  ratingRef.current = rating;
  const flippedRef = useRef(flipped);
  flippedRef.current = flipped;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const wordsRef = useRef(words);
  wordsRef.current = words;

  const handleRate = useCallback(async (wordId: string, ratingValue: number) => {
    // Note: caller is responsible for preventing double-rate (via ratingRef sync)
    setRating(ratingValue);

    const idx = currentIndexRef.current;
    const currentWord = wordsRef.current[idx];

    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: `/rate ${wordId} ${ratingValue}` }),
      });
      const result = await res.json();

      const rateResult: RateResult = {
        wordId,
        word: currentWord.word,
        rating: ratingValue,
        ratingLabel: RATING_LABELS[ratingValue] || String(ratingValue),
        scheduledDays: result.scheduledDays ?? 0,
      };

      setResults(prev => [...prev, rateResult]);

      setTimeout(() => {
        const nextIndex = idx + 1;
        if (nextIndex >= wordsRef.current.length) {
          setPhase('completed');
        } else {
          setCurrentIndex(nextIndex);
          setRating(null);
          setFlipped(false);
        }
      }, 600);
    } catch (err) {
      console.error('[ReviewSession] Rate failed:', err);
      setRating(null);
    }
  }, []); // No deps — uses refs for all state access

  // Unified keyboard handler — only the latest ReviewSession instance responds
  // Registered once, never re-registered (all state via refs)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only the most recently mounted session handles keys
      if (sessionIdRef.current !== activeSessionId) return;

      // Don't intercept when an input/textarea is focused
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      // Only handle keys when reviewing
      if (phaseRef.current !== 'reviewing') return;

      // Space → flip card
      if (e.key === ' ') {
        e.preventDefault();
        if (ratingRef.current === null) {
          const newFlipped = !flippedRef.current;
          flippedRef.current = newFlipped; // Sync ref immediately
          setFlipped(newFlipped);
        }
        return;
      }

      // A/S/D/F → rate (only after card is flipped, so user has seen the answer)
      const ratingMap: Record<string, number> = { a: 1, s: 2, d: 3, f: 4 };
      const ratingValue = ratingMap[e.key.toLowerCase()];
      if (ratingValue !== undefined) {
        e.preventDefault();
        if (flippedRef.current && ratingRef.current === null) {
          const wordId = wordsRef.current[currentIndexRef.current]?.wordId;
          if (wordId) {
            ratingRef.current = ratingValue; // Sync ref immediately to prevent double-rate from rapid keypresses
            setRating(ratingValue);
            handleRate(wordId, ratingValue);
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRate]); // handleRate is stable (empty deps)

  // ── Completed: show summary ──────────────────────────────────────────
  if (phase === 'completed') {
    return (
      <div className="space-y-3">
        <div className="text-sm font-medium text-foreground">
          复习完成！共 {results.length} 个单词
        </div>
        <div className="space-y-1">
          {results.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-muted last:border-0">
              <span className="font-medium">{r.word}</span>
              <span className="flex items-center gap-2">
                <span className={
                  r.rating === 1 ? 'text-red-500' :
                  r.rating === 2 ? 'text-yellow-500' :
                  r.rating === 3 ? 'text-green-500' :
                  'text-blue-500'
                }>
                  {r.ratingLabel}
                </span>
                <span className="text-muted-foreground">{r.scheduledDays}天后</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Reviewing: show one card at a time ───────────────────────────────
  const currentWord = words[currentIndex];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{currentIndex + 1} / {words.length}</span>
        {rating && (
          <span className={
            rating === 1 ? 'text-red-500' :
            rating === 2 ? 'text-yellow-500' :
            rating === 3 ? 'text-green-500' :
            'text-blue-500'
          }>
            {RATING_LABELS[rating]}
          </span>
        )}
      </div>
      <div className="relative mx-auto" style={{ width: '400px' }}>
        <WordCard
          key={currentWord.wordId}
          wordId={currentWord.wordId}
          word={currentWord.word}
          phonetic={currentWord.phonetic}
          definition={currentWord.definition}
          examples={currentWord.examples}
          flipped={flipped}
          onFlip={() => {
            if (rating === null) setFlipped(f => !f);
          }}
          fixedHeight="280px"
          fixedWidth="400px"
        />
        {flipped && (
          <div className="absolute top-2 right-2 z-10">
            <PinButton wordId={currentWord.wordId} word={currentWord.word} />
          </div>
        )}
      </div>
      <FsrsButtons
        wordId={currentWord.wordId}
        onRate={(wordId, ratingValue) => {
          if (ratingRef.current !== null) return; // prevent double-rate from button clicks
          ratingRef.current = ratingValue; // Sync ref immediately
          setRating(ratingValue);
          handleRate(wordId, ratingValue);
        }}
        pendingRating={rating}
      />
      {!flipped && (
        <p className="text-xs text-muted-foreground text-center">
          按空格键翻转卡片，翻转后按 A/S/D/F 评分
        </p>
      )}
      {flipped && rating === null && (
        <p className="text-xs text-muted-foreground text-center">
          按 A(Again) S(Hard) D(Good) F(Easy) 评分
        </p>
      )}
    </div>
  );
}
