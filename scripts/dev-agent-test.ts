/**
 * Developer Agent 自动化测试脚本 (pi SDK 版本)
 *
 * 遍历测试用例，向 Developer Agent 发送 prompt，
 * 收集效率指标，用 LLM 判断需求符合度，生成汇总报告。
 *
 * 与旧版的区别：
 * - 使用 pi SDK SSE 事件格式（text-delta, tool-start, tool-result）
 * - 文件操作通过 pi 内置 write/edit 工具（不再有标记块）
 * - 请求格式: { message, mode: "develop" }
 *
 * 运行方式: npx tsx scripts/dev-agent-test.ts [--group A|B|C|D] [--no-judge] [--no-clean]
 * 前提条件: 开发服务器必须已在运行 (npm run dev -- --turbopack --port 3088)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  TEST_CASES,
  TEST_GROUPS,
  getTestCasesByGroup,
  type TestCase,
} from './dev-agent-test-cases';

// ── 配置 ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3088';
const REPORTS_DIR = path.join(process.cwd(), 'reports');

// ── 认证 ────────────────────────────────────────────────────────────────

const COOKIE_NAME = 'vocab-auth';
const AUTH_SALT = 'vocab-agent-2024';
let authCookie: string = '';

async function generateAuthToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(password + AUTH_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function initAuth(env: Record<string, string>): Promise<void> {
  const password = env.AUTH_PASSWORD || process.env.AUTH_PASSWORD;
  if (password) {
    const token = await generateAuthToken(password);
    authCookie = `${COOKIE_NAME}=${token}`;
    console.log('🔑 认证 token 已生成');
  } else {
    console.log('⚠️ 未配置 AUTH_PASSWORD，跳过认证');
  }
}

// ── 内联工具函数 ─────────────────────────────────────────────────────────

const CJK_RANGES = [
  [0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x20000, 0x2a6df],
  [0x3000, 0x303f], [0x3040, 0x309f], [0x30a0, 0x30ff],
  [0xac00, 0xd7af], [0xf900, 0xfaff],
];

function isCJK(cp: number): boolean {
  return CJK_RANGES.some(([s, e]) => cp >= s && cp <= e);
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0, nonCjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isCJK(cp)) cjk++; else nonCjk++;
  }
  return Math.ceil(cjk * 1.5 + nonCjk / 4);
}

// ── 环境变量加载 ─────────────────────────────────────────────────────────

function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

// ── 类型定义 ─────────────────────────────────────────────────────────────

interface ToolCallRecord {
  toolName: string;
  toolCallId: string;
  input: any;
  output: any;
  isError: boolean;
}

interface FileOperation {
  tool: string;       // 'readSeek_write' | 'readSeek_edit' | 'write' | 'edit'
  filePath: string;
  content?: string;   // for write operations
  description: string;
}

interface TestResult {
  testCaseId: string;
  prompt: string;
  responseText: string;
  reasoningText: string;
  toolCalls: ToolCallRecord[];
  fileOperations: FileOperation[];
  responseTimeMs: number;
  estimatedTokens: number;
  codeGenerated: string;
  codeLineCount: number;
  toolCallCount: number;
  error?: string;
}

interface JudgeResult {
  testCaseId: string;
  score: number;
  compliance: boolean;
  issues: string[];
  reasoning: string;
  error?: string;
}

// ── SSE 流解析 (pi SDK format) ───────────────────────────────────────────

/**
 * 发送消息给 Developer Agent 并收集完整响应。
 * 使用 pi SDK SSE 事件格式：
 *   text-delta     → 流式文本
 *   thinking-delta → 推理文本
 *   tool-start     → 工具开始执行
 *   tool-result    → 工具执行结果
 *   agent-start    → Agent 开始
 *   agent-end      → Agent 结束
 *   error          → 错误
 */
