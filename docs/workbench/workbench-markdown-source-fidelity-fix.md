> Created: 2026-11-25 08:55 (Asia/Shanghai)
> Updated: 2026-11-25 09:11 (Asia/Shanghai)

# 工作台 Markdown 源码保真修复方案

## 问题现象

近期在 `D:\Project\masters-thesis` 等多份 Markdown 文件上观察到：文件在工作台被打开（或仅在富文本模式下短暂编辑）后，源码出现**与本次编辑无关的大量改动**——且这些改动会破坏后续渲染。一次典型的 git diff 报告（中期后论文研究范围调整与落地执行方案章节，`157e9ed` 提交对比）显示 23 行新增 / 17 行删除，正文实质内容未变，但 Markdown 语法层被改写：

1. **粗体被转义为字面量**：`**Rhino_明细表**` → `\*"_"*\*`，粗体失效。
2. **粗体范围漂移**：原本是"整行加粗"变成"行内某段加粗"，并把"删除旧参数"等本不该加粗的文字也包了进去。
3. **HTML 换行标记被转义为实体**：表格单元格内 `<br/>` → `&60;br/`，换行失效，渲染时显示字面 `<br/>` 文本。
4. **列表缩进被规范化**：3 空格缩进的子项被统一改成 4 空格。
5. **空行被合并/插入**：标题与列表之间被强行补空行，或反之。
6. **文件末尾换行符丢失**：`No newline at end of file`。

用户主观上**没有修改**这些内容，但磁盘文件已被悄悄改写。

## 根因

这是一个**架构性问题**，不是某个序列化器的 bug。

### 当前实现链路

- **加载**：`MarkdownSyncPlugin.tsx:778` 用 `$convertFromMarkdownString(prepareHtmlTablesForLexical(markdownBody), WORKBENCH_TRANSFORMERS)` 把 `.md` 解析为 Lexical AST。
- **回写**：`MarkdownSyncPlugin.tsx:799` 注册 `registerUpdateListener`，**只要 `dirtyElements` 或 `dirtyLeaves` 非空，就同步对整份文档调用 `serializeWorkbenchMarkdown`（`MarkdownSyncPlugin.tsx:515`）重新生成 Markdown 字符串**。如果文档内存在任意一条标注（`MarkNode`），还会把整篇文档 `state.toJSON(true)` 递归克隆并重建影子 `EditorState` 后再全量 `$convertToMarkdownString`。
- **落盘**：生成的字符串每次都立即交给 `workbenchStore.updateActiveContent` → `workbenchStore.ts:1257` 起 1200ms 防抖，自动调 `saveActiveFile` 写盘；同时 `activeFileContent` 变更会同步唤醒 `WorkbenchStatusPill`、`WorkbenchEditor`、`WorkbenchTitleBar`、`WorkbenchAnnotationPlugin`、`WorkbenchFindReplaceBar` 等多个全量计算订阅者。

### 为什么会破坏源码

Markdown 源码不仅包含语义，还包含大量**表层语法信息**：

- 强调语法的选择：`**bold**` vs `__bold__`、`*it*` vs `_it_`。
- 空白与缩进：列表缩进 3 vs 4 空格、空行数量、行尾空格。
- HTML 混排的具体形式：`<br/>` vs `<br>` vs `<br />`。
- 换行符与文件结尾：UTF-8 BOM（`\uFEFF`）、LF vs CRLF、是否以换行结尾。
- Frontmatter 内部键序、注释、MDX/扩展语法。

Lexical 的 `EditorState` 是**语义结构**，不保留上述源代码细节。`$convertToMarkdownString` 序列化时只能选一种规范形式输出（`__bold__` 不输出、`<br/>` 走转义、列表缩进统一 4 空格、BOM/CRLF/末尾换行被剥离或改写等）。结果是：哪怕语义一字未改，**重新生成的 Markdown 在字节层面已经和原文不同**。

### 触发条件比想象的宽

`registerUpdateListener` 里的守卫已经排除了 `sync-external`、`annotation-sync`、`code-exit` 等几个已知噪声源（`MarkdownSyncPlugin.tsx:801-806`），但以下真实路径仍会触发整篇重导出写盘：

