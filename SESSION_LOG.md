# Session Log

## 2026-09-22

### 10:43 | Codex

- done: 修正 Webview 右键菜单所属窗口定位，兼容快捷窗口
- modified:
  - `src/main/webviewManager.ts`

### 10:43 | Codex

- done: 恢复 Webview 原生右键菜单并支持复制粘贴、复制图片和图片另存为
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`

### 10:33 | Codex

- done: 修复带 utm_source=chatgpt.com 的 ChatGPT 来源引用外链被误判为站内链接的问题；注入脚本按 URL origin 识别外链并保留完整查询参数，沿用此前弹窗兜底处理
- context: 实际注入脚本模拟 GitHub/Reddit 引用点击通过；Electron 42 控制台消息事件实测保留 legacy message 参数；npm run lint 0 错误 42 条现有 warning；npm run build 通过；npm run dev 启动
- modified:
  - `src/main/webviewManager.ts`
- unresolved: 在已登录 ChatGPT 页面实际点击带 utm_source 的来源引用，确认系统默认浏览器打开链接

### 10:26 | Codex

- done: 修复 ChatGPT 来源引用等 Webview 外链弹窗未打开系统浏览器的问题；非认证 HTTP/HTTPS 链接复用 openBrowserWindowInternal 打开默认浏览器
- context: npm run lint 通过（42 条现有 warning）；npm run build 通过；npm run dev 成功启动，未在已登录 ChatGPT 页面手动点击来源链接
- modified:
  - `src/main/webviewManager.ts`
- unresolved: 在已登录 ChatGPT 页面点击来源引用，确认默认浏览器打开目标网址

### 10:11 | Codex

- done: 清理已删除总结专用地址字段的旧注释
- modified:
  - `src/shared/config/selectors.ts`

### 10:11 | Codex

- done: 修复 ChatGPT 总结页每次打开临时会话：删除 temporary-chat 专用 URL，改用普通新对话地址
- modified:
  - `src/shared/config/selectors.ts`
  - `src/renderer/src/components/SummaryPanel.tsx`

### 10:06 | Codex

- done: 补齐 Webview 总结历史字段及任务分配 IPC 类型并完成最终验证
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/types/summary.ts`
  - `src/renderer/src/env.d.ts`

### 10:04 | Codex

- done: 移除总结页 API 模式及其专用 IPC、流式生成和报告导出代码；保留 Webview 总结及任务分配 API
- modified:
  - `src/main/api/taskSplitApi.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `src/renderer/src/pages/SummaryPage.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/types/summary.ts`
- removed:
  - `src/main/api/summaryApi.ts`
  - `src/renderer/src/hooks/useSummaryPanel.ts`

