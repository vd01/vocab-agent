# Findings & Decisions

## Requirements

- 用户在 PC 任何软件上复制单词/短语
- 快捷键 Ctrl+Shift+X 打开 Vocab-Agent Tauri 客户端的快捷输入窗口
- 自动判断剪贴板内容是否为英语单词或短语，是的话自动粘贴到输入框
- 按回车键出现查询结果：单词解释、入库状态、学习状态
- 根据单词状态提供下一步操作按钮：入库、加入日常学习、加入日常学习并置顶、加入置顶或新建分组

## Research Findings

### 现有 Tauri 架构

- **Tauri 2.x** (v2.11.3)，已配置全局快捷键、通知、自启动插件
- **主窗口** "main"：1200x800，可隐藏到托盘，连接远程 Next.js 服务端
- **全局快捷键**：当前 Super+Shift+V 切换主窗口显示/隐藏
- **配置存储**：AppStore (config.json)，存储 server_url、shortcut、close_to_tray 等
- **托盘菜单**：显示/隐藏、复习提醒、设置、退出

### 现有 API 能力

- **vocab-lookup 工具**：先查用户词库，未找到则查 ECDICT + 在线词典，返回完整信息
- **add-word 工具**：添加单词到词库 + 初始化 FSRS 卡片 + 分配到分组
- **pin-word 工具**：置顶单词到侧边栏，不在词库则自动添加
- **group-manage 工具**：创建/列出/重命名/删除分组，添加/移除单词
- **dict-lookup 工具**：纯词典查询，不涉及用户词库

### 剪贴板方案

- **tauri-plugin-clipboard-manager**：Tauri 官方插件，支持读取/写入/监听剪贴板
- 需要在 Cargo.toml 添加依赖
- 需要在 capabilities 中添加权限
- 前端通过 `@tauri-apps/plugin-clipboard-manager` JS 包调用

### 英语单词/短语判断逻辑

- 正则匹配：`/^[a-zA-Z]+(?:\s+[a-zA-Z]+){0,5}$/`（1-6个英文单词）
- 过滤纯数字、URL、代码片段等
- 长度限制：1-100 字符
- 可选：检查是否包含常见英语单词模式

### 窗口设计参考

- **macOS Spotlight**：居中浮窗，毛玻璃背景，输入框在上结果在下
- **PowerToys Run**：类似 Spotlight 的 Windows 实现
- **Bob (macOS)**：划词翻译工具，小窗口显示翻译结果
- 建议尺寸：宽 480px，高度自适应（最大 600px）
- 无边框 + 圆角 + 半透明背景

## Technical Decisions

| Decision | Rationale |
| ---------- | ----------- |
| 独立 Tauri 窗口 "quick-lookup" | 可独立控制大小、位置、置顶、生命周期 |
| 新建 `/api/quick-lookup` API | 整合查询+状态+操作，一次请求返回所有信息 |
| Ctrl+Shift+X 独立注册快捷键 | 不影响现有 Super+Shift+V 主窗口切换 |
| 前端路由 `/quick-lookup` | 独立页面，轻量，快速加载 |
| 窗口无边框 + decorations: false | 类似 Spotlight 体验 |
| always_on_top: true | 确保在其他窗口之上 |
| skip_taskbar: true | 不在任务栏显示 |
| 使用 tauri-plugin-clipboard-manager | 官方插件，跨平台，支持文本读取 |
| 窗口失焦自动隐藏 | 类似 Spotlight 行为，点击外部自动关闭 |
| ESC 键关闭窗口 | 标准快捷键行为 |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Tauri 客户端连接远程服务端，Quick Lookup 需要直接调 API | 使用 server_url 配置，前端直接 fetch 远程 API |
| 认证 cookie 需要透传 | Tauri WebView 共享 cookie 存储，主窗口登录后 Quick Lookup 窗口也能访问 |

## Resources

- Tauri 多窗口文档: <https://v2.tauri.app/learn/multiwindow/>
- tauri-plugin-clipboard-manager: <https://v2.tauri.app/plugin/clipboard/>
- tauri-plugin-global-shortcut: <https://v2.tauri.app/plugin/global-shortcut/>
- 现有代码: src-tauri/src/lib.rs, src-tauri/src/store.rs, src-tauri/src/tray.rs
- 现有工具: src/lib/ai/tools/vocab-lookup.ts, add-word.ts, pin-word.ts, group-manage.ts

## Visual/Browser Findings

- 现有 Tauri 窗口配置在 tauri.conf.json 的 app.windows 数组中
- 现有全局快捷键在 lib.rs setup 中注册，使用 tauri_plugin_global_shortcut
- 现有配置存储在 AppStore，支持 shortcut 字段自定义
