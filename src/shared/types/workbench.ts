/**
 * 工作台 (Workbench) 共享类型定义
 * 用于主进程、Preload 与渲染进程通信与状态管理
 */

export type WorkbenchFileCategory =
  | 'markdown'
  | 'code'
  | 'image'
  | 'pdf'
  | 'document'
  | 'text'
  | 'other'

export interface WorkbenchFileNode {
  id: string              // 节点相对路径 (POSIX 格式，如 'docs/guide.md')
  name: string            // 显示名称
  path: string            // 相对路径
  fullPath: string        // 绝对路径
  isDirectory: boolean
  extension?: string      // 文件后缀名 (如 '.md', '.txt')
  category?: WorkbenchFileCategory
  size?: number           // 文件大小 (字节)
  mtime?: number          // 修改时间戳 (毫秒)
  children?: WorkbenchFileNode[]
}

export interface WorkbenchSearchResult {
  filePath: string        // 相对路径
  fileName: string        // 文件名称
  line: number            // 所在行号 (1-indexed)
  content: string         // 匹配行文本
  preview: string         // 前后上下文摘要
}

/** 工作区标签聚合信息（支持标签自动补全与防泛滥） */
export interface WorkspaceTagInfo {
  tag: string             // 标签名称（不含 #）
  count: number           // 引用频次
}

/** 工作区版本管理（Git）状态；主进程解析 porcelain v2 后提供给界面 */
export interface GitFileChange {
  path: string
  /** 重命名/复制前的路径 */
  oldPath?: string
  /** 暂存区相对 HEAD 的变化；未跟踪文件为 null */
  staged: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange' | null
  /** 工作区相对暂存区的变化 */
  unstaged: 'modified' | 'deleted' | 'typechange' | null
  untracked: boolean
  conflicted: boolean
}

export interface GitStatus {
  /** 未安装 Git、不是仓库或命令失败时的说明；available 为 false 表示不可用 */
  error: string | null
  available: boolean
  isRepository: boolean
  /** 仓库根目录；工作区可能是仓库子目录 */
  repoRoot: string | null
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** 仓库尚无任何提交 */
  unborn: boolean
  /** 工作区内的改动总数（含未跟踪）；超过展示上限时仍然准确 */
  changeCount: number
  /** 已暂存的改动数 */
  stagedCount: number
  /** 未暂存（含未跟踪）的改动数 */
  unstagedCount: number
  /** 未解决的冲突数 */
  conflictCount: number
  /** 进行中的合并（合并冲突后需要用户撤销） */
  merging: boolean
  /** 进行中的变基（本应用不产生，可能来自终端操作） */
  rebasing: boolean
  changes: GitFileChange[]
  changesTruncated: boolean
  /** 会阻止拉取/合并的已跟踪文件改动数；超过展示上限时仍然准确 */
  blockingChangeCount: number
  /** 是否配置了远程 */
  hasRemote: boolean
  /** 用于推送的远程名；优先 origin，没有则取第一个 */
  remoteName: string | null
  /** 未跟踪且超过单文件建议体积的文件（提交前提示用） */
  largeUntracked: Array<{ path: string; size: number }>
}

/** 编辑器行内/块级变更标记的基线读取结果 */
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
  /** 仅 status === 'ok' 时返回；已按 UTF-8 解码，未做换行归一化 */
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

export type GitActionFailure =
  | 'not-installed'
  | 'not-repository'
  | 'dirty'
  | 'diverged'
  | 'conflict'
  | 'large-files'
  | 'no-upstream'
  | 'rejected'
  | 'detached'
  | 'failed'

export interface GitActionResult {
  success: boolean
  failure?: GitActionFailure
  error?: string
  /** 面向用户的下一步说明 */
  hint?: string
}

export interface GitignoreEntry {
  /** 原始规则文本，例如 `*.zip` */
  pattern: string
  /** 该规则上方紧邻的注释（含 # 前缀） */
  comment: string | null
}

export interface GitignoreSnapshot {
  exists: boolean
  /** 文件原文；编辑器直接展示和保存这份文本，保留注释、空行与顺序 */
  content: string
  entries: GitignoreEntry[]
}

/** 忽略规则分组：按文件类型归类，用户自行勾选要忽略的组 */
export interface GitignoreCategory {
  id: string
  label: string
  description: string
  /** 默认勾选：几乎不会与知识库正文冲突的通用项 */
  recommended: boolean
  patterns: string[]
}

