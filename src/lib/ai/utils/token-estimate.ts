/**
 * Token estimation utilities — 中英文混合 token 估算
 *
 * 估算规则：
 * - CJK 字符（中日韩）：1 字符 ≈ 1.5 token
 * - 非 CJK 字符（英文/代码/标点）：4 字符 ≈ 1 token
 * - 混合文本按 CJK 比例加权
 *
 * 注意：这是粗略估算，实际 token 数取决于模型的 tokenizer。
 * 对于 GPT/DeepSeek 等模型，这个估算在大多数场景下误差在 ±20% 以内。
 */

import type { ModelMessage } from 'ai';

// CJK Unified Ideographs ranges + CJK Extension ranges + Hangul + Kana
const CJK_RANGES = [
  [0x4e00, 0x9fff],   // CJK Unified Ideographs
  [0x3400, 0x4dbf],   // CJK Unified Ideographs Extension A
  [0x20000, 0x2a6df], // CJK Unified Ideographs Extension B
  [0x2a700, 0x2b73f], // CJK Unified Ideographs Extension C
  [0x2b740, 0x2b81f], // CJK Unified Ideographs Extension D
  [0xf900, 0xfaff],   // CJK Compatibility Ideographs
  [0x2f800, 0x2fa1f], // CJK Compatibility Ideographs Supplement
  [0x3000, 0x303f],   // CJK Symbols and Punctuation
  [0x3040, 0x309f],   // Hiragana
  [0x30a0, 0x30ff],   // Katakana
  [0xac00, 0xd7af],   // Hangul Syllables
];

function isCJK(codePoint: number): boolean {
  return CJK_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/**
 * 估算文本的 token 数量，区分中英文。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjkCount = 0;
  let nonCjkCount = 0;

  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (isCJK(code)) {
      cjkCount++;
    } else {
      nonCjkCount++;
    }
  }

  // CJK: 1 char ≈ 1.5 token; Non-CJK: 4 chars ≈ 1 token
  return Math.ceil(cjkCount * 1.5 + nonCjkCount / 4);
}

/**
 * 从 ModelMessage 中提取纯文本内容。
 */
function extractTextContent(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return (message.content as any[])
      .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n');
  }
  return '';
}

/**
 * 估算 ModelMessage[] 的总 token 数。
 * 包括文本内容 + 工具调用的开销估算。
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let total = 0;

  for (const msg of messages) {
    // Text content
    const text = extractTextContent(msg);
    if (text) {
      total += estimateTokens(text);
    }

    // Overhead for tool calls/results (approximate)
    if (msg.role === 'tool') {
      total += 50; // tool result overhead
    }
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const hasToolCalls = (msg.content as any[]).some(
        (part: any) => part.type === 'tool-call',
      );
      if (hasToolCalls) total += 50; // tool call overhead
    }

    // Per-message overhead (role tokens, formatting)
    total += 4;
  }

  return total;
}
