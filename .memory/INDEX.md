# 知识索引与路由表

复杂修改、调试或需要历史经验时，先匹配任务关键词与文件路径，再读取 KNOWLEDGE.md 中对应的 `###` 章节。多个主题命中时只读确有依赖的章节；不要因此全文加载知识或归档日志。没有匹配主题时先查代码，确认有可复用经验后再新增主题和路由。

本表按领域路由，每个 `###` 主题可以有多个入口。触发词只保留主关键词和稳定文件路径，不把整组字段名、函数名或历史版本号堆进同一行。单行触发词控制在约 15 个以内；单个章节的触发词超过约 50 个时，优先拆分章节和路由，而不是继续追加关键词。路由目标以标题文本匹配，不再依赖章节编号。

## L1 知识路由（按触发条件读取对应章节）

| id | 触发词或文件路径 | KNOWLEDGE 章节 | 适用说明 |
|---|---|---|---|
| `webview-capture` | selectors.ts、webviewScripts.ts、contenteditable、Slate、CodeMirror、回复采集、整段对话、快照、虚拟代码框 | ### Webview 采集与平台自动化 | 先确认当前 DOM 与调用链；采集结果要区分未完成和解析失败 |
| `webview-platform` | 平台改版、豆包、千问、工作台回复按钮、generateInsertReplyButtonScript、messageContainer、item-icon、sr-only、selectorDiagnostics | ### Webview 采集与平台自动化 | 平台 DOM、选择器语义与注入定位；改选择器时检查前台总结、后台导图和整段对话三条链路 |
| `image-download` | imageDownload、clickDownloadButtons、generateExtractImagesScript、--gen-image、生图容器、message_image_content | ### Webview 采集与平台自动化 | 图片下载和生图提取；优先语义 hook，保留 click 失败后的 extract 兜底 |
| `deep-research` | Deep Research、iframe、CDP、OOPIF、iab、AutomationStep、研究模式 | ### Webview 采集与平台自动化 | 提取能力边界与平台入口；排查经验不等于已验收产品能力 |
| `workbench-editor` | Lexical、MarkdownSyncPlugin、CodeNode、AutoLinkNode、LinkNode、GFM 表格、HTML 表格、HTML 标注、annotation、anchorRevision、unlocated、reanchor、block.start、pendingCreateRef、DraggableBlockPlugin、WorkbenchHtmlVisualEditor、preserveFocus、allow-same-origin、postMessage | ### 工作台编辑器 | 编辑器导入、序列化、HTML 隔离编辑与标注；注释锚点生命周期、实时调色焦点和写盘安全也要核对 |
| `react-state` | useState、useMemo、useCallback、callback ref、闭包、ResizeObserver、共享抽屉、TDZ、HMR | ### React 状态与组件生命周期 | 按实际时序选择状态方案；组件挂载和父级提交时序要单独核对 |
| `workbench-files` | WorkbenchFileTree、importExternalPaths、getPathForFile、dispatchFileDrop、uploadAttachments、附件、PDF、workbench-file、二进制文档、PDF 滚轮缩放、docx-preview、Word 预览、read-docx-bytes | ### 工作台文件与上传 | 外部导入、跨 webview 拖拽、粘贴上传、临时副本和流式预览；Office 预览的内存与版式取舍 |
| `notes-mindmap` | noteManager、noteIdentity、noteTranscript、快照、resolveId、mindmap、generationSession、迁移、frontmatter、标签 | ### 笔记、快照与导图 | 笔记身份、版本指纹、改名重连、迁移与导图绑定 |
| `markmap` | Markmap、foreignObject、setData、fit、scrollWidth、节点按钮、中文竖排 | ### 导图渲染与交互 | 布局、视口、命中区域和编辑生命周期 |
| `workbench-ui` | AppIcon、Lucide、APP_ICON_MAP、FileTypeIcon、三栏布局、scrollTop、旁注、评论卡、设置弹窗、正文居中、大纲轨道 | ### 工作台 UI 与图标 | 图标体系、三栏布局、滚动恢复和浮层定位 |
| `selection-windows` | quickWindow、划词、UIA、monio、shortcutManager、findInPage、tray、quit-guard-ready、before-quit、托盘退出、trafficLightPosition、Splitter、context-menu | ### 窗口、划词与快捷键 | 自动划词与主动快捷键分开；托盘退出与窗口经验按平台核对 |
| `runtime` | history、currentConversationId、urlMismatch、轮询、辩论、hibernate、about:blank、SummaryPanel、download、TUN | ### 历史、会话与运行时 | 会话边界、加载失败、轮询、休眠与内存；源码核对不等于桌面验收 |
| `task-api` | taskSplitApi、requestBodyConfig、slotIndex、windowCount、IPC、API、summaryPrompts、debatePrompts | ### 任务分配、辩论与 API | 请求体、槽位、IPC 类型和提示词升级 |
| `cli-daemon` | src/cli、src/main/daemon、Named Pipe、backgroundThrottling、commander、daemon.token、task.submit、cancel、waitMs | ### CLI、Daemon 与登录态 | 通信顺序、任务终态、输出协议和 CLI 退出码 |
| `platform-auth` | 登录态、AUTH_REQUIRED、AUTH_LOST、platformAuthCookies、platformAuthCookieRules、localStorage、tongyi_sso_ticket、qianwen、selector version | ### CLI、Daemon 与登录态 | 游客与已登录要双通道判定；站点同源和主进程选择器版本也要核对 |
| `git-workflow` | gitService、update-index、git mv、fetch、ahead/behind、push -u、gitignore、remote set-url、worktree、文件树隐藏规则、落地页、README | ### Git 与开发工作流 | 索引写路径变化、同步策略、忽略规则、worktree 授权与文档事实核对 |
| `build-verify` | electron.vite.config、electron-builder、NSIS、installer.nsh、winCodeSign、混淆、is.dev、ELECTRON_RUN_AS_NODE、tsc、extraResources、Dock 图标、ERR_PACKAGE_PATH_NOT_EXPORTED、pi-coding-agent、pnpm install、EPERM | ### 构建、打包与验证 | 构建不等于类型检查或桌面验收；平台和版本经验需核对当前环境 |
| `historical` | Electron 28、Chromium 120、ScriptProcessorNode、WebContentsView、summaryApi、useSummaryPanel、generate-summary | ### 历史架构与版本限定 | 只在明确追溯旧架构或已授权工作中加载 |
| `prototype-verification` | docs/prototypes、自包含 HTML、innerHTML、视觉验收、重渲染、截图 | ### 原型与视觉验收 | 首屏截图之外必须验证切换、重复渲染和窄屏分支 |
| `agent-sidebar` | AgentCard、WorkbenchAiSidebar、assistant-ui、makeAssistantToolUI、pi-coding-agent、PermissionEngine、AgentSessionService | ### 本地 Agent 与 AI 侧边栏 | 本地 Agent 运行时、工具渲染、权限引擎与 AuiProvider 上下文边界 |

需要近期上下文时读 SESSION_LOG；只有追溯更早会话才读 `.memory/sessions/` 对应日期。既有脚本只提示缺少路由的三级标题，不检查 INDEX 缺失、触发词质量或反向失效条目；维护时需确认章节标题与表格一致。

新增、删除或重命名 `###` 主题时，必须同步本表：先确认目标标题在 KNOWLEDGE.md 中实际存在，再更新路由；不要继续使用旧编号或只改标题不改路由。
