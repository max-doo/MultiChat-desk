import { create } from 'zustand'
import {
  type WorkbenchFileNode,
  type WorkbenchSearchResult,
  type WorkbenchFileCategory,
  getFileCategory,
  MARKDOWN_EXTENSIONS
} from '../../../shared/types/workbench'

export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict'
export type EditorMode = 'wysiwyg' | 'source'
export type WorkbenchAiAction = 'ask' | 'explain' | 'polish' | 'summarize'
/** 右侧栏与快捷窗口一致：AI 对话和思维导图互斥，同一时刻只显示一个。 */
export type WorkbenchRightPane = 'ai' | 'mindmap' | null
export type WorkbenchSortKey = 'name' | 'mtime' | 'size'
export type WorkbenchSortOrder = 'asc' | 'desc'

export interface WorkbenchSortPreference {
  key: WorkbenchSortKey
  order: WorkbenchSortOrder
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/

// 右侧 AI 侧边栏宽度限制：随窗口宽度分档，避免小窗下侧边栏过宽挤压编辑器
const RIGHT_PANE_MIN = 300
const RIGHT_PANE_MAX_TIERS: Array<{ minWindowWidth: number; maxPaneWidth: number }> = [
  { minWindowWidth: 1680, maxPaneWidth: 960 },
  { minWindowWidth: 1440, maxPaneWidth: 640 },
  { minWindowWidth: 1200, maxPaneWidth: 560 },
  { minWindowWidth: 0, maxPaneWidth: 480 }
]

function getRightPaneMaxWidth(): number {
  const windowWidth = typeof window === 'undefined' ? 1400 : window.innerWidth
  for (const tier of RIGHT_PANE_MAX_TIERS) {
    if (windowWidth >= tier.minWindowWidth) return tier.maxPaneWidth
  }
  return RIGHT_PANE_MIN
}

function clampRightPaneWidth(width: number): number {
  return Math.max(RIGHT_PANE_MIN, Math.min(getRightPaneMaxWidth(), width))
}

/**
 * 往 Markdown 的 YAML frontmatter 补一条 source 链接。
 * 已有 frontmatter：把 url 并入 source 字段（不存在则新增一行）；
 * 无 frontmatter：新建 `---\nsource: url\n---\n` 头部。
 */
function upsertFrontmatterSource(content: string, url?: string): string {
  if (!url) return content
  const m = content.match(FRONTMATTER_RE)
  if (!m) {
    return `---\nsource: ${url}\n---\n\n${content}`
  }
  const head = m[0]
  const body = m[1]
  // 已有 source 行 → 追加 url（若未含该 url）
  if (/^source\s*:/m.test(body)) {
    if (body.includes(url)) return content
    const next = body.replace(/^(source\s*:.*)$/m, `$1\nsource: ${url}`)
    return `---\n${next}\n---\n` + content.slice(head.length)
  }
  return `---\n${body}\nsource: ${url}\n---\n` + content.slice(head.length)
}

interface WorkbenchStoreState {
  // 工作区状态
  workspacePath: string | null
  workspaceName: string
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
  isDirty: boolean
  saveStatus: SaveStatus
  lastSavedAt: number | null
  // 外部冲突：保存时检测到磁盘 mtime 比内存新，拉回来的磁盘版本内容
  conflictDiskContent: string | null

  // 搜索相关
  searchQuery: string
  isSearching: boolean
  searchResults: WorkbenchSearchResult[]

  // 文件树排序偏好
  fileSort: WorkbenchSortPreference

  // 布局尺寸与折叠
  leftPaneWidth: number
  rightPaneWidth: number
  isLeftCollapsed: boolean
  rightPane: WorkbenchRightPane
  /** 待生成的选区范围；由编辑器划词菜单写入，导图面板消费后清空。 */
  pendingMindmapSelection: { text: string; headingPath: string[] } | null
  /** 待打开的来源会话；笔记属性里的会话图标写入，AI 侧边栏消费后清空。 */
  pendingConversationOpen: { platformId: string; url: string; token: number } | null
  sidebarModelId: string
  editorMode: EditorMode

  // 错误提示
  error: string | null

