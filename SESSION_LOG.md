# Session Log

## 2026-07-16

### 23:23 | Antigravity

- done: 提交所有本地修改，清理冗余的 SummaryHistoryDrawer 历史抽屉组件
- removed:
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 22:56 | Codex

- done: 修复 MainPage 历史抽屉变量残留导致的 isHistoryOpen 未定义错误
- context: 用户 DevTools 报告 MainPage.tsx 中 isHistoryOpen 未定义；工作区含其他未提交改动，本次仅继续修复 MainPage。
- decision: 由 App.tsx 唯一渲染 HistoryDrawer，MainPage 通过 pendingHistoryRestore useEffect 调用原历史恢复逻辑。
- modified:
  - `src/renderer/src/pages/MainPage.tsx`
- lesson: 跨页提升共享 UI 后，必须同时移除原页面实例并把原回调接到 pending 状态消费点，不能只替换顶部状态变量。

### 22:50 | Codex

- done: 修复 MainPage 初始化错误与设置面板重复 React key
- context: 用户截图显示重复 key 2 与 MainPage models TDZ；工作区存在其他未提交修改，未触碰无关文件。
- decision: 提示词列表在主进程返回前去重，设置面板对提示词和总结模型再做防御性去重；MainPage 将局部 models 改名为 availableModels。
- modified:
  - `src/main/summaryPrompts.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
- lesson: React 列表数据来自可持久化文件或配置时，读取和渲染两侧都应按稳定业务 ID 去重；局部变量命名应避免与旧 HMR 代码产生歧义。

### 22:40 | Antigravity

- done: 修复总结页打开历史抽屉未正确弹出的Bug，将HistoryDrawer提升至App.tsx渲染
- decision: 在App.tsx层统一渲染HistoryDrawer解决隐藏主页面DOM导致总结页无法弹出抽屉的问题，通过store的pendingHistoryRestore跨页面触发MainPage的恢复逻辑
- modified:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/store/appStore.ts`

### 22:34 | Antigravity

