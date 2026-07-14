import { tool } from 'ai';
import { z } from 'zod';
import { db, client } from '@/lib/db';
import { words, reviews } from '@/lib/db/schema';
import { eq, sql, and, desc } from 'drizzle-orm';

// Tables that are forbidden in custom SQL queries (security/sensitivity)
const FORBIDDEN_TABLES = ['sqlite_master', 'sqlite_sequence', 'dynamic_commands', 'developer_lessons'];

function validateCustomSql(customSql: string): string | null {
  const upper = customSql.trim().toUpperCase();

  // Only allow SELECT
  if (!upper.startsWith('SELECT')) {
    return '只允许 SELECT 查询';
  }

  // Check for forbidden table names
  for (const table of FORBIDDEN_TABLES) {
    // Match table name as a word boundary (case-insensitive)
    const re = new RegExp('\\b' + table.replace('_', '[_]') + '\\b', 'i');
    if (re.test(customSql)) {
      return `禁止查询 ${table} 表`;
    }
  }

  return null;
}

export const dbQueryTool = tool({
  description: '查询数据库中的词汇和复习数据。必须指定 queryType 参数。',
  inputSchema: z.object({
    queryType: z.enum([
      'word-count',
      'review-history',
      'word-search',
      'custom',
    ]).describe('查询类型，必填。word-count=统计单词总数, review-history=查询单词复习记录(需wordId), word-search=搜索单词(需word), custom=自定义SQL(需sql)'),
    word: z.string().optional().describe('搜索单词时使用（queryType=word-search 时必填）'),
    wordId: z.string().optional().describe('查询特定单词的复习历史（queryType=review-history 时必填）'),
    sql: z.string().optional().describe('自定义 SQL 查询，只允许 SELECT（queryType=custom 时必填）'),
  }),
  execute: async ({ queryType, word, wordId, sql: customSql }) => {
    try {
      switch (queryType) {
        case 'word-count': {
          const result = await db.select({ count: sql<number>`count(*)` }).from(words);
          return { type: 'word-count', count: result[0].count };
        }

        case 'review-history': {
          if (!wordId) return { type: 'error', message: '需要 wordId 参数' };
          const result = await db
            .select()
            .from(reviews)
            .where(eq(reviews.wordId, wordId))
            .orderBy(desc(reviews.reviewedAt))
            .limit(20);
          return { type: 'review-history', reviews: result };
        }

        case 'word-search': {
          if (!word) return { type: 'error', message: '需要 word 参数' };
          const result = await db
            .select()
            .from(words)
            .where(eq(words.word, word.toLowerCase()));
          return { type: 'word-search', words: result };
        }

        case 'custom': {
          if (!customSql) return { type: 'error', message: '需要 sql 参数' };
          // Safety: validate custom SQL
          const validationError = validateCustomSql(customSql);
          if (validationError) {
            return { type: 'error', message: validationError };
          }
          const result = await client.execute({ sql: customSql, args: [] });
          return { type: 'custom', rows: result.rows };
        }

        default:
          return { type: 'error', message: `未知查询类型: ${queryType}` };
      }
    } catch (error) {
      return { type: 'error', message: `查询失败: ${String(error)}` };
    }
  },
});
