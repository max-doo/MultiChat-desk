> Created: 2026-11-19 23:00 (+08:00)

# MultiChat Desk「工作台」(Workbench) 产品与技术设计规范

## 1. 概述与产品愿景 (Executive Summary & Product Vision)

### 1.1 背景与用户痛点
MultiChat Desk 目前已具备多模型并行对比（多AI）、多角色协作（任务分配）、双模型对抗（辩论）、网页总结与会话快照笔记能力。然而重度大语言模型用户在日常使用中面临一个显著断层：
- **知识碎片化**：与 AI 深度对话生成的见解、方案、代码片段需要频繁手动复制到外部笔记软件（如 Obsidian、Logseq、Notion）进行沉淀整理。
- **协同割裂**：在笔记软件中写作时，遇到需要 AI 扩写、润色、查证、总结的需求，必须离开写作环境，切回浏览器或 AI 客户端，来回切换窗口与复制粘贴极大破坏了心流。
- **本地隐私诉求**：用户高度重视知识库的本地掌控度与数据主权，期望以标准 Markdown 文件形式直接存储在本地磁盘，拒绝私有格式锁定。

### 1.2 产品定位与核心目标
**「工作台」(Workbench)** 是 MultiChat Desk 在「多AI对话」之外引入的全新核心生产力形态。它是一个**以本地 Markdown 知识库为核心、深度融合网页版大模型侧边栏协同的「Obsidian 风格」生产力空间**：
1. **本地知识库优先**：用户任意指定本地磁盘文件夹作为 Workspace，纯本地 `.md` 文件树管理，无格式侵入，100% 兼容 Obsidian 库。
2. **极速顺滑的富文本 Markdown 编辑**：基于 Meta Lexical (`@lexical/react` + `@lexical/markdown` + `@lexical/table`) 内核打造现代化富文本 Markdown 编辑体验，支持即时渲染（Live Markdown Formatting）、丰富的排版语法与丝滑的输入响应。
3. **沉浸式 AI 边写边问**：右侧无缝嵌入 MultiChat 既有的 AI Webview 侧边栏，支持划词右键一键提问、解释、润色、续写，AI 结果随时回插笔记。
4. **统一设计美学**：延续 MultiChat Desk 标志性的 Glassmorphism（玻璃拟态）、Tailwind CSS 设计语言与极简高级灰蓝调，打造呼吸感十足的桌面工作台。

---

## 2. 入口与导航架构设计 (Entry Point & Navigation Architecture)

### 2.1 顶部栏入口集成 (Top Bar Navigation)
在 `src/renderer/src/components/Layout.tsx` 顶部标题栏的模式切换分段控件（Segmented Control）中新增「工作台」模式：

```tsx
{/* 模式选择分段控件 */}
<div className={`flex items-center p-0.5 bg-gray-200/60 dark:bg-gray-700/60 rounded-lg text-xs gap-0.5 no-drag ${...}`}>
  {[
    { key: 'multi_ai', label: '多AI', title: '默认模式：多个平台展示不同AI' },
    { key: 'task_assignment', label: '任务分配', title: '支持多个窗口选择同一个AI分配不同任务' },
    { key: 'debate', label: '辩论', title: '辩论模式：支持2个AI交互对抗' },
    { key: 'workbench', label: '工作台', title: '工作台模式：本地 Markdown 知识库与 AI 深度协同' }
  ].map(item => (
    <button
      key={item.key}
      type="button"
      title={item.title}
      onClick={() => handleProductModeChange(item.key as ProductMode)}
      className={`px-2.5 py-1 rounded-md font-medium transition-all duration-200 ${
        productMode === item.key 
          ? 'bg-white dark:bg-gray-800 text-primary shadow-xs' 
          : 'text-text-secondary hover:text-text-primary hover:bg-white/30'
      }`}
    >
      {item.label}
    </button>
  ))}
</div>
```

### 2.2 页面级隔离挂载策略 (App.tsx 顶层解耦)
为避免工作台受到 `MainPage` 的 `ControlBar`、会话轮询监控（MonitorState）和历史记录还原的逻辑串扰，工作台作为**顶层独立视图**在 `App.tsx` 中挂载：

