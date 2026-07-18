# Vocab Agent 三层架构优化计划

## 目标

系统性优化前端/后端/Agent 三层分离中的缺陷，提升可维护性、安全性和并发正确性。

## Phase 1: globalThis → AsyncLocalStorage ✅

- [x] 1.1 创建 `src/lib/pi/mode-context.ts` — AsyncLocalStorage 管理模式上下文
- [x] 1.2 修改 `src/app/api/chat/route.ts` — 使用 `runWithModeContext()` 包裹 SSE 流
- [x] 1.3 修改 `.pi-vocab/extensions/vocab-agent.ts` — 从 `mode-context` 读取而非 `route`
- [x] 1.4 删除 globalThis 相关代码

## Phase 2: Pi Session 并发防护 ✅

- [x] 2.1 确认 Pi SDK 不支持并发（`prompt()` 在 `activeRun` 存在时 throw）
- [x] 2.2 在 `src/lib/pi/session.ts` 中添加 `queuePrompt()` 互斥队列
- [x] 2.3 修改 `route.ts` 使用 `queuePrompt()` 替代 `session.prompt()`
- [x] 2.4 添加 `abortAndClearQueue()` 用于用户主动停止
- [x] 2.5 队列满时返回清晰错误（maxQueueSize=5）

## Phase 3: 动态命令沙盒安全加固（timeout）✅

- [x] 3.1 在 `executor.ts` 的 `executeDynamicCommand()` 中增加 10s 超时
- [x] 3.2 使用 `Promise.race([executionPromise, timeoutPromise])` 实现
- [x] 3.3 超时错误返回 `command-error` 类型，包含清晰消息

## Phase 4: 工具 schema 去重 ✅ (务实方案)

- [x] 4.1 创建 `src/lib/ai/tools/schema-sync.ts` — Zod→JSON Schema 验证脚本
- [x] 4.2 创建 `.pi-vocab/tools/wrap-tool.ts` — 共享 execute 适配器
- [x] 4.3 Extension schema 仍需手动维护，但有验证工具确保同步
- [ ] 4.4 未来：自动从 Zod 生成 TypeBox schema（需 typebox 版本统一）

## Phase 5: vocab-agent.ts 拆分 ✅

- [x] 5.1 创建 `wrapTool()` 适配器消除重复模板代码
- [x] 5.2 拆分 Teacher tools → `.pi-vocab/tools/teacher-tools.ts` (314行)
- [x] 5.3 拆分 Developer tools → `.pi-vocab/tools/developer-tools.ts` (236行)
- [x] 5.4 vocab-agent.ts 只保留路由逻辑 (129行, 原841行)

## Phase 6: message-item.tsx 拆分 ✅

- [x] 6.1 创建 `src/components/tool-renderers/` 目录 (12个文件)
- [x] 6.2 提取文本气泡 → `text-bubbles.tsx` (124行)
- [x] 6.3 提取工具输出注册表 → `registry.tsx` (446行, 含所有渲染器)
- [x] 6.4 提取 DevToolOutput → `dev-tool-output.tsx` (95行)
- [x] 6.5 提取 BatchAddedWords/CompactWordCard → `batch-added-words.tsx` + `compact-word-card.tsx`
- [x] 6.6 提取 ExtractedWordsPanel → `extracted-words-panel.tsx` (183行)
- [x] 6.7 提取 BatchAddResult → `batch-add-result.tsx` (153行)
- [x] 6.8 提取 AgentStatus → `agent-status.tsx` (175行)
- [x] 6.9 提取 TokenUsageBadge → `token-usage-badge.tsx` (51行)
- [x] 6.10 提取 mergeReasoningParts → `merge-parts.ts` (135行)
- [x] 6.11 提取常量/工具 → `utils.ts` (148行)
- [x] 6.12 提取 PinChangeNotifier → `pin-change-notifier.tsx` (15行)
- [x] 6.13 message-item.tsx 精简至 236行 (原1817行, -87%)

## Phase 7: chat-panel.tsx 拆分 ✅

- [x] 7.1 提取 useDueCount → `hooks/use-due-count.ts` (81行)
- [x] 7.2 提取 useChatHistory → `hooks/use-chat-history.ts` (110行)
- [x] 7.3 提取 useCommandInterceptor → `hooks/use-command-interceptor.ts` (173行)
- [x] 7.4 chat-panel.tsx 精简至 240行 (原518行, -54%)

## Phase 8: API 统一中间件 ✅

- [x] 8.1 创建 `src/lib/api/handler.ts` — apiHandlerV2 + ApiError + parseBody
- [x] 8.2 应用到 commands/route.ts (25→15行)
- [x] 8.3 应用到 review-due/route.ts (18→19行)
- [x] 8.4 应用到 health/route.ts (3→5行)
- [x] 8.5 应用到 command-list/route.ts (31→27行)
- [x] 8.6 应用到 debug-logs/route.ts (29→27行)
- [x] 8.7 路由重组暂不执行 — 改URL会破坏前端，收益不大

## Phase 9: 次要优化 ✅

- [x] 9.1 Developer prompt 已在 ≤280 行目标内 (262行), 无需精简
- [x] 9.2 component-registry 空加载已有优雅降级
- [x] 9.3 修复 chat-panel activeGroup 传递 (从 null → activeGroup)
- [x] 9.4 修复 useChatHistory initialHasMore 参数传递
- [x] 9.5 SSE 重连暂不实现 — 单用户应用, 重新发送即可恢复
- [x] 9.6 ToolResult union type 暂不实现 — 大型类型定义工作, 收益有限

## 验证状态

- TypeScript: 0 errors ✅
- Unit Tests: 43/43 passed ✅
