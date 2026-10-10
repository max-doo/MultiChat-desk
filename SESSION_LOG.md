# Session Log

## 2026-10-10

### 23:11 | Antigravity

- done: 提炼 FindInPage 会话参数经验至 KNOWLEDGE.md 与 INDEX.md，准备提交当前工作区修改并重新构建 Windows NSIS 安装包
- modified:
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
  - `SESSION_LOG.md`

### 21:50 | Codex

- done: 移除保存回复按钮；恢复多 AI、任务分配自动轮询快照，修复辩论 ref 重建导致多轮注入中断，并修正历史恢复锚点与同模型槽位快照。lint、build 与临时模拟回归验证通过。
- context: 保留工作区已有笔记、搜索、Webview 与 IPC 等未提交修改；未切分支。临时验证脚本位于系统 TEMP，不新增仓库测试框架。
- modified:
  - `AGENTS.md`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/hooks/useDebateRunner.ts`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 辩论轮询不能比较 React ref 对象引用；用 WebContents ID 绑定实例，发送前取基线，暂停后继续等待已发送回复。已修正 KNOWLEDGE 第9节与对应路由。
- unresolved: 类型检查存在原有报错（web 11、node 10），本次未新增；现有开发实例导致第二次 npm run dev 启动后退出，未进行真实 AI 网页桌面验收。computer use 授权问题待用户回复。

### 19:12 | Codex

- done: 修复笔记快照角色丢失：适配实际 ChatGPT DOM；导出保留 user/assistant 标签；UI 明确区分用户提问与模型回答，并保护代码块中的标签示例。
- decision: 保留内部角色标签；移除可能误删正文前缀的文本清理；只重新采集当前打开的一份真实笔记，批注与导图保持一致。
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/noteTranscript.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/NotesSourcePane.tsx`
- unresolved: 其他已丢失角色的历史快照需重新采集；其他平台仅验证 DOM 样例，未逐站实测；全量类型检查存在本次未修改位置的错误；原生导出对话框受桌面工具限制未完成保存，导出格式代码已定向验证。

### 18:52 | Antigravity

- done: 优化笔记页UI：顶部重排为标题+分段筛选器+自定义下拉筛选+搜索框并调换导出与对照原文位置；卡片头部将平台与日期内联至标题后；移除每条批注底部独立操作行，改为悬停摘录右上角浮现评论与删除操作
- decision: 顶部筛选改为Segmented Control并紧跟标题，复用CustomDropdown替换原生select；卡片标题行通过flex收缩标题并保持平台日期紧跟其后；摘录框自身点击定位原文，右上角悬浮毛玻璃操作条提供添加/编辑想法与删除，已有想法支持点击直接编辑
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/components/NotesConversationCards.tsx`
  - `src/renderer/src/styles/notesWorkspace.css`

### 15:22 | Antigravity

- done: 为 Webview 新增单卡片独立页面查找（Ctrl+F / Cmd+F）功能，支持主进程 before-input-event 按键转发、渲染层鼠标悬停兜底、匹配计数、大小写敏感切换、上下项跳转及 Esc 关闭
- added:
  - `src/renderer/src/components/WebviewFindBar.tsx`
- modified:
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/NotesSourcePane.tsx`
- lesson(promoted): Electron WebContents::FindInPage 底层 C++ 将 options.findNext 直接映射给 blink::mojom::FindOptions::new_session，因此首次搜索或修改关键词需传 findNext: true（开启新查找会话），而上下步进跳转需传 findNext: false（延续当前查找会话）

### 10:01 | Antigravity

- done: 优化设置中模型排序配置项说明文案与蓝色文本按钮样式
- decision: 精简说明文案为'将常用模型排在前面'防换行；将操作按钮改为轻量蓝色文字按钮 text-primary
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 09:59 | Antigravity

- done: 优化设置中模型排序配置项卡片样式与按钮视觉层次
- decision: 移除卡片中多余的模型图标胶囊，精简说明文字；按钮改为系统主题主色 bg-primary 避免与卡片白色毛玻璃背景融混
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 09:53 | Antigravity

