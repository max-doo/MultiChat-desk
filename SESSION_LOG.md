# Session Log

## 2026-07-03

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
- lesson: useMemo 引用同组件 useState 变量时必须声明在其后，否则渲染期访问 const TDZ 抛 'Cannot access X before initialization' 致整页黑屏；eslint react-hooks 与 tsc 均不报此顺序错，必须 npm run dev 实跑确认。

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
- lesson: 休眠 suspend 实现只 setIsHibernated+invisible 隐藏，并未 loadURL('about:blank')，渲染进程未真正释放，只省活跃 JS/网络轮询——与 KNOWLEDGE 第79条「隐藏未销毁 webview 仍占完整渲染进程」一致；真要省进程内存需改 suspend 主动卸载，但会与「保留会话连续性」决策冲突
- lesson: 移植 eb4791d 休眠调度到 main 的关键不兼容：recovery 用 ${productMode}-${i} 作休眠 key 并 split('-') 解析，但 main 的 getRefCallback 把 ref 注册到 slot-${i} 和 model.id 两个键，没有 ${productMode}-${i} 键——照搬 executeHibernate 会因 modeModels['slot'] 为 undefined 直接 return，休眠永不触发，必须重写 key→ref 查找
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
- lesson: 改前先 grep 函数调用点：计划若基于某函数'高频被调'做优化，必须先验证它真的有调用方——updatePlatformAnswer 被当成网络流式去重目标，实则整个 src/ 无调用方（死代码），优化它零收益。
- lesson: stopMonitoring 类停止函数加兜底写时，注意调用顺序：必须在 set 重置 monitor.currentTurn=null 之前调 saveCurrentTurn，否则拿到 null 直接 early return；startMonitoring 重置路径要复用停止出口也同理（在 set 新 turn 之前调）。
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
- lesson: 总结页计算显示模型时需完整传入 productMode 和 slot 参数以确保与当前主窗口插槽配置一致；复用挂载的页面需避免用静态 ref 阻断数据加载的 useEffect

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

## 2026-06-28

### 21:07 | claude-code

- done: 排查并修复 electron-builder 打包 Windows 安装包失败问题（winCodeSign 符号链接解压需开发者模式）
- context: 用户要求打包 exe 安装文件并保证以后不再出此问题
- modified:
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): electron-builder 打包 Windows 失败根因：winCodeSign-2.6.0.7z 含 macOS 符号链接，7za 在 Windows 解压需 SeCreateSymbolicLink 权限（管理员或开发者模式），否则 exit 2 致打包失败。根因修复=开启 Windows 开发者模式（注册表 AllowDevelopmentWithoutDevLicense=1），已用清空缓存从零重打验证。勿用 .cmd 包装 7za：Node v24 CVE-2024-27980 禁止 shell:false spawn .cmd 会抛 EINVAL；且解压走 app-builder.exe(Go) 能跑 .cmd、打包走 Node execFile 不能跑 .cmd，造成迷惑假象。winCodeSign 版本号硬编码在 app-builder.exe 内、JS 读不到；缓存目录存在时 app-builder.exe 跳过解压，故缓存偶然生成时能蒙混但清空即复发。

### 20:24 | claude-code

- done: 测试 CLI 功能：daemon status/exec/collect 命令，验证参数校验、错误处理、JSON 输出。CLI 通信正常，豆包 exec 成功，collect 返回空（选择器过期）
- context: 在 feature/cli-daemon worktree 中测试 CLI，开发服务器已启动
- unresolved: ['豆包 collect 选择器过期；ChatGPT/DeepSeek 输入框选择器过期']

### 20:11 | Antigravity

- done: 实现 CLI Daemon 架构 (Tasks 1-5): SessionManager, AutomationService, Named Pipe Server, CLI Client, IPC Bridge
- decision: automation:send-prompt uses fixed 5s delay between exec and collect; callers needing precise completion should use exec+poll pattern instead
- added:
  - `src/main/services/SessionManager.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/index.ts`
  - `src/cli/commands.ts`
  - `src/cli/client.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/htmlToMarkdown.ts`
  - `build/multichat-cli.cmd`
  - `build/multichat-cli.sh`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/utils/webviewScripts.ts`
  - `src/renderer/src/utils/htmlToMarkdown.ts`
  - `package.json`
  - `electron-builder.yml`
  - `tsconfig.node.json`
- lesson(promoted): CLI --json mode: ALL output (including errors) must use process.stderr.write for errors; only final successful data goes to stdout via console.log

### 20:06 | Antigravity

- done: Task 5: 重构 Renderer 与 Main 的通信桥梁
- decision: appStore.sendMessageToAll 使用 WebviewCardRef 抽象层而非直接 executeJavaScript，无需迁移；新的 automationSendPrompt/automationCollect 是独立的 CLI 驱动接口
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`

