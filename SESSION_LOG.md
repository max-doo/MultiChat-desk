# Session Log

## 2026-11-20

### 11:38 | Codex

- done: 文件树代码文件图标改用 vscode-material-icon-theme 官方 SVG；非代码文件还原 Material Symbols
- added:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/assets/file-icons/*.svg`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 11:38 | Codex

- done: 工作台左栏最小宽度 180→260px，容纳头部全部 7 个图标（搜索/新建笔记/新建文件夹/排序/折叠全部/刷新/收起侧边栏），防止最小宽度下图标被挤出
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 11:34 | Codex

- done: 工作台文件树图标改为 Seti/VSCode 风格 SVG 图标组件，按语言/格式区分
- added:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 11:33 | Codex

- done: 用户澄清 DOM 探针只能在 Codex 内置浏览器 IAB 执行，不可探测 MultiChat 应用内 webview;核查 tracked diff 均为工作台既有功能(文件树拖拽/多选/Office预览/窗口拖动修复)与SESSION_LOG记录一致，src/ 下无探针残留代码，无需代码撤回;docs/reply-action-dom 五家探针文档与设计文档保留
- context: 已探5家: chatgpt/gemini/qwen/doubao/yuanbao;未登录8家走通用回退
- decision: DOM探索通道=IAB而非应用内webvieview

### 11:32 | Codex

- done: 工作台文件树多选（VSCode风格）：Ctrl/Cmd 切换、Shift 从锚点范围选（基于当前展开态扁平化），普通点击单选并打开/折叠，选中态底色高亮；拖拽整组移动、右键未选中项先单选、多选批量删除（数量确认弹窗）；新建位置跟随最后一个选中项（anchorPath）
- decision: selectedPaths/anchorPath 为组件本地 state（不入 zustand），范围选择基于 flatVisibleNodes 保证只覆盖可见项
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 11:30 | Codex

- done: 工作台文件识别扩展：Excel/PPT/ODF/RTF 等 Office 格式纳入 document 类别
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 11:28 | Codex

- done: 工作台文件树：新增拖拽移动（文件/文件夹拖到目录上归位、拖到文件上入其父目录、拖到空白回根目录，目标目录高亮+自动展开，循环嵌套与原地拖放防护，复用 renameNode 同步 activeFilePath）；新建位置跟随选中文件父目录（activeFilePath）
- decision: 拖拽移动复用既有 workbench:rename-node IPC 实现跨目录移动，无新增 IPC；拖到文件上等价归入其父目录（VSCode 行为）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 11:26 | Codex

- done: 修复自绘标题栏拖动飞出屏幕：首个 drag-move 时无条件重置 startContentBounds 导致窗口漂移出屏；改为仅在最大化还原那一帧重置基准并更新 startMousePoint，非最大化拖动恢复原逻辑
- modified:
  - `src/main/ipcHandlers.ts`
- lesson: 对拖动基准点（startMousePoint/startContentBounds）的写操作要严格限定在状态转换的那一帧；每帧无条件重置会破坏 delta 语义，窗口以帧数×位移漂移出屏

### 11:23 | Codex

- done: 修复最大化状态下单击标题栏空白误还原窗口：restoreCustomMaximizedWindowForDrag 从 window-drag-start 移到首次 window-drag-move，最大化时只有实际拖动才还原（对齐原生行为）
- modified:
  - `src/main/ipcHandlers.ts`
- lesson: 自绘窗口拖动链路上 mousedown 不等于拖动开始；最大化还原、窗口尺寸变化等副作用应挂在首个 move 事件上

### 11:22 | Codex

- done: 工作台侧边栏交互优化：新建文件/文件夹改为树内联输入框（VSCode风格，右键文件→其父目录、文件夹→其内部、空白→根目录，Enter/失焦提交、Esc取消），新增文件树排序菜单（名称/修改时间/大小 + 升降序），排序偏好持久化到 electron-store
- decision: 排序放 renderer 端对已有 fileTree 重排，主进程 readTree 排序保留作为默认顺序，避免改 IPC 契约
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 11:14 | Codex

- done: 统一 AI 侧边栏折叠按钮:WorkbenchAiSidebar 内部按钮改 QuickPage 风(w-7 h-7 rounded-full + text-base + right_panel_close),Layout.tsx 三处标题栏按钮图标由 dock_to_right/vertical_split 改为 right_panel_open/right_panel_close,与左栏 left_panel_open/close 同系列
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 11:13 | Codex

- done: 工作台侧边栏视觉对齐 QuickPage:折叠/展开图标换为 left_panel_close/left_panel_open+w-7 h-7 rounded-full 风格,header 高度 h-10→h-12 与中间编辑区统一,图标 text-[19px]→text-[20px],移除顶部工作区名,其他按钮左对齐折叠按钮单独靠右,最外层容器去背景与模糊
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 11:12 | Codex

- done: 工作台分割线：2px 改细一档，颜色 #9ca3af→#b9bfc7，保持比标题线重的层级但不过重
- modified:
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 11:08 | Codex

- done: 工作台分割线：移植 playground HR transformer(triggerOnEnter+末尾insertBefore)，主题分隔线加粗至3px
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 11:06 | Codex

- done: 工作台左栏改为可折叠侧边栏+底部仓库管理入口:顶部 close 改为折叠按钮,底部新增 Obsidian 风格的当前仓库条(点击上弹最近工作区+管理仓库),管理弹窗支持切换/移除/选择新文件夹/关闭工作区;折叠后展开按钮嵌入中间工具栏最左(富文本+源码模式);store 新增 recentWorkspaces 持久化
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 10:57 | Codex

- done: 工作台第六轮：段落格式下拉/表格操作菜单/浮动条定位由useEffect改useLayoutEffect+去掉animate-in入场动画(修复菜单先闪现页面顶部再瞬移的跳动)；标题层级按typographic scale调整(h1=28/h2=22/h3=18/h4+=16全部加粗)并加段前间距与首标题豁免
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTableActionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:56 | Codex

- done: 工作台第五轮：表格GFM双向序列化(移植playground TABLE transformer进MarkdownSyncPlugin)、新增WorkbenchTableActionMenuPlugin单元格角标菜单(插删行列/合并拆分/表头/斑马纹)
- added:
  - `src/renderer/src/components/workbench/WorkbenchTableActionMenuPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:48 | Codex

- done: 工作台第四轮：标题加粗分级+h1/h2浅色下边框、无序列表圆点修复(disc+ulDepth)、代码块/行内代码加圆角、新增highlight高亮格式(toolbar+浮动条+主题类)、源码模式改为行号+Prism markdown高亮的WorkbenchSourceEditor并删返回按钮、'已保存'改灰字
- added:
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/types/prismjs.d.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:38 | Codex

- done: 工作台第三轮：渲染主题整体换为 playground PlaygroundEditorTheme（段落/标题/引用/代码/列表/表格/分割线/行内格式全套类名+样式写入 index.css）、移植 TableCellResizer 单元格行列拖拽调整、'+'菜单去掉筛选输入框
- added:
  - `src/renderer/src/components/workbench/WorkbenchTableCellResizerPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:23 | Codex

- done: 工作台第二轮：拖拽 handle 加 '+' 按钮+组件选择菜单（移植 playground DraggableBlockPlugin/ComponentPickerPlugin）、富文本/源码改预览/源码、编辑器与左侧文件树整体 UI 放大
- added:
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `docs/workbench-lexical-playground-parity.md`

### 10:15 | Codex

- done: 修拆解无返回：严格 <task_split> 包络解析失败时退到 parseSubtasksLenient 逐 <subtask> 兜底（平台回显/松包裹场景）；<subtask> 标签正则容空格
- modified:
  - `src/shared/utils/taskSplit.ts`
  - `src/main/services/TaskSplitService.ts`
- unresolved: DeepSeek 后台拆解端到端仍需 npm run dev 实测确认

### 10:11 | Codex

- done: 删拆解弹窗，平台选择器改为控制条内联 CustomDropdown（direction=up、全部 models、持久化 apiConfig.taskSplitPlatform），拆分左右加「查看网页/取消」；useTaskSplit 暴露 task 状态与 trim 对齐
- modified:
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/hooks/useTaskSplit.ts`
- removed:
  - `src/renderer/src/components/modes/TaskSplitModal.tsx`

### 10:07 | Codex

- done: 工作台编辑器对齐 Lexical Playground：下拉 portal 化防裁剪、工具栏状态回显与 toggle 语义、新增选中浮动格式条、移除手动保存改为纯防抖自动保存
- context: playground 源码 packages/lexical-playground (meta/lexical) 已 sparse checkout 到 %TEMP%\lexical-repo
- added:
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `docs/workbench-lexical-playground-parity.md`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: Electron 工具栏下拉要复刻 playground 必须用 createPortal+fixed 到 body，不能用 absolute 塞在 overflow-x-auto 容器里

### 10:03 | Codex

- done: 修任务拆解两处：平台下拉复用 webview 顶部样式（renderButton/renderOption logo+名称）、放开全部 models 不再限 enabled；确认 tasksplit:start 未注册是主进程未重启的 HMR 现象
- modified:
  - `src/renderer/src/components/modes/TaskSplitModal.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
- lesson: Electron 改主进程 IPC 后必须重启 npm run dev/electron，HMR 只热渲染层，preload/主进程不生效——报 'No handler registered' 先想到重启而非代码缺失

### 09:53 | Codex

- done: 按设计文档落地任务拆解后台 Web AI：TaskSplitService+tasksplit:*IPC+<task_split>XML输出+三态解析；删 API 模式全部链路（供应商/模型/IPC/弹层/迁移）；lint 0 errors、build 通过
- added:
  - `src/main/services/TaskSplitService.ts`
  - `src/shared/utils/taskSplit.ts`
  - `src/shared/types/taskSplit.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `src/renderer/src/components/modes/TaskSplitModal.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`
  - `docs/task-split-web-backend-design.md`
- removed:
  - `src/main/api/taskSplitApi.ts`
  - `src/main/config/requestBodyConfig.ts`
  - `src/main/config/taskSplitPrompt.ts`
- unresolved: npm run dev 手动验证未做：后台拆解端到端（登录态、<task_split>解析、取消/查看网页）需真实平台确认

### 09:44 | Codex

- done: 按独立评审修订拆解设计方案：输出格式由 JSON 改为 <task_split><subtask> 标签、补三态解析与 goal+taskId 双校验；原型标注子任务可编辑
- modified:
  - `docs/task-split-web-backend-design.md`
  - `docs/prototypes/task-split-web.html`

### 09:28 | Codex

- done: 设计任务拆解改走后台 Web AI 的方案：TaskSplitService 仿 MindmapService，删除 API 模式；交付设计文档与高保真 HTML 原型（沿用现有控制条/弹层形态）
- added:
  - `docs/task-split-web-backend-design.md`
  - `docs/prototypes/task-split-web.html`

### 09:25 | Antigravity

- done: 将 add_workbench_markdown_knowledge_base 分支合并至主分支 main，完成依赖同步与全量打包验证，并清理该 worktree

### 02:14 | Antigravity

- done: 修复工作台多格式预览(代码/图片/PDF/DOCX)致命写盘覆盖Bug、超大文件防御降级与代码语法高亮优化
- decision: 保持DOCX零生产依赖决策，以专属元信息卡片呈现并提供系统默认办公软件一键打开；对超大图片(>20MB)、超大PDF(>50MB)与大代码(>5MB)采用友好降级卡片替代Toast报错阻断
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `scripts/verify_workbench_previews.py`
- lesson(promoted): 在扩展编辑器支持只读或二进制文件（图片/PDF/Word）时，必须严格在 store、UI 全局快捷键与主进程文件写入三层严密拦截写盘调用，否则 Ctrl+S 会将空文本写入二进制文件造成不可逆数据破坏；此外，文件预览组件必须带有 key={activeFilePath} 确保文件切换时重置缩放旋转与编辑等局部状态

### 01:52 | Antigravity

- done: 支持工作台代码、图片、PDF预览及同系列专属图标，完成DOCX依赖评估与卡片集成
- decision: DOCX渲染需引入ZIP解压与OpenXML解析重型依赖(mammoth/docx-preview)，不宜静默引入；采用专属Word卡片与1-click系统默认程序打开方案
- added:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
  - `scripts/verify_workbench_previews.py`
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: 文件树图标使用Material Symbols统一体系可避免引入外部图标包；二进制文件通过Base64 DataUrl经IPC传递到Renderer可规避Chromium跨协议file://安全拦截

### 01:31 | Antigravity

- done: 修复工作台DraggableBlockPlugin文字块拖拽handle未绑定ref、侧边栏折叠销毁Webview导致状态丢失、分割线HR Markdown转换缺失及Splitter拖拽被Webview拦截问题，并通过Playwright完成完整前端网页验收
- added:
  - `scripts/verify_workbench_frontend.py`
  - `workbench_verified.png`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
- lesson: Lexical的DraggableBlockPlugin_EXPERIMENTAL不会自动为menuComponent包裹或注入ref，必须显式在自定义Handle根节点声明ref={menuRef}，否则menuRef.current始终为null导致setMenuPosition不生效、handle无法定位；侧边栏内嵌Webview组件折叠时切勿直接return null，应利用容器display:none维持挂载以保证模型常驻不重载；拖拽Splitter调整窗格必须使用setPointerCapture以防鼠标滑入webview被原生截获

### 01:14 | Antigravity

- done: 优化工作台 UI 设计规范与字体大小、将侧边栏入口移至最小化按钮前、支持源码模式双向无缝切回、补齐 Lexical 全部富文本能力（含文字块拖动、待办清单、表格、水平分割线等），并在侧边栏直接复用 WebviewCard
- decision: 在标题栏右侧最小化按钮前增加工作台 AI 侧边栏展开/折叠入口；侧边栏直接复用 WebviewCard 标准头部与平台下拉；富文本采用 Meta Lexical 官方 DraggableBlockPlugin_EXPERIMENTAL 实现文字块拖拽重排
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 00:34 | Antigravity

- done: 修复 MainPage 在 workbench 模式下 modeModels 未定义导致 TypeError: Cannot read properties of undefined (reading 'length') 的问题
- decision: 在 MainPage modeModels 中补全 workbench: []，并对 currentModeModels、prevModeModels、currentModels 增加兜底守卫，避免模式切换导致 React 崩溃
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 00:04 | Antigravity

- done: 修复 Windows 下 npm run dev 触发 EACCES 5173 端口排除冲突问题
- modified:
  - `electron.vite.config.ts`
- lesson: Windows 下 Hyper-V/WSL/WinNAT 动态排除端口范围（如 5141-5240）会导致 Vite 默认 5173 绑定报错 EACCES: permission denied；在 electron.vite.config.ts 中将 renderer.server.port 避开该区间（如 5300）并指定 host 127.0.0.1 即可彻底解决

## 2026-11-19

### 23:43 | Antigravity

- done: 实现工作台本地Markdown知识库功能（Obsidian式文件树、三栏布局、Meta Lexical富文本编辑器、AI侧边栏与划词右键提问）
- decision: 采用Meta Lexical作为Markdown富文本内核配合YAML Frontmatter保留管道；工作台顶层容器挂载彻底隔离MainPage底部ControlBar；右侧复用WebviewCard并打通划词注入
- added:
  - `docs/workbench_product_spec.md`
  - `src/main/services/workbenchService.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- modified:
  - `package.json`
  - `package-lock.json`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/shared/types/history.ts`

### 23:42 | Antigravity

- done: Conduct Phase 3 Acceptance Verification for Workbench feature
- decision: Acceptance Verification PASSED: verified Layout entry, 3-column layout, Lexical kernel, YAML frontmatter preservation, auto-save, scoped AI contextual menu, isolated WebviewCard sidebar, assertSafePath realpath symlink defense, clean lint/build.
- added:
  - `docs/workbench_product_spec.md`
  - `src/main/services/workbenchService.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/App.tsx`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/shared/types/history.ts`
  - `package.json`
  - `package-lock.json`

### 23:36 | Antigravity

- done: Implement MultiChat Desk Workbench UI, Lexical editor, Obsidian-like file tree, search, and AI Webview sidebar
- decision: Decoupled WorkbenchPage in App.tsx with display:none to isolate ControlBar and chat monitors; preserved YAML frontmatter during Lexical AST sync; reused WebviewCard with isolated=true and unique instance ID
- added:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- modified:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/shared/types/history.ts`

### 23:24 | Antigravity

- done: 实现工作台 (Workbench) 共享类型、文件系统服务与安全校验、IPC 处理器与 Preload 桥接
- decision: IPC 支持对象与位置参数双重解构，兼容多种前端调用风格；Preload 同时暴露 api.workbench 命名空间与扁平别名；文件路径校验严格比对 realpath 双向解析以彻底阻断符号链接逃逸
- added:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`

### 23:13 | Antigravity

- done: 根据评审意见修订工作台(Workbench)设计规范
- decision: 在设计规范中完善realpath软链接防范、Frontmatter保护、App.tsx顶层挂载隔离、切文件脏数据保护、搜索300ms防抖与序列锁、右键菜单编辑器作用域隔离以及生产依赖审批说明
- modified:
  - `docs/workbench_product_spec.md`

### 23:06 | Antigravity

- done: 编写工作台(Workbench)产品与技术设计规范
- decision: 采用Meta Lexical作为Markdown知识库编辑内核，三栏布局无缝复用WebviewCard与共享Session，主进程实现assertSafePath严格防范路径遍历
- added:
  - `docs/workbench_product_spec.md`

### 21:37 | Codex

- done: 修正 Client Hints 品牌一致性：sec-ch-ua 改用 Electron 实际发送的 Not/A)Brand+Chromium，与 navigator.userAgentData.brands 保持同源，避免请求头与页面 JS 品牌矛盾
- context: 用户要求按最小方案实施浏览器伪装补强
- decision: 只用 Electron 自身真实品牌值补齐主文档缺失的 Client Hints，不伪造 Google Chrome 品牌，避免引入跨层不一致
- modified:
  - `src/main/webviewManager.ts`
- lesson: 伪造 Client Hints 时必须与 navigator.userAgentData.brands 同源：把 Google Chrome 写进 sec-ch-ua 而 JS 层只有 Chromium 会制造新矛盾；Electron 的 getHighEntropyValues 内部不读被覆盖的 brands，页面级 patch 不可靠
- unresolved: window.chrome 空对象与 outerWidth/innerWidth 差值未处理；未在 npm run dev 真实站点端到端验证

### 21:34 | Codex

- done: 重建共享 Session 标准 Chrome UA 并补齐主文档 Client Hints，消除 Electron 指纹中的 UA 应用名泄漏与 sec-ch-ua 缺失
- context: 用户询问浏览器伪装是否可能被识别为 Electron，先做审计后用独立 worker 复核并查外部文档，最终按'先补 sec-ch-ua、再重建 UA'的顺序实施
- decision: 只改主进程 setupSharedSessionUserAgent，不动渲染层与 preload；不引入 window.chrome shim 等 stealth 手段，避免过度工程化
- modified:
  - `src/main/webviewManager.ts`
- lesson: Electron 默认 UA 为 <平台段> <应用名>/<版本> Chrome/x Electron/x Safari/x，只删 Electron/ 仍留应用名 token，需整段重建；主文档导航请求默认不发 Client Hints，可用 session.webRequest.onBeforeSendHeaders 按 mainFrame/subFrame 补齐，子资源请求本身会发需判重避免覆盖
- unresolved: 未在 npm run dev 中做真实站点端到端验证；window.chrome 空对象与 outerWidth/innerWidth 差值未处理

### 15:56 | Codex

- done: 审核 1.3.1 CHANGELOG 并修正 4 处过度承诺表述
- context: 发版前审核：原生下载按钮改为'优先点击+兜底提取'，引导卡片补 PATH 前提，日期更新为实际发布日
- modified:
  - `CHANGELOG.md`

### 00:12 | Codex

- done: 按新模板简化 Agent Skill 安装指引文案：路径由运行时解析、去掉硬编码 .agents/skills 与 POSIX 家目录写法，天然兼容 macOS
- modified:
  - `src/renderer/src/utils/cliGuide.ts`

## 2026-11-18

### 17:46 | agent

- done: README 更新 macOS 支持声明
- context: mac dmg 已在 Release 提供，README 此前只写 Windows 下载
- modified:
  - `README.md`

### 17:28 | agent

- done: macOS CLI/Skill 集成缺口修复：CliAgentHint 在 darwin 打包版可弹出、status 增加 platform 字段、设置页加复制调用命令、multichat.sh/run_task.sh 加执行位、SKILL.md 补 mac/Linux cli.json 路径
- modified:
  - `src/shared/types/cli.ts`
  - `src/main/cliIntegration.ts`
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `src/renderer/src/components/CliIntegrationSection.tsx`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `build/cli/multichat.sh`
  - `.agents/skills/multichat-cli/scripts/run_task.sh`
- lesson: macOS Electron 应用常驻旧进程会让 open 只激活而不重启，验证新版本前必须先 kill 旧实例（单实例锁）；electron-builder extraFiles 不会自动补可执行位，.sh 入口需在仓库内 chmod +x

### 17:46 | Codex

- done: 核查 CliAgentHint 弹窗触发逻辑：isPackaged+onPath+!hintDismissed；.install-stamp 由 NSIS 每次安装重写，关闭时清除
- context: 用户截图询问 multichat 就绪弹窗是否只在安装后首次打开提醒

### 16:59 | Codex

- done: 生图捕获修复+附件改粘贴式上传：doubao/chatgpt 图+文生图实测全通过
- context: doubao/chatgpt --image + --gen-image 图生图链路验收
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/services/AutomationService.ts`
- lesson(promoted): CLI --image 附件上传改用'粘贴式'优于 CDP 拖拽：主进程 readFile→base64→页内 new File+DataTransfer+ClipboardEvent(paste) 派发到输入框，主流 AI 编辑器(ProseMirror/Slate/Lexical)都监听 paste 解析附件，不依赖 drop 监听/落点坐标/附件区 DOM；doubao 实测一次通过，旧拖拽 90s 超时根因是附件 chip 只渲染缩略图不落文件名文本致 found 检测永远 false
- lesson(promoted): extractImages 生图探针必须只认生图专用容器(genImageOnly)：messageContainer 兜底 document.body 会把用户上传附件的回显缩略图当'已生成'产物，chatgpt 实测提前 done 抓到上传参考图而非生成图

### 16:39 | Codex

- done: Raised attachment upload timeouts for CLI --image path: uploadAttachments 30s->90s, generateSendMessageScript secondary confirm 15s->30s (named constant + comment), based on agent report of gemini/doubao image-upload timeouts
- modified:
  - `src/main/services/AutomationService.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson: --image upload has two layered timeouts (drop->ready 30s, ready->send 15s) both hardcoded; gemini/doubao OCR/preview latency can exceed the short ones — keep primary poll long enough to absorb that

### 16:36 | Codex

- done: 修复豆包/ChatGPT 生图捕获：消息容器补生图选择器+extractImages 过滤过程产物
- context: CLI --gen-image 生图下载链路验收
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson: extractImages 的 findLatestContainer 依赖 messageContainer 命中含图容器——豆包生图 message_image_content 是文本容器[data-streaming]的兄弟节点，须把生图容器并入 messageContainer;ChatGPT 生成中 Placeholder 骨架含半成品 img 会被误判为完成,需 isInProgressArtifact 按 data-finished/placeholder 标记过滤

### 16:32 | Codex

- done: Addressed agent feedback on multichat-cli skill: simplified cli.json lookup to install dir, flagged gemini/doubao image-upload flakiness, documented imageError markdown-URL recovery, and steered cli.json reads away from cat
- modified:
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson: External agents reported real failure modes not covered by the skill: platform-specific --image upload flakiness, imageError recovery via reply markdown URLs, and the implicit cat habit for reading APPDATA manifests — these belong in the skill, not left for the agent to discover

### 13:22 | Codex

- done: 提交 11-18 CLI Agent 链路改动（feat 2225c7b + chore 7350e34）并重新构建 NSIS 安装包 dist/MultiChat Setup 1.3.1.exe（签名通过，124.3MB）；删除脚本误产生的 nul 残留文件
- context: 用户要求提交修改并重新打包安装包；lint 0 errors（存量 warning），electron-builder 签名通过
- modified:
  - `dist/MultiChat Setup 1.3.1.exe`
- removed:
  - `nul`
- lesson: Windows 下脚本把输出重定向到 nul 会在仓库根目录生成名为 nul 的实体文件，需用 \\?\ 前缀路径删除

### 13:16 | Codex

- done: 把主进程选择器版本校验写入 KNOWLEDGE，并标记对应 lesson 已提升
- modified:
  - `.memory/KNOWLEDGE.md`

### 13:16 | Codex

- done: 补上主进程选择器版本校验：低于默认版本的已保存配置整体作废，避免旧版 qwen 域名继续生效；验证 v19 回退默认、v20/21 仍用自定义
- modified:
  - `src/main/services/AutomationService.ts`
- lesson(promoted): 主进程 AutomationService 读 store 选择器时要和渲染层 getSelectors 一样做 version 比较，否则旧配置里的废弃域名会长期生效

### 13:13 | Codex

- done: 把千问域名切换的实测结论（发送链路、研究模式幂等、三处域名落点）并入 KNOWLEDGE 既有条目
- modified:
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 千问切换 qianwen.com 后自动化可用：contenteditable + execCommand 写入正常，发送按钮由 disabled 变可用

### 13:13 | Codex

- done: 千问域名切换验收：qianwen.com 首页与会话页的输入/发送按钮试运行均通过，研究模式开关幂等；旧域名 tongyi.aliyun.com 301 到 www.qianwen.com，origin 统一
- context: 用户批注：千问域名切换是否影响自动化入口
- decision: 桌面端默认入口、后台自动化兜底 URL 一并改为 https://www.qianwen.com/；笔记平台名保留新旧两个 hostname 映射
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/webviewManager.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): 千问自动化实测：首页与 /chat/<id> 的输入框是普通 contenteditable div，走 execCommand('insertText') 分支可用；发送按钮 aria-label 为「发送消息」，输入后由 disabled 变可用
- lesson(promoted): 域名迁移要同时检查四类落点：选择器 newConversationUrl、主进程兜底 URL 表、渲染层默认模型列表、按 hostname 映射的展示名

### 13:04 | Codex

- done: 登录态值判定收尾：域名按标签边界匹配，补注释说明名字命中不等于已登录
- modified:
  - `src/main/services/AuthStateService.ts`

### 13:02 | Codex

- done: 补正登录态判定：chatglm/yuanbao 游客态会写同名 cookie，改为按 JWT is_guest 与 a_did_ 前缀做值判定
- modified:
  - `src/shared/config/selectors.ts`
  - `src/main/services/AuthStateService.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson: 登录态名单必须用游客态与登录态双向取样；只看登录态会把游客写同名 cookie 的平台误判

### 12:53 | Codex

- done: CLI 登录态识别修复：补齐 chatglm/yiyan/arena/qwen 的 cookie 名单与 kimi localStorage 通道；修正 deepseek 空壳 userToken 误判；qwen 自动化站对齐 qianwen.com 并给 aria-pressed 开关加幂等守卫
- decision: qwen 自动化目标站从 chat.qwen.ai 改为 www.qianwen.com，与登录态和选择器同源
- modified:
  - `src/shared/config/selectors.ts`
  - `src/main/services/AuthStateService.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson: 登录态判定必须 cookie + localStorage 双通道，且 cookie 未命中不等于游客；aria-pressed 开关类步骤需要 skipIfPressed 幂等守卫

### 11:47 | Codex

- done: 登录态判定改为双通道：cookie 名单 + 页面 localStorage；deepseek 认 userToken，qwen 认 qwen_token_logged_out_marker；localStorage 只读已打开 WebContents，不额外开窗
- context: 真实 persist:shared 实测：deepseek 已登录任务 9.5s 正常返回；qwen 会话落在 /c/guest 为游客；应用运行期 cookie 库被文件锁，外部读取不可靠
- decision: 不采用游客 URL 模式与通用 cookie 启发式，只用可验证的明确键；判不出返回 unknown 由页面侧兜底
- modified:
  - `src/shared/config/selectors.ts`
  - `src/main/services/AuthStateService.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson(promoted): 应用运行期间 Chromium 的 Cookies 库被独占锁，离线复制会得到空库或旧快照；判定登录态必须在应用进程内读，且凭证可能只在 localStorage（deepseek userToken）而非 cookie

### 11:03 | Codex

- done: 新增 cookie 级登录态判定：AuthStateService 按平台账号 cookie 名单区分已登录/游客，platforms 暴露 signedIn/loginRequired，新增 multichat auth 命令，登录门槛平台在 submit 阶段快速失败
- context: 隔离环境 --user-data-dir 全新目录；真实 persist:shared 只读导出 cookie 名验证名单：chatgpt/gemini/doubao/grok/yuanbao 命中，qwen/deepseek/claude 为游客
- decision: 移除通用'名字像凭证'启发式：__Host-id-token-nonce 等访客 cookie 会被误判为已登录；只保留平台名单精确匹配，判不出时返回 unknown 交由页面检测
- added:
  - `src/main/services/AuthStateService.ts`
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/commands.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson(promoted): cookie 是区分游客与已登录的唯一可靠信号：游客态同样有大量指纹/统计 cookie，甚至 deepseek 的 ds_session_id 游客态就存在，必须按平台账号 cookie 名精确匹配，不能靠'有 cookie'或通用命名规则
- unresolved: qwen/deepseek/claude 尚无可靠的登录态 cookie 名单，当前返回 unknown，其登录门槛仍靠页面侧检测兜底

### 10:34 | Codex

- done: CLI 任务链路增加登录态识别：preparing 阶段人机验证/密码框强信号连续两次判 AUTH_REQUIRED；发送失败后用页内登录入口归因；URL 登录墙正则支持 sign_in 等分隔写法
- context: 隔离验收用 --user-data-dir 指向全新目录，未复用本机缓存；DeepSeek 落 /sign_in 未被旧正则命中；gemini/doubao/yiyan/chatglm 游客可正常作答
- decision: 页内登录按钮不作提前判墙依据，只在发送失败后归因，避免误伤游客可用平台
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/conversationUrl.ts`
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson(promoted): 未登录页的输入框同样可见，不能靠 ready 探针判断登录态；页面顶栏常驻登录入口也不等于未登录，只有在提交失败后归因才可靠
- unresolved: chatglm 未登录时实际可作答，若后续平台收紧游客策略需重新实测

### 09:54 | Codex

- done: Reviewed multichat-cli SKILL.md vs CLI impl; fixed busySignal/gen-image/imageFiles drift
- modified:
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson: --gen-image submit check only requires imageDownload.steps (AgentTaskService:196); imageGeneration is an optional page-side mode toggle, not a gate. busySignal=adapted covers only chatgpt/claude/gemini/deepseek via generationStopSelectors.

### 09:52 | Codex

- done: 更新 1.3.1 CHANGELOG 的 CLI 条目并新增 README CLI 章节
- modified:
  - `CHANGELOG.md`
  - `README.md`

### 09:28 | Codex

- done: CLI --gen-image 验收完成：6/7 imageDownload 平台实测通过，qwen click 兜底回退生效，yiyan 受平台登录限制（非框架 bug）
- decision: click-download 未命中时回退 generateExtractImagesScript + data:/downloadURL 直存；done 态空 reply 也强制写 TXT 占位
- modified:
  - `src/main/services/AgentTaskService.ts`
  - `src/main/services/ImageDownloadService.ts`
  - `docs/cli-image-generation-plan.md`
- lesson: 多平台一次性跑比单平台更暴露问题：qwen 的 imageItem- class 已改版 → click steps 选不中 → 必须留 extract 兜底；yiyan 未登录不会真生图，框架容错合理

### 09:16 | Codex

- done: CLI 生图改为 prompt 直发模式并多平台验收：--gen-image 不调生图入口，extractImages 探针 + imageDownload 点下载；6/7 平台端到端真实出图落盘（chatgpt/gemini/doubao/yuanbao/grok，yiyan 未登录未出图，qwen SEND_FAILED 为平台兼容问题）
- decision: --gen-image 不再调 imageGeneration.steps 入口（headless 下不通用且多数平台凭 prompt 出图）；图片探针用 generateExtractImagesScript 而非 imageDownload.steps[0]；poll 把图片挂载+!busy 计入完成信号解决纯图回复卡死
- modified:
  - `src/main/services/AgentTaskService.ts`
  - `src/shared/config/selectors.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `docs/cli-image-generation-plan.md`
- unresolved: yiyan 需登录才真实生图；qwen sendButton/verifySubmission 失效为平台发送适配问题，与生图无关

### 00:55 | Codex

- done: 按调研结论修改 selectors.ts：chatgpt/perplexity/qwen/gemini/grok/doubao researchMode 全量重写，新增 yuanbao researchMode；version 18→19；iab 实测验收 chatgpt/perplexity/qwen/gemini/yuanbao 全链路选择器命中
- modified:
  - `src/shared/config/selectors.ts`
- lesson(promoted): qwen 模式入口是 div.mode-select-open[role=button] 不是 button；AutomationStep 验收需模拟 selector 数组顺序取第一个可见命中+text/regex/exclude 过滤链
- unresolved: grok/claude/chatglm/deepseek 选择器未在登录态实测；cancelSteps 选中态钩子未复核

### 00:49 | Codex

- done: CLI 生图与产物落盘端到端验证通过：task submit --gen-image + --artifact-dir（默认 cwd/.multichat）+ results/image 目录 + replyFile/imageFiles 契约 + doubao 真实出图落盘
- decision: 产物根目录由 CLI --artifact-dir（默认 cwd/.multichat）透传给 daemon，回退应用数据目录；image-ready 探针用 imageDownload.steps[0].selector；TXT 文件名 {platform}-{taskId[:8]}.txt
- modified:
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/commands.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `docs/cli-image-generation-plan.md`
- unresolved: grok/yiyan/qwen/gemini 等平台 imageGeneration.steps 需在真实登录态与 UI 下逐平台复测（headless 下选择器未命中或未激活），CLI 框架已在 doubao 验证

### 00:42 | Codex

- done: Deep Research DOM 探索：主进程 iab 实测 13 平台 + 3 audit worker 复核，14 份报告落 docs/deep-research-dom/；chatgpt/perplexity/qwen steps 全失效，doubao/grok/deepseek 无 DR 功能或入口
- added:
  - `docs/deep-research-dom/{chatgpt`
  - `perplexity`
  - `gemini`
  - `grok`
  - `qwen`
  - `doubao`
  - `kimi`
  - `yuanbao`
  - `yiyan`
  - `arena`
  - `claude`
  - `chatglm`
  - `deepseek}.md`
- modified:
  - `docs/deep-research-dom/README.md`
- lesson(promoted): 各平台已弃用 data-testid/data-log-*/tagBtn-* 钩子，转向 aria-label+role+文本语义；菜单 role 多样化（button/listbox+option/menu+menuitem/自定义元素），选择器须多 role 候选；iab 不共享 persist:shared 登录态，子 agent 无独立 iab 面
- unresolved: grok/claude/chatglm/deepseek 需在已登录 persist:shared webview 复核；selectors.ts 修复未实施（仅出报告）

