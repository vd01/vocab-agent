# Vocab Agent — pi SDK 重构计划

## 目标

将 vocab-agent 的 AI 后端从 AI SDK v7 迁移到 pi SDK，实现：
- 用 pi SDK 的 `createAgentSession()` 替代 AI SDK 的 `streamText()`
- 用 pi extension 的 `registerTool()` 替代 AI SDK 的 `tool()` 定义
- 用 pi-readseek 替代文件块标记系统（`<<<file-write:...>>>`）
- 用 pi 的 `before_agent_start` 事件替代 World State 注入
- 用 pi 的内置 compaction 替代自定义 context manager
- 保留完整的 Generative UI 能力（动态组件注册 + Turbopack HMR）
- 隔离日常 pi 和 vocab-agent 专用的 pi 环境

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (Next.js)                                                  │
│                                                                  │
│  ┌─ 消息渲染层 ───────────────────────────────────────────────┐ │
│  │  文本消息: pi SDK message_update 事件 → ReactMarkdown      │ │
│  │  LLM tool 输出: tool_execution_end.details → 内置渲染器    │ │
│  │  动态组件: tool_execution_end.details → DynamicRenderer    │ │
│  │  推理过程: thinking_delta → 折叠显示                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ 交互回调 (不走 pi) ──────────────────────────────────────┐ │
│  │  /api/rate → FSRS 评分                                     │ │
│  │  /api/pins → 置顶操作                                      │ │
│  │  /api/review-due → 获取待复习 (命令模式)                   │ │
│  │  /api/words/add → 添加单词 (命令模式)                      │ │
│  │  /api/commands/* → 动态命令执行                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ 命令拦截 (前端处理) ─────────────────────────────────────┐ │
│  │  /review, /add, /stats, /rate, /group → 直接调 API Route  │ │
│  │  /xxx (动态命令) → /api/commands/execute                   │ │
│  │  其他输入 → pi.prompt()                                    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ 动态组件系统 (保留) ─────────────────────────────────────┐ │
│  │  component-registry.ts + generated/components/             │ │
│  │  Turbopack HMR 热加载                                     │ │
│  │  /api/component-manifest 组件清单                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
         │
         │ pi SDK (进程内嵌入)
         │
┌─────────▼──────────────────────────────────────────────────────┐
│  Next.js 进程内的 pi AgentSession                                │
│                                                                  │
│  ┌─ .pi-vocab/ 隔离环境 ────────────────────────────────────┐ │
│  │  settings.json → vocab packages、模型配置                  │ │
│  │  auth.json → API keys                                      │ │
│  │  npm/ → pi-readseek 等独立安装                             │ │
│  │  extensions/ → vocab 专用 extensions                      │ │
│  │  sessions/ → vocab 的会话文件                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Extension: vocab-teacher ─────────────────────────────────┐ │
│  │  registerTool: fsrs-review, fsrs-rate, vocab-lookup,      │ │
│  │    add-word, extract-words, dict-lookup, vocab-stats,     │ │
│  │    pin-word, unpin-word, group-manage                      │ │
│  │  on("before_agent_start"): 注入 World State               │ │
│  │  tool execute() details 字段透传 UI 数据                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Extension: vocab-developer ───────────────────────────────┐ │
│  │  registerTool: create-command, register-component,        │ │
│  │    unregister-component, db-query, save-lesson,           │ │
│  │    list-lessons, merge-lessons, test-command              │ │
│  │  文件操作: 用 pi 内置 read/write/edit + readSeek 系列     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Extension: vocab-router ─────────────────────────────────┐ │
│  │  on("before_agent_start"): 切换 Teacher/Developer 模式    │ │
│  │  pi.setActiveTools() 动态启用/禁用工具集                   │ │
│  │  注入不同的 system prompt                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## 关键设计决策

### 1. LLM tool vs 业务命令 — 严格分离

| 层次 | 含义 | 数据流 | pi 对应 |
|------|------|--------|---------|
| **LLM tool** | LLM 推理中自主调用的工具 | pi tool → details → 前端渲染 | `pi.registerTool()` |
| **业务命令** | 用户 `/xxx` 触发，不经过 LLM | 前端 → API Route → 前端渲染 | 前端直接处理 |

LLM tool 和业务命令可能产出同类型的 UI 数据（如 `due-words`），但走完全不同的路径到达前端渲染器。

### 2. UI 数据透传 — details 字段

pi tool 的 `execute()` 返回两份数据：

```typescript
return {
  content: [{ type: "text", text: "简洁文本给 LLM 继续" }],  // LLM 看到
  details: { uiType: "due-words", words: [...], queueInfo: {...} },  // 前端看到
};
```

前端从 `tool_execution_end` 事件提取 `details`，复用现有 `renderToolOutput()` 渲染。

### 3. 动态组件注册 — 保留完整流程 (D-3)

```
当前: LLM 输出 <<<file-write>>> 标记块 → fileBlockStore 解析 → 落盘 → create-command 读取
迁移: LLM 调用 pi 内置 write tool → 落盘 → create-command pi tool 读取
```

组件注册表 (`component-registry.ts`) 和 Turbopack HMR 机制完全保留。
Developer Agent 文件操作改用 pi 内置 `read/write/edit` + pi-readseek 的 `readSeek_*` 系列。

### 4. 文件块系统 — 完全删除

以下文件/逻辑在迁移后删除：

| 删除项 | 原因 |
|--------|------|
| `file-block-store.ts` | 标记块存储，pi 内置 write 替代 |
| `file-block-executor.ts` | 标记块执行，pi 内置 write 替代 |
| `file-block-flush.ts` | 标记块 flush 时序问题，不再需要 |
| `file-write-tool.ts` | 引导工具（不执行操作），不再需要 |
| `file-edit-tool.ts` | 引导工具（不执行操作），不再需要 |
| `repairToolCall` 逻辑 | 修复 deepseek 把标记块当工具名，不再需要 |
| `prepareStep` 中标记块逻辑 | 不再需要 |
| `onStepFinish` 中标记块逻辑 | 不再需要 |

### 5. 环境隔离 — 独立 agentDir

```
~/.pi/agent/                    ← 日常 pi (命令行交互)
├── settings.json               ← 个人 packages、模型偏好
├── npm/node_modules/           ← pi-web-access, pi-subagents 等
└── ...

vocab-agent/.pi-vocab/          ← vocab-agent 专用 (SDK 嵌入)
├── settings.json               ← vocab packages + 模型配置
├── auth.json                   ← API keys (可选独立)
├── npm/node_modules/           ← pi-readseek 等
├── extensions/                 ← vocab-teacher, vocab-developer, vocab-router
├── skills/                     ← vocab-specific skills
└── sessions/                   ← vocab 会话文件
```

SDK 初始化时指定 `agentDir: ".pi-vocab"`，实现完全隔离。

### 6. pi packages 在 SDK 模式下完全可用

`DefaultResourceLoader` 通过 `SettingsManager` 读取 `settings.json` 中的 `packages` 列表，自动发现和加载已安装的 npm/git packages。当前安装的 pi-readseek 等在 vocab-agent 的 `.pi-vocab/settings.json` 中声明即可。

### 7. 开源分发

- **Docker 镜像**：主要分发方式，构建时安装 pi packages
- **初始化脚本**：非 Docker 用户的引导安装
- **pi CLI**：仅构建/初始化阶段需要，运行时只需 pi SDK（随 npm install 装入 node_modules）
- **.pi-vocab/extensions/**：进 git，随项目代码分发
- **.pi-vocab/settings.json**：进 git，声明依赖的 packages

## 迁移阶段

### Phase 1: 基础设施搭建
- 创建 `.pi-vocab/` 目录结构
- 编写 `settings.json`、`models.json`
- 在 Next.js 中集成 pi SDK（`src/lib/pi/session.ts`）
- 修改 `/api/chat/route.ts` 使用 pi SDK 替代 `streamText()`

**状态**: `pending`

### Phase 2: Teacher Agent 迁移
- 编写 `.pi-vocab/extensions/vocab-teacher.ts`
- 10 个 Teacher 工具迁移为 `pi.registerTool()`
- 每个工具的 `details` 字段透传 UI 数据
- `before_agent_start` 注入 World State

**状态**: `pending`

### Phase 3: Developer Agent 迁移
- 编写 `.pi-vocab/extensions/vocab-developer.ts`
- 11 个 Developer 工具迁移（文件操作除外）
- 文件操作改用 pi 内置 `read/write/edit` + pi-readseek
- 删除文件块系统（file-block-*, file-write-tool, file-edit-tool）

**状态**: `pending`

### Phase 4: 双 Agent 路由
- 编写 `.pi-vocab/extensions/vocab-router.ts`
- `before_agent_start` 中根据 mode 切换工具集和 system prompt
- `pi.setActiveTools()` 动态启用/禁用

**状态**: `pending`

### Phase 5: 前端适配
- 替换 `useChat` 为自定义消息状态管理
- 定义 `ChatMessage` 联合类型（user/assistant/tool-result）
- 适配 `message-item.tsx` 的渲染逻辑
- LLM tool 结果和业务命令结果统一走 `renderToolOutput()`

**状态**: `pending`

### Phase 6: 清理与优化
- 删除 AI SDK 依赖（`ai`, `@ai-sdk/openai`, `@ai-sdk/deepseek`, `@ai-sdk/react`）
- 删除文件块系统全部代码
- 删除 `models.ts`、`teacher-agent.ts`、`developer-agent.ts` 旧文件
- 更新 `deploy.sh` 支持 pi SDK
- 编写 Docker 镜像和初始化脚本
- 更新 AGENTS.md

**状态**: `pending`

## 删除清单 vs 保留清单

| 删除 (pi 替代) | 保留 (前端/业务侧) |
|----------------|-------------------|
| `route.ts` 的 SSE 流处理 (~400 行) | `message-item.tsx` (渲染层适配) |
| `models.ts` (provider 配置) | `component-registry.ts` + `dynamic-renderer.tsx` |
| `teacher-agent.ts` (AI SDK tool 定义) | `generated/components/` (动态组件) |
| `developer-agent.ts` (AI SDK tool 定义) | `review-session.tsx`, `word-card.tsx` 等 UI 组件 |
| `file-block-store.ts` | `executor.ts` (命令执行器) |
| `file-block-executor.ts` | `registry-utils.ts` (组件注册表更新) |
| `file-block-flush.ts` | API Routes (`/api/rate`, `/api/pins` 等) |
| `file-write-tool.ts` (引导工具) | `world-state.ts` (数据提取保留) |
| `file-edit-tool.ts` (引导工具) | DB schema + FSRS scheduler |
| `file-write.ts` (只提供 file-read) | 命令 handlers (`handlers/`) |
| `repairToolCall` 逻辑 | `context-manager.ts` (部分，pi compaction 替代大部分) |
| AI SDK 依赖 | 词典数据 + import 脚本 |

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| pi SDK 在 Next.js 进程内的稳定性 | 全局单例 + 错误恢复 + 优雅降级 |
| pi-readseek 与 vocab 自定义工具冲突 | `setActiveTools()` 精确控制 |
| 前端消息格式迁移工作量大 | 渐进式：先保持 AI SDK 消息格式，后迁移 |
| deepseek-reasoner 在 pi SDK 下的兼容性 | 测试 reasoningText 流式输出 |
| 开源用户安装 pi packages 门槛 | Docker 镜像 + 初始化脚本 |
