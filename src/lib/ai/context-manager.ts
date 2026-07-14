/**
 * Context Management — 对话上下文管理
 *
 * 策略：
 * 1. 功能性消息过滤：/review, /stats 等命令消息不发给 LLM
 * 2. Prompt Cache 友好：同会话内不改变消息前缀，保证 cache 命中
 * 3. Cache TTL：距上次请求 ≥ 4h 时 cache 已失效，可放心做完整 trim
 * 4. 工具结果截断：过长的工具输出自动截断，保留关键信息
 * 5. 跨会话 trim：摘要优先级 — 用户意图 > 助手结论 > 工具调用记录
 */

import type { UIMessage, ModelMessage } from 'ai';
import { estimateTokens } from './utils/token-estimate';

// ── Configuration ────────────────────────────────────────────────────────

export interface ContextManagerConfig {
  /** Maximum number of recent messages to keep in full (cross-session trim only) */
  recentWindow: number;
  /** Maximum tokens per tool result (truncated beyond this) */
  maxToolResultTokens: number;
  /** Maximum total tokens for the conversation context (approximate) */
  maxContextTokens: number;
  /** Whether to include reasoning parts in context */
  includeReasoning: boolean;
  /** Number of recent assistant rounds to keep in full (cross-session trim only) */
  fullAssistantRounds: number;
  /** Maximum user topics to include in summary */
  maxUserTopics: number;
  /** Cache TTL in ms — trim is skipped within this window to preserve prefix cache */
  cacheTtlMs: number;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  recentWindow: 50,
  maxToolResultTokens: 800,
  maxContextTokens: 80000,
  includeReasoning: false,
  fullAssistantRounds: 3,
  maxUserTopics: 10,
  cacheTtlMs: 4 * 60 * 60 * 1000, // 4 hours
};

// ── Context Manager ──────────────────────────────────────────────────────

