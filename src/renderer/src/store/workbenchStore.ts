import { create } from 'zustand'
import {
  type WorkbenchFileNode,
  type WorkbenchSearchResult,
  type WorkbenchFileCategory,
  type WorkspaceTagInfo,
  type GitStatus,
  type GitActionResult,
  getFileCategory,
  MARKDOWN_EXTENSIONS
} from '../../../shared/types/workbench'
import {
  adoptLegacyConversationFrontmatter,
  buildReplyExcerptFrontmatter,
  normalizeConversationFrontmatter,
  upsertConversationFrontmatter
} from '../../../shared/utils/conversationFrontmatter'
import { isConversationUrlForPlatform } from '../../../shared/utils/conversationUrl'
import { defaultSelectors } from '../../../shared/config/selectors'
import {
  looksLikeConversationTranscript,
  stripFrontmatter
} from '../../../shared/utils/noteTranscript'
import { useAppStore } from './appStore'

export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict'
export interface SaveActiveFileResult {
  saved: boolean
  reason?: 'oversized' | 'conflict' | 'error' | 'binary' | 'no-active'
}
export interface DocumentAnnotationFlushResult {
  saved: boolean
  error?: string
}
export type HtmlEditLeaveDecision = 'saved' | 'discarded' | 'cancelled'
export type EditorMode = 'wysiwyg' | 'source'
export type WorkbenchContentWidth = 'narrow' | 'medium' | 'wide'
export type WorkbenchAiAction = 'ask' | 'explain' | 'polish' | 'summarize'
/** 右侧栏与快捷窗口一致：AI 对话和思维导图同一时刻只显示一个（注释改为在编辑器右侧边距原位展示）。 */
export type WorkbenchRightPane = 'ai' | 'mindmap' | null
export type WorkbenchSortKey = 'name' | 'mtime' | 'size'
export type WorkbenchSortOrder = 'asc' | 'desc'
export type ImageBackgroundTheme = 'checkerboard' | 'light' | 'dark'

export interface WorkbenchSortPreference {
  key: WorkbenchSortKey
  order: WorkbenchSortOrder
}

// 右侧 AI 侧边栏宽度限制：随窗口宽度分档，避免小窗下侧边栏过宽挤压编辑器
export const WORKBENCH_MIN_EDITOR_WIDTH = 380
const RIGHT_PANE_MIN = 300
// 双 AI 侧栏并排时整个右栏容器的下限：两栏各至少 320，避免挤压成窄条不可读。
const RIGHT_PANE_DUAL_MIN = 640
const RIGHT_PANE_MAX_TIERS: Array<{ minWindowWidth: number; maxPaneWidth: number }> = [
  { minWindowWidth: 1680, maxPaneWidth: 960 },
  { minWindowWidth: 1440, maxPaneWidth: 640 },
  { minWindowWidth: 1200, maxPaneWidth: 560 },
  { minWindowWidth: 0, maxPaneWidth: 480 }
]

export function getRightPaneMaxWidth(
  windowWidth?: number,
  leftWidth?: number,
  isLeftCollapsed?: boolean,
  isDualAi?: boolean
): number {
  const winW = typeof window === 'undefined' ? 1400 : (windowWidth ?? window.innerWidth)
  const state = typeof useWorkbenchStore !== 'undefined' ? useWorkbenchStore.getState() : null
  const collapsed = isLeftCollapsed ?? state?.isLeftCollapsed ?? false
  const leftW = collapsed ? 0 : (leftWidth ?? state?.leftPaneWidth ?? 260)
  const splitters = collapsed ? 5 : 10
  const dualAi = isDualAi ?? state?.isAiSidebar2Open ?? false
  const minPane = dualAi ? RIGHT_PANE_DUAL_MIN : RIGHT_PANE_MIN

  // 窗口剩余空间计算：确保留足左栏、中栏保底和分割条，避免小窗下三栏硬性尺寸之和溢出被 overflow 截断
  const maxAllowedByWindow = Math.max(
    minPane,
    winW - leftW - WORKBENCH_MIN_EDITOR_WIDTH - splitters
  )

  let tierMax = minPane
  for (const tier of RIGHT_PANE_MAX_TIERS) {
    if (winW >= tier.minWindowWidth) {
      tierMax = tier.maxPaneWidth
      break
    }
  }

  // 双 AI 侧边栏并排时总宽度允许翻倍，仍受窗口剩余空间约束
  const paneMax = dualAi ? Math.max(minPane, tierMax * 2) : tierMax
  return Math.min(paneMax, maxAllowedByWindow)
}

/**
 * 保存普通 Markdown 时只收敛明确标成会话的文档；没有 source_kind 的旧会话
 * 文档，只有来源确属已配置平台的会话页才补类型，避免误改用户自己的文档。
 */
const LEGACY_CONVERSATION_KEYS = new Set([
  'source',
  'source_url',
  'source_key',
  'source_kind',
  'platform',
  'captured_at',
  'title',
  'id',
  'updated_at'
])

function normalizeMarkdownFrontmatter(content: string): string {
  const normalized = normalizeConversationFrontmatter(content)
  if (normalized !== content) return normalized
  const frontmatter = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)?.[1]
  if (!frontmatter) return content
  // 显式写了任何类型（包括 plain）都由文档自己决定，不再做旧会话升级；
  // 只有完全无类型标记的历史文档才进入兼容判定。
  if (/^source_kind\s*:/im.test(frontmatter)) return content
  // 只接管字段集合仍然像「旧会话文档」的文件。带 tags/status 等用户字段的
  // 笔记即使引用了会话链接，也保持普通 Markdown，不把同名属性解释成来源。
  const keys = [...frontmatter.matchAll(/^([A-Za-z0-9_-]+)\s*:/gm)].map(match =>
    match[1].toLowerCase()
  )
  if (keys.some(key => !LEGACY_CONVERSATION_KEYS.has(key))) return content
  const raw = /^(?:source|source_url|source_key)\s*:\s*["']?(https:\/\/.+?)["']?\s*$/im.exec(
    frontmatter
  )?.[1]
  if (!raw) return content
  // 旧会话必须同时具备完整对话结构；只有来源链接、正文是单条回复或普通
  // 笔记时保持普通文档，避免把回复摘录升级成会话快照。
  if (!looksLikeConversationTranscript(stripFrontmatter(content))) {
    return content
  }
  const isConversation = Object.entries(defaultSelectors.models).some(([platformId, config]) =>
    !!config.newConversationUrl && isConversationUrlForPlatform(platformId, raw, config.newConversationUrl)
  )
  if (!isConversation) return content
  return adoptLegacyConversationFrontmatter(content)
}

function clampRightPaneWidth(
  width: number,
  windowWidth?: number,
  leftWidth?: number,
  isLeftCollapsed?: boolean,
  isDualAi?: boolean
): number {
  const state = typeof useWorkbenchStore !== 'undefined' ? useWorkbenchStore.getState() : null
  const dualAi = isDualAi ?? state?.isAiSidebar2Open ?? false
  const maxAllowed = getRightPaneMaxWidth(windowWidth, leftWidth, isLeftCollapsed, dualAi)
  const minAllowed = Math.min(dualAi ? RIGHT_PANE_DUAL_MIN : RIGHT_PANE_MIN, maxAllowed)
  return Math.max(minAllowed, Math.min(maxAllowed, width))
}

interface WorkbenchStoreState {
  // 工作区状态
  workspacePath: string | null
  workspaceName: string
  /** 主进程 activateWorkspace 返回的版本号；用于 closeWorkspace 防止关错工作区。 */
  workspaceGeneration: number
  recentWorkspaces: string[]
  defaultWorkspacePath: string | null
  fileTree: WorkbenchFileNode[]
  expandedFolderIds: Set<string>
  isLoadingTree: boolean
  isInitialized: boolean

  // 当前激活文档与预览元信息
  activeFilePath: string | null
  activeFileContent: string
  activeFileCategory: WorkbenchFileCategory | null
  activeFileDataUrl: string | null
  activeFileUrl: string | null
  activeFileMime: string | null
  activeFileSize: number | null
  activeFileOversized: boolean
  /** 当前文档的 document 标注数；删除确认会据此说明旁路影响。 */
  activeAnnotationCount: number
  isDirty: boolean
  saveStatus: SaveStatus
  lastSavedAt: number | null
  // 外部冲突：保存时检测到磁盘 mtime 比内存新，拉回来的磁盘版本内容
  conflictDiskContent: string | null
  // 可视化编辑期间注册的序列化回调：保存前拉取 iframe 内的最新 DOM
  htmlEditFlusher: (() => Promise<string>) | null
  // 切文件/切工作区前由可视化编辑组件接管确认，避免静默自动保存或直接丢改动
  htmlEditLeaveGuard: (() => Promise<HtmlEditLeaveDecision>) | null
  /** 当前是否处于 HTML 可视化编辑态；用于隐藏会遮挡浮层工具的通用状态胶囊。 */
  htmlVisualEditing: boolean

  // 搜索相关
  searchQuery: string
  isSearching: boolean
  searchResults: WorkbenchSearchResult[]

  // 工作区标签集合（用于标签自动补全与防泛滥）
  workspaceTags: WorkspaceTagInfo[]

  // 文件树排序偏好
  fileSort: WorkbenchSortPreference

  // 布局尺寸与折叠
  leftPaneWidth: number
  rightPaneWidth: number
  isLeftCollapsed: boolean
  rightPane: WorkbenchRightPane
  /** 是否在文档右侧展示原位旁注便签 */
  showMarginNotes: boolean
  /** 图片预览画布背景，全局持久化，切换图片后保持一致 */
  imageBackgroundTheme: ImageBackgroundTheme
  /** 待生成的选区范围；由编辑器划词菜单写入，导图面板消费后清空。 */
  pendingMindmapSelection: { text: string; headingPath: string[] } | null
  /** 待打开的来源会话；笔记属性里的会话图标写入，AI 侧边栏消费后清空。 */
  pendingConversationOpen: { platformId: string; url: string; token: number; target?: 'ai' | 'ai2' } | null
  sidebarModelId: string
  sidebar2ModelId: string
  isAiSidebar2Open: boolean
  editorMode: EditorMode
  /** WYSIWYG 预览模式正文栏宽：narrow≈640px / medium≈720px / wide≈880px */
  contentWidth: WorkbenchContentWidth
  /** 由 WorkbenchAnnotationPlugin 注册；切文件、关闭和退出前等待最后一次对账。 */
  documentAnnotationFlusher: (() => Promise<DocumentAnnotationFlushResult>) | null

  // 错误提示
  error: string | null
  /** 非错误类轻提示（如跨工作区移动成功），自动消失，不影响错误条 */
  notice: { message: string } | null

  /** 对账判定为「外部删除」的待确认导图记录；确认后带 force+targets 执行。 */
  pendingMindmapDeletions: Array<{ conversationId: string; relativePath: string }> | null

  // 工作区文件拖拽态
  draggingNodes: WorkbenchFileNode[] | null

  // 版本管理
  gitStatus: GitStatus | null
  isGitLoading: boolean
  isGitBusy: boolean
  gitNotice: { tone: 'success' | 'info' | 'warning' | 'error'; message: string } | null
}

