# Session Log

## 2026-07-05

### 19:34 | Antigravity

- done: 优化任务拆解提示词，强制模型仅按独立且并行的横向维度进行拆解，严禁拆解成有先后依赖的串行步骤
- modified:
  - `src/main/config/taskSplitPrompt.ts`

### 18:15 | Antigravity

- done: 为任务拆解按钮添加文字‘拆解任务’
- modified:
  - `src/renderer/src/components/modes/TaskModePanel.tsx`

### 18:11 | claude-code

- done: 二次审核 modes-history-persist 计划与最新代码的冲突：任务分配已重构为 handleInsert+handleConfirmSend 两步流程，重写 Task 3 挂载点到 handleConfirmSend，翻转 v2 的 twoPhase 结论
- context: 代码重构：TaskModePanel 单步 handleSend→两步 handleInsert(注入)/handleConfirmSend(发送)，TaskPhase 增 inserted，sendMessage 不再传 twoPhase
- modified:
  - `docs/superpowers/plans/2026-07-05-modes-history-persist.md`
- lesson(promoted): 实施计划审核后若代码继续演进，必须对每个 Find/Replace 块重新 grep 核对：本次 twoPhase 参数被移除、函数名 handleSend→handleConfirmSend 变化，v2 结论直接作废，靠重新核对才避免计划带病执行

### 18:06 | claude-code

- done: 任务分配模式改为人工两步触发：第一步注入(insertText)、第二步确认发送(sendMessage单脚本)，复用多AI模式已验证路径；generateInsertTextScript 加 isAlreadySame 守卫防 Slate 重复注入报错
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
- lesson(promoted): 任务分配两段式自动发送(twoPhase)失败根因：phase1 用 generateInsertTextScript 缺旧 generateSendMessageScript 的强制 InputEvent 同步受控组件状态，按钮 disabled；且 Slate 编辑器(千问)走 setSlateDomValue 手搓 DOM span 触发 Cannot resolve a Slate node from DOM node 报错。改为人工两步复用多AI insertText/sendMessage 单脚本路径解决
- unresolved: 任务分配第一步注入仍触发千问报错，但多AI模式注入不报错——两条路径据代码应相同，需排查运行时差异

### 17:50 | Antigravity

- done: 删除辩论模式输入框中的论坛/气泡图标(forum icon)
- modified:
  - `src/renderer/src/components/modes/DebateModePanel.tsx`

### 16:52 | claude-code

- done: 审核并修订 modes-history-persist 实施计划：回填代码事实核对，修正 5 处实质问题（twoPhase 丢失/updateHistory 误删/辩题未持久化/辩论恢复块位置/首轮竞态丢轮）与若干小瑕疵
- context: spec: docs/superpowers/specs/2026-07-05-modes-history-persist-design.md
- decision: 辩论辩题写入 HistoryItem.title（非 debateState.topic），折中 spec §3 不持久化与 §5.6 取辩题作标题两处要求
- modified:
  - `docs/superpowers/plans/2026-07-05-modes-history-persist.md`
- lesson(promoted): 审核实施计划前必须 grep 实际代码核对 Find/Replace 块的行号与签名：本例 sendMessage 第二参 twoPhase、5 秒兜底用 updateHistory、debateSlots 无 setter 均靠核对才避免计划带病执行

### 16:22 | Antigravity

- done: 删除分配模式下输入框中多余的 '+' 按钮并实现发送后自动重置状态
- decision: 去除 isSent 状态的手动 '+' 重置流程，采用更符合普通聊天习惯的发送后自动 resetTask 逻辑，移除了多余的 '+' 按钮
- modified:
  - `src/renderer/src/components/modes/TaskModePanel.tsx`

### 15:52 | Antigravity

- done: 任务分配模式发送拆为两段式注入（注入→1000ms→点发送），消除千问网页报错
- added:
  - `docs/superpowers/specs/2026-07-05-task-assignment-two-phase-send-design.md`
  - `docs/superpowers/plans/2026-07-05-task-assignment-two-phase-send.md`
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`

### 15:00 | Antigravity

- done: Increase quick toolbar outer padding
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:59 | Antigravity

- done: Resize quick toolbar logo
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:48 | Antigravity

- done: Fix summary page white screen ReferenceError TDZ bug
- decision: Moved renderableModels useMemo declaration to be after restoreHistoryData useState definition to avoid Temporal Dead Zone ReferenceError
- modified:
  - `src/renderer/src/pages/SummaryPage.tsx`

### 14:41 | Antigravity

- done: Restore summary history model rendering bug fix
- decision: Derived renderableModels from restoreHistoryData when history is restored, and added fallback naming for missing models
- modified:
  - `src/renderer/src/pages/SummaryPage.tsx`
  - `src/renderer/src/hooks/useSummaryPanel.ts`

### 14:41 | Antigravity

- done: 在待办事项中记录了当前一键下载图片对豆包、gemini、gpt、智谱不生效的Bug
- modified:
  - `TODO.md`

### 14:30 | claude-code

- done: x

### 14:30 | claude-code

- done: 修复总结页 webview↔api 模式切换两个 bug：Bug#1 两模式共享 messages 导致 webview 用户气泡串到 API 模式 → webview 模式改用独立 webviewMessagesRef/webviewCustomPrompt；Bug#2 切模式卸载 <webview> 丢会话 → WebviewCard 提升为常驻渲染，API 模式 hidden 隐藏保活 WebContents。handleWebviewSend 对齐 currentConversationId/crypto.randomUUID 口径。
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx;src/renderer/src/hooks/useSummaryPanel.ts`
- lesson(promoted): Electron <webview> 设 display:none 不销毁 WebContents，只有 React 卸载 <webview> 元素才销毁；故模式切换保活 webview 会话应隐藏容器而非条件渲染卸载。WebviewCard.suspend()/resume() 会导航到 about:blank 再重载，丢失 live 流式回复，仅适合长时离开释放内存，不适用于短暂模式切换。

### 12:53 | claude-code

- done: 按计划修复历史记录/总结链路跨对话串台：P0-1 引入持久化 currentConversationId store 字段(setNewSession 同步清空、sendMessageToAll lastItem 选取改 ID 查找含复审补充的第5处 appStore:1091、新对话/续写分支 set 锚点、startMonitoring 同步写、removeHistory/removeHistories 删当前对话时置 null)；P0-1b onSelectHistory 双 set 同步 activeHistoryId 与 currentConversationId；P0-2 移除 MainPage 289/364、useSummaryPanel 124、SummaryPage 188 全部 history[0] 兜底改 ID 查找；P0-3 SummaryPage init effect 依赖移除 history；P1-1 全部 ID 改 crypto.randomUUID()(appStore 2处 + useSummaryPanel 4处)；P1-2 MainPage 906 补 debateSlots 漏参；P1-3 unregisterWebviewRef 加 ref 校验
- context: executing-plans 技能实施历史总结串台修复计划，lint 0 error / build 通过，回归脚本 1-8 与 crypto.randomUUID sandbox 需在 dev 手动验证
- added:
  - `docs/superpowers/plans/2026-07-05-history-summary-mixing-fix.md(补 appStore:1091 第5处 history[0] 出现点 + Done Criteria 行为变更标注)`
- modified:
  - `src/renderer/src/store/appStore.ts; src/renderer/src/pages/MainPage.tsx; src/renderer/src/pages/SummaryPage.tsx; src/renderer/src/hooks/useSummaryPanel.ts; docs/superpowers/plans/2026-07-05-history-summary-mixing-fix.md`
- lesson(promoted): 复审计划时发现 §3.2 表遗漏了 history[0] 的第5处出现点(appStore.ts sendMessageToAll 内的 lastItem 选取)，该处是续写分支 conversationId=lastItem!.id 的来源，若不修则恢复非 history[0] 的历史后续写仍串台——executing-plans 的 STOP-when-block 规则触发用户确认后并入 P0-1 修复
- unresolved: 回归脚本 1-8 需在 npm run dev 桌面环境手动验证；crypto.randomUUID() sandbox 需 dev console 确认；当前在 main 分支未提交，待用户决定提交/切分支

### 11:33 | claude-code

