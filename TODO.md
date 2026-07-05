# 待办事项

<!--
项目级 backlog，用于记录重要的待办和已完成事项。
由用户授权、AI 辅助维护。Agent 可在用户同意或明确请求后建议更新和编辑此文件。
-->

## 待完成

- [ ] AI 生图一键下载：支持在 AI 生图模式下点击底部“一键下载”按钮，从各 Webview 中抓取并批量下载最新生成图片的功能实现
- [ ] AI 生图一键下载 Bug：当前一键下载图片对豆包、gemini、gpt、智谱不生效
- [ ] **Gemini 历史会话恢复失败（Gemini 网页 bug，待上游修复）**：点击历史项后 webview 加载目标 URL 但 UI 落在初始页、对话内容不渲染。根因经多轮诊断确认是 Gemini 网页自身行为——`loadURL(/app/<id>)` 这种 deep-link 加载方式不可靠（URL 导航正确但 conversation 内容不渲染），成功率纯随机，与时机/状态/重试无关；浏览器首次打开 `/app/<id>` 同样有概率失败；**只有点击 Gemini 网页内左侧栏历史 UI 才能可靠恢复**。代码层无法修复（非 MultiChat 逻辑错误）。已排除方案：①A 守卫跳过同 URL（只挡重复加载、挡不住 deep-link 冷加载）②B 检测+重试（纯随机，重试无效）③点侧栏历史自动化（依赖 Angular 内部 DOM、侧栏视口小时折叠历史项不在 DOM、旧历史不在侧栏列表，脆弱且覆盖不全，已弃）。诊断证据见记忆 `gemini-history-restore-fails`。**跟踪条件**：日后用浏览器直开 `https://gemini.google.com/app/<某id>` 若能稳定显示历史，说明 Gemini 已修，届时可恢复 `loadURL` 路径；否则保持现状。附带独立缺陷（非根因，可单独修）：`MainPage.tsx:937-948` 的 `/u/N/` 多账号前缀重写是死代码（`models[].url` 硬编码 `https://gemini.google.com/app`、`updateModel` 全 renderer 零调用），多账号防护实际未生效
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
  - [x] **TaskSplitModal 拆解失败弹窗代码已落地**（commit `a751132`，基于 plan `docs/superpowers/plans/2026-07-02-task-split-modal.md`）：拆解失败弹窗内可选拆解模型写回 `apiConfig`、可编辑槽位写回 `taskAssignmentSlots`、可重试；Esc/遮罩关闭显式中止；`useTaskSplit` error state 统一经返回值传递。lint/build/dev 启动通过。**7 个 GUI 交互场景待 `npm run dev` 手动验收**：
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
  - [x] `getResponseFromSlot` 轮询可靠性修复（**已实现**）：2026-07-02 重写为基线快照对比 + 连续稳定 3 次判定 + 超时 120s 返回空 + 空回复中止辩论（`appStore.ts` + `useDebateRunner.ts`），根除旧回复被误判为新回复导致没等真回复就发下一轮的问题。详见 `docs/superpowers/specs/2026-07-02-debate-reply-detection-design.md`
  - [ ] **辩论回复检测 dev 验收**：基线对比逻辑已落地（lint/build/dev 启动通过），但未在 `npm run dev` 中按场景手动验收：正常多轮辩论推进 / 空回复中止 / 超时中止 / 长回复稳定判定
  - [ ] 辩论进行中模式切换加固：`Layout.tsx` 已做 `debateState.phase==='running'||'paused'` 时禁用模式 seg 的可选加固，需在 `npm run dev` 中验证切换确实被阻断、会话不丢失