### 20:03 | claude-code

- done: 新增 Task 4 事件驱动自动保存：sniffer 推送 __MM_REPLY_DONE__(含请求体提取的 prompt)→WebviewCard console-message 接收→appStore.recordSniffedTurn(活跃monitor直接落库+跳过DOM轮询；手动聊天续接同平台同URL历史)。消除 pollPlatforms 反复 DOM 爬取、补齐单webview手动聊天盲区。无新增 IPC
- context: 复用既有 __MM_LOG__ console-message 通道与 shouldStartNewConversation URL 判定；用户选定手动聊天续接同平台最近一条
- decision: 请求体解析 prompt 只读不改、低风险不触 TOS；pollPlatforms 降级为 sniffer 失效站点兜底
- modified:
  - `docs/superpowers/plans/2026-06-28-resilient-webview-automation.md`

### 19:49 | Antigravity

- done: Implement CLI client and packaging scripts
- added:
  - `src/cli/index.ts`
  - `src/cli/commands.ts`
  - `src/cli/client.ts`
  - `build/multichat-cli.cmd`
  - `build/multichat-cli.sh`
- modified:
  - `package.json`
  - `package-lock.json`
  - `electron-builder.yml`
  - `electron-builder-portable.yml`
  - `tsconfig.node.json`

### 19:47 | claude-code

- done: 按二级菜单/正则区分搜索反馈重做方案二：step schema 扩展 regex/exclude/wordBoundary/caseSensitive/menuOpenerFallback；findElement 匹配层升级为 matchText(单词边界解决Search/Research误匹配)；新增跨步菜单兜底 findMenuOpener；selectors.ts 易误匹配条目改用 regex+exclude；记录非DOM替代方案调研(网络改写/CDP输入)经评估暂不采用
- context: 用户选定 DOM 强化路线、CDP 暂不纳入
- modified:
  - `docs/superpowers/plans/2026-06-28-resilient-webview-automation.md`

### 19:34 | Antigravity

- done: Resolve stream buffering race condition and improve parameter fallback in ipcServer
- modified:
  - `src/main/daemon/ipcServer.ts`

### 19:26 | Antigravity

- done: Implement Named Pipe daemon server for CLI commands
- added:
  - `src/main/daemon/ipcServer.ts`
- modified:
  - `src/main/index.ts`

### 19:21 | claude-code

- done: 按评审意见修订 Resilient Webview Automation 方案：方案二改为最小增量兜底并收紧匹配；方案三补多平台 payload 适配/行缓冲/流完成判定/降级日志；Task3 锚点精确化、commit 改为需用户确认
- modified:
  - `docs/superpowers/plans/2026-06-28-resilient-webview-automation.md`

### 19:15 | Antigravity

- done: Fix Code Quality Reviewer issues in AutomationService
- decision: Inject electron-store into AutomationService to support reading custom selectors in main process, and clean up load listeners on timeout.
- modified:
  - `src/main/index.ts`
  - `src/main/services/AutomationService.ts`

### 18:59 | Antigravity

- done: Task 2: 抽取执行内核 - Automation Service (Main Process)
- decision: Move selectors and webviewScripts (with htmlToMarkdown) to src/shared and re-export in renderer to maintain backward compatibility.
- added:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/htmlToMarkdown.ts`
  - `src/main/services/AutomationService.ts`
- modified:
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/utils/webviewScripts.ts`
  - `src/renderer/src/utils/htmlToMarkdown.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`

### 18:38 | Antigravity

- done: Code Review fixes for Task 1: disable backgroundThrottling and handle about:blank
- decision: 在后台 BrowserWindow 设置 backgroundThrottling: false 确保定时器和DOM轮询不被降频；完善页面初始状态 URL 为 '' 或 'about:blank' 时的导航判断
- modified:
  - `src/main/services/SessionManager.ts`

### 18:31 | Antigravity