- done: 设置中新增模型下拉列表顺序配置项与拖拽排序弹窗
- decision: 采用原生 HTML5 Drag and Drop 零新增依赖实现拖拽重排，释放时自动保存生效；修复 appStore 启动初始化尊重用户保存的模型顺序
- added:
  - `src/renderer/src/components/ModelOrderModal.tsx`
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/store/appStore.ts`

## 2026-10-09

### 20:05 | Antigravity

- done: 优化 WebView 右键菜单：仅在会话已存在思维导图时展示「加入当前导图」选项，无导图时自动隐藏
- context: 用户反馈当会话尚未创建导图时点击「加入当前导图」会创建失败，要求在会话不存在导图时不出现该选项
- decision: 在 webviewManager 中通过 NoteManager.findSource 实时检查当前会话的 mindmaps 数组，无导图时从 items 剔除该项
- added:
  - `src/shared/types/contextMenu.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
- unresolved: npm run lint 0 错误通过，npm run build 构建成功；受限于环境未运行桌面实例，由用户在桌面端右键验证有/无导图时的菜单项显示

### 19:53 | Antigravity

- done: 优化 WebView 右键菜单 UI 样式为应用统一自绘毛玻璃圆角风格，并为所有操作项配置 Material Symbols 矢量图标与快捷键提示
- context: 用户要求优化 WebView 当中的右键菜单 UI 样式并为每个选项添加 icon；基于应用统一设计规范实现自定义浮层菜单与 IPC 通信契约
- decision: 采用屏幕绝对坐标与宿主窗口内容区坐标转换实现跨多分屏精准定位；全屏透明遮罩保障在 WebView 内部及任意区域点击时可靠关闭；复用主进程原有导图/笔记/提问/复制粘贴能力
- added:
  - `src/shared/types/contextMenu.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
- unresolved: npm run lint 通过（0 错误/20 项既有警告），npm run build 成功，TypeScript 检查无新增错误；受限于环境按既有安排未运行桌面实例，右键弹窗视觉效果与操作交互需用户在桌面上点击验收

### 17:10 | Codex

- done: 移除原文侧栏顶部的原句未匹配引导条（含导图节点同类提示），清理只用于该引导的网页/快照匹配状态；保留高亮、定位重试及顶部来源菜单。
- context: 用户反馈原文已加载时仍出现引导，要求顶部不显示该提示。
- modified:
  - `src/renderer/src/components/NotesSourcePane.tsx`
- unresolved: npm run lint通过（0错误/20项既有警告），npm run build通过；npm run dev完成编译启动后新实例退出。按用户既有安排未使用computer use，移除提示后的桌面效果由用户验收。

### 17:01 | Codex

- done: 精简实际笔记卡片：移除footer、批注条数和批注时间；卡片header合并为图标/标题/导图入口主行与紧凑平台日期副行，全局header缩至64px并移除批注总数；摘录改为浅暖色背景、1px边框与引用图标，删除操作移至批注操作行。
- context: 保持整卡打开原会话、摘录定位、内联想法与同页导图交互；保留会话级更新日期，移除批注级时间。
- modified:
  - `src/renderer/src/components/NotesConversationCards.tsx`
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/styles/notesWorkspace.css`
- unresolved: npm run lint通过（0错误/20项既有警告）；npm run build通过；样式扫描无发现；npm run dev完成编译启动后新实例退出。沿用用户安排，不使用computer use，视觉效果由用户桌面验收。

### 16:49 | Codex

- done: 修复原文侧栏切换/卸载时removeInsertedCSS同步抛错导致React崩溃：清理前检查DOM连接与就绪状态并捕获同步异常，异步注入完成后的回收复用同一清理逻辑；刷新增加防护，识别Chromium错误页。补齐主会话首次loadURL的Promise拒绝处理。
- context: 依据用户控制台截图定位NotesSourcePane原163行；仅修改生命周期和异常处理，未改变布局、Session或IPC。
- decision: 加载失败交由既有did-fail-load状态和快照入口处理；卸载后的样式随guest销毁释放，不再强行调用guest方法。
- modified:
  - `src/renderer/src/components/NotesSourcePane.tsx`
  - `src/renderer/src/hooks/useWebviewLifecycle.ts`
- unresolved: npm run lint通过（0错误、20项既有警告），npm run build通过，npm run dev编译启动后新进程退出。按用户既有安排未使用computer use，快速切换会话与侧栏收放需要用户桌面复验；远端网页网络加载成功不在本次静态验证结论内。

### 16:36 | Codex

