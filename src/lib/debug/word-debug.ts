/**
 * Word Debug Logger — records per-word lookup pipeline details.
 *
 * For each word lookup, writes a debug file to data/debug/<word>_<timestamp>.md
 * containing:
 *   1. Information sources: which dict sources returned data + per-source results
 *   2. LLM input: the summarized tool result text sent to the LLM
 *   3. LLM output: the final text the LLM generated for the user
 *
 * Usage:
 *   import { wordDebugger } from '@/lib/debug/word-debug';
 *
 *   // Start tracking a word
 *   wordDebugger.startWord(word);
 *
 *   // Record each source result
 *   wordDebugger.recordSource(word, sourceName, result);
 *
 *   // Record the merged result
 *   wordDebugger.recordMerged(word, mergedEntry);
 *
 *   // Record what was sent to LLM (tool summary text)
 *   wordDebugger.recordLLMInput(word, toolName, summaryText);
 *
 *   // Record what the LLM output (streamed text)
 *   wordDebugger.recordLLMOutput(word, llmText);
 *
 *   // Flush to disk
 *   wordDebugger.flushWord(word);
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const WORD_DEBUG_ENABLED = process.env.WORD_DEBUG === 'true';
const DEBUG_DIR = path.join(process.cwd(), 'data', 'debug');

interface WordDebugSession {
	word: string;
	timestamp: string;
	sources: { name: string; result: unknown; durationMs?: number }[];
	mergedEntry: unknown;
	llmInputs: { toolName: string; text: string }[];
	llmOutput: string;
	startTime: number;
}

class WordDebugger {
	private sessions = new Map<string, WordDebugSession>();

	constructor() {
		if (!WORD_DEBUG_ENABLED) return;
		if (!existsSync(DEBUG_DIR)) {
			mkdirSync(DEBUG_DIR, { recursive: true });
		}
	}

	/** Start a debug session for a word. */
	startWord(word: string): void {
		if (!WORD_DEBUG_ENABLED) return;
		const normalized = word.toLowerCase().trim();
		if (this.sessions.has(normalized)) return; // already tracking

		this.sessions.set(normalized, {
			word: normalized,
			timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
			sources: [],
			mergedEntry: null,
			llmInputs: [],
			llmOutput: '',
			startTime: Date.now(),
		});
	}

	/** Record a per-source lookup result. */
	recordSource(word: string, sourceName: string, result: unknown, durationMs?: number): void {
		if (!WORD_DEBUG_ENABLED) return;
		const session = this.sessions.get(word.toLowerCase().trim());
		if (!session) return;

		// Avoid duplicates
		if (!session.sources.some(s => s.name === sourceName)) {
			session.sources.push({ name: sourceName, result, durationMs });
		}
	}

	/** Record the merged DictEntry. */
	recordMerged(word: string, mergedEntry: unknown): void {
		if (!WORD_DEBUG_ENABLED) return;
		const session = this.sessions.get(word.toLowerCase().trim());
		if (!session) return;
		session.mergedEntry = mergedEntry;
	}

	/** Record the text sent to the LLM as tool result. */
	recordLLMInput(word: string, toolName: string, text: string): void {
		if (!WORD_DEBUG_ENABLED) return;
		const session = this.sessions.get(word.toLowerCase().trim());
		if (!session) return;
		session.llmInputs.push({ toolName, text });
	}

	/** Accumulate LLM output text (called per text_delta). */
	recordLLMOutput(word: string, delta: string): void {
		if (!WORD_DEBUG_ENABLED) return;
		const session = this.sessions.get(word.toLowerCase().trim());
		if (!session) return;
		session.llmOutput += delta;
	}

	/** Write the debug file and remove the session. */
	flushWord(word: string): void {
		if (!WORD_DEBUG_ENABLED) return;
		const normalized = word.toLowerCase().trim();
		const session = this.sessions.get(normalized);
		if (!session) return;

		const totalMs = Date.now() - session.startTime;
		const filename = `${normalized}_${session.timestamp}.md`;
		const filepath = path.join(DEBUG_DIR, filename);

		const lines: string[] = [];

		// ── Header ──────────────────────────────────────────────────
		lines.push(`# 单词详解调试日志: ${session.word}`);
		lines.push(``);
		lines.push(`- **时间**: ${new Date().toISOString()}`);
		lines.push(`- **总耗时**: ${totalMs}ms`);
		lines.push(``);

		// ── 1. 信息源 ──────────────────────────────────────────────
		lines.push(`---`);
		lines.push(`## 1. 信息源 (Dictionary Sources)`);
		lines.push(``);

		if (session.sources.length === 0) {
			lines.push(`*无来源记录*`);
		} else {
			for (const src of session.sources) {
				const duration = src.durationMs != null ? ` (${src.durationMs}ms)` : '';
				lines.push(`### ${src.name}${duration}`);
				lines.push(``);
				if (src.result === null) {
					lines.push(`> 未返回数据 (null)`);
				} else {
					lines.push('```json');
					lines.push(JSON.stringify(src.result, null, 2));
					lines.push('```');
				}
				lines.push(``);
			}
		}

		// ── 2. 合并结果 ────────────────────────────────────────────
		lines.push(`---`);
		lines.push(`## 2. 合并结果 (Merged Entry)`);
		lines.push(``);

		if (session.mergedEntry === null) {
			lines.push(`*合并结果为 null（所有来源均未找到）*`);
		} else {
			lines.push('```json');
			lines.push(JSON.stringify(session.mergedEntry, null, 2));
			lines.push('```');
		}
		lines.push(``);

		// ── 3. LLM 输入 ───────────────────────────────────────────
		lines.push(`---`);
		lines.push(`## 3. LLM 输入 (Tool Result → LLM)`);
		lines.push(``);
		lines.push(`以下文本是工具返回给 LLM 的内容（经 summarizeResult 处理后）：`);
		lines.push(``);

		if (session.llmInputs.length === 0) {
			lines.push(`*无 LLM 输入记录*`);
		} else {
			for (const input of session.llmInputs) {
				lines.push(`### Tool: \`${input.toolName}\``);
				lines.push(``);
				lines.push('```');
				lines.push(input.text);
				lines.push('```');
				lines.push(``);
			}
		}

		// ── 4. LLM 输出 ───────────────────────────────────────────
		lines.push(`---`);
		lines.push(`## 4. LLM 输出 (Final User-Visible Text)`);
		lines.push(``);
		lines.push(`以下是 LLM 生成的最终回复文本（用户看到的内容）：`);
		lines.push(``);

		if (session.llmOutput) {
			lines.push(session.llmOutput);
		} else {
			lines.push(`*无 LLM 输出记录（可能尚未生成或未捕获）*`);
		}
		lines.push(``);

		writeFileSync(filepath, lines.join('\n'), 'utf-8');
		console.log(`[WordDebug] Written: ${filepath}`);

		this.sessions.delete(normalized);
	}

	/** Check if we're tracking a word. */
	isTracking(word: string): boolean {
		if (!WORD_DEBUG_ENABLED) return false;
		return this.sessions.has(word.toLowerCase().trim());
	}

	/** Get all currently tracked words. */
	getTrackedWords(): string[] {
		return [...this.sessions.keys()];
	}

	/** Flush all active sessions (e.g., on process exit). */
	flushAll(): void {
		if (!WORD_DEBUG_ENABLED) return;
		for (const word of this.sessions.keys()) {
			this.flushWord(word);
		}
	}
}

// Singleton — shared across jiti (pi extension) and Turbopack (Next.js) runtimes
// via globalThis to ensure both see the same instance.
const GLOBAL_KEY = Symbol.for('vocab-agent:word-debugger');

if (!(globalThis as any)[GLOBAL_KEY]) {
	(globalThis as any)[GLOBAL_KEY] = new WordDebugger();
}

export const wordDebugger: WordDebugger = (globalThis as any)[GLOBAL_KEY];
