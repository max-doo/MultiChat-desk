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

export interface WorkbenchFileInfo {
  content: string
  mtime: number
  size: number
  category?: WorkbenchFileCategory
  dataUrl?: string
  mimeType?: string
  isBinary?: boolean
  isOversized?: boolean
}

export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif', '.tiff', '.tif'
])

export const PDF_EXTENSIONS = new Set(['.pdf'])

export const DOCUMENT_EXTENSIONS = new Set([
  '.docx', '.doc', '.dotx', '.dot', '.rtf', '.odt',
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.xltx', '.xlt', '.ods',
  '.pptx', '.ppt', '.pptm', '.potx', '.pot', '.ppsx', '.pps', '.odp'
])

export const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

export const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.csv', '.tsv'])

export const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.json5',
  '.html', '.htm', '.css', '.scss', '.less', '.sass',
  '.py', '.pyw',
  '.java', '.class',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.cs', '.rs', '.go', '.php', '.rb', '.swift', '.kt', '.kts',
  '.sql',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.yaml', '.yml', '.xml', '.toml', '.ini', '.env',
  '.dockerfile', '.dockerignore', '.gitignore',
  '.graphql', '.gql', '.proto',
  '.vue', '.svelte',
  '.lua', '.r', '.dart'
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
