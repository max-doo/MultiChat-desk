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
type AnnotationAnchorReason = 'not-found' | 'cross-block' | 'unsupported'

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

  /** 仅 document 标注使用；每次真正改写锚点时递增。 */
  anchorRevision?: number

  /** 首次进入未定位的时间；恢复为 anchored/shifted 时清除。 */
  orphanedAt?: number

  /** 最后一次成功定位或模糊重定位的时间。 */
  lastAnchoredAt?: number
}
```

字段规则：

- 新标注创建时把 `quote` 复制到 `originalQuote`。
- `quote/anchor` 仍表示“最后一次成功定位到的文本和锚点”，与现有主设计一致。
- `anchorRevision` 旧记录缺失时按 `1` 处理；新记录初始化为 `1`。
- `lastAnchoredAt` 只在 `anchored/shifted` 时更新；`ambiguous/unlocated` 不更新。
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

### 6.2 优先级一：MarkNode 当前范围

应用标注前先收集当前 MarkNode 的文本范围，不要先全部 `unwrapAllMarks()`：

1. 按 block 遍历 TextNode，记录每个 MarkNode id 在 block 内的起止位置。
2. 同一 id 的多个 MarkNode 片段合并为一个 range。
3. 如果该 range 仍在单个 block 内且文本非空：
   - 直接用当前 range 生成新的 `quote/anchor`；
   - 状态为 `anchored`；
   - 这是用户直接编辑高亮文字后的最可靠信息来源。
4. 如果 MarkNode 已被完全删除或跨 block，进入后续精确/模糊解析。

这一条优先于全文搜索。用户在高亮内部插入、删除或替换文字时，Lexical 仍保留 MarkNode 的情况很常见，不需要依赖相似度算法猜位置。

### 6.3 优先级二：精确匹配

1. 在压缩文本中查找 `anchor.exact` 的全部出现位置。
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
- 一次对账只做一次原子写；只有在 `applied.length > 0` 时广播 `annotations:changed`，避免广播循环。
- 实际写入时递增 `anchorRevision`，并更新 `updatedAt`。

同时更新 `src/preload/index.ts` 的 `API` 类型、`src/preload/index.d.ts` 和 `src/renderer/src/env.d.ts`，保持 IPC 契约端到端一致。

### 7.2 对账时机

- 创建、编辑、删除注释后。
- 编辑器失焦。
- 编辑停止 600ms 后（用于删除、撤销、重做后尽快更新未定位列表）。
- 切换文档、关闭工作台、保存正文前。
- 手动点击“刷新标注”。

编辑停止后的解析只更新本地状态和未定位列表；真正写盘仍走失焦、保存或显式刷新，避免每次击键都写 JSON。

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

### 8.2 旁注栏

`WorkbenchMarginNotes` 分成三组：

- 正常文档注释：按正文 MarkNode 位置排序和定位。
- 未定位文档注释：单独放在“未定位 N 条”折叠区，不参与正文位置计算。
- 未定位原文投影：单独展示，文案明确“文档投影未找到，原文高亮仍有效”。

未定位卡片展示：

- 原始引文 `originalQuote`，使用较弱颜色或删除线；
- 评论正文；
- 状态说明：`原文未找到`、`跨段落暂不支持`、`存在多处相似文字`；
- 操作：`重新定位`、`删除`。

标题数量示例：`注释 5 · 未定位 2`。未定位区不能因为没有正文 MarkNode 就隐藏。

### 8.3 重新定位

1. 用户点击未定位卡片的“重新定位”。
2. 编辑器进入一次性选区状态，用户选择单个 block 内的文本。
3. 用当前选区生成新的 `quote/anchor`，调用 `upsertDocument`。
4. 状态改为 `anchored`，清除 `orphanedAt`，正文重新绘制 MarkNode。

跨 block、空选区或重叠选区时只提示，不写状态。

### 8.4 歧义状态

本期不自动选择候选。卡片显示“找到多处相似文字，请重新选择”，操作与未定位一致。后续如果需要，再增加候选列表和逐项跳转，不把候选选择塞进 v1。

### 8.5 批量清理

未定位区提供“清理未定位”入口，但必须按 scope 分开：

- 默认只勾选当前文档的 `document` 未定位注释；
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

1. 收到 `resolved` 后更新本地 `unlocatedIds` 和 `resolutionById`。
2. 对未定位 id 调用 `reconcileDocument` 写回 `unlocated` 状态；对其余标注写回 `anchored` 状态，并沿用当前 `quote/anchor`。
3. 在预览区显示 `未定位 N 条` 入口，不能只让高亮消失。
4. 入口打开后展示未定位标注的引文、评论和删除操作。
5. 用户删除后调用现有 `deleteDocument`，并同步 iframe 的标注集合。
6. HTML 可视化编辑保存后，预览重新加载并重新发送标注；未定位数量随新正文重新计算。

HTML 的锚点仍以文本引文为主，不使用 CSS 选择器或 XPath 作为唯一绑定依据。iframe 继续使用 `sandbox="allow-scripts"`，宿主与 iframe 只通过带来源标识的 `postMessage` 通信。

HTML 重新定位：

1. 宿主记录 `pendingRelocateId`。
2. 用户点击“重新定位”后在 iframe 内重新选中文字。
3. `capture-result` 到达时，如果存在 `pendingRelocateId`，复用旧 id 更新原标注，而不是创建随机 UUID。
4. 成功后状态改为 `anchored`；失败或取消时保留原未定位状态。

HTML 阶段 A 只做精确匹配，不承诺与 Lexical 共用模糊算法。如果后续需要在 HTML 内支持局部修改后的模糊重定位，再单独评估运行时算法和双实现维护成本。

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
- 旁注栏按 `annotations.length` 展示总数；接近 500 条时提示清理未定位注释。
- 2MB 本身不在渲染层估算，写入失败时返回明确错误，提示清理或拆分。
- 超限错误包含当前总数和未定位数量，例如：
  `单篇文档最多 500 条标注；当前 500 条，其中 120 条未定位，请清理后重试`
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
   - 在 `WorkbenchAnnotationPlugin` 应用标注前收集 MarkNode range，优先使用当前范围。
   - 对齐创建锚点时的全文坐标、`occurrence` 和 block 边界。
   - 增加编辑停止 600ms 后的本地重新解析，覆盖删除、撤销、重做。
2. **状态持久化**
   - 扩展 `src/shared/types/annotations.ts`、`normalizeAnnotation` 和 `reconcileDocumentAnnotations`。
   - 增加 `anchorRevision`、`baseAnchorRevision`、`applied/stale/skipped` 返回。
   - 更新 IPC 类型与 preload 契约。
3. **未定位 UI**
   - `annotationStore` 增加 `resolutionById`。
   - `WorkbenchMarginNotes` 增加 document 未定位分组、source 投影分组、重新定位和批量清理。
4. **HTML 未定位**
   - 消费 `resolved`，写回状态，显示未定位入口；重新定位复用 `pendingRelocateId`。
5. **验证**
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
- 完全删除高亮内容：进入未定位，旁注栏显示原始引文和评论，JSON 中仍有记录。
- 撤销上述删除：MarkNode 恢复后注释重新定位，未定位数量归零。
- 删除后 600ms 内未定位列表更新，无需等待失焦。
- 把高亮文字移动到其他段落：精确匹配成功时跟随新位置；失败时保留记录。
- 产生重复文本时：精确候选接近时显示歧义状态，不静默绑定错误位置。
- 段落拆分或合并导致跨 block：保留记录并显示“跨段落暂不支持”，不截取部分文字冒充完整锚点。
- 只修改加粗、链接或 Markdown 语法：注释位置不变。
- 两个窗口同时失焦对账：较旧版本返回 `stale`，不覆盖新锚点；窗口重新读取后再解析。
- 对账 IPC 失败：本地状态标记同步失败，不假装持久化；重新打开后以磁盘为准。
- 在高亮文字所在的重复段落中创建第二条相同引文：使用全文 `occurrence/offsetHint` 区分，不绑定到第一条。
- 编辑后立即关闭再重开：正文保存完成后再对账；未保存时不写半套锚点。

### 13.2 source 与批量清理

- `source` 标注的锚点不因文档编辑改变，原文页面高亮仍有效。
- `source` 投影未定位时显示在独立分组，文案说明“原文高亮仍有效”。
- 批量清理默认只勾选 document 标注；source 不默认勾选，删除必须走 `deleteSource` 并二次确认。
- 批量删除失败时保留未成功条目。

### 13.3 HTML

- HTML 预览显示未定位数量，不再静默隐藏。
- HTML 未定位状态写回 `document` 标注；重开预览后状态仍可见。
- HTML 重新定位复用旧 id，不新建随机标注；取消或失败时保留原未定位状态。
- HTML 可视化编辑保存后，未定位数量随新正文重新计算。
- 不支持 CSS Highlight 时，所有标注进入未定位入口，不静默消失。

### 13.4 容量与文件生命周期

- 接近 500 条时有清理提示；超限错误包含未定位数量。
- 2MB 写入失败时返回明确错误，不产生半写文件。
- 新增 `originalQuote` 后，旧文件接近 2MB 时普通更新不会静默丢字段；失败时保留旧文件。
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
| 全量对账造成写放大 | 只写真实变化；一次原子写；无变化不广播 |
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
| preload | `src/preload/index.ts`、`src/preload/index.d.ts` | 同步 IPC 契约 |
| renderer | `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx` | MarkNode 优先、提交全部解析结果、编辑后防抖解析 |
| renderer | `src/renderer/src/components/workbench/WorkbenchMarginNotes.tsx` | 未定位分组、重新定位、分区批量清理 |
| renderer | `src/renderer/src/store/annotationStore.ts` | 保存解析状态和未定位列表 |
| renderer | `src/renderer/src/components/workbench/WorkbenchHtmlAnnotationPreview.tsx` | 消费 `resolved`，未定位入口与重新定位 |

不修改标注文件的目录结构，不新增依赖，不改变 `source` 标注的存储归属。

## 16. 与主设计的关系

本文覆盖主设计中以下细节：

- 7.6 对账时机与 MarkNode 当前范围处理；
- 10.2 `reconcileDocument` 的载荷、返回和版本保护；
- 11 中“多个精确位置选最高分并标可能位置”的策略，改为 `ambiguous` 且不自动选择；
- 未定位列表的 UI 行为。

主设计的存储根、scope 语义、会话原文回显、迁移和删除策略保持不变。