1. **未打排除 tag 的非内容性更新**：
   - `WORKBENCH_ANNOTATE_COMMAND`（`WorkbenchAnnotationPlugin.tsx:997-1084`）插入 `MarkNode` 时未携带 `annotation-sync` tag，直接把整篇正文重新序列化写盘。
   - `WorkbenchTableCellResizerPlugin.tsx:214-300` 拖拽表格列宽/行高仅带 `SKIP_SCROLL_INTO_VIEW_TAG`；`FORMAT_ELEMENT_COMMAND`（`WorkbenchToolbar.tsx:277`）调整块对齐。`@lexical/markdown` 不导出列宽/行高/对齐，但节点被标脏仍触发全量重导出。
   - `INSERT_REPLY_COMMAND`（`MarkdownSyncPlugin.tsx:614-660`）插入 `PendingInsertNode` + `PendingBarNode` 待确认预览时未隔离 tag，且提前改写了 `frontmatterRef`，导致用户还没点"✓ 采纳"就被 1200ms 自动落盘。
2. **Lexical 内部 normalize**：任何未被显式打 tag 的节点合并、格式修正、或兄弟节点 normalize 引起 `dirtyElements` / `dirtyLeaves` 非空。
3. **文件编码与边界漏洞**：`parseMarkdownWithFrontmatter`（`MarkdownSyncPlugin.tsx:535`）与 `normalizeMarkdownFrontmatter`（`workbenchStore.ts:114`）要求 `^---`，遇到带 UTF-8 BOM（`\uFEFF`）的文件会失效并把 Frontmatter 当成正文破坏；切文件未派发 `CLEAR_HISTORY_COMMAND`，`Ctrl+Z` 可能把上一份文件撤销进当前文件。

也就是说：**只要富文本模式挂载过 Lexical，文件就有被污染的风险**，跟用户是否真的修改无关。

## 业界做法对照

调研同类产品的实现思路，关键差异在于**持久化对象的选择**：

| 产品 | 持久化对象 | 富文本/源码关系 | 字节级保真 |
| --- | --- | --- | --- |
| **Obsidian** | Markdown 文本（CodeMirror Document） | Live Preview 是 Decoration 投影；编辑 = Text Transaction | ✅ 天然保证 |
| **Typora / MarkText** | Markdown 文本 | 实时渲染基于源码 | ✅ |
| **VS Code** | TextModel | 预览只读，编辑事务作用于字符串 | ✅ |
| **Milkdown** | ProseMirror AST | remark 双向转换 | ❌ 官方承认有损 |
| **Tiptap** | ProseMirror AST | Markdown 扩展是 Beta | ❌ 明确不保证 round-trip |
| **Notion / Linear** | 结构化 Block | Markdown 只是导入/导出格式 | ⚠️ 本就不承诺 |
| **MDXEditor** | Lexical AST | Source / Diff 模式分离 | ❌ 同样有损 |
| **本工作台（现状）** | Lexical AST | 全量序列化回写 | ❌ |

**关键结论**：Obsidian 能做到"打开不污染"，是因为它**根本不把 AST 当 source of truth**——底层始终是 CodeMirror 的文本字符串，Syntax Tree 和 Decoration 只是显示层投影。而我们现在的实现把 Lexical AST 当成了真相源，等价于用了 Notion 的模型却承诺了 Obsidian 的体验。

`@lexical/markdown` 的官方定位是**导出工具**而非"实时回写工具"，Tiptap 文档也明确不保证 round-trip identity。继续给序列化器打补丁（修 `**`、修 `<br/>`、修缩进）只能在已知的少数格式上止血，**无法解决所有未支持的语法、扩展和未来新增语法**——这是一个数据所有权错位的根本问题。

## 修复方案

目标分两层：

1. **未编辑文件 / 无语义变更操作**：源码 0 字节改动（P0，必须达到 100%）。
2. **已编辑文件**：未修改的块保持原文，只重写被编辑的块，且保留 BOM / Frontmatter / EOL / EOF 换行（P1，块级最小 diff）。

不要求"全量序列化结果与原文完全一致"——这在 AST 模型下做不到。

### 方案 A：P0 — 阻断非编辑回写与编码边界损坏

> **设计修正**：工作台内大量真实编辑入口直接调用 `editor.update(...)`（如 `WorkbenchToolbar` 块切换/公式、`WorkbenchDraggableBlockPlugin` 的 `+` 菜单、`WorkbenchTableActionMenuPlugin`、`WorkbenchLinkEditor`、`WorkbenchEquationNode`、`WorkbenchHtmlTableNode` 原位编辑、`WorkbenchImagePlugin` 异步插图）或由浏览器原生 IME `MutationObserver` 写入，**不能使用 Command 白名单拦截未知写入**（否则会导致静默丢编辑）。改为**“修复内部噪声 tag + 懒计算语义基线守卫 + 保留文件信封”**。

