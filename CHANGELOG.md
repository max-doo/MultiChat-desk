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

## 2026-06-28
- 00:10 | feat: src/main/shortcutManager.ts, src/main/index.ts, src/main/ipcHandlers.ts, src/preload/index.ts, src/renderer/src/components/SettingsDrawer.tsx - 快捷键管理模块与设置面板自定义配置
- 00:03 | feat: src/main/index.ts - 剪贴板文本召唤与自动注入快捷键 (MVP)
- 00:00 | feat: src/main/stateBus.ts, src/main/ipcHandlers.ts, src/preload/index.ts, src/renderer/src/store/appStore.ts - 跨窗口状态同步广播

## 2026-06-27
- 23:58 | feat: src/renderer/src/App.tsx, src/renderer/src/pages/QuickPage.tsx, src/renderer/src/store/appStore.ts - #quick 路由与 QuickPage 极简助手页
- 23:54 | feat: src/main/webviewManager.ts, src/main/index.ts, src/main/ipcHandlers.ts, src/preload/index.ts - 快捷弹窗预创建与全局召唤快捷键
- 23:51 | feat: src/main/webviewManager.ts, src/main/index.ts, src/main/ipcHandlers.ts, src/preload/index.ts - 系统托盘与三项菜单
- 23:48 | feat: src/main/webviewManager.ts, src/main/index.ts - 主窗关闭转隐藏与 isQuitting 退出守卫

### Added

### Changed

### Fixed

### Removed

### Security