async function sendDeveloperMessage(
  prompt: string,
  timeoutMs: number,
): Promise<TestResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authCookie) headers['Cookie'] = authCookie;

    // pi SDK request format: { message, mode }
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: prompt, mode: 'develop' }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        testCaseId: '',
        prompt,
        responseText: '',
        reasoningText: '',
        toolCalls: [],
        fileOperations: [],
        responseTimeMs: Date.now() - startTime,
        estimatedTokens: 0,
        codeGenerated: '',
        codeLineCount: 0,
        toolCallCount: 0,
        error: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
      };
    }

    // Read SSE stream and collect events
    const reader = res.body?.getReader();
    if (!reader) {
      return {
        testCaseId: '',
        prompt,
        responseText: '',
        reasoningText: '',
        toolCalls: [],
        fileOperations: [],
        responseTimeMs: Date.now() - startTime,
        estimatedTokens: 0,
        codeGenerated: '',
        codeLineCount: 0,
        toolCallCount: 0,
        error: 'No response body',
      };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let textAccum = '';
    let reasoningAccum = '';
    const toolCalls = new Map<string, ToolCallRecord>();
    const fileOperations: FileOperation[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages (separated by \n\n)
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'text-delta') {
              textAccum += event.delta ?? '';
            } else if (event.type === 'thinking-delta') {
              reasoningAccum += event.delta ?? '';
            } else if (event.type === 'tool-start') {
              toolCalls.set(event.toolCallId, {
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                input: {},
                output: null,
                isError: false,
              });
            } else if (event.type === 'tool-result') {
              const existing = toolCalls.get(event.toolCallId);
              const isError = event.isError === true;
              const output = event.uiData ?? event.textContent ?? null;
              if (existing) {
                existing.output = output;
                existing.isError = isError;
              } else {
                toolCalls.set(event.toolCallId, {
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  input: {},
                  output,
                  isError,
                });
              }
              // Detect file operations
              if (isFileWriteTool(event.toolName)) {
                const filePath = extractFilePath(event.toolName, output);
                const content = extractFileContent(event.toolName, output);
                if (filePath) {
                  fileOperations.push({
                    tool: event.toolName,
                    filePath,
                    content: content ?? undefined,
                    description: `${event.toolName}: ${filePath}`,
                  });
                }
              }
            }
          } catch {}
        }
      }
    }

    // Process remaining buffer
    if (buffer.includes('data: ')) {
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'text-delta') textAccum += event.delta ?? '';
          else if (event.type === 'thinking-delta') reasoningAccum += event.delta ?? '';
        } catch {}
      }
    }

    // Extract file operation content for code stats
    const codeGenerated = fileOperations
      .filter(fo => fo.content && (fo.tool.includes('write') || fo.tool.includes('edit')))
      .map(fo => fo.content!)
      .join('\n');
    const codeLineCount = codeGenerated ? codeGenerated.split('\n').length : 0;

    return {
      testCaseId: '',
      prompt,
      responseText: textAccum,
      reasoningText: reasoningAccum,
      toolCalls: Array.from(toolCalls.values()),
      fileOperations,
      responseTimeMs: Date.now() - startTime,
      estimatedTokens: estimateTokens(textAccum + reasoningAccum),
      codeGenerated,
      codeLineCount,
      toolCallCount: Array.from(toolCalls.values()).length,
    };
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return {
      testCaseId: '',
      prompt,
      responseText: '',
      reasoningText: '',
      toolCalls: [],
      fileOperations: [],
      responseTimeMs: Date.now() - startTime,
      estimatedTokens: 0,
      codeGenerated: '',
      codeLineCount: 0,
      toolCallCount: 0,
      error: isTimeout ? `超时 (${timeoutMs / 1000}s)` : String(err?.message || err).slice(0, 500),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Check if a tool is a file write/edit tool */
function isFileWriteTool(toolName: string): boolean {
  return [
    'readSeek_write', 'readSeek_edit',
    'write', 'edit',
    'file-write', 'file-edit',
  ].includes(toolName);
}

/** Extract file path from tool output */
function extractFilePath(toolName: string, output: any): string | null {
  if (!output) return null;
  if (typeof output === 'string') {
    // Try to extract path from string output
    const pathMatch = output.match(/(?:wrote|edited|created|updated|file):\s*`?([^\s`]+\.\w+)`?/i);
    return pathMatch?.[1] ?? null;
  }
  if (typeof output === 'object') {
    return output.path ?? output.filePath ?? output.file_path ?? null;
  }
  return null;
}

/** Extract file content from tool output */
function extractFileContent(toolName: string, output: any): string | null {
  if (!output) return null;
  if (typeof output === 'object') {
    return output.content ?? output.text ?? null;
  }
  return null;
}

// ── 截断 JSON 修复 ───────────────────────────────────────────────────────

function tryRepairTruncatedJSON(jsonStr: string): any | null {
  let s = jsonStr.trim();

  let cutIdx = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === '"') {
      const after = s.slice(i + 1).trim();
      if (after === '' || after.startsWith(',') || after.startsWith('}') || after.startsWith(']')) {
        cutIdx = i + 1;
        if (after.startsWith(',')) cutIdx = i + 1 + after.indexOf(',') + 1;
        break;
      }
    }
  }

  if (cutIdx > 0) {
    s = s.slice(0, cutIdx).trimEnd();
    if (s.endsWith(',')) s = s.slice(0, -1).trimEnd();
  }

  let openBraces = 0, openBrackets = 0;
  let inString = false, escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openBraces++;
    if (ch === '}') openBraces--;
    if (ch === '[') openBrackets++;
    if (ch === ']') openBrackets--;
  }

  s += ']'.repeat(Math.max(0, openBrackets));
  s += '}'.repeat(Math.max(0, openBraces));

  try {
    const parsed = JSON.parse(s);
    if (typeof parsed.score === 'number') {
      if (typeof parsed.compliance !== 'boolean') {
        parsed.compliance = parsed.score >= 4;
      }
      return parsed;
    }
  } catch {}

  const scoreMatch = s.match(/"score"\s*:\s*(\d+)/);
  const complianceMatch = s.match(/"compliance"\s*:\s*(true|false)/);
  const issuesMatch = s.match(/"issues"\s*:\s*\[([\s\S]*?)\]/);
  const reasoningMatch = s.match(/"reasoning"\s*:\s*"([\s\S]*?)(?:"|$)/);

  if (scoreMatch) {
    return {
      score: parseInt(scoreMatch[1], 10),
      compliance: complianceMatch ? complianceMatch[1] === 'true' : (parseInt(scoreMatch[1], 10) >= 4),
      issues: issuesMatch ? issuesMatch[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean) : [],
      reasoning: reasoningMatch ? reasoningMatch[1] : '(reasoning 被截断)',
    };
  }

  return null;
}

// ── LLM 评判 ─────────────────────────────────────────────────────────────

async function judgeResult(
  testCase: TestCase,
  result: TestResult,
  env: Record<string, string>,
): Promise<JudgeResult> {
  const apiKey = env.JUDGE_API_KEY || env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = env.JUDGE_BASE_URL || env.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL;
  const judgeModel = env.JUDGE_MODEL || process.env.JUDGE_MODEL || 'deepseek-v4-flash';

  if (!apiKey || !baseUrl) {
    return {
      testCaseId: testCase.id,
      score: 0,
      compliance: false,
      issues: ['无法执行 LLM 评判：缺少 OPENAI_API_KEY 或 OPENAI_BASE_URL'],
      reasoning: '环境变量未配置',
      error: 'missing-env',
    };
  }

  // Tool calls summary
  const toolCallsSummary = result.toolCalls.length > 0
    ? result.toolCalls.map(tc => {
        const inputStr = JSON.stringify(tc.input).slice(0, 200);
        const outputStr = typeof tc.output === 'string'
          ? tc.output.slice(0, 200)
          : JSON.stringify(tc.output || '').slice(0, 200);
        return `- ${tc.toolName}(${inputStr}) → ${outputStr}`;
      }).join('\n')
    : '(无工具调用)';

  // File operations summary (replaces file blocks)
  const fileOpsSummary = result.fileOperations.length > 0
    ? result.fileOperations.map(fo => {
        const content = fo.content && fo.content.length > 500
          ? fo.content.slice(0, 500) + '...'
          : (fo.content ?? '(无内容)');
        return `### ${fo.tool}: ${fo.filePath}\n\`\`\`\n${content}\n\`\`\``;
      }).join('\n\n')
    : '(无文件操作)';

  const truncatedText = result.responseText.length > 3000
    ? result.responseText.slice(0, 3000) + '\n... (截断)'
    : result.responseText;

  const systemPrompt = `你是一个代码评审专家，负责评估 Developer Agent 的任务完成质量。

你必须以纯 JSON 格式返回评估结果（不要包含 markdown 代码块标记），包含以下字段：
- score: 整数 1-5（1=完全错误, 2=重大问题, 3=部分正确, 4=小瑕疵, 5=完全正确）
- compliance: 布尔值（核心预期行为是否达成）
- issues: 字符串数组（具体问题，无问题则为空数组）
- reasoning: 字符串（评分理由，控制在 200 字以内）

评分标准：
5: 完全满足预期行为 — 正确的工具调用、正确的方案、正确的输出格式
4: 基本正确但有轻微偏差（如工具参数略有不同、多余步骤）
3: 部分正确 — 方向对但有显著偏差（如调用了错误的工具变体、遗漏步骤）
2: 重大问题 — 错误方案或缺失关键行为（如应拒绝但未拒绝、应用工具但未调用）
1: 完全失败 — 错误、错误的 Agent、或根本性不正确的响应

重要：直接输出 JSON 对象，不要用 \`\`\`json 包裹，不要添加任何额外文本。`;

  const userPrompt = `## 测试用例: ${testCase.id} — ${testCase.title}
**分类:** ${testCase.category} | **复杂度:** ${testCase.complexity}

**用户输入:** ${testCase.prompt}

**预期行为:** ${testCase.expectation}

**覆盖点:** ${testCase.coveragePoint}

---

## Agent 实际输出

**回复文本:**
${truncatedText}

**工具调用:**
${toolCallsSummary}

**文件操作:**
${fileOpsSummary}

**效率指标:** 耗时 ${result.responseTimeMs}ms | 估算 token ${result.estimatedTokens} | 工具调用 ${result.toolCallCount} 次 | 代码 ${result.codeLineCount} 行

---

请评估 Agent 的输出是否符合预期行为。`;

  const MAX_JUDGE_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_JUDGE_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);

      const body: Record<string, any> = {
        model: judgeModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 8092,
      };

      if (attempt === 0) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          testCaseId: testCase.id,
          score: 0,
          compliance: false,
          issues: [`LLM 评判 API 错误: HTTP ${res.status}`],
          reasoning: `API 调用失败: ${errText.slice(0, 300)}`,
          error: 'api-error',
        };
      }

      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content || '';

      let parsed: any;
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      try {
        parsed = JSON.parse(cleanContent);
      } catch {
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); } catch {
            parsed = tryRepairTruncatedJSON(jsonMatch[0]);
          }
        }
      }

      if (!parsed) {
        if (attempt < MAX_JUDGE_RETRIES) {
          console.log(`     ⚠️ ${testCase.id} 评判 JSON 解析失败，第 ${attempt + 1} 次重试...`);
          await sleep(1000);
          continue;
        }
        return {
          testCaseId: testCase.id,
          score: 0,
          compliance: false,
          issues: ['LLM 评判返回非 JSON 格式'],
          reasoning: content.slice(0, 500),
          error: 'parse-error',
        };
      }

      return {
        testCaseId: testCase.id,
        score: Math.max(1, Math.min(5, Math.round(parsed.score || 0))),
        compliance: typeof parsed.compliance === 'boolean' ? parsed.compliance : (parsed.score >= 4),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        reasoning: parsed.reasoning || '',
      };
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError';
      if (isTimeout && attempt < MAX_JUDGE_RETRIES) {
        console.log(`     ⚠️ ${testCase.id} 评判超时，第 ${attempt + 1} 次重试...`);
        continue;
      }
      return {
        testCaseId: testCase.id,
        score: 0,
        compliance: false,
        issues: [isTimeout ? 'LLM 评判超时' : `LLM 评判异常: ${String(err?.message || err).slice(0, 200)}`],
        reasoning: isTimeout ? '评判请求超时 (60s)' : String(err?.message || err).slice(0, 300),
        error: 'judge-error',
      };
    }
  }

  return {
    testCaseId: testCase.id,
    score: 0,
    compliance: false,
    issues: ['LLM 评判重试耗尽'],
    reasoning: '多次重试后仍无法获得有效评判',
    error: 'judge-exhausted',
  };
}

