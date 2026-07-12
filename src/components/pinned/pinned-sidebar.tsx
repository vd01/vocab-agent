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
  definition: string | null;
  position: number;
  side: 'left' | 'right';
  createdAt: string;
}

interface PinnedSidebarProps {
  side: 'left' | 'right';
  refreshKey?: number;
}

export function PinnedSidebar({ side, refreshKey = 0 }: PinnedSidebarProps) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPins = useCallback(async () => {
    try {
      const res = await fetch('/api/pins');
      if (!res.ok) return;
      const data = await res.json();
      const sidePins = (data.pins || []).filter((p: Pin) => p.side === side);
      sidePins.sort((a: Pin, b: Pin) => a.position - b.position);
      setPins(sidePins);
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
        notifyPinChange();
      }
    } catch {
      // silently fail
    }
  }, []);

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
          {pins.length === 0 && (
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
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
