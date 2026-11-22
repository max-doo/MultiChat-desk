# 工作台统一笔记与标注设计

> Created: 2026-11-21 21:08 (Asia/Shanghai, UTC+08:00)

## 1. 结论

这份设计只保留一个用户可见的对象：**工作区里的 Markdown 文档**。保存整段会话、保存单条答复、从会话摘录一段文字，都只是创建文档的不同入口；高亮和评论则是文档的旁路数据，不进入正文。

具体决策如下：

1. **不再维护第二套笔记库。** 旧 `NotesPage` 的会话卡片、详情和导图入口已经收进工作台，独立页面已删除；工作台左侧仍然只有一棵文件树，不再出现“对话 / 文件”两个并列标签。
2. **标注统一为一种记录结构。** 会话原文标注和文档内标注共用 `id + quote + anchor + comment`，用 `scope: 'source' | 'document'` 区分锚点所在位置和渲染方式。
3. **存储按锚点域分成两个根，而不是按产品分成两套对象。** `source` 标注按会话身份存放在**默认工作区**的旁路文件里，不归任何一篇文档所有；`document` 标注按文档路径存放在**文档所在工作区**。这样同一会话在多个工作区各有一篇会话文档时，原文高亮仍然只有一份；删除或移动某篇文档也不会误删原文高亮，而文档标注仍然随文档生命周期走。
4. **正文只有一个所有者。** Markdown 文件是正文唯一权威；会话内容写进 Markdown 后，旧 JSON 里的 `snapshot` 不再继续写入，避免两份正文互相覆盖。
5. **会话快照不能直接当 Markdown。** `normalizeNoteTranscriptMarkdown` 输出的是 `<user>/<assistant>` 内部 XML 标签，必须新增 `snapshotToDocumentMarkdown` 转成标准 Markdown 后再写入文档。
6. **`==文字==` 不是标注。** 它仍然是用户自己排版的文本高亮，不承载评论、锚点和会话回显。标注使用独立的 MarkNode 和视觉样式。
7. **入口决定 `scope`，不需要用户手动选类型。** 在 AI 原文页面选区创建的是 `source` 标注；在工作台文档里选区创建的是 `document` 标注。会话文档可以同时拥有两种标注。
8. **第一版只做单 block 标注。** MarkNode 是 inline 节点，不能跨段落；跨 block 选区直接拒绝，跨段落的原文标注只在侧栏列出并跳回原文。2MB 以上文档默认源码模式，不进入 WYSIWYG。
9. **原文回显跨工作区，但只认默认会话库。** 所有入口的 `source` 高亮都从默认工作区的 `annotations/sources/` 读取；切换工作区不会让原文高亮消失，也不会在当前仓库生成第二份 `source` 标注。默认工作区不可用时明确报错，不回退到当前工作区。
10. **会话文档按捕捉上下文路由。** 工作台内捕捉写入当前工作区；工作台外（主界面、Quick 窗口等）捕捉写入默认工作区。两个目标目录都默认 `conversations/`，可通过各自工作区的 `conversationDir` 改为工作区内相对路径。
11. **默认工作区就是会话库，不另建会话工作区。** 复用现有默认 MultiChat 工作区；v1 的默认路径固定在系统「文档」目录下的 `MultiChat Vault`，其 `conversations/` 专门存放会话文档，`.multichat/annotations/sources/` 存放全局原文标注。
12. **工作台内允许一次性的目标切换。** 默认保存到当前工作区；如果用户不想让这段会话进入当前仓库，可在评论框选择“保存到默认会话库”，只影响本次捕捉，不形成全局偏好。这样既保留工作台内的当前仓库心智，也避免用户为了不污染仓库而退出工作台。

这套模型保留了用户“所有东西最后都是本地 Markdown”的心智，同时承认一个事实：第三方会话页面不是我们的编辑器，它的 DOM 会重绘、会翻页、会换路由，不能和 Lexical 共用同一套高亮实现。

## 2. 现状与约束

### 2.1 当前实现

| 位置 | 现状 | 对本设计的影响 |
|---|---|---|
| `src/shared/types/notes.ts` | `NoteConversation` 顶层保存 `snapshot`，`ConversationNote[]` 单独保存 `quote/comment/anchor` | 已经是“正文 + 标注”两层，可以直接演进 |
| `src/main/noteManager.ts` | 会话笔记按 `notes/<id>.json` 保存；`anchorsForUrl` 按 URL 聚合高亮；`prepareWorkbenchSource` 仍会写 `snapshot` | 旧数据迁移入口明确；但 JSON 不适合作为长期正文，工作台记录也要停止写第二份正文 |
| `src/shared/utils/noteTranscript.ts` | `normalizeNoteTranscriptMarkdown` 输出 `<user>/<assistant>` XML，供 `parseSnapshotBlocks` 阅读 | 不能直接交给 Lexical 的 Markdown 导入导出；需要单独转换 |
| `src/renderer/src/components/NotesSourcePane.tsx` | 旧页的原文快照面板，已随 `NotesPage` 删除 | 锚点匹配算法已迁到 `annotationAnchors`；原文回显改由 `useSourceAnnotations` 承担 |
| `src/shared/utils/webviewScripts.ts` | `generateNoteHighlightScript` 在第三方页面遍历文本、创建 CSS Highlight，并排除 `[contenteditable]` | 这是 `source` 标注的渲染器；当前只按 exact + prefix/suffix 匹配，未用 occurrence |
| `src/renderer/src/components/NoteCaptureModal.tsx` | 监听选区采集，写入 `annotations:capture-source` 和文档标注 | 只保留采集入口；评论卡与正文、原文高亮共用 `AnnotationCommentCard` |
| `src/renderer/src/components/WebviewCard.tsx` | 通过 `useSourceAnnotations` 读取默认库 `sources/` 并回显高亮 | 主界面与工作台右栏共用同一套 source 回显层 |
| `src/renderer/src/pages/NotesPage.tsx` | 已删除 | 会话资料统一在工作台文件树中打开 |
| `src/renderer/src/App.tsx` | 已移除 `currentPage === 'notes'` 分支 | 不再有独立笔记页路由 |
| `src/renderer/src/components/workbench/WorkbenchEditor.tsx` | Lexical 编辑器，已注册表格、代码、链接、图片等节点 | 新增 MarkNode 和标注插件即可，不需要替换编辑器 |
| `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx` | Lexical 与 Markdown 双向同步，1200ms 防抖落盘 | 标注不能进入 Markdown，应用标注时不能触发表格外的正文回写 |
| `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx` | 已有 `highlight` 按钮，走 `FORMAT_TEXT_COMMAND` | 新增“标注”按钮，和 `==` 高亮并列 |
| `src/renderer/src/store/workbenchStore.ts` | 右栏类型是 `'ai' \| 'mindmap' \| null`；`upsertFrontmatterSource` 会把 source 写成 URL | 增加 `'annotations'`；frontmatter 语义要拆开，避免和新字段冲突 |
| `src/main/services/workbenchService.ts` | 文本文件超过 5MB 时返回空 `content` 和 `isOversized` | 会话文档落盘前必须做 5MB 上限检查，否则打开是空文档 |
| `src/main/services/MindmapService.ts` | 工作台/会话导图仍从 `conversation.snapshot` 取上下文 | 停写工作台 snapshot 前，必须先把导图来源切到 Markdown 文件 |
| `src/shared/utils/mindmapFile.ts` | 已有 `.multichat/mindmaps` 的文件化模式 | 标注沿用“文件是权威、索引可重建”的做法 |

### 2.2 需要尊重的边界

- **第三方 DOM 不可控。** AI 平台会改 class、重绘消息列表、做虚拟滚动。`source` 标注只能靠文本锚点重新定位，不能存 DOM 节点或像素坐标。
- **Lexical 是受控编辑器。** 文档里的文本会被用户改写、拆分、合并；标注必须跟着文本走，不能靠一次性 DOM Range。
- **MarkNode 是 inline 节点。** 它只能包住同一 block 内的一段内容，不能跨段落；第一版必须在交互上明确这个边界。
- **工作区文本读取有 5MB 硬上限。** 会话快照可以更大，但转换后的最终 Markdown（含 frontmatter）超过 5MB 就打不开；创建文档前必须按最终 UTF-8 字节校验，不能生成一个空壳。
- **工作区可能被外部软件修改。** 用户会用 Obsidian、VS Code 直接改文件、改名、移动目录。标注不能假设“应用内操作是唯一变更来源”。
- **不能把标注写进 frontmatter。** 评论可能很长，frontmatter 会被 Obsidian 属性面板当作元数据展示，也会让文档体积和解析成本失控。

## 3. 产品模型：一个对象，三种入口

### 3.1 用户看到的对象

工作台左侧仍然是一棵普通的文件树。用户看到的每一个 `.md` 都是文档，不区分“笔记”“会话”“摘录”这些产品类型。来源信息写在 frontmatter 里，作为文档属性存在：

```yaml
---
source_kind: conversation
source: "https://chatgpt.com/c/..."
platform: ChatGPT
captured_at: "2026-11-21T15:20:20.955Z"
---
```

会话文档保留四个语义字段：`source_kind` 声明它是会话资料，`source` 提供原文入口，`platform` 用于展示和筛选，`captured_at` 记录捕捉时间。来源身份在读取时由 `noteConversationKey(source, title)` 归一化；只有归一化结果与原始地址不同时，才额外写入 `source_key`。`captured_at` 写 ISO 时间，属性面板直接显示本地日期；文档修改时间由文件系统维护，不重复写 `updated_at`。

`source_kind` 不能省略。仅凭 `source` 链接无法区分“从会话保存的资料”和“普通 Markdown 里引用了一个外部链接”。应用不强制给每个文件写 `id`，也不把应用状态塞进用户正文。已有 `source_url`、`source_key`、`captured_at` 数值时间等旧格式继续按原语义读取，属性面板把 `source_kind`、来源身份和旧应用状态收进“更多属性”，默认只显示来源、平台和创建时间。

旧格式收敛时，`source_url` 只在与 `source` 完全同值时删除；两者指向不同地址时保留 `source_url`，避免把第二个来源当成重复字段丢掉。`source_key` 只在归一化来源身份与原始地址不同时保留。

### 3.2 三种创建入口

| 入口 | 结果 | 是否带标注 |
|---|---|---|
| 保存整段会话 | 按捕捉上下文创建或复用一篇会话文档：工作台内写当前工作区，工作台外写默认工作区；归档目录默认 `conversations/`，正文是标准 Markdown | 不自动创建标注；已有 `source` 标注会投影到文档里 |
| 保存单条答复 | 创建一篇独立文档，正文是该条答复 | 不带来源标注，后续可以按普通文档标注 |
| 从会话选区摘录 | 创建一篇独立摘录文档，正文以引用块开头，可附带用户评论 | 摘录本身是正文，不创建标注记录 |

还有一个动作是“在原文上标注”：它不创建新文档，而是把一条 `source` 标注写入会话级旁路文件。捕获时会确保有一篇会话文档用于查看，但标注本身不归这篇文档所有；文档被删除或移动，原文高亮仍然存在。

这里的“保存整段会话”不是第二种对象，也不是第二套存储。它和普通保存一样创建 `.md`，只是正文来自会话快照，frontmatter 多了来源字段，并且文档落在由捕捉上下文决定的工作区。

这个动作和“摘录为文档”必须在选区菜单里分开，因为两者意图不同：

- **标注**：这段话还在原文里，我要在原文和文档里都能看到它，并且以后能改评论。
- **摘录**：我要把这段话带走，变成一篇可以独立编辑的文档，不再依赖原文。

上一版原型把“高亮”直接等同于“创建文档”，会让用户以为高亮只有一种结果。这次要把两个动作并列，但主次明确：标注是主动作，摘录是次动作。

### 3.3 会话文档和普通文档的差异

两者都是 Markdown，差异只在**生命周期策略**，不在对象类型：

| 维度 | 会话文档 | 普通文档 |
|---|---|---|
| 正文来源 | 从会话快照转换成标准 Markdown | 用户写作或摘录 |
| 外部来源 | frontmatter 带 `source_kind: conversation` 和 `source`；归一化身份与地址不同时再带 `source_key` | 可以没有 |
| 默认位置 | 工作台内：当前工作区 `conversations/`；工作台外：默认工作区 `conversations/` | 文档所在工作区，由用户选择 |
| 标注归属 | `source` 标注在默认工作区；自己的 `document` 标注在文档所在工作区 | 只有 `document` 标注，在文档所在工作区 |
| 内容更新 | 不自动覆盖用户编辑；来源有新内容时提示“追加 / 覆盖 / 忽略” | 用户自己编辑 |
| 原文回显 | 可以在 AI 右栏打开原文，显示 `source` 标注 | 没有 |
| 标注 | `source` 标注投影 + 自己的 `document` 标注 | 只有 `document` |

关键规则：**会话文档一旦生成，Markdown 就是正文所有者。** 之后的会话采集不能静默覆盖用户改过的正文；需要保留“用户编辑优先”的边界。

会话文档和正式笔记的区别不需要升级成第二个产品类型。它们共用同一个编辑器、文件树、标注侧栏和 Git 边界；区别只在于 frontmatter 的来源字段、是否显示“原文”动作，以及来源更新时是否提示“追加 / 覆盖 / 忽略”。正式笔记没有这些来源生命周期，会话文档有；这足以解释行为差异，不足以支撑再建一套“对话笔记库”。

### 3.4 工作台内与工作台外

把“在哪里标注”与“存到哪里”分开，是这次模型调整的核心。`scope` 仍由选区位置决定，不需要用户选择；文档目标由捕捉上下文决定，只在工作台内提供一个一次性覆盖。

| 场景 | `captureContext` | 会话文档目标 | `source` 标注 | 典型入口 |
|---|---|---|---|---|
| 工作台内标注 | `workbench` | 当前活动工作区 | 默认工作区 | `WorkbenchAiSidebar`（含原文） |
| 工作台外标注 | `global` | 默认工作区 | 默认工作区 | 主界面 `WebviewCard`、Quick 窗口 |
| 工作台内选择“保存到默认会话库” | `global` | 默认工作区 | 默认工作区 | 评论框的一次性切换 |

规则：

- **入口决定默认目标，不靠用户猜。** 工作台内的心智是“我在这个仓库里干活”，所以会话文档默认进当前工作区；离开工作台后没有仓库上下文，默认进会话库。
- **`source` 标注与文档目标解耦。** 即使文档写进当前仓库，`source` 标注仍然只写默认工作区。这样切换仓库不会丢原文高亮，也不会在每个仓库里复制一份会话记忆。
- **工作台内没有活动工作区时，不伪造一个当前工作区。** 文档目标返回 `NO_ACTIVE_WORKSPACE`，由界面提供“保存到默认会话库”的明确选择；不能静默把会话文档写进默认库。
- **当前工作区不可达时，不静默回落到默认工作区。** 先把 `source` 标注写入默认库，再报告文档创建失败；用户可以重试，或在评论框显式改为“保存到默认会话库”。
- **工作台内的一次性切换不持久化。** 它只解决“这次不想污染当前仓库”，不改变下一次捕捉的默认行为，也不引入第二套全局设置。

不单独建“会话工作区”，是因为默认工作区已经是一个完整工作区：有文件树、Git、设置、导图和标注能力。再建一个会话工作区只会让用户在两个导航之间切换，并制造第二个 `source` 根。默认工作区下的 `conversations/` 文件夹足以承担“会话资料集中存放”的角色，且仍然可以被用户移动、改名或用 Obsidian 打开。

## 4. 标注模型：一套结构，两个 scope

### 4.1 数据结构

