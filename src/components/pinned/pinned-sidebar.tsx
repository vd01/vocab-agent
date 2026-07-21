'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PinDetailCard } from './pin-detail-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { notifyPinChange } from './pin-events';
import { cachedFetch, invalidateCache } from '@/lib/fetch-cache';

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

// ── Global shared cache: both sidebars share one API call ──
interface PinCache {
  active: Pin[];
  archived: Pin[];
  fetchPromise: Promise<void> | null;
  version: number;
}

const globalCache: PinCache = {
  active: [],
  archived: [],
  fetchPromise: null,
  version: 0,
};

const subscribers = new Set<() => void>();

function notifySubscribers() {
  globalCache.version++;
  subscribers.forEach((cb) => cb());
}

async function fetchAllPins(): Promise<void> {
  if (globalCache.fetchPromise) return globalCache.fetchPromise;

  globalCache.fetchPromise = (async () => {
    try {
      const [activeData, archivedData] = await Promise.all([
        cachedFetch<{ pins: Pin[] }>('/api/pins?archived=false'),
        cachedFetch<{ pins: Pin[] }>('/api/pins?archived=true'),
      ]);
      globalCache.active = (activeData.pins || []).sort(
        (a: Pin, b: Pin) => a.position - b.position
      );
      globalCache.archived = archivedData.pins || [];
      notifySubscribers();
    } catch {
      // silently fail
    } finally {
      globalCache.fetchPromise = null;
    }
  })();

  return globalCache.fetchPromise;
}

interface PinnedSidebarProps {
  side: 'left' | 'right';
  refreshKey?: number;
}

export function PinnedSidebar({ side, refreshKey = 0 }: PinnedSidebarProps) {
  const [, setCacheVersion] = useState(globalCache.version);
  const [showArchived, setShowArchived] = useState(false);

  // Subscribe to cache changes
  useEffect(() => {
    const cb = () => setCacheVersion(globalCache.version);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  // Fetch on mount and when refreshKey changes
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== prevRefreshKey.current || prevRefreshKey.current === 0) {
      prevRefreshKey.current = refreshKey;
      fetchAllPins();
    }
  }, [refreshKey]);

  const sidePins = globalCache.active.filter((p) => p.side === side);
  const sideArchived = globalCache.archived.filter((p) => p.side === side);

  const handleUnpin = useCallback(async (pinId: string) => {
    try {
      const res = await fetch(`/api/pins?id=${pinId}`, { method: 'DELETE' });
      if (res.ok) {
        // Optimistic update
        globalCache.active = globalCache.active.filter((p) => p.id !== pinId);
        globalCache.archived = globalCache.archived.filter((p) => p.id !== pinId);
        invalidateCache('/api/pins?archived=false');
        invalidateCache('/api/pins?archived=true');
        notifySubscribers();
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
        await fetchAllPins();
        notifyPinChange();
      }
    } catch {
      // silently fail
    }
  }, []);

  const handleUnarchive = useCallback(async (pinId: string) => {
    try {
      const res = await fetch('/api/pins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pinId, action: 'unarchive' }),
      });
      if (res.ok) {
        await fetchAllPins();
        notifyPinChange();
      } else {
        const data = await res.json();
        alert(data.error || '恢复失败');
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
          <span className="text-[10px] text-muted-foreground">{sidePins.length}/5</span>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {sidePins.length === 0 && !showArchived && (
            <div className="text-xs text-muted-foreground text-center py-8 leading-relaxed">
              暂无置顶单词
              <br />
              <span className="text-[10px]">在聊天中点击📌按钮添加</span>
            </div>
          )}
          {sidePins.map(pin => (
            <PinDetailCard
              key={pin.id}
              pin={pin}
              onUnpin={handleUnpin}
              onArchive={handleArchive}
            />
          ))}

          {sideArchived.length > 0 && (
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
                已归档 ({sideArchived.length})
              </button>
              {showArchived && (
                <div className="mt-2 space-y-2">
                  {sideArchived.map(pin => (
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
