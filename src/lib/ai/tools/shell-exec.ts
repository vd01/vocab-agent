import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';

export const shellExecTool = tool({
  description: '执行 Shell 命令。有 30 秒超时限制，输出截断到 10KB。需要用户确认。',
  inputSchema: z.object({
    command: z.string().describe('要执行的 Shell 命令'),
  }),
  execute: async ({ command }) => {
    // Block dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /del\s+\/[sS]/,
      /format\s+[a-zA-Z]:/,
      /shutdown/,
      /reboot/,
      /mkfs/,
    ];
    if (dangerousPatterns.some(p => p.test(command))) {
      return { type: 'error', message: '安全限制：禁止执行危险命令' };
    }

    return new Promise((resolve) => {
      exec(command, { timeout: 30000, maxBuffer: 10240 }, (error, stdout, stderr) => {
        const output = stdout?.slice(0, 10240) ?? '';
        const errOutput = stderr?.slice(0, 10240) ?? '';

        if (error) {
          resolve({
            type: 'error',
            exitCode: error.code,
            stdout: output,
            stderr: errOutput,
            message: `命令执行失败 (exit code ${error.code}): ${errOutput || error.message}`,
          });
        } else {
          resolve({
            type: 'success',
            stdout: output,
            stderr: errOutput,
            message: output || '命令执行成功（无输出）',
          });
        }
      });
    });
  },
});