- done: 将实际笔记页改为会话卡片瀑布流首页；摘录使用浅灰背景与选中态，整卡打开原会话、摘录定位；导图入口置于卡片header，同页展开中间画布，左侧保留笔记，叉号关闭并恢复首页位置。
- context: 保留现有蓝白风格、原文黄色高亮、原网页优先与快照可选；复用列表摘要和既有IPC，无新增依赖。
- decision: 首页仅加载摘要，原文/导图详情按需读取；内联评论使用所属会话ID保存，原文反向选中批注不退出导图。
- added:
  - `src/renderer/src/components/NotesConversationCards.tsx`
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/styles/notesWorkspace.css`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: npm run lint通过（0错误/20项既有警告），npm run build通过；web类型检查仍被TaskModePanel/MainPage/QuickPage/appStore的Map迭代配置和useWebviewLifecycle的既有类型问题阻塞，本次修改文件未报错。npm run dev完成编译后新实例退出；按用户此前明确安排不使用computer use，桌面点击验收由用户完成。

### 16:13 | Codex

- done: 同步笔记首页与同页导图展开的原型设计说明，内联脚本语法检查通过，并提供更新后的本地预览链接。
- context: 本轮交付为可交互HTML原型，右侧原会话使用离线示例数据。
- modified:
  - `docs/prototypes/notes-workspace.html`

### 16:13 | Codex

- done: 更新原有笔记工作台 HTML 原型：会话卡片瀑布流首页、批注内联编辑、黄色高亮定位右侧原文、同页切换为左侧笔记与中间导图；完成独立离屏渲染与18项交互检查。
- context: 仅修改原型，沿用蓝白风格；未使用 computer use，未操作运行中的桌面应用。
- decision: 导图展开复用同一工作区，保留原文栏状态、导图缩放和返回首页的滚动位置；原网页优先，快照可选。
- modified:
  - `docs/prototypes/notes-workspace.html`

### 15:51 | Codex

- done: 导图版本菜单改为按最后编辑时间倒序排列，时间相同按创建时间及 ID 稳定排序
- decision: 复用导图现有 updatedAt 与保存后的 notes:changed 刷新，不新增持久化字段
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: 未获 computer use 授权，尚需在桌面窗口编辑旧导图并确认其保存后移动到菜单首位

### 15:41 | Codex

- done: 加固思维导图修改协议解析与网页标签识别，允许安全合并候选及保留冲突候选继续调整；lint、build 与 43 项定向检查通过，类型检查无新增诊断。
- decision: 仅归一化协议标签，保留正文空白和精确替换校验；时间戳变化不直接判内容冲突；不同位置修改三方合并，同处冲突保留候选并提供基于当前图调整。沿用现有 IPC，无新增依赖。
- modified:
  - `src/shared/utils/mindmapEdits.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/MindmapService.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- unresolved: npm run dev 编译成功，但启动的新进程被已有应用的单实例锁退出，未实际触发桌面 AI 生成链路。最小验收：完整退出并重启开发应用，验证缺失 new_text 闭标签、生成期间改另一分支后合并、同处冲突后基于当前图调整，以及失败后要求仍保留。两侧 tsc 共 22 条既有错误，本次未新增。

### 15:36 | Codex

- done: 按已确认原型重构实际笔记页：中央批注/导图、默认收起的右侧原文对照、网页优先快照可选、黄色高亮及双向定位；修复摘要列表更新时间倒序，导图点击来源保留缩放。
- context: 在当前分支局部实现，保留并行未提交修改，未新增依赖或 IPC。用户明确选择不使用 computer use、自行桌面验收。lint 0错误20既有警告，首次build成功；node/web类型检查被其他文件既有错误阻塞，本次文件无类型报错。npm run dev编译启动后因已有应用单实例退出。
- decision: 原网页和已访问的快照保留实例；高亮按规范化空白与锚点前后文消歧，有限重试且避免重复滚动；导图节点无法精确匹配原句时明确提示，仍保留上下文对照。
- added:
  - `src/renderer/src/components/NotesSourcePane.tsx`
  - `src/renderer/src/styles/notesWorkspace.css`
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/noteManager.ts`
- unresolved: 用户需重启开发版自行验收批注/导图切换、原网页与快照高亮及真实平台加载；全量tsc既有错误未纳入此次范围。

### 15:25 | Codex

- done: 思维导图多选节点现在可批量设置加粗和高亮，混合状态点击统一应用，全部已启用时点击统一取消
- decision: 复用既有框选与 Ctrl/Shift 多选状态；批量格式操作只提交一次树更新，工具条显示选中数量与混合状态
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- unresolved: 此前未获 computer use 授权，尚需在桌面窗口手动验收多选、批量格式、撤销及 Markdown 持久化；Web 类型检查存在 12 处既有错误

### 15:18 | Codex

- done: 思维导图节点就地编辑改为保留加粗与高亮的可视样式，提交和新增子节点时从编辑 DOM 还原 Markdown
- decision: 整节点格式在 contenteditable 容器上保持视觉状态，部分格式由 strong/mark 子元素保留；保存时仅序列化支持的两种格式
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/utils/mindmapInlineFormat.ts`
  - `src/renderer/src/styles/localMindmap.css`