interface WorkbenchStoreActions {
  initWorkbench: () => Promise<void>
  selectWorkspaceFolder: () => Promise<void>
  /** 切换工作区；返回切换结果供调用方区分「取消」与「失败」。 */
  setWorkspaceFolder: (dirPath: string, dirName?: string) => Promise<'switched' | 'cancelled' | 'failed'>
  closeWorkspace: () => Promise<void>
  removeRecentWorkspace: (dirPath: string) => void
  loadFileTree: () => Promise<void>
  toggleFolder: (folderId: string) => void
  expandAllFolders: () => void
  collapseAllFolders: () => void
  /** 展开某文件路径的全部祖先目录，供 openFile 后侧边栏定位复用。 */
  expandAncestorsOf: (relativePath: string) => void
  openFile: (
    relativePath: string,
    options?: { keepActiveOnMissing?: boolean }
  ) => Promise<boolean>
  saveActiveFile: () => Promise<SaveActiveFileResult>
  setDocumentAnnotationFlusher: (
    flusher: (() => Promise<DocumentAnnotationFlushResult>) | null
  ) => void
  flushDocumentAnnotations: () => Promise<DocumentAnnotationFlushResult>
  resolveExternalConflict: (choice: 'keep-mine' | 'take-disk') => Promise<boolean>
  updateActiveContent: (content: string) => void
  setHtmlEditFlusher: (flusher: (() => Promise<string>) | null) => void
  setHtmlEditLeaveGuard: (guard: (() => Promise<HtmlEditLeaveDecision>) | null) => void
  setHtmlVisualEditing: (editing: boolean) => void
  markActiveFileDirty: () => void
  discardActiveFileChanges: (content?: string) => void
  createFile: (parentRelativeDir: string, fileName: string) => Promise<string | null>
  createFolder: (parentRelativeDir: string, folderName: string) => Promise<boolean>
  renameNode: (oldRelativePath: string, newRelativePath: string) => Promise<boolean>
  moveNode: (sourceRelativePath: string, targetDirRelative: string) => Promise<boolean>
  moveNodes: (sourceRelativePaths: string[], targetDirRelative: string) => Promise<boolean>
  deleteNode: (relativePath: string) => Promise<boolean>
  insertReplyIntoActiveMarkdown: (
    replyMd: string,
    meta?: { conversationUrl?: string; platformId?: string }
  ) => Promise<{ success: boolean; error?: string }>
  saveReplyAsNewMarkdown: (
    replyMd: string,
    meta: { platformId: string; title?: string; conversationUrl?: string }
  ) => Promise<{ success: boolean; error?: string }>
  revealFile: (relativePath: string) => Promise<void>
  openInSystem: (relativePath: string) => Promise<void>
  findUnreferencedImages: (documentRelativePath: string) => Promise<{ unreferenced: string[]; total: number } | null>
  deleteNodes: (relativePaths: string[]) => Promise<boolean>
  importExternalItems: (targetDirRelative: string, sourceAbsolutePaths: string[]) => Promise<{ imported: string[]; failed: { path: string; error: string }[] } | null>
  moveToWorkspace: (
    targetWorkspaceRoot: string,
    relativePaths: string[]
  ) => Promise<{ moved: Array<{ source: string; target: string }>; failed: Array<{ path: string; error: string }> } | null>
  handleExternalFsChanged: (workspaceRoot: string) => Promise<void>
  searchFiles: (query: string) => void
  clearSearch: () => void
  loadWorkspaceTags: () => Promise<void>
  setFileSort: (pref: WorkbenchSortPreference) => void
  setLeftPaneWidth: (width: number, persist?: boolean) => number
  setRightPaneWidth: (width: number, persist?: boolean) => number
  toggleLeftCollapse: () => void
  toggleMarginNotes: () => void
  openRightPane: (pane: Exclude<WorkbenchRightPane, null>) => void
  closeRightPane: () => void
  setPendingMindmapSelection: (selection: { text: string; headingPath: string[] } | null) => void
  openConversationInAiSidebar: (platformId: string, url: string) => void
  openConversationInAiSidebar2: (platformId: string, url: string) => void
  openAiSidebar2: () => void
  closeAiSidebar2: () => void
  consumeConversationOpen: (token: number) => void
  setSidebarModelId: (modelId: string) => void
  setSidebar2ModelId: (modelId: string) => void
  setEditorMode: (mode: EditorMode) => void
  setContentWidth: (width: WorkbenchContentWidth) => void
  setImageBackgroundTheme: (theme: ImageBackgroundTheme) => void
  askAi: (text: string, actionType: WorkbenchAiAction, target?: 'ai' | 'ai2') => void
  clearError: () => void
  showNotice: (message: string) => void
  clearNotice: () => void
  setDraggingNodes: (nodes: WorkbenchFileNode[] | null) => void

  /** 用户对账确认删除：把 pendingMindmapDeletions 带 force+targets 执行。 */
  confirmMindmapDeletions: (targets: Array<{ conversationId: string; relativePath: string }>) => Promise<void>

  refreshGitStatus: (options?: { showLoading?: boolean }) => Promise<void>
  gitCommit: (title: string, body?: string, allowLargeFiles?: boolean) => Promise<GitActionResult>
  gitPull: () => Promise<GitActionResult>
  gitMergeUpstream: () => Promise<GitActionResult>
  gitAbortMerge: () => Promise<GitActionResult>
  gitPush: (setUpstream?: boolean) => Promise<GitActionResult>
  gitInit: () => Promise<GitActionResult>
  gitSetRemote: (url: string, name?: string) => Promise<GitActionResult>
  setGitNotice: (notice: WorkbenchStoreState['gitNotice']) => void
  clearGitNotice: () => void
}

export type WorkbenchStore = WorkbenchStoreState & WorkbenchStoreActions

// 防抖与请求序列锁
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let currentSearchSeq = 0
let fsWatcherBound = false
let gitStatusSeq = 0
/** 同一时刻只保留一个在途的状态请求：连续触发时合并为最后一次，避免 Git 命令排队拖住刷新图标 */
let gitStatusInFlight = false
let gitStatusPending = false
/**
 * 最近一次对账发现的改名映射（旧路径 → 新路径）。
 * 应用关闭期间的外部改名只在重新载入时对账一次，恢复上次打开的文档要能跟着走。
 * 键带上工作区，避免切换工作区后同名相对路径被错误重定向。
 */
const recentRelinks = new Map<string, string>()
const relinkKey = (workspaceRoot: string, relativePath: string): string =>
  `${workspaceRoot.replace(/\\/g, '/').toLowerCase()}\n${relativePath}`

// 收集树中所有相对路径（含目录），用于判断当前激活文件是否被外部删除/移走
function collectTreePaths(nodes: WorkbenchFileNode[], out: Set<string>): Set<string> {
  for (const node of nodes) {
    out.add(node.path)
    if (node.children) collectTreePaths(node.children, out)
  }
  return out
}

/** 文件树已经带 size/mtime，直接当对账索引，主进程无需再扫盘。 */
function collectFileIndex(nodes: WorkbenchFileNode[], out: Array<{ path: string; size?: number; mtime?: number }>): void {
  for (const node of nodes) {
    if (node.isDirectory) {
      if (node.children) collectFileIndex(node.children, out)
    } else {
      out.push({ path: node.path, size: node.size, mtime: node.mtime })
    }
  }
}

function findNode(nodes: WorkbenchFileNode[], target: string): WorkbenchFileNode | null {
  for (const node of nodes) {
    if (node.path === target) return node
    if (node.isDirectory && node.children) {
      const hit = findNode(node.children, target)
      if (hit) return hit
    }
  }
  return null
}

/** 按当前排序拍平文件列表（目录优先，与树渲染一致），用于删除后挑相邻文件 */
function flattenSortedFiles(
  nodes: WorkbenchFileNode[],
  sort: WorkbenchSortPreference
): WorkbenchFileNode[] {
  const dir = sort.order === 'asc' ? 1 : -1
  const flat: WorkbenchFileNode[] = []
  const walk = (list: WorkbenchFileNode[]): void => {
    const sorted = [...list].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      if (sort.key === 'name' || a.isDirectory || b.isDirectory) {
        return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      }
      if (sort.key === 'mtime') return dir * ((a.mtime ?? 0) - (b.mtime ?? 0))
      const diff = (a.size ?? 0) - (b.size ?? 0)
      return diff !== 0
        ? dir * diff
        : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const node of sorted) {
      if (node.isDirectory) {
        if (node.children) walk(node.children)
      } else {
        flat.push(node)
      }
    }
  }
  walk(nodes)
  return flat
}

/** 路径是否命中待删除项（含被删目录下的子项） */
function isDeletedPath(target: string, deletedPaths: readonly string[]): boolean {
  return deletedPaths.some(path => target === path || target.startsWith(`${path}/`))
}

/** 删除后接管编辑器的文件：先向后取同序位的幸存文件，没有则向前取 */
function pickNextActiveFile(
  flat: WorkbenchFileNode[],
  activePath: string,
  deletedPaths: readonly string[]
): string | null {
  const index = flat.findIndex(node => node.path === activePath)
  if (index < 0) return null
  for (let i = index + 1; i < flat.length; i++) {
    if (!isDeletedPath(flat[i].path, deletedPaths)) return flat[i].path
  }
  for (let i = index - 1; i >= 0; i--) {
    if (!isDeletedPath(flat[i].path, deletedPaths)) return flat[i].path
  }
  return null
}

/** 从树中移除指定路径；无命中时返回原引用，避免整棵树被重建触发全量重渲染 */
function removeTreePaths(nodes: WorkbenchFileNode[], deletedPaths: readonly string[]): WorkbenchFileNode[] {
  let changed = false
  const next: WorkbenchFileNode[] = []
  for (const node of nodes) {
    if (isDeletedPath(node.path, deletedPaths)) {
      changed = true
      continue
    }
    if (!node.children) {
      next.push(node)
      continue
    }
    const children = removeTreePaths(node.children, deletedPaths)
    if (children === node.children) {
      next.push(node)
    } else {
      changed = true
      next.push({ ...node, children })
    }
  }
  return changed ? next : nodes
}

/**
 * 删除失败时还原编辑器：乐观移除已经清空了内容，必须把原状态写回去，
 * 否则文件还在磁盘上却显示为空文档。
 */
function restoreActiveFileState(
  snapshot: Pick<
    WorkbenchStoreState,
    | 'activeFilePath'
    | 'activeFileContent'
    | 'activeFileCategory'
    | 'activeFileDataUrl'
    | 'activeFileUrl'
    | 'activeFileMime'
    | 'activeFileSize'
    | 'activeFileOversized'
    | 'isDirty'
    | 'saveStatus'
    | 'conflictDiskContent'
  >
): void {
  useWorkbenchStore.setState({
    activeFilePath: snapshot.activeFilePath,
    activeFileContent: snapshot.activeFileContent,
    activeFileCategory: snapshot.activeFileCategory,
    activeFileDataUrl: snapshot.activeFileDataUrl,
    activeFileUrl: snapshot.activeFileUrl,
    activeFileMime: snapshot.activeFileMime,
    activeFileSize: snapshot.activeFileSize,
    activeFileOversized: snapshot.activeFileOversized,
    isDirty: snapshot.isDirty,
    saveStatus: snapshot.saveStatus,
    conflictDiskContent: snapshot.conflictDiskContent
  })
  if (snapshot.activeFilePath) {
    void window.api.storeSet('workbench_lastActiveFilePath', snapshot.activeFilePath)
  }
}

/**
 * 编辑器跟随外部改名：没有导图的文档不会出现在对账结果里，
 * 用同一套“大小 + mtime”判据在内存里补一次，唯一命中才认。
 */
function findRenamedNode(
  previous: WorkbenchFileNode[],
  next: WorkbenchFileNode[],
  activePath: string
): string | null {
  const before = findNode(previous, activePath)
  if (!before || before.isDirectory) return null
  const matches: string[] = []
  const walk = (nodes: WorkbenchFileNode[]): void => {
    for (const node of nodes) {
      if (node.isDirectory) {
        if (node.children) walk(node.children)
        continue
      }
      if (node.path === activePath) continue
      if (node.size !== before.size || node.mtime !== before.mtime) continue
      if (node.extension !== before.extension) continue
      matches.push(node.path)
    }
  }
  walk(next)
  return matches.length === 1 ? matches[0] : null
}