```ts
export type AnnotationScope = 'document' | 'source'

export interface AnnotationAnchor {
  exact: string
  prefix: string
  suffix: string
  /** 同一段引文在正文中多次出现时，按创建时的出现序号消歧。 */
  occurrence?: number
  /** 仅作为重定位提示，不要求精确；文本变化后仍以 exact + 上下文匹配为准。 */
  offsetHint?: number
}

export interface AnnotationSource {
  key: string
  url: string
  platform: string
  title?: string
}

export interface Annotation {
  id: string
  scope: AnnotationScope
  quote: string
  anchor: AnnotationAnchor
  comment: string
  source?: AnnotationSource
  createdAt: number
  updatedAt: number
}
```

`quote` 是给人看的引文快照，`anchor.exact` 是匹配用的规范化文本。两者在创建时相同；文档标注在用户编辑后可以一起更新，`source` 标注的 `anchor` 不随文档编辑变化。

### 4.2 `source` 和 `document` 到底差在哪

| 维度 | `source` 标注 | `document` 标注 |
|---|---|---|
| 归属 | 会话身份（`sourceKey`），不归文档 | 文档路径 |
| 存储根 | **默认工作区**的 `annotations/sources/` | **文档所在工作区**的 `annotations/documents/` |
| 创建位置 | AI 原文页面、原文侧栏的选区 | 工作台 Lexical 文档的选区 |
| 锚点坐标系 | 第三方页面渲染后的文本 | Markdown 文档渲染后的文本 |
| 主要渲染器 | 注入脚本 + CSS Highlight | Lexical MarkNode |
| 文档内显示 | 按同一段 `quote` 做投影，能找到就显示 | 一定显示在当前文档 |
| 用户编辑正文后 | 锚点不跟着文档变；文档投影可能变成“未定位”，但原文高亮仍有效 | 锚点跟着被标记的文本移动；引文和上下文在保存时重算 |
| 删除文档后 | 标注保留，原文高亮仍然存在 | 标注随文档删除 |
| 评论编辑 | 文档侧栏和原文侧栏编辑的是同一条记录 | 只在文档侧栏编辑 |
| 切换工作区后 | 仍然从默认工作区读取，原文高亮不消失 | 跟随当前打开的文档切换 |

这张表解释了为什么不能只做一个 `scope` 可选、其他完全一样的“万能高亮”：

- 如果让 `source` 标注跟着文档编辑重算锚点，用户在文档里改一个字，原文页面上的定位就可能失效。
- 如果让 `source` 标注归文档所有，删除或外部改名会把原文高亮一起带走，但原文页面明明还在。
- 如果让 `document` 标注走原网页的 CSS Highlight，编辑器里的选区、光标、撤销栈会和叠加层打架，而且文档一重排 Range 就失效。
- 如果完全不区分，代码里会出现大量“当前是在网页还是编辑器”的条件分支，最后还是会演化成两套适配器，只是把差异藏起来了。

因此，**统一的是记录结构、侧栏、评论编辑和视觉语言；分开的是存储归属、锚点更新策略和渲染适配器。**

存储根的不同不是实现细节，而是两条生命周期的直接结果：会话身份属于用户与 AI 的对话，跨仓库仍然成立；文档路径属于某个工作区里的文件，离开该工作区就不再成立。把 `source` 标注放进默认工作区，是为了让“同一段对话”始终只有一份记忆；把 `document` 标注留在文档所在工作区，是为了让删除、改名、移动和 Git 操作仍然可解释。

### 4.3 什么情况下用哪种

- 在 AI 原文页面选中文字，点“标注” → `source`。
- 在工作台文档里选中文字，点“标注” → `document`。
- 在原文侧栏里选中文字，点“标注” → `source`。
- 在文档里选中一段“从原文摘录来的文字”，点“标注” → 仍然是 `document`。它是对本地文档的评论，不回显到原文。

不在 UI 上放“标注类型”切换。入口已经表达了意图，额外开关只会让用户困惑。

### 4.4 `==` 高亮和标注的区别

| 能力 | `==文字==` | 标注 |
|---|---|---|
| 存在形式 | Markdown 文本格式 | 旁路 JSON 记录 |
| 有评论 | 没有 | 有，可为空 |
| 有稳定 id | 没有 | 有 |
| 能回显到原文 | 不能 | `source` 可以 |
| 能跨段落 | 不可靠 | 第一版也不支持；MarkNode 只能单 block |
| 外部软件可读 | 是，显示为 `==` 或渲染为高亮 | 正文里看不到，侧栏里看得到 |

两者可以叠加。视觉上必须能区分：

- `==`：实色浅黄背景，无下划线。
- 标注：低透明度琥珀背景 + 虚线下划线；激活时背景加深、下划线变实。
- 两者同时存在：背景只由 `==` 提供，标注只加下划线和右侧小圆点，避免颜色叠加后看不清；MarkNode 的 theme 要显式把背景设为透明。

颜色不写入标注记录。`source`、`document`、激活态、未定位态各自有固定的语义样式，由 scope 和 UI 状态推导；v1 不提供每条标注自定义颜色，也不把 `color` 字段塞进旁路 JSON。以后如果确实需要颜色分类，再增加可选 `color` 枚举并以 `amber` 为默认，旧记录不需要迁移。

## 5. 存储设计

### 5.1 正文

正文就是工作区里的 `.md` 文件，不引入第二份正文。

- 会话文档创建时写入由 `snapshotToDocumentMarkdown` 转换出的标准 Markdown。
- 普通文档由编辑器直接读写。
- 标注永远不写进正文，也不写进 frontmatter。
- `==` 是正文的一部分，按 Markdown 文本保存。

### 5.2 两个旁路文件区

```text
<default-workspace>/.multichat/annotations/
  sources/<source-hash>.json      # source 标注，跟会话身份，全局只有一份

<document-workspace>/.multichat/annotations/
  documents/<path-hash>.json      # document 标注，跟文档生命周期
```

两个根的选择固定如下：

| 记录 | 根 | 原因 |
|---|---|---|
| `source` 标注 | 默认工作区 | 会话身份跨工作区成立；切换仓库后原文高亮仍要回显 |
| `document` 标注 | 文档所在工作区 | 文档路径与工作区绑定；删除、改名、移动时跟着文档处理 |

会话正文本身仍然落在工作区文件树里，不进入旁路目录：

```text
<current-workspace>/conversations/*.md   # 工作台内捕捉
<default-workspace>/conversations/*.md   # 工作台外捕捉
```

`conversations/` 是 `conversationDir` 的默认值，不是一个固定目录名；用户可以把它改成其他工作区内相对路径。`sources/` 的根不可配置，始终是默认工作区。

`source` 文件示例：

```json
{
  "version": 1,
  "source": {
    "key": "https://chatgpt.com/c/...",
    "url": "https://chatgpt.com/c/...",
    "platform": "ChatGPT",
    "title": "ChatGPT - 工作台架构讨论"
  },
  "annotations": [
    {
      "id": "0f6a1d7e-7f6e-4b1a-9b7a-2d1c3e4f5a6b",
      "scope": "source",
      "quote": "标注应该和正文分离",
      "anchor": {
        "exact": "标注应该和正文分离",
        "prefix": "核心结论是",
        "suffix": "，不要写进 Markdown",
        "occurrence": 0,
        "offsetHint": 128
      },
      "comment": "这条要保留到原文回显",
      "createdAt": 1795258420955,
      "updatedAt": 1795258420955
    }
  ]
}
```

`document` 文件示例：

```json
{
  "version": 1,
  "document": {
    "relativePath": "笔记/架构讨论.md",
    "contentHash": "sha256:...",
    "size": 48213,
    "mtime": 1795258420955,
    "updatedAt": 1795258420955
  },
  "annotations": [
    {
      "id": "5c2b1f0e-3d4a-4e5f-8a9b-0c1d2e3f4a5b",
      "scope": "document",
      "quote": "先确认正文所有权",
      "anchor": {
        "exact": "先确认正文所有权",
        "prefix": "第一步",
        "suffix": "，再讨论存储",
        "occurrence": 0
      },
      "comment": "这里是整个设计的根",
      "createdAt": 1795258420955,
      "updatedAt": 1795258420955
    }
  ]
}
```

字段说明：

| 字段 | 作用 |
|---|---|
| `source.key` | 会话身份，和 `noteConversationKey` 一致；原文回显直接按它取标注 |
| `document.relativePath` | 文档在工作区内的 POSIX 相对路径；用于外部改名后重新认领 |
| `document.contentHash` | 上次成功对账时的正文哈希；只用于判断“正文是否变过”，不是写锁 |
| `document.size` / `document.mtime` | 外部改名对账的预筛条件；避免在大工作区里逐个读全文 |
| `scope` | 决定锚点更新策略和渲染适配器 |
| `quote` | 展示用引文；允许和 `anchor.exact` 在编辑后略有差异 |
| `anchor.exact/prefix/suffix` | 文本定位三元组；`prefix/suffix` 用于同文多次出现时打分 |
| `occurrence` | 同一引文多次出现时的序号消歧 |
| `offsetHint` | 近似位置，只用于同分候选，不作为失配时的唯一依据 |

文件名用 `sha1(relativePath)` 或 `sha1(sourceKey)` 的前 32 位，保证正常打开时 O(1) 找到文件。文档应用内重命名时同步重命名 `documents` 下的文件；外部重命名时按下面的顺序找回：

1. 按新路径的 hash 直接找；命中后必须校验 `contentHash`。路径被另一篇文档复用时，内容不一致就不能直接套用旧标注。
2. 找不到就扫描 `annotations/documents/*.json`，按 `document.relativePath` 匹配。
3. 还找不到就按 `contentHash` + 文件大小 + mtime 找唯一候选；唯一才认领，多个候选不猜。
4. 认领成功后更新 `relativePath` 并重命名文件；无法唯一认领时保留原文件，标注在侧栏显示为“未定位”，不删除。

`source` 文件不需要这套路径对账：会话身份就是 `sourceKey`，文档怎么改名都不影响原文回显。

### 5.3 为什么按 scope 分开存

| 方案 | 问题 |
|---|---|
| 所有标注都放文档旁路文件 | 删除/移动文档会带走原文高亮；文档改名后要同时维护“文档 → 会话”的反向索引；同一会话两篇文档会各存一份 source 标注 |
| 所有标注都放会话旁路文件 | 普通文档没有会话身份；文档标注会失去路径归属；删除文档无法自然清理 |
| 所有标注都放默认工作区 | 普通文档的标注会离开文档所在工作区；删除、改名、跨仓库移动无法跟随；一个仓库的标注会污染另一个仓库 |
| 继续用 `NoteManager` 的 `notes/<id>.json` | 数据在应用目录，不随工作区复制；正文和标注仍然分属两个世界 |
| 写进 Markdown frontmatter | 评论体积不可控；会污染用户的属性面板；外部编辑器改 frontmatter 容易破坏结构 |
| 写进正文的 `==...==` | 没有 id、评论和锚点；跨段落、表格、代码时不可靠；无法回显到原文 |
| 单独建一个全局 SQLite | 对当前数据量过重；工作区可移植性变差；和现有“文件即数据”的方向冲突 |

按 scope 分两个根是一个有意的例外：`source` 标注的锚点在第三方页面，不在文档；把它绑在文档生命周期上，会在删除、改名、跨工作区时产生无法解释的数据丢失。反过来，把 `document` 标注也放进默认工作区，会让普通文档的标注脱离文档生命周期。用户看到的仍然是一篇文档和一个标注侧栏，存储差异不暴露为产品概念。

评论保存在旁路 JSON，而不是 Markdown 正文或 frontmatter。这样评论不会改变正文渲染，不会出现在 Obsidian 属性面板里，外部编辑器改 frontmatter 也不会破坏评论结构；同时可以用稳定 id 做记录级合并，并让同一会话的 `source` 评论在默认库跨工作区复用。代价是旁路文件需要随工作区/默认库一起备份，单篇 `.md` 不会自带评论，这一点在导出和 Git 提示里说明。

### 5.4 写入、并发和性能

- **原子写**：临时文件 + `rename`，和 `noteManager.write` 的做法一致。
- **串行化**：主进程按 `scope + root + key` 串行化读改写，避免两个窗口同时覆盖。`source` 的 root 固定为默认工作区；`document` 的 root 是文档所在工作区。
- **按记录合并**：每次只 upsert 一条或一批带 id 的记录；删除必须显式传 `id`。不允许“提交一个子集，缺失即删除”，否则 Webview 里只拿到 source 子集时会把文档标注删光。
- **版本判断**：每条记录用 `updatedAt` 做后写覆盖；文件级 `revision` 只用于诊断和缓存失效，不作为业务锁。两个窗口同时改同一条时，较新的 `updatedAt` 胜出；不同 id 的记录都保留。
- **不按击键写**：正文仍然走 1200ms 自动保存；标注锚点只在创建/编辑/删除标注、编辑器失焦、切换文档、显式刷新时重算并落盘。
- **先保存正文再对账**：写 `document` 标注前先确认正文真的落盘。现有 `saveActiveFile` 对 `activeFileOversized` 会直接返回 `true` 但没有写盘，必须改成结构化结果（`{ saved, reason }`）或在调用前显式检查 `activeFileOversized / saveStatus === 'conflict'`；未真正保存时保留旧 anchor，不写半套状态。
- **上限**：单个旁路文件 500 条标注；单条 `quote/comment` 各 20k 字符；文件总大小 2MB。文件大小是最终约束，条数和单条长度只做交互保护；达到 2MB 时拒绝新增并提示导出或拆分，不静默截断。
- **跨根不做伪原子**：一次捕捉先写默认工作区的 `source` 标注，再写目标工作区的会话文档。跨盘或跨目录无法真正原子提交，所以把 `source` 作为提交点，文档作为可重建的投影；文档失败不回滚已保存的标注，也不在另一个根偷偷补写。
- **捕捉幂等**：`captureSource` 按渲染层生成的 `annotationId` 做 upsert，重试不会产生第二条 `source`；补文档走 `ensureDocumentForSource`，只读已有 `sourceKey`，不再写标注。只有用户重新发起一次新标注才生成新 id。

### 5.5 删除、Git 和隐私

- 删除文档时，主进程删除 `documents/<path-hash>.json`；删除前如果有 `document` 标注，确认框要写明“这些文档内标注会一起删除”。
- 删除文档**不删除** `sources/` 下的原文标注；原文页面上的高亮仍然存在。要清除原文高亮，使用原文侧栏或设置里的“清理该会话标注”。
- `source` 标注属于默认工作区，不属于某个仓库。切换工作区不会隐藏原文高亮；清理一条 `source` 标注会同时影响所有工作区，因此确认框必须写明“所有工作区的原文高亮都会消失”。
- 外部删除文档时，`documents` 旁路文件保留一个版本，便于恢复文档后找回；不自动删。
- 两个根的 `.multichat/annotations/` 都默认加入所在工作区 `.gitignore` 的“应用生成物”分类。`gitignoreService` 必须对已有 `.gitignore` 追加缺失模式，不能重写用户内容；工作区激活或首次写标注时补齐，不能只在空目录初始化时生效。原因是评论属于用户输入，可能包含敏感内容；JSON 数组在 Git 合并时也容易产生不可解析冲突。需要跨设备同步的用户可以在 `.gitignore` 里手动取消忽略，或使用后续的“导出标注”能力。
- `document` 标注随文档所在工作区复制、移动、换盘；只复制单篇 `.md` 不会带上旁路标注。`source` 标注在默认工作区，复制单篇会话文档也不会复制它；因为 `source` 与按需保留的 `source_key` 仍在 frontmatter 里，换到另一个工作区后原文投影仍能通过默认库找到。这是本地文件方案的已知边界，需要在导出/分享入口说明。
- 隐私边界不同：`document` 评论可能随仓库进入 Git；`source` 评论在默认工作区，只有默认工作区被同步或备份时才离开本机。界面不需要解释这套机制，但删除、导出和 Git 提示必须说清影响范围。

## 6. 会话原文回显

### 6.1 回显链路

