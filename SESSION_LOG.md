# Session Log

## 2026-10-06

### 12:02 | Antigravity

- done: 升级应用版本至 v1.3.0 并更新 CHANGELOG.md，准备提交修改与 NSIS 安装包打包
- decision: 按用户确认将目标版本升级为 v1.3.0（次版本），打包目标选定为 NSIS 安装包
- added:
  - `docs/mindmap-rewrite-design.md`
- modified:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`
  - `src/main/services/MindmapService.ts`
  - `src/shared/types/notes.ts`
  - `src/shared/utils/mindmapEdits.ts`
  - `src/shared/utils/webviewScripts.ts`

### 07:02 | Codex

- done: 完成导图双协议接入及范围审查：lint与build成功，在现有dev Electron窗口开发工具用合成数据验证19个解析场景与9个采集场景均通过
- context: 两侧tsc被本次未修改文件中的既有错误阻塞；新启动dev因单实例锁退出，未覆盖真实AI生成到候选应用的整条链路
- modified:
  - `src/shared/types/notes.ts`
  - `src/shared/utils/mindmapEdits.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `docs/mindmap-rewrite-design.md`
- unresolved: 重启开发实例后验证真实AI局部修改、整图重写、继续调整及应用期间的编辑冲突；定向类型检查已有错误未在本次范围内修复

### 00:23 | Codex

- done: 接入导图局部替换与整份覆写两种结果协议，去掉 edit 外层并应用精简提示词，开始验证
- decision: 覆写正文校验后直接进入现有候选流程；局部替换失败不升级覆写，IPC与持久化结构保持兼容
- modified:
  - `src/shared/types/notes.ts`
  - `src/shared/utils/mindmapEdits.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `docs/mindmap-rewrite-design.md`

### 00:14 | Codex

- done: 精简整份覆写设计中的提示词与来源说明，固定模板由2718字符减少至1469字符，保留模式边界、材料依据和精确替换格式约束
- decision: 合并重复范围和输出限制，压缩内容质量要求与示例；保留唯一匹配、完整行、非重叠、删除空标签、末尾换行及完整覆写要求
- modified:
  - `docs/mindmap-rewrite-design.md`

### 00:10 | Codex

- done: 评估并简化整份覆写设计中的局部替换协议，移除 edit 分组标签，同步提示词、解析要求和验收场景
- decision: 固定按 old_text 后接 new_text 的完整标签对定义一次替换；缺段或乱序整批拒绝，无需额外 edit 外层
- modified:
  - `docs/mindmap-rewrite-design.md`

### 00:08 | Codex

- done: 完成当前导图整份覆写协议、候选应用流程和可直接接入的提示词设计，未修改运行时代码
- decision: 新增互斥的 mindmap_rewrite 输出协议，复用候选与冲突检查；默认局部修改，仅明确整图重组时覆写；来源重生成必须携带本轮附件
- added:
  - `docs/mindmap-rewrite-design.md`

## 2026-10-05

### 23:59 | Antigravity

- done: Enlarge mindmap initial requirements textarea font size and optimize card UI
- decision: Change empty-state textarea from text-xs to text-sm with leading-relaxed, ring focus and padded layout; upgrade button height and font to text-sm
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 23:47 | Codex

- done: 实施导图后台网页资源释放：成功和失败的可恢复隐藏网页保留2分钟，临时会话保留10分钟；可见预览不自动销毁，任务结束后手动关闭即销毁，取消立即释放隐藏网页，未提交附件取消即使可见也释放。任务结束恢复后台节流，连续修改关闭节流并取消闲置计时。已释放的生成网页可校验会话网址重开，仅查看不重发，候选独立保留。补齐加载失败、取消/超时后迟到窗口清理以及销毁时延迟注入回调清理。lint无错误、20项既有警告，build成功；dev中真实BrowserWindow、SessionManager和预览逻辑的隔离网页41项验证通过，测试加速闲置计时并核对生产120000/600000毫秒配置。两侧类型检查存在既有错误，当前导图服务未新增报错。
- decision: 仅在MindmapService维护一个闲置计时器和最近会话地址；共享Session和IPC返回契约保持兼容，重开网页不自动注入或发送。不可恢复会话释放后提示用户主动新建，完整来源仍通过Markdown附件传递。
- modified:
  - `src/main/services/MindmapService.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 真实AI平台的登录与会话恢复尚需完整重启应用后复测；当前运行实例占用单实例锁。未进行内存占用基准测量。

### 23:47 | Antigravity

- done: Remove diff change banner from mindmap candidate preview header
- decision: Completely remove the '本次变化 / 原内容变化' banner line in candidate preview mode to make header cleaner
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 23:45 | Antigravity

- done: Delete editor bottom shortcut hint bar and move floating mindmap toolbar from bottom-right to top-left
- decision: Remove bottom shortcut hint in markdown outline editor; move mindmap floating toolbar to left-3 top-3 to avoid obscuring leaf nodes, with dropdown direction set to down
- modified:
  - `src/renderer/src/components/MindmapMarkdownEditor.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`

### 23:38 | Antigravity

- done: Move mindmap composer collapse button below input box with text label
- decision: Remove collapse button inside composer and place it below composer right-aligned with label and icon
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 23:35 | Antigravity

- done: 优化思维导图修改后交互：移除修改前后对比Tab，应用修改后自动清除高亮，去除高亮节点前描边仅保留背景色
- decision: 移除compareView对比Tab并直接展示候选稿变化；应用修改后直接将marks设为null实现自动清除高亮并收起变化条；css移除inset box-shadow前描边
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/styles/localMindmap.css`

### 23:16 | Codex

- done: 导图附件发送恢复普通消息发送路径：按钮选择器未命中时允许原有 Enter 兜底，附件上传或解析中以及已识别按钮禁用时继续等待；带附件请求仅提交一次并等待输入框清空确认。同步设计文档。lint 0 错误、20 项既有警告；build 成功；dev 隔离 Electron 页面 54 项验证通过，覆盖首次生成和修改的 Enter 路径。
- decision: 取消强制找到按钮的前置限制，复用现有注入与发送实现；新增确认只针对附件请求，普通消息保持原有行为。
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 真实 DeepSeek 网页尚未执行发送复测；当前运行实例占用单实例锁，需完整退出并重新启动应用加载后台脚本。两侧类型检查仍存在此前已记录的无关错误。

### 22:47 | Codex

- done: 修正导图附件已挂载却发送前误判失败：提示词注入后15秒内每200毫秒等待附件与按钮就绪；向上识别同时含输入区/附件/按钮的共同容器，跳过禁用按钮候选；超时明确区分附件缺失、解析中、按钮未命中或未就绪。lint0错误（20既有警告）、build通过、Electron48项检查通过，覆盖1.2秒延迟、分层布局、单次发送及原附件/初次生成流程。
- decision: 等待期间只检查状态，不重复填入或自动重发；未确认附件与按钮就绪时不模拟Enter。保留15秒就绪等待上限与主进程30秒发送超时；平台明确失败立即停止。
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 未读取截图对应的实时DeepSeek DOM，仍需重启应用在真实会话复测；如果继续失败，新提示可区分等待延迟与按钮选择器未命中。常规npm run dev受现有单实例影响退出，以隔离Electron开发入口验证。测试负例超时缩短以避免额外等待；node/web类型检查既有错误未新增。

### 22:38 | Codex

- done: 首次生成导图复用完整来源主会话Markdown附件上传机制，正文引用本轮文件并明确要求阅读附件生成完整mindmap；添加真实Markdown围栏示例，保持原归纳规则与解析保存链路。lint0错误（20既有警告）、build成功，Electron41项检查通过，包含首次生成上传-发送-解析-保存及绑定、失败重试、取消、空来源与超限拒绝。
- decision: 首次生成与修改共享附件上传、发送前确认和清理，不截断或自动总结来源；初次生成正文只包含文件引用、额外要求和完整导图输出协议，保持60000字符来源上限及原有新图创建UI。
- modified:
  - `src/shared/utils/mindmap.ts`
  - `src/main/services/MindmapService.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 真实DeepSeek等平台附件读取及AI输出稳定性尚需重启应用后手动首次生成复测。npm run dev受现有单实例影响退出，隔离Electron入口验证真实CDP上传和完整服务保存链路。node/web类型检查仍有既有报错，无新增修改相关错误。

