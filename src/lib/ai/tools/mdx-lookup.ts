import { defineTool } from './types';
import { z } from 'zod';
import { mdxLookupAll, scanMdxSources } from '../../dictionary/mdx/index';

/**
 * MDX dictionary lookup tool — for Teacher Agent.
 *
 * Queries user-provided MDX dictionaries (OALD9, LDOCE6, etc.)
 * and returns full HTML definitions. Use this when users want
 * authoritative dictionary entries from their installed MDX files.
 */
export const mdxLookupTool = defineTool({
	description:
		'查用户安装的 MDX 词典（牛津高阶 OALD、朗文当代 LDOCE 等），获取完整权威释义（HTML 格式）。用于获取详细的英文释义、用法说明和例句。',
	inputSchema: z.object({
		word: z.string().describe('要查询的单词'),
		dict: z
			.string()
			.optional()
			.describe('指定词典名（如 oald9、ldoce6），留空则查询所有已安装的 MDX 词典'),
	}),
	execute: async ({ word, dict }) => {
		// Check if any sources are available
		const sources = await scanMdxSources();
		if (sources.length === 0) {
			return {
				type: 'not-found',
				word,
				message:
					'没有安装 MDX 词典。请将 .mdx 文件放入 data/mdx/ 目录（如 OALD9、LDOCE6）。',
			};
		}

		const results = await mdxLookupAll(word.toLowerCase());

		if (results.length === 0) {
			return {
				type: 'not-found',
				word,
				message: `MDX 词典中未找到单词 "${word}"`,
			};
		}

		const filtered = dict
			? results.filter((r) => r.dict === dict)
			: results;

		if (filtered.length === 0 && dict) {
			return {
				type: 'not-found',
				word,
				message: `词典 "${dict}" 中未找到单词 "${word}"。可用的词典：${sources.map((s) => s.name).join(', ')}`,
			};
		}

		return {
			type: 'mdx-found',
			word: word.toLowerCase(),
			entries: filtered.map((r) => ({
				dict: r.dict,
				html: r.html,
				text: r.text,
			})),
			entryCount: filtered.length,
		};
	},
});