export class ContextManager {
  private config: ContextManagerConfig;
  /** Timestamp of the last LLM request (used for cache TTL) */
  private lastRequestTime: number = 0;

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Filter out functional command messages that don't need to be sent to LLM.
   *
   * Functional messages are identified by:
   * - User message text starts with '/' (e.g. /review, /stats)
   * - The following assistant message contains only tool parts (no text)
   *
   * This only affects what's sent to the LLM — the frontend and DB
   * still retain these messages for display.
   */
  filterFunctionalMessages(messages: UIMessage[]): UIMessage[] {
    if (messages.length === 0) return messages;

    const skipIndices = new Set<number>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;

      // Check if user message starts with '/'
      const userText = this.extractUIText(msg);
      if (!userText || !userText.trim().startsWith('/')) continue;

      // Check if the next message is an assistant with only tool parts
      if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
        const nextMsg = messages[i + 1];
        if (this.isFunctionalAssistantMessage(nextMsg)) {
          skipIndices.add(i);
          skipIndices.add(i + 1);
        }
      }
    }

    if (skipIndices.size === 0) return messages;

    return messages.filter((_, idx) => !skipIndices.has(idx));
  }

  /**
   * Check if an assistant message contains only functional tool parts
   * (no text content — just tool results from command execution).
   */
  private isFunctionalAssistantMessage(msg: UIMessage): boolean {
    if (!msg.parts || !Array.isArray(msg.parts)) return false;

    // If there's any text part with non-empty content, it's not purely functional
    const hasTextContent = msg.parts.some(
      (p: any) => p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0,
    );
    if (hasTextContent) return false;

    // If all parts are tool-related, it's functional
    const allToolParts = msg.parts.every((p: any) =>
      p.type === 'tool-invocation' ||
      (typeof p.type === 'string' && p.type.startsWith('tool-')),
    );
    return allToolParts && msg.parts.length > 0;
  }

  /**
   * Extract plain text from a UIMessage.
   */
  private extractUIText(msg: UIMessage): string | null {
    if (!msg.parts || !Array.isArray(msg.parts)) {
      // Legacy format
      if (typeof (msg as any).content === 'string') return (msg as any).content;
      return null;
    }
    return msg.parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n');
  }

  /**
   * Trim the message list to fit within the context budget.
   *
   * Cache-aware strategy:
   * - Within cache TTL (< 4h since last request): only filter functional
   *   messages and truncate tool results — NO prefix changes to preserve cache
   * - Beyond cache TTL (≥ 4h): cache is stale, safe to do full trim
   *   (summarize old messages, remove from front, etc.)
   */
  trimMessages(messages: ModelMessage[]): {
    messages: ModelMessage[];
    trimmed: boolean;
    originalCount: number;
    summaryAdded: boolean;
    summary: string | null;
    cacheAware: boolean;
  } {
    const now = Date.now();
    // Check if we're within the cache TTL — preserve prefix for cache hits
    // First request (lastRequestTime === 0) is treated as cross-session
    // since there's no cache to protect yet, but we still only trim if needed.
    const withinCacheTtl = this.lastRequestTime > 0 &&
      (now - this.lastRequestTime) < this.config.cacheTtlMs;

    // Save the time gap before updating lastRequestTime
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Update last request time
    this.lastRequestTime = now;

    const originalCount = messages.length;
    let trimmed = false;
    let summaryAdded = false;
    let summary: string | null = null;

    // Always: truncate oversized tool results
    const processed = messages.map(m => this.truncateToolResults(m));

    if (withinCacheTtl) {
      // Same session — preserve message prefix for cache hits.
      // Note: we still truncate oversized tool results. This may slightly
      // alter message content, but tool results are typically in the tail
      // of the prompt, so the prefix (which matters for caching) stays intact.
      console.log(
        `[Context Manager] Cache-aware mode: skipping trim (last request ${Math.round(timeSinceLastRequest / 60000)}min ago, TTL ${Math.round(this.config.cacheTtlMs / 60000)}min)`,
      );
      return {
        messages: processed,
        trimmed: false,
        originalCount,
        summaryAdded: false,
        summary: null,
        cacheAware: true,
      };
    }

    // Cross-session — cache is stale, safe to do full trim
    if (originalCount <= this.config.recentWindow) {
      return {
        messages: processed,
        trimmed: false,
        originalCount,
        summaryAdded: false,
        summary: null,
        cacheAware: false,
      };
    }

    // Identify assistant message indices for round counting
    const assistantIndices: number[] = [];
    for (let i = 0; i < processed.length; i++) {
      if (processed[i].role === 'assistant') assistantIndices.push(i);
    }

    // The last `fullAssistantRounds` assistant messages (and everything after them) are "recent"
    const recentAssistantStart = assistantIndices.length > this.config.fullAssistantRounds
      ? assistantIndices[assistantIndices.length - this.config.fullAssistantRounds]
      : 0;

    // Split: messages before recentAssistantStart are "old", rest are "recent"
    const splitIndex = Math.min(recentAssistantStart, originalCount - this.config.recentWindow);
    const oldMessages = processed.slice(0, Math.max(splitIndex, 0));
    const recentMessages = processed.slice(Math.max(splitIndex, 0));

    // Summarize old messages with differential treatment
    if (oldMessages.length > 0) {
      summary = this.summarizeMessages(oldMessages);
      trimmed = true;
      summaryAdded = true;
    }

    // Build final message list
    const result: ModelMessage[] = [];
    for (const msg of recentMessages) {
      result.push(this.truncateToolResults(msg));
    }

    // Final check: if total tokens exceed budget, trim from the front
    const totalTokens = this.estimateMessagesTokens(result);
    if (totalTokens > this.config.maxContextTokens) {
      this.trimToBudget(result);
      trimmed = true;
    }

    return {
      messages: result,
      trimmed,
      originalCount,
      summaryAdded,
      summary,
      cacheAware: false,
    };
  }

  /**
   * Summarize old messages with differential treatment:
   * - User messages: list all topics (up to maxUserTopics)
   * - Assistant messages: only brief summary (first sentence + tool names)
   */
  private summarizeMessages(messages: ModelMessage[]): string {
    const lines: string[] = [];
    const userTopics: string[] = [];
    const assistantSummaries: string[] = [];
    let toolCallCount = 0;

    for (const msg of messages) {
      if (msg.role === 'user') {
        const content = this.extractTextContent(msg);
        if (content) {
          const firstLine = content.split('\n')[0].slice(0, 120);
          userTopics.push(firstLine);
        }
      } else if (msg.role === 'assistant') {
        const text = this.extractTextContent(msg);
        const tools = this.extractToolNames(msg);
        toolCallCount += tools.length;

        const firstSentence = text
          ? text.split(/[。！？\n]/)[0].slice(0, 80)
          : '';
        const toolStr = tools.length > 0 ? ` [调用: ${tools.join(',')}]` : '';
        if (firstSentence || toolStr) {
          assistantSummaries.push(firstSentence + toolStr);
        }
      } else if (msg.role === 'tool') {
        toolCallCount++;
      }
    }

    // User messages: full topic list (high value)
    if (userTopics.length > 0) {
      const topics = userTopics.slice(-this.config.maxUserTopics);
      lines.push(`用户消息 (${userTopics.length} 条):`);
      topics.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
      if (userTopics.length > this.config.maxUserTopics) {
        lines.push(`  ...省略前 ${userTopics.length - this.config.maxUserTopics} 条`);
      }
    }

    // Assistant messages: compressed summary (low value)
    if (assistantSummaries.length > 0) {
      lines.push(`助手回复 (${assistantSummaries.length} 条):`);
      const recentSummaries = assistantSummaries.slice(-5);
      recentSummaries.forEach(s => lines.push(`  - ${s}`));
      if (assistantSummaries.length > 5) {
        lines.push(`  ...省略前 ${assistantSummaries.length - 5} 条`);
      }
    }

    if (toolCallCount > 0) {
      lines.push(`工具调用共 ${toolCallCount} 次。`);
    }

    return lines.join('\n');
  }

  /**
   * Trim messages to fit token budget, preferring to remove assistant messages.
   * Only called during cross-session trim (cache is already stale).
   */
  private trimToBudget(result: ModelMessage[]): void {
    // First pass: remove oldest assistant messages (keep user messages)
    while (result.length > 1 && this.estimateMessagesTokens(result) > this.config.maxContextTokens) {
      // Find the oldest assistant message
      const idx = result.findIndex(m => m.role === 'assistant');
      if (idx >= 0 && idx < result.length - 2) {
        // Also remove the associated tool message right after it
        result.splice(idx, 1);
        if (result[idx]?.role === 'tool') {
          result.splice(idx, 1);
        }
      } else {
        // No more assistant messages to remove, fall back to removing from front
        result.splice(0, 1);
      }
    }
  }

  /**
   * Extract tool names from an assistant message's tool-call parts.
   */
  private extractToolNames(message: ModelMessage): string[] {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      return (message.content as any[])
        .filter((part: any) => part.type === 'tool-call')
        .map((part: any) => part.toolName);
    }
    return [];
  }

  /**
   * Truncate oversized tool results in a message.
   * Uses token-based truncation: if a tool result exceeds the token budget,
   * truncate the string to fit within the budget.
   */
  private truncateToolResults(message: ModelMessage): ModelMessage {
    if (message.role === 'tool') {
      const content = message.content;
      if (Array.isArray(content)) {
        const truncatedParts = content.map((part: any) => {
          if (part.type === 'tool-result' && typeof part.result === 'string') {
            const resultTokens = estimateTokens(part.result);
            if (resultTokens > this.config.maxToolResultTokens) {
              // Estimate how many characters to keep based on token ratio
              const ratio = this.config.maxToolResultTokens / resultTokens;
              const keepChars = Math.floor(part.result.length * ratio * 0.9); // 0.9 safety margin
              return {
                ...part,
                result:
                  part.result.slice(0, keepChars) +
                  `\n\n[...已截断，原始 ${resultTokens} 估算 token，保留约 ${this.config.maxToolResultTokens} token]`,
              };
            }
          }
          return part;
        });
        return { ...message, content: truncatedParts } as ModelMessage;
      }
    }

    return message;
  }

  /**
   * Extract plain text content from a ModelMessage.
   */
  private extractTextContent(message: ModelMessage): string | null {
    if (message.role === 'system') {
      return typeof message.content === 'string' ? message.content : null;
    }
    if (message.role === 'user') {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join('\n');
      }
    }
    if (message.role === 'assistant') {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join('\n');
      }
    }
    return null;
  }

  /**
   * Estimate total tokens for a list of messages.
   * Uses the shared estimateTokens utility with CJK-aware token counting.
   */
  private estimateMessagesTokens(messages: ModelMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const text = this.extractTextContent(msg);
      if (text) total += estimateTokens(text);
      if (msg.role === 'tool') {
        total += 50; // tool result overhead
      }
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const hasToolCalls = (msg.content as any[]).some(
          (part: any) => part.type === 'tool-call',
        );
        if (hasToolCalls) total += 50; // tool call overhead
      }
      total += 4; // per-message overhead
    }
    return total;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const contextManager = new ContextManager();
