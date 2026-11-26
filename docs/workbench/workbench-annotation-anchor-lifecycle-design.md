> Created: 2026-11-23 16:45 (Asia/Shanghai)

# 工作台注释锚点生命周期与未定位清理设计

本文是 [工作台统一笔记与标注设计](workbench-unified-notes-annotation-design.md) 的增量设计，处理注释锚点在正文变化后的生命周期、未定位状态的持久化与展示、HTML 预览接入和容量清理。标注的存储归属、会话原文标注和统一记录结构仍以主设计为准。

## 1. 问题

当前文档标注按“引文 + 前后文”定位，正常情况可以处理文字移动和前后文变化，但存在三个缺口：

1. 高亮范围内的文字被局部修改后，原 `exact` 不再存在；即使大部分文字还在，也不会重新关联。
2. 高亮文字被完全删除后，标注记录仍保留在旁路 JSON，但旁注栏把未定位记录从列表和数量中过滤掉，用户看不到也无法删除。
3. HTML 预览没有消费 iframe 上报的 `resolved/unlocated`，未定位标注会静默消失。

这些缺口共同导致“数据不会自动删除，但会不可见地累积”，最终可能撞到单篇 500 条、单文件 2MB 的硬上限。

## 2. 设计结论

采用“保留记录、显式未定位、有限模糊重定位、用户手动清理”的方案，不采用按时间自动删除。

具体规则：

1. 正文编辑后仍存在 MarkNode 时，优先使用 MarkNode 当前覆盖的文本范围，不重新搜索全文。
2. MarkNode 不存在但精确引文仍存在时，沿用现有精确匹配和上下文消歧。
3. 精确引文也不存在时，只对足够长的引文做有限模糊匹配；成功时状态为 `shifted`，失败时保留记录并标记 `unlocated`。
4. 多个候选分数接近时状态为 `ambiguous`，不自动选择，要求用户重新选定文本。
5. 只有用户显式删除注释或删除整篇文档时，才物理删除标注记录。
6. 未定位注释必须在旁注栏单独展示，不允许用“数量为 0”掩盖已经存在的数据。
7. 原文标注（`source`）不因文档编辑改写锚点；它在文档中的投影找不到时只影响投影状态，不影响原文页面上的高亮。
8. 本期不增加按天、按周运行的注释清理任务；只提供当前文档的未定位入口和手动批量删除。

这个方案的目标不是“让所有注释永不失效”，而是让失效状态可见、可恢复、可清理，避免在用户不知情的情况下丢评论或积累不可见数据。

### 2.1 实施顺序

为了控制风险，分两阶段落地：

- **阶段 A（先做）**：MarkNode 当前范围优先、完整对账、未定位状态持久化与展示、source/document 分区、HTML 未定位入口。这一阶段不使用模糊匹配。
- **阶段 B（按真实样本再做）**：在精确匹配和 MarkNode 都不存在时，引入有限模糊匹配。先收集真实失配样本，再调整阈值和候选策略。

先完成阶段 A 已经能解决“注释变孤儿且不可见”的主要问题；阶段 B 不是前者的前置条件。

## 3. 业界依据

| 方案 | 代表产品 | 优点 | 代价 | 是否采用 |
|---|---|---|---|---|
| 文本范围强绑定 | Word、Google Docs | 行为直观，正文删掉后评论也不会继续存在 | 删除原文会丢评论；撤销、恢复和历史版本场景不可靠 | 否 |
| 引文 + 上下文模糊锚定 | Hypothesis、W3C Web Annotation | 能处理局部修改、移动和重复文本；失效后仍可展示原始引文 | 需要相似度阈值和歧义处理 | 阶段 B |
| 未定位保留 | Hypothesis | 不静默丢用户内容；可以重新定位或手动删除 | 需要未定位列表和容量管理 | 是 |
| 按周期自动删除 | 企业保留策略 | 能控制存储规模 | 普通文档评论很少这样做；误删不可逆，难以解释 | 否 |
| CRDT 稳定字符 ID | Peritext 等协同编辑模型 | 协同编辑下最稳健 | 当前是本地单用户文档，引入成本过高 | 后续按需 |

W3C 推荐使用文本引文选择器，并明确位置选择器在文档变化时不稳定；Hypothesis 会把找不到原文的注释放入 `Unanchored`，保留原引文并允许用户处理。本设计采用相近模型：精确匹配优先，局部相似匹配兜底，失败后保留并显式展示。

## 4. 当前实现与差距

| 位置 | 当前行为 | 差距 |
|---|---|---|
| `src/shared/utils/annotationAnchors.ts` | 只查找 `exact` 的精确出现位置，`prefix/suffix/occurrence/offsetHint` 只用于精确候选打分 | 没有局部相似匹配；高亮内部改一个字就会失配 |
| `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx` | 应用标注前先 `unwrapAllMarks()`，再按锚点重新搜索 | 丢掉了 MarkNode 当前范围；用户在 MarkNode 内编辑后的最新位置没有被优先使用 |
| `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx` | 只在失焦时提交仍能解析的标注 | 删除、撤销后未定位列表不会及时更新；未解析状态没有持久化 |
| `src/main/services/annotationService.ts` | `reconcileDocumentAnnotations` 只更新传入的标注，缺失的保持原样 | 不会误删，但也不会记录未定位时间、版本或冲突 |
| `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx` | 把 `unlocatedIds` 从列表和数量中过滤掉，document 和 source 未区分 | 用户看不到未定位注释；批量清理可能误删原文标注 |
| `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx` | 只处理 `ready/capture-result/hit/dismiss` | 没有处理 `resolved/unlocated`，HTML 未定位标注不可见 |

