'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

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
      const res = await fetch('/api/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
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

  // Refresh groups when page becomes visible again
  // (e.g. returning from Tauri quick-lookup window where groups may have been created)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshGroups();
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
