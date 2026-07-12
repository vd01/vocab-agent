'use client';

import { useState, useCallback } from 'react';
import { notifyPinChange } from './pin-events';

interface PinButtonProps {
  wordId: string;
  word: string;
}

export function PinButton({ wordId, word }: PinButtonProps) {
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePin = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordId, side: 'left' }),
      });

      const data = await res.json();

      if (res.status === 409 && data.error?.includes('已满')) {
        const tryRight = await fetch('/api/pins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wordId, side: 'right' }),
        });
        const rightData = await tryRight.json();
        if (tryRight.ok) {
          setPinned(true);
          notifyPinChange();
        } else {
          setError(rightData.error || '两侧都已满');
        }
      } else if (res.status === 409 && data.error?.includes('already')) {
        setPinned(true);
      } else if (res.ok) {
        setPinned(true);
        notifyPinChange();
      } else {
        setError(data.error || '置顶失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, [wordId, loading]);

  if (pinned) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-primary cursor-default select-none">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
        </svg>
        已置顶
      </span>
    );
  }

  return (
    <button
      onClick={handlePin}
      disabled={loading}
      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 select-none"
      title={`置顶 "${word}" 到侧边栏`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
      </svg>
      {loading ? '...' : error ? '!' : '置顶'}
    </button>
  );
}
