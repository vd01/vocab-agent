# Findings

## Pi SDK 并发支持

- **结论：不支持并发**
- `Agent.prompt()` 内部检查 `this.activeRun`，若存在直接 `throw new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.")`
- `Agent.steer()` 和 `Agent.followUp()` 用于在流式传输中排队消息
- `AgentSession.prompt()` 在流式期间需要 `streamingBehavior: "steer" | "followUp"`
- 当前项目用单例 session + 直接 prompt()，并发请求会崩溃

## globalThis 模式上下文

- `route.ts` 通过 `(globalThis as any)["__vocab_mode_context__"]` 设置模式
- Extension 在 `before_agent_start` 钩子中读取
- Node.js 的 AsyncLocalStorage 是标准解决方案，保证请求隔离
- Next.js App Router 原生支持 ALS（每个请求有独立的 store）

## 工具 schema 重复

- `src/lib/ai/tools/*.ts` 使用 Zod schema（`defineTool({ inputSchema: z.object(...) })`）
- `.pi-vocab/extensions/vocab-agent.ts` 使用 TypeBox schema（`Type.Object({...})`）
- Pi SDK 的 `pi.registerTool()` 需要 TypeBox 格式
- 选项 A: 工具文件直接用 TypeBox，去掉 Zod
- 选项 B: 工具文件导出参数描述，Extension 从中生成 TypeBox
- **推荐选项 A**：Pi SDK 原生 TypeBox，Zod 只在工具文件内部使用，可以统一替换
