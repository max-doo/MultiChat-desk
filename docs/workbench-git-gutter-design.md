> Created: 2026-11-25 09:33 (+08:00)

# 工作台 Git 行内/块级变更标记（Git Gutter）开发与性能审视方案

## 1. 背景与目标

当前工作台已在 [gitService.ts](file:///d:/Project/MultiChat-desk/src/main/services/gitService.ts) 和 [WorkbenchFileTree.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchFileTree.tsx) 中支持仓库检测、分支状态与**文件级**变更徽标（`M / A / D / R / C / U / !`），但打开具体文件后，用户无法像在 VSCode 中那样直接在编辑/预览区看到**具体哪几行或哪几段被新增、修改或删除**。

本方案旨在为工作台引入类似 VSCode 的 **Git Gutter（变更边距指示器）**，覆盖以下视图并严守各自边界：

1. **代码文件与纯文本**（[WorkbenchCodePreview.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchCodePreview.tsx)）：
   - 普通代码的「查看」与「编辑」模式
   - HTML 文件的「源码」模式（HTML「渲染」/「编辑」沙箱 iframe 仅保留顶栏状态提示，不做行级 DOM 映射）
2. **Markdown 文件**（[WorkbenchEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchEditor.tsx)）：
   - 「源码」模式（[WorkbenchSourceEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx)）
   - 「预览」模式（Lexical 富文本画布 + [FrontmatterPanel.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/FrontmatterPanel.tsx)）

### 核心产品规则（对齐业界常规实践）

| 场景 | 行为约定 | 说明 |
| :--- | :--- | :--- |
| **未跟踪文件（Untracked / `U`）** | 编辑器内**不画全篇绿条** | 仅文件树显示 `U` 徽标，避免新建笔记时满屏绿线影响阅读。 |
| **新建但已暂存（`staged === 'added'`）** | 以暂存区为基准 | 刚执行 `git add` 时无标记；若继续在工作区编辑，则仅对新增/改动行显示绿/蓝条（与 VSCode 一致）。 |
| **对比基准（Baseline）** | 默认对标 **Git Index（`:0:<repoPath>`）** | 与 VSCode `QuickDiffProvider` 一致：未暂存时 `:0:` 等价于 `HEAD`；文件在工作台移动后，[gitService.ts](file:///d:/Project/MultiChat-desk/src/main/services/gitService.ts) 的 `recordWorkspaceMove` 会把原 blob 写入新路径索引，因此查询 `:0:<newRepoPath>` 可自动延续历史。 |
| **空仓库（`unborn`） / 非仓库 / 冲突文件** | 编辑器内**不显示标记** | 无基准对象或处于冲突态（`!`）时跳过计算，防止大量误判与视觉噪声。 |
| **实时响应** | 内存态即时更新 | 基准内容一次性加载后缓存在前端内存，用户打字过程无需保存或反复调用 Git CLI，即可实时看到新增/修改标记。 |

> **关于对标 `:0:`（Index）还是 `HEAD` 的设计说明**：
> 工作台内 [WorkbenchGitPanel.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchGitPanel.tsx) 采用 `git add -A` 一次性提交，没有局部暂存区面板。若用户在外部终端手动执行了 `git add <file>`：
> - 按业界常规（`:0:`）：该文件在外部暂存后工作区 gutter 清空，后续继续编辑才显示新改动；
> - 若未来产品明确希望“只要没 `git commit` 就始终相对 `HEAD` 标红标绿”，只需在主进程将对象引用从 `:0:${repoPath}` 切换为 `HEAD:${repoPath}`（并把 `staged === 'added'` 单独视为与 `untracked` 相同的无基准态）即可，架构完全兼容。

---

## 2. 总体分层架构

严格遵循仓库分层规范（`main` 负责 Git 与安全校验、`preload` 仅桥接、`renderer` 负责状态、Diff 计算与视图渲染）：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Main Process (src/main/services/gitService.ts)                     │
│  1. git ls-files -s -z -- <repoPath>  → 取得 Index blobSha & stage │
│  2. git cat-file -s <blobSha>         → 体积熔断检查（≤ 1 MiB）     │
│  3. git cat-file -p <blobSha>         → 读取原始字节 → 编码/二进制校验│
└───────────────────────────────▲────────────────────────────────────┘
                                │ IPC: workbench:git-baseline
┌───────────────────────────────┴────────────────────────────────────┐
│ Renderer Store (src/renderer/src/store/workbenchStore.ts)          │
│  • 仅缓存「当前活动文件」唯一一份 gitBaseline（切文件/退出即释放）     │
│  • 绑定 requestSeq + (workspacePath, activeFilePath, blobSha) 防竞态 │
│  • 250ms 防抖调度 Diff 计算（大文件走 Web Worker / 超限熔断）         │
└──────────┬─────────────────────────────┬───────────────────────────┘
           │                             │
           ▼                             ▼
┌──────────────────────────┐  ┌──────────────────────────────────────┐
│ 代码查看/编辑 & HTML 源码 │  │ Markdown 源码 & Lexical 富文本预览    │
│ • WorkbenchCodePreview   │  │ • 源码：推荐迁至 CodeMirror 6 原生Gutter│
│ • 固定行高直接映射行样式  │  │ • 预览：基于 markdownSourceMap 映射块 │
│   （零额外行 DOM 节点）   │  │   在 ContentEditable 外部绘制覆盖色条 │
└──────────────────────────┘  └──────────────────────────────────────┘
```

---

## 3. 详细模块设计

### 3.1 共享契约（`src/shared/types/workbench.ts`）

```ts
export type GitBaselineStatus =
  | 'ok'          // 成功拿到基准文本
  | 'none'        // 非 Git 仓库 / 未跟踪 / unborn / 冲突中 / 无索引条目
  | 'binary'      // 基准对象含 NUL 字节或非文本
  | 'too-large'   // 基准对象超过安全大小上限，熔断降级
  | 'error'       // Git 命令异常

export interface GitBaselineResult {
  status: GitBaselineStatus
  /** Index 条目的对象哈希；用于判定提交/拉取/外部修改后基准是否发生变化 */
  blobSha?: string
  /** 仅 status === 'ok' 时返回；主进程已做 CRLF → LF 归一化？或由前端统一归一化 */
  content?: string
  byteLength?: number
  error?: string
}

export type GitLineChangeKind = 'added' | 'modified'

export interface GitDiffHunk {
  /** 新文件中起始行号（0-indexed） */
  newStart: number
  /** 新文件中覆盖行数；纯删除时为 0 */
  newCount: number
  /** 旧文件中起始行号（0-indexed） */
  oldStart: number
  /** 旧文件中覆盖行数；纯新增时为 0 */
  oldCount: number
  kind: 'added' | 'modified' | 'deleted'
}
```

### 3.2 主进程基线读取（`src/main/services/gitService.ts` & `ipcHandlers.ts`）

新增函数 `getFileBaseline(workspaceRoot: string, relativePath: string): Promise<GitBaselineResult>`，所有 Git 命令继续走现有 `serialize(workspaceRoot, ...)` 串行队列并带 `--no-optional-locks`：

1. **前置快速判定**：
   - 未传入 `workspaceRoot` / `relativePath`、或 Git 不可用、或 `resolveRepo(workspaceRoot)` 返回 `null` → 直接返回 `{ status: 'none' }`。
   - 使用 `assertSafePath` 思路规范化路径（禁止 `..` 逃逸与 `.git` 内部文件），转为 `repoPath = toRepoPath(repo.prefix, relativePath)`。
2. **查询 Index 条目（复用 `readIndexEntries`）**：
   - 执行 `git --literal-pathspecs ls-files -s -z --full-name -- <repoPath>`。
   - **关键点**：
     - 没有任何条目（未跟踪文件、被忽略文件、`unborn` 仓库尚未 `add` 的文件）→ 返回 `{ status: 'none' }`。
     - 存在 `stage !== '0'`（如合并冲突产生的 `1/2/3`）→ 返回 `{ status: 'none' }`，避免干扰冲突解决。
     - 命中 `stage === '0'` 时拿到 `entry.sha`。
3. **先探大小、后读内容（杜绝大文件 OOM）**：
   - 执行 `git cat-file -s <entry.sha>` 仅读取对象字节大小（O(1) 读 zlib header，几乎零内存开销）。
   - 若 `size > GIT_BASELINE_MAX_BYTES`（建议 **`1 * 1024 * 1024` = 1 MiB**）→ 直接返回 `{ status: 'too-large', blobSha: entry.sha, byteLength: size }`，**完全不把内容读进内存或 IPC**。
4. **读取并校验文本**：
   - 执行 `git cat-file -p <entry.sha>`（收集原始 `Buffer`，不直接 `toString()` 拼接字符串，避免多字节 UTF-8 跨 chunk 被截断）。
   - 扫描前 1024 字节是否存在 `0x00`（复用 `workbenchService.ts` 的二进制判定逻辑），命中则返回 `{ status: 'binary', blobSha: entry.sha }`。
   - **编码对齐**：按 `utf-8` 解码（若未来工作台支持非 UTF-8 本地文件读写，则与 `readFile` 共用同一套编码探测策略）。

**IPC 注册**：
- `src/main/ipcHandlers.ts`: `workbench:git-baseline`
- `src/preload/index.ts`: `window.api.workbench.gitBaseline(workspaceRoot, relativePath)`（`index.d.ts` 与 `env.d.ts` 自动从 preload 导出类型派生）

### 3.3 渲染层状态与缓存策略（`workbenchStore.ts`）

#### 状态结构（严格单文件作用域）
在 `workbenchStore` 中仅维护**当前打开文件**的状态，不做多文件缓存池：

```ts
gitBaselinePath: string | null
gitBaselineStatus: GitBaselineStatus | 'idle' | 'loading'
gitBaselineSha: string | null
gitBaselineContent: string | null  // 切文件/清空编辑器时立即置 null 释放内存
```

#### 触发与失效矩阵

| 事件 | 动作 | 原因 |
| :--- | :--- | :--- |
| `openFile` 打开可对比文件（`markdown`/`code`/`text`） | 异步拉取 `gitBaseline`，绑定递增 `baselineSeq` | 若打开的是图片/PDF/DOCX/oversized 文件，直接置空释放上一份基准。 |
| `updateActiveContent`（用户打字） | **不请求 Git**，由编辑器/Diff Hook 250ms 防抖用内存基准重算 Diff | 零进程开销，输入不卡顿。 |
| `saveActiveFile`（自动或手动保存） | 基准 `blobSha` 未变则**无需重拉**；仅当需要同步文件树徽标时节流刷新 `gitStatus` | 注意：目前 `saveActiveFile` 未主动刷 `gitStatus`，建议追加一个 800ms~1500ms 去抖的 `refreshGitStatus` 以保证文件树 `M` 徽标与编辑器实时一致。 |
| `gitCommit` / `gitPull` / `gitMergeUpstream` 成功 | 重新拉取当前打开文件的 `gitBaseline` | 提交或拉取后 Index 的 `blobSha` 已变更，必须刷新消除或更新标记。 |
| `handleExternalFsChanged` 或窗口 `focus` 触发 `refreshGitStatus` | 对比新状态：若 `gitStatus` 显示文件已变为干净、或从 `U` 变成已跟踪，校验/重拉 `gitBaseline`（若返回相同 `blobSha`，可跳过前端重算 Diff） | 覆盖外部终端 `git add / commit / checkout / reset` 场景。 |
| 切换工作区 / 关闭文档 / 文件被删除 | 立即清空 `gitBaselineContent = null` | 防止跨工作区泄漏与内存滞留。 |

### 3.4 行级 Diff 算法与换行符处理（`src/renderer/src/utils/gitDiff.ts`）

1. **换行符归一化（极其重要）**：
   - Windows 下工作区文件经常是 `\r\n`，而 Git Index（受 `core.autocrlf` 影响）常保存为 `\n`。
   - **必须在切分前统一做 `text.replace(/\r\n?/g, '\n')`**，然后再 `split('\n')`。否则 Windows 下打开未改动文件会整篇误报为全部修改。
   - **注意尾行空行**：如文件末尾带 `\n`，`split('\n')` 末尾多一个空串；旧新文本两侧须按同一规则切分，避免最后一行凭空多出“新增/删除”。
2. **算法选择**：
   - 使用轻量化 **Myers Line Diff**（可引入极轻量的 `diff` / `fast-myers-diff` 或几十行实现的基于行哈希的 Myers Diff，先把每行字符串映射为 32-bit FNV-1a 哈希或整数 ID，再比对整数数组，比直接比较字符串数组快数倍且更省临时内存）。
   - **Hunk 合并规则（对齐 VSCode）**：
     - 连续删除 `k` 行紧跟连续新增 `m` 行（同一编辑块内 `delete + insert`）：
       - 前 `min(k, m)` 行标记为 **`modified`（蓝色）**；
       - 若 `m > k`，多出的 `m - k` 行标记为 **`added`（绿色）**；
       - 若 `k > m`，该块末尾标记一个 **`deleted`（红色三角指示）**。
     - 纯新增：全部标记 **`added`（绿色）**。
     - 纯删除：在紧邻的下一行上方（若删到文件末尾则在最后一行下方）渲染 **`deleted` 指示器**。
3. **计算熔断保护**：
   - 任一侧字节数 `> 1 MiB` 或行数 `> 20,000` 行 → 直接返回空标记 + `truncated: true`。
   - 检测到极长单行（如存在单行字符数 `> 10,000`，常见于压缩 JS/JSON）→ 跳过精细 Diff，防止正则/折行/字符串比较卡顿。
   - 建议当 `oldLines.length + newLines.length > 4,000` 时，自动派发到 **Web Worker** 异步计算（携带版本号防乱序），主线程保持绝对流畅。

---

### 3.5 各视图渲染与改造方案

#### A. 代码文件「查看」与「编辑」+ HTML「源码」（`WorkbenchCodePreview.tsx`）

`WorkbenchCodePreview.tsx` 目前行号栏 `lineNumbersRef` 和代码区都使用 `whitespace-pre` + 固定行高 `leading-6`（24px），天然一行对一 `<div>`。

- **视觉规范**（适配当前暗色代码主题 `bg-slate-900`）：
  - 在行号侧边栏 `w-12` 的最右侧（`border-r border-slate-800` 内侧）留出 `3px` 窄带：
    - `added`：`bg-emerald-500` 竖条
    - `modified`：`bg-sky-400` 竖条
    - `deleted`：在对应行缝隙处使用 `::after` / `::before` 绘制 `5px` 高的红色水平小三角或细线（`bg-rose-500`）
- **零额外节点优化**：
  - **不要**在 `lines.map` 中为每一行新增包装 `<div>` 或 React 组件。
  - 直接将行标记编码为行号 `<div>` 的 `data-git-change="add|mod"` 与 `data-git-del="top|bottom"` 属性，由静态 CSS 伪元素渲染色带！未变更行零额外样式、零额外 DOM 节点。

#### B. HTML「渲染」与「可视化编辑」

- **不实现行级标记**：`WorkbenchHtmlAnnotationPreview` 与 `WorkbenchHtmlVisualEditor` 均运行在沙箱 `<iframe>` 中，HTML 文档可包含外部 CSS 布局与脚本，强行将源码行号投影到渲染 DOM 不可靠且会干扰现有的 HTML 标注系统。
- **替代呈现**：仅在 `WorkbenchCodePreview` 顶部工具栏文件名右侧保留一个简洁状态胶囊（如 `M 已修改`），鼠标悬停提示“切换至源码模式查看具体修改行”。

#### C. Markdown「源码」模式（`WorkbenchSourceEditor.tsx`）

**架构审视与关键取舍**：
当前 [WorkbenchSourceEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx) 采用「透明 `<textarea>` + 背景 `<pre><code>`（Prism）+ 独立 `gutterRef`」，并且正文字段开启了 `whitespace-pre-wrap break-all`（自动软折行）。经查代码现状：**目前长段落发生软折行时，左侧 `gutterRef` 按 `\n` 渲染的固定行高 `<div>{n}</div>` 已经无法与右侧正文视觉行严格对齐**。

因此有两种推进方案：

1. **方案 1（强烈推荐）：将 Markdown「源码」模式迁移至 CodeMirror 6**
   - **已有依赖**：`package.json` 已安装 `@codemirror/state`、`@codemirror/view`、`@codemirror/language`、`@codemirror/lang-markdown`、`@codemirror/commands`（目前已在 [MindmapMarkdownEditor.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/MindmapMarkdownEditor.tsx) 稳定使用），**无需新增任何生产依赖**。
   - **收益**：
     1. 原生 `lineNumbers()` + 自定义 `gutter()` + `EditorView.lineWrapping` 像素级对齐，彻底根治软折行错位；
     2. 原生支持**视口虚拟滚动**，即使 1MB~2MB 长篇 Markdown 文档，DOM 节点也始终只有屏幕可见的几十行，内存与帧率表现远超当前方案；
     3. 只需一个基于 `StateField` + `GutterMarker` 的轻量扩展即可渲染 VSCode 级 Git Gutter。
   - **改造成本**：需适配保留现有的 `WorkbenchSourceEditorHandle`（`applyAction`、`setSelection`）、滚动记忆 `workbenchEditorScroll`、以及图片粘贴/拖拽上传事件。

2. **方案 2（短期过渡方案，不推荐长期使用）：保留透明 `<textarea>` + 背景行容器**
   - 若暂不替换内核，则**不能**把 Git 竖条放进 `gutterRef`，而必须把背景 `<pre>` 的 `highlighted` HTML 按 `\n` 拆分为每行一个 `<span class="block relative">`（注意需要处理 Prism 跨行 token 如多行代码块闭合问题，否则拆行会破坏标签嵌套！），再在行左侧 `padding-left` 留白区用 `::before` 绝对定位绘制撑满整个折行高度的竖条。
   - 缺点：增加了 DOM 节点数、必须处理跨行 Prism 标签闭合，且原有的长行折行行号错位问题依然存在。

#### D. Markdown「预览」模式（`WorkbenchEditor.tsx` Lexical 富文本）

Lexical 是富文本状态树，**不存在行号**，且与源码之间通过 [markdownSourceMap.ts](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/markdownSourceMap.ts) 维护块级增量映射。

**实现路径（块级 Git Gutter 覆盖层，非侵入式）**：

1. **源码行区间 → 顶层 Lexical 块映射**：
   - 复用 `markdownSourceMap.ts` 的 `extractMarkdownEnvelope` 与 `scanMarkdownSourceBlocks`（或直接从 `MarkdownSyncPlugin` 暴露的 `sourceStateRef` 获取当前各顶层块 / `CompositeSourceGroup` 在 Markdown 正文中的起止行号 `[startLine, endLine]`；注意需在每次源码同步完成后顺带更新块行号索引，开销为 $O(\text{块数})$ 的轻量遍历）。
   - 将行级 Diff Hunk 的新文件行号区间 `[newStart, newStart + newCount)` 与每个顶层块的 `[startLine, endLine]` 做区间重叠判定：
     - 块内所有行均为 `added` → 该块标记 **`added`（绿条）**；
     - 块内部分新增或包含 `modified` → 该块标记 **`modified`（蓝条）**；
     - 纯删除 Hunk 落在两个块间隙 → 在后一个块顶部（或前一块底部）标记 **`deleted`（红三角）**。
   - **Frontmatter 区域**：`parseMarkdownWithFrontmatter` 分离出的 `frontmatter` 文本独立做一次字符串/行对比；若发生变化，直接在 [FrontmatterPanel.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/FrontmatterPanel.tsx) 左侧边线显示修改色条。
2. **只读外挂覆盖层（`WorkbenchGitGutterPlugin`）**：
   - 参照 [WorkbenchMarginNotes.tsx](file:///d:/Project/MultiChat-desk/src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx) 的非侵入架构，将标记层挂载在 `ContentEditable` 外部容器（`anchorElem` / `stageRef`）。
   - 仅遍历**有变更的 `NodeKey` 集合**（未变更块跳过），通过 `editor.getElementByKey(key)` 获取真实 DOM 的纵向坐标与高度，在正文 `px-16` 左侧安全留白边缘（避让 `WorkbenchDraggableBlockPlugin` 悬停拖拽手柄，例如放置在文章内容左边界外侧 `left: 10px` 处，而拖拽手柄在悬浮时位于块更外侧或紧邻文本）渲染 `3px` 竖条。
   - **铁律**：绝不往 `ContentEditable` 内部插入 DOM、绝不注册自定义 `LexicalNode`、绝不触发 Lexical `update`，从而**100% 保证光标、撤销栈、块拖拽与文本标注锚点不受影响**。

---

## 4. 重点审视：性能与内存专项评估

### 4.1 内存占用剖析与预算上限

| 内存来源 | 潜在风险点 | 量化约束与防线 |
| :--- | :--- | :--- |
| **主进程 Git Buffer** | 仓库含大文件时 `git show` 吐出数十 MB 原始数据 | 先执行 `git cat-file -s` 检查体积，**硬上限 `1 MiB`（1,048,576 B）**，超限直接熔断不读内容。 |
| **渲染进程 Store 缓存** | 若按路径字典缓存多文件基准，切换几十个文件后可能累积几十 MB 滞留 | **严格单文件策略**：只保存当前 `activeFilePath` 的 1 份基准；切换文件、关闭工作区、切到二进制文件时立即置 `null`。单文件常驻额外内存通常 **< 100 KB ~ 1.5 MB**。 |
| **DOM 与 React Fiber（现有隐患放大）** | `WorkbenchCodePreview` 和 `WorkbenchSourceEditor` 目前均**无虚拟滚动**，1MB 文件约 2~4 万行全量 DOM 已很重；若每行增加组件/包装节点会令内存翻倍 | 1. 代码视图**不增加行级 DOM 节点**，仅用行号 `<div>` 上的 `data-*` 属性 + CSS 伪元素着色；<br>2. Markdown 源码视图建议迁至 **CodeMirror 6**，可将数万行 DOM 压降至视口约 50 行，**净内存反而低于现状**；<br>3. Lexical 预览模式仅渲染**有变更块**的覆盖条，干净文档额外 DOM = 0。 |
| **Web Worker 内存** | 长驻 Worker 若缓存大字符串不释放会占内存 | Worker 无状态化：输入仅保留单次比对所需数据，或仅对超过 4,000 行的文件启用 Worker；工作区关闭时调用 `terminate()`。 |

### 4.2 CPU、主线程延迟与帧率审视

1. **Git 子进程排队延迟**
   - `gitService.ts` 使用单工作区串行队列 `serialize()`。如果打开文件时恰逢用户触发了 `gitPull` / `gitPush`（网络操作耗时可能数秒），`getFileBaseline` 会排在后面等待，属于预期安全行为（避免与写操作抢锁），但 UI 必须表现为“静默等待、不阻塞编辑器输入与内容显示”，拿到结果后渐进出现标记即可。
   - 必须通过 `baselineRequestSeq` 校验：如果网络同步耗时 3 秒期间用户已经切到别的文件，过期结果直接丢弃。
2. **最坏情况下的 Diff 计算耗时（$O((N+M) \cdot D)$ 退化）**
   - 如果一个 20,000 行的文件被全部格式化或整体替换，$D \approx N$ 时标准 Myers 算法在 JS 主线程上可能出现数百毫秒甚至秒级卡顿。
   - **三道防线**：
     - **行数与字节上限**：`> 1 MiB` 或 `> 20,000 行` 直接跳过。
     - **单行长度上限**：存在单行 `> 10,000 字符`（如压缩后的 JSON/CSS/JS）时，直接跳过 Diff，避免行哈希与后续渲染抖动。
     - **步数上限 + Worker 分流**：总行数 `> 4,000` 时在 Web Worker 中运行；Diff 内部设置最大编辑距离保护（如 `maxDiffSteps = 50_000`），超过即中止并降级（提示“改动过大，暂不显示行内标记”），绝不允许拖死主线程。
3. **打字防抖与零 Reflow**
   - 编辑态内容变化采用 **250ms 防抖**计算 Diff，不与单帧按键响应抢占 16ms 预算。
   - Lexical 预览态借助 `MarkdownSyncPlugin` 现有的 `250ms` 同步防抖节拍，并在 `requestAnimationFrame` 中批量读取变更块的 `offsetTop / offsetHeight`（**先读后写**），避免布局抖动（Forced Reflow）。
   - `ResizeObserver` 只监听 `stageRef` 宽度变化（窗口缩放/侧栏拖拽时重算高度），不对每个段落单独创建 `ResizeObserver`。

### 4.3 稳定性与一致性边缘场景 Checklist

- [ ] **Windows CRLF / LF 混合**：对比两侧均统一转为 `\n` 后再行切分，确保纯换行符差异不产生全篇蓝色标记。
- [ ] **编码一致性**：若文件含 BOM（`\uFEFF`），注意与 `extractMarkdownEnvelope` 保持一致，避免仅第一行因为 BOM 被标为修改。
- [ ] **快速切文件竞态**：使用自增 `seq` + `activeFilePath` 双重验证，过期 IPC 返回与 Worker 返回全部丢弃。
- [ ] **内部自动保存 vs 外部 Git 操作**：内部 `saveActiveFile` 不应重置基准；外部 `focus` / `fs-changed` 刷新 `gitStatus` 时，对比最新 `blobSha`，一致则跳过重拉、不一致则更新基准。
- [ ] **Lexical 折叠/图片异步撑高**：图片加载完成后会改变下方段落纵坐标，可复用现有的容器 `ResizeObserver`（节流至每帧一次）重算变更竖条位置。
- [ ] **大文件内存验证指标**：实施后需用 1.5MB 代码文件、500KB 长 Markdown（含表格/代码块/公式）以及压缩单行 JSON 在 `pnpm run dev` 中实测：输入帧率、切文件内存回落、以及提交后标记立即清除。

---

## 5. 建议实施路线（分阶段控制风险）

| 阶段 | 范围 | 预期工作量与风险 | 验收标准 |
| :--- | :--- | :--- | :--- |
| **Phase 1：基建 + 代码编辑器** | `gitService.ts` 基准读取 + IPC + `workbenchStore` 单文件缓存 + Web Worker Diff 引擎 + `WorkbenchCodePreview`（「查看」「编辑」及 HTML「源码」） | 工作量小、风险低，可立即打通全部数据链路与性能熔断机制 | 代码文件显示准确的新增/修改/删除标记；未跟踪文件不标全绿；Windows CRLF 无误报；>1MB 文件安全降级。 |
| **Phase 2：Markdown 源码模式** | 评估并推进 `WorkbenchSourceEditor` 迁移至 **CodeMirror 6**（复用已有依赖）并挂载原生 Git Gutter 扩展 | 中等工作量，一并解决长行折行错位与大文件虚拟滚动 | 软折行下色带高度精准对齐；工具栏格式操作、图片粘贴/拖拽、查找定位、滚动记忆功能完整无回归。 |
| **Phase 3：Markdown 预览模式** | 基于 `markdownSourceMap` 块行号投影 + `WorkbenchGitGutterPlugin` 外部只读覆盖层 + `FrontmatterPanel` 标记 | 复杂度集中在块级投影与浮层坐标跟随，需重点做标注/拖拽兼容性手测 | 段落/标题/列表/代码块修改在预览左侧显示块级色条；不影响光标、撤销、拖拽手柄与边距批注；Frontmatter 改动有独立指示。 |
