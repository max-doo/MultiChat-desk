import { create } from 'zustand'
import {
  type WorkbenchFileNode,
  type WorkbenchFileInfo,
  type WorkbenchSearchResult,
  type WorkbenchFileCategory,
  type WorkspaceTagInfo,
  type WorkspaceLinkEntry,
  type WorkspaceUnreferencedImagesSummary,
  type GitStatus,
  type GitActionResult,
  type GitBaselineStatus,
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
export type ReaderBackgroundTheme = 'light' | 'sepia' | 'green' | 'dark'

const READER_BG_THEMES = new Set<ReaderBackgroundTheme>(['light', 'sepia', 'green', 'dark'])
function isReaderBackgroundTheme(value: unknown): value is ReaderBackgroundTheme {
  return typeof value === 'string' && READER_BG_THEMES.has(value as ReaderBackgroundTheme)
}

export interface WorkbenchSortPreference {
  key: WorkbenchSortKey
  order: WorkbenchSortOrder
}

export interface WorkbenchTabItem {
  path: string
  isPinned: boolean
  isPreview: boolean
  editorMode?: EditorMode
}

export type WorkbenchTabInsertTarget =
  | { kind: 'before' | 'after' | 'replace'; path: string }
  | { kind: 'append' }

export interface PersistedWorkspaceTabs {
  tabs: WorkbenchTabItem[]
  activePath: string | null
}

// 右侧 AI 侧边栏宽度限制：随窗口宽度分档，避免小窗下侧边栏过宽挤压编辑器
export const WORKBENCH_MIN_EDITOR_WIDTH = 380
export const WORKBENCH_BASE_MIN_LEFT_WIDTH = 260
export const WORKBENCH_NEW_TAB_PREFIX = '__new_tab__:'

export function isNewTabPath(path: string | null | undefined): boolean {
  return Boolean(path && path.startsWith(WORKBENCH_NEW_TAB_PREFIX))
}

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
  const leftW = collapsed ? 0 : (leftWidth ?? state?.leftPaneWidth ?? WORKBENCH_BASE_MIN_LEFT_WIDTH)
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
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
  const raw = bom ? content.slice(1) : content
  const normalized = normalizeConversationFrontmatter(raw)
  if (normalized !== raw) return bom + normalized
  const frontmatter = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)?.[1]
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
  const sourceUrl = /^(?:source|source_url|source_key)\s*:\s*["']?(https:\/\/.+?)["']?\s*$/im.exec(
    frontmatter
  )?.[1]
  if (!sourceUrl) return content
  // 旧会话必须同时具备完整对话结构；只有来源链接、正文是单条回复或普通
  // 笔记时保持普通文档，避免把回复摘录升级成会话快照。
  if (!looksLikeConversationTranscript(stripFrontmatter(raw))) {
    return content
  }
  const isConversation = Object.entries(defaultSelectors.models).some(([platformId, config]) =>
    !!config.newConversationUrl && isConversationUrlForPlatform(platformId, sourceUrl, config.newConversationUrl)
  )
  if (!isConversation) return content
  return bom + adoptLegacyConversationFrontmatter(raw)
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
  /** 当前激活标签标识（文件标签等于 activeFilePath；新标签页为 __new_tab__:N，此时 activeFilePath 为 null） */
  activeTabPath: string | null
  /** 快速打开文件弹窗状态（Ctrl+O 或空白页“打开文件”触发） */
  isQuickOpenOpen: boolean
  /** 已打开的标签页集合（固定标签始终排在普通标签之前） */
  openTabs: WorkbenchTabItem[]
  /** 最近访问标签顺序（最新在前，用于 Ctrl+Tab 与关闭标签后智能回退） */
  mruTabOrder: string[]
  /** 最近关闭的标签路径栈（支持 Ctrl+Shift+T 恢复） */
  closedTabHistory: string[]
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
  /** 代码预览面板是否处于可编辑态（源码编辑/代码编辑）；只读查看态为 false。 */
  codePreviewEditable: boolean
  /** 当前是否为 HTML 渲染表面（渲染/可视化编辑模式）：内容区为白底，宿主 UI 必须浅色。 */
  htmlRenderSurface: boolean
  /** 富文本 Markdown 防抖同步注册的冲刷回调：切模式/保存/切文件前同步落入 activeFileContent */
  markdownSyncFlusher: (() => void) | null
  /** 源码模式防抖同步注册的冲刷回调：切模式/保存/切文件/Git 操作前同步落入 activeFileContent */
  sourceSyncFlusher: (() => void) | null

  // 搜索相关
  searchQuery: string
  isSearching: boolean
  searchResults: WorkbenchSearchResult[]

  // 工作区标签集合（用于标签自动补全与防泛滥）
  workspaceTags: WorkspaceTagInfo[]

  // 工作区双链快照：每个 Markdown 文件抽取出的 [[target]] 原始串，
  // 供文档元数据区解析出链/反链；解析依赖文件树，渲染层按统一语义完成。
  workspaceLinks: WorkspaceLinkEntry[]

  // 文件树排序偏好
  fileSort: WorkbenchSortPreference

  // 布局尺寸与折叠
  leftPaneWidth: number
  /** 左侧栏动态最小宽度（随顶部模式标签与操作按钮所需宽度动态抬高，下限 WORKBENCH_BASE_MIN_LEFT_WIDTH） */
  leftPaneMinWidth: number
  rightPaneWidth: number
  isLeftCollapsed: boolean
  rightPane: WorkbenchRightPane
  /** 是否在文档右侧展示原位旁注便签 */
  showMarginNotes: boolean
  /** 图片预览画布背景，全局持久化，切换图片后保持一致 */
  imageBackgroundTheme: ImageBackgroundTheme
  /** Markdown 编辑/预览、PDF 预览、Word 预览各自独立持久化的背景主题 */
  markdownBackgroundTheme: ReaderBackgroundTheme
  pdfBackgroundTheme: ReaderBackgroundTheme
  docxBackgroundTheme: ReaderBackgroundTheme
  /** 待生成的选区范围；由编辑器划词菜单写入，导图面板消费后清空。 */
  pendingMindmapSelection: { text: string; headingPath: string[] } | null
  /** 待打开的来源会话；笔记属性里的会话图标写入，AI 侧边栏消费后清空。 */
  pendingConversationOpen: { platformId: string; url: string; token: number; target?: 'ai' | 'ai2' } | null
  sidebarModelId: string
  sidebar2ModelId: string
  isAiSidebar2Open: boolean
  editorMode: EditorMode
  /** 笔记属性面板折叠态；出链/反链元数据属于笔记属性，跟随同一折叠 */
  frontmatterPanelCollapsed: boolean
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

  // 编辑器行内/块级标记的 Git 基准（仅当前活动文件单份缓存）
  gitBaselinePath: string | null
  gitBaselineStatus: 'idle' | 'loading' | GitBaselineStatus
  gitBaselineSha: string | null
  gitBaselineContent: string | null
}

interface WorkbenchStoreActions {
  initWorkbench: () => Promise<void>
  selectWorkspaceFolder: () => Promise<void>
  /** 切换工作区；返回切换结果供调用方区分「取消」与「失败」。 */
  setWorkspaceFolder: (dirPath: string, dirName?: string) => Promise<'switched' | 'cancelled' | 'failed'>
  closeWorkspace: () => Promise<void>
  removeRecentWorkspace: (dirPath: string) => void
  loadFileTree: (options?: { skipGitStatus?: boolean }) => Promise<void>
  toggleFolder: (folderId: string) => void
  expandAllFolders: () => void
  collapseAllFolders: () => void
  /** 展开某文件路径的全部祖先目录，供 openFile 后侧边栏定位复用。 */
  expandAncestorsOf: (relativePath: string) => void
  openFile: (
    relativePath: string,
    options?: {
      keepActiveOnMissing?: boolean
      preview?: boolean
      forcePermanent?: boolean
      insertTarget?: WorkbenchTabInsertTarget
    }
  ) => Promise<boolean>
  createNewTab: () => Promise<void>
  activateTab: (tabPath: string) => Promise<boolean>
  createUntitledNote: () => Promise<string | null>
  setQuickOpenOpen: (open: boolean) => void
  promoteTab: (relativePath: string) => void
  togglePinTab: (relativePath: string) => void
  reorderTabs: (fromPath: string, toPath: string) => void
  closeTab: (
    relativePath: string,
    options?: { force?: boolean }
  ) => Promise<'closed' | 'cancelled' | 'needs-confirm'>
  closeOtherTabs: (keepPath: string) => Promise<void>
  closeRightTabs: (fromPath: string) => Promise<void>
  closeSavedTabs: () => Promise<void>
  closeAllTabs: () => Promise<void>
  reopenLastClosedTab: () => Promise<boolean>
  saveActiveFile: () => Promise<SaveActiveFileResult>
  setDocumentAnnotationFlusher: (
    flusher: (() => Promise<DocumentAnnotationFlushResult>) | null
  ) => void
  flushDocumentAnnotations: () => Promise<DocumentAnnotationFlushResult>
  setMarkdownSyncFlusher: (flusher: (() => void) | null) => void
  flushMarkdownSync: () => void
  markMarkdownPendingSync: () => void
  setSourceSyncFlusher: (flusher: (() => void) | null) => void
  flushSourceSync: () => void
  markSourcePendingSync: () => void
  flushActiveEditorSync: () => void
  resolveExternalConflict: (choice: 'keep-mine' | 'take-disk') => Promise<boolean>
  updateActiveContent: (content: string) => void
  setHtmlEditFlusher: (flusher: (() => Promise<string>) | null) => void
  setHtmlEditLeaveGuard: (guard: (() => Promise<HtmlEditLeaveDecision>) | null) => void
  setHtmlVisualEditing: (editing: boolean) => void
  setCodePreviewEditable: (editable: boolean) => void
  setHtmlRenderSurface: (render: boolean) => void
  markActiveFileDirty: () => void
  /** 可视化编辑撤销回到干净基线时回调，仅在该路径调用。 */
  unmarkActiveFileDirty: () => void
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
  findWorkspaceUnreferencedImages: () => Promise<WorkspaceUnreferencedImagesSummary | null>
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
  loadWorkspaceLinks: () => Promise<void>
  setFileSort: (pref: WorkbenchSortPreference) => void
  setLeftPaneWidth: (width: number, persist?: boolean) => number
  setLeftPaneMinWidth: (minWidth: number) => void
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
  setMarkdownBackgroundTheme: (theme: ReaderBackgroundTheme) => void
  setPdfBackgroundTheme: (theme: ReaderBackgroundTheme) => void
  setDocxBackgroundTheme: (theme: ReaderBackgroundTheme) => void
  askAi: (text: string, actionType: WorkbenchAiAction, target?: 'ai' | 'ai2') => void
  clearError: () => void
  showNotice: (message: string) => void
  clearNotice: () => void
  setDraggingNodes: (nodes: WorkbenchFileNode[] | null) => void

  /** 用户对账确认删除：把 pendingMindmapDeletions 带 force+targets 执行。 */
  confirmMindmapDeletions: (targets: Array<{ conversationId: string; relativePath: string }>) => Promise<void>

