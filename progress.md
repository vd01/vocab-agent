# Progress — pi SDK 重构

## Session: 2025-07-16

### 完成的调研
- [x] 读取并理解当前 vocab-agent 完整架构
- [x] 读取 pi SDK 文档（extensions.md, sdk.md, rpc.md, packages.md）
- [x] 确认 pi SDK 各项能力
- [x] 确认 pi packages 在 SDK 模式下可用
- [x] 确认 agentDir 隔离方案可行
- [x] 确认文件块系统是 workaround，pi 内置工具完全替代
- [x] 澄清 LLM tool vs 业务命令的混淆
- [x] 确认动态组件注册保留完整流程（D-3 方案）
- [x] 确认开源分发方案

### 完成的实现
- [x] **Phase 1**: 基础设施搭建
  - `.pi-vocab/` 目录结构（settings.json, models.json, extensions/, skills/, sessions/）
  - pi SDK 单例 `src/lib/pi/session.ts`
  - ChatMessage 类型 `src/lib/pi/chat-message.ts`
  - SSE 桥接 API Route `src/app/api/chat/pi-route.ts`
  - 安装 `@earendil-works/pi-coding-agent` + `typebox`

- [x] **Phase 2-4**: 统一 vocab-agent extension
  - 合并 teacher/developer/router 为单个 `vocab-agent.ts`
  - 10 Teacher 工具 + 8 Developer 工具，全部带 details 字段
  - `before_agent_start` 中切换工具集和 system prompt
  - World State 注入（teacher 模式）
  - Developer system prompt 注入（develop 模式）
  - `setActiveTools()` 双 Agent 路由

- [x] **Phase 5**: 前端适配
  - `usePiChat` hook 消费 pi SSE 事件，产出 UIMessage 格式
  - `chat-panel-pi.tsx` 替代 chat-panel.tsx
  - 命令拦截逻辑保留不变
  - message-item.tsx 渲染无需修改

- [x] **Phase 6 (部分)**: 修复和验证
  - 修复 models.json 格式（`{ providers: { ... } }`）
  - 运行时从 env vars 写入 models.json
  - 修复中文引号嵌套、UIMessage 类型错误
  - 验证 pi SDK 初始化成功：35 工具、2 extensions、模型可用

### 待完成
- [ ] 切换 chat-panel.tsx → chat-panel-pi.tsx（正式启用）
- [ ] 切换 route.ts → pi-route.ts（正式启用）
- [ ] 删除文件块系统代码
- [ ] 删除 AI SDK 依赖
- [ ] 删除旧 models.ts, teacher-agent.ts, developer-agent.ts
- [ ] 更新 deploy.sh + Dockerfile
- [ ] 更新 AGENTS.md
- [ ] E2E 测试

### 关键验证结果
- pi SDK 初始化成功：2 extensions, 35 tools
- vocab-agent.ts extension 加载成功：18 自定义工具
- pi-readseek 加载成功：10 readSeek_* 工具
- 模型可用：当 env vars 正确注入时，TEACHER_MODEL 出现在 getAvailable() 中
- TypeScript 编译通过