  // 工作区文件拖拽态
  draggingNodes: WorkbenchFileNode[] | null
}

interface WorkbenchStoreActions {
  initWorkbench: () => Promise<void>
  selectWorkspaceFolder: () => Promise<void>
  setWorkspaceFolder: (dirPath: string, dirName?: string) => Promise<void>
  closeWorkspace: () => Promise<void>
  removeRecentWorkspace: (dirPath: string) => void
  loadFileTree: () => Promise<void>
  toggleFolder: (folderId: string) => void
  expandAllFolders: () => void
  collapseAllFolders: () => void
  openFile: (relativePath: string) => Promise<boolean>
  saveActiveFile: () => Promise<boolean>
  resolveExternalConflict: (choice: 'keep-mine' | 'take-disk') => Promise<boolean>
  updateActiveContent: (content: string) => void
  createFile: (parentRelativeDir: string, fileName: string) => Promise<string | null>
  createFolder: (parentRelativeDir: string, folderName: string) => Promise<boolean>
  renameNode: (oldRelativePath: string, newRelativePath: string) => Promise<boolean>
  moveNode: (sourceRelativePath: string, targetDirRelative: string) => Promise<boolean>
  deleteNode: (relativePath: string) => Promise<boolean>
  insertReplyIntoActiveMarkdown: (
    replyMd: string,
    _meta?: { conversationUrl?: string }
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
  handleExternalFsChanged: (workspaceRoot: string) => Promise<void>
  searchFiles: (query: string) => void
  clearSearch: () => void
  setFileSort: (pref: WorkbenchSortPreference) => void
  setLeftPaneWidth: (width: number) => void
  setRightPaneWidth: (width: number) => void
  toggleLeftCollapse: () => void
  openRightPane: (pane: Exclude<WorkbenchRightPane, null>) => void
  closeRightPane: () => void
  setPendingMindmapSelection: (selection: { text: string; headingPath: string[] } | null) => void
  openConversationInAiSidebar: (platformId: string, url: string) => void
  consumeConversationOpen: (token: number) => void
  setSidebarModelId: (modelId: string) => void
  setEditorMode: (mode: EditorMode) => void
  askAi: (text: string, actionType: WorkbenchAiAction) => void
  clearError: () => void
  setDraggingNodes: (nodes: WorkbenchFileNode[] | null) => void
}

export type WorkbenchStore = WorkbenchStoreState & WorkbenchStoreActions

// 防抖与请求序列锁
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let currentSearchSeq = 0
let fsWatcherBound = false
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
): Promise<{ deleted: number; relinked: number; relinks: Array<{ from: string; to: string }> } | null> {
  const index: Array<{ path: string; size?: number; mtime?: number }> = []
  collectFileIndex(tree, index)
  return window.api.workbench.reconcileMindmaps(workspaceRoot, index)
    .then(res => {
      if (!res.success || !res.data) return null
      for (const link of res.data.relinks) {
        recentRelinks.set(relinkKey(workspaceRoot, link.from), link.to)
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
  isDirty: false,
  saveStatus: 'saved',
  lastSavedAt: null,
  conflictDiskContent: null,

  searchQuery: '',
  isSearching: false,
  searchResults: [],

  fileSort: { key: 'name', order: 'asc' },

  leftPaneWidth: 260,
  rightPaneWidth: 420,
  isLeftCollapsed: false,
  rightPane: 'ai',
  pendingMindmapSelection: null,
  pendingConversationOpen: null,
  sidebarModelId: 'chatgpt',
  editorMode: 'wysiwyg',

  error: null,
  draggingNodes: null,

  initWorkbench: async () => {
    if (get().isInitialized) return
    try {
      // 绑定一次外部文件系统监听：主进程 watcher 去抖广播后静默重扫文件树
      if (!fsWatcherBound) {
        fsWatcherBound = true
        window.api.workbench.onFsChanged((payload) => {
          void get().handleExternalFsChanged(payload.workspaceRoot)
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
        savedEditorMode,
        savedRecentWorkspaces,
        savedFileSort
      ] = await Promise.all([
        window.api.storeGet('workbench_lastWorkspacePath') as Promise<string | null>,
        window.api.storeGet('workbench_lastActiveFilePath') as Promise<string | null>,
        window.api.storeGet('workbench_leftPaneWidth') as Promise<number | null>,
        window.api.storeGet('workbench_rightPaneWidth') as Promise<number | null>,
        window.api.storeGet('workbench_isLeftCollapsed') as Promise<boolean | null>,
        window.api.storeGet('workbench_rightPane') as Promise<WorkbenchRightPane | null>,
        window.api.storeGet('workbench_isRightCollapsed') as Promise<boolean | null>,
        window.api.storeGet('workbench_sidebarModelId') as Promise<string | null>,
        window.api.storeGet('workbench_editorMode') as Promise<EditorMode | null>,
        window.api.storeGet('workbench_recentWorkspaces') as Promise<string[] | null>,
        window.api.storeGet('workbench_fileSort') as Promise<WorkbenchSortPreference | null>
      ])

      const updates: Partial<WorkbenchStoreState> = { isInitialized: true }
      if (typeof savedLeftWidth === 'number' && savedLeftWidth >= 260 && savedLeftWidth <= 480) {
        updates.leftPaneWidth = savedLeftWidth
      }
      if (typeof savedRightWidth === 'number' && savedRightWidth >= RIGHT_PANE_MIN) {
        updates.rightPaneWidth = clampRightPaneWidth(savedRightWidth)
      }
      if (typeof savedLeftCollapsed === 'boolean') {
        updates.isLeftCollapsed = savedLeftCollapsed
      }
      // 新键优先；老版本只有布尔折叠状态，迁移成「AI 展开 / 全部收起」。
      if (savedRightPane === 'ai' || savedRightPane === 'mindmap' || savedRightPane === null) {
        updates.rightPane = savedRightPane
      } else if (typeof savedRightCollapsed === 'boolean') {
        updates.rightPane = savedRightCollapsed ? null : 'ai'
      }
      if (typeof savedSidebarModel === 'string' && savedSidebarModel) {
        updates.sidebarModelId = savedSidebarModel
      }
      if (savedEditorMode === 'wysiwyg' || savedEditorMode === 'source') {
        updates.editorMode = savedEditorMode
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

      // 确保默认工作区存在（首次启动会创建），随后无论上次是否有保存的工作区，都先把默认路径放到 store
      let defaultWorkspacePath: string | null = null
      try {
        const defaultRes = await window.api.workbench.ensureDefaultWorkspace()
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

      if (savedPath && typeof savedPath === 'string') {
        await get().setWorkspaceFolder(savedPath)
        if (savedActiveFile && typeof savedActiveFile === 'string') {
          // 应用关闭期间文件可能被改名，对账刚记下新路径，恢复时跟着走。
          await get().openFile(recentRelinks.get(relinkKey(savedPath, savedActiveFile)) ?? savedActiveFile)
        }
      } else if (defaultWorkspacePath) {
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
    const name = dirName || dirPath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace'
    const defaultPath = get().defaultWorkspacePath
    const recents = [dirPath, ...get().recentWorkspaces.filter((p) => p !== dirPath)]
    // 默认工作区必须始终保留在最近列表中（若已初始化），用于「管理仓库」展示与回落
    const nextRecent = (defaultPath && !recents.includes(defaultPath)
      ? [...recents, defaultPath]
      : recents
    ).slice(0, 10)
    const prevPath = get().workspacePath
    if (prevPath && prevPath !== dirPath) {
      void window.api.workbench.unwatch(prevPath)
    }
    set({
      workspacePath: dirPath,
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
    void window.api.storeSet('workbench_lastWorkspacePath', dirPath)
    void window.api.storeSet('workbench_recentWorkspaces', nextRecent)
    void window.api.workbench.watch(dirPath)
    await get().loadFileTree()
  },

  closeWorkspace: async () => {
    if (get().isDirty) {
      await get().saveActiveFile()
    }
    const closingPath = get().workspacePath
    const defaultPath = get().defaultWorkspacePath
    // 默认工作区不可关闭：若当前就在默认工作区，直接返回
    if (closingPath && defaultPath && closingPath === defaultPath) {
      return
    }
    if (closingPath) {
      void window.api.workbench.unwatch(closingPath)
    }
    set({
      workspacePath: null,
      workspaceName: '',
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
      searchResults: []
    })
    void window.api.storeDelete('workbench_lastWorkspacePath')
    void window.api.storeDelete('workbench_lastActiveFilePath')
    // 关闭非默认工作区后回落到默认工作区，保证始终有打开的 vault
    if (defaultPath) {
      await get().setWorkspaceFolder(defaultPath)
    }
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
        // 应用关闭期间的外部删除/改名，在重新载入工作区时补齐。
        // 等对账返回再结束载入，恢复上次打开的文档才能拿到改名映射。
        await reconcileMindmaps(workspacePath, res.data)
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

  openFile: async (relativePath: string) => {
    const { workspacePath, activeFilePath, isDirty } = get()
    if (!workspacePath) return false
    if (activeFilePath === relativePath) return true

    // 脏状态防护：如果前一个文件有未保存的改动，立即强制刷盘
    if (isDirty && activeFilePath) {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer)
        autoSaveTimer = null
      }
      const saved = await get().saveActiveFile()
      if (!saved) {
        set({ error: '当前文件保存未完成，无法安全切换文件' })
        return false
      }
    }

    try {
      const res = await window.api.workbench.readFile(workspacePath, relativePath)
      if (res.success && res.data) {
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
          error: null
        })
        void window.api.storeSet('workbench_lastActiveFilePath', relativePath)
        return true
      } else {
        set({ error: res.error || '无法读取文件内容' })
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ error: `打开文件失败: ${msg}` })
      return false
    }
  },

  saveActiveFile: async () => {
    const {
      workspacePath,
      activeFilePath,
      activeFileContent,
      activeFileCategory,
      activeFileOversized
    } = get()
    if (!workspacePath || !activeFilePath) return true

    // 严禁将只读二进制文件或非文本格式（图片、PDF、DOCX 等）作为空文本写盘覆盖，防止数据损坏
    if (
      activeFileOversized ||
      activeFileCategory === 'image' ||
      activeFileCategory === 'pdf' ||
      activeFileCategory === 'document' ||
      activeFileCategory === 'other'
    ) {
      return true
    }

    // 已处于冲突态：等用户裁决，不再自动写盘/反复拉磁盘版本
    if (get().saveStatus === 'conflict') {
      return false
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
        return false
      }
    }

    set({ saveStatus: 'saving' })
    try {
      const res = await window.api.workbench.writeFile(workspacePath, activeFilePath, activeFileContent)
      if (res.success && res.data) {
        set({
          isDirty: false,
          saveStatus: 'saved',
          lastSavedAt: res.data.mtime,
          conflictDiskContent: null,
          activeFileSize: res.data.size
        })
        return true
      } else {
        set({
          saveStatus: 'error',
          error: res.error || '保存文件失败'
        })
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({
        saveStatus: 'error',
        error: `保存文件异常: ${msg}`
      })
      return false
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
    return get().saveActiveFile()
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

  deleteNode: async (relativePath: string) => {
    const { workspacePath, activeFilePath, fileTree, fileSort } = get()
    if (!workspacePath) return false

    // 删除前按当前排序拍平文件列表，预取被删文件的后继者，删除后自动打开。
    // 覆盖两种情形：被删项即当前文件；被删目录包含当前文件。
    let nextFilePath: string | null = null
    if (activeFilePath === relativePath || (activeFilePath && activeFilePath.startsWith(`${relativePath}/`))) {
      const dir = fileSort.order === 'asc' ? 1 : -1
      const flat: WorkbenchFileNode[] = []
      const walk = (nodes: WorkbenchFileNode[]) => {
        const sorted = [...nodes].sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          if (fileSort.key === 'name' || a.isDirectory || b.isDirectory) {
            return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          }
          if (fileSort.key === 'mtime') return dir * ((a.mtime ?? 0) - (b.mtime ?? 0))
          const diff = (a.size ?? 0) - (b.size ?? 0)
          return diff !== 0
            ? dir * diff
            : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        })
        for (const n of sorted) {
          if (n.isDirectory) {
            if (n.children) walk(n.children)
          } else {
            flat.push(n)
          }
        }
      }
      walk(fileTree)
      const idx = flat.findIndex(n => n.path === activeFilePath)
      const isSurvivor = (n: WorkbenchFileNode) =>
        n.path !== relativePath && !n.path.startsWith(`${relativePath}/`)
      // 先向后取同序位的幸存文件，没有则向前取
      let next: WorkbenchFileNode | undefined
      for (let i = idx + 1; i < flat.length; i++) {
        if (isSurvivor(flat[i])) { next = flat[i]; break }
      }
      if (!next) {
        for (let i = idx - 1; i >= 0; i--) {
          if (isSurvivor(flat[i])) { next = flat[i]; break }
        }
      }
      nextFilePath = next?.path ?? null
    }

    try {
      const res = await window.api.workbench.deleteNode(workspacePath, relativePath)
      if (res.success) {
        // 若当前打开的文件正是删除项或位于删除目录下，清理当前编辑状态
        if (activeFilePath === relativePath || (activeFilePath && activeFilePath.startsWith(`${relativePath}/`))) {
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
        await get().loadFileTree()
        // 当前文件被删时自动切换到排序上的相邻文件；无任何文件则停在空状态
        if (nextFilePath) {
          const opened = await get().openFile(nextFilePath)
          if (!opened) void window.api.storeDelete('workbench_lastActiveFilePath')
        }
        return true
      } else {
        set({ error: res.error || '删除失败' })
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
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
    _meta?: { conversationUrl?: string }
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
      if (!saved) return fail('当前文件保存未完成')
    }

    if (editorMode === 'wysiwyg') {
      // 交给 Lexical 在光标处待确认插入；正文由 Lexical 回写
      window.dispatchEvent(new CustomEvent('workbench:insert-reply', { detail: { replyMd: md } }))
      return { success: true }
    }

    // source 模式：直接末尾追加并落盘
    const cur = get().activeFileContent
    const prefix = cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n` : ''
    const next = `${prefix}---\n\n${md}\n`
    set({ activeFileContent: next, isDirty: true })
    const saved = await get().saveActiveFile()
    return saved ? { success: true } : fail('写入文件失败')
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

    // 文档级元数据：frontmatter 记录来源对话链接（与 insertReplyIntoActiveMarkdown 一致）
    const content = upsertFrontmatterSource(md, meta.conversationUrl)

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

  deleteNodes: async (relativePaths: string[]) => {
    const { workspacePath } = get()
    if (!workspacePath || !relativePaths.length) return false
    try {
      const res = await window.api.workbench.deleteNodes(workspacePath, relativePaths)
      if (res.success && res.data) {
        await get().loadFileTree()
        return res.data.failed.length === 0
      }
      return false
    } catch {
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

  setFileSort: (pref: WorkbenchSortPreference) => {
    set({ fileSort: pref })
    void window.api.storeSet('workbench_fileSort', pref)
  },

  setLeftPaneWidth: (width: number) => {
    const clamped = Math.max(260, Math.min(480, width))
    set({ leftPaneWidth: clamped })
    void window.api.storeSet('workbench_leftPaneWidth', clamped)
  },

  setRightPaneWidth: (width: number) => {
    const clamped = clampRightPaneWidth(width)
    set({ rightPaneWidth: clamped })
    void window.api.storeSet('workbench_rightPaneWidth', clamped)
  },

  toggleLeftCollapse: () => {
    const next = !get().isLeftCollapsed
    set({ isLeftCollapsed: next })
    void window.api.storeSet('workbench_isLeftCollapsed', next)
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
    set({ pendingConversationOpen: { platformId, url, token: Date.now() } })
  },

  consumeConversationOpen: (token) =>
    set((state) =>
      state.pendingConversationOpen?.token === token ? { pendingConversationOpen: null } : state
    ),

  setSidebarModelId: (modelId: string) => {
    set({ sidebarModelId: modelId })
    void window.api.storeSet('workbench_sidebarModelId', modelId)
  },

  setEditorMode: (mode: EditorMode) => {
    set({ editorMode: mode })
    void window.api.storeSet('workbench_editorMode', mode)
  },

  askAi: (text: string, actionType: WorkbenchAiAction) => {
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

    // 若右侧栏处于折叠状态，先自动展开
    if (get().rightPane !== 'ai') {
      get().openRightPane('ai')
    }

    // 通过 CustomEvent 通知 WorkbenchAiSidebar 注入文本
    window.dispatchEvent(
      new CustomEvent('workbench:insert-prompt', {
        detail: { prompt: formattedPrompt }
      })
    )
  },

  clearError: () => set({ error: null }),

  setDraggingNodes: (nodes) => set({ draggingNodes: nodes })
}))

// 窗口缩小时，已存的侧边栏宽度可能超过新档位的上限，监听 resize 被动收敛。
// 仅在跨档位时才 set，避免窗口微调触发的多余渲染。
if (typeof window !== 'undefined') {
  let lastMaxWidth = getRightPaneMaxWidth()
  window.addEventListener('resize', () => {
    const nextMaxWidth = getRightPaneMaxWidth()
    if (nextMaxWidth === lastMaxWidth) return
    lastMaxWidth = nextMaxWidth
    const current = useWorkbenchStore.getState()
    if (current.rightPaneWidth > nextMaxWidth) {
      useWorkbenchStore.setState({ rightPaneWidth: nextMaxWidth })
    }
  })
}