- done: Task 1: 抽取执行内核 - Session Manager (Main Process)
- decision: 使用 BrowserWindow(show: false, partition: 'persist:shared') 构建后台长驻会话管理单例，复用现有 webview 拦截与脚本注入逻辑
- added:
  - `src/main/services/SessionManager.ts`
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`

### 18:26 | Antigravity

- done: 移除 Google Fonts 远程 CDN 依赖，通过 npm 内置 Material Symbols Outlined 和 Roboto 字体
- modified:
  - `package.json`
  - `package-lock.json`
  - `src/renderer/index.html`
  - `src/renderer/src/main.tsx`

### 18:21 | Antigravity

- done: Create git worktree for CLI daemon development at ../MultiChat-desk-cli
- added:
  - `../MultiChat-desk-cli (worktree)`

### 18:12 | Antigravity

- done: Update git remote origin URL to the new repository address https://github.com/max-doo/MultiChat-desk.git
- modified:
  - `.git/config`

### 17:55 | Antigravity

- done: 在生图模式下将总结按钮动态切换为一键下载按钮，并在 TODO.md 中记录后续具体下载功能实现的待办项
- modified:
  - `src/renderer/src/components/ControlBar.tsx`
  - `TODO.md`

### 17:42 | Antigravity

- done: 重构 AI 生图模式为提示词注入（Prompt Injection）模式，大幅优化交互响应和鲁棒性
- decision: 弃用容易因 UI 改版或多语言定位失效的 DOM 模拟点击开启生图菜单逻辑，改为在发送时判断开启状态自动追加生图指令前缀
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 17:30 | Antigravity

- done: 交换新建对话与AI生图按钮位置，增加二选一互斥逻辑并统一AI生图的主题高亮样式
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 17:27 | Antigravity

- done: Change the deep research and image generation icon colors to gray in the model selection dropdown menu
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 17:24 | Antigravity

- done: 在主页面单窗口模式下隐藏底部工具栏
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 17:18 | claude-code

- done: 划词悬浮工具条改用 UI Automation 读取选区替代 Ctrl+C：新增常驻 PowerShell UIA helper（行JSON协议+base64传文本+UTF-8），inputHookManager 按下/松手两次 UIA 读取对比实现拖拽+新选区双条件触发，toolbar:trigger-action 改用缓存文本不发 Ctrl+C，启动预建工具条窗口。修复终端选词杀进程/Word迷你工具条被抢占/拖窗口误弹三个bug
- added:
  - `src/main/uiaSelectionHelper.ts`
- modified:
  - `src/main/inputHookManager.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/index.ts`
- removed:
  - `scripts/diag-uia-selection.ps1`
- lesson(promoted): 划词工具条读取选区应用 UI Automation(TextPattern.GetSelection)替代 Ctrl+C 模拟复制：非侵入、不杀终端进程、不抢Word工具条、可对比新旧选区避免拖窗口误弹。需常驻 PowerShell helper(行JSON协议，文本走base64规避 PS5.1 ConvertTo-Json不转义换行 与中文Windows GBK乱码)，stdin关闭即exit+懒重启防僵尸。覆盖:Word/WindowsTerminal/Chrome可读;VS Code编辑器/记事本不可读→安全降级不弹(其AI划词由全局快捷键Ctrl+C路径覆盖)

### 15:27 | claude-code

- done: 为 WebviewCard 增加初始加载诊断：错误分类(无网络/DNS/超时/连接失败)、30s 首次加载超时、动态计时与取消按钮、分类驱动的错误覆盖层
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 15:20 | claude-code

- done: 排查划词工具条是否会让 Word 迷你工具条消失：用 MM_TOOLBAR_SKIP_PROBE 诊断开关对比，两种方式无差异且 Word 工具条均正常显示，证伪 Ctrl+C 探测与窗口显示两个假设；问题在当前构建未复现。移除临时诊断开关，保留选区探测
- context: 用户报告 Word 弹窗被覆盖/消失；诊断未复现，疑为中途 UI 调整(14:13/14:30)顺带缓解或偶发。如再次复现需补充具体场景(应用/选区方式/时序)
- modified:
  - `src/main/inputHookManager.ts`

### 15:09 | Antigravity

- done: 优化快捷工具条的UI，减少padding，降低工具条及窗口高度，且不改变图标和文字大小
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`

### 15:08 | claude-code

- done: 完成划词悬浮工具条完整功能：ToolbarPage UI 重构、文本选区探测、ShortcutRecorder 组件、搜索/快捷动作、monio-napi 数组派发修复、工具条开关设置
- added:
  - `src/renderer/src/components/ShortcutRecorder.tsx`
- modified:
  - `src/main/index.ts`
  - `src/main/inputHookManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/shortcutManager.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 15:07 | Antigravity

- done: Optimize floating selection toolbar UI by reducing padding and sizes to decrease its overall height from 48px to 36px
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`

### 14:55 | Antigravity

- done: Slightly increased other action icon sizes (search, compress, translate, copy) from 16px to 20px on selection floating toolbar.
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:51 | Antigravity

- done: Increased size of '问问' icon on selection floating toolbar to twice as large (w-7 h-7 / 28px).
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:50 | Antigravity