## 5. 数据模型

### 5.1 `Annotation` 增量字段

在现有 `Annotation` 上增加可选字段，旧记录无需迁移：

```ts
type AnnotationAnchorState = 'anchored' | 'shifted' | 'ambiguous' | 'unlocated'
type AnnotationAnchorReason = 'not-found' | 'cross-block' | 'unsupported' | 'overlap'

interface Annotation {
  id: string
  scope: 'document' | 'source'
  quote: string
  anchor: AnnotationAnchor
  comment: string
  source?: AnnotationSource
  createdAt: number
  updatedAt: number

  /** 创建时的引文，只用于展示原始内容，不参与自动重定位。 */
  originalQuote?: string

  /** 仅 document 标注持久化；source 标注的投影状态由渲染层临时计算。 */
  anchorState?: AnnotationAnchorState
  anchorReason?: AnnotationAnchorReason

  /** 仅 document 标注使用；每次持久化解析状态或锚点变化时递增。 */
  anchorRevision?: number

  /** 首次进入未定位的时间；恢复为 anchored/shifted 时清除。 */
  orphanedAt?: number

  /** 最后一次新建/恢复锚点或真正改写锚点的时间；重复同状态解析不刷新。 */
  lastAnchoredAt?: number
}
```

字段规则：

- 新标注创建时把 `quote` 复制到 `originalQuote`。
- `quote/anchor` 仍表示“最后一次成功定位到的文本和锚点”，与现有主设计一致。
- `anchorRevision` 旧记录缺失时按 `1` 处理；新记录初始化为 `1`。
- `lastAnchoredAt` 只在 `anchored/shifted` 时更新；`ambiguous/unlocated` 不更新。
- `orphanedAt` 只在 `unlocated` 时设置；离开 `unlocated` 时清除。
- 评论正文编辑只更新 `comment/updatedAt`，不递增 `anchorRevision`；用户重新定位导致 `quote/anchor` 变化时递增。
- 旧记录缺少 `anchorState` 时视为“尚未解析”，首次打开并完成解析后才进入正常或未解决分组；升级时不能把所有旧记录批量标成 `unlocated`。
- `source` 标注不写 `anchorState/anchorRevision/orphanedAt/lastAnchoredAt`。它在文档中的投影是否定位成功，属于当前渲染状态，不应污染原文标注记录。
- 不保存 `originalAnchor`。当前锚点已经是最后一次成功位置，原始引文用于展示；需要恢复旧位置时由用户重新选择文本，不做隐式回退。

### 5.2 状态机

```text
创建
  -> anchored      MarkNode 当前范围、精确匹配或用户重新锚定
  -> shifted       模糊匹配成功
  -> ambiguous     多个候选接近，需要用户确认
  -> unlocated     找不到可信位置

shifted / ambiguous / unlocated
  -> anchored      用户重新选择文本，或文本恢复后精确匹配
```

- `anchored`：MarkNode 仍在、精确匹配成功，或用户手动重新锚定。
- `shifted`：模糊匹配成功，当前锚点已更新到新范围。
- `ambiguous`：存在多个可能位置，保留原记录，不自动更新锚点。
- `unlocated`：没有任何可信位置；记录保留，展示原始引文。
- 任何状态都不是删除条件；删除只由用户显式操作触发。

### 5.3 兼容性

- 所有新增字段可选，旧 JSON 可以继续读取。
- `normalizeAnnotation` 需要保留并校验新增字段；旧记录读入后补默认值，不要求一次性升级磁盘文件。
- 旧记录没有 `originalQuote` 时，UI 回退显示当前 `quote`；不强制回写磁盘。
- 旧记录没有 `anchorState` 时保持 `undefined`，由首次解析结果决定；不能在读盘阶段假定为 `anchored` 或 `unlocated`。
- `originalQuote` 也计入文本长度限制，避免绕过 20KB 的字段上限。

## 6. 锚点解析算法

### 6.1 创建锚点时使用全文坐标

当前创建标注时使用单个 block 的文本计算 `occurrence` 和 `offsetHint`。两段完全相同的文字会得到相同的局部序号，后续在全文解析时容易绑定错位置。

新规则：

1. 选区映射到全文可见文本，用全文偏移计算 `offsetHint`。
2. `occurrence` 按全文文本中该引文在此之前出现的次数计算。
3. 同时把该选区所属 block 的全文起止范围传给解析器。
4. 解析候选不得跨 block 进入评分；跨 block 结果标记为 `cross-block`。

`buildAnchorAt` 继续作为纯函数使用，但调用方传入全文和选区映射，不再传单个 block 的局部文本。

`anchor.exact`、`occurrence` 和 `offsetHint` 统一使用压缩可见文本的坐标系；`quote` 仍保留原始文本用于展示。压缩只忽略空白和零宽字符，不改变正文内容。这样引文含空格、换行或零宽字符时，创建和解析不会使用两套序号。

`buildAnchorAt` 内部先构建压缩文本和压缩偏移表，再计算 `exact/occurrence/offsetHint`；创建时不要把原始 `quote` 直接写成 `anchor.exact`。旧记录如果 `anchor.exact` 含空白，解析时先压缩再匹配，不强制回写磁盘。

### 6.2 优先级一：MarkNode 当前范围

应用标注前先收集当前 MarkNode 的文本范围，不要先全部 `unwrapAllMarks()`：