### 22:26 | Codex

- done: 导图修改将完整来源主会话作为Markdown附件上传，正文保留当前导图、要求和输出协议；复用总结拖拽实现，增加附件就绪及发送前检查、失败/超时/取消清理和残留页面重试保护；更新设计文档。lint0错误（20既有警告）、build成功、Electron附件31项/解析54项/上下文16项检查通过。
- decision: 只对需要来源上下文的修改请求上传完整md附件，不截断或总结主会话；保持既有上下文采集时机及60000字符上限；上传失败不降级为缺上下文发送；现有dispatch-file-drop IPC参数和返回契约不变。
- modified:
  - `src/main/services/AutomationService.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/mindmapEdits.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 常规npm run dev受当前运行单实例影响退出，隔离Electron页面完成真实CDP拖拽/File读取和服务链路验证；真实DeepSeek等平台附件解析状态与AI回复需重启应用后手动验收。node/web tsc仍有既有报错，无新增修改相关错误。

### 22:05 | Codex

- done: 修正导图修改提示词的代码块示例与无变化格式歧义，调整最终输出规则位置；修复无关代码节点阻挡标签正文采集，并对网页渲染列表提供明确格式错误。lint 无错误（既有20警告）、build成功、Electron临时诊断54项通过；检查总结Markdown附件链路并评估后台复用限制。
- decision: 保留完整来源主会话，不截断、不自动总结；本轮完成提示词和采集修正，Markdown附件仅评估，尚未接入后台上传链路。保留既有60000字符限制，超过时拒绝发送。
- modified:
  - `src/shared/utils/mindmapEdits.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
- unresolved: 真实DeepSeek格式稳定性需重启开发实例后以同一导图和要求复测；常规npm run dev受已有单实例影响退出，隔离Electron入口完成DOM验证；node/web tsc仍有既有报错，无新增修改相关错误。

### 21:43 | Codex

- done: 修正导图修改按物理代码节点数量提前拒绝的问题：仅在本轮最新回复中识别包含修改标签的代码文档，相同文本重复展示去重，无关代码不算修改结果；多份不同修改文档仍拒绝，协议结构与精确匹配检查保持。错误诊断增加修改文档数量。lint/build/diff 通过；Electron dev 标签与 DOM 诊断 47 项通过，新增两个代码节点但唯一标签结果、重复展示、不同结果和单代码多外层标签场景。同步设计文档。
- decision: 物理 DOM 代码节点不等同于逻辑修改结果；唯一标签文档才可进入解析。只统一换行和外围空白用于重复展示比较，保留输出载荷，不扫描旧回复、不从不同结果中猜测。
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 截图只能确认代码节点计数导致返回空文本，无法确认真实网页第二个节点具体属于隐藏副本还是其他代码；隔离 DOM 诊断通过后仍需更新应用，在真实 DeepSeek 会话重新提交验证。两侧 tsc 保留既有错误，无新增导图采集相关类型错误。

### 21:33 | Codex

- done: 补充来源就绪边界：复用生成会话且未要求上下文时允许来源 Webview 未就绪；确实需要上下文时才拒绝未就绪来源，避免静默使用快照。最终 lint/build 通过，Electron dev 模拟平台服务诊断扩充为 16 项并通过；两侧类型检查仅保留既有错误。
- modified:
  - `src/shared/types/notes.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: 真实来源采集、真实 AI 请求和 UI 勾选交互仍需手动验收；本轮模拟平台诊断验证了服务决策与提示词，不等价于实际平台端到端验收。

### 21:30 | Codex

- done: 实现导图修改的来源上下文：新建生成会话自动携带来源内容；复用时提供带上主会话最新内容选项；笔记页使用本地快照并提示可能过期。复用现有采集并检查来源归属、会话身份和完整性；采集失败、空快照与合计超限均不发送。新会话成功发送后才标记已初始化，失败重试仍自动携带上下文。lint、build、diff 检查通过；Electron dev 中 14 项模拟平台服务诊断通过。
- context: 保留现有工作区修改，不切分支、不加依赖；诊断使用临时目录、独立 Electron 用户目录和模拟平台，不访问用户登录数据。
- decision: 来源正文只由主进程按需获取，renderer 传选项及来源 Webview 身份；当前导图保持唯一替换基准。来源上下文、导图和要求合计 60000 字符，超限不截断；没有实时来源时显式使用快照。新生成对话和恢复既有地址分别处理。
- modified:
  - `src/shared/types/notes.ts`
  - `src/shared/utils/mindmapEdits.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 两侧 tsc 仍有既有错误，没有新增上下文链路的类型错误。真实来源页面的采集、实际 AI 发送及界面交互仍需手动验收：新会话自动携带、复用勾选最新内容、笔记页快照提示、来源切换及超限拒绝。

### 21:30 | Antigravity

- done: 优化思维导图顶部更多选项菜单与画布工具更多菜单UI：增加极简前置图标、分组分割线、单行文本截断与选中指示，规范危险操作样式与弹窗高度防溢出
- decision: 保持极简原则，采用语义化Material Symbols图标与低视觉权重的分组细线，导图列表使用check勾选代替硬拼文本，设置max-height与truncate避免内容撑开与多余滚动条
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`

### 21:15 | Codex

- done: 将导图持续修改从 JSON 改为 mindmap_edits/edit/old_text/new_text 固定标签协议，复用首次生成的外层标签定位。修正 DeepSeek 采集优先读取正式回答正文和代码文档，避免思考内容、语言标签及复制下载控件替代代码正文。同步设计文档。lint 通过（20 条既有警告）、build 通过；electron-vite dev 隔离页面中的协议与 DOM 诊断 43 项通过；diff 检查通过。
- context: 诊断使用临时目录和独立 Electron Session 的构造页面，不访问用户真实登录数据。npm run dev 已启动，指定诊断入口通过直接调用同一 electron-vite CLI 执行；真实应用已有实例时新实例退出。
- decision: 仅以固定标签隔离原始文本，不引入 XML 依赖、不保留 JSON 回复兼容。载荷仅统一 LF；保留缩进、空白及字面字符；协议分隔换行不进入载荷。正式修改解析仍复用原精确替换执行器、候选和撤销逻辑。
- modified:
  - `src/shared/utils/mindmapEdits.ts`
  - `src/shared/utils/mindmap.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `docs/single-conversation-mindmap-mvp-design.md`
- unresolved: 两侧 tsc 仍被此前的 daemon、summaryPrompts、旧 Electron API、Window.api、Map 迭代和参数错误阻塞，没有新增的协议相关类型错误。
- unresolved: 真实 DeepSeek 页面尚未完成修复后的修改验收；更新开发应用后，在原生成会话重新提交添加例子，确认返回标签结果、显示候选，再连续调整并应用撤销。

### 20:48 | Codex

- done: 实现单会话导图 MVP：严格 JSON 精确替换、连续候选预览与应用撤销、生成会话绑定、来源选区添加和节点追问；按用户要求恢复无导图原始界面并将已有导图输入区压缩为单行。lint 通过（20 条既有警告），build 通过，30 个固定样例诊断通过，diff 检查通过。
- context: 保留开始时已有的画布拖动、多选等工作区修改；未切分支、未添加依赖；用户设计文档和原型未修改。
- decision: 无导图时复用原始新建 UI；已有图底部用操作胶囊、模型图标、32–72px 自适应输入及圆形提交。候选只在当前进程按窗口和导图隔离，不写入正式 Markdown；冲突和错误整批拒绝。
- added:
  - `src/shared/utils/mindmapEdits.ts`
  - `src/renderer/src/utils/mindmapSelection.ts`
- modified:
  - `AGENTS.md`
  - `src/main/ipcHandlers.ts`
  - `src/main/noteManager.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapMarkdownEditor.tsx`
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/hooks/useWebviewSidebar.ts`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/styles/localMindmap.css`
  - `src/renderer/src/utils/mindmapExport.ts`
  - `src/renderer/src/utils/mindmapTree.ts`
  - `src/shared/types/notes.ts`
  - `src/shared/utils/mindmap.ts`
  - `src/shared/utils/webviewScripts.ts`
