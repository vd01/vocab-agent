import { defineTool } from './types';
import { z } from 'zod';
import { mdxLookupAll, scanMdxSources } from '../../dictionary/mdx/index';

export const mdxLookupTool = defineTool({
	description:
		'查用户安装的 MDX 词典（新牛津英汉双解 oald、朗文当代英汉双解 ldoce、韦氏高阶 merriam），获取完整权威释义。',
	inputSchema: z.object({
		word: z.string().describe('要查询的单词'),
		dict: z.string().optional().describe('指定词典 ID（oald / ldoce / merriam），留空查所有'),
	}),
	execute: async ({ word, dict }) => {
		try {
			const sources = await scanMdxSources();
			if (sources.length === 0) {
				return {
					type: 'not-found',
					word,
					message: '没有安装 MDX 词典。请将 .mdx 文件放入 data/mdx/ 目录。',
				};
			}

			const results = await mdxLookupAll(word.toLowerCase());
			if (results.length === 0) {
				return { type: 'not-found', word, message: `MDX 词典中未找到 "${word}"` };
			}

			const filtered = dict ? results.filter((r) => r.dict === dict) : results;
			if (filtered.length === 0 && dict) {
				return {
					type: 'not-found',
					word,
					message: `词典 "${dict}" 中未找到 "${word}"。可用: ${sources.map((s) => s.name).join(', ')}`,
				};
			}

			const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

			return {
				type: 'mdx-found',
				word: word.toLowerCase(),
				entries: filtered.map((r) => ({ dict: r.dict, text: stripHtml(r.text || r.html) })),
				entryCount: filtered.length,
			};
		} catch (err) {
			console.error('[mdx-lookup] execute error:', err);
			return {
				type: 'error',
				word,
				message: `MDX 查询出错: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	},
});