1. 按 block 遍历 TextNode，记录每个 MarkNode id 在 block 内的起止位置。
2. 同一 block 内只合并首尾相接的连续片段；片段之间只要有未标注文字，就视为分离副本，不能从第一段跨到第二段。
3. 同一 id 出现在多个 block 时，先按 block 分组，再判断每一组是否能独立还原完整标注：
   - 阶段 A 先按“某一组文本与当前 `quote` 精确相同”判断完整副本；阶段 B 才允许用相似度门槛判断。完整副本按文档顺序保留第一组，其余组剥离。
   - 没有任何一组能独立还原完整标注，且各组文本合起来才接近当前 `quote`：这是段落拆分产生的跨 block 标注，不跨 gap 合并，状态记为 `unlocated`、`anchorReason: 'cross-block'`，同时解包所有 MarkNode，避免只显示半截。
   - 一组完整、另一组只有残缺片段：保留完整组，剥离残缺组，避免把副本残留当成第二段锚点。
4. 如果保留下来的 range 仍在单个 block 内且文本非空：
   - 直接用当前 range 生成新的 `quote/anchor`；
   - 状态为 `anchored`；
   - 这是用户直接编辑高亮文字后的最可靠信息来源。
5. 如果 MarkNode 已被完全删除，进入后续精确/模糊解析；已经判定为段落拆分导致的跨 block，不再用全文搜索伪造单 block 锚点，直接保持 `cross-block`。

这一条优先于全文搜索。用户在高亮内部插入、删除或替换文字时，Lexical 仍保留 MarkNode 的情况很常见，不需要依赖相似度算法猜位置。

投影流程固定为：收集旧 MarkNode range → 计算解析结果 → `unwrapAllMarks()` → 按结果重新包 MarkNode。不能先全部解包再反查旧位置。

在标注末尾按回车、复制粘贴标注文字或跨 block 复制，都会产生分离的同 id 片段。分离片段只能剥离副本，不能扩大原标注范围；否则会把中间未标注文字写进 `quote/anchor`，造成锚点数据损坏。段落拆分与复制副本用“单个 block 能否独立还原完整 quote”区分，不能只按“跨 block”一刀切。

### 6.3 优先级二：精确匹配

1. 在压缩文本中查找压缩后的 `anchor.exact` 全部出现位置。
2. 用 `prefix/suffix` 的匹配长度打分，用 `occurrence` 和 `offsetHint` 做次级排序。
3. 只有一个明显最优候选时，返回 `anchored`。
4. 多个候选分数相同或差距过小，返回 `ambiguous`，不强行选第一个。

精确匹配仍是主路径。短引文（压缩后少于 8 个字符）只做精确匹配，不进入模糊匹配。

### 6.4 优先级三：有限模糊匹配（阶段 B）

精确匹配失败后，才进入局部相似匹配。限制条件：

- 引文长度在 16–2000 个字符之间；更长引文只做精确匹配。
- 只处理没有 MarkNode 的 document 标注。
- 只在编辑器空闲、失焦、保存或切换文档时执行，不在每次击键时执行。

候选生成：

1. 从引文中取 5 个种子位置：开头、1/4、1/2、3/4、结尾；每个种子最多 24 个字符，去重。
2. 在当前文本中查找这些种子的出现位置；每个种子最多保留 8 个出现位置。
3. 对每个出现位置，按原引文长度的 0.5、0.75、1.0、1.25、1.5 倍生成候选范围。
4. 候选范围必须落在单个 block 内；跨 block 直接排除。
5. 去重并按与 `offsetHint` 的距离、上下文相似度预排序，最多保留 16 个候选。

候选评分：

1. 对压缩文本生成 3-gram 集合。
2. 计算：
   - `retention = |Q ∩ C| / |Q|`：原引文有多少内容仍保留；
   - `purity = |Q ∩ C| / |C|`：候选范围有多少内容来自原引文；
   - `context`：候选前后文与 `prefix/suffix` 的相似度，归一化到 0–1；
   - `position`：候选位置与 `offsetHint` 的距离，归一化到 0–1。
3. 总分 `score = 0.50 * purity + 0.30 * context + 0.20 * position`。
4. 接受条件：
   - `retention >= 0.50`；
   - `purity >= 0.80`；
   - `score >= 0.70`；
   - 最优候选与第二候选的 `score` 差至少 `0.08`。
5. 引文长度为 16–31 个字符时，提高门槛：`retention >= 0.70`、`purity >= 0.90`。
6. 多个候选同时满足且分差不足，返回 `ambiguous`；没有候选满足，返回 `unlocated`。
7. 模糊匹配成功一律返回 `shifted`，不返回 `anchored`。`anchored` 只表示 MarkNode、精确匹配或用户重新锚定。

阈值放在 `annotationAnchors.ts` 的常量中，按真实文档样本回归调整。不要用“只要能找到一点相同文字就绑定”的宽松策略。

### 6.5 文档结构约束

当前文档标注只支持单个 block 内的 MarkNode。解析结果落在多个 block、代码块、图片或 HTML 表格时：

- 不自动截取其中一段冒充完整标注；
- 返回 `unlocated`，`anchorReason` 记为 `cross-block` 或 `unsupported`；
- 旁注栏显示“跨段落，暂不支持定位”，保留评论和原始引文。

跨段落的 RangeSelector 支持是独立能力，不纳入本期。

如果锚点能定位，但目标范围已被另一条 document 标注或 source 投影占用，后处理的一条不能静默跳过：标记为 `unlocated`，`anchorReason: 'overlap'`，卡片保留在“未解决”分组，文案说明“与另一条注释重叠，暂不在正文显示”。这保证主设计“重叠时跳过投影但侧栏保留两条”有明确的状态出口。

### 6.6 更新规则

