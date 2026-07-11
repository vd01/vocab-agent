import { tool } from 'ai';
import { z } from 'zod';
import { executeCommand } from '@/lib/commands/executor';

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

      return {
        ...result,
        _testVerdict: isOk ? 'pass' : 'fail',
        _testSummary: isOk
          ? `命令 /${command.split(/\s+/)[0]} 执行成功，返回类型: ${result.type}`
          : `命令 /${command.split(/\s+/)[0]} 执行失败: ${result.message ?? result.type}`,
      };
    } catch (err) {
      return {
        type: 'error',
        _testVerdict: 'fail',
        _testSummary: `测试异常: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
