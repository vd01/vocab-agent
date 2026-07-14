import { tool } from 'ai';
import { z } from 'zod';
import { executeCommand } from '@/lib/commands/executor';
import { db } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Parse an Error object into a structured format with line/column info.
 */
function parseErrorDetail(err: unknown): {
  errorType: string;
  errorMessage: string;
  line?: number;
  column?: number;
  stack?: string;
} {
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

  return {
    errorType: name,
    errorMessage: msg,
    ...(line != null && { line }),
    ...(column != null && { column }),
    stack: err.stack,
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

export const testCommandTool = tool({
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

      // Failed — extract structured error info
      const errorDetail = parseErrorDetail(result._rawError);
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
