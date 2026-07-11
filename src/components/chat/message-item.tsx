'use client';

import { useState } from 'react';
import { type UIMessage } from 'ai';
import { WordCard } from '@/components/vocab/word-card';
import { ReviewSession } from '@/components/vocab/review-session';
import { DynamicRenderer } from '@/components/generative/dynamic-renderer';
import { componentRegistry } from '@/components/generative/component-registry';

interface MessageItemProps {
  message: UIMessage;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  /** If this message contains a review session, is it the latest one? */
  isLastReview?: boolean;
}

/**
 * Check if a message part is a tool part (AI SDK V7: type starts with 'tool-').
 * Returns the tool metadata if it is, or null otherwise.
 */
function parseToolPart(part: any): {
  toolCallId: string;
  toolName: string;
  state: string;
  input: any;
  output: any;
  errorText?: string;
} | null {
  if (!part || typeof part.type !== 'string') return null;

  // AI SDK V7: tool parts have type 'tool-<name>'
  if (part.type.startsWith('tool-')) {
    return {
      toolCallId: part.toolCallId,
      toolName: part.toolName ?? part.type.replace(/^tool-/, ''),
      state: part.state,
      input: part.input,
      output: part.output,
      errorText: part.errorText,
    };
  }

  return null;
}

export function MessageItem({ message, isLastAssistant, isStreaming, isLastReview = true }: MessageItemProps) {
  const isUser = message.role === 'user';

  // Merge consecutive reasoning parts into one group for cleaner display
  const mergedParts = mergeReasoningParts(message.parts ?? []);

  // Format timestamp (UIMessage may have createdAt from DB)
  const createdAt = (message as any).createdAt;
  const timeStr = createdAt
    ? formatTime(new Date(createdAt))
    : null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-4 py-3`}>
      <div className={`flex gap-3 max-w-3xl w-full ${isUser ? 'justify-end' : ''}`}>
        {/* Avatar for assistant */}
        {!isUser && (
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
          </div>
        )}
        <div
          className={`min-w-0 ${isUser ? 'max-w-[85%]' : 'mr-auto'}`}
        >
        {mergedParts.map((part, i) => {
          // Merged reasoning group
          if (part.type === 'reasoning-group') {
            return (
              <details key={i} className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                  思考过程（{part.count} 段）
                </summary>
                <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap border-l-2 border-muted pl-2">
                  {part.text}
                </div>
              </details>
            );
          }

          // Batch added words — collapsed compact list
          if (part.type === 'batch-added') {
            return <BatchAddedWords key={i} items={part.items} />;
          }

          // Text part
          if (part.type === 'text') {
            return isUser
              ? <UserTextBubble key={i} text={part.text} />
              : (
                <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground break-words">
                  {part.text}
                </div>
              );
          }

          // Reasoning part (single, non-merged)
          if (part.type === 'reasoning') {
            return (
              <details key={i} className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                  思考过程
                </summary>
                <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap border-l-2 border-muted pl-2">
                  {part.text}
                </div>
              </details>
            );
          }

          // Tool part (AI SDK V7: type = 'tool-<name>')
          if (part.type === 'tool') {
            const { toolCallId, toolName, state: toolState, input, output } = part;

            // Tool is streaming input
            if (toolState === 'input-streaming') {
              return (
                <div key={i} className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                  <span className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                  准备执行 {toolName}...
                </div>
              );
            }

            // Tool is awaiting execution (input available, waiting for call)
            if (toolState === 'input-available') {
              return (
                <div key={i} className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                  <span className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                  执行 {toolName}...
                </div>
              );
            }

            // Tool completed with output
            if (toolState === 'output-available' && output != null) {
              return renderToolOutput(i, toolName, output, isLastReview);
            }

            // Tool error
            if (toolState === 'output-error') {
              const errorText = part.errorText ?? '执行出错';
              return (
                <div key={i} className="mt-2 text-xs text-red-500">
                  {toolName}: {errorText}
                </div>
              );
            }

            return null;
          }

          return null;
        })}

        {/* Agent status indicator — only on the last assistant message */}
        {!isUser && isLastAssistant && <AgentStatus message={message} isStreaming={!!isStreaming} />}
        {/* Timestamp */}
        {timeStr && (
          <div className={`mt-1 text-[10px] text-muted-foreground/50 ${isUser ? 'text-right' : ''}`}>
            {timeStr}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ── Developer tool output (collapsed) ─────────────────────────────────────

const DEV_TOOL_LABELS: Record<string, { icon: string; label: string }> = {
  'file-write': { icon: 'W', label: '写入文件' },
  'file-read':  { icon: 'R', label: '读取文件' },
  'file-edit':  { icon: 'E', label: '编辑文件' },
  'file-list':  { icon: 'L', label: '列出文件' },
  'shell-exec': { icon: '>', label: '执行命令' },
  'register-tool':      { icon: 'T', label: '注册工具' },
  'register-component': { icon: 'C', label: '注册组件' },
  'create-command':     { icon: '!', label: '创建命令' },
  'db-query':   { icon: 'D', label: '查询数据库' },
  'save-lesson': { icon: 'S', label: '保存经验' },
  'test-command': { icon: '?', label: '测试命令' },
};

function DevToolOutput({ toolName, output }: { toolName: string; output: any; key: number }) {
  const [expanded, setExpanded] = useState(false);
  const meta = DEV_TOOL_LABELS[toolName] ?? { icon: '*', label: toolName };
  const isError = output.type === 'error';

  // Build a short summary line
  let summary = '';
  if (toolName === 'file-write') {
    summary = output.type === 'success'
      ? `${output.path} — ${output.message}`
      : output.message;
  } else if (toolName === 'file-read') {
    summary = output.type === 'success'
      ? `${(output.content ?? '').length} 字符`
      : output.message;
  } else if (toolName === 'file-list') {
    summary = output.type === 'success'
      ? `${(output.entries ?? []).length} 项`
      : output.message;
  } else if (toolName === 'shell-exec') {
    summary = output.type === 'success'
      ? (output.stdout ? `${output.stdout.slice(0, 60)}${output.stdout.length > 60 ? '...' : ''}` : '无输出')
      : output.message;
  } else {
    summary = output.message ?? JSON.stringify(output).slice(0, 80);
  }

  // Content to show when expanded
  let detailContent: string | null = null;
  if (toolName === 'file-read' && output.type === 'success') {
    detailContent = output.content;
  } else if (toolName === 'shell-exec' && (output.stdout || output.stderr)) {
    detailContent = [output.stdout, output.stderr].filter(Boolean).join('\n--- stderr ---\n');
  } else if (output.content && typeof output.content === 'string') {
    detailContent = output.content;
  }

  return (
    <div className={`mt-1.5 rounded-lg border text-xs overflow-hidden ${isError ? 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20' : 'border-border bg-muted/30'}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors"
      >
        <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${isError ? 'bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-200' : 'bg-muted text-muted-foreground'}`}>
          {meta.icon}
        </span>
        <span className={`font-medium ${isError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
          {meta.label}
        </span>
        <span className={`flex-1 truncate ${isError ? 'text-red-500/80' : 'text-muted-foreground/70'}`}>
          {summary}
        </span>
        {detailContent && (
          <svg
            className={`w-3.5 h-3.5 text-muted-foreground/50 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {expanded && detailContent && (
        <div className="px-2.5 pb-2 max-h-48 overflow-y-auto">
          <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all font-mono">
            {detailContent.slice(0, 5000)}{detailContent.length > 5000 ? '\n... (truncated)' : ''}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── User text bubble with collapse for long messages ──────────────────────

const COLLAPSE_LINES = 6;

function UserTextBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split('\n').length;
  const shouldCollapse = lineCount > COLLAPSE_LINES;

  return (
    <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2.5 w-fit break-words max-w-full">
      <div
        className={`whitespace-pre-wrap text-sm leading-relaxed ${!expanded && shouldCollapse ? 'line-clamp-6' : ''}`}
      >
        {text}
      </div>
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-primary-foreground/70 hover:text-primary-foreground/90 transition-colors"
        >
          {expanded ? '收起' : `展开全部 (${lineCount} 行)`}
        </button>
      )}
    </div>
  );
}

// ── Batch added words (collapsed) ──────────────────────────────────────────

function BatchAddedWords({ items }: { items: Array<{ word: string; phonetic: string | null; definition: string | null; wordId: string; examples: any; tag: string | null; collins: number | null; message: string }> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 rounded-xl border border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20 overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-green-100/50 dark:hover:bg-green-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-green-700 dark:text-green-300">
            已添加 {items.length} 个单词
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsed preview — show first 5 words inline */}
      {!expanded && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {items.slice(0, 8).map((item) => (
            <span key={item.wordId} className="inline-flex items-center gap-1 text-xs bg-white dark:bg-muted rounded-md px-1.5 py-0.5">
              <span className="font-medium">{item.word}</span>
              {item.phonetic && <span className="text-muted-foreground">{item.phonetic}</span>}
            </span>
          ))}
          {items.length > 8 && (
            <span className="text-xs text-muted-foreground self-center">+{items.length - 8} 更多</span>
          )}
        </div>
      )}

      {/* Expanded — full list with definitions */}
      {expanded && (
        <div className="px-3 pb-2 max-h-80 overflow-y-auto space-y-1.5">
          {items.map((item) => (
            <div key={item.wordId} className="flex items-start gap-2 text-xs py-1 border-b border-green-100 dark:border-green-900/50 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-semibold text-sm">{item.word}</span>
                  {item.phonetic && <span className="text-muted-foreground">{item.phonetic}</span>}
                  {item.collins && (
                    <span className="text-amber-500 text-[10px]">{'★'.repeat(item.collins)}</span>
                  )}
                  {item.tag && (
                    <span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      {item.tag.split(/\s+/)[0]}
                    </span>
                  )}
                </div>
                {item.definition && (
                  <div className="text-muted-foreground mt-0.5 truncate">{item.definition.split('\n')[0]}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tool output renderer ──────────────────────────────────────────────────

function renderToolOutput(key: number, toolName: string, output: any, isLastReview: boolean) {
  // Render review session (one card at a time) — only the latest review is interactive
  if (output.type === 'due-words' && output.words) {
    if (isLastReview) {
      return (
        <div key={key} className="mt-2">
          <ReviewSession words={output.words} />
        </div>
      );
    }
    // Stale review session — show collapsed summary
    return (
      <div key={key} className="mt-2">
        <div className="text-xs text-muted-foreground mb-1.5">
          复习（{output.words.length} 个单词）— 已过期
        </div>
        <div className="space-y-0.5">
          {output.words.map((w: any, wi: number) => (
            <div key={wi} className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
              <span className="font-medium">{w.word}</span>
              {w.phonetic && <span>{w.phonetic}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (output.type === 'review-result') {
    return (
      <div key={key} className="mt-2 text-xs text-muted-foreground">
        评分: {output.rating} | 下次复习: {output.scheduledDays} 天后
      </div>
    );
  }

  if (output.type === 'added') {
    return (
      <div key={key} className="mt-2 space-y-2">
        <div className="text-xs text-green-600">
          {output.message}
        </div>
        <WordCard
          wordId={output.wordId}
          word={output.word}
          phonetic={output.phonetic}
          definition={output.definition}
          examples={output.examples ? (typeof output.examples === 'string' ? output.examples : JSON.stringify(output.examples)) : null}
        />
      </div>
    );
  }

  if (output.type === 'already-exists') {
    return (
      <div key={key} className="mt-2 text-xs text-yellow-600">
        {output.message}
      </div>
    );
  }

  if (output.type === 'found') {
    return (
      <div key={key} className="mt-2">
        <WordCard
          wordId={output.wordId}
          word={output.word}
          phonetic={output.phonetic}
          definition={output.definition}
          examples={output.examples}
        />
      </div>
    );
  }

  if (output.type === 'not-found') {
    return (
      <div key={key} className="mt-2 text-xs text-muted-foreground">
        {output.message}
      </div>
    );
  }

  // Dictionary lookup result (not in user's library)
  if (output.type === 'dict-found') {
    return (
      <div key={key} className="mt-2 space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold">{output.word}</span>
          {output.phonetic && <span className="text-xs text-muted-foreground">{output.phonetic}</span>}
          {output.collins && (
            <span className="text-xs text-amber-500">{'★'.repeat(output.collins)}</span>
          )}
        </div>

        {/* Exam tags */}
        {output.tag && (
          <div className="flex flex-wrap gap-1">
            {output.tag.split(/\s+/).filter(Boolean).map((t: string) => (
              <span key={t} className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Chinese translation */}
        {output.translation && (
          <div className="text-sm">
            {output.translation.split('\n').filter(Boolean).map((line: string, idx: number) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        )}

        {/* English definitions with examples */}
        {output.definitions?.length > 0 && (
          <div className="space-y-1.5">
            {output.definitions.map((group: any, gi: number) => (
              <div key={gi}>
                {group.partOfSpeech && (
                  <span className="text-xs italic text-muted-foreground mr-1">{group.partOfSpeech}</span>
                )}
                {group.definitions?.slice(0, 3).map((d: any, di: number) => (
                  <div key={di} className="text-xs ml-2">
                    <span className="text-muted-foreground">{di + 1}. </span>
                    {d.definition}
                    {d.example && (
                      <div className="text-muted-foreground italic ml-3">— {d.example}</div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Synonyms / Antonyms */}
        {(output.synonyms?.length > 0 || output.antonyms?.length > 0) && (
          <div className="text-xs space-y-0.5">
            {output.synonyms?.length > 0 && (
              <div>
                <span className="text-muted-foreground">同义: </span>
                {output.synonyms.slice(0, 8).join(', ')}
              </div>
            )}
            {output.antonyms?.length > 0 && (
              <div>
                <span className="text-muted-foreground">反义: </span>
                {output.antonyms.slice(0, 8).join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Hint: not in library */}
        {output.hint && (
          <div className="text-[10px] text-muted-foreground italic">{output.hint}</div>
        )}

        {/* Frequency info */}
        {(output.bnc || output.frq) && (
          <div className="text-[10px] text-muted-foreground">
            词频: BNC #{output.bnc ?? '-'} / 当代 #{output.frq ?? '-'}
          </div>
        )}
      </div>
    );
  }

  if (output.type === 'no-due-words') {
    return (
      <div key={key} className="mt-2 text-sm text-muted-foreground">
        {output.message}
      </div>
    );
  }

  // Generic message (for dynamic commands that return formatted text)
  if (output.type === 'message') {
    return (
      <div key={key} className="mt-2 text-sm leading-relaxed">
        {output.message}
      </div>
    );
  }

  // Stats result
  if (output.type === 'stats') {
    return (
      <div key={key} className="mt-2 space-y-2">
        <div className="text-sm font-medium">学习统计</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted rounded-lg p-2">
            <div className="text-muted-foreground">总词汇量</div>
            <div className="text-lg font-bold">{output.totalWords}</div>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <div className="text-muted-foreground">今日复习</div>
            <div className="text-lg font-bold">{output.daily?.reviewed ?? 0}</div>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <div className="text-muted-foreground">今日正确率</div>
            <div className="text-lg font-bold">{output.daily?.correctRate ?? 0}%</div>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <div className="text-muted-foreground">学习中</div>
            <div className="text-lg font-bold">{output.distribution?.learning ?? 0}</div>
          </div>
        </div>
      </div>
    );
  }

  // Command error / unknown / invalid-args
  if (output.type === 'unknown-command' || output.type === 'invalid-args' || output.type === 'command-error') {
    return (
      <div key={key} className="mt-2 text-xs text-yellow-600">
        {output.message}
      </div>
    );
  }

  // Developer tools: file operations & shell — compact collapsed display
  const devToolNames = new Set(['file-write', 'file-read', 'file-edit', 'file-list', 'shell-exec', 'register-tool', 'register-component', 'create-command', 'db-query', 'save-lesson', 'test-command']);
  if (devToolNames.has(toolName)) {
    return <DevToolOutput key={key} toolName={toolName} output={output} />;
  }

  // Check dynamic component registry — match by output.type first, then toolName
  const componentName = componentRegistry.has(output.type) ? output.type
    : componentRegistry.has(toolName) ? toolName
    : null;
  if (componentName) {
    return (
      <div key={key} className="mt-2">
        <DynamicRenderer componentName={componentName} props={output} />
      </div>
    );
  }

  // Fallback: render as JSON
  return (
    <div key={key} className="mt-2 text-xs text-muted-foreground">
      [{toolName}] {JSON.stringify(output).slice(0, 200)}
    </div>
  );
}

// ── Agent status indicator ──────────────────────────────────────────────

type AgentPhase = 'reasoning' | 'calling-tool' | 'generating' | 'done' | 'step-limit' | 'error' | 'idle';

function detectPhase(message: UIMessage, isStreaming: boolean): AgentPhase {
  if (!isStreaming) {
    // Not streaming — check for step-limit first
    const hasStepLimit = message.parts?.some(
      p => p.type === 'text' && p.text?.includes('步数限制中断')
    );
    if (hasStepLimit) return 'step-limit';

    // Check for errors in tool parts
    const hasError = message.parts?.some(
      p => isToolPartWithState(p, 'output-error')
    );
    if (hasError) return 'error';

    // If the message has any content, it's done
    const hasContent = message.parts?.some(p =>
      (p.type === 'text' && p.text) ||
      isToolPartWithState(p, 'output-available')
    );
    return hasContent ? 'done' : 'idle';
  }

  // Streaming — inspect parts to determine phase
  const parts = message.parts ?? [];

  // Check for a tool currently being called
  const callingTool = parts.find(
    p => isToolPartWithState(p, 'input-available') || isToolPartWithState(p, 'input-streaming')
  );
  if (callingTool) {
    return 'calling-tool';
  }

  // Check for reasoning in progress (reasoning part exists but no text yet after it)
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type === 'reasoning') {
    return 'reasoning';
  }

  // Otherwise, generating text
  return 'generating';
}

/** Check if a part is a tool part (type starts with 'tool-') with the given state */
function isToolPartWithState(part: any, state: string): boolean {
  if (!part || typeof part.type !== 'string') return false;
  return part.type.startsWith('tool-') && part.state === state;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'file-write': '写入文件',
  'file-read': '读取文件',
  'file-edit': '编辑文件',
  'file-list': '列出文件',
  'shell-exec': '执行命令',
  'create-command': '创建命令',
  'register-tool': '注册命令',
  'register-component': '注册组件',
  'db-query': '查询数据库',
  'fsrs-review': '获取复习单词',
  'fsrs-rate': '提交评分',
  'add-word': '添加单词',
  'vocab-lookup': '查询单词',
  'extract-words': '提炼生词',
  'save-lesson': '保存经验',
  'test-command': '测试命令',
  'dict-lookup': '查词典',
  'vocab-stats': '词库统计',
};

function AgentStatus({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const phase = detectPhase(message, isStreaming);

  // Idle — no content yet, don't show anything (MessageList's "思考中..." handles this)
  if (phase === 'idle') return null;

  // Error — tool returned an error (persistent, won't disappear)
  if (phase === 'error') {
    const errorPart = message.parts?.find(
      p => isToolPartWithState(p, 'output-error')
    ) as any;
    const errorMsg = errorPart?.errorText ?? '执行出错';
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        {errorMsg}
      </div>
    );
  }

  // Done — persistent check mark, never disappears
  if (phase === 'done') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        已完成
      </div>
    );
  }

  // Step limit reached — task incomplete
  if (phase === 'step-limit') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4v.01M12 2l9.5 16.5H2.5L12 2z" />
        </svg>
        未完成（步数限制）— 回复"继续"可接着做
      </div>
    );
  }

  // Active phases — show pulsing indicator with phase label
  const callingToolPart = message.parts?.find(
    p => isToolPartWithState(p, 'input-available') || isToolPartWithState(p, 'input-streaming')
  ) as any;

  let label: string;
  if (phase === 'reasoning') {
    label = '思考中...';
  } else if (phase === 'calling-tool' && callingToolPart) {
    const rawName = callingToolPart.toolName ?? callingToolPart.type?.replace(/^tool-/, '') ?? '';
    const displayName = TOOL_DISPLAY_NAMES[rawName] ?? rawName;
    label = `执行 ${displayName}...`;
  } else {
    label = '生成中...';
  }

  return (
    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
      </span>
      {label}
    </div>
  );
}

// ── Merge consecutive reasoning parts ───────────────────────────────────

type MergedPart =
  | { type: 'reasoning-group'; text: string; count: number }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; toolCallId: string; toolName: string; state: string; input: any; output: any; errorText?: string }
  | { type: 'batch-added'; items: Array<{ word: string; phonetic: string | null; definition: string | null; wordId: string; examples: any; tag: string | null; collins: number | null; message: string }> };

function mergeReasoningParts(parts: any[]): MergedPart[] {
  const result: MergedPart[] = [];
  const reasoningTexts: string[] = [];

  // Collect all reasoning texts, emit everything else
  for (const part of parts) {
    if (part.type === 'reasoning') {
      reasoningTexts.push(part.text || '');
    } else if (part.type === 'text') {
      result.push({ type: 'text', text: part.text });
    } else if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
      // AI SDK V7 tool part: type = 'tool-<name>'
      result.push({
        type: 'tool',
        toolCallId: part.toolCallId,
        toolName: part.toolName ?? part.type.replace(/^tool-/, ''),
        state: part.state,
        input: part.input,
        output: part.output,
        errorText: part.errorText,
      });
    }
  }

  // Prepend a single merged reasoning block if any reasoning exists
  if (reasoningTexts.length > 0) {
    const text = reasoningTexts.join('\n\n---\n\n');
    const merged: MergedPart[] = reasoningTexts.length === 1
      ? [{ type: 'reasoning', text }]
      : [{ type: 'reasoning-group', text, count: reasoningTexts.length }];
    result.unshift(...merged);
  }

  // Merge consecutive 'added' tool outputs into a single 'batch-added' group
  const merged: MergedPart[] = [];
  let batch: Array<{ word: string; phonetic: string | null; definition: string | null; wordId: string; examples: any; tag: string | null; collins: number | null; message: string }> = [];

  const flushBatch = () => {
    if (batch.length === 0) return;
    if (batch.length === 1) {
      // Single item — keep as individual tool part for normal rendering
      const item = batch[0];
      merged.push({
        type: 'tool',
        toolCallId: '',
        toolName: 'add-word',
        state: 'output-available',
        input: {},
        output: {
          type: 'added',
          wordId: item.wordId,
          word: item.word,
          phonetic: item.phonetic,
          definition: item.definition,
          examples: item.examples,
          tag: item.tag,
          collins: item.collins,
          message: item.message,
        },
      });
    } else {
      merged.push({ type: 'batch-added', items: [...batch] });
    }
    batch = [];
  };

  for (const part of result) {
    if (part.type === 'tool' && part.state === 'output-available' && part.output?.type === 'added') {
      batch.push({
        word: part.output.word,
        phonetic: part.output.phonetic ?? null,
        definition: part.output.definition ?? null,
        wordId: part.output.wordId,
        examples: part.output.examples,
        tag: part.output.tag ?? null,
        collins: part.output.collins ?? null,
        message: part.output.message,
      });
    } else {
      flushBatch();
      merged.push(part);
    }
  }
  flushBatch();

  return merged;
}

// ── Time formatting ──────────────────────────────────────────────────────

function formatTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (isToday) return time;

  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${month}-${day} ${time}`;
}