### 00:41 | Codex

- done: Deep Research DOM 审核 worker：claude/chatglm/deepseek 三个被拦平台分别记录为 BLOCKED(login)/BLOCKED(captcha)/BLOCKED(login)，deepseek 的 researchMode 语义确认为'深度思考'而非 Deep Research；三份报告写入 docs/deep-research-dom/
- context: 子 agent 无独立 iab 浏览器面，三平台分别被登录态/滑块验证拦截，报告记录可验证的选择器静态分析与登录后复核步骤
- modified:
  - `docs/deep-research-dom/claude.md`
  - `docs/deep-research-dom/chatglm.md`
  - `docs/deep-research-dom/deepseek.md`

### 00:37 | Codex

- done: CLI 生图与产物落盘：task submit --gen-image + .multichat/image 落盘 + .multichat/results TXT + replyFile/imageFiles 契约字段 + platforms 新列 + will-download 框架抽为 ImageDownloadService
- decision: will-download 框架从 ipcHandlers 抽到独立 ImageDownloadService，杜绝 services→ipcHandlers 反向 import；image-ready 探针改用 imageDownload.steps[0].selector 而非 extractImages；--text 模式产物路径写 stderr 保 stdout 纯净
- added:
  - `src/main/services/ImageDownloadService.ts`