- `anchored`：更新 `quote/anchor`、`lastAnchoredAt`，清除 `orphanedAt`。
- `shifted`：使用新范围更新 `quote/anchor`，保留 `originalQuote`；清除 `orphanedAt`。
- `ambiguous`：只更新 `anchorState`，不修改 `quote/anchor`，不更新 `lastAnchoredAt`。
- `unlocated`：不修改 `quote/anchor`，首次进入时设置 `orphanedAt`，之后保留首次时间。
- 用户手动重新定位：用当前选区生成新的 `quote/anchor`，状态改为 `anchored`，清除 `orphanedAt`。

## 7. 对账、并发与 IPC

### 7.1 对账载荷

扩展现有 `annotations:reconcile-document`，让渲染层提交全部 document 标注的解析结果：

```ts
interface DocumentResolution {
  id: string
  state: AnnotationAnchorState
  reason?: AnnotationAnchorReason
  quote?: string
  anchor?: AnnotationAnchor
  baseAnchorRevision: number
}

annotations.reconcileDocument(
  workspaceRoot,
  relativePath,
  resolutions: DocumentResolution[]
) -> {
  success: boolean
  data?: {
    applied: string[]
    stale: string[]
    skipped: string[]
    annotations: Annotation[]
  }
  error?: string
}
```

主进程规则：

- 只更新载荷中出现的 `id`，不删除未出现的记录。
- `baseAnchorRevision` 必须等于当前记录 `anchorRevision`；不相等时返回 `stale`，不覆盖。
- `anchored` 可以不带 `quote/anchor`，表示只恢复状态、不清除已有锚点；带 `quote/anchor` 时按新值更新。
- `shifted` 必须带 `quote/anchor`；缺失时返回 `stale` 或忽略该条，不写半套状态。
- `ambiguous/unlocated` 可以不带 `quote/anchor`。
- 只有 `quote/anchor/state/reason/orphanedAt/lastAnchoredAt` 真正变化时才写盘；无变化记录进入 `skipped`。
- 同状态、同 `quote/anchor` 的重复 resolution 必须视为 no-op；`lastAnchoredAt` 只在从非 anchored 恢复、重新锚定或 `quote/anchor` 真正变化时更新，不能仅因“又解析了一次”就刷新。
- 一次对账只做一次原子写；只有在 `applied.length > 0` 时广播 `annotations:changed`，避免广播循环。
- 实际写入时递增 `anchorRevision`，并更新 `updatedAt`；状态变化也递增，避免旧状态覆盖新状态。

同时更新 `src/preload/index.ts` 的 `API` 类型、`src/preload/index.d.ts` 和 `src/renderer/src/env.d.ts`，保持 IPC 契约端到端一致。

### 7.1.1 新增、评论编辑和重新定位必须分开

现有 `upsertDocument` 按 `updatedAt` 整条替换记录，评论保存会把旧窗口里的 `anchorState/anchorRevision/orphanedAt` 一起写回，绕过 `baseAnchorRevision`。因此拆成三个语义：

```ts
annotations.createDocument({ workspaceRoot, relativePath, annotation })
annotations.updateDocumentComment({ workspaceRoot, relativePath, id, comment, baseUpdatedAt })
annotations.reanchorDocument({ workspaceRoot, relativePath, id, quote, anchor, baseAnchorRevision })
```

- `createDocument` 只用于新建；同一 id 已存在时返回冲突，不覆盖。
- `updateDocumentComment` 只 patch `comment/updatedAt`，不得写 `quote/anchor/anchorState/anchorRevision/orphanedAt/lastAnchoredAt`。
- `reanchorDocument` 必须校验 `baseAnchorRevision`；只有匹配时才更新 `quote/anchor`、状态和修订号。
- `upsertDocument` 仅保留给迁移、导入和兼容旧调用；对已存在记录必须走上面两个 patch，不能整条覆盖锚点字段。
- `upsertSource` 的评论编辑同样只 patch comment，不允许借评论保存改写 source anchor。

评论编辑使用 `baseUpdatedAt` 做轻量冲突检查；如果记录已被其他窗口更新，返回 `stale`，由 UI 重新读取后再保存。

### 7.2 对账时机

- 创建、编辑、删除注释后。
- 编辑器失焦。
- 编辑停止 600ms 后（用于删除、撤销、重做后尽快更新未定位列表）。
- 切换文档、关闭工作区、托盘退出、保存正文前。
- 手动点击“刷新标注”。

编辑停止后的解析会更新本地解析状态，并把新的 `quote/anchor` 回灌到本地标注列表，让正文投影按当前结果重绘（撤销恢复文字但未恢复 MarkNode 时，高亮需要靠这一步重现）。回灌只改本地状态，不写盘；真正写盘仍走失焦、保存或显式刷新，避免每次击键都写 JSON。source 标注只更新投影状态，不回灌锚点。

所有仅用于标注投影的 `editor.update` 必须同时带 `annotation-sync`、`HISTORIC_TAG` 和 `SKIP_SELECTION_FOCUS_TAG`。`HistoryPlugin` 只跳过 `HISTORIC_TAG`，缺少它会把 600ms 重新投影写进撤销栈，用户按一次 Ctrl+Z 可能先撤销投影而不是撤销正文删除。

`WorkbenchAnnotationPlugin` 在挂载时把 flusher 注册到 `workbenchStore`，由 store 暴露可等待的 `flushDocumentAnnotations(): Promise<{ saved: boolean; error?: string }>`：

1. 在当前 Lexical 状态上完成一次解析。
2. 如正文 dirty，先 `await saveActiveFile()`。
3. 再用当前 `baseAnchorRevision` 提交 `reconcileDocument`。
4. 返回 `saved: false` 时阻止切换/退出，或提示用户保存失败。

