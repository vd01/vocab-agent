'use client';

import { Button } from '@/components/ui/button';

interface FsrsButtonsProps {
  wordId: string;
  onRate: (wordId: string, rating: number) => void;
  pendingRating: number | null;
}

const RATING_CONFIG = [
  { value: 1, label: 'Again', shortcut: 'A', color: 'bg-red-500 hover:bg-red-600 text-white' },
  { value: 2, label: 'Hard', shortcut: 'S', color: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
  { value: 3, label: 'Good', shortcut: 'D', color: 'bg-green-500 hover:bg-green-600 text-white' },
  { value: 4, label: 'Easy', shortcut: 'F', color: 'bg-blue-500 hover:bg-blue-600 text-white' },
];

export function FsrsButtons({ wordId, onRate, pendingRating }: FsrsButtonsProps) {
  return (
    <div className="flex gap-2 mt-2">
      {RATING_CONFIG.map(({ value, label, shortcut, color }) => (
        <Button
          key={value}
          size="sm"
          className={`flex-1 ${color} ${pendingRating === value ? 'ring-2 ring-offset-2 ring-primary' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onRate(wordId, value);
          }}
        >
          <span>{label}</span>
          <kbd className="ml-1 text-xs opacity-70">({shortcut})</kbd>
        </Button>
      ))}
    </div>
  );
}
