# 变更日志

本文件记录本项目所有面向用户或发布相关的重要变化。

<!--
Release-facing changelog. 仅记录用户可见或与发布相关的变化。

规则：
- 使用版本级时间戳（## [version] - YYYY-MM-DD），不在此处记录每条提交的分钟级时间戳。
- 每个会话的操作记录归 SESSION_LOG.md 维护，不进入此文件。
- 发布时将 [Unreleased] 区块的内容迁移到带版本号的区块（例如 ## [1.1.0] - 2026-05-04）。
- 未使用的子区块（Removed、Security）可在为空时省略。
-->

## [Unreleased]

## [1.2.1] - 2026-07-15

### Added
- **拖拽文件上传安全化**: 底部控制栏拖拽文件上传支持将文件内容写入主进程受限临时目录后，由 Webview/CDP 加载上传，解决了依赖渲染进程 `File.path` 导致路径不支持的问题。

### Fixed
- **总结页面自定义提示词**: 修复总结页面 Webview 模式下，未正确使用 `webviewCustomPrompt` 变量导致用户自定义总结提示词失效的 bug。

## [1.2.0] - 2026-07-06

### Added
- **任务分配与辩论模式 (Task & Debate Modes)**: 支持水平任务拆解、独立槽位发送/控制、裁判评析汇总与对话流程自动流转。
- **对话历史持久化 (Modes History Persistence)**: 任务分配与辩论模式的执行轮次、中间回复和 slot URLs 会自动持久化，支持从历史记录完美复原界面状态。
- **网页图片原生下载 (Native Image Download)**: 支持一键下载 ChatGPT、双子座 (Gemini)、豆包等页面的生成图片，利用主进程 `will-download` 自动静默下载到本地。
- **历史记录分层存储与分页 (Tiered History Storage)**: 内存 Zustand store 中只缓存最新 100 条历史，磁盘端保留 1000 条，提供“加载更多”分页加载功能。
- **离线快照与 URL 不匹配检测 (ReadOnly Snapshots)**: 在网络爬取失败或 Webview URL 错配时，自动降级为只读快照层展示，并给用户清晰提醒。
- **版本更新提醒 (OTA Update Reminder)**: 设置面板显示当前版本并支持自动检测新版本，提供升级提示。

### Changed
- **快捷输入增强**: 重构 `Slate` 等 contenteditable 框架文本注入，改走派发 `paste` 事件机制，并增加 `insertText` 守卫，避免引起 Slate DOM 反复修改导致的白屏/崩溃。
- **自动化稳定性**: Perplexity 和 ChatGPT 深度研究/搜索模式按钮正则支持中文字符，并禁用 `wordBoundary` 以适配非英语单词。
- **Electron 架构回归**: 废弃实验性 `WebContentsView` 多重视口，回归使用经典的 `<webview>` 标签，完美解决 Windows 平台下的 z-index 遮挡和圆角裁剪残留白影问题。

### Fixed
- **十处内存泄漏审计与修复**: 解决 webview 实例被 ref 强引用不释放、重复绑定 IPC 监听器、cscript 僵尸进程未杀、临时文件（剪贴板解压等）未清理、流式 API reader 未 release 等十项内存/连接/进程泄漏点。
- **重开会话白屏/卡死修复**: 修复重置总结时 AbortController 泄漏问题；优化 reset 流程，先 abort 正在流式输出的 summary 再做 UI 重开，避免并发竞争。

## [1.1.0] - 2026-06-28
- **快捷键管理**: 快捷键管理模块与设置面板自定义配置。
- **快捷召唤与注入**: 剪贴板文本快捷召唤与自动注入快捷键 (MVP)。
- **状态同步**: 跨窗口 Zustand 状态同步广播。
- **托盘与防闭守卫**: 系统托盘与三项菜单，主窗关闭转隐藏与 `isQuitting` 退出守卫。
- **极简助手**: 极简助手页与 `#quick` 路由预加载。
