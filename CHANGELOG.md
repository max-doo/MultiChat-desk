# 变更日志

<!--此文件在每次对话结束后更新。每条记录精确到分钟级时间戳。-->

## 2026-05-03

- 17:39 | feat: src/main/ipcHandlers.ts, src/preload/index.ts, src/renderer/src/components/SettingsDrawer.tsx - 新增缓存数据导出功能：在设置面板导出所有应用配置和历史记录为 JSON，API Key 自动脱敏
- 17:39 | feat: src/renderer - 总结页面新增 Webview 模式（保留 API 模式），可选 11 个平台之一直接在面板内嵌 webview 完成总结
- 19:20 | fix: src/renderer/src/components/SettingsDrawer.tsx:651 - 删除供应商时同步移除其下的总结模型
- 19:20 | fix: src/renderer/src/pages/SummaryPage.tsx:148 - 恢复历史记录后保持 isRestoringHistory，防止 reportData 覆盖历史模型回复
- 19:20 | fix: src/renderer/src/hooks/useSummaryPanel.ts:77 - 更新历史记录时保留用户重命名的标题
- 19:20 | fix: src/main/ipcHandlers.ts:530 - 导出文件时若用户删除后缀名自动补回 .md
- 20:15 | fix: src/renderer/src/components/WebviewCard.tsx:327 - 文件上传成功后不再因 DOM 未检测到文件名而误报失败，信任 debugger API 的拖拽结果
- 20:30 | fix: src/renderer/src/utils/webviewScripts.ts:975 - 修复多行文本注入时因 trim() 导致首尾换行被误报为输入失败的问题
- 20:45 | fix: src/renderer/src/config/selectors.ts:78 - 为 ChatGPT 添加 reportContainer 选择器，修复 Deep Research 输出无法被提取的问题
- 21:00 | feat: src/renderer/src/components/WebviewCard.tsx:564 - 在 webview 工具栏新增"新对话"按钮，导航至平台对应的 newConversationUrl
- 21:15 | feat: src/renderer/src/components/HistoryDrawer.tsx, SummaryHistoryDrawer.tsx - 为历史记录抽屉添加 activeHistoryId 高亮，当前打开项显示左侧主色指示条和背景色差异
- 21:30 | fix: src/renderer/src/hooks/useSummaryPanel.ts:45 - 新增 capturedModelResponses 快照状态，首次生成总结时捕获 modelResponses，后续重新生成和持久化均使用快照，避免新对话的模型输出覆盖历史总结中的模型输出
- 22:00 | feat: src/renderer/src/hooks/useSummaryPanel.ts - 首次总结成功后异步调用 AI 生成中文标题（temperature=0.3, maxTokens=50），替代原有的截断消息标题；失败时静默回退到默认标题
- 22:15 | feat: src/renderer/src/hooks/useSummaryPanel.ts, SummaryPanel.tsx - 重新生成总结时支持编辑用户要求：点击重新生成按钮后显示内联输入框，预填原始要求，用户可修改后确认或取消
- 22:45 | feat: src/main/ipcHandlers.ts, src/preload/index.ts, src/renderer/src/components/ControlBar.tsx - 支持从剪贴板直接粘贴图片：监听全局 paste 事件，检测图片类型后通过主进程读取剪贴板图片并保存为临时文件，触发现有文件上传流程分发到所有 webview
## 格式

## YYYY-MM-DD

- HH:MM | 修改: [文件] - 描述；新增: [文件] - 描述
- HH:MM | 新增: [文件] - 描述
- HH:MM | 修复: - 描述
- HH:MM | 待解决: - 描述
