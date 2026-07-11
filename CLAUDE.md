# 自进化英语学习 AI Agent

## 项目概述
基于 Next.js 15 + AI SDK + DeepSeek 的自进化英语学习系统。Dual-Agent 架构（Teacher + Developer），支持 Generative UI 和动态工具注册。

## 技术栈
- **前端**: Next.js 15 (App Router) + Tailwind CSS + shadcn/ui
- **AI**: AI SDK (ai) + @ai-sdk/deepseek (Teacher: deepseek-chat, Developer: deepseek-reasoner)
- **FSRS**: ts-fsrs (间隔重复算法)
- **数据库**: @libsql/client (SQLite, WASM-based, 无需原生编译) + Drizzle ORM
- **向量**: @upstash/vector (RAG, Phase 4)

## 关键路径
- 聊天 API: `src/app/api/chat/route.ts`
- Agent 定义: `src/lib/ai/teacher-agent.ts`, `src/lib/ai/developer-agent.ts`
- Agent 路由: `src/lib/ai/agent-router.ts`
- FSRS 封装: `src/lib/fsrs/scheduler.ts`
- 数据库 Schema: `src/lib/db/schema.ts`
- World State: `src/lib/pipeline/world-state.ts`
- 动态组件: `src/components/generative/`

## 开发命令
- `npm run dev` — 启动开发服务器（默认 Turbopack）
- `npm run dev -- --turbopack --port 3088` — 指定端口启动（推荐）
- `npm run build` — 构建（webpack，Q: 盘上有 junction 问题）
- `npm run lint` — 代码检查
- `npm run db:migrate` — 运行数据库迁移
- `npm test` — 运行单元测试（FSRS + 数据库）
- `npm run test:e2e` — 运行 E2E 集成测试（需先启动 dev server）

## 注意事项
- Node.js 版本 20.11.1（AI SDK 要求 >=22，但实际可运行，忽略 EBADENGINE 警告）
- better-sqlite3 无法在此 Windows 环境编译，使用 @libsql/client 替代
- **必须用 Turbopack** 开发：`npm run dev -- --turbopack`（webpack 在 Q: 盘编译极慢）
- DeepSeek reasoner 返回 reasoning stream parts，前端需处理
- Agent 生成的代码存放在 `generated/` 目录，已加入 .gitignore
- E2E 测试默认连接 `http://localhost:3088`，可通过 `E2E_BASE_URL` 环境变量覆盖
