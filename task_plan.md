# Review 自动调度功能 — 任务计划

## 目标

为 Vocab Agent 增加 Review 自动调度功能，让系统在有待复习单词时自动提醒用户，无需用户手动发起 `/review`。功能需同时支持 **Electron 桌面端** 和 **浏览器端**。

## 现状分析

### 已有基础设施
1. **Electron 通知系统** (`electron/notification.ts`): 已实现定时轮询 `/api/review-due` + 系统通知，仅 Electron 端可用
2. **`/api/review-due` API**: 返回 `{ due: number }` 待复习单词数
3. **FSRS 调度器** (`src/lib/fsrs/scheduler.ts`): `getDueWords()` 获取待复习单词
4. **World State** (`src/lib/pipeline/world-state.ts`): `dueCount` 已注入 Teacher Agent 上下文
5. **Teacher Prompt**: 已包含"待复习: X 词"，但只是被动展示

### 缺失功能
1. **浏览器端无任何通知机制** — 没有 Web Push / Service Worker / Notification API
2. **无前端轮询/调度逻辑** — 用户必须主动点"复习"按钮或输入命令
3. **无"自动开始复习"能力** — 系统不会主动推送复习任务到聊天
4. **无复习时间窗口感知** — 不考虑用户习惯/时间段

---

## Phase 1: 浏览器端 Notification API 支持 ✅ done

**目标**: 在浏览器端使用 Web Notification API 实现复习提醒

### 步骤
- [x] 1.1 创建 `src/lib/notification/review-scheduler.ts` — ReviewScheduler 类
- [x] 1.2 创建 `src/lib/notification/notification-manager.ts` — NotificationManager 单例
- [x] 1.3 在 ChatPanel 中初始化 NotificationManager
- [x] 1.4 通知点击后自动触发 `/review` 命令

### 关键设计
- 权限请求时机：用户首次点击"复习提醒"按钮时，不自动弹出
- 轮询间隔：可配置，默认 30 分钟
- 静默时段：22:00-07:00 不发通知
- 通知去重：同一批 due words 不重复通知

---

## Phase 2: 前端 UI — 复习提醒控制组件 ✅ done

**目标**: 在前端提供复习提醒开关和配置入口

### 步骤
- [x] 2.1 创建 `src/components/notification/review-reminder-toggle.tsx` — 铃铛开关 + 设置 Popover
- [x] 2.2 在 ChatInput 快捷按钮区添加提醒开关 + due count badge
- [x] 2.3 设置面板（轮询间隔、静默时段）
- [x] 2.4 待复习数量 badge 显示在复习按钮上

### 关键设计
- 复习按钮增加 due count badge（红色小数字）
- 提醒开关用铃铛图标，开启后变为实心
- 设置用 Popover 弹出，包含间隔和时段配置

---

## Phase 3: 自动推送复习到聊天 ✅ done

**目标**: 当有待复习单词时，系统主动在聊天中推送复习提示消息

### 步骤
- [x] 3.1 创建 `src/components/notification/review-prompt-banner.tsx` — 琥珀色系统提示横幅 + useAutoReviewPrompt hook
- [x] 3.2 在 ChatPanel 中集成：页面加载时/轮询发现 due words 时，在聊天中插入系统提示
- [x] 3.3 用户可一键点击提示中的"开始复习"直接进入 ReviewSession
- [x] 3.4 去重：同一会话中不重复推送（10分钟冷却 + 复习后可重新触发）

### 关键设计
- 系统提示样式：淡黄色背景，区别于普通消息
- 不干扰正常对话：插入到消息列表顶部或底部，不触发 AI 回复
- 点击"开始复习"= 执行 `/review` 命令

---

## Phase 4: 持久化配置 + 后端 API ✅ done

**目标**: 将通知/调度配置持久化到数据库，提供 API 供前端读写

### 步骤
- [x] 4.1 DB schema 添加 `user_settings` 表（key-value 存储）
- [x] 4.2 创建 migration
- [x] 4.3 创建 `src/lib/db/settings.ts` + `/api/settings` GET/POST API
- [x] 4.4 NotificationManager 从 API 读取/保存配置
- [x] 4.5 Electron 端保持兼容（未迁移，使用原有 AppConfig）

---

## Phase 5: 测试 + 完善 ✅ done

**目标**: 确保功能稳定，边界情况处理好

### 步骤
- [x] 5.1 单元测试：ReviewScheduler — 16 tests（配置、轮询、静默时段、去重、权限）
- [x] 5.2 全量测试通过：43 tests (3 files)
- [x] 5.3 TypeScript 编译通过：0 errors
- [x] 5.4 DB migration 运行成功

---

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 浏览器通知方式 | Web Notification API | 原生支持，无需 Service Worker 复杂性，标签页后台也能收到 |
| 配置存储 | DB `user_settings` 表 | 统一存储，跨设备同步（未来），Electron/浏览器共用 |
| 轮询实现 | 前端 setInterval | 简单可靠，避免 Service Worker 生命周期问题 |
| 自动推送聊天 | 前端插入系统消息 | 不消耗 LLM token，无延迟，用户可交互 |
| 复习 Badge | 实时查询 review-due API | 已有 API，轻量，直接复用 |

## Phase 6: 每日新词+复习配额 (Anki-style daily limits) ✅ done

**目标**: 实现 Anki 风格的每日学习新词 + 历史待复习配额机制

### 步骤
- [x] 6.1 添加 `review.dailyNewLimit` / `review.dailyReviewLimit` 到 user_settings 默认值
- [x] 6.2 创建 `getDailyQueueInfo()` — 返回 newDue/reviewDue/todayNewReviewed/todayReviewReviewed/limits/remaining
- [x] 6.3 改造 `getDueWords()` — 先返回复习词，再按配额补充新词，遵守每日限额
- [x] 6.4 改造 `/api/review-due` — 返回分类统计 (newDue/reviewDue/limits/remaining)
- [x] 6.5 改造 /review 命令和 fsrs-review tool — 返回 queueInfo + isNew 标记
- [x] 6.6 改造 ReviewSession UI — 显示新词/复习分类进度 + 新词标签
- [x] 6.7 改造 ReviewPromptBanner — 显示新词/复习分类
- [x] 6.8 在提醒设置面板中添加每日限额配置（新词上限/复习上限）
- [x] 6.9 更新 Teacher prompt 提及 queueInfo

| Error | Attempt | Resolution |
|-------|---------|------------|
| (待填充) | | |
