> Created: 2026-11-21 13:19 (+08:00)

# 工作台笔记 Tag 规范对齐 Obsidian 与体验优化方案

## 1. 背景与问题定义

当前 MultiChat 工作台笔记已支持 YAML Frontmatter（笔记属性）中的 `tags` 属性，交互上支持在标签输入框中输入内容并按空格/回车建立标签 chip。但在实际使用中，存在以下核心问题：

1. **存储规范与 Obsidian 不对齐**：
   - 用户输入带有 `#` 的标签时（如习惯性输入 `#react`），系统直接保留了 `#`，导致 YAML 序列化为 `- "#react"`。而在 Obsidian 规范中，Frontmatter 中的标签不带 `#` 前缀（`#` 仅作为正文行内标签的前缀引导符）。
   - 解析存量或外部 Obsidian 笔记时，若遇到单行逗号分隔 `tags: a, b` 或包含引号/带 `#` 格式，当前解析器未将 `isList` 置为 true，导致标签渲染为带逗号的错误 chip（如 `a,`），并被序列化为普通标量字符串而非 YAML 列表。
   - 标签命名缺乏清洗机制：未限制空格、非法标点，未对同一篇笔记内重复标签做去重。

2. **全局搜索不支持 Tag 维度检索**：
   - 当前工作台搜索仅对文件逐行做纯文本子串匹配（`indexOf(lowerQuery)`）。
   - 用户在搜索框输入 `#react` 或 Obsidian 标配语法 `tag:#react` / `tag:react` 时，无法匹配到 YAML Frontmatter 中的 `react` 标签，返回 0 个结果。
   - 不支持 Obsidian 核心的层级嵌套标签检索（如搜索 `#project` 匹配 `#project/frontend`）。

3. **缺乏标签补全与防泛滥机制（体验痛点）**：
   - 用户在打标签时没有任何现有标签提示，容易随手新建近义、拼写微差标签（如 `dev`、`develop`、`frontend`、`fe`），引发标签熵增和混乱。
   - 期望在输入标签时能够根据已有库中的标签进行前缀/模糊匹配，弹出下拉建议列表供直接选用。

---

## 2. Obsidian Tag 规范与交互调研

### 2.1 命名规范与字符集
- **字符限制**：允许字母（含中文/多语言 Unicode）、数字（不能为纯数字）、下划线 `_`、短横线 `-`、斜杠 `/`。
- **层级嵌套**：斜杠 `/` 用于构建父子层级标签（如 `#project/alpha/ui`）。
- **禁止字符**：空格、逗号、引号、冒号、以及标点符号。
- **大小写**：大小写不敏感（搜索与匹配合并），但展示时保留首次创建的大小写。

### 2.2 存储格式 (YAML Frontmatter)
- **键名**：标准为 `tags`（或兼容 `tag`）。
- **格式**：Obsidian Properties 规范写入标准 YAML 多行列表：
  ```yaml
  ---
  tags:
    - project/alpha
    - react
  ---
  ```
  兼容读取单行中括号数组 `tags: [react, vue]` 及逗号分隔字符串。
- **无 `#` 前缀**：Frontmatter 中的标签名称绝对不含前缀 `#`；若用户在属性面板中输入 `#tag`，Obsidian 会自动剥离前缀 `#`。

### 2.3 检索交互 (Search Syntax)
- **`tag:` 操作符**：Obsidian 核心搜索语法，格式为 `tag:#name` 或 `tag:name`。
- **直接 `#name` 搜索**：全局搜索框中输入 `#name`，同时匹配文档正文中的行内标签与 YAML Frontmatter 中的标签。
- **层级继承匹配**：搜索父级标签（如 `tag:#project` 或 `#project`）自动匹配该标签及其所有子标签（如 `#project/a`、`#project/b`）。

### 2.4 自动补全交互 (Suggest Dropdown)
- 在 Obsidian 属性面板的 tags 字段输入时，或在正文中输入 `#` 时，弹出已有标签下拉菜单。
- 支持键盘上下键选择、回车/Tab 补全，或鼠标点击选择。
- 过滤出库中已存在但当前文档尚未添加的标签。

---

## 3. 产品视角评估：标签关键词匹配与下拉选用

### 3.1 评估结论
**高度合理，且为个人知识管理 (PKM) 系统的核心基础能力。必须支持。**

### 3.2 详细评估维度
1. **解决核心痛点（防止标签泛滥 / 标签熵增）**：
   - 知识库管理最常见的退化路径就是“标签随手打，用时找不到”。缺乏即时建议时，用户极易产生多版本标签（如 `obsidian` / `Obsidian`、`bugfix` / `bug-fix`、`ai` / `llm`）。
   - 下拉补全让既有词汇库“主动露出”，极大增加已有标签的复用率，收敛标签总数。