- done: 回滚前次 webview-resummarize 三 commit（composer 加按钮+setError+空文本走error），改为复用 WebviewCard 头部已有新对话按钮：WebviewCard 新增 onNewConversation prop，渲染条件改为 task_assignment || onNewConversation，点击 onNewConversation ?? handleNewConversation；SummaryPanel 传 onNewConversation={handleResetChat}。多任务模式行为不变
- decision: 用户偏好复用已有 UI 入口而非新增按钮+复杂守卫逻辑；总结模式新对话=重开总结 session（清对话+解锁+resetToInitial）走 handleResetChat 闭环，不加 setError/hasAnyReply/错误展示
- modified:
  - `src/renderer/src/components/WebviewCard.tsx src/renderer/src/components/SummaryPanel.tsx`

### 00:57 | claude-code

- done: 合并 batch-download-images 分支到 main:一键下载所有窗口生图功能(注入脚本+WebviewCardRef+appStore+IPC+ControlBar 全链路)整合进 main,与 summaryPrompts 重构(b02b012)无冲突合并,合并后 build/lint 通过
- context: 用户要求合并到主分支。开发期间 main 前进到 b02b012(summaryPrompts 重构,改了 ipcHandlers/preload/appStore 等 5 个本次也改的文件)。策略:先在 worktree 分支 merge main(0 冲突,区域不重叠),验证 build+lint 通过后 fast-forward 合回 main。SESSION_LOG 冲突手动解决(保留两边日志)。
- decision: 合并策略:在隔离 worktree 里先 merge main 验证,不在 main 工作区直接合并,避免半合并状态污染 main。main 是 worktree 分支祖先,最终用 --ff-only 干净合回。
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/shared/utils/webviewScripts.ts`

## 2026-07-04

### 22:50 | Antigravity

- done: Resolved merge conflicts in SESSION_LOG.md and committed all outstanding code and configuration changes
- modified:
  - `SESSION_LOG.md`

### 22:47 | Antigravity

- done: 撤回：修复 webview 模式下完成总结后发送框锁死、无法重新生成报告的问题
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`
  - `src/renderer/src/hooks/useSummaryPanel.ts`

### 22:21 | Antigravity

- done: Reduced expanded ModelOutputCard height to 60vh to allow following cards to remain visible
- modified:
  - `src/renderer/src/components/ModelOutputCard.tsx`

### 22:16 | Antigravity

- done: Updated ModelOutputCard: removed gradient mask in collapsed mode, and limited expanded height to 80vh with internal scrolling
- modified:
  - `src/renderer/src/components/ModelOutputCard.tsx`

### 22:15 | Antigravity

- done: Fix frontmatter bleeding into summary prompts and clean up corrupted local storage files
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/main/summaryPrompts.ts`

### 22:13 | Antigravity

- done: 修复 webview 模式下完成总结后发送框锁死、无法重新生成报告的问题
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`
  - `src/renderer/src/hooks/useSummaryPanel.ts`

### 22:05 | Antigravity

- done: Optimized SummaryPage UI to allow dragging to resize the summary panel
- modified:
  - `src/renderer/src/pages/SummaryPage.tsx`

### 22:04 | Antigravity

- done: Migrated summary prompts metadata from HTML comments to YAML frontmatter
- modified:
  - `src/main/summaryPrompts.ts`
  - `src/renderer/src/store/summary-prompts-defaults/*.md`

### 21:34 | Antigravity

- done: 更新千问 (Qwen) 的 Deep Research DOM 选择器，并升级版本至 15
- modified:
  - `src/shared/config/selectors.ts`

### 21:25 | Antigravity

- done: 更新 Gemini 的 Deep Research 和 Imagen 选择器，修复失效问题
- modified:
  - `src/shared/config/selectors.ts`

### 13:38 | claude-code

- done: Task 5: ControlBar 一键下载按钮接线 -- wired extractImagesFromAll + downloadAllImages to the one-click download button, replaced TODO toast with real handler
- context: Final task (5/5) in batch-download-images chain. All 5 tasks now complete on worktree-batch-download-images branch.
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 13:18 | claude-code

- done: Task 3: appStore 新增 extractImagesFromAll 遍历方法 — 添加 ExtractedImage/ExtractImagesResult 类型定义、AppStore 接口声明、以及遍历所有 displayedModels 提取生图的 store 方法实现
- context: Task 3 of 5-task batch-download-images plan. Added extractImagesFromAll() to Zustand store. Uses same traversal pattern as enableImageGenerationForAll but without IMAGE_GENERATION_SUPPORTED_MODEL_IDS filter.
- modified:
  - `src/renderer/src/store/appStore.ts`

### 11:58 | claude-code

- done: 将选择器诊断组件从生产构建中剔除：渲染层 DiagnosticsPage 改为 import.meta.env.DEV 守卫的 React.lazy 动态 import，生产构建不再打包；主进程 openDiagnosticsWindow 与三个 diagnostics IPC handler 加 is.dev 运行时守卫。
- context: 用户询问开发诊断工具是否被打进安装包，评估后确认渲染层 UI 与主进程代码均会进包但入口被 import.meta.env.DEV 隐藏；用户要求让组件不进包。
- decision: 渲染层用 import.meta.env.DEV + lazy 动态 import 让 Rollup tree-shake 掉诊断 chunk（Vite 官方机制）；主进程因是运行时副作用注册无法静态剔除，改为 is.dev 运行时守卫，体积可忽略。保留 appStore 中 'diagnostics' union 字面量避免无关重构。
- modified:
  - `src/renderer/src/App.tsx`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
- lesson(promoted): Vite 生产构建把 import.meta.env.DEV 静态替换为 false，但仅当被守卫的 import 是动态 import（lazy(() => import(...))）且整条引用链静态可达时，Rollup 才会把目标 chunk 从产物剔除；顶层静态 import + 运行时 if 判断不会剔除。
- lesson(promoted): electron-vite 主进程的 ipcMain.handle 是运行时副作用注册，无法用 import.meta.env.DEV 静态剔除，只能用 is.dev 运行时守卫短路返回。
- unresolved: 未在 npm run dev 桌面环境实机验证：dev 下诊断窗口可正常打开；生产构建中 #diagnostics 哈希无反应、diagnosticsOpenWindow 返回 dev-only。

### 11:26 | Antigravity

- done: 优化诊断页面 UI 与新增 DOM 树复制功能
- modified:
  - `src/renderer/src/pages/DiagnosticsPage.tsx`
- lesson(promoted): 通过使用 w-screen h-screen overflow-hidden 替换 w-full h-full，解决 frameless Electron 窗口中由于 #root 塌陷导致的 body 背景溢出空白问题

## 2026-07-03

### 21:40 | Antigravity