```text
AI 网页选区
  -> 现有注入脚本拿到 quote / anchor / snapshot / url
  -> 渲染层调用 annotations:capture-source
  -> 主进程解析默认工作区，把 source 标注写入默认库的 sources/<hash>.json
  -> 主进程按 captureContext 解析文档目标：workbench 用当前工作区，global 用默认工作区
  -> 在目标工作区扫描来源地址/身份，找到或创建会话文档（文档不拥有 source 标注）
  -> 广播 annotations:changed（source 与 document 分开）
  -> Webview 按 sourceKey 从默认库重新拉取 source 标注并执行 generateNoteHighlightScript
```

原文页面只拿到绘制所需的 `{ id, quote, anchor }`，不注入 `comment`。点击只回传 `id/x/y`；评论由渲染层按 id 从本地 store 取，避免把用户评论序列化进第三方页面上下文。

### 6.2 按会话身份查找

`source` 标注文件本身就以 `sourceKey` 命名，所以不需要 `sources.json` 或“URL → 文档”的索引：

1. 用 `noteConversationKey(url, title)` 计算 `sourceKey`。
2. 主进程解析默认工作区，在 `<default-workspace>/.multichat/annotations/sources/` 下按 hash 找文件。
3. 找不到就不画高亮；不查当前工作区，也不把当前工作区的 `sources/` 当作备用。
4. 不扫描文档、不依赖文档是否存在；文档只是查看入口。

`source` 的读取、写入、删除都只认默认工作区，渲染层不传 `workspaceRoot`。这样同一个会话无论从哪个仓库、哪个窗口打开，看到的都是同一份原文标注；不存在“从当前工作区读到、却往默认工作区写”的分叉。默认工作区不可用时返回可操作错误并停止绘制，不回退到当前仓库的 `.multichat/annotations`。

同一会话在多个工作区各有一篇会话文档时，`source` 文件仍然只有一份；每篇文档通过 frontmatter 的来源地址与归一化身份做投影。文档是查看入口，不是标注的所有者。

### 6.3 匹配和长会话

`generateNoteHighlightScript` 需要补三件事：

- 把 `occurrence` 和 `offsetHint` 纳入候选打分；没有这两个字段时退化为当前行为。
- 每次重新执行前清理旧的 CSS Highlight，避免重复叠加。
- 增加 `MutationObserver` + 滚动去抖，在虚拟滚动把目标消息加载出来后再补画。现有的 `dom-ready`、`did-stop-loading`、SPA 导航和 800ms–20s 重试保留。

不要复用这套脚本到 Lexical。它遍历的是第三方 DOM、排除 `[contenteditable]`，和编辑器的选区/输入法/撤销栈不兼容。

### 6.4 共享接入点

旧实现只有 `WebviewCard` 调用了 `useWebviewNotes`，工作台右侧 `WorkbenchAiSidebar` 没有接入。现在 source 高亮、点击和采集已经收进共享层，在以下位置接入：

- 主界面 `WebviewCard`
- 工作台 `WorkbenchAiSidebar`

右键菜单从“记为笔记”拆成“标注 / 摘录为文档”，并明确两条都走新的 annotation service，不再绕回 `notesSave`。

`WorkbenchAiSidebar` 已经有一套提问按钮注入；source 高亮接入时只追加自己的 CSS Highlight 和点击监听，不覆盖或重建原有注入。

共享 hook 只接收 `sourceKey`，不接收 `workspaceRoot`。捕捉时由入口传入 `captureContext`：

- `WorkbenchAiSidebar` 传 `workbench`。
- 主界面 `WebviewCard` 和 Quick 窗口传 `global`。
- 工作台评论框选择“保存到默认会话库”时，本次改为 `global`。

这样 source 的读写根在类型层面就只有默认工作区一个，渲染层没有机会把原文标注写进当前仓库。

## 7. 编辑器实现

### 7.1 用 MarkNode，但只做单 block

Lexical 0.53.0 已经带 `@lexical/mark` 的 `MarkNode`：

- 它是 inline ElementNode，`children: 'inline'`，只能包住同一段落/标题/列表项内的一段 inline 内容，**不能跨 block**。
- 文本被编辑、拆分、合并时，MarkNode 跟着 Lexical 的节点树移动。
- `$convertToMarkdownString` 遇到未知 inline ElementNode 会递归导出子节点，因此不会把标注写进 Markdown。
- `insertNewAfter` 会复制 `__ids`，用户在标注末尾回车会生成第二个同 id 的 MarkNode；复制粘贴也会。去重不能只在粘贴时做。

`@lexical/mark` 目前是 `@lexical/react` 的传递依赖，没有写进 `package.json` 的直接依赖。实现时需要：

1. 确认版本仍是 `0.53.0`，避免和现有 Lexical 包错位。
2. 按项目规则，新增生产依赖前先向用户确认；确认后执行 `npm install @lexical/mark@^0.53.0`。
3. 在 `WorkbenchEditor` 的 `initialConfig.nodes` 注册 `MarkNode`，在 theme 里补 `mark` 和 `markOverlap`，并把背景显式设为透明。

### 7.2 插件职责

新增 `WorkbenchAnnotationPlugin`，只做五件事：

1. **加载**：文档切换后，从文档所在工作区拉取 `document` 标注，从默认工作区拉取该文档来源身份对应的 `source` 标注，在 Markdown 导入完成后应用。
2. **创建**：把当前选区包成 MarkNode，生成标注 id，打开评论输入。
3. **定位**：点击 MarkNode 或侧栏卡片时，选中并滚动到对应文本。
4. **对账**：编辑器失焦、切换文档、保存标注时，重算 `document` 标注的 `quote/anchor`；`source` 标注不动。
5. **清理**：处理重复 id、零 id、目标文档不存在的 id。清理必须等 `document` 和 `source` 两路标注都加载完成后执行，有效 id 集合 = 当前文档的 `document` 标注 + 当前文档来源身份对应的 `source` 标注；不能只看 `documents/` 文件，否则会把异步加载的 `source` 投影当成未知 id 删掉。`source` 读取失败时跳过清理，保留现有投影，等默认库恢复后再对账。

不要在插件里自己监听 `activeFileContent` 然后重复导入。`MarkdownSyncPlugin` 已经是文档导入的唯一入口，应该由它在一个明确的“导入完成”时点调用标注应用逻辑。

### 7.3 加载顺序和防回写

推荐把加载流程固定为：

```text
读取 Markdown
  -> 解析 frontmatter
  -> $convertFromMarkdownString
  -> 拉取 document 标注 + 该 sourceKey 的 source 标注
  -> 用文本锚点在 Lexical 中定位
  -> 包 MarkNode
  -> 校验序列化后的 Markdown 与导入前一致
  -> 标记已应用的文档版本
```

要点：

- 先有正文，后有标注；不能先包 MarkNode 再导入 Markdown。
- 应用标注会拆分带格式的 TextNode，可能改变 `$convertToMarkdownString` 的输出。整个过程必须放在 `annotation-sync` 专用 tag 下，`MarkdownSyncPlugin` 忽略这个 tag，不能触发 `updateActiveContent`。
- 应用完成后做一次“同一编辑器状态下，应用 MarkNode 前的序列化结果 === 应用后的序列化结果”的校验；不要拿磁盘原文件字节做基准，Lexical 导入/导出本身会规范化列表、空行、强调和表格。不一致就撤销本次标注应用并记录错误，不能把用户正文改坏。
- 用 `documentToken` 或 `activeFilePath + contentHash` 防止异步加载把上一篇文档的标注应用到新文档。
- 从源码模式切回富文本时，重新执行导入 + 标注应用；源码编辑可能已经改变锚点。

### 7.4 文本锚点如何映射到 Lexical

不要在 Lexical 里存字符偏移作为长期身份，节点 key 在重载后会变。正确做法是：

1. 遍历编辑器状态里的 ElementNode/TextNode，拼出一份带 `(nodeKey, start, end)` 映射的纯文本。
2. 用共享的 `resolveAnchors(text, annotations)` 做一次匹配，返回 `{ id, start, end }`。
3. 把文本偏移映射回 `(nodeKey, offset)`，拆分 TextNode，包成 MarkNode。
4. MarkNode 的 id 就是标注 id；编辑过程中由 Lexical 维护位置。

`resolveAnchors` 从 `NotesSourcePane.snapshotRanges` 抽出来，变成不依赖 DOM 的纯函数，放在 `src/shared/utils/annotationAnchors.ts`。DOM 适配器和 Lexical 适配器各自负责把文本偏移变成自己的 Range。

匹配规则：

- 先按 `exact` 找所有出现位置。
- 用 `prefix/suffix` 给候选打分，上下文匹配得分高者优先。
- 分数相同看 `occurrence`；再相同看 `offsetHint` 的距离。
- 全部找不到就返回未定位，不抛错、不删除标注。

匹配是“DOM/节点树遍历一次，文本匹配按标注数线性扫描”，不是“所有标注一次扫描完成”。验收口径按前者写，不要承诺不可能成立的一次遍历。

### 7.5 创建和编辑

- 浮动工具栏新增“标注”按钮，图标用评论或书签类图标，和现有的 `ink_highlighter` 区分。
- 选中文字后点“标注”，立即创建 MarkNode，并在选区附近弹出一个小评论框；不输入评论也可以确认，得到一条“只有高亮、没有评论”的标注。
- 评论框只负责首次输入。后续编辑统一在右侧“标注”面板完成。
- 选区跨 block、代码块、图片、HTML、frontmatter 时拒绝，提示“请选择单个段落内的正文文本”。第一版不做跨段标注。
- 选区和已有标注重叠时拒绝，并选中已有标注。一个点击目标只能对应一个评论；MarkNode 的多 id 只表示完全相同的文本范围，不表示部分重叠，第一版不拿它做重叠功能。
- `source` 标注在文档里只做投影：单 block 能匹配就显示；跨 block 或找不到就只在侧栏列出，点击时跳到原文。

### 7.6 编辑后的对账

- `document` 标注：MarkNode 还在，就读取它当前的文本和前后文，更新 `quote/anchor`；MarkNode 被删掉，就把标注标记为未定位，保留评论。用户可以把文本重新选一遍并“重新关联”，或者删除标注。
- `source` 标注：文档里的 MarkNode 只是投影。用户在文档里改文字，不改 `source` 标注的 `anchor`；投影找不到时显示未定位，但原文页面仍然按原锚点回显。

对账时机：

- 评论保存/删除后。
- 编辑器失焦。
- 切换文档或关闭工作台前。
- 手动点击“刷新标注”。

正文仍然按 1200ms 自动保存；写 `document` 旁路前先确保正文已落盘。

### 7.7 重复 id、零 id 和跨文档粘贴

每次 editor update 都做一次轻量清理，不只粘贴：

- 同一 id 只保留第一个（按文档顺序）；`insertNewAfter` 产生的第二个、粘贴产生的副本都剥掉。
- ids 为空的 MarkNode 直接 unwrap，不能留下没有数据的 `<mark>`。
- 从文档 A 粘贴到文档 B 时，B 的有效 id 集合里没有这些 id；清理阶段移除，避免“看得见高亮、点不开评论”。有效集合必须同时包含当前文档的 `document` 标注和 `source` 投影。
- 在状态栏或侧栏给一次非阻塞提示“粘贴内容未复制评论”，不弹模态框。

### 7.8 源码模式和大文档

- 源码模式不渲染 MarkNode；点击侧栏标注卡片时，自动切回富文本并定位。
- 2MB 以上固定进入源码模式，不提供 WYSIWYG 入口；2MB 到 5MB 之间正文可读，点击标注卡片时在源码里按 `quote/anchor` 查找并滚动，不整篇导入 Lexical。
- 超过 5MB 的文本文件，`workbenchService.readFile` 会返回空内容；会话文档创建阶段就必须拒绝，不能生成打不开的文档。
- 超大文档不自动应用全部标注；先显示列表，用户点哪条就在源码里定位哪条。不要用“按需加载富文本”描述一个实际仍是整篇导入的行为。

## 8. 会话文档、导图与迁移

### 8.1 会话正文转换

新增 `snapshotToDocumentMarkdown(snapshot, platform, title)`，把内部 XML 快照转成标准 Markdown：

```markdown
# ChatGPT - 工作台架构讨论

## 你：

...

## ChatGPT：

...
```

规则：

- 用 `parseSnapshotBlocks(normalizeNoteTranscriptMarkdown(snapshot))` 或等价解析拿到 role/content，再按 role 输出 `##` 标题。
- 来源地址只写入 frontmatter，不重复写入正文。
- 保留原始 fenced code block、列表、表格和引用；不要重新转义代码内容。
- 不输出 `<user>/<assistant>` 标签，避免 Lexical 首次保存把 `<` 转成实体、把角色结构写坏。
- 空块跳过；同一角色连续多条消息可以合并到同一节，或各自保留 `###` 子标题，按可读性选择一种并固定。
- 旧 XML 格式继续只用于 `NotesSourcePane` 的原文快照，不进入文档正文。

### 8.2 新建会话文档

主进程提供 `annotations:capture-source`，输入包括 `annotationId`、`captureContext`、可空的 `workspaceRoot`、平台、标题、URL、快照、选区、评论：

```ts
{
  annotationId: string
  captureContext: 'workbench' | 'global'
  workspaceRoot?: string
  platform: string
  title: string
  url: string
  snapshot: string
  quote: string
  anchor: AnnotationAnchor
  comment: string
}
```

流程：

1. **先解析默认会话库。** 调用 `resolveDefaultWorkspace` / `ensureDefaultWorkspace` 取得默认工作区，校验目录存在、已授权、可写，并确保 `.multichat/annotations/sources/` 可创建。失败时返回 `CONVERSATION_LIBRARY_UNAVAILABLE`，不写任何 `source` 标注，也不在目标工作区创建半套文档。
2. 用 `noteConversationKey(url, title)` 计算 `sourceKey`。
3. **把 `source` 标注写入默认工作区。** 目标固定为 `<default-workspace>/.multichat/annotations/sources/<source-hash>.json`。按 `annotationId` 做 upsert：同一 id 重试时更新 `comment/anchor/updatedAt`，不追加第二条；同一 id 若对应不同 `sourceKey` 直接拒绝。这一步是本次捕捉的提交点；写入失败就直接返回错误，不继续创建文档。
4. **解析文档目标工作区 `T`。**
   - `captureContext: 'workbench'`：`T` 必须是主进程的 `activeWorkspaceRoot`；如果请求带了 `workspaceRoot`，它只能用于一致性校验，不能覆盖 active root。没有 active root 时返回 `success: true`、已保存的 `source` 标注和 `documentError: NO_ACTIVE_WORKSPACE`，由界面提供“保存到默认会话库”；active root 存在但目录不可达时返回 `documentError: WORKSPACE_UNAVAILABLE`，不静默改存默认库。
   - `captureContext: 'global'`：`T` 就是默认工作区；不需要当前工作区，也不接受渲染层指定其他根。
5. 读取 `T/.multichat/settings.json` 的 `conversationDir`，默认 `conversations/`；校验为工作区内相对路径，非法历史值回落到 `conversations/`。目标目录不存在时创建。
6. 扫描 `T` 的 `.md` frontmatter，读取 `source`、`source_url` 或 `source_key`，按 URL 与当前 `sourceKey` 等价比较。扫描整个 `T`，不只 `conversations/`，否则用户把文档移走后会重复建第二篇。复用筛选的扫描器，带 3 秒 / 2000 文件上限；扫描结果必须返回 `complete: boolean`，超时或达到 2000 文件都视为不完整。多个候选时优先 `conversationDir` 下最新修改的一篇，并在界面提示“存在多篇同源文档”；没有候选才新建。扫描不完整时只保留已写入的 `source` 标注，不新建或复用文档，避免无法确认时制造重复。
7. 新建文档时正文用 `snapshotToDocumentMarkdown`，frontmatter 用 `source_kind: conversation/source/platform/captured_at`；仅当归一化来源身份与地址不同时追加 `source_key`。已有文档不覆盖正文。文件名冲突时追加 ` (2)`、` (3)`，不覆盖已有文档。
8. 广播 `annotations:changed`：`source` 事件指向默认工作区，`document` 事件指向 `T` 和 `relativePath`。返回 `{ annotation, document?: { workspaceRoot: T, relativePath }, documentError? }`。
9. 文档创建失败时仍返回 `success: true`，因为 `source` 标注已经保存；`document` 为空，`documentError` 标明原因，界面提示“标注已保存，文档未生成”。重试或改存默认库时调用 `annotations.ensureDocumentForSource({ sourceKey, captureContext })`，只补文档，不再写第二条 `source`；如果默认库已经没有对应 source，返回 `SOURCE_NOT_FOUND`，不建空文档。不要回滚 `source`，也不要在默认库和当前仓库之间二选一偷偷补写。

