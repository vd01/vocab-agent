'use client';

import { Button } from '@/components/ui/button';

interface FsrsButtonsProps {
  wordId: string;
  onRate: (wordId: string, rating: number) => void;
  pendingRating: number | null;
  disabled?: boolean;
}

const RATING_CONFIG = [
  { value: 1, label: 'Again', shortcut: 'A', color: 'bg-red-500 hover:bg-red-600 text-white', disabledColor: 'bg-red-500/20 text-red-500/40' },
  { value: 2, label: 'Hard', shortcut: 'S', color: 'bg-yellow-500 hover:bg-yellow-600 text-white', disabledColor: 'bg-yellow-500/20 text-yellow-500/40' },
  { value: 3, label: 'Good', shortcut: 'D', color: 'bg-green-500 hover:bg-green-600 text-white', disabledColor: 'bg-green-500/20 text-green-500/40' },
  { value: 4, label: 'Easy', shortcut: 'F', color: 'bg-blue-500 hover:bg-blue-600 text-white', disabledColor: 'bg-blue-500/20 text-blue-500/40' },
];

export function FsrsButtons({ wordId, onRate, pendingRating, disabled = false }: FsrsButtonsProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2 min-w-0">
      {RATING_CONFIG.map(({ value, label, shortcut, color, disabledColor }) => (
        <Button
          key={value}
          size="sm"
          disabled={disabled}
          className={`flex-1 min-w-0 text-xs sm:text-sm ${disabled ? disabledColor + ' cursor-not-allowed' : color} ${!disabled && pendingRating === value ? 'ring-2 ring-offset-2 ring-primary' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onRate(wordId, value);
          }}
        >
          <span>{label}</span>
          <kbd className={`ml-0.5 text-[10px] hidden sm:inline ${disabled ? 'opacity-30' : 'opacity-70'}`}>({shortcut})</kbd>
        </Button>
      ))}
    </div>
  );
}