  refreshGitStatus: (options?: { showLoading?: boolean }) => Promise<void>
  refreshGitBaseline: () => Promise<void>
  gitCommit: (title: string, body?: string, allowLargeFiles?: boolean) => Promise<GitActionResult>
  gitPull: () => Promise<GitActionResult>
  gitMergeUpstream: () => Promise<GitActionResult>
  gitAbortMerge: () => Promise<GitActionResult>
  gitPush: (setUpstream?: boolean) => Promise<GitActionResult>
  gitInit: () => Promise<GitActionResult>
  gitSetRemote: (url: string, name?: string) => Promise<GitActionResult>
  gitDiscardFile: (change: { path: string; oldPath?: string }) => Promise<GitActionResult>
  gitTrashFile: (relativePath: string) => Promise<GitActionResult>
  gitIgnorePath: (relativePath: string, mode: 'file' | 'extension') => Promise<GitActionResult>
  setGitNotice: (notice: WorkbenchStoreState['gitNotice']) => void
  clearGitNotice: () => void
}

export type WorkbenchStore = WorkbenchStoreState & WorkbenchStoreActions

// 防抖与请求序列锁
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let gitNoticeTimer: ReturnType<typeof setTimeout> | null = null
let currentSearchSeq = 0
let fsWatcherBound = false
let gitStatusSeq = 0
/** 同一时刻只保留一个在途的状态请求：连续触发时合并为最后一次，避免 Git 命令排队拖住刷新图标 */
let gitStatusInFlight = false
let gitStatusPending = false
/** 焦点防抖与仓库状态指纹：避免未切回工作台或短时间内反复 alt-tab 重复触发 git status */
let lastGitRefreshAt = 0
let lastGitRepoStamp: string | null = null
/** 当前活动文件 Git 基准的请求序号与在途合批状态 */
let gitBaselineSeq = 0
let gitBaselinePromise: Promise<void> | null = null
let gitBaselinePending = false
/** 外部文件系统变更 in-flight 与 pending 合批锁 */
let externalFsInFlight = false
let externalFsPendingWorkspace: string | null = null
/** 最近一次 loadFileTree 对账产生的改名映射（供 gitPull/merge 等同步更新活动文件） */
let lastLoadTreeRelinks: Array<{ from: string; to: string }> = []
/** 保存后节流刷新文件树 Git 徽标的定时器 */
let gitStatusRefreshTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 最近一次对账发现的改名映射（旧路径 → 新路径）。
 * 应用关闭期间的外部改名只在重新载入时对账一次，恢复上次打开的文档要能跟着走。
 * 键带上工作区，避免切换工作区后同名相对路径被错误重定向。
 */
const recentRelinks = new Map<string, string>()
const relinkKey = (workspaceRoot: string, relativePath: string): string =>
  `${workspaceRoot.replace(/\\/g, '/').toLowerCase()}\n${relativePath}`

/** 工作区维度缓存的标签页状态（持久化至 workbench_workspaceTabs） */
const WORKSPACE_TABS_STORE_KEY = 'workbench_workspaceTabs'
let workspaceTabsCache: Record<string, PersistedWorkspaceTabs> = {}
let newTabSeq = 0

function normalizeWorkspaceTabKey(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function orderPinnedTabs(tabs: WorkbenchTabItem[]): WorkbenchTabItem[] {
  const pinned: WorkbenchTabItem[] = []
  const normal: WorkbenchTabItem[] = []
  for (const tab of tabs) {
    if (tab.isPinned) pinned.push(tab)
    else normal.push(tab)
  }
  return [...pinned, ...normal]
}

function sanitizePersistedTabs(raw: unknown): Record<string, PersistedWorkspaceTabs> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, PersistedWorkspaceTabs> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue
    const record = val as { tabs?: unknown; activePath?: unknown }
    if (!Array.isArray(record.tabs)) continue
    const seen = new Set<string>()
    const cleanTabs: WorkbenchTabItem[] = []
    for (const item of record.tabs) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as Partial<WorkbenchTabItem>
      if (typeof candidate.path !== 'string' || !candidate.path || seen.has(candidate.path)) continue
      seen.add(candidate.path)
      cleanTabs.push({
        path: candidate.path,
        isPinned: Boolean(candidate.isPinned),
        isPreview: Boolean(candidate.isPreview) && !candidate.isPinned,
        ...(candidate.editorMode === 'wysiwyg' || candidate.editorMode === 'source'
          ? { editorMode: candidate.editorMode }
          : {})
      })
    }
    out[key] = {
      tabs: orderPinnedTabs(cleanTabs),
      activePath: typeof record.activePath === 'string' && record.activePath ? record.activePath : null
    }
  }
  return out
}

function persistWorkspaceTabs(
  workspacePath: string | null,
  tabs: WorkbenchTabItem[],
  activePath: string | null
): void {
  if (!workspacePath) return
  const key = normalizeWorkspaceTabKey(workspacePath)
  const fileTabs = tabs.filter((t) => !isNewTabPath(t.path))
  const resolvedActive = activePath && !isNewTabPath(activePath) ? activePath : null
  workspaceTabsCache = {
    ...workspaceTabsCache,
    [key]: {
      tabs: fileTabs.map((t) => ({
        path: t.path,
        isPinned: t.isPinned,
        isPreview: t.isPreview,
        ...(t.editorMode ? { editorMode: t.editorMode } : {})
      })),
      activePath: resolvedActive
    }
  }
  // 限制最多保留 12 个工作区的标签快照，防止配置膨胀
  const keys = Object.keys(workspaceTabsCache)
  if (keys.length > 12) {
    const trimmed: Record<string, PersistedWorkspaceTabs> = {}
    for (const k of keys.slice(keys.length - 12)) {
      trimmed[k] = workspaceTabsCache[k]
    }
    workspaceTabsCache = trimmed
  }
  void window.api.storeSet(WORKSPACE_TABS_STORE_KEY, workspaceTabsCache)
}

function syncTabsOnOpen(
  tabs: WorkbenchTabItem[],
  mru: string[],
  prevActiveFilePath: string | null,
  prevActiveTabPath: string | null,
  prevEditorMode: EditorMode,
  nextPath: string,
  options?: {
    preview?: boolean
    forcePermanent?: boolean
    insertTarget?: WorkbenchTabInsertTarget
  }
): { openTabs: WorkbenchTabItem[]; mruTabOrder: string[]; restoredEditorMode?: EditorMode } {
  let nextTabs = tabs.map((t) =>
    prevActiveFilePath && t.path === prevActiveFilePath ? { ...t, editorMode: prevEditorMode } : t
  )
  let nextMru = [...mru]
  const existingIdx = nextTabs.findIndex((t) => t.path === nextPath)
  let restoredEditorMode: EditorMode | undefined
  const insertTarget = options?.insertTarget

  const replaceTargetIdx =
    insertTarget?.kind === 'replace' && isNewTabPath(insertTarget.path)
      ? nextTabs.findIndex((t) => t.path === insertTarget.path && !t.isPinned)
      : -1

  const outgoingNewTabIdx =
    replaceTargetIdx !== -1
      ? replaceTargetIdx
      : prevActiveTabPath && isNewTabPath(prevActiveTabPath)
        ? nextTabs.findIndex((t) => t.path === prevActiveTabPath && !t.isPinned)
        : -1

  if (existingIdx !== -1) {
    const existing = nextTabs[existingIdx]
    restoredEditorMode = existing.editorMode
    if (options?.forcePermanent && existing.isPreview) {
      nextTabs = nextTabs.map((t, i) => (i === existingIdx ? { ...t, isPreview: false } : t))
    }
    if (outgoingNewTabIdx !== -1) {
      const droppedPath = nextTabs[outgoingNewTabIdx].path
      nextTabs = nextTabs.filter((_, i) => i !== outgoingNewTabIdx)
      nextMru = nextMru.filter((p) => p !== droppedPath)
    }
  } else if (outgoingNewTabIdx !== -1 && (!insertTarget || insertTarget.kind === 'replace' || insertTarget.kind === 'append')) {
    // 若当前停留在空白“新标签页”或拖入“新标签页”槽位，打开或新建文件时就地替换该标签
    const droppedPath = nextTabs[outgoingNewTabIdx].path
    const replacement: WorkbenchTabItem = {
      path: nextPath,
      isPinned: false,
      isPreview: !options?.forcePermanent && Boolean(options?.preview)
    }
    nextTabs = nextTabs.map((t, i) => (i === outgoingNewTabIdx ? replacement : t))
    nextMru = nextMru.filter((p) => p !== droppedPath)
  } else if (!insertTarget && options?.preview) {
    const previewIdx = nextTabs.findIndex((t) => t.isPreview && !t.isPinned)
    const fresh: WorkbenchTabItem = { path: nextPath, isPinned: false, isPreview: true }
    if (previewIdx !== -1) {
      nextTabs = nextTabs.map((t, i) => (i === previewIdx ? fresh : t))
    } else {
      nextTabs = orderPinnedTabs([...nextTabs, fresh])
    }
  } else {
    if (outgoingNewTabIdx !== -1) {
      const droppedPath = nextTabs[outgoingNewTabIdx].path
      nextTabs = nextTabs.filter((_, i) => i !== outgoingNewTabIdx)
      nextMru = nextMru.filter((p) => p !== droppedPath)
    }
    nextTabs = orderPinnedTabs([
      ...nextTabs,
      { path: nextPath, isPinned: false, isPreview: false }
    ])
  }

  // 根据拖拽落位调整普通标签顺序（固定标签维持固定区位置）
  if (insertTarget && insertTarget.kind !== 'replace') {
    const targetTab = nextTabs.find((t) => t.path === nextPath)
    if (targetTab && !targetTab.isPinned) {
      if (insertTarget.kind === 'append') {
        nextTabs = orderPinnedTabs([
          ...nextTabs.filter((t) => t.path !== nextPath),
          targetTab
        ])
      } else if (insertTarget.path !== nextPath) {
        const withoutTarget = nextTabs.filter((t) => t.path !== nextPath)
        const anchorIdx = withoutTarget.findIndex((t) => t.path === insertTarget.path)
        if (anchorIdx !== -1) {
          const anchor = withoutTarget[anchorIdx]
          const insertIdx = anchor.isPinned
            ? withoutTarget.filter((t) => t.isPinned).length
            : insertTarget.kind === 'before'
              ? anchorIdx
              : anchorIdx + 1
          const reordered = [...withoutTarget]
          reordered.splice(insertIdx, 0, targetTab)
          nextTabs = orderPinnedTabs(reordered)
        }
      }
    }
  }

  nextMru = [nextPath, ...nextMru.filter((p) => p !== nextPath)]
  return { openTabs: nextTabs, mruTabOrder: nextMru, restoredEditorMode }
}

function remapPathPrefix(target: string, oldPrefix: string, newPrefix: string): string {
  if (target === oldPrefix) return newPrefix
  if (target.startsWith(`${oldPrefix}/`)) return newPrefix + target.slice(oldPrefix.length)
  return target
}

function dedupeTabsByPath(tabs: WorkbenchTabItem[]): WorkbenchTabItem[] {
  const seen = new Set<string>()
  const out: WorkbenchTabItem[] = []
  for (const t of tabs) {
    if (seen.has(t.path)) continue
    seen.add(t.path)
    out.push(t)
  }
  return orderPinnedTabs(out)
}

function isUnderAnyPath(target: string, prefixes: string[]): boolean {
  return prefixes.some((p) => target === p || target.startsWith(`${p}/`))
}

function pickFallbackTabPath(tabs: WorkbenchTabItem[], mru: string[], closedIdx?: number): string | null {
  const validSet = new Set(tabs.map((t) => t.path))
  for (const p of mru) {
    if (validSet.has(p)) return p
  }
  if (tabs.length === 0) return null
  if (typeof closedIdx === 'number' && closedIdx >= 0) {
    return tabs[Math.min(closedIdx, tabs.length - 1)]?.path ?? null
  }
  return tabs[0]?.path ?? null
}

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

