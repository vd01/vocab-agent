# Findings — Review 自动调度功能

## 现有代码分析

### Electron 通知系统 (electron/notification.ts)
- 使用 `setInterval` 定时轮询 `/api/review-due` API
- `Notification` class (Electron 原生) 展示系统通知
- 点击通知 → `showMainWindow()` + `win.loadURL(base + '/?command=/review')`
- 配置在 `AppConfig.notification` 中: `reviewReminder: boolean`, `reminderInterval: number`
- `startReminder()` 在 `app.whenReady()` 中调用

### /api/review-due (src/app/api/review-due/route.ts)
- 返回 `{ due: number }` — 当前待复习单词数
- 查询: reviews 表最新记录中 due <= now 的数量

### FSRS Scheduler (src/lib/fsrs/scheduler.ts)
- `getDueWords(limit, groupId?)` — 返回 DueWord[]，包含 word/phonetic/definition/examples/card
- 5 分钟去重: 排除最近 5 分钟内已复习的词（rating > 0）
- 初始化记录 (rating=0) 不过滤

### World State (src/lib/pipeline/world-state.ts)
- `dueCount` 通过 `dueWordsExtractor` 提取
- 注入 Teacher Agent instructions 中: "待复习: X 词"

### Chat Panel (src/components/chat/chat-panel.tsx)
- `tryExecuteCommand('/review')` 可触发复习
- 复习结果以 tool part 形式插入消息列表
- `handleReview` 回调绑定到 ChatInput

### Chat Input (src/components/chat/chat-input.tsx)
- 快捷按钮: 复习(Alt+R)、统计(Alt+S)、开发模式开关
- 无通知/提醒相关 UI

### DB Schema (src/lib/db/schema.ts)
- 无 user_settings 或 notification_config 表
- 现有表: words, reviews, chatMessages, dynamicCommands, dynamicExtractors, pinnedWords, wordGroups, wordGroupMembers, developerLessons

## Web Notification API 兼容性
- Chrome/Edge/Firefox/Safari 均支持
- 需要用户授权 (Notification.requestPermission())
- HTTPS 或 localhost 才能使用
- 标签页后台时仍可显示通知
- 无需 Service Worker (与 Push API 不同)

## 设计发现
- 浏览器端不需要 Service Worker + Push API 的复杂方案
- Web Notification API 已足够，因为用户在浏览器中打开页面时才能复习
- 前端 setInterval 轮询足够，不需要后端推送