- done: Change the icon in the page to be consistent with the application icon
- added:
  - `src/renderer/src/assets/logo.png`
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`
  - `src/renderer/src/pages/ToolbarPage.tsx`
- removed:
  - `src/renderer/src/assets/logo.svg`

### 21:19 | Antigravity

- done: Fix bug: history snapshot overlay persists when starting a new chat
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 19:37 | claude-code

- done: 诊断窗口新增 DOM 检拾模式 Tab（检拾→点选→祖先链+子树 DOM 结构回传，用于确认 selectors.ts 目标元素层级与属性）
- modified:
  - `src/renderer/src/utils/selectorDiagnostics.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/pages/DiagnosticsPage.tsx`
- unresolved: picker 自身超时 120s 与 relay 超时 60s 不匹配：用户在 60-120s 间点选时 relay 已超时返回错误，平台页 picker 覆盖层仍存活至 120s（plan 明确规定此值，dev-only，picker 120s setTimeout 兜底自清）；120s 超时极端路径未手动触发验证；DOM 检拾全链路（executeJavaScript await 页内 Promise、overlay 渲染、Esc、双击重入）需 npm run dev 手动验证

### 17:45 | claude-code

- done: 修复历史快照覆盖层加载途中误闪：checkUrlMismatch 不再在 dom-ready/did-navigate 触发，改在 did-stop-loading 做最终判定，保留 did-navigate-in-page
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
- lesson(promoted): 历史快照 urlMismatch 检测不能在加载途中的中间导航事件触发：dom-ready 与 did-navigate 在 SPA 重定向链每一跳都会触发，中途 URL 必然偏离 expectedUrl，先误报后纠正造成覆盖层闪烁。最终判定应放在 did-stop-loading（URL 已落定）；did-navigate-in-page 是首屏之后的 SPA 路由变化（isLoading=false），保留它可捕获加载后被重定向到登录页的真实偏离且不会闪。

### 15:44 | claude-code

- done: Task 3: WebviewCard 新增 probeDomStructure 检拾方法
- context: SDD Task 3: Added probeDomStructure method to WebviewCardRef (useImperativeHandle). 3 edits: import line, ref interface, implementation between probeResearchMode and suspend. Uses buildPickerScript/parseDomProbeResult from Task 1. Types: DomProbeReport, DomProbeOptions.
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 14:22 | claude-code

- done: 修复任务分配模式两个 bug：拆解按实时窗口数（提示词注入 windowCount）+ 一键派发按 slotIndex 分发（不再用 modelId 反查槽位，根除多窗口同模型全打 slot0）
- decision: 拆解提示词改为函数 buildTaskSplitSystemPrompt(windowCount)，强制模型输出恰好 windowCount 个子任务；windowCount 由渲染层实时 getDisplayedModels 计算后经 IPC 透传（端到端同步 SplitTaskParams/handler/preload/index.d.ts）。
- modified:
  - `src/main/config/taskSplitPrompt.ts src/main/api/taskSplitApi.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/store/appStore.ts src/renderer/src/hooks/useTaskSplit.ts src/renderer/src/components/modes/SubtaskList.tsx src/renderer/src/components/modes/TaskModePanel.tsx`
- lesson(promoted): 任务分配模式子任务必须携带 slotIndex（槽位索引）而非仅 modelId：taskAssignmentSlots 是按槽位顺序的模型 id 数组，任务模式支持多窗口选同一模型，用 modelId findIndex 反查槽位会把所有同模型子任务命中 slot0。派发/ cycle 一律按 slotIndex 走，modelId 仅作展示派生。

### 13:27 | claude-code

- done: 修复 API 模式总结历史恢复时左侧模型回复卡片为空的 bug：根因是 useSummaryPanel.persistSummaryHistory 在首次总结时与 setCapturedModelResponses 同 tick 调用，闭包读到的 capturedModelResponses 仍是旧值 {}，导致写入空 modelResponses；webview 模式因直接用 modelResponses prop 不经此闭包故不受影响。修复：引入 capturedModelResponsesRef 镜像，配对 setter 同步更新 ref，persist 改读 ref.current，避开闭包陈旧值
- modified:
  - `src/renderer/src/hooks/useSummaryPanel.ts`
- lesson(promoted): React 闭包陈旧值铁律：在同一事件处理函数内先 setState(A) 再调用一个闭包函数读取 A，读到的是本次渲染的旧值而非刚 set 的新值。useSummaryPanel.persistSummaryHistory 闭包读 capturedModelResponses，而首次总结路径 setCapturedModelResponses(snapshot) 后紧接着同步调用 persist → 写入空 modelResponses，导致 API 模式历史恢复时左侧模型卡片全空。webview 模式不受影响因其直接读 modelResponses prop。判别：某状态被 set 后同一 tick 内被闭包读取且结果为空/旧值 → 必须用 ref 镜像（setX 时同步写 ref.current）或显式传参，不能依赖未 flush 的 state。项目里 streamingContentRef/streamingReasoningContentRef 已是同一模式的既成先例。
- unresolved: 需用户在 npm run dev 实跑验证：API 模式生成首次总结->打开总结历史->恢复该条->左侧应显示模型回复卡片；旧的历史记录[1][2]因数据从未存入无法恢复，需重新生成。webview 模式恢复应保持正常

### 13:15 | claude

- done: 修正讯飞任务拆解 Model Not Found 的真因：useTaskSplit 把 summaryModel.name(别名 DeepSeek) 当 model 字段发出，网关只认 id(xopdeepseekv4pro)；改 .name→.id 与总结链路对齐。上一轮的 buildRequestBody 复用是健壮性改进但非本 bug 真因
- modified:
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): model 字段必须传 summaryModel.id(=平台模型标识如 xopdeepseekv4pro)，绝不能传 .name(用户别名如 DeepSeek)；.name 仅用于 UI 展示。讯飞 MaaS 网关对别名返回 PathDomainError:Model Not Found。判别：总结能用但任务拆解/辩论裁判报 Model Not Found → 先 grep 该链路取的是 .id 还是 .name，比 body 形状更优先。已固化进 KNOWLEDGE
- lesson(promoted): 方法论：model 字段传值对错只能靠读 config-dev.json 的 summaryModels.{id,name} + 代码传值对比确认，不能从代码静态结构猜；上一轮凭 body 形状静态差异推断根因直接改，翻车。systematic-debugging Phase4 fix 不灵必须回 Phase1 读真实配置而非叠加修复
- unresolved: 待用户在 npm run dev 实跑讯飞任务拆解确认报错消失；dev 控制台应见 [TaskSplit API] 模型: xopdeepseekv4pro

### 13:06 | claude

- done: 修复任务拆解 API 在讯飞供应商下报 Model Not Found：根因是 taskSplitApi 自拼最小请求体绕过了 buildRequestBody，与总结链路 body 形状不一致；改由 buildRequestBody 统一构建并允许 stream 覆盖
- modified:
  - `src/main/config/requestBodyConfig.ts`
  - `src/main/api/taskSplitApi.ts`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 非流式一次性 LLM 请求（任务拆解等）必须复用 buildRequestBody，不能自拼最小 body：同一讯飞网关同一模型名，body 形状不一致会报 PathDomainError:Model Not Found（误导性错误，看似模型配置问题实为 body 形状问题）。修复：buildRequestBody 加可选 stream 覆盖，taskSplitApi 改用 buildRequestBody({stream:false})。铁律：凡走同一 OpenAI 兼容端点的请求一律经 buildRequestBody 统一构建。已固化进 KNOWLEDGE.md。
- unresolved: 未在 npm run dev 中实机触发讯飞任务拆解验证（讯飞为用户本机配置供应商，无法在开发机触达）；需用户实跑确认报错消失，若仍报 Model Not Found 则根因转向模型名/路由本身

### 00:30 | claude-code

- done: 选择器诊断独立窗口 v2（8 task SDD：独立 BrowserWindow 双 Tab + researchMode 探针 + 实跑按钮，跨窗口 IPC 代理）
- decision: researchMode 探针同源铁律：findElement/matchText(含 exclude)/findMenuOpener 逐字复刻 webviewScripts.ts:640-781，只读不点击；任何行为分歧（如漏 exclude、漏 top 排序）即使只读不影响 found 判定也要修，否则探针可信度受损。
- added:
  - `src/renderer/src/pages/DiagnosticsPage.tsx`
- modified:
  - `src/renderer/src/utils/selectorDiagnostics.ts;src/renderer/src/components/WebviewCard.tsx;src/main/webviewManager.ts;src/main/ipcHandlers.ts;src/preload/index.ts;src/preload/index.d.ts;src/renderer/src/env.d.ts;src/renderer/src/store/appStore.ts;src/renderer/src/App.tsx;src/renderer/src/components/SettingsDrawer.tsx;src/renderer/src/components/Layout.tsx;docs/选择器维护方法论.md`
- removed:
  - `src/renderer/src/components/SelectorDiagnosticsPanel.tsx`
- lesson(promoted): Electron 跨窗口访问主窗口 webview：诊断窗口不持有 webview，须经主进程 reqId Map + 超时兜底透传给主窗口 renderer 查 webviewRefs；返回结构统一 {success,data?,error?}。
- lesson(promoted): renderer 的 window.api 类型有双源：src/preload/index.d.ts 与 src/renderer/src/env.d.ts 各自 declare global Window.api，tsconfig.web.json 同时引用两者——加 IPC 方法必须两边都补，否则 renderer tsc 报缺方法。
- lesson(promoted): ipcHandlers.ts 的 getMainWindow 是 registerIpcHandlers 的参数而非 webviewManager import；新增依赖 getMainWindow 的 handler 必须注册在函数体内，Map 等持久状态放模块顶层。
- unresolved: 手动 dev 示范（Task 8 Step2）需 npm run dev + 人工开 ChatGPT/Kimi 触发回复 + 点诊断观察，未自主完成；已做等价自动化验证（build exit 0、DEV-gate grep=0、同源核对、IPC 契约 parity、tsc/lint 无新错）。

## 2026-07-02

### 23:42 | claude-code

- done: Task 2: Added probeResearchMode to WebviewCardRef (interface + useImperativeHandle impl), extended selectorDiagnostics import
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 23:16 | claude-code

- done: 修复豆包多块合并回归：上次用1.5x下限长度守卫方向反了，末块极短时跳过单轮容器继续向上爬到跨轮根容器，把全部历史对话+用户query抓下。改为最近公共祖先：第一个queryAll([data-streaming],.md-box-root)>=2的祖先立即返回不再向上，去掉长度守卫，向上层数收紧到6
- context: 回归由上一次修复findDoubaoMultiBlockRoot引入
- modified:
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): 豆包多块合并防过并不能用下限长度守卫(1.5x)：方向反了，只挡比正文短的容器，挡不住爬过头到跨轮根容器(全部历史+query)。正确做法是最近公共祖先——第一个blockCount>=2的祖先立即返回不再向上，无需长度守卫，因为含>=2个本回复块的最近祖先必是单轮容器
- unresolved: 需npm run dev实测：豆包多轮对话只抓最新回复全文、不含query和历史

### 22:43 | claude-code

- done: 修复豆包回复抓取不完整：豆包现把一条助手回复拆成多个并列[data-streaming]渲染块，末块常为收尾提示，原'取最后可见候选'逻辑命中末块导致只抓到最后一句。新增findDoubaoMultiBlockRoot合并同轮多块容器
- context: 豆包DOM: <div data-container-type=block-v2>包多个<data-render-engine=node>块，每块含.md-box-root[data-streaming=false]
- decision: 豆包多块合并放在findMergedContentRoot之后作为补充启发式，沿用1.5倍长度+>=2块守卫，不改动既有markdown-content-N逻辑以免影响其他平台
- modified:
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): 豆包单轮回复已被拆成多个并列渲染块(<div data-render-engine=node>...<div data-streaming>)，末块常是收尾提示而非正文；抓取'取最后可见候选'会命中末块。判别手法：选定块向上找queryAll([data-streaming],.md-box-root)>=2且文本1.5倍长的祖先即为单轮容器
- lesson(promoted): findMergedContentRoot只认markdown-content-N的id正则，对豆包无该id的hash后缀容器(container-qX9Csx等)失效；多块合并需另设按'多回复块同轮容器'的启发式，并复用1.5倍长度守卫防过并
- unresolved: 需npm run dev实测：豆包多块回复确认抓全正文、收尾提示并入正文末尾、其他平台回复不受影响

### 22:32 | claude-code

- done: 辩论机制分层提示词改造 + 辩论专用总结模板(辩论裁判)自动选中 + 完成toast泄漏修复
- context: 用户反馈辩论提示词太机械,要求分开始/进行中/收尾,并加辩论专用总结模板,辩论模式进总结时默认选中;并报完成toast永久显示且泄漏到多AI模式的bug
- decision: 不切模式时resetDebate(会清rounds导致裁判评析拿不到发言),改用productMode门控+autoHide=4000+ControlBar切模式清通知
- added:
  - `src/renderer/src/utils/debatePrompts.ts`
- modified:
  - `src/renderer/src/utils/debatePrompts.ts(新建) src/renderer/src/hooks/useDebateRunner.ts src/renderer/src/store/agent-prompts-defaults/辩论对决.md src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx src/renderer/src/pages/SummaryPage.tsx src/renderer/src/types/summary.ts src/renderer/src/components/SummaryPanel.tsx src/renderer/src/hooks/useSummaryPanel.ts src/renderer/src/components/modes/DebateModePanel.tsx src/renderer/src/components/ControlBar.tsx`
- lesson(promoted): 辩论轮转prompt分层(立论/交锋/结辩)放代码内常量(debatePrompts.ts)而非AgentPrompt磁盘模板系统，因带变量插值与阶段分派;总结模板改名(辩论对决→辩论裁判)只改name不改id(仍'5'),MainPage presetSummaryMode:'5' 仍有效;现有用户磁盘agent-prompts/目录为空时bootstrap才会写入新默认,否则保留旧name/prompt(本机当前为空,下次dev生效)
- unresolved: 需npm run dev手动验证各轮prompt分层/默认选中辩论裁判/toast不泄漏;1轮与2轮辩论边界行为

### 22:32 | claude-code

- done: 修复豆包+千问回复选择器失效：豆包改用[data-streaming]/.md-box-root候选；千问改用qk-markdown体系容器级候选并删除段落级候选(.qk-md-paragraph导致命中视频卡丢失正文)；htmlToMarkdown跳过千问多模态卡片与来源汇总区；新增千问引用上标转[N]标记+tooltip来源提取([class*=source-card-item]兼容hash后缀)；降级结论：React:hover tooltip无法程序化触发挂载，来源靠手动悬停，不强求完整
- context: 豆包/千问选择器失效修复，用户要求保留正文引用链接
- decision: 千问来源明细降级方案:保留[N]上标标记+tooltip提取代码(无速度影响则留)，不做文末计数提示，不做CDP真实鼠标自动悬停(违反脆弱依赖约束)
- modified:
  - `src/shared/config/selectors.ts;src/shared/utils/htmlToMarkdown.ts;src/shared/utils/webviewScripts.ts;.memory/KNOWLEDGE.md`
- lesson(promoted): hash后缀class必须用[class*=...]属性子串选择器，不能用精确class(.source-card-item不匹配source-card-item-mo9ULH)，判别手法:精确选择器length=0但子串选择器length>0则必是hash后缀
- lesson(promoted): 平台改名class是选择器失效首要根因而非写法错：豆包mdbox-theme-next→md-box-root、千问tongyi-markdown→qk-markdown，排查第一步永远是先Console查当前真实class再写候选，不要凭旧DOM记忆改
- lesson(promoted): 抓取逻辑取最后可见候选时段落级候选(.qk-md-paragraph)会命中回复末尾多模态卡片块(.qk-md-has-multi-modal)导致只抓到卡片标题丢正文，messageContainer候选应容器级优先段落级靠后或不用
- lesson(promoted): React:hover/合成事件驱动的tooltip无法用程序化dispatchEvent触发挂载(实测increased:false)，千问来源明细只能靠手动悬停或CDP真实硬件鼠标(重且违反避免脆弱DOM依赖)，可接受降级:上标转[N]标记+尽力抓已挂载tooltip
- unresolved: 千问reportContainer仍依赖失效的.tongyi-markdown/viewResults-D_wP0H，需深度研究结果DOM才能修；豆包/千问选择器dev实测验证待用户跑npm run dev确认

### 22:13 | claude-code

- done: 修复 SummaryPage 黑屏：renderableModels 的 useMemo 引用了尚未声明的 modelResponses useState，触发 TDZ，移到其后
- context: 上一轮 phantom 空框修复引入的回归；const 不像 var 提升初始化。
- modified:
  - `src/renderer/src/pages/SummaryPage.tsx`
- lesson(promoted): useMemo 引用同组件 useState 变量时必须声明在其后，否则渲染期访问 const TDZ 抛 'Cannot access X before initialization' 致整页黑屏；eslint react-hooks 与 tsc 均不报此顺序错，必须 npm run dev 实跑确认。

### 22:08 | claude-code

- done: 修复多AI模式下总结页出现无关webview空回复框（phantom空框）的bug
- context: getDisplayedModels 的兜底逻辑与历史恢复回填是 phantom 模型进入总结页的两条路径；渲染口径需与 selectedModels/getAllResponses targetModelList 对齐。
- modified:
  - `src/renderer/src/pages/SummaryPage.tsx`
- lesson(promoted): SummaryPage 无条件渲染 getDisplayedModels 全部槽位模型，而该函数的 models[index % models.length] 兜底 + 历史恢复 newOrder 回填未参与模型（含禁用模型）会把用户当前页面没打开的模型也列入 displayedModels，无回复内容时渲染成「暂无回复内容」空框。修复：渲染前按 modelResponses 有内容过滤（与 selectedModels 口径一致）。

### 21:29 | claude-code

- done: Task 3: Added probeMessageContainer to WebviewCardRef interface and useImperativeHandle in WebviewCard.tsx. Added import for buildProbeScript, parseProbeResult, and ProbeReport from ../utils/selectorDiagnostics.
- added:
  - `src/renderer/src/components/WebviewCard.tsx`

### 21:28 | claude-code

- done: 辩论模式两 bug 修复：Bug1 getResponseFromSlot 去掉 sawNew 单向闩锁，每次循环要求 cur 非空且 !==base 才计入稳定计数，超时返回空，根除基线读空/闩锁后回稳到旧值导致旧回复被当成新回复发给对方；Bug2 裁判评析在 productMode==='debate' 时直接读 debateState.rounds 构造 modelResponses，绕开 getAllResponses/activeModels 污染与快照兜底，SummaryPage 解构并传入 debateSlots 给 getDisplayedModels 保证渲染 2 个辩论槽卡片。
- context: 辩论模式慢 AI 旧回复误发 + 裁判评析抓错 webview 两 bug
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/SummaryPage.tsx`
- lesson(promoted): getResponseFromSlot 的 sawNew 单向闩锁是错误抽象：一旦因瞬时空值/基线读空触发就永久 true，之后 cur 回稳到旧基线即返回旧回复。正确做法是每次循环都重新校验 cur 非空且 !==base 才计入稳定计数，不用闩锁。

