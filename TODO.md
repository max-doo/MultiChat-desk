# 待办事项

<!--
项目级 backlog，用于记录重要的待办和已完成事项。
由用户授权、AI 辅助维护。Agent 可在用户同意或明确请求后建议更新和编辑此文件。
-->

## 待完成

- [ ] AI 生图一键下载：支持在 AI 生图模式下点击底部“一键下载”按钮，从各 Webview 中抓取并批量下载最新生成图片的功能实现
- [ ] AI 生图 DOM 适配：`selectors.ts` 中各平台 `imageGeneration` 选择器基于推测，需在 `npm run dev` 中逐一打开各平台 webview 验证实际 DOM 结构并修正（chatgpt/gemini/grok/qwen/kimi/doubao/yuanbao/chatglm/yiyan）
- [ ] arena.ai DOM 适配：在 `npm run dev` 中打开 arena webview，验证输入框/发送按钮/消息容器选择器是否匹配实际 DOM 结构并修正 (`selectors.ts`)
- [ ] Webview 总结自适应传输：在 `npm run dev` 中手动验证短文本直接粘贴和长文本文件上传两种模式
- [ ] Webview 总结 composer 重构待验收：`SummaryPanel.tsx` Webview 模式右栏改为 WebviewCard 全高 + 底部单行 composer + 首发后锁定。lint/build 已通过，需在 `npm run dev` 中按 spec 验收清单 13 项手动验证（spec：`docs/superpowers/specs/2026-05-04-summary-page-webview-composer-redesign.md`，plan：`docs/superpowers/plans/2026-05-04-summary-page-webview-composer-redesign.md`）：
  - [ ] 进入总结页 Webview 模式：右栏只剩 WebviewCard + 底部单行 composer，无顶部模式行/textarea/底部状态行
  - [ ] textarea 默认 1 行高度，输入多行向上撑高至最多 5 行（120px）后出现内部滚动
  - [ ] Enter 发送、Shift+Enter 换行
  - [ ] 点发送后 composer 立刻 disabled（透明度 60%）、textarea/模式 pill/发送按钮全部 disabled
  - [ ] 流式完成后 composer 仍 disabled，placeholder 切到「已发送，请在右侧对话窗口继续追问」
  - [ ] 在 WebView 自带输入框可正常追问
  - [ ] 返回主页再进入总结页：composer 重新 enabled，placeholder 恢复
  - [ ] 切到 API 模式：右栏与改动前完全一致（顶部供应商/模型工具条 + 双行 composer）
  - [ ] 切回 Webview 模式：新布局立即出现
  - [ ] 左栏模型输出卡片视觉无变化
- [ ] macOS 打包：在 macOS 系统上运行 `npm run build:mac` 验证 DMG 产物
- [ ] macOS 打包：配置 Apple Developer ID 签名与公证（Notarization），正式分发必需
- [ ] Electron OTA 自动更新：实施计划见 `docs/superpowers/plans/2026-05-04-electron-ota.md`，设计见 `docs/superpowers/specs/2026-05-04-electron-ota-design.md`（NSIS 安装版 + GitHub Releases + Settings Drawer 内交互，便携版/macOS 优雅降级）
- [x] 桌面端快捷访问特性：实施计划见 `docs/superpowers/plans/2026-05-04-desktop-quick-access-plan.md`（7 个 Task，零 C++ 依赖，含完整 IPC 通道清单与 lint/build/dev 验证清单）
  - [x] Task 1-2：系统托盘 + 主窗关闭转隐藏（关闭主页面后常驻系统托盘，托盘菜单"显示主界面/召唤快捷弹窗/退出"）
  - [x] Task 3-4：全局快捷键 `Ctrl+Shift+Space` 召唤无边框 Quick Window，新增 `#quick` hash 路由复用 `WebviewCard`，共享 `persist:shared` Session
  - [x] Task 5：主窗 ↔ Quick Window 跨窗口状态广播（`models` / `apiConfig` 同步，主进程 `stateBus` + Zustand `subscribe`，`isApplyingRemote` 防回环）
  - [x] Task 6：剪贴板召唤 MVP —— `Ctrl+Shift+C` 读 `clipboard.readText()` 注入 Quick Window 当前 WebviewCard 输入框（不自动发送，用户校对后手动发）
  - [x] Task 7：`shortcutManager` + `SettingsDrawer` "快捷键与系统托盘"分组（自定义召唤键，持久化到 electron-store，注册失败回滚旧值）
