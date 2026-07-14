import { tool } from 'ai';
import { z } from 'zod';

/**
 * file-edit 引导工具
 *
 * 当 deepseek-reasoner 模型错误地将 <<<file-edit:...>>> 标记块当作工具调用时，
 * 此工具拦截调用并返回纠正提示，引导模型使用正确的标记块语法。
 *
 * 这不是真正的文件编辑工具——文件编辑通过标记块在文本输出中完成。
 */
export const fileEditGuidanceTool = tool({
  description: `⚠️ 此工具不可用！编辑文件请使用标记块语法，在回复文本中直接输出：
替换行范围：<<<file-edit:路径:replace:起始行-结束行>>>
新代码
<<<end>>>
插入代码：<<<file-edit:路径:insert:行号>>>
新代码
<<<end>>>
不要调用此工具。调用此工具只会返回错误提示。`,
  inputSchema: z.object({
    filePath: z.string().describe('文件路径（相对路径）'),
    mode: z.enum(['replace', 'insert']).describe('编辑模式：replace 替换行范围，insert 在指定行前插入'),
    startLine: z.number().describe('起始行号（replace: 起始行, insert: 插入位置）'),
    endLine: z.number().optional().describe('结束行号（仅 replace 模式需要）'),
    content: z.string().describe('新代码内容'),
  }),
  execute: async ({ filePath, mode, startLine, endLine, content }) => {
    // 不执行任何文件操作，只返回纠正提示
    let blockSyntax: string;
    if (mode === 'replace') {
      const end = endLine ?? startLine;
      blockSyntax = `<<<file-edit:${filePath}:replace:${startLine}-${end}>>>\n${content}\n<<<end>>>`;
    } else {
      blockSyntax = `<<<file-edit:${filePath}:insert:${startLine}>>>\n${content}\n<<<end>>>`;
    }

    return {
      type: 'error',
      errorType: 'guidance',
      message: `❌ file-edit 不是工具调用！请使用标记块语法编辑文件。

正确方式——直接在回复文本中输出以下标记块：

${blockSyntax}

标记块会自动编辑文件，不需要调用任何工具。
记住：编辑文件 = 标记块，不是工具调用。`,
    };
  },
});