- unresolved: 两侧 tsc 仍有既有错误（daemon、summaryPrompts、Electron 旧 API、Window.api、Map 迭代及调用参数），未扩大范围修复。
- unresolved: npm run dev 已启动隔离开发实例，桌面操作被用户 Escape 停止；尚未完成已登录真实平台的连续两轮调整、应用撤销、取消恢复、来源选区添加、追问追加和 PNG/SVG 导出视觉验收。

### 17:59 | Codex

- done: 合并导图生成与修改入口，新增可交互的模型选择，删除输入区标题、说明和示例入口；同步设计文档。浏览器验证模式草稿保留、带要求及留空新建、原图保留、模型切换、修改应用撤销、取消及失败处理。
- decision: 输入区仅保留操作、模型、需求和提交；AI 行为继续采用本地演示，不修改应用源代码。
- added:
  - `C:/Users/DMX/.codex/visualizations/2026/10/05/01a10a74-17f1-7a01-acc5-f8304c49502f/mindmap-unified-composer.png`
- modified:
  - `docs/mindmap-mvp-prototype.html`
  - `docs/single-conversation-mindmap-mvp-design.md`

### 17:03 | Codex

- done: 创建单会话思维导图 HTML 交互原型，沿用现有面板视觉，浏览器验证划词添加、右键追问仅注入、就地编辑、多轮候选预览、应用撤销、取消和失败保留。
- decision: 使用无外部依赖的独立 HTML 与本地 AI 回复模拟，不改动应用源代码；原型内容仅保留在浏览器内存中。
- added:
  - `docs/mindmap-mvp-prototype.html`
  - `C:/Users/DMX/.codex/visualizations/2026/10/05/01a10a74-17f1-7a01-acc5-f8304c49502f/mindmap-mvp-preview.png`

### 16:55 | Codex

- done: 节点新增和折叠按钮在缩放低于 75% 时隐藏整组操作及命中区域，放大后恢复悬停、选中和折叠指示规则；统一滚轮、工具栏和 fit 的缩放同步。lint/build 通过，独立 Electron 开发窗口验证选中/悬停/折叠、放大恢复、fit 和滚轮行为。
- decision: 保留按钮固定屏幕尺寸，新增 0.75 的可见性门槛；隐藏按钮锚点避免小比例下按钮或伪元素仍接收鼠标事件。
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/styles/localMindmap.css`

### 16:51 | Codex

- done: 思维导图画板支持左键框选、Ctrl/Shift 多选、批量删除、右键平移和跨层级分支拖动吸附；接入现有撤销重做并更新操作提示。lint/build 通过，独立 Electron 开发窗口已触发交互验证。
- decision: 沿用 Markmap 自动排版，通过拖放修改层级和同级顺序；多选分支按树序移动，父子同时选中时去重，保留根节点并阻止循环层级。
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/utils/mindmapTree.ts`
  - `src/renderer/src/styles/localMindmap.css`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- unresolved: 全项目 web 类型检查被未修改文件中的 12 项既有错误阻塞；因现有开发实例的单实例锁，使用独立 Electron 窗口和临时导图验证组件；真实导图保存后重开持久化需在完整应用中补验。

### 16:37 | Codex

- done: 更新单会话思维导图 MVP 设计为每轮 JSON 精确文本补丁，完善提示词模板、原文匹配与版本基线、IPC 契约和开发验收样例。
- decision: 统一用户输入，模型返回 oldText/newText；应用在本轮全文上唯一完整行匹配并整批生成候选，不保存节点 ID，不模糊匹配或自动全量降级。
- modified:
  - `docs/single-conversation-mindmap-mvp-design.md`

### 16:09 | Antigravity

- done: 实现模型回复附件智能复用与状态守护，根治重新注入重复上传附件及撤回脏附件 Bug
- decision: 在 useWebviewSummary 中建立 uploadedOutputsRef 附件指纹：长文本模式下，若撤回后仅修改提示词要求且模型回复内容未变，跳过重复上传直接复用已有附件；若模型数据源改变或降级为纯文本，自动重置页面清空旧附件后重新注入；在重开新对话和切换平台时自动重置指纹
- modified:
  - `src/renderer/src/hooks/useWebviewSummary.ts`
  - `src/renderer/src/components/SummaryPanel.tsx`

### 16:09 | Codex

- done: 完成单会话思维导图 MVP 产品与技术设计文档，明确统一提示词修改、完整 Markdown 候选应用、右键添加和仅注入追问。
- decision: 先以提示词约束 AI 保留无关内容并验证连续修改链路；不增加范围选择、局部替换或持久化节点 ID。
- added:
  - `docs/single-conversation-mindmap-mvp-design.md`

### 15:48 | Antigravity

- done: 将发送按钮改为在已发送/已注入后原位替换为撤回按钮，右侧始终保持单个操作按钮
- decision: 右侧操作区由双按钮改为单按钮原位替换：未发送时为正圆发送/注入按钮，注入完成后原位平滑切换为正圆撤回按钮（undo），点击即可只撤回网页提示词并切回发送按钮，保持最纯粹的单按钮极简体验
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

### 15:42 | Antigravity

- done: 实现总结页提示词撤回功能（只清空 Webview 注入的提示词并解锁输入框，保留用户草稿），并将最大高度限制为最多 3 行
- decision: textarea 最大高度由 120px 严格调整为 72px（最多 3 行）；注入后新增精致撤回胶囊按钮，调用 ref.clearInput() 清空网页提示词并回滚草稿历史，保留用户输入内容供修改重新注入
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

### 15:36 | Antigravity

- done: 修复总结页占位符文字溢出及滚动条问题，完善多行超长文本输入机制
- decision: 无输入时锁定 32px 单行高度并强制隐藏滚动条，避免 placeholder 污染 scrollHeight；精简文案并增加 placeholder:truncate；支持 1-5 行弹性自适应与超过 120px 内部平滑滚动；增加 Ctrl+Enter/Enter 发送快捷键与极简一键清空按钮；阐明超长文本自动转 Markdown 附件底层机制
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

### 13:29 | Antigravity

- done: 优化总结页底部输入框与上方 Webview 卡片粘连问题，改为极简精致浮岛风格
- decision: 外层增加 gap-3.5 彻底消除卡片边缘粘连；输入框容器采用与全站统一的 rounded-2xl glass-panel shadow-soft 毛玻璃浮岛；模式选择器改为精致胶囊 pill；发送按钮改为与全站一致的圆形向上箭头及旋转状态；加入中文 IME 输入法防误触
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

### 13:06 | Codex

- done: 完成导图独立平台偏好的实现与审阅：lint、build、diff检查通过，开发启动编译通过
- context: lint为0错误20条既有警告；web类型检查仍为既有错误；npm run dev因旧实例占用单实例锁退出；桌面工具点击坐标不可用且恢复截图超时，未完成手动交互验收
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: 手动检查选择导图平台后关闭重开、切换来源平台、快捷窗口同步与应用重启后恢复

### 13:04 | Codex

- done: 导图生成平台改为独立配置，记住上次选择并跨窗口同步，移除来源平台联动
- decision: 复用配置store与现有stateSync，首次默认ChatGPT；保存失败在导图面板提示
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: 待执行lint、build和开发态验证

### 13:00 | Codex

- done: 完成导图预览与快捷窗口交互修复的代码审阅；lint、build、diff检查通过
- context: lint为0错误20条既有警告；node/web类型检查仍有未改动位置的既有错误；npm run dev完成编译后因旧实例占用单实例锁退出，旧窗口仍为5174服务
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/SessionManager.ts`
- unresolved: 重启开发实例后验证：快捷窗口打开生成网页保持显示；关闭网页返回快捷窗口且生成继续；从网页切到外部应用仍隐藏快捷窗口；取消与完成释放会话

### 12:58 | Codex

- done: 修复导图预览关闭后后台任务中断，并保持快捷窗口与预览之间的焦点连续性
- decision: 预览关闭仅隐藏；显式任务清理强制销毁；从快捷窗口打开的预览保留快捷窗口，切到外部应用仍隐藏
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/SessionManager.ts`
- unresolved: 待执行 lint、build、类型检查与开发态交互验证