### 21:22 | claude-code

- done: Task 2: Created selectorDiagnostics.ts with buildProbeScript and parseProbeResult pure functions
- context: Task 2 of 6 in the selector diagnostics panel plan. Created the probe script builder and result parser as pure functions.
- decision: Used indexOf-based dedup (Step 3 fix) instead of Set-based dedup for injected environment compatibility. Used ​ escape instead of literal ZWSP to avoid ESLint no-irregular-whitespace.
- added:
  - `src/renderer/src/utils/selectorDiagnostics.ts`

### 21:03 | claude-code

- done: Task 1: Added vite/client types to tsconfig.web.json compilerOptions for import.meta.env.DEV type support
- modified:
  - `tsconfig.web.json`

### 19:37 | claude-code

- done: 据 SESSION_LOG 更新 TODO：勾掉辩论回复检测代码落地、TaskSplitModal 代码落地；新增 webview 智能休眠(代码落地/dev验收未完成)与内存泄漏修复(10处已修/2项follow-up)条目
- modified:
  - `TODO.md`

### 13:15 | claude-code

- done: 按休眠迁移评估计划的 5 个片段实施 webview 智能休眠：WebviewCard 休眠能力(片段A)+MainPage 5min调度器(片段B)+主窗口hide/show IPC 15min(片段B')+SummaryPanel 10min调度器(片段D,修正计划笔误:webview在SummaryPanel非SummaryPage)+QuickPage 5min旧模型调度器(片段E)。真卸载页面层(loadURL about:blank)+唤醒重载草稿恢复,登录态靠persist:shared。lint 0 errors,build三bundle通过,待dev手动验证真值表与各场景延迟。
- context: worktree webview-hibernation-recover 基于 main d8c22ba,前面2个doc提交(b40fa43/7c7e078)
- modified:
  - `src/main/webviewManager.ts;src/preload/index.ts;src/preload/index.d.ts;src/renderer/src/components/WebviewCard.tsx;src/renderer/src/components/SummaryPanel.tsx;src/renderer/src/pages/MainPage.tsx;src/renderer/src/pages/QuickPage.tsx;src/renderer/src/pages/SummaryPage.tsx;src/renderer/src/types/summary.ts`
- lesson(promoted): 休眠 suspend 必须补 loadURL('about:blank') 才真省内存——57efc27/eb4791d 原始版只 setIsHibernated+className 隐藏,渲染进程未卸载,与'优化性能'初衷冲突(决策D1)
- lesson(promoted): SummaryPage.tsx 不嵌入 WebviewCard,总结页 webview 实际在 SummaryPanel.tsx 的 webviewSummaryRef(用于webview平台总结模式)——计划文档笔误,实施时需以代码事实为准
- lesson(promoted): activeHistoryId 是 MainPage 本地 useState 而非 store 字段,useCallback 调度器要读最新回溯态需用 ref 镜像(activeHistoryIdRef)+useEffect 同步,不能直接进依赖数组
- unresolved: dev 手动验证未完成:12种真值表case+5/10/15min各场景延迟(需临时调小常量或控制台手动suspend)+内存实测(4 webview全休眠应降200-400MB)

### 13:10 | claude-code

- done: 辩论模式回复检测修复：getResponseFromSlot 增加基线快照对比，必须先观察到与发送前基线不同的新内容、再连续稳定 3 次才判定回复完成；超时返回空，useDebateRunner 在空回复时中止辩论而非记占位回合继续推进。根除旧回复被误判为新回复导致没等真回复就发下一轮的问题。
- context: 辩论模式 runNextTurn 单轮驱动
- added:
  - `docs/superpowers/specs/2026-07-02-debate-reply-detection-design.md`
  - `docs/superpowers/plans/2026-07-02-debate-reply-detection.md`
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/hooks/useDebateRunner.ts`
- lesson(promoted): getResponseFromSlot 旧轮询只用「连续两次内容相同」判完成，缺少与发送前基线对比，会把上一轮旧回复误判为本轮新回复。修复：发送后立即取基线，轮询必须先观察到 cur!==base 才进入稳定计数，超时返回空交由调用方中止。

### 13:02 | claude-code

- done: SDD Task 3: 改造 useDebateRunner.runNextTurn 取基线并空回复中止
- context: Task 3 of 4 in debate reply detection. Tasks 1-2 already updated getResponseFromSlot signature and polling logic. This change connects the caller side.
- decision: getResponseFromSlot 超时从 30s 改为 120s 以匹配基线对比新逻辑
- modified:
  - `src/renderer/src/hooks/useDebateRunner.ts`
- lesson(promoted): 空回复不应写入占位发言然后继续推进；应在检测到空回复时立即结束辩论并展示已有回合。

### 12:58 | claude-code

- done: Replaced getResponseFromSlot implementation with baseline-comparison polling logic for debate-mode reply detection
- context: Task 2 of 4 in debate reply-detection plan: baseline-aware polling with sawNew/sawNew gating, stableThreshold=3, pollInterval=500ms, timeout=120s
- modified:
  - `src/renderer/src/store/appStore.ts`

### 12:53 | claude-code

- done: Task 1: Extend getResponseFromSlot signature with optional baseline parameter
- context: SDD Task 1/4: Type-only change to appStore action type declaration for debate reply detection
- decision: Added baseline?: string as third optional parameter; new arg is optional so no existing call sites break
- modified:
  - `src/renderer/src/store/appStore.ts`

### 11:05 | claude-code

- done: 任务分发拆解失败弹窗（TaskSplitModal）代码落地：拆解失败不再静默，弹窗内可选拆解模型并写回 apiConfig、可编辑槽位并写回 taskAssignmentSlots、可重试；移除 useTaskSplit 内部 error state 统一经返回值传递；Esc/遮罩关闭时显式中止；happy path 不变。自动验证通过（lint 0 错误 / build 通过 / dev 干净启动）；GUI 交互验证 7 场景待用户手动执行
- added:
  - `src/renderer/src/components/modes/TaskSplitModal.tsx`
- modified:
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
- unresolved: Task 4 七个 GUI 交互验证场景需用户在 npm run dev 桌面环境手动验证：未配置供应商路径、选模型重试成功、Key 错误重试、槽位编辑、中止与 Esc、happy path 不回归

### 10:55 | claude-code

- done: 评估 webview 休眠机制移植回 main 的可行性：建保护分支 recover-hibernation(eb4791d) 后，对照当前 main 审阅休眠实现，产出移植评估文档
- context: eb4791d 休眠实现是 merge commit，含已删 .agent/.trae 目录，不能整体 cherry-pick；其休眠逻辑曾引发白屏回归(cc975a5 已修复)，main 现有 readonlySnapshot/urlMismatch 可见性门控与休眠 isHibernated 逻辑共存于同一段 className
- decision: 移植采用选择性重写而非 cherry-pick：片段A(WebviewCard suspend/resume/isHibernated+覆盖层UI)几乎原样移植，片段B(MainPage 调度器)重写 key 解析复用 slot-i 键，片段C(.agent/.trae/.memory 早期文件)不移植
- added:
  - `docs/superpowers/plans/2026-07-02-webview-hibernation-migration-assessment.md`
- lesson(promoted): 休眠 suspend 实现只 setIsHibernated+invisible 隐藏，并未 loadURL('about:blank')，渲染进程未真正释放，只省活跃 JS/网络轮询——与 KNOWLEDGE 第79条「隐藏未销毁 webview 仍占完整渲染进程」一致；真要省进程内存需改 suspend 主动卸载，但会与「保留会话连续性」决策冲突
- lesson(promoted): 移植 eb4791d 休眠调度到 main 的关键不兼容：recovery 用 ${productMode}-${i} 作休眠 key 并 split('-') 解析，但 main 的 getRefCallback 把 ref 注册到 slot-${i} 和 model.id 两个键，没有 ${productMode}-${i} 键——照搬 executeHibernate 会因 modeModels['slot'] 为 undefined 直接 return，休眠永不触发，必须重写 key→ref 查找
- unresolved: 休眠内存目标待用户确认：仅降活跃度(现状)vs真正释放渲染进程(需改suspend主动loadURL about:blank，但与保留会话连续性决策冲突)；白名单是否加第4项(回溯态activeHistoryId跳过休眠)以消除真值表case10-12重叠

### 01:54 | claude-code

- done: 内存泄漏审核修复：覆盖 10 处发现（AbortController 覆盖前 abort / reader finally 释放 / onChunk isDestroyed 守卫 / paste 临时目录即时+启动清理 / VBS 兜底清理 / registerWebviewHandlers 幂等 / loadMore 内存上限 100+游标 / saveCurrentTurn 写盘节流 / refCallbacks 旧键回收 / navigate setTimeout 清理）。#4 mountedWebviews 按用户决定不处理、记录为已知取舍。
- context: worktree-memory-leak-fixes，rebase 到本地 main(4198400) 后基于其执行计划；执行中使用 executing-plans skill
- decision: #4 mountedWebviews 模式切换保留 webview 进程为有意取舍（会话连续性），暂不处理；#6 加载更多语义定为内存硬上限 100+游标翻页，超出裁最旧；T9 registerWebviewHandlers 幂等守卫采用 WeakSet 方案（类型安全、不污染 webContents 实例、无 any）
- modified:
  - `src/main/api/summaryApi.ts src/main/ipcHandlers.ts src/main/index.ts src/main/shortcutManager.ts src/main/webviewManager.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx src/renderer/src/components/ControlBar.tsx docs/superpowers/plans/2026-07-02-memory-leak-fixes.md`
- lesson(promoted): AbortController 覆盖前必须 abort 旧实例+共享同一控制器的多个入口要互斥；ReadableStream getReader() 的 abort/异常路径必须有 finally { reader.cancel() } 释放锁；Electron 流式 onChunk 必须检查 sender.isDestroyed() 否则关窗后空转消费整条流；EnterWorktree 默认 baseRef=fresh 基于 origin/main，本地 main 若有未 push 提交会导致 worktree 落后于计划所基于的代码状态，需 rebase 到本地 main
- unresolved: #4 若后续需回收渲染进程，另起计划评估'新建会话时清空 mountedWebviews Set'方案；#10 发现预存架构问题：history 写路径 storeSet('history', inMemory100) 整数组覆写磁盘，使稳态下磁盘也仅 ≤100 条，与分层存储设计（磁盘 1000）矛盾、loadMore 稳态拉不到老数据；修复需改造写路径让磁盘保留全量+内存只覆写热区，属分层存储后续工作

### 00:34 | Antigravity

- done: Investigated Electron 42 bundle size increase

### 00:00 | claude-code

- done: history 分层存储：磁盘 1000/内存 100 + 加载更多按钮（基于 develop 新开 worktree 执行）
- context: 执行 docs/superpowers/plans/2026-07-01-history-tiered-storage.md，worktree: .worktrees/history-tiered-storage 分支 feature/history-tiered-storage
- modified:
  - `src/main/api/historyManager.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/store/appStore.ts src/renderer/src/components/HistoryDrawer.tsx`
- lesson(promoted): 新 worktree 的 electron postinstall 不会自动下载二进制：node_modules/electron/path.txt 为空、dist/ 缺失，npm run dev 报 Error: Electron uninstall。需手动 node node_modules/electron/install.js 拉取。计划行号引用会随分支漂移，执行计划前必须用 grep 核对锚点。
- unresolved: 端到端手动验证（发送产生 history、>300 条加载更多、搜索隔离）需在 dev 桌面窗口人工点击完成，本会话仅完成启动冒烟（app 成功启动无崩溃）

### 00:12 | claude-code

- done: 将轮询去重代码合并到 develop 分支：rebase 本分支到 develop（无冲突），主仓库 develop 干净后执行 git merge worktree-history-polling-dedup。仅 plan 文档 add/add 冲突，取本分支版本（含审核实施状态注释）解决。合并后 lint+build 通过，merge commit 8a3b1e4。
- context: 主仓库 develop 有用户并行工作（任务分配/辩论模式 TODO + 3 个 plan 文档），分叉点 309377e。本分支独有 b0161fa 代码 + 2 文档；develop 独有 3 提交。develop 上 3dea51b 也加了同名 polling-save-dedup plan 文档（早期无注释版），与本分支 21dbadd（含审核注释）冲突。
- decision: plan 文档 add/add 冲突取本分支版本（theirs）：本分支版是 386 行含实施状态注释的 superset，develop 版是 379 行早期版。未推送 origin/develop（领先 19 提交，按规则待用户决定推送时机）。
- modified:
  - `merge develop: src/renderer/src/store/appStore.ts TODO.md SESSION_LOG.md docs/superpowers/plans/2026-07-01-history-polling-save-dedup.md`
- lesson(promoted): 跨 worktree 合并：主仓库 worktree 检出的分支不能在本 worktree 用 git branch -f 强移指针（fatal: cannot force update branch used by worktree）。需用 git -C <主仓库路径> 在主仓库侧操作，或推远程分支。

## 2026-07-01

### 23:59 | claude-code

- done: check output

### 23:58 | claude-code

- done: 审核并实施会话轮询保存去重计划：pollPlatforms 引入 anyChanged 脏标记（稳定期不再每 3s 全量写盘），完成分支显式写终态；stopMonitoring 兜底写当前 turn；startMonitoring 重置与超时分支统一收口到 stopMonitoring 消除双写。舍弃 Task 1（updatePlatformAnswer 为死代码）。
- context: I/O 放大优化，仅改 src/renderer/src/store/appStore.ts，不碰 IPC/主进程/分层边界，存储引擎保持 electron-store(JSON)。项目无自动化测试，验证=lint+build+dev 手动。
- decision: 1) 舍弃 Task 1：updatePlatformAnswer 无调用方，优化死路径零收益。2) startMonitoring 重置路径改调 stopMonitoring() 而非裸 clearInterval，真正统一停止出口；前提已核实（唯一调用点 sendMessage 不提前改 monitor.currentConversationId）。3) 超时分支去掉冗余 saveCurrentTurn 依赖 stopMonitoring 内部兜底写消除双写；完成分支保留显式写（低频，换取最终态必落盘确定性）。4) 补原计划遗漏：!ref 分支也置 anyChanged=true。
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `docs/superpowers/plans/2026-07-01-history-polling-save-dedup.md`
- lesson(promoted): 改前先 grep 函数调用点：计划若基于某函数'高频被调'做优化，必须先验证它真的有调用方——updatePlatformAnswer 被当成网络流式去重目标，实则整个 src/ 无调用方（死代码），优化它零收益。
- lesson(promoted): stopMonitoring 类停止函数加兜底写时，注意调用顺序：必须在 set 重置 monitor.currentTurn=null 之前调 saveCurrentTurn，否则拿到 null 直接 early return；startMonitoring 重置路径要复用停止出口也同理（在 set 新 turn 之前调）。
- unresolved: updatePlatformAnswer 是否本应被接入网络流式推送回调而漏接——若未来需要实时（非轮询）落盘，需另立项核实其设计意图。

### 22:35 | claude-code

- done: 实现任务分配模式与辩论模式
- context: Task 8: 文档与收尾
- added:
  - `src/main/config/taskSplitPrompt.ts`
  - `src/main/api/taskSplitApi.ts`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/modes/SubtaskList.tsx`
  - `src/renderer/src/components/modes/DebateModePanel.tsx`
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `src/renderer/src/hooks/useDebateRunner.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `docs/mode-design-mock.html`
- lesson(promoted): 辩论轮转复用 webviewRefs.get('slot-N') 单槽位发送，无需改 WebviewCard；任务拆解复用 generate-summary 的 AbortController 全局中止器

### 22:35 | claude-code

- done: 实现任务分配模式与辩论模式
- added:
  - `src/main/config/taskSplitPrompt.ts`
  - `src/main/api/taskSplitApi.ts`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/modes/SubtaskList.tsx`
  - `src/renderer/src/components/modes/DebateModePanel.tsx`
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `src/renderer/src/hooks/useDebateRunner.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `docs/mode-design-mock.html`
- lesson(promoted): 辩论轮转复用 webviewRefs.get('slot-N') 单槽位发送，无需改 WebviewCard；任务拆解复用 generate-summary 的 AbortController 全局中止器

### 22:35 | claude-code

- done: 实现任务分配模式与辩论模式
- added:
  - `src/main/config/taskSplitPrompt.ts`
  - `src/main/api/taskSplitApi.ts`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/modes/SubtaskList.tsx`
  - `src/renderer/src/components/modes/DebateModePanel.tsx`
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `src/renderer/src/hooks/useDebateRunner.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `docs/mode-design-mock.html`
- lesson(promoted): 辩论轮转复用 webviewRefs.get('slot-N') 单槽位发送，无需改 WebviewCard；任务拆解复用 generate-summary 的 AbortController 全局中止器

### 13:17 | claude-code

- done: 内存占用性能优化（第一阶段）：summaryApi 流式日志加 is.dev 守卫、history/summaryHistory 上限 1000→100 并在加载时裁剪、网络嗅探器加 dev 守卫 + 主进程 console-message 过滤 NETWORK_RESPONSE
- context: 用户报告安装版峰值 1G、稳态 800MB，要求研究性能优化。用户决策：webview 销毁策略选「全部保留现状」，立即落地选 ROI 1+2+6 三步。
- decision: history 上限从 1000 收紧到 100（Zustand 常驻 + electron-store 持久化）。webview 模式切换不销毁（用户选择保留会话连续性，牺牲内存）。
- modified:
  - `src/main/api/summaryApi.ts`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): Electron 安装版稳态内存 800MB/峰值 1G 的三大可优化热点：(1) summaryApi.ts 每个流式 chunk 都 JSON.stringify 全量打印到 main 进程 stdout，是运行时峰值主因——必须用 is.dev 包住；(2) appStore history/summaryHistory slice(0,1000) 全量常驻 Zustand + 每 3 秒全量 storeSet 持久化，是稳态主因——上限改 100 且 initializeStore 加载时对老数据裁剪回写；(3) getNetworkSnifferScript 会把所有 fetch/XHR 响应体 console.log，是潜伏泄漏——生产环境返回空脚本。诊断结论：多 webview 独立渲染进程（300-500MB）是固有开销不可优化，真正可省的是日志和全量历史。
- lesson(promoted): Electron 内存优化的固有 vs 可优化边界：每个 <webview> 是独立渲染进程（site isolation），3-4 个 AI 平台 SPA 各 80-150MB 是固有开销，无法通过代码优化降低；persist:shared session 共享是架构约束（AGENTS.md 禁止动）。可优化的是：main 进程日志量、Zustand 全量常驻数据、隐藏未销毁的 webview（本次未动，用户要求保留会话）、Chromium 命令行开关（--js-flags=--max-old-space-size，本次未动待实测）。
- unresolved: ROI 3（webview 销毁策略）用户选保留现状，未实施。ROI 5（main 进程 --js-flags 内存开关、SessionManager backgroundThrottling）未实施，需实测。Material Symbols woff2 字体 3.95MB 全量打包，可子集化但未动。

## 2026-06-30

### 22:24 | Antigravity

- done: Updated Gemini Deep Research selector to support Chinese text
- modified:
  - `src/shared/config/selectors.ts`

### 21:57 | Antigravity

- done: Clean up unused useAppStore import in CustomDropdown.tsx
- modified:
  - `src/renderer/src/components/CustomDropdown.tsx`

### 21:54 | Antigravity

- done: Revert WebContentsView architecture back to original <webview> tag implementation
- added:
  - `docs/superpowers/plans/2026-06-30-webview-revert.md`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/ConfirmModal.tsx`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/RenameModal.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/utils/geminiCanvasExtractor.ts`
- removed:
  - `src/main/webContentsViewManager.ts`
  - `refactor_extractor.py`
  - `refactor_webview.py`
  - `test-corners.js`

### 20:58 | Antigravity

- done: Enhance Webview automation selectors and logic robustness with regex matching, menu opener fallbacks, and network sniffer support; fix dropdown overlay closing on resize
- modified:
  - `src/renderer/src/components/CustomDropdown.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): When elements in third-party AI web pages are dynamically loaded or change structure, regex exclusions and semantic menu opener fallbacks are much more resilient than static DOM selector lists.

