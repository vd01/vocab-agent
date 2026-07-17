# Task Plan: Tauri 快捷查词窗口 (Quick Lookup Window)

## Goal

在 Vocab-Agent Tauri 客户端中实现快捷查词窗口功能：用户在 PC 上复制单词/短语后，按 Ctrl+Shift+X 打开一个小型浮窗，自动检测剪贴板内容并粘贴英语单词/短语，回车后显示查询结果（释义、入库状态、学习状态），并提供下一步操作按钮（入库、加入日常学习、加入日常学习并置顶、加入置顶或新建分组）。

## Current Phase

Phase 3 (complete)

## Phases

### Phase 1: Requirements & Discovery

- **Status:** complete

### Phase 2: Planning & Architecture Design

- **Status:** complete

### Phase 3: Rust Backend Implementation

- [x] 添加 `tauri-plugin-clipboard-manager` 依赖 (Cargo.toml + npm)
- [x] 实现 `read-clipboard` Tauri Command (commands/clipboard.rs)
- [x] 在 lib.rs 注册 Ctrl+Shift+X 快捷键 (独立于主窗口快捷键)
- [x] 创建 "quick-lookup" 窗口（480x400, 无边框, 置顶, 居中, skip_taskbar）
- [x] 更新 capabilities 和 permissions (default.json + read-clipboard.toml)
- [x] 更新 AppConfig 添加 quick_lookup_shortcut 字段
- [x] 添加窗口失焦自动隐藏
- [x] 添加托盘菜单"快捷查词"选项
- [x] 添加 quick-lookup-activated 事件通知前端
- **Status:** complete

### Phase 4: Frontend Implementation

- [x] 创建 `/quick-lookup` 页面路由 (layout.tsx + page.tsx)
- [x] 实现 QuickLookup 主组件（输入框 + 结果展示 + 操作按钮）
- [x] 实现剪贴板自动检测和英语单词/短语判断逻辑
- [x] 实现查词 API 调用
- [x] 实现操作按钮逻辑（入库、入库并置顶、置顶、加入分组）
- [x] 样式设计（紧凑、深色主题、状态徽章、分组选择器）
- **Status:** complete

### Phase 5: API Enhancement

- [x] 创建 `/api/quick-lookup` API 路由（整合查询+状态+操作信息）
- [x] 创建 `/api/quick-lookup-action` API 路由（入库、置顶、分组操作）
- [x] 确保所有操作在 Tauri 窗口内完成（无需打开主窗口）
- **Status:** complete

### Phase 6: Integration & Testing

- [ ] 端到端流程测试：复制 → 快捷键 → 自动粘贴 → 查询 → 操作
- [ ] 测试各种输入（单词、短语、非英语内容、空剪贴板）
- [ ] 测试窗口生命周期（显示、隐藏、焦点管理）
- [ ] 测试与主窗口的交互（操作后主窗口数据同步）
- **Status:** pending

## Decisions Made

| Decision | Rationale |
| ---------- | ----------- |
| 使用独立 Tauri 窗口而非 WebView 弹窗 | 独立窗口可置顶、可控制大小、不影响主窗口状态 |
| 新建 `/api/quick-lookup` + `/api/quick-lookup-action` API | 查询和操作分离，查询返回完整状态+可用操作，操作API执行具体动作 |
| Ctrl+Shift+X 作为默认快捷键 | 用户指定，不与现有 Super+Shift+V 冲突 |
| 前端路由 `/quick-lookup` | 独立页面，轻量级，快速加载 |
| 窗口无边框 + always_on_top + skip_taskbar | 类似 Spotlight/PowerToys Run 体验 |
| 使用 tauri-plugin-clipboard-manager | Tauri 官方插件，跨平台支持 |
| 复用现有 vocab-lookup/add-word/pin-word 逻辑 | 不重复造轮子，保持一致性 |
| 窗口失焦自动隐藏 | 类似 Spotlight 行为 |
| ESC 键隐藏窗口 | 标准快捷键行为 |
| quick-lookup-activated 事件 | 通知前端重新读取剪贴板 |

## Errors Encountered

| Error | Attempt | Resolution |
| ------- | --------- | ------------ |
| `read_text().await` - not a future | 1 | clipboard read_text() is sync, removed .await |
| `emit` method not found on WebviewWindow | 1 | Added `use tauri::Emitter` import |
| `other => other` borrow of temp value | 1 | Changed to owned String with `lower` variable |
| `quick_lookup_shortcut_str` moved value | 1 | Clone before move into closure |

## Notes

- 现有 Tauri 架构：Rust 后端 + Next.js 前端（通过 server_url 连接远程服务端）
- Quick Lookup 窗口与主窗口共享 WebView cookie 存储，认证自动透传
- 窗口在 Rust 端动态创建（不在 tauri.conf.json 中声明）
- 前端通过 `window.__TAURI_INTERNALS__` 调用 Tauri API
