import React from 'react';

export default function RandomLetterPanel(props) {
  const { letter, total, words } = props;
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        以字母 <span className="text-lg font-bold text-primary">{letter}</span> 开头的单词共 {total} 个，随机抽取 {words.length} 个：
      </div>
      {words.map((w, i) => (
        <div key={w.word} className="rounded-lg border bg-card p-4 space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">{w.word}</span>
            {w.phonetic && <span className="text-sm text-muted-foreground">{w.phonetic}</span>}
          </div>
          <div className="text-sm">{w.definition}</div>
          {w.examples.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {w.examples.map((ex, j) => (
                <div key={j} className="text-xs text-muted-foreground pl-3 border-l-2 border-primary/30">💡 {ex}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