// ── 清理 ─────────────────────────────────────────────────────────────────

async function runCleanup(): Promise<void> {
  console.log('  🧹 执行 clean:dynamic 清理...');
  try {
    execSync('npx tsx scripts/clean-dynamic.ts', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 30_000,
    });
    console.log('  ✅ 清理完成');
  } catch (err) {
    console.error('  ⚠️ 清理失败:', (err as Error).message);
  }
}

// ── 服务器检查 ───────────────────────────────────────────────────────────

async function isServerUp(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = {};
    if (authCookie) headers['Cookie'] = authCookie;
    const res = await fetch(BASE_URL, { signal: controller.signal, headers });
    clearTimeout(timer);
    return res.ok || res.status === 307 || res.status === 302;
  } catch {
    return false;
  }
}

async function waitForServerRecovery(maxWaitMs = 30_000, intervalMs = 3_000): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < maxWaitMs) {
    attempt++;
    if (await isServerUp()) {
      if (attempt > 1) {
        console.log(`     ✅ 服务器已恢复 (等待 ${((Date.now() - start) / 1000).toFixed(1)}s)`);
      }
      return true;
    }
    console.log(`     ⏳ 服务器不可用，等待恢复... (${attempt}次, ${((Date.now() - start) / 1000).toFixed(0)}s)`);
    await sleep(intervalMs);
  }
  return false;
}