```tsx
// src/renderer/src/App.tsx
<Layout>
  {/* MainPage: 多AI / 任务分配 / 辩论模式 */}
  <div 
    className="h-full" 
    style={{ display: currentPage === 'main' && productMode !== 'workbench' ? 'block' : 'none' }}
  >
    <MainPage ... />
  </div>

  {/* WorkbenchPage: 工作台模式，独立容器，避免 ControlBar 污染 */}
  {hasWorkbenchOpened && (
    <div 
      className="h-full" 
      style={{ display: currentPage === 'main' && productMode === 'workbench' ? 'block' : 'none' }}
    >
      <WorkbenchPage isActive={currentPage === 'main' && productMode === 'workbench'} />
    </div>
  )}
  ...
</Layout>
```

- **隔离收益**：
  1. `MainPage` 底部的输入框与控制栏（ControlBar）不会在工作台显示；
  2. 对话轮询（`responseMonitorTarget`）与会话快照不会误判工作台操作；
  3. 延迟挂载（`hasWorkbenchOpened`）：首次切换到工作台时才挂载，减少首次冷启动开销；切出后保持 CSS 隐藏，避免编辑器 DOM 重建导致的光标或撤销历史丢失。

---

## 3. UI/UX 与三栏布局规范 (Three-Column Layout Specification)

工作台采用经典高效的三栏自适应响应式布局：

```
+---------------------------------------------------------------------------------------------------------+
| Top Bar (Layout.tsx) : [ 多AI | 任务分配 | 辩论 | 工作台 ]      [工作区名称 / 当前笔记.md (已保存)]  [设置|历史|笔记] [-][口][X]|
+-----------------------+-------------------------------------------------------+-------------------------+
| [1] 文件管理区 (左栏)  | [2] Lexical Markdown 富文本编辑器 (中栏)              | [3] AI Webview (右栏)   |
| 宽度: 220px - 360px   | 宽度: 自适应弹性拉伸 (min-width: 480px)                | 宽度: 320px - 600px     |
|                       |                                                       |                         |
| - 工作区切换/路径展示 | - 顶部文档状态栏 (标题/保存状态/字数/富文本工具栏)    | - 目标 AI 切换下拉框    |
| - 搜索与过滤输入框    | - Lexical 编辑画布 (H1-H6, 列表, 引用, 代码块, 表格)  | - WebviewCard 独立实例  |
| - 新建文件/文件夹按钮 | - 实时 Markdown 语法输入转换 (Live Preview)           | - 保持登录态 (共享Session)|
| - Obsidian 风格文件树 | - 选中文本悬浮菜单 / 右键上下文菜单 ("问 AI" 等)      | - 接收编辑器划词注入    |
| - 重命名/删除/移动    |                                                       | - 折叠/展开切换按键     |
+-----------------------+-------------------------------------------------------+-------------------------+
```

### 3.1 左栏：文件管理与工作区 (File Management Area)
- **尺寸规则**：默认宽度 `260px`，最小 `200px`，最大 `380px`。支持可拖拽 Splitter 调整宽度，支持一键折叠（快捷键 `Ctrl/Cmd + B` 或折叠图标）。
- **视觉风格**：`bg-slate-50/70 dark:bg-gray-900/50 backdrop-blur-md border-r border-black/5 dark:border-white/5`。
- **头部操作栏**：
  - **工作区选择器**：显示当前文件夹名，点击弹出菜单支持「打开本地文件夹...」「切换最近工作区」「关闭工作区」。
  - **快捷操作按钮组**：新建笔记 (`note_add`)、新建文件夹 (`create_new_folder`)、搜索切换 (`search`)、折叠全部目录 (`unfold_less`)、刷新 (`refresh`)。
- **搜索区域**：
  - 展开式搜索框，带 300ms 防抖输入与取消标记；
  - 高亮匹配项，支持快捷键 `ESC` 退出搜索，`Enter` 打开匹配文件。
- **Obsidian 风格文件树**：
  - 采用递归树状结构，支持无限级目录嵌套。
  - 文件夹折叠/展开指示图标 (`chevron_right` / `expand_more`)。
  - 文件状态图标：`.md` 笔记 (`description`)、普通文件 (`draft`)、文件夹 (`folder` / `folder_open`)。
  - 交互状态：Hover 微高亮 (`hover:bg-black/5`)，选中态为 MultiChat 品牌蓝背景高亮 (`bg-blue-50/80 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-medium`)。
  - **未保存脏状态提示**：文件存在未保存改动时，节点右侧显示圆点指示灯 (`●`)。
  - 右键上下文菜单：新建笔记、新建子文件夹、重命名、在系统资源管理器中显示 (Reveal in Explorer/Finder)、移动、删除（移入回收站）。
  - 空状态引导：未选择文件夹时，中央展示引导卡片「选择一个本地文件夹作为工作区」，支持点击按钮或直接拖拽系统文件夹到窗口。