- modified:
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/main/ipcHandlers.ts`
  - `src/cli/commands.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.agents/skills/multichat-cli/scripts/run_task.ps1`
  - `.agents/skills/multichat-cli/scripts/run_task.sh`
  - `docs/cli-image-generation-plan.md`
- unresolved: 各平台 imageGeneration.steps 在 headless BrowserWindow 下部分不生效（doubao 技能条不激活/qwen 工具栏缺/gemini toolbox 未命中/grok 需登录），属平台级选择器适配遗留，需真实 UI 逐平台复测

### 00:27 | Codex

- done: Deep Research DOM 审计（audit_a：chatgpt/perplexity/qwen/doubao）— 每个平台的失效选择器与新 DOM 链记录到 docs/deep-research-dom/
- context: iab 浏览器在子代理中不可用（Browser is not available: iab）— live DOM 验证由 /root 在同一 iab 会话执行，audit_a 负责整合与报告
- modified:
  - `docs/deep-research-dom/`
- unresolved: claude/chatglm/deepseek 未验证（无登录/滑块/登出）;doubao 的深入研究疑似被移除;chatgpt sendButton/reportContainer 需实测

## 2026-11-17

### 21:54 | agent

- done: 删除 v1.3.1 CHANGELOG 中针对未发布功能的修复条目（安装器 PATH 卡死、CLI 鉴权）；macOS 26 划词修复并入 macOS 打磨条目
- modified:
  - `CHANGELOG.md`
- lesson: 发版说明只写对上一正式版用户可见的变化，开发周期内引入又修掉的问题不写入

### 21:53 | agent

- done: 去除 v1.3.1 发版文案营销化表述（重磅新能力、外挂大脑、emoji 标题等），CHANGELOG 条目标题同步去修饰
- modified:
  - `CHANGELOG.md`
- lesson: 用户对发布文案偏好事实性、克制表达，避免“重磅”“附赠”等营销话术

### 21:44 | agent

- done: 精简 v1.3.1 CHANGELOG 表述：去除 52px 等 UI 像素级与底层实现细节，macOS 与修复条目改为概括性描述
- modified:
  - `CHANGELOG.md`

### 21:43 | agent

- done: 按反馈修正 v1.3.1 CHANGELOG：Agent Skill 表述去掉「随包附赠」，编码助手示例改为 Codex、Claude Code、Workbuddy
- modified:
  - `CHANGELOG.md`

### 21:37 | agent

- done: 撰写 v1.3.1 发版内容：CHANGELOG.md 新增 1.3.1 条目（multichat CLI/Agent 集成、生图下载全平台适配、macOS 打磨与修复），并输出 GitHub Release 发版信息草稿
- modified:
  - `CHANGELOG.md`

### 18:49 | agent

- done: 修复 NSIS 安装器 PATH 广播卡死：SendMessage(SMTO_NORMAL,5s/窗) 改为 System::Call SendMessageTimeoutW + SMTO_ABORTIFHUNG + 1s 宏（装/卸两处）；同批提交另一会话的 .install-stamp 覆盖安装重弹引导；已重新构建 dist/MultiChat Setup 1.3.1.exe（17:01）
- modified:
  - `build/installer.nsh`
  - `src/main/cliIntegration.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `dist/MultiChat Setup 1.3.1.exe`
