import { tool } from 'ai';
import { z } from 'zod';

/**
 * file-write 引导工具
 *
 * 当 deepseek-reasoner 模型错误地将 <<<file-write:...>>> 标记块当作工具调用时，
 * 此工具拦截调用并返回纠正提示，引导模型使用正确的标记块语法。
 *
 * 这不是真正的文件写入工具——文件写入通过标记块在文本输出中完成。
 */
export const fileWriteGuidanceTool = tool({
  description: `⚠️ 此工具不可用！写文件请使用标记块语法，在回复文本中直接输出：
<<<file-write:路径>>>
代码内容
<<<end>>>
不要调用此工具。调用此工具只会返回错误提示。`,
  inputSchema: z.object({
    filePath: z.string().describe('文件路径（相对路径）'),
    content: z.string().describe('文件内容'),
  }),
  execute: async ({ filePath, content }) => {
    // 不执行任何文件操作，只返回纠正提示
    const blockSyntax = `<<<file-write:${filePath}>>>\n${content}\n<<<end>>>`;

    return {
      type: 'error',
      errorType: 'guidance',
      message: `❌ 请用标记块写文件，不要调用此工具。正确方式：\n\n${blockSyntax}\n\n标记块会自动写入文件。`,
    };
  },
});
