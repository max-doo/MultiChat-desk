# Session Log

## 2026-10-04

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
- lesson: 在包含 SVG foreignObject 和 D3 zoom 的画布中，使用 DOM focus() 必须显式传入 { preventScroll: true }，否则 Chromium 会自动滚动最近的祖先容器导致整块画布视口突变；为浮动在节点边缘的操作按钮配置扩大命中范围的伪元素时，必须确保按钮自身具备独立的定位层级（relative + z-index），防止其父级绝对定位的伪元素将真实按钮遮挡拦截

### 16:12 | Antigravity

- done: 修复思维导图新建节点失败问题及优化UI：紧凑水平连线、描边按钮无填充、画布缩放按钮物理尺寸恒定
- decision: 通过 prevInitialMarkdownRef 区分外部受控更新与内部增删节点，彻底消除新建节点时的状态强制回滚；采用 scale(var(--mm-zoom-inv)) 确保画布缩放下操作按钮物理像素恒定
- modified:
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
- lesson: 在包含受控/非受控混用场景（如 initialMarkdown）的 React 组件中，避免在依赖项中监听内部编辑状态（markdown）来进行同步，否则内部任何状态更新都会被判定为与外部不同并触发强制回滚；对于绝对定位的 hover 操作按钮，需避免子元素与父元素之间出现事件空隙导致 hover 闪退

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
- lesson: 由于 electron-vite build 默认不执行 tsc 类型检查，在修改组件时需注意 hook 引入完整性，并可结合 npx tsc --noEmit 验证未定义引用

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

## 2026-09-28

### 20:23 | Antigravity

- done: 升级版本至 v1.2.5，更新 CHANGELOG 并准备执行 NSIS 打包构建
- decision: 完成代码规范校验与编译检查，同步升级 package.json 与 package-lock.json 到 1.2.5 并补充发布变更日志
- modified:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

### 20:18 | Antigravity

- done: 实现笔记批注侧边栏宽度可拖拽调节，并设置最小与最大宽度限制、双击重置及本地持久化
- decision: 采用 setPointerCapture 实现跨越 Webview 的平滑指针捕获，将批注侧边栏限制在 260px 到 520px（同时保留阅读画布至少 320px），支持双击快速恢复 320px 默认值
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`

### 20:10 | Antigravity

- done: WebView 中点击高亮笔记后点击其他区域自动关闭评论窗口，优化评论浮层边框样式
- decision: 通过 Webview 注入脚本监听点击高亮范围外时发送 NOTE_DISMISS_PREFIX，结合宿主窗口 pointerdown 事件实现跨进程失焦自动关闭评论窗口
- modified:
  - `.gitignore`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/NoteCaptureModal.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/utils/noteInteractions.ts`
  - `src/shared/types/notes.ts`
  - `src/shared/utils/noteTranscript.ts`
  - `src/shared/utils/webviewScripts.ts`

### 19:58 | Antigravity

- done: 移除右侧栏批注卡片的黄色描边，并将笔记页面的图标与控件尺寸与设置面板规范对齐统一
- decision: 批注卡片聚焦态切换为与设置面板一致的 primary 蓝光微阴影 (ring-2 ring-primary/20)，引文采用沉稳蓝灰边框取代黄色描边；将全页面所有过小的 text-xs/text-sm 图标放大至 text-base/text-lg/text-xl，搜索框与下拉列表加大至 text-sm py-2
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`
- lesson(promoted): UI 组件尺寸必须与应用核心面板（如 SettingsDrawer）规范看齐，避免局部页面为了紧凑而过度使用 text-xs 或 text-[10px] 导致可读性与点击舒适度下降

### 19:51 | Antigravity

- done: 使用 XML 标签 (<user> / <assistant>) 隔离快照中的用户问题与 AI 输出，并在精读快照中以蓝色气泡展示用户提问
- decision: 快照抓取不再侵入修改 Markdown 标题或拼接 GPT 说，采用 <user time='...'> 和 <assistant> XML 标签解耦；前端渲染层将 <user> 呈现为蓝色提问气泡并保留行号映射以保障大纲跳转与划词高亮
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/noteTranscript.ts`
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/NoteCaptureModal.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `.gitignore`
- lesson(promoted): 抓取网页对话时，ChatGPT 等平台 DOM 自带无障碍头 (如 <h4>你说：</h4>)，在 htmlToMarkdown 时会被转为 Markdown 噪音；因此提取消息必须主动过滤 DOM 伴生噪点，使用 XML 标签隔离结构，彻底避免语法与格式污染

### 19:42 | Antigravity

- done: 放宽快捷窗口侧边栏最大宽度限制至1200px
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/pages/QuickPage.tsx`

### 19:39 | Antigravity

- done: 优化批注卡片与目录Tab显示：移除批注卡片划词序号标签、完整显示引文原文不再截断、删除按钮移至底部操作行右对齐、移除目录Tab标题计数标签
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`

