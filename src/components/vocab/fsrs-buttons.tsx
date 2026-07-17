'use client';

import { Button } from '@/components/ui/button';

interface FsrsButtonsProps {
  wordId: string;
  onRate: (wordId: string, rating: number) => void;
  pendingRating: number | null;
  disabled?: boolean;
}

const RATING_CONFIG = [
  {
    value: 1,
    label: 'Again',
    color: 'bg-red-500 hover:bg-red-600 text-white',
    disabledColor: 'bg-red-500/20 text-red-500/40',
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 4v-5h-.581m0 0a8.003 8.003 0 01-15.357 2m15.357-2H15" />
      </svg>
    ),
  },
  {
    value: 2,
    label: 'Hard',
    color: 'bg-yellow-500 hover:bg-yellow-600 text-white',
    disabledColor: 'bg-yellow-500/20 text-yellow-500/40',
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.205 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
  },
  {
    value: 3,
    label: 'Good',
    color: 'bg-green-500 hover:bg-green-600 text-white',
    disabledColor: 'bg-green-500/20 text-green-500/40',
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.211 3.636l-6.735 5.5a2 2 0 01-2.422 0l-6.735-5.5A2 2 0 013.764 10H8.24a2 2 0 001.789-1.106l2.894-5.788a2 2 0 013.578 0l2.894 5.788A2 2 0 0014 10z" />
      </svg>
    ),
  },
  {
    value: 4,
    label: 'Easy',
    color: 'bg-blue-500 hover:bg-blue-600 text-white',
    disabledColor: 'bg-blue-500/20 text-blue-500/40',
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

export function FsrsButtons({ wordId, onRate, pendingRating, disabled = false }: FsrsButtonsProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2 w-full">
      {RATING_CONFIG.map(({ value, label, color, disabledColor, icon }) => (
        <Button
          key={value}
          size="sm"
          disabled={disabled}
          className={`flex-1 min-w-0 py-2 h-auto ${disabled ? disabledColor + ' cursor-not-allowed' : color} ${!disabled && pendingRating === value ? 'ring-2 ring-offset-2 ring-primary' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onRate(wordId, value);
          }}
        >
          <div className="flex flex-col items-center gap-0.5">
            {icon}
            <span className="text-xs font-medium">{label}</span>
          </div>
        </Button>
      ))}
    </div>
  );
}