function reconcileMindmaps(
  workspaceRoot: string,
  tree: WorkbenchFileNode[]
): Promise<{ deleted: number; relinked: number; relinks: Array<{ from: string; to: string }>; pendingDeletions: Array<{ conversationId: string; relativePath: string }> } | null> {
  const index: Array<{ path: string; size?: number; mtime?: number }> = []
  collectFileIndex(tree, index)
  return window.api.workbench.reconcileMindmaps(workspaceRoot, index)
    .then(res => {
      if (!res.success || !res.data) return null
      for (const link of res.data.relinks) {
        recentRelinks.set(relinkKey(workspaceRoot, link.from), link.to)
      }
      if (res.data.pendingDeletions?.length) {
        useWorkbenchStore.setState({ pendingMindmapDeletions: res.data.pendingDeletions })
      } else if (res.data.pendingDeletions) {
        useWorkbenchStore.setState({ pendingMindmapDeletions: null })
      }
      // 只是恢复上次打开的文档用的短期映射，不做无界增长。
      while (recentRelinks.size > 200) {
        const oldest = recentRelinks.keys().next().value
        if (oldest === undefined) break
        recentRelinks.delete(oldest)
      }
      return res.data
    })
    .catch(() => null)
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  // 初始状态
  workspacePath: null,
  workspaceName: '',
  workspaceGeneration: 0,
  recentWorkspaces: [],
  defaultWorkspacePath: null,
  fileTree: [],
  expandedFolderIds: new Set<string>(),
  isLoadingTree: false,
  isInitialized: false,

  activeFilePath: null,
  activeFileContent: '',
  activeFileCategory: null,
  activeFileDataUrl: null,
  activeFileUrl: null,
  activeFileMime: null,
  activeFileSize: null,
  activeFileOversized: false,
  activeAnnotationCount: 0,
  isDirty: false,
  saveStatus: 'saved',
  lastSavedAt: null,
  conflictDiskContent: null,
  htmlEditFlusher: null,
  htmlEditLeaveGuard: null,
  htmlVisualEditing: false,

  searchQuery: '',
  isSearching: false,
  searchResults: [],
  workspaceTags: [],

  fileSort: { key: 'name', order: 'asc' },

  leftPaneWidth: 260,
  rightPaneWidth: 420,
  isLeftCollapsed: false,
  rightPane: 'ai',
  showMarginNotes: false,
  imageBackgroundTheme: 'checkerboard',
  pendingMindmapSelection: null,
  pendingConversationOpen: null,
  sidebarModelId: 'chatgpt',
  sidebar2ModelId: 'gemini',
  isAiSidebar2Open: false,
  editorMode: 'wysiwyg',
  contentWidth: 'medium',
  documentAnnotationFlusher: null,

  error: null,
  notice: null,
  pendingMindmapDeletions: null,
  draggingNodes: null,
  gitStatus: null,
  isGitLoading: false,
  isGitBusy: false,
  gitNotice: null,

  initWorkbench: async () => {
    if (get().isInitialized) return
    try {
      // 绑定一次外部文件系统监听：主进程 watcher 去抖广播后静默重扫文件树
      if (!fsWatcherBound) {
        fsWatcherBound = true
        window.api.workbench.onFsChanged((payload) => {
          void get().handleExternalFsChanged(payload.workspaceRoot)
        })
        // 用户可能在终端或其他编辑器里改动过仓库：回到窗口时同步一次版本状态
        window.addEventListener('focus', () => {
          if (get().workspacePath) void get().refreshGitStatus()
        })
      }
      const [
        savedPath,
        savedActiveFile,
        savedLeftWidth,
        savedRightWidth,
        savedLeftCollapsed,
        savedRightPane,
        savedRightCollapsed,
        savedSidebarModel,
        savedSidebar2Model,
        savedAiSidebar2Open,
        savedEditorMode,
        savedRecentWorkspaces,
        savedFileSort,
        savedImageBackgroundTheme,
        savedContentWidth
      ] = await Promise.all([
        window.api.storeGet('workbench_lastWorkspacePath') as Promise<string | null>,
        window.api.storeGet('workbench_lastActiveFilePath') as Promise<string | null>,
        window.api.storeGet('workbench_leftPaneWidth') as Promise<number | null>,
        window.api.storeGet('workbench_rightPaneWidth') as Promise<number | null>,
        window.api.storeGet('workbench_isLeftCollapsed') as Promise<boolean | null>,
        window.api.storeGet('workbench_rightPane') as Promise<WorkbenchRightPane | null>,
        window.api.storeGet('workbench_isRightCollapsed') as Promise<boolean | null>,
        window.api.storeGet('workbench_sidebarModelId') as Promise<string | null>,
        window.api.storeGet('workbench_sidebar2ModelId') as Promise<string | null>,
        window.api.storeGet('workbench_isAiSidebar2Open') as Promise<boolean | null>,
        window.api.storeGet('workbench_editorMode') as Promise<EditorMode | null>,
        window.api.storeGet('workbench_recentWorkspaces') as Promise<string[] | null>,
        window.api.storeGet('workbench_fileSort') as Promise<WorkbenchSortPreference | null>,
        window.api.storeGet('workbench_imageBackgroundTheme') as Promise<ImageBackgroundTheme | null>,
        window.api.storeGet('workbench_contentWidth') as Promise<WorkbenchContentWidth | null>
      ])

      const updates: Partial<WorkbenchStoreState> = { isInitialized: true }
      const winW = typeof window !== 'undefined' ? window.innerWidth : 1400
      if (typeof savedLeftWidth === 'number' && savedLeftWidth >= 260 && savedLeftWidth <= 480) {
        updates.leftPaneWidth = savedLeftWidth
      }
      if (typeof savedLeftCollapsed === 'boolean') {
        updates.isLeftCollapsed = savedLeftCollapsed
      }
      const resolvedDualAi = typeof savedAiSidebar2Open === 'boolean' ? savedAiSidebar2Open : false
      const resolvedLeftCollapsed = updates.isLeftCollapsed ?? false
      if (resolvedDualAi && !resolvedLeftCollapsed && winW >= 260 + WORKBENCH_MIN_EDITOR_WIDTH + RIGHT_PANE_DUAL_MIN + 10) {
        const maxLeft = Math.max(260, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
        if ((updates.leftPaneWidth ?? 260) > maxLeft) {
          updates.leftPaneWidth = maxLeft
        }
      }
      // 新键优先；老版本只有布尔折叠状态，迁移成「AI 展开 / 全部收起」。
      // 注释已从右侧独立抽屉迁移为文档原位边距流，历史保存的 annotations 回退为 null。
      if (
        savedRightPane === 'ai' ||
        savedRightPane === 'mindmap' ||
        savedRightPane === null
      ) {
        updates.rightPane = savedRightPane
      } else if (savedRightPane === 'annotations') {
        updates.rightPane = null
      } else if (typeof savedRightCollapsed === 'boolean') {
        updates.rightPane = savedRightCollapsed ? null : 'ai'
      }
      if (typeof savedSidebarModel === 'string' && savedSidebarModel) {
        updates.sidebarModelId = savedSidebarModel
      }
      if (typeof savedSidebar2Model === 'string' && savedSidebar2Model) {
        updates.sidebar2ModelId = savedSidebar2Model
      }
      if (typeof savedRightWidth === 'number' && savedRightWidth >= RIGHT_PANE_MIN) {
        updates.rightPaneWidth = clampRightPaneWidth(
          savedRightWidth,
          winW,
          updates.leftPaneWidth ?? 260,
          resolvedLeftCollapsed,
          resolvedDualAi
        )
      }
      if (typeof savedAiSidebar2Open === 'boolean') {
        updates.isAiSidebar2Open = savedAiSidebar2Open
        // 恢复的持久化状态不会经过 store-set，主动同步一次主窗口最小宽度
        void window.api.setWindowDualAiMinWidth(savedAiSidebar2Open)
        // 恢复为双栏时，右栏容器持久化宽度可能仍是单栏值（如 300），抬到双栏下限保证两栏可读。
        if (savedAiSidebar2Open && (updates.rightPaneWidth ?? 0) < RIGHT_PANE_DUAL_MIN) {
          updates.rightPaneWidth = RIGHT_PANE_DUAL_MIN
        }
      }
      if (savedEditorMode === 'wysiwyg' || savedEditorMode === 'source') {
        updates.editorMode = savedEditorMode
      }
      if (
        savedContentWidth === 'narrow' ||
        savedContentWidth === 'medium' ||
        savedContentWidth === 'wide'
      ) {
        updates.contentWidth = savedContentWidth
      }
      if (Array.isArray(savedRecentWorkspaces)) {
        updates.recentWorkspaces = savedRecentWorkspaces.filter(
          (p): p is string => typeof p === 'string' && p.length > 0
        )
      }
      if (
        savedFileSort &&
        (savedFileSort.key === 'name' || savedFileSort.key === 'mtime' || savedFileSort.key === 'size') &&
        (savedFileSort.order === 'asc' || savedFileSort.order === 'desc')
      ) {
        updates.fileSort = savedFileSort
      }
      if (
        savedImageBackgroundTheme === 'checkerboard' ||
        savedImageBackgroundTheme === 'light' ||
        savedImageBackgroundTheme === 'dark'
      ) {
        updates.imageBackgroundTheme = savedImageBackgroundTheme
      }

      // 确保默认工作区存在（首次启动会创建），随后无论上次是否有保存的工作区，都先把默认路径放到 store
      let defaultWorkspacePath: string | null = null
      try {
        const defaultRes = await window.api.workbench.getDefaultWorkspace()
        if (defaultRes.success && defaultRes.data?.path) {
          defaultWorkspacePath = defaultRes.data.path
        }
      } catch (err) {
        console.error('[workbenchStore] 默认工作区初始化失败:', err)
      }
      updates.defaultWorkspacePath = defaultWorkspacePath
      if (defaultWorkspacePath) {
        const recents = (updates.recentWorkspaces ?? []).filter((p) => p !== defaultWorkspacePath)
        updates.recentWorkspaces = [defaultWorkspacePath, ...recents].slice(0, 10)
        void window.api.storeSet('workbench_recentWorkspaces', updates.recentWorkspaces)
      }

      set(updates)

      let activated = false
      if (savedPath && typeof savedPath === 'string') {
        await get().setWorkspaceFolder(savedPath)
        activated = Boolean(get().workspacePath)
        if (activated) {
          if (savedActiveFile && typeof savedActiveFile === 'string') {
            // 应用关闭期间文件可能被改名，对账刚记下新路径，恢复时跟着走。
            const restorePath = recentRelinks.get(relinkKey(savedPath, savedActiveFile)) ?? savedActiveFile
            // 先看文件树：应用关闭期间被删掉的文件不该再触发一次 readFile。
            // 文件树节点可能处于折叠状态，这里用“路径集合”而不是 findNode。
            const tree = get().fileTree
            // 读取失败时保留恢复点等下次启动；读取成功但为空说明工作区确实没有这个文件。
            if (tree.length === 0 && get().error) return
            if (collectTreePaths(tree, new Set<string>()).has(restorePath)) await get().openFile(restorePath)
            else void window.api.storeDelete('workbench_lastActiveFilePath')
          }
        }
      }
      if (!activated && defaultWorkspacePath) {
        await get().setWorkspaceFolder(defaultWorkspacePath)
      }
    } catch (err) {
      console.error('[workbenchStore] 初始化偏好配置失败:', err)
      set({ isInitialized: true })
    }
  },

  selectWorkspaceFolder: async () => {
    try {
      const res = await window.api.workbench.selectFolder()
      if (res.success && res.data) {
        await get().setWorkspaceFolder(res.data.path, res.data.name)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `选择工作区文件夹失败: ${msg}` })
    }
  },

  setWorkspaceFolder: async (dirPath: string, dirName?: string) => {
    if (get().htmlVisualEditing) {
      const leaveGuard = get().htmlEditLeaveGuard
      if (!leaveGuard) {
        set({ error: '可视化编辑尚未就绪，无法切换工作区' })
        return 'failed'
      }
      const decision = await leaveGuard()
      if (decision === 'cancelled') return 'cancelled'
    }

    let activePath = dirPath
    let generation = get().workspaceGeneration
    try {
      const res = await window.api.workbench.activateWorkspace(dirPath)
      if (!res.success || !res.data) {
        set({ error: res.error || '打开工作区失败' })
        return 'failed'
      }
      activePath = res.data.activeWorkspaceRoot
      generation = res.data.generation
    } catch (err) {
      set({ error: `打开工作区失败: ${err instanceof Error ? err.message : String(err)}` })
      return 'failed'
    }
    const name = dirName || activePath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace'
    const defaultPath = get().defaultWorkspacePath
    const recents = [activePath, ...get().recentWorkspaces.filter((p) => p !== activePath)]
    // 默认工作区必须始终保留在最近列表中（若已初始化），用于「管理仓库」展示与回落
    const nextRecent = (defaultPath && !recents.includes(defaultPath)
      ? [...recents, defaultPath]
      : recents
    ).slice(0, 10)
    set({
      workspacePath: activePath,
      workspaceGeneration: generation,
      workspaceName: name,
      recentWorkspaces: nextRecent,
      activeFilePath: null,
      activeFileContent: '',
      activeFileCategory: null,
      activeFileDataUrl: null,
      activeFileUrl: null,
      activeFileMime: null,
      activeFileSize: null,
      activeFileOversized: false,
      isDirty: false,
      saveStatus: 'saved',
        conflictDiskContent: null,
      searchQuery: '',
      searchResults: []
    })
    void window.api.storeSet('workbench_recentWorkspaces', nextRecent)
    set({ gitStatus: null, gitNotice: null })
    // 旧版本导图记录在全局笔记目录，先迁到 .multichat/mindmaps 文件。
    void window.api.workbench.mindmapMigrate(activePath).catch(() => undefined)
    await get().loadFileTree()
    void get().refreshGitStatus()
    return 'switched'
  },

  closeWorkspace: async () => {
    if (get().htmlVisualEditing) {
      const leaveGuard = get().htmlEditLeaveGuard
      if (!leaveGuard) {
        set({ error: '可视化编辑尚未就绪，无法关闭工作区' })
        return
      }
      const decision = await leaveGuard()
      if (decision === 'cancelled') return
    }
    const annotationFlush = await get().flushDocumentAnnotations()
    if (!annotationFlush.saved) {
      set({ error: annotationFlush.error || '标注同步未完成，无法关闭工作区' })
      return
    }
    if (get().isDirty) {
      const saved = await get().saveActiveFile()
      if (!saved.saved) return
    }
    const closingPath = get().workspacePath
    const defaultPath = get().defaultWorkspacePath
    // 默认工作区不可关闭：若当前就在默认工作区，直接返回
    if (closingPath && defaultPath && closingPath === defaultPath) {
      return
    }
    if (!closingPath) return
    let session: Awaited<ReturnType<typeof window.api.workbench.closeWorkspace>>
    try {
      session = await window.api.workbench.closeWorkspace(closingPath, get().workspaceGeneration)
    } catch (err) {
      set({ error: `关闭工作区失败: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    if (!session.success || !session.data) {
      set({ error: session.error || '关闭工作区失败' })
      return
    }
    const activePath = session.data.activeWorkspaceRoot
    const activeName = activePath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace'
    set({
      workspacePath: activePath,
      workspaceGeneration: session.data.generation,
      workspaceName: activeName,
      fileTree: [],
      expandedFolderIds: new Set<string>(),
      activeFilePath: null,
      activeFileContent: '',
      activeFileCategory: null,
      activeFileDataUrl: null,
      activeFileUrl: null,
      activeFileMime: null,
      activeFileSize: null,
      activeFileOversized: false,
      isDirty: false,
      saveStatus: 'saved',
      searchQuery: '',
      searchResults: [],
      gitStatus: null,
      gitNotice: null
    })
    void window.api.storeDelete('workbench_lastActiveFilePath')
    await get().loadFileTree()
    void get().refreshGitStatus()
  },

  removeRecentWorkspace: (dirPath: string) => {
    // 默认工作区始终保留在最近列表中，不可移除
    if (dirPath === get().defaultWorkspacePath) return
    const nextRecent = get().recentWorkspaces.filter((p) => p !== dirPath)
    set({ recentWorkspaces: nextRecent })
    void window.api.storeSet('workbench_recentWorkspaces', nextRecent)
  },

  loadFileTree: async () => {
    const { workspacePath } = get()
    if (!workspacePath) return
    set({ isLoadingTree: true, error: null })
    try {
      const res = await window.api.workbench.readTree(workspacePath)
      if (res.success && res.data) {
        set({ fileTree: res.data, isLoadingTree: false })
        void get().loadWorkspaceTags()
        // 应用关闭期间的外部删除/改名，在重新载入工作区时补齐。
        // 等对账返回再结束载入，恢复上次打开的文档才能拿到改名映射。
        await reconcileMindmaps(workspacePath, res.data)
        // 文件树变化后同步版本管理状态：外部改动、拉取、移动都会反映到这里
        void get().refreshGitStatus()
      } else {
        set({
          isLoadingTree: false,
          error: res.error || '读取文件目录失败'
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ isLoadingTree: false, error: msg })
    }
  },

  toggleFolder: (folderId: string) => {
    const next = new Set(get().expandedFolderIds)
    if (next.has(folderId)) {
      next.delete(folderId)
    } else {
      next.add(folderId)
    }
    set({ expandedFolderIds: next })
  },

  expandAllFolders: () => {
    const all = new Set<string>()
    const collect = (nodes: WorkbenchFileNode[]) => {
      for (const node of nodes) {
        if (node.isDirectory) {
          all.add(node.id)
          if (node.children) collect(node.children)
        }
      }
    }
    collect(get().fileTree)
    set({ expandedFolderIds: all })
  },

  collapseAllFolders: () => {
    set({ expandedFolderIds: new Set<string>() })
  },

  expandAncestorsOf: (relativePath: string) => {
    const next = new Set(get().expandedFolderIds)
    let p: string | null = relativePath
    while (p) {
      const idx = p.lastIndexOf('/')
      p = idx === -1 ? null : p.slice(0, idx)
      if (p) next.add(p)
    }
    set({ expandedFolderIds: next })
  },

  openFile: async (relativePath: string, options?: { keepActiveOnMissing?: boolean }) => {
    const { workspacePath, activeFilePath } = get()
    if (!workspacePath) return false
    if (activeFilePath === relativePath) {
      // 已是激活文件时也保证祖先目录展开（外部定位入口点击同一文件仍可见）。
      get().expandAncestorsOf(relativePath)
      return true
    }

    // 可视化编辑的未保存内容必须先由用户决定保存或放弃，不能静默刷盘。
    if (get().htmlVisualEditing) {
      const leaveGuard = get().htmlEditLeaveGuard
      if (!leaveGuard) {
        set({ error: '可视化编辑尚未就绪，无法切换文件' })
        return false
      }
      const decision = await leaveGuard()
      if (decision === 'cancelled') return false
    }

    const annotationFlush = await get().flushDocumentAnnotations()
    if (!annotationFlush.saved) {
      set({ error: annotationFlush.error || '标注同步未完成，无法安全切换文件' })
      return false
    }

    // 源码模式的既有行为：前一个文件有未保存改动时先落盘，再切换。
    if (get().isDirty && activeFilePath) {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer)
        autoSaveTimer = null
      }
      const saved = await get().saveActiveFile()
      if (!saved.saved) {
        set({ error: '当前文件保存未完成，无法安全切换文件' })
        return false
      }
    }

    try {
      const res = await window.api.workbench.readFile(workspacePath, relativePath)
      if (res.success && res.data) {
        const oversizedForWysiwyg = res.data.size > 2 * 1024 * 1024
        set({
          activeFilePath: relativePath,
          activeFileContent: res.data.content,
          activeFileCategory: res.data.category || getFileCategory(relativePath),
          activeFileDataUrl: res.data.dataUrl || null,
          activeFileUrl: res.data.fileUrl || null,
          activeFileMime: res.data.mimeType || null,
          activeFileSize: res.data.size,
          activeFileOversized: !!res.data.isOversized,
          isDirty: false,
          saveStatus: 'saved',
          lastSavedAt: res.data.mtime,
          conflictDiskContent: null,
          error: null,
          // 2MB 以上固定源码模式；切回小文件时沿用用户上次的偏好。
          editorMode: oversizedForWysiwyg ? 'source' : get().editorMode
        })
        void window.api.storeSet('workbench_lastActiveFilePath', relativePath)
        // 让侧边栏文件树能定位到该文件：展开所有祖先目录（id===path）。
        get().expandAncestorsOf(relativePath)
        return true
      } else {
        // 恢复上次打开的文件时，文件可能已在应用外被删除：清掉失效的恢复点，
        // 回到“未打开文档”即可，不把 ENOENT 当成需要用户处理的错误弹出来。
        if (/\bENOENT\b/.test(res.error || '')) {
          if (options?.keepActiveOnMissing) {
            set({ error: `文件不存在: ${relativePath}` })
            return false
          }
          set({
            activeFilePath: null,
            activeFileContent: '',
            activeFileCategory: null,
            activeFileDataUrl: null,
            activeFileUrl: null,
            activeFileMime: null,
            activeFileSize: null,
            activeFileOversized: false,
            isDirty: false,
            saveStatus: 'saved',
            lastSavedAt: null,
            conflictDiskContent: null,
            error: null
          })
          void window.api.storeDelete('workbench_lastActiveFilePath')
          return false
        }
        set({ error: res.error || '无法读取文件内容' })
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/\bENOENT\b/.test(msg)) {
        if (options?.keepActiveOnMissing) {
          set({ error: `文件不存在: ${relativePath}` })
          return false
        }
        set({
          activeFilePath: null,
          activeFileContent: '',
          activeFileCategory: null,
          activeFileDataUrl: null,
          activeFileUrl: null,
          activeFileMime: null,
          activeFileSize: null,
          activeFileOversized: false,
          isDirty: false,
          saveStatus: 'saved',
          lastSavedAt: null,
          conflictDiskContent: null,
          error: null
        })
        void window.api.storeDelete('workbench_lastActiveFilePath')
        return false
      }
      set({ error: `打开文件失败: ${msg}` })
      return false
    }
  },

  saveActiveFile: async () => {
    // 可视化编辑只在保存时序列化 iframe DOM：平时不写盘，也不与源码自动保存抢状态。
    const flushHtmlEdit = get().htmlEditFlusher
    const pathBeforeFlush = get().activeFilePath
    if (flushHtmlEdit) {
      try {
        const html = await flushHtmlEdit()
        if (get().activeFilePath !== pathBeforeFlush) {
          return { saved: false, reason: 'no-active' }
        }
        if (typeof html === 'string' && html !== get().activeFileContent) {
          set({ activeFileContent: html })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        set({ saveStatus: 'error', error: `无法读取可视化编辑内容: ${message}` })
        return { saved: false, reason: 'error' }
      }
    }

    const {
      workspacePath,
      activeFilePath,
      activeFileContent,
      activeFileCategory,
      activeFileOversized
    } = get()
    if (!workspacePath || !activeFilePath) return { saved: false, reason: 'no-active' }

    // 严禁将只读二进制文件或非文本格式（图片、PDF、DOCX 等）作为空文本写盘覆盖，防止数据损坏
    if (
      activeFileOversized ||
      activeFileCategory === 'image' ||
      activeFileCategory === 'pdf' ||
      activeFileCategory === 'document' ||
      activeFileCategory === 'other'
    ) {
      return { saved: false, reason: activeFileOversized ? 'oversized' : 'binary' }
    }

    // 已处于冲突态：等用户裁决，不再自动写盘/反复拉磁盘版本
    if (get().saveStatus === 'conflict') {
      return { saved: false, reason: 'conflict' }
    }

    // 乐观并发校验：磁盘 mtime 领先 lastSavedAt 且内存有未落盘改动 → 真冲突，
    // 拒绝静默覆盖（用户在外面刚写的会被吃掉）；内存干净则放行重写
    const { isDirty: dirtyBeforeSave, lastSavedAt: savedAtBefore } = get()
    const statRes = await window.api.workbench.statFile(workspacePath, activeFilePath)
    if (statRes.success && statRes.data && savedAtBefore !== null) {
      const diskNewer = statRes.data.mtime - savedAtBefore > 2
      if (diskNewer && dirtyBeforeSave) {
        // 拉磁盘版本供用户选择；读失败也标冲突，不继续写
        let diskContent = ''
        try {
          const fileRes = await window.api.workbench.readFile(workspacePath, activeFilePath)
          if (fileRes.success && fileRes.data) diskContent = fileRes.data.content
        } catch { /* noop */ }
        set({ saveStatus: 'conflict', conflictDiskContent: diskContent })
        return { saved: false, reason: 'conflict' }
      }
    }

    set({ saveStatus: 'saving' })
    try {
      const content =
        activeFileCategory === 'markdown'
          ? normalizeMarkdownFrontmatter(activeFileContent)
          : activeFileContent
      const res = await window.api.workbench.writeFile(workspacePath, activeFilePath, content)
      if (res.success && res.data) {
        set({
          activeFileContent: content,
          isDirty: false,
          saveStatus: 'saved',
          lastSavedAt: res.data.mtime,
          conflictDiskContent: null,
          activeFileSize: res.data.size
        })
        if (activeFileCategory === 'markdown') {
          void get().loadWorkspaceTags()
        }
        return { saved: true }
      } else {
        set({
          saveStatus: 'error',
          error: res.error || '保存文件失败'
        })
        return { saved: false, reason: 'error' }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({
        saveStatus: 'error',
        error: `保存文件异常: ${msg}`
      })
      return { saved: false, reason: 'error' }
    }
  },

  setDocumentAnnotationFlusher: (flusher) => set({ documentAnnotationFlusher: flusher }),

  flushDocumentAnnotations: async () => {
    const flusher = get().documentAnnotationFlusher
    if (!flusher) return { saved: true }
    try {
      return await flusher()
    } catch (error) {
      return {
        saved: false,
        error: error instanceof Error ? error.message : '标注同步失败'
      }
    }
  },

  updateActiveContent: (content: string) => {
    set({
      activeFileContent: content,
      isDirty: true
    })

    // 防抖 1200ms 自动落盘
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
    }
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null
      void get().saveActiveFile()
    }, 1200)
  },

  setHtmlEditFlusher: (flusher) => {
    // 进入可视化编辑后，源码模式的防抖自动保存必须失效；保存动作统一走显式按钮/Ctrl+S。
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    set({ htmlEditFlusher: flusher })
  },

  setHtmlEditLeaveGuard: (guard) => set({ htmlEditLeaveGuard: guard }),

  setHtmlVisualEditing: (editing) => set({ htmlVisualEditing: editing }),

  markActiveFileDirty: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    if (!get().isDirty) set({ isDirty: true })
  },

  discardActiveFileChanges: (content) => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    set({
      ...(typeof content === 'string' ? { activeFileContent: content } : {}),
      isDirty: false,
      saveStatus: 'saved',
      conflictDiskContent: null
    })
  },

  /**
   * 外部冲突处理：
   * - keep-mine：放弃磁盘版本，把内存内容强写回去（用户确认覆盖外部改动）
   * - take-disk：放弃内存改动，采纳磁盘版本（等价"从磁盘重载"）
   */
  resolveExternalConflict: async (choice) => {
    const { workspacePath, activeFilePath } = get()
    if (!workspacePath || !activeFilePath) return false
    set({ saveStatus: 'saved', conflictDiskContent: null })
    if (choice === 'take-disk') {
      const fileRes = await window.api.workbench.readFile(workspacePath, activeFilePath)
      if (fileRes.success && fileRes.data) {
        set({
          activeFileContent: fileRes.data.content,
          isDirty: false,
          lastSavedAt: fileRes.data.mtime
        })
        return true
      }
      return false
    }
    // keep-mine：lastSavedAt 置 null 绕过并发校验，直接落盘
    set({ lastSavedAt: null })
    return (await get().saveActiveFile()).saved
  },

  createFile: async (parentRelativeDir: string, fileName: string) => {
    const { workspacePath } = get()
    if (!workspacePath) return null

    let trimmed = fileName.trim()
    if (!trimmed) return null
    if (!/\.[a-zA-Z0-9]+$/.test(trimmed)) {
      trimmed += '.md'
    }

    const relPath = parentRelativeDir ? `${parentRelativeDir}/${trimmed}` : trimmed
    try {
      const res = await window.api.workbench.createNode(workspacePath, relPath, 'file')
      if (res.success) {
        await get().loadFileTree()
        void get().refreshGitStatus()
        await get().openFile(relPath)
        return relPath
      } else {
        set({ error: res.error || '创建文件失败' })
        return null
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `创建文件异常: ${msg}` })
      return null
    }
  },

  createFolder: async (parentRelativeDir: string, folderName: string) => {
    const { workspacePath } = get()
    if (!workspacePath) return false

    const trimmed = folderName.trim()
    if (!trimmed) return false

    const relPath = parentRelativeDir ? `${parentRelativeDir}/${trimmed}` : trimmed
    try {
      const res = await window.api.workbench.createNode(workspacePath, relPath, 'folder')
      if (res.success) {
        // 自动展开新建的目录及其父目录
        const next = new Set(get().expandedFolderIds)
        if (parentRelativeDir) next.add(parentRelativeDir)
        next.add(relPath)
        set({ expandedFolderIds: next })
        await get().loadFileTree()
        void get().refreshGitStatus()
        return true
      } else {
        set({ error: res.error || '创建文件夹失败' })
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `创建文件夹异常: ${msg}` })
      return false
    }
  },

  renameNode: async (oldRelativePath: string, newRelativePath: string) => {
    const { workspacePath, activeFilePath } = get()
    if (!workspacePath) return false

    try {
      const res = await window.api.workbench.renameNode(workspacePath, oldRelativePath, newRelativePath)
      if (res.success) {
        // 若当前打开的文件恰好是被重命名的节点或在其子目录中，同步更新路径
        if (activeFilePath === oldRelativePath) {
          set({ activeFilePath: newRelativePath })
          void window.api.storeSet('workbench_lastActiveFilePath', newRelativePath)

          // 主进程可能已重写 .md 内容（assets 路径替换），重新读盘同步渲染层状态
          // 否则 isDirty + 旧内容会在下一次 autoSave 覆盖掉主进程的修改
          const extension = `.${newRelativePath.split('.').pop()?.toLowerCase() ?? ''}`
          if (MARKDOWN_EXTENSIONS.has(extension)) {
            try {
              const fileRes = await window.api.workbench.readFile(workspacePath, newRelativePath)
              if (fileRes.success && fileRes.data) {
                set({
                  activeFileContent: fileRes.data.content,
                  isDirty: false,
                  lastSavedAt: fileRes.data.mtime
                })
              }
            } catch { /* noop：读失败不阻断，保持原状态 */ }
          }
        } else if (activeFilePath && activeFilePath.startsWith(`${oldRelativePath}/`)) {
          const updatedActive = newRelativePath + activeFilePath.slice(oldRelativePath.length)
          set({ activeFilePath: updatedActive })
          void window.api.storeSet('workbench_lastActiveFilePath', updatedActive)
        }
        await get().loadFileTree()
        // 移动/重命名已在主进程写入暂存区，这里刷新以显示新的重命名条目
        void get().refreshGitStatus()
        return true
      } else {
        set({ error: res.error || '重命名失败' })
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `重命名异常: ${msg}` })
      return false
    }
  },

  /**
   * 拖拽移动：将节点移入目标目录
   * - 目标目录已含同名节点 / 移入自身或后代目录 / 原地拖放 → 返回 false 或报错
   */
  moveNode: async (sourceRelativePath: string, targetDirRelative: string) => {
    const { workspacePath } = get()
    if (!workspacePath) return false

    const normalized = targetDirRelative.replace(/\/+$/, '')
    const sourceName = sourceRelativePath.split('/').pop()
    if (!sourceName) return false

    // 已位于目标目录（原地拖放）
    const sourceParent = sourceRelativePath.includes('/')
      ? sourceRelativePath.slice(0, sourceRelativePath.lastIndexOf('/'))
      : ''
    if (sourceParent === normalized) return false
    // 禁止移入自身或其后代目录
    if (normalized === sourceRelativePath || normalized.startsWith(`${sourceRelativePath}/`)) {
      set({ error: '不能将文件夹移动到其自身内部' })
      return false
    }

    const newPath = normalized ? `${normalized}/${sourceName}` : sourceName
    return get().renameNode(sourceRelativePath, newPath)
  },

  /**
   * 多选拖拽：按顺序逐个移动，父目录先移则子项跳过。
   * 任一失败会保留已成功的部分并提示，避免整组操作静默丢失。
   */
  moveNodes: async (sourceRelativePaths: string[], targetDirRelative: string) => {
    const { workspacePath } = get()
    if (!workspacePath || !sourceRelativePaths.length) return false
    const ordered = [...sourceRelativePaths].sort((a, b) => a.length - b.length)
    const moved: string[] = []
    for (const source of ordered) {
      // 父目录已移动时，其子项路径已失效，跳过避免误报
      if (moved.some(parent => source.startsWith(`${parent}/`))) continue
      const ok = await get().moveNode(source, targetDirRelative)
      if (!ok) {
        if (moved.length) set({ error: `${moved.length} 项已移动，其余移动失败` })
        return false
      }
      moved.push(source)
    }
    return true
  },

  deleteNode: async (relativePath: string) => {
    const {
      workspacePath,
      activeFilePath,
      activeFileContent,
      activeFileCategory,
      activeFileDataUrl,
      activeFileUrl,
      activeFileMime,
      activeFileSize,
      activeFileOversized,
      isDirty,
      saveStatus,
      conflictDiskContent,
      fileTree,
      fileSort
    } = get()
    if (!workspacePath) return false

    // 删除前按当前排序拍平文件列表，预取被删文件的后继者，删除后自动打开。
    // 覆盖两种情形：被删项即当前文件；被删目录包含当前文件。
    const deletedPaths = [relativePath]
    const hitsActive = !!activeFilePath && isDeletedPath(activeFilePath, deletedPaths)
    const nextFilePath = hitsActive && activeFilePath
      ? pickNextActiveFile(flattenSortedFiles(fileTree, fileSort), activeFilePath, deletedPaths)
      : null
    const previousTree = fileTree
    const activeSnapshot = {
      activeFilePath,
      activeFileContent,
      activeFileCategory,
      activeFileDataUrl,
      activeFileUrl,
      activeFileMime,
      activeFileSize,
      activeFileOversized,
      isDirty,
      saveStatus,
      conflictDiskContent
    }

    // 乐观移除：弹窗关闭后节点立即消失，磁盘删除在后台完成
    set({ fileTree: removeTreePaths(fileTree, deletedPaths) })
    if (hitsActive) {
      set({
        activeFilePath: null,
        activeFileContent: '',
        activeFileCategory: null,
        activeFileDataUrl: null,
        activeFileUrl: null,
        activeFileMime: null,
        activeFileSize: null,
        activeFileOversized: false,
        isDirty: false,
        saveStatus: 'saved',
        conflictDiskContent: null
      })
      void window.api.storeDelete('workbench_lastActiveFilePath')
    }

    try {
      const res = await window.api.workbench.deleteNode(workspacePath, relativePath)
      if (res.success) {
        await get().loadFileTree()
        void get().refreshGitStatus()
        // 当前文件被删时自动切换到排序上的相邻文件；无任何文件则停在空状态
        if (nextFilePath) {
          const opened = await get().openFile(nextFilePath)
          if (!opened) void window.api.storeDelete('workbench_lastActiveFilePath')
        }
        return true
      } else {
        set({ fileTree: previousTree })
        if (hitsActive) restoreActiveFileState(activeSnapshot)
        set({ error: res.error || '删除失败' })
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ fileTree: previousTree })
      if (hitsActive) restoreActiveFileState(activeSnapshot)
      set({ error: `删除操作异常: ${msg}` })
      return false
    }
  },

  /**
   * 把一条 AI 回复追加到当前打开的 Markdown 文件末尾并落盘。
   * 边界校验：仅接受 activeFileCategory === 'markdown'（.md/.markdown）。
   *
   * wysiwyg 模式：派发 workbench:insert-reply 事件，
   * 由 MarkdownSyncPlugin 在光标上次停留处以「待确认高亮」插入（✓采纳/✗撤回）。
   * source 模式：Lexical 未挂载，直接在末尾追加正文并落盘（无确认交互）。
   */
  insertReplyIntoActiveMarkdown: async (
    replyMd: string,
    meta?: { conversationUrl?: string; platformId?: string }
  ) => {
    const { activeFilePath, activeFileCategory, editorMode, isDirty } = get()
    const fail = (error: string): { success: boolean; error: string } => {
      set({ error })
      return { success: false, error }
    }
    if (!activeFilePath) return fail('请先在左侧打开一个 Markdown 文件')
    const ext = `.${(activeFilePath.split('.').pop() || '').toLowerCase()}`
    if (activeFileCategory !== 'markdown' || !MARKDOWN_EXTENSIONS.has(ext)) {
      return fail('当前文件不是 Markdown')
    }
    const md = (replyMd || '').trim()
    if (!md) return fail('回复内容为空')

    // 先落盘清 dirty，避免防抖回写覆盖本次插入
    if (isDirty) {
      const saved = await get().saveActiveFile()
      if (!saved.saved) return fail('当前文件保存未完成')
    }

    if (editorMode === 'wysiwyg') {
      // 交给 Lexical 在光标处待确认插入；正文由 Lexical 回写。
      // 同时带上会话元数据，插入回写时才能补 source_kind，避免变成普通 Markdown。
      const platform =
        useAppStore.getState().models.find(model => model.id === meta?.platformId)?.name ??
        meta?.platformId ??
        ''
      window.dispatchEvent(
        new CustomEvent('workbench:insert-reply', {
          detail: { replyMd: md, conversationUrl: meta?.conversationUrl, platform }
        })
      )
      return { success: true }
    }

    // source 模式：直接末尾追加并落盘
    const cur = get().activeFileContent
    const prefix = cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n` : ''
    const platform =
      useAppStore.getState().models.find(model => model.id === meta?.platformId)?.name ??
      meta?.platformId ??
      ''
    const upserted = upsertConversationFrontmatter(`${prefix}---\n\n${md}\n`, {
      url: meta?.conversationUrl,
      platform
    })
    if (upserted.conflict.length) {
      set({ error: '当前文档已有来源属性，已保留原值，未自动关联本次来源' })
    }
    const next = upserted.content
    set({ activeFileContent: next, isDirty: true })
    const saved = await get().saveActiveFile()
    return saved.saved ? { success: true } : fail('写入文件失败')
  },

  /**
   * 把一条 AI 回复另存为工作区里的新 Markdown 文件并打开。
   * 文件名 = 对话名（meta.title），重名自动加 -2/-3 序号；
   * 无标题时回退 <平台>-<时间戳>.md。落到当前文件同目录或根目录。
   */
  saveReplyAsNewMarkdown: async (
    replyMd: string,
    meta: { platformId: string; title?: string; conversationUrl?: string }
  ) => {
    const { workspacePath, activeFilePath, fileTree } = get()
    const fail = (error: string): { success: boolean; error: string } => {
      set({ error })
      return { success: false, error }
    }
    if (!workspacePath) return fail('请先打开一个工作区')
    const md = (replyMd || '').trim()
    if (!md) return fail('回复内容为空')

    // 单条回复只是会话中的一段摘录，不是整段会话快照：标成普通文档，
    // 保留来源便于回看，但不参与会话去重、原文标注和会话库统计。
    const content = `${buildReplyExcerptFrontmatter({
      url: meta.conversationUrl,
      platform:
        useAppStore.getState().models.find(model => model.id === meta.platformId)?.name ??
        meta.platformId
    })}${md}\n`

    const dir = activeFilePath && activeFilePath.includes('/')
      ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/'))
      : ''

    // 主名：对话名清洗；无标题回退 平台-时间戳
    const rawTitle = (meta.title || '').trim()
    let base = rawTitle.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
    if (!base) {
      const now = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      base = `${(meta.platformId || 'ai').replace(/[\\/:*?"<>|]/g, '')}-${stamp}`
    }
    if (base.length > 60) base = base.slice(0, 60)

    // 收集目标目录下已有文件名用于查重
    const siblings = new Set<string>()
    const collect = (nodes: WorkbenchFileNode[]): void => {
      for (const n of nodes) {
        if (n.isDirectory) {
          if (n.path === dir && n.children) collect(n.children)
          else if (n.children && dir.startsWith(n.path)) collect(n.children)
        } else if (n.path.split('/').slice(0, -1).join('/') === dir) {
          siblings.add(n.name)
        }
      }
    }
    collect(fileTree)

    let fileName = `${base}.md`
    let i = 2
    while (siblings.has(fileName)) {
      fileName = `${base}-${i}.md`
      i++
    }

    const relPath = await get().createFile(dir, fileName)
    if (!relPath) return fail(get().error || '创建文件失败')
    const res = await window.api.workbench.writeFile(workspacePath, relPath, content)
    if (!res.success) return fail(res.error || '写入文件失败')
    // createFile 已 openFile，同步最新内容与保存态
    set({ activeFileContent: content, isDirty: false, saveStatus: 'saved' })
    await get().loadFileTree()
    void get().refreshGitStatus()
    return { success: true }
  },

  revealFile: async (relativePath: string) => {
    const { workspacePath } = get()
    if (!workspacePath) return
    try {
      await window.api.workbench.revealFile(workspacePath, relativePath)
    } catch (err) {
      console.error('[workbenchStore] revealFile failed:', err)
    }
  },

  openInSystem: async (relativePath: string) => {
    const { workspacePath } = get()
    if (!workspacePath) return
    try {
      const res = await window.api.workbench.openInSystem(workspacePath, relativePath)
      if (!res.success && res.error) {
        set({ error: `使用系统默认程序打开失败: ${res.error}` })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `系统打开异常: ${msg}` })
    }
  },

  findUnreferencedImages: async (documentRelativePath: string) => {
    const { workspacePath } = get()
    if (!workspacePath) return null
    try {
      const res = await window.api.workbench.findUnreferencedImages(workspacePath, documentRelativePath)
      return res.success && res.data ? res.data : null
    } catch {
      return null
    }
  },

  /**
   * 批量删除（移至回收站）。
   * 交互对齐 VSCode：确认后节点立即从树里消失，编辑器马上切到相邻文件，
   * 真正的磁盘删除在后台进行，结束后用一次整树重扫收敛结果。
   * 失败项回滚到树里并提示，避免界面与磁盘长期不一致。
   */
  deleteNodes: async (relativePaths: string[]) => {
    const {
      workspacePath,
      activeFilePath,
      activeFileContent,
      activeFileCategory,
      activeFileDataUrl,
      activeFileUrl,
      activeFileMime,
      activeFileSize,
      activeFileOversized,
      isDirty,
      saveStatus,
      conflictDiskContent,
      fileTree,
      fileSort
    } = get()
    if (!workspacePath || !relativePaths.length) return false

    // 父目录已选中时其子项必然一并删除，去掉冗余目标减少一次 IPC 往返
    const targets = relativePaths.filter(
      p => !relativePaths.some(other => other !== p && p.startsWith(`${other}/`))
    )
    if (!targets.length) return false

    const hitsActive = !!activeFilePath && isDeletedPath(activeFilePath, targets)
    const nextFilePath = hitsActive && activeFilePath
      ? pickNextActiveFile(flattenSortedFiles(fileTree, fileSort), activeFilePath, targets)
      : null
    const previousTree = fileTree
    const activeSnapshot = {
      activeFilePath,
      activeFileContent,
      activeFileCategory,
      activeFileDataUrl,
      activeFileUrl,
      activeFileMime,
      activeFileSize,
      activeFileOversized,
      isDirty,
      saveStatus,
      conflictDiskContent
    }
    /** 整体失败时把编辑器连同树一起还原，避免内容消失但文件还在磁盘上 */
    const restoreOnFailure = (): void => {
      set({ fileTree: previousTree })
      if (!hitsActive) return
      restoreActiveFileState(activeSnapshot)
    }

    // 乐观移除：先让界面响应，再等磁盘结果
    set({ fileTree: removeTreePaths(fileTree, targets) })
    if (hitsActive) {
      set({
        activeFilePath: null,
        activeFileContent: '',
        activeFileCategory: null,
        activeFileDataUrl: null,
        activeFileUrl: null,
        activeFileMime: null,
        activeFileSize: null,
        activeFileOversized: false,
        isDirty: false,
        saveStatus: 'saved',
        conflictDiskContent: null
      })
      void window.api.storeDelete('workbench_lastActiveFilePath')
    }

    try {
      const res = await window.api.workbench.deleteNodes(workspacePath, targets)
      if (!res.success || !res.data) {
        restoreOnFailure()
        set({ error: res.error || '删除失败' })
        return false
      }

      const failedPaths = res.data.failed.map(item => item.path)
      if (failedPaths.length) {
        // 失败项还在磁盘上，先放回树里；随后重扫以磁盘为准收敛。
        // 当前文件只在删除失败时才恢复，否则它已进回收站，恢复会指向不存在的文件。
        set({ fileTree: previousTree })
        if (hitsActive && activeFilePath && isDeletedPath(activeFilePath, failedPaths)) {
          restoreOnFailure()
        }
        const first = res.data.failed[0]
        set({ error: `${failedPaths.length} 项删除失败（${first.path}: ${first.error}）` })
      }

      await get().loadFileTree()
      void get().refreshGitStatus()
      if (nextFilePath && !get().activeFilePath) {
        const opened = await get().openFile(nextFilePath)
        if (!opened) void window.api.storeDelete('workbench_lastActiveFilePath')
      }
      return failedPaths.length === 0
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      restoreOnFailure()
      set({ error: `删除操作异常: ${msg}` })
      return false
    }
  },

  /**
   * 外部文件/文件夹导入（拖入或粘贴）：复制进目标目录并重载文件树
   * 返回逐项结果；整体失败（IPC 异常等）返回 null
   */
  importExternalItems: async (targetDirRelative: string, sourceAbsolutePaths: string[]) => {
    const { workspacePath } = get()
    if (!workspacePath || !sourceAbsolutePaths.length) return null
    try {
      const res = await window.api.workbench.importExternalPaths(workspacePath, targetDirRelative, sourceAbsolutePaths)
      if (res.success && res.data) {
        await get().loadFileTree()
        void get().refreshGitStatus()
        if (res.data.failed.length > 0) {
          const first = res.data.failed[0]
          set({ error: `${res.data.failed.length} 项导入失败（${first.path}: ${first.error}）` })
        }
        return res.data
      }
      set({ error: res.error || '导入失败' })
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `导入异常: ${msg}` })
      return null
    }
  },

  /**
   * 跨工作区移动：把节点搬到另一个工作区根目录。
   * 当前文档在移动范围内时先落盘，移动成功后清理编辑状态，避免脏内容丢失。
   */
  moveToWorkspace: async (targetWorkspaceRoot: string, relativePaths: string[]) => {
    const { workspacePath, activeFilePath, isDirty } = get()
    if (!workspacePath || !targetWorkspaceRoot || !relativePaths.length) return null
    const hitsActive = !!activeFilePath && relativePaths.some(p =>
      activeFilePath === p || activeFilePath.startsWith(`${p}/`))
    if (hitsActive && isDirty) {
      const saved = await get().saveActiveFile()
      if (!saved.saved) {
        set({ error: '当前文件保存未完成，无法移动到其他工作区' })
        return null
      }
    }
    try {
      const res = await window.api.workbench.moveToWorkspace(workspacePath, targetWorkspaceRoot, relativePaths)
      if (!res.success || !res.data) {
        set({ error: res.error || '移动到其他工作区失败' })
        return null
      }
      if (hitsActive) {
        set({
          activeFilePath: null,
          activeFileContent: '',
          activeFileCategory: null,
          activeFileDataUrl: null,
          activeFileUrl: null,
          activeFileMime: null,
          activeFileSize: null,
          activeFileOversized: false,
          activeAnnotationCount: 0,
          isDirty: false,
          saveStatus: 'saved',
          conflictDiskContent: null
        })
        void window.api.storeDelete('workbench_lastActiveFilePath')
      }
      await get().loadFileTree()
      void get().refreshGitStatus()
      if (res.data.failed.length) {
        const first = res.data.failed[0]
        set({ error: `${res.data.failed.length} 项移动失败（${first.path}: ${first.error}）` })
      } else if (res.data.moved.length) {
        get().showNotice(res.data.moved.length > 1
          ? `已移动 ${res.data.moved.length} 项到其他工作区`
          : `已移动到其他工作区：${res.data.moved[0].target}`)
      }
      return res.data
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `移动异常: ${msg}` })
      return null
    }
  },

  /**
   * 外部文件系统变更回调（资源管理器/其他程序在工作区里增删移动文件）。
   * 1. 静默重扫文件树（不打 isLoadingTree 骨架，避免外部频繁变更时树闪烁）
   * 2. 当前激活文件若在磁盘上消失 → 清空编辑器（无脏写回风险）
   * 3. 文件仍存在且 mtime 变了 → 未编辑的干净文本自动重载；dirty 文档不动
   *    （用户编辑中不覆盖，等切换/手动刷新时读盘）
   */
  handleExternalFsChanged: async (workspaceRoot: string) => {
    const { workspacePath } = get()
    if (!workspacePath) return

    // 路径规范化对齐（Windows 大小写不敏感）：不一致说明是过期 watcher 的事件，忽略
    const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (normalize(workspaceRoot) !== normalize(workspacePath)) return

    const res = await window.api.workbench.readTree(workspacePath)
    if (!res.success || !res.data) return
    // 外部改动（终端、其他编辑器）同样会改变 Git 状态
    void get().refreshGitStatus()
    const nextTree = res.data
    const previousTree = get().fileTree
    set({ fileTree: nextTree })

    const { activeFilePath, isDirty, lastSavedAt } = get()
    // 对账复用刚扫出的文件树：正常路径下主进程不再遍历磁盘。
    // 外部改名要等对账结果，编辑器才能跟到新路径，而不是当作文件消失。
    const reconciled = await reconcileMindmaps(workspacePath, nextTree)
    const renamedTo = activeFilePath
      ? reconciled?.relinks.find(link => link.from === activeFilePath)?.to ??
        (findNode(nextTree, activeFilePath) ? null : findRenamedNode(previousTree, nextTree, activeFilePath))
      : null
    if (renamedTo) {
      set({ activeFilePath: renamedTo })
      void window.api.storeSet('workbench_lastActiveFilePath', renamedTo)
    }
    const currentPath = renamedTo ?? activeFilePath
    if (!currentPath) return

    const allPaths = collectTreePaths(nextTree, new Set<string>())

    // 文件被外部删除/移走（或被重命名成别的路径）：清空编辑器
    if (!allPaths.has(currentPath)) {
      set({
        activeFilePath: null,
        activeFileContent: '',
        activeFileCategory: null,
        activeFileDataUrl: null,
        activeFileUrl: null,
        activeFileMime: null,
        activeFileSize: null,
        activeFileOversized: false,
        isDirty: false,
        saveStatus: 'saved',
        lastSavedAt: null,
        conflictDiskContent: null
      })
      void window.api.storeDelete('workbench_lastActiveFilePath')
      return
    }

    // 文件还在：对比 mtime 决定是否重载内容；父目录 rename 会让 activeFilePath 失配
    // （其原路径消失走上面的清空分支），此处仅处理同路径内容变更
    const node = findNode(nextTree, currentPath)
    if (!node || node.isDirectory) return

    const mtimeChanged =
      typeof node.mtime === 'number' &&
      (lastSavedAt === null || Math.abs(node.mtime - lastSavedAt) > 1)
    if (!mtimeChanged) return

    // 磁盘版本领先内存 → dirty 时标冲突等用户裁决，干净时静默重载
    const diskNewer = lastSavedAt !== null && node.mtime! - lastSavedAt > 2
    const { activeFileCategory } = get()
    const reloadable =
      activeFileCategory === 'markdown' ||
      activeFileCategory === 'text' ||
      activeFileCategory === 'code'
    if (!reloadable) return

    if (diskNewer && isDirty) {
      let diskContent = ''
      try {
        const fileRes = await window.api.workbench.readFile(workspacePath, currentPath)
        if (fileRes.success && fileRes.data) diskContent = fileRes.data.content
      } catch { /* noop */ }
      set({ saveStatus: 'conflict', conflictDiskContent: diskContent })
      return
    }
    if (isDirty) return

    const fileRes = await window.api.workbench.readFile(workspacePath, currentPath)
    if (fileRes.success && fileRes.data) {
      set({
        activeFileContent: fileRes.data.content,
        activeFileCategory: fileRes.data.category || getFileCategory(currentPath),
        activeFileDataUrl: fileRes.data.dataUrl || null,
        activeFileUrl: fileRes.data.fileUrl || null,
        activeFileMime: fileRes.data.mimeType || null,
        activeFileSize: fileRes.data.size,
        activeFileOversized: !!fileRes.data.isOversized,
        isDirty: false,
        saveStatus: 'saved',
        lastSavedAt: fileRes.data.mtime,
        conflictDiskContent: null
      })
    }
  },

  searchFiles: (query: string) => {
    const { workspacePath } = get()
    set({ searchQuery: query })

    if (!workspacePath || !query.trim()) {
      if (searchTimer) clearTimeout(searchTimer)
      set({ isSearching: false, searchResults: [] })
      return
    }

    const seq = ++currentSearchSeq
    set({ isSearching: true })

    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(async () => {
      try {
        const res = await window.api.workbench.search(workspacePath, query.trim())
        if (seq !== currentSearchSeq) return // 已被后续请求替代
        if (res.success && res.data) {
          set({ searchResults: res.data, isSearching: false })
        } else {
          set({ searchResults: [], isSearching: false })
        }
      } catch (err) {
        if (seq !== currentSearchSeq) return
        console.error('[workbenchStore] searchFiles failed:', err)
        set({ searchResults: [], isSearching: false })
      }
    }, 300)
  },

  clearSearch: () => {
    if (searchTimer) clearTimeout(searchTimer)
    currentSearchSeq++
    set({ searchQuery: '', isSearching: false, searchResults: [] })
  },

  loadWorkspaceTags: async () => {
    const { workspacePath } = get()
    if (!workspacePath) {
      set({ workspaceTags: [] })
      return
    }
    try {
      const res = await window.api.workbench.getWorkspaceTags(workspacePath)
      if (res.success && res.data) {
        set({ workspaceTags: res.data })
      }
    } catch (err) {
      console.error('[workbenchStore] loadWorkspaceTags failed:', err)
    }
  },

  setFileSort: (pref: WorkbenchSortPreference) => {
    set({ fileSort: pref })
    void window.api.storeSet('workbench_fileSort', pref)
  },

  setLeftPaneWidth: (width: number, persist = true) => {
    const winW = typeof window === 'undefined' ? 1400 : window.innerWidth
    const state = get()
    const hasRight = !!state.rightPane || state.isAiSidebar2Open
    const rightReserve = hasRight
      ? (state.isAiSidebar2Open ? RIGHT_PANE_DUAL_MIN : RIGHT_PANE_MIN)
      : 0
    const maxLeftAllowed = Math.max(260, winW - WORKBENCH_MIN_EDITOR_WIDTH - rightReserve - 10)
    const clamped = Math.max(260, Math.min(480, Math.min(maxLeftAllowed, width)))
    const nextState: Partial<WorkbenchStoreState> = { leftPaneWidth: clamped }
    if (hasRight) {
      const clampedRight = clampRightPaneWidth(state.rightPaneWidth, winW, clamped, state.isLeftCollapsed, state.isAiSidebar2Open)
      if (clampedRight !== state.rightPaneWidth) {
        nextState.rightPaneWidth = clampedRight
        if (persist) {
          void window.api.storeSet('workbench_rightPaneWidth', clampedRight)
        }
      }
    }
    set(nextState)
    if (persist) {
      void window.api.storeSet('workbench_leftPaneWidth', clamped)
    }
    return clamped
  },

  setRightPaneWidth: (width: number, persist = true) => {
    const clamped = clampRightPaneWidth(width)
    set({ rightPaneWidth: clamped })
    if (persist) {
      void window.api.storeSet('workbench_rightPaneWidth', clamped)
    }
    return clamped
  },

  toggleLeftCollapse: () => {
    const state = get()
    const next = !state.isLeftCollapsed
    const nextState: Partial<WorkbenchStoreState> = { isLeftCollapsed: next }
    if (!next) {
      const winW = typeof window === 'undefined' ? 1400 : window.innerWidth
      const hasRight = !!state.rightPane || state.isAiSidebar2Open
      const rightReserve = hasRight
        ? (state.isAiSidebar2Open ? RIGHT_PANE_DUAL_MIN : RIGHT_PANE_MIN)
        : 0
      const maxLeftAllowed = Math.max(260, winW - WORKBENCH_MIN_EDITOR_WIDTH - rightReserve - 10)
      const clampedLeft = Math.max(260, Math.min(480, Math.min(maxLeftAllowed, state.leftPaneWidth)))
      if (clampedLeft !== state.leftPaneWidth) {
        nextState.leftPaneWidth = clampedLeft
        void window.api.storeSet('workbench_leftPaneWidth', clampedLeft)
      }
      if (hasRight) {
        const clampedRight = clampRightPaneWidth(state.rightPaneWidth, winW, clampedLeft, false, state.isAiSidebar2Open)
        if (clampedRight !== state.rightPaneWidth) {
          nextState.rightPaneWidth = clampedRight
          void window.api.storeSet('workbench_rightPaneWidth', clampedRight)
        }
      }
    }
    set(nextState)
    void window.api.storeSet('workbench_isLeftCollapsed', next)
  },

  toggleMarginNotes: () => {
    set(state => ({ showMarginNotes: !state.showMarginNotes }))
  },

  openRightPane: (pane) => {
    set({ rightPane: pane })
    void window.api.storeSet('workbench_rightPane', pane)
  },

  closeRightPane: () => {
    set({ rightPane: null })
    void window.api.storeSet('workbench_rightPane', null)
  },

  setPendingMindmapSelection: (selection) => set({ pendingMindmapSelection: selection }),

  openConversationInAiSidebar: (platformId, url) => {
    get().openRightPane('ai')
    set({ pendingConversationOpen: { platformId, url, token: Date.now(), target: 'ai' } })
  },

  openConversationInAiSidebar2: (platformId, url) => {
    const state = get()
    const winW = typeof window === 'undefined' ? 1400 : window.innerWidth
    const width = Math.max(state.rightPaneWidth, RIGHT_PANE_DUAL_MIN)
    const nextState: Partial<WorkbenchStoreState> = { isAiSidebar2Open: true, rightPaneWidth: width }
    if (!state.isLeftCollapsed && winW >= 260 + WORKBENCH_MIN_EDITOR_WIDTH + RIGHT_PANE_DUAL_MIN + 10) {
      const maxLeft = Math.max(260, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
      if (state.leftPaneWidth > maxLeft) {
        nextState.leftPaneWidth = maxLeft
        void window.api.storeSet('workbench_leftPaneWidth', maxLeft)
      }
    }
    set(nextState)
    void window.api.storeSet('workbench_isAiSidebar2Open', true)
    void window.api.storeSet('workbench_rightPaneWidth', width)
    set({ pendingConversationOpen: { platformId, url, token: Date.now(), target: 'ai2' } })
  },

  openAiSidebar2: () => {
    // 开启第二侧栏时把整个右栏容器抬到双栏下限（不低于当前值），否则两栏挤在原单栏宽度里各 ~150px。
    const state = get()
    const winW = typeof window === 'undefined' ? 1400 : window.innerWidth
    const width = Math.max(state.rightPaneWidth, RIGHT_PANE_DUAL_MIN)
    const nextState: Partial<WorkbenchStoreState> = { isAiSidebar2Open: true, rightPaneWidth: width }
    if (!state.isLeftCollapsed && winW >= 260 + WORKBENCH_MIN_EDITOR_WIDTH + RIGHT_PANE_DUAL_MIN + 10) {
      const maxLeft = Math.max(260, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
      if (state.leftPaneWidth > maxLeft) {
        nextState.leftPaneWidth = maxLeft
        void window.api.storeSet('workbench_leftPaneWidth', maxLeft)
      }
    }
    set(nextState)
    void window.api.storeSet('workbench_isAiSidebar2Open', true)
    void window.api.storeSet('workbench_rightPaneWidth', width)
  },

  closeAiSidebar2: () => {
    // 关闭第二侧栏后，右栏回到单栏：宽度若超出单栏上限则收回，避免留下空荡的宽栏。
    // 必须先置 false 再算单栏上限——getRightPaneMaxWidth 内部读 isAiSidebar2Open 决定是否翻倍。
    set({ isAiSidebar2Open: false })
    const singleMax = getRightPaneMaxWidth()
    const width = Math.min(get().rightPaneWidth, singleMax)
    set({ rightPaneWidth: width })
    void window.api.storeSet('workbench_isAiSidebar2Open', false)
    void window.api.storeSet('workbench_rightPaneWidth', width)
  },

  consumeConversationOpen: (token) =>
    set((state) =>
      state.pendingConversationOpen?.token === token ? { pendingConversationOpen: null } : state
    ),

  setSidebarModelId: (modelId: string) => {
    set({ sidebarModelId: modelId })
    void window.api.storeSet('workbench_sidebarModelId', modelId)
  },

  setSidebar2ModelId: (modelId: string) => {
    set({ sidebar2ModelId: modelId })
    void window.api.storeSet('workbench_sidebar2ModelId', modelId)
  },

  setEditorMode: (mode: EditorMode) => {
    // 2MB 以上文档固定源码模式：Lexical 整篇导入会卡死，且标注也无法安全映射。
    const size = get().activeFileSize ?? 0
    if (mode === 'wysiwyg' && size > 2 * 1024 * 1024) {
      set({ editorMode: 'source' })
      void window.api.storeSet('workbench_editorMode', 'source')
      return
    }
    set({ editorMode: mode })
    void window.api.storeSet('workbench_editorMode', mode)
  },

  setContentWidth: (width: WorkbenchContentWidth) => {
    set({ contentWidth: width })
    void window.api.storeSet('workbench_contentWidth', width)
  },

  setImageBackgroundTheme: (theme: ImageBackgroundTheme) => {
    set({ imageBackgroundTheme: theme })
    void window.api.storeSet('workbench_imageBackgroundTheme', theme)
  },

  askAi: (text: string, actionType: WorkbenchAiAction, target: 'ai' | 'ai2' = 'ai') => {
    const trimmed = text.trim()
    if (!trimmed) return

    let formattedPrompt = trimmed
    switch (actionType) {
      case 'explain':
        formattedPrompt = `请详细解释一下内容：\n\n"""\n${trimmed}\n"""`
        break
      case 'polish':
        formattedPrompt = `请对以下文本进行润色，优化行文逻辑：\n\n"""\n${trimmed}\n"""`
        break
      case 'summarize':
        formattedPrompt = `请提取并总结以下内容的关键要点：\n\n"""\n${trimmed}\n"""`
        break
      case 'ask':
      default:
        formattedPrompt = trimmed
        break
    }

    // 若目标右侧栏处于折叠状态，先自动展开
    if (target === 'ai2') {
      if (!get().isAiSidebar2Open) {
        get().openAiSidebar2()
      }
    } else if (get().rightPane !== 'ai') {
      get().openRightPane('ai')
    }

    // 通过 CustomEvent 通知 WorkbenchAiSidebar 注入文本
    window.dispatchEvent(
      new CustomEvent('workbench:insert-prompt', {
        detail: { prompt: formattedPrompt, target }
      })
    )
  },

  clearError: () => set({ error: null }),

  showNotice: (message) => {
    set({ notice: { message } })
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => set({ notice: null }), 3000)
  },

  clearNotice: () => {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    set({ notice: null })
  },

  setDraggingNodes: (nodes) => set({ draggingNodes: nodes }),

  confirmMindmapDeletions: async (targets) => {
    const { workspacePath } = get()
    set({ pendingMindmapDeletions: null })
    if (!workspacePath || !targets.length) return
    try {
      const index: Array<{ path: string; size?: number; mtime?: number }> = []
      collectFileIndex(get().fileTree, index)
      await window.api.workbench.reconcileMindmaps(workspacePath, index, {
        force: true,
        targets: targets.map(t => ({ conversationId: t.conversationId }))
      })
    } catch {
      // 删除失败保留现状，等下次对账再判
    }
  },

  refreshGitStatus: async (options) => {
    const { workspacePath } = get()
    if (!workspacePath) {
      gitStatusPending = false
      set({ gitStatus: null, isGitLoading: false })
      return
    }
    // 已有请求在途时只记一次待刷新，等它结束后再取最新状态。
    // 文件监听、自动保存和聚焦会密集触发；若每个请求都排队，Git 读盘会持续数秒，
    // 刷新按钮看起来一直在转，结果也可能滞后。
    if (gitStatusInFlight) {
      gitStatusPending = true
      return
    }
    // 后台触发（保存、文件监听、聚焦）不切换加载态，避免图标反复闪；
    // 首次读取或用户手动刷新才显示 loading。
    const showLoading = options?.showLoading ?? !get().gitStatus
    if (showLoading) set({ isGitLoading: true })
    // 工作台未显示时不必读盘；重新可见时由聚焦事件补一次刷新
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (showLoading) set({ isGitLoading: false })
      return
    }

    // 主进程内部按工作区串行执行 Git 命令，这里只丢弃过期结果：
    // 连续触发时以最后一次请求为准，避免旧状态覆盖新状态。
    gitStatusInFlight = true
    const seq = ++gitStatusSeq
    try {
      do {
        gitStatusPending = false
        const res = await window.api.workbench.gitStatus(workspacePath)
        // 请求期间切换了工作区：丢弃过期结果，避免把上一个仓库的状态显示到新工作区
        if (get().workspacePath !== workspacePath || seq !== gitStatusSeq) break
        if (res.success && res.data) {
          set({ gitStatus: res.data })
        }
      } while (gitStatusPending)
    } catch {
      // 读取失败保留上一次状态，只结束加载态
    } finally {
      gitStatusInFlight = false
      if (get().workspacePath === workspacePath && seq === gitStatusSeq) {
        set({ isGitLoading: false })
      } else if (gitStatusPending) {
        // 旧请求结束前新工作区的刷新被合并进来了，不能随旧请求一起丢掉
        gitStatusPending = false
        void get().refreshGitStatus()
      }
    }
  },

  /**
   * 提交前先落盘当前编辑内容：否则自动保存会在提交后用旧内容覆盖，出现“提交了但文件又变脏”。
   * 只提交工作区范围，未暂存的改动会一并纳入，与界面上“全部改动”的表述一致。
   */
  gitCommit: async (title, body, allowLargeFiles) => {
    const { workspacePath, isDirty } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      if (isDirty) {
        const saved = await get().saveActiveFile()
        if (!saved.saved) return { success: false, failure: 'failed', error: '当前文件保存失败，未提交' }
      }
      const res = await window.api.workbench.gitCommit(workspacePath, title, body, allowLargeFiles)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '提交失败' }
      await get().refreshGitStatus()
      if (result.success) {
        set({ gitNotice: { tone: 'success', message: '已提交' } })
      } else {
        set({ gitNotice: { tone: 'error', message: result.error || '提交失败' } })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ gitNotice: { tone: 'error', message } })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitPull: async () => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      const res = await window.api.workbench.gitPull(workspacePath)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '拉取失败' }
      if (result.success) {
        // 远程改动可能重命名/删除了当前打开的文档，先重扫文件树再按磁盘状态对齐编辑器
        await get().loadFileTree()
        await get().handleExternalFsChanged(workspacePath)
      }
      await get().refreshGitStatus()
      set({
        gitNotice: result.success
          ? { tone: 'success', message: result.hint ?? '已拉取远程改动' }
          : { tone: 'warning', message: result.hint ? `${result.error}：${result.hint}` : result.error || '拉取失败' }
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ gitNotice: { tone: 'error', message } })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitMergeUpstream: async () => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      const res = await window.api.workbench.gitMergeUpstream(workspacePath)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '合并失败' }
      if (result.success) {
        await get().loadFileTree()
        await get().handleExternalFsChanged(workspacePath)
      }
      await get().refreshGitStatus()
      set({
        gitNotice: result.success
          ? { tone: 'success', message: '已合并远程改动' }
          : { tone: 'warning', message: result.hint ? `${result.error}：${result.hint}` : result.error || '合并失败' }
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ gitNotice: { tone: 'error', message } })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitAbortMerge: async () => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    set({ isGitBusy: true })
    try {
      const res = await window.api.workbench.gitAbortMerge(workspacePath)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '撤销失败' }
      if (result.success) {
        await get().loadFileTree()
        await get().handleExternalFsChanged(workspacePath)
      }
      await get().refreshGitStatus()
      set({
        gitNotice: result.success
          ? { tone: 'info', message: '已撤销本次合并，文件回到操作前状态' }
          : { tone: 'error', message: result.error || '撤销失败' }
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ gitNotice: { tone: 'error', message } })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitPush: async (setUpstream) => {
    const { workspacePath, isDirty } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      if (isDirty) {
        const saved = await get().saveActiveFile()
        if (!saved.saved) return { success: false, failure: 'failed', error: '当前文件保存失败，未推送' }
      }
      const res = await window.api.workbench.gitPush(workspacePath, setUpstream)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '推送失败' }
      await get().refreshGitStatus()
      set({
        gitNotice: result.success
          ? { tone: 'success', message: result.hint ?? '已推送到远程' }
          : { tone: 'warning', message: result.hint ? `${result.error}：${result.hint}` : result.error || '推送失败' }
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ gitNotice: { tone: 'error', message } })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitInit: async () => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    set({ isGitBusy: true })
    try {
      const res = await window.api.workbench.gitInit(workspacePath)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '初始化失败' }
      await get().refreshGitStatus()
      set({
        gitNotice: result.success
          ? { tone: 'success', message: '已在此工作区初始化 Git 仓库' }
          : { tone: 'error', message: result.error || '初始化失败' }
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ gitNotice: { tone: 'error', message } })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitSetRemote: async (url, name) => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      const res = await window.api.workbench.gitSetRemote(workspacePath, url, name)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '保存远程地址失败' }
      await get().refreshGitStatus()
      if (!result.success) {
        set({ gitNotice: { tone: 'error', message: result.error || '保存远程地址失败' } })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ gitNotice: { tone: 'error', message } })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  setGitNotice: (notice) => set({ gitNotice: notice }),

  clearGitNotice: () => set({ gitNotice: null })
}))