**具体做法**：

1. **补齐内部非正文更新的 Tag 隔离**：
   - `WorkbenchAnnotationPlugin.tsx`：`WORKBENCH_ANNOTATE_COMMAND` 通过 `$addUpdateTag('annotation-sync')`、`$addUpdateTag(HISTORIC_TAG)`、`$addUpdateTag(SKIP_SELECTION_FOCUS_TAG)` 隔离，创建标注不触发正文写盘。
   - `WorkbenchTableCellResizerPlugin.tsx`：调整表格列宽/行高时携带 `'table-resize'` tag，在 `MarkdownSyncPlugin` 中跳过。
   - `MarkdownSyncPlugin.tsx`：`INSERT_REPLY_COMMAND` 与 `CANCEL_INSERT_COMMAND` 携带 `'pending-insert-preview'` tag，并把会话 frontmatter upsert 暂存在 `pendingFrontmatterRef`，仅在 `CONFIRM_INSERT_COMMAND`（采纳）时才落入正文与 frontmatter，杜绝预览态自动落盘。
   - 切文件（`isNewFile`）时派发 `CLEAR_HISTORY_COMMAND`，防止 Undo 跨文件污染。
2. **懒计算语义基线守卫（Semantic Baseline Guard）**：
   - 加载/切入 WYSIWYG 时 **0ms 序列化**，仅记录原始原文与文件信封；不在打开文件时阻塞主线程。
   - 当首次发生非排除 tag 的 dirty 更新时，利用 Lexical 回调自带的 `prevEditorState` 懒计算并缓存基线导出结果；若更新后整体（及各块）的导出语义与基线一致（如 `FORMAT_ELEMENT_COMMAND` 对齐、内部无语义变化的 normalize、或者改后 `Ctrl+Z` 撤销回原状），**不调用 `updateActiveContent`，源码保持 0 字节改动**。
3. **文件信封保真（P0 同步落地 BOM / Frontmatter / EOL / EOF 换行）**：
   - `parseMarkdownWithFrontmatter`、`normalizeMarkdownFrontmatter` 与 `WorkbenchEditor.handleFrontmatterChange` 统一识别并剥离前导 UTF-8 BOM（`\uFEFF`），记录原文件的 `eol`（`\r\n` vs `\n`）与 `hadTrailingNewline`（文件末尾是否有换行），写回时原样恢复。
   - `saveActiveFile` 中 `normalizeMarkdownFrontmatter` 若仅改写了 frontmatter，在 WYSIWYG 下仅更新 `frontmatterRef` 与 `lastSyncedContentRef`，不触发整篇 Lexical 重载丢光标。

### 方案 B：P1 — Lexical 同源块级 Source Map + 局部回写 + 性能优化

**核心思路**：文件级的 Source of Truth 仍是原始 Markdown 字符串，Lexical 只是编辑投影；保存时只对真正发生语义变化的顶层块序列化，未修改的块（包括被拖拽移动位置、或 Undo 恢复原状的块）原样输出原始源码片段。

> **技术选型修正**：不使用额外 `remark-parse` 依赖（该包在 `package.json` 中并非直接依赖，且 `remark-parse` 与 `@lexical/markdown` 在 `$$...$$`、HTML 表格占位符、段落合并、空行与缩进规则上存在系统性块数不一致）。改为**直接与 `WORKBENCH_TRANSFORMERS` / `@lexical/markdown` 导入规则对齐的原生轻量块扫描器 + Anchor-LCS 局部对齐兜底**，零新增依赖且天然同构。

**实现要点**：

1. **统一坐标系下的块扫描（`markdownSourceMap.ts`）**：
   - 先提取文件信封（`bom`、`frontmatter`、`bodyRaw`、`eol`、`hadTrailingNewline`）。
   - 将 `bodyRaw` 按行切分（保留每行精确 `raw` 与行尾符），在同一坐标系下完成 `<table>...</table>` 块到单行占位符的映射，并按 `@lexical/markdown` 与 `WORKBENCH_TRANSFORMERS` 规则扫描为顶层 `SourceBlock[]`（记录 `id`、`kind`、`raw`、`gapBefore`（块前原始空行/换行分隔）、`rawStartLine`、`rawEndLine`）以及文档末尾 `trailingGap`。