文件名的标题清洗复用导图文件名的安全字符处理，避免 Windows 非法字符和路径长度问题。渲染层不强制把用户从多 AI 模式切走；如果目标文档不在当前工作区，只提供“打开文档 / 打开会话库”的动作，由用户决定是否切换。

### 8.2.1 保存位置与配置

自动捕捉不是一个绝对路径，而是“一个默认会话库 + 一个文档目标工作区”：

- **默认会话库**：默认工作区，固定用于 `source` 标注和工作台外会话文档。v1 的产品约束是系统「文档」目录下的 `MultiChat Vault`；现有 `ensureDefaultWorkspace` 和 `workbench_defaultWorkspacePath` 继续负责定位与缓存，但不新增用户可见的“修改默认会话库”入口。
- **文档目标工作区**：工作台内是当前活动工作区，工作台外是默认会话库。它只决定会话文档落在哪个文件树，不改变 `source` 标注的根。
- **会话归档目录**：由目标工作区自己的 `.multichat/settings.json` 的 `conversationDir` 决定，默认 `conversations/`。工作台内读当前工作区的设置；工作台外读默认工作区的设置。

`workbench_defaultWorkspacePath` 只作为已解析路径缓存，不是可编辑配置。`ensureDefaultWorkspace` 必须把缓存路径与规范路径 `path.join(app.getPath('documents'), 'MultiChat Vault')` 的 `path.resolve` / `realpath` 结果比较；不一致时忽略并清理旧缓存键（不删除旧目录内容），按规范路径重新创建/授权，并在设置里提示旧目录位置，供用户手动迁移。缓存路径不可达、不是目录或不可写时同样重新解析。不能因为缓存存在就绕过规范路径检查和可写检查，也不能把 source 静默写到旧缓存。

配置边界如下：

| 配置/状态 | 存放位置 | 作用 | 是否允许绝对路径 |
|---|---|---|---|
| 默认会话库 | `ensureDefaultWorkspace` 解析出的默认工作区；`workbench_defaultWorkspacePath` 仅作已解析路径缓存 | `source` 标注根 + 工作台外会话文档根 | 由主进程解析，不接受渲染层任意指定 |
| 当前工作区 | `activeWorkspaceRoot`（主进程内存）+ `workbench_lastWorkspacePath`（electron-store，重启恢复） | 工作台内会话文档目标；切换工作区即切换文档目标 | 是，但必须是已授权的工作区根 |
| 当前工作区归档目录 | 当前工作区 `.multichat/settings.json` 的 `conversationDir` | 工作台内会话文档子目录，默认 `conversations/` | 否；必须落在工作区内 |
| 默认会话库归档目录 | 默认工作区 `.multichat/settings.json` 的 `conversationDir` | 工作台外会话文档子目录，默认 `conversations/` | 否；必须落在工作区内 |

工作台内的解析顺序：

1. 读取主进程内存中的 `activeWorkspaceRoot`。这个状态目前不存在，实施时必须新增；它只能由 `workbench:activate-workspace` 原子更新，不能由渲染层直接赋值。
2. 应用刚启动、尚未打开工作台时，读取 electron-store 中的 `workbench_lastWorkspacePath` 作为恢复值，然后调用同一个 `activate-workspace` 完成授权、写回和 watcher 启动。不能只读 store 就当作当前工作区。
3. 内存值与持久化值不一致时以 `activeWorkspaceRoot` 为准；渲染层传入的 `workspaceRoot` 只用于一致性校验，不能作为写入依据。其他根直接拒绝，不能借自动捕捉把文件写到另一个工作区。
4. 没有 `activeWorkspaceRoot` 时（只应出现在应用初始化未完成或初始化失败），不自动激活默认工作区来冒充“当前工作区”；返回 `NO_ACTIVE_WORKSPACE`，由界面提供“保存到默认会话库”的明确动作。正常关闭自定义工作区不会进入这个状态，而是由 `closeWorkspace` 原子回落到默认工作区。
5. 当前工作区在运行中暂时不可达（外部盘断开、网络盘掉线）时，不静默回落到默认工作区；保留 `activeWorkspaceRoot`，`source` 标注照常写入默认库，文档创建返回“工作区暂不可用”，让用户重试、重新连接或显式切换目标。
6. 工作台外捕捉不读取 `activeWorkspaceRoot`，直接使用默认会话库；即使当前有一个打开的仓库，也不会把文档写进那个仓库。

激活成功后，`workbench_lastWorkspacePath` 的写入也由主进程完成。关闭自定义工作区由 `workbench.closeWorkspace` 原子完成：停止旧 watcher、激活默认工作区、写入 last path、启动默认 watcher，并返回新的 active root 和 generation；默认工作区不允许关闭。只有应用退出或初始化失败才没有 active root。渲染层不再单独 `storeSet` / `storeDelete` 这个键，避免“UI 已切到 B、主进程仍认 A”的竞态。渲染层只保存最近工作区列表、活动文件等非权威偏好。

**不提供每个会话单独的绝对保存路径。** 会话文档已经是普通 Markdown，用户可以在创建后像普通文档一样在工作区内移动；再提供一个“这段会话保存到任意绝对路径”的设置，会带来三个实际问题：

1. `source` 标注固定在默认会话库，文档却被写到任意路径，文档、原文高亮和备份会分属不同根，用户很难判断哪份是权威。
2. 同一会话可以通过来源身份被多个工作区复用；允许任意路径会鼓励同一会话产生多份互不关联的副本，删除和迁移都无法收敛。
3. 工作台文件树、Git 状态、标注对账和“打开文档”都建立在工作区相对路径上；绝对路径会绕过这些边界，增加一套没有实际收益的例外。

需要把会话资料集中到默认库时，使用工作台评论框的一次性“保存到默认会话库”；需要放进某个仓库时，在工作台内捕捉或事后移动文档。两者都不产生新的全局配置。需要单独保存一篇会话时，使用“保存整段会话”或“保存单条答复”，它们仍然走同一套目标路由和同一个 `conversationDir`，不是第二套导出系统。

`.multichat/settings.json` 只保存工作区级偏好，不进入 frontmatter，也不和标注文件混合。写入时 `setSettings` 对非法值直接拒绝；读取历史非法值时回落到 `conversations/` 并在工作区设置里提示一次。非法值包括绝对路径、盘符、`..`、符号链接逃逸，以及指向 `.multichat`、`.git`、已有普通文件或非目录路径。修改归档目录只影响后续新建文档；已有文档不会被自动搬动，仍通过 `source` / `source_key` 或旧 `source:` URL 扫描复用。该文件作为工作区配置默认进入 Git；`annotations/` 仍然默认忽略。

默认会话库本身也是一个普通工作区，可以像其他工作区一样打开、筛选和编辑；它的 `conversations/` 与 `.multichat/` 在首次捕捉或迁移时按需创建。v1 不提供“设为默认工作区”：默认会话库的路径规则固定，用户通过工作台内/外的捕捉上下文和各自工作区的 `conversationDir` 决定文档落在哪里。后续如果需要更换默认库位置，再单独设计迁移和授权，不把它混进本次实现。

### 8.3 大小限制和来源更新

- 转换后的 Markdown（包含 frontmatter，按 UTF-8 文件字节计算）超过 5MB：拒绝创建文档，保留旧笔记 JSON（如果存在），迁移场景标记 `migrationBlocked: 'oversize'`，提示“会话过大，无法在工作台打开；可继续使用原文/旧笔记查看”。不要生成空文档。自动捕捉场景下，默认会话库里的 `source` 标注仍然保留，原文高亮可用；界面只报告文档未生成。
- 转换后的 Markdown（同一口径）在 2MB 到 5MB：允许创建，但固定源码模式打开，不进入 WYSIWYG。
- 文档已存在而新快照更长或内容不同：不自动覆盖正文；标题栏提示“来源有新内容”，提供“追加 / 覆盖 / 忽略”；覆盖前备份到 `.multichat/backups/`。

### 8.4 旧笔记迁移

迁移对象是 `NoteManager` 目录下的 `notes/*.json`。旧数据不在工作区，而在应用数据目录；迁移不是启动时静默搬运，而是一次可见、可取消、可重试的升级动作。迁移只处理这套旧 JSON；本功能之前没有生产版 `.multichat/annotations`，所以不存在“工作区级 source 副本”需要合并。若预发布版本曾生成过工作区级 source 文件，必须在迁移报告中单独列出并由用户确认后再合并到默认库，不能静默覆盖。

#### 8.4.1 触发与目标

- 首次升级后，工作台检测到未迁移的旧记录时，显示一次非阻塞入口：“发现 N 条旧会话笔记、M 条标注、K 张导图”。入口放在工作区设置，另在工作台顶部显示一次可关闭的提示；不自动写入。
- 迁移目标固定为**默认会话库**，与当前打开的是哪个仓库无关。入口必须显示默认工作区的实际路径；用户不需要为了迁移先切换工作区。默认工作区不可用时只显示可操作错误，不写临时目录，也不退回当前仓库。
- 普通会话的旧 `NoteManager` 记录是应用级数据，只有 URL、标题和快照，没有可靠的“原仓库”归属；因此不能猜测某个工作区，统一迁移到默认会话库。迁移后用户仍可把某篇会话文档移到仓库，`source` 标注会按来源身份继续从默认库投影。带 `workbench.workspaceRoot/relativePath` 的记录是例外，按第 8.4.2 节的分支留在原工作区文档，不搬进默认库。
- 开始迁移时在 electron-store 写入 `legacyMigrationJob`：`jobId + targetWorkspaceRoot + targetRootKey + targetConversationDir + startedAt + status`，其中 `targetWorkspaceRoot` 是默认工作区，`targetConversationDir` 是开始时的默认库 `conversationDir`。只要任务处于 `running` 或 `paused`，`migrateLegacy` 只接受这个目标根和归档目录；切换当前工作区不能改变目标。
- `targetRootKey` 必须等于当前规范默认库的 root key。恢复任务时如果发现旧缓存或旧任务指向另一个路径，暂停任务并报告“默认库路径不一致”，不得继续写入旧目标；已完成记录留在旧目标，由用户显式导出或确认后再清理。
- 迁移期间固定使用 `targetConversationDir`；任务运行或暂停时，默认库的 `conversationDir` 修改被拒绝，避免同一任务把文档分散到两个目录。
- v1 不允许更换迁移目标。用户“放弃本次迁移”只是取消任务，已完成记录仍留在其实际目标（普通会话在默认会话库，`workbench` 记录在原工作区文档）；重新开始仍然以同一默认库为目标，只处理剩余记录。`migratedTo` 记录每条旧数据实际去了哪个根，供旧页显示和诊断，不作为身份判断。
- 开始后先展示进度（当前记录 / 总数），允许取消。取消只停止后续记录，已经完成的记录保留 `migratedAt`，下次在同一个 `jobId` 和同一个目标工作区继续。
- 迁移前对每条旧 JSON 调用 `NoteManager.backup()`，保留 `.migration-backup`；原 JSON 永远不删除，直到用户明确清理旧页。

#### 8.4.2 单条记录的迁移顺序

迁移读取必须使用独立的原始枚举器：直接 `readdir(notes/*.json) + JSON.parse + convertForMigration`，不能调用 `NoteManager.list()`、`cachedValues()` 或复用会写盘的 `listUnlocked()`。现有读取路径会按 `sourceKey` 合并记录、按 `quote` 合并批注，并在合并后 `rm` 掉旧 JSON；这些行为在迁移场景下会造成批注丢失和旧数据被删。迁移期间旧 JSON 只读，合并与删除只能由迁移器显式执行。

迁移运行期间，旧读接口也必须只读：`notes:list`、`notes:summaries`、`notes:source`、`notes:anchors-for-url`、`notes:export`、`notes:get` 以及 `findSource` 等内部路径，都不能调用会写盘的 `listUnlocked()/cachedValues()`。迁移开始时把原始 JSON 读成只读快照，读接口从快照返回；快照不可用时直接提示“迁移中，暂不可读”，不要退回普通 `list()`。迁移结束或放弃后清空快照。与此同时，`listUnlocked()` 必须对 `migratedAt` / `migrationBlocked` 非空记录跳过同源合并、quote 去重和 `rm`，否则任务结束后第一次打开旧页仍会删数据。迁移功能上线后，普通 `list()` 也不应再自动 `rm` 旧 JSON；同源合并只作为内存视图，磁盘删除必须由迁移器或用户显式清理。

1. 先按 `workbench` 分类，不能把所有记录都当普通会话。以下第 2–6 步只处理没有 `workbench` 的普通会话；`workbench` 记录在第 1 步完成文档/导图绑定后直接进入校验，不执行 `sources/` 迁移：
   - `workbench` 存在且 `notes` 为空：纯导图来源，跳过，不创建默认库文档。
   - `workbench` 存在且 `notes` 非空：这是异常但真实存在的旧工作台记录，`notes[]` 属于它指向的工作台文档，不是对话原文标注。校验 `workbench.workspaceRoot` 可访问、`relativePath` 对应文档存在后，把 `notes[]` 直接写成该文档所在工作区的 `document` 旁路，不写默认库 `sources/`，也不在默认库新建同源会话文档；如果工作区不可达或文档不存在，标记 `migrationBlocked: 'workbench-unresolved'`，报告列出，绝不按普通会话迁移。
   - 没有 `workbench`：进入下面的普通会话迁移流程。
2. 计算 `sourceKey`：优先 `noteConversationKey(url, title)`；URL 缺失或非法时使用旧记录的 `sourceKey`；两者都不可用则标记为 `unlocatable-source`，不写 `sources/`。
3. 写 `sources` 前先计算目标文件：按标注 id 去重后的条数不超过 500，序列化后的 UTF-8 字节不超过 2MB。超过任一上限时不部分写入，保留旧 JSON，标记 `migrationBlocked: 'annotation-overflow'`，报告中给出条数和字节数。未超限时把 `notes[]` 逐条写成默认工作区里的 `scope: 'source'` 标注，`source` 字段来自记录的 `sourceKey/url/platform`；标注 id 直接复用旧 `ConversationNote.id`，缺失时用“旧记录 id + 原 note 序号”生成确定性 id。按 id 去重，不能按 `quote` 去重；同一句的两个不同评论必须都保留。
4. `sourceKey` 可用时，扫描**默认工作区**的 `.md` frontmatter 找或建文档，同时识别旧格式 `source: https://...`；已有同源文档不覆盖正文，`sources/` 标注已在第 3 步合并，导图按第 5 步处理，没有文档才在默认工作区的 `conversationDir` 下新建。`sourceKey` 不可用时不做来源扫描，只按标题在默认工作区新建普通会话文档，frontmatter 仍写 `source_kind: conversation` 但不写来源地址。正文走 `snapshotToDocumentMarkdown`；有 `sourceKey` 时 frontmatter 必须写 `source_kind: conversation/source/platform/captured_at`，身份与地址不同时再写 `source_key`，否则迁移后的文档无法被 `source` 投影关联。
5. 旧会话导图按来源分开迁移。普通会话的导图写默认工作区的 `.multichat/mindmaps/*.mindmap.md`，`source` 指向第 4 步的默认库文档；`workbench` 记录的导图写它自己的 `workbench.workspaceRoot/.multichat/mindmaps`，`source` 指向该工作台文档，不搬到默认库。校验同 id、正文、文件存在后再标记。已有同 id 文件时，正文相同则跳过；正文不同不追加第二份同 id 文件，保留旧 JSON 并标记 `migrationBlocked: 'mindmap-conflict'`，交给用户选择保留哪一份。
6. 校验并标记：普通会话验证默认工作区里的文档、对应 `sources/` 旁路和导图文件；`workbench` 记录验证其工作区里的文档、`documents/` 旁路和导图文件。三项都通过才写 `migratedAt` 和 `migratedTo`。来源扫描不完整（超时或达到 2000 文件）不算成功，保留旧 JSON，报告为可重试失败。任一项失败保留旧 JSON，记录失败原因；下次只重试未完成的记录。

