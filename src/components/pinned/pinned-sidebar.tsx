'use client';

import { useState, useEffect, useCallback } from 'react';
import { PinDetailCard } from './pin-detail-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { notifyPinChange } from './pin-events';

interface Pin {
  id: string;
  wordId: string;
  word: string;
  phonetic: string | null;
  audioUrl: string | null;
  definition: string | null;
  position: number;
  side: 'left' | 'right';
  createdAt: string;
  archivedAt: string | null;
}

interface PinnedSidebarProps {
  side: 'left' | 'right';
  refreshKey?: number;
}

export function PinnedSidebar({ side, refreshKey = 0 }: PinnedSidebarProps) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [archivedPins, setArchivedPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const fetchPins = useCallback(async () => {
    try {
      const [activeRes, archivedRes] = await Promise.all([
        fetch('/api/pins?archived=false'),
        fetch('/api/pins?archived=true'),
      ]);
      if (activeRes.ok) {
        const data = await activeRes.json();
        const sidePins = (data.pins || []).filter((p: Pin) => p.side === side);
        sidePins.sort((a: Pin, b: Pin) => a.position - b.position);
        setPins(sidePins);
      }
      if (archivedRes.ok) {
        const data = await archivedRes.json();
        const sideArchived = (data.pins || []).filter((p: Pin) => p.side === side);
        setArchivedPins(sideArchived);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [side]);

  useEffect(() => {
    fetchPins();
  }, [fetchPins, refreshKey]);

  const handleUnpin = useCallback(async (pinId: string) => {
    try {
      const res = await fetch(`/api/pins?id=${pinId}`, { method: 'DELETE' });
      if (res.ok) {
        setPins(prev => prev.filter(p => p.id !== pinId));
        setArchivedPins(prev => prev.filter(p => p.id !== pinId));
        notifyPinChange();
      }
    } catch {
      // silently fail
    }
  }, []);

  const handleArchive = useCallback(async (pinId: string) => {
    try {
      const res = await fetch('/api/pins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pinId, action: 'archive' }),
      });
      if (res.ok) {
        await fetchPins();
        notifyPinChange();
      }
    } catch {
      // silently fail
    }
  }, [fetchPins]);

  const handleUnarchive = useCallback(async (pinId: string) => {
    try {
      const res = await fetch('/api/pins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pinId, action: 'unarchive' }),
      });
      if (res.ok) {
        await fetchPins();
        notifyPinChange();
      } else {
        const data = await res.json();
        alert(data.error || '恢复失败');
      }
    } catch {
      // silently fail
    }
  }, [fetchPins]);

  return (
    <div className={cn('hidden xl:flex w-[220px] shrink-0 flex-col border-border', side === 'left' ? 'border-r' : 'border-l')}>
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground">
            📌 置顶单词
          </h2>
          <span className="text-[10px] text-muted-foreground">{pins.length}/5</span>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {pins.length === 0 && !showArchived && (
            <div className="text-xs text-muted-foreground text-center py-8 leading-relaxed">
              暂无置顶单词
              <br />
              <span className="text-[10px]">在聊天中点击📌按钮添加</span>
            </div>
          )}
          {pins.map(pin => (
            <PinDetailCard
              key={pin.id}
              pin={pin}
              onUnpin={handleUnpin}
              onArchive={handleArchive}
            />
          ))}

          {archivedPins.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setShowArchived(s => !s)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('transition-transform', showArchived && 'rotate-90')}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                已归档 ({archivedPins.length})
              </button>
              {showArchived && (
                <div className="mt-2 space-y-2">
                  {archivedPins.map(pin => (
                    <PinDetailCard
                      key={pin.id}
                      pin={pin}
                      onUnpin={handleUnpin}
                      onUnarchive={handleUnarchive}
                      isArchived
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