- lesson(promoted): NSIS SendMessage /TIMEOUT= 是 SMTO_NORMAL：HWND_BROADCAST 超时会按每个无响应顶层窗口累计，桌面挂起窗口多时安装器可卡死分钟级；修复要么 SMTO_ABORTIFHUNG+短超时，要么 SendNotifyMessage 异步（Scoop #6706）

### 17:00 | agent

- done: 让 Agent Skill 引导卡片在每次安装/覆盖安装后重新弹出；梳理设置面板 PATH 状态逻辑
- context: 用户反馈重装安装包后不再弹出 Agent Skill 引导，根因是 cliAgentHintDismissed 存于 electron-store config.json，卸载不清除
- decision: 用 NSIS customInstall 写入 cli/.install-stamp 标记方案，而非按版本号重置 dismissed 标记，以覆盖同版本覆盖安装场景
- modified:
  - `build/installer.nsh`
  - `src/main/cliIntegration.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/CliAgentHint.tsx`

### 16:41 | agent

- done: 提交待入库改动（feat: skill 迁移 .agents + 生图下载选择器 + CLI Agent 链路；chore: 记忆层）并重新构建 NSIS 安装包 dist/MultiChat Setup 1.3.1.exe（electron-builder 签名通过，覆盖同版本旧产物）
- modified:
  - `dist/MultiChat Setup 1.3.1.exe`