### 12:49 | Codex

- done: 修订数据治理方案并完成分会话 JSON 存储、启动迁移、按需回复采集、导图迁移及完整业务备份恢复；lint 无错误、构建通过，隔离 npm dev 桌面链路和迁移失败场景验证通过
- context: 保持当前分支与既有未提交修改；使用 tmp/governance 虚构数据与独立 userData，未迁移或清理真实用户数据。定向类型检查仍有既有错误。
- decision: 保留完整 JSON；history/conversations 与 history/summaries，开发历史在 history/dev；配置内 historyStorageVersion 标记，不引入 migration.json、SQLite 或新生产依赖。
- added:
  - `docs/data-governance-optimization-plan.md`
  - `src/shared/types/history.ts`
  - `src/renderer/src/components/StandaloneMindmapPanel.tsx`
- modified:
  - `AGENTS.md`
  - `src/main/api/historyManager.ts`
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/noteManager.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/hooks/useDebateRunner.ts`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/pages/NotesPage.tsx`
- unresolved: 真实登录平台的一轮辩论与后台导图、安装/便携包首次迁移未验收；最小人工检查已写入方案第 11 节。

### 11:49 | Codex

- done: 恢复快捷窗口未固定时失焦自动隐藏，保留 pin 置顶时不自动隐藏；核对历史提交中的全局禁用原因
- context: c723732 于 2026-06-28 注释失焦隐藏并新增 pin；记录无法证明当时真实用户意图，也无法解释上个安装包的行为差异。用户要求停止 computer-use，已停止桌面操作。
- decision: 沿用现有置顶状态判断 pin，失焦延迟 150ms 并仅检查快捷窗口及其 Webview 焦点，隐藏/销毁/重新聚焦时清理定时器。
- modified:
  - `src/main/webviewManager.ts`
- unresolved: lint 通过（22 条既有警告），build 通过，diff check 通过；node tsc 受现有 10 处类型错误阻塞，本次新增代码无诊断。npm run dev 完成编译与启动尝试，现有开发实例占用 5173/5174，新实例启动后退出，未完成交互实测；需手动验证未固定点击外部隐藏、固定后保持、取消固定后隐藏和 Webview 内操作不误隐藏。

### 11:48 | Codex

- done: 制定本地数据治理优化方案，明确分会话 JSON、启动迁移、按需采集、导图统一保存与完整备份的实施边界和验收标准
- decision: 仅形成实施文档，不修改功能代码；普通对话默认不轮询，SQLite 按真实需求和测量结果后续评估
- added:
  - `docs/data-governance-optimization-plan.md`

### 11:13 | Codex

- done: 按 build-memory 规范整理项目记忆层：新增 13 主题索引，重组全部既有知识，纠正冲突与旧架构引用，更新 AGENTS 并精简 CLAUDE；模板逐字比对、双向路由、文件保全、类型检查命令选项及 diff 检查通过。本次仅改记忆文档，未运行应用 lint/build/dev。
- decision: 保留全部项目纪律及用户工程化/文档规范；旧方案限定历史场景，运行时未验收内容不推断完成；日志脚本修复、TODO、CHANGELOG 和既有源码改动保持原样，历史仅由脚本归档。
- added:
  - `.memory/INDEX.md`
  - `.memory/sessions/2026-09-28.md`
- modified:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

## 2026-10-04

### 22:14 | Codex

- done: 修复导图采集过早采用带标签代码片段的问题：采集同一最新回复的完整模型、代码原文、换行还原和共享Markdown转换候选，由现有解析器逐一选择可解析大纲；lint、build及注入脚本语法检查通过
- decision: 保留虚拟编辑器完整性限制，候选回退限定在同一条回复；不修改总结采集行为、IPC或导图输出格式
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
- unresolved: dev启动仍复用修改前主进程，真实DeepSeek生成与导图保存需完整退出后重新npm run dev验收；主进程tsc检查有其他文件10处错误，本次修改文件未报错

### 22:11 | Codex

- done: 按会话日志提示提升 Markmap 隐藏视口适配及既有稳定经验，并标记已提升的日志条目
- modified:
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 22:10 | Codex

- done: 修复隐藏导图零尺寸适配导致缩放失效、画布无法拖动的问题；lint/build/diff 检查通过，桌面工具未找到可操作窗口，交互回归未完成
- decision: 观察 SVG 可见尺寸，创建 Markmap 时不传入数据；待布局与有效尺寸就绪后首次适配，正常更新保留视口
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
- lesson(promoted): Markmap.create(svg, options, data) 会在 setData 完成后无条件 fit，即使 autoFit:false；隐藏画布的零尺寸会产生 0/NaN 缩放，必须分开创建与 setData，并在有效可见尺寸及布局后适配。
- unresolved: 需在可操作的 npm run dev 桌面窗口中验证大纲切换、侧栏重开、添加节点后拖动及缩放恢复；全量 tsc 仍有既有类型问题

### 19:48 | Antigravity

- done: fix: resolve dropdown menu not closing on outside click by capturing pointerdown/mousedown and handling escape/blur
- modified:
  - `src/renderer/src/components/CustomDropdown.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 19:44 | Antigravity

- done: UI: integrate mindmap title and more actions into unified sidebar header and remove inner canvas header
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`

### 19:40 | Antigravity

- done: UI: move generate mindmap button to bottom left
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 19:12 | Codex

- done: 修复大纲自动保存后跳回导图及保存版本回退问题；lint 与 build 通过，桌面回归因用户 Esc 停止而未完成
- decision: 忽略相同或旧保存版本的刷新快照，保留编辑器实例；保存回调按会话及导图 ID 稳定依赖
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: 桌面验证未完成：切到大纲后连续编辑两次，各等候自动保存，再撤销/重做并重新打开核对落盘内容；全量 tsc 被仓库现有类型错误阻塞

### 19:03 | Codex

- done: 将会话导图选项菜单中的打开幕布移至在笔记中打开之后、删除导图之前，保留空导图状态下的入口。lint 和 build 通过。
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 19:01 | Codex

- done: 本地思维导图设为默认入口；幕布移入更多菜单，在原侧栏 WebView 中按需打开并提供返回本地导图按钮。lint 和 build 通过，dev 已启动。
- decision: 取消本地/在线并列切换与来源偏好读取，切换时保留两侧状态，沿用已有侧栏休眠管理。
- modified:
  - `src/renderer/src/components/MindmapSidebarView.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- unresolved: 桌面截图首次超时，用户随后通过 Escape 停止 Computer Use；打开幕布、返回本地和编辑状态保留仍需人工验证。

### 17:50 | Antigravity

- done: 接入并完成 WebviewCard 的三个 Hook 拆分，修复 selectors 可选类型并完成全链路编译验证
- context: 全量 lint 0 errors、tsc 0 errors、生产 build 成功
- decision: WebviewCard 完整委托给 useWebviewLifecycle、useWebviewActions 和 useWebviewNotes，消除旧直接 ref.current 唤醒并保持 24 个 ref 方法兼容
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/hooks/useWebviewLifecycle.ts`

### 16:58 | Codex

- done: 将 WebviewCard 按网页操作、生命周期、笔记高亮拆分为三个 Hook，保留 Props 与 24 个 Ref 方法，并修复加载事件旧状态读取和回调 Ref 唤醒按钮。
- context: lint 0 errors、22 项既有 warnings；生产构建通过；TypeScript 对照未新增错误，改动文件无类型错误，项目仍有 81 项既有错误。
- decision: 保留头部、覆盖层和全局会话规则；加载、导航及休眠共用生命周期状态；上传脚本复用 shared 文件。
- added:
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/hooks/useWebviewLifecycle.ts`
  - `src/renderer/src/hooks/useWebviewNotes.ts`
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/shared/utils/webviewScripts.ts`
- unresolved: 桌面交互回归待完成：开发构建通过，但已有实例导致新进程退出，computer-use 截图两次超时，未验证实际加载/刷新、休眠恢复、网页操作和笔记高亮。

### 16:54 | Codex

