/**
 * Developer Agent 自动化测试脚本
 *
 * 遍历 20 个测试用例，向 Developer Agent 发送 prompt，
 * 收集效率指标，用 LLM 判断需求符合度，生成汇总报告。
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

/** 生成认证 token: sha256(password + salt) */
async function generateAuthToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(password + AUTH_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 初始化认证 cookie */
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

// ── 内联工具函数（避免 @/ 路径别名问题）──────────────────────────────────

/** CJK 字符范围检测 */
const CJK_RANGES = [
  [0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x20000, 0x2a6df],
  [0x3000, 0x303f], [0x3040, 0x309f], [0x30a0, 0x30ff],
  [0xac00, 0xd7af], [0xf900, 0xfaff],
];

function isCJK(cp: number): boolean {
  return CJK_RANGES.some(([s, e]) => cp >= s && cp <= e);
}

/** 估算文本 token 数（中英文混合） */
function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0, nonCjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isCJK(cp)) cjk++; else nonCjk++;
  }
  return Math.ceil(cjk * 1.5 + nonCjk / 4);
}

// ── 标记块解析（内联，避免路径别名）──────────────────────────────────────

interface FileBlockRecord {
  filePath: string;
  mode: 'write' | 'insert' | 'replace';
  content: string;
  startLine?: number;
  endLine?: number;
}

const FILE_WRITE_RE = /<<<file-write:(.+?)>>>\n?([\s\S]*?)\n?<<<end>>>/g;
const FILE_EDIT_INSERT_RE = /<<<file-edit:(.+?):insert:(\d+)>>>\n?([\s\S]*?)\n?<<<end>>>/g;
const FILE_EDIT_REPLACE_RE = /<<<file-edit:(.+?):replace:(\d+)-(\d+)>>>\n?([\s\S]*?)\n?<<<end>>>/g;

function parseFileBlocks(text: string): FileBlockRecord[] {
  const blocks: FileBlockRecord[] = [];
  const norm = (p: string) => p.replace(/\\/g, '/');
  let m: RegExpExecArray | null;

  FILE_WRITE_RE.lastIndex = 0;
  while ((m = FILE_WRITE_RE.exec(text)) !== null) {
    blocks.push({ filePath: norm(m[1].trim()), mode: 'write', content: m[2] });
  }
  FILE_EDIT_INSERT_RE.lastIndex = 0;
  while ((m = FILE_EDIT_INSERT_RE.exec(text)) !== null) {
    blocks.push({ filePath: norm(m[1].trim()), mode: 'insert', content: m[3], startLine: parseInt(m[2], 10) });
  }
  FILE_EDIT_REPLACE_RE.lastIndex = 0;
  while ((m = FILE_EDIT_REPLACE_RE.exec(text)) !== null) {
    blocks.push({ filePath: norm(m[1].trim()), mode: 'replace', content: m[4], startLine: parseInt(m[2], 10), endLine: parseInt(m[3], 10) });
  }
  return blocks;
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
  input: any;
  output: any;
}