2. **Fast-path 1:1 绑定 + Anchor-LCS 区间兜底**：
   - 在 `sync-external` 导入完成后，对齐 `root.getChildren()` 与 `SourceBlock[]`。
   - 常规情况（长度与块类型一致）：$O(N)$ 直接建立 `nodeKey -> sourceBlockId` 绑定。
   - 若遇到特殊嵌套/边缘写法导致局部块数不一致：使用基于块类型与文本特征的 Anchor-LCS 对齐，仅将相邻锚点之间未对齐的小区间封装为 `CompositeSpan`（记录整段原始源码切片 `rawSlice` 与区间内 `nodeKeys`）。**只要该局部区间内没有任何节点被编辑，该切片仍原样透传；绝不因局部 1 处语法差异导致整篇硕士论文退化为全量重写**。
3. **跨更新脏追踪与单块增量序列化**：
   - Lexical 每次 commit 后会清空 `dirtyElements` / `dirtyLeaves`，插件维护持久化的 `dirtyBlockKeys` 与 `pendingDirtyKeys`，覆盖：
     - **块内编辑 / 拆块（`Enter`）/ 并块（`Backspace`）/ 删除块 / 插入块**；
     - **拖拽移动未编辑块（`DraggableBlockPlugin`）与撤销回原状（`Ctrl+Z`）**：首次对某原始块判脏时，从 `prevEditorState` 懒导出该**单个块**的基线字符串 `baselineExport`（加载时成本为 0）；若当前单块导出结果等于 `baselineExport`，则判定该块语义未改、清除脏标记并继续原样输出其 `raw`！
     - **单块导出与局部 `MarkNode` 剥离**：构造只含该单个顶层节点的微型影子 `EditorState` 调用 `$convertToMarkdownString(WORKBENCH_TRANSFORMERS)`，并仅对该脏块递归剥离 `MarkNode`（将标注文档编辑时的序列化成本从 $O(N_{\text{doc}})$ 降至 $O(1\text{ block})$）。
     - **块间分隔符策略**：保留原块 `gapBefore`（首块被删后新的首块不残留前导空行）；对新插入块按相邻块是否为空段落采用 `eol + eol` 或 `eol` 分隔；末尾保留 `trailingGap`（控制 EOF 换行符）。
4. **节流防抖同步 + 同步 Flush 通道（性能优化）**：
   - `registerUpdateListener` 中不再每次按键同步执行序列化与 Zustand 全文广播：按键期间仅做 $O(1)$ 的 `dirtyBlockKeys` 收集、轻置 `isDirty: true`（仅状态切换时触发一次）、并调度 **250ms** 防抖同步（同时复用 `WorkbenchMinimalToc` 的非内容选区跳过优化）。
   - 在 `workbenchStore` 暴露 `flushMarkdownSync()`，并在 `saveActiveFile`、`openFile`、`setEditorMode`、`closeWorkspace`、`insertReplyIntoActiveMarkdown`、打开查找替换栏、发送到 AI 及窗口关闭/退出守卫前同步执行，保证切模式、保存或退出不丢失 250ms 窗口内的最后输入。

**数据结构**：

```ts
export interface SourceBlock {
  id: string
  kind: SourceBlockKind
  raw: string               // 原始正文源码片段（不含前导空行与尾部换行）
  gapBefore: string         // 该块紧邻前方的原始换行/空行分隔符
  textHint: string          // 用于 Anchor-LCS 对齐的轻量文本特征
  baselineExport?: string   // 懒缓存：首次被判脏时从 prevEditorState 导出的规范文本
}
```

### 方案 C：P2 — 并发校验与扩展透传加固

> **核查修正**：主进程 `workbenchService.ts:1269-1303` 已实现 `.tmp` + `rename` 原子写入（及 Windows 占用兜底），不再重复列为待办。

后续演进聚焦以下两点：

- **强并发校验**：主进程 `statFile` / `writeFile` IPC 增加 SHA-256 内容摘要与 compare-and-swap（`expectedHash`）校验，防御跨工具或极短时间窗内 mtime 精度不足导致的静默覆盖（渲染层自身对比已有字符串仍保持 `===` 零额外 hash 开销）。
- **扩展原文透传占位符**：将 `HTML_TABLE_TRANSFORMER` 的占位符透传模式推广到更多有损原生语法块（如 `<details>` / `<figure>` / HTML 注释 `<!-- ... -->` / 脚注定义 / 未知 MDX 或 directive 块）。