### 3.2 中栏：Meta Lexical Markdown 编辑器 (Editor Area)
- **尺寸规则**：`flex-1 min-w-[460px] h-full overflow-hidden flex flex-col bg-white dark:bg-gray-800`，带专属 DOM 标识 `data-workbench-editor="true"`。
- **顶部文档工具栏**：
  - **文档信息区**：面包屑导航（如 `docs > 架构设计 > spec.md`）、保存状态指示灯（🟢 已保存 / 🟡 正在保存... / ⚪ 未保存修改）、字数与字符数统计（`字数: 2,345`）。
  - **格式排版工具组**：
    - 段落格式下拉：正文、标题 1、标题 2、标题 3、引用块、代码块。
    - 行内修饰：粗体 (`Ctrl+B`)、斜体 (`Ctrl+I`)、删除线、行内代码 (`Ctrl+E`)、高亮标注、超链接 (`Ctrl+K`)。
    - 结构排版：无序列表、有序列表、待办任务清单 (Task list `- [ ]`)、表格插入与编辑 (`TableNode`)。
    - 撤销/重做：Undo (`Ctrl+Z`)、Redo (`Ctrl+Y` / `Cmd+Shift+Z`)。
  - **视图切换与操作**：
    - 「源码/富文本」切换开关（支持查看与编辑原始 Markdown 文本）。
    - 「在右侧 AI 中提问」快捷入口。
- **编辑器核心画布**：
  - 采用 Meta Lexical 现代编辑器架构，Typography 排版风格对齐 GitHub Flavored Markdown。
  - 具备舒适的阅读边距（最大阅读宽度 `840px` 居中展示，或全宽模式可选），字体平滑，行高 `1.75`。
  - 支持即时 Markdown 输入补全（Typing `# ` 立即转为 H1 节点；`- ` 转为无序列表；`> ` 转为引用等）。

### 3.3 右栏：AI Webview 侧边栏 (AI Webview Sidebar)
- **尺寸规则**：默认宽度 `420px`，最小 `320px`，最大 `600px`。配备可拖拽 Splitter 调整宽度，右上角可一键折叠/展开。
- **组件复用**：完全复用已在 `MainPage` 验证成熟的 `WebviewCard` 核心与 `useWebviewSidebar` 调度机制。
- **架构隔离**：
  - Webview 实例 ID 隔离：`workbench-sidebar-${model.id}`，不与主界面的 `slot-0` 或 `main-sidebar` 实例 ID 冲突。
  - 保持全局统一的 `persist:shared` Session，因此 ChatGPT、Claude、Gemini、DeepSeek、Qwen 等账号登录状态完全共享，无需重新登录。
- **头部控制条**：
  - 平台切换选择器：下拉自由切换 ChatGPT、Claude、Gemini、DeepSeek、Kimi 等已启用平台。
  - 刷新网页、原网址导航、复制当前网页链接、折叠侧边栏按键。
- **智能唤醒与休眠**：
  - 遵循 MultiChat Desk 30 秒休眠规范。当右栏折叠或用户切回多AI模式后，侧边栏实例进入平滑休眠（挂起渲染与定时器）；再次打开时毫秒级唤醒恢复。

---

## 4. 划词右键「问 AI」端到端闭环链路 (Contextual AI Interaction Flow)

这是工作台最具生产力价值的核心闭环场景：用户在阅读或编写本地笔记时，选中任意文本片段，通过右键即可无缝向右侧的 AI 平台发问。