interface TestResult {
  testCaseId: string;
  prompt: string;
  responseText: string;
  toolCalls: ToolCallRecord[];
  fileBlocks: FileBlockRecord[];
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

// ── SSE 流解析 ───────────────────────────────────────────────────────────

/** 发送消息给 Developer Agent 并收集完整响应 */
async function sendDeveloperMessage(
  prompt: string,
  timeoutMs: number,
  conversationHistory: Array<{ role: string; parts: Array<{ type: string; text?: string; toolName?: string; toolCallId?: string; state?: string; input?: any; output?: any }> }> = [],
): Promise<TestResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 构造 UIMessage 格式
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      parts: [{ type: 'text', text: prompt }],
    };

    const messages = [...conversationHistory, userMessage];

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authCookie) headers['Cookie'] = authCookie;

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, mode: 'develop' }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        testCaseId: '',
        prompt,
        responseText: '',
        toolCalls: [],
        fileBlocks: [],
        responseTimeMs: Date.now() - startTime,
        estimatedTokens: 0,
        codeGenerated: '',
        codeLineCount: 0,
        toolCallCount: 0,
        error: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
      };
    }

    // 读取完整 SSE 响应
    const rawText = await res.text();
    const events = parseSSEEvents(rawText);

    // 提取文本
    const responseText = extractTextFromEvents(events);

    // 提取工具调用
    const toolCalls = extractToolCallsFromEvents(events);

    // 提取标记块
    const fileBlocks = parseFileBlocks(responseText);

    // 代码统计
    const codeGenerated = fileBlocks.map(b => b.content).join('\n');
    const codeLineCount = codeGenerated ? codeGenerated.split('\n').length : 0;

    return {
      testCaseId: '',
      prompt,
      responseText,
      toolCalls,
      fileBlocks,
      responseTimeMs: Date.now() - startTime,
      estimatedTokens: estimateTokens(responseText),
      codeGenerated,
      codeLineCount,
      toolCallCount: toolCalls.length,
    };
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return {
      testCaseId: '',
      prompt,
      responseText: '',
      toolCalls: [],
      fileBlocks: [],
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

/** 解析 SSE 原始文本为事件数组 */
function parseSSEEvents(rawText: string): any[] {
  return rawText
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** 从事件中提取文本 */
function extractTextFromEvents(events: any[]): string {
  return events
    .filter(e => e.type === 'text-delta' && (e.delta || e.textDelta))
    .map(e => e.delta || e.textDelta || '')
    .join('');
}

/** 从事件中提取工具调用 */
function extractToolCallsFromEvents(events: any[]): ToolCallRecord[] {
  const calls: Map<string, ToolCallRecord> = new Map();

  for (const e of events) {
    if (e.type === 'tool-input-available' && e.toolCallId) {
      const existing = calls.get(e.toolCallId) || { toolName: e.toolName || '', input: null, output: null };
      existing.toolName = e.toolName || existing.toolName;
      existing.input = e.input;
      calls.set(e.toolCallId, existing);
    }
    if (e.type === 'tool-output-available' && e.toolCallId) {
      const existing = calls.get(e.toolCallId) || { toolName: '', input: null, output: null };
      existing.output = e.output;
      calls.set(e.toolCallId, existing);
    }
  }

  return Array.from(calls.values());
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

  // 构造工具调用摘要
  const toolCallsSummary = result.toolCalls.length > 0
    ? result.toolCalls.map(tc => {
        const inputStr = JSON.stringify(tc.input).slice(0, 200);
        const outputStr = typeof tc.output === 'string'
          ? tc.output.slice(0, 200)
          : JSON.stringify(tc.output || '').slice(0, 200);
        return `- ${tc.toolName}(${inputStr}) → ${outputStr}`;
      }).join('\n')
    : '(无工具调用)';

  // 构造代码摘要
  const codeSummary = result.fileBlocks.length > 0
    ? result.fileBlocks.map(b => {
        const content = b.content.length > 500 ? b.content.slice(0, 500) + '...' : b.content;
        return `### ${b.mode}: ${b.filePath}${b.startLine ? ` (line ${b.startLine}${b.endLine ? `-${b.endLine}` : ''})` : ''}\n\`\`\`\n${content}\n\`\`\``;
      }).join('\n\n')
    : '(无代码生成)';

  // 截断过长的响应文本
  const truncatedText = result.responseText.length > 3000
    ? result.responseText.slice(0, 3000) + '\n... (截断)'
    : result.responseText;

  const systemPrompt = `你是一个代码评审专家，负责评估 Developer Agent 的任务完成质量。

你必须以 JSON 格式返回评估结果，包含以下字段：
- score: 整数 1-5（1=完全错误, 2=重大问题, 3=部分正确, 4=小瑕疵, 5=完全正确）
- compliance: 布尔值（核心预期行为是否达成）
- issues: 字符串数组（具体问题，无问题则为空数组）
- reasoning: 字符串（评分理由）

评分标准：
5: 完全满足预期行为 — 正确的工具调用、正确的方案、正确的输出格式
4: 基本正确但有轻微偏差（如工具参数略有不同、多余步骤）
3: 部分正确 — 方向对但有显著偏差（如调用了错误的工具变体、遗漏步骤）
2: 重大问题 — 错误方案或缺失关键行为（如应拒绝但未拒绝、应用标记块但尝试调用工具）
1: 完全失败 — 错误、错误的 Agent、或根本性不正确的响应`;

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

**生成的代码:**
${codeSummary}

**效率指标:** 耗时 ${result.responseTimeMs}ms | 估算 token ${result.estimatedTokens} | 工具调用 ${result.toolCallCount} 次 | 代码 ${result.codeLineCount} 行

---

请评估 Agent 的输出是否符合预期行为。`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: judgeModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 8092,
        response_format: { type: 'json_object' },
      }),
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

    // 解析 JSON 响应
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // 尝试从文本中提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }
    }

    if (!parsed) {
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
      compliance: !!parsed.compliance,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      reasoning: parsed.reasoning || '',
    };
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return {
      testCaseId: testCase.id,
      score: 0,
      compliance: false,
      issues: [isTimeout ? 'LLM 评判超时' : `LLM 评判异常: ${String(err?.message || err).slice(0, 200)}`],
      reasoning: isTimeout ? '评判请求超时 (30s)' : String(err?.message || err).slice(0, 300),
      error: 'judge-error',
    };
  }
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
    const headers: Record<string, string> = {};
    if (authCookie) headers['Cookie'] = authCookie;
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000), headers });
    return res.ok || res.status === 307; // 307 redirect is also OK (Next.js auth)
  } catch {
    return false;
  }
}

/**
 * 等待服务器恢复可用。
 * 当 Agent 生成的组件代码触发 Turbopack HMR 编译时，如果组件有语法错误，
 * Next.js dev server 可能短暂不可用（返回 HTML 500 或连接失败）。
 * 本函数轮询等待服务器恢复，避免后续测试用例因基础设施问题而失败。
 *
 * @param maxWaitMs 最大等待时间（默认 30s）
 * @param intervalMs 轮询间隔（默认 3s）
 * @returns 是否在超时前恢复
 */
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

  // 效率统计
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

  // 质量统计
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

  let md = `# Developer Agent 测试报告

> 运行时间: ${timestamp}
> 模型: ${model}
> 评判模型: ${judgeModel}
> 服务器: ${BASE_URL}
> 总测试: ${allResults.length} | 完成: ${completed.length} | 失败: ${failed.length}

---

## 效率总览

| TC | 复杂度 | 耗时(s) | 输出token | 代码行数 | 工具调用数 | 标记块数 |
|----|--------|---------|-----------|----------|-----------|---------|
`;

  for (const { testCase: tc, result: r } of allResults) {
    const time = r.error ? '❌' : (r.responseTimeMs / 1000).toFixed(1);
    const tokens = r.error ? '-' : String(r.estimatedTokens);
    const codeLines = r.error ? '-' : String(r.codeLineCount);
    const toolCalls = r.error ? '-' : String(r.toolCallCount);
    const blocks = r.error ? '-' : String(r.fileBlocks.length);
    md += `| ${tc.id} | ${complexityIcon(tc.complexity)} ${tc.complexity} | ${time} | ${tokens} | ${codeLines} | ${toolCalls} | ${blocks} |\n`;
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
        md += `- \`${tc2.toolName}\`(${inputStr})\n`;
      }
      md += '\n';
    }

    if (r.fileBlocks.length > 0) {
      md += `**标记块:**\n`;
      for (const b of r.fileBlocks) {
        const content = b.content || '';
        md += `- ${b.mode}: \`${b.filePath}\`${b.startLine ? ` (line ${b.startLine}${b.endLine ? `-${b.endLine}` : ''})` : ''} — ${content.split('\n').length} 行\n`;
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
`;

  // 优势与不足
  const highScore = allResults.filter(r => r.judge.score >= 4);
  const lowScore = allResults.filter(r => r.judge.score > 0 && r.judge.score <= 2);

  if (highScore.length > 0) {
    md += `\n**优势领域:** ${highScore.map(r => r.testCase.category).filter((v, i, a) => a.indexOf(v) === i).join('、')}\n`;
  }
  if (lowScore.length > 0) {
    md += `\n**薄弱领域:** ${lowScore.map(r => `${r.testCase.id}(${r.testCase.category})`).join('、')}\n`;
  }

  // 常见问题
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
  // 解析命令行参数
  const args = process.argv.slice(2);
  const groupFilter = args.find(a => a.startsWith('--group='))?.split('=')[1]
    || args[args.indexOf('--group') + 1];
  const noJudge = args.includes('--no-judge');
  const noClean = args.includes('--no-clean');

  console.log('═══════════════════════════════════════════════════');
  console.log('  Developer Agent 自动化测试');
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
  const resultMap = new Map<string, TestResult>();

  // 遍历测试组
  for (const group of groups) {
    const cases = getTestCasesByGroup(group.name);
    console.log(`\n📦 Group ${group.name}: ${group.label} (${cases.length} 个用例)`);
    console.log('─'.repeat(50));

    // 组间清理
    if (group.needsCleanup && !noClean) {
      await runCleanup();
      // 等待清理生效 + Turbopack HMR 编译完成
      // 清理会删除 generated/ 组件文件并重写 registry，触发 HMR
      console.log('  ⏳ 等待 Turbopack HMR 处理清理变更...');
      await waitForServerRecovery(15_000, 2_000);
    }

    // 顺序执行组内用例
    for (const tc of cases) {
      // 检查依赖
      if (tc.dependsOn) {
        const unmet = tc.dependsOn.filter(dep => !resultMap.has(dep));
        if (unmet.length > 0) {
          console.log(`  ⏭️  ${tc.id}: 跳过（依赖 ${unmet.join(', ')} 未完成）`);
          allResults.push({
            testCase: tc,
            result: {
              testCaseId: tc.id,
              prompt: tc.prompt,
              responseText: '',
              toolCalls: [],
              fileBlocks: [],
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

      // 构造对话历史（如果有依赖，将前置对话包含进来）
      const history = buildConversationHistory(tc, resultMap);

      // 执行测试，支持 HTTP 500 自动重试
      // 原因：Agent 生成的组件代码可能触发 Turbopack HMR 编译错误，
      // 导致 Next.js dev server 短暂不可用，等待恢复后重试即可
      const MAX_RETRIES = 2;
      let result: TestResult;
      let retryCount = 0;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        // 每次尝试前检查服务器健康
        if (attempt > 0 || !(await isServerUp())) {
          if (attempt > 0) {
            console.log(`     🔄 第 ${attempt + 1} 次重试...`);
          }
          const recovered = await waitForServerRecovery(30_000, 3_000);
          if (!recovered) {
            console.log(`     ❌ 服务器在 30s 内未恢复，跳过此用例`);
            result = {
              testCaseId: tc.id,
              prompt: tc.prompt,
              responseText: '',
              toolCalls: [],
              fileBlocks: [],
              responseTimeMs: 0,
              estimatedTokens: 0,
              codeGenerated: '',
              codeLineCount: 0,
              toolCallCount: 0,
              error: '服务器不可用（Turbopack HMR 编译错误可能导致 Next.js 崩溃）',
            };
            break;
          }
        }

        result = await sendDeveloperMessage(tc.prompt, tc.timeoutMs, history);
        result.testCaseId = tc.id;

        // 如果是 HTTP 500 且还有重试次数，等待服务器恢复后重试
        if (result.error?.startsWith('HTTP 500') && attempt < MAX_RETRIES) {
          retryCount++;
          console.log(`     ⚠️ HTTP 500（可能是 Turbopack 编译错误），等待恢复后重试...`);
          continue;
        }

        // 其他情况（成功或非 500 错误），不再重试
        break;
      }

      if (result.error) {
        console.log(`     ❌ 失败: ${result.error}`);
      } else {
        console.log(`     ✅ 完成: ${result.responseTimeMs}ms | ${result.estimatedTokens} tokens | ${result.toolCallCount} 工具调用 | ${result.codeLineCount} 行代码`);
        if (result.toolCalls.length > 0) {
          console.log(`     🔧 工具: ${result.toolCalls.map(tc2 => tc2.toolName).join(', ')}`);
        }
        if (result.fileBlocks.length > 0) {
          console.log(`     📝 标记块: ${result.fileBlocks.map(b => `${b.mode}:${b.filePath}`).join(', ')}`);
        }
        if (retryCount > 0) {
          console.log(`     🔄 重试 ${retryCount} 次后成功`);
        }
      }

      resultMap.set(tc.id, result);

      // 记录结果
      allResults.push({
        testCase: tc,
        result,
        judge: { testCaseId: tc.id, score: 0, compliance: false, issues: [], reasoning: '' }, // 占位，后面评判时替换
      });

      // 请求间短暂间隔，避免过快
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
      } else {
        console.log(`  🧑‍⚖️ ${testCase.id}: 评判中...`);
      }

      const judge = result.error
        ? {
            testCaseId: testCase.id,
            score: 0,
            compliance: false,
            issues: ['测试执行失败，无法评判'],
            reasoning: `执行错误: ${result.error}`,
            error: 'test-failed',
          }
        : await judgeResult(testCase, result, env);

      judgeResults.push(judge);

      if (!result.error) {
        console.log(`     得分: ${judge.score}/5 ${judge.compliance ? '✅' : '❌'} — ${judge.reasoning.slice(0, 80)}`);
      }

      // 评判间短暂间隔
      await sleep(500);
    }
  } else {
    // 不评判时，填充默认值
    for (const { testCase, result } of allResults) {
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

  // 合并结果
  const finalResults = allResults.map((item, i) => ({
    ...item,
    judge: judgeResults[i],
  }));

  // 生成报告
  console.log('\n📝 生成报告...');
  const report = generateReport(finalResults, env);

  // 保存报告
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORTS_DIR, `dev-agent-test-${reportTimestamp}.md`);
  fs.writeFileSync(reportPath, report, 'utf-8');

  // 同时保存一份 latest
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
  console.log('  测试摘要');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  完成: ${completed.length}/${finalResults.length}`);
  console.log(`  失败: ${finalResults.length - completed.length}`);
  console.log(`  平均得分: ${avgScore}/5.0`);
  console.log(`  符合需求率: ${complianceRate}%`);
  console.log('═══════════════════════════════════════════════════');
}

/** 构造对话历史（用于有依赖的测试用例） */
function buildConversationHistory(
  tc: TestCase,
  resultMap: Map<string, TestResult>,
): Array<{ role: string; parts: Array<{ type: string; text?: string }> }> {
  if (!tc.dependsOn || tc.dependsOn.length === 0) return [];

  const history: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> = [];

  for (const depId of tc.dependsOn) {
    const depResult = resultMap.get(depId);
    if (!depResult) continue;

    // 添加前置用户消息
    const depCase = TEST_CASES.find(t => t.id === depId);
    if (depCase) {
      history.push({
        role: 'user',
        parts: [{ type: 'text', text: depCase.prompt }],
      });
    }

    // 添加前置助手回复（截断以避免过长）
    const replyText = depResult.responseText.slice(0, 2000);
    if (replyText) {
      history.push({
        role: 'assistant',
        parts: [{ type: 'text', text: replyText }],
      });
    }
  }

  return history;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── 入口 ─────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('❌ 测试脚本异常:', err);
  process.exit(1);
});
