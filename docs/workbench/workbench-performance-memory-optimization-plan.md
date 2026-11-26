# MultiChat Desk 工作台性能与内存优化开发文档

> Created: 2026-11-25 21:00 (+08:00)

本文档基于对工作台全链路（编辑器与 Lexical 插件、源码模式、标注系统、文件树/搜索/Git 面板、多格式预览、思维导图、AI 侧边栏与本地 Agent、主进程服务与 IPC）的源码级深度审查整理而成，旨在作为后续分阶段性能优化与内存治理的详细开发指南。

---

## 一、优先级评估标准

为保证性能优化过程**不以牺牲日常交互体验或引入数据丢失风险为代价**，本文档按**「用户体验影响 × 性能/内存收益」**划分三级优先级：

| 优先级 | 定义标准 | 用户体验风险 | 推进策略 |
|---|---|---|---|
| **P0** | **体验无下降、纯正向收益**：不改变任何交互语义与视觉习惯（部分项还能顺带修复闪烁/误触 Bug），消除明显主线程卡顿、子进程风暴、OOM 与资源泄漏 | **零下降（纯正向）** | 优先落地，按模块逐项合入并回归验证 |
| **P1** | **高收益但存在可感知 UX 权衡或实现边界风险**：收益大，但需要配套防护机制（如 flusher、语义探针、距离缓冲、读写分离同帧执行）避免丢字、闪烁或打断后台任务 | **可控权衡 / 需配套防护** | 先对齐边界策略与交互细节，再分步实现 |
| **P2** | **长尾开销治理 / 强 UX 权衡或低频场景优化**：主要影响极端规模工作区、长时间运行长尾内存，或仅涉及边际交互体验的清理 | **轻微权衡或低影响** | 按需排期，结合相关模块迭代顺带清理 |

---

## 二、优化项总览矩阵

### P0 级（体验无下降、纯正向收益，共 17 项）

| 编号 | 所属模块 | 优化项 | 核心收益 |
|---|---|---|---|
| P0-01 | 本地 Agent | 修复 `AgentComposer` 空队列 selector 每次返回新 `[]` 及无缓存全树拍平 | 消除每 token 与每次击键对整棵文件树的同步递归遍历 |
| P0-02 | 本地 Agent | `MarkdownRenderer` 静态化配置与 `React.memo` + `AgentCard` 历史消息项记忆化 + 剔除 O(N²) 计算 | 流式输出不再每 token 全量重解析所有历史消息 |
| P0-03 | 本地 Agent | 合并 `<ChangedFilesCard>` 并发读盘 + 清理无消费 `branchUserEntries` / 重复 `sessionStatus` IPC | 恢复 30 轮长会话从 30–60 次并发 IPC 读盘降为 1 次 |
| P0-04 | 富文本编辑器 | `WorkbenchAnnotationPlugin` 与 `WorkbenchFootnotePlugin` 纯选区变化早退 + 复用 `compactWithOffsets` | 消除每次击键/移动光标的 `discrete` 二次更新与 O(N×L) 全文扫描 |
| P0-05 | 编辑器状态栏 | `wordCount.ts` 复用单例 `Intl.Segmenter` | 消除中英混排编辑每次击键新建数百至数千个 Segmenter 实例 |
| P0-06 | Git Diff 算法 | `gitDiff.ts` Myers `trace` 按层分配 `2d+1` + 富文本 `WorkbenchGitGutterPlugin` 复用 Web Worker | 峰值内存从 **~1.6GB 降至几十 MB**，消除富文本主线程阻塞与 OOM 风险 |
| P0-07 | 主进程 Git | 缓存 `git --version` / `resolveRepo` + 去掉 `loadFileTree` 后重复刷新 + 读写队列分离 | 单次刷新 spawn 次数减半以上，消除网络操作阻塞只读查询 |
| P0-08 | 主进程扫描 | `getWorkspaceTags` 与 `search` 先过滤忽略目录再跳过普通条目 `realpath` + 加软链环保护 | 扫描耗时降低一个数量级，消除软链成环打满超时的风险 |
| P0-09 | 主进程标注 | `annotationService.ts` 补齐二进制/体积守卫 + 未标注文档合并为单遍扫描 | 杜绝右键删除大 PDF/视频触发全文件 UTF-8 读盘 OOM；切文档 IO 减半 |
| P0-10 | 文件树 | 缓存 `Intl.Collator` + 跳过折叠目录排序 + 拆分内联输入组件 + 节点 `React.memo` 与移除无关订阅 | 重命名打字、保存变脏、拖拽不再触发整树重排重渲染 |
| P0-11 | HTML 预览 | 移除 `WorkbenchCodePreview` 标注预览 `key` 中的 `saveStatus`/`isDirty` + 0 标注与焦点切换早退 | 修复每次保存 iframe 销毁重建闪烁；消除无标注页全量 TreeWalker |
| P0-12 | Webview 注入 | `useSourceAnnotations` 在 0 标注页面跳过高亮脚本注入 | 消除所有未标注 AI 网页流式生成期间每 200–300ms 全页文本遍历 |
| P0-13 | PDF 预览 | 亮色模式跳过 `page.getOperatorList()` + 父级共享单个 `IntersectionObserver` | 消除亮色模式阻塞文字层的指令遍历及数百个冗余 Observer |
| P0-14 | DOCX 预览 | 缓存未缩放固有页宽，取消每次 resize 翻转 `style.zoom = '1'` + 修复异常路径 Blob 回收 | 消除拖拽分栏时的双倍全文档强制同步回流与异常 Blob 泄漏 |
| P0-15 | 导图 & 工作台容器 | 导图移除无用 `activeFileContent` 订阅 + 工作台四栏加 `React.memo` + 修复隐藏工作台全局快捷键穿透 | 消除拖拽分栏整页重渲染、隐藏导图无效重渲染及切页快捷键误触 |
| P0-16 | 主进程资源治理 | `AgentTaskService` 无头窗口空闲销毁 + `NoteManager` 切工作区清理旧导图 Watcher + 修复锁表与 `store.set` | 彻底堵住每调用一平台永久常驻 150–400MB 窗口与主进程同步刷盘 |
| P0-17 | 编辑器微插件 | `WorkbenchFloatingToolbarPlugin` 浅比较防重渲染 + `WorkbenchSourceEditor` CM6 Gutter 复用 Marker + `WorkbenchDraggableBlockPlugin` 改 ref | 消除每次击键、光标移动、鼠标扫过段落的无效 React/DOM 重建 |

### P1 级（高收益，存在可感知 UX 权衡或实现边界风险，共 10 项）

| 编号 | 所属模块 | 优化项 | 潜在体验权衡 / 关键防护点 |
|---|---|---|---|
| P1-01 | AI 侧边栏 Webview | 修复折叠重开历史 Webview 并发雪崩 + 改用 DOM 语义探针替代 `getClientRects()` 休眠死循环 | 切回很久不用的旧平台需按需加载 1–3s；必须保证不误休眠正在生成的 AI |
| P1-02 | 本地 Agent | `<AgentCard>` 首次使用再懒挂载 + 流式推送节流（32–50ms）+ 智能跟随滚动 | 节流过大会变“蹦字”；隐藏态保留局部状态避免切回丢滚动/折叠态 |
| P1-03 | 源码模式 | `WorkbenchSourceEditor` `onChange` 防抖写回 Store + 配套 `sourceSyncFlusher` + 状态栏字数防抖 | 缺 flusher 会导致最后 300ms 输入丢失；字数显示有轻微 0.3s 滞后 |
| P1-04 | 代码预览 | 复用项目内已有的 CodeMirror 6 替换无虚拟化 `<pre>` 高亮预览 | 避免自造虚拟化截断跨屏复制，同时根治 5MB 文件冻结主线程 |
| P1-05 | 思维导图 | 移除 `SVGPathElement.prototype` 全局劫持，改为当前帧绘制前读写分离批处理 + 隐藏态暂停监听 | 若延迟到下一帧 rAF 会出现 16ms 曲线→折线闪烁，必须在同帧/微任务末尾批处理 |
| P1-06 | PDF 预览 | 懒加载 `getPage` + 缓存页宽高比消除缩放双重渲染 + 带安全缓冲区的 `page.cleanup()` | 混排异形页偶发轻微高度跳动；缩放防抖 150ms 内短暂模糊（但消灭白屏闪烁） |
| P1-07 | 主进程 Git & 标签 | `focus` 刷新加冷却/按 `.git` 文件变化触发 + Markdown 自动保存改为单文件增量更新标签 + `fs.watch` 过滤高噪目录 | 外部终端操作后可能出现 2–3s 延迟；watcher 忽略名单须与文件树显示一致 |
| P1-08 | 主进程 Agent 会话 | `AgentSessionService.activeSessions` 空闲 LRU 淘汰 + `listSessions()` 索引缓存避免全盘读 `.jsonl` | 严禁淘汰运行中/等待审批会话；切回很久前会话需重新读盘加载 |
| P1-09 | 编辑器结构 | 拆分 `WorkbenchEditor` 对 `activeFileContent` 的顶层订阅 + 增量拼装单块导出结果缓存 | 需核对 Frontmatter 面板与查找条的同步时机 |
| P1-10 | 旁注 / 大纲 / 表格 / HTML 拖拽 | 补齐高频 `scroll`/`pointermove`/`ResizeObserver` 的 rAF 节流 + 二分查找 ScrollSpy + 旁注布局 O(M×AST) 降为 O(AST+M) | 需确保拖拽视觉跟手、不丢末帧事件 |

### P2 级（长尾优化、极端规模治理或低频项，共 7 项）