- [ ] **CLI 待进一步验收**：daemon 通信正常，但选择器大量过期（豆包 collect 返回空、ChatGPT/DeepSeek 输入框选择器过期），需逐平台验证并修正 `selectors.ts`
- [ ] **CLI exec 命令改进**：当前 `exec` 发送提示词后立即返回，需再手动 `collect` 取结果。期望行为：发送提示词后终端挂起，轮询等待 AI 回复完成，流式输出或完成后返回完整结果，而非分两步操作
- [ ] **注入 DOM 选择器全面更新**：当前 `selectors.ts` 中各平台注入 DOM 选择器大量失效（网站改版导致），需逐平台验证并修正。同时探索让 Agent 自动读取网页原始 DOM 并自行更新选择器的自动化方案——例如通过 MCP/脚本抓取各平台实际 DOM 结构，由 Agent 分析并生成修正后的选择器配置，减少手动维护成本
- [ ] **DOM选择器鲁棒性提升**：详见 `docs\superpowers\plans\2026-06-28-resilient-webview-automation.md`
- [x] **项目改名 MultiChat**：将项目从 "MultiChat Desk" 更名为 "MultiChat"，同步更新所有相关命名（package.json、窗口标题、文档、构建产物名等）
- [x] **CLI Daemon 基础架构**（**已实现**）：Named Pipe 通信、SessionManager、AutomationService、CLI Client（`daemon status/exec/collect`）已落地，详见 SESSION_LOG 2026-06-28 多条记录。剩余工作：选择器更新、exec 挂起轮询改进（见上方 CLI 相关 TODO）
- [ ] **ModalShell 统一与 SettingsDrawer 拆分**（计划已审核修正，待执行）：抽取通用 `ModalShell` 壳组件（双 variant `glass`/`solid` + Esc/遮罩关闭统一），把 6 个居中模态（3 settings 内嵌 + 3 独立）收敛到统一壳，并把 SettingsDrawer 内 3 个 Editor Modal 拆到 `components/settings/`，使 `SettingsDrawer.tsx` 从 1503 行降至约 600 行。纯表现层重构，不碰 main/preload/IPC/Store。计划：`docs/superpowers/plans/2026-07-05-modal-shell-unification.md`（10 个 Task，行号已校验为当前 1503 行版本、删除指令改为函数名锚定、`maxHeight`/`width` 支持字符串保留视口相对语义）。建议用 subagent-driven-development 逐 task 执行。
- [ ] **`updatePlatformAnswer` 设计意图核实**：该 store action（`appStore.ts`）在整个 `src/` 中无任何调用方（仅类型声明 + 定义），疑似漏接网络流式推送回调。当前监控内容流全靠 `pollPlatforms` 每 3s 轮询爬 DOM。若未来需要实时（非轮询）落盘流式内容，需另立项核实其是否本应被 webview 注入脚本 / IPC 回调接入，并补接入点；否则考虑移除该死代码。来源：2026-07-02 会话轮询保存去重任务（plan：`docs/superpowers/plans/2026-07-01-history-polling-save-dedup.md`）
- [ ] **会话轮询去重 dev 验收**：`appStore.ts` 轮询保存去重已实施（commit `9975d25`，lint/build 通过），但未在 `npm run dev` 中手动验收。最小等价检查：发消息触发监控，观察 `%APPDATA%\MultiChat Desk-dev\config-dev.json` 的 `history` 字段写盘频率——稳定等待期（内容不变约 9s）应不再每 3s 写一次；并验证三个停止出口（全部完成 / 超时 5 分钟 / 新消息重置）终态完整不丢数据
- [ ] **webview 智能休眠代码已落地，dev 验收未完成**（2026-07-02，commit 含 `69580a9`）：按休眠迁移评估计划 5 片段实施——WebviewCard suspend/resume+`isHibernated` 覆盖层（片段A）、MainPage 5min 调度器（片段B）、主窗 hide/show IPC 15min（片段B'）、SummaryPanel 10min 调度器（片段D，修正计划笔误：webview 在 SummaryPanel 非 SummaryPage）、QuickPage 5min 旧模型调度器（片段E）。真卸载页面层（`loadURL('about:blank')`）+ 唤醒重载草稿恢复，登录态靠 `persist:shared`。lint 0 errors / build 三 bundle 通过。**待 dev 手动验收**：
  - [ ] 12 种真值表 case（休眠白名单：当前活跃 slot / 回溯态 activeHistoryId / 总结页 webview 等跳过条件组合）
  - [ ] 5/10/15min 各场景延迟（可临时调小常量或控制台手动 suspend 触发）
  - [ ] 内存实测：4 webview 全休眠应降 200-400MB（任务管理器对比）
- [ ] **内存泄漏审核修复代码已落地，2 项 follow-up 未完成**（2026-07-02，worktree `memory-leak-fixes`）：覆盖 10 处——AbortController 覆盖前 abort / reader finally 释放 / onChunk `isDestroyed` 守卫 / paste 临时目录即时+启动清理 / VBS 兜底清理 / `registerWebviewHandlers` 幂等（WeakSet）/ loadMore 内存上限 100+游标 / `saveCurrentTurn` 写盘节流 / refCallbacks 旧键回收 / navigate setTimeout 清理。`#4 mountedWebviews` 按用户决定保留为有意取舍（会话连续性）。剩余：
  - [ ] #4 后续若需回收渲染进程：另起计划评估「新建会话时清空 mountedWebviews Set」方案
  - [ ] #10 history 写路径架构问题：`storeSet('history', inMemory100)` 整数组覆写磁盘，稳态下磁盘也仅 ≤100 条，与分层存储设计（磁盘 1000）矛盾、`loadMore` 稳态拉不到老数据。需改造写路径让磁盘保留全量 + 内存只覆写热区（属分层存储后续工作）

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
