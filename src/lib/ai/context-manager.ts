/**
 * Context Management — 对话上下文管理
 *
 * 策略：
 * 1. Token 预算：为模型输入设定 token 上限，超出时自动截断/摘要
 * 2. 差异化保留：用户消息始终完整保留，assistant 消息按距离递减保留
 * 3. World State 注入：将 World State 作为 instructions 的一部分注入，而非消息
 * 4. 工具结果截断：过长的工具输出自动截断，保留关键信息
 * 5. 摘要优先级：用户意图 > 助手结论 > 工具调用记录
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
  /** Number of recent assistant rounds to keep in full */
  fullAssistantRounds: number;
  /** Maximum user topics to include in summary */
  maxUserTopics: number;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  recentWindow: 20,
  maxToolResultChars: 2000,
  maxContextChars: 60000,
  includeReasoning: false,
  fullAssistantRounds: 3,
  maxUserTopics: 10,
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
   * Strategy (priority: user messages > recent assistant > old assistant):
   * 1. Keep all user messages intact (they carry intent)
   * 2. Keep the most recent `fullAssistantRounds` assistant messages intact
   * 3. Compress older assistant messages into brief summaries
   * 4. Truncate oversized tool results
   * 5. If still over budget, remove oldest messages from front
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
      const processed = messages.map(m => this.truncateToolResults(m));
      return { messages: processed, trimmed: false, originalCount, summaryAdded: false, summary: null };
    }

    // Identify assistant message indices for round counting
    const assistantIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'assistant') assistantIndices.push(i);
    }

    // The last `fullAssistantRounds` assistant messages (and everything after them) are "recent"
    const recentAssistantStart = assistantIndices.length > this.config.fullAssistantRounds
      ? assistantIndices[assistantIndices.length - this.config.fullAssistantRounds]
      : 0;

    // Split: messages before recentAssistantStart are "old", rest are "recent"
    const splitIndex = Math.min(recentAssistantStart, originalCount - this.config.recentWindow);
    const oldMessages = messages.slice(0, Math.max(splitIndex, 0));
    const recentMessages = messages.slice(Math.max(splitIndex, 0));

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

    // Final check: if total chars exceed budget, trim from the front
    // But prefer removing assistant messages over user messages
    const totalChars = this.estimateChars(result);
    if (totalChars > this.config.maxContextChars) {
      this.trimToBudget(result);
      trimmed = true;
    }

    return { messages: result, trimmed, originalCount, summaryAdded, summary };
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
   * Trim messages to fit budget, preferring to remove assistant messages.
   */
  private trimToBudget(result: ModelMessage[]): void {
    // First pass: remove oldest assistant messages (keep user messages)
    while (result.length > 1 && this.estimateChars(result) > this.config.maxContextChars) {
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
   * In V7, tool message content is ToolContent = Array<ToolResultPart | ToolApprovalResponse>
   */
  private truncateToolResults(message: ModelMessage): ModelMessage {
    if (message.role === 'tool') {
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
      if (msg.role === 'tool') {
        total += 200;
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