| 编号 | 所属模块 | 优化项 | 说明 |
|---|---|---|---|
| P2-01 | 文件树 | 展开节点超阈值（>500）时的按需虚拟滚动 | 仅在极大扁平目录有必要，需同步改造拖拽自动滚屏与键盘定位 |
| P2-02 | 主进程笔记与导图 | `NoteManager` 摘要/正文分离与导图缓存 TTL 放宽 + 仅对变更文件重算哈希 | 优化长期积累数百篇大快照笔记与大量导图时的内存占用 |
| P2-03 | 富文本代码块 | `WorkbenchCodeHighlightPlugin` 仅对变动行/防抖执行 Prism 分词与单块 Diff | 针对单块 500–1,000+ 行超大代码块的编辑优化 |
| P2-04 | 渲染层 Agent 细节 | `ToolItem` 折叠态延迟 `JSON.stringify`/`parseDiff` + `InlineFileCode` 去树订阅 + `AgentCard` 历史大载荷裁剪 | 改善超长工具调用对话的内存与展开瞬间耗时 |
| P2-05 | 文件树 & Git 面板 | `WorkbenchGitPanel` 拆分 commit 输入与徽标 tooltip 状态 + 历史提交项 `React.memo` | 改动接近 500 项时提升输入 commit 信息流畅度 |
| P2-06 | 协议与启动 IPC | `workbench-file://` 静态 runtime 启用缓存、透传 `Range`、加 HTML 体积守卫 + 合并启动 18 次 `storeGet` | 优化音视频 seek 与冷启动 IPC 往返次数 |
| P2-07 | 长尾边界清理 | `WorkbenchFindHighlightPlugin` 锚点缓存、`scrollPositions` 容量上限、Worker `onerror` 兜底、`App.tsx` `initListeners` 清理、`WorkbenchImagePreview` 非被动滚轮与步进阈值、`LocalMindmapPanel` Undo 栈上限 | 防止长期运行后的边际泄漏与小瑕疵 |

---

## 三、P0 级优化详细开发方案（体验无下降、纯正向收益）

