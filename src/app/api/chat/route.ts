import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  pruneMessages,
  NoSuchToolError,
  type UIMessage,
  type ModelMessage,
} from 'ai';
import { getTeacherConfig } from '@/lib/ai/teacher-agent';
import { getDeveloperConfig } from '@/lib/ai/developer-agent';
import { buildWorldState } from '@/lib/pipeline/world-state';
import { contextManager } from '@/lib/ai/context-manager';
import { setDebugLogs } from '@/lib/ai/debug-store';
import { estimateMessagesTokens } from '@/lib/ai/utils/token-estimate';
import { fileBlockStore } from '@/lib/ai/utils/file-block-store';
import { parseAndExecuteFileBlocks } from '@/lib/ai/utils/file-block-executor';

export const maxDuration = 60;

const MAX_STEPS = 25;

// Debug panel is disabled by default; set NEXT_PUBLIC_DEBUG_PANEL=true to enable
const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PANEL === 'true';

// Token threshold for context compaction within a multi-step task.
// When accumulated messages exceed this, pruneMessages will trim
// old reasoning and tool calls to keep the context window manageable.
const COMPACTION_THRESHOLD = 80000;

// ── Types for debug serialization ─────────────────────────────────────────

interface DebugContentPart {
  type: string;
  text?: string;
  toolUseId?: string;
  toolName?: string;
}

interface DebugMessage {
  role: string;
  content: string | DebugContentPart[] | string;
}

// ── Helper: serialize model messages for debug display ────────────────────
function serializeMessagesForDebug(messages: ModelMessage[]): DebugMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content.slice(0, 500) + (m.content.length > 500 ? '...' : '')
      : Array.isArray(m.content)
        ? m.content.slice(0, 5).map((c) => {
            if (c.type === 'text') return { type: 'text', text: c.text?.slice(0, 200) + (c.text?.length > 200 ? '...' : '') };
            if (c.type === 'tool-result') return { type: 'tool-result', toolCallId: c.toolCallId };
            if (c.type === 'tool-call') return { type: 'tool-call', toolName: c.toolName };
            return { type: c.type };
          })
        : '[complex]',
  }));
}