- done: Adjusted selection floating toolbar UI: removed capsule pill rounded corners, removed button divider lines, reduced padding/spacing for compactness, added '问问' button with product logo to copy selected text into quick window input, adjusted button order (quick, search, summarize, translate, copy), and updated summarize icon to compress.
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`

### 14:49 | claude-code

- done: 修复划词悬浮工具条无选中文本也弹出的问题：松手后先用 getSelectedTextAsync(false) 探测选区，空则不弹；恢复 isAppFocused 守卫与收紧手势阈值
- modified:
  - `src/main/inputHookManager.ts`
- lesson(promoted): 划词工具条不能仅凭鼠标手势弹窗：全局鼠标钩子无法判断光标下是否为可文本选区，唯一可靠的跨进程选区信号是模拟 Ctrl+C 探测剪贴板；手势→直接弹窗 必然导致拖窗口/滚动条/空白也误弹

### 14:30 | Antigravity

- done: 优化工具条阴影使其更加轻盈，并修复点击外部需要等待2-3s才消失的BUG，实现取消划词时点击外部区域秒级立即隐藏
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`
  - `src/main/inputHookManager.ts`

### 14:29 | Antigravity

- done: 修复快捷键录制组件在Windows中文输入法下按住Ctrl+Shift会被过早截断只能记录2个键的Bug
- modified:
  - `src/renderer/src/components/ShortcutRecorder.tsx`
- lesson(promoted): Windows Chrome/Electron中中文输入法对Ctrl+Shift热键响应时会发送e.key='Process'或keyCode=229事件，快捷键录制组件必须将其过滤并视为暂态修饰事件，防止过早触发提交

### 14:24 | Antigravity

- done: 优化快捷键设置UX为业界标准的交互式捕获录制组件，支持按键徽章展示、一键清空与重置默认值
- added:
  - `src/renderer/src/components/ShortcutRecorder.tsx`
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 14:22 | Antigravity

- done: 修复划词工具条外部矩形容器问题：在ToolbarPage挂载时强制清除全局 body/html/root 的背景样式，实现真正无边框纯圆角胶囊悬浮效果
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:19 | Antigravity

- done: 设置其他快捷键默认值为空时 placeholder 采用之前默认设置组合键
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 14:13 | Antigravity

- done: 优化划词工具条UI：去除了所有Icon的高亮颜色采用统一无色文字说明，去除了包裹外部容器使页面呈现出只有毛玻璃样态工具条的纯粹UI效果，调整窗口宽高适配文本按钮
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`

### 14:10 | Antigravity

- done: 为快捷窗口增加搜索提示词及搜索动作支持，默认关闭除召唤以外的全局快捷键，并在设置中增加划词悬浮工具条开启/关闭开关与搜索按钮
- modified:
  - `src/main/shortcutManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/index.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 14:00 | claude-code

- done: 清除划词工具条 inputHookManager.ts 中两条每次触发都打印的调试日志（MouseReleased / Double click detected），逻辑与判定不变。
- context: 上一条会话条目的收尾清理；保留 start/stop/Failed/Detected selection gesture 等关键节点日志。
- modified:
  - `src/main/inputHookManager.ts`

### 13:56 | claude-code

- done: 修复划词悬浮工具条永不触发：monio-napi 的 startListen 回调运行时按 EventJs[] 数组批量派发（d.ts 标注为单个 EventJs，与运行时不符），直接读 event.eventType/event.mouse 全得 undefined，导致探针条件永不命中、button=undefined、distance=NaN。改为 Array.isArray(payload)?payload:[payload] 解包后逐条 processEvent。实测工具条可正常触发。
- context: 本轮用 systematic-debugging 证伪了交接报告里的 4 个假设（原生二进制缺失/eventMask 漏发/out bundle 陈旧/electron-vite 打包破坏），并用 console.log(JSON.stringify(event)) 揭示 raw=[{...}] 即数组真身，定位真因。同时纠正 KNOWLEDGE.md 中前一会话误写的“嵌套对象”教训（实为数组）。临时诊断脚本 scripts/diag-monio.js 与 index.ts 临时 process 异常监听均为本轮创建后删除/还原，净零未留存。
- decision: 保留 startListen 单回调用法（而非退回 InputHook），因为 eventMask=2047、isRunning=true 已证实库在 Electron 内正常工作，真因仅在载荷形状。
- modified:
  - `src/main/inputHookManager.ts`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): monio-napi startListen 回调实为 EventJs[] 数组派发，d.ts 与运行时不符；回调字段全 undefined 时，先用 JSON.stringify(event) 看输出是否以方括号开头（数组），勿猜嵌套字段名、勿归咎 OS 消息循环或库损坏。修复：Array.isArray(payload)?payload:[payload] 逐条处理。
- unresolved: ['InputHook.onMouseXxx 是否同样按数组派发未单独验证（仅见历史 button=undefined 症状）；如未来用回 InputHook 需先确认。']