### 20:51 | Antigravity

- done: Restore git to previous state

### 19:42 | Antigravity

- done: Restore capturePage DPI resizing logic to fix screenshot jump
- modified:
  - `src/main/ipcHandlers.ts`
- lesson(promoted): When faking a native window with a screenshot, rely on main process image.resize() to force 1:1 DIP dimensions, rather than relying on browser CSS background-size: 100% 100% to downscale physical pixels, which introduces visible resampling jumps.

### 09:04 | Antigravity

- done: Optimize WebContentsView bounds sync during resize by switching to fire-and-forget IPC and requestAnimationFrame throttling
- modified:
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/WebviewCard.tsx`

### 01:27 | Antigravity

- done: 优化四窗模式下宽度不足时的布局：不再出现田字格模式，而是使用横向滚动条滑动查看
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 01:25 | Antigravity

- done: Remove WebviewCard min-height limit and increase desktop window minHeight limits
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/main/webviewManager.ts`

### 01:18 | Antigravity

- done: Fix WebContentsView vertical overflow over toolbar and update to official rounded corners API
- modified:
  - `src/main/webContentsViewManager.ts`
  - `src/renderer/src/components/WebviewCard.tsx`

### 00:24 | Antigravity

- done: Reverted back to CustomDropdown, fixed the WebContentsView overlay issue by broadening needsOverlay to cover all slots, and implemented a CSS-based border-radius clipping mechanism for WebContentsView since setBorderRadius has no effect on Windows.
- lesson(promoted): 1. setBorderRadius on WebContentsView is a no-op on Windows. To achieve zero-margin rounded corners for WebContentsView, set the view's background color to transparent (#00000000) and inject CSS to apply border-radius and overflow:hidden to the html tag. 2. When a modal or drawer is absolute-positioned and overlays multiple elements, tracking which specific slots it overlays can be error-prone; it is safer to apply the Screenshot Illusion to ALL WebContentsView instances when any overlay is active.

