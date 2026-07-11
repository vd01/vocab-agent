# 项目架构文档

> Developer Agent 必须理解的项目架构，避免写出与系统不兼容的代码。

## 1. 双 Agent 架构

```
用户消息 → routeAgent() → Teacher Agent (deepseek-chat)
                      → Developer Agent (deepseek-reasoner)
```

### Teacher Agent
- 模型: `deepseek-chat`
- 职责: 日常对话、单词查询、复习引导
- 工具: fsrs-review, add-word, vocab-lookup, dict-lookup, extract-words, vocab-stats
- 不需要注册命令，直接用工具完成任务

### Developer Agent
- 模型: `deepseek-reasoner`（返回 reasoning stream parts）
- 职责: 创建命令、写代码、扩展系统
- 工具: file-write, file-read, file-edit, file-list, create-command, register-tool, register-component, shell-exec, db-query, test-command, save-lesson
- 返回 reasoning 部分前端会折叠显示

### 路由规则 (`src/lib/ai/agent-router.ts`)
- 以 `/dev` 开头 → Developer
- 包含"帮我实现"/"添加功能"/"创建命令"等关键词 → Developer
- 其他 → Teacher

## 2. 命令系统

### 内置命令 (`src/lib/commands/handlers/`)
- `/review` — 获取待复习单词，返回 `{ type: 'due-words', words: [...] }`
- `/add <word>` — 添加单词，返回 `{ type: 'added', wordId, word, ... }`
- `/stats` — 学习统计，返回 `{ type: 'stats', totalWords, daily, distribution }`
- `/rate <wordId> <1-4>` — 提交评分，返回 `{ type: 'review-result', rating, scheduledDays }`

### 动态命令 (`dynamic_commands` 表)
- 由 Developer Agent 通过 `create-command` 工具注册
- toolCode 存在 DB 中，运行时通过 `new Function()` 沙盒执行
- 沙盒注入: `db`, `tables`, `fsrs`, `args`, `console`
- 如果 toolCode 返回的 `type` 有对应注册组件，前端自动渲染该组件

### 命令执行流程
```
用户输入 /xxx → chat-panel.tsx 检测到 / 开头
  → POST /api/commands { command: "/xxx" }
  → executor.ts: 先查内置命令，再查 dynamic_commands 表
  → 内置: 直接调用 handler.execute()
  → 动态: new Function(toolCode)() 在沙盒中执行
  → 返回 CommandResult → 前端渲染
```

## 3. 组件注册系统

### 注册流程
```
create-command({ name, toolCodePath, componentCodePath })
  → 读取 toolCode 文件和 componentCode 文件
  → upsert dynamic_commands 表
  → 如果有 componentCode:
     → 写入 src/components/generated/<name>.tsx
     → 写入 generated/components/<name>.tsx (备份)
     → 更新 src/components/generative/component-registry.ts (静态 import)
     → 更新 DB 中 dynamic_commands.component_code
```

### component-registry.ts 机制
- 文件路径: `src/components/generative/component-registry.ts`
- 使用静态 import + `componentRegistry.register()` 注册所有组件
- 每次 register-component/create-command 调用时自动重写此文件
- Turbopack HMR 自动热更新，无需重启

### 组件命名规则
- 组件文件名: kebab-case（如 `word-stats-panel.tsx`）
- import 变量名: PascalCase（如 `WordStatsPanel`）
- 注册名: kebab-case（如 `'word-stats-panel'`）
- toolCode 返回的 `type` 必须与注册名完全一致

### DynamicRenderer
- 路径: `src/components/generative/dynamic-renderer.tsx`
- 根据 componentName 从 componentRegistry 查找组件
- 包含 ErrorBoundary 防止组件崩溃影响整个页面
- 未注册的组件显示 "组件未注册" 提示

## 4. 前端消息渲染

### message-item.tsx 渲染逻辑
消息中的 tool result 按以下优先级渲染：
1. `type: 'due-words'` → ReviewSession 组件（只有最新的可交互）
2. `type: 'added'` → WordCard 组件
3. `type: 'found'` / `'dict-found'` → WordCard / 词典详情
4. `type: 'message'` → 纯文本
5. `type: 'stats'` → 统计面板
6. `type: 'unknown-command'` / `'command-error'` → 错误提示
7. 其他 → 查 componentRegistry，有则用 DynamicRenderer
8. 兜底 → JSON 文本

**重要**: 新的动态命令返回类型不需要修改 message-item.tsx，只要注册了对应组件就会自动渲染。