#### 8.4.3 迁移标记与旧页并行期

迁移标记必须落到类型和读写路径上：

- `NoteConversation` 增加 `migratedAt?: number`、`migratedTo?: string` 和 `migrationBlocked?: 'oversize' | 'empty-snapshot' | 'unlocatable-source' | 'annotation-overflow' | 'mindmap-conflict' | 'workbench-unresolved' | 'verify-failed'`。`verify-failed` 表示写入后回读文档、旁路或导图失败，记录仍可重试，但目标状态无法确认。`migratedAt` 与 `migrationBlocked` 互斥；`migratedTo` 只用于旧页显示实际目标（普通会话是默认会话库，`workbench` 记录是其原工作区），不作为身份判断。`StoredConversation`、`convert()`、合并和导出/导入都要保留这些字段；否则下一次读盘会丢掉标记，迁移重跑会把用户后来删掉的标注复活。
- 迁移入口先跳过 `migratedAt` 非空的记录；只有文档、旁路、导图三项都确认存在才写 `migratedAt`。`migrationBlocked` 非空的记录不重复自动迁移，只在用户处理后重试。
- `legacyMigrationJob` 处于 `running` 或 `paused` 时，所有旧写接口整体拒绝，避免迁移枚举之后又冒出新的旧格式记录；`migratedAt` 或 `migrationBlocked` 非空的记录在任务结束后仍然只读。
- `migratedAt` 或 `migrationBlocked` 非空的记录，旧页只读；旧 `notes:*` 和 `mindmaps:*` 写接口在主进程直接拒绝，不能只靠隐藏按钮。
- 迁移中的记录加进程内锁，避免旧页和迁移同时写同一个 JSON。
- 迁移任务结束后，未迁移且没有阻塞标记的记录保持现状，旧页可读写；任务运行或暂停期间仍然全部只读。工作台顶部提示“还有 N 条旧笔记未迁移”，但不用模态框阻塞。
- 阻塞记录的详情里提供“重试”；只有用户确认后清除 `migrationBlocked`，不能因为一次失败就永久锁死。
- `notes.cancelMigration({ jobId })` 必须绑定任务；jobId 不匹配时拒绝。旧页和迁移入口显示默认会话库路径；`workbench` 记录另列原工作区，明确“切换当前工作区不会改变迁移目标”。
- 所有新的选区采集、`NoteCaptureModal`、旧 `NotesPage`、Quick 窗口先切到新 API，再标记迁移完成。旧 `notes:save/update/delete` 在切换后只允许兼容读；`notes:standalone/import` 在迁移期拒绝创建新的旧格式记录，导入改走工作区文档导入。不要一边写旧 JSON、一边写新旁路。
- 旧页的删除动作对 `migratedAt` 或 `migrationBlocked` 非空记录禁用；用户要清理时走“清理旧数据”，先确认其实际目标（普通会话默认库，`workbench` 记录原工作区）里的文档、标注、导图都存在。删除旧 JSON 不删除这些目标里的 `sources/`、`documents/` 和文档。

#### 8.4.4 不能完整迁移的记录

- **转换后最终 Markdown 超过 5MB（含 frontmatter，UTF-8 字节）**：不创建文档，避免生成打不开的空壳；可解析且未超过旁路上限的标注仍写入默认工作区的 `sources/`，原文高亮可用。记录标记 `migrationBlocked: 'oversize'`，旧页只读并在迁移报告中逐条列出；保留旧 JSON，不进入“迁移完成”统计。清理旧页时必须保留这些记录，不能一刀切删除。
- **快照为空但仍有标注或导图**：不创建空文档；有 `sourceKey` 的标注写入默认工作区的 `sources/`；导图无法绑定文档时保留在旧 JSON。记录标记 `migrationBlocked: 'empty-snapshot'`，旧页只读，报告列出。
- **没有可用 URL / sourceKey**：不写 `sources/`。能生成文档时，把能在正文中定位的旧标注写成默认工作区文档的 `document` 标注；定位不到的旧标注保留在旧 JSON，标记 `migrationBlocked: 'unlocatable-source'`，报告中逐条列出。
- **旁路文件超过上限**：条数超过 500 或序列化后超过 2MB 时，不部分写入；保留旧 JSON，标记 `migrationBlocked: 'annotation-overflow'`，报告给出条数和字节数，提供导出或拆分入口。
- **同 id 导图正文不同**：不追加第二份同 id 文件，也不改文件名冒充新 id；保留旧 JSON，标记 `migrationBlocked: 'mindmap-conflict'`，报告列出现有文件与冲突正文，让用户选择保留哪一份。未冲突的标注和文档可以先完成，但记录不能标记 `migratedAt`。
- 同时命中多个阻塞原因时，`migrationBlocked` 只记录阻止文档创建的首要原因，报告里列出全部原因；不要用后一个原因覆盖前一个。
- **同源文档已存在但内容不同**：默认工作区里已有同一来源身份的文档时不覆盖用户正文；只合并默认库的 `sources/` 标注和导图。正文差异在报告中提示“已保留现有文档”，不自动选择哪一份为准。
- **旧 JSON 损坏或无法解析**：不写任何新文件，保留原文件，列入迁移报告；旧页仍尝试读取，读取失败时显示具体文件路径，不阻塞其他记录。
- **默认会话库不可用**：这是任务级阻塞，不是单条记录阻塞。迁移不启动；已经开始的任务暂停并保留进度，不写 `migratedAt`，不把数据退回当前仓库。恢复默认库可写后从同一 `jobId` 继续。
- **旧 `workbench` 记录带 `notes` 但其工作区/文档不可达**：不写默认库 `sources/`，不新建默认库会话文档；保留旧 JSON，标记 `migrationBlocked: 'workbench-unresolved'`，报告列出工作区路径和相对路径，等原工作区恢复后重试。

### 8.5 停写工作台 snapshot

`prepareWorkbenchSource` 和 `createWorkbenchRecordUnlocked` 目前都会在 `workbench` 记录里写 `snapshot = content`，这是第二份正文。Phase 2 要同时移除这两处：

- 工作台记录不再持久化正文，只保留 `workbench` 元信息和导图绑定。
- `MindmapService` 对 `source.workbench` 的上下文改为读取 Markdown 文件，不再读 `conversation.snapshot`。
- `findWorkbenchByPathUnlocked` 等依赖 snapshot 的对账逻辑改用 `contentHash + size + mtime`。
- 迁移完成前保留旧字段的只读兼容，避免导图生成断档。

### 8.6 旧页面收口

`NotesPage`、`NotesConversationCards`、`NotesSourcePane` 以及只为旧页服务的 `notesWorkspace.css` 已删除；`useWebviewNotes` 与 `notes:open-popover` 事件链路也已移除，原文高亮统一走 `useSourceAnnotations`。`NoteManager`、`notes:*` 读取接口和迁移器保留，原因是旧数据仍可能包含 `migratedAt` 为空或 `migrationBlocked` 非空的记录，迁移与兼容读取不能断档。

`ConversationMindmapPanel` 仍被工作台导图入口使用，保留并读写文件化导图，不再把导图写回 `conversation.mindmaps`。

## 9. 工作台 UI 集成

### 9.1 左侧：一棵树

- 文件树保持现状，不新增“对话 / 文件”两个 tab，也不放一个容易被误认为真实目录的“对话资料”虚拟节点。
- 用户已明确移除树头的“对话资料”筛选 chip；文件树按普通目录结构展示当前工作区的全部文件，不按 `source_kind` 过滤。会话文档与普通 Markdown 在文件树中一视同仁。
- 会话文档默认放在文档目标工作区的 `conversationDir`（默认 `conversations/`），用户可以移到任意目录。工作台内捕捉的文档在当前仓库，工作台外捕捉的文档在默认会话库；文件树只展示当前工作区，不把默认库的文档混进当前仓库。
- 普通文件树节点不显示平台徽标，避免为了每个节点解析 frontmatter；平台信息只在打开的文档属性面板和右栏显示。

### 9.2 右栏：AI / 标注 / 导图

`WorkbenchRightPane` 扩展为：

```ts
export type WorkbenchRightPane = 'ai' | 'annotations' | 'mindmap' | null
```

- 右栏顶部用三个短标签切换：AI、标注、导图。标签是名词，不写解释性句子。
- 标注面板显示当前文档的 `document` 标注和 `source` 投影：引文两行截断、评论、时间、来源图标。`document` 从当前文档所在工作区读取，`source` 从默认会话库读取。点击卡片定位正文；正文点击 MarkNode 时选中卡片，并在文字旁展示评论与编辑入口。
- 面板支持“全部 / 文档 / 原文 / 未定位”筛选，不增加新的页面。
- 切换到标注面板时，AI Webview 按现有休眠策略挂起，避免后台占资源。
- 导图面板保持现状；会话文档和普通文档都可以生成导图，导图仍然落在 `.multichat/mindmaps`。

### 9.3 原文侧栏

会话文档的标题栏增加“原文”动作，直接打开工作台已有的 AI 右栏并定位到该会话，不创建全屏弹层：

- 复用 AI 右栏的 Webview、原文高亮、选区采集和评论回显；点击原文高亮直接显示该条评论。
- 右栏内可以继续选中文字并“标注”，产生的仍然是 `source` 标注。
- 原文高亮始终从默认会话库读取 `source` 标注；即使当前文档在仓库里，也不读当前仓库的 `sources/`。
- 关闭右栏回到文档，标注面板自动刷新。
- 没有可用来源地址或 `source_key` 的文档不显示“原文”动作。
- 原文标注的删除/清理也在原文高亮评论卡中提供，因为它不随文档删除；确认框要说明删除会影响所有工作区的原文高亮。

### 9.4 视觉规范

| 状态 | 样式 |
|---|---|
| `==` 文本高亮 | `bg-amber-200/75 dark:bg-amber-300/25`，实色，无下划线 |
| 普通标注 | `bg-amber-300/15 dark:bg-amber-300/10` + 1px 虚线下划线 `border-amber-600/60` |
| 激活标注 | `bg-amber-300/30 dark:bg-amber-300/20` + 实线下划线 + 右侧小圆点 |
| 未定位标注 | 正文不画；侧栏引文使用 tertiary 文本色 + 警告图标 |
| `source` 投影 | 与普通标注同底色，但下划线用更细的点线，侧栏加链接图标；不加文字说明 |

颜色不是唯一区分手段：虚线下划线、右侧圆点和侧栏图标共同承担识别。深色模式下降低透明度，避免大面积琥珀色影响阅读。

界面不写“这是标注层”“高亮不会修改 Markdown”之类的说明文字。用户通过“选中文字 → 标注 → 侧栏出现评论”就能理解行为。

## 10. 分层与 IPC

### 10.1 文件与模块

| 层 | 文件 | 职责 |
|---|---|---|
| shared | `src/shared/types/annotations.ts` | `Annotation/AnnotationAnchor/AnnotationScope/CaptureContext`、IPC 入参出参类型 |
| shared | `src/shared/utils/annotationAnchors.ts` | 纯文本锚点匹配、打分、未定位结果 |
| shared | `src/shared/utils/noteTranscript.ts` | 新增 `snapshotToDocumentMarkdown`，保留旧 XML 解析给原文面板 |
| main | `src/main/services/annotationService.ts` | `documents/` 读写（文档所在工作区）与 `sources/` 读写（默认工作区）、路径校验、原子写、记录级合并 |
| main | `src/main/services/conversationDocumentService.ts` | 按 `captureContext` 解析文档目标工作区，扫描来源地址/身份，创建或复用会话文档 |
| main | `src/main/services/workbenchService.ts` | 默认工作区解析、原子 `activateWorkspace` / `closeWorkspace`、`conversationDir` 读写与校验 |
| main | `src/main/ipcHandlers.ts` | 注册 `annotations:*`，广播 `annotations:changed` |
| preload | `src/preload/index.ts` | 暴露 `window.api.annotations`；类型由 `API` 派生 |
| renderer | `src/renderer/src/store/annotationStore.ts` | 当前文档标注、按 `sourceKey` 缓存的全局 source 标注、选中项、筛选、加载状态 |
| renderer | `src/renderer/src/components/workbench/WorkbenchAnnotationPlugin.tsx` | Lexical 内的 MarkNode 创建、定位、对账、清理 |
| renderer | `src/renderer/src/components/workbench/WorkbenchAnnotationPanel.tsx` | 右栏标注列表与评论编辑 |
| renderer | `src/renderer/src/hooks/useSourceAnnotations.ts` | 共享 source 高亮/点击/采集，只接收 `sourceKey` 和 `captureContext`，接入 WebviewCard 和 WorkbenchAiSidebar |

不建议把标注状态塞进已经很大的 `workbenchStore`。标注有独立的加载、保存、选中和筛选状态，单独一个小 store 更容易控制重渲染；但也不要再建一个全局数据层。

### 10.2 IPC 契约

按记录操作，不做整表提交：

```ts
annotations.listDocument({ workspaceRoot, relativePath })
  -> { success, data?: Annotation[], error? }

annotations.listSource({ sourceKey })
  -> { success, data?: { source: AnnotationSource | null, annotations: Annotation[] }, error? }

annotations.upsertDocument({ workspaceRoot, relativePath, annotation })
  -> { success, data?: Annotation, error? }

annotations.upsertSource({ sourceKey, source, annotation })
  -> { success, data?: Annotation, error? }

annotations.deleteDocument({ workspaceRoot, relativePath, id })
  -> { success, error? }

annotations.deleteSource({ sourceKey, id })
  -> { success, error? }

annotations.reconcileDocument({ workspaceRoot, relativePath, anchors })
  -> { success, data?: { updated: number, unlocated: string[] }, error? }

annotations.captureSource({
  annotationId: string,
  captureContext: 'workbench' | 'global',
  workspaceRoot?,
  platform, title, url, snapshot, quote, anchor, comment
})
  -> { success, data?: { annotation, document?: { workspaceRoot, relativePath }, documentError? }, error? }

annotations.ensureDocumentForSource({ sourceKey, captureContext: 'workbench' | 'global', workspaceRoot? })
  -> { success, data?: { document?: { workspaceRoot, relativePath }, documentError? }, error? }

workbench.getDefaultWorkspace()
  -> { success, data?: { path: string, writable: boolean }, error? }

workbench.getSettings({ workspaceRoot })
  -> { success, data?: { conversationDir: string }, error? }

workbench.setSettings({ workspaceRoot, settings: { conversationDir } })
  -> { success, error? }

workbench.activateWorkspace({ workspaceRoot })
  -> { success, data?: { activeWorkspaceRoot, generation }, error? }

workbench.closeWorkspace({ workspaceRoot, generation })
  -> { success, data?: { activeWorkspaceRoot, generation }, error? }

notes.migrateLegacy({ jobId? })
  -> { success, data?: { jobId, targetWorkspaceRoot, targetConversationDir, total, migrated, blocked, failed, cancelled }, error? }

notes.cancelMigration({ jobId })
  -> { success, data?: { status: 'paused' }, error? }

notes.resumeMigration({ jobId })
  -> { success, data?: { jobId, targetWorkspaceRoot, targetConversationDir }, error? }

notes.abandonMigration({ jobId })
  -> { success, error? }
```