```
[ 用户在 Lexical 编辑器选中文字 ]
               │
               ▼ (鼠标右键触发 contextmenu)
[ CustomContextMenu 过滤: 校验 target.closest('[data-workbench-editor]') ]
               │
               ▼ (仅在工作台编辑器内展示 AI 专属动作)
[ 弹出定制 ContextMenu: "向 AI 提问" / "解释" / "润色" / "续写" ]
               │
               ▼ (点击选定操作)
[ WorkbenchController: 构建 Prompt 提示词模板 ]
               │
               ▼ (检查右侧 Webview 状态)
  ┌────────────┴────────────┐
  ▼ (若处于折叠/休眠状态)     ▼ (若已处于激活状态)
[ 展开右栏 + 唤醒 Webview ]   [ 直接复用当前实例 ]
               │
               ▼ (通过 WebviewCardRef 获取 WebContents)
[ 执行智能注入: ref.insertText(formattedPrompt) ]
               │
               ▼
[ 触发 Webview 目标平台输入框适配脚本，内容填入并定位焦点 ]
               │
               ▼ (用户确认或一键发送)
[ AI 平台开始流式解答，左边看笔记，右边看 AI 协同成果 ]
```

### 4.1 划词上下文菜单作用域隔离 (Scoped Context Menu)
为防止 `CustomContextMenu.tsx` 的右键菜单污染应用中的其他页面（如系统设置、笔记列表或普通 Webview），必须增加作用域守卫：
```typescript
// 在 CustomContextMenu.tsx 中
const isWorkbenchEditor = Boolean(target.closest('[data-workbench-editor="true"]'))
if (isWorkbenchEditor && selectionText) {
  items.unshift(
    {
      key: 'ask_ai',
      label: '向 AI 提问',
      icon: 'chat',
      action: () => triggerWorkbenchAskAi(selectionText, 'ask')
    },
    {
      key: 'explain_ai',
      label: '让 AI 解释',
      icon: 'psychology',
      action: () => triggerWorkbenchAskAi(selectionText, 'explain')
    },
    {
      key: 'polish_ai',
      label: '让 AI 润色',
      icon: 'auto_fix_high',
      action: () => triggerWorkbenchAskAi(selectionText, 'polish')
    },
    { type: 'separator' }
  )
}
```

### 4.2 划词提示词模板
1. **向 AI 提问 (`ask_ai`)**：
   - 快捷动作：直接将选中内容发送给右侧 Webview，作为当前对话的输入。
2. **解释此内容 (`explain_ai`)**：
   - 提示词模板：`请详细解释以下内容的核心含义、背景与原理：\n\n"""\n${selectedText}\n"""`
3. **语言润色与精简 (`polish_ai`)**：
   - 提示词模板：`请对以下文本进行专业级润色，纠正语病并优化行文逻辑，保持原意但更精炼地表达：\n\n"""\n${selectedText}\n"""`
4. **基于此内容续写 (`continue_ai`)**：
   - 提示词模板：`请基于以下已有段落和上下文思路，自然承接并往下续写：\n\n"""\n${selectedText}\n"""`

---

## 5. 状态管理与切文件脏状态防丢设计 (State Management & Dirty File Guard)

### 5.1 状态模型定义 (State Schema)

```typescript
export interface WorkbenchFileNode {
  id: string              // 节点相对路径 (如 'docs/guide.md')
  name: string            // 显示名称
  path: string            // 相对路径
  fullPath: string        // 绝对路径
  isDirectory: boolean
  extension?: string      // '.md', '.txt' 等
  size?: number           // 文件大小
  mtime?: number          // 修改时间戳
  children?: WorkbenchFileNode[]
}

export interface WorkbenchSearchResult {
  filePath: string        // 相对路径
  fileName: string
  line: number            // 所在行号
  content: string         // 匹配行文本
  preview: string         // 前后上下文
}

export interface WorkbenchState {
  // 工作区基础配置
  workspacePath: string | null        // 根目录绝对路径 (持久化)
  workspaceName: string               // 工作区根文件夹名称
  fileTree: WorkbenchFileNode[]       // 文件树数据
  expandedFolderIds: Set<string>      // 展开的文件夹路径集合 (持久化)
  isLoadingTree: boolean

  // 当前打开的文件
  activeFilePath: string | null       // 当前编辑的相对路径 (持久化)
  activeFileContent: string           // 编辑器当前内存文本
  isDirty: boolean                    // 是否包含未保存的修改
  saveStatus: 'saved' | 'saving' | 'error'
  lastSavedAt: number | null

  // 搜索与过滤
  searchQuery: string
  isSearching: boolean
  searchResults: WorkbenchSearchResult[]

  // 界面布局尺寸与折叠状态
  leftPaneWidth: number               // 左栏宽度 (默认 260)
  rightPaneWidth: number              // 右栏宽度 (默认 420)
  isLeftPaneCollapsed: boolean        // 左栏是否折叠
  isRightPaneCollapsed: boolean       // 右栏是否折叠
  editorMode: 'wysiwyg' | 'source'    // 编辑模式：富文本 / 纯源码

  // 侧边栏 AI 模型
  sidebarModelId: string              // 当前选中的 AI 平台 (持久化)
}
```