// 窗口缩小时，已存的侧边栏宽度可能超过可用上限，监听 resize 被动收敛。
// 使用 requestAnimationFrame 防抖，且仅在当前宽度真正超出可用上限时才 set，避免窗口放大或微调触发的多余渲染。
if (typeof window !== 'undefined') {
  let resizeRafId: number | null = null
  window.addEventListener('resize', () => {
    if (resizeRafId !== null) return
    resizeRafId = window.requestAnimationFrame(() => {
      resizeRafId = null
      const current = useWorkbenchStore.getState()
      if (!current.rightPane && !current.isAiSidebar2Open) return
      const winW = window.innerWidth
      const nextState: Partial<WorkbenchStoreState> = {}
      let leftW = current.leftPaneWidth
      if (current.isAiSidebar2Open && !current.isLeftCollapsed) {
        const maxLeft = Math.max(260, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
        if (leftW > maxLeft) {
          leftW = maxLeft
          nextState.leftPaneWidth = leftW
        }
      }
      const clampedRight = clampRightPaneWidth(current.rightPaneWidth, winW, leftW, current.isLeftCollapsed, current.isAiSidebar2Open)
      if (clampedRight !== current.rightPaneWidth) {
        nextState.rightPaneWidth = clampedRight
      }
      if (Object.keys(nextState).length > 0) {
        useWorkbenchStore.setState(nextState)
      }
    })
  })
}
