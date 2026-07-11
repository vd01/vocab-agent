/**
 * Context Management — 对话上下文管理
 *
 * 策略：
 * 1. Token 预算：为模型输入设定 token 上限，超出时自动截断/摘要
 * 2. 消息窗口：保留最近 N 条完整消息，更早的消息摘要为一条 system 消息
 * 3. World State 注入：将 World State 作为 instructions 的一部分注入，而非消息
 * 4. 工具结果截断：过长的工具输出自动截断，保留关键信息
 */

import type { ModelMessage } from 'ai';

// ── Configuration ────────────────────────────────────────────────────────

export interface ContextManagerConfig {
  /** Maximum number of recent messages to keep in full */
  recentWindow: number;
  /** Maximum characters per tool result (truncated beyond this) */
  maxToolResultChars: number;
  /** Maximum total characters for the conversation context (approximate) */
  maxContextChars: number;
  /** Whether to include reasoning parts in context */
  includeReasoning: boolean;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  recentWindow: 20,
  maxToolResultChars: 3000,
  maxContextChars: 60000,
  includeReasoning: false,
};

// ── Context Manager ──────────────────────────────────────────────────────

export class ContextManager {
  private config: ContextManagerConfig;

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Trim the message list to fit within the context budget.
   *
   * Strategy:
   * 1. Keep the most recent `recentWindow` messages intact
   * 2. If older messages exist, summarize them into a single system message
   * 3. Truncate oversized tool results
   * 4. Optionally strip reasoning parts
   */
  trimMessages(messages: ModelMessage[]): {
    messages: ModelMessage[];
    trimmed: boolean;
    originalCount: number;
    summaryAdded: boolean;
    summary: string | null;
  } {
    const originalCount = messages.length;
    let trimmed = false;
    let summaryAdded = false;
    let summary: string | null = null;

    if (originalCount <= this.config.recentWindow) {
      // No trimming needed — just truncate tool results
      const processed = messages.map(m => this.truncateToolResults(m));
      return { messages: processed, trimmed: false, originalCount, summaryAdded: false, summary: null };
    }

    // Split into "old" and "recent"
    const splitIndex = originalCount - this.config.recentWindow;
    const oldMessages = messages.slice(0, splitIndex);
    const recentMessages = messages.slice(splitIndex);

    // Summarize old messages
    summary = this.summarizeMessages(oldMessages);
    trimmed = true;
    summaryAdded = true;

    // Build final message list: recent only (summary goes via instructions, not as system message)
    const result: ModelMessage[] = [];

    // Process recent messages
    for (const msg of recentMessages) {
      result.push(this.truncateToolResults(msg));
    }

    // Final check: if total chars exceed budget, trim from the front of recent
    const totalChars = this.estimateChars(result);
    if (totalChars > this.config.maxContextChars) {
      // Remove oldest messages from recent until under budget
      while (result.length > 1 && this.estimateChars(result) > this.config.maxContextChars) {
        result.splice(0, 1);
        trimmed = true;
      }
    }

    return { messages: result, trimmed, originalCount, summaryAdded, summary };
  }

  /**
   * Summarize a list of messages into a concise text.
   * This is a simple extractive summary — no LLM call needed.
   */
  private summarizeMessages(messages: ModelMessage[]): string {
    const lines: string[] = [];
    let userCount = 0;
    let assistantCount = 0;
    const topics: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        userCount++;
        // Extract first line of user message as topic
        const content = this.extractTextContent(msg);
        if (content) {
          const firstLine = content.split('\n')[0].slice(0, 80);
          topics.push(firstLine);
        }
      } else if (msg.role === 'assistant') {
        assistantCount++;
      }
    }

    lines.push(`用户发送了 ${userCount} 条消息，助手回复了 ${assistantCount} 条。`);

    if (topics.length > 0) {
      // Show last 5 topics (most recent context)
      const recentTopics = topics.slice(-5);
      lines.push(`最近讨论的话题: ${recentTopics.join('; ')}`);
    }

    // Mention tool usage
    const toolMessages = messages.filter(m => m.role === 'tool');
    if (toolMessages.length > 0) {
      lines.push(`期间使用了 ${toolMessages.length} 次工具调用。`);
    }

    return lines.join('\n');
  }

  /**
   * Truncate oversized tool results in a message.
   * In V7, tool message content is ToolContent = Array<ToolResultPart | ToolApprovalResponse>
   */
  private truncateToolResults(message: ModelMessage): ModelMessage {
    if (message.role === 'tool') {
      // V7: tool content is an array of ToolResultPart
      const content = message.content;
      if (Array.isArray(content)) {
        const truncatedParts = content.map((part: any) => {
          if (part.type === 'tool-result' && typeof part.result === 'string') {
            if (part.result.length > this.config.maxToolResultChars) {
              return {
                ...part,
                result:
                  part.result.slice(0, this.config.maxToolResultChars) +
                  `\n\n[...已截断，原始长度 ${part.result.length} 字符]`,
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
   * Extract plain text content from a message.
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
   * Rough character count estimation for context budget.
   * ~4 chars per token for English, ~2 chars per token for Chinese.
   * We use a conservative estimate of 3 chars/token.
   */
  private estimateChars(messages: ModelMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const text = this.extractTextContent(msg);
      if (text) total += text.length;
      // Account for tool call overhead
      if (msg.role === 'tool') {
        total += 200; // overhead for tool result structure
      }
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const hasToolCalls = (msg.content as any[]).some(
          (part: any) => part.type === 'tool-call',
        );
        if (hasToolCalls) total += 200;
      }
    }
    return total;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const contextManager = new ContextManager();
