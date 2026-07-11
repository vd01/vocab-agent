'use client';

import { useState, useEffect } from 'react';

interface Command {
  name: string;
  description: string;
}

interface CommandSuggestionsProps {
  filter: string;
  onSelect: (command: string) => void;
  selectedIndex: number;
}

export function CommandSuggestions({ filter, onSelect, selectedIndex }: CommandSuggestionsProps) {
  const [commands, setCommands] = useState<Command[]>([]);

  // Fetch commands on mount (panel just opened).
  // Re-fetching on every mount ensures dynamically registered commands
  // appear immediately after a Developer agent registers a new command.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/command-list')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data?.commands) setCommands(data.commands);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const filtered = commands
    .filter((cmd, i) => commands.findIndex(c => c.name === cmd.name) === i) // dedupe by name
    .filter((cmd) => cmd.name.startsWith(filter.toLowerCase()));

  if (filtered.length === 0) return null;

  return (
    <div
      data-command-list
      data-command-count={filtered.length}
      className="absolute bottom-full left-4 right-4 mb-2 bg-popover border rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          data-command-name={cmd.name}
          className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
            i === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent'
          }`}
          onClick={() => onSelect(cmd.name)}
        >
          <span className="font-mono text-sm text-primary">/{cmd.name}</span>
          <span className="text-sm text-muted-foreground">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}
