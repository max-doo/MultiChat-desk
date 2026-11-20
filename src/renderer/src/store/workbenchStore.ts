import { create } from 'zustand'
import {
  type WorkbenchFileNode,
  type WorkbenchSearchResult,
  type WorkbenchFileCategory,
  getFileCategory,
  MARKDOWN_EXTENSIONS
} from '../../../shared/types/workbench'

export type SaveStatus = 'saved' | 'saving' | 'error'
export type EditorMode = 'wysiwyg' | 'source'
export type WorkbenchAiAction = 'ask' | 'explain' | 'polish' | 'continue' | 'summarize'
export type WorkbenchSortKey = 'name' | 'mtime' | 'size'
export type WorkbenchSortOrder = 'asc' | 'desc'

export interface WorkbenchSortPreference {
  key: WorkbenchSortKey
  order: WorkbenchSortOrder
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/

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
  fileTree: WorkbenchFileNode[]
  expandedFolderIds: Set<string>
  isLoadingTree: boolean
  isInitialized: boolean

  // 当前激活文档与预览元信息
  activeFilePath: string | null
  activeFileContent: string
  activeFileCategory: WorkbenchFileCategory | null
  activeFileDataUrl: string | null
  activeFileMime: string | null
  activeFileSize: number | null
  activeFileOversized: boolean
  isDirty: boolean
  saveStatus: SaveStatus
  lastSavedAt: number | null

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
  isRightCollapsed: boolean
  sidebarModelId: string
  editorMode: EditorMode

  // 错误提示
  error: string | null
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
  updateActiveContent: (content: string) => void
  createFile: (parentRelativeDir: string, fileName: string) => Promise<string | null>
  createFolder: (parentRelativeDir: string, folderName: string) => Promise<boolean>
  renameNode: (oldRelativePath: string, newRelativePath: string) => Promise<boolean>
  moveNode: (sourceRelativePath: string, targetDirRelative: string) => Promise<boolean>
  deleteNode: (relativePath: string) => Promise<boolean>
  insertReplyIntoActiveMarkdown: (
    replyMd: string,
    meta?: { conversationUrl?: string }
  ) => Promise<{ success: boolean; error?: string }>
  saveReplyAsNewMarkdown: (
    replyMd: string,
    meta: { platformId: string; title?: string }
  ) => Promise<{ success: boolean; error?: string }>
  revealFile: (relativePath: string) => Promise<void>
  openInSystem: (relativePath: string) => Promise<void>
  searchFiles: (query: string) => void
  clearSearch: () => void
  setFileSort: (pref: WorkbenchSortPreference) => void
  setLeftPaneWidth: (width: number) => void
  setRightPaneWidth: (width: number) => void
  toggleLeftCollapse: () => void
  toggleRightCollapse: () => void
  setSidebarModelId: (modelId: string) => void
  setEditorMode: (mode: EditorMode) => void
  askAi: (text: string, actionType: WorkbenchAiAction) => void
  clearError: () => void
}

export type WorkbenchStore = WorkbenchStoreState & WorkbenchStoreActions