export async function POST(req: Request) {
  try {
    // Clear file block store at the start of each request
    fileBlockStore.clear();

    const body = await req.json();

    // AI SDK V7 DefaultChatTransport sends messages in body.messages
    const uiMessages: UIMessage[] = body.messages || [];

    // Get the last user message for context
    const lastUserMessage = [...uiMessages].reverse().find((m) => m.role === 'user');
    const userContent = extractTextFromMessage(lastUserMessage);

    // Determine agent type from frontend mode switch (body.mode)
    const { mode: rawMode, modeSwitched: rawModeSwitched, activeGroup } = body as { mode?: string; modeSwitched?: boolean; activeGroup?: string };
    const mode = rawMode ?? 'teach';
    const modeSwitched = rawModeSwitched === true;
    const agentType = mode === 'develop' ? 'developer' : 'teacher';

    // Build World State for context injection
    const worldState = await buildWorldState();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- model/tools types come from AI SDK which uses any
    let config: { model: any; instructions: string; tools: any; maxTokens?: number; temperature?: number };
    if (agentType === 'developer') {
      config = await getDeveloperConfig(worldState);
    } else {
      config = getTeacherConfig(worldState);
    }

    console.log(`[Chat API] Routed to ${agentType} agent`);

    // Sanitize UIMessages: remove orphaned tool parts that lack a matching
    // call/result pair (e.g. command results from /review, /stats that were
    // stored as standalone tool parts). These cause AI_MissingToolResultsError
    // in convertToModelMessages.
    const sanitizedMessages = sanitizeUIMessages(uiMessages);

    // Filter out functional command messages (/review, /stats, etc.)
    // These are pure frontend operations that don't need LLM context.
    const filteredMessages = contextManager.filterFunctionalMessages(sanitizedMessages);
    const filteredCount = sanitizedMessages.length - filteredMessages.length;
    if (filteredCount > 0) {
      console.log(`[Context Manager] Filtered ${filteredCount} functional command messages`);
    }

    // Convert UIMessage[] → ModelMessage[] using AI SDK V7 converter
    const modelMessages = await convertToModelMessages(filteredMessages, {
      tools: config.tools,
      ignoreIncompleteToolCalls: true,
    });

    // Apply context management: trim/summarize old messages (cache-aware)
    const { messages: trimmedMessages, trimmed, summaryAdded, summary, cacheAware } =
      contextManager.trimMessages(modelMessages);

    if (trimmed) {
      console.log(
        `[Context Manager] Trimmed ${modelMessages.length} → ${trimmedMessages.length} messages` +
        (summaryAdded ? ' (with summary)' : '') +
        (cacheAware ? '' : ' (cross-session, cache stale)'),
      );
    } else if (cacheAware) {
      console.log(
        `[Context Manager] Cache-aware: skipped trim to preserve prefix cache`,
      );
    }

    // Merge conversation summary into instructions (only when cross-session trim produced one)
    let finalInstructions = summary
      ? `${config.instructions}\n\n[对话历史摘要]\n${summary}`
      : config.instructions;

    // Inject active group context for the teacher agent
    if (agentType === 'teacher' && activeGroup) {
      finalInstructions += `\n\n[当前分组] 用户当前选中的分组是"${activeGroup}"，复习和学习相关的操作默认针对该分组。`;
    }

    // When the user just switched modes, append a context hint so the LLM
    // understands the role change without needing an explicit user message.
    if (modeSwitched) {
      const modeHint = agentType === 'developer'
        ? '\n\n[模式切换提示] 用户刚刚切换到开发模式。你现在以系统开发者助手的身份工作，专注于代码开发和功能扩展。之前的对话可能来自教学模式，请忽略其中的教学上下文。'
        : '\n\n[模式切换提示] 用户刚刚切换到教学模式。你现在以英语教师的身份工作，专注于英语教学和词汇复习。之前的对话可能来自开发模式，请忽略其中的代码开发上下文。';
      finalInstructions += modeHint;
    }

    // Track step count for step-limit detection
    let stepCount = 0;

    // Debug: collect LLM interaction logs per step (only when debug panel is enabled)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- debug log structure is dynamic
    const debugLogs: Record<string, unknown>[] = [];
    const debugId = DEBUG_ENABLED ? `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : '';

    // Snapshot the actual messages sent to LLM (before any step mutates them)
    const requestMessagesSnapshot = DEBUG_ENABLED ? serializeMessagesForDebug(trimmedMessages) : [];

    const result = streamText({
      model: config.model,
      instructions: finalInstructions,
      messages: trimmedMessages,
      tools: config.tools,
      maxOutputTokens: config.maxTokens,
      temperature: config.temperature,
      stopWhen: stepCountIs(MAX_STEPS),
      // Repair tool calls where deepseek-reasoner puts the entire file-block
      // syntax (e.g. "file-write:generated/tools/word-match.js") into the
      // toolName field instead of using the <<<file-write:...>>> text syntax.
      repairToolCall: agentType === 'developer' ? async ({ toolCall, error }) => {
        if (!(error instanceof NoSuchToolError)) return null;

        const name = toolCall.toolName;

        // Case 1: "file-write:path" → redirect to file-write guidance tool
        if (name.startsWith('file-write:')) {
          const filePath = name.slice('file-write:'.length);
          return {
            type: 'tool-call' as const,
            toolCallId: toolCall.toolCallId,
            toolName: 'file-write',
            input: JSON.stringify({ filePath, content: String(toolCall.input ?? '') }),
          };
        }

        // Case 2: "file-edit:path:replace:start-end" or "file-edit:path:insert:line"
        if (name.startsWith('file-edit:')) {
          const rest = name.slice('file-edit:'.length);
          // Try to parse replace pattern: path:replace:start-end
          const replaceMatch = rest.match(/^(.+?):replace:(\d+)-(\d+)$/);
          if (replaceMatch) {
            return {
              type: 'tool-call' as const,
              toolCallId: toolCall.toolCallId,
              toolName: 'file-edit',
              input: JSON.stringify({
                filePath: replaceMatch[1],
                mode: 'replace',
                startLine: parseInt(replaceMatch[2], 10),
                endLine: parseInt(replaceMatch[3], 10),
                content: String(toolCall.input ?? ''),
              }),
            };
          }
          // Try to parse insert pattern: path:insert:line
          const insertMatch = rest.match(/^(.+?):insert:(\d+)$/);
          if (insertMatch) {
            return {
              type: 'tool-call' as const,
              toolCallId: toolCall.toolCallId,
              toolName: 'file-edit',
              input: JSON.stringify({
                filePath: insertMatch[1],
                mode: 'insert',
                startLine: parseInt(insertMatch[2], 10),
                content: String(toolCall.input ?? ''),
              }),
            };
          }
          // Fallback: can't parse, redirect to file-edit with raw info
          return {
            type: 'tool-call' as const,
            toolCallId: toolCall.toolCallId,
            toolName: 'file-edit',
            input: JSON.stringify({
              filePath: rest,
              mode: 'replace',
              startLine: 1,
              endLine: 1,
              content: String(toolCall.input ?? ''),
            }),
          };
        }

        return null;
      } : undefined,
      onChunk({ chunk }) {
        // Accumulate text deltas into fileBlockStore's step buffer
        // so that tool execute() can parse file blocks from the current step
        if (chunk.type === 'text-delta' && agentType === 'developer') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK chunk type doesn't expose .text
          fileBlockStore.appendStepText((chunk as any).text ?? '');
        }
      },
      prepareStep: async ({ messages }) => {
        try {
          // Context compaction
          const tokens = estimateMessagesTokens(messages);
          if (tokens > COMPACTION_THRESHOLD) {
            return {
              messages: pruneMessages({
                messages,
                reasoning: 'all',
                toolCalls: 'before-last-3-messages',
                emptyMessages: 'remove',
              }),
            };
          }

          // Execute file blocks from assistant messages (only for developer agent)
          if (agentType === 'developer') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK step messages type mismatch
            const results = await parseAndExecuteFileBlocks(messages as any);
            if (results.length > 0) {
              const resultText = results.map(r =>
                r.success
                  ? `✅ [file-${r.mode}] ${r.message}`
                  : `❌ [file-${r.mode}] ${r.message}`
              ).join('\n');
              return {
                instructions: `${finalInstructions}\n\n[文件操作结果]\n${resultText}`,
              };
            }
          }
        } catch (err) {
          // prepareStep errors must not crash the stream — log and continue
          console.error('[Chat API] prepareStep error (recovered):', err);
        }
      },
      onStepFinish: async (stepResult) => {
        try {
          stepCount++;

          // Clear step text buffer (already parsed by tools via flushFileBlocks)
          fileBlockStore.clearStepText();

          // Execute file blocks from step text (fallback for when prepareStep doesn't run)
          if (agentType === 'developer' && stepResult.text) {
            const blockCount = fileBlockStore.parseAndStore(stepResult.text);
            if (blockCount > 0) {
              console.log(`[Chat API] Parsed ${blockCount} file block(s) from step ${stepCount}`);
            }
          }

          // Capture debug info for this step (only when debug panel is enabled)
          if (DEBUG_ENABLED) {
          // Use request.messages from stepResult if available, otherwise fall back to snapshot
          const stepRequestMessages = (stepResult.request?.messages?.length)
            ? serializeMessagesForDebug(stepResult.request.messages)
            : requestMessagesSnapshot;

          const stepLog = {
            step: stepCount,
            agent: agentType,
            model: stepResult.model?.modelId ?? config.model.modelId ?? 'unknown',
            request: {
              instructions: finalInstructions.slice(0, 500) + (finalInstructions.length > 500 ? '...' : ''),
              messages: stepRequestMessages,
              tools: Object.keys(config.tools),
            },
            response: {
              text: stepResult.text || undefined,
              reasoningText: stepResult.reasoningText || undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK toolCall type is loosely typed
              toolCalls: stepResult.toolCalls?.map((tc: any) => ({
                toolName: tc.toolName,
                args: tc.args,
              })) || undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK toolResult type is loosely typed
              toolResults: stepResult.toolResults?.map((tr: any) => ({
                toolName: tr.toolName,
                result: typeof tr.result === 'string'
                  ? tr.result.slice(0, 300)
                  : JSON.stringify(tr.result).slice(0, 300),
              })) || undefined,
              finishReason: stepResult.finishReason,
              usage: stepResult.usage
                ? {
                    inputTokens: stepResult.usage.inputTokens,
                    outputTokens: stepResult.usage.outputTokens,
                    totalTokens: stepResult.usage.totalTokens,
                  }
                : undefined,
            },
          };
          debugLogs.push(stepLog);

          // Write debug logs to file immediately after each step
          // (only effective for teacher — developer uses onEnd fallback below)
          if (debugLogs.length > 0) {
            try {
              setDebugLogs(debugId, debugLogs);
            } catch (err) {
              console.error('[Chat API] Failed to store debug logs:', err);
            }
          }
        }
        } catch (err) {
          // onStepFinish errors must not crash the stream — log and continue
          console.error('[Chat API] onStepFinish error (recovered):', err);
        }
      },
    });

    // Get the SSE stream response — use onEnd to capture steps that
    // onStepFinish missed (e.g. deepseek-reasoner doesn't trigger onStepFinish)
    const streamResponse = result.toUIMessageStreamResponse({
      onError: (error) => {
        // Log the real error server-side for debugging
        console.error('[Chat API] Stream error:', error);
        // Return a more descriptive message to the client
        const errObj = error as Record<string, unknown>;
        if (errObj?.name === 'NoSuchToolError') {
          return `工具不存在: ${errObj?.toolName ?? 'unknown'}`;
        }
        if (errObj?.name === 'InvalidToolInputError') {
          return `工具参数无效: ${errObj?.message ?? String(error)}`;
        }
        return `执行出错: ${String(error).slice(0, 200)}`;
      },
      onEnd: async () => {
        // If debug is disabled or onStepFinish already wrote logs, skip
        if (!DEBUG_ENABLED || debugLogs.length > 0) return;

        try {
          // result.steps resolves after the stream is fully consumed
          const steps = await result.steps;
          for (const step of steps) {
            const stepRequestMessages = (step.request?.messages?.length)
              ? serializeMessagesForDebug(step.request.messages)
              : requestMessagesSnapshot;

            debugLogs.push({
              step: debugLogs.length + 1,
              agent: agentType,
              model: step.model?.modelId ?? 'unknown',
              request: {
                instructions: finalInstructions.slice(0, 500) + (finalInstructions.length > 500 ? '...' : ''),
                messages: stepRequestMessages,
                tools: Object.keys(config.tools),
              },
              response: {
                text: step.text || undefined,
                reasoningText: step.reasoningText || undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK step types are loosely typed
                toolCalls: step.toolCalls?.map((tc: any) => ({
                  toolName: tc.toolName,
                  args: tc.args,
                })) || undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK step types are loosely typed
                toolResults: step.toolResults?.map((tr: any) => ({
                  toolName: tr.toolName,
                  result: typeof tr.result === 'string'
                    ? tr.result.slice(0, 300)
                    : JSON.stringify(tr.result).slice(0, 300),
                })) || undefined,
                finishReason: step.finishReason,
                usage: step.usage
                  ? {
                      inputTokens: step.usage.inputTokens,
                      outputTokens: step.usage.outputTokens,
                      totalTokens: step.usage.totalTokens,
                    }
                  : undefined,
              },
            });
          }

          if (debugLogs.length > 0) {
            setDebugLogs(debugId, debugLogs);
            console.log(`[Chat API] Debug logs written via onEnd: ${debugId} (${debugLogs.length} steps)`);
          }
        } catch (err) {
          console.error('[Chat API] Failed to capture debug logs via onEnd:', err);
        }
      },
    });
    const originalBody = streamResponse.body!;

    // Wrap the stream: after it ends, if step limit was hit,
    // append a custom SSE event so the frontend knows.
    // Also handle abort gracefully.
    const transformedBody = new ReadableStream({
      async start(controller) {
        const reader = originalBody.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }

          // Stream ended normally

          // Execute any remaining file blocks (when LLM's last step had blocks but no next step)
          if (agentType === 'developer') {
            // First, parse any remaining step text buffer into pending store
            // (needed when onStepFinish doesn't fire, e.g. deepseek-reasoner)
            const { fileBlockStore } = await import('@/lib/ai/utils/file-block-store');
            const stepText = fileBlockStore.getStepText();
            if (stepText) {
              const parsed = fileBlockStore.parseAndStore(stepText);
              if (parsed > 0) {
                console.log(`[Chat API] Parsed ${parsed} file block(s) from step text at stream end`);
              }
              fileBlockStore.clearStepText();
            }

            if (fileBlockStore.size > 0) {
              const { executeFileBlocks } = await import('@/lib/ai/utils/file-block-executor');
              const results = await executeFileBlocks();
              if (results.length > 0) {
                const resultText = results.map(r =>
                  r.success
                    ? `\n✅ [file-${r.mode}] ${r.message}`
                    : `\n❌ [file-${r.mode}] ${r.message}`
                ).join('');
                const textDeltaEvent = `data: ${JSON.stringify({ type: 'text-delta', textDelta: resultText })}\n\n`;
                controller.enqueue(new TextEncoder().encode(textDeltaEvent));
                console.log(`[Chat API] Executed ${results.length} file block(s) at stream end`);
              }
            }
          }

          // Check if we hit the step limit
          if (stepCount >= MAX_STEPS) {
            const warning =
              '\n\n---\n⚠ **任务因步数限制中断** — 已执行 ' +
              stepCount +
              '/' +
              MAX_STEPS +
              ' 步工具调用，部分工作可能未完成。请回复"继续"让我接着做。';
            const textDeltaEvent = `data: ${JSON.stringify({ type: 'text-delta', textDelta: warning })}\n\n`;
            controller.enqueue(new TextEncoder().encode(textDeltaEvent));
            console.log(
              `[Chat API] ⚠ Step limit reached: ${stepCount}/${MAX_STEPS}. Appended warning as text-delta.`,
            );
          }
        } catch (err: unknown) {
          if ((err as Record<string, unknown>)?.name !== 'AbortError') {
            console.error('[Chat API Stream Error]', err);
          }
        } finally {
          try { controller.close(); } catch {}
        }
      },
    });

    // Return response with debug ID in header (only when debug panel is enabled)
    const headers = new Headers(streamResponse.headers);
    if (DEBUG_ENABLED && debugId) {
      headers.set('X-Debug-Id', debugId);
    }

    return new Response(transformedBody, {
      headers,
      status: streamResponse.status,
      statusText: streamResponse.statusText,
    });
  } catch (error) {
    console.error('[Chat API Error]', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ── Message Sanitization ─────────────────────────────────────────────────

/**
 * Extract text content from a UIMessage, handling both V7 'parts' format
 * and legacy 'content' string format.
 */
function extractTextFromMessage(message: UIMessage | undefined): string {
  if (!message) return '';

  // V7 format: parts array with text parts
  if (message.parts && Array.isArray(message.parts)) {
    return message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }

  // Legacy format: content string
  const legacyContent = (message as unknown as Record<string, unknown>).content;
  if (typeof legacyContent === 'string') {
    return legacyContent;
  }

  return '';
}

/**
 * Remove orphaned tool parts from UIMessages.
 *
 * Orphaned tool parts are tool results that don't have a matching tool call
 * in the same message. These come from /review, /stats commands that inject
 * results directly into the chat without going through the LLM.
 */
function sanitizeUIMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    // Normalize: if message has 'content' string but no 'parts', convert to parts format
    // This handles messages from external sources or legacy formats
    let normalized = msg;
    const msgContent = (msg as unknown as Record<string, unknown>).content;
    if ((!msg.parts || !Array.isArray(msg.parts) || msg.parts.length === 0) && typeof msgContent === 'string') {
      normalized = {
        ...msg,
        parts: [{ type: 'text' as const, text: msgContent }],
      } as UIMessage;
    }

    if (!normalized.parts || !Array.isArray(normalized.parts)) return normalized;

    // Part type guards — parts can be AI SDK typed or custom (e.g. tool-xxx from commands)
    type PartLike = Record<string, unknown>;
    const isToolPart = (p: PartLike) =>
      p.type === 'tool-invocation' ||
      (typeof p.type === 'string' && (p.type as string).startsWith('tool-') && p.type !== 'tool-invocation');

    const isToolCall = (p: PartLike) =>
      (p.type === 'tool-invocation' && (p.state === 'call' || p.state === 'partial-call')) ||
      (typeof p.type === 'string' && (p.type as string).startsWith('tool-') && p.type !== 'tool-invocation' && p.state === 'call');

    const isToolResult = (p: PartLike) =>
      (p.type === 'tool-invocation' && p.state === 'result') ||
      (typeof p.type === 'string' && (p.type as string).startsWith('tool-') && p.type !== 'tool-invocation' && (p.state === 'output-available' || p.state === 'result'));

    const hasToolCall = (normalized.parts as PartLike[]).some(isToolCall);
    const hasToolResult = (normalized.parts as PartLike[]).some(isToolResult);

    // If there are tool results but no tool calls, strip all tool parts
    if (hasToolResult && !hasToolCall) {
      const filteredParts = (normalized.parts as PartLike[]).filter((p) => !isToolPart(p));
      return {
        ...normalized,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parts type varies at runtime
        parts: (filteredParts.length > 0 ? filteredParts : [{ type: 'text' as const, text: '' }]) as any,
      };
    }

    return normalized;
  });
}
