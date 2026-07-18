import { defineTool } from './types';
import { z } from 'zod';
import { executeCommand } from '../../commands/executor';
import { db } from '../../db';
import { dynamicCommands } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Parse an Error object into a structured format with line/column info.
 * Adds Chinese hints for common SQLite errors to help the LLM self-repair.
 */
function parseErrorDetail(err: unknown): {
  errorType: string;
  errorMessage: string;
  line?: number;
  column?: number;
  stack?: string;
  hint?: string;
} {
  // Handle plain objects (from executor's _errorDetail)
  if (err && typeof err === 'object' && !(err instanceof Error)) {
    const obj = err as Record<string, unknown>;
    const msg = String(obj.message ?? obj.errorMessage ?? 'Unknown error');
    const name = String(obj.name ?? 'Error');
    let line: number | undefined;
    let column: number | undefined;
    if (obj.stack && typeof obj.stack === 'string') {
      const stackLineMatch = obj.stack.match(/<anonymous>:(\d+):(\d+)/);
      if (stackLineMatch) {
        line = parseInt(stackLineMatch[1], 10);
        column = parseInt(stackLineMatch[2], 10);
      }
    }
    let hint: string | undefined;
    const msgLower = msg.toLowerCase();
    if (msgLower.includes('syntaxerror') || msgLower.includes('unexpected token') || msgLower.includes('is not valid json')) {
      hint = 'JavaScript 语法错误或 JSON 解析错误。检查 toolCode 中的 JSON.parse 调用，确保数据是合法 JSON。建议用 try-catch 包裹 JSON.parse。';
    } else if (msgLower.includes('unique constraint')) {
      hint = '数据已存在（UNIQUE 约束冲突），可能是重复插入。';
    } else if (msgLower.includes('not null constraint')) {
      hint = '必填字段缺失（NOT NULL 约束）。检查 id 等必填字段。';
    } else if (msgLower.includes('referenceerror')) {
      hint = '引用了未定义的变量。沙盒注入: db, client, tables, dql, fsrs, args, console。';
    }
    return {
      errorType: name,
      errorMessage: msg,
      ...(line != null && { line }),
      ...(column != null && { column }),
      ...(obj.stack ? { stack: String(obj.stack) } : {}),
      ...(hint ? { hint } : {}),
    };
  }

  if (!(err instanceof Error)) {
    return { errorType: 'unknown', errorMessage: String(err) };
  }

  const msg = err.message;
  const name = err.name || 'Error';

  let line: number | undefined;
  let column: number | undefined;

  // Try to extract from message
  const lineInMsg = msg.match(/line\s+(\d+)/i);
  if (lineInMsg) line = parseInt(lineInMsg[1], 10);

  // Try to extract from stack trace (new Function creates eval-like frames)
  if (err.stack) {
    const stackLineMatch = err.stack.match(/<anonymous>:(\d+):(\d+)/);
    if (stackLineMatch) {
      line = parseInt(stackLineMatch[1], 10);
      column = parseInt(stackLineMatch[2], 10);
    }
  }

  // Add Chinese hints for common SQLite errors
  let hint: string | undefined;
  const msgLower = msg.toLowerCase();
  if (msgLower.includes('unique constraint')) {
    hint = '数据已存在（UNIQUE 约束冲突），可能是重复插入。检查是否已存在相同数据，或先删除再插入。';
  } else if (msgLower.includes('not null constraint')) {
    hint = '必填字段缺失（NOT NULL 约束）。检查 id 等必填字段是否都已提供。插入单词时 id 必须用 uuidv4() 生成。';
  } else if (msgLower.includes('no column named') || msgLower.includes('table has no column')) {
    hint = '字段名不存在。检查 tables 中的字段名是否正确（如 tables.words.word, tables.words.source）。';
  } else if (msgLower.includes('failed query') || msgLower.includes('insert into')) {
    hint = 'SQL 插入/查询失败。检查：1) id 字段是否用 uuidv4() 生成 2) definition/examples 是否用 JSON.stringify() 3) 字段名是否正确。';
  } else if (msgLower.includes('syntaxerror') || msgLower.includes('unexpected token')) {
    hint = 'JavaScript 语法错误。检查 toolCode 中的括号、引号、分号是否匹配。';
  } else if (msgLower.includes('referenceerror')) {
    hint = '引用了未定义的变量。检查是否使用了沙盒未注入的变量（沙盒注入: db, client, tables, dql, fsrs, args, console）。';
  }

  return {
    errorType: name,
    errorMessage: msg,
    ...(line != null && { line }),
    ...(column != null && { column }),
    stack: err.stack,
    ...(hint && { hint }),
  };
}