- done: 已提交拆分前修改 cb01b82；将 LocalMindmapPanel 从 1868 行拆分为 363 行主组件、树工具、画布 Hook、导出工具及共享样式，移除默认模板入口与无用分支，修复导出按钮清理并保留旧模板迁移识别。lint 与 build 通过；全量类型诊断与提交基线同为 91 条，本次无新增诊断。
- decision: 按完整职责拆为四个辅助文件，保留已有连线与缩放修正路径、独立本地保存和原有导出 ref 接口。
- added:
  - `src/renderer/src/utils/mindmapTree.ts`
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/utils/mindmapExport.ts`
  - `src/renderer/src/styles/localMindmap.css`
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: npm run dev 启动时已有实例运行；Windows computer-use 捕获两个开发窗口均超时，未完成实际编辑、撤销重做、视图切换、折叠及 PNG/SVG 导出的桌面复验。

### 16:36 | Antigravity

- done: 在思维导图顶部操作菜单和底部更多菜单中均支持导出图片（PNG与SVG）功能
- decision: 在LocalMindmapPanel中暴露LocalMindmapPanelRef供外部调用导出；使用内联base64 DataURL渲染SVG到Canvas以规避Chromium Canvas Taint限制，并以2x高清比例导出PNG
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`

### 16:33 | Antigravity

- done: 修复思维导图Tab新建节点画面跳动问题，修复新建与折叠按钮点击失效问题，升级按钮尺寸与命中热区
- decision: 在聚焦新建节点时使用 focus({ preventScroll: true }) 并在容器层监听重置滚动位移，彻底消除聚焦触发的视口跳动；将按钮升级为 18px 描边并添加扩展命中区与高 z-index，并在 mousedown 阶段阻止冒泡，彻底避免与 D3 zoom 拖拽和节点选择逻辑冲突
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): 在包含 SVG foreignObject 和 D3 zoom 的画布中，使用 DOM focus() 必须显式传入 { preventScroll: true }，否则 Chromium 会自动滚动最近的祖先容器导致整块画布视口突变；为浮动在节点边缘的操作按钮配置扩大命中范围的伪元素时，必须确保按钮自身具备独立的定位层级（relative + z-index），防止其父级绝对定位的伪元素将真实按钮遮挡拦截

### 16:12 | Antigravity

- done: 修复思维导图新建节点失败问题及优化UI：紧凑水平连线、描边按钮无填充、画布缩放按钮物理尺寸恒定
- decision: 通过 prevInitialMarkdownRef 区分外部受控更新与内部增删节点，彻底消除新建节点时的状态强制回滚；采用 scale(var(--mm-zoom-inv)) 确保画布缩放下操作按钮物理像素恒定
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): 在包含受控/非受控混用场景（如 initialMarkdown）的 React 组件中，避免在依赖项中监听内部编辑状态（markdown）来进行同步，否则内部任何状态更新都会被判定为与外部不同并触发强制回滚；对于绝对定位的 hover 操作按钮，需避免子元素与父元素之间出现事件空隙导致 hover 闪退

### 16:00 | Antigravity

- done: 精简导图操作下拉菜单，删除多余分类标题与底部提示文字，并将模型选择器内联至生成新图选项右侧
- decision: 将生成平台下拉框放置在生成新图选项后面并清除灰色说明小字，移除新建与生成以及当前导图管理冗余标题
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 15:50 | Antigravity

- done: 优化思维导图水平连线长度（砍半）、按钮画布缩放逆缩放恒定尺寸、按钮灰色描边及hover变黑线
- decision: 使用CSS变量--mm-zoom-inv逆缩放保证按钮物理尺寸恒定；折线拐点设为中点midX并将水平间距设为24px以砍半水平连线；折叠/新增按钮改用纯线段描边与白色遮罩底
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`

### 15:35 | Antigravity

- done: 修复 ConversationMindmapPanel 中遗漏引入 useMemo 导致的组件渲染报错
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- lesson(promoted): 由于 electron-vite build 默认不执行 tsc 类型检查，在修改组件时需注意 hook 引入完整性，并可结合 npx tsc --noEmit 验证未定义引用

### 15:31 | Antigravity

- done: 实现思维导图标题与文件名双向绑定、历史版本倒序排列展示及生成后自动切换新导图
- decision: 导图顶栏标题与画布根节点Markdown第一行建立严格双向响应同步；历史版本按createdAt倒序排列并优先展示最新版本；生成新导图完成时自动将mapId更新为新生成的mindmapId
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`

### 15:18 | Antigravity

- done: 删除按要求生成导图对话框中冗余的'额外要求（选填）'标签文本
- decision: 移除输入框上方与 placeholder 重复的标题文本，直接展示输入框，使弹窗更加紧凑简洁
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 15:17 | Antigravity

- done: 优化按要求生成导图对话框文案：将 textarea placeholder 简化为通用提示，并移除底部的冗余说明行
- decision: 将具体过长的业务例子 placeholder 改为通用的'输入额外要求（选填）...'，并精简对话框底部文案，消除冗余提示
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 15:14 | Antigravity

- done: 移除按要求生成导图对话框中的模型启用过滤限制，展示全部支持的 AI 平台选项
- decision: 移除 models.filter(model.enabled) 限制，与初始卡片和顶栏 Split Button 下拉选择保持一致，允许自由选择所有 13 个支持的模型平台生成思维导图
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 13:34 | Codex

- done: 实现快捷窗口尺寸持久化：拖动结束、隐藏与关闭时按需保存，启动恢复，扣除侧栏实际宽度并限制屏幕边界；lint、build及独立开发实例运行检查通过
- context: 保留原有未提交改动；lint 有39个已有警告；主进程类型检查有10个已有错误，与修改前基线完全一致；临时验证目录清理被系统策略拦截，目录保留在系统 Temp 中
- decision: 复用 electron-store，仅在主进程保存宽高，无新增 IPC、依赖、定时器或测试框架
- modified:
  - `src/main/index.ts`
  - `src/main/webviewManager.ts`
- unresolved: 桌面截取工具连续超时，未完成真实鼠标拖动验证；独立 npm run dev 实例已实际验证保存/恢复/隐藏/关闭/侧栏与异常尺寸，resized 完成事件通过调试接口显式触发；最小手动补验：拖动窗口后隐藏再打开、退出应用重启、侧栏展开时拖动后重启

### 13:27 | Antigravity

- done: 优化导图管理菜单中的历史导图选择器：从原生矮小 select 升级为整体 UI 风格一致的卡片式历史版本列表项，并拓宽下拉浮层至 w-72
- decision: 弃用原生系统 select 控件，改用带 Material Symbols 图标、标题、时间两行排版及选中高亮徽标的卡片按钮列表，提升易用性与一致性
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 13:16 | Antigravity

- done: 思维导图已生成后的交互重构：将生成新图与更多菜单重构为方案一（Split Button 新建组合按钮 + 独立对象管理图标）
- decision: 采用方案一：将'生成新图'与'新建空白导图/按要求生成'统一收敛于 Split Button，并将导图导出/在笔记打开/删除解耦到独立的 more_horiz 菜单，解决心智混淆与删除误触问题
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/CustomDropdown.tsx`

### 12:59 | Codex

- done: 移除思维导图大纲的标题栏及编辑/预览切换，仅保留带语法高亮的 CodeMirror 编辑视图；复制与编辑操作合并到正常布局工具栏，导图/大纲 tabs 不再遮挡复制
- context: npm run lint 与 npm run build 通过（39 条原有 lint 警告）；编辑组件严格类型检查通过。npm run dev 在独立临时配置中验证标题及预览移除、复制可点击、tabs 无遮挡，774px 与 280px 宽度下按钮均在容器内；留存实测截图。
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapMarkdownEditor.tsx`

### 12:53 | Codex

- done: 为思维导图大纲接入 CodeMirror 6，支持两空格及多行缩进、Markdown 语法高亮、列表续写、撤销重做和格式预览；验证导图层级同步、自动保存及从笔记重开
- context: 已获用户同意新增 CodeMirror 生产依赖。lint 通过（39 条原有警告），build 通过，新增组件严格类型检查通过；完整 web tsc 的 91 条错误与 HEAD 基线一致，无新增。npm run dev 使用临时配置目录避开正在运行的正式版单实例锁，通过开发版 Electron 的 DevTools 验证编辑与保存链路。
- added:
  - `src/renderer/src/components/MindmapMarkdownEditor.tsx`
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `package.json`
  - `package-lock.json`