调用点：

- `openFile` 切换文件前；
- 关闭工作区前；
- 托盘退出和真正退出应用的 quit guard 中；
- 主窗口关闭到托盘前；
- 切换产品模式或离开工作台前。

主窗口关闭到托盘不会触发 `app:quit-requested`；当前主进程会直接 `preventDefault()` 后隐藏窗口。需要新增一条关闭握手：

1. 主进程 `close` 事件先 `preventDefault()`，向渲染层发送 `app:window-close-requested`。
2. 渲染层处理函数 `await flushDocumentAnnotations()`，保存成功后再回复允许隐藏；失败则保持窗口可见并提示原因。
3. 主进程收到允许后才隐藏窗口；5 秒内没有回复时保持窗口打开并记录错误，不能静默丢弃最后一次对账。
4. 真正退出应用时，quit guard 同时等待正文保存、标注 flush 和现有 HTML 编辑守卫。

这条握手需要同时修改 `src/main/webviewManager.ts`、`src/preload/index.ts` 和 `src/renderer/src/App.tsx`。不能把 `beforeunload` 里的异步 IPC 当作唯一保证。

### 7.3 并发与失败

- 两个窗口同时编辑同一文档时，`baseAnchorRevision` 保护较新的锚点。
- 收到 `stale` 的窗口重新读取当前文档标注，再按新版本解析；不把旧结果写回。
- IPC 失败时保留本地 UI 状态，但标记同步失败；下次打开或刷新时以磁盘为准，不假装已经持久化。
- `source` 标注不参与 document 对账，不因文档编辑改写原文锚点。

## 8. 渲染层与 UI

### 8.1 Store

`annotationStore` 增加按 id 的解析状态：

```ts
interface AnnotationResolution {
  state: AnnotationAnchorState
  reason?: AnnotationAnchorReason
}

resolutionById: Record<string, AnnotationResolution>
```

- `document` 标注使用主进程持久化状态。
- `source` 标注使用本次渲染的临时状态；不写回 `sources` JSON。
- 原有 `unlocatedIds` 可以保留为派生视图，但 UI 不应只依赖 id 集合来判断原因。
- `ambiguous` 和 `unlocated` 都属于“未解决”状态，必须进入可见分组；不能只把 `unlocatedIds` 当作唯一过滤依据。
- `removeLocal` 和重新加载文档时同步清理 `resolutionById`，避免已删除标注继续出现在未定位统计中。

### 8.2 旁注栏

`WorkbenchMarginNotes` 分成三组：

- 正常注释：已定位的 document 标注 + 已定位的 source 投影；按正文 MarkNode 位置排序和定位。
- 未解决文档注释：`ambiguous/unlocated` 的 document 标注，放在“未解决 N 条”折叠区，不参与正文位置计算。
- 未解决原文投影：找不到或存在歧义的 source 投影，单独展示，文案明确“文档投影未找到，原文高亮仍有效”。

未解决卡片展示：

- 原始引文 `originalQuote`，使用较弱颜色或删除线；
- 评论正文；
- 状态说明：`原文未找到`、`跨段落暂不支持`、`存在多处相似文字`、`与另一条注释重叠`；
- document 标注操作：`重新定位`、`删除`；
- source 投影操作：`打开原文`、`刷新投影`、`删除原文标注`。

source 的锚点在原文页面，不能用文档选区直接重定位。它的“删除原文标注”必须单独调用 `deleteSource`，即使是单条卡片也要二次确认“会删除所有工作区里的原文高亮”。

标题数量示例：`注释 5 · 未解决 2`。分组过滤和计数使用 `resolutionById.state`，不能只看 `unlocatedIds`。未解决区不能因为没有正文 MarkNode 就隐藏。

### 8.3 document 重新定位

1. 用户点击 document 未解决卡片的“重新定位”。
2. 编辑器进入一次性选区状态，用户选择单个 block 内的文本。
3. 用当前选区生成新的 `quote/anchor`，调用 `reanchorDocument` 并带上原 `baseAnchorRevision`。
4. 状态改为 `anchored`，清除 `orphanedAt`，正文重新绘制 MarkNode。

跨 block、空选区或重叠选区时只提示，不写状态。

### 8.4 歧义状态

本期不自动选择候选。`ambiguous` 与 `unlocated` 一样进入“未解决”分组，计入数量。卡片显示“找到多处相似文字，请重新选择”，操作与未定位一致。后续如果需要，再增加候选列表和逐项跳转，不把候选选择塞进 v1。

### 8.5 批量清理

未解决区提供“清理未解决”入口，但必须按 scope 分开：

- 默认只勾选当前文档的 `document` 未解决注释，包含 `unlocated` 和 `ambiguous`；
- `source` 投影不默认勾选，不能调用 `deleteDocument`；
- source 删除必须走独立的 `deleteSource`，并提示“会删除所有工作区里的原文高亮”；
- 展示条数和原引文摘要；
- 用户确认后批量删除；
- 删除失败时保留条目并显示错误。

可以先逐条复用现有 `deleteDocument`；如果实测超过 20 条时写盘明显卡顿，再增加一次写入的批量 IPC。批量 IPC 不是第一阶段的前置条件。

## 9. HTML 预览接入

`WorkbenchHtmlAnnotationPreview` 已经能收到 iframe 运行时发出的：

```ts
{ type: 'resolved', matched: number, unlocated: string[] }
```

阶段 A 的 HTML 行为：