// 防抖与请求序列锁
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let currentSearchSeq = 0

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  // 初始状态
  workspacePath: null,
  workspaceName: '',
  recentWorkspaces: [],
  fileTree: [],
  expandedFolderIds: new Set<string>(),
  isLoadingTree: false,
  isInitialized: false,

  activeFilePath: null,
  activeFileContent: '',
  activeFileCategory: null,
  activeFileDataUrl: null,
  activeFileMime: null,
  activeFileSize: null,
  activeFileOversized: false,
  isDirty: false,
  saveStatus: 'saved',
  lastSavedAt: null,

  searchQuery: '',
  isSearching: false,
  searchResults: [],

  fileSort: { key: 'name', order: 'asc' },

  leftPaneWidth: 260,
  rightPaneWidth: 420,
  isLeftCollapsed: false,
  isRightCollapsed: false,
  sidebarModelId: 'chatgpt',
  editorMode: 'wysiwyg',

  error: null,

  initWorkbench: async () => {
    if (get().isInitialized) return
    try {
      const [
        savedPath,
        savedActiveFile,
        savedLeftWidth,
        savedRightWidth,
        savedLeftCollapsed,
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
      if (typeof savedRightWidth === 'number' && savedRightWidth >= 300 && savedRightWidth <= 700) {
        updates.rightPaneWidth = savedRightWidth
      }
      if (typeof savedLeftCollapsed === 'boolean') {
        updates.isLeftCollapsed = savedLeftCollapsed
      }
      if (typeof savedRightCollapsed === 'boolean') {
        updates.isRightCollapsed = savedRightCollapsed
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

      set(updates)

      if (savedPath && typeof savedPath === 'string') {
        await get().setWorkspaceFolder(savedPath)
        if (savedActiveFile && typeof savedActiveFile === 'string') {
          await get().openFile(savedActiveFile)
        }
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
    const nextRecent = [dirPath, ...get().recentWorkspaces.filter((p) => p !== dirPath)].slice(0, 10)
    set({
      workspacePath: dirPath,
      workspaceName: name,
      recentWorkspaces: nextRecent,
      activeFilePath: null,
      activeFileContent: '',
      activeFileCategory: null,
      activeFileDataUrl: null,
      activeFileMime: null,
      activeFileSize: null,
      activeFileOversized: false,
      isDirty: false,
      saveStatus: 'saved',
      searchQuery: '',
      searchResults: []
    })
    void window.api.storeSet('workbench_lastWorkspacePath', dirPath)
    void window.api.storeSet('workbench_recentWorkspaces', nextRecent)
    await get().loadFileTree()
  },

  closeWorkspace: async () => {
    if (get().isDirty) {
      await get().saveActiveFile()
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
  },

  removeRecentWorkspace: (dirPath: string) => {
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
          activeFileMime: res.data.mimeType || null,
          activeFileSize: res.data.size,
          activeFileOversized: !!res.data.isOversized,
          isDirty: false,
          saveStatus: 'saved',
          lastSavedAt: res.data.mtime,
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

    set({ saveStatus: 'saving' })
    try {
      const res = await window.api.workbench.writeFile(workspacePath, activeFilePath, activeFileContent)
      if (res.success && res.data) {
        set({
          isDirty: false,
          saveStatus: 'saved',
          lastSavedAt: res.data.mtime,
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
            activeFileMime: null,
            activeFileSize: null,
            activeFileOversized: false,
            isDirty: false,
            saveStatus: 'saved'
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
   * wysiwyg 模式：处理 frontmatter 后派发 workbench:insert-reply 事件，
   * 由 MarkdownSyncPlugin 在光标上次停留处以「待确认高亮」插入（✓采纳/✗撤回）。
   * source 模式：Lexical 未挂载，直接在末尾追加正文并落盘（无确认交互）。
   */
  insertReplyIntoActiveMarkdown: async (
    replyMd: string,
    meta?: { conversationUrl?: string }
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

    // frontmatter 补 source（文档级元数据，撤回后仍保留）
    const content = upsertFrontmatterSource(get().activeFileContent, meta?.conversationUrl)
    if (content !== get().activeFileContent) {
      set({ activeFileContent: content, isDirty: true })
      await get().saveActiveFile()
    }

    if (editorMode === 'wysiwyg') {
      // 交给 Lexical 在光标处待确认插入；frontmatter 已写盘，正文由 Lexical 回写
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
    meta: { platformId: string; title?: string }
  ) => {
    const { workspacePath, activeFilePath, fileTree } = get()
    const fail = (error: string): { success: boolean; error: string } => {
      set({ error })
      return { success: false, error }
    }
    if (!workspacePath) return fail('请先打开一个工作区')
    const md = (replyMd || '').trim()
    if (!md) return fail('回复内容为空')

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
    const res = await window.api.workbench.writeFile(workspacePath, relPath, md)
    if (!res.success) return fail(res.error || '写入文件失败')
    // createFile 已 openFile，同步最新内容与保存态
    set({ activeFileContent: md, isDirty: false, saveStatus: 'saved' })
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
    const clamped = Math.max(300, Math.min(700, width))
    set({ rightPaneWidth: clamped })
    void window.api.storeSet('workbench_rightPaneWidth', clamped)
  },

  toggleLeftCollapse: () => {
    const next = !get().isLeftCollapsed
    set({ isLeftCollapsed: next })
    void window.api.storeSet('workbench_isLeftCollapsed', next)
  },

  toggleRightCollapse: () => {
    const next = !get().isRightCollapsed
    set({ isRightCollapsed: next })
    void window.api.storeSet('workbench_isRightCollapsed', next)
  },

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

    const isCode = get().activeFileCategory === 'code'
    let formattedPrompt = trimmed
    switch (actionType) {
      case 'explain':
        formattedPrompt = isCode
          ? `请详细分析以下代码的架构设计、执行流程与实现逻辑：\n\n\`\`\`\n${trimmed}\n\`\`\``
          : `请详细解释以下内容的核心含义、背景与原理：\n\n"""\n${trimmed}\n"""`
        break
      case 'polish':
        formattedPrompt = isCode
          ? `请对以下代码进行专业重构与性能/可读性优化，指出潜在缺陷并提供更清晰、健壮的改进代码：\n\n\`\`\`\n${trimmed}\n\`\`\``
          : `请对以下文本进行专业级润色，纠正语病并优化行文逻辑，保持原意但更精炼地表达：\n\n"""\n${trimmed}\n"""`
        break
      case 'continue':
        formattedPrompt = isCode
          ? `请基于以下代码上下文，补全或续写后续逻辑：\n\n\`\`\`\n${trimmed}\n\`\`\``
          : `请基于以下已有段落和上下文思路，自然承接并往下续写：\n\n"""\n${trimmed}\n"""`
        break
      case 'summarize':
        formattedPrompt = isCode
          ? `请总结以下代码片段的核心模块与导出功能：\n\n\`\`\`\n${trimmed}\n\`\`\``
          : `请提取并总结以下内容的关键要点：\n\n"""\n${trimmed}\n"""`
        break
      case 'ask':
      default:
        formattedPrompt = isCode
          ? `关于以下代码：\n\n\`\`\`\n${trimmed}\n\`\`\``
          : trimmed
        break
    }

    // 若右侧栏处于折叠状态，先自动展开
    if (get().isRightCollapsed) {
      get().toggleRightCollapse()
    }

    // 通过 CustomEvent 通知 WorkbenchAiSidebar 注入文本
    window.dispatchEvent(
      new CustomEvent('workbench:insert-prompt', {
        detail: { prompt: formattedPrompt }
      })
    )
  },

  clearError: () => set({ error: null })
}))