/**
 * Check if a component file exists on disk for the given command name.
 * Returns warnings if the command returns a custom type but the component
 * file is missing (which means Turbopack can't load it).
 */
async function checkComponentStatus(cmdName: string, resultType: string): Promise<string[]> {
  const warnings: string[] = [];

  if (resultType === 'message') return warnings;

  // Check DB for component registration
  const cmd = await db.select({ componentCode: dynamicCommands.componentCode })
    .from(dynamicCommands)
    .where(eq(dynamicCommands.name, cmdName))
    .limit(1);

  if (cmd.length === 0 || !cmd[0].componentCode) {
    warnings.push(
      `命令返回 type: "${resultType}"，但该命令未注册 UI 组件。` +
      `用户会看到 JSON 数据而非渲染结果。` +
      `请在 create-command 时提供 componentCodePath 参数。`
    );
    return warnings;
  }

  // Check if component file exists on disk
  const componentPath = path.join(
    process.cwd(), 'src', 'components', 'generated', `${cmdName}.tsx`
  );
  if (!existsSync(componentPath)) {
    warnings.push(
      `命令返回 type: "${resultType}"，组件代码在 DB 中存在但文件未落盘: ${componentPath}。` +
      `可能是 create-command 写入失败。`
    );
    return warnings;
  }

  // File exists — Turbopack should be able to compile it.
  // If it still doesn't render on the client, the issue is likely a compile error
  // in the component code. We can't check Turbopack compile status from server-side,
  // but the client-side ErrorBoundary will catch and display the error.
  return warnings;
}

export const testCommandTool = defineTool({
  description: '测试已注册的 / 命令是否正常工作。直接调用命令执行器，返回执行结果。用于验证新注册的命令是否正确。',
  inputSchema: z.object({
    command: z.string().describe('要测试的完整命令，如 "word-stats" 或 "prefix-search app"（不含 / 前缀）'),
  }),
  execute: async ({ command }) => {
    try {
      // Prepend / if not present, since executeCommand expects it
      const fullCommand = command.startsWith('/') ? command : `/${command}`;
      const result = await executeCommand(fullCommand);

      // Analyze the result and provide a verdict
      const isOk = result.type !== 'unknown-command'
        && result.type !== 'command-error'
        && result.type !== 'invalid-args'
        && result.type !== 'error';

      if (isOk) {
        // Additional check: if the command returns a custom type (not 'message'),
        // verify the component file exists on disk
        const cmdName = command.split(/\s+/)[0];
        const componentWarnings = await checkComponentStatus(cmdName, result.type);

        return {
          ...result,
          _testVerdict: componentWarnings.length > 0 ? 'warn' : 'pass',
          _testSummary: componentWarnings.length > 0
            ? `命令 /${cmdName} 执行成功，但组件可能有问题: ${componentWarnings[0]}`
            : `命令 /${cmdName} 执行成功，返回类型: ${result.type}`,
          ...(componentWarnings.length > 0 && { _componentWarnings: componentWarnings }),
        };
      }

      // Failed — extract structured error info from _errorDetail
      const errorDetail = result._errorDetail
        ? parseErrorDetail(result._errorDetail)
        : parseErrorDetail(new Error(result.message ?? 'Unknown error'));
      return {
        ...result,
        _testVerdict: 'fail',
        _testSummary: `命令 /${command.split(/\s+/)[0]} 执行失败: ${result.message ?? result.type}`,
        _errorDetail: errorDetail,
      };
    } catch (err) {
      const errorDetail = parseErrorDetail(err);
      return {
        type: 'error',
        _testVerdict: 'fail',
        _testSummary: `测试异常: ${err instanceof Error ? err.message : String(err)}`,
        _errorDetail: errorDetail,
      };
    }
  },
});