- done: 总结页历史抽屉复用主页HistoryDrawer
- decision: 移除SummaryHistoryDrawer独立实例，改为在appStore增加historyInitialTab状态，Layout历史按钮根据currentPage设置初始Tab，HistoryDrawer支持initialTab prop，MainPage的HistoryDrawer去掉isActive限制全局可用
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/SummaryPage.tsx`
  - `src/renderer/src/components/Layout.tsx`

### 22:32 | Codex

- done: 恢复总结页 Webview 长文本自动 Markdown 上传功能；上传后仅注入附件分析指令，不自动发送
- decision: 保留 8000 字阈值、临时 Markdown、getFileInfo 与 uploadFile 链路；将上传后的 sendMessage 改为 insertText，上传失败仍降级为直接注入完整提示词
- modified:
  - `src/renderer/src/hooks/useWebviewSummary.ts`

### 22:27 | Codex

- done: 将本次及待处理的稳定调试经验提升到项目知识库，并把对应会话记录标记为 promoted。
- modified:
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 22:27 | Codex

- done: 同步总结页 Webview 注入状态注释与休眠判断，完成最终 lint/build 验证
- context: 前一条会话记录已记录主要逻辑改动；本条仅补充后续注释和休眠判断收口
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

### 22:27 | Codex

- done: 实现 ChatGPT Deep Research 跨域 OOPIF 报告提取：main 进程通过 CDP 子 target/session 读取报告 DOM，经受限 IPC 交给 renderer 转 Markdown；监控忽略空结果并将深度研究上限延长到 30 分钟。
- context: 深度研究报告位于 connector_openai_deep_research.web-sandbox.oaiusercontent.com 沙盒 iframe；页面下载和剪贴板路径不可依赖。用户决定自行完成桌面端验收。
- decision: 采用固定 main 层提取脚本和受限 webContentsId IPC，不向 renderer 暴露任意 CDP 脚本执行能力；普通 DOM 优先，仅 ChatGPT 深度研究空结果时节流回退。
- added:
  - `src/main/chatgptDeepResearchExtractor.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/store/appStore.ts`
- lesson(promoted): 跨域 OOPIF 不能从顶层 webview executeJavaScript 读取；必须附加目标 iframe 并在 Target.attachToTarget 返回的 child sessionId 上执行 Runtime.evaluate。
- lesson(promoted): 轮询抓取的空字符串代表尚未产出或读取失败，不能累计稳定次数并判定完成。
- unresolved: 需由用户在 npm run dev 桌面环境触发 ChatGPT Deep Research 总结链路，确认目标 target 可发现且报告 Markdown 完整。

### 22:26 | Codex

- done: 总结页 Webview 模式改为只注入总结提示词，不自动发送；完成 lint/build/dev 启动验证
- decision: 复用 WebviewCard.insertText 注入路径，移除总结页专用的自动发送、文件上传和回复轮询；由用户在右侧平台页面手动发送
- modified:
  - `src/renderer/src/hooks/useWebviewSummary.ts`
  - `src/renderer/src/components/SummaryPanel.tsx`
- unresolved: 未能在真实登录 Webview 中完成点击级手动验证：Computer Use 捕获 Electron 窗口时返回 SetIsBorderRequired 不支持此接口

### 22:21 | Antigravity

- done: 新增千问深度研究报告提取器（复制按钮法）
- added:
  - `src/renderer/src/utils/qwenReportExtractor.ts`
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 21:58 | Antigravity

- done: Change history button label text from 历史会话 to 历史
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 21:58 | Codex

- done: 修复 GPT 新建会话误打开临时会话：普通会话改用 chatgpt.com，并为总结页保留独立临时会话地址
- context: 工作区存在其他未提交改动；本次仅修改选择器契约、GPT 默认 URL和总结页取址逻辑
- decision: 拆分普通新会话 URL 与总结页隔离会话 URL，避免全局移除 temporary-chat 破坏总结页隔离行为
- modified:
  - `src/shared/config/selectors.ts`
  - `src/renderer/src/components/SummaryPanel.tsx`

### 21:56 | Antigravity

- done: Add text labels to settings and history buttons in the top status bar
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 21:53 | Codex

- done: 放开任务分配模式生成总结按钮的禁用条件
- context: 用户要求总结按钮任何情况下不因任务分配状态置灰；保留辩论模式裁判评析的结束态限制
- decision: ControlBar 仅保留 debateDisabled，移除 taskHasSent/taskDisabled 及对应的 disabled 和点击拦截路径
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 21:50 | Codex

- done: 修复任务分配模式恢复历史后的生成总结按钮禁用状态，并让任务分配历史标题使用原始总目标
- context: 恢复历史切换产品模式时 setProductMode 会清空 currentConversationId；任务分配发送历史 userMessage 包含带 slot 前缀的完整子任务提示
- decision: 历史恢复完成模式切换后重新写回 isNewSession、activeModels 和 currentConversationId；beginConversation 增加可选 title，仅任务分配新会话传入原始总目标
- modified:
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
- lesson(promoted): 恢复历史时若产品模式切换会重置会话锚点，必须在模式恢复完成后重新设置 isNewSession、activeModels 和 currentConversationId。
- unresolved: 桌面 UI 点击验证因已有 Electron 窗口最小化且物理 Esc 中断，未完成交互复现。

### 21:40 | Codex

- done: 修正右键粘贴失效：宿主窗口恢复焦点后向目标 WebView 发送跨平台原生 Ctrl/Cmd+V
- context: 用户反馈 target.paste 在所有窗口无效；依据 Electron 类型定义中 sendInputEvent 需要宿主 BrowserWindow 聚焦，改为 focusedWindow.focus + target.focus + 平台快捷键事件；npm run lint/build 通过
- decision: Windows/Linux 使用 Control+V，macOS 使用 Command+V；不恢复 DOM value 注入，避免千问受控输入伪文字
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/Layout.tsx`
- unresolved: 需在桌面观察接口可用时实际验证千问及其他 WebView 的右键粘贴、退格删除与光标替换

### 21:35 | Codex