- [ ] 全局划词悬浮 Toolbar（**推迟到独立计划**）：原需求"豆包式划词悬浮条"需引入 `uiohook-napi`（C++ 扩展）或平台 Accessibility API，跨平台编译/杀软误报/剪贴板备份恢复成本高。本期由"剪贴板召唤"（上面 Task 6）弱化版替代——用户先 `Ctrl+C` 再按 `Ctrl+Shift+C` 即可。后续若决定做悬浮条，新计划须包含 `uiohook-napi` 三平台编译验证、ToolbarWindow `focusable+ignoreMouseEvents` 设计、剪贴板备份恢复、macOS Accessibility 权限引导
- [ ] **调研划词弹出工具条**：调研是否可实现类似豆包（Doubao）的划词即弹出工具条功能——用户在任何应用中划选文本后，自动弹出悬浮工具条，通过工具条实现文本复制、注入到 MultiChat 并打开窗口。需调研：系统级划词事件监听方案（`uiohook-napi` / 平台 Accessibility API / 剪贴板轮询）、跨平台可行性、悬浮窗口实现方案、与现有快捷窗口的整合方式
- [ ] **注入 DOM 选择器全面更新**：当前 `selectors.ts` 中各平台注入 DOM 选择器大量失效（网站改版导致），需逐平台验证并修正。同时探索让 Agent 自动读取网页原始 DOM 并自行更新选择器的自动化方案——例如通过 MCP/脚本抓取各平台实际 DOM 结构，由 Agent 分析并生成修正后的选择器配置，减少手动维护成本
- [ ] **项目改名 MultiChat + CLI 开发**：将项目从 "MultiChat Desk" 更名为 "MultiChat"，同步更新所有相关命名（package.json、窗口标题、文档、构建产物名等）。同时启动 CLI 工具开发，提供命令行入口以支持脚本化操作、批量任务、CI/CD 集成等场景

## 已完成

### 2026-05-04

- [x] 重构总结页数据流：移除全局 `reportData`，改为一次性 `pendingSummarySession` 导航数据包，实现 API/webview 模式总结 session 的完全数据隔离 (`appStore.ts`, `MainPage.tsx`, `SummaryPage.tsx`, `SummaryPanel.tsx`, `useSummaryPanel.ts`)
  - [x] 修复：webview 模式下总结历史记录未保存对话 URL（`SummaryHistoryItem` 新增 `urls` 字段）
  - [x] 修复：新对话后总结页仍显示旧模型输出（`pendingSummarySession` 消费即销毁 + `history` fallback）
  - [x] **待验收**：在 `npm run dev` 中验证：主页面对话A -> 生成报告 -> 总结页显示对话A输出 -> 返回主界面 -> 对话B -> 生成报告 -> 总结页显示对话B输出（不应残留A的数据）
- [x] 修复：启动 Webview 空白问题（冷启动白屏，需 Ctrl+R）
  - [x] 修复 #F1（P0）：将 3s 强制 fallback 改为 10s 超时后显示错误界面
  - [x] 修复 #F2（P0）：合并 storedModels + geminiAccountUrl 更新为单次 setState
  - [x] 修复 #F3（P1）：将 `<webview src={url}>` 改为主动 `loadURL(url)` 导航，规避冷启动不触发导航

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
- [x] 补齐 macOS 打包配置：新增 `mac`/`dmg` 配置、entitlements、`.icns` 图标 (`electron-builder.yml`, `package.json`)
- [x] 新增：ControlBar 增加 AI 生图一键切换按钮，支持 9 个平台，复用 DeepResearch 注入脚本架构 (`selectors.ts`, `webviewScripts.ts`, `WebviewCard.tsx`, `appStore.ts`, `ControlBar.tsx`)