/** 按当前排序拍平文件列表（目录优先，与树渲染一致），用于删除后挑相邻文件及快速打开弹窗 */
export function flattenSortedFiles(
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
function buildActiveFilePayload(relativePath: string, data: WorkbenchFileInfo) {
  return {
    activeFilePath: relativePath,
    activeFileContent: data.content,
    activeFileCategory: data.category || getFileCategory(relativePath),
    activeFileDataUrl: data.dataUrl || null,
    activeFileUrl: data.fileUrl || null,
    activeFileMime: data.mimeType || null,
    activeFileSize: data.size,
    activeFileOversized: !!data.isOversized,
    isDirty: false,
    saveStatus: 'saved' as const,
    lastSavedAt: data.mtime,
    conflictDiskContent: null
  }
}

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
    activeTabPath: snapshot.activeFilePath,
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

/**
 * 文件树刷新后，按磁盘最新状态对齐当前打开的文档（处理外部改名、删除与磁盘修改）。
 */
async function reconcileActiveFileWithTree(
  workspacePath: string,
  previousTree: WorkbenchFileNode[],
  nextTree: WorkbenchFileNode[],
  relinks: Array<{ from: string; to: string }>,
  options?: { skipBaselineRefresh?: boolean }
): Promise<void> {
  const store = useWorkbenchStore.getState()
  if (store.workspacePath !== workspacePath) return
  store.flushActiveEditorSync()
  const { activeFilePath, isDirty, lastSavedAt, openTabs, mruTabOrder, closedTabHistory } =
    useWorkbenchStore.getState()
  const allPaths = collectTreePaths(nextTree, new Set<string>())

  // 同步外部改名与删除到所有已打开标签页
  if (openTabs.length > 0) {
    const relinkMap = new Map(relinks.map((r) => [r.from, r.to]))
    let tabsChanged = false
    const nextOpenTabs: WorkbenchTabItem[] = []
    const seenTabPaths = new Set<string>()
    for (const tab of openTabs) {
      if (isNewTabPath(tab.path)) {
        if (!seenTabPaths.has(tab.path)) {
          seenTabPaths.add(tab.path)
          nextOpenTabs.push(tab)
        }
        continue
      }
      let nextPath = relinkMap.get(tab.path) ?? tab.path
      if (!allPaths.has(nextPath)) {
        const guessed = findRenamedNode(previousTree, nextTree, tab.path)
        if (guessed && allPaths.has(guessed)) nextPath = guessed
      }
      if (!allPaths.has(nextPath)) {
        tabsChanged = true
        continue
      }
      if (nextPath !== tab.path) tabsChanged = true
      if (!seenTabPaths.has(nextPath)) {
        seenTabPaths.add(nextPath)
        nextOpenTabs.push(nextPath === tab.path ? tab : { ...tab, path: nextPath })
      } else {
        tabsChanged = true
      }
    }
    if (tabsChanged) {
      const nextMru = mruTabOrder
        .map((p) => relinkMap.get(p) ?? p)
        .filter((p, i, arr) => seenTabPaths.has(p) && arr.indexOf(p) === i)
      const nextClosed = closedTabHistory
        .map((p) => relinkMap.get(p) ?? p)
        .filter((p) => allPaths.has(p))
      useWorkbenchStore.setState({
        openTabs: orderPinnedTabs(nextOpenTabs),
        mruTabOrder: nextMru,
        closedTabHistory: nextClosed
      })
      persistWorkspaceTabs(workspacePath, orderPinnedTabs(nextOpenTabs), useWorkbenchStore.getState().activeTabPath)
    }
  }

  const renamedTo = activeFilePath
    ? relinks.find(link => link.from === activeFilePath)?.to ??
      (findNode(nextTree, activeFilePath) ? null : findRenamedNode(previousTree, nextTree, activeFilePath))
    : null
  const currentPath = renamedTo ?? activeFilePath
  if (!currentPath) return

  // 文件被外部删除/移走（或被重命名成别的路径）：若还有其他打开的标签则切过去，否则清空编辑器
  if (!allPaths.has(currentPath)) {
    const remaining = useWorkbenchStore.getState().openTabs.filter((t) => t.path !== activeFilePath)
    const fallbackPath = pickFallbackTabPath(remaining, useWorkbenchStore.getState().mruTabOrder)
    useWorkbenchStore.setState({
      activeFilePath: null,
      activeTabPath: null,
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
      openTabs: remaining
    })
    useWorkbenchStore.setState({
      gitBaselinePath: null,
      gitBaselineStatus: 'idle',
      gitBaselineSha: null,
      gitBaselineContent: null
    })
    if (fallbackPath) {
      void useWorkbenchStore.getState().activateTab(fallbackPath)
    } else {
      persistWorkspaceTabs(workspacePath, [], null)
      void window.api.storeDelete('workbench_lastActiveFilePath')
    }
    return
  }

  // 文件还在：对比 mtime 决定是否重载内容；外部重命名（mtime 不变）也要刷新 activeFileUrl 与分类
  const node = findNode(nextTree, currentPath)
  if (!node || node.isDirectory) return

  const mtimeChanged =
    typeof node.mtime === 'number' &&
    (lastSavedAt === null || Math.abs(node.mtime - lastSavedAt) > 1)
  const diskNewer = typeof node.mtime === 'number' && lastSavedAt !== null && node.mtime - lastSavedAt > 2
  const nextCategory = getFileCategory(currentPath)
  const reloadable =
    nextCategory === 'markdown' ||
    nextCategory === 'text' ||
    nextCategory === 'code'

  if (!renamedTo && (!mtimeChanged || !reloadable)) return

  let fileRes: { success: boolean; data?: WorkbenchFileInfo } | null = null
  try {
    fileRes = await window.api.workbench.readFile(workspacePath, currentPath)
  } catch {
    fileRes = null
  }
  if (useWorkbenchStore.getState().workspacePath !== workspacePath) return

  if (renamedTo) {
    void window.api.storeSet('workbench_lastActiveFilePath', renamedTo)
    if (!options?.skipBaselineRefresh) {
      void useWorkbenchStore.getState().refreshGitBaseline()
    }
  }

  if (isDirty) {
    if (diskNewer) {
      useWorkbenchStore.setState({
        ...(renamedTo && fileRes?.success && fileRes.data
          ? {
              activeFilePath: currentPath,
              activeFileCategory: fileRes.data.category || nextCategory,
              activeFileDataUrl: fileRes.data.dataUrl || null,
              activeFileUrl: fileRes.data.fileUrl || null,
              activeFileMime: fileRes.data.mimeType || null,
              activeFileSize: fileRes.data.size,
              activeFileOversized: !!fileRes.data.isOversized
            }
          : renamedTo
            ? {
                activeFilePath: currentPath,
                activeFileCategory: nextCategory,
                activeFileUrl: null,
                activeFileDataUrl: null
              }
            : {}),
        saveStatus: 'conflict',
        conflictDiskContent: fileRes?.success && fileRes.data ? fileRes.data.content : ''
      })
    } else if (renamedTo) {
      useWorkbenchStore.setState(
        fileRes?.success && fileRes.data
          ? {
              activeFilePath: currentPath,
              activeFileCategory: fileRes.data.category || nextCategory,
              activeFileDataUrl: fileRes.data.dataUrl || null,
              activeFileUrl: fileRes.data.fileUrl || null,
              activeFileMime: fileRes.data.mimeType || null,
              activeFileSize: fileRes.data.size,
              activeFileOversized: !!fileRes.data.isOversized
            }
          : {
              activeFilePath: currentPath,
              activeFileCategory: nextCategory,
              activeFileUrl: null,
              activeFileDataUrl: null
            }
      )
    }
    return
  }

  if (fileRes?.success && fileRes.data) {
    useWorkbenchStore.setState(buildActiveFilePayload(currentPath, fileRes.data))
  } else if (renamedTo) {
    useWorkbenchStore.setState({
      activeFilePath: currentPath,
      activeFileCategory: nextCategory,
      activeFileUrl: null,
      activeFileDataUrl: null
    })
  }
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
  activeTabPath: null,
  isQuickOpenOpen: false,
  openTabs: [],
  mruTabOrder: [],
  closedTabHistory: [],
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
  codePreviewEditable: false,
  htmlRenderSurface: false,
  markdownSyncFlusher: null,
  sourceSyncFlusher: null,

  searchQuery: '',
  isSearching: false,
  searchResults: [],
  workspaceTags: [],
  workspaceLinks: [],

  fileSort: { key: 'name', order: 'asc' },

  leftPaneWidth: WORKBENCH_BASE_MIN_LEFT_WIDTH,
  leftPaneMinWidth: WORKBENCH_BASE_MIN_LEFT_WIDTH,
  rightPaneWidth: 420,
  isLeftCollapsed: false,
  rightPane: 'ai',
  showMarginNotes: false,
  imageBackgroundTheme: 'checkerboard',
  markdownBackgroundTheme: 'light',
  pdfBackgroundTheme: 'light',
  docxBackgroundTheme: 'light',
  pendingMindmapSelection: null,
  pendingConversationOpen: null,
  sidebarModelId: 'chatgpt',
  sidebar2ModelId: 'gemini',
  isAiSidebar2Open: false,
  editorMode: 'wysiwyg',
  frontmatterPanelCollapsed: false,
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
  gitBaselinePath: null,
  gitBaselineStatus: 'idle',
  gitBaselineSha: null,
  gitBaselineContent: null,

  initWorkbench: async () => {
    if (get().isInitialized) return
    try {
      // 绑定一次外部文件系统监听：主进程 watcher 去抖广播后静默重扫文件树
      if (!fsWatcherBound) {
        fsWatcherBound = true
        window.api.workbench.onFsChanged((payload) => {
          void get().handleExternalFsChanged(payload.workspaceRoot)
        })
        // 重命名/删除等自写操作不会广播 fs-changed；主进程索引落盘后
        // 推来的快照是消除过期 path 键（幽灵反链）的唯一通道
        window.api.workbench.onLinksChanged((payload) => {
          const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
          const current = get().workspacePath
          if (current && normalize(payload.workspaceRoot) === normalize(current)) {
            set({ workspaceLinks: payload.links })
          }
        })
        // 用户可能在终端或其他编辑器里改动过仓库：仅在处于工作台且冷却期已过或 .git/HEAD/.git/index 变化时同步
        window.addEventListener('focus', () => {
          const { workspacePath } = get()
          if (!workspacePath) return
          if (useAppStore.getState().productMode !== 'workbench') return
          if (Date.now() - lastGitRefreshAt >= 2500) {
            void get().refreshGitStatus()
            void get().refreshGitBaseline()
            return
          }
          void window.api.workbench.gitRepoStamp(workspacePath)
            .then((res) => {
              if (!res.success || !res.data) return
              if (lastGitRepoStamp === null) {
                lastGitRepoStamp = res.data
                return
              }
              if (res.data !== lastGitRepoStamp) {
                lastGitRepoStamp = res.data
                if (get().workspacePath === workspacePath && useAppStore.getState().productMode === 'workbench') {
                  void get().refreshGitStatus()
                  void get().refreshGitBaseline()
                }
              }
            })
            .catch(() => undefined)
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
        savedMarkdownBgTheme,
        savedPdfBgTheme,
        savedDocxBgTheme,
        savedContentWidth,
        savedWorkspaceTabs
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
        window.api.storeGet('workbench_markdownBgTheme') as Promise<ReaderBackgroundTheme | null>,
        window.api.storeGet('workbench_pdfBgTheme') as Promise<ReaderBackgroundTheme | null>,
        window.api.storeGet('workbench_docxBgTheme') as Promise<ReaderBackgroundTheme | null>,
        window.api.storeGet('workbench_contentWidth') as Promise<WorkbenchContentWidth | null>,
        window.api.storeGet(WORKSPACE_TABS_STORE_KEY) as Promise<unknown>
      ])
      workspaceTabsCache = sanitizePersistedTabs(savedWorkspaceTabs)

      const updates: Partial<WorkbenchStoreState> = { isInitialized: true }
      const winW = typeof window !== 'undefined' ? window.innerWidth : 1400
      const currentMinLeft = get().leftPaneMinWidth
      if (typeof savedLeftWidth === 'number' && savedLeftWidth >= WORKBENCH_BASE_MIN_LEFT_WIDTH && savedLeftWidth <= 480) {
        updates.leftPaneWidth = Math.max(currentMinLeft, savedLeftWidth)
      }
      if (typeof savedLeftCollapsed === 'boolean') {
        updates.isLeftCollapsed = savedLeftCollapsed
      }
      const resolvedDualAi = typeof savedAiSidebar2Open === 'boolean' ? savedAiSidebar2Open : false
      const resolvedLeftCollapsed = updates.isLeftCollapsed ?? false
      if (resolvedDualAi && !resolvedLeftCollapsed && winW >= currentMinLeft + WORKBENCH_MIN_EDITOR_WIDTH + RIGHT_PANE_DUAL_MIN + 10) {
        const maxLeft = Math.max(currentMinLeft, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
        if ((updates.leftPaneWidth ?? currentMinLeft) > maxLeft) {
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
          updates.leftPaneWidth ?? currentMinLeft,
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
      if (isReaderBackgroundTheme(savedMarkdownBgTheme)) {
        updates.markdownBackgroundTheme = savedMarkdownBgTheme
      }
      if (isReaderBackgroundTheme(savedPdfBgTheme)) {
        updates.pdfBackgroundTheme = savedPdfBgTheme
      }
      if (isReaderBackgroundTheme(savedDocxBgTheme)) {
        updates.docxBackgroundTheme = savedDocxBgTheme
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
        if (activated && get().openTabs.length === 0 && !get().activeFilePath) {
          if (savedActiveFile && typeof savedActiveFile === 'string') {
            // 兼容老版本无 workbench_workspaceTabs 快照时的单文件恢复
            const restorePath = recentRelinks.get(relinkKey(savedPath, savedActiveFile)) ?? savedActiveFile
            const tree = get().fileTree
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

    const prevWorkspace = get().workspacePath
    if (prevWorkspace) {
      get().flushActiveEditorSync()
      if (get().isDirty && get().activeFilePath) {
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer)
          autoSaveTimer = null
        }
        await get().saveActiveFile()
      }
      persistWorkspaceTabs(prevWorkspace, get().openTabs, get().activeFilePath)
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
      activeTabPath: null,
      isQuickOpenOpen: false,
      openTabs: [],
      mruTabOrder: [],
      closedTabHistory: [],
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
    if (gitNoticeTimer) {
      clearTimeout(gitNoticeTimer)
      gitNoticeTimer = null
    }
    lastGitRefreshAt = 0
    lastGitRepoStamp = null
    gitBaselinePending = false
    externalFsPendingWorkspace = null
    set({
      gitStatus: null,
      gitNotice: null,
      gitBaselinePath: null,
      gitBaselineStatus: 'idle',
      gitBaselineSha: null,
      gitBaselineContent: null
    })
    // 旧版本导图记录在全局笔记目录，先迁到 .multichat/mindmaps 文件。
    void window.api.workbench.mindmapMigrate(activePath).catch(() => undefined)
    await get().loadFileTree()

    // 恢复该工作区上次打开的标签页与激活文档
    const savedSnapshot = workspaceTabsCache[normalizeWorkspaceTabKey(activePath)]
    if (savedSnapshot && savedSnapshot.tabs.length > 0) {
      const validPaths = collectTreePaths(get().fileTree, new Set<string>())
      const restoredTabs: WorkbenchTabItem[] = []
      const seen = new Set<string>()
      for (const tab of savedSnapshot.tabs) {
        const relinked = recentRelinks.get(relinkKey(activePath, tab.path)) ?? tab.path
        if (!validPaths.has(relinked) || seen.has(relinked)) continue
        seen.add(relinked)
        restoredTabs.push({ ...tab, path: relinked })
      }
      if (restoredTabs.length > 0) {
        const ordered = orderPinnedTabs(restoredTabs)
        const desiredActive = savedSnapshot.activePath
          ? recentRelinks.get(relinkKey(activePath, savedSnapshot.activePath)) ?? savedSnapshot.activePath
          : null
        const targetActive =
          desiredActive && seen.has(desiredActive) ? desiredActive : ordered[0].path
        set({
          openTabs: ordered,
          mruTabOrder: [targetActive, ...ordered.map((t) => t.path).filter((p) => p !== targetActive)]
        })
        await get().openFile(targetActive)
      }
    }
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
    get().flushActiveEditorSync()
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
    if (closingPath) {
      persistWorkspaceTabs(closingPath, get().openTabs, get().activeFilePath)
    }
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
    if (gitNoticeTimer) {
      clearTimeout(gitNoticeTimer)
      gitNoticeTimer = null
    }
    set({
      workspacePath: activePath,
      workspaceGeneration: session.data.generation,
      workspaceName: activeName,
      fileTree: [],
      expandedFolderIds: new Set<string>(),
      activeFilePath: null,
      activeTabPath: null,
      isQuickOpenOpen: false,
      openTabs: [],
      mruTabOrder: [],
      closedTabHistory: [],
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
      gitNotice: null,
      gitBaselinePath: null,
      gitBaselineStatus: 'idle',
      gitBaselineSha: null,
      gitBaselineContent: null
    })
    lastGitRefreshAt = 0
    lastGitRepoStamp = null
    gitBaselinePending = false
    externalFsPendingWorkspace = null
    void window.api.storeDelete('workbench_lastActiveFilePath')
    await get().loadFileTree()
  },

  removeRecentWorkspace: (dirPath: string) => {
    // 默认工作区始终保留在最近列表中，不可移除
    if (dirPath === get().defaultWorkspacePath) return
    const nextRecent = get().recentWorkspaces.filter((p) => p !== dirPath)
    set({ recentWorkspaces: nextRecent })
    void window.api.storeSet('workbench_recentWorkspaces', nextRecent)
  },

  loadFileTree: async (options) => {
    const { workspacePath } = get()
    if (!workspacePath) return
    set({ isLoadingTree: true, error: null })
    try {
      const res = await window.api.workbench.readTree(workspacePath)
      if (res.success && res.data) {
        set({ fileTree: res.data, isLoadingTree: false })
        void get().loadWorkspaceTags()
        void get().loadWorkspaceLinks()
        // 应用关闭期间的外部删除/改名，在重新载入工作区时补齐。
        // 等对账返回再结束载入，恢复上次打开的文档才能拿到改名映射。
        const reconciled = await reconcileMindmaps(workspacePath, res.data)
        lastLoadTreeRelinks = reconciled?.relinks ?? []
        // 文件树变化后同步版本管理状态：外部改动、拉取、移动都会反映到这里
        if (!options?.skipGitStatus) {
          void get().refreshGitStatus()
        }
      } else {
        lastLoadTreeRelinks = []
        set({
          isLoadingTree: false,
          error: res.error || '读取文件目录失败'
        })
      }
    } catch (err) {
      lastLoadTreeRelinks = []
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

  openFile: async (
    relativePath: string,
    options?: {
      keepActiveOnMissing?: boolean
      preview?: boolean
      forcePermanent?: boolean
      insertTarget?: WorkbenchTabInsertTarget
    }
  ) => {
    const { workspacePath, activeFilePath, activeTabPath } = get()
    if (!workspacePath) return false
    if (activeFilePath === relativePath) {
      // 已是激活文件时：若本次要求常驻、转正或调整标签落位，确保标签同步并展开祖先目录
      const existing = get().openTabs.find((t) => t.path === relativePath)
      if (!existing || options?.insertTarget || (options?.forcePermanent && existing.isPreview)) {
        const synced = syncTabsOnOpen(
          get().openTabs,
          get().mruTabOrder,
          activeFilePath,
          activeTabPath,
          get().editorMode,
          relativePath,
          options
        )
        set({ openTabs: synced.openTabs, mruTabOrder: synced.mruTabOrder, activeTabPath: relativePath })
        persistWorkspaceTabs(workspacePath, synced.openTabs, relativePath)
      } else if (activeTabPath !== relativePath) {
        set({ activeTabPath: relativePath })
      }
      get().expandAncestorsOf(relativePath)
      return true
    }

    // 离开当前文件前确保可视化编辑确认、防抖同步、标注落盘与自动保存完成
    if (activeFilePath) {
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

      get().flushActiveEditorSync()
      const annotationFlush = await get().flushDocumentAnnotations()
      if (!annotationFlush.saved) {
        set({ error: annotationFlush.error || '标注同步未完成，无法安全切换文件' })
        return false
      }

      // 源码模式的既有行为：前一个文件有未保存改动时先落盘，再切换。
      if (get().isDirty) {
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
    }

    try {
      const res = await window.api.workbench.readFile(workspacePath, relativePath)
      if (res.success && res.data) {
        const oversizedForWysiwyg = res.data.size > 2 * 1024 * 1024
        const synced = syncTabsOnOpen(
          get().openTabs,
          get().mruTabOrder,
          activeFilePath,
          get().activeTabPath,
          get().editorMode,
          relativePath,
          options
        )
        const nextMode = oversizedForWysiwyg
          ? 'source'
          : (synced.restoredEditorMode ?? get().editorMode)
        set({
          ...buildActiveFilePayload(relativePath, res.data),
          activeTabPath: relativePath,
          openTabs: synced.openTabs,
          mruTabOrder: synced.mruTabOrder,
          error: null,
          // 2MB 以上固定源码模式；否则优先恢复该标签记忆的视图模式
          editorMode: nextMode
        })
        persistWorkspaceTabs(workspacePath, synced.openTabs, relativePath)
        void window.api.storeSet('workbench_lastActiveFilePath', relativePath)
        // 让侧边栏文件树能定位到该文件：展开所有祖先目录（id===path）。
        get().expandAncestorsOf(relativePath)
        void get().refreshGitBaseline()
        return true
      } else {
        // 恢复上次打开的文件时，文件可能已在应用外被删除：清掉失效的恢复点，
        // 回到“未打开文档”即可，不把 ENOENT 当成需要用户处理的错误弹出来。
        if (/\bENOENT\b/.test(res.error || '')) {
          if (options?.keepActiveOnMissing) {
            set({ error: `文件不存在: ${relativePath}` })
            return false
          }
          const remaining = get().openTabs.filter((t) => t.path !== relativePath)
          set({
            activeFilePath: null,
            activeTabPath: null,
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
            openTabs: remaining,
            mruTabOrder: get().mruTabOrder.filter((p) => p !== relativePath),
            error: null
          })
          set({
            gitBaselinePath: null,
            gitBaselineStatus: 'idle',
            gitBaselineSha: null,
            gitBaselineContent: null
          })
          persistWorkspaceTabs(workspacePath, remaining, null)
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
        const remaining = get().openTabs.filter((t) => t.path !== relativePath)
        set({
          activeFilePath: null,
          activeTabPath: null,
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
          openTabs: remaining,
          mruTabOrder: get().mruTabOrder.filter((p) => p !== relativePath),
          error: null
        })
        set({
          gitBaselinePath: null,
          gitBaselineStatus: 'idle',
          gitBaselineSha: null,
          gitBaselineContent: null
        })
        persistWorkspaceTabs(workspacePath, remaining, null)
        void window.api.storeDelete('workbench_lastActiveFilePath')
        return false
      }
      set({ error: `打开文件失败: ${msg}` })
      return false
    }
  },

  createNewTab: async () => {
    const { workspacePath, activeFilePath } = get()
    if (!workspacePath) return
    if (activeFilePath) {
      if (get().htmlVisualEditing) {
        const leaveGuard = get().htmlEditLeaveGuard
        if (!leaveGuard) {
          set({ error: '可视化编辑尚未就绪，无法新建标签页' })
          return
        }
        const decision = await leaveGuard()
        if (decision === 'cancelled') return
      }
      get().flushActiveEditorSync()
      const annotationFlush = await get().flushDocumentAnnotations()
      if (!annotationFlush.saved) {
        set({ error: annotationFlush.error || '标注同步未完成，无法安全新建标签页' })
        return
      }
      if (get().isDirty) {
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer)
          autoSaveTimer = null
        }
        const saved = await get().saveActiveFile()
        if (!saved.saved) {
          set({ error: '当前文件保存未完成，无法安全新建标签页' })
          return
        }
      }
    }

    const tabPath = `${WORKBENCH_NEW_TAB_PREFIX}${++newTabSeq}`
    const prevEditorMode = get().editorMode
    const baseTabs = get().openTabs.map((t) =>
      activeFilePath && t.path === activeFilePath ? { ...t, editorMode: prevEditorMode } : t
    )
    const nextTabs = orderPinnedTabs([
      ...baseTabs,
      { path: tabPath, isPinned: false, isPreview: false }
    ])
    const nextMru = [tabPath, ...get().mruTabOrder.filter((p) => p !== tabPath)]
    set({
      openTabs: nextTabs,
      mruTabOrder: nextMru,
      activeTabPath: tabPath,
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
      gitBaselinePath: null,
      gitBaselineStatus: 'idle',
      gitBaselineSha: null,
      gitBaselineContent: null,
      error: null
    })
  },

  activateTab: async (tabPath: string) => {
    if (!isNewTabPath(tabPath)) {
      return get().openFile(tabPath)
    }
    const { workspacePath, activeTabPath, activeFilePath, openTabs } = get()
    if (!workspacePath || !openTabs.some((t) => t.path === tabPath)) return false
    if (activeTabPath === tabPath) return true

    if (activeFilePath) {
      if (get().htmlVisualEditing) {
        const leaveGuard = get().htmlEditLeaveGuard
        if (!leaveGuard) {
          set({ error: '可视化编辑尚未就绪，无法切换标签页' })
          return false
        }
        const decision = await leaveGuard()
        if (decision === 'cancelled') return false
      }
      get().flushActiveEditorSync()
      const annotationFlush = await get().flushDocumentAnnotations()
      if (!annotationFlush.saved) {
        set({ error: annotationFlush.error || '标注同步未完成，无法安全切换标签页' })
        return false
      }
      if (get().isDirty) {
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer)
          autoSaveTimer = null
        }
        const saved = await get().saveActiveFile()
        if (!saved.saved) {
          set({ error: '当前文件保存未完成，无法安全切换标签页' })
          return false
        }
      }
    }

    const prevEditorMode = get().editorMode
    const syncedTabs = get().openTabs.map((t) =>
      activeFilePath && t.path === activeFilePath ? { ...t, editorMode: prevEditorMode } : t
    )
    const nextMru = [tabPath, ...get().mruTabOrder.filter((p) => p !== tabPath)]
    set({
      openTabs: syncedTabs,
      mruTabOrder: nextMru,
      activeTabPath: tabPath,
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
      gitBaselinePath: null,
      gitBaselineStatus: 'idle',
      gitBaselineSha: null,
      gitBaselineContent: null,
      error: null
    })
    return true
  },

  createUntitledNote: async () => {
    const { openTabs, fileTree } = get()
    const taken = new Set<string>(openTabs.map((t) => t.path))
    for (const node of fileTree) {
      if (!node.isDirectory) taken.add(node.path)
    }
    let name = '未命名笔记.md'
    if (taken.has(name)) {
      let index = 2
      while (taken.has(`未命名笔记-${index}.md`)) {
        index += 1
      }
      name = `未命名笔记-${index}.md`
    }
    return get().createFile('', name)
  },

  setQuickOpenOpen: (open: boolean) => set({ isQuickOpenOpen: open }),

  promoteTab: (relativePath: string) => {
    const { openTabs, workspacePath, activeFilePath } = get()
    const target = openTabs.find((t) => t.path === relativePath)
    if (!target || !target.isPreview) return
    const nextTabs = openTabs.map((t) =>
      t.path === relativePath ? { ...t, isPreview: false } : t
    )
    set({ openTabs: nextTabs })
    persistWorkspaceTabs(workspacePath, nextTabs, activeFilePath)
  },

  togglePinTab: (relativePath: string) => {
    const { openTabs, workspacePath, activeFilePath } = get()
    const target = openTabs.find((t) => t.path === relativePath)
    if (!target) return
    const nextPinned = !target.isPinned
    const updated = openTabs.map((t) =>
      t.path === relativePath
        ? { ...t, isPinned: nextPinned, isPreview: nextPinned ? false : t.isPreview }
        : t
    )
    const ordered = orderPinnedTabs(updated)
    set({ openTabs: ordered })
    persistWorkspaceTabs(workspacePath, ordered, activeFilePath)
  },

  reorderTabs: (fromPath: string, toPath: string) => {
    if (fromPath === toPath) return
    const { openTabs, workspacePath, activeFilePath } = get()
    const srcIdx = openTabs.findIndex((t) => t.path === fromPath)
    const dstIdx = openTabs.findIndex((t) => t.path === toPath)
    if (srcIdx === -1 || dstIdx === -1) return
    // 固定区与普通区隔离排序
    if (openTabs[srcIdx].isPinned !== openTabs[dstIdx].isPinned) return
    const next = [...openTabs]
    const [moved] = next.splice(srcIdx, 1)
    next.splice(dstIdx, 0, moved)
    set({ openTabs: next })
    persistWorkspaceTabs(workspacePath, next, activeFilePath)
  },

  closeTab: async (relativePath: string, options?: { force?: boolean }) => {
    const { workspacePath, activeFilePath, activeTabPath, openTabs, mruTabOrder, closedTabHistory } = get()
    const closedIdx = openTabs.findIndex((t) => t.path === relativePath)
    if (closedIdx === -1) return 'closed'

    const isVirtualNewTab = isNewTabPath(relativePath)
    const closingActive = activeTabPath === relativePath
    if (closingActive && !isVirtualNewTab && activeFilePath) {
      if (!options?.force && get().saveStatus === 'conflict') {
        return 'needs-confirm'
      }
      if (get().htmlVisualEditing) {
        const leaveGuard = get().htmlEditLeaveGuard
        if (!leaveGuard) {
          set({ error: '可视化编辑尚未就绪，无法关闭标签页' })
          return 'cancelled'
        }
        const decision = await leaveGuard()
        if (decision === 'cancelled') return 'cancelled'
      }
      get().flushActiveEditorSync()
      const annotationFlush = await get().flushDocumentAnnotations()
      if (!annotationFlush.saved && !options?.force) {
        set({ error: annotationFlush.error || '标注同步未完成，无法安全关闭标签页' })
        return 'cancelled'
      }
      if (get().isDirty && !options?.force) {
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer)
          autoSaveTimer = null
        }
        if (get().saveStatus === 'conflict') return 'needs-confirm'
        const saved = await get().saveActiveFile()
        if (!saved.saved) return 'needs-confirm'
      }
    }

    const nextTabs = openTabs.filter((t) => t.path !== relativePath)
    const nextMru = mruTabOrder.filter((p) => p !== relativePath)
    const nextClosed = isVirtualNewTab
      ? closedTabHistory
      : [relativePath, ...closedTabHistory.filter((p) => p !== relativePath)].slice(0, 20)

    set({
      openTabs: nextTabs,
      mruTabOrder: nextMru,
      closedTabHistory: nextClosed
    })

    if (closingActive) {
      const nextPath = pickFallbackTabPath(nextTabs, nextMru, closedIdx)
      if (nextPath) {
        // 清空当前脏状态再切走，避免 openFile/activateTab 再次保存刚关闭的文件
        set({ isDirty: false, saveStatus: 'saved', conflictDiskContent: null })
        const opened = await get().activateTab(nextPath)
        if (opened) return 'closed'
      }
      set({
        activeFilePath: null,
        activeTabPath: null,
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
        gitBaselinePath: null,
        gitBaselineStatus: 'idle',
        gitBaselineSha: null,
        gitBaselineContent: null
      })
      persistWorkspaceTabs(workspacePath, nextTabs, null)
      void window.api.storeDelete('workbench_lastActiveFilePath')
    } else {
      persistWorkspaceTabs(workspacePath, nextTabs, activeTabPath)
    }
    return 'closed'
  },

  closeOtherTabs: async (keepPath: string) => {
    const { openTabs, activeTabPath } = get()
    const toClose = openTabs.filter((t) => t.path !== keepPath && !t.isPinned).map((t) => t.path)
    if (!toClose.length) return
    if (activeTabPath !== keepPath) {
      const ok = await get().activateTab(keepPath)
      if (!ok) return
    }
    const remaining = get().openTabs.filter((t) => t.path === keepPath || t.isPinned)
    const closedFiles = toClose.filter((p) => !isNewTabPath(p))
    const nextClosed = [
      ...closedFiles.reverse(),
      ...get().closedTabHistory.filter((p) => !toClose.includes(p))
    ].slice(0, 20)
    set({
      openTabs: remaining,
      mruTabOrder: get().mruTabOrder.filter((p) => remaining.some((t) => t.path === p)),
      closedTabHistory: nextClosed
    })
    persistWorkspaceTabs(get().workspacePath, remaining, get().activeTabPath)
  },

  closeRightTabs: async (fromPath: string) => {
    const { openTabs, activeTabPath } = get()
    const idx = openTabs.findIndex((t) => t.path === fromPath)
    if (idx === -1) return
    const rightPaths = openTabs
      .slice(idx + 1)
      .filter((t) => !t.isPinned)
      .map((t) => t.path)
    if (!rightPaths.length) return
    if (activeTabPath && rightPaths.includes(activeTabPath)) {
      const ok = await get().activateTab(fromPath)
      if (!ok) return
    }
    const rightSet = new Set(rightPaths)
    const remaining = get().openTabs.filter((t) => !rightSet.has(t.path))
    const closedFiles = rightPaths.filter((p) => !isNewTabPath(p))
    const nextClosed = [
      ...closedFiles.reverse(),
      ...get().closedTabHistory.filter((p) => !rightSet.has(p))
    ].slice(0, 20)
    set({
      openTabs: remaining,
      mruTabOrder: get().mruTabOrder.filter((p) => !rightSet.has(p)),
      closedTabHistory: nextClosed
    })
    persistWorkspaceTabs(get().workspacePath, remaining, get().activeTabPath)
  },

  closeSavedTabs: async () => {
    const { openTabs, activeFilePath, activeTabPath, isDirty } = get()
    const keepActiveBecauseDirty = Boolean(activeFilePath && isDirty)
    const toClose = openTabs
      .filter((t) => !t.isPinned && !(keepActiveBecauseDirty && t.path === activeTabPath))
      .map((t) => t.path)
    if (!toClose.length) return
    for (const path of toClose) {
      const res = await get().closeTab(path)
      if (res === 'cancelled') break
    }
  },

  closeAllTabs: async () => {
    const { openTabs } = get()
    const targets = openTabs.filter((t) => !t.isPinned).map((t) => t.path)
    for (const path of targets) {
      const res = await get().closeTab(path)
      if (res === 'cancelled' || res === 'needs-confirm') break
    }
  },

  reopenLastClosedTab: async () => {
    const { workspacePath, closedTabHistory, fileTree } = get()
    if (!workspacePath || !closedTabHistory.length) return false
    const validPaths = collectTreePaths(fileTree, new Set<string>())
    const nextHistory = [...closedTabHistory]
    while (nextHistory.length > 0) {
      const candidate = nextHistory.shift()!
      if (!validPaths.has(candidate)) continue
      set({ closedTabHistory: nextHistory })
      return get().openFile(candidate, { forcePermanent: true })
    }
    set({ closedTabHistory: [] })
    return false
  },

  saveActiveFile: async () => {
    // 富文本模式可能存在 250ms 防抖同步窗口，保存前先同步冲刷为最新 activeFileContent
    get().flushActiveEditorSync()

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
          void window.api.workbench.extractFileTags(workspacePath, activeFilePath, content)
            .then((tagRes) => {
              if (tagRes.success && tagRes.data && get().workspacePath === workspacePath) {
                set({ workspaceTags: tagRes.data })
              }
            })
            .catch(() => undefined)
          // 双链快照同标签走增量更新；内存里是刚写盘的内容，直接交给主进程抽取
          void window.api.workbench.extractFileLinks(workspacePath, activeFilePath, content)
            .then((linkRes) => {
              if (linkRes.success && linkRes.data && get().workspacePath === workspacePath) {
                set({ workspaceLinks: linkRes.data })
              }
            })
            .catch(() => undefined)
        }
        // 保存后文件树 M 徽标与编辑器标记需与磁盘一致；去抖合并连续保存
        if (gitStatusRefreshTimer) clearTimeout(gitStatusRefreshTimer)
        gitStatusRefreshTimer = setTimeout(() => {
          gitStatusRefreshTimer = null
          void get().refreshGitStatus()
        }, 1000)
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

  setMarkdownSyncFlusher: (flusher) => set({ markdownSyncFlusher: flusher }),

  flushMarkdownSync: () => {
    const flusher = get().markdownSyncFlusher
    if (!flusher) return
    try {
      flusher()
    } catch { /* noop */ }
  },

  markMarkdownPendingSync: () => {
    if (!get().isDirty) set({ isDirty: true })
  },

  setSourceSyncFlusher: (flusher) => set({ sourceSyncFlusher: flusher }),

  flushSourceSync: () => {
    const flusher = get().sourceSyncFlusher
    if (!flusher) return
    try {
      flusher()
    } catch { /* noop */ }
  },

  markSourcePendingSync: () => {
    if (!get().isDirty) set({ isDirty: true })
  },

  flushActiveEditorSync: () => {
    get().flushMarkdownSync()
    get().flushSourceSync()
  },

  updateActiveContent: (content: string) => {
    const { activeFilePath, openTabs, workspacePath } = get()
    const activeTab = activeFilePath ? openTabs.find((t) => t.path === activeFilePath) : null
    if (activeTab?.isPreview) {
      const nextTabs = openTabs.map((t) =>
        t.path === activeFilePath ? { ...t, isPreview: false } : t
      )
      set({
        activeFileContent: content,
        isDirty: true,
        openTabs: nextTabs
      })
      persistWorkspaceTabs(workspacePath, nextTabs, activeFilePath)
    } else {
      set({
        activeFileContent: content,
        isDirty: true
      })
    }

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

  setCodePreviewEditable: (editable) => set({ codePreviewEditable: editable }),

  setHtmlRenderSurface: (render) => set({ htmlRenderSurface: render }),

  markActiveFileDirty: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    const { activeFilePath, openTabs, workspacePath } = get()
    const activeTab = activeFilePath ? openTabs.find((t) => t.path === activeFilePath) : null
    if (activeTab?.isPreview) {
      const nextTabs = openTabs.map((t) =>
        t.path === activeFilePath ? { ...t, isPreview: false } : t
      )
      set({ isDirty: true, openTabs: nextTabs })
      persistWorkspaceTabs(workspacePath, nextTabs, activeFilePath)
    } else if (!get().isDirty) {
      set({ isDirty: true })
    }
  },

  unmarkActiveFileDirty: () => {
    if (get().isDirty) set({ isDirty: false })
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
    if (oldRelativePath === newRelativePath) return true

    const hitsActive =
      !!activeFilePath &&
      (activeFilePath === oldRelativePath || activeFilePath.startsWith(`${oldRelativePath}/`))

    if (hitsActive) {
      // 可视化编辑的未保存改动先交由用户决定保存或放弃，避免重命名重建预览后静默丢失
      if (get().htmlVisualEditing) {
        const leaveGuard = get().htmlEditLeaveGuard
        if (!leaveGuard) {
          set({ error: '可视化编辑尚未就绪，无法重命名当前文件' })
          return false
        }
        const decision = await leaveGuard()
        if (decision === 'cancelled') return false
      }

      get().flushActiveEditorSync()
      const annotationFlush = await get().flushDocumentAnnotations()
      if (!annotationFlush.saved) {
        set({ error: annotationFlush.error || '标注同步未完成，无法安全重命名' })
        return false
      }

      if (get().isDirty) {
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer)
          autoSaveTimer = null
        }
        const saved = await get().saveActiveFile()
        if (!saved.saved) {
          set({ error: '当前文件保存未完成，无法安全重命名' })
          return false
        }
      }
    }

    try {
      const res = await window.api.workbench.renameNode(workspacePath, oldRelativePath, newRelativePath)
      if (res.success) {
        // 若重命名的是目录，同步迁移已展开文件夹集合，避免树折叠
        const prevExpanded = get().expandedFolderIds
        let nextExpanded: Set<string> | null = null
        for (const id of prevExpanded) {
          if (id === oldRelativePath || id.startsWith(`${oldRelativePath}/`)) {
            if (!nextExpanded) nextExpanded = new Set(prevExpanded)
            nextExpanded.delete(id)
            nextExpanded.add(newRelativePath + id.slice(oldRelativePath.length))
          }
        }
        if (nextExpanded) {
          set({ expandedFolderIds: nextExpanded })
        }

        // 同步重命名所有受影响的标签页、MRU 与关闭恢复栈
        const prevTabs = get().openTabs
        const remappedTabs = dedupeTabsByPath(
          prevTabs.map((t) => ({
            ...t,
            path: remapPathPrefix(t.path, oldRelativePath, newRelativePath)
          }))
        )
        const remappedMru = get()
          .mruTabOrder.map((p) => remapPathPrefix(p, oldRelativePath, newRelativePath))
          .filter((p, i, arr) => arr.indexOf(p) === i)
        const remappedClosed = get()
          .closedTabHistory.map((p) => remapPathPrefix(p, oldRelativePath, newRelativePath))
          .filter((p, i, arr) => arr.indexOf(p) === i)

        const currentActive = get().activeFilePath
        const nextActivePath =
          currentActive === oldRelativePath
            ? newRelativePath
            : currentActive && currentActive.startsWith(`${oldRelativePath}/`)
              ? newRelativePath + currentActive.slice(oldRelativePath.length)
              : null

        set({
          openTabs: remappedTabs,
          mruTabOrder: remappedMru,
          closedTabHistory: remappedClosed
        })
        persistWorkspaceTabs(workspacePath, remappedTabs, nextActivePath ?? currentActive)

        if (nextActivePath) {
          set({ activeTabPath: nextActivePath })
          // 重新读取新路径的完整元数据与 URL（HTML/图片依赖 activeFileUrl，改扩展名需同步 category，
          // .md 可能被主进程替换 assets/ 路径），在一次 set 内原子更新避免预览加载旧路径。
          let refreshed = false
          try {
            const fileRes = await window.api.workbench.readFile(workspacePath, nextActivePath)
            if (fileRes.success && fileRes.data) {
              set(buildActiveFilePayload(nextActivePath, fileRes.data))
              refreshed = true
            }
          } catch { /* noop：读失败时退回最小路径同步 */ }

          if (!refreshed) {
            set({
              activeFilePath: nextActivePath,
              activeFileCategory: getFileCategory(nextActivePath),
              activeFileUrl: null,
              activeFileDataUrl: null
            })
          }
          void window.api.storeSet('workbench_lastActiveFilePath', nextActivePath)
          void get().refreshGitBaseline()
        }
        // loadFileTree 内部已刷新 Git 状态与工作区标签
        await get().loadFileTree()
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
        activeTabPath: null,
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
      set({
        gitBaselinePath: null,
        gitBaselineStatus: 'idle',
        gitBaselineSha: null,
        gitBaselineContent: null
      })
      void window.api.storeDelete('workbench_lastActiveFilePath')
    }

    try {
      const res = await window.api.workbench.deleteNode(workspacePath, relativePath)
      if (res.success) {
        const remainingTabs = get().openTabs.filter((t) => !isUnderAnyPath(t.path, deletedPaths))
        const nextMru = get().mruTabOrder.filter((p) => !isUnderAnyPath(p, deletedPaths))
        const nextClosed = get().closedTabHistory.filter((p) => !isUnderAnyPath(p, deletedPaths))
        set({
          openTabs: remainingTabs,
          mruTabOrder: nextMru,
          closedTabHistory: nextClosed
        })
        await get().loadFileTree()
        // 当前文件被删时优先切到剩余打开标签，其次相邻文件；无任何文件则停在空状态
        const tabFallback = hitsActive ? pickFallbackTabPath(remainingTabs, nextMru) : null
        const targetNext = tabFallback || nextFilePath
        if (targetNext) {
          const opened = await get().activateTab(targetNext)
          if (!opened) void window.api.storeDelete('workbench_lastActiveFilePath')
        } else if (hitsActive) {
          persistWorkspaceTabs(workspacePath, remainingTabs, null)
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
    const { activeFilePath, activeFileCategory, editorMode } = get()
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
    get().flushActiveEditorSync()
    if (get().isDirty) {
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

  findWorkspaceUnreferencedImages: async () => {
    const { workspacePath } = get()
    if (!workspacePath) return null
    // 扫描前先把当前编辑中的改动落盘，避免刚粘贴的图片被误判为未引用
    get().flushActiveEditorSync()
    if (get().isDirty) {
      await get().saveActiveFile()
    }
    try {
      const res = await window.api.workbench.findWorkspaceUnreferencedImages(workspacePath)
      if (!res.success) {
        if (res.error) set({ error: res.error })
        return null
      }
      return res.data ?? null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `扫描未引用图片失败: ${msg}` })
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
        activeTabPath: null,
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
      set({
        gitBaselinePath: null,
        gitBaselineStatus: 'idle',
        gitBaselineSha: null,
        gitBaselineContent: null
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

      const deletedSuccessful = targets.filter((t) => !failedPaths.includes(t))
      if (deletedSuccessful.length) {
        const remainingTabs = get().openTabs.filter((t) => !isUnderAnyPath(t.path, deletedSuccessful))
        const nextMru = get().mruTabOrder.filter((p) => !isUnderAnyPath(p, deletedSuccessful))
        const nextClosed = get().closedTabHistory.filter((p) => !isUnderAnyPath(p, deletedSuccessful))
        set({
          openTabs: remainingTabs,
          mruTabOrder: nextMru,
          closedTabHistory: nextClosed
        })
      }

      await get().loadFileTree()
      if (hitsActive && !get().activeFilePath) {
        const tabFallback = pickFallbackTabPath(get().openTabs, get().mruTabOrder)
        const targetNext = tabFallback || nextFilePath
        if (targetNext) {
          const opened = await get().activateTab(targetNext)
          if (!opened) void window.api.storeDelete('workbench_lastActiveFilePath')
        } else {
          persistWorkspaceTabs(workspacePath, get().openTabs, null)
        }
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
    const { workspacePath, activeFilePath } = get()
    if (!workspacePath || !targetWorkspaceRoot || !relativePaths.length) return null
    const hitsActive = !!activeFilePath && relativePaths.some(p =>
      activeFilePath === p || activeFilePath.startsWith(`${p}/`))
    if (hitsActive) {
      get().flushActiveEditorSync()
      if (get().isDirty) {
        const saved = await get().saveActiveFile()
        if (!saved.saved) {
          set({ error: '当前文件保存未完成，无法移动到其他工作区' })
          return null
        }
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
          activeTabPath: null,
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
        set({
          gitBaselinePath: null,
          gitBaselineStatus: 'idle',
          gitBaselineSha: null,
          gitBaselineContent: null
        })
        void window.api.storeDelete('workbench_lastActiveFilePath')
      }
      if (res.data.moved.length) {
        const movedSources = res.data.moved.map((m) => m.source)
        const remainingTabs = get().openTabs.filter((t) => !isUnderAnyPath(t.path, movedSources))
        const nextMru = get().mruTabOrder.filter((p) => !isUnderAnyPath(p, movedSources))
        const nextClosed = get().closedTabHistory.filter((p) => !isUnderAnyPath(p, movedSources))
        set({
          openTabs: remainingTabs,
          mruTabOrder: nextMru,
          closedTabHistory: nextClosed
        })
        if (hitsActive) {
          const tabFallback = pickFallbackTabPath(remainingTabs, nextMru)
          if (tabFallback) {
            void get().activateTab(tabFallback)
          } else {
            persistWorkspaceTabs(workspacePath, remainingTabs, null)
          }
        } else {
          persistWorkspaceTabs(workspacePath, remainingTabs, get().activeTabPath)
        }
      }
      await get().loadFileTree()
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
    const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const currentWorkspace = get().workspacePath
    if (!currentWorkspace || normalize(workspaceRoot) !== normalize(currentWorkspace)) return

    if (externalFsInFlight) {
      externalFsPendingWorkspace = workspaceRoot
      return
    }

    externalFsInFlight = true
    try {
      let targetRoot: string | null = workspaceRoot
      while (targetRoot) {
        externalFsPendingWorkspace = null
        const activeRoot = get().workspacePath
        if (!activeRoot || normalize(targetRoot) !== normalize(activeRoot)) break

        const res = await window.api.workbench.readTree(activeRoot)
        if (!res.success || !res.data || get().workspacePath !== activeRoot) break

        // 外部改动（终端、其他编辑器）同样会改变 Git 状态与索引基准
        void get().refreshGitStatus()
        void get().refreshGitBaseline()

        const nextTree = res.data
        const previousTree = get().fileTree
        set({ fileTree: nextTree })

        // 外部增删改会让双链快照缓存作废重扫；随文件树一起静默刷新
        void get().loadWorkspaceLinks()

        const reconciled = await reconcileMindmaps(activeRoot, nextTree)
        if (get().workspacePath !== activeRoot) break

        await reconcileActiveFileWithTree(activeRoot, previousTree, nextTree, reconciled?.relinks ?? [])
        targetRoot = externalFsPendingWorkspace
      }
    } finally {
      externalFsInFlight = false
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

  loadWorkspaceLinks: async () => {
    const { workspacePath } = get()
    if (!workspacePath) {
      set({ workspaceLinks: [] })
      return
    }
    try {
      const res = await window.api.workbench.getWorkspaceLinks(workspacePath)
      if (res.success && res.data && get().workspacePath === workspacePath) {
        set({ workspaceLinks: res.data })
      }
    } catch (err) {
      console.error('[workbenchStore] loadWorkspaceLinks failed:', err)
    }
  },

  setFileSort: (pref: WorkbenchSortPreference) => {
    set({ fileSort: pref })
    void window.api.storeSet('workbench_fileSort', pref)
  },

  setLeftPaneWidth: (width: number, persist = true) => {
    const winW = typeof window === 'undefined' ? 1400 : window.innerWidth
    const state = get()
    const minLeft = state.leftPaneMinWidth
    const hasRight = !!state.rightPane || state.isAiSidebar2Open
    const rightReserve = hasRight
      ? (state.isAiSidebar2Open ? RIGHT_PANE_DUAL_MIN : RIGHT_PANE_MIN)
      : 0
    const maxLeftAllowed = Math.max(minLeft, winW - WORKBENCH_MIN_EDITOR_WIDTH - rightReserve - 10)
    const clamped = Math.max(minLeft, Math.min(480, Math.min(maxLeftAllowed, width)))
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

  setLeftPaneMinWidth: (minWidth: number) => {
    const resolvedMin = Math.max(
      WORKBENCH_BASE_MIN_LEFT_WIDTH,
      Math.min(480, Math.ceil(minWidth))
    )
    const state = get()
    if (state.leftPaneMinWidth === resolvedMin && state.leftPaneWidth >= resolvedMin) {
      return
    }
    const nextState: Partial<WorkbenchStoreState> = { leftPaneMinWidth: resolvedMin }
    if (state.leftPaneWidth < resolvedMin) {
      const winW = typeof window === 'undefined' ? 1400 : window.innerWidth
      const hasRight = !!state.rightPane || state.isAiSidebar2Open
      const rightReserve = hasRight
        ? (state.isAiSidebar2Open ? RIGHT_PANE_DUAL_MIN : RIGHT_PANE_MIN)
        : 0
      const maxLeftAllowed = Math.max(
        resolvedMin,
        winW - WORKBENCH_MIN_EDITOR_WIDTH - rightReserve - 10
      )
      const bumpedLeft = Math.min(480, Math.min(maxLeftAllowed, resolvedMin))
      nextState.leftPaneWidth = bumpedLeft
      if (hasRight && !state.isLeftCollapsed) {
        const clampedRight = clampRightPaneWidth(
          state.rightPaneWidth,
          winW,
          bumpedLeft,
          false,
          state.isAiSidebar2Open
        )
        if (clampedRight !== state.rightPaneWidth) {
          nextState.rightPaneWidth = clampedRight
        }
      }
    }
    set(nextState)
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
      const minLeft = state.leftPaneMinWidth
      const hasRight = !!state.rightPane || state.isAiSidebar2Open
      const rightReserve = hasRight
        ? (state.isAiSidebar2Open ? RIGHT_PANE_DUAL_MIN : RIGHT_PANE_MIN)
        : 0
      const maxLeftAllowed = Math.max(minLeft, winW - WORKBENCH_MIN_EDITOR_WIDTH - rightReserve - 10)
      const clampedLeft = Math.max(minLeft, Math.min(480, Math.min(maxLeftAllowed, state.leftPaneWidth)))
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
    const minLeft = state.leftPaneMinWidth
    if (!state.isLeftCollapsed && winW >= minLeft + WORKBENCH_MIN_EDITOR_WIDTH + RIGHT_PANE_DUAL_MIN + 10) {
      const maxLeft = Math.max(minLeft, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
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
    const minLeft = state.leftPaneMinWidth
    if (!state.isLeftCollapsed && winW >= minLeft + WORKBENCH_MIN_EDITOR_WIDTH + RIGHT_PANE_DUAL_MIN + 10) {
      const maxLeft = Math.max(minLeft, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
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
    if (get().editorMode !== mode) {
      get().flushActiveEditorSync()
    }
    // 2MB 以上文档固定源码模式：Lexical 整篇导入会卡死，且标注也无法安全映射。
    const size = get().activeFileSize ?? 0
    if (mode === 'wysiwyg' && size > 2 * 1024 * 1024) {
      set({ editorMode: 'source' })
      void window.api.storeSet('workbench_editorMode', 'source')
      return
    }
    set({ editorMode: mode })
    const activePath = get().activeFilePath
    if (activePath) {
      const nextTabs = get().openTabs.map((t) =>
        t.path === activePath ? { ...t, editorMode: mode } : t
      )
      set({ openTabs: nextTabs })
      persistWorkspaceTabs(get().workspacePath, nextTabs, activePath)
    }
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

  setMarkdownBackgroundTheme: (theme: ReaderBackgroundTheme) => {
    set({ markdownBackgroundTheme: theme })
    void window.api.storeSet('workbench_markdownBgTheme', theme)
  },

  setPdfBackgroundTheme: (theme: ReaderBackgroundTheme) => {
    set({ pdfBackgroundTheme: theme })
    void window.api.storeSet('workbench_pdfBgTheme', theme)
  },

  setDocxBackgroundTheme: (theme: ReaderBackgroundTheme) => {
    set({ docxBackgroundTheme: theme })
    void window.api.storeSet('workbench_docxBgTheme', theme)
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
    lastGitRefreshAt = Date.now()
    try {
      do {
        gitStatusPending = false
        lastGitRefreshAt = Date.now()
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
   * 拉取当前活动文件的 Git Index 基准内容（支持 in-flight 合并与 knownBlobSha 短路）。
   * 仅保留单份缓存：非文本/未跟踪/超大/非仓库统一置空，
   * 切换工作区或文件后由 openFile / 清理逻辑重新触发。
   */
  refreshGitBaseline: async () => {
    const isTextCategory = (category: WorkbenchFileCategory | null): boolean =>
      category === 'markdown' || category === 'code' || category === 'text'

    const { workspacePath, activeFilePath, activeFileCategory } = get()
    if (!workspacePath || !activeFilePath || !isTextCategory(activeFileCategory)) {
      ++gitBaselineSeq
      gitBaselinePending = false
      set({
        gitBaselinePath: null,
        gitBaselineStatus: 'idle',
        gitBaselineSha: null,
        gitBaselineContent: null
      })
      return
    }

    if (gitBaselinePromise) {
      gitBaselinePending = true
      if (get().gitBaselinePath !== activeFilePath) {
        set({
          gitBaselinePath: activeFilePath,
          gitBaselineStatus: 'loading',
          gitBaselineSha: null,
          gitBaselineContent: null
        })
      }
      return gitBaselinePromise
    }

    const seq = ++gitBaselineSeq
    const run = (async () => {
      try {
        do {
          gitBaselinePending = false
          const state = get()
          const targetWorkspace = state.workspacePath
          const targetPath = state.activeFilePath
          const targetCategory = state.activeFileCategory
          if (!targetWorkspace || !targetPath || !isTextCategory(targetCategory)) {
            if (seq === gitBaselineSeq) {
              set({
                gitBaselinePath: null,
                gitBaselineStatus: 'idle',
                gitBaselineSha: null,
                gitBaselineContent: null
              })
            }
            break
          }

          const hasReusableCache =
            state.gitBaselinePath === targetPath &&
            !!state.gitBaselineSha &&
            ((state.gitBaselineStatus === 'ok' && typeof state.gitBaselineContent === 'string') ||
              state.gitBaselineStatus === 'binary' ||
              state.gitBaselineStatus === 'too-large')

          const knownBlobSha = hasReusableCache ? (state.gitBaselineSha ?? undefined) : undefined
          if (!hasReusableCache) {
            set({
              gitBaselineStatus: 'loading',
              gitBaselinePath: targetPath,
              gitBaselineSha: null,
              gitBaselineContent: null
            })
          }

          try {
            const res = await window.api.workbench.gitBaseline(targetWorkspace, targetPath, knownBlobSha)
            // 请求期间已切走工作区或文件：丢弃过期结果，若后续有 pending 会由循环补拉
            if (seq !== gitBaselineSeq || get().workspacePath !== targetWorkspace || get().activeFilePath !== targetPath) {
              continue
            }
            if (!res.success || !res.data) {
              set({ gitBaselinePath: targetPath, gitBaselineStatus: 'error', gitBaselineSha: null, gitBaselineContent: null })
              continue
            }
            const data = res.data
            if (data.status === 'unchanged') {
              // SHA 一致且本地仍持有有效基线：保持现有 gitBaselineContent / gitBaselineStatus / gitBaselineSha 不变
              continue
            }
            if (data.status === 'ok' && typeof data.content === 'string') {
              // 与磁盘保存内容一致归一化：基准 CRLF→LF，避免与编辑器文本产生纯换行差异
              const content = data.content.replace(/\r\n?/g, '\n')
              set({
                gitBaselinePath: targetPath,
                gitBaselineStatus: 'ok',
                gitBaselineSha: data.blobSha ?? null,
                gitBaselineContent: content
              })
            } else {
              set({
                gitBaselinePath: targetPath,
                gitBaselineStatus: data.status,
                gitBaselineSha: data.blobSha ?? null,
                gitBaselineContent: null
              })
            }
          } catch {
            if (seq === gitBaselineSeq && get().workspacePath === targetWorkspace && get().activeFilePath === targetPath) {
              set({ gitBaselinePath: targetPath, gitBaselineStatus: 'error', gitBaselineSha: null, gitBaselineContent: null })
            }
          }
        } while (gitBaselinePending)
      } finally {
        gitBaselinePromise = null
      }
    })()

    gitBaselinePromise = run
    return run
  },

  /**
   * 提交前先落盘当前编辑内容：否则自动保存会在提交后用旧内容覆盖，出现“提交了但文件又变脏”。
   * 只提交工作区范围，未暂存的改动会一并纳入，与界面上“全部改动”的表述一致。
   */
  gitCommit: async (title, body, allowLargeFiles) => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      get().flushActiveEditorSync()
      if (get().isDirty) {
        const saved = await get().saveActiveFile()
        if (!saved.saved) return { success: false, failure: 'failed', error: '当前文件保存失败，未提交' }
      }
      const res = await window.api.workbench.gitCommit(workspacePath, title, body, allowLargeFiles)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '提交失败' }
      await get().refreshGitStatus()
      if (result.success) await get().refreshGitBaseline()
      if (result.success) {
        get().clearGitNotice()
      } else {
        get().setGitNotice({ tone: 'error', message: result.error || '提交失败' })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
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
        // 远程改动可能重命名/删除了当前打开的文档，单次扫树后按磁盘状态对齐编辑器（不重复调 handleExternalFsChanged 二次扫盘）
        const previousTree = get().fileTree
        await get().loadFileTree({ skipGitStatus: true })
        await reconcileActiveFileWithTree(workspacePath, previousTree, get().fileTree, lastLoadTreeRelinks, { skipBaselineRefresh: true })
      }
      await get().refreshGitStatus()
      if (result.success) await get().refreshGitBaseline()
      get().setGitNotice(
        result.success
          ? { tone: 'success', message: result.hint ?? '已拉取远程改动' }
          : { tone: 'warning', message: result.hint ? `${result.error}：${result.hint}` : result.error || '拉取失败' }
      )
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
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
        const previousTree = get().fileTree
        await get().loadFileTree({ skipGitStatus: true })
        await reconcileActiveFileWithTree(workspacePath, previousTree, get().fileTree, lastLoadTreeRelinks, { skipBaselineRefresh: true })
      }
      await get().refreshGitStatus()
      if (result.success) await get().refreshGitBaseline()
      get().setGitNotice(
        result.success
          ? { tone: 'success', message: '已合并远程改动' }
          : { tone: 'warning', message: result.hint ? `${result.error}：${result.hint}` : result.error || '合并失败' }
      )
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
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
        const previousTree = get().fileTree
        await get().loadFileTree({ skipGitStatus: true })
        await reconcileActiveFileWithTree(workspacePath, previousTree, get().fileTree, lastLoadTreeRelinks, { skipBaselineRefresh: true })
      }
      await get().refreshGitStatus()
      if (result.success) await get().refreshGitBaseline()
      get().setGitNotice(
        result.success
          ? { tone: 'info', message: '已撤销本次合并，文件回到操作前状态' }
          : { tone: 'error', message: result.error || '撤销失败' }
      )
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitPush: async (setUpstream) => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      get().flushActiveEditorSync()
      if (get().isDirty) {
        const saved = await get().saveActiveFile()
        if (!saved.saved) return { success: false, failure: 'failed', error: '当前文件保存失败，未推送' }
      }
      const res = await window.api.workbench.gitPush(workspacePath, setUpstream)
      const result = res.success && res.data ? res.data : { success: false, failure: 'failed' as const, error: res.error || '推送失败' }
      await get().refreshGitStatus()
      get().setGitNotice(
        result.success
          ? { tone: 'success', message: result.hint ?? '已推送到远程' }
          : { tone: 'warning', message: result.hint ? `${result.error}：${result.hint}` : result.error || '推送失败' }
      )
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
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
      if (result.success) {
        get().clearGitNotice()
      } else {
        get().setGitNotice({ tone: 'error', message: result.error || '初始化失败' })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
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
        get().setGitNotice({ tone: 'error', message: result.error || '保存远程地址失败' })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitDiscardFile: async (change) => {
    const { workspacePath, activeFilePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      // 若当前编辑器正打开目标文件，先刷清 Lexical 增量缓冲并取消自动保存定时器，
      // 防止撤回磁盘内容后几百毫秒被残留的自动保存写回旧文本。
      if (activeFilePath === change.path) {
        get().flushActiveEditorSync()
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer)
          autoSaveTimer = null
        }
      }

      const res = await window.api.workbench.gitDiscardFile(workspacePath, change)
      const result =
        res.success && res.data
          ? res.data
          : { success: false, failure: 'failed' as const, error: res.error || '撤回修改失败' }

      if (!result.success) {
        get().setGitNotice({ tone: 'error', message: result.error || '撤回修改失败' })
        return result
      }

      await get().loadFileTree({ skipGitStatus: true })

      const currentActive = get().activeFilePath
      const reloadPath =
        currentActive === change.path
          ? change.path
          : change.oldPath && currentActive === change.oldPath
            ? change.oldPath
            : null

      if (reloadPath) {
        let reloaded = false
        try {
          const fileRes = await window.api.workbench.readFile(workspacePath, reloadPath)
          if (fileRes.success && fileRes.data) {
            set(buildActiveFilePayload(reloadPath, fileRes.data))
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('workbench:git-file-reloaded', { detail: { relativePath: reloadPath } })
              )
            }
            reloaded = true
          }
        } catch {
          reloaded = false
        }

        if (!reloaded) {
          if (change.oldPath && currentActive === change.path) {
            const opened = await get().openFile(change.oldPath)
            if (!opened) void window.api.storeDelete('workbench_lastActiveFilePath')
          } else {
            set({
              activeFilePath: null,
              activeTabPath: null,
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
            set({
              gitBaselinePath: null,
              gitBaselineStatus: 'idle',
              gitBaselineSha: null,
              gitBaselineContent: null
            })
            void window.api.storeDelete('workbench_lastActiveFilePath')
          }
        }
        await get().refreshGitBaseline()
      }

      await get().refreshGitStatus()
      get().setGitNotice({ tone: 'success', message: result.hint ?? '已撤回修改' })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitTrashFile: async (relativePath) => {
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
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })

    const hitsActive = activeFilePath === relativePath
    const nextFilePath = hitsActive && activeFilePath
      ? pickNextActiveFile(flattenSortedFiles(fileTree, fileSort), activeFilePath, [relativePath])
      : null
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

    if (hitsActive) {
      get().flushActiveEditorSync()
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer)
        autoSaveTimer = null
      }
      set({
        activeFilePath: null,
        activeTabPath: null,
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
      set({
        gitBaselinePath: null,
        gitBaselineStatus: 'idle',
        gitBaselineSha: null,
        gitBaselineContent: null
      })
      void window.api.storeDelete('workbench_lastActiveFilePath')
    }

    try {
      const res = await window.api.workbench.gitTrashFile(workspacePath, relativePath)
      const result =
        res.success && res.data
          ? res.data
          : { success: false, failure: 'failed' as const, error: res.error || '移入回收站失败' }

      if (!result.success) {
        if (hitsActive) restoreActiveFileState(activeSnapshot)
        get().setGitNotice({ tone: 'error', message: result.error || '移入回收站失败' })
        return result
      }

      const remainingTabs = get().openTabs.filter((t) => t.path !== relativePath)
      const nextMru = get().mruTabOrder.filter((p) => p !== relativePath)
      const nextClosed = get().closedTabHistory.filter((p) => p !== relativePath)
      set({
        openTabs: remainingTabs,
        mruTabOrder: nextMru,
        closedTabHistory: nextClosed
      })

      await get().loadFileTree({ skipGitStatus: true })
      await get().refreshGitStatus()
      const targetNext = hitsActive ? (pickFallbackTabPath(remainingTabs, nextMru) || nextFilePath) : null
      if (targetNext) {
        const opened = await get().activateTab(targetNext)
        if (!opened) void window.api.storeDelete('workbench_lastActiveFilePath')
      } else if (hitsActive) {
        persistWorkspaceTabs(workspacePath, remainingTabs, null)
      }
      get().setGitNotice({ tone: 'info', message: '已移至系统回收站' })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (hitsActive) restoreActiveFileState(activeSnapshot)
      get().setGitNotice({ tone: 'error', message })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  gitIgnorePath: async (relativePath, mode) => {
    const { workspacePath } = get()
    if (!workspacePath) return { success: false, failure: 'not-repository', error: '未打开工作区' }
    if (get().isGitBusy) return { success: false, failure: 'failed', error: '正在执行其他操作' }
    set({ isGitBusy: true })
    try {
      const res = await window.api.workbench.gitIgnorePath(workspacePath, relativePath, mode)
      const result =
        res.success && res.data
          ? res.data
          : { success: false, failure: 'failed' as const, error: res.error || '更新忽略规则失败' }
      if (result.success) {
        await get().loadFileTree({ skipGitStatus: true })
        await get().refreshGitStatus()
        get().setGitNotice({ tone: 'success', message: result.hint ?? '已加入忽略规则' })
      } else {
        get().setGitNotice({ tone: 'error', message: result.error || '更新忽略规则失败' })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().setGitNotice({ tone: 'error', message })
      return { success: false, failure: 'failed', error: message }
    } finally {
      set({ isGitBusy: false })
    }
  },

  setGitNotice: (notice) => {
    if (gitNoticeTimer) {
      clearTimeout(gitNoticeTimer)
      gitNoticeTimer = null
    }
    set({ gitNotice: notice })
    if (notice && (notice.tone === 'success' || notice.tone === 'info')) {
      gitNoticeTimer = setTimeout(() => {
        gitNoticeTimer = null
        set({ gitNotice: null })
      }, 2600)
    }
  },

  clearGitNotice: () => {
    if (gitNoticeTimer) {
      clearTimeout(gitNoticeTimer)
      gitNoticeTimer = null
    }
    set({ gitNotice: null })
  }
}))

// 开发态调试/验收钩子：vite 下裸 import() 会拿到幻影模块副本，
// CDP 行为验证必须经由应用真实加载路径暴露的同一实例。
// import.meta.env.DEV 在生产构建被静态替换为 false，分支被 tree-shake 剔除。
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __workbenchStore?: typeof useWorkbenchStore }).__workbenchStore = useWorkbenchStore
}

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
        const minLeft = current.leftPaneMinWidth
        const maxLeft = Math.max(minLeft, winW - WORKBENCH_MIN_EDITOR_WIDTH - RIGHT_PANE_DUAL_MIN - 10)
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