规则：

- `listDocument/upsertDocument/deleteDocument/reconcileDocument` 只操作文档所在工作区；`workspaceRoot` 必须等于主进程的 `activeWorkspaceRoot`，不能从另一个工作区读文档标注再写回。
- `listSource/upsertSource/deleteSource` 不接受 `workspaceRoot`。主进程固定解析默认工作区；即使渲染层多传了一个根，也不能改变 source 的读写位置。
- `listDocument` / `listSource` 在旁路文件不存在时返回空数组（`source` 为 `null`），不把“还没有标注”当错误；只有文件存在但损坏时才返回读取错误。
- `captureSource` 先写默认工作区的 source 标注，再按 `captureContext` 解析文档目标。`workbench` 必须使用 active root；`global` 强制使用默认工作区；`workspaceRoot` 在 `global` 下无效，在 `workbench` 下只做一致性校验。
- `captureSource` 按 `annotationId` 幂等 upsert；同一 id 重复调用只更新同一条 source，不能追加。`ensureDocumentForSource` 只补文档，不写 source；用于文档失败后的重试或切换保存目标。它必须先确认默认库已有对应 `sourceKey`，不存在时返回 `SOURCE_NOT_FOUND`，不能凭空创建一篇没有标注的文档。
- `upsert` 只写一条；同一 id 以 `updatedAt` 较新的为准。不同 id 永远都保留，不能因为 quote 相同就合并。
- `delete` 必须显式传 id；不能从“当前列表里没有”推断删除。
- `reconcileDocument` 只更新 document 标注的 `quote/anchor`，不能碰 source 标注。
- `captureSource` 文档创建失败时仍返回 `success: true` 和已保存的 `annotation`；`document` 为空，`documentError` 说明是“无活动工作区 / 工作区不可用 / 扫描不完整 / 超限 / 写入失败”中的一种，界面提示“未生成文档”并可重试。
- `workbench.getDefaultWorkspace` 只读，返回默认会话库的实际路径和可写状态；修改默认库路径不是 v1 的 API。
- `workbench.getSettings / setSettings` 只操作当前 `activeWorkspaceRoot` 的 `.multichat/settings.json`；默认会话库作为普通工作区打开后，同样通过这套接口读写自己的 `conversationDir`。全局捕捉在主进程内部读取默认库设置，不经过渲染层的跨根写接口。`conversationDir` 必须是工作区内相对路径，非法值直接拒绝，不能悄悄写到根目录。`legacyMigrationJob` 运行或暂停时，默认库的 `conversationDir` 修改被拒绝，任务按 `targetConversationDir` 继续。
- `workbench.activateWorkspace` 原子完成“校验路径 → 授权 → 设置 active root → 写 last path → 启动 watcher → 返回 generation”。渲染层必须等它完成后再发起捕捉；`captureSource` 只使用 active root，传入的 `workspaceRoot` 只做一致性校验。
- `workbench.closeWorkspace` 只接受当前 active root 和 generation。它先确认默认工作区可用，再原子停止旧 watcher、激活默认工作区、写入 last path、启动默认 watcher；默认库不可用时返回错误并保留当前 active root，不能先把旧工作区停掉再失败。默认工作区不可关闭；过期 generation 直接拒绝，不能把已经切走的工作区关掉。
- `notes.migrateLegacy` 首次调用创建 `legacyMigrationJob`，目标固定为当前规范默认工作区；后续调用必须带同一个 `jobId`，且 `targetRootKey` / `targetConversationDir` 不能变。恢复时发现规范默认库路径不一致，暂停任务并报告，不写旧目标。迁移过程中通过事件上报进度；取消只暂停，不回滚已完成的记录；`abandonMigration` 才清除任务，且必须提示“已完成记录会留在其实际目标（普通会话默认库，`workbench` 记录原工作区）”。

校验规则放在主进程：

- `document` 类 IPC 的 `workspaceRoot` 必须等于主进程的 `activeWorkspaceRoot`。只有 `workbench.activateWorkspace` 的启动恢复路径可以读取 `workbench_lastWorkspacePath`；其余 IPC 在 `activeWorkspaceRoot` 建立前一律拒绝，不能拿 last path 绕过授权、watcher 和 generation。目录必须存在且已授权；渲染层不能随意指定任意磁盘路径。
- 工作区设置也只在 active root 下读写；想修改默认会话库的 `conversationDir`，先通过“打开会话库”激活默认工作区，不能从当前仓库跨根写默认库设置。
- `source` 类 IPC 没有 `workspaceRoot` 入参；根由主进程的默认工作区解析器决定。默认工作区不可用时返回 `CONVERSATION_LIBRARY_UNAVAILABLE`，禁止回退到 active root。
- `captureContext` 只能是两个枚举值。`workbench` 必须存在 active root；`global` 不接受任何其他根。
- `ensureDocumentForSource` 使用与 `captureSource` 相同的目标解析规则；它必须先读到默认库的 `sourceKey`，不能只凭 `sourceKey` 建空文档。
- `relativePath` 必须解析到工作区内，禁止 `..` 和符号链接逃逸。
- `id` 必须是 UUID；`document` 类接口只能写 `scope: 'document'`，`source` 类接口只能写 `scope: 'source'`，不接受由渲染层改 scope 绕过存储根。
- `captureSource` 的 `annotationId` 必须是 UUID；同一 id 重复提交时 `sourceKey` 必须一致，不一致直接拒绝，不能借 upsert 改掉已有标注的归属。
- `quote/comment` 长度、标注条数、文件大小都设上限。
- `source.url` 只接受 `https://`；`sourceKey` 必须由 `noteConversationKey` 归一化，实际文件名仍用 hash，不能拿任意字符串当路径。
- `conversationDir` 必须是工作区内相对目录；拒绝绝对路径、盘符、`..`、符号链接逃逸、`.multichat`、`.git`、已有普通文件和非目录路径。

### 10.3 事件

- `annotations:changed` 分两种载荷：`{ scope: 'document', workspaceRoot, relativePath }` 用于刷新当前文档侧栏；`{ scope: 'source', sourceKey }` 用于刷新所有打开同一会话的 Webview 和原文侧栏。不要用当前工作区过滤 source 事件。
- `notes:migration-progress`：携带 `jobId, targetWorkspaceRoot`（普通会话固定为默认工作区）、`targetConversationDir, total, completed, currentTitle, blocked, failed`；`workbench` 记录的实际目标在其记录/报告里单独列出。迁移结束后发一次终态，渲染层据此刷新工作台和旧页状态。
- 外部文件 watcher 同时监听默认工作区的 `.multichat/annotations/sources` 和当前文档工作区的 `.multichat/annotations/documents`；不要因为旁路文件变化触发整树重扫。
- 工作区切换或 `closeWorkspace` 回退时清空当前文档标注缓存和当前文档选中项，但保留按 `sourceKey` 缓存的全局 source 标注；切换后重新向默认工作区校验一次，避免把上一个工作区的文档标注显示到新文档。
- `workbench:rename-node`、`delete-node`、`delete-nodes` 在完成文件操作后只调用 annotation service 的 `rekey/removeDocument`；source 标注不受文档改名或删除影响。失败时给出可见状态，不能只 warn。
- 所有会写 `NoteConversation` 的 IPC 都要加校验：`notes:save/update/delete/standalone/import`，以及 `mindmaps:add/start/modify/delete/update/apply/blank-source/import-legacy`。`legacyMigrationJob` 运行或暂停时全部拒绝；任务结束后，`migratedAt` / `migrationBlocked` 非空记录继续拒绝。旧页只读必须由主进程保证，不能只隐藏 UI 按钮。
- 迁移运行或暂停时，`notes:list/summaries/source/anchors-for-url/export/get` 从迁移开始时的只读原始快照返回，不调用 `listUnlocked()/cachedValues()`；快照不可用时返回“迁移中，暂不可读”。任务结束后，`listUnlocked()` 对 `migratedAt` / `migrationBlocked` 非空记录跳过同源合并、quote 去重和 `rm`；普通 `list()` 不再自动删除旧 JSON，合并只做内存视图。
- `workbench:mindmap-migrate` 在 `legacyMigrationJob` 处于 `running` 或 `paused` 时跳过，避免它和旧笔记迁移同时改写同一批 JSON；迁移结束后再执行。

## 11. 边界与失败处理

| 场景 | 行为 |
|---|---|
| 引文在文档中找不到 | 标注保留，侧栏显示未定位；不自动删除 |
| 引文出现多次 | 用 `prefix/suffix + occurrence + offsetHint` 打分；仍不唯一时选取得分最高者，并在侧栏标“可能位置” |
| 文档被外部改名 | 按路径、路径表、内容哈希三级找回；唯一才认领，多个候选不猜 |
| 文档被外部删除 | `documents` 旁路文件保留；文档恢复后可重新关联；`sources` 旁路不受影响 |
| 会话页面 DOM 改版 | 高亮可能暂时找不到；保留标注，重试和 DOM 变化后重新匹配；不因为一次 miss 删除 |
| 会话页面虚拟滚动 | MutationObserver + 滚动去抖补画；标注未出现前侧栏仍可打开评论 |
| 同一会话保存到两个工作区 | 两个工作区各自有一篇会话文档，但默认工作区只有一份 `sources` 文件；两篇文档都投影同一组 source 标注；不按 quote 合并不同 id |
| 工作台内不想写入当前仓库 | 评论框一次性选择“保存到默认会话库”；本次文档和 source 都进默认库，当前仓库不产生文件；下一次捕捉仍回到当前工作区默认行为 |
| 文档被移到另一个工作区 | `document` 标注不跟随单篇 `.md`；`source` 投影仍可通过 frontmatter 来源身份从默认库恢复；界面提示重新关联或复制旁路 |
| 同一文档被两个窗口编辑 | 正文走现有 mtime 冲突处理；标注按 id + `updatedAt` 合并，不同 id 都保留 |
| 重复 id / 零 id / 跨文档粘贴 | 每次 update 清理；零 id unwrap；只在 `document` 和 `source` 两路都加载完成后，移除不在有效 id 集合里的标记 |
| `source` 投影异步加载 | 加载完成前不清理未知 id；两路都完成后再对账；投影与 `document` 标注重叠时跳过投影，侧栏保留两条 |
| 默认库读取 `source` 失败 | 不把现有投影当成未知 id 清理；侧栏和原文侧栏显示读取错误；恢复后重试，不退回当前仓库 |
| 标注与 `==` 重叠 | 允许共存；`==` 负责背景，标注负责下划线和圆点；MarkNode theme 背景透明 |
| 选区跨 block | 第一版拒绝；提示选择单个段落内的正文 |
| 代码块/图片选区 | 第一版拒绝创建标注 |
| 超大文档 | 最终 Markdown 含 frontmatter 按 UTF-8 字节计算；2MB 以上固定源码模式，5MB 以上拒绝创建会话文档；标注卡片在源码里定位 |
| 没有工作区时在原文标注 | 工作台内返回 `NO_ACTIVE_WORKSPACE`，提示选择“保存到默认会话库”；工作台外直接写默认工作区。两种情况都不伪造当前工作区 |
| 关闭自定义工作区 | `workbench.closeWorkspace` 原子停止旧 watcher、激活默认库并写 last path；不产生无 active root 的中间态；默认库不可关闭 |
| 关闭时默认库不可用 | `closeWorkspace` 返回错误并保留当前 active root，不先停掉旧工作区；用户可修复默认库后重试 |
| 自动捕捉时当前工作区路径失效 | 保留 `activeWorkspaceRoot`；source 标注仍写入默认库，文档返回“工作区暂不可用”；不静默改存默认库，用户可重试或显式切换目标 |
| 默认会话库不可用 | `captureSource` 直接失败，返回 `CONVERSATION_LIBRARY_UNAVAILABLE`；不写 source，不在当前仓库创建半套文档，不回退到 active root |
| 默认库缓存指向非规范路径 | `ensureDefaultWorkspace` 用 resolve/realpath 比较后忽略并清理旧缓存键，保留旧目录内容并提示；迁移任务 `targetRootKey` 不一致时暂停，不写旧目标 |
| `conversationDir` 非法 | 写入时直接拒绝；读取历史值时回落到 `conversations/`；拒绝 `.multichat`、`.git`、普通文件和非目录路径 |
| 来源扫描不完整 | 超时或达到 2000 文件时只保存 `source` 标注，不新建或复用文档；报告为可重试失败，不写半套状态 |
| 迁移中途失败 | 保留旧 JSON，旧页面可继续读；迁移可重跑，按标注 id 去重；`migratedAt` 非空即跳过；`migrationBlocked` 记录不自动重试 |
| 迁移中切换工作区 | 普通会话的 `legacyMigrationJob` 锁定默认工作区；`workbench` 记录锁定其原工作区；切换当前工作区不改变任何目标，也不影响迁移进度；v1 不允许换目标 |
| 迁移中修改默认库 `conversationDir` | 任务运行或暂停时拒绝修改；任务固定使用 `targetConversationDir`，不把同一批文档分散到两个目录 |
| 旧 `workbench` 记录带 `notes` | 按其 `workspaceRoot/relativePath` 写成该文档的 `document` 旁路；工作区/文档不可达标记 `workbench-unresolved`，不写默认库 `sources/`、不新建默认库会话文档 |
| 旧记录批注超过旁路上限 | 不部分写入；保留旧 JSON，标记 `annotation-overflow`，报告条数与字节数，提供导出或拆分 |
| 旧导图同 id 冲突 | 不写第二份同 id 文件；保留旧 JSON，标记 `mindmap-conflict`，让用户选择保留哪一份 |
| 旧会话导图 | 单独迁移到默认工作区的 `.multichat/mindmaps` 并绑定默认库里的会话文档；未迁移成功不标记旧 JSON |
| 旧页并行期写导图 | 对 `migratedAt` 或 `migrationBlocked` 非空记录，主进程拒绝 `mindmaps:*` 和 `notes:*` 写入，避免旧页新建的导图丢失 |
| Git 合并冲突 | 标注默认忽略；用户自行纳入版本管理时，按记录 id 手工合并，不承诺自动解决 JSON 数组冲突 |

## 12. 实施阶段

### Phase 0：数据层

- 新增 `annotations.ts` 类型（含 `CaptureContext`）、`annotationAnchors.ts` 纯函数、`annotationService.ts`。
- 实现 `documents/` 与 `sources/` 的双根读写：`source` 固定默认工作区，`document` 固定文档所在工作区；路径校验、原子写、记录级合并。
- 增加默认工作区解析器，确保 `sources/` 可独立于当前工作区创建和校验。
- 新增 `snapshotToDocumentMarkdown`，用真实会话样本做 Markdown 导入导出验证。

退出条件：同一文档两次写入不丢标注；外部改名后能按内容哈希找回；损坏文件不会导致工作区打不开；XML 快照转换后不含 `<user>/<assistant>`；在 A 工作区写 source、在 B 工作区写 document 时两个根不串。

### Phase 1：文档标注

- 注册 MarkNode，新增标注插件、浮动工具栏入口、右栏标注面板。
- 实现创建、编辑、删除、点击定位、未定位展示、每次 update 的 id 清理。
- Markdown 导入/导出链路加“annotation-sync 不回写”和“同一导入状态下应用前后序列化结果一致”的检查。

退出条件：在 `npm run dev` 中完成“选中 → 标注 → 写评论 → 重启 → 仍在”的闭环；`.md` 文件不出现标注标记。

### Phase 2：会话文档与迁移