### 5.2 切换文件时的脏状态守护 (Dirty File Guard)
当用户编辑了文件 A（`isDirty = true`），未等待防抖写盘便点击文件树中的文件 B 时：
1. **优先自动同步刷盘 (Flush on Switch)**：在加载文件 B 之前，立即取消文件 A 的防抖定时器，并同步调用 `saveActiveFile()`；
2. **写盘失败阻断**：若文件 A 保存遇到磁盘 IO 错误或权限受阻，中断切换，弹出确认弹窗（「当前文件保存失败，是否放弃修改并继续切换？」），杜绝用户内容悄悄丢失。

---

## 6. IPC 协议规范与严密文件安全防护 (IPC & Realpath Security)

### 6.1 IPC 接口契约列表

| IPC 频道名 | 传参 | 返回值 | 说明 |
|---|---|---|---|
| `workbench:select-folder` | 无 | `{ success: boolean, data?: { path: string, name: string }, error?: string }` | 唤起系统原生目录选择器对话框 |
| `workbench:read-tree` | `{ workspaceRoot: string }` | `{ success: boolean, data?: WorkbenchFileNode[], error?: string }` | 递归扫描工作区文件树（跳过系统隐藏及忽略文件） |
| `workbench:read-file` | `{ workspaceRoot: string, relativePath: string }` | `{ success: boolean, data?: { content: string, mtime: number, size: number }, error?: string }` | 安全读取指定 Markdown/文本文件内容 |
| `workbench:write-file` | `{ workspaceRoot: string, relativePath: string, content: string }` | `{ success: boolean, data?: { mtime: number, size: number }, error?: string }` | 安全原子写入文件内容 |
| `workbench:create-node` | `{ workspaceRoot: string, relativePath: string, type: 'file' \| 'folder' }` | `{ success: boolean, data?: WorkbenchFileNode, error?: string }` | 在工作区内创建新文件或目录 |
| `workbench:rename-node` | `{ workspaceRoot: string, oldRelativePath: string, newRelativePath: string }` | `{ success: boolean, error?: string }` | 重命名文件或目录 |
| `workbench:delete-node` | `{ workspaceRoot: string, relativePath: string }` | `{ success: boolean, error?: string }` | 将文件或目录安全移入系统回收站 (Trash) |
| `workbench:search` | `{ workspaceRoot: string, query: string }` | `{ success: boolean, data?: WorkbenchSearchResult[], error?: string }` | 全文搜索关键词并返回行号及摘要 |
| `workbench:reveal-file`| `{ workspaceRoot: string, relativePath: string }` | `{ success: boolean, error?: string }` | 在操作系统文件管理器 (Explorer/Finder) 中高亮展示 |

### 6.2 严密的符号链接与路径遍历防范 (`assertSafePath` 完整实现)

为了彻底解决软链接逃逸（Symlink Traversal）问题，必须使用 `realpath` 验证真实文件系统指向：

```typescript
// src/main/services/workbenchSecurity.ts
import path from 'path'
import { realpath } from 'fs/promises'

/**
 * 校验并返回安全的物理绝对路径
 * 1. 规范化路径分隔符与 resolve
 * 2. 检查解析后的 targetPath 是否以 workspaceRoot 为前缀
 * 3. 必须通过 realpath 校验真实物理路径，防止符号链接 (Symlink) 逃逸出工作区
 */
export async function assertSafePath(workspaceRoot: string, relativePath: string): Promise<string> {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') {
    throw new Error('非法的工作区根路径')
  }

  const normalizedRoot = path.resolve(workspaceRoot)
  const targetPath = path.resolve(normalizedRoot, relativePath)

  // 1. 基础逻辑路径前缀比对
  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error('访问被拒绝：检测到逻辑路径越权 (Path Traversal Attempt)')
  }

  // 2. 校验控制字符
  const baseName = path.basename(targetPath)
  if (baseName.includes('\0') || /[\x00-\x1f]/.test(targetPath)) {
    throw new Error('路径包含非法字符')
  }

  // 3. 真实文件系统路径 (Realpath) 严格比对
  const realRoot = await realpath(normalizedRoot)
  try {
    const realTarget = await realpath(targetPath)
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new Error('访问被拒绝：检测到符号链接逃逸 (Symlink Escape Attempt)')
    }
    return realTarget
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    // 如果目标是尚未创建的新文件，校验其现存父目录的真实路径
    if (nodeErr.code === 'ENOENT') {
      let currentDir = path.dirname(targetPath)
      while (currentDir.startsWith(normalizedRoot)) {
        try {
          const realParent = await realpath(currentDir)
          if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
            throw new Error('访问被拒绝：上级目录符号链接逃逸')
          }
          break
        } catch {
          currentDir = path.dirname(currentDir)
        }
      }
      return targetPath
    }
    throw err
  }
}
```

