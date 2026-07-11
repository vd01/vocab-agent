import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from 'ai';
import { getTeacherConfig } from '@/lib/ai/teacher-agent';
import { getDeveloperConfig } from '@/lib/ai/developer-agent';
import { routeAgent } from '@/lib/ai/agent-router';
import { buildWorldState } from '@/lib/pipeline/world-state';
import { contextManager } from '@/lib/ai/context-manager';
import { debugStore } from '@/lib/ai/debug-store';

export const maxDuration = 60;

const MAX_STEPS = 25;

// ── Debug: in-memory log store ────────────────────────────────────────────
// Temporary research tool — stores LLM interaction logs per request.
// Entries auto-expire after 5 minutes.
const debugStore = new Map<string, { logs: any[]; createdAt: number }>();

// Cleanup expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of debugStore) {
    if (now - val.createdAt > 5 * 60 * 1000) debugStore.delete(key);
  }
}, 60_000);

export { debugStore };

// ── Helper: serialize model messages for debug display ────────────────────
function serializeMessagesForDebug(messages: any[]): any[] {
  return messages.map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content.slice(0, 500) + (m.content.length > 500 ? '...' : '')
      : Array.isArray(m.content)
        ? m.content.slice(0, 5).map((c: any) => {
            if (c.type === 'text') return { type: 'text', text: c.text?.slice(0, 200) + (c.text?.length > 200 ? '...' : '') };
            if (c.type === 'tool-result') return { type: 'tool-result', toolUseId: c.toolUseId };
            if (c.type === 'tool-call') return { type: 'tool-call', toolName: c.toolName };
            return { type: c.type };
          })
        : '[complex]',
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // AI SDK V7 DefaultChatTransport sends messages in body.messages
    const uiMessages: UIMessage[] = body.messages || [];

    // Get the last user message for routing
    const lastUserMessage = [...uiMessages].reverse().find((m) => m.role === 'user');
    // V7 UIMessage uses 'parts' array, but messages from DB or external sources
    // may still use 'content' string. Handle both formats.
    const userContent = extractTextFromMessage(lastUserMessage);

    // Route to appropriate agent
    const agentType = routeAgent(userContent);

    // Build World State for context injection
    const worldState = await buildWorldState();

    let config;
    if (agentType === 'developer') {
      config = await getDeveloperConfig();
    } else {
      config = getTeacherConfig(worldState);
    }

    console.log(`[Chat API] Routed to ${agentType} agent`);

    // Sanitize UIMessages: remove orphaned tool parts that lack a matching
    // call/result pair (e.g. command results from /review, /stats that were
    // stored as standalone tool parts). These cause AI_MissingToolResultsError
    // in convertToModelMessages.
    const sanitizedMessages = sanitizeUIMessages(uiMessages);

    // Convert UIMessage[] → ModelMessage[] using AI SDK V7 converter
    const modelMessages = await convertToModelMessages(sanitizedMessages, {
      tools: config.tools,
      ignoreIncompleteToolCalls: true,
    });

    // Apply context management: trim/summarize old messages
    const { messages: trimmedMessages, trimmed, summaryAdded, summary } =
      contextManager.trimMessages(modelMessages);

    if (trimmed) {
      console.log(
        `[Context Manager] Trimmed ${modelMessages.length} → ${trimmedMessages.length} messages` +
        (summaryAdded ? ' (with summary)' : ''),
      );
    }

    // Merge conversation summary into instructions (AI SDK V7 forbids system messages in messages[])
    const finalInstructions = summary
      ? `${config.instructions}\n\n[对话历史摘要]\n${summary}`
      : config.instructions;

    // Track step count for step-limit detection
    let stepCount = 0;

    // Debug: collect LLM interaction logs per step
    const debugLogs: any[] = [];
    const debugId = `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Snapshot the actual messages sent to LLM (before any step mutates them)
    const requestMessagesSnapshot = serializeMessagesForDebug(trimmedMessages);

    const result = streamText({
      model: config.model,
      instructions: finalInstructions,
      messages: trimmedMessages,
      tools: config.tools,
      stopWhen: stepCountIs(MAX_STEPS),
      onStepFinish: async (stepResult) => {
        stepCount++;

        // Use request.messages from stepResult if available, otherwise fall back to snapshot
        const stepRequestMessages = (stepResult.request?.messages?.length)
          ? serializeMessagesForDebug(stepResult.request.messages)
          : requestMessagesSnapshot;

        // Capture debug info for this step
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
            toolCalls: stepResult.toolCalls?.map((tc: any) => ({
              toolName: tc.toolName,
              args: tc.args,
            })) || undefined,
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
      },
    });

    // Get the SSE stream response
    const streamResponse = result.toUIMessageStreamResponse();
    const originalBody = streamResponse.body!;

    // Wrap the stream: after it ends, if step limit was hit,
    // append a custom SSE event so the frontend knows
    const transformedBody = new ReadableStream({
      async start(controller) {
        const reader = originalBody.getReader();

        try {
          // Pass through all original chunks
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }

          // After stream ends, check if we hit the step limit
          if (stepCount >= MAX_STEPS) {
            // Append a text-delta event that AI SDK will render as assistant text
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

          // Store debug logs in memory for frontend to fetch
          if (debugLogs.length > 0) {
            debugStore.set(debugId, { logs: debugLogs, createdAt: Date.now() });
          }
        } catch (err) {
          console.error('[Chat API Stream Error]', err);
        } finally {
          controller.close();
        }
      },
    });

    // Return response with debug ID in header
    const headers = new Headers(streamResponse.headers);
    headers.set('X-Debug-Id', debugId);

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
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('');
  }

  // Legacy format: content string
  if (typeof (message as any).content === 'string') {
    return (message as any).content;
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
    if ((!msg.parts || !Array.isArray(msg.parts) || msg.parts.length === 0) && typeof (msg as any).content === 'string') {
      normalized = {
        ...msg,
        parts: [{ type: 'text' as const, text: (msg as any).content }],
      };
    }

    if (!normalized.parts || !Array.isArray(normalized.parts)) return normalized;

    const isToolPart = (p: any) =>
      p.type === 'tool-invocation' ||
      (typeof p.type === 'string' && p.type.startsWith('tool-') && p.type !== 'tool-invocation');

    const isToolCall = (p: any) =>
      (p.type === 'tool-invocation' && (p.state === 'call' || p.state === 'partial-call')) ||
      (typeof p.type === 'string' && p.type.startsWith('tool-') && p.type !== 'tool-invocation' && p.state === 'call');

    const isToolResult = (p: any) =>
      (p.type === 'tool-invocation' && p.state === 'result') ||
      (typeof p.type === 'string' && p.type.startsWith('tool-') && p.type !== 'tool-invocation' && (p.state === 'output-available' || p.state === 'result'));

    const hasToolCall = normalized.parts.some(isToolCall);
    const hasToolResult = normalized.parts.some(isToolResult);

    // If there are tool results but no tool calls, strip all tool parts
    if (hasToolResult && !hasToolCall) {
      const filteredParts = normalized.parts.filter((p: any) => !isToolPart(p));
      return {
        ...normalized,
        parts: filteredParts.length > 0 ? filteredParts : [{ type: 'text' as const, text: '' }],
      };
    }

    return normalized;
  });
}
