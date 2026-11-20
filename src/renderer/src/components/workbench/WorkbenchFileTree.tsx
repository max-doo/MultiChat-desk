import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { WorkbenchFileNode } from '../../../../shared/types/workbench'
import { getFileCategory } from '../../../../shared/types/workbench'
import WorkbenchSearch from './WorkbenchSearch'
import FileTypeIcon from './FileTypeIcon'

/** 新建节点输入框默认占位名，提交时若用户未修改则使用 */
const DEFAULT_FILE_NAME = '未命名笔记.md'
const DEFAULT_FOLDER_NAME = '新建文件夹'

interface ContextMenuState {
  x: number
  y: number
  node: WorkbenchFileNode | null
}

interface ActionModalState {
  type: 'rename' | 'delete' | 'deleteMulti' | 'cleanImages'
  targetNode: WorkbenchFileNode | null
  defaultValue?: string
  // cleanImages 用：待清理的未引用图片列表
  unreferencedImages?: string[]
  // 删除确认用：关联的文档数与导图数，用于提前告知绑定会如何处理
  mindmapImpact?: { documents: number; mindmaps: number }
}

/**
 * 树内联"新建"输入框状态（VSCode 风格）
 * parentDir 为目标父目录的相对路径，'' 表示根目录
 */
interface InlineCreateState {
  type: 'file' | 'folder'
  parentDir: string
}

/** 拖拽状态：记录被拖节点与当前悬停目标目录（null 表示根目录） */
interface DragState {
  node: WorkbenchFileNode
  /** 参与拖拽的全部路径（多选时为整组，单选时仅自身） */
  paths: string[]
}

/** 从拖拽/粘贴的 File 对象提取本地绝对路径（Electron：.path 或 webUtils.getPathForFile） */
function extractLocalPath(file: File): string {
  const legacy = (file as File & { path?: string }).path
  if (legacy) return legacy
  const webUtils = (window as Window & { electron?: { webUtils?: { getPathForFile?: (f: File) => string } } }).electron?.webUtils
  try {
    return webUtils?.getPathForFile?.(file) ?? ''
  } catch {
    return ''
  }
}

/** 收集 DataTransferItemList / FileList 中所有带本地路径的条目 */
function collectLocalPaths(files: FileList | File[] | null | undefined): string[] {
  if (!files) return []
  const out: string[] = []
  for (const f of Array.from(files)) {
    const p = extractLocalPath(f)
    if (p) out.push(p)
  }
  return out
}

type SortMenuKey = 'name' | 'mtime' | 'size'

const SORT_LABELS: Record<SortMenuKey, string> = {
  name: '名称',
  mtime: '修改时间',
  size: '大小'
}

export function getNodeIcon(node: WorkbenchFileNode): { icon: string; color: string } {
  if (node.isDirectory) {
    return { icon: 'folder', color: 'text-amber-500' }
  }

  const ext = (node.extension || '').toLowerCase()

  // Markdown 专属图标
  if (ext === '.md' || ext === '.markdown') {
    return { icon: 'description', color: 'text-blue-500 dark:text-blue-400' }
  }

  // PDF 专属图标
  if (ext === '.pdf') {
    return { icon: 'picture_as_pdf', color: 'text-rose-500 dark:text-rose-400' }
  }

  // 图片专属图标 (同一 Material Symbols 系列)
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif', '.tiff', '.tif'].includes(ext)) {
    return { icon: 'image', color: 'text-purple-500 dark:text-purple-400' }
  }
  if (ext === '.svg') {
    return { icon: 'draw', color: 'text-purple-500 dark:text-purple-400' }
  }

  // Word 文档专属图标
  if (['.docx', '.doc', '.dotx', '.dot', '.rtf', '.odt'].includes(ext)) {
    return { icon: 'article', color: 'text-indigo-600 dark:text-indigo-400' }
  }

  // Excel 电子表格专属图标
  if (['.xlsx', '.xls', '.xlsm', '.xlsb', '.xltx', '.xlt', '.ods'].includes(ext)) {
    return { icon: 'table', color: 'text-emerald-600 dark:text-emerald-400' }
  }

  // PPT 演示文稿专属图标
  if (['.pptx', '.ppt', '.pptm', '.potx', '.pot', '.ppsx', '.pps', '.odp'].includes(ext)) {
    return { icon: 'slideshow', color: 'text-orange-600 dark:text-orange-400' }
  }

  // 纯文本专属图标
  if (['.txt', '.log', '.csv', '.tsv'].includes(ext)) {
    return { icon: 'text_snippet', color: 'text-slate-500 dark:text-slate-400' }
  }

  return { icon: 'draft', color: 'text-text-secondary/70' }
}

