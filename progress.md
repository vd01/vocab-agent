# Progress — Review 自动调度功能

## Session: 2025-01-XX

### Phase 1: 浏览器端 Notification API 支持 ✅
- [x] 1.1 创建 `src/lib/notification/review-scheduler.ts` — ReviewScheduler 类（轮询、静默时段、去重、Web Notification）
- [x] 1.2 创建 `src/lib/notification/notification-manager.ts` — NotificationManager 单例（生命周期管理、配置持久化）
- [x] 1.3 使用 globalThis 替代 window 检查，兼容 Node 测试环境
- [x] 1.4 通知点击 → dispatch `review-notification-click` custom event → ChatPanel 处理

### Phase 2: 前端 UI — 复习提醒控制组件 ✅
- [x] 2.1 创建 `src/components/notification/review-reminder-toggle.tsx` — 铃铛开关 + 设置 Popover
- [x] 2.2 ChatInput 集成：复习按钮 due count badge + 提醒开关
- [x] 2.3 设置面板：轮询间隔（15/30/60/120/240分钟）、静默时段选择
- [x] 2.4 dueCount 传递链：NotificationManager → ChatPanel → ChatInput

### Phase 3: 自动推送复习到聊天 ✅
- [x] 3.1 创建 `src/components/notification/review-prompt-banner.tsx` — 琥珀色系统提示横幅
- [x] 3.2 创建 `useAutoReviewPrompt` hook — 去重逻辑（10分钟内不重复、复习后可重新触发）
- [x] 3.3 ChatPanel 集成：showPrompt 时渲染横幅，一键"开始复习"
- [x] 3.4 handleReview 调用 markReviewDone，横幅在 devMode 下不显示

### Phase 4: 持久化配置 + 后端 API ✅
- [x] 4.1 DB schema 添加 `user_settings` 表（key-value）
- [x] 4.2 migration 添加 CREATE TABLE IF NOT EXISTS user_settings
- [x] 4.3 创建 `src/lib/db/settings.ts` — getSetting/setSetting/getSettingsByPrefix
- [x] 4.4 创建 `/api/settings` GET/POST API
- [x] 4.5 NotificationManager.init() 从 API 加载配置，setEnabled/updateConfig 保存到 API

### Phase 5: 测试 + 完善 ✅
- [x] 5.1 单元测试：ReviewScheduler — 16 tests（配置、轮询、静默时段、去重、权限）
- [x] 5.2 全量测试通过：43 tests (3 files)
- [x] 5.3 TypeScript 编译通过：0 errors
- [x] 5.4 DB migration 运行成功

## 新增文件清单
| 文件 | 用途 |
|------|------|
| `src/lib/notification/review-scheduler.ts` | 复习调度核心逻辑 |
| `src/lib/notification/notification-manager.ts` | 通知管理单例 |
| `src/lib/notification/review-scheduler.test.ts` | 调度器单元测试 |
| `src/lib/db/settings.ts` | 设置读写 API |
| `src/app/api/settings/route.ts` | 设置 REST API |
| `src/components/notification/review-reminder-toggle.tsx` | 提醒开关 UI |
| `src/components/notification/review-prompt-banner.tsx` | 自动复习提示横幅 |

## 修改文件清单
| 文件 | 变更 |
|------|------|
| `src/lib/db/schema.ts` | 添加 userSettings 表定义 |
| `src/lib/db/migrate.ts` | 添加 user_settings 表 migration |
| `src/components/chat/chat-input.tsx` | 添加 dueCount badge + ReviewReminderToggle |
| `src/components/chat/chat-panel.tsx` | 添加 NotificationManager 初始化 + dueCount + ReviewPromptBanner |