### 16:34 | agent

- done: 仓库 skill 源从 .devin/skills/multichat-cli 迁移到 .agents/skills/multichat-cli：git mv 三个文件（SKILL.md、run_task.sh、run_task.ps1），同步 electron-builder.yml / electron-builder-portable.yml 的 extraResources from、cliIntegration.ts dev 回退、cli.ts 注释；顺带将一直未跟踪的 run_task.ps1 纳入 git
- added:
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.agents/skills/multichat-cli/scripts/run_task.sh`
  - `.agents/skills/multichat-cli/scripts/run_task.ps1`
- modified:
  - `electron-builder.yml`
  - `electron-builder-portable.yml`
  - `src/main/cliIntegration.ts`
  - `src/shared/types/cli.ts`
- removed:
  - `.devin/skills/multichat-cli`
- lesson(promoted): run_task.ps1 历史上从未被 git 跟踪（非 ignore），打包靠文件系统带上；仓库迁移类操作要顺手核对 git status 里的 ?? 文件

### 16:24 | agent

- done: 复制安装命令的 skills 目标目录从 .devin/skills 改为跨客户端通用约定 .agents/skills（项目级）与 ~/.agents/skills（全局），附兜底说明'客户端有专属目录时按其约定'
- decision: 采用 .agents/skills 而非 .agent：agentskills.io 规范、Cursor/Codex/OpenCode、skills.sh 生态均以复数 .agents/skills 为 canonical 位置
- modified:
  - `src/renderer/src/utils/cliGuide.ts`

### 16:22 | Codex

- done: 图片下载 DOM 适配落地：7 家平台实测选择器写入 selectors.ts；Kimi/智谱/DeepSeek 用户确认跳过
- context: 一键批量下载改走平台 UI 原生下载链；iab 浏览器实测 DOM 结构；choose aria-label/data-testid/data-icon-button 语义 hook，避开 CSS 哈希类名
- added:
  - `docs/image-download-dom/{chatgpt`
  - `gemini`
  - `yiyan`
  - `doubao`
  - `grok`
  - `qwen`
  - `yuanbao`
  - `kimi`
  - `chatglm`
  - `perplexity`
  - `arena}.md`
- modified:
  - `src/shared/config/selectors.ts`
  - `docs/image-download-dom/README.md`
- lesson(promoted): ChatGPT 下载按钮 aria-label 从 '保存' 改成了 '下载'；豆包 UI 改版从 hover 浮层改为点图→预览→testid 下载；Grok/文心/Gemini 有稳定的语义 hook（aria-label/data-icon-button/cos-icon-download）可一键下载无需开预览

### 16:20 | Codex

- done: Grok/千问/元宝 imageDownload DOM 实测并落地 selectors.ts
- context: iab 内置浏览器实测 12 家 AI 平台生图下载入口；Grok/千问/元宝本轮完成，Kimi 未登录、智谱滑块验证未解、DeepSeek 不生图跳过
- added:
  - `docs/image-download-dom/grok.md`
  - `docs/image-download-dom/qwen.md`
  - `docs/image-download-dom/yuanbao.md`
- modified:
  - `src/shared/config/selectors.ts`
  - `docs/image-download-dom/README.md`
- removed:
  - `docs/image-download-dom/grok.md`
  - `docs/image-download-dom/qwen.md`
  - `docs/image-download-dom/yuanbao.md(重写)`
- lesson: iab 登录态与 MultiChat persist:shared session 不共享，需各平台独立登录；智谱 chatglm.cn 有滑块反爬；Playwright evaluate 是 read-only，不能 dispatchEvent

### 15:58 | Codex

- done: 实测4家AI平台图片下载DOM并更新imageDownload选择器
- context: 用户反馈一键批量下载图片部分平台失败/低质，需逐平台探索DOM改走原生UI下载
- decision: imageDownload.steps保持两步结构(点开预览→点下载按钮)，优先用语义aria-label/data-testid而非hash class
- added:
  - `docs/image-download-dom/README.md;docs/image-download-dom/chatgpt.md;docs/image-download-dom/gemini.md;docs/image-download-dom/doubao.md;docs/image-download-dom/yiyan.md;docs/image-download-dom/qwen.md;docs/image-download-dom/kimi.md;docs/image-download-dom/yuanbao.md;docs/image-download-dom/chatglm.md;docs/image-download-dom/grok.md;docs/image-download-dom/perplexity.md;docs/image-download-dom/arena.md`
- modified:
  - `src/shared/config/selectors.ts`
- unresolved: Grok/千问/元宝三家登录后未实测DOM；智谱被滑块拦；Kimi未登录。等待CUA工具恢复或用户手动确认

### 15:50 | agent

- done: CLI task submit 接入 --image 图片上传：CLI 解析绝对路径并校验文件存在，daemon 透传 images，AgentTaskService 复用 dispatchFileDrop 逐张拖拽上传 + generateFileUploadStateScript 确认解析，最后经 generateSendMessageScript(attachmentFileName) 门控发送；query 与 image 至少其一；同步 SKILL.md/run_task 包装脚本/验收脚本用例，ChatGPT 图文与纯图片两条链路实测通过
- modified:
  - `src/shared/types/agentTask.ts;src/main/services/AutomationService.ts;src/main/services/AgentTaskService.ts;src/main/daemon/ipcServer.ts;src/cli/commands.ts;scripts/agent-cli-acceptance.mjs;.devin/skills/multichat-cli/SKILL.md;.devin/skills/multichat-cli/scripts/run_task.sh;.devin/skills/multichat-cli/scripts/run_task.ps1`
- lesson(promoted): dev 环境 ELECTRON_RUN_AS_NODE=1 残留会让 electron 以纯 Node 模式启动即崩（isPackaged undefined），须 env -u 彻底移除而非置空；图片附件在部分平台不渲染文件名，generateFileUploadStateScript 按文件名匹配在 Gemini 上 30s 超时（ChatGPT 正常），属平台适配差异非链路 bug
- unresolved: Gemini 平台 --image 上传检测超时（附件状态脚本按文件名匹配，图片缩略图无文件名渲染或未接受 drop），后续若要全平台需为图片类附件增加非文件名的存在性检测

### 11:29 | agent

- done: 精简 CLI/Skill 引导：安装后引导卡片只保留'复制安装命令（给 Agent）'与'打开 Skill 目录'两个动作；剪贴板内容改为一句 Agent 可执行的安装指令（含 skillDir 源路径，项目/全局目标由 Agent 决定）；设置页'命令行与 Agent 集成'砍掉大段说明文字，改为与'模型下拉列表排序'一致的标题+一行说明+右侧操作密度，已加 PATH 时隐藏 CLI 路径行
- decision: 复制内容用自然语言安装指令而非 shell 命令：跨平台且让 Agent 自行决定装到项目 .devin/skills 还是全局 ~/.devin/skills
- modified:
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `src/renderer/src/components/CliIntegrationSection.tsx`
  - `src/renderer/src/utils/cliGuide.ts`

### 11:07 | agent

- done: 更新 Gemini 与文心一言平台图标为官方现行版本
- context: gemini.png 换成 Google 2025-07 启用的圆角四芒星彩色渐变新 logo（Wikimedia 官方 SVG 渲染 960px 源缩放至 256px）；yiyan 图标换成 chat.baidu.com webmanifest 官方 512px 文心助手图标（蓝紫圆角声波方块），格式由 .ico 改为 .png 并同步 import
- added:
  - `src/renderer/src/assets/logos/yiyan.png`
- modified:
  - `src/renderer/src/assets/logos/gemini.png`
  - `src/renderer/src/store/appStore.ts`
- removed:
  - `src/renderer/src/assets/logos/yiyan.ico`
- lesson: Wikimedia Commons 缩略图已限流标准尺寸（256px 请求 400），应通过 API iiurlwidth 取最近标准桶（330px/960px）再用 System.Drawing 缩放；找中文站点现行图标可查其 webmanifest 的 icons 字段，比 favicon 更准

### 10:47 | agent

- done: 修复 tsconfig.web.json 的 baseUrl 弃用告警：移除 baseUrl，paths 改为 ./ 相对路径（TS6.0 迁移写法）
- modified:
  - `tsconfig.web.json`
- lesson: tsconfig.web.json 缺少 target 导致存量 TS2802（Map 迭代需 es2015+）等 12 个类型错误，与本次改动无关；验证存量错误需 stash 对比

## 2026-11-16

### 23:14 | agent

- done: 实施评审 P0-P3 全部代码层根治项：commands.ts 显式 query 参数跳过 readStdinIfPiped（根治开放 stdin 管道挂死）+ submit --wait 客户端两段化（stderr 早吐 taskId ack，实测对 1.3.1 daemon 正常）；idempotencyKey 全链贯通（CLI flag→ipcServer buildSubmitRequest→AgentTaskService 同 sessionKey 内存去重）；index.ts 启动写 cli.json（cliCmdPath/skillDir，覆盖便携版）；electron-builder-portable.yml 补回 skill extraResources（extends 数组覆盖语义，原为缺 skill 的 bug）；installer.nsh customInstall 补写 InstallLocation 到卸载键；SKILL.md/双包装脚本同步新契约与 --idempotency-key
- context: 评审 P0-P3 落地；端到端对运行中的 1.3.1 daemon 实测：stdin 跳过/管道读取/两段式 stderr ack/cancel/task list 均正常；daemon 侧新功能（幂等键、cli.json）因已装实例占管无法实测，留 dev 验证
- modified:
  - `src/cli/commands.ts`
  - `src/shared/types/agentTask.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/cliIntegration.ts`
  - `src/main/index.ts`
  - `electron-builder-portable.yml`
  - `build/installer.nsh`
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.ps1`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
- lesson(promoted): electron-builder extends 对 extraResources 等数组字段是覆盖语义非合并：portable yml 重定义时必须重复声明父配置全部条目，否则静默丢资源（本次便携版丢 skill 目录实证）
- lesson(promoted): submit --wait 的正确两段化在客户端而非协议层：daemon 协议不变（client 先 submit 无 wait 回 taskId 吐 stderr 再 task.status 长轮询），新旧 CLI/daemon 交叉兼容；若在 daemon 侧加 ack 先行响应，旧 client 首行即 resolve 会提前退出
- unresolved: daemon 侧新代码（idempotencyKey 去重、writeCliManifest）需在安装版退出后 npm run dev 实测：关闭 MultiChat → npm run dev → node out/cli/index.js task submit --platform deepseek --query x --idempotency-key k1 两次应返回同 taskId；%APPDATA%\multichat-dev\cli.json 应生成