1. 收到 `resolved` 后更新本地 `unlocatedIds` 和 `resolutionById`，并计算一个解析指纹：`id + state + quote + anchor`。
2. 只对指纹发生变化的标注调用 `reconcileDocument`；未定位 id 写 `unlocated`，其余写 `anchored` 并沿用当前 `quote/anchor`。指纹完全相同则不写盘、不广播。
3. 收到自己触发的 `annotations:changed` 后重新读取可以，但重新 `sync` 得到相同指纹时不能再次提交对账，避免 `resolved -> write -> broadcast -> reload -> resolved` 循环。
4. 在预览区显示 `未定位 N 条` 入口，不能只让高亮消失。
5. 入口打开后展示未定位标注的引文、评论和删除操作。
6. 用户删除后调用现有 `deleteDocument`，并同步 iframe 的标注集合。
7. HTML 可视化编辑保存后，预览重新加载并重新发送标注；未定位数量随新正文重新计算。

HTML 的锚点仍以文本引文为主，不使用 CSS 选择器或 XPath 作为唯一绑定依据。iframe 继续使用 `sandbox="allow-scripts"`，宿主与 iframe 只通过带来源标识的 `postMessage` 通信。

HTML 重新定位：

1. 用户明确点击某条未解决标注的“重新定位”后，宿主记录 `pendingRelocateId = { id, startedAt }`；普通新建标注不能设置它。
2. 用户点击“重新定位”后在 iframe 内重新选中文字。
3. `capture-result` 到达时，如果存在 `pendingRelocateId`，复用旧 id 更新原标注，而不是创建随机 UUID。
4. 成功后保留原 `comment` 和 `originalQuote`，更新 `quote/anchor`，状态改为 `anchored`。
5. 失败或取消时保留原未解决状态。
6. 以下任一事件必须清空 `pendingRelocateId`：`capture-result`、`capture-error`、`dismiss`、10 秒超时、切换文件、预览重新加载、组件卸载、用户再次发起普通标注。
7. `pendingRelocateId` 未清空时禁止把新的 `capture-result` 当作普通新建；如果旧 id 已不存在，提示“原注释已删除”并清除 pending，不创建新注释。

HTML 阶段 A 只做精确匹配，不承诺与 Lexical 共用模糊算法。如果后续需要在 HTML 内支持局部修改后的模糊重定位，再单独评估运行时算法和双实现维护成本。

重复文本的严格歧义治理优先在文档侧完成。HTML 阶段 A 仍沿用运行时现有的“精确候选打分选最优”策略；如果运行时无法判断唯一位置，后续应让它返回 `ambiguous` id 列表，而不是让宿主猜测。该能力不阻塞阶段 A 的未定位可见性。

## 10. 容量与清理策略

### 10.1 本期策略

- 不按时间自动删除任何注释。
- 不对未定位记录做后台扫描或批量清理。
- 只提供当前文档的显式清理入口。
- 文档删除、注释删除仍按用户显式操作立即生效。

理由：

1. 未定位不等于用户不再需要；可能是临时删改、撤销、版本切换或外部编辑器保存。
2. 主进程无法可靠判断“正文是否真的删除了这段”，需要复制渲染层的文本抽取和 block 语义。
3. 自动删除会破坏撤销、文档恢复和历史批注的价值。

### 10.2 上限与提示

- 保留单篇 500 条、单文件 2MB 的硬上限。
- 旁注栏按当前文档的 `annotations.length` 展示总数；达到 400 条（500 的 80%）时提示清理未解决注释，source 不计入该文档计数。
- 2MB 本身不在渲染层估算，写入失败时返回明确错误，提示清理或拆分。
- 超限错误包含当前总数和未解决数量，例如：
  `单篇文档最多 500 条标注；当前 500 条，其中 120 条未解决，请清理后重试`
- 不对已达上限的文档自动删除最旧记录。

### 10.3 source 的容量边界

`source` 旁路同样受 500 条/2MB 限制，但本期不提供全局 source 清理和归档。原文标注的删除仍走原文侧栏或评论卡，并明确影响所有工作区。source 的容量治理是后续独立设计。

### 10.4 后续可选保留期

如果真实使用中出现大量长期未定位记录，再单独设计“归档 + 保留期”，并且只处理 `document`、`unlocated`、`orphanedAt` 超过设定时间的记录。归档必须可恢复，不能直接硬删除。本期不实现时间阈值、归档目录或自动清理任务。

## 11. 文件生命周期

- 文档重命名、移动：沿用 `rekeyDocumentAnnotations` 和内容哈希找回，新增字段随文件一起迁移。
- 通过应用删除单个文件：按现有行为删除对应 `documents` 旁路；这是用户显式操作，删除确认框已经说明影响。
- 通过应用删除文件夹：当前批量删除只清理传入的目录路径本身，子文档旁路保留一个版本，便于从回收站恢复文档后找回。确认框需要明确这一行为；本期不新增全库旁路清理。
- 外部删除文档：旁路文件保留，文档恢复后可以重新关联；如果永远不恢复，旁路会作为孤儿文件保留，本期不做全库自动清理。
- 默认工作区的 `sources` 旁路不受文档删除影响；原文标注仍然可用。

## 12. 实施步骤

### 阶段 A：未定位闭环

1. **MarkNode 当前范围优先**
   - 在 `WorkbenchAnnotationPlugin` 应用标注前收集 MarkNode range，只合并连续片段，优先使用当前范围。
   - 对齐创建锚点时的全文坐标、`occurrence` 和 block 边界。
   - 增加编辑停止 600ms 后的本地重新解析，覆盖删除、撤销、重做。
   - 所有投影更新附加 `HISTORIC_TAG`，避免进入撤销栈。