### 12:29 | Codex

- done: 从产品使用场景更新 README，突出快捷窗口并加入用户截图，补充笔记与会话导图，修正网页总结及任务拆解 API 说明
- context: 仅文档与图片变更；已对照当前源码和近期提交核实功能，13处本地引用、导航锚点、截图原文件哈希及 git diff --check 通过；未运行应用 lint/build/dev
- decision: 以快捷窗口日常阅读追问、主窗口并行任务、笔记导图留存组织产品介绍；下载章节说明源码与发布包能力可能不同
- added:
  - `docs/readme/quick-window.png`
- modified:
  - `README.md`

## 2026-10-03

### 23:23 | Codex

- done: 修复导图生成失败或取消残留会话快照，放开全部配置平台并为完成提示增加五秒关闭及会话内关闭记录
- context: lint 0错误39既有警告，build通过；类型诊断与HEAD相比无新增（node 10、web 91）；dev启动复用现有单实例；桌面捕获超时后重试被用户Escape停止
- decision: 生成前快照仅在主进程按窗口暂存，生成成功或创建空白图时与导图一次保存；保持IPC参数和返回结构；完成通知由前端记录截止时间与关闭状态，后台保留任务结果
- modified:
  - `src/main/noteManager.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `docs/single-conversation-mindmap-design.md`
- unresolved: 完整退出后npm run dev复验生成成功/失败/取消、空白导图及笔记保存，并检查13个平台选择和五秒提示关闭/重新挂载行为；既有空快照记录未自动删除

### 23:11 | Antigravity

- done: 优化思维导图初始界面UI设计：增大模型选择器尺寸提升辨识度；移除输入框外层容器焦点背景色变化；将生成导图与手动创建按钮调整为卡片正下方并排展示
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 23:08 | Antigravity

- done: 优化思维导图初始界面UI设计：删除标题下方的小字说明文字，进一步简化顶部视觉区域
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 23:07 | Antigravity

- done: 优化思维导图初始界面UI设计：将模型选择器与额外要求合并为一体化输入卡片（模型选择器以紧凑药丸置于左上角，下方直接展开输入框，去除折叠、图标与字数统计）
- decision: 根据图二需求将模型选择器与额外要求整合为单张输入卡片，去除非必要标签与字数限制
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 23:01 | Antigravity

- done: 优化思维导图初始界面UI设计：移除红框冗余标题和更多按钮，重构为方案A聚焦控制台，直接外显模型选择器（带Logo）、额外要求（内联展开）、生成导图主按钮与手动创建次按钮，并删除底部提示文案
- decision: 采纳方案A聚焦控制台设计，遵循极简设计原则完全移除底部次要提示文案
- added:
  - `docs/superpowers/specs/2026-10-03-mindmap-initial-ui-design.md`
  - `docs/superpowers/plans/2026-10-03-mindmap-initial-ui-plan.md`
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 22:38 | Codex

- done: 调整导图提示词：核心认识优先、短语为主句子按需、分支按重要程度展开，删除无信息引导节点与重复总结；同步文档；lint/build/diff 检查通过，dev 完成构建后退出
- decision: 保持必要条件和分歧，不强制节点数量与平均展开；本次仅修改提示词文本与文档
- modified:
  - `src/shared/utils/mindmap.ts`
  - `docs/conversation-mindmap-prompt-optimization.md`
- unresolved: 开发运行实例未确认加载新提示词，完整退出重启后用同一会话生成新图对照归纳质量

### 22:14 | Codex

- done: 落实会话导图主旨提炼提示词与可选额外要求；lint/build 通过，类型对比无新增诊断；桌面实测未完成
- decision: 默认一键生成采用新提炼策略；额外要求仅本次确认使用，当前来源内保留草稿，切换清空；保持代码块协议与单次生成链路
- modified:
  - `src/shared/utils/mindmap.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `docs/conversation-mindmap-prompt-optimization.md`
- unresolved: 完整退出并重启开发应用后手动验证主窗口、快捷窗口、笔记页和归纳质量；截图 FrameArrived 超时，恢复时用户 Escape 停止电脑操作

### 19:23 | Codex

- done: 完成会话导图归纳方法调研，形成可直接采用的主旨提炼提示词、末端句子表达规则、按要求生成交互及现有IPC接入方案。
- context: 用户反馈当前导图逐项罗列对话，要求先调研再给提示词优化方案，并支持生成前输入额外要求。
- decision: 区分传统关键词导图与会话复盘用途；以焦点、信息取舍、逻辑组织为核心，末端允许一句话；默认一键生成，更多菜单提供按要求生成入口。
- added:
  - `docs/conversation-mindmap-prompt-optimization.md`
- unresolved: 本轮为调研方案，提示词替换及额外要求输入尚未开发；效果需用真实会话人工对照评估。

### 19:15 | Codex

- done: 对话快照同步兼容ChatGPT新旧正文和data-turn角色，共享回复定位候选，去除嵌套轮次重复并优先提取助手正文；lint/build/注入语法/diff检查通过，类型诊断无新增。
- context: 浏览器只读DOM检查确认当前页面保留用户/助手角色且使用旧正文结构；需兼容站点不同版本。
- decision: 快照按全部轮次保存用户提问和AI回复，正文候选与总结、导图共享；明确用户角色优先，快照文件和批注锚点契约不变。
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `docs/single-conversation-mindmap-design.md`
  - `.memory/KNOWLEDGE.md`
- unresolved: dev仍复用现有实例，桌面多轮快照保存、批注与导图共享结果需要完整重启后验收。

### 19:08 | Codex

- done: 用户确认导图采集成功后，恢复单个Markdown代码块输出要求：固定首尾标签置于代码块内，无ID、属性或转义；更新设计文档。lint/build/diff检查通过。
- context: 用户已实测新DOM选择器下成功获取思维导图。
- decision: 只恢复提示词格式，保留已验证的回复定位和现有采集、超时、保存逻辑。
- modified:
  - `src/shared/utils/mindmap.ts`
  - `docs/single-conversation-mindmap-design.md`
- unresolved: dev命令复用现有实例；恢复代码块的下一次生成需完整重启后确认。

### 19:00 | Codex

- done: 将选择器更新需要覆盖前后台采集及本地旧配置的稳定经验写入长期知识，并标记对应lesson已晋升。
- modified:
  - `.memory/KNOWLEDGE.md`

### 18:59 | Codex

- done: 根据用户提供的ChatGPT实际DOM补充MarkdownRoot类名前缀选择器，统一接入总结和后台导图并兼容本地旧配置；lint/build/注入语法/diff检查通过，类型诊断无新增。
- context: 用户提供的回复根节点为div.MarkdownRoot-rZKhxa；之前的零容器诊断与缺失的新正文候选相符。
- decision: 匹配MarkdownRoot-前缀，不写死后缀；运行时按站点补充候选，不重置用户选择器、登录或会话数据。
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `docs/single-conversation-mindmap-design.md`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 更新站点回复选择器时，必须覆盖前台总结和后台采集两条实际执行路径，并确认本地旧配置不会屏蔽新增候选。
- unresolved: dev命令复用现有实例，真实总结采集和导图保存仍需完整重启后验收。

### 18:41 | Codex

