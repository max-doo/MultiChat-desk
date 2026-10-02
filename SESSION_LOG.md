# Session Log

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
- lesson: 当React组件在不同模式分支下分别渲染挂载了同一个ref的DOM元素时，若useEffect仅监听isActive而不监听DOM节点或模式切换，会导致ResizeObserver滞留于已卸载节点并上报0宽度，新节点未被监听从而永久冻结在0px。必须使用callback ref追踪DOM节点变化，并在CSS Grid列宽处提供minmax(0, 1fr)安全保底

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
- lesson: UI 组件尺寸必须与应用核心面板（如 SettingsDrawer）规范看齐，避免局部页面为了紧凑而过度使用 text-xs 或 text-[10px] 导致可读性与点击舒适度下降

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
- lesson: 抓取网页对话时，ChatGPT 等平台 DOM 自带无障碍头 (如 <h4>你说：</h4>)，在 htmlToMarkdown 时会被转为 Markdown 噪音；因此提取消息必须主动过滤 DOM 伴生噪点，使用 XML 标签隔离结构，彻底避免语法与格式污染

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