2. **状态持久化**
   - 扩展 `src/shared/types/annotations.ts`、`normalizeAnnotation` 和 `reconcileDocumentAnnotations`。
   - 增加 `anchorRevision`、`baseAnchorRevision`、`applied/stale/skipped` 返回。
   - 拆分 `createDocument/updateDocumentComment/reanchorDocument`，禁止评论保存整条覆盖锚点。
   - 更新 IPC 类型与 preload 契约。
3. **未定位 UI**
   - `annotationStore` 增加 `resolutionById`。
   - `WorkbenchMarginNotes` 增加正常注释、未解决 document、未解决 source 三组，重新定位和批量清理。
4. **HTML 未定位**
   - 消费 `resolved`，写回状态，显示未定位入口；重新定位复用 `pendingRelocateId` 并定义所有清理出口。
5. **落盘时序**
   - 增加 `flushDocumentAnnotations`，接入文件切换、关闭工作区、托盘退出和窗口关闭。
6. **验证**
   - 覆盖第 13 节阶段 A 场景，执行类型检查、lint、build 和开发态手动验证。

### 阶段 B：有限模糊匹配

1. 在 `annotationAnchors.ts` 增加种子、候选、3-gram、retention/purity、阈值和歧义判定。
2. 只在 MarkNode 和精确匹配都失败时调用；先收集真实失配样本，再调整阈值。
3. 补充阶段 B 的验收场景；HTML 是否同步实现模糊匹配另行评估。
4. 如果未定位批量清理出现性能问题，再增加一次写入的批量删除 IPC。

## 13. 验收标准

### 13.1 阶段 A

- 在高亮范围内编辑文字且 MarkNode 仍在：注释继续跟随当前范围，状态为 `anchored`。
- 删除高亮内容的一半且 MarkNode 仍在：注释跟随剩余范围，不进入未定位。
- 在标注末尾按回车产生两个分离的同 id MarkNode：只保留第一个片段，不把中间未标注文字并入 `quote/anchor`。
- 复制粘贴标注文字产生同 id 副本：剥离副本，不扩大原标注范围；正文和评论保持一致。
- 在高亮内部拆分段落：没有单个 block 能独立还原完整 quote 时标记 `cross-block`，不截取半段冒充锚点；跨 block 复制整条标注时，单个 block 能独立还原完整 quote，则保留第一份、剥离副本。
- 完全删除高亮内容：进入未定位，旁注栏显示原始引文和评论，JSON 中仍有记录。
- 撤销上述删除：MarkNode 随正文一起恢复时直接重新定位；只恢复文字、未恢复 MarkNode 时，600ms 本地解析也要把注释重新投影并让未定位数量归零。
- 删除高亮文字后按一次 Ctrl+Z：正文和标注一起恢复，不出现“先撤销标注投影”的额外撤销步。
- 删除后 600ms 内未定位列表更新，无需等待失焦。
- 把高亮文字移动到其他段落：精确匹配成功时跟随新位置；失败时保留记录。
- 产生重复文本时：精确候选接近时显示歧义状态，不静默绑定错误位置。
- 段落拆分或合并导致跨 block：保留记录并显示“跨段落暂不支持”，不截取部分文字冒充完整锚点。
- 只修改加粗、链接或 Markdown 语法：注释位置不变。
- 两个窗口同时失焦对账：较旧版本返回 `stale`，不覆盖新锚点；窗口重新读取后再解析。
- 窗口 A 持有旧状态时保存评论：只 patch comment，不覆盖窗口 B 已写入的 `anchorState/anchorRevision/orphanedAt`。
- 对账 IPC 失败：本地状态标记同步失败，不假装持久化；重新打开后以磁盘为准。
- 在高亮文字所在的重复段落中创建第二条相同引文：使用全文 `occurrence/offsetHint` 区分，不绑定到第一条。
- 引文含空白或零宽字符时：创建和解析使用同一套压缩坐标，重复文本序号一致。
- 旧记录缺少 `anchorState`：升级后首次解析前不批量进入未解决分组；解析后再按结果分组。
- 编辑后立即关闭再重开：正文保存完成后再对账；未保存时不写半套锚点。
- 切换文件、关闭工作区、托盘退出：等待 `flushDocumentAnnotations` 完成；保存失败时阻止离开或明确提示。
- 点击窗口关闭按钮隐藏到托盘：同样等待 flush；5 秒无响应时窗口保持可见，不静默丢最后一次对账。

### 13.2 source 与批量清理

- `source` 标注的锚点不因文档编辑改变，原文页面高亮仍有效。
- `source` 投影未定位时显示在独立分组，文案说明“原文高亮仍有效”。
- 已定位的 source 投影出现在正常注释列表，与 document 标注使用同一套位置排序。
- source 未解决卡片不提供文档“重新定位”；只能打开原文、刷新投影或确认后删除原文标注。
- source 与 document 标注重叠时，后处理的一条进入“未解决/重叠”分组，侧栏仍保留两条卡片，原文高亮不受影响。
- `ambiguous` document 标注进入“未解决”分组并计数，不因没有 MarkNode 而隐藏。
- 批量清理默认只勾选 document 标注；source 不默认勾选，删除必须走 `deleteSource` 并二次确认。
- 批量删除失败时保留未成功条目。

### 13.3 HTML

- HTML 预览显示未定位数量，不再静默隐藏。
- HTML 未定位状态写回 `document` 标注；重开预览后状态仍可见。
- HTML 重新定位复用旧 id，不新建随机标注；取消或失败时保留原未定位状态。
- HTML `pendingRelocateId` 在 `dismiss`、`capture-error`、超时、切换文件、预览重载和组件卸载后清空；下一次普通标注不会误复用旧 id。
- HTML 可视化编辑保存后，未定位数量随新正文重新计算。
- HTML 空闲预览或重复收到相同 `resolved` 时不产生写盘和广播循环；状态与锚点相同的 resolution 进入 `skipped`。
- 不支持 CSS Highlight 时，所有标注进入未定位入口，不静默消失。