- unresolved: 未获 computer use 授权，仍需在 npm run dev 桌面窗口手动确认鼠标选区、中文输入法、粘贴与保存恢复；渲染侧类型检查仍有既有错误

### 12:47 | Codex

- done: 将思维导图节点格式工具条改为深色，移除前置标签并给加粗与高亮按钮增加图标和明显的选中态；评估暂不扩展其他 Markdown 按钮
- decision: 保留两个整节点高频格式，避免在窄画布底部堆叠低频操作；其他格式待明确使用场景再加入
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- unresolved: 未获 computer use 授权，工具条桌面视觉与交互仍需在 npm run dev 窗口手动确认

### 12:43 | Codex

- done: 为本地思维导图节点增加整节点 Markdown 加粗与高亮工具条，画布渲染格式效果并保留 Markdown 原文
- decision: 工具条作用于单个选中节点；使用 **文字** 与 ==文字== 存储，根标题输入保持纯文字
- added:
  - `src/renderer/src/utils/mindmapInlineFormat.ts`
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/styles/localMindmap.css`
- unresolved: 当前会话未授权 computer use，需在 npm run dev 桌面窗口手动确认工具条位置、点击切换、编辑回显及保存恢复；渲染侧类型检查仍有既有错误

### 12:36 | Codex

- done: 按用户反馈精简笔记原型为单行工具区和默认收起的原文对照栏：黄色高亮、原网页优先、快照可选，删除中央完整原文 tab 与原对话弹窗；批注/导图来源一键并排定位。
- context: 独立 HTML 原型，继续保持项目蓝白风格，不操作用户桌面；原网页使用隔离的离线会话示例。
- decision: 中间始终保留批注或导图，右侧只展示来源；点击引用或节点直接展开来源，导图展开来源时保留缩放和选中位置。
- modified:
  - `docs/prototypes/notes-workspace.html`

### 12:36 | Codex

- done: 修复本地思维导图节点编辑时选中文本删除或 Ctrl+V 粘贴后意外退出编辑模式的事件处理
- decision: 保留明确的离开节点提交操作；对内容变化引起的短暂失焦恢复焦点，并避免编辑中双击重新初始化选区
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
- unresolved: 受限于当前会话未获 computer use 授权，需在 npm run dev 的桌面窗口手动复验拖选删除、拖选 Ctrl+V、点击外部提交与 Enter/Esc

### 12:21 | Codex

- done: 补充适配视口异步流程的实例存活检查，避免销毁后的导图实例继续执行最小缩放钳制
- decision: 在 fit 完成后先确认当前 Markmap 实例仍有效，再执行最小缩放修正，保持现有生命周期清理语义
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`

### 12:20 | Codex

- done: 限制思维导图缩放下限，禁止滚轮、工具栏和适配视口无限缩小
- decision: 统一使用 0.2 作为最小缩放比例：D3 scaleExtent 约束交互缩放，fit 与程序化缩小额外钳制，避免不同入口绕过下限
- modified:
  - `src/renderer/src/hooks/useMindmapCanvas.ts`

### 12:11 | Codex

- done: 调研 Readwise、Xmind 与 Obsidian，交付与现有蓝白 UI 风格一致的笔记/思维导图高保真 HTML 交互原型；离屏渲染验证双向定位、排序、评论、撤销、原文重新关联和响应式布局。
- context: 本次仅制作独立原型；复用项目主题色与平台图标；用户要求不使用 computer use。
- decision: 批注为默认主视图，思维导图为并列模式；来源按需展开。验证使用隔离的 Electron 离屏窗口，不读取应用数据。
- added:
  - `docs/prototypes/notes-workspace.html`

### 11:52 | Codex

- done: 取消思维导图生成时额外要求的字数输入限制，保留已有导图调整要求的 1000 字符限制并同步文档
- decision: 仅移除生成新图链路的前端 maxLength 与 mindmaps:start 主进程长度校验，保留调整已有导图的限制及来源对话上下文保护
- modified:
  - `docs/conversation-mindmap-prompt-optimization.md`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/shared/utils/mindmap.ts`

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