- 实现 `annotations:capture-source`、`annotations:ensure-document-for-source`、会话文档创建/复用、来源更新提示；`captureSource` 按 `annotationId` 幂等，重试不追加 source。
- 实现捕捉路由：`workbench` 写当前工作区，`global` 写默认会话库；先写默认库的 source，再写目标文档；新增原子 `workbench:activate-workspace` / `workbench:close-workspace` 和主进程 `activeWorkspaceRoot`；工作台评论框提供一次性“保存到默认会话库”；`conversationDir` 默认 `conversations/`，两个工作区各自读取自己的设置；不增加每会话绝对保存路径。
- 切换所有采集/编辑入口到新 API：`webviewManager`、`NoteCaptureModal`、Quick 窗口。
- 迁移旧 `NoteConversation` 和旧会话导图：普通会话到默认会话库，带 `workbench` 的记录到其原工作区文档；使用独立原始 JSON 枚举器，绕开 `list()` 的同源合并、quote 去重和自动 `rm`；增加一次性迁移入口、`legacyMigrationJob`、默认库路径提示、进度、暂停/恢复/放弃和失败报告；迁移目标不随当前工作区变化。
- `NoteConversation` 增加并保留 `migratedAt` / `migratedTo` / `migrationBlocked`；已迁移或阻塞记录的 `notes:*` / `mindmaps:*` 写入由主进程拒绝；迁移期暂停 `workbench:mindmap-migrate`。
- 停写工作台 `snapshot`，把 `MindmapService` 的来源切到 Markdown 文件。

退出条件：所有转换后最终 Markdown 不超过 5MB 的旧笔记和旧导图都能在默认会话库打开；旧 `workbench` 记录带 `notes` 时按原文档工作区分流，不混入默认库 source；旧高亮在文档侧栏可见；迁移可重复执行；同一 quote 的两条不同评论都保留；迁移不删除任何旧 JSON；没有双写；捕捉失败重试不会重复 source。超过 5MB、批注溢出、导图冲突、无法定位来源或工作台文档不可达的记录保留旧页只读入口，并在迁移报告中逐条列出，不能宣称“全部迁移完成”。工作台内捕捉、工作台外捕捉、一次性切到默认库、切换工作区、关闭自定义工作区、修改两个工作区的 `conversationDir` 后，会话文档和 source 标注都落在预期根；非法目录的写入被拒绝、读取回落。

### Phase 3：原文回显与收口

- 接通默认库 `sources/` 读取、共享 `useSourceAnnotations`、AI 右栏原文侧栏；所有入口只传 `sourceKey` 和 `captureContext`。
- 多 AI 模式和工作台右栏都能显示 `source` 标注；切换工作区后仍从默认库刷新，不从当前仓库找 `sources/`。
- 顶部“笔记”正式改为工作台入口，旧页面重定向；稳定后删除旧写接口。

退出条件：在原文标注后，刷新页面、切换 SPA 路由、切换工作区、重启应用，回到同一会话仍能看到高亮；点击高亮能打开评论；默认库不可用时明确报错而不是静默丢失。

## 13. 验收标准

以下项目都要在 `npm run dev` 的桌面环境里实际触发，不能只看类型检查。

### 文档与标注

1. 新建普通文档，选中一段文字点“标注”，输入评论并保存；重启应用后标注仍在，正文没有多出 `==`、HTML 或隐藏字符。
2. 点击正文里的标注，右栏选中对应卡片并滚动到可视区域；点击卡片，正文定位并高亮。
3. 删除评论但保留标注，侧栏显示“无评论”状态；删除标注后正文样式消失，旁路文件同步更新。
4. 在同一段文字上先用 `==` 高亮，再添加标注：两种样式可区分，Markdown 里只有 `==`，没有标注痕迹。
5. 编辑标注覆盖的文字，标注跟随；修改前后文，仍能定位；删掉整段文字，标注在侧栏显示未定位且评论不丢。
6. 在标注末尾按回车、复制粘贴、撤销重做：不出现重复 id、零 id 高亮或点不开的标注。
7. 从文档 A 复制带标注的文字到文档 B：B 不显示无主高亮，原标注仍指向 A。
8. 源码模式切换到富文本：标注重新出现；在源码里改掉引文后切回，标注显示未定位而不是报错。
9. 最终 Markdown（含 frontmatter，UTF-8 字节）在 2MB 到 5MB 的文档：固定源码模式，正文可读；点击标注卡片后在源码里定位并滚动，不整篇导入 Lexical，不出现整页卡死。
10. 最终 Markdown 超过 5MB 的会话：创建文档被拒绝，给出可操作提示；不生成空文档，默认库的 `source` 标注仍保存，旧数据不受影响。

### 会话与原文回显

11. 在工作台的 AI 侧栏选中文字点“标注”：默认工作区的 `sources/` 下出现会话标注文件；会话文档创建或复用在当前工作区的 `conversations/`；文档侧栏出现投影；原文页面出现高亮。
12. 在主界面 AI 页面（工作台外）选中文字点“标注”：`source` 写入默认工作区，会话文档也写入默认工作区的 `conversations/`；当前仓库不新增文档或 `.multichat/annotations/sources`。
13. 刷新原文页面、切换同一会话的 SPA 路由、重启应用后，高亮仍在；点击高亮弹出评论，编辑后若存在对应会话文档，文档侧栏同步。
14. 从工作区 A 切到 B：原文高亮仍从默认库显示；当前文档的 `document` 标注随当前文档切换；B 的 `.multichat/annotations` 不出现 A 的 source 副本。
15. 删除当前仓库里带标注的会话文档：`document` 标注一起删除；默认库的 `source` 标注和原文高亮仍然存在；界面没有把两者混为一谈。
16. 在文档里修改 `source` 标注的引文：文档投影变成未定位，但原文高亮仍在；评论仍可编辑。
17. 同一会话在工作区 A 和 B 各捕捉一次：两个工作区各有一篇会话文档；默认库只有一份 `sources` 文件；两篇文档都投影同一组 source 标注；不按 quote 合并不同 id。
18. 长会话只渲染部分消息：滚动到标注所在消息后高亮出现；滚动前后点击侧栏卡片都能定位或提示未加载。
19. 原文页面点击高亮的网络/console 消息里不包含评论正文，只包含 id 和坐标。
20. 文档和 `sources/` 两路异步加载、编辑器 update、粘贴、撤销重做之后，`source` 投影仍然存在；不会因为“目标文档的 `documents` 文件里没有这个 id”被清理掉。
21. 从仓库里的会话文档在 AI 右栏打开原文：高亮和评论来自默认库；在原文高亮评论卡中删除一条 source 标注时，确认框说明会影响所有工作区的原文高亮。
22. 默认会话库不可用：原文不画新高亮，界面给出“会话库暂不可用”；当前仓库即使有旧 `.multichat/annotations/sources` 也不被当作回退数据。

### 迁移与导航

23. 旧 `NoteConversation` 有 3 条标注、1 张导图：迁移后文档正文是标准 Markdown，落在默认会话库的 `conversations/`；frontmatter 有 `source_kind: conversation/source/platform/captured_at`，身份与地址不同时再有 `source_key`；3 条标注在默认库的 `sources/`；导图落在默认库 `.multichat/mindmaps` 并能从右栏打开；正文没有 `<user>/<assistant>`。
24. 迁移执行两次：不产生重复文档、不产生重复标注、不产生重复导图文件；删除一条新标注后再次迁移，已删除的标注不会复活。
25. 迁移中途杀掉应用：旧 JSON 仍可读；重启后重跑迁移成功；旧页只读期间不会写入旧 JSON；尝试在旧页生成、调整、删除导图被主进程拒绝。
26. 顶部不再有独立“笔记”入口；`NotesPage` 路由与组件已删除，打开历史笔记统一进入工作台文件树，不出现空白页。
27. 工作台左侧只有一棵树，没有“对话资料”筛选 chip；会话文档和普通 Markdown 都按目录结构展示，搜索能命中会话标题、平台和正文。
28. 外部把文档从 `conversations/` 移到其他目录：筛选仍能找到；`document` 标注按内容哈希重新认领；`source` 回显不受影响。
29. 当前工作区不是默认会话库时，用户通过工作区切换打开默认会话库；不新增第二棵树，也不把默认库文档混进当前仓库。

### 保存位置与配置

30. 从工作区 A 切换到 B 后立刻在工作台捕捉：渲染层等待 `activate-workspace` 返回新的 generation；会话文档落在 B 的 `conversations/`，`source` 标注落在默认库；B 不产生 `annotations/sources` 副本，也不会因为 watcher 异步而写进 A。
31. 当前工作区为 A，在工作台自动捕捉同一会话两次：文档复用在 A 的 `conversations/`；默认库只有一份 `sources` 文件；第二次不新建重复文档。
32. 切换到工作区 B 后在工作台捕捉同一会话：B 下新建或复用自己的一篇会话文档；默认库的 source 标注仍只有一份；A 的文档仍投影同一组 source 标注，不按 quote 合并不同 id。
33. 在主界面（工作台外）捕捉同一会话：文档写入默认工作区的 `conversations/`；当前仓库不新增文档，也不新增 `.multichat/annotations/sources`。
34. 工作台内评论框选择“保存到默认会话库”：本次文档写入默认库，当前仓库不产生文件；下一次捕捉仍默认写当前工作区，不形成持久偏好。
35. 关闭自定义工作区并回落到默认工作区后捕捉：文档进入默认工作区的 `conversationDir`；不会写入刚关闭的工作区。
36. 把当前工作区的 `conversationDir` 改为 `资料/会话`：后续工作台内新文档进入该目录；已有文档仍按来源地址/身份复用，不会被搬到新目录，也不会重复创建。
37. 通过“打开会话库”激活默认工作区后，把它的 `conversationDir` 改为 `inbox/conversations`：后续工作台外新文档进入该目录；已有默认库文档仍按来源身份复用；当前仓库的设置不受影响。
38. `conversationDir` 填绝对路径、`../`、盘符、符号链接逃逸、`.multichat`、`.git`、普通文件路径：`setSettings` 直接拒绝；历史非法值读取时回落到 `conversations/`，界面提示一次，捕捉仍能完成。
39. 已有文档 frontmatter 是旧格式 `source: https://...`：再次捕捉同一会话时按 URL 等价命中，复用该文档，不新建第二篇。
40. 目标工作区有超过 2000 篇 `.md` 或扫描超时：扫描返回 `complete: false`；默认库的 `source` 标注仍然保存，不新建文档，不把已有文档误判为不存在。
41. 工作台捕捉时当前工作区是已断开的网络盘：默认库的 source 标注写入成功；文档返回“工作区暂不可用”，不静默改存默认库；重新连接后可以重试，或由用户显式选择“保存到默认会话库”。
42. 默认会话库不可用（无权限、盘断开、目录被删）：捕捉直接失败，返回 `CONVERSATION_LIBRARY_UNAVAILABLE`；当前仓库不写 source，也不创建半套文档。
43. `workbench.getDefaultWorkspace` 返回默认库实际路径和可写状态；设置界面不出现“设为默认工作区/修改默认库路径”的入口；当前工作区切换不会改变默认库路径。

### 迁移行为

44. 在 A 开始迁移并暂停，切到 B 后点继续：普通会话记录的目标是默认会话库，不绑定 A；切换当前工作区不改变目标，也不阻止继续；A 中不会写入普通会话的迁移数据。带 `workbench` 的记录按验收 64 留在其原工作区。
45. 放弃一次迁移后重新开始：普通会话的目标仍是默认会话库；已完成普通会话记录留在默认库，`workbench` 记录留在原工作区；当前工作区 A/B 不产生旧笔记数据；报告列出 `migratedTo`，但不把普通会话分散到多个仓库。
46. 迁移中取消再重启：同一 `jobId` 从剩余记录继续；已完成记录保留 `migratedAt`；不重复创建文档或导图。
47. 旧记录里同一 quote 有两条不同评论：迁移后仍是两条；迁移运行中和结束后打开旧页刷新列表，旧 JSON 数量、内容和批注数都不变，不被 `list()` 的 quote 去重合并，也不被自动 `rm`；`.migration-backup` 已生成。
48. 迁移任务运行或暂停时，`notes:save/update/delete/standalone/import` 和 `mindmaps:add/start/modify/delete/update/apply/blank-source/import-legacy` 都被主进程拒绝；任务结束后，已迁移或阻塞记录继续只读；`workbench:mindmap-migrate` 在迁移期跳过。
49. 默认会话库里已有同源文档且被用户编辑：迁移不覆盖正文，只合并默认库的 `sources/` 标注和导图；报告提示“已保留现有文档”，不自动挑选正文版本。
50. 旧记录转换后最终 Markdown（含 frontmatter，UTF-8 字节）超过 5MB：不创建文档；可解析标注仍写入默认库的 `sources/`；记录标记 `migrationBlocked: 'oversize'`；旧页只读；报告逐条列出；清理旧页时不会删除该记录。
51. 旧记录没有 URL 或 `sourceKey`：不写默认库的 `sources/`；能定位的标注写成默认库文档的 `document` 标注；定位不到的标记 `migrationBlocked: 'unlocatable-source'`；报告列出，不静默丢弃。
52. 旧记录批注超过 500 条或序列化后超过 2MB：不部分写入；标记 `migrationBlocked: 'annotation-overflow'`；旧 JSON 保留；报告给出条数和字节数。
53. 旧导图同 id 但正文不同：不写第二份同 id 文件；标记 `migrationBlocked: 'mindmap-conflict'`；现有默认库导图不被覆盖；报告列出冲突。
54. 旧记录快照为空但仍有标注或导图：不创建空文档；有 `sourceKey` 的标注写入默认库的 `sources/`；标记 `migrationBlocked: 'empty-snapshot'`；旧页只读。
55. 迁移执行两次：按标注 id 去重，不按 quote 合并；删除过的新标注不会复活；同 id 导图文件不被覆盖。
56. 迁移扫描默认会话库超时或达到 2000 文件：不算成功，不写 `migratedAt`；旧 JSON 保留；报告为可重试失败，下次再试。
57. 默认会话库在迁移开始时不可用：任务不启动，不写任何 `migratedAt`；已经开始的任务暂停并保留进度；恢复默认库可写后从同一 `jobId` 继续，不把数据退回当前仓库。

### 一致性与性能

58. 连续输入 5 分钟：正文按现有 1200ms 防抖保存；旁路文件写入次数与标注操作次数同量级，不随击键增长。
59. 两个窗口同时编辑同一文档的标注：不同 id 的记录都保留；同 id 以较新 `updatedAt` 为准；不出现整文件被覆盖。
60. 200 条标注、1MB 文档：打开和定位无明显卡顿；DOM/节点树只遍历一次，文本匹配按标注数线性扫描。
61. 损坏一个旁路 JSON：该文档正文正常打开，标注面板提示读取失败，其他文档不受影响；损坏的 source 文件只影响对应会话的原文高亮。
62. 文档工作区没有 `.multichat` 目录：首次写 `document` 标注时在文档所在工作区创建；默认库没有 `.multichat` 时首次写 `source` 标注在默认工作区创建。任一根目录创建失败时给出明确错误，不静默丢标注，也不把数据写到另一个根。
63. `annotation-sync` 应用标注后，同一导入状态下的正文序列化结果与应用前一致；粗体、链接、表格、代码块内的标注不会改变原格式。不要拿磁盘原文件字节做基准。

### 回归与边界