### 19:37 | Antigravity

- done: 修正本地快照 Markdown 引用样式：将 blockquote 恢复为中性浅灰底边框，避免与用户暖琥珀金划词高亮混淆冲突
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`

### 19:36 | Antigravity

- done: 优化笔记页面细节：弱化会话卡片数量标签表达、侧边栏划词项支持2行并可直接删除、切换器改为本地快照、右侧边栏去掉Header描边并将首个Tab设为批注第二个设为目录
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`

### 19:27 | Antigravity

- done: 优化笔记页面 UI 设计：重构为整体风格协调的漫反射毛玻璃三栏工作台，支持快照与原网页 Tab 切换，右侧集成目录大纲与批注列表，升级纸感暖琥珀金高亮
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/NoteCaptureModal.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `.gitignore`

### 18:12 | Codex

- done: 修复 ChatGPT Webview 保存笔记时抓取脚本在正式构建中执行失败；移除函数 toString 注入并补充读取降级
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/webviewManager.ts`
- lesson(promoted): 构建启用 JavaScript 混淆时，不要通过函数 toString 生成 Webview 注入脚本；函数体可能依赖主进程混淆器生成的名称映射，进入隔离页面后失效。

### 18:11 | Antigravity

- done: 快捷窗口新增思维导图功能，复用侧边栏加载幕布并支持30秒休眠
- added:
  - `docs/superpowers/specs/2026-09-28-quick-window-mindmap-design.md`
  - `docs/superpowers/plans/2026-09-28-quick-window-mindmap.md`
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`

### 18:03 | Codex

- done: 笔记页右侧新增随高亮定位的评论卡片和无评论添加入口；新快照保持标题格式，停止旧快照自动转换
- modified:
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/main/noteManager.ts`
  - `src/shared/utils/noteTranscript.ts`

### 17:52 | Codex

- done: 按截图调整笔记页标题栏导航、固定会话标题、原网页平台 Logo、常用黄色高亮及旧快照用户问题一级标题
- context: 隔离 Electron 实例验证返回/笔记双向导航、旧快照 Markdown 一级问题与二级回复、目录、移除通用标题、侧栏平台 Logo 和固定标题；lint/build/dev 与 diff 检查通过
- added:
  - `src/shared/utils/noteTranscript.ts`
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/NoteCaptureModal.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/noteManager.ts`

### 17:36 | Codex

- done: 优化笔记交互：右键即保存高亮、非模态评论卡片、Webview 高亮点击评论删除、一级二级目录和重复笔记去重
- context: 隔离 Electron 实例验证 Markdown 提问一级标题、AI 回复二级标题、目录仅一级二级、同会话两笔记、点击高亮回传、非模态评论保存和删除；并发重复保存与旧数据去重合并通过；lint/build/dev 通过
- added:
  - `src/renderer/src/utils/noteInteractions.ts`
- modified:
  - `src/shared/types/notes.ts`
  - `src/main/noteManager.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/NoteCaptureModal.tsx`
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/assets/index.css`

### 16:47 | Codex

- done: 补充验证 Markdown 快照与原页面 DOM 高亮，修复多 main 区域选择问题，并验证旧笔记合并后的修改删除
- context: 隔离 Electron 页面合成对话 DOM：提问/AI 回复 Markdown 成功，高亮匹配 1 处；旧版分组数据合并、修改、删除成功；lint、build、dev 均通过
- modified:
  - `src/shared/utils/webviewScripts.ts`

### 13:48 | Codex

- done: 修正笔记会话归组、Markdown 对话快照、原网页高亮和笔记页并排查看及定位
- context: 隔离 Electron 实例中用合成笔记验证单会话归组、本地快照高亮和并排侧栏；真实站点登录态与 DOM 需用户本机复核
- added:
  - `src/shared/utils/noteIdentity.ts`
- modified:
  - `src/main/noteManager.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/NoteCaptureModal.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`

### 12:40 | Codex

- done: 将共享笔记类型与脚本纳入主进程和渲染层 TypeScript 项目范围
- modified:
  - `tsconfig.node.json`
  - `tsconfig.web.json`

### 12:38 | Codex

- done: 同步仓库规则与实际 Electron 版本、构建命令和共享 Webview 文件位置
- modified:
  - `AGENTS.md`

### 12:38 | Codex

- done: 实现按会话分组的本地笔记管理、右键采集对话快照和侧栏原对话高亮
- added:
  - `src/main/noteManager.ts`
  - `src/renderer/src/components/NoteCaptureModal.tsx`
  - `src/renderer/src/pages/NotesPage.tsx`
  - `src/shared/types/notes.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/shared/utils/webviewScripts.ts`
- unresolved: 第三方平台懒加载的旧消息与非文本媒体不能仅靠当前 DOM 保证完整采集，需逐平台验证

