'use client';

import { useState, useCallback, useImperativeHandle, forwardRef, useEffect } from 'react';
import { notifyPinChange } from './pin-events';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface PinButtonProps {
  wordId: string;
  word: string;
  initialPinned?: boolean;
}

export interface PinButtonRef {
  toggle: () => void;
}

export const PinButton = forwardRef<PinButtonRef, PinButtonProps>(function PinButton({ wordId, word, initialPinned = false }, ref) {
  const [pinned, setPinned] = useState(initialPinned);
  const [pinId, setPinId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    setPinned(initialPinned);
    setPinId(null);
    setError(null);
    setShowError(false);
  }, [wordId, initialPinned]);

  useEffect(() => {
    if (error) {
      setShowError(true);
      const timer = setTimeout(() => setShowError(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handlePin = useCallback(async () => {
    if (loading || pinned) return;
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
          setPinId(rightData.pin?.id ?? null);
          notifyPinChange();
        } else {
          setError(rightData.error || '两侧都已满');
        }
      } else if (res.status === 409 && data.error?.includes('already')) {
        setPinned(true);
        setPinId(data.pin?.id ?? null);
      } else if (res.ok) {
        setPinned(true);
        setPinId(data.pin?.id ?? null);
        notifyPinChange();
      } else {
        setError(data.error || '置顶失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, [wordId, loading, pinned]);

  const handleUnpin = useCallback(async () => {
    if (loading || !pinned) return;
    setLoading(true);
    setError(null);
    setConfirmOpen(false);

    try {
      let idToDelete = pinId;
      if (!idToDelete) {
        const listRes = await fetch('/api/pins');
        const listData = await listRes.json();
        const found = (listData.pins || []).find((p: any) => p.wordId === wordId);
        if (found) idToDelete = found.id;
      }
      if (!idToDelete) {
        setPinned(false);
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/pins?id=${idToDelete}`, { method: 'DELETE' });
      if (res.ok) {
        setPinned(false);
        setPinId(null);
        notifyPinChange();
      } else {
        const data = await res.json();
        setError(data.error || '取消置顶失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, [wordId, pinId, loading, pinned]);

  const toggle = useCallback(() => {
    if (pinned) {
      setConfirmOpen(true);
    } else {
      handlePin();
    }
  }, [pinned, handlePin]);

  useImperativeHandle(ref, () => ({ toggle }), [toggle]);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle();
  };

  return (
    <>
      {pinned ? (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-0.5 text-[10px] text-primary cursor-pointer hover:text-primary/80 select-none transition-colors"
          title="已置顶，点击或按 T 取消置顶"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
          </svg>
          已置顶
        </button>
      ) : (
        <div className="relative inline-flex">
          <button
            onClick={onClick}
            disabled={loading}
            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 select-none"
            title={`置顶 "${word}" 到侧边栏 (T)`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
            </svg>
            {loading ? '...' : error ? '!' : '置顶'}
          </button>
          {showError && error && (
            <div className="absolute top-full left-0 mt-1 px-2 py-1 rounded bg-destructive text-destructive-foreground text-[10px] whitespace-nowrap z-50 shadow-md animate-in fade-in slide-in-from-top-1">
              {error}
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>取消置顶</DialogTitle>
            <DialogDescription>
              确定要取消置顶「{word}」吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>
              取消
            </DialogClose>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleUnpin}
              disabled={loading}
            >
              {loading ? '删除中...' : '确认取消置顶'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