64. 旧 `workbench` 记录带 `notes` 且工作区/文档存在：迁移后 `notes[]` 只出现在该文档所在工作区的 `documents/` 旁路，默认库不新增 `sources/`、不新建同源会话文档；导图留在该工作区。工作区不可达时标记 `workbench-unresolved`，旧 JSON 保留，不按普通会话迁移。
65. 文档创建失败后用同一个 `annotationId` 重试，或调用 `ensureDocumentForSource`，或改为“保存到默认会话库”：默认库的 `source` 始终只有一条，原文高亮不重复；补文档成功后才出现新的会话文档。
66. 关闭自定义工作区：`closeWorkspace` 原子回到默认库，随后工作台内捕捉的文档进默认库 `conversationDir`，不进入刚关闭的工作区；默认工作区不可关闭；关闭期间没有可观察的“无 active root”中间态；默认库不可用时关闭失败且当前工作区仍可用。
67. 预置一个有效的旧 `workbench_defaultWorkspacePath` 指向非规范目录：`ensureDefaultWorkspace` 忽略并清理旧缓存键，旧目录内容保留并提示，source 和迁移都写规范默认库；旧任务 `targetRootKey` 不一致时暂停，不写旧目标。
68. 已有仓库的 `.gitignore` 不含标注规则：首次激活或首次标注后追加 `.multichat/annotations/`，用户原有规则不丢；`git status` 不显示 `sources/` 或 `documents/` 旁路文件。
69. 迁移运行或暂停时修改默认库 `conversationDir`：`setSettings` 拒绝；迁移固定使用 `targetConversationDir`，新文档不会分散到两个目录；任务结束后才允许修改。

## 14. 非目标

- 不在 PDF、Word、PPT 预览里做标注；第一版只覆盖 Markdown 富文本编辑。
- 不做跨文档的标注聚合搜索；原文回显按会话地址查，不按评论全文查。
- 不做评论回复、@、线程和协作冲突解决；一条标注只有一个评论体。
- 不把 `==` 升级成带 id 的标注语法，也不要求外部 Markdown 软件理解标注。
- 不做基于 AI 的语义重定位；只做确定性的文本锚点匹配。
- 不在第一版支持跨 block 或部分重叠标注；数据模型保留 occurrence，交互先保持单 block、单点击目标。
- 不把导图改成文档的 frontmatter 字段；导图继续走 `.multichat/mindmaps` 文件化方案。
- 不把 `source` 标注复制到每个工作区；默认会话库只保留一份，原文高亮跨工作区共用。
- 不把 `document` 标注搬到默认会话库；它始终跟随文档所在工作区，跨工作区移动单篇 `.md` 时不会自动跟随。
- 不提供每个会话单独的绝对保存路径，也不单独建会话工作区；只有默认会话库、当前工作区和各自工作区的 `conversationDir`。
- 不在 v1 提供修改默认会话库路径的设置；默认库固定为系统「文档」下的 `MultiChat Vault`，切换工作区只改变工作台内文档目标。
- 不做迁移任务的目标切换或跨工作区自动接续；普通会话始终迁移到默认会话库，带 `workbench` 的记录按原文档工作区分流，放弃任务不会搬走已完成记录。
- 不做每条标注的自定义颜色；v1 只使用 `source`/`document`/激活/未定位的固定语义样式。
- 不在第一版支持 2MB 以上文档进入 WYSIWYG；这些文档固定使用源码模式。
- 第一版不做标注的独立导出/导入；复制整个工作区文件夹会带上该工作区的 `.multichat/annotations`，只复制单篇 `.md` 不包含 document 标注，也不会复制默认库的 source 标注。

## 15. 风险与取舍

| 风险 | 影响 | 处理 |
|---|---|---|
| MarkNode 在回车/粘贴时复制 id | 同一评论被多处引用 | 每次 update 去重，保留第一个；零 id unwrap |
| 应用标注改变 Markdown 序列化 | 用户正文被自动保存改坏 | 专用 tag + 回写抑制 + 序列化一致性校验 |
| 第三方页面 DOM 改版/虚拟滚动 | 原文高亮暂时找不到 | 文本锚点 + occurrence/offsetHint + MutationObserver + 重试；miss 不删除 |
| 最终 Markdown 超过 5MB | 文档打不开或生成空壳 | 按含 frontmatter 的 UTF-8 字节预校验并拒绝；保留旧数据；提示可操作原因 |
| 旧会话导图未迁移 | 删除旧页后导图丢失 | 单独迁移到默认库并校验；未成功不标记旧 JSON |
| 旁路文件被用户误删 | 标注丢失 | document 随文档工作区备份；source 随默认库备份；删除文档时保留一个版本；后续可加导出 |
| 标注写入和正文写入竞争 | anchor 指向未落盘文本 | 先确认 `saveActiveFile()` 真正写盘（检查 `activeFileOversized / conflict`），再写 document 标注；失败保留旧 anchor |
| `source` 投影被当成未知 id 清理 | 文档里看不到原文高亮 | 等 `document` 和 `source` 两路都加载完成再清理；有效 id 集合同时包含两者 |
| 文档与 source 分属两个根 | 一次捕捉要写两个位置，跨盘无法真原子 | source 先写默认库作为提交点；文档失败保留 source 并提示重试；不回滚、不偷偷补写到另一个根 |
| 捕捉失败重试重复 source | 同一句话出现两条高亮、评论分裂 | `captureSource` 按 `annotationId` 幂等 upsert；补文档走 `ensureDocumentForSource`；验收 65 |
| 默认会话库不可用 | source 标注和全局原文高亮都不可用 | capture 直接失败，不退回当前仓库；错误可操作；已有页面保留旧高亮直到刷新 |
| source 删除影响全局 | 在某个仓库删除评论会让所有工作区的原文高亮消失 | 确认框写明影响范围；删除入口只在原文侧栏或会话库设置；不提供“仅当前工作区删除” |
| 同一会话多篇文档 | 用户以为 source 标注重复 | 文档副本按工作区各自复用；source 只有一份；两篇文档显示同一组投影，不按 quote 合并 |
| 用户不想在仓库留会话文档 | 自动捕捉污染当前仓库 | 工作台评论框一次性切到默认库；默认不改成全局偏好；已生成文档可删除，source 仍保留 |
| 迁移目标与用户预期不符 | 用户以为旧笔记会进当前仓库 | 迁移入口显示默认库路径；`legacyMigrationJob` 固定默认库；切换工作区不改变目标 |
| 默认库路径漂移 | 旧缓存把会话库带到不可预期目录 | v1 固定规则；`workbench_defaultWorkspacePath` 只作缓存；resolve/realpath 比较，不一致只清缓存键、保留旧目录并提示；不暴露任意路径设置 |
| 当前/默认 `conversationDir` 混淆 | 工作台内外的文档落到错误目录 | 每次按目标工作区读取自己的 settings；默认 `conversations/`；测试两个根独立 |
| 关闭工作区产生无根状态 | 随后的捕捉报 `NO_ACTIVE_WORKSPACE` | `closeWorkspace` 原子回落到默认库；默认库不可关闭；验收 66 |
| 旧 `workbench` 记录误迁 | 本应属于工作台文档的评论被写成默认库 source | `workbench` 且 `notes` 非空时只写原文档的 `document` 旁路；不可达标记 `workbench-unresolved`；验收 64 |
| 迁移中默认库 `conversationDir` 被改 | 同一批文档分散到两个目录 | job 记录 `targetConversationDir`；运行/暂停时拒绝修改；验收 69 |
| 迁移复用 `list()` | 同 quote 批注被合并、旧 JSON 被自动删除 | 使用独立原始枚举器；迁移期旧 JSON 只读；合并/删除只由迁移器显式执行 |
| 旧页读取触发 `listUnlocked()` | 迁移期间或结束后仍可能合并、删盘 | 迁移期旧读接口走只读原始快照；`listUnlocked()` 不再自动 `rm` 旧 JSON，已迁移/阻塞记录跳过合并与 quote 去重 |
| `migratedAt` / `migratedTo` / `migrationBlocked` 被类型或 convert 丢掉 | 迁移重跑、旧页重新可写、已删除标注复活 | 类型、`convert()`、合并、导入导出都保留三个字段；迁移先跳过已标记或已阻塞记录 |
| 迁移写同 id 导图副本 | 导图扫描判为 duplicate，保存和删除无法定位 | 同 id 正文不同时标记 `mindmap-conflict`，不追加第二份同 id 文件 |
| 旧批注超过旁路上限 | 迁移反复失败或部分写入 | 先算条数和字节；超限标记 `annotation-overflow`，保留旧 JSON，提供导出/拆分 |
| 来源扫描不完整 | 已有文档被当成不存在，重复新建 | 扫描返回 `complete`；超时或达到 2000 文件只写标注，不建文档 |
| 旧页并行期仍能写导图 | 新导图留在旧 JSON，删页后丢失 | 主进程拒绝已迁移或已阻塞记录的 `notes:* / mindmaps:*` 写入，不只隐藏按钮 |
| 清理旧页时删掉未完成迁移的记录 | 超大或无法定位的旧会话永久丢失 | 清理前列出 `migratedAt` 为空或 `migrationBlocked` 非空的记录；有残留时保留旧页入口；已迁移/阻塞记录只读，未迁移记录仍可读写；实际目标里的文档、`sources/`、`documents/` 不随旧 JSON 删除 |
| 评论进入 Git | 隐私泄露、JSON 合并冲突 | document 评论可能随仓库进 Git，source 评论在默认库；两个根的 `.multichat/annotations/` 都默认忽略；需要同步时用户显式取消忽略 |
| MarkNode 未来升级行为变化 | 标注进入 Markdown 或丢失 | 固定 Lexical 版本；加“导出后不含标注标记”的回归检查 |

### 最小充分版本

如果希望先以最小改动落地，可以只做：

1. Phase 0 + Phase 1：文档内标注、`documents/` 旁路、右栏面板。
2. Phase 2 的捕捉路由和默认会话库：工作台内写当前工作区，工作台外写默认库；`source` 一开始就只写默认库；旧笔记/导图迁移到默认库。可以先不做评论框的一次性目标切换和“打开会话库”入口。
3. Phase 3 的共享回显：把 AI 右栏原文和主界面 `WebviewCard` 接到默认库的 `sources/`，同时删除旧 NotesPage。

这样仍然满足“笔记统一到工作台、文档可高亮评论、切换仓库不丢原文高亮”的核心诉求；代价是工作台内的一次性“保存到默认库”和文件树里的“打开会话库”入口要晚一点补。这些是交互便利，不影响存储模型；后续补上时不需要迁移 source 或 document 数据。

## 16. 附：关键代码落点

| 改动 | 位置 |
|---|---|
| 标注类型 | 新增 `src/shared/types/annotations.ts`，包含 `Annotation/AnnotationScope/AnnotationAnchor/CaptureContext` |
| 锚点纯函数 | 新增 `src/shared/utils/annotationAnchors.ts`，承接旧 `NotesSourcePane.snapshotRanges` 的匹配逻辑 |
| 会话正文转换 | `src/shared/utils/noteTranscript.ts` 新增 `snapshotToDocumentMarkdown` |
| 旁路存储 | 新增 `src/main/services/annotationService.ts`：`document` 写文档所在工作区，`source` 固定写默认工作区 |
| 忽略规则 | `src/main/services/gitignoreService.ts` 增加 `.multichat/annotations/`；对已有 `.gitignore` 追加缺失模式，工作区激活或首次标注时补齐 |
| IPC | `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` |
| 会话文档创建 | 新增 `src/main/services/conversationDocumentService.ts`：按 `captureContext` 解析目标工作区，扫描来源地址/身份，创建或复用会话文档；提供 `ensureDocumentForSource` 供失败重试/切换目标，不重复写 source |
| 保存位置 | `src/main/services/workbenchService.ts` 新增原子 `activateWorkspace` / `closeWorkspace`，维护 `activeWorkspaceRoot` + generation，读取 `workbench_lastWorkspacePath`；`closeWorkspace` 关闭自定义工作区时原子回落到默认库；`ensureDefaultWorkspace` 用 resolve/realpath 校验规范路径并清理旧缓存；`getDefaultWorkspace` 只读返回路径 |
| 归档目录设置 | 当前工作区和默认工作区各自新增 `.multichat/settings.json` 的 `conversationDir` 读写与路径校验；`WorkbenchWorkspaceSettings.tsx` 增加相对目录选择；写入拒绝非法值，读取回落 `conversations/` |
| 迁移标记 | `src/shared/types/notes.ts` 增加 `migratedAt` / `migratedTo` / `migrationBlocked`，`noteManager.convert()` 保留这三个字段 |
| 迁移枚举器 | `src/main/noteManager.ts` 新增独立原始 JSON 枚举器和只读快照，不调用 `list()` / `cachedValues()`；迁移期旧读接口走快照；`listUnlocked()` 不再自动 `rm` 旧 JSON，已迁移/阻塞记录跳过合并与 quote 去重；`workbench` 记录按纯导图/带 notes 分流 |
| 迁移任务 | electron-store 增加 `legacyMigrationJob`，记录 `targetWorkspaceRoot` / `targetRootKey` / `targetConversationDir`；`ipcHandlers.ts` 暴露迁移、暂停/恢复/放弃、进度；普通会话目标固定默认会话库，`workbench` 记录固定原工作区，切换当前工作区不改变目标 |
| 迁移入口与报告 | 工作区设置与工作台顶部提示展示默认库路径、进度、阻塞原因和失败列表；阻塞详情提供重试、导出或拆分入口 |
| Lexical 节点 | `src/renderer/src/components/workbench/WorkbenchEditor.tsx` 注册 MarkNode |
| 标注插件 | 新增 `WorkbenchAnnotationPlugin.tsx`，接到 `MarkdownSyncPlugin` 的导入完成钩子 |
| 浮层入口 | `WorkbenchFloatingToolbarPlugin.tsx` 增加“标注”按钮 |
| 右栏面板 | 新增 `WorkbenchAnnotationPanel.tsx`，`WorkbenchPage.tsx` 增加 `annotations` 分支 |
| 原文侧栏 | 复用 `WorkbenchAiSidebar` 的 Webview、高亮和评论回显，不再新增全屏覆盖层 |
| 共享回显 | 新增 `useSourceAnnotations.ts`，只接收 `sourceKey` 和 `captureContext`，接入 `WebviewCard.tsx`、`WorkbenchAiSidebar.tsx`；根固定默认工作区 |
| 选区采集 | `src/main/webviewManager.ts`、`src/renderer/src/components/NoteCaptureModal.tsx` 拆出“标注 / 摘录”，并传 `annotationId` + `captureContext`；重试复用同一 id；工作台评论框提供一次性“保存到默认会话库” |
| 旧页面收口 | `src/renderer/src/App.tsx`、`src/renderer/src/components/Layout.tsx` 移除旧入口；`NotesPage.tsx`、`NotesConversationCards.tsx`、`NotesSourcePane.tsx` 已删除 |
| 文件树 | `src/renderer/src/components/workbench/WorkbenchFileTree.tsx` 保持普通目录树，不提供“对话资料”筛选 chip |
| 导图来源 | `src/main/services/MindmapService.ts` 工作台上下文改读 Markdown 文件 |
| Frontmatter 修复 | 会话文档写 `source_kind: conversation/source/platform/captured_at`，仅在归一化身份与地址不同时追加 `source_key`；属性面板默认折叠重复字段和纯技术字段 |
| 保存结果 | `src/renderer/src/store/workbenchStore.ts` 的 `saveActiveFile` 返回结构化结果，标注对账前检查是否真的写盘 |
| 停写 snapshot | `src/main/noteManager.ts` 的 `prepareWorkbenchSource` 与 `createWorkbenchRecordUnlocked` 同时移除正文快照写入 |
| 文档索引 | `docs/DOCS_INDEX.md` 更新为本方案的默认库、捕捉路由和迁移目标摘要 |

这份设计的关键不是“把 NotesPage 搬进 Workbench”，而是把**正文所有权、标注归属、渲染适配器**三件事分开：正文归 Markdown；`source` 标注归会话身份，物理根是默认会话库；`document` 标注归文档路径，物理根是文档所在工作区；两者共用记录结构和侧栏，但各自使用正确的渲染器。只要这三条守住，后续做导图、摘录、原文对照和跨设备迁移都不会再回到“两套笔记”的状态。