### 13:08 | Antigravity

- done: 全面迁移 monio-napi 的 InputHook 至官方主推的 startListen API，解决底层事件包装结构差异导致坐标为 0 的问题
- decision: 废弃偏差较多的 InputHook 类，改用官方 README 中提供完整结构保证和实战示例的全局 startListen 回调
- modified:
  - `src/main/inputHookManager.ts`

### 13:04 | Antigravity

- done: 修复 monio-napi 底层嵌套结构导致划词坐标与按键为 undefined 从而计算出 distance=NaN 的Bug
- modified:
  - `src/main/inputHookManager.ts`
- lesson(promoted): 在使用 monio-napi 的 InputHook (如 onMouseDown / onMouseUp) 时，虽然 TypeScript 声明为扁平结构 MouseButtonEventJs { x, y, button }，但运行时实际传递的是嵌套的 EventJs { mouse: { x, y, button } } 对象，必须使用兼容函数优先从 e.mouse 中解包获取坐标与按键

### 13:02 | Antigravity

- done: 修复划词悬浮工具条无法触发的问题：移除应用内焦点拦截、放宽手势判定门槛并增强按键兼容性
- decision: 放宽左键判定以兼容 N-API 跨层传递的 button 字段差异；移除 duration 上限以支持长文本慢速划选；移除 isAppFocused 拦截支持全局触发
- modified:
  - `src/main/inputHookManager.ts`

### 12:54 | Antigravity

- done: 实现类似豆包与桌面划词翻译的悬浮工具条（Selection Floating Toolbar）
- decision: 采用无焦点（focusable: false）和 showInactive() 悬浮工具条，避免抢夺外部应用焦点导致选区高亮丢失；基于 screen 逻辑坐标系定位消除高 DPI 错位风险；动作触发时严格遵循先复制后 focus 规则
- added:
  - `src/main/inputHookManager.ts`
  - `src/renderer/src/pages/ToolbarPage.tsx`
- modified:
  - `package.json`
  - `package-lock.json`
  - `electron-builder.yml`
  - `src/main/index.ts`
  - `src/main/shortcutManager.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/App.tsx`

### 12:07 | Antigravity

- done: 修复快捷键注入内容时重复注入及发送后继续注入的Bug
- modified:
  - `src/renderer/src/utils/webviewScripts.ts`
- lesson(promoted): 在往富文本编辑器（如 Slate/Lexical/contenteditable）注入带有换行符或多行文本时，编辑器会将其格式化为 HTML 标签，读取 textContent 会丢失换行导致全等校验失败，因此执行完插入后应直接返回成功从而停止重试轮询

### 12:02 | claude-code

- done: 将 AI 平台 logo 从外部 CDN 链接迁移为本地资源，支持离线显示
- added:
  - `src/renderer/src/assets/logos/ (13 个 logo 文件: chatgpt.svg`
  - `gemini.png`
  - `grok.png`
  - `claude.svg`
  - `perplexity.png`
  - `arena.png`
  - `doubao.png`
  - `yuanbao.png`
  - `qwen.svg`
  - `deepseek.png`
  - `kimi.ico`
  - `chatglm.ico`
  - `yiyan.ico)`
- modified:
  - `src/renderer/src/store/appStore.ts (logo 引用从外部 URL/base64 改为 Vite 静态资源 import)`

### 11:58 | Antigravity

- done: 修复划词快捷键未选中内容时呼出弹窗及误把陈旧剪贴板当做选中文本的Bug
- modified:
  - `src/main/shortcutManager.ts`
- lesson(promoted): 遇到划词快捷键时需区分主动呼出和划词操作，获取选中文本失败后切勿兜底返回陈旧剪贴板数据

### 11:45 | Antigravity

- done: 优化快捷弹窗召唤置顶逻辑，解决 Windows 下后台召唤仅闪烁和不可见隐藏问题
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/shortcutManager.ts`
  - `src/main/ipcHandlers.ts`
- lesson(promoted): 在 Windows 平台下，Electron 后台窗口直接调用 focus() 会被操作系统防抢焦点机制拦截导致任务栏闪烁，通过临时开启 alwaysOnTop 置顶再取消可实现稳定强行聚焦置顶

### 11:36 | Antigravity

- done: 修改了快捷弹窗的翻译提示词，调整为如果是英文则翻译成中文，如果是中文则翻译成英文
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`

### 11:33 | Antigravity

- done: 快捷键自动复制文本优化：采用 VBScript 与按键释放缓冲方案解决修饰键冲突与焦点抢占问题
- modified:
  - `src/main/shortcutManager.ts`
