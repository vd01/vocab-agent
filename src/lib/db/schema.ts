import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// 词汇表
export const words = sqliteTable('words', {
  id: text('id').primaryKey(),
  word: text('word').notNull().unique(),
  phonetic: text('phonetic'),
  definition: text('definition').notNull(), // JSON string, supports multiple meanings
  examples: text('examples'),               // JSON array of example sentences
  source: text('source'),                   // "manual" | "reading" | "ecdict"
  tag: text('tag'),                         // 考试标签: "cet4 cet6 gre toefl"
  collins: integer('collins'),              // Collins 星级 1-5
  bnc: integer('bnc'),                      // BNC 词频排名
  frq: integer('frq'),                      // 当代语料库词频排名
  exchange: text('exchange'),               // 词形变化: "d:abandoned/p:abandoned/i:abandoning/3:abandons"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// FSRS 复习记录
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  wordId: text('word_id').notNull().references(() => words.id),
  rating: integer('rating').notNull(),       // 1=Again, 2=Hard, 3=Good, 4=Easy
  state: integer('state').notNull(),         // 0=New, 1=Learning, 2=Review, 3=Relearning
  due: integer('due', { mode: 'timestamp' }).notNull(),
  stability: real('stability').notNull(),
  difficulty: real('difficulty').notNull(),
  elapsedDays: integer('elapsed_days').notNull(),
  scheduledDays: integer('scheduled_days').notNull(),
  reps: integer('reps').notNull(),
  lapses: integer('lapses').notNull(),
  lastReview: integer('last_review', { mode: 'timestamp' }),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull(),
});

// 聊天消息日志
// parts: JSON string of AI SDK v7 UIMessagePart[]
//   text:     { type: 'text', text: '...' }
//   tool:     { type: 'tool-<name>', toolCallId, toolName, state: 'output-available', input, output }
//   reasoning: { type: 'reasoning', text: '...' }
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),              // "user" | "assistant"
  parts: text('parts'),                      // JSON string — AI SDK v7 UIMessagePart[]
  agentType: text('agent_type'),             // "teacher" | "developer"
  seq: integer('seq').notNull().unique(),    // 自增序列，保证插入顺序
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 动态命令注册表
export const dynamicCommands = sqliteTable('dynamic_commands', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  toolCode: text('tool_code').notNull(),     // Agent-generated tool code
  componentCode: text('component_code'),     // Agent-generated UI component code
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 动态提取脚本注册表
export const dynamicExtractors = sqliteTable('dynamic_extractors', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  scriptCode: text('script_code').notNull(), // Agent-generated extraction script
  outputKey: text('output_key').notNull(),   // Key name in World State
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 置顶单词
export const pinnedWords = sqliteTable('pinned_words', {
  id: text('id').primaryKey(),
  wordId: text('word_id').notNull().references(() => words.id),
  word: text('word').notNull(),
  phonetic: text('phonetic'),
  definition: text('definition'),
  position: integer('position').notNull(),       // 排序位置，越小越靠前
  side: text('side').notNull(),                   // "left" | "right" — 放在哪一侧
  richContent: text('rich_content'),              // JSON — AI 生成的丰富内容
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),  // 归档时间，null=未归档
});

// Developer Agent 经验教训
export const developerLessons = sqliteTable('developer_lessons', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),       // "pattern" | "anti-pattern" | "tip" | "pitfall"
  title: text('title').notNull(),             // 简短标题，如 "组件名必须与 type 匹配"
  content: text('content').notNull(),         // 详细描述
  context: text('context'),                   // 触发场景，如 "注册新命令时"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),  // 最后被注入 prompt 的时间，用于衰减排序
});
