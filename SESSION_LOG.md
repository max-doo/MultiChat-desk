# Session Log

## 2026-11-26

### 22:51 | Codex

- done: 特殊文件夹低调辨识方案：assets 行尾加 14px 半透 paperclip 图标；.multichat 及其受管子目录名称改用 text-text-secondary/70 淡化；两类目录加 title 悬停说明；恢复 chevron 后普通文件夹保持 纯箭头+名称
- decision: 特殊文件夹不用行首图标，改用更弱的视觉通道：assets=行尾小图标、.multichat=名称淡化，避免图标抢眼
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 22:48 | Codex

- done: Agent 输入框权限模式按钮在面板过窄时退化为纯图标：footer 加 container-type: inline-size，@container (max-width: 380px) 隐藏文字与下拉箭头；按钮加 whitespace-nowrap 修复逐字换行撑高；title 提示补全模式名+说明
- context: 用户截图反馈窄侧栏下权限模式文字竖排挤压
- modified:
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/assets/index.css`
- lesson: Tailwind 3 无容器查询插件时可直接手写原生 @container CSS（Electron 42/Chromium 完全支持），不必为此引入依赖；元素自身作容器用 container-type: inline-size 不影响块级布局宽度

### 22:46 | Codex

- done: 导图面板平台下拉中的已登录徽标由亮绿(emerald)改为低调灰色
- context: 用户反馈下拉里绿色已登录徽标太辣眼睛,要求改灰;全仓仅此一处登录态徽标使用 emerald,其余 emerald 均为 git/鉴权成功等语义场景,不在本次范围
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 22:46 | Codex

- done: workbench 文件树实现业界常规剪切（Ctrl+X）：树内剪贴板带 copy/cut 模式、剪切项半透明、Esc 取消、移动粘贴走 rename 联动链；系统剪贴板写入 Preferred DropEffect 实现与 Windows 资源管理器双向剪切互操作；外部剪切粘贴走 moveExternalPaths（同盘 rename、跨盘复制后删除），修复跨盘 cp 排除过滤导致 .git/node_modules 数据丢失的存量隐患；顺带修复 PowerShell ConvertFrom-Json 数组解包 bug 导致的多文件复制路径串连问题
- decision: 剪切清空剪贴板时机统一在 store moveExternalItems 尾部（全部成功零失败时），内部/外部移动不分叉；原地剪切粘贴为无操作（不产生 -n 副本，Explorer 语义）
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson(promoted): PowerShell 5.1 的 ConvertFrom-Json 会把 JSON 数组作为单个 Object[] 元素返回，@() 包裹后元素被空格拼接成整串，必须用 [string[]] 强转逐元素展开——本项目所有 ps1 脚本传 JSON 数组参数都受此坑影响；移动语义的跨盘 cp 绝不能带 isBlockedImportName 排除过滤（那是复制/导入的规则），否则被排除内容随源删除直接数据丢失；Explorer 剪切互操作靠剪贴板 Preferred DropEffect 位掩码 DROPEFFECT_MOVE=2，粘贴完成后要清空剪贴板但仅在内容与预期完全一致时清避免误清用户新复制内容；CDP 行为验收文件树可用 window.__workbenchStore 钩子 + dispatchEvent 合成 KeyboardEvent（React 合成事件不校验 isTrusted），paste 事件 clipboardData 无法合成需直接驱动 store 逻辑链
- unresolved: 已知限制（低概率）：Explorer 剪贴板路径与工作区大小写错配时内部源误入 moveExternalPaths 会缺 assets 联动与标签页重映射，后果可恢复；剪切粘贴脏文件依赖 renameNode 存量 save 守卫链未单独实测

### 22:36 | Codex

- done: 在 AGENTS.md Testing Guidelines 中补充端到端验收可用 CDP
- modified:
  - `AGENTS.md`

### 22:28 | Codex

- done: 晋升 verbatim 行内节点经验至 KNOWLEDGE 并更新路由
- modified:
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`

### 22:27 | Codex

- done: 将 Markdown 预览链接关系面板的'出链/反链'标签改为更易懂的'引用/被引'
- modified:
  - `src/renderer/src/components/workbench/WorkbenchLinkRelationsPanel.tsx`

### 22:27 | Codex

- done: 工作台 Markdown 编辑器支持 Pandoc 引文 [@key] 与 HTML 注释的视觉区分：渲染模式（Lexical）新增两个 verbatim 行内 ElementNode 容器 + TextMatchTransformer，仅字体样式区分（引文 teal、注释灰斜体），导入/键入/粘贴三条链路自动转换，导出逐字节保真；源码模式（CodeMirror）补齐 lezer tags.comment 配色（此前样式表缺失导致注释无高亮的根因），并新增 ViewPlugin 扫描引文补色，跳过围栏/行内代码与链接语法；email 误伤通过 key 前置字符校验规避
- decision: 按用户要求不做胶囊徽章等复杂渲染，引文注释仅字体颜色/斜体区分且保留原始定界符可见；键入即时转换沿用 wikilink/footnote 同款行为（无撤销性），引文后接 (url) 的链接歧义场景接受为已知边界
- added:
  - `src/renderer/src/components/workbench/WorkbenchInlineMarkupNodes.tsx`
  - `src/renderer/src/components/workbench/workbenchCitations.ts`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/assets/index.css`
- lesson(promoted): Lexical verbatim 行内容器节点模式：纯文本 ElementNode（isInline+extractWithChild）+ TextMatchTransformer，export 用 node.getTextContent() 直出原文可做到逐字节保真（exportChildren 会经 exportTextFormat 转义方括号/下划线）；TextMatch 同位置候选冲突由 transformers 数组顺序决定，自定义引文必须放在内置 LINK 之后让链接优先；lezer-markdown 把 HTML 注释标记为 tags.comment 而非 processingInstruction，HighlightStyle 缺该条目即无高亮；CDP 验证 contenteditable 会先命中 CodeMirror（它也是 contenteditable），必须先确认 editorMode 再查 DOM

### 22:21 | Antigravity

- done: 优化三处 CodeMirror 6 编辑器行号 Gutter 宽度：移除 formatNumber 5位空格补齐，恢复原生 maxLineNumber spacer 自适应，并添加 tabular-nums 与 2ch+padding 轻量下限
- context: 此前已通过 .cm-gitGutter 固定 width:8px 与空占位 marker 根治滚动/点击跳动；5位 padStart 与 3rem/3.5rem minWidth 导致小文件行号列过宽
- decision: 使用 lineNumbers() 原生 spacer + fontVariantNumeric: tabular-nums + calc(2ch + 16px/8px) minWidth；同步更新 .memory/KNOWLEDGE.md
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/components/MindmapMarkdownEditor.tsx`
  - `.memory/KNOWLEDGE.md`

### 22:11 | Codex

- done: 修正上一轮误删：恢复文件夹行的展开/收起 chevron 箭头与 isExpanded prop、新建文件夹输入框的箭头占位；保持仅移除文件夹图标本身
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson: 用户说'去掉文件夹前面的图标'时，chevron 展开箭头不属于'文件夹图标'范畴，应保留；动手前先区分状态指示符与类型图标

### 22:00 | Codex

- done: 复制对话导出格式调整：Markdown 标题结构改为 XML 标签隔离（conversation/user_query/assistant_final_answer），final answer 保留原始 Markdown
- modified:
  - `src/main/services/AgentSessionService.ts`

### 21:56 | Codex

- done: 修复工作台文件树'移动到其他工作区'子菜单失效：根因是 79cd3fda 将右键菜单 portal 化后，子菜单仍以 fixed 定位嵌在带 backdrop-filter 的菜单 DOM 内，Chromium 中 backdrop-filter 会成为 fixed 后代的包含块，按视口算的 left/top 被二次偏移渲染到视口外；修复为子菜单独立 portal 到 document.body，配 hover 延迟关闭（250ms 可取消定时器）与外部点击判定扩展
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson(promoted): Chromium/Electron 中，元素带 backdrop-filter（含 -webkit- 前缀）时，其所有 position:fixed 后代的包含块变为该元素而非视口，且该行为不依赖 DOM 父子关系的视觉效果，无法用 getBoundingClientRect 自动修正；浮层套浮层必须 portal 到 body 或改用 absolute

### 21:49 | Codex

- done: 工作台文件树：文件夹行去掉 chevron 和文件夹图标，只保留名称；新建文件夹输入框同步去图标；resolveMultichatFolderVisual 精简为 isManagedMultichatFolder 布尔判断
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 21:41 | Codex

- done: 修复 Markdown 双击全屏图片查看器（Lightbox）右键无菜单：z-modal(100) 遮罩盖住全局菜单 z-50，按知识库约束在 Lightbox 内实现接管式自定义右键菜单（发送到 AI/复制图片/另存为/复制地址/外部打开/资源管理器定位），z-[110] 按 DESIGN.md 特例压 modal；Esc capture 拦截先关菜单再关查看器，翻页/换图自动收菜单
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImageLightbox.tsx`
- lesson(promoted): 模态层内的右键菜单不能依赖全局 CustomContextMenu（z-50 会被 z-modal 遮罩盖住且事件链正常但不可见），必须在模态内自建接管式菜单并按 DESIGN.md 特例用 z-[110+] 加注释说明；接管前逐项盘点全局菜单对 <img> 的存量三件套（发送AI/copyImageAt复制/另存为）避免能力回退

### 21:40 | Codex

- done: Agent对话历史菜单：行内编辑/删除按钮改为hover浮层不占布局；新增更多菜单含复制对话（仅用户query+各回合final answer，剔除trace）与复制原始文件路径；主进程新增 agent:get-session-export IPC 与 getSessionExport 导出逻辑
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson(promoted): React capture 阶段的外部点击监听若在菜单项 click 前卸载菜单，click 会落在已 detached 的节点上不触发；外部关闭判定需排除菜单内部与触发器

### 21:32 | Codex

- done: 在侧边 Agent 系统提示词(MIAO_PREAMBLE)的 Operating Principles 中新增规范：临时脚本与临时文件一律放入 .tmp/ 目录（不存在则创建），禁止放在工作区根目录
- modified:
  - `src/main/extensions/systemPromptTrim.ts`

### 21:23 | Codex

- done: 将 .tmp/ 加入 .gitignore
- modified:
  - `.gitignore`

### 21:10 | Antigravity

- done: 优化工作台双链 chip 与出链/反链面板的目录树解析性能：按 fileTree 引用 WeakMap 缓存 O(1) WikiLinkIndex 与目标串解析结果，flattenSortedFiles 复用 Intl.Collator 并按 (tree, sort) 缓存，移除 WikiLinkChip 与 WorkbenchLinkRelationsPanel 的重复全树排序与线性扫描
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/workbenchWikiLinks.ts`
  - `src/renderer/src/components/workbench/WorkbenchWikiLinkNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchLinkRelationsPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWikiLinkPlugin.tsx`
- lesson: Lexical DecoratorNode 内渲染双链 chip（以及随切文档重建的出链/反链面板）时，切忌在每个节点组件内部调用全树拍平排序和线性扫描；应基于不可变 fileTree 引用建立 WeakMap 共享索引（含路径/stem/basename Map 与目标串级解析缓存），将单节点解析从 O(N log N) 降为 O(1)。

### 21:10 | Antigravity

- done: 优化 Webview 浏览器伪装与页面注入隐蔽性：补齐 app.userAgentFallback、收窄 Client Hints 改写范围至 mainFrame/subFrame 缺失头、移除页面内 window.open 覆写并将注入全局标记迁移至 Symbol.for
- decision: 保留 DOM 注入发送消息链路，不做高风险重构；Google about:blank 弹窗拦截收窄至 Google 域名且完全由主进程 setWindowOpenHandler 处理
- modified:
  - `src/main/webviewManager.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/hooks/useSourceAnnotations.ts`
- unresolved: 未在 pnpm run dev 中对 Google Auth、ChatGPT branch 与各 AI 站点做端到端桌面手测

### 21:03 | Codex

- done: 按功能模块分三批提交本日工作:feat(agent)权限加固+工具状态修复+打捞链, feat(workbench)双链面板+内联chip+排版/图片预览, docs(memory)日志与约束;过程目录.tmp/ scratch/与调试脚本不入库
- added:
  - `src/renderer/src/components/workbench/WorkbenchLinkRelationsPanel.tsx;src/renderer/src/components/workbench/agent/AgentComposerEditor.tsx;src/renderer/src/components/workbench/agent/fileExistenceCache.ts;src/shared/utils/workbenchWikiLinks.ts`
- modified:
  - `AGENTS.md;.memory/INDEX.md;.memory/KNOWLEDGE.md;SESSION_LOG.md;DESIGN.md;src/main/ipcHandlers.ts;src/main/services;src/preload/index.ts;src/renderer/src/components/workbench;src/renderer/src/store;src/shared/types;src/shared/utils;tailwind.config.js`

### 21:03 | Codex

- done: 删除 Agent 回复文末附件胶囊（与行内 chip 冗余）：移除 AgentCard 的 AttachmentChips 渲染与 attachmentPaths 去重计算链路，删除 AttachmentChips.tsx 中胶囊组件、collectToolAttachmentPaths、extractInlineFilePaths、collectInlineCoveredPathKeys 及附件扩展名白名单；KNOWLEDGE.md 过期条目就地更新
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/agent/markdownMath.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `.memory/KNOWLEDGE.md`

### 20:56 | Codex

- done: 修复双链元数据审查发现的缺陷:P1锚点链接解析([[doc#heading]]剥离锚点解析到文档+显示名doc>anchor);P1重命名/删除后快照竞态过期(watcher索引落盘后无条件推送workbench:links-changed快照,不受自写窗口抑制);P2系列:截断扫描不入缓存+预算提到8s、增量索引尊重gitignore、扫描/索引按工作区串行队列、fileName null整表作废进队列、自写抑制判定改在去抖触发时捕捉、缺失chip不再cursor-pointer;折叠联动(笔记属性折叠态提升到store共享);出链/反链字号对齐笔记属性text-body 14px
- context: 独立worker验收报告P1x2+P2x7,用户确认'前端我验收了'后只做代码修复与逻辑验证;锚点修复后用户wiki中18/88个带#锚点的目标从琥珀缺失态恢复正常
- modified:
  - `src/renderer/src/components/workbench/workbenchWikiLinks.ts(锚点剥离+显示名); src/main/services/workbenchService.ts(links-changed广播+串行队列enqueueWorkspaceLinkScan+scanWorkspaceLinks拆分+截断不入缓存+gitignore过滤+自写抑制捕捉时点); src/preload/index.ts(onLinksChanged); src/renderer/src/store/workbenchStore.ts(onLinksChanged订阅+frontmatterPanelCollapsed+__workbenchStore dev钩子); src/renderer/src/components/workbench/FrontmatterPanel.tsx(折叠态上store); src/renderer/src/components/workbench/WorkbenchLinkRelationsPanel.tsx(折叠联动+text-body); src/renderer/src/components/workbench/WorkbenchFileChip.tsx(缺失态cursor-default)`
- lesson(promoted): vite dev下页面内裸import()拿到的是幻影模块副本而非应用真实store实例(HMR带?t=参数加剧),CDP行为验证必须经应用真实加载路径暴露的同一实例——本次加import.meta.env.DEV守卫的window.__workbenchStore调试钩子(生产tree-shake);openFile等在workbench初始化完成前调用会静默返回,测试脚本必须轮询isInitialized+workspacePath
- unresolved: main进程侧修复(队列/广播/gitignore)需要重启dev实例才生效,当前运行实例仍是旧main;[[doc#heading]]点击只打开文档不滚动到标题(Obsidian有,未实现,可作后续)

### 20:53 | Codex

- done: 工作台文件 inline chip 改为正常字重（去掉 font-medium）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileChip.tsx`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`

### 20:32 | Codex

- done: 修复图片预览右键菜单回归：补回被顶掉的发送到 AI 侧边栏/复制图片/图片另存为三项，copyImageElementToClipboard 从 CustomContextMenu 导出复用，复制优先走主进程 copyImageAt 保留原编码
- context: 用户发现回归后指出；复制图片依赖渲染出的 img 元素故仅在 canManipulateImage 时展示，超限图片仍可用另存为和发送到 AI（走文件路径管线）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
- lesson(promoted): 接管已挂全局 CustomContextMenu 的 DOM 区域右键前，必须先盘点 e.defaultPrevented 退让后会被顶替的存量菜单项（图片三件套发送到AI/复制/另存），在新菜单中逐项保留或明确裁剪，不能只盯新需求项

### 20:28 | Codex

- done: 文件chip合并收尾：修复数学占位符还原的NaN缺陷（match[2]）与InlineFileChip磁盘兜底useMemo依赖缺失（existenceVersion未入deps导致stat到达后不重算），CDP实证unknown到exists升级、隐藏/树外路径chip化、点击行为与文末胶囊去重；tsc/eslint/build全绿
- context: 承接上一轮chip合并工作；dev实例重启后agent:stat-file已注册
- modified:
  - `src/renderer/src/components/workbench/agent/markdownMath.ts`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
- lesson(promoted): useSyncExternalStore驱动的订阅版本号必须进入useMemo依赖数组，否则stat等异步结果到达后组件虽重渲染但memo缓存的null永不失效，升级链路静默断裂
- lesson(promoted): 正则交替分支捕获组编号：(?:FP(\d+)|(\d+))中第一分支是group1、第二分支是group2，误用match[1]读第二分支得到undefined转NaN，占位符还原静默失败；写交替正则后必须用真实样本验证每个分支
- lesson(promoted): CDP验证中把Windows路径字符串直接拼进evaluate的JS表达式时反斜杠会被浏览器JS解析器吞掉（\t变制表符），必须用JSON.stringify注入或正斜杠路径

### 20:20 | Codex

- done: 工作台中间预览面板图片右键菜单新增移动到功能：hover 展开二级菜单按层级列出工作区子目录（排除当前所在目录与 .multichat 内部目录），点击后复用 moveNode/renameNode 移动当前图片并自动同步标签页与预览路径；同时补充系统默认程序打开、资源管理器定位两个入口；菜单按真实尺寸钳位进视口，子菜单右侧不足时翻到左侧
- context: 用户要求的是中间预览面板右键，不是 Markdown 文档内图片（WorkbenchImageNode）也不是 Lightbox
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/workbenchImageUtils.ts`
- lesson(promoted): 宿主 DOM 右键链路：全局 CustomContextMenu 按 e.defaultPrevented 退让，组件级右键菜单只需 preventDefault 即可共存，无需额外标记

### 20:17 | Codex

- done: Markdown h1 从 2em 降到 1.6em(25.6px)，与 32px 文档标题拉开层级，h2-h6 不动；参照 Craft/Logseq 有独立文档标题时 h1 压到 1.5-1.6em 的惯例
- decision: 方案A最小改动：只压 h1，h2-h6 已是业界标准值不动；级差 标题32>h1 25.6>h2 24 靠分隔线有无进一步区分
- modified:
  - `src/renderer/src/assets/index.css`

### 20:16 | Codex

- done: 实现 Obsidian 风格双链元数据：编辑器元数据区显示出链/反链 chip 面板
- context: 用户要求参照 Obsidian 实现文档元数据中的被引/反引(即出链/反链)。调研结论:Obsidian 的反链/出链不在笔记元数据里而是独立面板/底部区,由 metadata cache 计算、天然不可编辑;用户要求的'元数据不可编辑'与计算型展示天然契合,实现为编辑器元数据区(笔记属性面板下方)的纯计算只读区。
- decision: 1)主进程缓存原始[[target]]串,解析统一在渲染层用文件树按最短路径语义完成,单一事实源;2)索引双保险:保存后extractFileLinks增量+watcher事件驱动按路径增量索引(覆盖导图后台生成等不经渲染层的写盘),目录级事件整表作废退化全扫;3)出链实时取编辑器内存内容(未保存也准确),反链取磁盘快照;4)出链按解析后路径去重(Obsidian语义),反链排除自引用;5)面板只在出链/反链非空时显示,纯只读不可编辑。
- added:
  - `src/shared/utils/workbenchWikiLinks.ts(extractWikiLinkTargets); src/renderer/src/components/workbench/WorkbenchLinkRelationsPanel.tsx(出链/反链面板)`
- modified:
  - `src/shared/types/workbench.ts(WorkspaceLinkEntry); src/main/services/workbenchService.ts(workspaceLinkCache+getWorkspaceLinks+extractFileLinks+watcher增量索引updateWorkspaceLinkCachePaths); src/main/ipcHandlers.ts(两个IPC); src/preload/index.ts(桥接); src/renderer/src/store/workbenchStore.ts(workspaceLinks状态+加载/保存联动); src/renderer/src/components/workbench/WorkbenchEditor.tsx(挂载面板)`
- lesson(promoted): CDP自动化输入Lexical编辑器:Input.insertText整串输入不触发markdown快捷键转换,必须逐字符;document.execCommand('insertText')在页面eval内可用且走真实beforeinput管道;但insertText的'\\n'不会换行而是直接拼接文本。测试脚本打开文件应用store.openFile(vite下可import('/src/store/workbenchStore.ts')),不要用文件树DOM点击(折叠态节点不在DOM中)。绝不可以在未守卫activeFilePath的情况下向contenteditable输入——会污染用户真实文档。
- unresolved: CDP验收曾误把测试文本写入用户论文文件thesis/4-夏热冬暖地区农房需求与案例启示.md末尾,已精确移除垃圾行并git diff核对干净(仅剩用户自己未提交的1行修改);dev实例是手动重启的(pnpm run dev在后台session 6141运行中)

### 20:14 | Codex

- done: workbench 文档大标题(WorkbenchTitleBar)字号 24px 提升到 32px 与 Markdown h1 同档，新增 text-title-xl token，title-lg 仍保留给设置页
- decision: 文档标题用 32px 与 h1(2em) 视觉同档而非 Notion 式 40px——用户明确要求只与标题同大
- modified:
  - `tailwind.config.js`
  - `src/renderer/src/components/workbench/WorkbenchTitleBar.tsx`
  - `DESIGN.md`

### 20:11 | Codex

- done: Agent 输入框 chip 样式调整：背景改灰色 bg-slate-100/dark:bg-white/10，移除按钮从右上角悬浮改为同行常显小叉
- modified:
  - `src/renderer/src/components/workbench/agent/AgentComposerEditor.tsx`

### 20:09 | Codex

- done: Agent 侧栏文件 chip 合并：行内 chip 支持磁盘存在性兜底（区外/隐藏目录路径），正文裸绝对路径经 markdownMath 管线 chip 化，文末胶囊与行内 chip 去重合并
- added:
  - `src/renderer/src/components/workbench/agent/fileExistenceCache.ts`
- modified:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx`
  - `src/renderer/src/components/workbench/agent/markdownMath.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
- lesson: react-markdown 裸文本 token 化可复用 markdownMath 的预处理占位符管线：扫描时跳过行内/围栏代码与链接目的地，rehype 阶段把占位符还原为 data-* 元素再在 components.span 分支渲染；占位符正则的多捕获组序号必须与交替分支顺序一致（先写的分支是 group 1）
- unresolved: agent:stat-file IPC 需重启 dev 实例生效；重启后需验证 .multichat/区外路径 chip 升级链路（unknown→exists 视觉跳变）

### 20:08 | Codex

- done: 修复 Agent 运行中工具状态误判：image_gen 等长任务执行期间 UI 显示成功、标题停止闪烁。四层修复：①store mergeMessageParts 保留本地 tool-call（message_end/message_update 快照缺失 toolCall 时不再抹掉运行中的 part）；②tool_execution_start 强制消息回到 running、turn_end 不得越过未出结果的 tool-call；③AgentCard 把组级 isGroupRunning 传给 ToolGroup（组级 run 存活即权威，消息级只做辅助）；④resumeSession 按后端 isRunning 还原运行中状态 + toolResult 恢复归一化为 {content,details,isError}。新增 MM_AGENT_EVENTLOG=1 事件时间线日志（sessionsDir/<id>/event-timeline.jsonl）备查。中止/丢失的工具结果改显示'未返回结果'而非假'成功'。验证：tsc web/node 0 错误、eslint 目标文件 0 警告、build 通过、四种致病变体回放全部正确
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`
- lesson(promoted): Agent 工具状态链路三个权威信号各有盲区：消息级 status 会因 message_end 形态异常（不含 toolCall/空 content）提前翻转 complete；part.result 会因快照覆盖丢失；唯一可靠的是组级 agent run 存活信号（agent_start→agent_end）。渲染层运行态必须以组级为准、消息级为辅。pi 的 message_end 在 tool_execution_start 之前到达，不能作为完成信号；turn_end 兜底也不得越过未出结果的 tool-call
- unresolved: 真实生产中触发该 bug 的确切事件形态未确认（四种变体均已防御）；如需实证：设 MM_AGENT_EVENTLOG=1 后复现一次 image_gen，检查 agent-sessions/<id>/event-timeline.jsonl

### 20:08 | Codex

- done: Agent 输入框 @ 文件引用改为内联 chip：新增 contenteditable 编辑器 AgentComposerEditor，已登记附件的 @token 在输入框内就地渲染为带背景的文件 chip（复用 WorkbenchFileChip + bg-primary/10），移除输入框上方独立的附件 chip 双轨行；目录 mention 的 chip 图标按文件树节点类型渲染为文件夹（输入框 chip、消息气泡 mention、回复附件 chip 三处同步）
- added:
  - `src/renderer/src/components/workbench/agent/AgentComposerEditor.tsx`
- modified:
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
- lesson(promoted): contenteditable chip 编辑器的稳定模式：文本模型保持纯字符串，DOM 只作镜像；输入时序列化比对，文本一致即跳过重建从而保住光标与 IME；chip 宿主用 contenteditable=false 原子节点，React 内容经 createPortal 注入

### 20:06 | Codex

- done: workbench Markdown 标题字号体系对齐业界惯例：h1-h6 改 em 梯队(2/1.5/1.25/1.12/1/1)字重600，正文基准定 16px(text-body-lg)
- decision: 标题用 em 相对单位而非 px，正文基准变化时梯队自动跟随；h5/h6 与正文同字号仅靠字重区分，参照 GitHub/Obsidian 惯例
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 20:00 | Codex

- done: 审查并更新 AGENTS.md：修正任务拆解链路描述（API 路径已删，迁移至 TaskSplitService + tasksplit:* IPC），新增 Agent 模式架构约束（pi-coding-agent/PermissionEngine/commandAnalyzer/agent:* IPC），补充 workbench 与后台 Web AI 自动化链路，刷新目录结构（services 扩展、extensions/updater、划词工具栏）、Tech Stack 关键依赖、docs 主题化归档与 CLI Skill extraResources 来源
- context: 用户要求控制整体长度只加最关键信息；最终 +8 行（119->127）
- modified:
  - `AGENTS.md`
- lesson(promoted): apply_patch 必须整行精确匹配，含弯引号/全角标点时 substring 替换会静默失败；改前先用字节级读取确认原文

### 19:41 | Antigravity

- done: 加固 bash/macOS/Linux 权限审查并打通 Auto 模式工作区文件写放行
- context: 用户确认不引入 OS 级沙箱、sudo 在 bypass 确认、pnpm install 等任意脚本执行在 Auto 保持确认
- decision: POSIX 系统目录(/etc,/usr,/bin,/sbin,/boot,/lib,/System,/Library 等)采用写保护硬拒+读放行分离；bashAnalyzer 保留变量原文并识别 >/>>/2>/dev/null/2>&1 及 mkdir/touch/cp/mv/tee 写入；sudo/doas/su/持久化文件写/未解析变量目标在 bypass 仍触发确认
- modified:
  - `src/main/services/commandAnalyzer/bashAnalyzer.ts`
  - `src/main/services/commandAnalyzer/externalCommandGate.ts`
  - `src/main/services/commandAnalyzer/psAstAnalyzer.ts`
  - `src/main/services/permissionPolicy.ts`
  - `src/main/services/PermissionEngine.ts`
- unresolved: Windows 主机完成 tsc/lint/build 与 64 条权限用例无头校验；macOS/Linux 真实路径与 pnpm run dev 桌面端烟雾测试待实机验证

### 19:30 | Codex

- done: 修正双链 chip 样式方向：对齐 Agent 侧栏模型回复正文内联 chip（图标+主题色文字、无背景无描边、字号继承），附件胶囊恢复独立样式；图标尺寸支持 em 字符串随上下文缩放（AppIcon 增加 em 分支，FileChipIcon 默认 1em，缺失态圆点改 em）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileChip.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWikiLinkNode.tsx`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
- lesson(promoted): chip 样式参照对象要区分：Agent 回复底部附件胶囊（描边 rounded-full）与回复正文内联 chip（无边框主题色文字）是两种形态，行内引用应以后者为准；AppIcon 数值 size 乘 0.85 光学系数，em 字符串分支保持同一系数

### 19:25 | Codex

- done: Markdown 编辑器支持 Obsidian 式双链：[[target]]/[[target|display]] 渲染为 chip，支持文件树拖拽插入、@ 与 [[ 唤起文件菜单（复用快速打开过滤与行样式）、点击打开目标文件、缺失目标琥珀色标记；行内 chip 样式抽为共享组件 WorkbenchFileChip（对齐 Agent 侧栏行内 chip：图标+主题色文字、无背景无描边、字号继承），AttachmentChips 回复胶囊样式原样保留
- context: workbench Lexical 编辑器双链功能首版，CDP 9223 行为级验收通过（导入渲染/round-trip/点击打开/@菜单/[[转换/拖拽落点）
- added:
  - `src/renderer/src/components/workbench/workbenchWikiLinks.ts`
  - `src/renderer/src/components/workbench/WorkbenchWikiLinkNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWikiLinkPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileChip.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchQuickOpenModal.tsx`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/assets/index.css`
- lesson(promoted): Lexical 行内 DecoratorNode + TextMatchTransformer 可实现 [[x]] 键入即转节点；@ 触发菜单用 LexicalTypeaheadMenuPlugin，多触发实例必须分开存 query 状态否则互相置 null；文件树拖入编辑器用 DROP_COMMAND + caretRangeFromPoint + setBaseAndExtent + createRangeSelectionFromDom 精确落点

### 19:15 | Codex

- done: 撤回提问弹窗的主按钮和图标从黄色改为主题色 primary
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 19:09 | Codex

- done: Agent 侧边栏内容区与容器边缘 padding 过小，消息滚动区、回看提示条、底部输入框横向 padding 从 px-4/p-3 统一增大到 px-5
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 18:50 | Codex

- done: docs 目录大整理：根目录 60+ 文档按主题归组（agent/workbench/mindmap/selectors），36 个历史文档归档至 archive/2026-08|2026-10|2026-11，重写 DOCS_INDEX 为新结构权威索引
- decision: 归档按落地/取代年月分目录（archive/2026-08 等），常青指南保留根目录，归档规则写入 DOCS_INDEX
- modified:
  - `docs/DOCS_INDEX.md 重写`
  - `docs/agent/* 12 篇迁入`
  - `docs/workbench/* 13 篇迁入`
  - `docs/mindmap/* 3 个迁入`
  - `docs/selectors/* 方法论与三个 dom 目录迁入`
  - `docs/archive/* 36 个归档`
  - `src/renderer/src/components/icons/AppIcon.tsx 注释路径修正`
  - `docs/agent/cli-image-generation-plan.md 与 agent-cli-dev-plan.md 跨目录链接修复`
  - `docs/BUILD_GUIDE.md 与 QUICK_BUILD_REFERENCE.md 失效相对链接修复`
- lesson: git mv 批量移动后需全局校验相对 Markdown 链接：跨簇引用仅 3 处，同簇整体移动不断链；BUILD_GUIDE 中 ../ 前缀的失效链接是历史遗留，整理时顺手修复

### 18:42 | Codex

- done: 补充同步：gitignoreService 忽略项 results→task-results；agentTask.ts 类型注释同步目录名
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/shared/types/agentTask.ts`

### 18:39 | Codex

- done: web_search 打捞链打通 + 产物目录改名 task-results：web_search 返回带 replyFile/taskId 绝对路径与存档脚注；AgentTaskService 产物目录 results→task-results 并含旧数据一次性迁移（搬移 TXT+改写 JSON replyFile）；CLI Skill 文档同步目录名
- modified:
  - `src/main/services/webSearchTool.ts`
  - `src/main/services/AgentTaskService.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson(promoted): 中间产物(intermediates)按业界惯例(Claude Code/Codex/OpenCode/Amp)放用户级/应用级存储而非项目工作区，交付物(deliverables)才写工作区；可打捞性比存放位置更关键——产物路径必须一开始就暴露在工具返回中，不能依赖压缩占位符

### 18:37 | Codex

- done: 浏览器扩展深度调研：Obsidian Web Clipper 复刻 + 侧边栏嵌入 AI 网页可行性，产出 docs/research/browser-extension-deep-research.md
- context: 用户想在浏览器插件里实现Obsidian Clipper式剪藏+侧边栏嵌入网页版AI
- added:
  - `docs/research/browser-extension-deep-research.md`
- lesson: iframe嵌入的真正障碍不是frame头(扩展可用DNR剥离)而是SameSite会话Cookie;AI站实测约半数无frame封锁;ChatGPT CSP官方白名单了4个扩展ID

### 18:35 | Codex

- done: Agent 侧边栏右键菜单项「在聊天中提问」改名为「在侧边聊天中提问」，语义更明确指向侧边栏网页平台
- modified:
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 18:31 | Codex

- done: 修正气泡折叠遮罩圆角错误：误加rounded-br-sm，气泡小圆角只在右上，右下应为大圆角；遮罩改为rounded-b-2xl
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 18:29 | Codex

- done: 修复用户气泡折叠态圆角丢失：裁剪在内层滚动容器但圆角在外壳，矩形容器overflow裁剪导致除左上外圆角消失；圆角移到裁剪容器本体，渐隐遮罩同步补底部圆角
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson(promoted): CSS裁剪容器必须自带圆角：rounded在父级、overflow在内层时圆角失效，因为裁剪边界取的是内层矩形容器的边框盒

### 18:28 | Codex

- done: Agent 撤回(rewind)复用文件回滚机制：图标改 undo；撤回弹窗按回合文件状态三态化（无修改/可回滚/不可回滚），支持'撤回文件修改和对话'与'仅撤回对话'；回滚机制加固——pre-shell 扫描预算内捕获内容使 shell 修改可回滚、edit 基线按 capturedAt<scanStartedAt 定真伪、原子写(tmp+rename)、幂等校验防重试死锁、逐文件错误收集、运行态服务端硬拒、缺失快照 fail-closed、撤回后删除匹配回合记录防错挂、undone 重试按基线校验
- context: 用户要求撤回机制鲁棒、不损坏用户文件；验收：tsc双侧0错、lint目标文件0警告、build通过、扫描与 revert/reapply 无头测试 12/12 PASS
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/agentFileChangeTracker.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `.memory/KNOWLEDGE.md`
- lesson: pi 并行批次所有 beforeToolCall 先于任何工具执行，pre-shell 扫描是严格回合前真值；回滚类操作必须幂等校验+原子写，否则中途失败会永久死锁或留下半个文件；PowerShell 管道 -replace 批量改文件会塌缩换行，文件编辑只用 apply_patch
- unresolved: pnpm dev 桌面端手动验收未做：撤回弹窗三态交互、rewind+revert 端到端、工作台编辑器打开中被回滚文件的冲突重载行为

### 18:26 | Codex

- done: 用户气泡折叠补充：展开行为分层——中等长度全量展开，极端超长粘贴(>480px)封顶内嵌滚动，气泡外壳与滚动容器分离使chevron悬浮不随内容滚动
- decision: 展开封顶值取固定480px而非视口比例，遵循固定档位避免逐帧动态计算
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 18:21 | Codex

- done: Agent侧边栏用户气泡超长折叠：>180px(约8行)默认折叠至112px预览+渐隐遮罩+居中chevron，点击全量展开/收起，ResizeObserver按渲染高度评估
- decision: 展开采用全量展示而非内嵌滚动条，避免聊天流嵌套滚轮劫持；按渲染高度而非行数判定，因换行宽度不定行数不可靠
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 18:15 | Codex

- done: Agent 侧边栏消息区右键菜单新增两个动作：添加到对话（选中文字追加到 Agent 输入框并聚焦光标）与在聊天中提问（投到另一侧边栏的网页平台输入框，关闭时自动展开；目标栏停在 Agent 模式时自动切回网页平台）。新增 workbench:ask-webview 事件与 requestAskWebview 编排，修复第二侧边栏未挂载时同步派发事件丢失的时序问题；WorkbenchAiSidebar 抽出 insertPromptIntoWebview 复用注入逻辑。
- decision: 在聊天中提问的目标取另一侧边栏实例（与既有 sidebar_ask 交叉投递一致），目标栏为 Agent 模式时优先沿用另一栏的网页平台，否则退回第一个可用平台
- modified:
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/workbenchAiEvents.ts`

### 18:00 | Codex

- done: 将文档四件套选型结论晋升至 KNOWLEDGE.md
- modified:
  - `.memory/KNOWLEDGE.md`

### 18:00 | Codex

- done: 专项调研文档四件套 skill 源选型：anthropics/skills 采用度断层第一(200k stars)且为 OpenAI Codex 官方改编上游，OpenAI 版许可证禁止再分发不可用作源，docx/pptx 已 JS 化降低依赖；更新研究报告
- modified:
  - `docs/research/agent-skills-research-2026-11.md`
- lesson(promoted): OpenAI Codex 随包 skills（documents/spreadsheets/presentations/pdf）许可证为 All rights reserved 明确禁止提取分发，只能作设计参考；anthropics/skills 的 Office 四件套 2026-11 已迁 Apache-2.0 且 docx/pptx 创建路径已从 Python 切换为 npm 的 docx-js/pptxgenjs

### 17:56 | Codex

- done: Agent 侧栏文件 chip 打开语义对齐预览标签机制：普通点击进预览槽位复用，Ctrl/Cmd+点击或中键点击开常驻标签
- decision: chip 点击默认 { preview: true } 复用 VS Code 式预览槽位；修饰键/中键走 forcePermanent；不改 store 逻辑，最小充分改动
- modified:
  - `src/renderer/src/components/workbench/agent/filePathUtils.ts`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`
- lesson(promoted): Agent 侧栏文件入口此前裸调 openFile(rel)，落入 syncTabsOnOpen 的无条件常驻分支，每点必开新标签；新增打开入口时必须先确认 preview/forcePermanent 语义归属

### 17:50 | Codex

- done: 将 pi 内核 MCP/Skills 生态事实晋升至 KNOWLEDGE.md 并同步 INDEX 路由触发词
- modified:
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`

### 17:49 | Codex

- done: 深度调研侧边栏 Agent 默认 Skill/插件配置：盘点现状（内核已支持标准 Skills + 内置 MCP 但产品未接入）、分析受众场景、给出三层 Skill 建议与开源项目清单，产出 docs/research/agent-skills-research-2026-11.md
- added:
  - `docs/research/agent-skills-research-2026-11.md`
- lesson(promoted): pi-coding-agent v1.6 fork 内核已内置 MCP（mcp.json + direct/deferred/codemode/hidden 暴露档位）且 Skills 遵循 Anthropic Agent Skills 开放标准——anthropics/skills 等公开仓库可直接套用；pi-mcp-adapter 已过时勿用

### 17:48 | Codex

- done: 分模块提交本轮 Agent 安全与文件追踪、导图登录态、工作台图片预览与布局改动，共 7 笔 Conventional Commits
- context: 提交前执行 pnpm run lint 与 pnpm run build；提交时因 .git 索引写权限不足申请提权；排除 .tmp、scratch 与 scripts/debug_gutter_width.cjs 临时调试文件
- modified:
  - `SESSION_LOG.md`
  - `.memory/KNOWLEDGE.md`
- unresolved: 提交完成后工作区仍有 AgentCard.tsx 编辑图标微调、临时目录与调试脚本未提交；Agent Shell 主进程改动未做 pnpm run dev 桌面端交互实测

### 17:41 | Codex

- done: Agent 正文 inline 文件引用样式二次调整：markdown 图标对齐文件树蓝色 description，图片/矢量图标颜色与树一致，文件名由 caption 号改为与正文同号（body），负边距补偿行距
- modified:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`

### 17:39 | Antigravity

- done: 修复 Agent 侧边栏弹窗溢出可视区域问题：在 AgentPopover 中增加基于祖先裁剪容器与视口交集的自动边界纠偏与最大宽高限制
- context: 窄侧边栏中 AgentContextMeter 等右对齐/左对齐弹窗会超出 overflow-hidden 容器被裁剪
- modified:
  - `src/renderer/src/components/workbench/agent/AgentPopover.tsx`

### 17:38 | Codex

- done: Agent 正文 inline 文件引用从 chip 样式改为蓝色链接样式（图标+蓝色文件名，hover 才显示背景），与 inline code 视觉区分
- modified:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`

### 17:29 | Antigravity

- done: 将独立图片预览（WorkbenchImagePreview）的缩放与旋转控件统一移至底部悬浮胶囊，顶部仅保留衬底切换、系统程序打开与资源管理器定位
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`

### 17:27 | Antigravity

- done: 完成 Agent Shell 执行链路与权限安全体系全量修复（委托 pi 原生进程树执行+流式解码/脱敏/审计、AST/Segment 感知硬拒、expandPathInput 路径展开修复、redact 误遮蔽收敛），并通过三轮独立 worker 审查与 E2E/lint/tsc/build 验证
- decision: ShellTool.createBashOperations 改为直接包装 pi-coding-agent 的 createLocalPowerShellOperations/createLocalBashOperations，彻底消除进程树孤儿、30s 默认强杀与 stdin 挂起；PermissionEngine 先跑 AST/segment 判定再执行结构化硬拒（仅不可解析时回退正则）
- modified:
  - `src/main/services/ShellTool.ts`
  - `src/main/services/PermissionEngine.ts`
  - `src/main/services/permissionPolicy.ts`
  - `src/main/services/commandAnalyzer/powershellAstHelper.ts`
  - `src/main/services/commandAnalyzer/bashAnalyzer.ts`
  - `src/main/services/redact.ts`
- lesson(promoted): Windows 下 path.resolve(homedir(), '\\.ssh\\id_rsa') 会因前导反斜杠退化为盘符根目录 C:\\.ssh\\id_rsa，expandPathInput 对 ~/~/env 展开必须先剥离前导分隔符；bash wrapper 展开重拼命令时必须保留引号并区分短参数大小写
- unresolved: 主进程改动未做 pnpm run dev 桌面端交互实测（需重启 dev 实例后在 Agent 侧栏触发 Format-Table 与 timeout 命令验收）

### 17:26 | Codex

- done: 将 ChangedFilesCard 已修改状态图标改为灰色并放大至 size=16，保留原折叠布局和交互
- context: 用户先要求参考截图改折叠态，随后撤回该方案，明确保持原折叠方式，仅调整图标颜色和样式。
- modified:
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`

### 17:25 | Codex

- done: 将 ChangedFilesCard 已修改状态图标改为灰色并放大，保留原折叠布局
- modified:
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`

### 17:24 | Antigravity

- done: 移除 Lightbox 衬底开关并抽取共用图片视口 Hook；为 WorkbenchImagePreview 增加滚轮缩放、拖拽平移、双击切换、同文件夹上下张切换及底部不重复悬浮工具条
- modified:
  - `src/renderer/src/components/workbench/workbenchImageUtils.ts`
  - `src/renderer/src/components/workbench/WorkbenchImageLightbox.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`

### 17:18 | Antigravity

- done: 在思维导图模型选择器中接入平台登录态实时检测与已登录标签展示，并为 localStorage 凭证平台（DeepSeek/Kimi）实现零额外建窗的被动采集与 electron-store 持久化记忆
- decision: Cookie 平台直读 persist:shared 实时判态，DeepSeek/Kimi 在 Webview 正常加载或 SPA 导航时被动采集并写入 platformAuthStorageCache 持久化；导图面板挂载与打开模型下拉框时轻量刷新，不额外后台建窗
- modified:
  - `src/main/services/AuthStateService.ts`
  - `src/main/index.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 17:16 | Antigravity

- done: 将 Markdown 图片 Lightbox 改造为飞书风格的半透明遮罩 + 右上角关闭 + 底部居中悬浮胶囊工具栏，并将衬底切换收敛至图片自身边界
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImageLightbox.tsx`

### 17:13 | Codex

- done: 调换工作台右上角侧边栏和思维导图按钮顺序，并减小与窗口控制按钮的间距
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 17:11 | Antigravity

- done: 修复 HMR 后图片节点 instanceof 校验失效导致双击打不开 Lightbox 的问题，并附带节点信息兜底
- modified:
  - `src/renderer/src/components/workbench/workbenchImageUtils.ts`
  - `src/renderer/src/components/workbench/WorkbenchImageLightboxPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`
- lesson(promoted): Vite HMR 重载 Lexical 自定义 Node 模块时，已挂载编辑器持有的旧节点实例与新模块 class 的 instanceof 会返回 false；命令/插件识别节点应兼容 node.getType() 校验

### 17:09 | Antigravity

- done: 修复 Agent 侧边栏文件变更追踪漏报、撤销基线损坏与 Shell 改文件盲区，改为按用户回合聚合并接入轻量熔断工作区扫描
- added:
  - `src/main/services/agentFileChangeTracker.ts`
- modified:
  - `src/shared/types/agentRuntime.ts`
  - `src/main/services/PermissionEngine.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`
- lesson(promoted): pi-agent-core 中单次用户提问（agent_start→agent_end）内每轮工具调用都会触发 turn_start/turn_end，文件变更累加器不能在 turn_start 清空或在 turn_end 覆写 index.json；修改前基线内容必须在 beforeToolCall 写盘前捕获，绝不能在 turn_end 从修改后的磁盘补读 .before

### 17:08 | Antigravity

- done: 移除 Markdown 图片节点悬停时的放大镜指针，改为 cursor-default 避免误导单击行为
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`

### 17:05 | Antigravity

- done: 为工作台 Markdown 预览模式图片节点实现应用内 Lightbox 查看视窗及多入口交互
- decision: 保留单击选中与 Backspace/Delete 删除；以双击、悬停/选中态放大按钮、选中态 Space 键及右键菜单四路触发 Lightbox，并复用缩放与画布背景工具
- added:
  - `src/renderer/src/components/workbench/workbenchImageUtils.ts`
  - `src/renderer/src/components/workbench/WorkbenchImageLightbox.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImageLightboxPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 16:51 | Antigravity

- done: 实现侧边栏底栏响应式紧凑模式：leftPaneWidth < 320px 时隐藏 Git 分支名称仅保留图标与状态计数并收紧间距，保证窄窗下工作区名可读
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 16:51 | Antigravity

- done: 修复 Agent 侧边栏新建会话时底部上下文窗口图标未自动清空的问题
- context: newSession/deleteSession 重置为草稿态时未清空 sessionStatus 与 snapshot.context/stats，且草稿态传 undefined 给 resolveSession 会回退读取旧会话上下文
- decision: 在 store 会话切换/重置动作中同步清空 sessionStatus/isCompacting/snapshot 用量并拦截跨会话与草稿态回流，主进程 resolveSession 区分 undefined 与显式空/指定 sessionId，AgentContextMeter 对草稿态与空会话直接不渲染
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`

### 16:51 | Antigravity

- done: 为 Agent 侧边栏回复的 MarkdownRenderer 增加 KaTeX LaTeX 数学公式渲染支持
- decision: 复用项目已有的 katex 依赖，采用预处理提取占位符 + rehype 插件还原节点 + React 端 KaTeX 渲染方案，未引入新生产依赖，避免 remark/rehypeRaw 误解析公式内的下划线、反斜杠、竖线与尖括号
- added:
  - `src/renderer/src/components/workbench/agent/markdownMath.ts`
- modified:
  - `src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx`

### 16:50 | Antigravity

- done: 支持将文件直接拖放到工作台顶部标签栏打开并落位
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchTabBar.tsx`

### 16:50 | Antigravity

- done: 采用方案1在文件树右键菜单动态识别含托管附件的 Markdown 文档再显示清理未引用图片
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 16:42 | Antigravity

- done: 优化工作台新标签页与空白页双按钮质感，回归极简居中纵向布局
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 16:35 | Antigravity

- done: 修复文件树右键菜单底部溢出，并在工作区设置中新增全工作区批量清除未引用照片功能
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 16:34 | Antigravity

- done: 将工作台标签栏 + 按钮改为新建虚拟新标签页并复用极简空白页，提供新建笔记 (Ctrl+N) 与快速打开文件弹窗 (Ctrl+O)
- added:
  - `src/renderer/src/components/workbench/WorkbenchQuickOpenModal.tsx`
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchTabBar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 16:24 | Antigravity

- done: 移除 WorkbenchTabBar 拖拽留白区的 min-w-[16px] 与外层 gap-1，使标签溢出时 + 与 ⌄ 之间仅保留 2px 紧凑间距，同时保持 ⌄ 右边缘对齐中间编辑区
- modified:
  - `src/renderer/src/components/workbench/WorkbenchTabBar.tsx`

### 16:21 | Antigravity

- done: 进一步拉开工作台侧边栏底部 Git 与工作区设置按钮的间距（gap-2.5 与 px-2.5），增强视觉分隔
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 16:20 | Antigravity

- done: 修复工作台顶部与右侧栏 4 处细节：1) 导图/AI 侧栏切换按钮靠右紧邻最小化按钮；2) 移除顶部左右分割线静止态灰线；3) 为 WorkbenchMindmapPanel 补全 w-full min-w-0 撑满右栏宽度；4) 标签栏 + 紧跟末个标签，全部标签下拉按钮 ⌄ 锚定在中间编辑区右侧边缘并留出 16px 保底拖拽区
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTabBar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
- lesson(promoted): 父容器是 display:flex(row) 时，内部 flex-col 子组件根元素若不声明 w-full min-w-0 会按内容最小宽度收缩，导致右侧面板出现大块空白且关闭按钮偏移

### 16:19 | Antigravity

- done: 优化工作台侧边栏底部三按钮空间配比：切换箭头紧跟工作区名、增加竖向分隔与统一 h-8 rounded-lg 热区并移除 Git 分支最小占位宽度
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 16:17 | Antigravity

- done: 恢复工作区设置与版本管理弹窗顶部标签页字号为 text-body (14px) 并强化激活字重，区分标签页与 12px 表单小节
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 16:13 | Antigravity

- done: 核验工作台侧边栏底栏浮层与文件树字号关系，并统一版本管理与工作区设置弹窗的字体层级与紧凑控件密度
- context: 侧边栏文件名基准为 text-body (14px)；两弹窗内原混用或整体上调至 text-body 的 Tab、表单标签、胶囊、输入框与操作按钮收敛至 text-label (12px)，改动列表行高对齐 py-1
- modified:
  - `src/renderer/src/components/ui/FormControls.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 16:13 | Codex

- done: 将工作区设置按钮从齿轮改为 Lucide Settings2（两条滑杆），新增 AppIcon 映射并替换文件树按钮调用
- context: 用户确认采用截图中的 settings-2 图标；全局设置仍保留齿轮，工作区设置按钮改用两条滑杆以作区分。
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson: Lucide 的 Settings2 对应 icons 站点 settings-2；工作区设置按钮可通过 APP_ICON_MAP 的 settings_2 名接入，保持 size=19 和原 title 不变。

### 16:11 | Codex

- done: 修复 Agent runtime shell 执行两个 bug：硬性拒绝误杀 Format-* cmdlet；timeout 秒被当毫秒导致显式超时命令 30ms 内被杀（exitCode -1 无输出）；spawn error 现通过 onData 透传给模型
- modified:
  - `src/main/services/PermissionEngine.ts`
  - `src/main/services/ShellTool.ts`
- lesson(promoted): pi-coding-agent bash/powershell 工具契约的 timeout 单位是秒且默认无超时，自定义 BashOperations 必须 x1000 转毫秒；HARD_DENY 正则中 \bformat\b 因 - 非单词字符会匹配 Format-Table/Format-Wide，写磁盘防护规则要用 format(?!-) 排除 PowerShell Format-* cmdlet；排查 agent 执行失败先看 ShellTool exitCode=-1 只有 timedOut/spawn error 两个来源

### 16:09 | Antigravity

- done: 将工作台设置与历史按钮放回顶部左侧原位，实现两级自适应（空间充裕时显示图标+文字、不足时收起为纯图标）与左侧栏动态最小宽度（按模式切换胶囊宽度+3个按钮所需宽度通过 ResizeObserver 实时计算并同步约束 leftPaneWidth）
- decision: 使用两级阈值：图标+文字阈值控制设置/历史文字显隐，纯图标+模式切换阈值决定 leftPaneMinWidth，避免4种模式全开时左侧栏过窄挤压或溢出
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 15:06 | Antigravity

- done: 实现工作台 Obsidian 式通顶三栏重构与极简标签页功能：多标签状态管理与按工作区持久化、单击预览态与双击/编辑转正、固定标签、滚轮横滑与溢出搜索面板、同名路径消歧、拖拽排序及拖往 AI 侧栏、右键菜单与快捷键
- decision: 工作台模式下将 38px/52px 顶栏拆分为与下方三栏（leftPaneWidth / flex-1 / rightPaneWidth）精确对齐的三段，标签栏宽度严格跟随中间编辑区，侧边栏折叠后保留模式切换与展开入口
- added:
  - `src/renderer/src/components/workbench/WorkbenchTabBar.tsx`
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/assets/index.css`
- unresolved: 需在 pnpm run dev 桌面窗口中手动验证通顶分割线拖拽、多标签溢出与 Ctrl+W 在 Windows 默认菜单下的表现

### 15:06 | Antigravity

- done: 实现工作台 Agent 侧边栏 Fork 交互提醒、无后缀前置分支徽标、消息流分叉点来源标注及历史树状分组摘要
- decision: 不再为 Fork 会话追加'分支'标题后缀，改为复用 pi 内核 header.parentSession + multichat:fork_origin CustomEntry 记录分叉锚点与父会话信息，在前端实现 Header 前置分支徽标、顶部 Toast 提醒、分叉边界分隔线及历史列表树状首问摘要
- modified:
  - `src/shared/types/agentRuntime.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 14:05 | Codex

- done: 可视化编辑底部状态条配色对齐顶栏：slate-800 蓝灰改为 #252526 中性灰 + border-white/8 + #A1A1AA 文字，header/footer 实测同色 rgba(37,37,38)
- context: visual editor footer header color unify
- modified:
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`

### 12:21 | Codex

- done: HTML 渲染/可视化编辑表面去除宿主 dark 类：状态胶囊与发送到 AI 按钮恢复浅色；保存徽标改为仅在可编辑表面显示（markdown 恒可编辑，代码/文本走 store 上报的 codePreviewEditable）；store 新增 codePreviewEditable/htmlRenderSurface 两个表面状态由 CodePreview 上报
- context: html preview light surface status pill
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
- lesson(promoted): 宿主 UI 配色不应与预览内容表面脱钩：HTML 渲染白底页面上的深色胶囊并非主题偏好，而是容器无条件 dark 类的副作用；按『内容表面是什么』驱动宿主配色（store 上报表面状态），比给单个组件加 forceLight 补丁更可扩展

### 11:50 | Codex

- done: HTML 编辑区撤销/重做按钮移至顶栏保存按钮之前（对齐 Markdown 编辑区布局），WorkbenchHtmlVisualEditor 暴露 requestHistory 命令与 onHistoryStateChange 回调，撤掉底部状态栏重复按钮
- context: html visual editor undo redo toolbar placement
- modified:
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 11:43 | Codex

- done: 工作台文件树右键'复制文件路径'支持多选：复制整组绝对路径，每行一个，与 Windows 资源管理器行为一致
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 10:33 | Codex

- done: 提升撤销历史与 CDP 验收经验至 KNOWLEDGE（工作台编辑器/构建验证两节），SESSION_LOG 标记 promoted
- modified:
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 10:32 | Codex

- done: HTML 可视化编辑新增撤销/重做：iframe 运行时内建 body 快照历史（250ms 防抖合并连续输入、离散操作前冲刷批次、上限 60 步），Ctrl+Z/Y 与状态栏按钮双入口，父窗口聚焦时转发快捷键；撤销回到保存基线自动清除脏标记；恢复时断开 MutationObserver 避免回声入栈
- context: workbench HTML visual editor undo
- modified:
  - `src/shared/utils/workbenchHtmlEditor.ts`
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson(promoted): 快照历史用 post-mutation 捕获 + index 线性移动即可同时得到 undo/redo，无需记录反向操作；恢复期间 observer.disconnect() 重连比时间窗口标志更可靠（微任务时序无竞态）；headless Edge + CDP 原生 WebSocket 可做注入运行时行为级验收，process.exit 会截断 stdout 要改 exitCode

### 09:19 | codex

- done: 修正 HTML 可视化编辑悬浮工具条、拖拽控件及取色弹层的浅色样式；避免代码预览暗色主题把图标文字刷白
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarChrome.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlColorPicker.tsx`
- lesson(promoted): 代码文件预览容器有意挂载 .dark 与 data-reader-theme='dark'，其中强制浅色浮层不能复用 text-text-primary/text-text-secondary 等语义文字类；需改用具体浅色文字色值，否则会被全局阅读器主题覆盖为浅色。

### 00:46 | Codex

- done: 修复设置页靠左不完全的问题:发现 Agent 配置分页使用独立容器 AgentSettingsPageSection 仍是 mx-auto max-w-3xl 居中(上一轮的漏改),已改 max-w-6xl 左对齐;同时内容区 lg:px-10 大内边距(48px)统一降为 px-6(24px)贴住导航,模型行 py-2 降 py-1.5 提升密度;eslint/tsc 通过
- modified:
  - `src/renderer/src/pages/SettingsPage.tsx`
- lesson(promoted): 分页布局若各页有独立容器(如 AgentSettingsPageSection 的固定头+独立滚动结构),改全局布局类时不能只改主滚动容器——rg 全量审计 max-w/mx-auto 命中点才能发现分页级逃逸

### 00:41 | Codex

- done: 移除代码预览器顶栏全部保存状态，保留底部状态显示
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 00:40 | Codex

- done: 删除代码预览器顶栏已保存徽标，保留异常和未保存状态
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 00:39 | Codex

- done: 按用户批准的 B1 方案落地设置页宽屏布局:SettingsPage 内容容器由 mx-auto max-w-3xl 改为 max-w-6xl 左对齐(Windows 设置范式);模型行控件右对齐(justify-between)与 hover 行高亮(hover:bg-white/80)为现状已具备,无需新增;eslint/tsc web 定向检查/build 全部通过
- modified:
  - `src/renderer/src/pages/SettingsPage.tsx`
- lesson: 验收布局方案前先核对现状:className 审计发现模型行的 justify-between 右对齐与 hover 行高亮早已存在,B1 的'三件套'中两件是存量,实际落地只剩容器宽度一处改动——方案阶段的落地清单要以代码事实为准

### 00:34 | Codex

- done: 回应用户对限宽通栏方案行首尾距离过远的质疑:在设置页布局对比原型中新增 B1(右端列对齐+hover行高亮,Windows/iOS 范式)与 B2(操作组紧邻名称,Chrome 部分设置页范式)两个子变体区块,B 降级为对照基线,推荐项改为 B1,同步更新导航/统计条/对比表/结论,已用无头 Edge 截图验证 B1/B2 渲染
- modified:
  - `docs/prototypes/settings-layout-comparison.html`

### 00:32 | Codex CLI

- done: 将命令行路径行的打开目录入口恢复为纯图标样式
- context: 用户评估后决定不在开发态隐藏或删除入口，只恢复原先图标按钮外观
- modified:
  - `src/renderer/src/components/CliIntegrationSection.tsx`

### 00:30 | Codex

- done: 基于半成品重构完成供应商设置页改造：补完 useAgentProviderSettingsState/AgentProviderToolbar/AgentProviderContent 拆分与设置页固定工具栏布局；Key 输入直连保存无取消环节（Key 按钮开关式切换）；取消 OAuth 立即关闭认证弹窗不再展示已取消终态
- context: 用户连续反馈认证弹窗的等待/取消语义噪音；用户并行做了工具栏固定重构需在其基础上收尾
- decision: API Key 走直连 setCredential 内联输入框；交互式 AgentAuthDialog 仅保留给多步 OAuth；等待态 10 分钟自动过期
- modified:
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/pages/SettingsPage.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/main/services/ProviderAuthController.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`

### 00:29 | Codex CLI

- done: 统一设置页命令行集成与关于更新区域的操作按钮样式
- context: 按截图反馈修正 CLI 配置按钮视觉混乱问题，保留目录入口的按钮形态并复用外链图标
- decision: 复制安装命令、复制调用命令、打开目录和检查更新统一为 h-9 rounded-lg 次按钮，文字统一 text-label，打开目录使用 open_in_new 图标
- modified:
  - `src/renderer/src/components/CliIntegrationSection.tsx`
  - `src/renderer/src/components/AboutSection.tsx`

### 00:27 | Codex

- done: 制作设置页宽屏布局对比原型 HTML:以 1:1 真实尺寸复刻四种业界方案(窄列居中现状/限宽通栏/描述+内容双列/通栏不限宽),含实时宽度占用统计条、方案 A 留白红色标注、方案 D 标签-控件距离标注,附横向对比表与落地清单(推荐 B:SettingsPage 容器 max-w-3xl 居中改 max-w-6xl 左对齐),已用无头 Edge 截图逐区块验证渲染
- added:
  - `docs/prototypes/settings-layout-comparison.html`
- lesson(promoted): edge 无头截图在沙箱内因 GPU 进程拦截失败,需提权运行;--screenshot 配合 --window-size 超大高度可截整页长图,System.Drawing 可按区域裁剪分块检查

### 00:24 | Codex

- done: Agent 配置页重构为固定头部布局：AgentProviderSettings 拆分为 useAgentProviderSettingsState 状态 hook + AgentProviderToolbar + AgentProviderContent + 组合形态四个导出；设置页 Agent 分页改为独立 flex 列（固定头部=SectionHeader+搜索/刷新额度/添加供应商工具栏，内容区独立滚动含供应商列表与技能目录卡片）；共享滚动容器不再包含 Agent 页；弹窗内组合形态恢复原滚动行为，移除了半透明 sticky 吸附方案
- modified:
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/pages/SettingsPage.tsx`
- lesson(promoted): sticky+半透明浮层方案被用户否掉后，正确解法是结构性布局（固定头+独立滚动区）；拆分组件时用状态 hook + state 对象整传（ReturnType 推导）可避免大量 props 枚举，组件必须定义在模块级防止重挂载

### 00:07 | Codex

- done: 修复供应商认证弹窗状态指示误导：等待输入阶段不再转圈（改为静态输入图标+输入框自动聚焦），转圈仅表示后台真实处理中
- context: 用户反馈 API Key 输入时弹窗一直转圈像卡住，实为 waiting 状态也渲染 spinner 导致的语义混淆
- modified:
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`

### 00:06 | Codex

- done: Agent供应商配置页移除内置订阅供应商名称后的「订阅」徽标（保留「订阅登录」按钮动作文案）
- context: 界面文案规范：能用视觉样式/状态表达的信息不靠标签堆砌，订阅身份无需重复标记
- modified:
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`

### 00:04 | Codex

- done: 设置页从连续滚动联动重构为左侧导航分页切换：界面与模式、Agent 配置独立成页；任务与总结/划词工具条/全局快捷键合并为效率页；数据与备份/命令行集成/关于与更新/开发工具合并为系统页；各分区块常驻 DOM（hidden 切换），切页不丢失编辑状态，切页时滚动复位
- modified:
  - `src/renderer/src/pages/SettingsPage.tsx`
- lesson: 语音输入会出现关键词转写错误（AA键=Agent），涉及专有名词时先对照现有代码语义确认再动手

### 00:03 | Codex

- done: Agent配置页简化：Magpie 不再查询/展示额度（本地网关聚合额度由网关自身管理），移除每模型单独配置项（上下文/思考档位覆盖编辑器）及其 IPC/服务/类型链路
- context: 用户反馈配置页过度复杂：Magpie 额度接口报错无意义；每个模型的 tune 编辑器增加认知负担
- decision: Magpie 在配额目标层直接跳过；模型规格覆盖功能全链路删除而非仅隐藏 UI，避免死代码
- modified:
  - `src/main/services/ProviderQuotaService.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/modelCatalogEnricher.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/agentRuntime.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderQuotaBar.tsx`
- removed:
  - `src/renderer/src/components/workbench/agent/AgentModelSpecEditor.tsx`
- lesson(promoted): Magpie 是本地聚合网关（127.0.0.1:3425），上游账号凭据与额度由网关自身管理，客户端仅需占位 key 即可连接，无需用户配置 API Key

## 2026-11-25

### 23:43 | Antigravity

- done: 重构 Agent 供应商配置体验：新增第三方网关模型规格自动补全（pi-ai 内置库 + models.dev 同步 + 手动覆写）、pi 订阅与中转站额度查询服务、常用预设与 curl/环境变量粘贴导入及完整编辑弹窗
- decision: 仅针对当前 pi-ai 内置订阅类型（openai-codex/openai/github-copilot/kimi-coding/anthropic/xai）、Magpie 网关聚合与主流中转/官方余额接口实现额度查询；list-custom-gateways IPC 剥离 apiKey 避免密钥跨进程泄露
- added:
  - `src/shared/config/providerPresets.ts`
  - `src/main/services/modelCatalogEnricher.ts`
  - `src/main/services/ProviderQuotaService.ts`
  - `src/renderer/src/utils/providerPasteParser.ts`
  - `src/renderer/src/components/workbench/agent/AgentProviderQuotaBar.tsx`
  - `src/renderer/src/components/workbench/agent/AgentGatewayEditorModal.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelSpecEditor.tsx`
- modified:
  - `src/shared/types/agentRuntime.ts`
  - `src/main/services/customGatewayProvider.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 22:47 | Codex

- done: 修复代码编辑器行号 gutter 宽度抖动（三轮）：找到用户实际看的是 WorkbenchCodePreview.tsx 不是 SourceEditor，同步补 formatNumber + 空占位 marker + gitGutter 列固定宽；顺带同步 MindmapMarkdownEditor
- context: 之前两轮只改了 WorkbenchSourceEditor.tsx（Markdown 源码编辑器），用户实际看的代码文件预览在 WorkbenchCodePreview.tsx，根本没碰。第三轮 CDP 实测发现 ggEl 始终=1（activeLineGutter 而非空占位），意识到改错文件。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx; src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx; src/renderer/src/components/MindmapMarkdownEditor.tsx`
- lesson(promoted): 排查 UI bug 时必须确认用户实际看的组件路径：搜索到多个候选时不要假定第一个匹配的就是目标；WorkbenchSourceEditor 是 Markdown 源码编辑、WorkbenchCodePreview 才是看 .ts/.js/.py 等代码文件的 CodeMirror 实例。同名 cm-gitGutter/cm-lineNumbers 在三处独立配置。

### 22:35 | Codex

- done: 修复源码编辑器行号 gutter 宽度抖动（二轮）：补上 gitGutter renderEmptyElements + 固定列宽，配合第一轮 formatNumber 补齐 5 位宽
- context: 第一轮只改 formatNumber 没修复，因为真正变量是旁边的 cm-gitGutter：视口内无 marker 时该列塌缩导致 .cm-gutters 整体宽度抖动。补 renderEmptyElements:true 让空行也渲染占位元素，并给 .cm-gitGutter 列固定 width:8px + flexShrink:0。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson(promoted): 调试 gutter 宽度类问题时要把所有 gutter 列都考虑进去：.cm-gutters 总宽 = 各列宽度之和，任一列塌缩（renderEmptyElements:false + 视口内无 marker）都会让总宽变化；formatNumber 锁的只是行号列自己的宽度。

### 22:32 | Codex

- done: 修复源码编辑器行号 gutter 宽度抖动：lineNumbers 用 formatNumber + padStart(5, NBSP) 锁死宽度
- context: CM6 的 lineNumbers gutter 有一个 spacer 元素，按文档行数向上取整到全9数预留最小宽度；滚动/点击时 spacer 重测导致 gutter 宽度微抖。
- decision: 用 formatNumber 把行号固定补齐到 5 位宽（不换行空格），gutter 宽度恒定；超过 99999 行才扩一次。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson: CM6 lineNumbers gutter 宽度 = spacer(按 maxLineNumber(9/99/999...) 预留) + 视口内最宽行号 + minWidth；width 固定会让大文件行号被 overflow:hidden 截断，formatNumber+padStart(NBSP) 是更稳的锁宽方式。

### 22:26 | Codex

- done: 分模块提交2笔并准备打包 NSIS 安装包
- context: perf(workbench) P0/P1 性能优化50文件 + docs/memory/agent-avatar；lint/tsc 双侧通过
- modified:
  - `git 提交e8360c5/db8be41`

### 21:50 | Codex

- done: workbench 性能优化变更端到端验收：通过 dev server (Electron remote-debugging 9223 + Vite import stores) 驱动 workbenchStore 真实动作，覆盖 P0/P1 主要链路
- context: 用户已启动 pnpm run dev；masters-thesis 工作区 7645 节点
- modified:
  - `.tmp/cdp/*.mjs`（验收脚本，过程文件）
- lesson(promoted): dev server 验收可走 remote-debugging-port=9223 CDP；页面内 import('/src/store/*.ts') 拿真实 store 实例驱动 openFile/saveActiveFile/refreshGitStatus 等动作，无需 UI 自动化

### 21:28 | Antigravity

- done: Landed all 17 P0 and 10 P1 workbench performance and memory optimizations across main, preload, shared, and renderer layers via 4 parallel workers; passed full eslint, node/web tsc, and production build.
- context: Executed from docs/workbench-performance-memory-optimization-plan.md with disjoint file ownership across 4 workers.
- decision: Kept IPC/store contracts synchronized (knownBlobSha baseline short-circuit, gitRepoStamp, extractFileTags, sourceSyncFlusher/flushActiveEditorSync, MindmapVisibilityContext, and WorkbenchEditor isActive guard); deferred P2 items as planned.
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/noteManager.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/services/annotationService.ts`
  - `src/main/services/gitService.ts`
  - `src/main/services/workbenchService.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFindReplaceBar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitGutterPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTableCellResizerPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTocRail.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`
  - `src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx`
  - `src/renderer/src/components/workbench/markdownSourceMap.ts`
  - `src/renderer/src/hooks/useGitLineDiff.ts`
  - `src/renderer/src/hooks/useMindmapCanvas.ts`
  - `src/renderer/src/hooks/useSourceAnnotations.ts`
  - `src/renderer/src/hooks/useWebviewLifecycle.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/store/annotationStore.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/utils/gitDiff.ts`
  - `src/renderer/src/utils/wordCount.ts`
  - `src/shared/types/workbench.ts`
  - `src/shared/utils/annotationAnchors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/workbenchHtmlAnnotations.ts`
  - `src/shared/utils/workbenchHtmlEditor.ts`
- unresolved: Interactive desktop smoke testing in pnpm run dev (large workspace file tree/git, 5k-line annotated markdown, 15+ round Agent streaming, 100+ page PDF/5MB DOCX resize, and Ctrl+F/Ctrl+S focus isolation) remains to be verified interactively.

### 21:04 | Antigravity

- done: 完成工作台全链路性能与内存深度源码审查，并输出分级优化开发文档
- context: 基于体验零下降标准将 17 项纯正向收益优化列为 P0，10 项需权衡 UX/配套防护的优化列为 P1，7 项长尾优化列为 P2
- added:
  - `docs/workbench-performance-memory-optimization-plan.md`

### 20:20 | Codex

- done: 分模块提交4笔并打包 NSIS 安装包
- context: Git提交详情面板、Agent模型选择器收藏+最近使用、.bib/.bst代码编辑器+脚注段中解析修复；dist/MultiChat Setup 1.3.5.exe 115.9MB
- modified:
  - `git 提交c770545/5521062/f16c6ad/96365a2`

### 20:05 | Codex

- done: 最近使用模型同时显示收藏星标与移出按钮
- context: 非收藏的最近使用模型悬浮操作区改为星标在左、× 在右；星标按钮不再随 showRemoveRecent 条件隐藏，文本区按是否存在 × 动态预留 pr-14/pr-7
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 20:02 | Codex

- done: 常用区支持移除最近使用并改为悬浮操作
- context: 最近使用但非收藏模型在常用区 hover 显示 ×，点击从 agent_recent_models 移除；收藏星标和 × 均绝对定位在卡片右侧，整行 hover 触发，不占卡片宽度；新增 agent:remove-recent-models IPC 与主进程 removeRecentModels
- decision: 收藏行显示星标，非收藏最近使用行显示 ×；当前激活模型的 check 仅保留在收藏/普通模型行
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 19:58 | Codex

- done: 模型选择弹窗星标改为整行 hover 触发
- context: 用户澄清 hover 范围是模型卡片整行，而非星标按钮本身。新增 hoveredRowKey 行级状态，onMouseEnter/onMouseLeave 在 renderModelRow 根节点切换，收藏按钮 opacity 由当前行 hover 状态决定
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 19:57 | Codex

- done: 模型选择弹窗星标改为仅鼠标进入按钮时显示
- context: 用户截图显示星标仍常亮；源码已是 Tailwind group-hover 隐藏版且 Vite 实时模块返回最新代码。为避免运行进程/CSS HMR 状态差异，改为每个星标按钮 inline opacity:0 + onMouseEnter/onMouseLeave 直接控制 opacity
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 19:53 | Codex

- done: 工作台 .bib/.bst 文件改用代码编辑器打开并配专属图标：CODE_EXTENSIONS 新增 .bib/.bst，FileTypeIcon 引入 material 主题 bibliography/bibtex-style 图标
- added:
  - `src/renderer/src/assets/file-icons/bibliography.svg`
  - `src/renderer/src/assets/file-icons/bibtex-style.svg`
- modified:
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`

### 19:52 | Codex

- done: AgentModelPicker 常用区合并收藏+最近使用、新增行内星标切换
- context: AgentModelPicker 弹窗；原 favorites 区改为 favorites+recent（前端去重、置前 favorites），新增 RECENT_MODELS_STORE_KEY 持久化、setModel 写入、8 条淘汰上限；行右侧 hover 显示星标，收藏时常显实心星
- decision: recent 存于 electron-store 键 agent_recent_models，最多 8 条，按 LRU 推入；favorites 在前端去重优先，recent 仅补充非收藏项
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/shared/types/agentRuntime.ts`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 19:37 | Codex

- done: 上下文用量弹窗字号升档（标题/正文 caption→label），与其他 Agent 弹窗对齐
- modified:
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`

### 19:19 | Codex

- done: Git 历史时间戳还原为相对时间，展开详情新增『作者 · 完整时间戳(秒级)』行
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 19:18 | Codex

- done: Git 历史列表时间戳由相对时间（N 分钟前/小时前/天前）改为自适应精确时间：今天只显 HH:MM，今年显 MM-DD HH:MM，跨年补 YYYY-；并加 tabular-nums 等宽数字对齐
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 18:48 | Codex

- done: Git 历史面板支持点击提交查看详情：展开文件改动列表，含状态徽标、增删行统计、点击打开文件；新增 gitCommitDetail IPC 与主进程 getCommitDetail（git show --numstat + --name-status -z）
- modified:
  - `src/main/services/gitService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 18:40 | Codex

- done: 版本管理弹窗改为固定高度：WorkbenchFooterPopover 新增 contentHeight prop + 视口压缩自适应；Git 弹窗传 480px，历史/改动空态撑满居中
- decision: contentHeight 做成可选 prop 而非全局默认，未传时保持原动态高度，Vault/WorkspaceSettings 两个调用方零影响
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 18:26 | Codex

- done: 优化脚注输入弹层：将编号输入框与脚注内容输入框改为白色背景，保留边框、焦点与错误状态。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFootnotePopover.tsx`

### 18:23 | Codex

- done: 将标注卡片从单侧左描边改为整圈标注色描边，并让选中态以更深的琥珀色和光环强调。
- modified:
  - `src/renderer/src/components/AnnotationCommentCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`

### 18:23 | Codex

- done: 优化工作台文件树搜索交互：工具栏搜索按钮进入/聚焦搜索，搜索框移除重复返回与清空按钮并统一退出，Esc 退出，打开搜索结果成功后自动返回文件树
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
- lesson(promoted): 工作台搜索属于文件树局部状态：退出入口应收敛为关闭按钮/Esc/打开结果，工具栏搜索按钮在进入搜索态后应聚焦输入框而不是反向退出；openFile 已负责展开祖先目录和定位。

### 18:21 | Codex

- done: 优化工作台标注评论卡片尺寸：统一设计系统字号与按钮触控高度，编辑输入区改为正文档位，并适度加宽旁注栏与卡片留白。
- modified:
  - `src/renderer/src/components/AnnotationCommentCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
- lesson(promoted): 工作台局部浮层应优先使用 DESIGN.md 的语义字号和 32px 控件高度，避免用 text-caption/tiny 与 py-0.5 把 Operate 工具卡片做得过小。完整构建可能被工作区既有未提交语法错误阻断，需用定向类型检查区分责任边界。

### 18:20 | Codex

- done: 简化标注导出为脚注：隐藏侧栏时去掉下载入口、弹窗改为复用 ConfirmModal（固定 highlight 格式、全部 anchored 标注、另存为直写工作空间）
- modified:
  - `src/renderer/src/components/workbench/AnnotationExportFootnoteModal.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/preload/index.ts`
  - `src/main/ipcHandlers.ts`

### 18:14 | Antigravity

- done: Add non-destructive annotation-to-footnote export feature and rename 注释 to 标注 in WorkbenchMarginNotes
- added:
  - `src/renderer/src/components/workbench/annotationFootnoteExport.ts`
  - `src/renderer/src/components/workbench/AnnotationExportFootnoteModal.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`

### 18:08 | Codex

- done: 右键菜单'摘录为文档'仅在工作台 AI 侧栏显示，多AI视图与快捷窗口中隐藏（文档落点在工作台工作区，其他宿主下用户无法定位）
- decision: 渲染层按 captureContextOf(wcId) 过滤 excerpt 菜单项；主进程不用改，无需 IPC 同步 webview 归属
- modified:
  - `src/renderer/src/components/CustomContextMenu.tsx`

### 18:05 | Antigravity

- done: PDF 暗黑模式下通过 PDF.js getOperatorList 解析位图区域并叠加无滤镜原图还原层，保持照片与扫描图片原样显示
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`

### 17:53 | Antigravity

- done: 修复暗黑模式下块插入菜单未变暗与评论标注文字变黑问题，并优化顶部背景切换按钮可见性
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchReaderThemePicker.tsx`
- lesson(promoted): HTML 原生 <mark> 元素在 Chromium UA 样式表默认带 color: black，暗黑模式下需显式在 .PlaygroundEditorTheme__mark 声明 color: inherit；挂在 document.body 的块插入菜单需显式读取阅读主题状态适配暗黑样式

### 17:47 | Antigravity

- done: 实现同工作区静态 cd/Set-Location 受限放行并修复 bypass 模式权限单调性（auto 放行的只读参数未登记工具与缺命令执行分支不再在 bypass 下被硬拒绝）
- decision: cd 目标在 AST/segment 阶段提取为 cdTargets，由 decidePermission 按模拟 cwd 逐段校验工作区边界并用新 cwd 复核后续相对路径；移除 hardDenyReason 中 bypass 对 unknown 工具和缺命令调用的硬拒分支，保证 bypass >= auto >= default 单调性
- modified:
  - `src/main/services/commandAnalyzer/externalCommandGate.ts;src/main/services/commandAnalyzer/psAstAnalyzer.ts;src/main/services/commandAnalyzer/bashAnalyzer.ts;src/main/services/permissionPolicy.ts;src/main/services/PermissionEngine.ts`
- unresolved: 尚未在 pnpm run dev 桌面窗口中进行界面端到端人工验证

### 17:47 | Antigravity

- done: 为工作台 Markdown 编辑（富文本与源码）、PDF 预览和 Word 预览新增四档背景预设（纸白/羊皮纸/豆沙绿/中性暗黑）及各自独立持久化，暗黑模式下同步切换顶部工具栏与图标，并将代码阅读器统一至中性暗黑 #1E1E1E 体系
- decision: 纸白/羊皮纸/豆沙绿保持顶部工具栏浅色一致，仅中性暗黑同步切换工具栏与图标；PDF/Word 非白底连同纸张本身着色或暗黑反色，不额外加开关，依托三端独立持久化应对彩图 PDF 场景
- added:
  - `src/renderer/src/components/workbench/WorkbenchReaderThemePicker.tsx`
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPreviewChrome.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`
- lesson(promoted): tailwind.config.js 的 text-primary (#1f2937) 与 text-secondary (#6b7280) 为静态 Hex，局部挂载 .dark 不会自动变色，需配合容器属性选择器显式覆写；Word section.docx 施加 invert 滤镜时需清除原 box-shadow 并反色还原 img/svg

### 17:45 | Codex

- done: 替换脚注按钮图标为自定义 lucide 风格 SVG：圆角方框 rx=4 + 单笔画数字 1（AppIcon footnote），不再使用 MessageSquareQuote 评论气泡图标
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 17:32 | Codex

- done: 按功能模块拆分提交当前未提交改动
- context: 用户要求提交当前修改；工作区含液态玻璃 UI、Git 远程状态可视化、脚注/上下标、Markdown rehype-raw 及记忆日志五组改动，另有 .tmp/、scratch/、assets/agent-avatar.png 未跟踪过程文件沿用历史口径不入库
- decision: 按功能拆 5 个 commit：refactor(ui)液态玻璃体系、feat(git)远程状态可视化、feat(workbench)脚注上下标、feat(agent)rehype-raw、docs(memory)会话日志与经验沉淀
- modified:
  - `DESIGN.md`
  - `src/renderer/src/assets/index.css`
  - `src/main/services/gitService.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx`
  - `src/renderer/src/components/ModelOutputCard.tsx`
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 17:29 | Antigravity

- done: 将脚注悬浮 tooltip 从毛玻璃改为实色白底卡片（dark 下为 gray-800），避免正文透底影响阅读
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx`

### 17:24 | Antigravity

- done: 补充富文本粘贴脚注语法识别（避免被转义为 &#91;^id&#93;）并将脚注定义块改为极简无框序号样式
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx`
  - `src/renderer/src/assets/index.css`
- lesson(promoted): Lexical MarkdownShortcutPlugin 仅响应键入不拦截粘贴；手贴 [^id]: 或 [^id] 落入普通 TextNode 后会被 exportTextFormat 转义为 &#91;^id&#93;，需在 PASTE_COMMAND (COMMAND_PRIORITY_HIGH) 跳过内部 clipboard 与代码上下文后用 $generateNodesFromMarkdownString 即时转换。

### 17:14 | Antigravity

- done: 将编辑器浮动格式工具栏恢复为实色白底，避免正文上方毛玻璃产生视觉侵入感
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarChrome.tsx`

### 17:10 | Antigravity

- done: 修复工作台脚注重复覆盖与自动递增检测，支持 GFM 1 对多复用、空内容插入及渲染态定义块
- decision: 遵循 GFM 1 对多脚注标准（多处引用指向同一定义，遵循 First Definition Wins）：插入已有编号且内容留空时仅插入引用不覆盖原定义；输入已有编号同时填写新内容时拦截并提示改用递增编号或清空仅引用；新增脚注允许内容留空占位。
- added:
  - `src/renderer/src/components/workbench/workbenchFootnotes.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFootnoteNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/markdownSourceMap.ts`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/assets/index.css`
- lesson(promoted): 在 Lexical ElementNode 承载 Markdown 块级语法（如 [^id]: 定义行）时，markdownSourceMap.ts 的 isSpecialBlockLine 与 scanMarkdownSourceBlocks 必须同步识别该块边界，否则连续多条定义会被合并为单个段落并导致 1:N 错位；同时 ElementTransformer.regExp 只需匹配行首前缀，由 @lexical/markdown 保留剩余文本节点以解析行内格式。

### 16:56 | Antigravity

- done: 深色模式原型 v7（顶部纯暗背景色 + 底部晴蓝融粉无缝连续渐变 + 深灰高光玻璃卡片）落盘至 docs/prototypes/dark-mode-prototype.html 归档待后续开发
- context: 用户确认深色模式原型效果满意，要求暂不进行代码开发，先将原型放入 docs 目录下留档
- added:
  - `docs/prototypes/dark-mode-prototype.html`

### 16:56 | Codex

- done: 脚注工具栏图标与正文段落图标去重：保留正文段落 ¶(notes)，插入脚注改用 footnote(MessageSquareQuote) 图标
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePopover.tsx`

### 16:49 | Codex

- done: workbench markdown 上标/下标/脚注：渲染层 rehype-raw + remark-gfm 脚注；Lexical 侧 sup/sub 走 TextMatchTransformer(<sup>/<sub>)，脚注引用 WorkbenchFootnoteRefNode decorator + 定义行文末透传；两个工具栏(富文本+源码)加 x² 下拉与插入脚注弹层
- decision: 上下标导出用 <sup>/<sub> 行内 HTML（无 markdown 原生语法），remark-gfm 已自带脚注支持；脚注定义行不落节点，作为普通段落文本透传，编辑时按 id 去重重写
- added:
  - `src/renderer/src/components/workbench/WorkbenchFootnoteNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFootnotePopover.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/components/ModelOutputCard.tsx`
  - `src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/assets/index.css`
  - `package.json`
  - `pnpm-lock.yaml`

### 16:27 | Antigravity

- done: 全量弹窗与下拉/菜单/浮层接入 8px 轻模糊仿液态玻璃效果并移除弹窗视觉遮罩
- context: 用户确认采用 8px 轻模糊仿液态玻璃方案，且弹窗不加暗色遮罩，需兼顾 Electron 性能、明暗模式与易读性
- decision: 在 index.css 新增明暗双色 liquid-glass-menu 与 liquid-glass-modal（8px blur + saturate 145% + 方向性渐变微透底 + inset 高光亮边），Modal 默认改为 variant=glass 且 backdrop=none（仅透明点击拦截层）；用 border + 多层 box-shadow 替代 ::before 伪元素以兼容 overflow-y-auto 与 overflow-hidden
- modified:
  - `DESIGN.md`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/ui/Modal.tsx`
  - `src/renderer/src/components/ConfirmModal.tsx`
  - `src/renderer/src/components/RenameModal.tsx`
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditLeaveDialog.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/CustomDropdown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/agent/AgentPopover.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenu.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTableActionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEquationNode.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/WorkbenchUrlInputPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEquationEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlColorPicker.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarChrome.tsx`
  - `src/renderer/src/components/AnnotationCommentCard.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`
- unresolved: 需在 pnpm run dev 桌面实机中目视检查弹窗无遮罩与跨 webview 菜单表现

### 16:15 | Antigravity

- done: 核查全项目弹窗与下拉菜单毛玻璃现状并输出仿液态玻璃高保真交互原型
- context: 用户关注之前有的毛玻璃效果为何消失，并希望在不拖慢 Electron 跨 webview 性能的前提下预览兼顾易读性的仿液态玻璃效果
- decision: 原型中提供当前实色、零模糊纯合成仿液态玻璃（渐变微透+mask-composite高光边+多层inset折射，0个backdrop-filter）和8px轻模糊三档实时切换对比
- added:
  - `docs/prototypes/liquid-glass-showcase.html`

### 16:08 | Antigravity

- done: 评估并修复工作台 Markdown 图片识别问题（尾部硬换行空白、含空格本地路径、可选标题与 Pandoc {#...} 属性），并对齐源码扫描器与节点序列化
- decision: 由 markdownSourceMap.ts 统一导出 IMAGE_BLOCK_REGEX 供扫描器与 MarkdownSyncPlugin 共用，避免顶层块切分错位
- modified:
  - `src/renderer/src/components/workbench/markdownSourceMap.ts`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`
- lesson(promoted): 修改工作台 Markdown ElementTransformer 正则时，必须同步更新 markdownSourceMap.ts 的同源块正则（最好直接共用导出常量），否则 Lexical AST 与 SourceBlock 1:N 错位会导致源码保真退化为复合块并在邻块编辑时误伤原文

### 16:07 | Antigravity

- done: 修复版本管理面板 Tab 栏重复渲染两个状态说明按钮的嵌套 JSX 问题
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 16:06 | Codex

- done: 设置页「界面与模式」图标由 view_column_2 (Columns2) 换成 web_asset (AppWindow)，更贴界面/模式语义
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/pages/SettingsPage.tsx`

### 16:03 | Antigravity

- done: 统一文件树与版本管理面板的 Git 状态徽标与配色，补齐精简 Tooltip 与状态说明浮卡（U 统一简称为新文件）
- decision: 保留 M/U/D/R/A/C/! 字母，统一由 gitStatusBadge.ts 提供精简中文标签、英文原词与短描述；Tooltip 与状态说明浮卡仅按需展示，不挤占主列表
- added:
  - `src/renderer/src/utils/gitStatusBadge.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- unresolved: 未在 pnpm run dev 桌面窗口内实际交互验收，需手动启动确认

### 14:23 | Codex

- done: Git 历史图连线颜色改为跟随节点同步状态，泳道按等待提交的远程状态着色
- context: 用户反馈节点已区分已推送/未推送，但连线仍沿用泳道色；要求线色跟随节点
- decision: 布局层为每条泳道记录等待提交的 pushed 状态；入线与出线跟随当前节点状态，穿行线跟随目标提交状态，使颜色在相邻节点之间自然衔接
- modified:
  - `src/renderer/src/utils/gitGraphLayout.ts`
  - `src/renderer/src/components/workbench/GitHistoryGraph.tsx`

### 14:18 | Codex

- done: Git 历史图按远程同步状态给节点着色，并补充已推送/未推送图例与提交提示
- context: 用户要求 Git 树节点颜色可区分已推送到远程与仅本地提交，并参考 VS Code 提交图样式
- decision: 主进程用 rev-list --all --not --remotes 计算显示范围内未推送提交；渲染层保留泳道连线色，节点用灰色/琥珀色表达同步状态
- modified:
  - `src/main/services/gitService.ts`
  - `src/renderer/src/components/workbench/GitHistoryGraph.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/shared/types/workbench.ts`
- lesson(promoted): Git 提交图区分远程状态可用 rev-list --all --not --remotes 得到未推送集合，避免逐提交执行 contains 查询

### 14:08 | Codex

- done: 按功能模块提交 5 个 commit 并构建 Windows NSIS 安装包 1.3.5
- context: 用户要求提交修改并构建安装包；工作区含下载保存框、弹窗性能、布局限宽、模型选择器四组未提交改动及记忆日志改动，另有 .tmp/、scratch/、assets/agent-avatar.png 未跟踪过程文件未纳入提交
- decision: 按功能拆分提交：下载保存框、弹窗遮罩性能、控制栏限宽与卡片阴影、Agent 模型选择器、记忆日志；构建使用当前 package.json 版本 1.3.5，未额外升版
- modified:
  - `src/main/index.ts`
  - `src/main/services/workbenchDownloadService.ts`
  - `CHANGELOG.md`
  - `src/renderer/src/components/ui/Modal.tsx`
  - `src/renderer/src/components/ConfirmModal.tsx`
  - `src/renderer/src/assets/index.css`
  - `DESIGN.md`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/modes/DebateModePanel.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 14:01 | Antigravity

- done: AgentModelPicker 供应商列表支持折叠与展开
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 13:59 | Antigravity

- done: 调整思考强度滑块渐变为越高越暖并移除无条件显示的大脑图标
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 13:55 | Antigravity

- done: 优化 Agent 侧边栏 Model Picker 组件及思考强度渐变滑块
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 13:38 | Antigravity

- done: 将底部控制栏最大宽度由 max-w-5xl (1024px) 调整为 max-w-7xl (1280px)，确保在主窗口最小宽度 (1100px) 下可撑满并与卡片外缘对齐
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 13:35 | Codex

- done: 工作台 AI Webview 原生下载改为弹出系统保存框，默认目录为当前工作区
- context: 工作台下载原先由 workbenchDownloadService 在 will-download 中直接 setSavePath，静默落盘到工作区根目录
- decision: 保留 will-download 识别与默认文件名生成，改用 downloadItem.setSaveDialogOptions({ defaultPath }) 而不调用 setSavePath，让 Electron 走默认保存框
- modified:
  - `src/main/services/workbenchDownloadService.ts`
  - `src/main/index.ts`
  - `CHANGELOG.md`
- lesson(promoted): Electron will-download 中 setSavePath 会跳过系统保存框；要保留保存框并指定默认位置，应使用 item.setSaveDialogOptions({ defaultPath })。

### 13:33 | Antigravity

- done: 排查确认弹窗弹出卡顿原因并移除 Modal 全屏模糊与遮罩淡入动画，solid 弹窗改用透明点击拦截层，glass 弹窗保留轻量纯色压暗
- modified:
  - `src/renderer/src/components/ui/Modal.tsx`
  - `src/renderer/src/components/ConfirmModal.tsx`
  - `src/renderer/src/assets/index.css`
  - `DESIGN.md`
- lesson(promoted): Electron/Chromium 中全屏 fixed inset-0 叠 backdrop-blur-sm 再加 opacity 淡入动画会触发合成器跨 webview 与下层 glass-panel 反复全屏采样重绘导致弹窗明显卡顿；solid 确认弹窗改用 bg-transparent 透明事件拦截层（保留阻断 webview 穿透与点击外部关闭语义），glass 大弹窗仅用无动画轻量纯色压暗（bg-black/25）。

### 13:31 | Antigravity

- done: 限制多AI/任务分配/辩论模式底部操作栏全屏最大宽度并居中，同时收敛 WebviewCard 阴影避免被外层滚动容器底边裁切形成分界线
- modified:
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/modes/DebateModePanel.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`

### 13:27 | Codex

- done: 提交工作台改动：按功能拆 4 个 commit（md 编辑器引用块入口、Git 面板反馈/Hooks 修复、工作台 UI 体系审计重构、会话日志）
- context: 用户要求提交修改
- decision: .tmp/、scratch/、assets/agent-avatar.png 沿用此前判定作为过程文件不入库；GitPanel 字号/反馈改造与审计重构同 hunk 交织不可干净拆分，整文件归入 fix commit
- modified:
  - `已提交文件见 git log 6d9e110..79387be`
- unresolved: 工作台 UI 审计重构与引用块入口未在 pnpm run dev 桌面窗口实际验证

### 13:25 | Codex

- done: 工作台md编辑器补引用块入口：顶部工具栏加快捷引用按钮，浮动工具栏加引用切换按钮
- modified:
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`

### 13:21 | Antigravity

- done: 修复 WorkbenchGitPanel 中 closePopover 的 useCallback 误放在 if (!workspacePath) return null 之后的 Rules of Hooks 报错
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- lesson: React 组件中所有 Hook（含后补的 useCallback）必须严格位于首个条件 return 之前；ESLint 未开启 react-hooks/rules-of-hooks 时，修改组件后需自检 Hook 调用顺序

### 13:17 | Antigravity

- done: 优化版本管理面板字号对齐与反馈交互：列表/输入框/主按钮升回 DESIGN.md text-body(14px)，次按钮使用 text-label(12px) 与右键菜单协调一致；将 gitNotice 拆分为 2.6s 自动消散的不占位悬浮胶囊（成功/信息，去除 gitInit/gitCommit 冗余成功提示并在关闭弹层时清理）与可关闭内嵌圆角警示卡（错误/警告）
- decision: 保留 history 列表行高 h-10(40px) 与 GIT_GRAPH_ROW_HEIGHT 对齐，避免 SVG 提交轨断线；仅对 error/warning 保留常驻与关闭按钮
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 13:09 | Antigravity

- done: 完成工作台与 Agent 侧栏 UI 体系审计重构：清理 5 个零引用死组件，抽取 FormControls/WorkbenchPreviewChrome/WorkbenchSelectionMenu/formatFileSize，统一 DESIGN.md 字体阶梯、AppIcon 尺寸、Modal 弹窗壳、z-index 层级、暗色模式与 Tailwind v3 有效类名（不改变 UI 布局与元素顺序）
- decision: 保留现有布局、组件顺序与视觉结构，只收敛重复 UI 壳与规范偏移；Tailwind v3 无 animate-in/shadow-xs/py-0.2/w-6.5/h-18 等类名，统一替换为 tailwind.config.js 与 DESIGN.md 约定 token
- added:
  - `src/renderer/src/components/ui/FormControls.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPreviewChrome.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenu.tsx`
  - `src/renderer/src/utils/formatBytes.ts`
- modified:
  - `DESIGN.md`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/ui/Modal.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEquationEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEquationNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFindReplaceBar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlColorPicker.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditLeaveDialog.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchLinkHoverPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSendToAiButton.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTableActionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTitleBar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTocRail.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchUrlInputPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchVaultPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentPopover.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSettingsDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSkillsSettings.tsx`
  - `src/renderer/src/components/workbench/agent/ApprovalCard.tsx`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`
  - `src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx`
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`
  - `src/renderer/src/components/workbench/agent/WorkPhaseBlock.tsx`
- removed:
  - `src/renderer/src/components/workbench/agent/AgentThinkingPicker.tsx`
  - `src/renderer/src/components/workbench/agent/BashToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/EditToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ReadToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ToolFallback.tsx`
- lesson: React 18 下组件可选 ref prop 类型应声明为 Ref<T>（而非 RefObject<T | null>），与 StrictNullChecks 兼容；JSX 注释 {/* ... */} 不能直接放在 createPortal(arg1, arg2) 的非标签位置

### 12:47 | Codex

- done: 提交当前工作区改动：按功能拆 5 个 commit（HTML 预览缩放、重命名/外部变更 URL 同步、Git 右键撤回/删除/忽略菜单、快捷窗口模态失焦保护、记忆文档）
- decision: .tmp/、scratch/ 与 assets/agent-avatar.png 判定为过程文件与重复资源未入库（与此前口径一致）
- modified:
  - `已提交文件见 git log 430376d..a68e90f`
- unresolved: 右键菜单撤回交互未在 pnpm run dev 桌面窗口实际点击验证

### 12:45 | Antigravity

- done: 实现工作台版本管理列表右键菜单：支持 M/T 撤回修改、D 恢复删除、R/C 撤回重命名或移出待提交、A 移出待提交或移入回收站、U 一键加入 .gitignore 或移入回收站，并同步编辑器重载与浮层防误关
- decision: 面向非编程用户隐藏暂存区术语；U/A 删除走系统回收站（workbenchDeleteNode + git rm --cached），M/D/R 还原走 HEAD，右键菜单与 ConfirmModal 使用 data-footer-popover-portal 避免触发父浮层失焦关闭
- modified:
  - `src/main/services/gitService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- unresolved: 未在 pnpm run dev 桌面窗口内实际点击右键菜单与撤销交互，需手动启动验证

### 12:32 | Antigravity

- done: 排查 Ctrl+滚轮未触发 HTML 缩放的根因（运行中的主进程 11:29 启动未重启，且原 100 阈值在系统高 DPI 缩放下首格滚轮 deltaY<100 会被吞掉），并将滚轮阈值调优为 60 且整格滚动清零余量
- modified:
  - `src/shared/utils/workbenchHtmlAnnotations.ts`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`

### 12:30 | Codex

- done: 工作台 HTML 渲染预览顶栏：把刷新按钮移到缩放控件之后、分隔线之前
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 12:27 | Antigravity

- done: 将 HTML 渲染预览顶栏缩放控件移至「渲染/编辑/源码」模式分段控件之前，保持切换模式时分段控件与右侧操作按钮位置固定
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 12:27 | Antigravity

- done: 快捷窗口打开原生文件选择等模态对话框时阻止失焦自动隐藏
- decision: 在 scheduleBlurHide 中检测 win.isEnabled() 与 macOS sheet-begin/sheet-end 模态状态，模态打开期间轮询保持显示，关闭后补等一个 150ms 周期再判定失焦
- modified:
  - `src/main/webviewManager.ts`

### 12:25 | Antigravity

- done: 为工作台 HTML 渲染预览增加网页缩放能力（Ctrl/Cmd+滚轮、Ctrl+加减/0 及顶栏缩放控件），通过 iframe 内 CSS zoom 实现与浏览器一致的流式排版缩放
- modified:
  - `src/shared/types/htmlAnnotations.ts`
  - `src/shared/utils/workbenchHtmlAnnotations.ts`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
- lesson(promoted): HTML 渲染预览的 Ctrl+滚轮缩放需在 sandbox iframe 的标注运行时内以 { passive: false, capture: true } 拦截并设置 document.documentElement.style.zoom：在 Electron 42/Chromium 中 CSS zoom 会自动按视口重排文本与缩放 Range.getBoundingClientRect()/clientX，无需额外坐标换算，且不会污染编辑态源码或缩放整个宿主窗口。

### 12:11 | Antigravity

- done: 修复工作台重命名 HTML/预览文件后 activeFileUrl 未同步导致预览空白与标注脚本报错的问题，并优化文件树重命名与 HTML 预览首帧初始化
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson(promoted): 工作台 renameNode 和 handleExternalFsChanged 更新 activeFilePath 时必须同步刷新 activeFileUrl 与 activeFileCategory（一次 set 原子提交），否则 HTML/图片预览会继续请求已失效的旧 workbench-file:// URL；WorkbenchCodePreview 需按文件类型直接初始化 viewMode 并把 activeFileUrl 纳入 iframe 预览组件 key。

### 11:50 | Codex

- done: 修复 Markdown 预览 Git Gutter：为同步层放弃映射的 1:N 复合段增加只读近似映射，并取消首帧对 rAF 的依赖；用污染文档完成不落盘高亮验证，并在干净 V3 的 1:5 复合段内编辑验证增量回写未复制。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitGutterPlugin.tsx`
- lesson(promoted): Markdown 预览高亮可对 1:N 复合段做只读近似映射，但不得进入回写路径；首次 DOM 测量不能依赖可能暂停的 rAF。

### 11:21 | Codex

- done: Gemini 画布导出菜单「存为文档」改用与工作台回复按钮同款文件+加号图标，并加浅蓝底高亮以区分原生菜单项
- context: 用户要求图标与对话框注入的新建文档按钮一致，并用高亮做区分；通过 CDP 实测 Gemini 画布菜单渲染
- decision: 图标直接复用 generateInsertReplyButtonScript 的 save SVG 路径；高亮用 26x26 浅蓝圆角底（#dbeafe）而非仅改图标颜色，因为 #eff6ff 在菜单浅灰蓝底上不可见；脚本 guard key 升到 V6 以便已注入页面重新执行
- modified:
  - `src/shared/utils/webviewScripts.ts`
- lesson: Gemini 菜单底色本身是浅灰蓝，工作台 dark UI 上可见的 #eff6ff chip 在菜单里几乎不可见；跨背景复用时需要按目标底色加深一档

### 11:16 | Codex

- done: Canvas「存为文档」菜单项图标复用工作台「存为新文档」SVG 并加高亮色
- context: 用户希望菜单项图标与对话框注入的存为新文档按钮一致，并用高亮区分原生项
- decision: 去掉 mat-icon 的 fonticon 属性让伪元素为空，改用 createElementNS 构建与 ICON_DEFS.save 相同的文件+加号 SVG(20px)，图标着 #1a73e8 强调色；guard 升到 V4
- modified:
  - `src/shared/utils/webviewScripts.ts`
- lesson: Gemini 菜单 mat-icon 只要移除 fonticon 属性伪元素就不再出字形，可安全改挂自定义 SVG

### 11:08 | Codex

- done: 修正 Gemini Canvas「存为文档」菜单项图标尺寸/字形异常
- context: 用户反馈注入图标比其他菜单项大且字形错乱；实测 mat-icon 由 .lumi-symbols 的 ::before 按 fonticon 属性渲染 ligature，原脚本同时写入 textContent 导致双层字形，且 note_add 不在该字体子集里
- decision: 去掉 textContent 只留 fonticon/data-mat-icon-name，图标名改用 edit_note；guard key 升到 V3 以便已注入页面被新脚本替换
- modified:
  - `src/shared/utils/webviewScripts.ts`
- lesson: Gemini 菜单 mat-icon 的 ::before content 由 fonticon 属性驱动，文本内容必须为空；Luminous Symbols 里 note_add/note/save/sticky_note_2/insert_drive_file 等缺失会渲染成残字，可用的是 edit_note/article/notes/description/docs

### 10:46 | Codex

- done: 修复 Gemini Canvas「存为文档」菜单项注入失败
- context: 通过 CDP(9223) 连接运行中的 MultiChat webview 逐层排查：注入脚本已执行(bound=true)、MutationObserver 正常触发、copy 菜单项可定位可 clone，最终发现 insertBefore 的父节点错误导致 DOMException 被静默吞掉
- decision: 插入点改为 copy 项所在的顶层子节点(content 直接子节点)，并把 guard key 升级为 V2 让旧注入能被替换；scan 增加 deep-research-immersive-panel 存在性判断，保证只在画布打开时注入
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: Gemini 菜单 gem-menu-item 外面还包着 COPY-BUTTON 等 wrapper，不在 .mat-mdc-menu-content 直接子级；clone 后必须插到 copy 项所在顶层子节点之前，否则 insertBefore 抛 NotFoundError 且异常静默中断整轮注入

### 10:40 | Codex

- done: 补齐 Markdown 源码扫描的代码围栏尾随空格兼容，消除 770 份文档审计中剩余的 9 个 1:N 悬空映射；全量标脏回归 0 失败。
- modified:
  - `src/renderer/src/components/workbench/markdownSourceMap.ts; .memory/KNOWLEDGE.md; SESSION_LOG.md`

### 10:32 | Codex

- done: 补强工作台 Markdown 复合块回写：为 1:N 块内节点保存载入基线，只有真实内容变化才拆组；完成源码、类型、lint、构建和隔离回写回归验证，并恢复论文文件到 HEAD。
- modified:
  - `src/renderer/src/components/workbench/markdownSourceMap.ts; src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx; .memory/INDEX.md; .memory/KNOWLEDGE.md; SESSION_LOG.md`

### 10:30 | Codex

- done: Gemini Deep Research Canvas 导出菜单注入「存为文档」菜单项
- context: 画布导出菜单懒渲染 mat-mdc-menu-panel，MutationObserver 检测到菜单出现就 clone gem-menu-item[value=copy] 改成 mc-save-note/存为文档/note_add icon 插到 copy 前；点击回传原生 copy 项坐标，渲染层 sendMouseClick 真实点击 → 轮询剪贴板 → Turndown → saveReplyAsNewMarkdown
- decision: 复用现有 Deep Research 复制提取链路而非 DOM 爬取，菜单项用 clone 真实 GEM-MENU-ITEM 保样式一致
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: Gemini Canvas 标题在 .markdown h1 而非 toolbar；菜单项是 GEM-MENU-ITEM 自定义元素 role=menuitem 非 button

### 10:29 | Codex

- done: 修复工作台 Markdown 增量拼装在 1 个源码块对应多个 Lexical 顶层节点时的重复回写：数量不等的对齐区间整体降为复合块，避免原文与未绑定节点双重输出。
- modified:
  - `src/renderer/src/components/workbench/markdownSourceMap.ts`
- lesson(promoted): Markdown Source Map 的 Patience 对齐在节点数与源码块数不等时不能做贪心 1:1 前后缀匹配；否则未绑定的额外 Lexical 节点会在增量拼装时与整块 raw 重复输出，导致文件在每次载入后持续膨胀。

### 10:08 | Codex

- done: Git Gutter 预览模式色条从左侧移至右侧：WorkbenchGitGutterPlugin 按 [data-workbench-article] 正文右缘 +8px 计算 barLeft 存入 positions，渲染 left: pos.left，CSS 移除固定 left:10px
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitGutterPlugin.tsx src/renderer/src/assets/index.css`

### 10:05 | Codex

- done: 工作空间 Git 历史改为提交 DAG + SVG 泳道树形图
- context: 现有历史面板直接展示 git log --graph ASCII，单分支只有一列星号，分叉时提交文字列宽会漂移。
- decision: 主进程返回完整 hash、父提交和引用，渲染层按 input/output swimlanes 计算布局；不引入图形依赖，不继续解析 ASCII graph。
- added:
  - `src/renderer/src/components/workbench/GitHistoryGraph.tsx`
  - `src/renderer/src/utils/gitGraphLayout.ts`
- modified:
  - `src/main/services/gitService.ts`
  - `src/shared/types/workbench.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- unresolved: 桌面窗口的实际视觉验收尚未完成：开发态启动时已有 MultiChat 实例占用单实例锁，需重启应用后检查分叉、合并和深色模式表现。

### 10:04 | Codex

- done: Git Gutter 修复审查发现的缺陷：预览模式 markers 重构为 GitGutterPlugin 自包含响应式链路（订阅 baseline/content + 250ms 防抖重扫 + patience 对齐）；focus/renameNode 补 refreshGitBaseline；CM lineMarkerChange 恒 true 修复 reconfigure 不刷新；删除指示器改锚行上方+git-also-deleted 组合标记；Frontmatter 对比双侧 LF 归一化；MAX_DIFF_STEPS 降 5000+worker try/catch 兜底；baseline 行数缓存
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitGutterPlugin.tsx src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx src/renderer/src/components/workbench/WorkbenchEditor.tsx src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx src/renderer/src/components/workbench/markdownSourceMap.ts src/renderer/src/utils/gitDiff.ts src/renderer/src/utils/gitDiff.worker.ts src/renderer/src/hooks/useGitLineDiff.ts src/renderer/src/store/workbenchStore.ts src/renderer/src/assets/index.css`
- lesson: CodeMirror gutter 的 lineMarkerChange 在 Compartment.reconfigure 触发的 update 中必须返回 true，docChanged/viewportChanged 均为 false 会让新 marker 静默不生效；Myers diff trace 每层 Int32Array(2*max+1) 峰值内存 O(max*D)，maxSteps 必须与行数联动或严格 cap
- unresolved: 预览模式需在 pnpm dev 实测：编辑后块标记更新、CRLF frontmatter 不误标、外部 git 操作后标记刷新

### 09:56 | Codex

- done: 实现工作台 Git 行内/块级变更标记（Git Gutter）：主进程 getFileBaseline 走 Index :0: 基准（cat-file -s 探大小熔断 1MiB、NUL 二进制检测），IPC workbench:git-baseline；渲染层 gitBaseline 单文件缓存 + seq 防竞态；Myers 行 Diff（FNV-1a 哈希）+ 熔断（1MiB/2万行/单行1万/5万步）+ >4000行 Web Worker；代码/文本查看与编辑 + HTML 源码行号 data-* 属性伪元素标记；Markdown 源码迁移 CodeMirror 6 原生 gutter（根治软折行错位+虚拟滚动）；Markdown 预览按 markdownSourceMap 块行号投影外挂覆盖层；FrontmatterPanel 左侧修改色条；保存后 1s 节流刷新 gitStatus；commit/pull/merge 成功后重拉基准
- decision: 对齐 VSCode QuickDiff 以 Git Index(:0:)为基准：未跟踪/冲突/unborn 不画标记；WorkbenchSourceEditor 按方案迁移至 CodeMirror 6 复用已有依赖，无新增生产依赖
- added:
  - `src/renderer/src/utils/gitDiff.ts src/renderer/src/utils/gitDiff.worker.ts src/renderer/src/hooks/useGitLineDiff.ts src/renderer/src/components/workbench/WorkbenchGitGutterPlugin.tsx`
- modified:
  - `src/shared/types/workbench.ts src/main/services/gitService.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/src/store/workbenchStore.ts src/renderer/src/components/workbench/WorkbenchCodePreview.tsx src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx src/renderer/src/components/workbench/WorkbenchEditor.tsx src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx src/renderer/src/components/workbench/markdownSourceMap.ts src/renderer/src/components/workbench/FrontmatterPanel.tsx src/renderer/src/assets/index.css`
- unresolved: 需在 pnpm dev 实测：CRLF 无误报、打字 250ms 防抖、commit 后标记清除、大文件熔断、Lexical 拖拽手柄与标注兼容

### 09:52 | Antigravity

- done: 版本管理面板：变更文件可点击打开并同步导航高亮；新增改动/历史双标签页，历史标签页展示 Git 图形化提交日志
- added:
  - `src/shared/types/workbench.ts(GitLogLine)`
- modified:
  - `src/main/services/gitService.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 09:36 | Antigravity

- done: Refine SettingsPage back button, top spacing, and revert ModelOrderCard to top-header single-column layout
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/SettingsPage.tsx`

### 09:34 | Antigravity

- done: 编写工作台 Git Gutter 变更标记开发与性能内存审视文档
- decision: 对标业界常规：未跟踪文件仅保留文件树 U 徽标不在编辑器内全篇标绿，工作区编辑器默认对比 Git Index (:0:)，采用单活动文件基准缓存与 1MiB/20000行熔断防止内存与主线程卡顿
- added:
  - `docs/workbench-git-gutter-design.md`

### 09:32 | codex

- done: 调整设置页顶栏与侧栏视觉：设置页隐藏多AI/工作台/设置/历史入口，标题栏改为返回主页；移除标题副说明；底部品牌改为 MultiChat。
- context: UI 改动按 DESIGN.md token，仅调整设置页相关链路。验证通过：eslint、tsc web、pnpm run build；未进行桌面截图验收。
- decision: 设置页返回入口统一放在标题栏，移除侧栏重复返回按钮；从总结页进入设置时仍按 settingsReturnPage 显示返回总结页。
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/SettingsPage.tsx`
  - `src/renderer/src/App.tsx`

### 09:30 | Antigravity

- done: 完成 auto/bypass 模式安全审查并落地近期加固方案：修复 AST/bash/policy 多项 P1 绕过、P2 竞态与文案透传、P3 误拦，补充应用凭据目录保护与 UI 三模式描述
- decision: 近期保留应用层 AST 边界（Auto 放宽普通跨区读、严守 workspace 写与凭据拦截；Bypass 仅受 HARD_DENY 与 protectedRoots 约束并纳入应用 auth.json/Partitions 目录）；OS 级 workspace-write 沙箱留待后续引入。
- added:
  - `src/main/services/commandAnalyzer/externalCommandGate.ts`
- modified:
  - `src/main/services/commandAnalyzer/powershellAstHelper.ts`
  - `src/main/services/commandAnalyzer/psAstAnalyzer.ts`
  - `src/main/services/commandAnalyzer/bashAnalyzer.ts`
  - `src/main/services/permissionPolicy.ts`
  - `src/main/services/PermissionEngine.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
- lesson(promoted): PowerShell AST 结构化字段必须直接从 Helper 序列化输出，避免在 Node 侧对 200 字符截断文本做正则猜测；且 AST/segment 判定返回 readOnly:false 时绝对不能再被旧正则 readOnlyPowerShell 或 simpleCommand 翻案。
- unresolved: 真实 Electron dev 界面中的人工端到端交互回归需重启 pnpm run dev 后触发验证。

### 09:27 | Antigravity

- done: Optimize SettingsPage layout, simplify descriptions, and unify Agent settings UI
- modified:
  - `src/renderer/src/pages/SettingsPage.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSkillsSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSettingsDialog.tsx`
- lesson: Keep 1D ordered dropdown settings as vertical single-column lists rather than 2D grids to avoid order ambiguity; pair a side metadata column inside the card to prevent wide empty rows

### 09:19 | Antigravity

- done: 独立审阅并优化工作台 Markdown 源码保真方案，落地 P0 噪声隔离/文件信封保真与 P1 Lexical 同源块级 Source Map、局部序列化及 250ms 防抖冲刷
- decision: 放弃 Command 白名单与外部 remark-parse 依赖，改为 Lexical 同源块扫描 + Anchor-LCS 局部兜底 + prevEditorState 单块基线懒缓存 + 250ms 防抖与显式 flushMarkdownSync
- added:
  - `src/renderer/src/components/workbench/markdownSourceMap.ts`
- modified:
  - `docs/workbench-markdown-source-fidelity-fix.md`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTableCellResizerPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/App.tsx`
- unresolved: 需在 pnpm run dev 桌面端手动验证富文本编辑、IME 组合输入、标注创建、待确认 AI 插入、拖拽块及 Undo/Redo 端到端交互

### 09:13 | Antigravity

- done: 界面与模式改为仅该区块两列布局，模型列表改为纯拖拽排序并支持显隐联动与生图/深度研究图标展示，任务与导图模型选择器仅同步显隐不展示能力图标
- modified:
  - `src/renderer/src/pages/SettingsPage.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 08:57 | Antigravity

- done: 移除设置页全部二级弹窗，将模式排序、模型排序、Agent配置与认证、提示词编辑/删除确认、数据恢复预览均内联到设置页中完成
- modified:
  - `src/renderer/src/pages/SettingsPage.tsx`
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/CliIntegrationSection.tsx`
- removed:
  - `src/renderer/src/components/ModelOrderModal.tsx`
  - `src/renderer/src/components/ProductModeOrderModal.tsx`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`

### 08:52 | Antigravity

- done: 重构设置页为二级页面，采用透明背景侧边栏导航与连续内容区滚动联动
- added:
  - `src/renderer/src/pages/SettingsPage.tsx`
- modified:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/store/appStore.ts`
- removed:
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 00:55 | Codex

- done: Agent 会话支持重命名：新增 agent:rename-session IPC + renameSession（活跃会话走 setSessionName，磁盘会话用 SessionManager 追加 session_info）；历史抽屉与 Agent 卡片历史弹层加铅笔入口复用 RenameModal；listSessions 已透传 name，store 处理 session_info_changed 同步标题
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson: pi 的会话命名就是 appendSessionInfo 写 session_info 条目（非消息、不进 LLM 上下文），listAll 会读 name；磁盘会话直接 SessionManager.open().appendSessionInfo() 即可持久化，无需起完整 AgentSession

### 00:44 | Codex

- done: Agent 侧边栏顶部居中显示当前对话标题
- context: 标题取 AgentSessionSummary.title（首轮 message_end 后生成），sessions 在 agent_end 时刷新，无需额外拉取；小字号 text-label + text-secondary，绝对定位居中，pointer-events-none 不挡按钮
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 00:44 | Codex

- done: 保留 HR 分隔线用户原始写法（---/***/___），修复导出统一变 *** 的问题
- added:
  - `src/renderer/src/components/workbench/WorkbenchHorizontalRuleNode.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 00:29 | Codex

- done: 命令安全 AST 化改造：新增 commandAnalyzer/ 目录（powershellAstHelper+psAstAnalyzer+bashAnalyzer），permissionPolicy/PermissionEngine/AgentSessionService 接入 AST 判定；截图 PowerShell 案例 readOnly=true 修复。独立 worker 验收发现 2 个 P1（bash -lc 合并 flag 绕过、.prop= 属性赋值漏拦）已修复；P2（analyzer=null fallback 区分、helper dispose 清理链）已补。pnpm lint+build+typecheck 全过
- context: auto 模式 PowerShell  只读命令误拦；方案=PS 官方 AST helper（内联 -Command）+ bash shell-quote 递归下钻 + .NET 静态方法白名单；文档 docs/command-safety-ast-plan.md
- decision: helper 不落盘 ps1 文件；analyzer=null 时允许 isSafeShellCommand fallback（helper 挂）但 readOnly=false 不 fallback（明确判危险）；convertfrom-json 不进只读词表；dispose() 链: AgentSessionService→PermissionEngine→cachedHelper
- added:
  - `src/main/services/commandAnalyzer/powershellAstHelper.ts;src/main/services/commandAnalyzer/psAstAnalyzer.ts;src/main/services/commandAnalyzer/bashAnalyzer.ts`
- modified:
  - `src/main/services/permissionPolicy.ts;src/main/services/PermissionEngine.ts;src/main/services/AgentSessionService.ts`
- lesson: PowerShell AST [type]::method 调用节点是 InvokeMemberExpressionAst 不是 TypeExpressionAst;[System.Predicate[T]] 不能带变量类型参数,scriptblock 直接传 FindAll 即可;bash 合并 flag -lc/-ic 会绕过独立 -c 匹配,必须正则识别
- unresolved: scripts/_tmp_build 目录壳子还在（Remove-Item 被拦）；真实 Electron dev 环境手动验收矩阵还没跑——文档 §7 用例需要在 pnpm dev 里实际走一遍

### 00:28 | Codex

- done: HTML 渲染预览加刷新按钮
- context: Workbench HTML 渲染模式 iframe 只在挂载时打时间戳，外部改文件后无法手动刷新
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 00:16 | Codex

- done: WorkPhaseBlock 已完成耗时改为 Xm Ys 格式（<60s 仅显示秒，整分钟不补 0s）
- modified:
  - `src/renderer/src/components/workbench/agent/WorkPhaseBlock.tsx`

### 00:15 | Codex

- done: 撰写命令安全 AST 化改造方案 docs/command-safety-ast-plan.md，独立 worker 审查后按 4 个 P1 + 3 个 P2 修订（analyzeCommand 签名、helper 内联 -Command、scriptblock 递归语义、quote-state 配平、ExpandableStringExpressionAst、convertfrom-json 移出词表）
- context: auto 模式 PowerShell  只读命令误拦；方案 = PS 官方 AST helper + bash shell-quote 递归下钻 + .NET 静态方法白名单
- decision: helper 用内联 -Command 单行脚本不落盘 ps1；convertfrom-json 不进只读词表（gadget 风险）；AST 可用时 isSafeShellCommand 仅作对照不参与判定
- added:
  - `docs/command-safety-ast-plan.md`

### 00:12 | Codex

- done: 文件树 Git 徽标改为仅末尾标记，取消文件名/图标着色
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 00:11 | Codex

- done: 删除 AgentContextMeter tooltip 中的'点击查看详情'提示
- modified:
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`

### 00:06 | Codex

- done: 工作台文件树按 VSCode 风格显示 Git 状态徽标（M/U/D/R/!）与文件名着色，目录聚合后代最高优先级状态
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

## 2026-11-24

### 23:59 | Codex

- done: 将 Agent model picker 及相关代码中的'思考深度'统一更名为'思考强度'（AgentModelPicker footer/不支持提示、AgentComposer 注释与 tooltip）
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 23:42 | Codex

- done: Agent 供应商停用开关、常用模型集与思考档位真实值回读
- context: 用户要求模型设置里供应商可停用、可配置常用模型集置顶展示；并质疑 7 档思考滑块是否真实
- decision: 停用/常用模型集持久化到 electron-store（agent_disabled_providers/agent_favorite_models），不经 models.json；snapshot 携带 favorites 与每模型 thinkingLevels，picker 常用栏置顶+禁用组跳过
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/shared/types/agentRuntime.ts`
- lesson: getActiveModelInfo 无会话时曾 fallback 固定 7 档思考档位；正确做法是按 model.thinkingLevelMap 复现 pi getSupportedThinkingLevels 规则（null=不支持，xhigh/max opt-in），SWE-2 实为 medium/high/max 3 档

### 22:56 | Codex

- done: 修复文件发送到 agent 侧边栏后，删除 chip/@ 再发同一文件被吞的 bug
- decision: 删除 seenUploadRegistry 黑名单机制；mentionFile 自身的 attachments+@token 双重判重已足够处理回声，registry 引入永久拦截副作用
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
- lesson: 按会话 key 的'已发送'登记器容易把'用户撤销后的合法重发'误判为回声；判重应该基于当前 UI 事实（attachments/composerInput）而不是历史事件登记

### 22:56 | Codex

- done: 代码预览顶部栏在左侧栏收起时补一个展开按钮
- context: WorkbenchCodePreview 顶部栏在 isLeftCollapsed 时无展开入口
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 22:52 | Codex

- done: 修复双 AI 侧栏模式下手动拖拽左/右分割条与窗口缩放仍可把右栏压缩过窄的问题
- context: 用户反馈开启双栏后仍能手动压缩到非常窄
- decision: 将双栏右栏最小宽度 RIGHT_PANE_DUAL_MIN 设为 640（每栏 320），主窗口双栏最小宽度 MAIN_MIN_WIDTH_DUAL_AI 提到 1360（并按屏幕 workArea.width 钳制），并在 clampRightPaneWidth/getRightPaneMaxWidth/setLeftPaneWidth/toggleLeftCollapse/openAiSidebar2/resize 全链路按 isAiSidebar2Open 动态保留双栏下限
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
- lesson: 只抬高 openAiSidebar2 的初始宽度不够，clampRightPaneWidth、setLeftPaneWidth、toggleLeftCollapse、resize 与 CSS maxWidth 都会反向挤压双栏；且 Tailwind 动态类名 min-w-[\px] 不会被 JIT 编译，必须用 inline style 才能真正生效

### 22:41 | Codex

- done: 修复双 AI 侧栏过窄+关不掉：根因是 rightPaneWidth 持久化单栏值 300，双栏两实例 flex:1 各分 150px；openAiSidebar2 把右栏容器抬到 RIGHT_PANE_DUAL_MIN=600，closeAiSidebar2 收回单栏上限，初始化恢复双栏时同样补齐 600；主实例双栏按钮改为 toggle（isAiSidebar2Open 时关闭）
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/main/ipcHandlers.ts`
- lesson: 工作台右栏 rightPaneWidth 是整个容器宽而非单栏宽，双 AI 并排时两栏 flex:1 共享该值；开双栏必须把容器宽抬到每栏下限之和，否则下限再高的窗口 minWidth 也救不了 150px 竖排。store 的 getRightPaneMaxWidth 内部读 isAiSidebar2Open，调整顺序必须先 set 状态再算上限

### 22:33 | Codex

- done: 双侧 AI 侧栏模式下动态抬高主窗口最小宽度：新增 setMainWindowDualAiMinWidth（单栏 1100/双栏 1340），store-set 挂钩 workbench_isAiSidebar2Open，新增 window-set-dual-ai-min-width IPC 供初始化同步，窗口过窄时自动回宽并钳在工作区内
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson: 主窗口最小宽度需要随工作台侧栏组合动态变化时，不要改固定 minWidth 常量，而是 setMinimumSize 动态调整 + 持久化 key 的 store-set 联动 + 初始化显式同步通道，三条路径缺一不可（切换、启动恢复、运行时变更）

### 22:28 | Antigravity

- done: 统一 AI 侧边栏 Agent 卡片右上角操作按钮间距与尺寸规范
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 22:11 | Codex

- done: web-ai-mode-design.md 终审收敛：4调研+5审核worker交叉修订，修正registerApiProvider注入/configured判据/会话抢占硬约束/transcript归属/搜索生图口径等6处，终审确认可交付
- decision: 终审确认路线A registerApiProvider为最小侵入正路；平台会话抢占升级为共享per-platform锁硬约束；transcript归Pi SessionManager不落streamFn
- modified:
  - `docs/web-ai-mode-design.md`
- unresolved: 各平台实际可选模型清单随套餐灰度变动，需M1用pnpm dev webview注入generateListModelsScript逐站实测后再写死

### 22:10 | Codex

- done: 调研并输出工作台 Agent Web AI 模式开发方案：WAA 可迁移资产审计 + 五平台 DOM 缺口 + Pi registerApiProvider 分流架构 + 多 worker 交叉审核修订
- context: 用户要求为本地 Agent 新增免 API 的 Web AI 模式（登录网页版即可用），一期 GPT/Gemini/元宝/豆包/千问，复用侧边栏换运行内核，搜索生图沿用 WAA
- decision: 采纳路线A：registerApiProvider({api:'web',streamSimple:WebAiStreamFn}) 挂进 ModelRegistry，createAgentSession 不动；否决路线B（上游分叉 AgentRuntimeBackend）
- added:
  - `docs/web-ai-mode-design.md`
- lesson: Pi 自定义 api 的最小注入点是 registerApiProvider 而非给 createAgentSession 传 agent；登录态过滤必须在 buildProviders 投影层做，getAvailableSnapshot 只看 configured 不看网页登录态

### 21:52 | Codex

- done: 供应商设置：magpie与自定义供应商支持编辑端点baseUrl；override写入models.json并refresh生效
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/shared/types/agentRuntime.ts`

### 21:46 | Codex

- done: chip 与输入框 @token 双向同步 + 修复上传去重误报：removeAttachment/clearAttachments 同步 removeFileMention 清输入框；setComposerInput 按 extractMentionTokens+mentionTokenMatchesPath 反向对账附件；全部重复(回声)静默吞掉、部分新鲜才提示
- context: agent composer chip sync dedup toast
- modified:
  - `src/renderer/src/components/workbench/agent/filePathUtils.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: 去重提示要区分'全部重复(同事件回声)'与'部分重复(真新增)'：全部命中时静默 return，部分命中才 toast；输入框 @token 与 attachments 互为镜像，任何一侧的删除都要同步到另一侧

### 21:45 | Antigravity

- done: 优化历史记录抽屉(HistoryDrawer)视觉尺寸，对齐DESIGN.md规范将标题、搜索框、Tab与元信息收敛至text-body/text-label/text-caption语义token，缩减padding与图标尺寸
- context: 用户反馈历史记录侧边栏整体UI偏大；排查发现标题因缺省字号继承了全局body的17px，Header为p-6，卡片内边距及多模型头像(24px)过大
- decision: 严格复用DESIGN.md的7档字号token(text-body 14px、text-label 12px、text-caption 11px、text-title 19px、text-tiny 10px)，Header收敛至p-4，卡片调整至p-3，头像调为20px(h-5 w-5)，保持w-[500px]抽屉宽度同时提升信息密度
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`

### 21:44 | Codex

- done: Agent配置弹窗供应商模型列表默认收起，点击展开/收起，修复全展开卡死
- modified:
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`

### 21:43 | Codex

- done: 工作台 Agent 输入框支持直接粘贴图片：textarea onPaste 捕获 image/* 剪贴板项转 dataUrl 存入新 imageAttachments，输入框上方显示 12x12 缩略图可删除；发送时经 IPC 传 images[] 给主进程，AgentSessionService 走 pi 原生 prompt({images}) 通道；用户气泡上方渲染 message.content 中 image parts（本地 dataUrl/会话恢复 base64 统一归一化）；空文本仅图片也可发送（给 pi 传空格兜底）
- context: pi AgentSession.prompt 原生支持 images: ImageContent[]（base64+mimeType），粘贴路径与文件附件分离：图片走 imageAttachments 独立通道不拼 @path
- decision: 图片以 dataUrl 存 zustand 内存态不落临时文件，发送时剥前缀传纯 base64；用户消息气泡在正文上方渲染 image parts，会话恢复时 convertPiContentParts 把 pi 的 image part 归一化为 dataUrl
- modified:
  - `src/renderer/src/types/agent.ts`
  - `src/preload/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 21:41 | Codex

- done: 修复上传去重误报：sidebar 双实例(ai/ai2)共享同一 window 事件导致同一次拖入被二次处理并提示'重复的文件已跳过'；引入跨实例 seenUploadRegistry 按 sessionId/cwd 登记，发送后 prompt 统一清空
- context: workbench dual-sidebar upload dedup toast false-positive
- modified:
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/agent/filePathUtils.ts`
- lesson: 工作台 AI 侧边栏在页面上挂载了主/副两个实例（instanceKey=ai/ai2），均监听同一全局 window CustomEvent；实例内 dedupe 无法识别对方已处理，跨实例副作用必须用模块级共享 registry 才能去重

### 21:36 | Antigravity

- done: 工作台 Agent 对话历史浮层体验升级：提升整体字阶（标题14px、副信息11px）、加宽至320px，将滚动列表最大高度限制扩大至 380px，彻底摆脱局促感
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 21:34 | Codex

- done: 弹窗次级按钮补边框，避免与面板底色融为一体
- modified:
  - `src/renderer/src/components/ConfirmModal.tsx`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`
- lesson: ConfirmModal 取消按钮曾漏写 border，bg-sidebar(半透明白) 叠在 bg-app(#fcfdff) 上几乎不可见；次按钮规范是 border + bg-sidebar + hover:bg-gray-100

### 21:28 | Antigravity

- done: 工作台 Agent 对话历史浮层增加方案二紧凑搜索栏：Header 下方内嵌轻量搜索行，支持即时过滤当前与外部工作区会话并带一键清空
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`

### 21:26 | Codex

- done: 工作台发文件到 AI 去重：webview 侧批内按绝对路径去重+上传前按文件名过滤页面已有附件；Agent 侧 mentionFile/addAttachment/prompt 三处按归一化路径+@token 去重，重复触发不再重复插入或附加
- context: workbench uploadFilesToCurrentModel, agentSessionStore mentionFile/prompt, generateFileUploadStateScript
- modified:
  - `src/renderer/src/components/workbench/agent/filePathUtils.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: webview 侧上传前用 generateFileUploadStateScript 传文件名数组做 matched/missing 检测；Agent 侧 token 同时可能以相对路径或绝对路径出现，需用同一归一化规则判定

### 21:22 | Codex

- done: 修复 mention chip 点击后文件树不高亮：根因是 toWorkspaceRelative 用 normalizePath(lowercase) 后的路径 slice 返回，openFile 设的 activeFilePath 是全小写，与文件树 node.path 的真实大小写严格相等比较失败。双修：(1) filePathUtils.toWorkspaceRelative 改用原始路径切片保留大小写，normalizePath 仅作前缀比较；(2) AttachmentChips/InlineMentionText 点击时先用 findTreePathByAbs 在 fileTree 按大小写不敏感匹配真实 node.path，命中则 openFile(node.path)，未命中再回退 toWorkspaceRelative/revealFile，覆盖 token 大小写与磁盘不一致的边缘场景
- modified:
  - `src/renderer/src/components/workbench/agent/filePathUtils.ts`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
- lesson: 路径比较函数如果顺手做了 lowercase 归一，返回值不能直接当事实路径用——openFile/activeFilePath 与文件树 node.path 是严格字符串相等匹配，大小写差异会让高亮静默失效；凡是要回写进 store 的路径都必须保留原始大小写，归一只能用于比较

### 21:22 | Codex

- done: 追加消息从 followUp 改为 steer（下一个 turn 边界注入，不再等 final answer 跑完）
- context: 用户实测发现追加要等上一轮 final answer 输出完才执行
- decision: pi-agent-core agent-loop.js: steering 每轮 turn_end 后 poll、下个 LLM 请求前注入（回合边界插队）；followUp 要等内层 loop 完全退出才 poll（agent 决定停下才注入）。用户预期'追加'=steer 语义
- modified:
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/main/services/AgentSessionService.ts`
- lesson: pi steer vs followUp：steer=turn 边界插队（不打断流式），followUp=整个 run 结束才投递。交互式'追加要求'场景用 steer

### 21:22 | Antigravity

- done: 微调工作台 Agent 对话历史浮层：将标题前对话 icon 调整为与文字保持一致的灰度色，去除任何彩色高亮
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 21:19 | Antigravity

- done: 优化 Agent 底层对话框选中流光效果：弱化外层与羽化光晕强度，降低扩散半径，放缓旋转与呼吸节奏
- decision: 保留全色系 Conic-gradient 流光特征，但将弥散外层 blur 从 12px 收紧至 8px、inset 从 -5px 降至 -3px；将峰值透明度从 0.85 压低至 0.38（暗色 0.46），旋转与呼吸周期分别拉长至 6.5s 和 4.5s，使光效克制、柔和且不抢占视觉焦点
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 21:19 | Antigravity

- done: 工作台 Agent 对话历史浮层重构：无点无描边极简、其他工作区默认折叠并固定在 Footer、强调新对话按钮并在标题前增加对话图标
- context: 优化工作台 Agent 历史浮层交互与视觉体验
- decision: 浮层设为 flex-col，主体滚动当前工作区，其他工作区折叠收拢并固定在底部 Footer，标题前放置 chat 图标，新对话按钮使用强调微按钮
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 21:17 | Codex

- done: 把用户消息气泡里的 @path 引用从外部 chip 改成内联 chip：AttachmentChips.tsx 新增 InlineMentionText 组件，splitMentionSegments 把 userText 切成 text/mention 段、@token 就地渲染成可点击 chip（含文件名+图标，蓝底白字样式），同 resolved 路径的重复 token（prompt 自动拼接的 @absPath）按重复吞掉并 trim 尾部孤白；AgentCard user 气泡用 InlineMentionText 替换纯文本渲染，删除外部 AttachmentChips 块与 extractMentionedFilePaths
- decision: token 末尾定位剥掉 TRAILING_PUNCT_RE 后的 @token 本体（如 @path，的逗号归普通文本），避免标点被吞或 chip 名带标点
- modified:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 21:05 | Codex

- done: Agent 消息气泡显示拖入/@ 引用的文件附件：新增 store.mentionFile 统一'addAttachment+插入@token'，WorkbenchAiSidebar local-agent 上传分支与 AgentComposer '+'按钮改用之；AgentComposer 容器新增 onDrop/onDragOver 处理工作区节点/外部文件/text-plain 三种 payload；AttachmentChips 新增 extractMentionedFilePaths(text,cwd) 从 userText 提取 @path token 并按 cwd 归一去重；AgentCard user 气泡下方渲染 AttachmentChips（恢复会话/旧消息同样生效，无需改 IPC）；顺手修复 AttachmentChips INLINE_PATH_RE 的 no-useless-escape lint 报错
- decision: user 消息附件不落 AgentMessage 字段：attachments 已通过 prompt 拼接的 @absPath 持久化进 pi text，气泡渲染端正则提取即可，新消息与 resume 恢复的旧消息走同一条链路
- modified:
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson: Agent 侧边栏有 z-40 全屏拖拽感应层，composer 上的 onDrop 实际不触发，真正入口是 WorkbenchAiSidebar.handleDrop→uploadFilesToCurrentModel 的 local-agent 分支；composer 仅作兜底

### 20:50 | Codex

- done: 修复 review worker 发现的队列逻辑 bug
- decision: 队列按 sessionId 隔离（Record）；主进程 prompt 兜底 isStreaming→followUp；queued user 按位置(最早 running)翻转不按文本；clearQueue 挪到 abort 成功之后；agent_end/agent_settled 兜底清 chip；LocalAgentEvent 联合类型替代 Record<string,unknown>
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 20:46 | Codex

- done: Agent 运行中追加要求（follow-up 队列）
- context: pi-coding-agent 原生支持 steer/followUp/clearQueue/queue_update；与 Codex/Claude Code/Cursor 的队列模型一致
- decision: 运行中 prompt 走 streamingBehavior='followUp' 排队；abort 时 clearQueue 把未投递文本经 queue_cleared 事件回填到 composer；queue_update 事件驱动 chip 展示
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 20:39 | Codex

- done: 修复工作台 Agent 历史对话菜单不显示正在跑的任务标注：fetchSessions 合并 isRunning 取后端快照与本地 runningSessionIds 并集并回填 set；agent_start/agent_end/auto_retry_end 事件即时同步 sessions 列表项 isRunning；打开历史菜单时主动 fetchSessions 刷新。
- modified:
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson(promoted): 列表项的运行态标注若同时存在'后端快照'和'事件驱动本地 set'两个来源，必须用并集合并，否则时序竞争会让标注丢失。

### 20:35 | Codex

- done: 修复工作台 image_gen 图生图上传失败：①paste 脚本在 textarea 命中时向并存 contenteditable 编辑器兜底派发；②AgentTaskService.execute 补开生图模式（generateEnableImageGenerationScript）
- modified:
  - `src/shared/utils/webviewScripts.ts;src/main/services/AgentTaskService.ts`
- lesson(promoted): AI 平台图片上传的 paste 合成事件只能落在 contenteditable/role=textbox 类编辑器上——命中纯 textarea 时 File 对象被静默丢弃；豆包 textarea 首选命中的是真实 textarea 而非并存 contenteditable，故图片根本未进编辑器。genImage 任务除产物捕获外还必须显式开生图模式（imageGeneration.steps），否则平台不会把附件当参考图。

### 20:31 | Codex

- done: 取消工作台 .multichat 硬编码隐藏并交由 .gitignore 控制（含非 Git 工作区兜底），为 .multichat 及其 image/mindmap/annotation 子目录增加专属图标
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/workbenchService.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 20:25 | Codex

- done: 附件Chip兜底增强：extractInlineFilePaths扫描正文任意位置绝对路径（反引号/句中/列表项均可），URL用lookbehind排除
- decision: 双层兜底：工具structuredContent为主，正文内联绝对路径兜底覆盖shell/脚本/忘加反引号场景
- modified:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 20:22 | Codex

- done: 附件Chip数据源收敛：只从工具结果收集，不再解析正文路径；提示词改为反引号标记不限位置
- decision: Chip可靠性优先：工具structuredContent驱动而非模型文本解析；反引号约定仅用于正文可读性，不作Chip数据源
- modified:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/main/extensions/systemPromptTrim.ts`
  - `src/main/services/imageGenTool.ts`
- lesson: 路径呈现要分层：正文汇报交给模型自然语言（反引号标记增强可读），打开附件交给工具数据驱动——两层解耦比要求模型输出特定格式更稳

### 20:17 | Codex

- done: 附件Chip去重：extractFilePaths返回cleanText剔除纯路径行，正文Markdown不再重复显示路径
- decision: Chip与正文职责分离：路径行只作Chip数据源不进Markdown渲染，复制按钮仍用原文保留完整文本
- modified:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 20:16 | Codex

- done: 修复工作台 Agent 对话流在多轮工具调用及命令审批间隙误触发已完成的问题
- decision: 将最新工作段的 isGroupRunning 与会话级 isRunning 及当前会话 pendingApprovals 绑定，并用 firstMsg.id 稳定工作段挂载键；在 agentSessionStore 同步 isRunning、忽略 willRetry 为 true 的中间 agent_end、补齐 auto_retry_end 兜底并修复 turn_end 先于 agent_end 置 complete 导致 turnDurationMs 漏记的问题
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
- unresolved: 需在 pnpm run dev 桌面端实际运行一次包含读文档与命令审批的多轮 Agent 任务做人工验收

### 20:15 | Codex

- done: 给工作台 image_gen 工具加 images 参数支持图生图/参考改图
- modified:
  - `src/main/services/imageGenTool.ts`

### 20:10 | Codex

- done: Agent最终回复附件Chips：路径文本提取+工具结果兜底，点击openFile/agentRevealFile；系统提示词追加File & Artifact Reporting约定
- decision: 不用结构化attachments块，改为渲染层从最终回复独占一行的路径提取+工具structuredContent兜底，降低对模型遵守度的依赖
- added:
  - `src/renderer/src/components/workbench/agent/AttachmentChips.tsx`
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/main/extensions/systemPromptTrim.ts`
  - `src/main/services/imageGenTool.ts`
- lesson: 提示词约定要轻：让模型继续自然语言汇报，把可点击化交给渲染层，比要求模型输出特定标签格式更稳

### 20:07 | Codex

- done: 修正工作台 image_gen 生图落盘位置：默认从应用数据目录改为会话工作区 .multichat/image/
- modified:
  - `src/main/services/imageGenTool.ts;src/main/services/AgentSessionService.ts;src/main/services/permissionPolicy.ts`
- lesson(promoted): image_gen 工具经 agentTaskService.submit 提交任务时未传 artifactDir，导致落盘回退到应用数据 .multichat/；把会话 cwd 透传为 artifactDir 即可让图片落到工作区。注意 artifactDir 是产物根（服务内自拼 /image、/results），应传 <cwd>/.multichat 而非 <cwd>/.multichat/image。

### 19:51 | Codex

- done: WorkPhaseBlock 默认收起：running 时不再自动展开（进度由标题 shimmer + 动态动作表达），完成后保持收起；加 userToggled ref 记住手动操作，状态变化不抢展开状态
- modified:
  - `src/renderer/src/components/workbench/agent/WorkPhaseBlock.tsx`

### 19:49 | Codex

- done: WorkPhaseBlock 标题行加单行截断：button 加 w-full，activity/已完成 span 加 min-w-0 flex-1 truncate，长 prompt/命令不再换行溢出
- modified:
  - `src/renderer/src/components/workbench/agent/WorkPhaseBlock.tsx`

### 19:46 | Codex

- done: work-group 合并逻辑回调：一个 user query 后所有连续 assistant 合并为一个组，组内 reasoning/tool-call/中间过渡 text 全部折叠进'思考中/已完成'，只有组内最后一个非空 text 外显为 final answer；中间过渡 text 用斜体灰字样式与 reasoning 同级；assistantText 改用 lastTextPart.text 保证复制到的是 final answer
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 19:40 | Codex

- done: 修复 work-group 分组边界：buildRenderItems 改为'含 text 的 assistant 收尾一段，前面 pending 的无文字工作并入该组'，每段模型文字独立结算'已完成 Ns'，不再整轮合并；组耗时改用段首消息 timestamp（turnDurationMs 仅留给本轮最后一组），修复中间段误算整轮耗时；text-shimmer 改 background-repeat:repeat-x + 亮带收窄（42-58%），渐变无限平铺保证任意 position 下文字都被覆盖，根治闪没
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/assets/index.css`
- lesson: text-shimmer 的 background-size:200% + position ±100% 在两端仍会让渐变半移出文字；稳态方案是 repeat-x 无限平铺 + 亮带只占中段，任意位置文字都被基色或亮带覆盖

### 19:20 | Codex

- done: WorkPhaseBlock 折叠标题改为动态动作：新增 activity prop，AgentCard 用 describeActivity 从最后一个进行中 part 生成中文动词短语（正在读取 xxx.md / 正在编辑 xxx / 正在运行 xxx / 正在搜索 xxx / 正在思考…）；等待首个 part 的间隙也走 WorkPhaseBlock 占位，保持 UI 一致
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/WorkPhaseBlock.tsx`

### 19:11 | Codex

- done: docs 段从精简一行改为彻底删除：before_agent_start 返回 forceSystemPrompt=event.systemPrompt 剥掉 docs 块
- decision: customSections 空值无法删段，改用 before_agent_start 返回 systemPrompt 走 forceSystemPrompt 投影路径
- modified:
  - `src/main/extensions/systemPromptTrim.ts`

### 19:09 | Codex

- done: 工作台 Agent 系统提示词优化：Miao 身份句强化(标注 pi 只是 harness)、web_search/image_gen snippet 去双前缀、新增 systemPromptTrim inline extension 把 pi docs 段精简成一行
- decision: 用 before_agent_start 的 systemPromptOptions.sections.docs 覆写精简 docs 段，保住 SDK 自动 tools/rules；不用 customPrompt 以免丢失三段
- added:
  - `src/main/extensions/systemPromptTrim.ts`
- modified:
  - `src/main/services/shell.ts`
  - `src/main/services/webSearchTool.ts`
  - `src/main/services/imageGenTool.ts`
  - `src/main/services/AgentSessionService.ts`

### 19:02 | Codex

- done: 工作台本地 Agent 系统提示词追加身份声明：助手名为 Miao（appendSystemPrompt，不改 pi harness preamble）
- decision: 用 appendSystemPrompt 注入身份而非替换 SDK preamble，保留 tools/rules/docs 段
- modified:
  - `src/main/services/shell.ts`
  - `src/main/services/AgentSessionService.ts`

### 19:00 | Codex

- done: 对话流文件定位链路：openFile 成功后自动展开祖先目录并复用 expandAncestorsOf action；WorkbenchFileTree 监听 activeFilePath scrollIntoView 跟随定位（修复修改摘要点击后侧边栏不高亮）；ToolGroup read/edit 工具行文件名改为可点击 button，经 toWorkspaceRelative 归一到 workspace 后 openFile，出界 fallback agentRevealFile；resolveAbsolute/toWorkspaceRelative/normalizePath 抽到 agent/filePathUtils.ts 共享
- added:
  - `src/renderer/src/components/workbench/agent/filePathUtils.ts`
- modified:
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson: Electron 文件树跟随定位要两步配合：store 层展开祖先目录（expandedFolderIds 存目录 posix path，id===path）+ 组件层 useEffect 对 activeFilePath 做 requestAnimationFrame 后的 scrollIntoView；只设高亮不展开父级会导致节点不可见

### 18:57 | Codex

- done: AgentCard 消息流按工作段分组渲染：连续 assistant 合并为 work-group，reasoning/tool-call 折叠进 WorkPhaseBlock（进行中'思考中' shimmer / 完成后'已完成 Xs' 自动收起），text 外显为 final answer；修复 shimmer 文字消失（background-size 250%/±200% 导致渐变移出容器 → 200%/±100%）；清理未使用 finalIsRunning；agent_end 兜底不再覆盖 aborted 状态
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/WorkPhaseBlock.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/main/services/AgentSessionService.ts`
- lesson: CSS text-shimmer 动画必须保证渐变覆盖整个动画周期：background-size 设 200% 且 background-position 仅在 ±100% 间往返，超过 200% 的位移会让渐变完全移出容器导致文字瞬间消失

### 18:54 | Codex

- done: 重构 Agent auto 模式权限策略：放开越界读，新增敏感文件(credential)检查，命令分 networkRead/networkWrite 分级，接入 shell-quote 结构化二次校验，收紧 always-allow 粒度到工具级，修复 git -C 路径提取与 looksReadOnlyCall 字段歧义
- decision: 越界读全模式放开（读不破坏）；敏感文件(.env/密钥/云凭据)单独设卡所有模式 ask；git pull/clone 归 networkWrite 需审批；always-allow 按实际工具名而非 * 存储
- modified:
  - `src/main/services/permissionPolicy.ts`
  - `src/main/services/PermissionEngine.ts`
- lesson: 白名单分段校验必须 fail-closed：shell-quote 未识别的 op 和 PS/bash 子表达式语法(@(,$(,反引号)一律拒绝，'分不出错≠安全'；git -c/-C 大小写敏感，不能统一 lower() 比较

### 18:48 | Codex

- done: 修复编辑文件后 ChangedFilesCard 不显示：persistFileChanges 异步落盘，renderer 在 turn_end/message_end 后立即 mount 卡片调 agentGetFileChanges，比 persist 快拿到 null 且 loadStartedRef 防重试。给 active 记 pendingFileChangePersist，getFileChanges 先 await（3s 超时兜底）
- modified:
  - `src/main/services/AgentSessionService.ts`

### 18:47 | Codex

- done: 按 worker 复核修复 cwd fallback：shellCustomTool 调用从 cwd ?? process.cwd() 改为 cwd && cwd.trim() ? cwd : process.cwd()，空字符串/纯空白 cwd 正确回落
- modified:
  - `src/main/services/AgentSessionService.ts`

### 18:44 | Codex

- done: 把 redactShellOutput 接入 agent 实际执行链路：AgentSessionService 新增 shellCustomTool() 通过 customTools 注册带自定义 BashOperations 的 powershell/bash 定义，覆盖 pi 内置实现，使 ShellTool.execute 的输出脱敏在真实工具调用上生效
- modified:
  - `src/main/services/AgentSessionService.ts`

### 18:44 | Codex

- done: 修复 message_end merge 回归：事件对 user/toolResult 也触发，会覆盖 assistant 消息内容（工具卡片消失、首行出现用户 query）。补 event.message?.role==='assistant' 守卫
- modified:
  - `src/renderer/src/store/agentSessionStore.ts`

### 18:39 | Codex

- done: 工作台对话流进行中态视觉统一为 text-shimmer 文字扫光：index.css 加 .text-shimmer（slate-400 基色+近白亮带，background-clip:text + background-position 动画），穿透子级用 -webkit-text-fill-color；ThinkingBlock/ToolItem/ToolGroup 去掉 Loader2 转圈改 shimmer；AgentCard 加两处'正在思考…'占位（assistant 已建但 content 空、user 已发出 assistant 未创建）；修复 message_end 不 merge content 导致 tool-call part 缺失→vacuous allToolsDone→提前 complete 的根因
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`

### 18:35 | Codex

- done: 按 worker 审核意见修复沙箱拦截：补 POSIX / 绝对路径形态防止越界读放行；redactShellOutput 改为关键字结尾整词匹配+补 PEM BLOCK 形态；ShellTool onData 改行级缓冲防止 chunk 边界泄露 secret 片段；删除无效的 SHELL_SCRIPT_TOOLS 死代码
- modified:
  - `src/main/services/permissionPolicy.ts src/main/services/redact.ts src/main/services/ShellTool.ts`

### 18:30 | Codex

- done: 把耗时统计从单条 assistant message.durationMs 改成「用户 query 发出 → 整轮 agent run 结束」的 turnDurationMs；UI 同步切换字段；resumeSession 用最近一条 user.timestamp → assistant.timestamp+durationMs 近似恢复
- modified:
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 18:27 | Codex

- done: 把 AgentCard 消息操作行的时间戳·用时从分支按钮后挪到复制按钮后
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 18:27 | Codex

- done: 优化 agent shell 沙箱拦截策略：修复 Get-ChildItem Env:/HKCU:/Cert: 等 PowerShell provider 被误当文件路径做边界检查的 bug；命令路径抽取改为只抽形如真实路径的 token；新增 redactShellOutput 对 shell 输出做 env/密钥脱敏（KV/表格/JWT/GitHub/AWS 等格式）
- modified:
  - `src/main/services/permissionPolicy.ts src/main/services/redact.ts src/main/services/ShellTool.ts src/main/services/AgentSessionService.ts`

### 18:26 | Codex

- done: 工作台Agent支持多并发会话运行：后端isRunning标记+前端runningSessionIds集合+历史列表转圈指示
- context: 工作台右侧Agent原本UI只支持单会话。本次改造让后端activeSessions天然支持多session并行的基础上，前端通过runningSessionIds集合追踪所有运行中session，新建会话不再阻塞旧会话，历史对话列表用转圈图标实时显示运行状态
- decision: 保留isRunning作为currentSessionId派生字段而非完全重构，最小化对现有组件的侵入；事件流按sessionId路由更新对应状态，非当前session的message事件仍被丢弃但running状态正确追踪
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson: Electron+Zustand架构下，把单值状态改成集合状态时，可以保留原字段作为当前选中项的派生视图，避免大面积重构组件层

### 18:20 | Codex

- done: 修复 agent_end 覆盖 abort/error 状态：只在 status==='running' 时才标 complete，保留 abort/error 终态不被覆盖
- modified:
  - `src/renderer/src/store/agentSessionStore.ts`

### 18:19 | Codex

- done: 在 AgentCard 对话流中给每轮最后一条 assistant 消息加时间戳+用时，显示在分支按钮后
- modified:
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson(promoted): pi 的 AssistantMessage/UserMessage 自带 timestamp(ms) 和 durationMs，message_start/message_update/message_end 事件与 resumeSession 的 rawData 都会携带，直接透传即可，不需要自己计时

### 18:18 | Codex

- done: 修复 ChangedFilesCard 每轮重复显示:session 级 index.json 单记录被所有 turn-final message 共享→加 turnIndex 绑定;main turn_start 按 state.messages 数 user 得 turn 序号写入 meta;renderer 每条 assistant 算 messageTurnIndex,卡片仅当 record.turnIndex===turnIndex 时渲染;旧记录无 turnIndex 走 allowLegacy 只在最后一条 turn-final 显示
- context: 用户截图:read 文件那一轮没改文件却也显示已修改1个文件卡片
- decision: turnIndex 用语义对齐:main 数 state.messages 里 user 数而非进程内计数器,保证 resume 后与 renderer 按 user 分隔的 turn 序号一致
- modified:
  - `"src/main/services/AgentSessionService.ts"`
  - `"src/renderer/src/components/workbench/AgentCard.tsx"`
  - `"src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx"`
  - `"src/shared/types/agentRuntime.ts"`
- lesson: pi-agent turn_start 时当前 turn 的 user message 已入 agent.state.messages;state.messages 不含 turn_start/turn_end 事件类型只含 user/assistant entry

### 18:17 | Codex

- done: 修复工作台对话流中工具等待期间 spinner 不显示的问题：pi 在 tool_execution_start 前就发 message_end，store 此前在 message_end 时无条件标 complete 导致 status 提前变 complete。改为 message_end 仅在消息内所有 tool-call 都有 result 时才标 complete；tool_execution_end 时若全部收齐也标 complete；新增 turn_end 兜底把 running 的 assistant 消息标 complete
- modified:
  - `src/renderer/src/store/agentSessionStore.ts`

### 18:13 | Codex

- done: 优化工作台对话流工具调用展示：web_search/image_gen/grep/find/ls 显示关键入参；write 工具用 args.content 合成 unified diff 复用 Diff 视图；单个工具调用时自动展开唯一结果
- modified:
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`

### 18:13 | Codex

- done: 修复 ChangedFilesCard：文件名重复展示(第二行改为仅在有目录时显示目录部分)；文件名可点击→openFile 在编辑区打开,workspace 外文件兜底 agentRevealFile 打开所在文件夹
- context: 用户反馈截图:自我介绍.md 文件名重复两行;期望点击文件直接在编辑区打开而非打开文件夹
- decision: 复用 workbenchStore.openFile 而非新 IPC;toWorkspaceRelative 统一处理绝对/相对路径转 ws 相对,外部文件 fallback reveal
- modified:
  - `src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`

### 18:07 | Codex

- done: 排查 Agent 文件修改卡片不显示：坏 index.json(files空/baseline空/target有值/无cwd)是旧构建产物写入，当前代码已修复 turn 事件乱序与 persist 逻辑；清理 7 处 fc-debug；persist 写 blob 失败时不再保留悬空 blobs 元数据
- context: ChangedFilesCard files.length===0 return null；用户对话 17:16 写入的 index.json 缺 cwd 字段=旧版代码产物
- decision: 用 turn_start 先 flush 半成品 tfc + tool_execution_end 同步捕获 tfc 闭包 + turn_end/agent_end 兜底 persist，应对 pi-agent 不 await 异步 listener 的事件乱序
- modified:
  - `src/main/services/AgentSessionService.ts`
- unresolved: 未在 dev 环境实测一次真实 agent 改文件抓 index.json 验证（需重启 dev 会打断用户）；shell 工具改文件不覆盖、agent:reveal-file 无路径白名单为遗留 minor

### 18:00 | Codex

- done: 修复web_search返回空结果：done态改用getResult()取reply
- modified:
  - `src/main/services/webSearchTool.ts`
- lesson: AgentTaskService.getView()不返回reply正文（只有replyChars），done态正文必须走getResult()；daemon waitForTaskView同样模式

### 17:53 | Codex

- done: 为工作台 Agent 注册 image_gen 工具，通过已登录 AI 平台触发原生 AI 生图能力并下载落盘到应用数据目录
- context: 沿用 web_search 工具同一思路：pi-coding-agent 的 customTools 扩展点 + typebox schema + AgentTaskService.submit/poll；平台挑选基于 capabilities() 的 imageGeneration+imageDownload 双标记
- decision: image_gen 在 permissionPolicy 中登记为 kind=read/paths=none 与 web_search 同级——产物落盘到应用数据目录 .multichat/image/，workspace 无副作用，default/auto 模式默认放行；chatglm/kimi 因仅 imageGeneration 无 imageDownload 被排除在 platform 枚举外（submit 会被 CAPABILITY_UNSUPPORTED 拦截）
- added:
  - `src/main/services/imageGenTool.ts`
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/permissionPolicy.ts`
- lesson: AgentTaskService.submit 的 genImage=true 与 deep_research 互斥；image_gen 必须用 mode='chat'。平台是否支持完整生图链路要看 imageDownload 而非 imageGeneration（前者覆盖下载点击适配）

### 17:50 | Codex

- done: 工作台Agent web_search工具注册（pi customTools+AgentTaskService）
- context: 用户要求把multichat cli搜索能力封装为工作台Agent侧边栏内置工具
- decision: 用pi内核customTools SDK扩展点而非MCP/skill；web_search登记为read类默认放行；typebox提为直接依赖解决运行时解析
- added:
  - `src/main/services/webSearchTool.ts`
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/permissionPolicy.ts`
  - `package.json`
- lesson: pi内核ToolDefinition经customTools字段注入createAgentSession；typebox是pi传递依赖但运行时经new Function逃逸bundler解析需提升为直接依赖

### 17:47 | Codex

- done: Agent 设置弹窗改定高 85vh，供应商模型列表默认全部展开，外层容器滚动
- modified:
  - `src/renderer/src/components/workbench/agent/AgentSettingsDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`

### 17:45 | Codex

- done: Agent 设置侧边栏提至第 2 项；排查并优化 Agent 设置弹窗卡顿；新增自定义 OpenAI 兼容网关接入
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/types/agent.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`

### 17:32 | Antigravity

- done: 优化 Agent 窗口视觉与动效：去除全屏动态色斑背景以规避 GPU 与内存开销，恢复浅色面板与轻量卡片；保留输入框聚焦双层羽化流光动效，并为未选中输入框增加精致微阴影与 hover 层次
- decision: 全屏大尺寸高斯模糊结合无限循环 translate 会持续占据合成器显存并导致整屏重绘；改用纯净浅色面板并将灵动动效局部收敛于输入框 focus-within，实现未输入时 0 性能损耗与点击时的主题色灵动流光兼得
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/assets/index.css`

### 17:32 | Antigravity

- done: 移除工作台模型下拉项 Agent 的 Active 标签，并将 Agent 对话流用户 query 气泡右上角圆角调整为 rounded-tr-sm
- context: 用户反馈：工作台模式下 Agent 选项后无需显示 active 标签；Agent 对话流中用户 query 气泡右上角圆角需改小以呈现对话气泡感
- decision: WebviewCard 下拉选项中移除 isLocalAgent 的 Active badge；AgentCard 中将无效的 rounded-tr-xs 修复为合法的 Tailwind rounded-tr-sm (2px)，使气泡右上角呈现精致的气泡导向角
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 17:23 | Antigravity

- done: 实现 Agent 窗口灵动极光流光背景、通透透明 Header、毛玻璃提示词卡片与极光羽化流光对话框
- context: 用户希望 Agent 窗口具有灵动的流光渐变背景与微交互，但保持简约与极简，去除刺目的粗描边，卡片升级为毛玻璃质感，严格保持原有 AI 回复及用户气泡样式不变
- decision: 采用双层极光羽化流光架构 (3px 贴身柔化羽化 + 12px 弥散流动气场) 消除粗黑硬边，Header 完全透明贯穿全窗口渐变，4 个快捷卡片重构为 Glassmorphism 毛玻璃
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 17:15 | Codex

- done: Agent 末尾增加文件变更卡片（已修改 N 个文件，可折叠、可撤销/恢复），runtime 通过 tool_execution_start/end 事件抓 baseline/target 快照（mtime+size+sha1），撤销/恢复前做完整性校验，冲突时按钮置灰不解释
- context: 用户面向办公人群，diff 卡片改成卡片形态 + 撤销带二次确认 + 恢复同样做外部修改校验
- decision: 快照存 agent-sessions/{id}/file-changes/{sha1}.{before,after} blob + index.json；用 tool_execution_start 事件（args 完整）抓 baseline、tool_execution_end 抓 target；toolCallId→filePath 映射存 ActiveSessionEntry.pendingToolFiles
- modified:
  - `src/shared/types/agentRuntime.ts; src/main/services/AgentSessionService.ts; src/main/ipcHandlers.ts; src/preload/index.ts; src/renderer/src/components/workbench/AgentCard.tsx; src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx`
- lesson: pi-agent 的 tool_execution_end 事件没有 args 字段，只有 toolCallId，想拿文件路径必须用 start 事件时缓存映射；beforeToolCall hook 是同步权限校验不是异步文件快照点

### 17:09 | Codex

- done: 修复工作台 Agent 历史跨工作区点击无反应：handleSelectSession 拦截跨工作区会话弹 ConfirmModal；先 setWorkspaceFolder 再 resumeSession，resumeAfterSwitchRef 阻断 effect1 竞态；setWorkspaceFolder 改为返回 switched/cancelled/failed 区分取消与失败；目录失效降级只读回看（agentSessionStore.foreignReview 共享标志防双侧栏清空），回看态 cwd 对齐自动退出；列表项加 folder 图标标注非当前工作区
- decision: 回看豁免标志放 agentSessionStore 而非组件 state：双侧栏复用 AgentCard 时共享同一标志，避免一侧回看被另一侧的 cwd 同步 effect 清空
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson(promoted): AgentCard 顶部两个 cwd/workspacePath 同步 effect 是'点击无反应'根因：resume 后 currentCwd≠workspacePath 触发 newSession 清空；跨工作区恢复必须保证顺序=先切工作区→effect 重置 draft→再 resume，且需 ref 标记防止 effect1 与 resumeSession 的 React 调度竞态

### 16:21 | Codex

- done: 重构 Agent 上下文压缩为持久化分层：L1 tool_result 写入前截断 + L2 turn_end context_edit 持久掩码（percent 回落自我解除）+ L3 fileIndex 程序拼接 pinned
- decision: L2 从 transformContext(每请求改投影、percent 永不回落、全量扫死循环) 改为 turn_end 返回 context_edit entry(appendContextEdit 持久化进投影)——这是业界 clear_tool_uses 的 pi 等价物，清了就清了；maskResultChars(4000)独立于 L1 hardCap(8000)避免死代码；fileIndex 程序拼接 summary+fileIndex 而非靠模型复述；toolResultUseModel 摘要并发 Promise.all
- modified:
  - `src/main/extensions/contextCompression.ts`
  - `src/shared/types/agentCompression.ts`
- unresolved: dumpText fire-and-forget(模型立即 read 可能拿半截);keepRecentToolCalls 按调用条数非轮数(与业界 keep:{tool_uses}一致);turn_end 时 percent>=70 每轮 getEntries 全量扫(可接受)

### 16:11 | Codex

- done: 按业界分层重构 Agent 上下文压缩：L1 tool_result 写入前截断（零 cache 损耗）+ L2 context 仅 token 水位触发观测掩码（keepRecent 保鲜）+ L3 session_before_compact 摘要带文件索引不变量
- context: 业界 context-editing 共识：不按轮数触发（token 水位为主）、改历史前缀击穿 KV-Cache 故 L1 用写入前截断零损耗、tool_result 是主要压缩目标（可 re-fetch）、tool_call 入参仅截超大载荷保留索引、保鲜最近 3-5 个 tool_result
- decision: 三层归位：L1 tool_result 入库前截断不动历史前缀零 cache 损耗；L2 context 用 ctx.getContextUsage().percent>=triggerPercent 真实 token 水位门控（替代字符估算），keepRecentToolCalls 保鲜，excludeTools 豁免；L3 摘要 details 落 readFiles/modifiedFiles 作为跨压缩存活的外置文件索引锚点防级联失真；tool_call 事件弃用（改的是执行参数非模型视图）
- modified:
  - `src/main/extensions/contextCompression.ts`
  - `src/shared/types/agentCompression.ts`
  - `docs/agent-context-compression-plan.md`
- unresolved: L2 内 dumpText 仍 fire-and-forget；Sub-agent 隔离/Repo Map 常驻属更上游架构未实现；compression 配置改动对活会话需重建生效

### 14:33 | Codex

- done: 实现 Agent 上下文压缩：tool_call 入参裁剪 + tool_result 结果截断/可选模型摘要 + session_before_compact 自定义摘要（当前模型） + 手动 compact IPC/UI + auto-compaction 开关与状态
- context: pi-coding-agent SDK 自带 auto-compaction 与 tool_call/tool_result/context/session_before_compact 事件钩子；压缩模型默认 ctx.model（当前模型）；压缩提示词复用 pi 内置 structured summary 模板；SDK 原生 compaction.* 走 settingsManager，自定义 agent_compression 走 electron-store
- decision: 用 InlineExtension(extensionFactories) 接入压缩而非自研引擎（SDK 既定接入点，tool_call/tool_result 事件只在 ExtensionRunner emit）；压缩失败一律 return undefined 回退 SDK 默认；toolResultUseModel 默认关避免串行 LLM 开销；uuidv7 换成 crypto.randomUUID 消除对 pi-ai 运行时依赖（顺带绕开 tmp/pi-src 环境污染导致的 build 失败）
- added:
  - `src/main/extensions/contextCompression.ts`
  - `src/shared/types/agentCompression.ts`
  - `docs/agent-context-compression-plan.md`
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/AgentResourceLoader.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/agentRuntime.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`
- unresolved: tool_call 的 dumpText 为 fire-and-forget，极端情况下原文可能未写完占位符已生效（best-effort）；compression.* 配置改动对已有 session 需重建生效；auto-compaction 的 reserveTokens/keepRecentTokens 当前用 SDK 默认+settings.json，未做 UI 配置项

### 14:22 | Codex

- done: 修复 LaTeX 公式粘贴被双转义：新增 equationPaste.ts 切块+续行符净化，WorkbenchEquationPastePlugin 用其直接建公式节点绕过 markdown import
- added:
  - `src/renderer/src/components/workbench/equationPaste.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEquationPastePlugin.tsx`
- lesson: @lexical/markdown 0.53 的 import 会按 CommonMark 处理行尾 \ 为硬换行并执行 unescapeText，export 时对 \ 做 \\ 转义；LaTeX 片段必须绕过 markdown import 直接建节点

### 14:17 | Codex

- done: 提交今日工作台改动：按功能拆 4 个 commit（agent rewind/fork + 命名统一、文件树复制写系统剪贴板、LaTeX 公式体系+标题上限/文案统一、Agent 空状态 2x2 卡片与 agent.png 头像），SESSION_LOG 单独提交；scratch/mock-agent-test/根级 assets/agent-avatar.png 判定为过程文件与重复资源未入库
- modified:
  - `SESSION_LOG.md`

### 14:13 | Codex

- done: 修复 + 号菜单公式编辑弹层位置漂移：弹层是 fixed 定位，锚点必须用 pickerPosition（点击时计算的页面坐标），不能用 menuRef.getBoundingClientRect()（会跑到视口左上）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`

### 14:13 | Codex

- done: 修复 MD 编辑器 + 号菜单：公式块点击后改为先弹 LaTeX 编辑弹层，保存后再插入节点（不再插入空节点导致无反应）；列表宽度从固定 w-56 改为 w-max 自适应；notes 图标由 StickyNote 换成 Pilcrow
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 14:05 | Antigravity

- done: 将 AgentCard 空白页优化为现代 2x2 微卡片布局，增大字号去除冗余说明，改为填入提示词交互
- decision: 采用 2x2 网格与 ArrowUpRight 悬浮微动效，移除卡片冗长二次副标题，点击卡片改为填入输入框并聚焦光标
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 13:54 | Codex

- done: Markdown 编辑器新增 LaTeX 公式插入入口（富文本/源码工具栏+拖拽菜单），统一公式编辑弹层支持 KaTeX 实时预览与清除，修复 function 图标缺失回退警示符号
- added:
  - `src/renderer/src/components/workbench/WorkbenchEquationEditor.tsx`
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEquationNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`

### 13:54 | Antigravity

- done: 简化工作台 Agent 空白页设计，对齐知识工作者与文档写作场景
- decision: 去除开发者专用技术术语（如开发 Agent、AGENTS.md、类型构建等），采用极简 Hero 问候与 4 类高频知识办公微卡片，并智能感知当前打开文档
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 13:37 | Codex

- done: 会话/总结/Agent 会话标题统一加 48 字符上限：normalizeHistory 落盘截断、RenameModal 输入框 maxLength、appStore addHistory/updateHistory 本地 state 同步截断、AgentSessionService listSessions title 截断、列表索引 slice(0,200) 收敛为同一常量
- modified:
  - `src/main/api/historyManager.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/components/RenameModal.tsx`
  - `src/renderer/src/store/appStore.ts`

### 13:32 | Codex

- done: 删除所有和agent相关的本地字样
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`

### 13:23 | Codex

- done: 调研 pi-coding-agent 撤回/fork 机制并实现 GUI：用户气泡编辑撤回一步(navigateTree)+复制；助手末条加分支(createBranchedSession)+复制；仅撤回最近一条用户消息，代码文件不回滚
- context: pi SDK navigateTree 仅移动 leaf 指针实现分支撤回，不回滚文件；fork 走 createBranchedSession 生成新 jsonl；GUI 只允许撤回最后一条用户消息以保稳定
- added:
  - `src/main/services/AgentSessionService.ts(rewindToUserMessage/forkSessionFromUserMessage/listBranchUserEntries)`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 13:16 | Codex

- done: LaTeX 公式节点右键菜单：KaTeX decorator 接管 contextmenu，弹出 fixed 浮层菜单（向 AI 提问/解释此公式/语言润色/提取关键要点 + 编辑公式/复制 LaTeX/删除公式），复制时按 inline/block 分别写 \$...\$ / \$\$...\$\$，菜单含视口边界检测、Esc/外点/失焦关闭，样式对齐 workbench 菜单
- context: 公式是 Lexical decorator，浏览器选区取不到源码，全局 CustomContextMenu 也无公式入口；onContextMenu 中 e.stopPropagation 阻止全局菜单接管
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEquationNode.tsx`
- unresolved: pnpm run build 失败：react-diff-view 在 package.json 已声明但 node_modules 未安装（既有环境问题，需 pnpm install）

### 13:14 | Codex

- done: 移除本地 Agent 附件添加成功后的 toast（已添加附件/已添加 N 个文件到本地 Agent）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 13:12 | Codex

- done: 移除选中内容向本地 Agent 提问时的'已注入提示词到本地 Agent'info toast
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 13:09 | Codex

- done: 工具调用展开区去卡片套卡片：统一单容器 header/内容/footer 三段结构
- context: 原展开区外层 rounded-lg border bg-slate-50 p-3 卡片里再嵌 rounded border bg-white diff 卡片，用户要去掉嵌套感
- decision: 保留外层容器作 header(标签+复制)/内容区/footer(状态) 三段；内层 diff 去边框直接渲染
- modified:
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`

### 13:06 | Antigravity

- done: 去除模式选择弹窗顶部的 Header，并将弹窗宽度收窄为 w-72，优化内部图标与文字间距，使其更加紧凑精致
- modified:
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 13:01 | Antigravity

- done: 统一模式选择、上下文窗口与选模型弹窗的卡片骨架与视觉语言，将模式选择宽度扩展为320px实现说明单行完整容纳并补齐Header与Check选中标记
- modified:
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`

### 13:00 | Codex

- done: 思考过程卡片改为可点击展开/收起，展开态完整显示多行文本
- context: 原先 truncate 单行截断，长思考只能 hover 看 title tooltip；用户要求完整展示
- decision: 保持极简风格：不加标题栏/折叠框，整行作为 button 切换 truncate ↔ whitespace-pre-wrap
- modified:
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`

### 12:58 | Codex

- done: 修复 agent 无 shell 工具可用的问题：pi 默认激活工具只含 read/bash/edit/write，powershell 不在默认集内；项目原 excludeTools 在 Windows 把 bash 排除后，powershell 又从未被激活，导致模型无任何命令执行能力。新增 shellToolModifiers() 返回 ['+powershell']，createAgentSession 传入 tools 修饰符，在默认集上追加 powershell
- context: 用户在 agent 会话中要求统计 markdown 数量，模型回复'没有列目录或执行命令的工具'
- decision: 通过 tools:['+powershell'] 显式激活平台 shell 工具，而不是依赖 defaultTools 设置文件
- modified:
  - `src/main/services/shell.ts`
  - `src/main/services/AgentSessionService.ts`
- lesson: pi SDK 默认工具集是 read/bash/edit/write，powershell 是独立工具名、Windows 平台需用 +powershell 修饰符显式启用；excludedShellTools 只能二选一减一个，不能依赖默认集自动包含平台 shell

### 12:58 | Codex

- done: 修复 Agent 工具卡片：编辑文件展开后不显示编辑内容的问题
- context: pi-coding-agent 的 edit 工具 result.details = { diff, patch, firstChangedLine }，patch 是标准 unified diff，diff 是带行号的展示用文本。原代码只看 args.diff 或 outputText，导致 diff 没有被解析渲染
- decision: diff 提取顺序 result.details.patch > args.diff > outputText；parseDiff 失败时把 details.diff 作为 pre 文本兜底
- modified:
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`

### 12:55 | Antigravity

- done: 统一输入框弹窗组件为 AgentPopover，合并模型选择与思考深度为单个底栏 Selector 并在弹窗 Footer 中通过 Slider 调节思考深度，弹窗精确定位在选择器上方
- added:
  - `src/renderer/src/components/workbench/agent/AgentPopover.tsx`
- modified:
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`

### 12:54 | Codex

- done: 修复 Agent 会话列表标题始终显示'新会话'的问题：wireSession 订阅里在首个 user message_end 时提取文本写入 active.title；listSessions 合并时若活跃条目无 title 则回退到磁盘 firstMessage
- context: 历史列表中每个会话都显示'新会话'，用户无法区分
- decision: 在 message_end(role=user) 时一次性写入 title，避免重复覆盖；listSessions 增加磁盘 title 兜底，覆盖 resume 后未发新消息的场景
- modified:
  - `src/main/services/AgentSessionService.ts`

### 12:47 | Antigravity

- done: Simplified AgentContextMeter into an SVG progress circle representing context usage, opened detail popover on click instead of hover
- decision: Replaced text string 'tokens/window · percent' with an SVG progress ring; removed hover trigger so menu only shows on explicit click
- modified:
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`

### 12:32 | Antigravity

- done: Resolved tool output leakage into message stream by associating toolResult messages to toolCall and enhanced extractToolResultText; simplified thinking blocks into clean single-line italic text per user request
- decision: Extracted tool output text recursively from content arrays and injected toolResult messages into tool-call.result while filtering standalone toolResult messages from the chat stream; stripped collapsible card wrapper from ThinkingBlock to display a pure single-line text
- modified:
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 12:21 | Antigravity

- done: Adopted minimalist tool group UI per reference screenshot, embedded command outputs inside collapsed tool items, and enlarged agent sidebar UI to 14px body typography
- decision: Combined consecutive tool calls into a single minimalist ToolGroup row defaulted to collapsed; embedded outputs directly inside individual tool items upon expansion; removed standalone terminal cards from markdown body; boosted chat font to 14px body
- added:
  - `src/renderer/src/components/workbench/agent/ToolGroup.tsx`
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`
  - `src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`

### 12:19 | Codex

- done: 把 magpieProvider.ts 重构成通用的 CustomGatewayProvider：fetchModels/persistModels/loadStoredModels 走标准 OpenAI /v1/models 映射，富字段（native_endpoints/reasoning_levels/pricing/context_window）默认就有，enrichModel 留作异构网关的可选增强；magpie 变成一个配置实例 MAGPIE_PROVIDER，AgentSessionService 的 ensure/applyCatalog/refresh 全部走通用层
- modified:
  - `src/main/services/customGatewayProvider.ts`
  - `src/main/services/AgentSessionService.ts`
- removed:
  - `src/main/services/magpieProvider.ts`
- lesson: 通用 OpenAI 兼容网关 provider 的关键不在 fetch 而在模型→api adapter 的映射：标准 /v1/models 只有 id，需要 native_endpoints 才能区分 anthropic-messages/openai-responses/openai-completions；没有这个字段的网关只能默认 completions

### 12:00 | Codex

- done: magpie 网关模型目录自动获取：改走 fetch+registerProvider 重注册投影，绕开 pi composer refreshedExtensionModels 不生效的问题；启动 seed 用 models-store.json 持久化缓存，后台 fetch 实时拉取 211 项；picker 刷新按钮走同一链路
- context: 本地 magpie 网关 http://127.0.0.1:3425 聚合多厂商模型，应用里此前只有一个 fallback 模型
- modified:
  - `src/main/services/magpieProvider.ts`
  - `src/main/services/AgentSessionService.ts`
  - `src/main/index.ts`
- lesson: pi-coding-agent 的 extension refreshModels 返回值通过 composer 闭包 refreshedExtensionModels 投影，但 registerProvider({models}) 重注册时 validateExtensionProvider 校验的是裸入参而非 merge 后 effective —— 缺 baseUrl 会抛 'baseUrl is required'；可靠的目录更新路径是 fetch 后 registerProvider 重注册（recompose 直接投影 extension.models），持久化自己读写 models-store.json

### 11:45 | Antigravity

- done: Upgrade agent sidebar UI to assistant-ui visual standard with strict native light design system alignment
- decision: Adopted Native Light assistant-ui styling with dedicated MarkdownRenderer to format unescaped terminal outputs, cardify markdown tables, and enhance thinking blocks without interfering with concurrent Codex backend development
- added:
  - `src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx`
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`
  - `src/renderer/src/components/workbench/agent/BashToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/EditToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ReadToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ToolFallback.tsx`
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSkillsSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSettingsDialog.tsx`

### 11:43 | Codex

- done: magpie 供应商接入 /v1/models 动态模型目录：新增 src/main/services/magpieProvider.ts（fetchMagpieModels + refreshModels hook + endpoint→api 映射 + thinkingLevelMap 翻译），AgentSessionService.ensureMagpieProvider 改为始终注册并后台拉取真实目录；anthropic-messages 模型单独用网关根地址修复 /v1/v1/messages 404；网关在线时目录从 1 个模型扩到 211 个（openai-completions 184 / anthropic-messages 24 / openai-responses 3），离线时回退到静态 swe-2
- context: 用户问为什么接的网关只有一个模型；根因是 ensureLocalDevinProvider 硬编码单个 devin/swe-2，没有调用网关 /v1/models
- added:
  - `src/main/services/magpieProvider.ts`
- modified:
  - `src/main/services/AgentSessionService.ts`
- lesson: Pi extension refreshModels 的返回值不是直接进 getModels，而是经 composer 的 applyExtension 投影后作为 extension.models 生效；同时必须 publish({persist}) 才能把目录写进 models-store.json 供离线阶段复用。anthropic-messages API 的 baseUrl 必须是不含 /v1 的网关根地址，Anthropic SDK 会自己拼 /v1/messages，带 /v1 会变成 /v1/v1/messages 404。magpie 网关 /v1/models 每条记录用 native_endpoints 标出原生协议，映射规则：/v1/messages→anthropic-messages、/v1/responses→openai-responses、其他→openai-completions；reasoning_levels 可精确转成 thinkingLevelMap（不支持的档位置 null，pi 自动 clamp），'none' 要映射到 off。
- unresolved: trae-cn 部分模型上游本身报 502/429 是网关侧配额/路由问题，不是本项目模型目录问题

### 11:11 | codex

- done: 认证进行中的供应商卡片增加可点击入口，关闭认证弹窗后可重新打开同一操作
- modified:
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`

### 11:10 | codex

- done: 收尾验证：独立配置弹窗挂到 Layout、thinking 无会话时持久化、context meter 真实响应显示 6.6k/262k·3%
- context: 在 pnpm run dev 下通过 CDP 实际点击抽屉入口、切换 tab、打开模型 Picker、切换 thinking、发送真实请求
- decision: AgentContextMeter 优先用 sessionStatus，回退 snapshot；新会话零用量不渲染
- modified:
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `docs/agent-provider-model-context-design.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 11:06 | codex

- done: 将 Agent 供应商配置改为独立弹窗，抽屉仅保留入口；补齐模型 Picker、thinking 档位、context 用量与供应商认证
- context: 基于 Pi ModelRuntime 复用供应商与模型目录；弹窗挂到 Layout，Picker 空状态也能打开
- decision: 抽屉不铺开供应商列表，配置统一进 AgentSettingsDialog；认证弹窗用 portal 避免被滚动容器裁剪
- added:
  - `src/shared/types/agentRuntime.ts`
  - `src/main/services/ProviderAuthController.ts`
  - `src/main/services/redact.ts`
  - `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`
  - `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`
  - `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSettingsDialog.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSkillsSettings.tsx`
  - `src/renderer/src/components/workbench/agent/AgentThinkingPicker.tsx`
  - `src/renderer/src/store/agentSettingsDialogStore.ts`
  - `docs/agent-provider-model-context-design.md`
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/types/agent.ts`
  - `docs/DOCS_INDEX.md`
- removed:
  - `src/renderer/src/components/workbench/agent/AgentSettingsModal.tsx`
- lesson(promoted): Pi 的 getContextUsage() 在 compaction 后返回 tokens/percent 为 null，UI 必须区分未知与 0；registerProvider 的可用性刷新是异步的，init 里要 await refresh 才能让首个快照正确

### 10:59 | Codex

- done: 验收修复：空会话过滤改用 SessionInfo.messageCount===0（firstMessage 空会话时为占位串非空）；handleAgentEvent 改严格 sessionId 匹配防草稿态吸收其他会话事件
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
- lesson: pi-coding-agent 的 SessionInfo.firstMessage 零消息时是占位字符串 '(no messages)' 而非空串，过滤空会话必须用 messageCount

### 10:54 | Codex

- done: Agent 会话历史支持删除（ConfirmModal 确认）+ AgentComposer @ 文件提及补全 + 新会话改草稿态懒创建避免空会话堆积
- decision: 新建会话改为本地草稿态，首次 prompt 才经 createSession 落后端；listSessions 过滤零消息会话
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
- lesson: Pi AgentSessionService 的 session 删除需先 abort+unsubscribe+dispose，再扫 sessionsDir 按 header.id 匹配删 .jsonl

### 10:45 | Codex

- done: 调整权限模式图标：默认->Pencil、自动->Play、全放行->TriangleAlert(红色警示语义)，picker 触发按钮同步显示当前模式图标
- modified:
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 10:42 | Codex

- done: 优化 AgentComposer 权限模式选择弹窗 UI：为默认/自动/全放行三种模式分别添加 ShieldCheck/Zap/FastForward 图标，移除选中项后的'当前'文字标记（选中态已由左侧高亮背景表达）
- modified:
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 10:24 | codex

- done: 补充开发文档：核对 login 持久化路径与 models.json 刷新语义，修正设置抽屉现状与改动文件清单
- context: 文档落盘后核对 Pi ModelRuntime 源码，确认 login 经 CredentialStore.modify 落盘，refresh 会重新加载 models.json
- decision: 自定义 provider 必须写 models.json 再 refresh；registerProvider 仅内存，不能作为持久化手段；设置抽屉已有入口应替换而非新增
- modified:
  - `docs/agent-provider-model-context-design.md`

### 10:23 | codex

- done: 调研 Pi Agent 供应商、模型选择与上下文用量实现，编写并落盘完整开发方案
- context: MultiChat-agent-sidebar 的 Agent 配置入口在 AgentComposer/AgentSettingsModal，Provider 列表硬编码 9 项，baseUrl 未生效，缺少 thinking 与 context 展示
- decision: 直接复用 Pi 1.6.0 ModelRuntime 作为唯一 provider/model/auth 适配层，移植 mu-agent 的认证状态机，不自研 adapter；Agent provider 配置与总结链路 apiConfig 保持隔离
- added:
  - `docs/agent-provider-model-context-design.md`
- modified:
  - `docs/DOCS_INDEX.md`
- lesson: Pi 的 getContextUsage() 在 compaction 后可能返回 tokens:null，UI 必须区分未知与 0；context 占用用 usage.totalTokens，不要自行用 input+output 重算
- unresolved: 方案尚未实施；自定义端点写入 models.json 列为第二阶段

### 10:15 | Codex

- done: 设置抽屉新增'本地 Agent'入口，打开 AgentSettingsModal 集中管理：模型凭证、权限模式(default/auto/bypass)、全局 Skills 目录勾选+自定义路径、命令放行名单；弹窗改为可滚动 max-h-85vh
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSettingsModal.tsx`

### 10:03 | Codex

- done: GUI 支持 /skill 调用：IPC 暴露 skills 列表 + Composer 斜杠自动补全
- decision: 复用 pi DefaultResourceLoader 的 skill 发现(SKILL.md/.agents/.claude/agentDir)，listSkills 按 cwd 临时建 loader 实时取；GUI 用斜杠建议菜单填 /skill:name
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`

### 09:59 | Codex

- done: 实现 Agent shell 平台挂载+UTF-8+权限决策内核；独立 worker 审核通过并修复 readonly 语义回归与流式 O(n2)
- decision: shell 按平台 excludeTools 二选一+环境提示词；UTF-8 用 SDK UTF8_OUTPUT_PREFIX+decodeCommandOutput ANSI 兜底；权限内核移植 mu decidePermission，三档 default/auto/bypass+readonly 兼容档
- added:
  - `src/main/services/shell.ts`
  - `src/main/services/encoding.ts`
  - `src/main/services/permissionPolicy.ts`
  - `docs/agent-shell-encoding-design.md`
- modified:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/AgentResourceLoader.ts`
  - `src/main/services/ShellTool.ts`
  - `src/main/services/PermissionEngine.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `package.json`
- lesson: mu 0.85→pi 1.6 移植可用 beforeToolCall 钩子替代 pi.on(tool_call)；PowerShell [Console]::OutputEncoding=UTF8 前缀能把嵌套 cmd 输出一并转 UTF-8，是 Windows 中文乱码根治点

### 09:49 | Codex

- done: 调研 mu-agent/WebAI-to-API 与业界做法，实测 Windows UTF-8/shell 行为，产出 Agent shell+编码+权限设计文档
- decision: shell 按平台二选一 excludeTools + 环境提示词；UTF-8 用 SDK 前缀 + WebAI decodeCommandOutput 兜底；权限内核迁移 mu decidePermission，模式收敛 default/auto/bypass
- added:
  - `docs/agent-shell-encoding-design.md`

### 09:48 | Codex

- done: 将 main 合并入 worktree 的 codex/agent-sidebar：解决依赖清单、会话日志与 package-lock 冲突，迁移 pnpm 锁文件，验证类型检查、lint、构建与 dev 启动
- context: main 引入 pnpm 10 与依赖分层调整，worktree 同时在开发 Agent 侧边栏与工作台正文宽度/公式粘贴功能
- decision: dependencies 仅保留主进程外部化运行时依赖（pi-coding-agent、electron-store、monio-napi、shell-quote），渲染层依赖移入 devDependencies；移除已无引用的 assistant-ui 依赖；删除 package-lock.json 并重生成 pnpm-lock.yaml
- modified:
  - `package.json`
  - `AGENTS.md`
  - `README.md`
  - `SESSION_LOG.md`
  - `docs/BUILD_GUIDE.md`
  - `.gitignore`
  - `pnpm-lock.yaml`
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- removed:
  - `package-lock.json`
- lesson(promoted): pnpm install 迁移 npm 生成的 node_modules 前必须先关闭正在运行的 Electron dev 实例，否则重命名 node_modules/electron 会报 EPERM
- unresolved: Agent 侧边栏与工作台的合并后 UI 交互仍需在桌面窗口中手动走查

### 11:22 | Codex

- done: 按 impeccable skill 的 document 模式生成 DESIGN.md(frontmatter token + 8 canonical section),AGENTS.md 的 UI 设计规范小节收敛为一行指针做渐进式披露
- decision: DESIGN.md 用 impeccable 官方 spec(YAML frontmatter + 固定 8 节顺序);AGENTS.md 不再承载具体 token 表,只声明'涉及前端 UI 时读 DESIGN.md'
- added:
  - `DESIGN.md`
- modified:
  - `AGENTS.md`

### 11:15 | Codex

- done: 全量收敛任意字号:text-[Npx] 119处批量映射到 tiny/caption/label/body/body-lg/title/title-lg,37文件;AppIcon 上 size 冗余的 text-[Npx] 类删除而非换名;顺手修 ConversationMindmapPanel 4处 buttonclassName 拼写错误导致样式从未生效的存量 bug
- decision: text-[17-20px] 是 AppIcon 冗余类,size prop 已控尺寸,删除比换 text-title 名更正;text-[0.9em] 是 inline code 相对单位合法保留;text-[#hex] 是颜色值误报不动
- modified:
  - `37个 tsx 文件(components/、components/workbench/、pages/)含全部 text-[Npx] 处`
  - `ConversationMindmapPanel.tsx buttonClassName 修复`
- unresolved: text-xs/sm/base/lg 原生 Tailwind 刻度(66文件)未迁,合法但非语义 token,继续渐进收敛

### 11:10 | Codex

- done: 将设计 token 规范与统一 Modal 用法写入 AGENTS.md 的 UI 设计规范小节,完成遗漏检查(剩余 z-[90-130] 与 text-[10/11px] 均为合规特例,不需收敛)
- decision: z-[90]/[95]/[110]/[120]/[130] 及 ConversationMindmapPanel 内嵌 modal 属合规特例(需压在 modal 之上或有自定义焦点圈),不纳入统一 token;WorkspaceSettings 内 text-[10/11px] 即 tiny/caption 语义,合法保留
- modified:
  - `AGENTS.md`

### 11:03 | Codex

- done: 建立设计 token 体系(fontSize/zIndex),新建统一 ui/Modal 组件并迁移全部 6 个对话框,ConfirmModal 字体收敛、WorkbenchWorkspaceSettings 升一档
- decision: 字号 token 以已认可区域 SettingsDrawer 的 text-sm(14px)为 body 基准,新增 tiny/caption/label/body/body-lg/title/title-lg;图标保留 19px(FileTree 认可值);Modal 分 solid/glass 两变体覆盖现有两类弹窗
- added:
  - `src/renderer/src/components/ui/Modal.tsx`
- modified:
  - `tailwind.config.js`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/ConfirmModal.tsx`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`
  - `src/renderer/src/components/RenameModal.tsx`
  - `src/renderer/src/components/ModelOrderModal.tsx`
  - `src/renderer/src/components/ProductModeOrderModal.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditLeaveDialog.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- unresolved: 其余组件任意字号/图标 size 渐进收敛,未全局替换;ConversationMindmapPanel/NoteCaptureModal/CliAgentHint 等定制浮层未迁 Modal;dark 色板未纳入本次

### 10:28 | Codex

- done: 双开 AI 侧边栏时主栏'再开一个'按钮高亮，与快捷窗口 toggle 行为对齐
- context: 用户要求双开时主侧边栏按钮显示激活态
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 10:27 | Codex

- done: 修正左侧工作区栏展开按钮尺寸：WorkbenchEditor/WorkbenchToolbar/WorkbenchSourceToolbar 中 left_panel_open 从 16 改为 20；回退右侧 AI 栏图标误调
- context: 用户要求调大左侧工作区栏展开图标，之前误改右侧 AI 栏
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx;src/renderer/src/components/workbench/WorkbenchToolbar.tsx;src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx;src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 10:26 | Codex

- done: 主侧边栏'再开一个'图标从 20 调到 22
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 10:24 | Codex

- done: 调整 AI 侧边栏头部按钮：第二栏关闭改 X 图标，主栏'再开一个'改用更粗的 view_column_2 图标与其他 header 按钮对齐
- context: 用户反馈第二栏关闭按钮应为叉，主栏打开按钮视觉偏小需与编辑栏图标一致
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 10:17 | Codex

- done: 修复工作台空状态(未打开文档)下左栏收起后无展开入口的交互bug：在空状态页左上角补充与工具栏一致的'展开侧边栏'悬浮按钮，仅在 isLeftCollapsed 时显示
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: WorkbenchEditor 在无活动文档时提前 return，导致 WorkbenchToolbar/SourceToolbar 中的展开侧边栏按钮不渲染；涉及多种渲染分支的组件中，布局恢复入口需在每个分支独立可用

### 10:16 | Codex

- done: 修正工作台顶部按钮语义：窗口顶栏按钮负责关闭整个 AI 侧边栏（含第二栏），侧边栏内部按钮负责再开一个；双栏时最大宽度翻倍
- context: 用户反馈顶部按钮无法关闭侧边栏，且双栏需要更大宽度
- decision: 顶栏按钮聚合控制两个 AI 栏的开关；getRightPaneMaxWidth 在 isAiSidebar2Open 时 tierMax*2，仍受窗口剩余空间约束
- modified:
  - `src/renderer/src/components/Layout.tsx;src/renderer/src/store/workbenchStore.ts`

### 10:11 | Codex

- done: 工作台 AI 侧边栏支持双实例：顶部按钮改为再开一个侧边栏，支持在 A 栏选中内容右键到 B 栏提问
- context: 用户要求把工作台 AI 侧边栏顶部按钮从收起改为再打开一个侧边栏，复用现有组件，实现跨栏选中提问
- decision: 复用 WorkbenchAiSidebar 为实例化组件，用 wcId 注册表识别来源，通过 target 字段路由 insert-prompt 到指定栏
- added:
  - `无`
- modified:
  - `src/main/webviewManager.ts;src/preload/index.ts;src/renderer/src/components/Layout.tsx;src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx;src/renderer/src/components/workbench/workbenchAiEvents.ts;src/renderer/src/pages/MainPage.tsx;src/renderer/src/pages/QuickPage.tsx;src/renderer/src/pages/WorkbenchPage.tsx;src/renderer/src/store/workbenchStore.ts`
- unresolved: 需在 pnpm run dev 中实际验证双栏并排、跨栏右键提问、关闭第二栏

### 09:36 | Codex

- done: 从 worktree 恢复依赖与打包改动到 main：补 4 个幽灵依赖、迁移 pnpm、修复 postinstall 二进制下载、删除 package-lock.json
- decision: dependencies 只保留主进程运行时依赖 electron-store 与 monio-napi，渲染层依赖移到 devDependencies；postinstall 补 install-electron 解决 electron@42 无 postinstall 导致 pnpm 装完无二进制
- added:
  - `pnpm-lock.yaml`
- modified:
  - `package.json`
  - `AGENTS.md`
  - `README.md`
  - `docs/BUILD_GUIDE.md`
  - `.gitignore`
- removed:
  - `package-lock.json`
- lesson: electron@42.5.1 的 package.json 没有 scripts 字段，二进制是懒加载的；pnpm install 后 dist 为空，必须显式跑 install-electron，否则 pnpm run dev 报 Electron uninstall
- unresolved: worktree 中 16 个 workbench 改动已恢复但未提交；需确认与本次依赖改动分开提交

### 09:29 | Codex

- done: 调研 WebAI-to-API(agent waa) 与 mu-agent 两个项目对 pi-agent 的封装资产，输出三主题可复用性评估（权限引擎/UTF-8/shell 挂载）
- context: 用户要求探索两个基于 pi-agent 的旧项目能否迁移复用到 MultiChat-desk 的 Agent 侧边栏开发
- decision: mu-agent 的 permissions.ts+modes.ts+shell.ts 整文件搬运（接 IPC 审批卡片）；waa 的 encoding.ts 整文件搬（iconv-lite 依赖）；bash 输出走 buffer+decodeCommandOutput 兜底文件编码；cmd vs powershell 路线待定
- unresolved: cmd.exe vs PowerShell 作为默认 shell 路线选择；只读模式档位需自补（mu 只有 default/auto/bypass）

### 09:12 | Antigravity

- done: 彻底修复 AgentCard 崩溃与输入框塌陷、端到端真机桌面客户端交互验收
- decision: 纯 Zustand 接管 Agent 消息流；AgentComposer 设置 min-h-[44px] 与点击聚焦；自动跟随 Workbench 工作区目录
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/agent/AgentSettingsModal.tsx`
- lesson(promoted): 1) 移除无用的 assistant-ui 外部 runtime 彻底消除 status 校验与 ToolUI 崩溃；2) textarea 必须设置最小高度与兜底值，避免隐藏状态下 scrollHeight 计算为 0 导致高度塌陷；3) ReactMarkdown 行内代码需配合 Tailwind prose-code 规范，避免行内变量被渲染为巨型黑色 pre 块

### 01:05 | Antigravity

- done: 修复 convertMessage 中 user 消息携带 status 导致 assistant-ui 抛出 Uncaught Error 崩溃的问题
- decision: assistant-ui 的 ThreadMessageConverter 严格限制 status 仅允许 assistant 消息携带；convertMessage 对 user 角色分支做显式区分，仅提取纯文本并剔除 status
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`

### 01:01 | Antigravity

- done: 对齐 AgentCard 与 WebviewCard 的 Header 布局规范、修复输入框 select-none 导致的无法输入问题并统一全量组件设计风格
- decision: Header 统一遵循 WebviewCard 扁平模式布局规范（p-3、border-gray-200/60、h2 字体、AppIcon 尺寸 20），去除父级容器 select-none 并显式保证 Textarea 可输入与选区能力
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/BashToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/EditToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ReadToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ToolFallback.tsx`
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`
  - `src/renderer/src/components/workbench/agent/ApprovalCard.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSettingsModal.tsx`

### 00:41 | Antigravity

- done: 修复 AgentCard 中 ToolUI 未在 AssistantRuntimeProvider 内包裹导致的渲染崩溃白屏问题
- decision: 将 AssistantRuntimeProvider 作为 AgentCard 顶层容器包裹所有 ToolUI 插槽与消息视口，确保 Aui 上下文全局有效
- modified:
  - `src/renderer/src/components/workbench/AgentCard.tsx`
- lesson(promoted): 使用 @assistant-ui/react 时，makeAssistantToolUI 生成的组件内部强制依赖 AuiProvider 上下文，必须置于 AssistantRuntimeProvider 内部包裹渲染

### 00:11 | Antigravity

- done: Implement backend agent session, permission engine, resource loader, shell tool, IPC handlers and preload bridge
- decision: Use dynamic import via new Function('s', 'return import(s)') for pure ESM @earendil-works/pi-coding-agent to support Electron CommonJS main build
- added:
  - `src/main/services/AgentSessionService.ts`
  - `src/main/services/PermissionEngine.ts`
  - `src/main/services/AgentResourceLoader.ts`
  - `src/main/services/ShellTool.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `package.json`
  - `package-lock.json`
- lesson(promoted): When building with electron-vite CommonJS output, pure ESM packages must be loaded using dynamic import with Function constructor to prevent compiler converting import() to require()

## 2026-11-23

### 23:59 | frontend

- done: 实现工作台本地 Agent 侧边栏 UI、Zustand store、工具与审批卡片、凭证配置与文件拖拽集成
- decision: 基于 assistant-ui 的 useExternalStoreRuntime 接管消息流，结合 react-diff-view 渲染 diff，WorkbenchAiSidebar 对 local-agent 分叉渲染并重定向拖拽与提示词注入
- added:
  - `src/renderer/src/types/agent.ts`
  - `src/renderer/src/store/agentSessionStore.ts`
  - `src/renderer/src/components/workbench/AgentCard.tsx`
  - `src/renderer/src/components/workbench/agent/BashToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/EditToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ReadToolUI.tsx`
  - `src/renderer/src/components/workbench/agent/ToolFallback.tsx`
  - `src/renderer/src/components/workbench/agent/ApprovalCard.tsx`
  - `src/renderer/src/components/workbench/agent/ThinkingBlock.tsx`
  - `src/renderer/src/components/workbench/agent/AgentComposer.tsx`
  - `src/renderer/src/components/workbench/agent/AgentSettingsModal.tsx`
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 22:57 | Codex

- done: 提交本次工作台改动的会话日志
- modified:
  - `SESSION_LOG.md`

### 22:57 | Codex

- done: 提交工作台迭代：docx 悬浮大纲(TocRail 复用)、图片右键发送到 AI 侧边栏(resolve-file-url IPC)、普通文档多来源 sources frontmatter、Agent 侧边栏高保真原型
- added:
  - `src/renderer/src/components/workbench/WorkbenchTocRail.tsx;src/renderer/src/components/workbench/WorkbenchDocxToc.tsx;docs/prototypes/agent_sidebar_prototype.html`
- modified:
  - `src/main/ipcHandlers.ts;src/preload/index.ts;src/renderer/src/components/CustomContextMenu.tsx;src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx;src/renderer/src/components/workbench/workbenchAiEvents.ts;src/renderer/src/components/workbench/FrontmatterPanel.tsx;src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx;src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx;src/shared/utils/conversationFrontmatter.ts;docs/workbench-unified-notes-annotation-design.md;docs/prototypes/minimalist-toc-showcase.html;SESSION_LOG.md`

### 22:56 | Antigravity

- done: 更新用户消息气泡背景色与主操作按钮为项目标准主题色 (#3b82f6)
- decision: 用户气泡统一使用 MultiChat Desk 主题色 primary (#3b82f6)，与全局 Tailwind 色彩体系一致
- modified:
  - `docs/prototypes/agent_sidebar_prototype.html`

### 22:52 | Antigravity

- done: 优化 Agent 侧边栏交互：拆分底部加号为添加文件组件、完全访问为权限下拉组件；将对话历史入口移至顶部新建会话后方
- decision: 底部左侧解耦为独立添加文件按钮与权限模式下拉，消除语义混淆；顶部操作区按「新建会话 -> 对话历史 -> 折叠」编排
- modified:
  - `docs/prototypes/agent_sidebar_prototype.html`

### 22:50 | Antigravity

- done: 优化文档 TOC 原位展开药丸的阴影与边框视觉，使其更加柔和轻盈
- decision: 将 TOC 胶囊由短焦距重阴影改为多层大扩散微阴影 (0 4px 20px -2px rgba(0,0,0,0.05) + 0 1px 4px rgba(0,0,0,0.02))，配合 border-black/[0.06] 与 backdrop-blur-sm，消除下边缘灰黑硬边感并补充暗色主题样式
- modified:
  - `src/renderer/src/components/workbench/WorkbenchTocRail.tsx`
  - `docs/prototypes/minimalist-toc-showcase.html`

### 22:44 | Antigravity

- done: 重构侧边栏 Agent 原型为项目原生浅色风格，新增对话历史菜单栏，移除刷新与语音输入
- decision: 保持与工作台一致的纯白浅色基调；顶部复用模型选择器并增加对话历史下拉菜单，移除本地 Agent 冗余的网页刷新按钮；底部胶囊输入栏严格按图2布局适配浅色形态并移除语音图标；对话输出维持纯净无外层容器
- modified:
  - `docs/prototypes/agent_sidebar_prototype.html`

### 22:41 | Codex

- done: 普通文档多来源：source 保持主来源，后续来源累积到 sources 列表；会话文档维持单来源；属性面板支持来源列表展示与逐条移除
- modified:
  - `src/shared/utils/conversationFrontmatter.ts`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `docs/workbench-unified-notes-annotation-design.md`

### 22:38 | Antigravity

- done: 创建工作台侧边栏集成自建 Agent 高保真交互原型
- decision: 侧边栏头部无缝复用现有 WebviewCard 结构与模型选择器；对话流保持纯净无容器嵌套，原生呈现用时与工具调用链路；底部采用深色胶囊输入栏并对齐权限、状态与操作按钮
- added:
  - `docs/prototypes/agent_sidebar_prototype.html`

### 22:38 | Codex

- done: 补充多来源 frontmatter 文档说明
- modified:
  - `docs/workbench-unified-notes-annotation-design.md`

### 22:37 | Codex

- done: 普通文档支持累积多来源：source 保持首个来源，后续来源写入 sources 列表；会话文档维持单来源并拒绝跨会话插入
- decision: 普通文档用独立 sources 列表累积来源，source 仍是唯一主来源（原文入口与会话去重只认它）；会话文档保持 1:1，跨会话插入继续返回 conflict
- modified:
  - `src/shared/utils/conversationFrontmatter.ts`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- lesson(promoted): frontmatter 多来源不能直接改 source 为列表：source 同时承担文档身份锚点，被会话去重与 source 标注按 1:1 依赖

### 22:17 | Codex

- done: Workbench Word 预览悬浮大纲导航（重构为 TocRail 公共 UI + 双数据源）
- context: 用户验收发现 TOC 未出现：初版用 docx_样式名 正则识别标题失效，因论文用自定义 styleId；改走 parseAsync outlineLevel 后正常工作
- decision: 抽出 WorkbenchTocRail 纯 UI 组件（items+resolveElement 回调），Lexical/docx 各自做数据源适配，避免平行复制 UI
- added:
  - `src/renderer/src/components/workbench/WorkbenchTocRail.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxToc.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`
- lesson(promoted): docx-preview 0.4.1 的 renderAsync 直接返回 WordDocument，不必拆成 parseAsync+renderDocument；OOXML 大纲层级在 paragraph.outlineLevel（顶层字段，不在 paragraphProps 里）+ style.paragraphProps.outlineLevel 继承；styleId 是中文论文模板自定义命名（a7/a0/1rgb181818）时按 className 识别完全失效，必须走 WordDocument 树

### 21:56 | Codex

- done: 为 Workbench Word 预览新增极简悬浮大纲导航
- context: docx-preview 0.4.1 不输出语义化 h1-h6 标签，只把 OOXML styleId escape 成 docx_<id> class，需要按 className 正则识别标题
- decision: 平行新建 WorkbenchDocxToc 而不是改造 WorkbenchMinimalToc：后者耦合 useLexicalComposerContext，抽离会动到 Markdown 编辑器链路，超出最小充分复杂度
- added:
  - `src/renderer/src/components/workbench/WorkbenchDocxToc.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`

### 21:50 | Codex

- done: 所有图片右键新增'发送到 AI 侧边栏'：新增 WORKBENCH_SEND_IMAGE_EVENT 事件 + workbench:resolve-file-url IPC（只解析白名单内真实路径不复制）；workbench-file:// 直接按磁盘路径上传，blob/data/http 经 create-temp-upload-file 临时文件复用既有上传管线后清理
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/workbenchAiEvents.ts`
- lesson(promoted): 右键图片发送到 AI 复用既有 FileUploadData 上传管线；workbench-file:// 只在主进程可解析授权根，需专用 resolve IPC 把真实路径交还渲染层而非渲染层自行解码 URL

### 21:49 | Codex

- done: 提交今日工作台迭代：标注锚点生命周期A/B、docx内嵌预览、KaTeX公式、文件树删除优化、图片背景持久化、工作区设置改版、frontmatter备份与旧笔记迁移修复、HTML预览图片右键
- decision: 共用基础设施文件(ipc/preload/store/service)集中入第一个 feat commit，后续按功能分 commit；中间态编译不可得的文件不强行 hunk 拆分
- added:
  - `src/main/services/frontmatterBackupService.ts;src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx;src/renderer/src/components/workbench/WorkbenchEquationNode.tsx;docs/design/workspace-settings-redesign.html`
- modified:
  - `src/main/ipcHandlers.ts;src/preload/index.ts;src/renderer/src/store/workbenchStore.ts;src/main/services/workbenchService.ts 等 36 文件`

### 21:48 | Codex

- done: docx/HTML 预览图片右键新增'复制图片'：blob/data/http 走渲染层 ClipboardItem（非 PNG/JPEG 先 canvas 转码），workbench-file:// 走主进程 copyImageAt 保留原编码；此前只有'另存为'
- modified:
  - `src/renderer/src/components/CustomContextMenu.tsx`
- lesson: Electron 渲染层复制图片剪贴板只有 ClipboardItem 一条路且只支持 PNG/JPEG，blob: URL 主进程 fetch 不到；workbench-file:// 图片复制优先用 webContents.copyImageAt 保留原图编码，DOM img 中心点坐标即 CSS 像素

### 21:40 | Codex

- done: docx 预览新增 Word 口径字数统计：右下角字数 chip 显示总字数（选中时显示 已选/总数），点击展开详情（字数/字符数不计空格/计空格/段落数/中文字符/英文单词），CJK 逐字+西文按词计数
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`

### 21:33 | Codex

- done: docx 预览增加缩放能力：工具栏缩放控件 + Ctrl/Cmd+滚轮缩放，与 PDF 预览一致；适应宽度基础上叠加手动缩放比例（0.5x-3x，步进0.1）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`

### 21:20 | Codex

- done: HTML 渲染预览 iframe 内嵌图片支持右键菜单：复制图片 + 图片另存为；workbench-file:// 协议 srcURL 经白名单解析后落盘
- modified:
  - `src/shared/types/contextMenu.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`
- lesson: workbench-file:// iframe 的右键由主进程 context-menu 捕获（params.frameURL 判定）转发给宿主自绘菜单；图片场景 params.mediaType==='image' 携带 srcURL/x/y，复制图靠 webContents.copyImageAt(x,y)，另存为走既有 save-image-from-url 但需加 workbench-file 分支 resolveWorkbenchFileRequest 拿真实路径再 copyFile

### 21:11 | Codex

- done: 新增迁移前 frontmatter 备份的查看与清理入口：跨已知工作区统计、只删正文仍存在的备份、清理后移除空目录；备份写入改为不覆盖已有备份；frontmatter-backup 纳入应用生成物忽略规则
- added:
  - `src/main/services/frontmatterBackupService.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/main/services/conversationFrontmatterRepair.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/services/gitignoreService.ts`
- lesson: 备份清理必须只删原文档仍存在的条目，原文档消失后备份是唯一副本；跨工作区统计要复用默认库+最近工作区+当前工作区并集，只看当前工作区会经常为 0

### 21:10 | Codex

- done: 图片预览背景主题改为全局持久化偏好，切换图片/重启保持一致
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`

### 21:04 | Codex

- done: Workbench Markdown 预览支持 LaTeX 公式渲染
- context: Lexical Workbench 编辑器此前无公式节点；新增 KaTeX 渲染的行内/块级公式 DecoratorNode 与 markdown transformer
- added:
  - `src/renderer/src/components/workbench/WorkbenchEquationNode.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `package.json`
- lesson: @lexical/markdown 0.53 无内置 EQUATION transformer，需自行用 MultilineElementTransformer(...)+TextMatchTransformer($...$)实现；katex.render 的 CSS 需 import 'katex/dist/katex.min.css' 才会带字体

### 20:58 | Codex

- done: 修复旧笔记迁移入口在无可迁移资产时仍显示 1 条待迁移：工作台记录正文以 Markdown 文件为准，snapshot 副本不再计为迁移资产；无资产且无任务时隐藏迁移卡片与角标
- modified:
  - `src/main/noteManager.ts`
  - `src/main/services/legacyMigrationService.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: 工作台记录的 snapshot 只是历史副本，迁移资产判定必须排除它，否则纯副本记录会永久停留在待迁移

### 20:45 | Codex

- done: 补齐标注创建的显式失败提示，避免再次静默无反应
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`

### 20:45 | Codex

- done: 修复忽略规则分类胶囊缺少部分选中态：按命中规则数区分全选/部分/未选，部分选中时点击补齐整组
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: 分类勾选的三态要用命中数判定（0=未选，全部=全选，其余=部分），只判断 some() 会把部分命中误显示成全选

### 20:43 | Codex

- done: 修复放弃旧笔记迁移后仍残留阻塞记录与进度：放弃时等在途记录收尾后清理阻塞标记、不再广播迟到进度事件；历史 abandoned 任务打开时自动收敛残留标记；一次性临时工作区已删除的记录改为把快照落到默认会话库
- modified:
  - `src/main/services/legacyMigrationService.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: 放弃迁移必须等在途单条迁移落盘后再清阻塞标记，且放弃路径不能再 emit 进度事件，否则迟到事件会把进度条和阻塞计数刷回来

### 20:42 | Codex

- done: 修复点击标注无反应与新建草稿被对账覆盖的回归
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
- lesson(promoted): Lexical 选区端点偏移是段落内偏移，构建全文锚点前必须先映射到 block.start；仅首个 block 恰好相等会掩盖这个错误。
- lesson(promoted): 新建标注草稿在落盘前必须用同步 ref 保护，避免失焦触发的异步对账把草稿从 store 覆盖掉。

### 20:09 | Codex

- done: 修复旧笔记迁移放弃后阻塞记录仍显示的问题：abandon 时清除所有记录的 migrationBlocked 标记，让旧笔记回到待迁移状态
- modified:
  - `src/main/services/legacyMigrationService.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 20:06 | Codex

- done: 修复旧笔记迁移进度条在放弃后仍显示的问题
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 19:55 | Codex

- done: 补完注释阶段 A/B 验收收尾：评论保存失败保留卡片可重试、展开态未解决面板避让已定位卡片、600ms 本地解析回灌投影让撤销后高亮重现；完成 HTML 未定位落盘、关窗 flush、阶段 B 模糊匹配与独立 worker 复核
- context: 用户要求按 docs/workbench-annotation-anchor-lifecycle-design.md 实施阶段 A 与 B；独立 worker 结论为可直接交付，无 P0/P1 阻断项
- decision: 编辑停止后的本地解析可以回灌 quote/anchor 到本地标注列表以触发重投影，但仍不写盘；source 锚点不回灌
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/main/services/annotationService.ts`
  - `docs/workbench-annotation-anchor-lifecycle-design.md`
- lesson(promoted): 撤销恢复文字但未恢复 MarkNode 时，高亮不会自动重现；编辑停止后的本地解析必须把新 quote/anchor 回灌到标注列表触发重投影，仅更新解析状态不够
- lesson(promoted): 旁注栏的未解决面板若绝对定位在顶部，必须把自身高度计入已定位卡片的最小 top，否则第一条卡片会被盖住

### 19:35 | Antigravity

- done: 优化默认会话库状态呈现：正常隐藏可写文案，仅在异常或只读时告警
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 19:28 | Antigravity

- done: 优化工作区设置UI并对齐侧栏底部原生FooterPopover规范，移除标题多余目录副标题，锁定Tab切换固定容器高度
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 19:16 | Antigravity

- done: 对齐工作区设置真实渲染与原型：支持minWidth(400px)与固定高度(530px)避免切Tab高度跳动，优化预设激活判定(some匹配)、精简文案及SVG微图标
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`

### 18:48 | Codex

- done: 实现工作台注释锚点生命周期阶段 A 与阶段 B：MarkNode 优先、未定位持久化与可见分组、source/document 分离、HTML 未定位入口与重新定位、关闭窗口到托盘前 flush 握手、有限模糊匹配；补齐保存失败可重试与窄屏未解决入口
- context: 按 docs/workbench-annotation-anchor-lifecycle-design.md 实施，未切分支未提交
- decision: 不按时间 TTL 自动删除注释，未定位记录保留可见并提供手动清理；模糊匹配成功统一返回 shifted，短引文只做精确匹配
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/services/annotationService.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/workbenchAnnotationUtils.ts`
  - `src/renderer/src/store/annotationStore.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/shared/types/annotations.ts`
  - `src/shared/types/workbench.ts`
  - `src/shared/utils/annotationAnchors.ts`
  - `docs/workbench-annotation-anchor-lifecycle-design.md`
  - `docs/workbench-unified-notes-annotation-design.md`
  - `docs/DOCS_INDEX.md`
- lesson(promoted): 新建注释打开评论框会触发编辑器失焦对账；对账若用磁盘结果回写 store 会冲掉尚未落盘的新建草稿，必须在 create 模式跳过 store 回写但仍保存正文
- lesson(promoted): Lexical 选区端点可能是 ElementNode 而非 TextNode，整段选中或行首行尾必须同时处理两种端点，否则重新定位读不到选区
- lesson(promoted): source 投影也要参与本地解析，否则删除投影目标后它既不显示也不进入未解决分组；但 source 结果不能写回磁盘锚点

### 18:37 | Antigravity

- done: 实现工作区设置UI极简重构：采用代码与忽略/存储与维护双标签分流，预设升级为紧凑交互胶囊，.gitignore编辑区直接展示不设折叠，去除所有冗余小绿点与假定Git标签，统一全局保存与脏检查
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 18:09 | Codex

- done: 工作台引入 Word(.docx) 内嵌预览：新增 workbench:read-docx-bytes 二进制 IPC 与 WorkbenchDocxPreview，支持划词气泡/右键发送到 AI、链接安全处理、Blob URL 回收
- context: 仅做 Word，表格与 PPT 不做
- decision: 未采用方案中的 base64 dataUrl，改为 IPC 直接传 Uint8Array 并延迟 import docx-preview；实测 10MB 文档 base64 链路在主进程+渲染层各多占约 1.4x 与 2.3x 常驻内存
- added:
  - `src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `package.json`
  - `package-lock.json`
- lesson(promoted): docx-preview 的 ignoreWidth 会把页面压成窄条并写死正文宽度，应保留页宽再按容器 zoom 缩放；altChunk 会注入未沙箱 iframe，必须关闭；内嵌图走 blob URL，卸载需 revoke

### 18:03 | Antigravity

- done: 优化工作区设置UI并交付高保真交互HTML原型：去除多余绿点与Git标签，.gitignore编辑区直接展示不设折叠
- added:
  - `docs/design/workspace-settings-redesign.html`

### 18:01 | Codex

- done: 优化工作台批量删除卡顿：readTree 改限流并发+按需 realpath，批量删除统一一次 IPC 并乐观移除、确认即关弹窗
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson: 工作台 readTree 逐条 assertSafePath 会对每个条目做两次 realpath，万级文件工作区单次扫描 6.9s；改为根路径缓存+仅 symlink 校验+24 路限流并发后 1.2s。批量删除必须先乐观移除再后台落盘，逐项调用单删接口会放大成 N 次整树重扫

### 17:49 | Codex

- done: 实现工作台注释锚点生命周期阶段A和阶段B：状态持久化、MarkNode优先、精确与有限模糊解析、IPC拆分、未解决UI、HTML未定位闭环和关闭flush握手
- context: 按已批准的docs/workbench-annotation-anchor-lifecycle-design.md实施A和B两阶段
- added:
  - `docs/workbench-annotation-anchor-lifecycle-design.md`
- modified:
  - `src/shared/types/annotations.ts`
  - `src/shared/utils/annotationAnchors.ts`
  - `src/main/services/annotationService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/annotationStore.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`
  - `src/renderer/src/App.tsx`
- lesson: 注释对账必须拆分create/update-comment/reanchor语义，并用anchorRevision保护并发；投影更新统一带HISTORIC_TAG避免进入撤销栈
- unresolved: npm run dev桌面端全场景人工验收未执行

### 17:46 | Codex

- done: 实现工作台注释锚点生命周期阶段A和阶段B：状态持久化、MarkNode优先、精确与有限模糊解析、IPC拆分、未解决UI、HTML未定位闭环和关闭flush握手
- context: 按已批准的docs/workbench-annotation-anchor-lifecycle-design.md实施A和B两阶段
- added:
  - `docs/workbench-annotation-anchor-lifecycle-design.md`
- modified:
  - `src/shared/types/annotations.ts`
  - `src/shared/utils/annotationAnchors.ts`
  - `src/main/services/annotationService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/annotationStore.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`
  - `src/renderer/src/App.tsx`
- lesson: 注释对账必须拆分create/update-comment/reanchor语义，并用anchorRevision保护并发；投影更新统一带HISTORIC_TAG避免进入撤销栈
- unresolved: npm run dev桌面端全场景人工验收未执行

### 17:46 | Codex

- done: 排查批量删除卡顿：定位到 hitsActive 走逐项 deleteNode 导致 N 次树重扫/导图对账/git 刷新
- context: 工作台文件树批量删除 6 项（含正在预览的 PNG）卡住很久

### 17:23 | root

- done: 完成注释锚点文档的第二轮与最终复核修订：拆分 upsert、投影撤销栈、关闭到托盘 flush、HTML no-op、source 卡片动作和跨 block/重叠状态
- context: 独立复核先后发现跨 block 误合并、评论 upsert 绕过修订号、投影进入撤销栈、关闭到托盘不 flush、HTML 对账循环等问题
- decision: 保留阶段 A/B 方案；只补状态、版本保护和落盘时序，不扩大功能范围
- modified:
  - `docs/workbench-annotation-anchor-lifecycle-design.md`
  - `docs/workbench-unified-notes-annotation-design.md`
  - `docs/DOCS_INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 17:06 | Codex

- done: 大纲导航改为固定在编辑区左边缘，不再随居中正文左缘定位
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx`
- lesson(promoted): 大纲/侧边导航的锚点按用户心智模型选择：贴编辑区左缘时用固定 left 定位，不要跟随居中正文测量。

### 16:57 | root

- done: 完成工作台注释锚点生命周期与未定位清理设计文档，并按独立 worker 审核意见修订
- context: 现状为旁路 JSON 保留注释但未定位状态被 UI 隐藏；HTML 预览未消费 resolved 消息
- decision: 采用阶段 A 未定位闭环 + 阶段 B 有限模糊匹配；不按时间自动删除注释，source 与 document 分区清理
- added:
  - `docs/workbench-annotation-anchor-lifecycle-design.md`
- modified:
  - `docs/DOCS_INDEX.md`
  - `docs/workbench-unified-notes-annotation-design.md`
- lesson(promoted): 锚点生命周期先保证未定位可见与对账完整，再引入模糊匹配；不要用旧渲染结果覆盖新锚点

### 16:55 | Codex

- done: 提交今日工作台迭代：HTML 可视化编辑/原位标注/导图选区/正文居中旁注/托盘退出守卫等 43 文件一个 feat 提交，知识库重组单独 docs(memory) 提交
- added:
  - `src/shared/utils/workbenchHtmlEditor.ts;src/shared/utils/workbenchHtmlAnnotations.ts;src/shared/types/htmlAnnotations.ts;src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx;src/renderer/src/components/workbench/WorkbenchHtmlEditToolbar.tsx;src/renderer/src/components/workbench/WorkbenchHtmlColorPicker.tsx;src/renderer/src/components/workbench/WorkbenchHtmlEditLeaveDialog.tsx;src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx;src/renderer/src/components/workbench/WorkbenchFloatingToolbarChrome.tsx;docs/workbench-html-visual-edit-plan.md;docs/workbench-annotation-anchor-lifecycle-design.md;docs/mindmap-selection-scope-design.md;docs/mindmap-selection-scope-prototype.html;.memory/sessions/2026-11-16.md`
- modified:
  - `src/main/index.ts;src/main/ipcHandlers.ts;src/main/webviewManager.ts;src/preload/index.ts;src/renderer/src/App.tsx;src/renderer/src/components/Layout.tsx;src/renderer/src/components/CustomContextMenu.tsx;src/renderer/src/store/workbenchStore.ts;src/renderer/src/store/appStore.ts;.memory/INDEX.md;.memory/KNOWLEDGE.md;SESSION_LOG.md`

### 16:43 | Codex

- done: 工作台 Markdown 编辑器改为正文固定居中：旁注栏脱离 flex 布局按右侧留白浮层定位，大纲导航跟随正文左缘
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx`
- lesson(promoted): Markdown 阅读区左右侧栏（旁注、大纲）不要参与 flex 布局流；以正文容器矩形为锚做绝对/固定定位，展开收起才不会推动正文。

### 16:27 | Codex

- done: 将 HTML 可排序容器的拖拽手柄移出工具条并放到容器左上角外侧；不可排序容器不渲染手柄，贴边无外侧空间时隐藏，避免遮挡正文。
- context: 用户要求拖拽控件不能覆盖选中容器内部正文，只能在容器外侧显示。
- decision: 优先放在容器左侧外侧并与顶边对齐；左侧无空间时放到容器上方外侧，且仅在完整位于容器外时显示。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditToolbar.tsx`
  - `docs/workbench-html-visual-edit-plan.md`

### 16:17 | Codex

- done: 将 HTML 编辑背景色的透明选项并入完整取色器，并修复菜单失焦关闭与实时输入抢焦点问题。
- context: 用户要求透明色直接放在背景颜色菜单中、菜单失焦后自动关闭，并且自建取色器具备原生 color picker 级别的取色能力。
- decision: 取色器提供饱和度/明度区、色相、不透明度、Hex 与预设色，透明作为背景调色板首项；实时调色命令携带 preserveFocus，避免 iframe 抢走 Hex 输入焦点。
- added:
  - `src/renderer/src/components/workbench/WorkbenchHtmlColorPicker.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/shared/utils/workbenchHtmlEditor.ts`
  - `docs/workbench-html-visual-edit-plan.md`
- lesson(promoted): sandbox iframe 的宿主工具条做实时调色时，编辑运行时不能无条件 window.focus()，否则每次输入都会抢走父窗口焦点并关闭调色菜单；实时预览命令应显式 preserveFocus。

### 16:06 | Codex

- done: 实现 HTML 渲染预览的原位标注：选中文字右键标注，页面内高亮，点击高亮打开与文档一致的评论卡，支持修改和删除，不显示旁注栏。
- context: 用户要求 HTML 只显示高亮，点击高亮再显示评论；复用 document 标注旁路存储。现有工作区包含未提交的 HTML 可视化编辑改动，本次只在该链路旁增加标注预览。
- decision: 标注运行时作为 workbench-file:// 同源外部脚本注入，iframe 继续 sandbox=allow-scripts；评论正文和持久化留在宿主 renderer，运行时只接收 id 与 anchor。复用 AnnotationCommentCard，不引入旁注列表。
- added:
  - `src/shared/types/htmlAnnotations.ts`
  - `src/shared/utils/workbenchHtmlAnnotations.ts`
  - `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx`
- modified:
  - `src/main/index.ts`
  - `src/shared/utils/workbenchHtmlEditor.ts`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
- lesson(promoted): HTML 预览标注应把高亮运行时放在 iframe 内、评论 UI 放在宿主；空白点击、滚动和 Esc 必须由 iframe 运行时主动 postMessage 关闭评论卡，否则新建卡片会残留。

### 15:58 | Codex

- done: 为 HTML 可视化编辑工具条增加当前文字色和背景色回显，并支持透明背景。
- context: 用户要求工具条识别选区当前文字色与背景色，背景色不是文字高亮，且需要透明色选项。
- decision: 编辑器运行时在 selection 消息中上报计算样式；工具条用色块回显文字色与背景色，背景色改用填充图标并提供独立透明按钮。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/shared/utils/workbenchHtmlEditor.ts`
  - `docs/workbench-html-visual-edit-plan.md`

### 15:52 | Codex

- done: 按用户截图修正导图侧栏：选区预览放到 logo 与标题下方，标题切换为将选中内容整理成思维导图，并保留一键清除
- context: 用户指出前一版把选区预览放在标题上方且标题未变化，要求预览位于 logo/标题下方并改变标题文案
- decision: 空状态在标题下方注入固定高度选区预览；选区模式标题使用将选中内容整理成思维导图；生成成功才自动清除选区，清除按钮可随时一键恢复全文
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
  - `docs/mindmap-selection-scope-prototype.html`
  - `docs/mindmap-selection-scope-design.md`

### 15:46 | Codex

- done: 修正 HTML 可视化编辑态顶栏、编辑高亮与离开确认框样式。
- context: 用户反馈模式分段控件被挤动、文件操作按钮被隐藏、编辑态使用紫色，以及弹窗不符合现有 UI。
- decision: 保存按钮前置并保留全部文件操作，使模式分组位置固定；选中、hover 与拖拽落点改用应用主色；确认框沿用工作台浅色弹窗样式。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditLeaveDialog.tsx`
  - `src/shared/utils/workbenchHtmlEditor.ts`
  - `docs/workbench-html-visual-edit-plan.md`

### 13:21 | Codex

- done: 在工作台 HTML 预览中完成渲染、可视化编辑、源码三态分离，加入可复用浮动工具栏、显式保存、未保存离开确认、产品模式切换守卫和托盘退出确认，并同步实现方案文档。
- context: 按 docs/workbench-html-visual-edit-plan.md 实现；iframes 保持 sandbox=allow-scripts，不放开 allow-same-origin；保存复用 saveActiveFile/writeFile 直接覆写原文件，不新增保存 IPC。
- decision: 编辑文档、运行时和样式由 workbench-file:// 查询参数提供，父子页面通过 postMessage 通信；工具栏复用 WorkbenchFloatingToolbarChrome；文件、工作区、编辑模式和托盘退出统一走 htmlEditLeaveGuard。
- added:
  - `docs/workbench-html-visual-edit-plan.md`
  - `src/shared/utils/workbenchHtmlEditor.ts`
  - `src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarChrome.tsx`
  - `src/renderer/src/components/workbench/WorkbenchHtmlEditLeaveDialog.tsx`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson(promoted): sandbox iframe 内做可视化编辑时，可由主进程提供同源编辑文档与运行时，再用 postMessage 通信，避免放开 allow-same-origin；跨 iframe 拖拽应由外层 Pointer Capture 与覆盖层保持事件归属。
- lesson(promoted): Electron 托盘退出若要经过渲染层确认，必须先建立 quit-guard-ready 握手，并在 before-quit 中 preventDefault 后等待 IPC 决策；取消退出时不能提前 setQuitting(true)，否则窗口关闭会绕回隐藏到托盘的既有行为。

### 12:59 | Codex

- done: 进一步统一选区交互：去掉长短选区与折叠分支，固定选区文本区域高度并内部滚动
- context: 用户要求统一使用文档中有选区的方案，长选区不做专门折叠，固定 text area 高度即可
- modified:
  - `docs/mindmap-selection-scope-prototype.html`
  - `docs/mindmap-selection-scope-design.md`

### 12:59 | Codex

- done: 修正 PDF 预览 Ctrl+滚轮缩放方向：向上放大、向下缩小
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
- lesson(promoted): 滚轮缩放方向按 deltaY 语义映射：deltaY<0 为向上应放大，正值为向下应缩小；与图片预览和系统通用习惯保持一致，避免反向操作。

### 12:57 | Codex

- done: 修正原型：选区模式必须展示原始文字，长文本默认折叠并可展开；默认仍为全文生成
- context: 用户指出选区导图应在右侧面板显示选中内容，只是内容较多时默认折叠
- decision: 短选区直接展示，长选区默认折叠；展开仅作为查看行为，不引入范围选择或取消入口
- modified:
  - `docs/mindmap-selection-scope-prototype.html`
  - `docs/mindmap-selection-scope-design.md`

### 12:57 | Codex

- done: 为 HTML 预览右键菜单的 AI 操作图标补齐与 Markdown 文档一致的配色
- modified:
  - `src/shared/types/contextMenu.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`

### 12:55 | Codex

- done: PDF 预览支持 Ctrl/⌘ + 滚轮缩放，并统一缩放步进逻辑
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
- lesson(promoted): PDF 预览的 Ctrl+滚轮缩放要挂在非被动 wheel 监听上并累加 deltaY，触控板连续手势才不会一次跳过多档；缩放状态仍由 WorkbenchPdfPreview 统一持有，Viewer 只上报方向。

### 12:54 | Codex

- done: 根据反馈简化思维导图选区交互原型：删除范围选择，默认全文，选区仅作一次性隐式上下文
- context: 用户指出生成范围不应让用户选择：选择部分文字后自动触发，默认按整篇文档生成
- decision: 取消范围配置区；选区状态仅通过正文高亮、主按钮圆点和底部一行反馈表达，生成后恢复全文
- modified:
  - `docs/mindmap-selection-scope-prototype.html`
  - `docs/mindmap-selection-scope-design.md`

### 12:50 | Codex

- done: 设计思维导图选区交互重设计，并交付可切换状态的 HTML 原型与设计说明
- context: 用户提供截图反馈：顶部全宽选区提示占用容器宽度且交互不合理，要求用 HTML 展示重设计方案
- decision: 将选区定义为生成卡片内的一次性作用范围，支持取消、生成后恢复全文，并取消顶部通知条
- added:
  - `docs/mindmap-selection-scope-prototype.html`
  - `docs/mindmap-selection-scope-design.md`

### 12:49 | Codex

- done: 删除工作台划词菜单顶部标题，并将 HTML 预览右键菜单样式对齐 Markdown 右键菜单
- modified:
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`

### 12:48 | Codex

- done: 对齐 HTML 预览右键菜单与 Markdown 文档右键菜单的样式
- context: 用户截图显示 HTML 预览右键仍使用全局 CustomContextMenu；Markdown 文档使用 WorkbenchSelectionMenuPlugin 样式。

### 12:46 | Codex

- done: 删除工作台划词菜单顶部的 AI 划词协同/划词操作文字标题，并统一编辑器与 PDF 菜单结构
- modified:
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`

### 12:36 | Codex

- done: 移除工作台标注文字后的圆形序号：删除紧凑模式下的 data-annotation-index 写入与 ::after 伪元素样式
- context: 用户反馈窄窗口才出现序号、宽窗口没有；定位为 960px 以下 compact 旁注模式的遗留视觉标记。保留 data-margin-notes-mode，因为正文选区逻辑仍依赖它判断紧凑模式
- decision: 只移除序号渲染与无用的 DOM 标记同步，保留高亮底色、虚线边框和全部标注交互；不改宽窄屏布局与旁注定位
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/assets/index.css`

### 12:20 | Codex

- done: 修复工作台已有标注弹窗评论输入框被抢焦点：为所有标注投影与定位的 Lexical update 附加 SKIP_SELECTION_FOCUS_TAG，输入不再落入正文
- context: 根因是 Lexical 0.53 选区更新会主动 rootElement.focus()；打开已有标注后的定位，以及 textarea 失焦对账触发的 cleanMarkNodes，都会把焦点抢回 contenteditable。桌面实测点击 textarea 后 0.2s、1.0s、2.0s 焦点仍在 TEXTAREA，测试文字未进入正文；lint、定向类型检查与 build 均通过
- decision: 复用 Lexical 官方 SKIP_SELECTION_FOCUS_TAG 统一约束 annotation-sync 后台更新，只改焦点策略，不改标注数据与 Markdown 序列化
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
- lesson(promoted): Lexical 后台标注投影和选区定位即使带自定义 tag，也会在 discrete update 时抢走评论框焦点；同步链路必须附加 SKIP_SELECTION_FOCUS_TAG，避免输入落入 contenteditable
- unresolved: 验收中发现 Markdown 导入器会丢失嵌套强调格式，已恢复测试文档原文，未在本任务修改

### 12:02 | Codex

- done: 重组 KNOWLEDGE.md 与 INDEX.md：按领域收敛为 15 个主题、166 条经验，合并重复条目，修正过时 IPC 类型与 tsc 基线，拆分 Git/CLI/工作台触发器并补齐 Cookie 证据链
- context: KNOWLEDGE 原有 448 行、约 6.8 万字符；INDEX 的 react-state/notes-identity/cli-daemon 触发词分别膨胀到 119/69/55 个，Git 路由还指向错误的旧章节
- decision: 保留单文件按 ### 分节，不拆多文件；路由改为按标题文本匹配，去掉数字编号依赖；条目统一为结论开头的单 bullet，历史细节压缩为证据句
- modified:
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson: 知识库整理要先修与当前代码冲突的事实，再按领域归并；索引触发词超过 50 个时应拆分路由，而不是继续追加关键词
- unresolved: 历史平台 DOM 观测仍有 2026-11 的时效性，后续遇到相关平台改版时应按当前 DOM 复核

### 11:54 | Codex

- done: 将 MarkNode 破坏 Markdown 格式连续性的经验写入 KNOWLEDGE，并在 INDEX 增加 lexical-markdown 路由；标注本次修复验证结果。
- context: 实现方案 B 后，普通文档无标注时保持原序列化路径，存在标注时使用 toJSON(true)+parseEditorState 影子状态；无界面 Electron 验收已确认标注不再报错，编辑后自动保存的 Markdown 不含 *****。
- modified:
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 11:49 | Codex

- done: 工作台标注投影修复：统一用无 MarkNode 的影子状态序列化 Markdown，标注校验和正文回写共用，避免粗体/斜体标注被安全校验拒绝或写回时格式损坏。
- context: 用户确认按独立审查后的方案 B 实施；问题是 @lexical/markdown 的 exportTextFormat 只识别直接相邻 TextNode，MarkNode 隔断格式连续性。
- decision: 保留 after !== before 的安全 guard 和 annotation-sync 过滤；仅在树中存在 MarkNode 时走 toJSON(true) + parseEditorState 影子序列化，普通文档保持原路径。
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
- lesson(promoted): Lexical MarkNode 会隔断 Markdown 导出器的相邻 TextNode 格式判断；标注旁路投影的序列化必须在 guard 和普通编辑回写两条路径统一剥离 MarkNode，否则会出现校验拒绝或静默格式损坏。

### 11:26 | Codex

- done: 主页模式设置弹窗：工作台挪到第二位、删除上下箭头按钮（保留拖拽排序）
- decision: 默认顺序改为 [multi_ai, workbench, task_assignment, debate]，hidden 默认不变；PRODUCT_MODE_CONFIG_SCHEMA_VERSION 未递增（仅 order 变化，不属 hidden 迁移场景）
- modified:
  - `src/renderer/src/store/appStore.ts;src/renderer/src/components/ProductModeOrderModal.tsx`

## 2026-11-22

### 21:23 | Codex

- done: 修复工作台 Markdown 表格导入把排版空格写入单元格：mapToTableCells 按 GFM 规则裁掉单元格两侧 ASCII 空格/制表符，保留全角空格与 NBSP
- context: 用户反馈管道分隔用的填充空格被渲染为真实空格；主页 remark-gfm 本就会裁剪，问题只在工作台 Lexical 自定义 TABLE transformer
- decision: 只裁剪 [ \\t]，不使用 String.trim()，避免误删中文全角空格和不换行空格
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
- lesson(promoted): Lexical 自定义 GFM 表格导入时，单元格左侧/右侧的排版空白必须在拆分后显式裁剪；GFM 仅把 ASCII 空格和制表符视为填充，不应使用会吞掉 Unicode 空白的 trim()

### 21:12 | Codex

- done: 纠正工作台右上角圆角修改对象：改为中间编辑器右上角
- context: 用户指出红框圆角属于中间编辑区域右上角，而不是右侧 AI 栏左上角。
- decision: 中间编辑器在 rightPane 展开时应用 rounded-tr-xl，折叠时不应用；右栏恢复固定 rounded-tl-xl。
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 20:59 | Codex

- done: 修复工作台右栏左上角圆角规则：侧栏展开时圆角、关闭时直角
- context: 根据用户截图，红框标记的是右侧 AI/导图栏左上角；原实现把圆角放在中间编辑器右上角且条件相反。
- decision: 移除中间编辑器的条件性右上角圆角，右栏容器仅在 rightPane 展开时应用 rounded-tl-xl。
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 20:46 | Codex

- done: jsonl/ndjson 文件树图标映射到 jsonIcon
- context: 继 CODE_EXTENSIONS 分类修复后补充对应文件图标
- modified:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`

### 20:44 | Codex

- done: 工作台文件分类：将 .jsonl/.ndjson/.gitattributes/.editorconfig 及 conf/cfg/properties/lock/prisma/diff/patch 等代码类扩展归入 CODE_EXTENSIONS，使 jsonl 等代码文件用代码编辑器打开而非 Markdown 编辑器
- context: 用户反馈 .jsonl 文件被 Markdown 编辑区域打开
- modified:
  - `src/shared/types/workbench.ts`

### 20:44 | Codex

- done: 右键菜单顺序调整：重命名置顶，移动到其他工作区放到上传到AI下方，去掉图标配色并简化二级菜单文案
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 20:34 | Codex

- done: 跨工作区移动改为二级菜单（移动到 <工作区名字>），补轻提示通道与同名副本的 assets 引用改写
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/main/services/workbenchService.ts`
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`

### 20:30 | Codex

- done: 为工作台文件右键菜单新增跨工作区移动（二级菜单「移动到 <工作区名字>」），主进程完成同盘 rename/跨盘复制后删除，并迁移 assets 附件、导图文件与文档标注旁路
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/services/annotationService.ts`
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 19:55 | Codex

- done: 提交工作台旁注交互收敛、属性字段归属与会话识别修复
- context: 用户要求提交当前修改；按旁注 UI、属性系统、记忆日志分组提交，不提交 .tmp/.dev 临时验收产物。
- added:
  - `src/shared/utils/frontmatterPolicy.ts`
  - `docs/prototypes/document-margin-comments-responsive-wide-open.png`
  - `docs/prototypes/margin-notes-collapsed.png`
  - `docs/prototypes/margin-notes-expanded.png`
  - `docs/prototypes/margin-notes-sticky.png`
  - `docs/prototypes/workbench-margin-notes-responsive-narrow.png`
  - `docs/prototypes/workbench-margin-notes-responsive-wide.png`
- modified:
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`
  - `docs/prototypes/document-margin-comments-responsive-narrow-open.png`
  - `docs/prototypes/document-margin-comments-responsive-narrow.png`
  - `docs/prototypes/document-margin-comments-responsive-wide.png`
  - `docs/prototypes/document-margin-comments.html`
  - `src/main/services/conversationDocumentService.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/shared/utils/conversationFrontmatter.ts`
  - `src/shared/utils/conversationSource.ts`
  - `src/shared/utils/noteTranscript.ts`

### 19:50 | Codex

- done: 修复单条回复被识别为会话：另存回复不写 source_kind，仅保留来源属性；无类型文档仅在正文含用户与助手轮次时按旧会话升级；普通文档属性面板不再显示文档类型行
- decision: 会话快照与单条回复摘录分离：前者带 source_kind 并参与会话库/标注，后者是普通 Markdown，仅保留来源便于回看
- modified:
  - `src/shared/utils/conversationFrontmatter.ts`
  - `src/shared/utils/noteTranscript.ts`
  - `src/shared/utils/conversationSource.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/main/services/conversationDocumentService.ts`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`

### 19:48 | Codex

- done: 修复 Markdown 富文本预览区左侧块拖拽控件与正文重叠
- context: 用户截图显示当前 Markdown 编辑预览模式下，块插入控件压住正文；最小修复仅调整文章容器左内边距。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson(promoted): Lexical DraggableBlockPlugin 的 + 与拖拽手柄合计约 60px；富文本文章容器的左侧 gutter 至少要预留 64px，否则正文第一个字符会被控件覆盖。

### 19:44 | Codex

- done: 修复正文清空后仍显示注释计数：旁注数量与列表排除未定位标注
- context: 用户报告未命名笔记.md 正文已清空但控件仍显示注释 1；排查为会话来源的 source 标注锚定原文、在空文档中定位失败仍被计入
- decision: WorkbenchMarginNotes 的 allNotes 过滤掉 unlocatedIds，只统计能在当前正文定位的标注
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
- lesson: 标注存在但锚点在当前正文里失效时，必须从数量统计和列表里排除，否则清空正文后会残留幽灵计数；source 标注跨文档共享，不能只按 scope 计数

### 19:38 | Codex

- done: 统一注释控件折叠与展开态外观：共用容器样式、标题改为注释、折叠时保留旁注列占位实现零位移切换
- context: 用户反馈展开后控件容器样式与标签差异大导致切换不丝滑，且标题应叫注释；实测两态横向相差 148px 源于折叠时 aside 不渲染使正文重排
- decision: 两态共用 h-9 圆角边框容器与同一水平基准；折叠态渲染 aria-hidden 的 260px 占位列保持布局稳定
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
- lesson: 同一控件在展开/收起两态之间切换，若两态占用的布局空间不同，正文重排会让控件横向跳动；折叠态保留等宽占位列比事后校正坐标更可靠

### 19:34 | Codex

- done: 修复旁注卡片跑到文档顶部、展开栏头与折叠图标位置不一致、无标注仍显示控件三个问题
- context: 用户验收反馈展开控件未停在图标位置、卡片跑到顶部，并要求无注释时隐藏控件；CDP 复现确认找不到 MarkNode 的标注会落到兜底 top=74px
- decision: 找不到正文锚点的标注不渲染卡片；展开栏头按首行与视口共同定位，与折叠入口 sticky 对齐；allNotes 为空时不渲染入口与旁注列
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
- lesson: 浮动卡片用兜底坐标会造成'跑到顶部'的假象，找不到锚点时应直接不渲染；折叠与展开的同一控件必须共用同一套定位计算，否则切换瞬间会跳位

### 19:25 | Codex

- done: 修复普通文档来源链接丢失会话跳转入口：来源行按链接是否属于平台会话页决定显示在侧边栏打开会话，不再受文档类型限制
- decision: 会话跳转能力由链接本身决定，文档类型只控制会话归属、原文标注和自动升级
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`

### 19:19 | Codex

- done: 旁注控件改 sticky 吸附并消除展开闪跳：折叠入口用 position:sticky 合成器吸附，折叠态持续维护 positions 防展开首帧卡片堆文档顶
- context: 用户反馈展开控件栏跑到文档最开头、折叠图标滚动时先跟动再回顶；CDP 复现为 absolute+JS 测量的一帧延迟与折叠态 positions 被清空
- decision: 折叠入口 absolute 改 sticky(top:8 + marginTop 首行偏移)；computeLayout 移除 compactMode/showMarginNotes 提前 return，headerOffset 恒 44
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
- lesson: 需要随滚动吸附的控件优先用 position:sticky 而不是 absolute+scroll 测量，后者在事件到渲染间必有一帧跟手漂移；条件渲染的浮层若在隐藏时清空布局缓存，重新显示首帧会闪在默认位

### 19:19 | Codex

- done: 为转为普通文档增加确认弹窗：复用 ConfirmModal，转换前提示解除会话关联及原文入口/标注影响，切换文件自动关闭确认
- decision: 复用项目已有 ConfirmModal，确认文案说明结果而非解释机制
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`

### 19:16 | Codex

- done: 收窄文档类型转换为单向：仅允许会话文档解除归属转为普通文档，移除普通文档转会话入口及无意义锁按钮
- decision: 普通 Markdown 缺少可信会话身份，反向翻转 source_kind 会制造假会话文档，因此只保留会话到普通文档的单向转换
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`

### 19:15 | Codex

- done: 修复旁注展开跳顶与箭头缺失：展开/收起前后保持 scrollTop，单条标注也显示上下定位箭头
- context: 用户验收反馈展开仍跳到顶部、且栏头没有上下箭头；真实 CDP 复现确认展开 scrollTop 2500->2529、箭头因 >1 条件在单标注时隐藏
- decision: handleToggleMarginNotes 记录 scrollTop，双 rAF 在 aside 布局重排后恢复；箭头显示条件从 >1 放宽到 >0
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
- lesson: flex 行内增删 aside 会撑开 stage 高度使 scroller 漂移，切换前后要暂存并恢复 scrollTop；控件显隐条件要和用户验收口径一致，单条数据也应有定位入口

### 19:11 | Codex

- done: 按截图要求把文档类型的分段控件改成只读类型文字 + 行尾文字按钮（转为普通文档 / 转为会话文档），保留锁解锁前置
- context: 用户明确要求不要分段控件，在类型行红框位置放文字按钮
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`

### 19:08 | Codex

- done: 最终收敛笔记属性面板：文档类型行 + 锁语义、来源字段可改可删、改链接不删身份字段、转普通文档只改类型
- context: 用户要求从用户视角和鲁棒性重审系统字段与用户字段的区分，并允许会话文档转普通 Markdown
- decision: 类型切换放在文档类型行；锁挂在笔记属性标题栏；来源/平台/采集时间在转换后保留为普通属性
- added:
  - `src/shared/utils/frontmatterPolicy.ts`
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/shared/utils/conversationFrontmatter.ts`
  - `src/shared/utils/conversationSource.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/main/services/conversationDocumentService.ts`
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 19:05 | Codex

- done: 统一 Markdown 笔记属性中系统字段与用户字段的交互：文档类型独立成行并可解锁切换，来源改链接不再隐式删除身份字段，转普通文档只改类型
- context: 用户质疑解锁后不能改来源类型、系统字段不能删；要求可把会话文档转成普通 Markdown 且不因改链接自动删预设字段
- decision: 系统字段按文档类型判定归属；类型行承载会话/普通文档切换；来源/平台/采集时间保留，source_key 在改链接后作为缓存保留
- added:
  - `src/shared/utils/frontmatterPolicy.ts`
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/shared/utils/conversationFrontmatter.ts`
  - `src/shared/utils/conversationSource.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/main/services/conversationDocumentService.ts`
  - `src/renderer/src/components/icons/AppIcon.tsx`
- unresolved: 需在 npm run dev 中手动验证锁/类型切换/改链接后原文入口与转普通文档

### 19:02 | Codex

- done: 优化旁注折叠控件：滚动时吸附视口顶部，展开不跳回文档顶部，栏头新增上/下一条旁注定位按钮
- context: 用户反馈折叠入口滚动后消失、展开会跳到文档顶部，并要求展开控件加快速定位箭头
- decision: 折叠入口按首行位置与滚动视口共同计算吸附位；展开栏头 portal 到编辑器根节点保持原位；按旁注纵向顺序循环定位 MarkNode
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `docs/prototypes/margin-notes-sticky.png`
- lesson(promoted): 吸附控件要同时读首行锚点与滚动容器视口，不能只按文档坐标 clamp；展开态控件 portal 目标必须是编辑器根节点而不是会滚动的旁注列

### 18:21 | Codex

- done: 收敛旁注交互：入口移到正文首行并默认折叠，展开栏头固定在滚动视口内，切换文档不再闪现旧评论卡
- context: 用户要求首行入口、琥珀色图标与紧跟数量、默认折叠，并追问滚动后能否关闭；同时报告切文档先闪评论卡
- decision: 折叠入口按正文首块测量并随文档滚动；展开栏头 portal 到编辑器根节点，定位到滚动视口顶部；评论浮层记录文档身份，侧栏按 workspaceRoot 与 relativePath 过滤
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `docs/prototypes/document-margin-comments.html`
  - `docs/prototypes/document-margin-comments-responsive-wide.png`
  - `docs/prototypes/document-margin-comments-responsive-narrow.png`
  - `docs/prototypes/document-margin-comments-responsive-narrow-open.png`
  - `docs/prototypes/document-margin-comments-responsive-wide-open.png`
  - `docs/prototypes/margin-notes-collapsed.png`
  - `docs/prototypes/margin-notes-expanded.png`
- lesson(promoted): 评论栏头放在随正文滚动的旁注列内，sticky 也会滚出可视区；必须挂到滚动层外并按滚动视口定位
- lesson(promoted): 切换文档的评论卡闪现要同时约束浮层身份和侧栏标注列表，两份异步状态都要校验当前文档

### 17:23 | Codex

- done: 补完窄屏旁注验收与细节收敛：入口固定在可见区顶部，窄屏选中标注不再触发正文选区工具条，宽屏旁注卡改为中性底色
- context: 窄屏截图暴露浮动格式条与入口随滚动漂移两个问题
- decision: 窄屏跳过选中标注的自动选区定位，由入口自身完成滚动；入口用滚动容器偏移补偿固定
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/assets/index.css`
- lesson(promoted): 旁注选中不应复用正文选区联动，否则浮动格式条会遮挡评论卡
- unresolved: 其他 worker 的 FrontmatterPanel 改动已合并并通过构建，无遗留

### 17:00 | Codex

- done: 工作台 frontmatter 按文档类型区分字段归属：会话来源字段只读、身份字段收进更多属性、用户属性自由编辑；面板改为按行区间写回，保留注释与未知字段。
- context: 业界调研（Obsidian/Logseq/Hugo/Joplin）支持扁平保留键 + 按文档类型 + UI 分组，不做命名空间迁移。
- decision: 保留扁平 YAML；来源地址可显式改写并失效 source_key/captured_at；已有来源时插入其他会话回复只提示冲突，不静默改来源；普通笔记仅字段集合仍像旧会话文档时才自动补类型。
- added:
  - `src/shared/utils/frontmatterPolicy.ts`
- modified:
  - `src/shared/utils/conversationFrontmatter.ts`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson: frontmatter 面板必须按字段行区间 patch，整块 parse/serialize 会丢注释和嵌套结构；多行列表要先按 span 解析，否则会被内联标签分支吞掉。
- unresolved: 需在 npm run dev 中手工验收：会话文档分组、断开来源、普通笔记同名属性冲突提示。

### 16:55 | Codex

- done: 移除工作台正文批注后的黄色小圆点，保留高亮和批注交互
- modified:
  - `src/renderer/src/assets/index.css`

### 16:42 | Codex

- done: 实现工作台旁注窄屏响应式布局：紧凑模式下旁注列退出横向布局，改用正文序号与浮动入口复用现有评论卡；宽屏旁注卡改为中性底色配琥珀色强调
- context: 用户在窄屏下旁注列挤压正文宽度；要求弹窗复用 AnnotationCommentCard，卡片不要整体黄色
- decision: 以编辑器 stage 可用宽度 960px 为断点；紧凑模式绝对定位浮层入口，不参与 flex 列；序号通过 data-annotation-index 写入 MarkNode DOM
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/assets/index.css`
- lesson(promoted): 在子组件 useLayoutEffect 读取父组件 ref 时，父 ref 可能尚未挂载；跨组件 DOM 尺寸观察应在 useEffect 中初始化 ResizeObserver
- unresolved: FrontmatterPanel.tsx 存在其他并行改动导致整体构建失败，本次验证使用临时隔离构建产物，未修改该文件

### 14:10 | Antigravity

- done: 恢复原位边距批注便签功能：删除旧注释侧边栏，实现原位展示/编辑/删除旁注
- decision: 注释直接在编辑器右侧以旁注便签（Margin Notes）原位呈现，随正文高亮行自动对齐避让，支持点击就地修改与直接删除，彻底删除抽屉式右侧栏 WorkbenchAnnotationPanel
- added:
  - `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx`
  - `src/renderer/src/components/workbench/workbenchAnnotationUtils.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- removed:
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPanel.tsx`

### 13:57 | Codex

- done: 按现有 AnnotationCommentCard 重构窄屏旁注浮层，并收敛旁注卡片的黄色使用：改为中性卡面、淡黄引用块与蓝色主操作按钮
- context: 用户认同宽度优先的双态方案，但要求点击浮层复用现有评论卡组件且不要整卡黄色
- decision: 窄屏点击高亮直接进入现有评论卡编辑态：标题为修改评论，新建为标注；保留引用块、输入框、删除/取消/保存层级。黄色仅用于正文高亮、引用块左边线和卡片左侧细描边
- modified:
  - `docs/prototypes/document-margin-comments.html`
  - `docs/prototypes/document-margin-comments-responsive-wide.png`
  - `docs/prototypes/document-margin-comments-responsive-narrow.png`
  - `docs/prototypes/document-margin-comments-responsive-narrow-open.png`

### 13:49 | Codex

- done: 将旁注便签原型改为按编辑区可用宽度自适应的双态布局：宽屏保留右侧原位便签，窄屏退出旁注列并改为行尾序号标记加单条浮层便签
- context: 用户反馈窄屏下固定宽度旁注容器压缩正文；本次只交付高保真 HTML 原型，未修改生产组件
- decision: 以编辑容器宽度 960px 为切换阈值；窄屏下旁注完全脱离横向布局，单条浮层按高亮位置避让，不再分走正文宽度
- added:
  - `docs/prototypes/document-margin-comments-responsive-wide.png`
  - `docs/prototypes/document-margin-comments-responsive-narrow.png`
  - `docs/prototypes/document-margin-comments-responsive-narrow-open.png`
- modified:
  - `docs/prototypes/document-margin-comments.html`

### 13:12 | Antigravity

- done: 修正注释设计：去除多人协作与复杂社交层级，重构为紧挨正文高亮、即点即改的极简个人笔记旁注 (Sidenotes) 原型
- decision: MultiChat Desk 为个人桌面笔记工作台，注释定位为纯粹个人随手笔记旁注；完全移除头像、作者名、楼中楼回复及解决流，直接紧挨对应高亮文本右侧以淡黄小便签形式原位展示，支持点击就地修改与划词原位新建
- modified:
  - `docs/prototypes/document-margin-comments.html`
  - `docs/prototypes/document-margin-comments.png`
  - `docs/prototypes/document-margin-comments-active-c3.png`
  - `docs/prototypes/document-margin-comments-dark-ai.png`
  - `docs/prototypes/document-margin-comments-draft.png`

### 12:56 | Antigravity

- done: 设计并验证文档右侧原位批注流 (Margin Comments) 原型，替代传统注释侧边栏
- decision: 摒弃传统抽屉侧边栏式注释面板，改用类似 Google Docs / 飞书文档的文档右侧边距行内流式批注（Margin Comments）；在屏幕宽裕时展开常驻并执行垂直碰撞避让，在窄屏或 AI 侧边栏开启时自适应收缩为行尾呼吸气泡药丸与 Popover 浮层
- added:
  - `docs/prototypes/document-margin-comments.html`
  - `docs/prototypes/document-margin-comments.png`
  - `docs/prototypes/document-margin-comments-active-c3.png`
  - `docs/prototypes/document-margin-comments-dark-ai.png`
  - `docs/prototypes/document-margin-comments-draft.png`
  - `scripts/capture-margin-comments-prototype.js`
- lesson(promoted): 自包含 HTML 原型在处理边距批注时，需基于容器可用宽度（ResizeObserver）设计双态自适应机制：宽屏平铺卡片流，窄屏收敛为行尾气泡角标，避免与多栏布局（如 AI 侧边栏）发生视口重叠与挤压

### 12:56 | Antigravity

- done: 修复工作台模式下编辑区右上角在侧栏折叠/展开时的圆角与直角逻辑
- decision: 反转 rightPane 对应的三元表达式，使右侧栏展开时编辑区右上角显示圆角（rounded-tr-xl），折叠时贴齐右侧窗口边缘显示直角（''），与左侧栏行为保持一致
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 12:28 | Codex

- done: 将标注相关图标统一收敛为单一语义名 annotation，并同步右键菜单、侧栏开关、浮动工具栏、标注卡片和旧笔记入口
- context: 用户要求标注图标统一使用截图中的消息框加号图标，且图标名只定义成一个，便于维护。
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAnnotationPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/NotesConversationCards.tsx`
- lesson(promoted): 同一业务图标必须使用单一语义名，不要保留 add_comment、sticky_note_2 等多个别名。

### 12:24 | Codex

- done: 修正工作台来源会话入口图标为对话气泡，并补齐标注右键菜单的 sticky_note_2 图标映射，消除警告三角回退
- context: 用户根据工作台截图要求：标题栏来源入口改为打开会话图标；右键菜单标注在侧边栏显示警告图标。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchTitleBar.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
- lesson(promoted): AppIcon 遇到未映射名称会回退为 AlertTriangle；新增右键菜单图标时必须同步检查 APP_ICON_MAP。

### 11:47 | Codex

- done: 清理删除旧笔记入口后验证脚本中的过期 mock API
- context: 独立代码验收发现三个浏览器验证脚本仍声明已删除的 onNotesNavigate/notesConsumeNavigation；属于低危残留，本轮一并删除
- modified:
  - `scripts/verify_workbench_frontend.py`
  - `scripts/verify_workbench_previews.py`
  - `scripts/verify_workspace_drag_drop.py`

### 11:43 | Codex

- done: 删除旧笔记模式顶部入口与文件树对话资料筛选及其兼容链路
- context: 用户确认当前已没有单独笔记模式，截图中顶部笔记和文件树对话资料均为旧链路残留；工作区仍有其他未提交改动，本次只改这两个入口相关代码
- decision: 保留工作台中的普通 Markdown 文档、会话资料写入与标注能力，仅删除独立笔记页导航、筛选 UI、自定义事件、导航 IPC 和仅供筛选使用的扫描 IPC
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/preload/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/conversationDocumentService.ts`
- unresolved: 当前会话未获授权使用 computer use，未在 npm run dev 桌面环境做人工视觉验收

### 11:36 | Codex

- done: 补充对话采集的可见媒体提取：在清理按钮/操作栏之前收集图片，并合并正文区之外的媒体，覆盖 Grok、千问、文心等图片型回复
- context: 运行中的 dev 进程锁定了 .dev-log7.txt，临时文件未能在不中断应用的情况下删除
- modified:
  - `src/shared/utils/webviewScripts.ts`

### 11:34 | Codex

- done: 统一对话采集文档为“## 你：/## 平台：”结构，清洗屏幕阅读器标签，补全多平台消息选择器与图片回复采集，修复原文高亮在导航/隐藏容器下的回显，并移除正文重复来源行
- context: 按用户要求只探索现有会话，不重新发送消息；Arena 按用户标注不做适配
- decision: 来源 URL 只保留在 frontmatter；原文高亮排除 sr-only 等隐藏文本，但不因通用 aria-hidden 容器误伤可见对话
- modified:
  - `src/shared/utils/noteTranscript.ts`
  - `src/main/services/conversationDocumentService.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
  - `src/renderer/src/hooks/useSourceAnnotations.ts`
  - `src/main/webviewManager.ts`
  - `docs/workbench-unified-notes-annotation-design.md`
- lesson: 不同平台的隐藏角色标签与图片生成卡片 DOM 不一致；原文锚点需按可见文本建索引，图片消息需在清理按钮前先提取可见媒体
- unresolved: Claude、Perplexity、ChatGLM 因登录/验证页未完成真实会话回归

### 11:32 | Codex

- done: 深度研究平台更新：doubao 从 DEEP_RESEARCH_SUPPORTED_MODEL_IDS 移除（selectors.ts 的 researchMode 配置此前已删除）
- modified:
  - `src/renderer/src/store/appStore.ts`

### 11:31 | Codex

- done: 深度研究平台更新：qwen 移除（千问已下线研究/深入研究入口），从 DEEP_RESEARCH_SUPPORTED_MODEL_IDS 删 qwen
- modified:
  - `src/shared/config/selectors.ts`
  - `src/renderer/src/store/appStore.ts`

### 11:30 | Codex

- done: 深度研究平台更新：Grok 移除（入口已下架），yuanbao 加入支持列表并修正 researchMode（开启后原 application_id_deep_research 按钮消失，替换为激活 chip + aria-label 移除钮）
- modified:
  - `src/shared/config/selectors.ts`
  - `src/renderer/src/store/appStore.ts`
- lesson: 元宝深度研究用 data-application-id 做稳定语义钩子（application_id_deep_research），开启后原按钮被替换为激活 chip + 独立 aria-label 移除钮，enable/cancel 需要覆盖两种状态

### 11:24 | Codex

- done: 更新深度研究支持列表：DeepSeek 已无深度研究（researchMode 配置移除、从 DEEP_RESEARCH_SUPPORTED_MODEL_IDS 删 deepseek）；Kimi 通过 /deep-research 路由实现深度研究，新增 researchMode steps/cancelSteps 及 AutomationStep.skipIfExists 幂等守卫；kimi 加入支持列表
- context: Kimi 深度研究以独立路由 /deep-research 呈现，composer 出现 div.tool-switch.open 标记开启态，svg.close-icon 仅 hover 可见但 click 派发可触发关闭
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/store/appStore.ts`
- lesson: Kimi 站点的 Vue SPA 用 .tool-switch.open class 标记开关状态而非 aria-pressed；启用链路需要在两个不同页面状态（首页有 shortcut 入口 / deep-research 页已有开关）下都能幂等成功

### 02:44 | Codex

- done: 深度评审并优化工作台模式内存占用：AI 侧栏离开/隐藏后延迟休眠、恢复后等待就绪；导图/标注按首次打开懒挂载；图片改流式 URL；PDF 改受信 IPC Range；补充忙状态守卫并完成独立开发版验收。
- context: Workbench 页面常驻、AI 历史平台只 display:none、图片/PDF 走 base64 导致峰值内存高；用户要求独立 Worker 在实际开发版验收方案是否最佳。
- decision: 采用最小充分方案：保留 WebviewCard 契约，用 about:blank suspend 释放页面层；不为空白 Guest 立即引入 LRU/卸载，避免会话 URL 与草稿丢失；PDF 不用自定义协议 CORS 暴露，改 IPC Range。
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/workbenchService.ts`
  - `src/preload/index.ts`
  - `src/renderer/index.html`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): 本地文件预览不要给自定义 scheme 开启 corsEnabled/跨源 fetch 面；PDF 用受信 IPC Range，并注意 PDF.js 的 range 为 end-exclusive，而 IPC 底层闭区间需传 end-1。
- lesson(promoted): about:blank 休眠只释放页面层 V8 堆/DOM，不销毁 Guest WebContents/进程底座；多平台累计空白 Guest 是后续容量治理问题，不能宣称绝对无成本。
- unresolved: 空白 Guest 的逐平台进程底座仍会累计；如后续确需彻底释放，应单独设计可恢复 URL/草稿/附件的 LRU 或卸载方案并独立验收。

### 01:29 | root

- done: 修复历史笔记迁移不收敛与误标完成：空 v2 工作台记录不再计入待迁移，工作台目标文档缺失时转阻塞，迁移进度持久化，完成前回读校验，暂停竞态与任务级暂停收口，设置页显示阻塞原因并提供直接重试
- context: 用户反馈历史遗留笔记未迁移到默认库；默认库实际已有 34 篇文档/33 条标注/18 张导图，问题在 3 条临时工作台记录误标完成、job.completed=0、5 条新格式空记录反复待迁移
- decision: 只对系统临时目录下已消失的工作区重开迁移，普通工作区用户删除文档不复活；新增 verify-failed 区分普通会话回读失败与 workbench-unresolved
- modified:
  - `src/main/services/legacyMigrationService.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-unified-notes-annotation-design.md`
- lesson(promoted): 迁移枚举器必须跳过无正文/批注/导图且无标记的新格式记录，否则 pending 永不收敛
- lesson(promoted): 写 migratedAt 前必须回读文档、旁路和导图；写入调用成功不等于目标存在
- unresolved: 10 条 source 标注的锚点文本不在迁移后正文中，侧栏显示未定位；记录仍保存在 sources/，需另行设计快照差异提示或重新采集

## 2026-11-21

### 23:56 | Antigravity

- done: 修复工作台左栏文件树与搜索空状态占位图标未居中对齐的问题
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
- lesson(promoted): AppIcon 渲染为 SVG，赋予 block 类名后脱离父级 text-center 影响，必须配合 mx-auto 或父级 flex flex-col items-center 方可实现水平居中对齐

### 23:45 | Codex

- done: 修复工作台本地文件链接被补成 https:// 且 Ctrl+点击无法跳转
- context: Lexical LinkNode 会对无协议地址调用 formatUrl，普通文件名会被当成网址；点击插件此前只放行 http/https
- decision: 仅在识别为工作区本地文件时保留相对路径语义，并按当前文档目录解析后调用工作台 openFile；外部 HTTP 链接保持原行为；链接目标不存在时保留当前文档
- added:
  - `src/renderer/src/components/workbench/workbenchLinks.ts`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchUrlInputPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchLinkClickPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchLinkHoverPlugin.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson(promoted): Lexical LinkNode 出于安全会给无协议 URL 补 https://；Markdown 本地文件链接必须在进入 LinkNode 前保留 ./ 等相对路径语义，点击层再按当前文档目录解析，不能把 anchor 的绝对 href 直接交给浏览器
- unresolved: 未进行 npm run dev 下的真实鼠标 Ctrl+点击验收；需打开含本地 .md 链接的笔记确认悬停地址无 https:// 且点击后切换到目标文档

### 23:39 | Antigravity

- done: 调整大纲位置至左侧、移除标签前蓝点并优化展开药丸阴影
- decision: 大纲挂载位置由右侧切换到左侧（left-3.5，items-start，origin-left）；移除 Hover 展开时的前缀蓝点，改为直接呈现 Hx 层级标签；将暗沉弥散阴影替换为通透轻盈的高清投影（shadow-[0_2px_10px_rgba(0,0,0,0.08)]）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx`
  - `docs/prototypes/minimalist-toc-showcase.html`

### 23:30 | Antigravity

- done: 开发并集成 Markdown 预览模式下的极简原位变形大纲导航组件 (WorkbenchMinimalToc)
- decision: 封装独立组件 WorkbenchMinimalToc，以 100% 透明无边框容器置于编辑器右侧，通过 Lexical 订阅提取 H1~H6 标题，静止时为层级线段，悬停时原位展开为标题胶囊并联动上下线段弹性避让；ScrollSpy 实时追踪阅读小节，点击平滑滚动并附加脉冲聚焦
- added:
  - `src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/assets/index.css`

### 23:28 | Codex

- done: HTML 表格预览支持直接修改已有单元格内容，保持行列表格结构和 rowspan/colspan 不变
- context: Lexical DecoratorBlockNode 内嵌 contentEditable 单元格；失焦或 Ctrl+S 时安全回写单元格 HTML
- modified:
  - `src/renderer/src/components/workbench/WorkbenchHtmlTableNode.tsx`
- lesson(promoted): DecoratorBlockNode 内编辑单元格时要在 focus 记录基线、blur 再提交，避免输入过程中触发节点重渲染导致光标跳动；只替换目标单元格内容，不提供行列结构编辑

### 23:27 | Codex

- done: 修正工作台文件树隐藏规则：.gitignore/.gitattributes/.gitmodules 等 Git 元文件不再显示，未被忽略的点号目录继续显示
- context: 上一轮改为按 Git 真实忽略结果过滤后，原本被'点开头即隐藏'覆盖的 .gitignore/.gitattributes 暴露在文件树中
- decision: 新增 GIT_META_FILE_NAMES 名单，在文件树/搜索过滤与外部导入拦截中一并生效；.gitignore 编辑仍走工作区设置入口
- modified:
  - `src/main/services/workbenchService.ts`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 放宽'点开头即隐藏'后，必须显式保留被旧规则顺带覆盖的 Git 元文件，否则配置文件会混入工作区内容树

### 23:20 | Antigravity

- done: 对齐 MultiChat Desk 设计系统，实现横线原位变形标题与无边框透明大纲交互原型
- decision: 采用完全透明无边框容器（border:none, bg:transparent），实现横线原位膨胀为标题药丸，并通过弹性微波与物理风琴两种模式实现上下相邻线段平滑避让，解决鼠标高速划过时的抖动脱靶问题
- modified:
  - `docs/prototypes/minimalist-toc-showcase.html`

### 23:17 | Codex

- done: 工作台文件树改为按 Git 真实忽略结果过滤：未被 .gitignore 忽略的点号目录（.agents/.claude/.memory）正常显示，被忽略路径与依赖缓存目录不显示
- context: 原规则为 name.startsWith('.') 即隐藏，导致 .agents 等无法在管理界面查看；项目已依赖系统 Git
- decision: 忽略判定交给 git ls-files --others --ignored --exclude-standard --directory，避免自行实现 gitignore 匹配；.git/.multichat/.trash 与 node_modules 等依赖缓存仍无条件隐藏
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/services/gitService.ts`
- lesson(promoted): git ls-files --others --ignored --exclude-standard --directory 在子目录执行时返回相对工作区的路径，可直接用于文件树过滤；整目录被忽略折叠为 dir/，目录内有已跟踪文件时返回其中被忽略的具体文件

### 23:14 | Codex

- done: 修复工作台 HTML 渲染预览中划词右键无菜单：主进程捕获 iframe 选区并接入现有 AI 划词菜单
- context: HTML 预览运行在 workbench-file:// 的 sandbox iframe 中，DOM 右键事件不会冒泡到宿主 renderer
- decision: 仅在 frameURL 属于 workbench-file:// 且存在选区时转发；普通页面和 webview 右键链路保持不变
- modified:
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/shared/types/contextMenu.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`
- lesson(promoted): 跨源 sandbox iframe 的右键选区应通过 BrowserWindow.webContents 的 context-menu 事件获取，再经 IPC 交给宿主自绘菜单；不要依赖 iframe 内 DOM 事件冒泡

### 23:11 | Antigravity

- done: 调研 Markdown 极简导航方案并完成可交互高保真原型设计
- decision: 针对极简导航方案客观分析横线 hover 缺陷（零预知性/扫雷试探），提出横线骨架、幽灵侧轨、浮动胶囊、滚动条雷达与自适应混合等五种方案，并构建自包含交互原型验证分屏适应力
- added:
  - `docs/prototypes/minimalist-toc-showcase.html`

### 23:07 | Codex

- done: 工作台 Markdown 富文本模式支持渲染 HTML table，并保留原始 rowspan/colspan HTML 源码
- context: Markdown/Lexical 双向转换链路；HTML 表格块通过安全白名单渲染为只读表格
- added:
  - `src/renderer/src/components/workbench/WorkbenchHtmlTableNode.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson(promoted): Lexical Markdown 导入不支持原生 HTML 表格；块级 HTML 可先用占位标记转成 element transformer，再由 DecoratorBlockNode 保留原文并渲染

### 22:44 | Codex

- done: 按功能模块分 9 批提交工作区全部改动：导图文件化绑定（mindmapFileService+mindmapFile）、导图保存主链路与 IPC、导图面板文件态、文件树/Vault/footer UI、Markdown 链接能力、.gitignore 整段编辑、目录改名 EBUSY 重试、webview 注入 generation 收敛、统一笔记标注设计文档与日志
- context: 用户要求提交修改，沿用分模块提交偏好
- decision: 过程产物 .dev-log*.txt 与验收截图 workbench_*.png 不入库，留作 untracked
- modified:
  - `见 9 个提交 e44ec5e..3b46995`

### 22:42 | Codex

- done: 按双根模型修订工作台统一笔记与标注设计：默认会话库、工作台内外捕捉路由、英文 conversations 目录、迁移目标与幂等重试
- added:
  - `docs/workbench-unified-notes-annotation-design.md`
- modified:
  - `docs/DOCS_INDEX.md`

### 22:22 | Codex

- done: 完成工作台思维导图方案A收尾：文件即索引，修复换盘/改名记录认领、无记录时只读壳、自写watcher漏广播、迁移同id改绑、删除前重读校验、子目录提示、复制漏图，并修复启动恢复已删PDF报ENOENT
- context: 用户要求方案A（删除index.json，文件即索引），并要求独立worker验收；gitignore由用户自行决定，未改动
- decision: 旧根认领按卷根是否在线区分改名与离线；watcher按size+mtime+首尾抽样指纹比对而非时间窗；只读壳首次写操作时补建记录
- modified:
  - `src/main/noteManager.ts src/main/services/mindmapFileService.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/src/components/ConversationMindmapPanel.tsx src/renderer/src/store/workbenchStore.ts docs/workbench-mindmap-file-binding-design.md .memory/KNOWLEDGE.md`
- lesson: Windows上目录改名与盘符离线文件级stat都返回ENOENT，必须用卷根是否可访问区分
- lesson: 按时间窗抑制watcher自写事件会吞掉紧随其后的外部修改，应按文件指纹比对
- unresolved: 需在npm run dev中手工验证：外部改导图冲突横幅、换盘后批注认领、只读壳下AI调整、应用外改名跟随

### 22:11 | Codex

- done: 补强工作台导图会话复用：按 mapId 保存进程内最近生成页，避免多张导图互相覆盖 lastPage
- modified:
  - `src/main/services/MindmapService.ts`

### 22:10 | agent

- done: 工作台链接光标改为按修饰键显示：编辑态普通 hover 保持文本光标，按住 Ctrl/Cmd 才切换为手形；只读态仍直接显示手形。
- context: 用户反馈链接 hover 直接出现手形，与需要 Ctrl/Cmd+点击才打开的交互不一致。
- decision: 由 WorkbenchLinkClickPlugin 在编辑根节点上维护 data-workbench-link-cursor，并在 keydown/keyup、pointer 事件、窗口失焦和可编辑状态变化时同步，CSS 只在该标记存在时赋予 pointer。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchLinkClickPlugin.tsx`
  - `src/renderer/src/assets/index.css`

### 22:08 | Codex

- done: 修复工作台导图追加修改不复用生成会话：modify 优先复用 lastPage 保留的会话地址，恢复成功时不再上传来源文件
- context: 工作台导图文件不持久化 generationSession；空闲网页释放后仅剩 lastPage 可用
- modified:
  - `src/main/services/MindmapService.ts`
- lesson(promoted): 工作台导图追加修改不能在读取 map.generationSession 后才决定恢复；文件型导图缺少会话字段时，应先复用 lastPage 的绑定再考虑新建对话

### 22:06 | agent

- done: 工作台链接交互收尾：裸链接按显示文字是否为 URL 判定，去掉常驻下划线且不弹 hover 提示；粘贴整段仅为裸 URL 时即使剪贴板带 HTML 也立即转成 AutoLinkNode，无需刷新文档；文字链接保持常驻下划线并显示 URL 提示。
- context: 用户反馈文字链接仅 hover 有下划线、裸链接不应弹提示，以及直接粘贴裸链接需重开文档才识别。
- decision: 视觉区分按显示文字语义判定而不是按 AutoLinkNode 节点类型，避免用户编辑链接文字后样式失真；富文本粘贴仅在内容并非裸链接时交给 Lexical 默认处理。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchLinkPastePlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchLinkHoverPlugin.tsx`
  - `src/renderer/src/assets/index.css`
- unresolved: 尚未在 npm run dev 桌面端手动点击验收粘贴、Ctrl+点击和 hover 提示，构建与静态检查已通过。

### 22:02 | root

- done: 补充工作台统一笔记与标注设计的保存路径、旧数据迁移与迁移期只读规则，并根据两轮独立审查闭环 P0/P1
- context: 用户追问自动捕捉会话的保存路径如何确定，以及旧数据迁移是否覆盖；当前只改设计文档，未改生产代码
- decision: 自动捕捉始终跟随当前工作区，归档目录只允许工作区内相对路径；默认工作区固定回落，v1 不提供设为默认；旧迁移使用独立原始枚举器和只读快照，legacyMigrationJob 锁定目标工作区
- added:
  - `docs/workbench-unified-notes-annotation-design.md`
- modified:
  - `docs/DOCS_INDEX.md`
- lesson(promoted): 旧 NoteManager.list() 会合并同源记录、按 quote 去重并 rm 旧 JSON；迁移和旧页读取必须走只读原始快照，不能复用 list()

### 21:59 | Codex

- done: 调整工作台链接交互：编辑态普通点击定位光标，Ctrl/Cmd+点击或中键打开外部链接，只读态直接点击打开；同时抽出统一裸链接识别规则，粘贴纯文本裸 URL 时立即转为 AutoLinkNode。
- context: 用户反馈直接点击链接会误跳转，且粘贴裸链接需重新打开文档后才识别。
- decision: 链接点击按编辑态/阅读态区分而不是按裸链接/文字链接区分；粘贴仅在无 HTML、无附件且非代码/链接上下文时自行插入 AutoLinkNode，避免影响富文本粘贴。
- added:
  - `src/renderer/src/components/workbench/WorkbenchLinkClickPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchLinkPastePlugin.tsx`
  - `src/renderer/src/components/workbench/workbenchBareLinks.ts`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 21:49 | Codex

- done: 修复工作台 Markdown 链接能力：预览/源码模式改为应用内链接弹层，支持新增、编辑、移除链接；链接常态显示下划线；文字链接 hover 显示 URL，裸链接不弹提示；Markdown 导入支持裸 URL 渲染并保持裸链接回写。
- context: 用户反馈浮动工具栏链接按钮无法输入具体链接，预览不支持裸链接，且链接仅 hover 时才有下划线。
- decision: 复用通用 URL 弹层服务 Lexical 与源码 textarea；裸链接用 AutoLinkNode 导入，文字链接保留 LinkNode 与 hover 提示。
- added:
  - `src/renderer/src/components/workbench/WorkbenchLinkEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchLinkHoverPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchUrlInputPopover.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
  - `src/renderer/src/assets/index.css`
- lesson(promoted): Lexical Markdown transformer 导出 AutoLinkNode 时不能直接用 exportChildren 的结果与 URL 比较：exportTextFormat 会转义下划线等字符；应使用 getTextContent() 判断纯文本裸链接并原样输出。

### 21:36 | Codex

- done: 按两轮独立审查意见修订工作台统一笔记与标注设计：source/document 分库存储、记录级 IPC、标准 Markdown 转换、5MB 边界、迁移幂等、旧页写保护与验收闭环
- decision: source 标注按 sourceKey 存工作区级 sources 文件，document 标注按路径存 documents 文件；原文回显只查当前工作区；标注采用记录级 upsert/delete，不做整表隐式删除
- modified:
  - `docs/workbench-unified-notes-annotation-design.md`
  - `docs/DOCS_INDEX.md`
- lesson: 设计文档里 source 标注不能绑在文档生命周期上；MarkNode 是单 block inline 节点，应用标注必须用专用 tag 防止 Markdown 回写
- unresolved: 进入实现前需先验证 Lexical MarkNode 往返、source 投影异步生命周期、迁移幂等与 5MB 边界

### 21:34 | Codex

- done: 修复工作台目录重命名遇到 Windows EBUSY 时直接失败的问题，增加短重试与持续占用提示
- context: 用户截图显示 rename 'D:\DMX-Vault\AI 编程实战' -> 'D:\DMX-Vault\AI Coding'；句柄检查确认 VS Code workspace（AI 编程实战）及 Markdown/NodeService 子进程持有目录句柄，MultiChat 主进程仅持有 Vault 根目录监听句柄；Google Drive 同时在该 Vault 活跃
- decision: 只在 Windows 对 EBUSY/EPERM/EACCES 做 80/160/320/640/1000ms 退避重试；EBUSY 持续存在时返回可操作提示，不采用复制后删除等破坏性兜底
- modified:
  - `src/main/services/workbenchService.ts`
- lesson: Windows 目录重命名 EBUSY 应先检查外部目录句柄，再在应用层做短重试；VS Code 将子目录作为 workspace 打开会持续占用该目录
- unresolved: 当前 npm run dev 主进程仍运行旧构建；需重启应用并在关闭占用该目录的 VS Code 窗口后做一次真实改名复验

### 21:24 | Antigravity

- done: 优化工作台文件与文件夹命名方式：移除弹窗改为VSCode式内联命名，边框统一微圆角(rounded-[3px])，重命名高亮区间避开文件后缀名，支持F2/Enter/Esc/Blur/IME
- decision: 重命名交互完全对齐VSCode：直接在树节点原位展开输入框并保留原有图标；圆角由容易形成胶囊状的全局rounded(12px)改为精致微圆角rounded-[3px]；重命名选中区间排除扩展名避免误删；支持F2快捷键与中文输入法composition守卫
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 21:23 | Codex

- done: workbench 文件树右键菜单新增'复制文件路径'(绝对路径)
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 21:11 | Codex

- done: 产出工作台统一笔记与标注设计文档，明确 Markdown 文档唯一对象、source/document 两种标注锚点域、旁路存储与迁移方案
- decision: 标注统一为一种数据结构，用 scope 区分原文 DOM 回显与 Lexical 文档渲染；正文归 Markdown，标注归 .multichat/annotations 旁路文件
- added:
  - `docs/workbench-unified-notes-annotation-design.md`
- modified:
  - `docs/DOCS_INDEX.md`
- unresolved: 待独立 worker 审查文档后按意见修订

### 21:01 | Codex

- done: 排查工作台导图保存报错：确认 AI 大纲已生成，失败发生在本地保存；现场主进程早于最新构建，当前源码隔离保存通过
- context: 工作台导图保存报错 Cannot read properties of undefined (reading 'set')
- removed:
  - `tmp/cdp-eval.mjs`
  - `tmp/electron-stub.cjs`
  - `tmp/mindmap-save-repro.ts`
  - `tmp/mindmap-save-repro.mjs`
  - `tmp/mindmap-repro.md`
- lesson: Electron 主进程不随渲染层 HMR 更新；排查主进程报错先核对进程启动时间与 out/main 构建时间，并重启完整应用复验

### 20:31 | Codex

- done: 知识库沉淀文档来源 resolveId 与 HTML 原文件上传经验，并完成 tsc/lint/build 验证
- modified:
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson(promoted): 文档来源读记录前必须先 resolveId 换 UUID，否则首次打开侧栏即报无效笔记 ID

### 20:29 | Codex

- done: 修复工作台文档首次打开思维导图提示无效笔记ID；HTML 接入原文件上传并在上传前保存当前编辑
- context: 工作台未建档时 source.id 是文件路径，直接传给 notesGet 会命中 UUID 校验
- decision: 文档来源统一先 resolveId 建档再读记录；HTML 可编辑但按原文件上传，记录仍用文本哈希
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
  - `src/main/ipcHandlers.ts`
  - `src/main/noteManager.ts`
  - `src/shared/utils/mindmap.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/services/AutomationService.ts`
  - `src/shared/types/notes.ts`
  - `src/preload/index.ts`
- lesson(promoted): 文档来源在记录建立前只有路径，任何 notesGet 必须先 resolveId 拿 UUID
- lesson(promoted): 可编辑的 HTML 走原文件上传时先落盘再上传，版本哈希仍按文本计算
- unresolved: 尚未在 npm run dev 桌面环境做真实平台上传验收

### 19:59 | Codex

- done: 统一思维导图生成提示词为单套输出协议，对话附件名改为按首条提问生成（平台占位标题只作兜底）；工作台 PDF/Word/PPT 改为原文件上传生成与修改，并补齐二进制来源的版本指纹与选区处理
- context: 用户要求先评估两套输出格式是否必要、为何附件仍是 source-conversation 命名，再按方案接入 PDF/Word/PPT 原文件生成
- decision: 提示词共用 mindmapOutputFormat，不再维护两份格式；文本材料统一 .md，PDF/Word/PPT 不读正文、按原文件上传；工作台二进制来源用 size+mtime 指纹判定版本
- modified:
  - `src/shared/utils/mindmap.ts`
  - `src/shared/utils/mindmapEdits.ts`
  - `src/shared/types/notes.ts`
  - `src/preload/index.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/noteManager.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
- lesson(promoted): 同名附件只在输入框已有同名项时才加短后缀，否则附件数增加已足够判定本轮新增；临时副本须等平台解析稳定后再删
- lesson(promoted): 工作台 PDF/Word/PPT 不能按 UTF-8 读正文；复制与改名判定都要走二进制指纹，扩展名需覆盖 docm/pptm
- unresolved: 尚未在 npm run dev 桌面环境做真实平台上传验收；需分别验证 PDF/Word/PPT 在各平台的附件解析与修改链路

### 19:48 | Antigravity

- done: 精简底部操作栏，去除冗余的新建知识库按钮，保留单一清晰的打开本地文件夹按钮
- decision: 系统文件选择框自带创建文件夹能力，两个按钮底层行为完全一致，消除功能重复只保留一个明确的打开本地文件夹按钮
- modified:
  - `src/renderer/src/components/workbench/WorkbenchVaultPopover.tsx`

### 19:41 | Codex

- done: 工作台思维导图面板：打开侧栏即建档，无中间按钮页直接进入生成界面
- decision: 把『为这篇文档生成导图』中间页删掉，改为面板挂载时直接 create=true 建档后渲染 ConversationMindmapPanel；workbench 类记录不进 NotesPage 列表所以不会污染；给 MindmapSource 加 resolveId 兜底外部删除场景
- modified:
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx;src/renderer/src/components/ConversationMindmapPanel.tsx`

### 19:39 | Antigravity

- done: 对齐原型设计：彻底移除关闭当前工作区按钮与顶栏副标题，将底部按钮调整为单行并排的打开本地文件夹与新建知识库
- decision: 知识库管理是切换与打开操作，不设关闭工作区进入空态；弹窗完全还原原型设计
- modified:
  - `src/renderer/src/components/workbench/WorkbenchVaultPopover.tsx`

### 19:19 | Antigravity

- done: 重构知识库管理与切换UI为单层一体化浮层，消除二级弹窗，支持即时切换、路径查看、在资源管理器中打开、复制路径与移除
- decision: 采用方案A精简版：原位一体化浮层，默认库标预设标签，去除多余搜索框与沙箱/分支标注，统一Home/Folder规范化图标
- added:
  - `src/renderer/src/components/workbench/WorkbenchVaultPopover.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 19:04 | Codex

- done: 工作台左栏底部弹层（切换工作区/管理仓库/版本管理/工作区设置）宽度跟随 leftPaneWidth，取代固定 420px，拖动分隔条实时贴合
- context: 用户反馈：工作台左侧栏底部几个设置弹层宽度应跟随侧栏，更一体
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 19:00 | Codex

- done: 复核并收敛导图菜单图标改动范围
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
- lesson: 用户要求只改图标含义对不上的菜单项时，需按截图中的每个图标逐项判断并严格限定改动范围；发现同类问题在别处也存在时，除非用户明确扩大范围，否则不要顺手修改。

### 18:59 | Codex

- done: 优化导图菜单图标语义
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`

### 18:53 | Codex

- done: 记录工作区设置 UI 重设计的知识提升与验证结果
- modified:
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson: 表单区块的可用性应以数据是否已读到为准，而不是依赖另一个异步状态先完成，避免无意义的加载占位。

### 18:52 | Codex

- done: 重新设计工作区设置弹窗，移除卡片套卡片并合并保存入口
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson(promoted): 设置弹窗应在一个面板内用分区、间距和分隔线建立层级；复选框网格与输入控件不要各自描边形成嵌套卡片。

### 17:47 | Antigravity

- done: 修复工作台侧边栏在较小窗口下加载截断及拖拽高频IPC写盘性能问题
- decision: 中栏min-w放宽至380px，右栏增加maxWidth硬件级保底，clampRightPaneWidth动态计入视口与左栏折叠态，pointermove与持久化写盘解耦（仅在pointerup触发单次写入），resize监听接入rAF单向收敛
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
- lesson(promoted): 三栏Flex布局中不可将多栏全部设为不可收缩的硬性尺寸（shrink-0与大min-w），否则总宽度超出视口时排在最后的侧边栏必被截断；Splitter拖拽事件中每帧调用IPC持久化写盘是严重性能隐患，必须将内存更新与落盘解耦

### 17:13 | Codex

- done: 验证点击拦截注入收敛并补强幂等：按文档 generation 去重、注入中触发排队重试、跳过 about:blank，实测每 webview 仅 1 次注入
- modified:
  - `src/main/webviewManager.ts`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson(promoted): 只留 dom-ready 会失去失败重试；按文档 generation + pendingSource 排队可在不空转的前提下保留兜底

### 16:38 | Codex

- done: 工作台思维导图文件绑定：P0-P2 全量修复并通过两轮独立 worker 验收（可交付）
- decision: 导图文件扁平存 .multichat/mindmaps/*.mindmap.md(frontmatter id/source/title+markdown 正文), 索引 .multichat/index.json 只补缺不覆盖; read() 与 readWithMindmaps() 拆分防组装值写回磁盘复活已删导图; 删除先文件后索引; 导图 IPC 校验 isAuthorizedWorkspaceRoot; 对齐与删除均校验 id+source+正文一致才动手
- added:
  - `src/main/services/mindmapFileService.ts`
  - `src/main/services/workbenchMindmapIndex.ts`
  - `src/shared/utils/mindmapFile.ts`
- modified:
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/workbenchService.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/shared/types/notes.ts`
  - `docs/workbench-mindmap-file-binding-design.md`
- lesson(promoted): noteManager serial 队列不可重入(内部 public 方法不得在 serial 内再调包 serial 的方法); read() 返回值会被写路径透传到 write(), 读路径组装的数据必须隔离到专用读法; 文件存在性判断要用 stat 而非读文件失败(读失败含 EACCES 会被误判为不存在)

### 16:21 | Codex

- done: 设置页远程仓库区块在已读到远程配置时直接可编辑，不依赖 Git 状态先加载；最终 lint、tsc、build 全部通过
- context: 最后复查设置页状态边界，避免 gitStatus 未就绪时显示读取中占位。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: 表单区块的可用性应以数据是否已读到为准，而不是依赖另一个异步状态先完成，避免无意义的加载占位。

### 16:19 | Codex

- done: 修正 footer 分支名回退：upstream 按 remoteName 剥离前缀，避免 feature/foo 被截成 foo；设置页远程仓库在未启用 Git 时也保持置顶占位
- context: 复查分支名回退时发现 origin/feature/foo 只取最后一段会丢层级；设置页需要任何状态下都保持远程仓库在最上面。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: 从 upstream 推导分支名不能只取最后一段，必须剥离 remoteName 前缀；设置页首块在加载/不可用状态也要占位，避免布局跳动。

### 16:18 | Codex

- done: 工作台导图文件化：.multichat/index.json + .multichat/mindmaps/*.mindmap.md 落地，索引按 id 对齐、改名/删除跟随、对账三闸门、导出/回读/重建 IPC、面板状态与菜单、迁移旧记录
- added:
  - `src/shared/utils/mindmapFile.ts`
  - `src/main/services/mindmapFileService.ts`
  - `src/main/services/workbenchMindmapIndex.ts`
- modified:
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/notes.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`

### 16:17 | Codex

- done: 收紧 footer Git 按钮热区并统一弹层：分支名改为有界动态宽度、设置页远程仓库置顶、忽略规则单层滚动与三列快捷项，切换工作区补统一标题栏
- context: 用户反馈 Git 图标与设置图标间距过大、分支名不显示，并要求设置页与其它弹层样式统一。
- decision: Git 按钮不再占 52% 宽度；分支名 min-w-[2.5rem] max-w-[96px] 截断，完整名称保留在 tooltip 与弹层副标题。设置页去掉内层滚动，分类快捷项压缩为三列单行。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson: footer 按钮用 max-w 百分比会把剩余空间做成空白热区，把相邻图标推远；状态文本应使用有界动态宽度而不是纯 flex-1 或固定槽位。

### 16:04 | Codex

- done: 修复 Git footer 分支名为空；工作区设置改为远程仓库置顶与 .gitignore 整段文本编辑，并同步 IPC 契约
- context: 用户反馈 footer 不显示分支名，并要求设置页远程仓库置顶、忽略规则改为可直接编辑的 textarea。
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: Git 分支名可能为空字符串，空值回退要用 trim() || fallback；footer 空间紧张时给分支名保底宽度，避免被压成零宽。.gitignore 编辑器以整段原文为事实来源，分类勾选只做文本增删。

### 16:01 | Codex

- done: 收敛 webview 点击拦截注入：只保留 dom-ready 触发，跳过非 http 文档，仅在真正注入时打日志
- decision: 保留 DOM 注入而非改用 will-navigate 白名单：click 捕获是外链拦截的唯一可靠点，主进程 will-navigate 无法阻止同页 <a> 默认导航且白名单需跨 13 个平台维护
- modified:
  - `src/main/webviewManager.ts`
- lesson(promoted): 同一 webview 文档只需在 dom-ready 注入一次，did-finish-load/did-frame-finish-load 会被页面内幂等守卫挡掉，只产生空转的 executeJavaScript 与日志

### 15:55 | Codex

- done: 工作台导图文件化设计文档收尾（验收编号重排 1-63、接口与状态机对齐、DOCS_INDEX 收录）
- decision: 最终方案：导图落 .multichat/mindmaps/*.mindmap.md；索引为工作区 .multichat/index.json（不存 conversationId，按 source 归属）；frontmatter 只保留 id/source/title；正文与绑定冲突一律不自动选边
- modified:
  - `docs/workbench-mindmap-file-binding-design.md`
  - `docs/DOCS_INDEX.md`
- lesson: 设计文档里的验收清单编号必须唯一且连续，否则逐条验收时会漏项；跨段落引用的状态名与 reason 枚举要与状态机保持单一来源
- unresolved: 尚未实现；需按 §13 改动清单落地，并在 npm run dev 中逐条走 §14 的 63 项验收

### 15:55 | Codex

- done: 统一工作区 footer 三类弹层：共用 420px 锚定弹层容器与标题栏，Git 状态采用动态截断并补充完整状态 tooltip
- context: 用户指出 Git 按钮需明确展示信息与宽度策略，且 Git、设置、仓库管理弹层样式和宽度不一致。
- added:
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: footer 弹层统一用锚定容器和共享标题栏，避免各弹窗各自定义宽度与定位；Git 状态用固定状态徽标 + 可截断分支名，不按静态总宽度设计。

### 15:54 | Codex

- done: 工作台导图文件化与相对绑定设计文档（含独立审核两轮修订，补 DOCS_INDEX 索引）
- decision: 导图正文落 .multichat/mindmaps/*.mindmap.md，索引为工作区 .multichat/index.json，绑定用 frontmatter 的 source 相对路径；正文与绑定冲突一律不自动选边
- modified:
  - `docs/workbench-mindmap-file-binding-design.md`
  - `docs/DOCS_INDEX.md`
- lesson: 同一条绑定同时存在于 JSON 与文件时，必须指定唯一权威并让另一方只做缓存；用可变快照字段做比对会让校验永远成立
- unresolved: 尚未实现；需要按 §13 改动清单落地，并在 npm run dev 中逐条走 §14 的 63 项验收

### 15:54 | Codex

- done: 工作台导图文件化与相对绑定设计文档（含独立审核两轮修订）
- decision: 导图正文落 .multichat/mindmaps/*.mindmap.md，索引为工作区 .multichat/index.json，绑定用 frontmatter 的 source 相对路径；正文与绑定冲突一律不自动选边
- modified:
  - `docs/workbench-mindmap-file-binding-design.md`
- lesson: 同一条绑定同时存在于 JSON 与文件时，必须指定唯一权威并让另一方只做缓存；用可变快照字段做比对会让校验永远成立
- unresolved: 尚未实现；需要按 §13 改动清单落地，并在 npm run dev 中逐条走 §14 的 63 项验收

### 15:44 | Codex

- done: 工作区 Git：gitignore 改为按类型复选分类，压缩包与 IDE 配置改为可选，修复刷新请求叠加与设置弹窗静默丢弃未保存规则，补文档
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/gitService.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `docs/workbench-git-sync.md`
- lesson: 文件移动后用 update-index 搬原 blob 可保留重命名历史；git status 用 --no-optional-locks 避免递归监听自激；Git 状态刷新应合并并发请求，否则图标会长时间转圈

### 15:41 | Codex

- done: 调整 footer 三个入口间距，并将 Git 弹层宽度统一为仓库管理弹窗的 420px
- context: 用户反馈 Git 图标与设置图标距离过远，以及仓库管理和 Git 管理弹窗宽度不一致。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 15:37 | Codex

- done: 实现方案1底部 footer：工作区切换、Git、设置三个独立入口，移除横向分隔线和重复设置入口
- context: 用户选择 HTML 原型方案1，并明确三个按钮之间不需要横向分隔竖线。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- lesson: 设置入口只保留 footer 齿轮；工作区菜单和管理仓库弹窗不再重复放置工作区设置。

### 15:25 | Codex

- done: 补齐开发依赖忽略：默认与模板加入 Python 缓存/虚拟环境/测试工具、Node 依赖、IDE 文件；新增 Python 项目模板；文件树同步隐藏 Python 缓存目录
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/gitService.ts`
  - `src/main/services/workbenchService.ts`
  - `docs/workbench-git-sync.md`

### 15:20 | Codex

- done: 工作区设置的忽略规则改为整组模板：知识库/含大文件/全量，一次填入缺失规则，模板前置并区分已填入与已保存
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`

### 14:39 | Codex

- done: 调整 Git 提交标题预填：普通提交只保留日期时间，首次提交使用 Initial commit，并同步文档
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `docs/workbench-git-sync.md`

### 14:34 | Codex

- done: 工作台 Git 接入收尾：修复子目录路径匹配、未跟踪文件误阻止拉取、SSH 凭据误脱敏、大文件提交兜底与索引刷新循环，并完成回归验证
- lesson(promoted): 目录移动必须逐文件映射索引；.gitignore 编辑按行差异写回并保留注释；push 前必须 fetch；带凭据远程地址不可回填脱敏值
- modified:
  - `src/main/services/gitService.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/main/services/workbenchService.ts`
  - `docs/workbench-git-sync.md`
  - `docs/DOCS_INDEX.md`
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 14:28 | Antigravity

- done: 修复工作台标签 Obsidian 格式兼容性、无井号紫色胶囊样式对齐、中文输入法防抢断与无尾换行解析
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/shared/utils/workbenchTags.ts`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `scripts/test-tags-obsidian-parity.ts`
- lesson: Obsidian 标签 chip 样式应为原有 violet-500 圆角 badge 且不带井号；Frontmatter 正则必须兼容文件末尾无换行的边界；标签输入框需拦截 IME isComposing 避免中文输入空格误提交

### 14:02 | Codex

- done: 工作台 Git 最终验证：类型检查、全量 lint、构建与 22 项 Git 行为脚本全部通过
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 14:00 | Codex

- done: 工作台 Git 终审：.gitignore 原子写入、沿用已有远程名、同步更新说明文档
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/gitService.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`

### 13:57 | Codex

- done: 工作台 Git 收口复查：空仓库推送提示、已是最新反馈、footer 宽度约束与弹窗尺寸边界
- modified:
  - `src/main/services/gitService.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 13:52 | Codex

- done: 补充工作台 Git 同步边界知识路由与长期经验
- modified:
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 13:52 | Codex

- done: 工作台 Git：footer 整合、工作区设置与忽略规则、大文件提示、远程配置与拉取/推送校准
- added:
  - `src/main/services/gitService.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`
- modified:
  - `src/main/services/gitService.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`
  - `docs/DOCS_INDEX.md`
- lesson: 目录移动必须逐文件映射索引；.gitignore 编辑按行差异写回并保留注释；push 前必须 fetch；带凭据远程地址不可回填脱敏值

### 13:51 | Antigravity

- done: 恢复工作台笔记属性 tag chip 原有无井号 badge 样式与 Obsidian YAML 标签格式兼容
- context: 用户反馈 Obsidian Frontmatter 源码格式为 tags 多行列表无井号，要求界面 tag chip 保持原先不带井号的 badge 样式
- decision: 标签 chip 与补全浮层均移除井号前缀，恢复原有 rounded-full 胶囊样式；测试集补充覆盖 Obsidian 引号列表标签格式
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/main/services/workbenchService.ts`
  - `scripts/test-tags-obsidian-parity.ts`

### 13:37 | Codex

- done: 修复工作台 Markdown 预览与源码切换丢失滚动位置：按工作区+文件+视图分别记忆，切回预览时等待内容解析并在尺寸变化时重试恢复，源码切回时首帧恢复 textarea 与行号层
- context: 根因是 editorMode 切换会整棵卸载当前编辑器，两套滚动容器各自从顶部重新挂载；用 Playwright 对构建产物实测长文：预览 2400->2400、源码 900->900
- decision: 滚动位置只保留在渲染层内存 Map，不写配置；预览恢复最多 2 秒并在用户主动滚动/输入时立即让出控制权，避免恢复逻辑抢占交互
- added:
  - `src/renderer/src/components/workbench/workbenchEditorScroll.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson(promoted): 编辑器双视图切换若采用条件渲染整树卸载，浏览器不会保留滚动状态；恢复滚动还要防止内容未撑开时的夹紧值反写记忆，并监听内容尺寸变化重试

### 13:36 | Antigravity

- done: 工作台笔记标签规范对齐Obsidian、标签检索与输入自动补全优化
- decision: Frontmatter存储不带#前缀保持Obsidian Properties兼容；标签输入框支持工作区已有标签关键词模糊匹配下拉选用
- added:
  - `src/shared/utils/workbenchTags.ts`
  - `docs/workbench-tags-obsidian-parity-plan.md`
  - `scripts/test-tags-obsidian-parity.ts`
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
- lesson(promoted): Obsidian YAML Frontmatter标签规范不带#前缀，但正文行内标签以#引导；标签输入框需做剥离#前缀与去重清洗

### 13:33 | Antigravity

- done: 统一工作台模式顶栏右侧面板切换按钮（思维导图与AI侧栏）的尺寸与视觉规范，将其与窗口系统控制按钮分离
- context: 用户反馈在进入工作台模式后顶部的两个面板切换按钮明显与其他按钮大小不统一，显得不协调
- decision: 将 WorkbenchPaneToggles 从原先 win32 专属的 w-[46px] 撑满矩形块重构为全平台统一的 w-7 h-7 离散圆角按钮（size=16），并在 Windows 下将其与原生窗口最小化/最大化/关闭按钮分离（保留 mr-2 间距），使其与应用顶栏其他功能按钮规范保持协调一致
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 13:16 | Codex

- done: 来源会话入口改用严格会话页判定：新增 isPlatformConversationPage 按平台枚举真实会话路径与 query 会话键，非会话页/非 AI 链接不再显示“在侧边栏打开会话”，仅保留浏览器打开
- context: 用户反馈 source 填其他链接仍出现打开对话图标；根因是来源入口复用了为后台恢复设计的宽松 isConversationUrlForPlatform
- decision: 自动化链路继续用宽松判定以免影响恢复；UI 入口用严格判定，未确认的 chatglm query 规则不猜；新增严格正负样例进 agent-cli-acceptance.mjs
- modified:
  - `src/shared/utils/conversationUrl.ts`
  - `src/renderer/src/utils/noteSourceConversation.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): “能否恢复会话”与“是否显示会话入口”是两个判定口径，UI 入口必须用逐平台严格路径白名单，且负例要覆盖同域名非会话页

### 13:11 | Codex

- done: 工作台接入 Git：移动/重命名写入暂存区，新增提交、快进拉取、显式合并与冲突自动撤销、推送与首次关联上游，左栏新增版本管理面板
- context: 验证：tsc node/web 通过，lint 0 error，npm run build 通过；用临时仓库跑通 13 项行为验证（移动暂存、子目录提交范围、快进、分叉、冲突撤销、脏工作区、推送、初始化）
- decision: 不引入 Git 库，直接调用系统 Git；移动用 update-index 只记录路径变化，不连带暂存内容改动；拉取默认只允许快进，分叉需显式合并，冲突自动 merge --abort 回到操作前；提交与状态均限定在工作区范围
- added:
  - `src/main/services/gitService.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
- lesson(promoted): execFile 不支持 input 选项，需要写 stdin 时必须用 spawn；status 的 ahead/behind 基于本地缓存的远程引用，拉取/合并前必须先 fetch，否则会把远程新提交误判为已是最新

### 13:06 | Codex

- done: 修正笔记属性图标映射：补充 sell/calendar_month 的 Lucide 图标，并按属性名识别 source/url/tag/date/title/description
- context: 用户截图显示笔记属性 tag/date 等图标错误；仅修改本次图标映射，保留工作区其他未提交改动。
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- lesson: AppIcon 对未映射名称会回退为警告三角；属性面板新增图标名时必须同步 APP_ICON_MAP，且空值字段应由属性名而非值类型决定语义图标。

### 13:06 | Antigravity

- done: 优化工作台搜索结果在窄宽度下的UI布局，防止行号标签被挤压拉长
- modified:
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`

### 12:55 | Codex

- done: 笔记属性 source 链接值支持 Ctrl/Cmd+点击用本地浏览器打开，普通点击仍进入行内编辑；title 提示补齐修饰键用法
- context: 用户反馈上一版只保留编辑动作，缺少本地浏览器打开入口，询问能否用 Ctrl+点击
- decision: 值恢复为 <a href target=_blank>，普通点击 preventDefault 进编辑，修饰键放行给主窗口 setWindowOpenHandler → shell.openExternal；不新增 IPC
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- lesson(promoted): Electron 渲染层给 <a target=_blank> 的普通点击做 preventDefault 不影响修饰键/中键外链：setWindowOpenHandler 只在未被拦截的新窗口请求时触发

### 12:49 | Codex

- done: 修复工作台笔记属性中 source 链接无法直接修改：链接值改为点击即行内编辑（Esc 取消、Enter/失焦提交），打开动作拆为独立图标（会话链接进 AI 侧栏、普通链接进浏览器）
- context: 用户反馈工作台 Markdown 编辑区编辑时不能修改 source 链接；原实现只有 Ctrl/Cmd+点击进入编辑且输入框未自动聚焦
- decision: 链接值与打开动作分离：值文本承担编辑，右侧图标承担打开；保留 source 会话链接解析后走 AI 侧栏，其他 URL 走系统浏览器
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- lesson(promoted): 工作台 FrontmatterPanel 的 URL 字段不能直接把 <a> 当编辑入口，否则普通点击会导航走；编辑态需优先于 URL 渲染分支，且 Esc 要用标记跳过 blur 提交

### 11:59 | Codex

- done: 产出工作台导图文件化与工作区身份设计文档，经独立 worker 四轮审核后修正删除顺序、文件删除出口、收养哈希口径、targets 语义等 6 处契约矛盾
- decision: 导图以 Markdown 落盘到 .multichat/mindmaps，绑定键改为 workspaceId+relativePath，工作区身份用 marker id + 本机 dev/ino 映射
- added:
  - `docs/workbench-mindmap-file-binding-design.md`
- lesson: 对账删除必须区分 ENOENT 与其他错误，空索引不能当成删除依据；导图文件哈希与源文档哈希是两套口径，不可混用

### 09:39 | Codex

- done: 修复 WorkbenchDocxCard 类型报错：为 FileTypeIcon 传入的节点补 fullPath
- context: npx tsc -p tsconfig.web.json 报 WorkbenchFileNode 缺少 fullPath
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
- lesson(promoted): WorkbenchFileNode 的 fullPath 为必填，新增图标节点时需同时提供绝对路径

### 09:36 | Codex

- done: 按独立审查意见加固主页模式迁移：版本号改为自 1 起的 schema 版本、迁移写入加 await 保证先配置后版本、修复 App 初始化 effect 依赖 [isInitialized] 导致的每次启动重复执行
- decision: hidden 为空视为默认配置；显式清空过的用户会被覆盖，按产品预期接受并在注释留痕
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/App.tsx`

### 09:34 | Codex

- done: 修复主页模式默认显隐对存量用户与新装均不生效：新增 productModeConfigVersion 一次性迁移，未保存配置按默认值、hidden 为空补默认隐藏、已自定义保持原样，并落盘版本号
- context: normalizeProductModeConfig(undefined) 会把 hidden 收成空数组，导致 DEFAULT_PRODUCT_MODE_CONFIG 只在首次渲染瞬间生效
- decision: 用版本号区分一次性迁移，避免每次启动覆盖用户后续在设置里的显隐调整
- modified:
  - `src/renderer/src/store/appStore.ts`

### 09:10 | Codex

- done: 将主页模式默认显隐改为只显示多AI和工作台，任务分配/辩论默认隐藏，用户可在设置-主页模式设置中恢复
- modified:
  - `src/renderer/src/store/appStore.ts`

### 09:06 | Codex

- done: 应用户要求将发布版本号从 1.4.0 改为 1.3.5，amend 发布提交并重新打包 NSIS
- modified:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

## 2026-11-20

### 22:25 | Codex

- done: 发布 v1.4.0：版本号 1.3.1→1.4.0，CHANGELOG 新增工作台模式（三栏布局/Obsidian 式属性面板/多格式预览/AI 侧边栏/上传落盘/导图绑定）、Lucide 图标迁移与 Chrome UA 安全加固条目
- context: 1.3.1 后累计 33 个提交以 Workbench 本地知识库为主线，构成 minor 级发布
- modified:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

### 21:57 | Codex

- done: 字数统计改为 Word 口径（CJK 字符 + 非 CJK 词），emoji 字符数修正
- context: 原实现纯空格分词对中文完全不准，一段无空格中文只算 1 词
- decision: 采用 Intl.Segmenter word 粒度 + CJK Unicode 属性范围，回退空白切分；统计基于 Markdown 源码
- added:
  - `src/renderer/src/utils/wordCount.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 21:47 | Codex

- done: 笔记属性 source 链接后新增会话图标，可在工作台 AI 侧边栏打开来源会话
- context: source 可能被改写或指向非平台链接，需在渲染期判定而不是依赖创建时记录
- decision: 用 isConversationUrlForPlatform 校验链接归属平台会话页，非会话链接或被改写的 source 不显示入口
- added:
  - `src/renderer/src/utils/noteSourceConversation.ts`
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 21:22 | Codex

- done: 工作台模式下 AI Webview 原生下载自动落到当前工作区，其他模式保持系统保存框；同名文件自动追加序号，生图批量下载链路保持独立
- added:
  - `src/main/services/workbenchDownloadService.ts`
- modified:
  - `src/main/index.ts`
  - `src/main/services/ImageDownloadService.ts`
- lesson: Electron session 的 will-download 可通过 webContents.getType() === 'webview' 识别 AI 侧 Webview；setSavePath 会跳过保存框，需自行做文件名清洗、同名避让和并发占位

### 21:15 | Codex

- done: 修复 WorkbenchFileTree 重复导入导致的 dev 启动失败，并在 PDF 顶部工具栏加入缩放控件
- context: 第 5 行重复 import MARKDOWN_EXTENSIONS 触发 Babel Identifier already declared，dev 直接起不来
- decision: 缩放以 10% 为步进，范围 50%-300%，点击百分比回到 100%；页面宽度=适配宽度×缩放，容器横向滚动承接溢出
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`

### 21:14 | Codex

- done: 采用方案1，将 AI 工作台注入按钮从绿色主题调整为项目主题蓝，并补齐蓝色 hover 效果
- modified:
  - `src/shared/utils/webviewScripts.ts`

### 21:03 | Codex

- done: 工作台 PDF 预览改用 PDF.js 渲染，补文本层让选中文字可弹右键菜单
- context: Electron 42 内置 PDFium 把正文放在 embed，DOM 无文本层，context-menu 的 selectionText 恒为空且 copy() 无效
- decision: 改用 pdfjs-dist canvas + TextLayer，主进程新增 workbench:read-pdf-bytes 供渲染层取字节；按视口懒渲染并释放位图
- added:
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/index.html`
  - `src/renderer/src/assets/index.css`
  - `electron.vite.config.ts`
  - `package.json`

### 20:56 | Codex

- done: 统一快捷窗口固定/思维导图等顶栏图标与工作台侧边栏按钮的视觉尺寸
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson(promoted): AppIcon 的 size 会乘 0.85 光学缩放；要求与 WebviewCard 的 20px 导航图标视觉一致，需要传 size={20}，不能只沿用旧 material text-base 对应的 16。

### 20:56 | Codex

- done: 按用户要求进一步恢复图片文件原来的 image/draw 图标；Markdown/TXT 的 description 图标继续保留，PDF、Word、Excel、PPT 与代码类仍使用统一 Material 文件图标
- context: 用户明确要求图片也用原来的
- modified:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `scripts/verify_workbench_previews.py`

### 20:52 | Codex

- done: 按用户要求恢复 Markdown 与 TXT 的原有 description 图标；PDF、Word、Excel、PPT、代码、图片等文件类型仍统一使用工作区 Material SVG 图标
- context: 用户明确要求不要改 Markdown 和 TXT 的 logo
- modified:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `scripts/verify_workbench_previews.py`

### 20:49 | Codex

- done: 按批注调整工作台划词 AI：改写解释与润色提示词，删除续写动作及文档旧模板，并同步两处右键菜单
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `docs/workbench_product_spec.md`

### 20:46 | Codex

- done: 将 ControlBar 通知状态残留 Material Symbols 图标替换为 AppIcon
- context: 按用户要求处理最后一处应用自身 material-symbols-outlined 残留；通知 success/error/info 分别映射 check_circle/error/info，保留原颜色与 16px 尺寸。
- modified:
  - `src/renderer/src/components/ControlBar.tsx`
- lesson: AppIcon 默认 optical scale 0.85，旧 font-size 16px 的图标改用 size={16} 即可保持接近原视觉尺寸。

### 20:44 | Codex

- done: 替换 AI 工作台注入回复按钮图标为 Lucide file-plus-corner 与 pilcrow-left，并升级注入脚本绑定标记以刷新旧页面按钮
- modified:
  - `src/shared/utils/webviewScripts.ts`

### 20:43 | Codex

- done: 统一工作台文件类型图标：所有代码、PDF、Word、Excel、PPT、Markdown、图片与文本均使用同一套工作区 Material SVG 图标，并让文件树、PDF 预览和 Office 预览复用同一组件
- decision: 根因是文件树按代码/非代码分成 SVG 与 AppIcon 两套图标来源；收敛为 FileTypeIcon 单一映射并复用在预览头部
- added:
  - `src/renderer/src/assets/file-icons/pdf.svg`
  - `src/renderer/src/assets/file-icons/word.svg`
  - `src/renderer/src/assets/file-icons/table.svg`
  - `src/renderer/src/assets/file-icons/powerpoint.svg`
  - `src/renderer/src/assets/file-icons/markdown.svg`
  - `src/renderer/src/assets/file-icons/image.svg`
  - `src/renderer/src/assets/file-icons/svg.svg`
  - `src/renderer/src/assets/file-icons/log.svg`
  - `src/renderer/src/assets/file-icons/zip.svg`
- modified:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `scripts/verify_workbench_previews.py`

### 20:35 | Codex

- done: 核实 Material Symbols、Lucide 与 Material 风格文件图标的迁移边界
- context: 用户询问现有 Material 风格文件图标是否应已全部迁移至 Lucide；检查 AppIcon、FileTypeIcon、ControlBar 残留、依赖与文档。
- lesson(promoted): Material Symbols 通用字体图标与 vscode-material-icon-theme 文件类型 SVG 是两个体系；后者按扩展名显示语言品牌图标，不属于 Lucide 迁移范围。当前仍有 ControlBar 通知提示一处 material-symbols-outlined 残留，外部网页选择器中的 material-icons 不算应用图标残留。

### 20:33 | Codex

- done: 自定义 Lucide 风格 PDF 图标，替换 AppIcon 中 picture_as_pdf 对通用 FileText 的复用
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 20:27 | Codex

- done: 核验并修正设置中过时的 API Key 备份说明：确认应用已不再存储 API Key，更新备份说明和使用说明文案，移除恢复弹窗中的失效兼容提示。
- context: 用户指出截图中的 API Key 脱敏说明已过时；核验 ApiConfig 仅保留总结模板与平台字段，旧备份兼容清理继续保留。
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`

### 20:24 | Codex

- done: 将当前思维导图的入口图标统一替换为 diagram-flow-horizontal
- context: 用户要求把当前思维导图图标统一换成 diagram-flow-horizontal；保留任务分配等非导图语义的 account_tree 不变。
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`
  - `src/renderer/src/components/NotesConversationCards.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 20:22 | Codex

- done: 工作台文件树右键菜单新增上传到 AI，复用现有节点上传事件并支持多选节点
- context: 用户截图指向工作区文件列表右键菜单，要求新增上传到 AI 命令。
- decision: 沿用 WORKBENCH_UPLOAD_NODES_EVENT 与 WorkbenchAiSidebar 已实现的节点上传链路，不改 IPC；右键未选中节点沿用现有单选处理，已多选时批量上传。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 20:15 | Codex

- done: 将工作台 AI 侧栏文件上传 toast 从 top-12 下移至 top-28，避免遮挡平台 header
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 20:14 | Codex

- done: 调整 ControlBar 文件上传 toast 定位，改为相对控制栏右侧下移显示，避免遮挡页面 header
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 20:13 | Codex

- done: 补充统一 .txt 的 Markdown 行为：重命名后按共享扩展集合刷新内容，文件树清理未引用图片菜单对 .txt 可见
- context: Follow-up sweep after TXT-to-Markdown editor change found remaining .md/.markdown-only hardcodes.
- decision: Reuse MARKDOWN_EXTENSIONS instead of duplicating extension literals.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 20:13 | Codex

- done: 工作台 PDF 预览改用 webview，复用 Webview 右键菜单链路
- context: PDF object 插件文档选区不进入主页面 window.getSelection，无法触发现有 DOM 菜单
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`

### 20:12 | Codex

- done: 工作台将 .txt 视同 Markdown：复用 Markdown 富文本/源码编辑器，并同步文件树图标、AI 回复插入、资产联动与导图支持
- context: User requested TXT files in the workbench to use the Markdown editor instead of the plain code editor.
- decision: Treat .txt as MARKDOWN_EXTENSIONS; keep .log/.csv/.tsv as TEXT_EXTENSIONS so the existing category-driven editor routing applies end-to-end.
- modified:
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 20:12 | Codex

- done: 修复工作区拖拽上传偶发永久卡死：为 Webview 脚本调用与 dispatchFileDrop 增加超时，上传锁改为带时间戳可自愈，新增停止等待入口与批次代际校验，避免迟到结果覆盖新一批状态
- context: 用户截图显示元宝侧边栏长期停留在'正在上传上一批文件，请稍候'；根因是 uploadingRef 仅在 finally 释放，而 executeJavaScript/dispatchFileDrop 无超时，Promise 永不 settle 时锁永久占用
- decision: 脚本读取 5s、CDP 派发 15s、附件就绪仍为 90s；锁超过 3 分钟视为僵死可接管；停止等待通过 uploadGenerationRef 使旧批次静默退出，不改写新批次 toast
- modified:
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `scripts/verify_workspace_drag_drop.py`
- lesson(promoted): 上传互斥锁必须只保护有界的等待；任何 await 的 executeJavaScript/CDP Promise 都要 withTimeout，否则页面重载或调试器挂起会让 finally 永不执行，锁永久卡住
- lesson(promoted): 可取消批次要同时有代际号与 toast 归属校验；旧批次迟到时不得清空新批次的锁或覆盖新提示，否则会出现'停止后又被上一批写回'的假状态

### 20:11 | Codex

- done: 为 PDF、PPT、Excel、Word 预览底部新增发送到 AI 按钮，复用现有文件上传事件与轻量强调样式
- context: PDF 和 Office 文档分类共用 WorkbenchPdfPreview / WorkbenchDocxCard 两个预览组件；PPT、Excel、Word 均归入 document 类别。
- added:
  - `src/renderer/src/components/workbench/WorkbenchSendToAiButton.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 20:02 | Codex

- done: 精简工作台 AI 侧边栏文件上传失败提示，超长错误详情改为控制台输出
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 20:02 | Codex

- done: 修复 Markdown 编辑区滚动到底部无留白：flex 行容器默认 stretch 使内容盒固定为视口高度，padding-bottom 不进入滚动范围；改为 items-start 让内容随文档增高
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: flex 行容器里给滚动子项加 padding-bottom 不产生末尾留白：align-items 默认 stretch 把子项高度拉到容器高度，padding 位于盒内而内容溢出盒外；需要 items-start/self-start 让子项按内容高度撑开（或改成 block + mx-auto），min-h-full 仍保留短文档铺满

### 19:58 | Codex

- done: 按用户反馈调整 Markdown 编辑区底部安全区：保留右下角悬浮状态条，仅增加滚动到底部时的底部留白
- decision: 放弃预留 footer 占位带，恢复悬浮效果；富文本画布 pb-20，源码模式 pre/textarea 底部内边距 80px，滚到底后最后一行与浮层之间保留约 32px 间距
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 19:58 | Codex

- done: 简化工作台不支持文件打开的提醒：移除详情卡片和多余操作，仅保留背景提示与主题色默认应用打开按钮
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 19:57 | Codex

- done: 修正工作台 Markdown 编辑区底部安全区：改为预留固定空白带，滚动视口在状态条上方结束，避免内容在任何滚动位置被浮层遮挡
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson: 悬浮底栏场景下，仅给滚动内容加 padding-bottom 只在滚到底时留白，中途滚动仍会被覆盖；要保证任何位置不遮挡必须为浮层预留独立布局空间（如 shrink-0 占位带或静态 footer）

### 19:54 | codex

- done: 工作台 AI 侧栏上传提示改为仅显示进度，不再显示文件名与目标模型名
- context: 用户反馈截图中的上传 toast 文案冗余
- decision: 进行中显示 正在上传 (i/n)，完成显示 上传完成 (n/n)；保留失败详情与跳过文件夹数量
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 19:53 | Codex

- done: 为工作台 Markdown 编辑区底部增加空白安全区，避免最后一行内容被右下角悬浮的状态条遮挡
- decision: 富文本画布由 py-6 改为 pt-6 pb-24；源码模式的 pre 与 textarea 底部内边距同步加到 96px，保持高亮层与输入层对齐
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 19:50 | Codex

- done: 补齐工作台发送到 AI 轻量强调方案：按钮从状态胶囊拆分为独立浅蓝按钮，并完善 hover、禁用与键盘焦点状态
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:48 | Codex

- done: 采用轻量强调方案：优化工作台底部发送到 AI 按钮样式
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:48 | Codex

- done: 补充独立审查：确认代码提问入口已全部移除，保留全局右键/非代码划词公式化提示词与思维导图入口
- context: 最终范围复核：代码预览无 askAi 调用；CustomContextMenu 与 WorkbenchSelectionMenuPlugin 在 activeFileCategory=code 时不显示 AI 提问项；workbenchStore 删除 isCode 条件分支
- modified:
  - `SESSION_LOG.md`

### 19:48 | Codex

- done: 删除工作台代码提问提示词注入：移除代码预览的提问/解释/重构悬浮入口，代码文件右键仅保留思维导图，全局右键与 askAi 去掉代码专用提示词分支
- context: 用户澄清当前只有发送功能，要删掉代码提问的提示词注入功能；保留发送到 AI，以及非代码编辑器的 AI 划词能力
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 19:43 | Codex

- done: 补充折叠条带上传在 React 布局完成后再启动、右侧条带外部文件守卫，并增加外部文件优先于残留 draggingNodes 的回归用例；将跨栏上传教训提升到 KNOWLEDGE/INDEX
- context: Playwright 主路径与 5c-5e、7b 全部通过后，针对真实 Electron 折叠态 Webview 可能为 0 尺寸补两帧等待；5f 验证陈旧 store 节点不再劫持外部文件
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `scripts/verify_workspace_drag_drop.py`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
  - `SESSION_LOG.md`

### 19:39 | Codex

- done: 修复工作区文件拖拽上传到 AI 侧边栏的假成功、折叠面板丢文件、外部拖拽状态残留，并补充混选提示、上传互斥和主进程文件校验；同时恢复 WorkbenchCodePreview 中缺失的 saveStatus/activeFileSize/formattedSize 声明以消除运行时崩溃
- context: 按用户确认的 P1→P3 顺序修复；改前先用 Playwright 复现折叠条带 drop=0、外部拖拽遮罩残留、混选静默丢文件夹、陈旧 draggingNodes 劫持
- decision: 上传成功改为以附件新增信号（文件名命中或附件计数增加）连续稳定 3 次为准；折叠条带改为拖拽释放后一次完成展开与上传；外部文件 drop 优先于 store 残留节点
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/workbenchAiEvents.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/main/services/AutomationService.ts`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `scripts/verify_workspace_drag_drop.py`
- lesson(promoted): CDP Input.dispatchDragEvent 返回成功只代表事件已派发，不代表附件已挂载；必须轮询 generateFileUploadStateScript，并以基线与新增计数/文件名命中判断，否则会稳定产生假成功
- lesson(promoted): 工作台右侧条带不能在 dragenter 就卸载并只 openRightPane，drop 会被吞；应在 drop 时把 draggingNodes 快照交给常驻侧边栏，一次完成展开与上传
- unresolved: 尚未在真实 Electron Webview 内对 ChatGPT/Claude/Gemini 等平台做上传就绪验收；需 npm run dev 后逐平台拖拽图片/PDF/大文件确认，尤其关注无附件 chip 的平台是否出现 90 秒超时

### 19:36 | Codex

- done: Increase-status-pill-height
- context: User requested increasing the height of the bottom status pill after moving the send-to-AI capsule into it.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:36 | Codex

- done: 删除工作台编辑器空状态中的说明文字，并保留按钮间距
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 19:34 | Codex

- done: Emphasize-send-to-ai-capsule-button
- context: User requested blue text/icon for the status-pill send button and a blue background with white text on hover.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:32 | Codex

- done: 删除工作台顶部栏工作区名称前的文件夹图标
- context: 用户截图红框标记的是顶部工作区名称前的黄色文件夹图标；仅移除该图标，保留工作区名称、文件路径和其余按钮。
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 19:31 | Codex

- done: Move-send-file-button-to-status-pill
- context: User requested moving the send-file button from the code toolbar into the bottom-right character-count floating pill as a matching capsule button.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:25 | Antigravity

- done: 彻底移除右侧 AI 对话框拖拽上传时的蒙层和提示卡片，保持完全透明无感上传，并刷新当前运行中的 Electron 调试实例
- decision: 采用完全透明的 cursor-copy 感应层，阻断 guest webview 吞噬拖拽事件的同时避免视觉遮挡与弹窗打扰
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `scripts/verify_workspace_drag_drop.py`

### 19:23 | Antigravity

- done: 修复工作区文件跨栏拖拽上传至AI侧边栏问题：消除2.5s阻塞、适配Windows路径与MIME补全、解决拖拽遮罩残存与布局抖动并补全端到端验证
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `scripts/verify_workspace_drag_drop.py`
  - `scripts/verify_workbench_frontend.py`
  - `scripts/verify_workbench_previews.py`

### 19:23 | Antigravity

- done: 修复并完善左侧工作区拖拽文件上传至右侧AI对话框机制：解决上传成功Toast静默被吞、ESLint无用转义错误、全透明拖拽感应层防Guest Webview事件吞噬、Escape按键与窗口边界清理、工作区搜索列表项拖拽能力
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `scripts/verify_workspace_drag_drop.py`

### 19:22 | Codex

- done: 修正 Markdown 编辑区前进按钮图标
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
- lesson(promoted): 重做按钮应使用成套的 Undo2/Redo2；Repeat 是循环播放语义，不应作为前进图标。

### 19:20 | Codex

- done: 移除文件编辑器代码预览中文件名后的文件类型标签
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 19:16 | Codex

- done: 修复工作台 Markdown 富文本预览的标题换行行距与引用左缩进
- context: 工作台 Lexical Markdown 渲染；用户提供两张预览截图
- decision: 标题按层级设置相对行高；引用移除额外 20px 左边距，保留左边线与内边距
- modified:
  - `src/renderer/src/assets/index.css`
- lesson(promoted): PlaygroundEditorTheme 标题使用固定 px 字号时需显式设置相对 line-height，否则会继承 body 的 24px 固定行高，标题换行后行距过紧

### 19:11 | Codex

- done: 保留工作台文件上传成功提示，并将上传 toast 统一为项目现有 ControlBar/ModelOutputCard 样式；进度、成功、失败分别使用信息、成功、错误状态。
- context: 用户要求成功 toast 保留，且不能自造样式。
- decision: 直接复用 notification-popup、shadow-float、白底半透明与绿色/红色/蓝色细边框；部分成功改用信息态，不新增警告样式。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 项目内 toast 应复用 ControlBar/ModelOutputCard 的既有视觉类，不单独设计新的上传提示条。

### 19:06 | Antigravity

- done: 移除拖拽文件至 AI 对话框时的遮罩与提示卡片，保持无感透明感应与直接拖拽上传能力
- decision: 保留覆盖于 webview 上层的透明感应层以确保 Electron host 接收 drag/drop 事件，但彻底移除 backdrop-blur、蒙层及弹窗提示，实现无感平滑拖拽上传
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `scripts/verify_workspace_drag_drop.py`

### 18:57 | Codex

- done: WorkbenchCodePreview 工具栏简化：删除文件名后的语言标签，发送到AI按钮改蓝色+纸飞机图标
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 18:53 | Codex

- done: 工作台代码预览的 AI 助手下拉改为一键发送当前完整文件；上传前自动保存未落盘修改，上传成功静默收尾。
- context: 截图指向 WorkbenchCodePreview 的 AI 助手下拉菜单，侧边栏已有工作区文件上传能力。
- decision: 复用 WorkbenchAiSidebar 的 uploadFile 链路，通过渲染层自定义事件触发，不新增 IPC；保留划词解释和重构入口。
- added:
  - `src/renderer/src/components/workbench/workbenchAiEvents.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson(promoted): 文件上传成功无需 toast；若先展示持久进度提示，成功时必须主动清除，避免无自动隐藏的提示滞留。

### 18:46 | Antigravity

- done: 验证并补全工作区拖拽上传到右侧 AI 对话框链路，增加完整 DOM-ready 与 dispatchFileDrop 端到端自动化验收
- added:
  - `scripts/verify_workspace_drag_drop.py`

### 18:19 | Antigravity

- done: 实现工作台左侧工作区文件拖拽直接上传到右侧 AI 对话框
- decision: 工作区拖拽通过 store 记录 draggingNodes 跨栏感知，配合 AI 侧边栏浮层遮罩捕获宿主 drop 事件，调用已有 CDP dispatchFileDrop 直连输入框
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): Electron guest webview 运行时会吞噬宿主 DOM 的拖拽事件；内部元素拖放至 webview 必须在宿主侧挂载拖拽遮罩层以截获 drop 事件并借由 CDP Input.dispatchDragEvent 发送给 webContents

### 18:03 | Antigravity

- done: 修复 Windows 窗口控件中向下还原(restore)图标与原生 Windows MDL2 资产不一致的问题
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 17:47 | Codex

- done: 修复工作台代码块连续 Enter 光标跳转，以及最后一个代码块无法点击外部退出：高亮重建改为微任务提交，按字符偏移恢复支持 Element Point 与连续 LineBreakNode 的选区；在编辑根空白处 mousedown 时补建代码块外段落，并用 code-exit 标签阻止幻影空段落写回 Markdown
- context: 内置浏览器直接打开 Vite 页面会因缺少 Electron preload 在 window.api.platform 处白屏，因此用 Electron CDP 加真实键盘事件验证实际编辑行为；临时测试文档已删除
- decision: 只修改代码块高亮插件与 Markdown 同步插件，不调整编辑器整体结构或 Lexical 配置
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodeHighlightPlugin.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
- lesson(promoted): Lexical CodeNode mutation listener 内不能同步 editor.update 重建 children：重建会并入当前提交并被随后状态覆盖，选区却按新节点恢复而落到幸存旧节点；应 queueMicrotask 延后，并以块内字符偏移恢复选区。连续 LineBreakNode 的空行必须用 CodeNode element point 表示，selectNext 会越过空行。代码块是文档末节点时 Chromium 会把下方空白点击映射回代码末尾，需要在根元素 mousedown 捕获并主动插入段落，相关更新要跳过 Markdown 回写，避免只点击就产生空段落落盘
- unresolved: 全量 npm run lint 仍被既有 AppIcon.tsx:308 unused eslint-disable 阻塞，与本次改动无关；定向 ESLint 已通过

### 17:41 | Codex

- done: 修正主窗口 Windows 最大化/最小化/关闭控件字形，并将附件回形针旋转为垂直方向
- context: 用户截图指出附件图标呈 45 度、Windows 标题栏最小化按钮不是原生样式
- decision: 窗口三键使用 10x10 的 Windows 字形 SVG，保留现有自绘标题栏与 IPC；附件仅调整 Lucide Paperclip 的旋转角度
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/ControlBar.tsx`
- lesson(promoted): Lucide Paperclip 默认斜向，叠加 -rotate-90 仍是另一种 45 度斜线；需要 -rotate-45 才呈垂直。

### 17:32 | Codex

- done: Material→Lucide迁移完成：codemod替换378处span为AppIcon(55文件)，FrontmatterPanel button图标手动改，3处fontVariationSettings改fill/strokeWidth，CSS选择器改svg[data-icon]且font-size→width/height，main.tsx移除字体import+uninstall material-symbols，verify断言改svg[data-icon]；tsc+lint+build全过，woff2减3.86MB
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/main.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/styles/notesWorkspace.css`
  - `scripts/verify_workbench_previews.py`
  - `55个tsx组件`
  - `package.json`
  - `package-lock.json`
- lesson: 批量图标迁移codemod要点:动态className含插值不能拍平成字符串要透传;title是tooltip要转title子节点或加进Props;fontVariationSettings对svg无效要改fill/strokeWidth;CSS的font-size控图标尺寸迁svg要改width/height;button直接挂图标类的形态正则匹配不到要手动找
- unresolved: npm run dev视觉巡检未做(stroke可读性/基线/小尺寸),待手动验证

### 17:14 | Codex

- done: 修复代码块 Enter 光标跳回上一行行首：WorkbenchCodeHighlightPlugin 在 mutation 回调 discrete 重建 children 把 insertNewAfter 刚设的新行选区删掉重置；改为去掉 discrete + 重建前记录块首字符偏移、重建后按偏移恢复选区
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodeHighlightPlugin.tsx`
- lesson: CodeNode 高亮重建 children（clear+append）会销毁选区锚点节点导致光标重置到块首；mutation listener 里用 discrete:true 会抢在 selection 提交前执行——正确做法是记录『块首字符偏移』重建后恢复，并走 Lexical 默认异步调度

### 17:08 | Codex

- done: 修复 wysiwyg 代码块：新增 WorkbenchCodeHighlightPlugin 复刻 playground 算法——registerCodeGutter 写行号 + CodeNode mutation 触发 Prism.tokenize 重建 CodeHighlightNode children；theme 补 codeHighlight token 映射与 PlaygroundEditorTheme__token* 配色（含 dark）
- added:
  - `src/renderer/src/components/workbench/WorkbenchCodeHighlightPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/types/prismjs.d.ts`
- lesson: @lexical/code 0.53 移除了 registerCodeHighlighting，行号 registerCodeGutter 在 @lexical/code-core、Prism 高亮需自行实现（@lexical/code-prism 未安装）；CodeNode children 重建要 tag 跳过自身 mutation 回声 + 逐项比较防止无限重建

### 17:03 | Codex

- done: workbench 标题栏去后缀显示、字号 28→32 比 h1 大；frontmatter 属性面板去卡片边框/底色与背景融为一体（对齐 Obsidian）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchTitleBar.tsx`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 17:01 | Codex

- done: workbench 预览区顶部加 Obsidian 式文档标题栏：去扩展名显示、点击行内重命名（Enter/blur 提交、Esc 取消）、提交前先落盘清 dirty 再 renameNode 联动 assets；顺带把 placeholder 定位改为相对正文容器修复与标题/属性面板重叠
- modified:
  - `src/renderer/src/components/workbench/WorkbenchTitleBar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: workbench 重命名文档必须先 saveActiveFile 清 dirty+防抖计时器再 renameNode，否则 autosave 会用旧路径覆盖新文件；Lexical placeholder 用 absolute top 硬编码会随前置块（标题/属性面板）高度变化漂移，应包 relative 容器相对正文定位

### 16:54 | Codex

- done: 修复重复 Ctrl+C/Ctrl+V 副本互相覆盖：workbenchService.importExternalPaths 查空名与 cp 落盘存在跨 IPC TOCTOU 竞态，两次粘贴并发拿到同一个 -1 目标名；按目标目录加进程内 promise 链锁(copyTargetLocks)串行化临界区
- context: 用户反馈重复复制粘贴时 -1 副本被覆盖，应生成 -1/-2/-3 递增副本
- decision: 锁放主进程而非前端串行：外部拖拽导入、菜单'创建副本'同样走 importExternalPaths，主进程锁对全部入口统一生效
- modified:
  - `src/main/services/workbenchService.ts`
- lesson: fs 异步复制的'查空名→落盘'是典型的 TOCTOU；校验和落盘必须处于同一互斥临界区，仅在查名前加一次 stat 不能修复并发覆盖

### 16:53 | Codex

- done: workbench 笔记属性面板改为 Obsidian 式可编辑：值行内编辑、key 重命名、tags chip 增删、添加属性入口，frontmatter 通过自定义事件同步回 MarkdownSyncPlugin
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
- lesson: workbench 编辑器 frontmatter 与正文分离存放于 MarkdownSyncPlugin.frontmatterRef；面板直接改 activeFileContent 会被 Lexical 回写覆盖，必须同步 ref + lastSyncedContentRef

### 16:48 | Codex

- done: 采纳独立 worker 审查意见：保持 binding 优先语义（每张导图记住自己的模型，新视图用全局上次选择）；applyPlatform 持久化调用补 .catch 防御
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 16:48 | Codex

- done: 修复 Markdown 预览（富文本）模式下查找无定位无高亮：新增 WorkbenchFindHighlightPlugin，把 markdown 偏移区间映射成 Lexical TextNode 选区并聚焦+滚动；查找替换仍走 activeFileContent 字符串层（统一口径，MarkdownSyncPlugin 自动重灌 AST）；源码 textarea 沿用 setSelection 定位
- added:
  - `src/renderer/src/components/workbench/WorkbenchFindHighlightPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFindReplaceBar.tsx`
- lesson: markdown 偏移→Lexical 选区映射用「按文档序 TextNode.getTextContent() 在 markdown 中 indexOf 顺序定位」建锚点：语法字符(# ** | ![]() frontmatter)不进入节点文本自然落在锚点间隙，匹配只命中纯文本区间；Lexical command listener 运行在 updateEditorSync 上下文，；reveal 时需 editor.focus() 让预览态原生选区高亮可见

### 16:46 | Codex

- done: 思维导图模型选择持久化：面板 dropdown 写入 mindmapPlatformId；初始/兜底逻辑改为优先使用上次保存值
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 16:46 | Codex

- done: 修复工作台文件树无法复制粘贴/创建副本的问题：新增树内剪贴板状态 + Ctrl+C/Ctrl+V 键盘接管 + onCopy 捕获，右键菜单补齐'复制/粘贴/创建副本'项，复用 importExternalItems 后端复制（自动 -n 重名 + 克隆导图绑定），过滤目录复制进自身内部
- context: 用户反馈工作台无法复制文档、Ctrl+C/Ctrl+V 失效、不能创建副本
- decision: 应用内剪贴板存节点相对路径而非操作系统剪贴板（避免污染用户系统剪贴板），粘贴复用后端 importExternalPaths（本就支持工作区内路径复制+导图克隆）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 16:36 | Codex

- done: 删除确认文案澄清：导图随文档删除且不可恢复，文档本身仍可从回收站还原
- context: 原文案删除后不可恢复容易被理解为文件也不可恢复
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 16:35 | Codex

- done: 对账映射支持连续改名：a→b→c 时沿映射链解析到最终记录，并在命中后把旧路径直接收敛到最终路径，visited 防环
- context: 生成任务持有最早路径，期间可能连续改名两次
- modified:
  - `src/main/noteManager.ts`

### 16:31 | Codex

- done: 生成期间改名改为按对账映射跟随：NoteManager 记录旧路径到新路径的映射，保存导图时据此定位改绑后的记录，替换按内容哈希回查，避免编辑过正文或同内容文档导致的误判
- decision: 跨会话/生成期间的重连都以对账产出的显式路径映射为准，不再用内容相似度兜底
- modified:
  - `src/main/noteManager.ts`
  - `.memory/KNOWLEDGE.md`

### 16:30 | Codex

- done: 补跨会话改名恢复：文件树载入时先完成对账，记录旧路径到新路径映射，启动恢复上次打开的文档时跟随新路径；映射键带工作区并有上限，避免切换工作区串味与无界增长
- context: 应用关闭期间外部改名后重启，恢复上次打开文档会失败
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 16:26 | Codex

- done: 补生成期间文档被外部改名的保存守卫：旧来源键找不到记录时，按工作区 + 正文哈希 + size/mtime 回查改绑后的记录，唯一命中才写入，避免导图在生成完成时被丢弃
- context: 对账会把记录改绑到新路径，生成任务仍持有旧 sourceKey
- modified:
  - `src/main/noteManager.ts`

### 16:22 | Codex

- done: 工作台导图绑定最终收口：批量删除改回单次 IPC 调用、删除提示的文档数只统计真正带导图的记录、重命名同步记录标题
- context: 删除即删语义下复查批量删除路径，避免逐项调用导致重复重扫与对账
- modified:
  - `src/main/noteManager.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 16:15 | Codex

- done: 工作台导图绑定收口：对账改为必须传入文件树索引（删除主进程自行扫盘兜底），按 size+mtime 建桶索引避免整目录删除时的平方复杂度，补充生成期间文档被删则拒绝写回的守卫，应用内改名同步记录标题
- context: 第二步性能优化的收尾：把可选兜底路径与 O(n²) 候选筛选去掉
- decision: 对账只保留一条可预测路径：索引由渲染层随文件树传入，缺失即报错而不是静默全盘扫描
- modified:
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`

### 16:05 | Codex

- done: 工作台思维导图绑定语义收敛与性能优化：取消软删除（删除即删导图）、外部改名按 size+mtime 重连并让编辑器跟随新路径、对账复用文件树索引实现零额外 IO、保存后同步指纹但不推进快照、补充误删守卫与副本歧义保护
- context: 用户要求删除文档时导图立即删除（提示不可恢复），外部改名要重连，并关注对账性能
- decision: 取消 deletedAt/软删除与 30 天保留期，改为删除即删；对账分两阶段（先占位再改名匹配），删除前单独 stat 守卫 ENOENT
- modified:
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/shared/types/notes.ts`
- lesson(promoted): 工作台文档与导图的绑定对账应复用文件树已扫描的 size/mtime 作为索引，避免二次遍历；外部改名与外部删除在文件系统层面不可区分，只能靠 size+mtime 唯一候选判定，多候选时必须放弃而不是猜
- unresolved: 需在 npm run dev 中手动验收：外部改名后导图重连与编辑器跟随、外部删除后导图消失、删除确认提示、复制副本克隆导图

### 16:01 | Codex

- done: 独立worker二轮审核AppIcon映射表148条按图形语义逐条核对：修正8处P0错配(rocket_launch→Rocket/build→Wrench/edit_square→SquarePen/folder_managed→FolderCog/folder_special→FolderBookmark/filter_none→SquareStack/ios_share→SquareArrowOutUpRight/select_all→SquareDashed)+3处P1(biotech→Microscope/summarize→TextQuote/bedtime→MoonStar)；方案附录记录
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `docs/lucide-migration-plan.md`
- lesson: 图标映射审核要看图形语义非名字相似度；lucide多数material名有同形对应(Rocket/Wrench/SquarePen等)，少数需语义近似(FolderStar不存在用FolderBookmark)；有意合并项(多material名→同lucide)是合理的
- unresolved: 映射表已审定，待批准执行B1-B5分批替换

### 15:46 | Codex

- done: 工作台编辑器补 Ctrl+F/Ctrl+H 查找替换：新增 WorkbenchFindReplaceBar 浮动条，作用于 store.activeFileContent；markdown 源码/富文本、code/text 编辑/预览全接入；源码 textarea 经 setSelection 定位，code 只读/渲染预览禁用替换；附带补全 markdown 编辑器缺失的 Ctrl+S 保存
- added:
  - `src/renderer/src/components/workbench/WorkbenchFindReplaceBar.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson: workbench 编辑器 Ctrl+F 统一走 activeFileContent 字符串查找替换：与既有全文搜索 searchFiles 口径一致、source/wysiwyg 无缝切换；富文本由 MarkdownSyncPlugin 的 isReturningToWysiwyg 路径重灌同步（不走 Lexical 坐标，避免 markdown↔AST 映射复杂度，代价是富文本模式下不可 undo）；WorkbenchSearch 是文件树全文搜索，与编辑器内查找是两个功能

### 15:37 | Codex

- done: 工作台思维导图：文档绑定、软删除、改名/复制/外部删除对账，右侧栏 AI 与导图互斥
- added:
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
- modified:
  - `src/shared/types/notes.ts`
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/services/workbenchService.ts`
  - `src/preload/index.ts`
  - `src/shared/utils/mindmap.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson: 工作台导图绑定走 sourceKey 派生 + 软删除(deletedAt) + 文件树刷新后对账，外部删除/还原无需拦截即可收敛；convert() 必须显式保留新增可选字段，否则读盘即丢。

### 15:36 | Codex

- done: 修复 AI 回复转 Markdown 表格多出空列：htmlToMarkdown 的 tr 分支在 td 已自带 ' | ' 收尾后再追加 ' |'，导致每行结尾 '| a | b | |' 被 Lexical TABLE_ROW_REG_EXP 解析出额外空单元格；改为 tr 只补行首管道
- context: 用户在工作台模式把 GPT/Gemini 回复插入文档，表格总是多一个空列；排查确认是转换器 bug 而非源数据
- modified:
  - `src/shared/utils/htmlToMarkdown.ts`
- lesson: htmlToMarkdown 的 td 返回 'x | ' 自带尾管道后 tr 又 ' | '+cells+' |' 包边，形成 '... | |' 双管道；tr 内 endsWith(' | ') 判断因 cells 已 trim 永不命中，清理分支失效

### 15:32 | Codex

- done: 源码模式编辑器支持 Tab/Shift+Tab 缩进
- context: 工作台 Markdown 源码编辑器
- modified:
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 15:25 | Codex

- done: 编辑器并发冲突处理：saveActiveFile 落盘前 statFile 比对磁盘 mtime，dirty+外部新则置 saveStatus='conflict' 拒绝覆盖并拉回磁盘版本；handleExternalFsChanged 对 dirty 文档同样标冲突；WorkbenchStatusPill 冲突态展示磁盘内容预览 + 重载磁盘/保留我的两按钮；code/text 预览区挂载状态药丸
- decision: 不做 diff merge/文件锁：按 VS Code/Obsidian 惯例把裁决权给用户（重载磁盘版/保留我的），冲突概率低、merge 成本与出错面不成比例
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: 乐观并发：文件级冲突用 mtime 比对（statFile 轻量接口，不带全文），mtime 差>2ms 判外部更新——Windows 文件系统时间戳精度 ~1ms；进入 conflict 态后必须短路自动写盘，否则 autosave 防抖会反复触发 readFile
- unresolved: 冲突浮层展示磁盘全文（max-h-40 滚动），无 diff 视图；take-disk 是整文件覆盖

### 15:24 | Codex

- done: 实现 Obsidian 风格默认工作区：Documents/MultiChat Vault 自动创建 + 欢迎笔记 + 禁删/禁关 + 删除空状态引导页
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 15:16 | Codex

- done: 工作台文件树外部变更自动同步：主进程 fs.watch 递归监听 + 350ms 去抖 + 应用自写抑制，广播 workbench:fs-changed；渲染层静默重扫树并对激活文件做删除/外部改动处理
- decision: 不用增量 diff/patch 同步：事件去抖后直接 readTree 全量重扫，代价一次 IPC + readdir 递归，换来对 rename/批量移动/丢事件的最终一致性
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/index.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson: Electron 文件监听最佳实践（VS Code/chokidar 共识）：单 recursive watcher + 事件聚合去抖后整树重扫优于增量 patch（rename 成对事件、缓冲溢出会漂移）；应用自写操作用时间窗抑制回声，避免每 1.2s autosave 触发整树重扫；扫描忽略规则与 watcher 过滤必须同源（此处事件本身不解析文件名，靠重扫时 isIgnoredName 收敛）
- unresolved: dirty 文档遭遇外部改动时目前不重载不提示（保护用户编辑）；父目录外部 rename 导致激活文件路径失配时清空编辑器而不重定向新路径

### 15:09 | Codex

- done: 代码文件编辑模式补语法高亮：WorkbenchCodePreview 编辑态改为透明 textarea 叠加 highlightCodeLine 高亮层，与查看态共用高亮器
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 15:08 | Codex

- done: 工作台各预览统计信息统一为右下角状态 Pill：代码预览去掉标题栏行/词/字符统计，改为悬浮 Pill 显示行数+大小；PDF/图片/DocxCard 大小(图片含尺寸)移出标题栏/卡片到编辑区右下角 Pill，样式与 Markdown StatusPill 一致
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 15:07 | Codex

- done: 统一工作台预览工具栏：PDF/图片/Office 文档去掉文件类型徽标，'本地应用打开'改为与代码预览一致的纯图标按钮，无高亮底色；DocxCard 顶栏补资源管理器定位图标
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 15:07 | Codex

- done: 重构工作台原型为单文件树、文档优先的统一笔记模型，答复保存/整段会话保存/选区摘录统一生成 Markdown 文档
- context: 用户反馈旧版对话与文件双标签、独立高亮数据造成交互和心智割裂
- decision: 用户可见对象只保留本地 Markdown 文档；保存单条答复、保存整段会话、选区摘录只是不同来源的建文档入口，不再设置独立高亮笔记页或标注侧栏
- added:
  - `docs/prototypes/workbench-notes-unified-v2.png`
- modified:
  - `docs/prototypes/workbench-notes-unified.html`
  - `docs/prototypes/workbench-notes-unified.png`
  - `docs/prototypes/workbench-notes-unified-1366.png`

### 14:58 | Codex

- done: 工作台 HTML 文件支持浏览器渲染预览
- context: 工作台模式下点击 HTML 文件默认进入渲染预览,像浏览器一样渲染页面,同时保留源码查看与编辑模式
- modified:
  - `src/main/services/workbenchService.ts(workbench-file:// URL 改走 pathname 承载 + readFile 对 html/htm 附带 fileUrl)`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx(HTML 文件新增 渲染/源码/编辑 三态切换`
  - `iframe sandbox 渲染)`
- lesson: workbench-file:// 协议从 ?path=query 改为 /pathname 分段编码, 使 HTML 内相对路径资源(./style.css)可由 Chromium 按目录层级自然解析到同 workspace 白名单内文件; resolveWorkbenchFileRequest 保留旧 query 格式兼容 PDF 已生成 URL

### 14:51 | Codex

- done: 新增工作台统一笔记与高亮标注的高保真交互原型，并完成浏览器交互验收
- context: 用户需要先看统一工作台笔记视图的实际效果，暂不修改生产代码
- decision: 以 Markdown 文档为单一正文来源，标注采用引用、定位与评论分离的数据结构，收藏作为独立导航元数据
- added:
  - `docs/prototypes/workbench-notes-unified.html`
  - `docs/prototypes/workbench-notes-unified.png`
  - `docs/prototypes/workbench-notes-unified-1366.png`
- lesson(promoted): 自包含原型用 innerHTML 重建含 id 的子节点后，后续渲染不得继续引用旧节点

### 14:49 | Codex

- done: 插入链路不再写 conversationUrl 到 frontmatter(仅新建时带 source)
- context: 用户反馈:不希望『插入到当前文档』把对话链接写进现有文档 frontmatter,只有『存为新文档』应保留来源链接
- decision: insertReplyIntoActiveMarkdown 移除 upsertFrontmatterSource 调用,meta 参数改 _meta 标记未用;saveReplyAsNewMarkdown 保持 conversationUrl 不变
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 14:46 | Codex

- done: wysiwyg 模式下 frontmatter 渲染为 Obsidian 式笔记属性面板
- context: 用户反馈:存为新文档已有 source frontmatter,但 wysiwyg 预览面板完全不渲染元数据;参考 Obsidian 笔记属性布局(仅样式参考非复刻)
- decision: MarkdownSyncPlugin 剥离出的 frontmatter 渲染为只读属性面板,tags→chip/URL→可点链接(经 mainWindow.setWindowOpenHandler→系统浏览器);YAML 用极简正则解析不引 js-yaml 依赖,折叠交互同 Obsidian
- added:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 14:38 | Codex

- done: 工作台 Markdown 源码模式下补齐顶部工具栏（格式/段落/插入/撤销重做），通过 SourceEditor 命令式 API 对 textarea 选区执行 markdown 文本操作
- added:
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 14:33 | Codex

- done: 工作台文件树支持外部文件拖入与粘贴导入（VSCode 风格）
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson(promoted): Electron 42 中 File.path 已移除，拖入/粘贴的本地路径用 window.electron.webUtils.getPathForFile 获取（@electron-toolkit/preload 的 electronAPI 已自带 webUtils）；目录拖入项也会出现在 dataTransfer.files 中，getPathForFile 返回目录路径，主进程 stat.isDirectory 区分后 fs.cp recursive 即可

### 14:30 | Codex

- done: 存为新文档补 frontmatter source 链接
- context: 用户反馈:侧边栏回复下「存为新文档」生成的文档缺 source frontmatter,设计文档要求补上;插入链路已有,save链路漏传
- decision: 复用 upsertFrontmatterSource:meta 增加 conversationUrl 透传,saveReplyAsNewMarkdown 写盘前先补 frontmatter,与 insertReplyIntoActiveMarkdown 行为对齐
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 14:28 | Codex

- done: 修复 tsc 报错（node 8 处、web 11 处）：Electron 42 移除的 webContents 'crashed' 事件删除、YAML frontmatter 值类型放宽、tsconfig.web 补 target ES2020 解决 Map 迭代 TS2802、selectors.ts 通过局部 store bridge 类型取 window.api、QuickPage ref 回调按模型缓存并补 unregister 的 ref 参数、resume 恢复草稿前判空 selectors
- context: 用户要求核验并修复 tsc 报错且避免回归
- decision: QuickPage 的 ref 回调若不缓存，每次渲染 React 会以 null 调旧回调，新增的真实注销会反复清 activeWebviewTimes，故按 modelId 缓存回调身份
- modified:
  - `src/main/summaryPrompts.ts`
  - `src/main/webviewManager.ts`
  - `tsconfig.web.json`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/hooks/useWebviewLifecycle.ts`
  - `src/shared/config/selectors.ts`
- lesson: tsconfig.web.json 原先缺 target，默认 ES3/ES5 导致 for..of Map 报 TS2802；补 ES2020 与 node 侧一致，比逐个改 Array.from 更贴根因
- unresolved: npm run lint 仍有 1 个既有 error：src/renderer/src/components/icons/AppIcon.tsx:300 未使用的 eslint-disable，未在本次范围内

### 14:18 | Codex

- done: 提交本会话工作台改动为 dc808f5：图片插入/粘贴、assets 附件目录联动、未引用图片清理、AppIcon/lucide 迁移基础、回复装饰图过滤、选择器诊断；一次性分析脚本 dry.cjs 未提交
- added:
  - `docs/lucide-migration-plan.md`
  - `docs/workbench-office-preview-plan.md`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePlugin.tsx`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/workbenchService.ts`
  - `src/preload/index.ts`
  - `src/renderer/index.html`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/**`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/store/*.ts`
  - `src/renderer/src/utils/selectorDiagnostics.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/htmlToMarkdown.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `package.json`
  - `package-lock.json`
  - `SESSION_LOG.md`
  - `.memory/*`
- unresolved: dry.cjs 一次性图标扫描脚本保留在工作区未提交

### 14:16 | Codex

- done: DeepSeek 按钮位置二次修正: replyItem 改 div:has(> div.ds-message + div.ds-flex) 命中含回复+操作栏的父容器; actionBar 用 div.ds-flex:has(> div.ds-button ~ div.ds-button) 命中底部原生操作行(6个ds-button); 之前误挂'已思考'行 _5ab5d64
- modified:
  - `src/shared/config/selectors.ts`

### 14:11 | Codex

- done: DeepSeek 按钮位置修正: replyItem 改 div.ds-message(整轮),actionBar 用 div:has(> div.ds-icon ~ div.ds-icon)命中回复顶部原生操作栏,contentItem 缩到 ds-markdown.ds-assistant-message-main-content; observer 存实例支持 disconnect 防 SPA 内重复注入
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
- lesson: DeepSeek 回复操作栏在回复块顶部(think-content上方)非底部,按钮是 div.ds-icon 非 ds-button; 平台 hash 类全失效时用 :has(> X ~ X)结构选择器定位比记 hash 稳

### 14:00 | Codex

- done: DeepSeek 注入循环修复: fallback bar 复用已有不再重复新建,幂等检查区分 createBar 平台; 新增 deepseek 配置(replyItem=ds-markdown.ds-assistant-message-main-content+createBar); 按钮尺寸改 CFG.btnSize/iconSize 可调(Gemini 34/18 其余 30/16); 修复 fallback 迁移时按钮顺序反转
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
- lesson: 注入 fallback bar 必须先查 replyEl 内是否已有可复用的,否则 MutationObserver 每次 scan 都 append 导致无限循环(DeepSeek 实测 2412 个); 幂等判断要区分『有原生 bar 待迁移』和『本就无原生 bar』两种情况

### 13:56 | Codex

- done: 独立worker评审Lucide迁移方案并修正：补draft漏映射(FileSignature)；AppIcon加data-icon/verticalAlign:middle/strokeWidth默认2.2/兜底改AlertTriangle；方案文档同步P0/P1修正(替换锚点=渲染span、CSS font-size失效、verify断言改svg[data-icon])
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `docs/lucide-migration-plan.md`
- lesson: icon字体迁移坑：object-map的icon:字段是定义行不是渲染点，间接模式(getNodeIcon().icon)要改渲染span；verify脚本靠inner_text断言图标名，迁SVG必须改data-icon属性；Lucide线稿比Material填充偏细需strokeWidth校准+verticalAlign:middle对齐基线
- unresolved: 方案+组件就绪待批准执行B1-B5分批替换

### 13:54 | Codex

- done: Material→Lucide迁移评估+方案+映射组件+干跑分析：建AppIcon.tsx封装(147图标静态映射)，docs/lucide-migration-plan.md开发方案，lucide-react@1.76.0已装待替换
- context: material-symbols字体3.86MB占renderer产物32.8%；51文件~290静态span/49动态/65 object-map
- added:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `docs/lucide-migration-plan.md`
- modified:
  - `package.json`
  - `package-lock.json`
- lesson: icon:/iconName:字段混有业务token(success/asc/updated等)与CSS visibility，不能按名字纯文本批量替换；静态映射表保tree-shaking优于运行时名转换
- unresolved: 独立worker评审中；待批准后按B1-B5分批替换

### 13:49 | Codex

- done: 修复工作台回复按钮注入: Gemini Trusted Types CSP 拦 innerHTML/DOMParser 致按钮静默失败改 createElementNS; ChatGPT actionBar 误挂用户气泡行改限定 actionRow 容器; 提取内容克隆清洗剥掉 sr-only 说话人标签和操作按钮
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
  - `src/main/index.ts`
- lesson: Gemini/ChatGPT 等高 CSP 平台禁止 innerHTML/DOMParser 字符串→DOM,注入 UI 必须 createElementNS 程序化构建; ChatGPT 一轮有用户行+AI行两个 turn-action-controls 需按 actionRow 类名区分; 平台 sr-only 说话人标签(你说:/ChatGPT 说:)会被 htmlToMarkdown 当正文,提取前须克隆清洗
- unresolved: dev 实例已验证 Gemini+ChatGPT 注入位置与提取纯度; 豆包/元宝/千问未实机复验(选择器按先前 DOM 调查已配 userItemMarker/--ai 限定,建议用户在真实平台各发一条验证)

### 13:41 | Codex

- done: 修复工作台 Markdown 编辑器文字粘贴失效：WorkbenchImagePlugin 的 PASTE/DROP_COMMAND 处理器无论剪贴板内容均返回 true，高优先级吞掉默认粘贴；改为同步检查有无图片文件后再决定是否拦截
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImagePlugin.tsx`
- lesson: Lexical registerCommand 返回值决定处理器是否继续执行；注册为 COMMAND_PRIORITY_HIGH 的异步处理器必须在同步阶段先判断再返回，否则会无条件吞掉后续所有默认处理

### 13:06 | Codex

- done: 修复 workbench Markdown 预览表格过窄：表格改 auto layout+100%宽，单元格 75px 改 min-width
- modified:
  - `src/renderer/src/assets/index.css`
- lesson: Lexical TableCellNode 在无 colWidths 时内联 width:75px，配 table-layout:fixed+fit-content 会把 md 表格压成一列；渲染层用 table-layout:auto+width:100%+单元格 min-width 即可自适应，内联 75px 只作下限不阻塞分配

### 13:02 | Codex

- done: 修复工作台回复按钮注入三处 bug：ChatGPT 提取含用户消息、豆包按钮挂用户气泡、Gemini 按钮不可见
- context: 上会话已修过一轮去重/hover，本会话用户实测回报三平台仍有问题，用 iab 实 DOM 验证定位
- decision: AssistantReplyConfig 新增 contentItem（整轮容器内取 AI 正文块）与 userItemMarker（用户消息特征跳过）；bar 定位上爬限高 56px 防止爬进块级 footer（Gemini）；豆包靠 message_action_edit 区分用户/AI
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): 豆包用户消息与 AI 回复共用 w-full pl-14 和 message-action-bar，判别特征是操作栏内 message_action_edit（用户）vs message_action_like/dislike（AI）；ChatGPT 一轮对话是单 .group 容器含用户气泡+AI 正文，AI 正文用 [data-chatgpt-search-unit-key$=:assistant]；Gemini buttons-container-v2 的父级是 block footer，bar 上爬必须限高

### 12:47 | Codex

- done: 修复撤回后无法重试插入bug:lastInsertHash用===永久记录replyHash,撤回/采纳后重试同一条回复被永久跳过;改为{hash,at}时间窗防抖(1.5s内同payload双击跳过,撤回/采纳后重试必然超窗允许)
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: 防重复防抖要用时间窗而非永久标记;采纳/撤回在Lexical内部完成、sidebar无感知,防双击与'允许重试'的边界只能按时间而非状态划分

### 12:45 | Codex

- done: 内置浏览器逐一核验并修复工作台'回复插入'按钮注入点：豆包 replyItem 加 :has(message-action-bar) 限定+actionBar 换失效 hash 为语义类；元宝 replyItem 限定 --ai 变体+actionBar 换 toolbar__right；ChatGPT replyItem/actionBar 全换（data-message-author-role 已失效→turn-action-controls）；千问 replyItem 换 message-select-wrapper-answer（区分 question/answer）；findReplyItems 兜底 firstMatch→lastMatch
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson: 各平台 replyItem/actionBar 选器全量失效（hash 类名 actionButton-m1fXIC/ToolbarCopy_icon__5Odjl/data-message-author-role 都变了）；iab 内置浏览器登录态独立：豆包/元宝/Gemini/ChatGPT/千问/Grok(部分)可核验，DeepSeek/Kimi/Claude/文心/智谱/Perplexity/Arena 未登录或验证码拦截；通用注入选器要用 :has() 区分用户/AI 气泡，避免把按钮挂到用户消息下
- unresolved: DeepSeek/Kimi/Claude/Grok/文心/智谱/Perplexity/Arena 无法在 iab 核验（未登录）；Grok 全 CSS-in-JS 混淆类无语义选器可用，维持兜底

### 12:34 | Codex

- done: 修复主页面模式切换设置不生效：normalizeProductModeConfig 中 hidden 数组在自身 filter 回调里被引用（TDZ ReferenceError），导致隐藏非空时整个 set 抛错回退；改为 forEach 累加写法
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ProductModeOrderModal.tsx`
- lesson: 数组常量在其自身 .filter/.map 回调里被引用会触发 TDZ ReferenceError 且只在数据非空时暴露；去重场景改用 forEach+累加数组

### 12:22 | Codex

- done: 修复工作台'回复插入'按钮重复注入与错位：findReplyItems 去重嵌套 replyItem（元宝同回复外层气泡+内层 markdown 各挂一组→6组），ensureButtons 加 DOM 级幂等（.mc-workbench-btn 存在即跳过），bar 定位收紧为横向单行按钮行（flex row/h≤48/textLen<30，避免 prepend 到回复卡顶部），按钮 hover 加灰色背景
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/utils/selectorDiagnostics.ts`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
- lesson: webview 内嵌页面可用 CUA getAXState 直接读（Electron webview 暴露给 a11y tree）；元宝 replyItem 选器命中嵌套容器导致重复注入，须按 contains 去重取最外层；bar 定位不能只看'含≥2交互子元素'，回复卡本身满足该条件会错位
- unresolved: probeActionBar 探针已挂到 WebviewCardRef（与 probeMessageContainer 同族 dev 诊断能力），未接 UI；其他平台（kimi/deepseek/claude/grok/yiyan 等未配置 assistantReplyConfigs 走 createBar 兜底）注入位置未逐一真机核验

### 12:13 | Codex

- done: 工作台删除当前打开文件后自动切换到排序上的相邻文件（先向后再向前），删除包含当前文件的目录同样生效；无剩余文件才显示空状态
- context: 用户反馈：删除当前打开的笔记后出现'未打开任何文档'空状态，希望自动打开下一个文件
- decision: 删除前按 fileSort 排序拍平文件树预取后继者，删除成功并 loadFileTree 后调用 openFile 切换；openFile 内部处理了 dirty 刷盘与 lastActiveFilePath 持久化
- lesson(promoted): tsconfig.web.json 缺少 target 导致存量 TS2802 等 12 个类型错误，验证时以"错误清单未新增"为准（已并入 KNOWLEDGE 主题12）
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 12:11 | Codex

- done: 设置面板新增'主页面模式切换'自定义：4 个模式（多AI/任务分配/辩论/工作台）支持拖拽排序、上下移、显隐开关，至少保留两个可见；配置持久化到 productModeConfig 键，当前模式被隐藏时自动回落第一个可见模式
- added:
  - `src/renderer/src/components/ProductModeOrderModal.tsx`
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
- lesson: ProductMode 分 tab 显示/排序配置可走 electron-store 单键（order+hidden），normalize 时按 ALL_PRODUCT_MODES 白名单过滤并保证≥2 可见

### 12:09 | Codex

- done: v4增量：插入到光标上次停留处(lastAnchorRef序列化锚点+isAttached校验,失效时selectEnd兜底)+待确认高亮PendingInsertNode容器(非黄淡蓝,含PendingBarNode装饰器✓采纳/✗撤回)+失效修复(先saveActiveFile清dirty再经Lexical editor.update内部插入,消除双向回写竞争)+新文档名=对话名重名-2/-3+frontmatter补source链接+actionBar挂载改向上找含≥2按钮容器prepend+insert图标换落笔
- decision: MarkNode isInline=true跨不了block,改PendingInsertNode Element容器一处解决高亮+撤回;;frontmatter归store层管body归Lexical
- added:
  - `src/renderer/src/components/workbench/PendingInsertNode.tsx`
  - `src/renderer/src/components/workbench/PendingBarNode.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/assets/index.css`
  - `docs/reply-insert-into-workbench-design.md`
- lesson: Lexical 0.53自定义ElementNode/DecoratorNode: exportJSON需兼容compact overload,SerializedXNode直接用基类型勿用Spread<Record<string,never>>否则type/version推成never;ElementNode容器法比MarkNode更适合跨block临时高亮

### 12:08 | Antigravity

- done: 移除工作台内容区域最外层容器的半透明暗背景，使页面底部渐变背景直接通透呈现
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 12:02 | Codex

- done: 修复工作台侧边栏无法切换到未启用模型（DeepSeek/元宝等）的问题
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: 侧边栏为 isolated 隔离场景，切换目标需与下拉选项一致使用全量 models；若沿用主界面 enabled 过滤，选中未启用模型时 webview 不挂载、currentModel 回退到首个 enabled 模型，表现为点击无效

### 12:01 | Codex

- done: 工作台模式：为中间编辑区顶部两角、右侧 AI 侧栏左上角加适中圆角(rounded-xl)，新增外层灰色衬底容器使圆角可见
- context: 用户截图红框标注三处角需圆角，圆角不要太大
- decision: 用 bg-black/[0.03] 外层衬底 + rounded-xl + 补边框/bg，圆角自然且不影响 webview 内容
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 11:45 | Codex

- done: 实现工作台 AI 回复一键插入 Markdown：selectors.ts 新增 assistantReplyConfigs(chatgpt/gemini/qwen/doubao/yuanbao)；webviewScripts.ts 新增 generateInsertReplyButtonScript(MutationObserver 幂等挂两按钮,console.log __MC_前缀回传)；WebviewCardRef 新增 getWebview() 只读访问器;WorkbenchAiSidebar 注入脚本+console-message 监听(仅此模式注入,其他模式零感知);workbenchStore 新增 insertReplyIntoActiveMarkdown(仅.md追加落盘)/saveReplyAsNewMarkdown(平台-时间戳.md 自动打开)；主窗口 minWidth 900→1100 防工作台三栏挤压
- decision: 回传通道=console-message(webview无preload);只WorkbenchAiSidebar注入其他模式零感知;插入仅markdown类文件
- added:
  - `docs/reply-action-dom/*.md`
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/main/webviewManager.ts`
  - `docs/reply-insert-into-workbench-design.md`
- unresolved: 8家未登录平台选择器待补;dev实机验证按钮出现/插入/存新待跑

### 11:45 | Codex

- done: 修复工作台小窗口下两侧分隔条无法拖拽问题（webview 原生层遮挡命中）；中栏最小宽 360→480；字数/保存状态从工具栏移至编辑区右下角悬浮胶囊（WYSIWYG 与源码模式共用）
- added:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
- lesson: Electron <webview> 是原生插件层，会遮挡相邻 DOM 的指针命中；分隔条需要足够大的命中区域并在拖拽时用全屏透明遮罩接管事件

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
- lesson(promoted): Windows 下 Hyper-V/WSL/WinNAT 动态排除端口范围（如 5141-5240）会导致 Vite 默认 5173 绑定报错 EACCES: permission denied；在 electron.vite.config.ts 中将 renderer.server.port 避开该区间（如 5300）并指定 host 127.0.0.1 即可彻底解决