- lesson(promoted): 在全局快捷键触发自动复制时，必须：1) 延迟250ms等待用户释放物理按键以防Ctrl+Shift+C冲突；2) 在展示/聚焦快捷窗口前执行复制以防焦点被抢占；3) 采用 VBS 脚本启动速度更快(约10ms)且不抢焦点。

### 01:31 | claude-code

- done: 添加三个 TODO 到 TODO.md
- modified:
  - `TODO.md`

### 01:26 | claude-code

- done: 提交综合 commit：快捷窗口 pin 切换、拖拽支持、尺寸约束、修复剪贴板自动复制焦点顺序 Bug、提取 webview 处理器公共函数
- modified:
  - `src/main/ipcHandlers.ts src/main/shortcutManager.ts src/main/webviewManager.ts src/preload/index.d.ts src/preload/index.ts src/renderer/src/components/WebviewCard.tsx src/renderer/src/pages/QuickPage.tsx .memory/KNOWLEDGE.md SESSION_LOG.md`

### 01:20 | Antigravity

- done: 修复快捷窗口自动复制 Bug：焦点顺序错误导致 SendKeys 打到错误窗口
- decision: 改用 execFileSync + Atomics.wait 实现同步阻塞式等待：确保按键模拟、剪贴板读取全部在 show/focus 之前完成
- modified:
  - `src/main/shortcutManager.ts`
- lesson(promoted): 全局快捷键触发后若立即 show/focus 自身窗口，焦点会从用户原始窗口转移，导致 SendKeys 模拟 Ctrl+C 打到 Electron 自己而非目标应用；必须先完成 SendKeys+读剪贴板，再 show/focus 窗口

### 01:16 | Antigravity

- done: 快捷窗口自动复制选中文本：去掉手动 Ctrl+C 步骤
- decision: 用 PowerShell SendKeys 模拟 Ctrl+C 自动复制，零新依赖，Windows 专属；非 Windows 降级读现有剪贴板
- modified:
  - `src/main/shortcutManager.ts`
- lesson(promoted): PowerShell execFile 方式比 exec 字符串更安全，避免引号转义问题；先清空剪贴板再模拟复制，可以可靠地检测是否真的有内容被选中

### 01:14 | Antigravity

- done: 修复快捷窗口外部链接无法打开系统浏览器的 Bug
- modified:
  - `src/main/webviewManager.ts`
- lesson(promoted): 快捷窗口（quickWindow）是独立的 BrowserWindow，主窗口的 did-attach-webview 监听器不会自动继承给快捷窗口；任何新增窗口都需要单独为其 webContents 注册 did-attach-webview 事件，否则该窗口内 Webview 的脚本注入和链接拦截将完全失效

### 01:10 | Antigravity

- done: Fix quick window: default alwaysOnTop=false, skipTaskbar=false, isPinned=false
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/pages/QuickPage.tsx`
- lesson(promoted): quickWindow 初始配置 alwaysOnTop 和 skipTaskbar 应默认关闭，让用户通过 pin 按钮自行决定；skipTaskbar=true 会导致被遮挡后无任务栏入口找不回窗口

### 01:05 | Antigravity

- done: Implement shortcut window size constraints (320x480), window pinning toggle, and icon updates
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:59 | Antigravity

- done: Implement dragging functionality for the shortcut window header blank area by integrating WebviewCard onDragStart with QuickPage isDraggingRef
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:56 | Antigravity

- done: Disable quick window auto-hide on blur/loss of focus
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `docs/superpowers/plans/2026-06-28-disable-quick-window-blur-hide.md`

### 00:51 | Antigravity

- done: 同步修改主进程中主窗口控件背景色，消除标题栏与渐变背景色差
- modified:
  - `src/main/webviewManager.ts`

### 00:48 | Antigravity

- done: 将应用背景渐变色调淡一点
- modified:
  - `src/renderer/src/assets/index.css`

### 00:41 | Antigravity

- done: 修复快捷助手模型切换受限 Bug，并增加 flat 属性彻底去除 WebviewCard 外层容器视觉
- decision: QuickPage 放开已开启模型过滤查询全量 models；WebviewCard 支持 flat 无边框模式，外层 padding 设为 p-0。
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:36 | Antigravity

- done: 直接复用 WebviewCard 渲染快捷助手窗口，移除外层包装容器，并将主界面与关闭操作按钮直接无缝嵌入 WebviewCard 头部。
- decision: WebviewCard 扩展 headerActions 与 draggableHeader 属性；QuickPage 根节点直接渲染 WebviewCard。
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:28 | Antigravity

- done: 重构快捷助手弹窗 (QuickPage)，直接复用 WebviewCard 组件，移除底部多余输入框，支持将提示词直接注入目标 AI 网页输入框，并对齐应用浅色毛玻璃主题风格。
- decision: 直接复用 WebviewCard (设置 compact, hideHeader, isolated)；增加 15 次/500ms 的异步重试注入机制以应对 Webview 初始启动延迟。
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:12 | Antigravity

- done: Mark all checkboxes complete in Desktop Quick Access plan
- modified:
  - `docs/superpowers/plans/2026-05-04-desktop-quick-access-plan.md`

### 00:10 | Antigravity

- done: Task 7: shortcutManager module and custom shortcuts setting drawer UI
- added:
  - `src/main/shortcutManager.ts`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `CHANGELOG.md`

### 00:04 | Antigravity

- done: Task 6: clipboard text summon and prompt injection MVP shortcuts
- modified:
  - `src/main/index.ts`
  - `CHANGELOG.md`

### 00:01 | Antigravity

- done: Task 5: cross-window state broadcast via stateBus and Zustand subscribe
- added:
  - `src/main/stateBus.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `CHANGELOG.md`

