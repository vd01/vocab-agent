'use client';

import { useState, useEffect, useRef, type Ref } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PronounceButton, type PronounceButtonHandle } from '@/components/vocab/pronounce-button';

interface WordCardProps {
  wordId: string;
  word: string;
  phonetic: string | null;
  audioUrl?: string | null;
  definition: string;
  examples: string | null;
  groups?: string[];  // Group names the word belongs to
  flipped?: boolean;
  onFlip?: () => void;
  fixedHeight?: string;
  fixedWidth?: string;
  topRightSlot?: React.ReactNode;
  /** Optional ref to the front-face pronunciation button (e.g. for keyboard hotkey). */
  pronounceRef?: Ref<PronounceButtonHandle>;
}

export function WordCard({ wordId, word, phonetic, audioUrl, definition, examples, groups, flipped: controlledFlipped, onFlip, fixedHeight, fixedWidth, topRightSlot, pronounceRef }: WordCardProps) {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const isFlipped = controlledFlipped !== undefined ? controlledFlipped : internalFlipped;
  const handleFlip = onFlip !== undefined
    ? onFlip
    : () => setInternalFlipped(f => !f);

  // Space key to flip — only for uncontrolled (standalone) cards
  useEffect(() => {
    if (controlledFlipped !== undefined) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === ' ' && cardRef.current && document.activeElement && cardRef.current.contains(document.activeElement)) {
        e.preventDefault();
        setInternalFlipped(f => !f);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [controlledFlipped]);

  let parsedExamples: string[] = [];
  try {
    parsedExamples = examples ? JSON.parse(examples) : [];
  } catch {
    parsedExamples = examples ? [examples] : [];
  }

  let parsedDefinition = definition;
  try {
    const parsed = JSON.parse(definition);
    if (typeof parsed === 'object') {
      parsedDefinition = JSON.stringify(parsed, null, 2);
    }
  } catch {
    // definition is already a string
  }

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="cursor-pointer select-none focus:outline-none relative"
      onClick={handleFlip}
      style={{ perspective: '600px', ...(fixedWidth ? { width: fixedWidth } : {}) }}
    >
      {topRightSlot && (
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          {topRightSlot}
        </div>
      )}
      {/*
        Grid stacking: both faces occupy the same grid cell.
        When fixedHeight is set, both faces use that exact height.
        Otherwise, container height = max(front height, back height).
      */}
      <div
        className="grid transition-transform duration-300"
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          ...(fixedHeight ? { height: fixedHeight } : { maxHeight: '300px' }),
        }}
      >
        {/* Front face */}
        <Card
          className="row-start-1 col-start-1 transition-shadow duration-300 hover:shadow-md"
          style={{ backfaceVisibility: 'hidden', ...(fixedHeight ? { height: fixedHeight } : {}) }}
        >
          <CardContent className="p-4 h-full flex items-center justify-center">
            <div className="text-center py-4">
              <h3 className="text-2xl font-bold text-foreground">{word}</h3>
              {phonetic && (
                <div className="flex items-center justify-center gap-1 mt-1">
                  <p className="text-sm text-muted-foreground">{phonetic}</p>
                  <PronounceButton ref={pronounceRef} word={word} audioUrl={audioUrl} />
                </div>
              )}
              {!phonetic && (
                <div className="flex items-center justify-center mt-1">
                  <PronounceButton ref={pronounceRef} word={word} audioUrl={audioUrl} />
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-4">
                点击或按空格键翻转查看释义
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Back face — same grid cell, rotated 180deg so it shows when container flips */}
        <Card
          className="row-start-1 col-start-1 transition-shadow duration-300 hover-hidden"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            ...(fixedHeight ? { height: fixedHeight } : {}),
          }}
        >
          <CardContent className="p-4 overflow-y-auto scrollbar-thin" style={fixedHeight ? { height: fixedHeight } : { maxHeight: '300px' }}>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-foreground">{word}</h3>
                {phonetic && (
                  <Badge variant="secondary" className="text-xs">{phonetic}</Badge>
                )}
                <PronounceButton word={word} audioUrl={audioUrl} />
              </div>
              <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                {parsedDefinition}
              </div>
              {parsedExamples.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">例句:</p>
                  {parsedExamples.map((ex, i) => (
                    <p key={i} className="text-xs text-muted-foreground italic pl-2 border-l-2 border-muted whitespace-pre-wrap break-words">
                      {ex}
                    </p>
                  ))}
                </div>
              )}
              {groups && groups.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {groups.map(g => (
                    <span key={g} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                点击或按空格键翻转回正面
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