## 依据与参考

**业界实现**：

- Obsidian 编辑器架构（CodeMirror 6 + Decoration）：https://codemirror.net/docs/guide/ 、https://codemirror.net/examples/decoration/ 、https://obsidian.md/help/edit-and-read
- Milkdown 架构（remark ↔ ProseMirror 双向转换）：https://milkdown.dev/docs/guide/architecture-overview
- Tiptap Markdown 扩展（明确 Beta、不保 round-trip）：https://tiptap.dev/docs/editor/markdown
- MDXEditor（同栈 Lexical）：https://github.com/mdx-editor/editor 、https://mdxeditor.dev/editor/docs/diff-source
- Lexical 官方 `@lexical/markdown`：https://github.com/facebook/lexical/tree/main/packages/lexical-markdown

**本仓库相关代码**：

- `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx:551` — 双向同步插件主体（`515` `serializeWorkbenchMarkdown`、`778` `$convertFromMarkdownString`、`799` `registerUpdateListener`）
- `src/renderer/src/components/workbench/markdownSourceMap.ts` — 块级 Source Map、Anchor-LCS 对齐、单块序列化与增量拼装模块（P1 新增）
- `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx:997` — `WORKBENCH_ANNOTATE_COMMAND`（需补 `annotation-sync` tag）
- `src/renderer/src/components/workbench/WorkbenchTableCellResizerPlugin.tsx:214` — 列宽/行高调整（需补布局 tag 隔离）
- `src/renderer/src/store/workbenchStore.ts:1132` — `saveActiveFile`、`1247` `updateActiveContent`、`111` `normalizeMarkdownFrontmatter`
- `src/main/services/workbenchService.ts:1269` — 已有临时文件 + 原子 rename 写盘实现

## 验收标准

| 指标 | 定义 | 目标 |
| --- | --- | --- |
| No-op Fidelity | 打开 → 切富文本 → 点选/对齐/调整表宽/建标注/关闭，文件字节级不变 | 100% |
| Unchanged Block Fidelity | 编辑块 A 后（或拖拽重排块位置、Undo 回原状），未编辑块 B / C 源码字节级不变 | 100% |
| Edit Locality | 本次编辑产生的 diff 限制在目标块区间 | 块级 |
| Frontmatter / BOM / CRLF / EOF 换行 | 不被误改或丢失 | 100% |
| Pending AI Reply 安全 | 插入待确认回复预览态未点"采纳"前不自动落盘 | 100% |
| 外部冲突 | 编辑过程中磁盘被改 → 触发既有 conflict 流程 | 不丢数据 |

测试 fixture 应覆盖：`**` / `__` 强调、`<br/>` / `<table>` 等 HTML 混排、3 / 4 空格嵌套列表、GFM 表格、块级 `$$...$$` 公式、连续空行、BOM + Frontmatter、CRLF、Emoji / 中文 IME、文件末尾换行有无、拖拽块与 Undo/Redo。

## 实施路线

1. **P0 + P1 同步落地**：
   - 修复内部噪声 tag（标注创建、表宽拖拽、待确认 AI 插入、切文件清历史）、文件信封保真（BOM / Frontmatter / EOL / EOF）与懒计算语义基线守卫；
   - 落地 `markdownSourceMap.ts`（Lexical 同源块扫描 + Anchor-LCS 局部兜底 + 单块影子序列化与局部 MarkNode 剥离）及 250ms 防抖同步 + `flushMarkdownSync()` 全链路接入。
2. **P2 持续加固**：SHA-256 compare-and-swap 并发校验，扩展 `<details>` / `<!-- -->` / 脚注 / directive 原文透传。

**明确不做**：

- 不追求"被编辑块重新序列化后与原文表层语法一致"——AST 模型下做不到，业界也没做到。
- 不在序列化器上继续打零散的语法补丁（`**` / `<br/>` / 缩进），那是治标不治本。
- 不使用 Command 白名单拦截未知 `editor.update`（会误杀工具栏、表格菜单、异步插图和 IME 组合输入）。
- 不立即把 Lexical 换成 CodeMirror——拖拽块、表格操作、AI 插入这些富文本交互的重做成本太高，P0+P1 已能拿到绝大部分收益。