## 2026-06-27

### 23:58 | Antigravity

- done: Task 4: QuickPage renderer and #quick routing
- added:
  - `src/renderer/src/pages/QuickPage.tsx`
- modified:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `CHANGELOG.md`

### 23:55 | Antigravity

- done: Task 3: quick window lifecycle and global summon shortcut
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `CHANGELOG.md`

### 23:52 | Antigravity

- done: Task 2: system tray with show/hide/quit menu
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `CHANGELOG.md`

### 23:48 | Antigravity

- done: Task 1: intercept main window close to hide instead of quit
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`
  - `CHANGELOG.md`

### 23:45 | Antigravity

- done: Clean up obsolete BrowserPage legacy component and associated routing/state
- modified:
  - `README.md`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/ModelOutputCard.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`
  - `src/renderer/src/store/appStore.ts`
- removed:
  - `src/renderer/src/pages/BrowserPage.tsx`

### 23:39 | Antigravity

- done: 将抽屉 Header 内的 Logo 尺寸由 w-8 h-8 进一步放大至 w-10 h-10
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:38 | Antigravity

- done: 将历史记录抽屉宽度改为500px，统一放大 Logo 图标尺寸至 w-8 h-8
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:37 | Antigravity

- done: 调整抽屉面板 UI 布局，添加 Logo 及产品名称，标题居中，设置页使用说明移至选项内并去除 footer
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:36 | claude-code

- done: 修正 Desktop Quick Access Plan 文档中的 8 项技术问题
- context: 评估 desktop-quick-access-plan 合理性后修正文档
- modified:
  - `docs/superpowers/plans/2026-05-04-desktop-quick-access-plan.md`
- lesson(promoted): Electron webview 内部点击触发父 BrowserWindow blur;setTemplateImage 是 Tray 方法而非 NativeImage 方法;Quick Window 不应包裹主窗 Layout 组件;Ctrl+Shift+C 与 Chrome DevTools 冲突需全局拦截

### 23:35 | Antigravity

- done: 为抽屉组件添加圆角，抽屉打开时，遮罩去掉模糊效果
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:30 | Antigravity

- done: 调整 WebView 卡片和底部 control bar 之间的间距为最初的1/2 (pb-3 -> pb-5)
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 23:29 | Antigravity

- done: 修复主界面会话锁定（模型锁定）污染并导致总结页 Webview 模式下模型切换下拉框被禁用的 Bug
- decision: 为 WebviewCard 增加 isolated 属性，使得总结页等独立工作区的 Webview 组件不受主界面会话锁定的影响
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`

### 23:29 | Antigravity

- done: 减小 WebView 卡片和底部 control bar 之间的间距 (pb-10 -> pb-3)
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 22:57 | Antigravity

- done: Lock layout mode buttons when restoring a history session
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 22:55 | Antigravity

- done: Hide individual 'New Conversation' button in multi_ai and debate modes to enforce global session consistency
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 22:46 | Antigravity

- done: Preserve Webview states in the background when switching productMode to prevent conversation loss
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 22:31 | Antigravity

- done: Decouple sending logic from displayMode and lock layout switcher
- modified:
  - `src/renderer/src/store/appStore.ts src/renderer/src/components/Layout.tsx`

### 22:24 | Antigravity

- done: Fix webview ref leak and duplicate refreshes, lock session model choices
- modified:
  - `src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx src/renderer/src/components/ControlBar.tsx src/renderer/src/components/WebviewCard.tsx`

### 22:20 | Antigravity

- done: Implement pointer-capture IPC window dragging, independent Multi-AI slots configuration, and Google login UA bypass
- added:
  - `docs/drag-fix-experience.md`
  - `scripts/verify-titlebar-drag-contract.js`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/store/appStore.ts`