### 00:17 | Antigravity

- done: Implemented screenshot illusion for drawers and native menus for model selection to fix WebContentsView UI layout issues without reverting the architecture.
- lesson(promoted): When moving from <webview> to WebContentsView, DOM UI elements (like dropdowns and drawers) will be obscured by the native view. To fix this without breaking responsive web layouts: (1) Use native Menus for dropdowns to escape the DOM z-index context. (2) For complex overlays like side drawers, capture the native view as an image (capturePage), set it as a background, and temporarily hide the native view so DOM elements can render on top.

## 2026-06-29

### 22:06 | Antigravity

- done: Git commit all recent modifications and documents including WebView summary fixes, Qwen scriptProcessor patching, and WebContentsView plan

### 22:02 | Antigravity

- done: 深化修复Webview总结会话URL的捕获与重载逻辑，排除通用新建对话首页的干扰，确保准确捕获独立会话ID链接并在重新加载历史时精准加载
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/SummaryPanel.tsx`

### 21:38 | Antigravity

- done: 修复了总结页Webview模式下会话URL持久化记录与恢复的Bug，以及主页面开启新对话后总结会话未刷新的Bug
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/pages/SummaryPage.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`
  - `src/renderer/src/hooks/useSummaryPanel.ts`

### 21:29 | claude-code

