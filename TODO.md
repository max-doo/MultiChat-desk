# 待办事项

<!--此文件用于跟踪已完成的工作和会话之间的待处理任务。每天工作结束后更新。-->

## 进行中

- [-] 无

## 已完成

### 2026-05-03

- [x] 修复 #1: 删除 API 供应商时同步移除其下的总结模型 (`SettingsDrawer.tsx`)
- [x] 修复 #3: 恢复历史记录后保持保护状态，防止 reportData 覆盖历史模型回复 (`SummaryPage.tsx`)
- [x] 修复 #9: 导出文件时若用户删除后缀名自动补回 .md (`ipcHandlers.ts`)
- [x] 修复 #10: 更新历史记录时保留用户重命名的标题 (`useSummaryPanel.ts`)
- [x] 修复 #11: 文件上传成功后不再因 DOM 未检测到文件名而误报失败 (`WebviewCard.tsx`)
- [x] 修复 #13: 多行文本注入时因 trim() 导致首尾换行被误报为输入失败 (`webviewScripts.ts`)
- [x] 修复 #16: 首次生成总结时快照 modelResponses，避免新对话输出覆盖历史总结 (`useSummaryPanel.ts`)
- [x] 修复 #17: 为 ChatGPT 添加 reportContainer 选择器，修复 Deep Research 输出无法提取 (`selectors.ts`)
- [x] 新增 #4: 总结重新生成时支持修改用户要求后再生成 (`useSummaryPanel.ts`, `SummaryPanel.tsx`)
- [x] 新增 #5: 历史记录列表中高亮当前打开的历史项 (`HistoryDrawer.tsx`, `SummaryHistoryDrawer.tsx`)
- [x] 新增 #6: 首次总结成功后异步调用 AI 生成历史记录标题 (`useSummaryPanel.ts`)
- [x] 新增 #7: Webview 顶部工具栏增加新建对话按钮 (`WebviewCard.tsx`)
- [x] 新增 #12: 设置面板增加缓存数据导出功能，API Key 自动脱敏 (`ipcHandlers.ts`, `SettingsDrawer.tsx`)
- [x] 新增 #15: 支持从剪贴板直接粘贴图片并上传到各模型 (`ControlBar.tsx`, `ipcHandlers.ts`)

## 待处理

- [ ] 无