2. **降低认知负担与敲击成本**：
   - 尤其是层级嵌套标签（如 `department/engineering/frontend`），用户只需敲入 `front` 或 `eng` 即可从下拉列表中选择，避免记忆全路径或重复输入长文本。
3. **符合心智习惯**：
   - 主流知识管理与笔记产品（Obsidian、Notion、Craft、Bear、Logseq）均具备标签实时补全能力，用户对“输入即补全、回车即选定、没有则新建”的交互具备高度直觉。

---

## 4. 架构与开发实现方案

### 4.1 模块分层与职责
1. **跨进程共享标签工具集 (`src/shared/utils/workbenchTags.ts`)**：
   - `normalizeTag(tag: string)`: 剔除 `#` 前缀、前后空格与非法字符，保证格式合规。
   - `isValidTag(tag: string)`: 校验标签有效性。
   - `parseTagsFromFrontmatterValue(val: string)`: 健壮解析各种格式（列表、中括号数组、逗号分隔、带引号等），去重并标准化。
   - `matchTag(candidateTag: string, queryTag: string)`: 支持精确与层级嵌套匹配（如 `parent/child` 命中 `parent`）。
   - `parseTagSearchQuery(query: string)`: 解析 `tag:#xxx`、`tag:xxx`、`#xxx` 查询。
   - `extractFrontmatterTags(content: string)`: 从 Markdown 全文中提取 frontmatter 标签与行号。
   - `extractInlineTags(content: string)`: 提取 Markdown 正文行内标签（过滤代码块）。

2. **主进程服务与 IPC (`src/main/services/workbenchService.ts`, `ipcHandlers.ts`)**：
   - 新增 IPC `workbench:get-workspace-tags`: 扫描工作区 Markdown 文件，聚合所有唯一标签及出现频次 `{ tag: string, count: number }`。
   - 改造 `workbenchSearch`: 识别标签搜索语法，精准匹配 frontmatter 标签与行内标签，返回高可读性的标签匹配摘要。

3. **Preload 桥接 (`src/preload/index.ts`, `src/preload/index.d.ts`)**：
   - 暴露 `window.api.workbench.getWorkspaceTags`，保持三层契约一致。

4. **渲染层 Store (`src/renderer/src/store/workbenchStore.ts`)**：
   - 维护 `workspaceTags` 状态，在工作区初始化、文件保存、文件树变更时按需刷新。

5. **界面交互 (`src/renderer/src/components/workbench/FrontmatterPanel.tsx`)**：
   - 存储对齐：输入与序列化统一转为标准无 `#` 列表；修复存量逗号分隔等格式解析。
   - 标签输入框下拉补全浮层：
     - 输入时根据当前关键词过滤已有标签库（支持拼音/英文不区分大小写子串匹配）。
     - 支持键盘方向键上下选择、Enter/Tab 选中、Esc 关闭、鼠标点击选中。
     - 若输入全新标签，空格/回车直接建立新标签。
     - 自动剔除当前文档已存在的标签，防止重复。

6. **搜索面板交互 (`src/renderer/src/components/workbench/WorkbenchSearch.tsx`)**：
   - 优化搜索提示文案，支持标签搜索说明。
   - 针对 `tag:#xxx`、`tag:xxx` 或 `#xxx` 搜索结果准确高亮标签关键词。

---

## 5. 验收标准
1. **规范对齐**：
   - 在 Frontmatter 标签栏输入 `#test` 或 `test` 并回车，生成的 Markdown Frontmatter 均为 `tags:\n  - test`，不含引号和 `#`。
   - 原有含 `tags: [a, b]` 或 `tags: a, b` 的文件在编辑器中可正确解析为独立 tag chip，写回时规范化为标准 YAML 列表。
2. **搜索体验**：
   - 在工作台搜索框输入 `#test`、`tag:#test` 或 `tag:test`，能同时搜出在 Frontmatter 中标注 `test` 的文件和正文中写有 `#test` 的文件。
   - 嵌套标签 `project/sub` 能够被 `#project` 或 `tag:project` 搜出。
3. **补全下拉**：
   - 在标签输入框输入字符，即时弹出包含该字符的现有工作区标签列表。
   - 可以通过上下键高亮并按 Enter 键插入，或鼠标点击插入。
   - 插入后自动清空草稿并继续聚焦输入框。
   - 当前笔记已有该标签时不重复出现在建议列表中。