---

## 7. Meta Lexical 深度集成、表格支持与 Frontmatter 保护

### 7.1 依赖库清单与用户审批提示 (AGENTS.md 依赖合规)
> [!IMPORTANT]
> 依据 `AGENTS.md` 规则「*Ask before adding new production dependencies*」，在正式安装下列生产依赖前，需要向用户明确确认。这些包均为 Meta 官方 Lexical 编辑器套件模块，采用模块化 Tree-shaking 结构，不会对主聊天 Webview 带来体积污染。

```json
{
  "dependencies": {
    "lexical": "^0.20.0",
    "@lexical/react": "^0.20.0",
    "@lexical/markdown": "^0.20.0",
    "@lexical/rich-text": "^0.20.0",
    "@lexical/list": "^0.20.0",
    "@lexical/table": "^0.20.0",
    "@lexical/code": "^0.20.0",
    "@lexical/link": "^0.20.0",
    "@lexical/utils": "^0.20.0"
  }
}
```

### 7.2 表格与全节点注册
在中栏富文本编辑器中完整注册 Markdown 所需的全部 AST 节点，包括表格套件：

```tsx
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode, AutoLinkNode } from '@lexical/link'

const editorConfig = {
  namespace: 'MultiChatWorkbenchEditor',
  nodes: [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    TableNode,
    TableRowNode,
    TableCellNode,
    CodeNode,
    CodeHighlightNode,
    LinkNode,
    AutoLinkNode
  ],
  ...
}
```

### 7.3 YAML Frontmatter 保护机制 (Obsidian 兼容核心)
Obsidian 库中绝大部分 Markdown 笔记开头包含 YAML Frontmatter（如 `--- \n tags: [ai, spec] \n status: draft \n ---`）。Lexical 默认的 `$convertFromMarkdownString` 会将其误判为水平分割线或普通引用，破坏元数据。

**设计 Frontmatter 隔离管道**：
1. **读取时剥离与暂存**：
   ```typescript
   export function parseMarkdownWithFrontmatter(rawContent: string): { frontmatter: string | null; markdownBody: string } {
     const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
     const match = rawContent.match(frontmatterRegex)
     if (match) {
       return {
         frontmatter: match[0],
         markdownBody: rawContent.slice(match[0].length)
       }
     }
     return { frontmatter: null, markdownBody: rawContent }
   }
   ```
2. **编辑器仅加载正文**：Lexical 仅对 `markdownBody` 执行 `$convertFromMarkdownString`；
3. **写盘时原子拼装**：调用 `$convertToMarkdownString` 生成最新正文 Markdown 后，前置拼接已保留的 `frontmatter`，确保写回磁盘的文件元数据 100% 完好无损。

---

## 8. 全文本检索算法与取消优化 (Search Algorithm & Debounce)

### 8.1 300ms 防抖与请求序列守护 (Sequence ID)
为防止用户快速键入搜索词时，多次并发 IPC 请求造成乱序覆盖与磁盘 IO 颠簸：
1. **渲染层防抖 300ms**：输入停顿 300ms 后才发出 `workbench:search` 请求；
2. **递增序列锁 (Sequence Token)**：
   ```typescript
   let currentSearchSeq = 0
   export async function executeSearch(query: string) {
     const seq = ++currentSearchSeq
     setSearching(true)
     const res = await window.api.workbenchSearch(workspacePath, query)
     // 若当前响应已被后续搜索取代，直接丢弃
     if (seq !== currentSearchSeq) return
     setSearchResults(res.data || [])
     setSearching(false)
   }
   ```