- done: 基于 WEBCONTENTSVIEW_MIGRATION_ASSESSMENT 评估制定 WebContentsView 完整迁移任务级开发计划
- context: 用户选定范围=仅完整迁移(option C)，粒度=任务级；用 context7 核验 WebContentsView/BaseWindow.contentView API 与 Electron 30+ 前提
- decision: 计划分 5 阶段(升级/主进程基建/渲染层适配/缓存池打磨/集成回归)；保留 WebviewCardRef 与 appStore.webviewRefs 结构以压缩上层改动面；项目无测试运行器故每任务验证门=lint+build+dev
- added:
  - `docs/superpowers/plans/2026-06-29-webcontentsview-migration.md`

### 21:13 | Antigravity

- done: Saved the WebContentsView migration assessment to the docs/ directory and updated DOCS_INDEX.md
- added:
  - `docs/WEBCONTENTSVIEW_MIGRATION_ASSESSMENT.md`
- modified:
  - `docs/DOCS_INDEX.md`

### 21:10 | Antigravity

- done: 修复生成总结页面展示和选中的模型与当前窗口实际打开的网页不匹配的问题
- modified:
  - `src/renderer/src/pages/SummaryPage.tsx`
- lesson(promoted): 总结页计算显示模型时需完整传入 productMode 和 slot 参数以确保与当前主窗口插槽配置一致；复用挂载 of 页面需避免用静态 ref 阻断数据加载的 useEffect