### 23:02 | agent

- done: 独立评审后修复 skill 脚本层缺陷：run_task.ps1 重构为两段式（submit 不带 --wait 先拿 taskId 吐 stderr → status --wait 轮询）、MULTICHAT_CLI 先 Test-Path 再分词（修含空格路径自伤）、CLI 调用统一 '' | 给空 stdin（堵住子进程继承开放管道的挂死）、Poll/Timeout 加 ValidateRange、加 Get-Process 便携版兜底解析；run_task.sh 同步两段式+taskId ack+stdin 防护+JSON success 判错（原退出码判错对已装 shim 无效）；SKILL.md 补开放 stdin 管道警告、便携版无卸载键说明、data.phase 终态判定表述、Get-Process 备选定位
- context: subagent 独立评审结论：方案近优但缺 CLI 代码层根治；electron-builder-portable.yml 重定义 extraResources 会丢 skill 目录（extends 数组覆盖语义，疑似 bug 待修）
- modified:
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.ps1`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
- lesson(promoted): 评审抓到的关键缺口：文档层缓解（两段式/警告）无法根治 CLI 源码缺陷——readStdinIfPiped 无条件先读 stdin 会让开放管道场景下所有提交挂死（连 --query-file 也救不了）；submit --wait 被杀丢 taskId 需客户端两段化（submit 不带 wait 先回 stderr ack 再 status 长轮询）
- unresolved: CLI 代码层根治项待定：readStdinIfPiped 显式参数跳过、submit --wait 客户端两段化、cli.json 入口指示文件、portable extraResources 补 skill、installer 补写 InstallLocation、idempotencyKey 幂等提交

### 22:48 | agent

- done: 修复 multichat-cli skill 的 Agent 调用摩擦：SKILL.md 补注册表确定性入口定位、两段式 submit/status 后台等待范式、被杀调用≠任务取消的恢复警告、Windows 引号坑与旧 shim 吞退出码警告（顺带修正 run_task.sh 示例中不存在的 --wait 参数）；新增 run_task.ps1（自解析入口+临时文件传 query+JSON success 判定）；修复 multichat.cmd endlocal 吞 ERRORLEVEL 的退出码 bug
- context: Devin 会话截图显示 agent 调 multichat CLI 走了 15+ 步：PATH 陈旧找不到入口 5 步 + submit --wait 前台超时被杀丢 taskId 重投 + 多次 status 轮询
- added:
  - `.devin/skills/multichat-cli/scripts/run_task.ps1`
- modified:
  - `.devin/skills/multichat-cli/SKILL.md`
  - `build/cli/multichat.cmd`
- lesson(promoted): cmd 批处理 setlocal/endlocal 会把子进程 ERRORLEVEL 复位吞掉退出码：退出码必须 endlocal & exit /b %ERRORLEVEL% 同行显式透传（%E% 在行解析时展开先于 endlocal 执行）
- lesson(promoted): electron-builder NSIS 卸载键不写 InstallLocation，反推安装目录用 DisplayIcon（去 ,0 后缀）或 UninstallString 首个引号路径
- lesson(promoted): PowerShell 函数 return @(x) 单元素数组在赋值时被解包成标量，x[0] 会取到字符串首字符；调用处必须 @(func) 强制数组

### 22:23 | agent

- done: 拉取 origin/main（5 个 macOS 相关提交）并与本地 CLI 功能提交 9c1ce6f 合并为 merge commit df31db8；仅 SESSION_LOG.md 冲突，按日期新旧保留双段（2026-11-16 在前、2026-11-14 在后）；Layout.tsx 自动合并（本地 CliAgentHint + 远程 entryButtons 重构共存）；.memory/sessions/2026-10-21.md 双侧内容一致自动落齐
- context: 合并前本地曾有大量未提交改动，期间被提交为 9c1ce6f 后与远程分叉
- modified:
  - `SESSION_LOG.md`
- unresolved: 本地领先 origin/main 2 个提交，尚未 push；tsconfig.web.json 定向检查存在 TaskModePanel/useWebviewLifecycle/MainPage/QuickPage/appStore 等历史 TS 报错，与本次合并无关

### 22:02 | agent

- done: 安装器 CLI 选项页说明文案中的 Agent 示例由 Devin 改为 Codex（Codex、Claude Code 等）
- modified:
  - `build/installer.nsh`

### 21:42 | agent

- done: 升级应用版本至 v1.3.1 并完成 NSIS 安装包打包（dist/MultiChat Setup 1.3.1.exe，125MB，latest.yml 已更新）
- context: 版本号由 app.getVersion() 从 package.json 读取，package.json 与 package-lock.json 为唯一需同步位置；npm run build:win:nsis 一次性完成编译与 electron-builder NSIS 打包
- modified:
  - `package.json`
  - `package-lock.json`
- removed:
  - `nul`

### 18:06 | agent

- done: 实现安装包可选装 multichat CLI 并加入 PATH + 应用内 Agent Skill 集成引导：NSIS 复选框页与 PATH 注册/卸载清理、cliIntegration 主进程模块（状态查询/PowerShell 补挂 PATH/Skill 目录定位）、cli:* IPC 与 preload 契约、设置抽屉集成区块、首启一次性引导卡片
- context: 用户希望安装期可选装 CLI 并提醒用户给 AI Agent 装配套 Skill；验证过 npm run build 与 electron-builder NSIS 双侧编译，shim 实测 daemon status 连通
- decision: CLI 对外命令名统一为 multichat（cli/ 子目录 shim，不污染 INSTDIR）；Skill 只给说明不代装；首启引导卡片用 PATH 检测 + store 标记实现一次性提示
- added:
  - `build/cli/multichat.cmd`
  - `build/cli/multichat.sh`
  - `src/shared/types/cli.ts`
  - `src/main/cliIntegration.ts`
  - `src/renderer/src/components/CliIntegrationSection.tsx`
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `src/renderer/src/utils/cliGuide.ts`
- modified:
  - `build/installer.nsh`
  - `electron-builder.yml`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
  - `build/MACOS_FIRST_OPEN.md`
  - `AGENTS.md`
- removed:
  - `build/multichat-cli.cmd`
  - `build/multichat-cli.sh`
- lesson(promoted): electron-builder nsis.include 被注入到生成脚本头部（先于 common.nsh/MUI2/LogicLib），自定义 Function 体内用到的宏必须在 installer.nsh 自己 include（nsDialogs.nsh 会连带 LogicLib+WinMessages）；PATH 操作用 WriteRegExpandStr 保 REG_EXPAND_SZ，改完需 SendMessage HWND_BROADCAST WM_SETTINGCHANGE 广播

### 17:39 | agent

- done: 验证 session_log.py stdout UTF-8 修复
- modified:
  - `.memory/session_log.py`

### 17:39 | agent

- done: 为 multichat CLI 创建专属 skill（.devin/skills/multichat-cli）：SKILL.md 涵盖入口解析、preflight、submit→wait→result 工作流、research/追问/多平台 fan-out 场景、错误码表；scripts/run_task.sh 封装提交+轮询闭环，已用 deepseek 实测端到端通过
- context: CLI 契约来自 src/cli/commands.ts + src/main/daemon/ipcServer.ts + docs/agent-cli-dev-plan.md；daemon 实测在线，platforms 返回 13 个平台
- added:
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
- lesson(promoted): done 终态的 task.status/submit --wait 响应已内嵌 reply，多数场景无需再调 task.result

### 17:26 | agent

- done: CLI输出契约优化：默认输出翻转为JSON（--json变兼容no-op），新增--text人类可读模式；done终态在单任务响应（submit --wait/status）内嵌reply省去一次result往返（Google LRO/AIP-151模式），task.list批量视图不内嵌；AgentTaskView加可选reply字段；验收脚本同步--text用例+新增D8内嵌断言，89 PASS/0 FAIL/0 SKIP，持久化记录内嵌链路实机验证
- modified:
  - `src/cli/commands.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/shared/types/agentTask.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): 异步任务API的业界模式：Google LRO(AIP-151)在operation done时直接内嵌response，单任务响应内嵌reply+批量列表不内嵌是省一次工具调用又不爆列表体积的平衡点；CLI翻转默认输出时isJsonMode改为!opts.text比加env开关更直观

