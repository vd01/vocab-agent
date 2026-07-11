import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function RandomWordsPanel(props) {
  const words = props.words || [];

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-center">🎲 随机3词</h3>
      {words.map((w) => {
        let examples = [];
        try { examples = JSON.parse(w.examples); } catch(e) { examples = []; }
        return (
          <Card key={w.id} className="bg-white/5 border-white/10">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-blue-400 font-bold">{w.word}</span>
                {w.phonetic && <span className="text-xs text-gray-400">{w.phonetic}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-4">
              <p className="text-sm text-gray-300">{w.definition}</p>
              {examples.length > 0 && (
                <p className="text-xs text-gray-500 mt-1 italic">💡 {examples[0]}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-center text-gray-500">再次输入 /random-words 获取新词</p>
    </div>
  );
}