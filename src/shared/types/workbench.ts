/**
 * 工作台 (Workbench) 共享类型定义
 * 用于主进程、Preload 与渲染进程通信与状态管理
 */

export interface WorkbenchFileNode {
  id: string              // 节点相对路径 (POSIX 格式，如 'docs/guide.md')
  name: string            // 显示名称
  path: string            // 相对路径
  fullPath: string        // 绝对路径
  isDirectory: boolean
  extension?: string      // 文件后缀名 (如 '.md', '.txt')
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
