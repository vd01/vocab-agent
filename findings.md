# Findings — pi SDK 重构调研

## pi SDK 核心能力

### createAgentSession()
- 主工厂函数，接受 ResourceLoader、SettingsManager、AuthStorage、ModelRegistry 等
- 返回 `AgentSession` 实例，提供 `prompt()`, `steer()`, `followUp()`, `subscribe()`, `abort()` 等方法
- 支持进程内嵌入，不需要单独的 pi 进程

### DefaultResourceLoader
- 发现 extensions, skills, prompts, themes, context files
- 接受 `agentDir` 参数控制所有资源的根目录
- 通过 SettingsManager 读取 `settings.json` 中的 `packages` 列表
- 自动发现已安装的 npm/git packages 的 `pi` manifest
- 支持项目级隔离（不同 agentDir = 完全不同的环境）

### Extension registerTool()
- `execute()` 返回 `{ content: [...], details: {} }`
- `content` 给 LLM 看（文本），`details` 给前端看（结构化 UI 数据）
- `promptSnippet` + `promptGuidelines` 控制工具在 system prompt 中的描述
- 动态注册：`session_start` 后也能注册新工具
- 可以覆盖 pi 内置工具（同名注册）

### Event 系统
- `before_agent_start` — 注入 system prompt、切换工具集
- `tool_execution_end` — 获取工具执行结果（含 details）
- `message_update` — 流式文本/thinking delta
- `context` — 修改消息上下文
- `input` — 拦截用户输入

### setActiveTools()
- 运行时动态启用/禁用工具
- 支持 include/exclude 模式
- 可用于实现 Teacher/Developer 双 Agent 路由

## 当前架构关键发现

### 文件块系统是 workaround
- deepseek-reasoner 不支持 tool calling，只能把文件操作混入文本
- 导致 fileBlockStore、fileBlockExecutor、fileBlockFlush、引导工具等 ~300 行代码
- pi 内置 read/write/edit + pi-readseek 完全替代，无需保留

### LLM tool vs 业务命令是两个独立系统
- LLM tool: LLM 自主调用，结果回传给 LLM 继续推理，同时通过 details 给前端
- 业务命令: 用户 `/xxx` 触发，直接执行，结果直接给前端
- 两者可能产出相同 type 的 UI 数据，但数据路径完全不同
- 当前 LLM 不能调用动态命令，动态命令只能通过 `/xxx` 触发

### 动态命令结果不经过 LLM
- 前端调 `/api/commands` → executor 沙盒执行 → JSON 返回
- 前端把结果包装成 AI SDK tool part 格式注入消息列表
- 迁移后：结果放入自定义 `ChatMessage.tool-result` 类型消息

### Generative UI 渲染统一入口
- `message-item.tsx` 的 `renderToolOutput()` 是所有 UI 渲染的统一入口
- 先检查 `componentRegistry.has(output.type)` → DynamicRenderer
- 再走内置渲染器（due-words, found, stats 等 15+ 种）
- 最后 fallback 为 JSON 文本
- 这个统一入口在迁移后保持不变，只是数据来源变了

## pi packages 可用性

| Package | 类型 | SDK 下可用 | vocab 需要程度 |
|---------|------|-----------|---------------|
| pi-readseek | Extension | ✅ | 必须 — 替代文件块系统 |
| pi-web-access | Extension + Skills | ✅ | 可选 — Teacher 查在线资源 |
| pi-subagents | Extension + Skills | ✅ | 可选 — 未来双 Agent 协作 |
| pi-hermes-memory | Extension | ✅ | 可选 — 替代 developer_lessons |
| pi-planning-with-files | Skill | ✅ | 不需要 — 开发时用 |

关键：SettingsManager 必须用 `SettingsManager.create()` 读取 settings.json，不能用 `inMemory()`，否则 packages 不被发现。

## 隔离方案确认

- `agentDir` 是隔离的核心旋钮
- 所有状态（settings, auth, packages, sessions）都挂在 agentDir 下
- vocab-agent 用 `.pi-vocab/` 作为 agentDir，与日常 `~/.pi/agent/` 完全隔离
- pi CLI 仅在 `pi install` 时需要，运行时只需 pi SDK