### P0-01：修复 `AgentComposer` 坏 Selector 与未缓存的全树拍平
- **涉及文件**：[AgentComposer.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/agent/AgentComposer.tsx#L44-L49)、[L98-L107](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/agent/AgentComposer.tsx#L98-L107)
- **当前问题**：
  1. `queuedSteering` 与 `queuedFollowUp` 两个 Zustand selector 在队列为空时返回新字面量 `[]`（`s.queuedSteering[s.currentSessionId] ?? [] : []`）。由于 Zustand 默认按 `Object.is` 比对，导致 `useAgentSessionStore` 任意字段变化（包括每个流式 `message_update` token）都会强制重渲染整个 `AgentComposer`。
  2. 第 98 行 `const flatFiles = (() => flattenFileTree(fileTree))()` 既无 `useMemo` 也未判断 `if (!atMention)`，每次 `AgentComposer` 重渲染（每 token + 每次输入框击键）都会同步递归拍平整棵工作区 `fileTree`。
- **为什么要优化**：在中大型工作区（数千文件）下，Agent 流式回复期间每秒触发 20–60 次全树递归与大数组分配，直接造成输入卡顿与频繁 GC；双侧栏下开销翻倍。
- **怎样优化**：
  1. 在模块作用域定义 `const EMPTY_QUEUE: readonly string[] = []`（按实际类型声明），selector 改为返回 `EMPTY_QUEUE`。
  2. 用 `useMemo` 包裹 `flattenFileTree(fileTree)`，且仅当 `atMention !== null` 时才执行扁平化与过滤排序：
     ```ts
     const flatFiles = useMemo(
       () => (atMention ? flattenFileTree(fileTree) : []),
       [atMention !== null, fileTree]
     )
     ```
- **体验影响**：零下降。`@` 提及补全与排队提示行为 100% 不变。

---

### P0-02：`MarkdownRenderer` 静态化配置与记忆化 + `AgentCard` 消息项拆分
- **涉及文件**：
  - [MarkdownRenderer.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/agent/MarkdownRenderer.tsx#L73-L234)
  - [AgentCard.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/AgentCard.tsx#L789-L1075)
- **当前问题**：
  1. `MarkdownRenderer` 未包裹 `React.memo`，且每次渲染内联创建 `remarkPlugins={[remarkGfm]}`、`rehypePlugins={[rehypeRaw]}` 和包含 17 个子组件的 `components={{ ... }}` 新对象，强制 `ReactMarkdown` 在每个流式 token 到达时把**所有已完成的历史消息**全部重新解析并重建子树。
  2. `AgentCard.tsx:789-900` 渲染循环中对每条消息调用 `messages.indexOf(...)`、`messages.reduce(...)`、`messages.slice(...).some(...)`（总体复杂度 O(N²)），并在流式进行中提前对正在增长的 `assistantText` 执行复杂 lookbehind 正则 `extractInlineFilePaths(assistantText)`，尽管结果在 `!isGroupRunning` 时才渲染（第 996 行）。
- **为什么要优化**：10–20 轮含代码/表格的对话在流式输出期间 CPU 飙升、页面明显掉帧。
- **怎样优化**：
  1. 将 `REMARK_PLUGINS = [remarkGfm]`、`REHYPE_PLUGINS = [rehypeRaw]` 提升至模块顶层常量；将 `components` 映射表提取为模块级稳定对象（依赖 `workspacePath` 等动态上下文的组件通过轻量 Context 或稳定回调注入）。
  2. 用 `React.memo` 包裹 `MarkdownRenderer`（按 `content` 与关键渲染 props 比较）。
  3. 将 `AgentCard` 中的用户消息与助手工作段拆为 `React.memo` 子组件（`AgentUserMessageItem`、`AgentWorkGroupItem`）；在单次 `useMemo([messages])` 内预处理 `turnIndex`、`hasLaterMessage` 等索引信息消除 O(N²) 查找；`extractInlineFilePaths` 和 `collectToolAttachmentPaths` 仅在 `!isGroupRunning` 时计算。
- **体验影响**：零下降。流式与历史消息渲染结果完全一致，交互显著更跟手。

---

### P0-03：合并 `<ChangedFilesCard>` 并发读盘 + 清理冗余 Agent IPC
- **涉及文件**：
  - [AgentCard.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/AgentCard.tsx#L1000-L1007)
  - [ChangedFilesCard.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/agent/ChangedFilesCard.tsx#L57-L107)
  - [agentSessionStore.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/store/agentSessionStore.ts#L155)、[L264-L276](file:///d:/Project/MultiChat-desk/src/renderer/src/store/agentSessionStore.ts#L264-L276)、[L1387](file:///d:/Project/MultiChat-desk/src/renderer/src/store/agentSessionStore.ts#L1387)、[L1713-L1751](file:///d:/Project/MultiChat-desk/src/renderer/src/store/agentSessionStore.ts#L1713-L1751)
- **当前问题**：
  1. `AgentCard` 为每个已完成轮次渲染独立 `<ChangedFilesCard>`，每个实例挂载即调 `agentGetFileChanges(sessionId)`，导致主进程重复读取解析同一份 `file-changes/index.json` N 次（双侧栏 2N 次），实际只有匹配 `turnIndex` 的 1 张卡片显示。
  2. 主进程 `AgentSessionService.ts:422-427` 已主动推送 `agent:session-status`，但 `agentSessionStore` 收到事件后仍多次重复 invoke `fetchSessionStatus()`。
  3. `refreshBranchEntries()` 在每次 `message_end` / `resumeSession` / `rewind` 拉取整条分支写入 `branchUserEntries`，但全前端无任何组件消费该字段。
- **为什么要优化**：恢复 30 轮历史会话时瞬间并发 30–60 次 IPC + 磁盘读取 + 重复 SHA1 校验，并产生无效 store 更新。
- **怎样优化**：
  1. 将 `fileChangesRecord` 提升到 `agentSessionStore`（按 `currentSessionId` 拉取一次并在 `agent_end` 刷新），`AgentCard` 仅在 `record && record.turnIndex === messageTurnIndex` 的那一轮渲染 `<ChangedFilesCard record={record} />`。
  2. 移除收到主进程已推送事件后的冗余 `fetchSessionStatus()` 调用。
  3. 移除无人消费的 `branchUserEntries` 自动拉取（若未来需要分支切换 UI 再按需在打开菜单时拉取）。
- **体验影响**：零下降。文件变更卡片展示完全一致，恢复长会话瞬间加载更快。

---

### P0-04：富文本标注与脚注插件消除纯选区更新扫描与 O(N×L) 重算
- **涉及文件**：
  - [WorkbenchAnnotationPlugin.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx#L397-L444)、[L819-L830](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx#L819-L830)、[L982-L985](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx#L982-L985)
  - [annotationAnchors.ts](file:///d:/Project/MultiChat-desk/src/shared/utils/annotationAnchors.ts#L33-L42)、[L331-L349](file:///d:/Project/MultiChat-desk/src/shared/utils/annotationAnchors.ts#L331-L349)、[L379-L399](file:///d:/Project/MultiChat-desk/src/shared/utils/annotationAnchors.ts#L379-L399)
  - [WorkbenchFootnotePlugin.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx#L164-L194)、[L295](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx#L295)、[L367-L370](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFootnotePlugin.tsx#L367-L370)
- **当前问题**：
  1. `WorkbenchAnnotationPlugin.tsx:819-830` 未过滤 `dirtyElements.size === 0 && dirtyLeaves.size === 0`，每次移动光标或击键（甚至 0 标注文档）都同步触发 `editor.update(() => cleanMarkNodes(...), { discrete: true })`，全树遍历并引发所有其他插件再执行一轮。
  2. `WorkbenchAnnotationPlugin.tsx:982-985` 同样未过滤纯选区变化；600ms 防抖进入 `resolveProjectedAnnotations` 后，循环内逐条调用 `resolveAnnotationAnchors(text, [annotation])` 与 `buildAnchorAt(text, start, end)`，两者每次都重跑整篇 `compactWithOffsets(text)`，导致 **O(N×L)** 耗时与巨量临时数组分配；且偏移变化回写 `documentAnnotations` 时触发 `applyAnnotations` 连续执行 **2 次**整篇 `toJSON(true)` + `parseEditorState` + `$convertToMarkdownString`。
  3. `WorkbenchFootnotePlugin.tsx:367-370` 未过滤纯选区更新与 `annotation-sync`、未对 rAF 合帧及卸载取消，每次击键/移动光标全树正则扫描 + 2 次 `querySelectorAll`（0 脚注文档亦然）；另 `window` scroll 捕获监听未设 `{ passive: true }`。
- **为什么要优化**：5,000 行 + 100 标注文档中，每次编辑停顿 600ms 主线程冻结可达数百毫秒至数秒，普通打字/方向键移动也出现肉眼可见延迟。
- **怎样优化**：
  1. 标注 `registerUpdateListener`（`L819` 与 `L982`）：增加 `if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return`；并在 `L819` 先 `editorState.read()` 轻量检测文档是否真有 `MarkNode` 或脏节点中是否涉及 `MarkNode`，无变更直接跳过 `editor.update(..., { discrete: true })`（不再空跑第二轮提交）。
  2. `annotationAnchors.ts`：为 `resolveAnnotationAnchors` 和 `buildAnchorAt` 增加可选参数 `precomputedCompact?: CompactTextIndex`，在 `resolveProjectedAnnotations` 循环前计算一次 `compactWithOffsets(text)` 供全部标注复用，复杂度从 O(N×L) 降为 **O(L + N)**。
  3. 仅当标注锚点需要真正**重新投影 DOM**（如 `unlocated -> anchored`、新增/删除标注、或 Mark 缺失）时才跑 `applyAnnotations()`；纯 `offsetHint` 数字位移更新只同步内存元数据，不拆装已有正确的 `MarkNode` DOM，从而跳过 2 次整篇 `toJSON(true)` + `parseEditorState`。
  4. `WorkbenchFootnotePlugin`：同样过滤 `dirtyElements.size === 0 && dirtyLeaves.size === 0` 与 `tags.has('annotation-sync')`；用单 `rafId` 合帧并在卸载时 `cancelAnimationFrame`；先通过 `registerMutationListener` 追踪文档是否存在脚注节点或 `[^` 文本，无脚注且无 `[^` 时直接跳过；scroll 监听补 `{ capture: true, passive: true }`。
- **体验影响**：零下降。标注定位精度、撤销后恢复高亮与脚注状态同步均保持不变（仍保留 `HISTORIC_TAG` 与 `SKIP_SELECTION_FOCUS_TAG` 约束）。

---

### P0-05：`wordCount.ts` 复用单例 `Intl.Segmenter`
- **涉及文件**：[wordCount.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/utils/wordCount.ts#L26-L66)
- **当前问题**：`countWords()` 对文本中每一个非 CJK 片段调用 `countNonCjkWords`，内部每次执行 `new Intl.Segmenter(undefined, { granularity: 'word' })`。中英混排长文档每次统计都会新建数百至数千个 ICU Segmenter 实例。
- **为什么要优化**：`Intl.Segmenter` 构造涉及底层 ICU 词典初始化，高频实例化造成极大 CPU 与内存分配开销。
- **怎样优化**：在模块顶层缓存单个 `const wordSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null`，直接复用 `wordSegmenter.segment(chunk)`；同时避免 `Array.from(text)` 分配完整单字符数组，改用线性遍历 `for (let i = 0; i < text.length; ...)`（或正则分段）统计 CJK 与非 CJK 区间。
- **体验影响**：零下降。字数统计结果与原实现完全等价。

---

### P0-06：`gitDiff.ts` 内存压缩（1.6GB → 几十 MB）+ 富文本 Git Gutter 走 Web Worker
- **涉及文件**：
  - [gitDiff.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/utils/gitDiff.ts#L96-L130)
  - [WorkbenchGitGutterPlugin.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchGitGutterPlugin.tsx#L115-L123)、[L150-L159](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchGitGutterPlugin.tsx#L150-L159)
  - [useGitLineDiff.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useGitLineDiff.ts#L64-L85)
- **当前问题**：
  1. `gitDiff.ts:96-129` 声明 `width = 2 * (midN + midM) + 1`，每步 `d` 把整条 `v.slice()` 存入 `trace`。当两侧各 20,000 行且 `d = 5,000` 时，单层 `Int32Array` 占 320KB，总计 **~1.6GB**；5,000 行大改也瞬时分配 200–400MB。
  2. `WorkbenchGitGutterPlugin` 未复用 `useGitLineDiff` 的 Web Worker 分流，在主线程同步执行 Myers diff，且删除点匹配存在 O(D_del × B) 嵌套扫描。
  3. `useGitLineDiff.ts:79` 将 `baseline.split('\n')` 写在依赖 `currentText` 的 `useEffect` 内，每次击键都重复切分 `baseline`。
- **为什么要优化**：大改或格式化长文档极易触发 Electron Renderer 明显冻结甚至 OOM 崩溃。
- **怎样优化**：
  1. `gitDiff.ts` 第 `d` 层只保存 `[-d, +d]` 范围的 `2d + 1` 个有效值：`const sliceLen = 2 * d + 1`，写入 `v.subarray(max - d, max + d + 1).slice()`；回溯时按偏移 `k + d` 索引（`d=0..5000` 总大小从 `5000 × 80001 × 4B ≈ 1.6GB` 降至 `5000² × 4B ≈ 100MB`，且若仅存偶数/奇数对角线 `d + 1` 个槽位可再减半至 **~50MB**，在 5,000 行大改时降至 **<12MB**）。
  2. 将 `baseline` 的行数计算独立到 `useMemo([baseline])` 中。
  3. 让 `WorkbenchGitGutterPlugin` 复用 `useGitLineDiff`（超 4,000 行自动走 Worker），并将删除点到块索引的匹配改为双指针/二分查找 O(D_del log B)。
- **体验影响**：零下降。Diff 输出结果逐行一致，富文本大文档 gutter 刷新不卡主线程。

---

### P0-07：主进程 Git 缓存与去重 + 读写串行队列分离
- **涉及文件**：
  - [gitService.ts](file:///d:/Project/MultiChat-desk/src/main/services/gitService.ts#L52-L69)、[L209-L234](file:///d:/Project/MultiChat-desk/src/main/services/gitService.ts#L209-L234)、[L304-L316](file:///d:/Project/MultiChat-desk/src/main/services/gitService.ts#L304-L316)、[L727-L799](file:///d:/Project/MultiChat-desk/src/main/services/gitService.ts#L727-L799)、[L840-L899](file:///d:/Project/MultiChat-desk/src/main/services/gitService.ts#L840-L899)
  - [workbenchStore.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L957-L958)、[L1032-L1033](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L1032-L1033)、[L1463-L1464](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L1463-L1464)、[L1494-L1495](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L1494-L1495)、[L1729-L1730](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L1729-L1730)、[L2029-L2030](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L2029-L2030)、[L2054-L2055](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L2054-L2055)、[L2116-L2117](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L2116-L2117)、[L2753-L2813](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L2753-L2813)
- **当前问题**：
  1. `git --version` 与 `resolveRepo`（3 次 `rev-parse`）完全无缓存，导致 `getStatus` 和 `getFileBaseline` 各自每次都要 spawn **7 次 `git`**；`getFileBaseline` 未支持传入已知 `blobSha` 短路，基线未变仍重复 `cat-file -p` 传回高达 1MB 文本。
  2. `workbenchStore` 中十余处操作在 `await loadFileTree()`（其内部 `L1057` 已调 `refreshGitStatus()`）之后紧接着又调一次 `refreshGitStatus()`，触发 `gitStatusPending = true` 使整套 7 次 spawn 连跑两遍；`gitPull`/`gitMergeUpstream`/`gitAbortMerge` 更叠加了 `loadFileTree` + `handleExternalFsChanged` + `refreshGitStatus` 三重重复扫描。
  3. 只读 `getStatus`/`getFileBaseline` 与最长 120s 的 `pull`/`push`/`commit` 共用同一串行队列 `serialize(workspaceRoot)`。
  4. `readStatus` 对最多 2,000 个未跟踪文件执行无并发上限的 `Promise.all(stat)`；`listIgnoredPaths` 在非 Git 目录下每次仍 spawn `git ls-files`。
- **为什么要优化**：Windows 下单次 Git spawn 耗时 40–100ms，当前单次增删文件或切窗就产生 14–22 次子进程创建，造成 0.5–1.5s 磁盘/进程抖动，且网络 push/pull 期间切文件读基线全部卡住。
- **怎样优化**：
  1. **进程级缓存 `gitAvailable`**：启动/首次检测后缓存 `git --version` 结果（失败时可短 TTL 30s 重试，避免用户刚装好 git 需重启）。
  2. **工作区级缓存 `resolveRepo`**：合并 3 次 `rev-parse` 为单次 `git rev-parse --show-toplevel --is-inside-work-tree --absolute-git-dir`，按 `workspaceRoot` 缓存（在 `gitInit`、切/关工作区、或命令返回非仓库错误时失效）；非 Git 目录直接跳过 `listIgnoredPaths()`。
  3. **`getFileBaseline` 支持 `knownBlobSha` 短路**：前端传入当前 `gitBaselineSha`，主进程跑完 `ls-files -s` 若 SHA 一致直接返回 `{ status: 'unchanged', blobSha }`，免去 `cat-file` 与 1MB IPC 传输；前端为 `refreshGitBaseline` 增加与 `refreshGitStatus` 同款的 in-flight 合并。
  4. **读写队列分离**：写操作（`commit`/`pull`/`push`/`merge`/`discard`）走写串行队列；只读操作（`getStatus`/`getFileBaseline`/`getLog`）不排在网络操作之后。
  5. **移除重复触发**：清理 `workbenchStore` 中所有 `await loadFileTree()` 后面冗余的 `void get().refreshGitStatus()`；`gitPull`/`merge`/`abort` 后避免重复调用 `loadFileTree` 与 `handleExternalFsChanged` 两次扫树；未跟踪文件 `stat` 加上并发限流（如 32）。
- **体验影响**：零下降。Git 状态与行级基线完全实时准确，且显著消除刷新图标久转和网络操作期间的界面阻塞。

---

### P0-08：优化 `getWorkspaceTags` 与 `search` 的遍历开销与软链防护
- **涉及文件**：[workbenchService.ts](file:///d:/Project/MultiChat-desk/src/main/services/workbenchService.ts#L1994-L2064)、[L2074-L2204](file:///d:/Project/MultiChat-desk/src/main/services/workbenchService.ts#L2074-L2204)
- **当前问题**：
  1. `getWorkspaceTags` 和 `search` 在遍历目录时，先对每个条目调用 `assertSafePath`（每次 **2 次 `fs.realpath`**），之后才调用 `isFiltered` 跳过 `node_modules`/`.git`；完全串行 `for...await`；且缺少 `readTree` 中已有的 `ancestors` 符号链接环检测。
  2. `search` 在用户修改关键词后，前序扫描未取消，在主进程并发堆积多个 1500ms 串行扫盘任务。
- **为什么要优化**：在包含 `node_modules` 或深层目录的工作区中，逐条双 `realpath` 是磁盘 IO 瓶颈核心；软链环会直接打满 3s/1.5s 超时。
- **怎样优化**：
  1. 复刻 `readTree` 的已验证优化：入口只对 `workspaceRoot` 做一次 `realpath`；遍历期间**先按名称和规则过滤忽略目录**；仅对 `entry.isSymbolicLink()` 执行 `realpath` 并用 `ancestors: Set<string>` 防环，普通文件/目录跳过 `realpath`。
  2. 为 `getWorkspaceTags` 和 `search` 引入有界并发（如 16 并发槽），并为 `search` 增加按 `workspaceRoot` 的搜索代际号/取消标记（新搜索到达时中断旧循环）。
- **体验影响**：零下降。搜索与标签补全结果完全不变，响应速度大幅提升。

---

### P0-09：`annotationService.ts` 补齐二进制/体积守卫与单遍扫描
- **涉及文件**：
  - [annotationService.ts](file:///d:/Project/MultiChat-desk/src/main/services/annotationService.ts#L162-L192)、[L431-L514](file:///d:/Project/MultiChat-desk/src/main/services/annotationService.ts#L431-L514)
  - [WorkbenchFileTree.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFileTree.tsx#L1706-L1708)
- **当前问题**：
  1. `fingerprintOf()` 无任何文件类型或大小限制，直接 `readFile(absolute, 'utf8')` + SHA-256。右键删除工作区里任意文件（包括 150MB PDF、视频、压缩包、大图）时都会先调用 `annotations.listDocument`，可能触发主进程卡死甚至 `ERR_STRING_TOO_LONG` / OOM。
  2. 绝大多数未标注文档在 `findDocumentAnnotationFile` 中命中 `direct === null` 后，会串行读取并 `JSON.parse` 全部标注文件**两遍**（第一遍查 `relativePath`，第二遍重读重解析查 `contentHash`）。
  3. 读路径 `L441-456` 在未持 `serial()` 锁的情况下执行 `atomicWrite`。
- **为什么要优化**：消除确定性的大文件删除卡死/OOM 风险，并将切换未标注文档时的磁盘读取减半。
- **怎样优化**：
  1. `fingerprintOf()` 先按扩展名（复用 `getFileCategory` 仅允许 `markdown`/`text`/`code` 等可标注文本类）与 `info.size <= MAX_ANNOTATION_TEXT_BYTES`（如 5MB）做守卫；二进制或超大文件直接跳过内容读取（返回 `{ size, mtime }` 或 `undefined`）。
  2. `findDocumentAnnotationFile` 合并为**单遍扫描**：单次读取解析每个 JSON 文件，同时检查 `relativePath` 精确命中与收集 `contentHash` 候选；另可维护轻量内存索引 `Map<workspaceRoot, Map<relativePath, fileName>>`（由写/删操作同步维护）。
  3. 读路径需要回写指纹更新时，必须经 `serial()` 锁执行。
- **体验影响**：零下降。二进制文件本身无正文标注功能，文本标注改名认领逻辑完全保留。

---

### P0-10：`WorkbenchFileTree` 排序与重渲染彻底去冗余（零虚拟化风险版）
- **涉及文件**：[WorkbenchFileTree.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFileTree.tsx#L164-L218)、[L347-L371](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFileTree.tsx#L347-L371)、[L439-L451](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFileTree.tsx#L439-L451)、[L1022-L1201](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFileTree.tsx#L1022-L1201)
- **当前问题**：
  1. `sortNodes` 每次比较新建 options 调用 `localeCompare(..., { numeric: true, sensitivity: 'base' })`（未用 `Intl.Collator`）；且 `L1037` 在检查 `isExpanded` 之前就对所有折叠目录执行排序，`flatVisibleNodes` 又排序第二遍。
  2. 顶层订阅 `isDirty`、`gitStatus`，并持有 `inlineRenameValue`、`inlineInputValue`、`dropTargetDir`、`contextMenu`、`isSortMenuOpen` 等局部交互状态；所有树节点未用 `React.memo` 隔离，导致**重命名每敲一个字符、编辑器变脏/保存、拖拽滑过目录**都会把整棵文件树重排并全量重渲染。
- **为什么要优化**：2,000+ 文件工作区下，重命名输入和拖拽出现 50–300ms 明显卡顿。
- **怎样优化**：
  1. 在模块作用域创建单例 `const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`（主进程 `workbenchService.ts:1036` 同步替换）。
  2. 用单一 `useMemo([fileTree, fileSort])` 生成排序结果（或仅对展开目录 `expandedFolderIds` 懒排序），`flatVisibleNodes` 直接复用已排序结果不再二次排序。
  3. 将内联重命名/新建输入框抽为独立子组件管理自身输入值 state，敲字不再触发父组件重渲染。
  4. 将树节点行拆为 `React.memo` 子组件，仅传入该行自身的 `isSelected`、`isActive`、`isDirty`（仅当前激活文件一行变化）、`gitBadge`（从 Map 查出的单行标量）和稳定回调。
- **体验影响**：零下降。视觉、拖拽、多选、右键菜单和键盘导航行为 100% 不变。

---

### P0-11：HTML 标注预览避免保存重建 iframe + 0 标注/焦点切换早退
- **涉及文件**：
  - [WorkbenchCodePreview.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchCodePreview.tsx#L658-L665)
  - [workbenchHtmlAnnotations.ts](file:///d:/Project/MultiChat-desk/src/shared/utils/workbenchHtmlAnnotations.ts#L131-L193)、[L310-L384](file:///d:/Project/MultiChat-desk/src/shared/utils/workbenchHtmlAnnotations.ts#L310-L384)、[L573-L602](file:///d:/Project/MultiChat-desk/src/shared/utils/workbenchHtmlAnnotations.ts#L573-L602)、[L699-L712](file:///d:/Project/MultiChat-desk/src/shared/utils/workbenchHtmlAnnotations.ts#L699-L712)
  - [WorkbenchHtmlAnnotationPreview.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx#L466-L479)、[L701-L710](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx#L701-L710)
- **当前问题**：
  1. `WorkbenchCodePreview.tsx:658-665` 把 `saveStatus` 和 `isDirty` 拼进了标注预览组件 `key`，导致每次保存状态流转都会销毁并重建整个 iframe。
  2. `workbenchHtmlAnnotations.ts` 在**仅切换高亮焦点 `activeId`**、点空白、滚动、按 Esc、甚至 **0 条标注**时，都完整重跑 `buildTextIndex()`（全页 `TreeWalker` + `getComputedStyle`）+ 逐字符正则 `compactWithOffsets` + O(A×N) 线性 `rangeFromOffsets`。
  3. 重复向 `document` 与 `window` 绑定 `scroll` 监听；宿主侧批量删除未定位标注在循环中逐条 `setAnnotations`，触发 N 次全量 `sync` 和全量索引重建。
- **为什么要优化**：消除保存 HTML 时的白屏重载闪烁，显著降低长 HTML 报告的点击/滚动卡顿。
- **怎样优化**：
  1. `key` 移除 `${saveStatus}-${isDirty}`，仅保留 `${activeFilePath}-${activeFileUrl}-${previewReloadKey}`（外部改盘或用户点刷新时递增 `previewReloadKey` 即可）。
  2. 拆分 `syncAnnotations()`（仅在标注列表非空且收到 `sync` 或实质 DOM 变化时建索引解析）与 `updateFocusHighlight(activeId)`（仅 O(1) 替换 CSS `FOCUS_NAME` Highlight，不重建文本索引）；标注数为 0 时直接清空 Highlight 并跳过 `buildTextIndex()`。
  3. `rangeFromOffsets` 改为对 `index.nodes` 二分查找 O(log N)；去掉重复的 `window` scroll 监听；批量删除未定位标注改为循环完成后单次 `setAnnotations`；宿主 `message` 监听用 ref 读取 `allAnnotations` 避免频繁解绑重绑。
- **体验影响**：零下降（且直接修复每次保存时 iframe 闪烁丢滚动位置的现有 Bug）。

---

### P0-12：`useSourceAnnotations` 0 标注页面跳过高亮脚本注入
- **涉及文件**：
  - [useSourceAnnotations.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useSourceAnnotations.ts#L98-L185)
  - [webviewScripts.ts](file:///d:/Project/MultiChat-desk/src/shared/utils/webviewScripts.ts#L2984-L3134)
- **当前问题**：对每个打开的 HTTPS AI 页面，即使该页面 **0 条原文标注**，仍会注入完整 `generateNoteHighlightScript`，在 guest 页面常驻全子树 `MutationObserver`（300ms）+ 捕获 `scroll`（200ms），每次触发全页 `TreeWalker` + 逐字符正则；且有标注时在 `notes.some(...)` 中反复读取 `el.innerText` 强制回流。
- **为什么要优化**：AI 网页在流式输出长回复或滚动对话时，无故多出一套持续运行的全页 DOM 扫描器，消耗 guest 进程 CPU 并引起滚动掉帧。
- **怎样优化**：
  1. 在 `useSourceAnnotations` 中：若 `annotations.length === 0` 且此前未向当前页面注入过高亮，直接跳过注入；若由非空变为 0（删完最后一条），仅执行轻量清理函数（移除 Highlight、disconnect Observer、解绑监听）。
  2. 在 `generateNoteHighlightScript` 内部同样加 `if (!notes.length) { cleanup(); return }` 兜底，并将 `el.innerText` 提取移出 `notes.some(...)` 循环外仅计算一次。
- **体验影响**：零下降。新建原文标注走独立划词菜单逻辑，不受影响。

---

### P0-13：PDF 亮色模式跳过 `getOperatorList()` + 共享单个 `IntersectionObserver`
- **涉及文件**：[WorkbenchPdfViewer.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx#L98-L110)、[L161-L169](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx#L161-L169)
- **当前问题**：
  1. 每页挂载各自创建一个 `IntersectionObserver`（500 页即 500 个 Observer）。
  2. 亮色模式下仍无条件 `await page.getOperatorList()` 并遍历全部绘制指令提取图片坐标框，阻塞后面的 `TextLayer` 渲染，而结果完全未使用。
- **为什么要优化**：减少数百个原生 Observer 内存开销，大幅加快亮色模式下复杂矢量图/学术论文 PDF 的文字层出现速度。
- **怎样优化**：
  1. 在 `WorkbenchPdfViewer` 父组件创建**唯一一个** `IntersectionObserver`（搭配 `Map<Element, pageNumber>` 与单一 `nearPages: Set<number>` 或回调分发），统一观测所有页容器。
  2. `page.getOperatorList()` 与 `extractPdfImageBoxes` 仅在 `isDark === true` 时按需执行（从亮切暗时再按需对当前可见页补抽）。
- **体验影响**：零下降。亮色与暗黑预览视觉、图片原色还原与文字选中完全一致。

---

### P0-14：DOCX 缓存固有页宽消除双倍全文档回流 + 修复异常 Blob 回收
- **涉及文件**：[WorkbenchDocxPreview.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx#L77-L90)、[L167-L192](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx#L167-L192)、[L235-L275](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx#L235-L275)
- **当前问题**：
  1. `fitToWidth` 每次先写 `wrapper.style.zoom = '1'`、同步读 `getBoundingClientRect().width`（第 1 次全文档回流），再写回目标 `zoom`（第 2 次全文档回流），且 `ResizeObserver` 无 rAF 节流。
  2. `renderAsync` 渲染到游离 `staging` 失败进入 `catch` 时未回收 `staging` 里已创建的 `blob:` URL；`docxDocument` 大对象解析完大纲后仍永久留在 state。
- **为什么要优化**：大体积 Word 文档拖动左右分栏或缩放时帧率骤降，异常路径存在 Blob 内存泄漏。
- **怎样优化**：
  1. 渲染完成首次测量并缓存 `basePageWidthRef.current = page.offsetWidth`，后续 `fitToWidth` 直接用 `containerWidth / basePageWidthRef.current` 计算，不再翻转 `zoom = '1'`；`ResizeObserver` 回调套一层 rAF 节流。
  2. `catch` 与取消分支补充 `revokeDocxBlobUrls(staging)`，并扩充扫描 `image[href^="blob:"]`、`[style*="blob:"]`；`WordDocument` 仅用于同步提取轻量的 `DocxTocItem[]`，不把整棵 AST 存入 React state。
- **体验影响**：零下降（且消除拖拽分栏时的缩放抖动）。

---

### P0-15：工作台四栏 `React.memo` + 导图去掉冗余订阅 + 修复隐藏工作台快捷键穿透
- **涉及文件**：
  - [WorkbenchPage.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/pages/WorkbenchPage.tsx#L18-L19)、[L165-L242](file:///d:/Project/MultiChat-desk/src/renderer/src/pages/WorkbenchPage.tsx#L165-L242)
  - [WorkbenchMindmapPanel.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx#L20)
  - [WorkbenchEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchEditor.tsx#L204-L221)
- **当前问题**：
  1. 拖拽左右 Splitter 时每次 `pointermove` 改变 `leftPaneWidth`/`rightPaneWidth`，引发 `WorkbenchPage` 重渲染；因 `WorkbenchFileTree`、`WorkbenchEditor`、`WorkbenchAiSidebar`、`WorkbenchMindmapPanel` 均无 `React.memo`，每次动 1px 全工作台 React 树重走 reconcile。
  2. `WorkbenchMindmapPanel.tsx:20` 订阅 `activeFileContent` 仅用来写入 `contentRef.current`，导致导图面板隐藏时仍随每次正文保存整棵子树重渲染。
  3. `WorkbenchEditor.tsx:204-221` 挂在 `window` 上的 `Ctrl+F`/`Ctrl+H`/`Ctrl+S` 未检查工作台是否激活（`isActive`），切回主页/总结页后按键仍会被隐藏工作台拦截。
- **为什么要优化**：显著提升拖拽分栏顺滑度、消除隐藏面板无效重渲染，并修复跨页面快捷键冲突 Bug。
- **怎样优化**：
  1. 用 `React.memo` 包裹 `WorkbenchFileTree`、`WorkbenchEditor`、`WorkbenchAiSidebar`、`WorkbenchMindmapPanel`；向 `WorkbenchEditor` 透传 `isActive`（或在 `onKey` 内同时判断 `isActive`）。
  2. `WorkbenchMindmapPanel` 删除 `useWorkbenchStore((s) => s.activeFileContent)` 订阅，改在真正需要正文内容的方法内通过 `useWorkbenchStore.getState().activeFileContent` 按需读取。
  3. 仅在 `isAiSidebar2Open` 为 `true` 时挂载第二侧栏容器（或在 `WorkbenchPage` 延迟到首次打开第二侧栏），避免未开双栏用户常驻第二套全局捕获 `pointerdown` 与 IPC 监听。
- **体验影响**：零下降（且修复主页按 `Ctrl+F`/`Ctrl+S` 被工作台抢占的 Bug）。

---

### P0-16：主进程内存、Watcher 句柄与同步刷盘修复
- **涉及文件**：
  - [AgentTaskService.ts](file:///d:/Project/MultiChat-desk/src/main/services/AgentTaskService.ts#L131-L135)、[L483](file:///d:/Project/MultiChat-desk/src/main/services/AgentTaskService.ts#L483)
  - [noteManager.ts](file:///d:/Project/MultiChat-desk/src/main/noteManager.ts#L482-L517)
  - [workbenchService.ts](file:///d:/Project/MultiChat-desk/src/main/services/workbenchService.ts#L436-L447)、[L768-L804](file:///d:/Project/MultiChat-desk/src/main/services/workbenchService.ts#L768-L804)、[L822-L867](file:///d:/Project/MultiChat-desk/src/main/services/workbenchService.ts#L822-L867)
  - [annotationService.ts](file:///d:/Project/MultiChat-desk/src/main/services/annotationService.ts#L42-L48)
  - [ipcHandlers.ts](file:///d:/Project/MultiChat-desk/src/main/ipcHandlers.ts#L460-L468)、[L1902-L1911](file:///d:/Project/MultiChat-desk/src/main/ipcHandlers.ts#L1902-L1911)
- **当前问题**：
  1. `AgentTaskService` 通过 `SessionManager` 创建的无头 `BrowserWindow`（`backgroundThrottling: false`，单窗口 150–400MB）任务结束后永不销毁；`tasks` 与 `persistedIndex` 运行期双份无限保留完整 `reply`。
  2. 切换/关闭工作区时只关了 `workbenchWatchers`，未清理 `NoteManager` 对应旧工作区的 `mindmapWatchers`、`mindmapScanCache`、`mindmapSelfWrites` 和 `relinks`。
  3. `annotations:list-source` 只读查询调用 `ensureDefaultWorkspace` 时，每次无条件执行 `store.set(...)` 在主线程同步重写整份 `config.json`。
  4. `copyTargetLocks` 因存入 `.then()` 包装 Promise 导致 `finally` 中的 `delete` 永不生效；`annotationService.locks` 从不删 key；`will-download` 临时监听在失败/取消时泄漏。
- **为什么要优化**：堵住主进程最明显的几处内存/句柄/窗口常驻泄漏与主线程同步磁盘写阻塞。
- **怎样优化**：
  1. 参照 `MindmapService`/`TaskSplitService`，给 `AgentTaskService` 的无头 `BrowserWindow` 增加空闲定时器（如任务结束后 2–5 分钟无新任务即调用 `sessionManager.destroySession`）；已终态任务仅保留摘要或做容量上限（如 100 条），`reply` 正文按需读盘。
  2. `activateWorkspace`/`closeWorkspace` 时通知 `noteManager.releaseWorkspace(oldWorkspaceRoot)` 关闭旧工作区 `mindmapWatcher` 并释放对应缓存。
  3. `ensureDefaultWorkspace` 在内存缓存已确认的 `defaultPath`，仅当与 `store.get(DEFAULT_WORKSPACE_STORE_KEY)` 不一致时才调用 `store.set`。
  4. 修复 `copyTargetLocks` 比较同一 Promise 引用、`annotationService.locks` 在 `.finally` 中按引用安全 delete、`will-download` 绑定超时/失败兜底移除。
- **体验影响**：零下降。后台任务与笔记功能语义 100% 不变，长时运行内存占用大幅回落。

---

### P0-17：编辑器高频交互小插件去冗余重渲染与 DOM 重建
- **涉及文件**：
  - [WorkbenchFloatingToolbarPlugin.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx#L279-L326)
  - [WorkbenchSourceEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx#L130-L165)
  - [WorkbenchDraggableBlockPlugin.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx#L72)、[L309-L335](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx#L309-L335)
- **当前问题**：
  1. `WorkbenchFloatingToolbarPlugin` 每次击键/移动光标都无条件 `setState({...})` 建新对象（即便选区一直折叠、`isText` 始终 `false`），且对非折叠选区重复调两次 `selection.getTextContent()`。
  2. `WorkbenchSourceEditor` 的 CM6 `gitGutter` 设 `lineMarkerChange: () => true` 且 `GitGutterMarker` 每次 `new` 且未实现 `eq()`，每次移动光标都销毁重建视口内所有 gutter DOM。
  3. `WorkbenchDraggableBlockPlugin` 用 `useState` 存 hover 块 `draggableElement`，鼠标滑过段落频繁重渲染，但该值仅在点击 `+` 时使用。
- **为什么要优化**：消除日常打字、方向键移动、鼠标浏览文档时大量毫无意义的 React 协调与 DOM 重建。
- **怎样优化**：
  1. `WorkbenchFloatingToolbarPlugin` 过滤 `annotation-sync`、缓存 `textContent` 只读一次、`setState` 前做字段级浅比较（无变化返回 prev 引用）。
  2. `GitGutterMarker` 改为按改动类型复用模块级单例（`ADDED_MARKER`/`MODIFIED_MARKER`/`DELETED_MARKER`）并实现 `eq(other)`；`lineMarkerChange` 仅在 `update.docChanged`、`update.transactions.some(tr => tr.reconfigured)`（保留 `Compartment.reconfigure` 切换生效）或 gutter `StateEffect` 变更时返回 `true`。
  3. `WorkbenchDraggableBlockPlugin` 改用 `draggableElementRef = useRef<HTMLElement | null>(null)` 替代 `useState`。
- **体验影响**：零下降。所有编辑器微交互视觉完全一致。

---

## 四、P1 级优化详细开发方案（高收益，需权衡 UX 或配套防护）

### P1-01：Webview 折叠重载雪崩治理与隐藏态休眠探针改造
- **涉及文件**：
  - [WorkbenchAiSidebar.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx#L319-L333)、[L480-L560](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx#L480-L560)、[L1435](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx#L1435)、[L1539-L1583](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx#L1539-L1583)
  - [useWebviewLifecycle.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useWebviewLifecycle.ts#L400-L435)、[L568-L578](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useWebviewLifecycle.ts#L568-L578)
  - [webviewScripts.ts](file:///d:/Project/MultiChat-desk/src/shared/utils/webviewScripts.ts#L2904-L2915)
- **当前问题**：
  1. `mountedSidebarModels` 只增不减；折叠侧栏（`!visible`）卸载全部 `<WebviewCard>` 后，再次展开瞬间并发重新挂载并 `loadURL` 全部历史平台（瞬间拉起 4–8 个 Chromium 进程）。
  2. 休眠探针用 `el.getClientRects().length > 0` 检测输入框；在 `display: none`、未登录、加载失败时返回 `{ busy: true, reason: 'not-ready' }`，陷入永久 30s 定时轮询且永远无法休眠。
- **为什么要优化**：单/双侧栏切换几次平台后内存轻松突破 1–2GB，折叠重开明显卡死。
- **怎样优化**：
  1. **折叠给宽限期再卸载**：折叠侧栏后先用 CSS 隐藏保持挂载 30–60s，避免用户临时收起看文档再展开时重载；超时后再执行休眠/卸载。
  2. **展开只恢复当前模型**：触发卸载清理时将 `mountedSidebarModels` 收缩为仅包含当前 `currentModel.id`（或标记非当前模型为 `suspended` 状态不立即 `loadURL`），等用户主动切回旧平台时再按需加载。
  3. **探针去几何依赖**：`generateWorkbenchLifecycleStateScript` 区分「正在生成（DOM 存在 stop 按钮 / 流式标志）」与「页面未就绪/未登录（`not-ready`）」；仅在**确实正在生成或有活跃上传任务**时阻止休眠，对长期 `not-ready` 或真正空闲的隐藏页正常休眠；休眠超过更长阈值（如 10 分钟）直接卸载 `<WebviewCard>` 回收整个 guest 进程壳。
- **潜在体验影响与防护**：
  - *影响*：切回很久未使用的第二个 AI 平台需重新加载（1–3 秒）并重置页面滚动位置。
  - *防护*：通过“折叠短期保活 + 精准识别生成中绝不打断 + 保留草稿恢复”，把体验影响降到最低。

---

### P1-02：`<AgentCard>` 懒挂载 + 本地 Agent 流式输出节流与智能滚动
- **涉及文件**：
  - [WorkbenchAiSidebar.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx#L1529-L1537)
  - [AgentSessionService.ts](file:///d:/Project/MultiChat-desk/src/main/services/AgentSessionService.ts#L418-L429)
  - [agentSessionStore.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/store/agentSessionStore.ts#L1531-L1568)
  - [AgentCard.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/AgentCard.tsx#L134-L138)
- **当前问题**：
  1. 即使从未使用本地 Agent，单/双侧栏也无条件挂载 1–2 个隐藏 `<AgentCard>`，双倍消费共享 store 并并发触发 `initListeners`、`fetchSkills` 与 `newSession`。
  2. `message_update` 每 chunk 推送全量消息快照，store 无节流广播，且每次 `messages` 变化同步读 `scrollHeight` 强拉到底部。
- **为什么要优化**：根治双侧栏 2× 渲染与流式输出每 token 跨进程全量克隆及强制回流。
- **怎样优化**：
  1. **首次激活才挂载 + 双栏隐藏态降活**：增加 `hasUsedAgent` 状态，纯网页 AI 用户完全不挂载 `<AgentCard>`；已挂载后切去网页 AI 时不粗暴卸载（避免丢失滚动/展开状态），而是透传 `isVisible` prop，隐藏态下跳过 `scrollHeight` 滚动、禁止重复触发 `newSession` 与后台副作用（副作用统一收敛到 store 或主实例）。
  2. **流式合批节流（32–50ms）**：在主进程 `forwardEvent` 或渲染层 `agentSessionStore` 中对同条消息的连续 `message_update` 做 32–50ms（约 20–30fps）尾沿合并，终态事件（`message_end`/`agent_end`）立即无延迟冲刷。
  3. **智能跟随滚动**：记录用户是否处于底部区域（`scrollHeight - scrollTop - clientHeight <= 80`），仅用户发新消息时强制滚底，流式输出期间用 rAF 合帧且仅在 `isNearBottom` 时跟随。
- **潜在体验影响与防护**：
  - *影响*：节流窗口设得过大会出现“块状蹦字”；`isNearBottom` 判定过严会导致不跟滚。
  - *防护*：节流上限严格 ≤ 50ms，发送瞬间重置 `autoFollowRef.current = true`。

---

### P1-03：源码模式 `onChange` 防抖写回 Store（配 `sourceSyncFlusher`）+ 字数统计防抖
- **涉及文件**：
  - [WorkbenchSourceEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx#L234-L238)、[L284-L291](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx#L284-L291)
  - [WorkbenchStatusPill.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchStatusPill.tsx#L20-L22)
  - [WorkbenchFindReplaceBar.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFindReplaceBar.tsx#L77-L94)
  - [workbenchStore.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L1359-L1387)
- **当前问题**：源码模式每次击键同步 `doc.toString()` 写回全局 `activeFileContent`，引发第二次 `doc.toString()` 对比、`WorkbenchEditor`/`WorkbenchSourceToolbar`/`WorkbenchStatusPill` 级联重渲染、以及关闭态但保留旧 `query` 的 `WorkbenchFindReplaceBar` 跑全文正则。
- **为什么要优化**：5,000 行大 Markdown 源码编辑时外围级联导致每键 30–150ms 延迟，白白浪费了 CodeMirror 6 的高性能内核。
- **怎样优化**：
  1. 复用富文本 `markdownSyncFlusher` 机制（或泛化为 `activeEditorSyncFlusher`）：`WorkbenchSourceEditor` 在 `docChanged` 时立刻只标记 `markPendingSync()`（轻量置 `isDirty: true`），将 `doc.toString()` + `onChange` 写回 Store 防抖 250ms；同时用 `lastEmittedValueRef` 跳过自身回写触发的 `useEffect([value])` 二次 `doc.toString()`。
  2. 在 `saveActiveFile`、`setEditorMode`、`openFile`、`renameNode`、`gitCommit`、`Ctrl+F`、关窗/退出守卫前统一调用 flusher 同步落入 `activeFileContent`。
  3. `WorkbenchStatusPill` 字数/行数计算做 300ms 防抖；`WorkbenchFindReplaceBar` 在 `!open` 时直接跳过 `findMatches` 计算。
- **潜在体验影响与防护**：
  - *影响*：状态栏字数有约 0.3s 微延迟；**若遗漏任一退出/保存入口的 flush 会导致最后 250ms 输入丢失**。
  - *防护*：所有涉及读 `activeFileContent` 的写盘/切换/查找/Git 入口全部复用统一的 `flushActiveEditorSync()`，并在 dev 模式下逐路径回归验证。

---

### P1-04：`WorkbenchCodePreview` 复用 CodeMirror 6 替换无虚拟化高亮渲染
- **涉及文件**：[WorkbenchCodePreview.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchCodePreview.tsx#L36-L76)、[L711-L772](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchCodePreview.tsx#L711-L772)
- **当前问题**：最大支持 5MB 代码/日志/JSON 文件，但行号与代码区无虚拟化且 JSX `.map` 内无缓存跑 7 分支正则 `highlightCodeLine`，大文件打开即卡顿数秒、编辑完全卡死。
- **为什么要优化**：从根本上解决 1–5MB 日志/JSON/源码文件查看与编辑冻结主线程与 DOM 爆内存问题。
- **怎样优化**：
  - **不要自造只读 `<pre>` 行虚拟化**（会破坏跨视口拖选复制）。直接复用项目已安装的 **CodeMirror 6**，按文件扩展名动态加载语言扩展（或对 `.log`/`.txt`/超长单行降级纯文本），通过 `EditorState.readOnly` 切换预览与编辑态，同时复用 `useGitLineDiff` Gutter 与 `sourceSyncFlusher`。
  - 短期过渡方案（若暂不替换内核）：对 `lines` 做 `useMemo([activeFileContent])` 缓存单行高亮结果，超长行（>2,000 字符）和 `.log`/`.txt`/`.csv` 跳过正则高亮。
- **潜在体验影响与防护**：
  - *影响*：切换为 CodeMirror 6 后需对齐现有滚动位置记忆、查找替换联动、以及暗色主题 Token 配色（遵循 `DESIGN.md`）。
  - *防护*：保留原有查找条回调接口（参考 `WorkbenchSourceEditorHandle`），确保跨屏复制、行号、Git 边栏和快捷键体验只增不减。

---

### P1-05：思维导图移除 `SVGPathElement.prototype` 劫持 + 隐藏态透传 `isVisible`
- **涉及文件**：
  - [useMindmapCanvas.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useMindmapCanvas.ts#L48-L181)、[L302-L320](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useMindmapCanvas.ts#L302-L320)、[L650-L660](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useMindmapCanvas.ts#L650-L660)、[L722-L802](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useMindmapCanvas.ts#L722-L802)、[L883-L954](file:///d:/Project/MultiChat-desk/src/renderer/src/hooks/useMindmapCanvas.ts#L883-L954)
  - [WorkbenchMindmapPanel.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx#L52-L75)
  - [LocalMindmapPanel.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/LocalMindmapPanel.tsx#L148-L160)
- **当前问题**：
  1. 永久全局劫持 `SVGPathElement.prototype.setAttribute`/`setAttributeNS`，在批量写 `<path d>` 时同步查 DOM + 读 `offsetWidth`/`offsetHeight` 引发 O(N) 强制同步回流。
  2. 框选/拖拽 `mousemove` 无 rAF 节流、每次无条件 `setSelection` + O(N²) `syncSelectionClass`；`ResizeObserver` 拖动分栏每 11px 触发一次全量回流。
  3. 导图面板 `display: none` 隐藏期间仍在切文件时发起 `mindmapSource(..., create=true)` 建档并保留 5 个全局事件监听。
- **为什么要优化**：200–500 节点导图交互掉帧严重，原型劫持还会拖慢全应用所有 SVG 渲染。
- **怎样优化**：
  1. 移除原型链劫持，改为 `convertLinksToStep` 读写分离批处理：**第一阶段**一次性遍历所有 `.mm-node-item` 建立 `Map<nodeId, { width, height, level }>`（单次布局读）；**第二阶段**纯内存计算全部折线路径并批量写 `<path d>`。
  2. `syncSelectionClass` 预建 `Map<id, MindNode>` 将 O(N²) 降为 O(N)；`mousemove` 合并至 rAF 且选区集合未变时跳过 `setSelection`；`ResizeObserver` 做 rAF/100ms 节流。
  3. 从 `WorkbenchPage` 向 `WorkbenchMindmapPanel` → `LocalMindmapPanel` 透传 `isVisible={rightPane === 'mindmap' && isActive}`：隐藏时暂停自动建档 IPC，并把 `useMindmapCanvas` 的 `active` 置为 `false` 解绑全局监听器。
- **潜在体验影响与防护**：
  - *影响*：若连线改折线延迟到下一帧 rAF，展开/折叠时可能出现 16ms 的“曲线闪一下变折线”。
  - *防护*：在 `setData()` 完成后同一帧绘制前（同步或 microtask 末尾）执行读写分离批处理，仅把 `ResizeObserver` 与拖拽 `mousemove` 放入 rAF。

---

### P1-06：PDF 懒加载 `getPage` + 缓存宽高比消除缩放双重渲染 + 缓冲式 `page.cleanup()`
- **涉及文件**：[WorkbenchPdfViewer.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx#L98-L205)、[L289-L300](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx#L289-L300)
- **当前问题**：
  1. 打开 N 页 PDF 瞬间挂载 N 个 `<PdfPage>` 并立即并发 `pdf.getPage(1..N)`，抵消 256KB 分段 IPC 优势。
  2. `ResizeObserver` 无防抖，拖动分栏或缩放时 `width` 变化会同时触发 Canvas 立即清空重绘 + 所有 N 页重调 `getPage` 返回新 `size` 后再次取消并清空重绘（白屏闪烁）。
  3. 离开视口后未调用 `page.cleanup()`，PDF.js Worker 内页面缓存持续累积；暗黑模式有小图即分配整页等大第二张高分辨率 Canvas。
- **为什么要优化**：解决长 PDF 打开慢、缩放白屏闪烁与一路滚动到底后 Worker 内存持续上升。
- **怎样优化**：
  1. 打开文档仅先读取第 1 页获取默认 `defaultAspectRatio`，其余页进入 `near` 区域才首次调用 `pdf.getPage(pageNumber)` 并永久缓存该页真实 `aspectRatio`。
  2. `width` 变化时纯数学计算 `Math.floor(width * aspectRatio)`，不再重跑 `getPage`，彻底消除双重渲染；`ResizeObserver` 与缩放重绘做 120ms 防抖（期间用 CSS `transform: scale` 平滑过渡）。
  3. 记录已加载页号，仅对距离当前视口 **5–8 页之外**的离屏页调用 `page.cleanup()`；暗黑图片还原层改按实际图片包围盒尺寸裁剪绘制。
- **潜在体验影响与防护**：
  - *影响*：异形混排 PDF 首次滚到横版页时有轻微滚动条高度调整；缩放 120ms 防抖内短暂微糊。
  - *防护*：120ms 防抖期比现有反复白屏闪烁观感好得多；5–8 页缓冲区避免相邻页对照频繁重解码。

---

### P1-07：`focus` Git 刷新冷却 + Markdown 自动保存增量更新标签 + `fs.watch` 过滤高噪目录
- **涉及文件**：
  - [workbenchStore.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L693-L698)、[L1317-L1319](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L1317-L1319)、[L2141-L2164](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L2141-L2164)
  - [workbenchService.ts](file:///d:/Project/MultiChat-desk/src/main/services/workbenchService.ts#L474-L514)
- **当前问题**：
  1. 窗口 `focus` 无冷却且不判断当前是否在工作台页，每次切回窗口都触发 Git 状态与基线刷新。
  2. 每次 Markdown 1.2s 自动保存都调用 `loadWorkspaceTags()` 触发全工作区扫描。
  3. `fs.watch` 仅忽略 `.git` 和 `.multichat`，未过滤 `node_modules`/`.venv`/`__pycache__` 等高变动目录；且 `handleExternalFsChanged` 无 in-flight 并发互斥，同时把全量文件树发往前端又立刻通过 `reconcileMindmaps` 拍平发回主进程。
- **为什么要优化**：消除日常打字（每 1.2s 自动保存）与 Agent/终端构建期间的持续磁盘风暴。
- **怎样优化**：
  1. `focus` 监听增加判断：仅当 `productMode === 'workbench'` 且距上次刷新超过 **2–3 秒**（或主进程先快速 `stat` `.git/HEAD` 与 `.git/index` 的 `mtime` 有变化）才刷新 Git。
  2. `saveActiveFile` 保存单个 `.md` 后，仅针对当前文件在内存/主进程增量提取并更新该文件的标签集合（合并进 `workspaceTags`），不再全盘扫描所有 `.md`；仅在工作区初始化与文件树实质变更时全量/增量校准。
  3. `watchWorkspace` 的忽略名单与 `readTree` 保持一致（过滤 `node_modules`、`.venv`、`venv`、`__pycache__`、`.trash` 等，且不把在文件树里**可见**的目录偷偷屏蔽掉）；`handleExternalFsChanged` 增加 in-flight + pending 合并锁；主进程若该工作区无工作台导图记录则直接短路对账，无需前端把全树再传回主进程。
- **潜在体验影响与防护**：
  - *影响*：外部终端执行 `git commit` 后 2–3 秒内切回应用可能短时看到旧徽标；若忽略了用户关注的构建目录会导致不自动刷新。
  - *防护*：优先使用 `.git/index` + `.git/HEAD` `mtime` 精准判定（既有零延迟又能跳过无变化时的 14 次 spawn）；watcher 忽略列表严格对齐文件树隐藏规则。

---

### P1-08：主进程 `AgentSessionService` 会话 LRU 淘汰与 `listSessions()` 索引缓存
- **涉及文件**：[AgentSessionService.ts](file:///d:/Project/MultiChat-desk/src/main/services/AgentSessionService.ts#L145)、[L996](file:///d:/Project/MultiChat-desk/src/main/services/AgentSessionService.ts#L996)、[L1449-L1472](file:///d:/Project/MultiChat-desk/src/main/services/AgentSessionService.ts#L1449-L1472)、[L1574-L1616](file:///d:/Project/MultiChat-desk/src/main/services/AgentSessionService.ts#L1574-L1616)、[L1888-L1892](file:///d:/Project/MultiChat-desk/src/main/services/AgentSessionService.ts#L1888-L1892)
- **当前问题**：
  1. `activeSessions` Map 无淘汰且 `dispose()` 未释放，每次新建/恢复/分叉会话都把完整 `AgentSession`（含所有消息与 base64 图片）永久留在主进程堆内。
  2. 每次 `listSessions()`（每轮 `agent_end`、打开历史菜单、初始化均触发）都串行读取 `sessionsDir` 下**所有 `.jsonl` 完整正文**并逐行 split；`findSessionFile` 同样为读首行 header 而全量读完整个文件。
- **为什么要优化**：随着历史会话增多，每轮对话结束主进程都要吞吐数十至数百 MB 磁盘 IO，且主进程 RSS 持续增长永不回落。
- **怎样优化**：
  1. 为 `activeSessions` 引入 LRU 上限（如保留最近 **4 个**空闲会话），淘汰前严格校验 `!session.isRunning && !hasPendingApproval`；在 `dispose()` 中遍历释放全部活跃会话。
  2. 为 `listSessions()` 建立按 `{ filePath, size, mtimeMs }` 键控的内存元数据缓存，仅对新增或 `size/mtimeMs` 变化的 `.jsonl` 重新解析；`findSessionFile` 改用 `open` + 仅读取前 4–8KB 读取首行 header，不加载整文件。
- **潜在体验影响与防护**：
  - *影响*：切回较早以前的空闲历史会话时，需多花几十至数百毫秒从磁盘恢复。
  - *防护*：运行中及等待权限审批的会话永久豁免淘汰，绝不中断后台任务。

---

### P1-09：拆分 `WorkbenchEditor` 对 `activeFileContent` 的顶层订阅 + 增量拼装单块导出缓存
- **涉及文件**：
  - [WorkbenchEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchEditor.tsx#L180)、[L312-L349](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchEditor.tsx#L312-L349)
  - [markdownSourceMap.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/markdownSourceMap.ts#L916-L939)、[L1012-L1028](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/markdownSourceMap.ts#L1012-L1028)、[L1165-L1190](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/markdownSourceMap.ts#L1165-L1190)
- **当前问题**：
  1. `WorkbenchEditor` 顶层订阅 `activeFileContent`（仅用于 `FrontmatterPanel`、`WorkbenchSourceEditor` 和空二进制判空），导致富文本每 250ms 写回时，`<LexicalComposer>` 下的 25+ 个插件子组件全部重渲染。
  2. `markdownSourceMap.ts` 中已改过的旧块和所有新增顶层块无单块导出缓存，累计修改或新建 100–300 块后，每 250ms flush 会重复创建上百个 Shadow `EditorState` 重新导出这些并未再次变动的块；`collectDirtyTopLevelBlocks` 在每次击键都分配 3 个全顶层块数组。
- **为什么要优化**：确保长文档持续编辑或新建长文时，富文本增量同步保持恒定 O(改动块数) 耗时，不随会话编辑时长退化。
- **怎样优化**：
  1. 将 `FrontmatterPanel` 包装为自行订阅 `frontmatter` 切片的子组件（在 selector 中提取 frontmatter 头部字符串，正文变化时返回值引用不变，不触发重渲染），移除 `WorkbenchEditor` 顶层对 `activeFileContent` 的订阅（源码模式改由 `WorkbenchSourceEditor` 内部订阅，空二进制分支改用 `activeFileSize` 判定）。
  2. 在 `MarkdownSourceMap` 中增加 `exportedBlockCache: Map<NodeKey, string>`：仅当该顶层块本次真正变脏（本次 flush 周期内被 `dirtyElements`/`dirtyLeaves` 触及）时重新调用 `exportSingleTopLevelNode` 并更新缓存，其余已改旧块/新增块直接命中缓存字符串。
- **潜在体验影响与防护**：
  - *影响*：缓存失效逻辑若有遗漏会导致导出旧文本（高数据一致性要求）。
  - *防护*：任何块在 `registerUpdateListener` 中变脏即立刻从 `exportedBlockCache` 删去对应顶层 `NodeKey`（`undo`/`redo`、外部同步、插入回复时清空整表），确保绝对不出现脏缓存。

---

### P1-10：补齐高频滚动 / 拖拽的 rAF 节流与 O(M×AST) 布局消除
- **涉及文件**：
  - [WorkbenchMarginNotes.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx#L196)、[L243](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx#L243)、[L294](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx#L294)、[L350-L361](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx#L350-L361)
  - [WorkbenchTocRail.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchTocRail.tsx#L66-L87) & [WorkbenchMinimalToc.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMinimalToc.tsx#L65-L68)
  - [WorkbenchTableCellResizerPlugin.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchTableCellResizerPlugin.tsx#L126-L133)、[L395-L483](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchTableCellResizerPlugin.tsx#L395-L483)
  - [WorkbenchHtmlVisualEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchHtmlVisualEditor.tsx#L349-L352) & [workbenchHtmlEditor.ts](file:///d:/Project/MultiChat-desk/src/shared/utils/workbenchHtmlEditor.ts#L419-L467)
- **当前问题**：
  1. `WorkbenchMarginNotes` 的 `scroll` 回调无 rAF 节流且无值比较 `setState`；`computeLayout` 内对每条标注调 `findMarkDom`（O(M×AST)）；`annotationStore.setResolutions` 每次返回新对象触发级联重算。
  2. `WorkbenchMinimalToc` 每键扫全部顶层块；`WorkbenchTocRail` 滚动每帧线性 `getBoundingClientRect()`（长文 200+ 标题时每帧 200 次布局读取）。
  3. `WorkbenchTableCellResizerPlugin` 拖拽列宽无 rAF 节流且在 render 期读 `getBoundingClientRect()`；`WorkbenchHtmlVisualEditor` 拖拽排序无 rAF 节流高频跨 iframe `postMessage` + 全文档 `querySelectorAll`。
- **为什么要优化**：消除长文档/多标注/大表格/HTML 拖拽排序中的滚动与指针掉帧。
- **怎样优化**：
  1. `WorkbenchMarginNotes`：`scroll`/`resize` 合并至 rAF 且 `setAnchorBox`/`setHeaderBox` 先做数值相等判断；`computeLayout` 开头**单次** `allMarks()` 建立 `Map<annotationId, HTMLElement>` 将 O(M×AST) 降为 O(AST + M)；`setResolutions` 浅比较无变化不返回新对象。
  2. `WorkbenchMinimalToc` 改用 `registerMutationListener(HeadingNode)` 或 200ms 防抖；`WorkbenchTocRail` 对有序标题列表用二分查找定位当前激活标题（O(log H) 次 `getBoundingClientRect()`）并在卸载时 `cancelAnimationFrame`。
  3. 表格列宽拖拽与 HTML 排序拖拽的 `pointermove` 均合并到单帧 rAF，并在 `pointerup` 前冲刷末帧坐标；表格 resizer 位置测量移出 render 期改为 ref/effect；HTML 运行时缓存上一个 drop hint 节点替代全文档 `querySelectorAll`。
- **潜在体验影响与防护**：
  - *影响*：拖拽 rAF 节流若漏处理 `pointerup` 最后一帧，松手落点可能与指针差几像素。
  - *防护*：`pointerup` 时取消挂起 rAF 并同步应用最后记录的指针坐标。

---

## 五、P2 级优化摘要（长尾与边际治理）

1. **P2-01 文件树超大规模按需虚拟滚动**：在完成 P0-10 后，仅当展开可见节点数超过阈值（如 >500–800 行）时启用虚拟列表（如 `@tanstack/react-virtual`），并同步适配跨视口拖拽自动滚动与 `activeFilePath` `scrollToIndex` 定位。
2. **P2-02 `NoteManager` 摘要/正文分离与导图扫描优化**（[noteManager.ts](file:///d:/Project/MultiChat-desk/src/main/noteManager.ts#L33)、[L70](file:///d:/Project/MultiChat-desk/src/main/noteManager.ts#L70)、[L610-L653](file:///d:/Project/MultiChat-desk/src/main/noteManager.ts#L610-L653)）：`cache` 仅常驻轻量摘要（剥离最高 20MB `snapshot` 按需读盘）；已有 `FSWatcher` 实时置脏的前提下将 `MINDMAP_SCAN_TTL_MS` 从 500ms 放宽至 5–10s；watcher 回调仅对变更文件重算哈希，不扫描全目录。
3. **P2-03 `WorkbenchCodeHighlightPlugin` 超大代码块优化**（[WorkbenchCodeHighlightPlugin.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchCodeHighlightPlugin.tsx#L80-L101)）：仅在 `Prism.tokenize` 后比较文本/类型差异，只为真正变化的 token 区间创建新 `CodeHighlightNode`，避免每键先全量建节点再丢弃；超过一定行数（如 >300 行）的代码块编辑时做 80ms 防抖高亮。
4. **P2-04 本地 Agent 长会话细节**（[ToolGroup.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/agent/ToolGroup.tsx#L103-L203)、[AttachmentChips.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/agent/AttachmentChips.tsx#L364-L379)）：`ToolItem` 在 `expanded === false` 时跳过 `JSON.stringify` 与 `parseDiff`；`InlineFileCode` 不订阅全量 `fileTree`（改用按 `fileTree` 构建的共享 `Map<basename/absPath, relPath>` 或仅点击时解析）。
5. **P2-05 `WorkbenchGitPanel` 局部状态隔离**（[WorkbenchGitPanel.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchGitPanel.tsx#L140-L145)、[L967-L1107](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchGitPanel.tsx#L967-L1107)）：拆分 commit 输入框与改动列表为独立组件，给 `GitHistoryGraph` 与单条提交行加 `React.memo`，把 `toLocaleString()` 预计算。
6. **P2-06 协议与冷启动 IPC 细节**（[index.ts](file:///d:/Project/MultiChat-desk/src/main/index.ts#L258-L350)、[workbenchStore.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/store/workbenchStore.ts#L700-L738)）：`workbench-file://` 静态 runtime JS/CSS 改为可缓存（按版本号/immutable）、透传 `Range` 头支持音视频 seek、HTML 编辑/标注读取加体积上限；冷启动 18 次 `storeGet` 合并为单次批量 IPC。
7. **P2-07 长尾内存与生命周期补漏**：
   - `WorkbenchFindHighlightPlugin` 按文档版本缓存锚点表；
   - `workbenchEditorScroll.ts` 的 `scrollPositions` Map 增加 LRU 上限（如 200）；
   - `useGitLineDiff.ts` 为模块级 Worker 补齐 `onerror` 清理滞留回调闭包；
   - `App.tsx:287` 保存/处理 `initListeners()` 清理函数防止 `ipcListenerRefs` 递增泄漏；
   - `LocalMindmapPanel.tsx` 的 `historyRef` 限制上限（如 80 步）并对大纲输入合并；
   - `WorkbenchImagePreview.tsx` 用原生 `{ passive: false }` wheel 监听加步进阈值（参考 PDF 滚轮缩放经验）。

---

## 六、已验证的正向基线（优化期间禁止破坏）

以下机制在本次源码审查中确认设计良好，改造时应予以保留：

1. **PDF 分段流式读取 & 离屏 Canvas 归零**：256KB IPC Range 传输 + 离屏清空 `canvas.width/height` 与 textLayer + 卸载销毁 `PDFDocumentProxy`。
2. **DOCX 懒加载与二进制 IPC**：`await import('docx-preview')`、走 `Uint8Array`（非 base64）、关闭 `renderAltChunks`。
3. **CodeMirror 6 源码内核**：原生视口虚拟滚动 + Lezer 增量高亮 + `Compartment` 原位切换。
4. **工作台顶层懒挂载**：首次进入工作台前不挂载 `WorkbenchPage` 与任何侧栏 Webview；`readTree` 具备 24 并发槽限流与软链防环。
5. **Splitter 拖拽写盘解耦**：拖拽过程仅改内存，松手单次 `storeSet`。

---

## 七、建议实施节奏与验证标准

### 推荐分批顺序
1. **Batch 1（P0 主进程与高危 OOM 止血）**：P0-06（Myers 内存）→ P0-07（Git 风暴）→ P0-08（扫描优化）→ P0-09（标注大文件守卫）→ P0-16（主进程窗口/Watcher/锁表清理）。
2. **Batch 2（P0 本地 Agent 与编辑器击键顺滑度）**：P0-01 + P0-02 + P0-03（Agent 渲染与 IPC）→ P0-04 + P0-05 + P0-15 + P0-17（富文本/状态栏/工作台容器）。
3. **Batch 3（P0 文件树与多格式预览）**：P0-10（文件树）→ P0-11 + P0-12（HTML/Webview 标注）→ P0-13 + P0-14（PDF/DOCX）。
4. **Batch 4（P1 需对齐 UX 细节项）**：按业务痛点逐项评审后实施 P1-01 ~ P1-10。
5. **Batch 5（P2 长尾清理）**：随后续版本迭代逐步消化。

### 每批合入验收基线
- 静态与构建校验：`pnpm run lint` → 两侧定向类型检查（`tsconfig.node.json` / `tsconfig.web.json`）→ `pnpm run build`。
- 桌面端实测（`pnpm run dev`）：
  1. 打开 3,000+ 文件工作区，测试重命名打字、切换窗口、编辑 Markdown 触发 1.2s 自动保存时任务管理器中 `git.exe` 进程数与 CPU 波动；
  2. 打开 5,000 行含 50+ 标注的长 Markdown，连续打字/方向键移动/滚屏，使用 DevTools Performance 面板核对长任务（Long Tasks > 50ms）；
  3. 本地 Agent 进行 15+ 轮长对话，测试流式输出帧率与内存曲线；
  4. 右键删除 50MB+ PDF 文件确认无冻结；打开 100+ 页 PDF 与 5MB+ DOCX 缩放/拖拽分栏确认无白屏闪烁与明显掉帧；
  5. 主页/总结页按 `Ctrl+F` / `Ctrl+S` 确认不再被后台隐藏工作台拦截。