- done: 修复右键 WebView 粘贴：改用目标 WebContents 原生 paste，避免千问 React 受控输入出现伪文字
- context: npm run lint 与 npm run build 通过；开发版窗口已发现，但桌面观察接口返回 SetIsBorderRequired 不支持接口 (0x80004002)，未执行 UI 输入验证
- decision: 右键粘贴不再读取剪贴板后注入 activeEl.value，统一调用 target.focus() + target.paste()，兼容 Windows/macOS/Linux
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/Layout.tsx`
- unresolved: 需要在可用的桌面观察环境中实际验证千问右键粘贴后退格/删除与光标位置

## 2026-07-15

### 23:40 | Antigravity

- done: Bump version to 1.2.1 and update CHANGELOG.md
- modified:
  - `package.json package-lock.json CHANGELOG.md`

### 23:32 | Antigravity

- done: Remove expressions of '总结 Agent' and the word 'Agent' from documentation files
- modified:
  - `README.md`
  - `docs/USER_GUIDE.md`
  - `docs/API_CONFIG_GUIDE.md`
  - `docs/ModelMashPRD 3 simple.md`
  - `docs/总结模块提示词架构方案.md`
  - `docs/settings-config-design.md`
  - `docs/CLI_FEASIBILITY_ASSESSMENT.md`

### 23:19 | codex

- done: Fixed the summary-page webview prompt bug and promoted the triggered reusable lessons into long-term knowledge.
- context: The webview summary prompt was reading the wrong composer state; memory promotion was required after session_log surfaced stable lesson candidates.
- decision: Keep the functional fix minimal, then update knowledge/session markers to preserve reuse for future debugging.
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx .memory/KNOWLEDGE.md .memory/sessions/2026-07-06.md .memory/sessions/2026-07-05.md`

### 23:18 | Codex

- done: 修复底部对话框拖拽文件上传依赖 renderer File.path 导致路径不支持的问题：拖拽内容经 IPC 写入主进程临时文件后复用上传链路，并在完成后清理
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/ControlBar.tsx`
- lesson(promoted): 拖拽上传不要直接信任 renderer File.path；应将文件内容写入主进程受限临时目录后再交给 Webview/CDP。

### 23:17 | codex

- done: Fixed summary-page webview prompt assembly so the user's extra requirement is taken from the webview composer state and included in the prompt sent to the webview summary flow.
- context: The bug was in the webview summary path, not the API summary path: buildWebviewPrompt was reading customPrompt from the API flow instead of webviewCustomPrompt.
- decision: Keep the fix minimal and local to SummaryPanel so API summary behavior remains unchanged.
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

## 2026-07-11

### 14:09 | Codex

- done: Completed_macos_followup_gaps_for_selection_toolbar_packaging_and_unsigned_release
- decision: Use_macos_System_Events_accessibility_reading_without_a_new_production_dependency_and_keep_unsigned_release_explicit
- added:
  - `build/generate-mac-assets.sh`
  - `build/MACOS_FIRST_OPEN.md`
  - `scripts/generate-release-checksums.js`
- modified:
  - `src/main/platform/selectionReader.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/assets/index.css`
  - `electron-builder.yml`
  - `package.json`
  - `build/multichat-cli.sh`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/client.ts`
  - `.gitignore`
- unresolved: Validate_on_clean_Intel_and_Apple_Silicon_macs

### 13:52 | Codex

- done: macOS-plan-execution
- added:
  - `src/main/platform/selectionReader.ts`
- modified:
  - `electron-builder.yml`
  - `scripts/verify-titlebar-drag-contract.js`
  - `src/cli/client.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/main/index.ts`
  - `src/main/inputHookManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/env.d.ts`
- lesson(promoted): macOS-selection-must-not-invoke-Windows-PowerShell-UIA

### 13:42 | Codex

- done: Removed_nonfunctional_macos_titlebar_status_indicator_from_plan
- decision: Keep_macos_titlebar_right_side_limited_to_history_and_settings
- modified:
  - `docs/MACOS_DEVELOPMENT_PLAN.md`

### 13:26 | Codex

- done: Saved_macOS_adaptation_and_unsigned_release_plan
- decision: Unsigned_DMG_validation_phase_with_documented_Gatekeeper_confirmation_and_integrity_checks
- added:
  - `docs/MACOS_DEVELOPMENT_PLAN.md`
- unresolved: Implement_and_validate_on_Intel_and_Apple_Silicon