### 8.2 流式分块检索算法
主进程使用流式文件读取：
- 仅检索后缀为 `.md`, `.markdown`, `.txt` 且文件大小 `< 2MB` 的文本；
- 采用正则逐行匹配，命中的行截取匹配关键字前后各 30 个字符作为摘要高亮；
- 全局匹配上限截断为 100 条，并在检索耗时超过 1500ms 时实施主动让渡，杜绝卡顿。

---

## 9. 性能、内存控制与生命周期调度 (Performance & Lifecycle)

- **30秒平滑休眠**：右侧嵌入的 Webview 遵循项目既有策略，在面板折叠或切换模式 30 秒后自动挂起渲染并释放内存；
- **文件树虚拟化渲染**：当工作区文件超过 300 个时，左侧文件树使用 `react-virtuoso` 虚拟滚动，维持极端场景下的首屏秒开；
- **生产环境日志管控**：主进程所有文件扫描与检索日志受 `is.dev` 守卫，杜绝内存堆积。

---

## 10. 实施分步规划与里程碑 (Implementation Plan & Milestones)

| 阶段 | 周期 | 核心交付内容 | 涉及主要文件 |
|---|---|---|---|
| **Phase 1: 基础框架与顶栏入口** | 1~2 天 | - `Layout.tsx` 模式控件增添「工作台」入口<br>- `appStore.ts` 扩展 `ProductMode = ... \| 'workbench'`<br>- `App.tsx` 顶层解耦挂载 `WorkbenchPage`<br>- 三栏骨架与响应式 Splitter | `Layout.tsx`<br>`App.tsx`<br>`appStore.ts`<br>`WorkbenchPage.tsx` |
| **Phase 2: 本地文件树与安全 IPC** | 2~3 天 | - 实现主进程 `workbench:select-folder`、`read-tree`、`read-file`、`write-file` 等 IPC<br>- 严格实现包含 `realpath` 的 `assertSafePath` 路径越权拦截<br>- 左栏 Obsidian 风格文件树与新建/重命名/删除上下文菜单 | `src/main/ipcHandlers.ts`<br>`workbenchSecurity.ts`<br>`src/preload/index.ts`<br>`WorkbenchFileTree.tsx` |
| **Phase 3: Meta Lexical 编辑器集成** | 3~4 天 | - 获得用户审批后引入 `lexical` 相关依赖包<br>- 搭建富文本 Markdown 编辑器核心与工具栏（含表格支持）<br>- 接入 `MarkdownShortcutPlugin` 即时转换<br>- YAML Frontmatter 保护与防抖切文件守护 | `WorkbenchEditor.tsx`<br>`MarkdownSyncPlugin.tsx`<br>`WorkbenchToolbar.tsx`<br>`package.json` |
| **Phase 4: AI Webview 复用与划词联动** | 2 天 | - 封装右栏 `WorkbenchAiSidebar.tsx` 复用现有 `WebviewCard`<br>- 在 `CustomContextMenu.tsx` 中增加作用域守卫，提供「向 AI 提问/解释/润色」动作<br>- 划词注入与自动唤醒侧边栏连通 | `WorkbenchAiSidebar.tsx`<br>`CustomContextMenu.tsx`<br>`useWebviewSidebar.ts` |
| **Phase 5: 全文搜索、体验打磨与集成验证** | 2 天 | - 实现 300ms 防抖与序列锁全文本检索<br>- Obsidian 真实 Vault 兼容性实测<br>- 执行 `npm run lint` -> `npm run build` -> `npm run dev` 端到端验证 | 全模块联调 |

---

## 11. 总结 (Conclusion)

通过本次优化升级后的规范文档，「工作台」具备了极高的生产可用性与架构严密性：
1. **顶层解耦与独立性**：在 `App.tsx` 顶层挂载，彻底摆脱 `MainPage` 的会话轮询与控制栏干扰；
2. **绝对的文件系统安全**：采用 `realpath` 双向校验，彻底堵死软链接逃逸与越权路径遍历漏洞；
3. **真实生产级 Obsidian 兼容**：引入表格支持与 YAML Frontmatter 保护通道，确保本地知识库无损漫游；
4. **防抖与防丢机制完备**：切文件时主动刷盘守护脏数据，全文检索配合防抖与序列锁。