### 13.4 容量与文件生命周期

- 当前文档达到 400 条时有清理提示；超限错误包含未解决数量。
- 2MB 写入失败时返回明确错误，不产生半写文件。
- 新增 `originalQuote` 使序列化超过 2MB 时，写入失败并保留旧文件，不产生半写文件。
- 文档重命名、移动后注释和新增字段完整保留。
- 删除单个文件时旁路按显式删除逻辑清理；删除文件夹时保留子文档旁路一个版本，并在确认框说明。
- 外部删除文档时旁路保留；本期没有按时间自动删除注释的后台任务。

### 13.5 工程验证

- `npx tsc --noEmit -p tsconfig.node.json --composite false --incremental false`
- `npx tsc --noEmit -p tsconfig.web.json --composite false --incremental false`
- `npm run lint`
- `npm run build`
- `npm run dev` 中逐项触发上述场景。

## 14. 风险与边界

| 风险 | 处理 |
|---|---|
| 模糊匹配把注释绑定到错误位置 | 阶段 B 才引入；阈值 + retention/purity + 分差；低置信度进入歧义或未定位；原始引文永久保留 |
| 短引文歧义大 | 少于 8 个字符只做精确匹配；16–31 个字符提高模糊门槛 |
| 两个窗口覆盖锚点 | `baseAnchorRevision` + `stale` 返回；旧结果不写回 |
| 评论保存覆盖新锚点 | `updateDocumentComment` 只 patch comment；重新定位走 `reanchorDocument` |
| 全量对账造成写放大 | 只写真实变化；一次原子写；无变化不广播 |
| 标注投影进入撤销栈 | 投影更新附加 `HISTORIC_TAG`；验收一次 Ctrl+Z 恢复正文和标注 |
| 切换/退出丢最后一次对账 | `flushDocumentAnnotations` 接入切换、关闭和 quit guard |
| 关闭到托盘绕过 flush | 主进程 close 握手 + renderer 保存后回复；超时保持窗口可见 |
| HTML resolved 反复写盘 | 解析指纹去重；同状态同锚点 no-op，不刷新 `lastAnchoredAt` |
| source 与 document 投影重叠导致卡片消失 | 后处理条目进入 `overlap` 未解决分组，侧栏保留两条 |
| 500 条上限被未定位记录占满 | 显示未定位数量，提供手动清理；不自动淘汰 |
| source 被误删 | document/source 分组；批量清理默认只选 document；source 独立删除确认 |
| 主进程解析正文导致分层破坏 | 主进程只存渲染层提交的解析结果，不复制文本抽取逻辑 |
| HTML 与 Lexical 可见文本不一致 | HTML 由 iframe 运行时解析，阶段 A 只做精确匹配；共用锚点结构和状态语义 |
| 自动清理误删重要批注 | 本期不做时间清理；后续只做可恢复的归档 |
| 跨段落标注无法投影 | 本期明确标记 `cross-block`，不假装成功；多段 RangeSelector 后续独立设计 |

## 15. 涉及文件

| 层 | 文件 | 改动 |
|---|---|---|
| shared | `src/shared/types/annotations.ts` | 增加状态、原始引文、修订号、未定位时间字段 |
| shared | `src/shared/utils/annotationAnchors.ts` | MarkNode 外的精确/模糊解析、歧义判定、状态与原因 |
| main | `src/main/services/annotationService.ts` | 持久化解析结果、修订保护、兼容旧记录、错误信息 |
| main | `src/main/ipcHandlers.ts` | 扩展 `annotations:reconcile-document` 载荷与返回 |
| main | `src/main/webviewManager.ts` | 主窗口关闭到托盘前的 flush 握手 |
| preload | `src/preload/index.ts`、`src/preload/index.d.ts` | 同步 IPC 契约 |
| renderer | `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx` | MarkNode 优先、提交全部解析结果、编辑后防抖解析 |
| renderer | `src/renderer/src/components/workbench/workbenchAnnotationUtils.ts` | 投影更新和删除标记附加 `HISTORIC_TAG`，避免进入撤销栈 |
| renderer | `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx` | 未解决分组、重新定位、分区批量清理 |
| renderer | `src/renderer/src/store/annotationStore.ts` | 保存解析状态和未解决列表 |
| renderer | `src/renderer/src/store/workbenchStore.ts` | 注册并暴露 `flushDocumentAnnotations`，切换文件前等待 |
| renderer | `src/renderer/src/App.tsx` | 托盘退出和窗口关闭 guard 等待标注 flush |
| renderer | `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx` | 消费 `resolved`，按指纹去重，未定位入口与重新定位 |

不修改标注文件的目录结构，不新增依赖，不改变 `source` 标注的存储归属。

## 16. 与主设计的关系

本文覆盖主设计中以下细节：

- 7.6 对账时机与 MarkNode 当前范围处理；
- 10.2 `reconcileDocument` 的载荷、返回和版本保护；
- 10.2 中 `upsertDocument` 的评论编辑/重新定位语义，拆为独立 patch；
- 11 中“多个精确位置选最高分并标可能位置”的策略，改为 `ambiguous` 且不自动选择；
- 未定位列表的 UI 行为、投影撤销栈和可等待 flush。

主设计的存储根、scope 语义、会话原文回显、迁移和删除策略保持不变。