- done: 按用户要求将导图生成改为直接文本输出；增加助手消息定位候选，后台读取取消可见布局过滤，并从标题和嵌套列表还原大纲；lint/build/注入语法/diff检查通过，类型诊断无新增。
- context: 用户截图显示抓取0字符、回复容器0个；未取得该任务实时DOM，不能认定代码块为唯一原因。
- decision: 不使用代码块，XML首尾标签转义成可显示文本；兼容已有代码输出，用户消息与输入区域不参与提取。
- modified:
  - `src/shared/utils/mindmap.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `docs/single-conversation-mindmap-design.md`
- unresolved: dev命令仍复用现有实例，需完整重启后验收普通文本输出、后台采集、列表层级和笔记保存；本轮未进行桌面操作。

### 15:34 | Codex

- done: 修复思维导图后台无限等待：单次网页操作超时、独立生成总超时、完整大纲稳定后保存及前端状态核对；lint/build通过，类型诊断无新增。
- context: 用户确认超过三分钟仍无错误；尚未取得该次任务的运行时挂起位置。
- decision: 完整可解析大纲连续三次稳定后保存；失败不重发，迟到结果不保存；通知故障按窗口隔离，复用现有IPC。
- modified:
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `docs/single-conversation-mindmap-design.md`
- unresolved: dev命令复用现有实例，需完整重启加载主进程修复。截图FrameArrived timed out，恢复时用户按Esc终止Computer Use，真实平台生成保存尚未验收。

### 11:58 | Codex

- done: 针对完整代码块已包含首尾标签但仍超时的问题，增加导图专用全文读取：CodeMirror 文档模型优先，普通代码原文其次，虚拟框无法取模型则明确失败；增加不含正文的失败诊断计数
- decision: 保持固定 XML 输出；仅导图使用完整代码读取，禁止把虚拟可见行保存为全量结果；将相关稳定经验写入 KNOWLEDGE 并标记既有 lesson promoted
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/mindmap.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `docs/single-conversation-mindmap-design.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`
- unresolved: 用户确认复制结果包含两个标签；实际失败窗口 DOM 尚未读取，CodeMirror 假设仍需网页复验。lint/build/脚本语法通过，无新增类型诊断；dev 单实例复用，需完整主进程重启后验收。

### 11:23 | Codex

- done: 改用代码块内固定 XML 标签输出导图，任务 ID 保留内部；合并顶部工具栏，将次要操作、状态详情和画布工具收进菜单，保留编辑与自动保存
- decision: 复用现有回复采集和 CustomDropdown，不新增依赖、IPC 或存储结构；普通采集行为保持不变
- modified:
  - `src/shared/utils/mindmap.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `docs/single-conversation-mindmap-design.md`
- unresolved: lint/build/diff 检查通过，无新增类型诊断；dev 复用现有实例；桌面截图超时且用户按 Esc 终止验证，真实窗口排版和网页生成仍需重启后复验。

### 11:06 | Codex

- done: 修复网页版 AI 导图输出结束后仍等待直到超时的问题：专用 DOM 抓取保留层级，代码块输出与宽容标记识别，已完成但不可解析时及时报错
- decision: 不改普通采集、IPC 和存储，不自动重发历史超时任务
- modified:
  - `src/shared/utils/mindmap.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `docs/single-conversation-mindmap-design.md`
- lesson(promoted): 网页版 AI 将 Markdown 渲染为 DOM 后不能依赖标记整行相等或通用 HTML 转换保留列表缩进；结构化输出应保留代码块原文，并将未完成与已完成但无法解析分开处理。
- unresolved: 桌面截图工具 FrameArrived timed out；dev 单实例复用，真实平台完成保存仍需重启主进程后复验。

### 10:52 | Codex

- done: 补充生成前快照一致性检查，避免不完整采集时静默使用旧快照生成；更新设计说明，lint和build通过
- modified:
  - `src/main/ipcHandlers.ts`
  - `docs/single-conversation-mindmap-design.md`
- unresolved: 真实桌面及网页版AI验收受截图超时与现有开发单实例限制，操作步骤见设计文档第10节

### 10:50 | Codex

- done: 完成退出应用时的后台导图任务清理，最终lint和build再次通过；dev仍进入现有单实例，真实网页验收步骤已记录在设计文档
- modified:
  - `src/main/services/MindmapService.ts`
  - `src/main/ipcHandlers.ts`
- unresolved: 按docs/single-conversation-mindmap-design.md第10节重启开发实例并完成真实网页与桌面手动验收

### 10:47 | Codex

- done: 将日志提示的四条稳定经验写入长期知识并标记已提升；调整新增导图容器操作字号与核心面板一致
- decision: 不创建缺失的memory索引或额外测试框架，保留原有存储结构和开发验证方式
- modified:
  - `.memory/KNOWLEDGE.md`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 10:46 | Codex

- done: 编写单对话思维导图设计开发文档并实现共享快照、后台网页版AI任务和主窗口/快捷窗口/笔记页接入；lint及build通过，实际桌面验收受截图环境限制
- decision: 一个JSON会话文档只保留一份快照，Markdown存正文和大纲；默认当前平台支持跨平台，重新生成新建；保留并行产生的快捷窗口拖拽改动
- added:
  - `docs/single-conversation-mindmap-design.md`
  - `src/shared/utils/mindmap.ts`
  - `src/main/services/MindmapService.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- modified:
  - `AGENTS.md`
  - `src/shared/types/notes.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/noteIdentity.ts`
  - `src/main/noteManager.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`
  - `src/renderer/src/components/WebviewSidebarPanel.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/pages/NotesPage.tsx`
- lesson(promoted): 来源会话键应保留完整规范化URL路径，截取第一个chat片段会把chat/s/id1和chat/s/id2错误分为同一会话
- unresolved: 真实网页版AI发送与完成检测、旧笔记实际迁移、多窗口保存冲突和桌面UI仍需按开发文档手动验收；全项目类型检查有既有错误，本次未新增诊断

### 10:17 | Antigravity

