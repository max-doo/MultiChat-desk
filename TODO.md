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
- [ ] macOS UI 适配与包验收：根据主窗口标题栏防重叠计划完成 UI 改造，并落实 macOS 安装包的验证与验收方案（解决无 Mac 物理设备时的打包测试痛点）
- [ ] Electron OTA 自动更新：实施计划见 `docs/superpowers/plans/2026-05-04-electron-ota.md`，设计见 `docs/superpowers/specs/2026-05-04-electron-ota-design.md`（NSIS 安装版 + GitHub Releases + Settings Drawer 内交互，便携版/macOS 优雅降级）
- [x] 桌面端快捷访问特性：实施计划见 `docs/superpowers/plans/2026-05-04-desktop-quick-access-plan.md`（7 个 Task，零 C++ 依赖，含完整 IPC 通道清单与 lint/build/dev 验证清单）
  - [x] Task 1-2：系统托盘 + 主窗关闭转隐藏（关闭主页面后常驻系统托盘，托盘菜单"显示主界面/召唤快捷弹窗/退出"）
  - [x] Task 3-4：全局快捷键 `Ctrl+Shift+Space` 召唤无边框 Quick Window，新增 `#quick` hash 路由复用 `WebviewCard`，共享 `persist:shared` Session
  - [x] Task 5：主窗 ↔ Quick Window 跨窗口状态广播（`models` / `apiConfig` 同步，主进程 `stateBus` + Zustand `subscribe`，`isApplyingRemote` 防回环）
  - [x] Task 6：剪贴板召唤 MVP —— `Ctrl+Shift+C` 读 `clipboard.readText()` 注入 Quick Window 当前 WebviewCard 输入框（不自动发送，用户校对后手动发）
  - [x] Task 7：`shortcutManager` + `SettingsDrawer` "快捷键与系统托盘"分组（自定义召唤键，持久化到 electron-store，注册失败回滚旧值）
- [x] 全局划词悬浮 Toolbar（**已实现**）：已通过 monio-napi + UI Automation 实现划词弹出工具条，支持"问问"/搜索/总结/翻译/复制等动作，详见 SESSION_LOG 2026-06-27 12:54 ~ 06-28 17:18 多条记录
- [x] **调研划词弹出工具条**（**已实现**）：调研已完成，实现方案已落地——采用 monio-napi 全局鼠标钩子 + UI Automation 读取选区 + 无焦点悬浮窗口，已覆盖 Word/Chrome/WindowsTerminal 等场景
- [x] **任务分配模式（task_assignment）已实现**：UI + 交互已落地（`TaskModePanel.tsx` + `SubtaskList.tsx` + `useTaskSplit.ts` + `split-task` IPC + `taskSplitApi.ts`），输入总目标 → 拆解 → 上拉可编辑子任务列表 → 一键发送，复用总结 API 供应商。详见 `docs/superpowers/plans/2026-07-01-task-assignment-and-debate-modes.md`。剩余 follow-up：
  - [ ] 任务/辩论发送绕过 `sendMessageToAll`/`addHistory`：`TaskModePanel.handleSend` 与 `useDebateRunner` 直接调 `webviewRefs.get('slot-N').sendMessage`，不经 store 的 `sendMessageToAll`，导致这两种模式的发送不写入历史记录。需补历史落盘（或在 store 增加单槽位发送的 history 钩子）
  - [ ] **TaskSplitModal 拆解失败弹窗 dev 验收**：拆解失败恢复弹窗已落地（commit `a751132`，基于 plan `docs/superpowers/plans/2026-07-02-task-split-modal.md`），lint/build/dev 启动通过，但 7 个 GUI 交互场景待 `npm run dev` 手动验证：
    - [ ] 未配置供应商路径：禁用所有供应商 → 拆解 → 弹窗提示未配置，"管理供应商…"能打开设置抽屉，"拆解"按钮禁用
    - [ ] 选模型 + 重试成功：弹窗内选供应商+模型 → 拆解 → 成功后弹窗关闭、ControlBar 出现 inline 子任务列表、通知"拆解完成"
    - [ ] Key 错误重试：配无效 Key 供应商 → 拆解 → 弹窗显示错误（如 `拆解请求失败 (401)`）→ 改正确模型重试成功
    - [ ] 槽位对齐 webview：分解后子任务按当前 webview 数量(`displayMode`)轮询指派、SubtaskList 的 cycle 按钮只在槽位模型间切；改 `displayMode`（如 3→4 窗口）后重新分解槽位数随之变
    - [ ] 中止与 Esc：弹窗内拆解开始 loading → 按 Esc/点关闭/取消 → 触发 abort、loading 结束、弹窗关闭、不残留"拆解中…"
    - [ ] happy path 不回归：正常供应商+Key → 拆解 → 不弹窗、inline 子任务出现、一键发送正常分发
    - [ ] 上拉面板定位：弹窗以 toolbar 上拉面板形式悬浮在输入框上方居中（非屏幕居中模态），分解失败弹窗无槽位区（槽位编辑在 SubtaskList）
  - [ ] ⚠️ `clean:store` 验证后需重新配置供应商/Key 再继续后续步骤