// ── 报告生成 ─────────────────────────────────────────────────────────────

function generateReport(
  allResults: Array<{ testCase: TestCase; result: TestResult; judge: JudgeResult }>,
  env: Record<string, string>,
): string {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  const model = env.DEVELOPER_MODEL || process.env.DEVELOPER_MODEL || 'deepseek-v4-pro';
  const judgeModel = env.JUDGE_MODEL || process.env.JUDGE_MODEL || 'deepseek-v4-flash';

  const completed = allResults.filter(r => !r.result.error);
  const failed = allResults.filter(r => !!r.result.error);

  const avgTime = completed.length > 0
    ? Math.round(completed.reduce((s, r) => s + r.result.responseTimeMs, 0) / completed.length)
    : 0;
  const avgTokens = completed.length > 0
    ? Math.round(completed.reduce((s, r) => s + r.result.estimatedTokens, 0) / completed.length)
    : 0;
  const avgToolCalls = completed.length > 0
    ? (completed.reduce((s, r) => s + r.result.toolCallCount, 0) / completed.length).toFixed(1)
    : '0';
  const avgCodeLines = completed.length > 0
    ? Math.round(completed.reduce((s, r) => s + r.result.codeLineCount, 0) / completed.length)
    : 0;

  const judged = allResults.filter(r => r.judge.score > 0);
  const avgScore = judged.length > 0
    ? (judged.reduce((s, r) => s + r.judge.score, 0) / judged.length).toFixed(1)
    : 'N/A';
  const complianceCount = judged.filter(r => r.judge.compliance).length;
  const scoreDist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 };
  for (const r of allResults) {
    scoreDist[r.judge.score] = (scoreDist[r.judge.score] || 0) + 1;
  }

  const complexityIcon = (c: string) => c === 'simple' ? '🟢' : c === 'medium' ? '🟡' : '🔴';

  let md = `# Developer Agent 测试报告 (pi SDK)

> 运行时间: ${timestamp}
> 模型: ${model}
> 评判模型: ${judgeModel}
> 服务器: ${BASE_URL}
> 后端: pi SDK
> 总测试: ${allResults.length} | 完成: ${completed.length} | 失败: ${failed.length}

---

## 效率总览

| TC | 复杂度 | 耗时(s) | 输出token | 代码行数 | 工具调用数 | 文件操作数 |
|----|--------|---------|-----------|----------|-----------|---------|
`;

  for (const { testCase: tc, result: r } of allResults) {
    const time = r.error ? '❌' : (r.responseTimeMs / 1000).toFixed(1);
    const tokens = r.error ? '-' : String(r.estimatedTokens);
    const codeLines = r.error ? '-' : String(r.codeLineCount);
    const toolCalls = r.error ? '-' : String(r.toolCallCount);
    const fileOps = r.error ? '-' : String(r.fileOperations.length);
    md += `| ${tc.id} | ${complexityIcon(tc.complexity)} ${tc.complexity} | ${time} | ${tokens} | ${codeLines} | ${toolCalls} | ${fileOps} |\n`;
  }

  md += `
**平均值:** ${avgTime / 1000}s | ${avgTokens} tokens | ${avgCodeLines} 行代码 | ${avgToolCalls} 次工具调用

---

## 质量评估

| TC | 得分 | 符合需求 | 主要问题 |
|----|------|---------|---------|
`;

  for (const { testCase: tc, judge: j } of allResults) {
    const score = j.score > 0 ? `${j.score}/5` : 'N/A';
    const compliance = j.score > 0 ? (j.compliance ? '✅' : '❌') : '-';
    const mainIssue = j.issues.length > 0 ? j.issues[0].slice(0, 60) : '-';
    md += `| ${tc.id} | ${score} | ${compliance} | ${mainIssue} |\n`;
  }

  md += `
**平均得分:** ${avgScore}/5.0
**符合需求率:** ${judged.length > 0 ? Math.round(complianceCount / judged.length * 100) : 0}% (${complianceCount}/${judged.length})
**得分分布:** 5分=${scoreDist[5]} | 4分=${scoreDist[4]} | 3分=${scoreDist[3]} | 2分=${scoreDist[2]} | 1分=${scoreDist[1]} | 未评=${scoreDist[0]}

---

## 详细结果

`;

  for (const { testCase: tc, result: r, judge: j } of allResults) {
    const truncatedResponse = r.responseText.length > 800
      ? r.responseText.slice(0, 800) + '\n... (截断)'
      : r.responseText;

    md += `### ${tc.id}: ${tc.title}

- **分类:** ${tc.category} | **复杂度:** ${complexityIcon(tc.complexity)} ${tc.complexity}
- **输入:** \`${tc.prompt}\`
- **预期:** ${tc.expectation.slice(0, 200)}${tc.expectation.length > 200 ? '...' : ''}
- **耗时:** ${r.responseTimeMs}ms | **Token:** ${r.estimatedTokens} | **工具调用:** ${r.toolCallCount} | **代码:** ${r.codeLineCount} 行
${r.error ? `- **❌ 错误:** ${r.error}\n` : ''}

**Agent 回复:**
\`\`\`
${truncatedResponse}
\`\`\`

`;

    if (r.toolCalls.length > 0) {
      md += `**工具调用:**\n`;
      for (const tc2 of r.toolCalls) {
        const inputStr = JSON.stringify(tc2.input).slice(0, 150);
        md += `- \`${tc2.toolName}\`(${inputStr})${tc2.isError ? ' ❌' : ''}\n`;
      }
      md += '\n';
    }

    if (r.fileOperations.length > 0) {
      md += `**文件操作:**\n`;
      for (const fo of r.fileOperations) {
        const content = fo.content ?? '';
        md += `- ${fo.tool}: \`${fo.filePath}\` — ${content.split('\n').length} 行\n`;
      }
      md += '\n';
    }

    md += `**LLM 评判:** ${j.score > 0 ? `**${j.score}/5** ${j.compliance ? '✅' : '❌'}` : 'N/A'}\n`;
    md += `> ${j.reasoning}\n\n`;
    if (j.issues.length > 0) {
      md += `**问题:**\n`;
      for (const issue of j.issues) {
        md += `- ${issue}\n`;
      }
      md += '\n';
    }

    md += '---\n\n';
  }

  // 总结
  md += `## 总结

- **整体效率:** 平均响应 ${avgTime / 1000}s，平均 ${avgTokens} tokens，平均 ${avgToolCalls} 次工具调用
- **整体质量:** 平均得分 ${avgScore}/5.0，${judged.length > 0 ? Math.round(complianceCount / judged.length * 100) : 0}% 符合需求
- **后端:** pi SDK (替换 AI SDK)
`;

  const highScore = allResults.filter(r => r.judge.score >= 4);
  const lowScore = allResults.filter(r => r.judge.score > 0 && r.judge.score <= 2);

  if (highScore.length > 0) {
    md += `\n**优势领域:** ${highScore.map(r => r.testCase.category).filter((v, i, a) => a.indexOf(v) === i).join('、')}\n`;
  }
  if (lowScore.length > 0) {
    md += `\n**薄弱领域:** ${lowScore.map(r => `${r.testCase.id}(${r.testCase.category})`).join('、')}\n`;
  }

  const allIssues = allResults.flatMap(r => r.judge.issues);
  if (allIssues.length > 0) {
    md += `\n**常见问题:**\n`;
    const issueCounts = new Map<string, number>();
    for (const issue of allIssues) {
      const key = issue.slice(0, 50);
      issueCounts.set(key, (issueCounts.get(key) || 0) + 1);
    }
    const sorted = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [issue, count] of sorted) {
      md += `- [${count}次] ${issue}\n`;
    }
  }

  return md;
}