## 5. 数据库 Schema

### words 表
```sql
id TEXT PRIMARY KEY,
word TEXT NOT NULL UNIQUE,
phonetic TEXT,
definition TEXT NOT NULL,  -- JSON string 数组，如 '["放弃，抛弃","放纵"]'
examples TEXT,             -- JSON string 数组
source TEXT,               -- "manual" | "reading" | "ecdict"
tag TEXT,                  -- 考试标签: "cet4 cet6 gre toefl"
collins INTEGER,           -- Collins 星级 1-5
bnc INTEGER,               -- BNC 词频排名
frq INTEGER,               -- 当代语料库词频排名
exchange TEXT,             -- 词形变化: "d:abandoned/p:abandoned/i:abandoning/3:abandons"
created_at INTEGER         -- Unix timestamp (seconds)
```

### reviews 表
```sql
id TEXT PRIMARY KEY,
word_id TEXT NOT NULL REFERENCES words(id),
rating INTEGER NOT NULL,       -- 1=Again, 2=Hard, 3=Good, 4=Easy
state INTEGER NOT NULL,        -- 0=New, 1=Learning, 2=Review, 3=Relearning
due INTEGER NOT NULL,          -- Unix timestamp
stability REAL NOT NULL,
difficulty REAL NOT NULL,
elapsed_days INTEGER NOT NULL,
scheduled_days INTEGER NOT NULL,
reps INTEGER NOT NULL,
lapses INTEGER NOT NULL,
last_review INTEGER,           -- Unix timestamp
reviewed_at INTEGER NOT NULL   -- Unix timestamp
```

### dynamic_commands 表
```sql
id TEXT PRIMARY KEY,
name TEXT NOT NULL UNIQUE,
description TEXT NOT NULL,
tool_code TEXT NOT NULL,       -- async 函数表达式字符串
component_code TEXT,           -- React 组件代码（可选）
created_at INTEGER NOT NULL,
updated_at INTEGER NOT NULL
```

### developer_lessons 表
```sql
id TEXT PRIMARY KEY,
category TEXT NOT NULL,  -- "pattern" | "anti-pattern" | "tip" | "pitfall"
title TEXT NOT NULL,
content TEXT NOT NULL,
context TEXT,
created_at INTEGER NOT NULL
```

## 6. FSRS 间隔重复

### 关键函数 (`src/lib/fsrs/scheduler.ts`)
- `getDueWords(limit)` — 获取待复习单词，5 分钟内刚复习过的排除
- `processReview(wordId, rating)` — 提交评分，2 秒防抖
- `initializeCard(wordId)` — 初始化新卡片
- `getProficiencyDistribution()` — 掌握度分布
- `getDailyStats()` — 今日统计

### 时间戳注意
- Drizzle 的 `timestamp` mode 在 SQLite 中存储为 Unix 秒数（整数）
- 查询时必须手动 `toUnixSec(date)` 转换，Drizzle 不会自动处理
- `getDueWords` 和 `getProficiencyDistribution` 使用 raw SQL 避免时间戳问题

## 7. 文件系统约定

### 可写目录（file-write / file-edit 白名单）
- `generated/` — 生成的代码、工具脚本、临时文件
- `src/components/generated/` — 动态注册的 UI 组件
- `src/app/api/` — API 路由

### 可读目录（file-read）
- 项目内任意文件

### 关键文件路径
- 聊天 API: `src/app/api/chat/route.ts`
- 命令 API: `src/app/api/commands/route.ts`
- Agent 定义: `src/lib/ai/teacher-agent.ts`, `src/lib/ai/developer-agent.ts`
- Agent 路由: `src/lib/ai/agent-router.ts`
- 命令执行器: `src/lib/commands/executor.ts`
- 组件注册表: `src/components/generative/component-registry.ts`
- DB Schema: `src/lib/db/schema.ts`
- FSRS: `src/lib/fsrs/scheduler.ts`
- World State: `src/lib/pipeline/world-state.ts`

## 8. 环境限制

- Node.js 20.11.1（AI SDK 要求 >=22 但实际可运行，忽略 EBADENGINE 警告）
- better-sqlite3 无法编译，使用 @libsql/client (WASM-based)
- 必须用 Turbopack 开发（webpack 在 Q: 盘编译极慢）
- DeepSeek reasoner 返回 reasoning stream parts，前端需处理
- generated/ 目录已加入 .gitignore