- done: 快捷窗口支持拖拽思维导图侧边栏顶部空白区域移动窗口，并强化侧边栏卡片拖拽与指针边界保护
- decision: 在 MindmapSidebarView 增加 draggableHeader 接口与 no-drag/button 过滤；在 QuickPage 为导图与副模型卡片传入拖拽回调并增加 requestAnimationFrame 与 pointercancel 监听
- modified:
  - `src/renderer/src/components/MindmapSidebarView.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

## 2026-10-02

### 23:16 | Antigravity

- done: 提交思维导图功能相关代码：集成 Markmap 本地思维导图与幕布在线视图，支持正交连线与就地编辑
- added:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`
- modified:
  - `package.json`
  - `package-lock.json`
  - `src/renderer/src/components/WebviewSidebarPanel.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 23:08 | Antigravity

- done: 修复思维导图节点文本竖向折行问题，强制水平横向排版
- decision: 在LocalMindmapPanel的CSS样式中为foreignObject所有div层级、mm-node-item和mm-node-title强制注入white-space:nowrap和width:max-content
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap外层foreignObject容器在初始无明确宽度时，内层中文字符若缺失white-space:nowrap会在每个字符处发生自动软折行坍塌为单字竖排；必须在外层foreignObject、div及mm-node-item/mm-node-title全链路设置white-space:nowrap与width:max-content

### 22:56 | Antigravity

- done: 彻底修复思维导图连线与节点之间的视觉空隙与断裂问题
- decision: 在 getOrthogonalStepPath 中提取真实 DOM 边界 offsetWidth/offsetHeight 并根据层级穿透 1-2px 闭合入卡片或纯文本；CSS 强制 foreignObject x:0 且按钮默认 display:none
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap 中绝对定位子元素（如 hover 操作按钮）即便 opacity:0 也会撑大祖先元素 scrollWidth，导致 D3 计算 rect.width 虚增 40px 引发出线空隙；必须将非 hover/非 fold 态设为 display:none，并在折线计算中以实际 DOM offsetWidth 为准

### 22:28 | Antigravity

- done: 彻底修复部分节点无法被选中及无法触发hover效果的问题
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap默认CSS对foreignObject内div硬编码了width 9999px，在开启overflow visible后会横向遮盖右侧所有子分支导致无法hover和点击；必须在外层foreignObject及其包装div上强制设置pointer-events none与width auto，仅对mm-node-item本体开启pointer-events auto，并为纯文本分支设置微不可见背景消除穿透

### 22:23 | Antigravity

- done: 彻底消除连线与节点之间的断层空隙，大幅缩短水平连线距离让导图更紧凑
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap默认paddingX: 8会导致foreignObject产生8px外层偏移导致连线两端悬空断裂；必须显式配置paddingX: 0让连线与节点绝对贴合；配置spacingHorizontal: 46将原本80px的超长水平连线大幅缩减为46px，并微调纯文本节点的内边距

### 22:14 | Antigravity

- done: 实现节点末尾浮动圆形加号与向左向右展开收起按钮，覆盖在线段上且不改变节点与线段长度
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): 节点末端操作按钮必须通过0宽高的绝对定位anchor容器脱离流式布局，保证节点尺寸纯粹由文字决定，避免hover时节点宽度与连线长度发生变化；圆形白底按钮可无缝遮盖正交折线，收起采用向左箭头◂，展开采用向右箭头▸

### 22:01 | Antigravity

- done: 修复思维导图节点无法选中与修改/增删节点时画布突变缩放问题
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap集成避坑：1. 严禁嵌套setState并使用treeRef保障最新树；2. 避免透明背景在SVG foreignObject中点击穿透需设rgba微背景；3. 连线设置pointer-events none防止遮挡节点点击；4. ResizeObserver需设置防抖阈值杜绝编辑微调时误触发fit()

### 21:52 | Antigravity

- done: 彻底修复节点选择与编辑视口跳动：禁用 Markmap 内部 autoFit 消除编辑/增删节点时的画布缩放跳变，全方位捕获节点点击与双击，扩大分支热区并双向同步 mm-selected 状态
- decision: 将 autoFit 设为 false 仅在初次挂载时执行一次 fit()，后续数据变更绝不跳动画布；点击事件优先多级向上向内解析 .mm-node-item，彻底解决子元素或外层 div 点击漏选问题
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap 的 options.autoFit: true 会在每次 setData() 内部自动触发 this.fit() 重设视口缩放，导致编辑/增删节点时画布突变缩放；必须 autoFit: false 仅手动适时 fit；点击目标判定需兼顾 foreignObject 和包装 div，防止点击边缘时误判为背景

### 21:37 | Antigravity

- done: 修复连线垂直居中与节点编辑生命周期：从 D3 __data__ 精准计算节点垂直居中坐标并连接卡片中部；移除 mm.transition 篡改避免 TypeError；解耦 selectedNodeId/editingNodeId 与 setData 依赖，消除 addRange DOM 节点销毁告警
- decision: 通过 D3 __data__ rect 提取源节点与目标节点实际高度的一半作为 Y 轴锚点，实现连线穿入节点正中央；节点选中与编辑态使用 DOM class 驱动而非 setData 重建
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): 不能篡改 mm.transition 为 raw selection，Markmap 内部强依赖 transition.end() promise；selectedNodeId/editingNodeId 变化切勿触发 markmap.setData，否则会销毁正处于编辑态的 DOM 导致 addRange 越界失败

### 21:19 | Antigravity

- done: 彻底攻克正交折线与节点原形就地编辑：全局拦截 SVGPathElement setAttribute 实现幕布风格正交折线，节点标题 contenteditable 原生形状内打字，移除浮层输入框
- decision: 采用 SVGPathElement 原型级拦截和 mm.transition 规避 D3 动画滞后；采用节点内部 contenteditable 实现原形状原色就地打字零浮层
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap 内部硬编码 linkHorizontal 贝塞尔曲线且依赖 D3 transition，必须在 SVGPathElement 原型层拦截并在实例上替换 transition 才能实现无闪烁纯正交折线；就地编辑应直接赋予节点 DOM contenteditable，完美继承节点尺寸和黑白灰层级样式

### 20:44 | Antigravity

- done: 实现幕布式黑白灰分层视觉与正交折线连线，支持点击打字覆盖、双击就地编辑及Tab/加号就地新增输入零弹窗
- decision: 设计 curveToStepPath 算法将贝塞尔曲线转换为正交阶梯折线，统一黑白灰无彩色分支；根节点黑底白字、一级节点浅灰块、二级及以上透明底文字；通过绝对定位原位输入框实现零弹窗就地直接输入与打字覆盖
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): Markmap 原生连线为贝塞尔曲线，可通过提取路径端点坐标动态改写为 M-L 正交折线，并在父节点侧统一折角水平偏移量实现同分支垂直对齐；就地编辑采用绝对定位原位输入框比 SVG 内嵌 input 具备更好的中文输入法兼容性与定位稳定性

### 20:32 | Antigravity

- done: 修复 LocalMindmapPanel 中 cloneTree 与 findNode 在 useCallback 声明中递归自引用导致的 TDZ ReferenceError
- decision: 将 cloneTree 和 findNode 提取为模块级纯函数，消除组件内的生命周期与依赖闭包死区
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson(promoted): 递归树操作纯函数切勿在 React 组件体内用 useCallback 声明并在依赖数组中引用自身，否则会在初始化阶段触发 ES6 暂时性死区 (TDZ) ReferenceError: Cannot access X before initialization，应直接声明为模块顶层纯函数

### 20:18 | Antigravity

- done: 优化思维导图交互：Header只保留大字号本地/在线Tab，导图/Markdown切换移至画布右上角，Markdown精简为纯源码编辑，导图默认全展开且修复展开按钮，支持Delete删除节点、Tab/加号新增节点、hover末尾折叠及撤回重做
- decision: 在Markmap中自定义节点HTML包裹结构，隐藏原生圆圈，节点末尾提供+与hover折叠按钮避免打架；建立无损Line-based AST双向映射，支持键盘Tab新增与Delete删除，双击重命名并记录历史栈实现Undo/Redo
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`
- lesson(promoted): Markmap 原生 circle 与自定义按钮容易冲突，可通过 CSS 隐藏 circle 并在节点内容末尾自定义嵌入展开与添加按钮；Markmap 默认全展开需设置 initialExpandLevel: -1 并在数据变化时调用 setData 与 fit

### 20:08 | Antigravity

- done: 基于 Markmap 实现本地自研思维导图与在线幕布分段切换功能，支持思维导图与 Markdown 预览双模
- decision: 采用 markmap-lib/no-plugins 与 markmap-view 实现轻量化离线渲染；在侧边栏 Header 引入分段控件支持本地/在线无缝切换并保活在线会话；本地以 Markdown 为单一真实数据源，默认以思维导图呈现，并支持视口自适应、展开折叠、SVG导出及持久化存储
- added:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`
- modified:
  - `package.json`
  - `package-lock.json`
  - `src/renderer/src/components/WebviewSidebarPanel.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
- lesson(promoted): Markmap 采用 markmap-lib/no-plugins 导入 Transformer 能排除重型代码高亮和数学公式插件，大幅减小构建体积并消除运行风险；在侧边栏切换在线 Webview 与本地组件时，通过 CSS display:none 隐藏 WebviewCard 可避免销毁重建导致的页面重新加载与登录态中断

### 16:30 | Antigravity

- done: 修复单窗口与多窗口/任务分配模式切换时容器宽度计算为0导致窗口塌陷空白的问题
- decision: 在MainPage中引入containerEl状态与setContainerRef回调ref，确保容器节点切换时ResizeObserver及时重新挂载；忽略卸载时上报的0尺寸；在gridTemplateColumns列宽计算中若有效宽度为0则保底回退为minmax(0, 1fr)
- modified:
  - `src/renderer/src/pages/MainPage.tsx`
- lesson(promoted): 当React组件在不同模式分支下分别渲染挂载了同一个ref的DOM元素时，若useEffect仅监听isActive而不监听DOM节点或模式切换，会导致ResizeObserver滞留于已卸载节点并上报0宽度，新节点未被监听从而永久冻结在0px。必须使用callback ref追踪DOM节点变化，并在CSS Grid列宽处提供minmax(0, 1fr)安全保底

### 13:43 | Antigravity

- done: 优化顶部视窗切换按钮：辩论模式下自动隐藏，任务分配模式下隐藏单窗口选项
- decision: 在Layout组件中通过productMode条件判断在辩论模式下隐藏窗口切换栏，在任务分配模式下排除'one'选项；在appStore初始化中强化taskAssignmentDisplayMode不能为'one'的规范
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/store/appStore.ts`

## 2026-10-01

### 11:42 | Antigravity

- done: 实现单窗口占满视口与快捷侧边栏/思维导图交互复用
- decision: 抽离 useWebviewSidebar 与 WebviewSidebarPanel 模块化组件，主窗口与快捷窗口交互一致，单窗口 flat 全屏无留白，多窗口自动休眠侧边栏
- added:
  - `src/renderer/src/hooks/useWebviewSidebar.ts`
  - `src/renderer/src/components/WebviewSidebarPanel.tsx`
- modified:
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/pages/MainPage.tsx`

