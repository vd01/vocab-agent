'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PronounceButton } from '@/components/vocab/pronounce-button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

interface RichContent {
  mnemonic?: string;
  wordFamily?: string;
  collocations?: string;
  contextSentences?: string[];
  confusables?: string;
  cultureNote?: string;
  memoryTip?: string;
  raw?: boolean;
}

interface PinDetailCardProps {
  pin: {
    id: string;
    word: string;
    phonetic: string | null;
    audioUrl: string | null;
    definition: string | null;
    createdAt: string;
    archivedAt: string | null;
  };
  onUnpin: (pinId: string) => void;
  onArchive?: (pinId: string) => void;
  onUnarchive?: (pinId: string) => void;
  isArchived?: boolean;
}

function formatTimestamp(ts: string | number | null): string {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function PinDetailCard({ pin, onUnpin, onArchive, onUnarchive, isArchived = false }: PinDetailCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [richContent, setRichContent] = useState<RichContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnpinOpen, setConfirmUnpinOpen] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (richContent) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pins/${pin.id}/detail`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.cached) {
        setLoading(false);
      }
      setRichContent(data.richContent);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [pin.id, richContent]);

  useEffect(() => {
    if (dialogOpen) fetchDetail();
  }, [dialogOpen, fetchDetail]);

  const handleUnpin = useCallback(() => {
    setConfirmUnpinOpen(false);
    setDialogOpen(false);
    onUnpin(pin.id);
  }, [pin.id, onUnpin]);

  let parsedDefinition: string | null = null;
  if (pin.definition) {
    try {
      const parsed = JSON.parse(pin.definition);
      if (typeof parsed === 'object') {
        parsedDefinition = JSON.stringify(parsed, null, 2);
      }
    } catch {
      parsedDefinition = pin.definition;
    }
    if (!parsedDefinition) parsedDefinition = pin.definition;
  }

  return (
    <>
      <Card className={cn('group relative', isArchived && 'opacity-60')}>
        <CardContent className="p-3">
          <div
            className="cursor-pointer"
            onClick={() => setDialogOpen(true)}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-sm text-foreground">{pin.word}</span>
                  {pin.phonetic && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                      {pin.phonetic}
                    </Badge>
                  )}
                  <PronounceButton word={pin.word} audioUrl={pin.audioUrl} />
                </div>
                {parsedDefinition && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                    {parsedDefinition}
                  </p>
                )}
                {isArchived && (
                  <div className="mt-1 space-y-0.5">
                    {pin.createdAt && (
                      <p className="text-[10px] text-muted-foreground/70">置顶: {formatTimestamp(pin.createdAt)}</p>
                    )}
                    {pin.archivedAt && (
                      <p className="text-[10px] text-muted-foreground/70">归档: {formatTimestamp(pin.archivedAt)}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {isArchived ? (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onUnarchive?.(pin.id); }}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-green-600 hover:bg-green-500/10"
                      title="恢复置顶"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmUnpinOpen(true); }}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="删除"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onArchive?.(pin.id); }}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10"
                      title="归档"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmUnpinOpen(true); }}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="取消置顶"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{pin.word}</span>
              <PronounceButton word={pin.word} audioUrl={pin.audioUrl} size="md" />
              {pin.phonetic && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {pin.phonetic}
                </Badge>
              )}
            </DialogTitle>
            {parsedDefinition && (
              <DialogDescription className="text-left whitespace-pre-wrap leading-relaxed">
                {parsedDefinition}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mx-4 px-4">
            <div className="space-y-3 pb-2">
              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  AI 正在生成详解...
                </div>
              )}
              {error && (
                <p className="text-xs text-destructive py-1">{error}</p>
              )}
              {richContent && !loading && (
                <>
                  {richContent.mnemonic && (
                    <Section title="助记" icon="💡">
                      <p className="text-sm text-foreground leading-relaxed">{richContent.mnemonic}</p>
                    </Section>
                  )}
                  {richContent.memoryTip && (
                    <Section title="记忆诀窍" icon="🎯">
                      <p className="text-sm text-foreground leading-relaxed">{richContent.memoryTip}</p>
                    </Section>
                  )}
                  {richContent.wordFamily && (
                    <Section title="词族" icon="🌳">
                      <p className="text-sm text-foreground leading-relaxed">{richContent.wordFamily}</p>
                    </Section>
                  )}
                  {richContent.collocations && (
                    <Section title="常用搭配" icon="🔗">
                      <p className="text-sm text-foreground leading-relaxed">{richContent.collocations}</p>
                    </Section>
                  )}
                  {richContent.contextSentences?.length ? (
                    <Section title="语境例句" icon="📖">
                      <div className="space-y-1.5">
                        {richContent.contextSentences.map((s, i) => (
                          <p key={i} className="text-sm text-muted-foreground italic pl-3 border-l-2 border-muted leading-relaxed">
                            {s}
                          </p>
                        ))}
                      </div>
                    </Section>
                  ) : null}
                  {richContent.confusables && (
                    <Section title="易混淆" icon="⚠️">
                      <p className="text-sm text-foreground leading-relaxed">{richContent.confusables}</p>
                    </Section>
                  )}
                  {richContent.cultureNote && (
                    <Section title="文化贴士" icon="🌍">
                      <p className="text-sm text-foreground leading-relaxed">{richContent.cultureNote}</p>
                    </Section>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUnpinOpen} onOpenChange={setConfirmUnpinOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{isArchived ? '删除归档' : '取消置顶'}</DialogTitle>
            <DialogDescription>
              {isArchived
                ? `确定要删除归档的「${pin.word}」吗？此操作不可恢复。`
                : `确定要取消置顶「${pin.word}」吗？`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>
              取消
            </DialogClose>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleUnpin}
            >
              {isArchived ? '确认删除' : '确认取消置顶'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </div>
  );
}