### 16:59 | agent

- done: Agent CLI 真机E2E全量验收：新daemon起服后platforms(13平台)/task.list/token鉴权/submit-wait-done实测gemini21.5s+chatgpt27.3s均done，conversationUrl捕获归一，conversation追问落同页，FIFO排队queuedPosition=1，cancel三相(queued/preparing/generating)正确落地，CAPABILITY_UNSUPPORTED(claude research)正确，终态全量落盘；修复cancelled不落盘遗漏；验收脚本token感知后88 PASS/0 FAIL/0 SKIP
- modified:
  - `src/main/services/AgentTaskService.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): Electron系IDE终端自带ELECTRON_RUN_AS_NODE=1，须env -u ELECTRON_RUN_AS_NODE npm run dev否则electron.app undefined崩溃；kill_shell只杀npm壳electron主进程成孤儿仍占管道须taskkill //PID main //T；git-bash下node -e与heredoc中反斜杠管道路径被MSYS二次坍缩，管道测试要落盘为文件或用fromCharCode构造
- unresolved: research深度研究实机路径未跑(耗时10min+)；wait超时返回实时快照与queueTimeout边界仅代码审查+mock验证

### 16:10 | agent

- done: Agent CLI 全量实施+独立worker验收：agentTask.ts契约、conversationUrl.ts共享URL工具、AgentTaskService（状态机/FIFO租约/就绪探针/轮询/双超时/取消/持久化200条7天TTL/shutdown）、ipcServer鉴权全平台修复+task.*路由+waitMs长轮询、CLI task命令组+platforms+三通道query+exit2语义；worker深审13项全修（queued取消不出队、poll单次exec零容忍、query型会话URL回归、auth墙跨origin误伤、taskId路径穿越、commander exitOverride顺序、双导航等），验收脚本84 PASS/0 FAIL
- added:
  - `src/shared/types/agentTask.ts`
  - `src/shared/utils/conversationUrl.ts`
  - `src/main/services/AgentTaskService.ts`
  - `scripts/agent-cli-acceptance.mjs`
- modified:
  - `src/main/daemon/ipcServer.ts`
  - `src/main/index.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/services/MindmapService.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/cli/client.ts`
  - `src/cli/commands.ts`
  - `src/cli/index.ts`
- lesson(promoted): commander exitOverride 必须在 registerCommands 之前调用——子命令在创建时拷贝 _exitCallback，后设不生效；daemon token 文件须放 getDataPath() 下而非管道名派生路径（Windows Named Pipe 名不能当文件路径）；executeJavaScript 在页面导航/重载期间会瞬时 reject，轮询需按空采计数容错而非单次失败即 INTERNAL；取消 queued 任务必须直接 finalize 出队，仅置标志会导致 pump 仍提取执行产生幽灵窗口
- unresolved: 真实 E2E 未跑：需关闭旧版 MultiChat 实例释放 \.\pipe\multichat-daemon 后 npm run dev，再执行 platforms/task.submit→wait→result/FIFO排队/取消/DR/追问/断连清理等人工验收（验收脚本D5/D6会自动检测新daemon并执行协议级用例）

### 16:04 | agent

- done: Agent CLI 独立验收：深审 task.* 链路 + 新增 scripts/agent-cli-acceptance.mjs（88 用例：PASS=83 FAIL=1 SKIP=4）
- context: 旧版 daemon 常驻本机管道（无 task.* 路由），新版 task.* 端到端需 npm run dev 实测
- added:
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): 验收脚本：NODE_OPTIONS --require 注入 net.connect 重定向 shim 可在无 Electron 下做 CLI↔daemon 协议契约测试；commander 缺必填参数 exit 1 与契约'参数错误=2'不符；AgentTaskService.cancel 对 queued 任务不落地终态是状态机高危缺口

### 15:02 | agent

- done: 按独立 worker 深审结论修订 agent-cli-dev-plan.md：修正导航语义、waitMs 单请求原子化、socket 泄漏清理、响应契约兼容、双超时、verifySubmission、busy 分档、URL 校验、Windows 无鉴权、数据路径、终态顺序等 15 项设计错误
- modified:
  - `docs/agent-cli-dev-plan.md`
- lesson(promoted): 评审 MultiChat daemon/CLI 设计时易漏的真实约束：ensureSessionReady 不负责导航（已加载会话原样返回）；sendResponse 引用作用域外 req 使非 Windows CLI 全挂；Windows Named Pipe 无 token 且 pipe 路径不能存 token 文件；DaemonResponse.error 是 string；每请求一新 socket，wait 挂起需 socket close 清理；generateSendMessageScript 仅附件场景 verifySubmission；generationStopSelectors 只适配 4 平台

### 14:52 | agent

- done: 合并 Agent CLI PRD 与技术方案为单一开发方案文档
- added:
  - `docs/agent-cli-dev-plan.md`
- removed:
  - `docs/agent-cli-prd.md`
  - `docs/agent-cli-technical-design.md`

### 14:48 | agent

- done: 制定 Agent CLI 开发方案：PRD + 技术方案文档（task.* 异步任务协议、AgentTaskService 状态机、回复完成检测、wait 长轮询、会话语义）
- context: 借鉴 WebAI-to-API 把网页版 AI 包装成本地 Agent 可调用服务；基于已有 cli/daemon/AutomationService/SessionManager 雏形
- decision: model 参数一期仅声明元数据；MCP 二期；会话=每次新对话+可选追问；任务类型不固定，通用 query 提交
- added:
  - `docs/agent-cli-prd.md`
  - `docs/agent-cli-technical-design.md`

## 2026-11-14

### 19:24 | agent

- done: 修复 macOS 26 下选中文本工具条读取脚本失效：System Events 已移除 focused UI element 语法，改用 AXFocusedUIElement 属性
- modified:
  - `src/main/platform/selectionReader.ts`
- lesson(promoted): macOS 26 System Events 词典变化：focused UI element of <process> 编译报错 -2741，正确写法 value of attribute "AXFocusedUIElement"

### 19:11 | agent

- done: 新增 assets/dock-icon.png（图稿 82% + 透明边距），dev Dock 图标与打包 icns 改用它，修复 Dock 图标偏大的问题
- added:
  - `assets/dock-icon.png`
- modified:
  - `src/main/webviewManager.ts`
  - `build/generate-mac-assets.sh`
- lesson(promoted): macOS Dock 图标显大通常不是尺寸问题而是图稿没有留边距：Apple 图标规范图稿约占画布 82%；sips 无合成能力，可用 Swift/AppKit NSImage 生成带透明边距的 PNG

### 19:09 | agent

- done: macOS 红绿灯定位改为 titleBarStyle:'hidden'+trafficLightPosition(12,20) 垂直居中 52px 标题栏；dev 模式 Dock 图标替换为应用图标
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
- lesson(promoted): trafficLightPosition 仅对 titleBarStyle:'hidden' 生效（hiddenInset 强制内嵌位）；其坐标是 OS 点单位，红绿灯圆心≈设定值+6.5，无头测试机截屏坐标≠OS 坐标需按实际像素对齐

### 18:44 | Devin

- done: 修复 macOS 托盘图标渲染为黑色剪影的问题（去掉 template 标记并缩放到 22px 显示彩色 logo）；mac 版 header 将 设置/历史/笔记 三个入口移到右侧
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`
- lesson(promoted): macOS tray template image 只保留 alpha 剪影：要显示彩色应用图标不能调 setTemplateImage；tray icon 建议 resize 到 ~22px

### 18:34 | Devin

- done: 修复 macOS 托盘创建崩溃：setTemplateImage 误调在 Tray 上（Tray 无此方法），改为对 nativeImage 调用；验证 npm run dev 无 unhandled rejection，Cmd+Shift+Space 可唤出/收起快捷弹窗
- context: macOS arm64, electron-vite dev; npm install 可能跳过 Electron 二进制下载需 node node_modules/electron/install.js; 本机 python 为 3.9，session_log.py 需 python3.12
- modified:
  - `src/main/webviewManager.ts`
- lesson(promoted): Electron Tray 没有 setTemplateImage 方法，模板图标应调用 nativeImage.setTemplateImage(true)；assets/ 下无 tray-iconTemplate.png 时回退 logo.png