/** Git 历史提交；父提交用于在渲染层计算泳道连接 */
export interface GitHistoryItem {
  /** 完整提交 hash，作为提交图和父提交关系的稳定标识 */
  id: string
  /** 界面上展示的短 hash */
  shortId: string
  /** 父提交完整 hash；合并提交会有多个 */
  parentIds: string[]
  message: string
  author: string
  /** Unix 秒级时间戳 */
  date: number
  /** 分支/标签引用名 */
  refs: string[]
  /** 是否已在任一远程分支上；本地提交尚未推送时为 false */
  pushed: boolean
}

/** 仓库远程地址；只读展示，凭据由系统 Git 凭据管理器保存 */
export interface GitRemoteInfo {
  name: string
  /** 已脱敏的地址，可直接展示 */
  url: string
  /** 原地址含凭据；修改时必须重新输入，避免把脱敏值写回仓库 */
  redacted: boolean
}

/** 提交详情中的单个文件改动；路径为仓库根相对 POSIX 路径 */
export interface GitCommitFile {
  path: string
  /** 重命名/复制来源路径 */
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange'
  /** numstat 无法计数（二进制文件）时为 null */
  insertions: number | null
  deletions: number | null
}

/** 单条提交的完整详情；numstat 只统计文本文件，二进制行数为 null */
export interface GitCommitDetail {
  id: string
  shortId: string
  /** 提交标题（subject） */
  subject: string
  /** 完整提交说明（含 body） */
  body: string
  author: string
  email: string
  /** Unix 秒级时间戳 */
  date: number
  parentIds: string[]
  refs: string[]
  files: GitCommitFile[]
  insertions: number
  deletions: number
  /** 文件列表被 MAX 截断时 true，需要提示可能不完整 */
  filesTruncated: boolean
}

/** 迁移前 frontmatter 备份：按工作区聚合，供设置面板展示与清理 */
export interface FrontmatterBackupGroup {
  workspaceRoot: string
  /** 备份文件数 */
  files: number
  /** 备份占用字节 */
  bytes: number
  /** 原文档已不存在、清理时会保留的备份数 */
  orphans: number
}

export interface FrontmatterBackupSummary {
  files: number
  bytes: number
  orphans: number
  groups: FrontmatterBackupGroup[]
}

export interface FrontmatterBackupClearResult {
  removed: number
  /** 因原文档缺失而保留的备份数 */
  kept: number
  errors: Array<{ workspaceRoot: string; relativePath: string; error: string }>
}

export interface WorkbenchFileInfo {
  content: string
  mtime: number
  size: number
  category?: WorkbenchFileCategory
  dataUrl?: string
  fileUrl?: string
  mimeType?: string
  isBinary?: boolean
  isOversized?: boolean
}

export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif', '.tiff', '.tif'
])

export const PDF_EXTENSIONS = new Set(['.pdf'])

/**
 * Word 内嵌预览上限。
 * docx-preview 需要完整解压 OOXML 包并在 renderer 构建 DOM，
 * 超过该体积后峰值内存与渲染耗时都不适合常驻工作台，改走卡片兜底。
 */
export const DOCX_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

export const DOCUMENT_EXTENSIONS = new Set([
  '.docx', '.doc', '.dotx', '.dot', '.rtf', '.odt',
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.xltx', '.xlt', '.ods',
  '.pptx', '.ppt', '.pptm', '.potx', '.pot', '.ppsx', '.pps', '.odp'
])

export const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])

export const TEXT_EXTENSIONS = new Set(['.log', '.csv', '.tsv'])

export const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.json5', '.jsonl', '.ndjson',
  '.html', '.htm', '.css', '.scss', '.less', '.sass',
  '.py', '.pyw',
  '.java', '.class',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.cs', '.rs', '.go', '.php', '.rb', '.swift', '.kt', '.kts',
  '.sql',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.yaml', '.yml', '.xml', '.toml', '.ini', '.env',
  '.dockerfile', '.dockerignore', '.gitignore', '.gitattributes', '.editorconfig',
  '.graphql', '.gql', '.proto',
  '.vue', '.svelte',
  '.lua', '.r', '.dart',
  '.conf', '.cfg', '.properties', '.lock', '.prisma', '.diff', '.patch'
])

export function getFileCategory(nameOrPath: string): WorkbenchFileCategory {
  const lower = nameOrPath.toLowerCase()
  const baseName = lower.split(/[/\\]/).pop() || ''
  if (baseName === 'dockerfile' || baseName.startsWith('.env') || baseName === '.gitignore') {
    return 'code'
  }
  const lastDot = lower.lastIndexOf('.')
  const ext = lastDot !== -1 ? lower.slice(lastDot) : ''

  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'other'
}

export interface WorkbenchWriteResult {
  mtime: number
  size: number
}

export interface WorkbenchSelectFolderResult {
  path: string
  name: string
}

export type WorkbenchNodeType = 'file' | 'folder'

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
