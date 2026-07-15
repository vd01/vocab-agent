# Progress — pi SDK 重构

## Session: 2025-07-16

### 完成的调研
- [x] 读取并理解当前 vocab-agent 完整架构（route.ts, teacher-agent, developer-agent, tools, commands, generative UI）
- [x] 读取 pi SDK 文档（extensions.md, sdk.md, rpc.md, packages.md）
- [x] 确认 pi SDK 的 createAgentSession()、DefaultResourceLoader、registerTool()、event 系统的能力
- [x] 确认 pi packages 在 SDK 模式下通过 DefaultResourceLoader + SettingsManager 自动发现
- [x] 确认 pi-readseek 注册 10 个工具，可替代文件块系统
- [x] 确认 agentDir 隔离方案可行
- [x] 确认文件块系统是 workaround，pi 内置工具完全替代
- [x] 澄清 LLM tool vs 业务命令的混淆，确认两者是独立系统
- [x] 确认动态组件注册保留完整流程（D-3 方案）
- [x] 确认动态命令结果不经过 LLM，前端直接处理
- [x] 确认开源分发方案（Docker + 初始化脚本）

### 关键决策
1. 采用方案 D-3：保留完整动态组件注册能力
2. 采用方案 1 隔离：独立 agentDir (.pi-vocab/)
3. 文件操作改用 pi 内置 + pi-readseek，删除文件块系统
4. 业务命令前端直接处理，不走 pi
5. LLM tool 通过 details 字段透传 UI 数据
6. 开源分发：Docker 镜像为主，初始化脚本为辅

### 待执行
- [ ] Phase 1: 基础设施搭建
- [ ] Phase 2: Teacher Agent 迁移
- [ ] Phase 3: Developer Agent 迁移
- [ ] Phase 4: 双 Agent 路由
- [ ] Phase 5: 前端适配
- [ ] Phase 6: 清理与优化
