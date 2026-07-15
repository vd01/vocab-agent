'use client';

import { useGroup } from '@/lib/groups/group-context';
import { useState, useRef, useEffect } from 'react';

export function GroupSelector() {
  const { activeGroup, setActiveGroup, groups, refreshGroups, loading } = useGroup();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setError(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus input when creating
  useEffect(() => {
    if (creating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [creating]);

  const handleCreate = async () => {
    if (!newGroupName.trim()) return;

    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '创建失败');
        return;
      }

      setNewGroupName('');
      setCreating(false);
      setError(null);
      await refreshGroups();
      setActiveGroup(newGroupName.trim());
    } catch {
      setError('创建失败');
    }
  };

  const displayText = activeGroup || '全部';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => { setOpen(!open); setCreating(false); setError(null); }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted border border-transparent hover:border-border"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="text-[11px] text-muted-foreground">分组</span>
        <span className="max-w-[60px] truncate font-medium text-foreground">{displayText}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-48 bg-popover border rounded-md shadow-md z-50 py-1">
          {/* "All groups" option */}
          <button
            onClick={() => { setActiveGroup(null); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between ${
              activeGroup === null ? 'text-foreground font-medium' : 'text-muted-foreground'
            }`}
          >
            <span>全部</span>
            <span className="text-[10px] text-muted-foreground">
              {groups.reduce((sum, g) => sum + g.wordCount, 0)}
            </span>
          </button>

          {/* Group list */}
          {!loading && groups.map(g => (
            <button
              key={g.id}
              onClick={() => { setActiveGroup(g.name); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between ${
                activeGroup === g.name ? 'text-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              <span className="truncate">{g.name}</span>
              <span className="text-[10px] text-muted-foreground ml-2 shrink-0">{g.wordCount}</span>
            </button>
          ))}

          {/* Divider + Create new */}
          <div className="border-t my-1" />
          {creating ? (
            <div className="px-2 py-1.5">
              <div className="flex gap-1">
                <input
                  ref={inputRef}
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') { setCreating(false); setError(null); }
                  }}
                  placeholder="分组名"
                  className="flex-1 text-xs px-1.5 py-0.5 border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  maxLength={20}
                />
                <button
                  onClick={handleCreate}
                  className="text-xs px-1.5 py-0.5 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                >
                  ✓
                </button>
              </div>
              {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              + 新建分组
            </button>
          )}
        </div>
      )}
    </div>
  );
}