// ── 主流程 ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const groupFilter = args.find(a => a.startsWith('--group='))?.split('=')[1]
    || args[args.indexOf('--group') + 1];
  const noJudge = args.includes('--no-judge');
  const noClean = args.includes('--no-clean');

  console.log('═══════════════════════════════════════════════════');
  console.log('  Developer Agent 自动化测试 (pi SDK)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  服务器: ${BASE_URL}`);
  console.log(`  测试用例: ${TEST_CASES.length} 个`);
  console.log(`  LLM 评判: ${noJudge ? '禁用' : '启用'}`);
  console.log(`  组间清理: ${noClean ? '禁用' : '启用'}`);
  if (groupFilter) console.log(`  指定组: ${groupFilter}`);
  console.log('═══════════════════════════════════════════════════\n');

  // 检查服务器
  console.log('🔍 检查开发服务器...');
  const serverUp = await isServerUp();
  if (!serverUp) {
    console.error('❌ 开发服务器未运行！请先执行: npm run dev -- --turbopack --port 3088');
    process.exit(1);
  }
  console.log('✅ 服务器运行中\n');

  // 加载环境变量
  const envPath = path.join(process.cwd(), '.env.local');
  const env = loadEnvFile(envPath);
  console.log(`📋 环境变量: ${Object.keys(env).length} 项已加载`);

  // 初始化认证
  await initAuth(env);

  // 确定要运行的组
  const groups = groupFilter
    ? TEST_GROUPS.filter(g => g.name === groupFilter)
    : TEST_GROUPS;

  if (groups.length === 0) {
    console.error(`❌ 未找到测试组: ${groupFilter}`);
    process.exit(1);
  }

  const allResults: Array<{ testCase: TestCase; result: TestResult; judge: JudgeResult }> = [];

  for (const group of groups) {
    const cases = getTestCasesByGroup(group.name);
    console.log(`\n📦 Group ${group.name}: ${group.label} (${cases.length} 个用例)`);
    console.log('─'.repeat(50));

    if (group.needsCleanup && !noClean) {
      await runCleanup();
      console.log('  ⏳ 等待 Turbopack HMR 处理清理变更...');
      await waitForServerRecovery(15_000, 2_000);
    }

    for (const tc of cases) {
      // Check dependencies
      if (tc.dependsOn) {
        const unmet = tc.dependsOn.filter(dep => !allResults.some(r => r.testCase.id === dep && !r.result.error));
        if (unmet.length > 0) {
          console.log(`  ⏭️  ${tc.id}: 跳过（依赖 ${unmet.join(', ')} 未完成）`);
          allResults.push({
            testCase: tc,
            result: {
              testCaseId: tc.id,
              prompt: tc.prompt,
              responseText: '',
              reasoningText: '',
              toolCalls: [],
              fileOperations: [],
              responseTimeMs: 0,
              estimatedTokens: 0,
              codeGenerated: '',
              codeLineCount: 0,
              toolCallCount: 0,
              error: `依赖未满足: ${unmet.join(', ')}`,
            },
            judge: {
              testCaseId: tc.id,
              score: 0,
              compliance: false,
              issues: [`依赖未满足: ${unmet.join(', ')}`],
              reasoning: '前置测试未完成，跳过',
              error: 'dependency-unmet',
            },
          });
          continue;
        }
      }

      console.log(`  🔄 ${tc.id}: ${tc.title}`);
      console.log(`     输入: "${tc.prompt.slice(0, 60)}${tc.prompt.length > 60 ? '...' : ''}"`);

      console.log(`     输入: "${tc.prompt.slice(0, 60)}${tc.prompt.length > 60 ? '...' : ''}"`);
      const MAX_RETRIES = 3;
      let result: TestResult | undefined;
      let retryCount = 0;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0 || !(await isServerUp())) {
          if (attempt > 0) {
            console.log(`     🔄 第 ${attempt + 1} 次重试...`);
          }
          const recovered = await waitForServerRecovery(60_000, 3_000);
          if (!recovered) {
            result = {
              testCaseId: tc.id,
              prompt: tc.prompt,
              responseText: '',
              reasoningText: '',
              toolCalls: [],
              fileOperations: [],
              responseTimeMs: 0,
              estimatedTokens: 0,
              codeGenerated: '',
              codeLineCount: 0,
              toolCallCount: 0,
              error: '服务器不可用',
            };
            break;
          }
        }

        result = await sendDeveloperMessage(tc.prompt, tc.timeoutMs);
        result.testCaseId = tc.id;

        if (result.error?.startsWith('HTTP 500') && attempt < MAX_RETRIES) {
          retryCount++;
          console.log(`     ⚠️ HTTP 500，等待恢复后重试...`);
          continue;
        }

        break;
      }

      if (!result) {
        result = {
          testCaseId: tc.id,
          prompt: tc.prompt,
          responseText: '',
          reasoningText: '',
          toolCalls: [],
          fileOperations: [],
          responseTimeMs: 0,
          estimatedTokens: 0,
          codeGenerated: '',
          codeLineCount: 0,
          toolCallCount: 0,
          error: '未获取到结果',
        };
      }

      if (result.error) {
        console.log(`     ❌ 失败: ${result.error}`);
      } else {
        console.log(`     ✅ 完成: ${result.responseTimeMs}ms | ${result.estimatedTokens} tokens | ${result.toolCallCount} 工具调用 | ${result.codeLineCount} 行代码`);
        if (result.toolCalls.length > 0) {
          console.log(`     🔧 工具: ${result.toolCalls.map(tc2 => tc2.toolName).join(', ')}`);
        }
        if (result.fileOperations.length > 0) {
          console.log(`     📁 文件: ${result.fileOperations.map(fo => `${fo.tool}:${fo.filePath}`).join(', ')}`);
        }
        if (retryCount > 0) {
          console.log(`     🔄 重试 ${retryCount} 次后成功`);
        }
      }

      allResults.push({
        testCase: tc,
        result,
        judge: { testCaseId: tc.id, score: 0, compliance: false, issues: [], reasoning: '' },
      });

      // Wait for HMR if component files were generated
      if (!result.error && result.fileOperations.some(fo => fo.filePath.includes('component'))) {
        console.log('     ⏳ 等待 Turbopack HMR 编译组件代码...');
        await waitForServerRecovery(30_000, 2_000);
      }

      await sleep(1000);
    }
  }

  // LLM 评判阶段
  console.log('\n\n📊 LLM 评判阶段');
  console.log('─'.repeat(50));

  const judgeResults: JudgeResult[] = [];

  if (!noJudge) {
    for (const { testCase, result } of allResults) {
      if (result.error) {
        console.log(`  ⏭️  ${testCase.id}: 跳过评判（测试失败）`);
        judgeResults.push({
          testCaseId: testCase.id,
          score: 0,
          compliance: false,
          issues: ['测试执行失败，无法评判'],
          reasoning: `执行错误: ${result.error}`,
          error: 'test-failed',
        });
      } else {
        console.log(`  🧑‍⚖️ ${testCase.id}: 评判中...`);
        const judge = await judgeResult(testCase, result, env);
        judgeResults.push(judge);
        console.log(`     得分: ${judge.score}/5 ${judge.compliance ? '✅' : '❌'} — ${judge.reasoning.slice(0, 80)}`);
        await sleep(500);
      }
    }
  } else {
    for (const { testCase } of allResults) {
      judgeResults.push({
        testCaseId: testCase.id,
        score: 0,
        compliance: false,
        issues: ['LLM 评判已禁用'],
        reasoning: '--no-judge 模式',
        error: 'disabled',
      });
    }
  }

  const finalResults = allResults.map((item, i) => ({
    ...item,
    judge: judgeResults[i],
  }));

  // 生成报告
  console.log('\n📝 生成报告...');
  const report = generateReport(finalResults, env);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORTS_DIR, `dev-agent-test-${reportTimestamp}.md`);
  fs.writeFileSync(reportPath, report, 'utf-8');

  const latestPath = path.join(REPORTS_DIR, 'dev-agent-test-latest.md');
  fs.writeFileSync(latestPath, report, 'utf-8');

  console.log(`\n✅ 报告已保存:`);
  console.log(`   ${reportPath}`);
  console.log(`   ${latestPath}`);

  // 打印摘要
  const completed = finalResults.filter(r => !r.result.error);
  const avgScore = finalResults.filter(r => r.judge.score > 0).length > 0
    ? (finalResults.filter(r => r.judge.score > 0).reduce((s, r) => s + r.judge.score, 0) / finalResults.filter(r => r.judge.score > 0).length).toFixed(1)
    : 'N/A';
  const complianceRate = finalResults.filter(r => r.judge.score > 0).length > 0
    ? Math.round(finalResults.filter(r => r.judge.compliance).length / finalResults.filter(r => r.judge.score > 0).length * 100)
    : 0;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  测试摘要 (pi SDK)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  完成: ${completed.length}/${finalResults.length}`);
  console.log(`  失败: ${finalResults.length - completed.length}`);
  console.log(`  平均得分: ${avgScore}/5.0`);
  console.log(`  符合需求率: ${complianceRate}%`);
  console.log('═══════════════════════════════════════════════════');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('❌ 测试脚本异常:', err);
  process.exit(1);
});