export default function WorkbenchFileTree(): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const workspaceName = useWorkbenchStore((s) => s.workspaceName)
  const defaultWorkspacePath = useWorkbenchStore((s) => s.defaultWorkspacePath)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const expandedFolderIds = useWorkbenchStore((s) => s.expandedFolderIds)
  const isLoadingTree = useWorkbenchStore((s) => s.isLoadingTree)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const isDirty = useWorkbenchStore((s) => s.isDirty)

  const selectWorkspaceFolder = useWorkbenchStore((s) => s.selectWorkspaceFolder)
  const closeWorkspace = useWorkbenchStore((s) => s.closeWorkspace)
  const recentWorkspaces = useWorkbenchStore((s) => s.recentWorkspaces)
  const removeRecentWorkspace = useWorkbenchStore((s) => s.removeRecentWorkspace)
  const loadFileTree = useWorkbenchStore((s) => s.loadFileTree)
  const toggleFolder = useWorkbenchStore((s) => s.toggleFolder)
  const collapseAllFolders = useWorkbenchStore((s) => s.collapseAllFolders)
  const toggleLeftCollapse = useWorkbenchStore((s) => s.toggleLeftCollapse)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const createFile = useWorkbenchStore((s) => s.createFile)
  const createFolder = useWorkbenchStore((s) => s.createFolder)
  const renameNode = useWorkbenchStore((s) => s.renameNode)
  const deleteNode = useWorkbenchStore((s) => s.deleteNode)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const fileSort = useWorkbenchStore((s) => s.fileSort)
  const setFileSort = useWorkbenchStore((s) => s.setFileSort)
  const moveNode = useWorkbenchStore((s) => s.moveNode)
  const findUnreferencedImages = useWorkbenchStore((s) => s.findUnreferencedImages)
  const deleteNodes = useWorkbenchStore((s) => s.deleteNodes)
  const importExternalItems = useWorkbenchStore((s) => s.importExternalItems)

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null)
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null)
  const [isRootDropActive, setIsRootDropActive] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [anchorPath, setAnchorPath] = useState<string | null>(null)
  const [isVaultMenuOpen, setIsVaultMenuOpen] = useState(false)
  const [isVaultManageOpen, setIsVaultManageOpen] = useState(false)
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [inlineInputValue, setInlineInputValue] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [isCleaningImages, setIsCleaningImages] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const inlineInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const vaultMenuRef = useRef<HTMLDivElement | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (actionModal && actionModal.type === 'rename') {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [actionModal])

  // 切换工作区/文件树刷新时清理失效选中
  useEffect(() => {
    setSelectedPaths(new Set())
    setAnchorPath(null)
  }, [workspacePath])

  // 内联新建输入框出现时聚焦（VSCode 行为：空白输入框等待用户输入）
  useEffect(() => {
    if (inlineCreate) {
      setInlineInputValue('')
      requestAnimationFrame(() => inlineInputRef.current?.focus())
    }
  }, [inlineCreate])

  // 关闭上下文菜单
  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  // 关闭底部工作区菜单
  useEffect(() => {
    if (!isVaultMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (vaultMenuRef.current && !vaultMenuRef.current.contains(e.target as Node)) {
        setIsVaultMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsVaultMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isVaultMenuOpen])

  // 关闭排序菜单
  useEffect(() => {
    if (!isSortMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setIsSortMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSortMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSortMenuOpen])

  // 按当前排序偏好对树节点排序（目录始终在前）
  const sortNodes = useCallback(
    (nodes: WorkbenchFileNode[]): WorkbenchFileNode[] => {
      const { key, order } = fileSort
      const dir = order === 'asc' ? 1 : -1
      return [...nodes].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        if (key === 'name') {
          return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        }
        if (key === 'mtime') {
          return dir * ((a.mtime ?? 0) - (b.mtime ?? 0))
        }
        // size：目录没有 size 概念，统一按名称排序保持一致体验
        if (!a.isDirectory && !b.isDirectory) {
          const diff = (a.size ?? 0) - (b.size ?? 0)
          if (diff !== 0) return dir * diff
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })
    },
    [fileSort]
  )

  const sortedFileTree = useMemo(() => sortNodes(fileTree), [fileTree, sortNodes])

  /** 可见节点扁平化（按当前展开状态与排序），用于 Shift 范围选择 */
  const flatVisibleNodes = useMemo(() => {
    const out: WorkbenchFileNode[] = []
    const walk = (nodes: WorkbenchFileNode[]) => {
      for (const n of nodes) {
        out.push(n)
        if (n.isDirectory && expandedFolderIds.has(n.id) && n.children) {
          walk(sortNodes(n.children))
        }
      }
    }
    walk(sortedFileTree)
    return out
  }, [sortedFileTree, expandedFolderIds, sortNodes])

  /** 节点点击（VSCode：普通点击单选、Ctrl/Cmd 切换、Shift 从锚点范围选择） */
  const handleNodeClick = useCallback(
    (e: React.MouseEvent, node: WorkbenchFileNode) => {
      const isCtrl = e.ctrlKey || e.metaKey
      const isShift = e.shiftKey

      if (isShift && anchorPath) {
        const ai = flatVisibleNodes.findIndex((n) => n.path === anchorPath)
        const bi = flatVisibleNodes.findIndex((n) => n.path === node.path)
        if (ai !== -1 && bi !== -1) {
          const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai]
          const range = flatVisibleNodes.slice(lo, hi + 1).map((n) => n.path)
          setSelectedPaths(new Set(range))
        } else {
          setSelectedPaths(new Set([node.path]))
          setAnchorPath(node.path)
        }
      } else if (isCtrl) {
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          if (next.has(node.path)) next.delete(node.path)
          else next.add(node.path)
          return next
        })
        setAnchorPath(node.path)
      } else {
        setSelectedPaths(new Set([node.path]))
        setAnchorPath(node.path)
      }

      if (node.isDirectory) {
        if (!isCtrl && !isShift) toggleFolder(node.id)
      } else {
        if (!isCtrl && !isShift) void openFile(node.path)
      }
    },
    [anchorPath, flatVisibleNodes, toggleFolder, openFile]
  )

  /** 展开 set 中的祖先目录，保证选中项/新建输入框可见 */
  const expandAncestors = useCallback((dirPaths: Iterable<string>) => {
    const next = new Set(useWorkbenchStore.getState().expandedFolderIds)
    for (const dirPath of Array.from(dirPaths)) {
      // dirPath 自身及其全部祖先目录均需展开
      let p: string | null = dirPath
      while (p) {
        next.add(p)
        const idx = p.lastIndexOf('/')
        p = idx === -1 ? null : p.slice(0, idx)
      }
    }
    useWorkbenchStore.setState({ expandedFolderIds: next })
  }, [])

  /** 依据上下文节点推断新建目标的父目录（VSCode 语义：文件→其父目录；文件夹→其内部） */
  const resolveParentDir = useCallback(
    (node: WorkbenchFileNode | null): string => {
      if (node) {
        if (node.isDirectory) return node.path
        const idx = node.path.lastIndexOf('/')
        return idx === -1 ? '' : node.path.slice(0, idx)
      }
      // 无右键上下文时：跟随最后一个选中项（VSCode 语义）
      const anchor =
        anchorPath && flatVisibleNodes.find((n) => n.path === anchorPath)
          ? flatVisibleNodes.find((n) => n.path === anchorPath)!
          : activeFilePath
          ? flatVisibleNodes.find((n) => n.path === activeFilePath) ?? null
          : null
      if (anchor) {
        if (anchor.isDirectory) return anchor.path
        const idx = anchor.path.lastIndexOf('/')
        return idx === -1 ? '' : anchor.path.slice(0, idx)
      }
      return ''
    },
    [activeFilePath, anchorPath, flatVisibleNodes]
  )

  const beginInlineCreate = useCallback(
    (type: 'file' | 'folder', contextNode: WorkbenchFileNode | null) => {
      const parentDir = resolveParentDir(contextNode)
      if (parentDir) {
        expandAncestors([parentDir])
      }
      setInlineCreate({ type, parentDir })
    },
    [resolveParentDir, expandAncestors]
  )

  const commitInlineCreate = useCallback(async () => {
    if (!inlineCreate || isCreating) return
    const fallback = inlineCreate.type === 'file' ? DEFAULT_FILE_NAME : DEFAULT_FOLDER_NAME
    const name = inlineInputValue.trim() || fallback
    setIsCreating(true)
    try {
      if (inlineCreate.type === 'file') {
        await createFile(inlineCreate.parentDir, name)
      } else {
        await createFolder(inlineCreate.parentDir, name)
      }
    } finally {
      setIsCreating(false)
      setInlineCreate(null)
    }
  }, [inlineCreate, inlineInputValue, isCreating, createFile, createFolder])

  // ---- 拖拽移动（VSCode 风格） ----
  const handleDragStart = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', node.path)
      // 拖已选中集合中的一项 → 整组移动；拖未选中项 → 改为单选并只拖它
      const paths =
        selectedPaths.has(node.path) && selectedPaths.size > 1
          ? Array.from(selectedPaths)
          : [node.path]
      if (!selectedPaths.has(node.path)) {
        setSelectedPaths(new Set([node.path]))
        setAnchorPath(node.path)
      }
      setDragState({ node, paths })
    },
    [selectedPaths]
  )

  const handleDragEnd = useCallback(() => {
    setDragState(null)
    setDropTargetDir(null)
    setIsRootDropActive(false)
  }, [])

  /** 判断 node 是否可作为当前拖拽的有效目标目录 */
  const isValidDropDir = useCallback(
    (node: WorkbenchFileNode): boolean => {
      if (!dragState || !node.isDirectory) return false
      // 不允许拖到任一被拖目录自身或其后代
      return !dragState.paths.some(
        (p) => node.path === p || node.path.startsWith(`${p}/`)
      )
    },
    [dragState]
  )

  /** 外部文件/文件夹拖入：目录节点 dragover（内部拖拽与外部文件共享高亮态） */
  const isExternalFileDrag = useCallback((e: React.DragEvent): boolean => {
    return !dragState && e.dataTransfer.types.includes('Files')
  }, [dragState])

  /** 拖到文件上 = 放入其父目录（VSCode 行为），返回父目录路径，无效则 null */
  const resolveFileDropParent = useCallback(
    (node: WorkbenchFileNode): string | null => {
      if (!dragState || node.isDirectory) return null
      if (dragState.paths.includes(node.path)) return null // 拖到被拖文件自身
      const idx = node.path.lastIndexOf('/')
      return idx === -1 ? '' : node.path.slice(0, idx)
    },
    [dragState]
  )

  const handleNodeDragOver = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
      // 外部文件拖入：目录节点直接作为目标
      if (isExternalFileDrag(e)) {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setDropTargetDir(node.path)
        setIsRootDropActive(false)
        return
      }
      if (!isValidDropDir(node)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropTargetDir(node.path)
      setIsRootDropActive(false)
    },
    [isValidDropDir, isExternalFileDrag]
  )

  const handleNodeDrop = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
      e.preventDefault()
      e.stopPropagation()
      // 外部文件/文件夹 → 复制进该目录
      if (isExternalFileDrag(e)) {
        const paths = collectLocalPaths(e.dataTransfer.files)
        if (paths.length) {
          expandAncestors([node.path])
          void importExternalItems(node.path, paths)
        }
        setDropTargetDir(null)
        return
      }
      if (isValidDropDir(node) && dragState) {
        expandAncestors([node.path])
        for (const p of dragState.paths) {
          void moveNode(p, node.path)
        }
      }
      handleDragEnd()
    },
    [isValidDropDir, dragState, expandAncestors, moveNode, handleDragEnd, isExternalFileDrag, importExternalItems]
  )

  const handleFileDragOver = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
      // 外部文件拖到文件上 → 落入其父目录
      if (isExternalFileDrag(e)) {
        const idx = node.path.lastIndexOf('/')
        const parent = idx === -1 ? '' : node.path.slice(0, idx)
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        if (parent) {
          setDropTargetDir(parent)
          setIsRootDropActive(false)
        } else {
          setDropTargetDir(null)
          setIsRootDropActive(true)
        }
        return
      }
      const parent = resolveFileDropParent(node)
      if (parent === null) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      // 文件本身不高亮，高亮其父目录（根目录则高亮容器）
      if (parent) {
        setDropTargetDir(parent)
        setIsRootDropActive(false)
      } else {
        setDropTargetDir(null)
        setIsRootDropActive(true)
      }
    },
    [resolveFileDropParent, isExternalFileDrag]
  )

  const handleFileDrop = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
      e.preventDefault()
      e.stopPropagation()
      if (isExternalFileDrag(e)) {
        const idx = node.path.lastIndexOf('/')
        const parent = idx === -1 ? '' : node.path.slice(0, idx)
        const paths = collectLocalPaths(e.dataTransfer.files)
        if (paths.length) void importExternalItems(parent, paths)
        setDropTargetDir(null)
        setIsRootDropActive(false)
        return
      }
      const parent = resolveFileDropParent(node)
      if (parent !== null && dragState) {
        for (const p of dragState.paths) {
          void moveNode(p, parent)
        }
      }
      handleDragEnd()
    },
    [resolveFileDropParent, dragState, moveNode, handleDragEnd, isExternalFileDrag, importExternalItems]
  )

  // 根目录空白区：拖到文件上时冒泡不触发（子节点已 stopPropagation），仅空白生效
  const handleRootDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isExternalFileDrag(e)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setIsRootDropActive(true)
        setDropTargetDir(null)
        return
      }
      if (!dragState) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsRootDropActive(true)
      setDropTargetDir(null)
    },
    [dragState, isExternalFileDrag]
  )

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (isExternalFileDrag(e)) {
        const paths = collectLocalPaths(e.dataTransfer.files)
        if (paths.length) void importExternalItems('', paths)
        setIsRootDropActive(false)
        setDropTargetDir(null)
        return
      }
      if (dragState) {
        for (const p of dragState.paths) {
          void moveNode(p, '')
        }
      }
      handleDragEnd()
    },
    [dragState, moveNode, handleDragEnd, isExternalFileDrag, importExternalItems]
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkbenchFileNode | null) => {
    e.preventDefault()
    e.stopPropagation()
    // VSCode：右键未选中节点时，先将其变为单选；已选中则保留多选作用于菜单
    if (node && !selectedPaths.has(node.path)) {
      setSelectedPaths(new Set([node.path]))
      setAnchorPath(node.path)
    }
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setContextMenu({ x, y, node })
  }, [selectedPaths])

  /** 粘贴（Ctrl+V / 系统粘贴）：把剪贴板中的本地文件复制进上下文目录（VSCode 语义） */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return // 文本/图片粘贴不接管（图片走编辑器插件）
      const paths = collectLocalPaths(files)
      if (!paths.length) return
      e.preventDefault()
      const parentDir = resolveParentDir(null)
      expandAncestors(parentDir ? [parentDir] : [])
      void importExternalItems(parentDir, paths)
    },
    [resolveParentDir, expandAncestors, importExternalItems]
  )

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!actionModal) return

    const { type, targetNode } = actionModal
    const trimmed = inputValue.trim()

    if (type === 'rename' && targetNode) {
      if (trimmed && trimmed !== targetNode.name) {
        const parts = targetNode.path.split('/')
        parts[parts.length - 1] = trimmed
        const newPath = parts.join('/')
        await renameNode(targetNode.path, newPath)
      }
    } else if (type === 'deleteMulti') {
      const targets = Array.from(selectedPaths)
      // 命中当前文档时走逐项删除：它会顺带把编辑器切到相邻文档；
      // 其余情况一次批量删除，主进程只清理一次、文件树只重扫一次。
      const hitsActive = !!activeFilePath && targets.some(p =>
        activeFilePath === p || activeFilePath.startsWith(`${p}/`))
      if (hitsActive) {
        for (const p of targets) await deleteNode(p)
      } else {
        await deleteNodes(targets)
      }
      setSelectedPaths(new Set())
    } else if (type === 'delete' && targetNode) {
      await deleteNode(targetNode.path)
    } else if (type === 'cleanImages' && targetNode) {
      const images = actionModal.unreferencedImages ?? []
      if (images.length) {
        await deleteNodes(images)
      }
    }

    setActionModal(null)
    setInputValue('')
  }

  // 递归渲染树节点
  const renderNode = (node: WorkbenchFileNode, level = 0) => {
    const isExpanded = expandedFolderIds.has(node.id)
    const isActive = activeFilePath === node.path

    if (node.isDirectory) {
      const children = node.children ? sortNodes(node.children) : []
      const showInlineHere = inlineCreate !== null && inlineCreate.parentDir === node.path
      const isDropTarget = dropTargetDir === node.path
      // assets/ 目录受管：显示特殊图标且不可拖拽（避免与文档附件目录联动逻辑冲突）
      const isManagedAssetsDir = node.path.split('/').includes('assets')
      return (
        <div key={node.id} className="select-none">
          <div
            draggable={!isManagedAssetsDir}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleNodeDragOver(e, node)}
            onDragLeave={() => setDropTargetDir((v) => (v === node.path ? null : v))}
            onDrop={(e) => handleNodeDrop(e, node)}
            onContextMenu={(e) => handleContextMenu(e, node)}
            onClick={(e) => handleNodeClick(e, node)}
            style={{ paddingLeft: `${level * 14 + 8}px` }}
            className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer text-sm transition-colors group ${
              isDropTarget
                ? 'bg-primary/15 ring-1 ring-inset ring-primary/50'
                : selectedPaths.has(node.path)
                ? 'bg-black/10 dark:bg-white/10'
                : 'hover:bg-black/5 dark:hover:bg-white/5'
            } text-text-primary`}
          >
            <span className="material-symbols-outlined text-[19px] text-text-secondary transition-transform duration-150">
              {isExpanded ? 'expand_more' : 'chevron_right'}
            </span>
            <span className={`material-symbols-outlined text-[19px] ${isManagedAssetsDir ? 'text-slate-400' : 'text-amber-500'}`}>
              {isManagedAssetsDir
                ? 'attachment'
                : isExpanded
                ? 'folder_open'
                : 'folder'}
            </span>
            <span className="truncate flex-1 font-medium">{node.name}</span>
          </div>
          {isExpanded && (
            <div>
              {showInlineHere && renderInlineInput(level + 1)}
              {children.length > 0 ? (
                children.map((child: WorkbenchFileNode) => renderNode(child, level + 1))
              ) : !showInlineHere ? (
                <div
                  style={{ paddingLeft: `${(level + 1) * 14 + 24}px` }}
                  className="py-1 text-sm text-text-secondary/60 italic"
                >
                  (空目录)
                </div>
              ) : null}
            </div>
          )}
        </div>
      )
    }

    // 文件节点
    return (
      <div
        key={node.id}
        data-file-node={node.path}
        draggable
        onDragStart={(e) => handleDragStart(e, node)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleFileDragOver(e, node)}
        onDrop={(e) => handleFileDrop(e, node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
        onClick={(e) => handleNodeClick(e, node)}
        style={{ paddingLeft: `${level * 14 + 24}px` }}
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer text-sm transition-colors group select-none ${
          isActive
            ? 'bg-blue-500/10 dark:bg-blue-500/20 text-primary dark:text-blue-400 font-medium'
            : selectedPaths.has(node.path)
            ? 'bg-black/10 dark:bg-white/10 text-text-primary'
            : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        {getFileCategory(node.name) === 'code' ? (
          <FileTypeIcon node={node} className="w-[19px] h-[19px]" />
        ) : (
          <span
            className={`material-symbols-outlined text-[19px] shrink-0 ${getNodeIcon(node).color}`}
          >
            {getNodeIcon(node).icon}
          </span>
        )}
        <span className="truncate flex-1">{node.name}</span>
        {isActive && isDirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="未保存的修改" />
        )}
      </div>
    )
  }

  /** 树内联新建输入框（VSCode 风格） */
  const renderInlineInput = (level: number) => {
    const isFile = inlineCreate?.type === 'file'
    return (
      <div
        style={{ paddingLeft: `${level * 14 + 24}px` }}
        className="flex items-center gap-1.5 py-0.5 px-2"
      >
        <span
          className={`material-symbols-outlined text-[19px] shrink-0 ${
            isFile ? 'text-blue-500 dark:text-blue-400' : 'text-amber-500'
          }`}
        >
          {isFile ? 'description' : 'folder'}
        </span>
        <input
          ref={inlineInputRef}
          type="text"
          value={inlineInputValue}
          onChange={(e) => setInlineInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commitInlineCreate()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setInlineCreate(null)
            }
          }}
          onBlur={() => void commitInlineCreate()}
          disabled={isCreating}
          placeholder={isFile ? DEFAULT_FILE_NAME : DEFAULT_FOLDER_NAME}
          className="flex-1 min-w-0 h-6 px-1.5 rounded border border-primary/60 bg-white dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>
    )
  }

  return (
    <div
      tabIndex={-1}
      className="flex flex-col h-full overflow-hidden text-sm select-none border-r border-black/5 dark:border-white/5 outline-none"
      onMouseDown={(e) => {
        // 点击任意处让容器获得焦点，从而能接收 paste 事件；不打断子元素交互
        if (e.target instanceof HTMLInputElement) return
        e.currentTarget.focus()
      }}
      onPaste={handlePaste}
    >
      {/* 头部：核心操作（左对齐）+ 侧边栏折叠开关（最右） */}
      <div className="h-12 px-3 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-0.5 text-text-secondary">
          <button
            type="button"
            onClick={() => setIsSearchMode(!isSearchMode)}
            className={`w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${
              isSearchMode ? 'text-primary bg-black/5 dark:bg-white/10' : ''
            }`}
            title="搜索笔记"
          >
            <span className="material-symbols-outlined text-[20px]">search</span>
          </button>
          <button
            type="button"
            onClick={() => beginInlineCreate('file', null)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="新建笔记"
          >
            <span className="material-symbols-outlined text-[20px]">note_add</span>
          </button>
          <button
            type="button"
            onClick={() => beginInlineCreate('folder', null)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="新建文件夹"
          >
            <span className="material-symbols-outlined text-[20px]">create_new_folder</span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSortMenuOpen((v) => !v)}
              className={`w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors ${
                isSortMenuOpen ? 'text-primary bg-black/5 dark:bg-white/10' : ''
              }`}
              title="排序方式"
            >
              <span className="material-symbols-outlined text-[20px]">sort</span>
            </button>
            {isSortMenuOpen && (
              <div
                ref={sortMenuRef}
                className="absolute top-full left-0 mt-1 z-50 min-w-[150px] py-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-sm animate-in fade-in zoom-in-95 duration-100"
              >
                {(Object.keys(SORT_LABELS) as SortMenuKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFileSort({ ...fileSort, key })
                      setIsSortMenuOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span className="flex-1">{SORT_LABELS[key]}</span>
                    {fileSort.key === key && (
                      <span className="material-symbols-outlined text-[18px] text-primary">check</span>
                    )}
                  </button>
                ))}
                <div className="my-1 border-t border-black/5 dark:border-white/5" />
                <button
                  type="button"
                  onClick={() => {
                    setFileSort({ ...fileSort, order: fileSort.order === 'asc' ? 'desc' : 'asc' })
                    setIsSortMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[18px] text-text-secondary">
                    {fileSort.order === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                  </span>
                  <span className="flex-1">{fileSort.order === 'asc' ? '升序' : '降序'}</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={collapseAllFolders}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="折叠全部"
          >
            <span className="material-symbols-outlined text-[20px]">unfold_less</span>
          </button>
          <button
            type="button"
            onClick={() => void loadFileTree()}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="刷新目录"
          >
            <span className={`material-symbols-outlined text-[20px] ${isLoadingTree ? 'animate-spin' : ''}`}>
              refresh
            </span>
          </button>
        </div>

        {/* 折叠侧边栏开关 */}
        <div className="flex items-center gap-0.5 text-text-secondary">
          <button
            type="button"
            onClick={toggleLeftCollapse}
            className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
            title="收起侧边栏"
            aria-label="收起侧边栏"
          >
            <span className="material-symbols-outlined text-base">left_panel_close</span>
          </button>
        </div>
      </div>

      {/* 搜索视图或树状文件列表 */}
      <div
        className={`flex-1 overflow-y-auto p-1.5 ${isRootDropActive ? 'bg-primary/5' : ''}`}
        onContextMenu={(e) => handleContextMenu(e, null)}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsRootDropActive(false)
          }
        }}
      >
        {isSearchMode ? (
          <WorkbenchSearch onClose={() => setIsSearchMode(false)} />
        ) : (
          <>
            {fileTree.length === 0 && !isLoadingTree && (
              <div className="py-10 text-center text-text-secondary/70">
                <span className="material-symbols-outlined text-3xl mb-2 opacity-40 block">folder_off</span>
                当前工作区为空，点击上方图标新建笔记
              </div>
            )}
            {inlineCreate && inlineCreate.parentDir === '' && renderInlineInput(0)}
            {sortedFileTree.map((node) => renderNode(node))}
          </>
        )}
      </div>

      {/* 底部：工作区切换与管理入口 */}
      <div className="relative shrink-0 border-t border-black/5 dark:border-white/5">
        <button
          type="button"
          onClick={() => setIsVaultMenuOpen((v) => !v)}
          className="w-full h-10 px-3 flex items-center gap-1.5 text-sm font-medium text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={workspacePath || ''}
        >
          <span className="material-symbols-outlined text-[19px] text-amber-500">folder_open</span>
          <span className="truncate flex-1 text-left">{workspaceName || '未选工作区'}</span>
          <span className="material-symbols-outlined text-[18px] text-text-secondary">unfold_more</span>
        </button>

        {isVaultMenuOpen && (
          <div
            ref={vaultMenuRef}
            className="absolute bottom-full left-1.5 right-1.5 mb-1 z-50 py-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-sm animate-in fade-in zoom-in-95 duration-100"
          >
            {defaultWorkspacePath && (() => {
              const p = defaultWorkspacePath
              const name = p.split(/[/\\]/).filter(Boolean).pop() || p
              const isCurrent = p === workspacePath
              return (
                <>
                  <button
                    key={p}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      setIsVaultMenuOpen(false)
                      void useWorkbenchStore.getState().setWorkspaceFolder(p, name)
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                      isCurrent
                        ? 'text-text-primary font-medium'
                        : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    title={p}
                  >
                    <span className="material-symbols-outlined text-[18px] text-primary">home</span>
                    <span className="truncate flex-1">{name}</span>
                    {isCurrent && (
                      <span className="material-symbols-outlined text-[18px] text-primary">check</span>
                    )}
                  </button>
                  <div className="my-1 border-t border-black/5 dark:border-white/5" />
                </>
              )
            })()}
            {recentWorkspaces.filter((p) => p !== defaultWorkspacePath).length === 0 && !workspacePath && (
              <div className="px-3 py-2 text-text-secondary/70 text-xs">暂无历史工作区</div>
            )}
            {recentWorkspaces.filter((p) => p !== defaultWorkspacePath).map((p) => {
              const name = p.split(/[/\\]/).filter(Boolean).pop() || p
              const isCurrent = p === workspacePath
              return (
                <button
                  key={p}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => {
                    setIsVaultMenuOpen(false)
                    void useWorkbenchStore.getState().setWorkspaceFolder(p, name)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isCurrent
                      ? 'text-text-primary font-medium'
                      : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                  title={p}
                >
                  <span className="truncate flex-1">{name}</span>
                  {isCurrent && (
                    <span className="material-symbols-outlined text-[18px] text-primary">check</span>
                  )}
                </button>
              )
            })}
            <div className="my-1 border-t border-black/5 dark:border-white/5" />
            <button
              type="button"
              onClick={() => {
                setIsVaultMenuOpen(false)
                setIsVaultManageOpen(true)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-[19px] text-text-secondary">folder_managed</span>
              <span>管理仓库…</span>
            </button>
          </div>
        )}
      </div>

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[170px] py-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-sm animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {(!contextMenu.node || contextMenu.node.isDirectory) && (
            <>
              <button
                type="button"
                onClick={() => {
                  beginInlineCreate('file', contextMenu.node)
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[19px] text-blue-500">note_add</span>
                <span>新建笔记</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  beginInlineCreate('folder', contextMenu.node)
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[19px] text-amber-500">create_new_folder</span>
                <span>新建文件夹</span>
              </button>
              <div className="my-1 border-t border-black/5 dark:border-white/5" />
            </>
          )}

          {contextMenu.node && (
            <>
              <button
                type="button"
                onClick={() => {
                  setInputValue(contextMenu.node?.name || '')
                  setActionModal({ type: 'rename', targetNode: contextMenu.node })
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[19px]">edit</span>
                <span>重命名</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (contextMenu.node) void revealFile(contextMenu.node.path)
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[19px]">folder</span>
                <span>在资源管理器中显示</span>
              </button>
              {!contextMenu.node.isDirectory && (
                <button
                  type="button"
                  onClick={() => {
                    if (contextMenu.node) void openInSystem(contextMenu.node.path)
                    setContextMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[19px]">open_in_new</span>
                  <span>使用系统默认程序打开</span>
                </button>
              )}
              {/* 仅 .md 文档：清理未引用图片 */}
              {contextMenu.node && !contextMenu.node.isDirectory && /\.(md|markdown)$/i.test(contextMenu.node.name) && (
                <button
                  type="button"
                  disabled={isCleaningImages}
                  onClick={async () => {
                    const node = contextMenu.node
                    if (!node) return
                    setContextMenu(null)
                    setIsCleaningImages(true)
                    try {
                      const result = await findUnreferencedImages(node.path)
                      if (!result) {
                        setActionModal(null)
                        return
                      }
                      if (!result.unreferenced.length) {
                        // 无可清理图片：轻提示复用现有 error 通道太重，直接弹确认框说明
                        setActionModal({
                          type: 'cleanImages',
                          targetNode: node,
                          unreferencedImages: []
                        })
                      } else {
                        setActionModal({
                          type: 'cleanImages',
                          targetNode: node,
                          unreferencedImages: result.unreferenced
                        })
                      }
                    } finally {
                      setIsCleaningImages(false)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[19px]">image_not_supported</span>
                  <span>{isCleaningImages ? '扫描中…' : '清理未引用图片'}</span>
                </button>
              )}
              <div className="my-1 border-t border-black/5 dark:border-white/5" />
              <button
                type="button"
                onClick={async () => {
                  const multi = selectedPaths.size > 1 && contextMenu.node && selectedPaths.has(contextMenu.node.path)
                  const targets = multi ? Array.from(selectedPaths) : contextMenu.node ? [contextMenu.node.path] : []
                  const impact = workspacePath && targets.length
                    ? await window.api.workbench.mindmapImpact(workspacePath, targets)
                    : null
                  setActionModal(
                    multi
                      ? { type: 'deleteMulti', targetNode: contextMenu.node, mindmapImpact: impact?.data }
                      : { type: 'delete', targetNode: contextMenu.node, mindmapImpact: impact?.data }
                  )
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
              >
                <span className="material-symbols-outlined text-[19px]">delete</span>
                <span>
                  {selectedPaths.size > 1 && contextMenu.node && selectedPaths.has(contextMenu.node.path)
                    ? `删除 ${selectedPaths.size} 项 (移至回收站)`
                    : '删除 (移至回收站)'}
                </span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 重命名 / 删除 弹窗 */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <form
            onSubmit={handleModalSubmit}
            className="w-[360px] p-5 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 flex flex-col gap-4 text-sm"
          >
            <div className="flex items-center justify-between font-semibold text-sm text-text-primary">
              <span>
                {actionModal.type === 'rename'
                  ? '重命名'
                  : actionModal.type === 'deleteMulti'
                  ? '确认批量删除'
                  : actionModal.type === 'cleanImages'
                  ? '清理未引用图片'
                  : '确认删除'}
              </span>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="text-text-secondary hover:text-text-primary"
              >
                <span className="material-symbols-outlined text-[19px]">close</span>
              </button>
            </div>

            {actionModal.type === 'deleteMulti' || actionModal.type === 'delete' ? (
              <div className="text-text-secondary text-sm leading-relaxed space-y-2">
                <p>
                  {actionModal.type === 'deleteMulti'
                    ? <>确定要将选中的 <strong className="text-text-primary">{selectedPaths.size}</strong> 项移至系统回收站吗？</>
                    : <>确定要将「<strong className="text-text-primary">{actionModal.targetNode?.name}</strong>」移至系统回收站吗？</>}
                </p>
                {!!actionModal.mindmapImpact?.mindmaps && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                    <p>
                      <strong>{actionModal.mindmapImpact.documents}</strong> 篇文档的{' '}
                      <strong>{actionModal.mindmapImpact.mindmaps}</strong> 张思维导图会一并删除，且无法恢复；
                      文档本身仍可从回收站还原。
                    </p>
                  </div>
                )}
              </div>
            ) : actionModal.type === 'cleanImages' ? (
              <div className="text-text-secondary text-sm leading-relaxed">
                {actionModal.unreferencedImages && actionModal.unreferencedImages.length > 0 ? (
                  <>
                    <p className="mb-2">
                      「<strong className="text-text-primary">{actionModal.targetNode?.name}</strong>」
                      的附件目录中有 <strong className="text-rose-500">{actionModal.unreferencedImages.length}</strong> 张图片未被文档引用：
                    </p>
                    <div className="max-h-[180px] overflow-y-auto rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2 font-mono text-xs">
                      {actionModal.unreferencedImages.map((p) => (
                        <div key={p} className="truncate py-0.5" title={p}>
                          {p.split('/').pop()}
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs">确认后将移至系统回收站（可恢复）。</p>
                  </>
                ) : (
                  <p>该文档的附件目录中没有未引用的图片。</p>
                )}
              </div>
            ) : (
              <div>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="请输入名称..."
                  className="w-full h-8 px-3 rounded-lg border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/5 focus:bg-white dark:focus:bg-gray-900 text-text-primary focus:outline-none focus:border-primary text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={actionModal.type === 'cleanImages' && !(actionModal.unreferencedImages?.length)}
                className={`px-3 py-1.5 rounded-lg text-white font-medium shadow-xs ${
                  actionModal.type === 'delete' || actionModal.type === 'deleteMulti' || actionModal.type === 'cleanImages'
                    ? 'bg-rose-500 hover:bg-rose-600'
                    : 'bg-primary hover:bg-primary/90'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {actionModal.type === 'delete' || actionModal.type === 'deleteMulti'
                  ? '确认移入回收站'
                  : actionModal.type === 'cleanImages'
                  ? `清理 ${actionModal.unreferencedImages?.length ?? 0} 张`
                  : '确定'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 管理仓库弹窗：列出最近工作区、切换/移除、打开新目录、关闭当前工作区 */}
      {isVaultManageOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs"
          onClick={() => setIsVaultManageOpen(false)}
        >
          <div
            className="w-[420px] max-h-[480px] p-5 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 flex flex-col gap-4 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between font-semibold text-sm text-text-primary">
              <span>管理仓库</span>
              <button
                type="button"
                onClick={() => setIsVaultManageOpen(false)}
                className="text-text-secondary hover:text-text-primary"
              >
                <span className="material-symbols-outlined text-[19px]">close</span>
              </button>
            </div>

            <div className="flex-1 min-h-[120px] overflow-y-auto -mx-2 px-2 flex flex-col gap-1">
              {defaultWorkspacePath && (
                <>
                  <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium text-text-secondary/70 tracking-wide">
                    默认仓库
                  </div>
                  {(() => {
                    const p = defaultWorkspacePath
                    const name = p.split(/[/\\]/).filter(Boolean).pop() || p
                    const isCurrent = p === workspacePath
                    return (
                      <div
                        key={p}
                        className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                          isCurrent
                            ? 'bg-primary/10'
                            : 'hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[19px] text-primary">home</span>
                        <button
                          type="button"
                          disabled={isCurrent}
                          onClick={() => {
                            setIsVaultManageOpen(false)
                            void useWorkbenchStore.getState().setWorkspaceFolder(p, name)
                          }}
                          className="flex-1 min-w-0 text-left"
                          title={p}
                        >
                          <div className="font-medium text-text-primary truncate">{name}</div>
                          <div className="text-xs text-text-secondary truncate">{p}</div>
                        </button>
                        {isCurrent && (
                          <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                        )}
                      </div>
                    )
                  })()}
                  <div className="my-1 border-t border-black/5 dark:border-white/5" />
                </>
              )}
              {recentWorkspaces.filter((p) => p !== defaultWorkspacePath).length === 0 && (
                <div className="py-8 text-center text-text-secondary/70 text-xs">
                  暂无历史工作区
                </div>
              )}
              {recentWorkspaces.filter((p) => p !== defaultWorkspacePath).map((p) => {
                const name = p.split(/[/\\]/).filter(Boolean).pop() || p
                const isCurrent = p === workspacePath
                return (
                  <div
                    key={p}
                    className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                      isCurrent
                        ? 'bg-primary/10'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[19px] text-amber-500">folder</span>
                    <button
                      type="button"
                      disabled={isCurrent}
                      onClick={() => {
                        setIsVaultManageOpen(false)
                        void useWorkbenchStore.getState().setWorkspaceFolder(p, name)
                      }}
                      className="flex-1 min-w-0 text-left"
                      title={p}
                    >
                      <div className="font-medium text-text-primary truncate">{name}</div>
                      <div className="text-xs text-text-secondary truncate">{p}</div>
                    </button>
                    {isCurrent && (
                      <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRecentWorkspace(p)}
                      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-text-secondary opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 hover:text-rose-500 transition-all"
                      title="从列表移除"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-col gap-2 pt-1 border-t border-black/5 dark:border-white/5">
              <button
                type="button"
                onClick={() => {
                  setIsVaultManageOpen(false)
                  void selectWorkspaceFolder()
                }}
                className="w-full h-9 px-3 rounded-lg bg-primary text-white hover:bg-primary/90 font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">folder_open</span>
                <span>选择其他文件夹…</span>
              </button>
              {workspacePath && workspacePath !== defaultWorkspacePath && (
                <button
                  type="button"
                  onClick={() => {
                    setIsVaultManageOpen(false)
                    void closeWorkspace()
                  }}
                  className="w-full h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 dark:hover:bg-rose-950/20 dark:hover:border-rose-900/40 dark:hover:text-rose-400 text-text-secondary flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                  <span>关闭当前工作区</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