- [x] **辩论模式（debate）已实现**：UI + 交互已落地（`DebateModePanel.tsx` + `useDebateRunner.ts` + `appStore.debateState` 状态机 + `swapModelInSlot` debate 分支 + `Layout` 进行中禁模式切换），左正方/右反方固定双窗、轮次 stepper、全自动轮转、裁判评析总结。详见同上 plan。剩余 follow-up：
  - [ ] `debateSlots`/`debateTotalRounds` 未持久化：重启后回到默认值（`['chatgpt','gemini']` / `3`），需补 `window.api.storeSet`
  - [ ] `getResponseFromSlot` 轮询可靠性因平台而异：辩论发言回传依赖 `WebviewCardRef.getLatestResponse()` 轮询等稳定，不同平台回复抓取稳定性不一，超时取空时会写入「（无回复）」。需在 `selectors.ts` 增量补强不稳平台的回复选择器
  - [ ] 辩论进行中模式切换加固：`Layout.tsx` 已做 `debateState.phase==='running'||'paused'` 时禁用模式 seg 的可选加固，需在 `npm run dev` 中验证切换确实被阻断、会话不丢失
- [ ] **CLI 待进一步验收**：daemon 通信正常，但选择器大量过期（豆包 collect 返回空、ChatGPT/DeepSeek 输入框选择器过期），需逐平台验证并修正 `selectors.ts`
- [ ] **CLI exec 命令改进**：当前 `exec` 发送提示词后立即返回，需再手动 `collect` 取结果。期望行为：发送提示词后终端挂起，轮询等待 AI 回复完成，流式输出或完成后返回完整结果，而非分两步操作
- [ ] **注入 DOM 选择器全面更新**：当前 `selectors.ts` 中各平台注入 DOM 选择器大量失效（网站改版导致），需逐平台验证并修正。同时探索让 Agent 自动读取网页原始 DOM 并自行更新选择器的自动化方案——例如通过 MCP/脚本抓取各平台实际 DOM 结构，由 Agent 分析并生成修正后的选择器配置，减少手动维护成本
- [ ] **DOM选择器鲁棒性提升**：详见 `docs\superpowers\plans\2026-06-28-resilient-webview-automation.md`
- [x] **项目改名 MultiChat**：将项目从 "MultiChat Desk" 更名为 "MultiChat"，同步更新所有相关命名（package.json、窗口标题、文档、构建产物名等）
- [x] **CLI Daemon 基础架构**（**已实现**）：Named Pipe 通信、SessionManager、AutomationService、CLI Client（`daemon status/exec/collect`）已落地，详见 SESSION_LOG 2026-06-28 多条记录。剩余工作：选择器更新、exec 挂起轮询改进（见上方 CLI 相关 TODO）
- [ ] **`updatePlatformAnswer` 设计意图核实**：该 store action（`appStore.ts`）在整个 `src/` 中无任何调用方（仅类型声明 + 定义），疑似漏接网络流式推送回调。当前监控内容流全靠 `pollPlatforms` 每 3s 轮询爬 DOM。若未来需要实时（非轮询）落盘流式内容，需另立项核实其是否本应被 webview 注入脚本 / IPC 回调接入，并补接入点；否则考虑移除该死代码。来源：2026-07-02 会话轮询保存去重任务（plan：`docs/superpowers/plans/2026-07-01-history-polling-save-dedup.md`）
- [ ] **会话轮询去重 dev 验收**：`appStore.ts` 轮询保存去重已实施（commit `9975d25`，lint/build 通过），但未在 `npm run dev` 中手动验收。最小等价检查：发消息触发监控，观察 `%APPDATA%\MultiChat Desk-dev\config-dev.json` 的 `history` 字段写盘频率——稳定等待期（内容不变约 9s）应不再每 3s 写一次；并验证三个停止出口（全部完成 / 超时 5 分钟 / 新消息重置）终态完整不丢数据

## 已完成

### 2026-06-28

- [x] CLI Daemon 基础架构（Tasks 1-5）：SessionManager（后台 BrowserWindow 会话管理）、AutomationService（主进程自动化执行内核）、Named Pipe Server（`\\.\pipe\multichat-daemon`）、CLI Client（`daemon status/exec/collect`）、IPC Bridge（main↔renderer 通信桥梁）
- [x] 划词悬浮 Toolbar 完整体验：monio-napi 全局鼠标钩子 + UI Automation 选区读取 + 无焦点悬浮 ToolbarWindow，支持"问问"/搜索/总结/翻译/复制等动作
- [x] 全局快捷键设置 UX 重构：ShortcutRecorder 交互式捕获录制组件，按键徽章展示、一键清空与重置默认值
- [x] 修复 electron-builder Windows 打包失败（winCodeSign 符号链接需开发者模式）

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