### 20:53 | Antigravity

- done: Prevent error prompt overlay from disappearing and causing white blank screen during TUN mode startup errors
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 20:46 | claude-code

- done: 修复通义千问点击黑屏/渲染进程崩溃(0xC0000005): 定位为Chromium 120 ScriptProcessorNode::Process() use-after-free,在webview注入脚本中对阿里云/通义域名将createScriptProcessor替换为纯JS桩消除原生音频线程崩溃路径
- modified:
  - `src/main/webviewManager.ts`
- lesson(promoted): Electron 28(Chromium 120)存在ScriptProcessorNode::Process()的use-after-free(STATUS_ACCESS_VIOLATION/0xC0000005,退出码-1073741819),已在Chrome121修复;阿里云风控SDK在用户点击手势时创建ScriptProcessorNode做音频指纹会命中该崩溃,表现为点击即黑屏。传感器的Permissions-Policy告警是干扰项(已被策略阻断且Electron无sensors权限类型,setPermissionRequestHandler无效),GPU开关也不对症。修复方式:对阿里云/通义域名在dom-ready注入时patch AudioContext/OfflineAudioContext(含webkit变体)的createScriptProcessor为纯JS桩,避免进入原生音频线程。彻底方案是升级Electron到29+(Chromium121+)。
- unresolved: 需在npm run dev中手动点击通义千问页面验证崩溃是否消除;长期应评估升级Electron28到29+

### 20:45 | Antigravity

- done: Adjust Qwen SVG viewBox to remove excess padding and crop empty margins so the icon renders at full scale matching other model logos
- modified:
  - `src/renderer/src/assets/logos/qwen.svg`

### 20:42 | Antigravity

- done: Replace Tongyi Qianwen logo with new SVG asset and rename model configuration name to Qianwen
- modified:
  - `src/renderer/src/assets/logos/qwen.svg`
  - `src/renderer/src/store/appStore.ts`

### 20:33 | Antigravity

- done: Fix multiple instances issue on double click by implementing app.requestSingleInstanceLock() and second-instance event handler
- modified:
  - `src/main/index.ts`

### 20:30 | Antigravity

- done: Summarize all debugging attempts and root cause analysis for Tongyi Qianwen webview click black screen issue for handover to next AI
- modified:
  - `src/main/index.ts`
  - `src/main/webviewManager.ts`

### 20:27 | Antigravity

- done: Systematic debugging: replace app.disableHardwareAcceleration with --use-angle=gl switch to resolve software rendering black screen on Windows and keep GPU renderer stable
- modified:
  - `src/main/index.ts`

### 20:18 | Antigravity

- done: Systematic debugging: restrict script injection to webContents.mainFrame only to prevent 0xC0000005 access violation crash when Aliyun Qwen dynamic subframes are disposed
- modified:
  - `src/main/webviewManager.ts`

### 20:12 | Antigravity

- done: Fix Qwen black screen on click caused by global about:blank window.open interceptor redirecting non-Google domains to Google Account chooser
- modified:
  - `src/main/webviewManager.ts`

### 20:03 | Antigravity

- done: Systematic debugging: replaced disable-gpu-compositing with app.disableHardwareAcceleration() and added reason/exitCode logging to fix Qwen webview crash on click
- modified:
  - `src/main/index.ts`
  - `src/renderer/src/components/WebviewCard.tsx`

### 19:57 | Antigravity

- done: Fix Qwen click causing black screen and renderer crash by disabling GPU compositing and hiding crashed webview
- modified:
  - `src/main/index.ts`
  - `src/renderer/src/components/WebviewCard.tsx`

### 13:19 | Antigravity

- done: Fix Clash Verge TUN mode blank page issue and ChatGPT Cloudflare Turnstile verification loop
- modified:
  - `src/main/index.ts`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
- lesson(promoted): Clash Verge TUN 模式与 Cloudflare Turnstile 验证在 Electron Webview 下的通用修复：1. TUN 虚拟网卡代理拦截 UDP 443 易导致 QUIC 握手挂起或丢包致白屏，需注入 app.commandLine.appendSwitch('disable-quic') 强制走 TCP；2. Cloudflare Turnstile 会探测 Blink 自动化特征（navigator.webdriver），需注入 app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled') 并在 Session 层面通过正则替换彻底移除 User-Agent 中的 Electron 标识；3. WebviewCard 需对所有导航启用超时检测并监听 render-process-gone 与 errorCode === -3 异常中断。

### 13:12 | Antigravity

- done: Fix bug where switching models in QuickPage blocked or failed if current webview was not fully loaded
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`

### 13:03 | Antigravity

- done: Task 4: verified build and lint for quick window cache and text carry-over

### 13:02 | Antigravity

- done: Task 3: QuickPage webview caching + input text carry-over on model switch
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`

### 13:01 | Antigravity

- done: Task 2: add getInputText method to WebviewCardRef interface
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 13:00 | Antigravity

- done: Task 1: add generateGetInputTextScript for reading webview input text
- modified:
  - `src/shared/utils/webviewScripts.ts`

### 12:45 | Antigravity

- done: Updated unpromoted lesson tags to promoted
- modified:
  - `SESSION_LOG.md`

### 12:45 | Antigravity

- done: Created macOS title bar adaptation plan and added macOS verification task to TODO
- added:
  - `docs/superpowers/plans/2026-06-29-macos-titlebar-adaptation.md`
- modified:
  - `TODO.md`

### 00:02 | claude-code

- done: 更新 TODO.md：check 掉已实现的划词悬浮 Toolbar 和调研任务，新增 4 个 TODO（任务分配模式待设计、辩论模式待设计、CLI 待验收、CLI exec 挂起轮询改进），补充 2026-06-28 已完成条目
- decision: 任务分配和辩论模式 UI 入口已存在（Layout.tsx 三选一分段控件），但具体行为逻辑尚未设计；CLI exec 当前为异步两步操作（exec + collect），应改为发送后挂起轮询输出
- modified:
  - `TODO.md`