- lesson(promoted): Complex Electron titlebar dragging with app-region:drag on Windows can cause hit-test click-through issues and recursive window-resizing bugs; use JS pointer capture and IPC win.setContentBounds as a reliable workaround.

### 21:51 | Antigravity

- done: Fix webview refs memory leak causing New Chat to refresh historic and duplicate model windows
- modified:
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/components/ControlBar.tsx`

### 21:04 | Antigravity

- done: Fixed window dragging functionality by replacing inline WebkitAppRegion styles with explicit CSS classes on all header layout components to bypass React style stripping and Chromium bubbling bugs.
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 20:52 | Antigravity

- done: 基于全 CSS Grid 的统一布局重构完成，利用 position: absolute 及 visibility: hidden 安全隐藏 Webview 插槽以实现零重载瞬间切换
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 20:47 | Antigravity

- done: 恢复此前因冲突丢失的 MainPage.tsx 关于生成总结时爬取模型回答的 10 秒超时限制和 ESC 按键强行退出机制修改
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 20:45 | Antigravity

- done: 修复因为缺少 currentPage 和 apiConfig 解构导致应用白屏崩溃的问题
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 20:43 | Antigravity

- done: 恢复了被意外删除的总结页顶部 API/Webview 切换控件并对齐了样式
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 20:37 | Antigravity

- done: 应用户要求，回滚 MainPage.tsx 代码至修改前的状态
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 17:38 | Antigravity

- done: Prepare batch commits and clean up unused imports
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`

### 17:27 | Antigravity

- done: Replace top product title with mode segmented control (Multi-AI, Task Assignment, Debate) and support same model multi-slot selection in task assignment mode
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/Layout.tsx`

### 17:26 | Antigravity

- done: Investigated opening external links in default browser and drafted implementation plan using writing-plans skill and context7 official Electron docs
- added:
  - `docs/superpowers/plans/2026-06-27-open-external-links-in-default-browser.md`

### 17:18 | Antigravity

- done: 修复设置抽屉及其他抽屉顶部关闭按钮在 Electron 窗口拖拽区域被拦截导致无法点击的热区冲突问题
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 17:09 | Antigravity

- done: 将底部的设置和历史记录按钮迁移到顶部标题栏红框区域，与窗口控件放在一行，改造为纯图标按钮
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/SummaryPage.tsx`
  - `src/renderer/src/App.tsx`

### 17:01 | Antigravity

- done: Change Claude's logo icon to a custom SVG path with brand color
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:41 | Antigravity

- done: Updated Grok logo to black variant for light themes
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:36 | Antigravity

- done: Updated Grok logo to stable public jsDelivr CDN icon URL
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:28 | Antigravity

- done: 使用 Material Symbol 'biotech'（显微镜）代表深度研究，使用 'image'（图片）代表生图，只在下拉列表选项中显示，并同步更新底部控制栏中的深度研究按钮图标
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/ControlBar.tsx`

### 16:23 | Antigravity

- done: Updated Grok logo to official favicon
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:21 | Antigravity

- done: 将模型下拉列表中的深度研究标签替换为望远镜图标，并在支持生图的模型后面展示生图（图片）图标；同时同步替换底部控制栏中的深度研究按钮图标
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/ControlBar.tsx`

### 16:20 | Antigravity

- done: Updated Wenxin Yiyan website URL to chat.baidu.com and updated its logo
- modified:
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/store/appStore.ts`

### 16:10 | Antigravity

- done: 删除设置抽屉中的模型排序功能，并在 Webview 窗口的模型下拉列表中的模型名称后面显示深度研究标签
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`

### 16:05 | Antigravity

- done: Added DeepSeek web support with logo and elements integration
- modified:
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/utils/webviewScripts.ts`

### 16:00 | Antigravity

- done: Updated minimum pane width to 320 for four window layout
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 15:58 | Antigravity

- done: 将下拉列表组件的背景改成毛玻璃效果
- modified:
  - `src/renderer/src/components/CustomDropdown.tsx`

### 15:58 | Antigravity

- done: Adjusted MIN_PANE_WIDTH to 280 for better responsiveness on scaled resolutions
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 15:53 | Antigravity

- done: Reduce segmented layout control padding and height to prevent touching title bar edges
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 15:49 | Antigravity

- done: Updated four-window display mode layout logic
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 15:47 | Antigravity

- done: Update segmented layout control styling to match bottom toolbar buttons using glass-panel
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 15:44 | Antigravity

- done: Change layout controls to segmented control, remove reset button, and trigger reset on layout change
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 15:25 | Antigravity

- done: Move window layout buttons to top title bar
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 15:19 | Antigravity

- done: Fix minimum window size missing properties
- modified:
  - `src/main/webviewManager.ts`

