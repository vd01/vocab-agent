'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { cachedFetch, invalidateCache } from '@/lib/fetch-cache';

export interface GroupInfo {
  id: string;
  name: string;
  wordCount: number;
  isDefault: boolean;
}

interface GroupContextValue {
  activeGroup: string | null;  // null = all groups, string = group name
  setActiveGroup: (name: string | null) => void;
  groups: GroupInfo[];
  refreshGroups: () => Promise<void>;
  loading: boolean;
}

const GroupContext = createContext<GroupContextValue | null>(null);

const STORAGE_KEY = 'vocab-active-group';

export function GroupProvider({ children }: { children: React.ReactNode }) {
  const [activeGroup, setActiveGroupState] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  // Load active group from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setActiveGroupState(saved === '__all__' ? null : saved);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const setActiveGroup = useCallback((name: string | null) => {
    setActiveGroupState(name);
    try {
      localStorage.setItem(STORAGE_KEY, name === null ? '__all__' : name);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const refreshGroups = useCallback(async () => {
    try {
      const data = await cachedFetch<{ groups: GroupInfo[] }>('/api/groups');
      setGroups(data.groups || []);
    } catch (err) {
      console.error('[GroupProvider] Failed to fetch groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch groups on mount
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      refreshGroups();
    }
  }, [refreshGroups]);

  // Refresh groups when returning from another window with 10s cooldown
  useEffect(() => {
    let lastRefresh = 0;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastRefresh > 10_000) {
          lastRefresh = now;
          refreshGroups();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refreshGroups]);

  return (
    <GroupContext.Provider value={{ activeGroup, setActiveGroup, groups, refreshGroups, loading }}>
      {children}
    </GroupContext.Provider>
  );
}

export function useGroup(): GroupContextValue {
  const context = useContext(GroupContext);
  if (!context) {
    throw new Error('useGroup must be used within a GroupProvider');
  }
  return context;
}
