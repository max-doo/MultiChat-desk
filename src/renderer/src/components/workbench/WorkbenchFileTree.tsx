import { memo, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { getFileCategory, MARKDOWN_EXTENSIONS, type WorkbenchFileNode } from '../../../../shared/types/workbench'
import {
  GIT_BADGE_STYLES,
  mergeGitBadgeCodes,
  resolveFileGitBadge,
  type GitBadgeCode,
  type GitStatusBadgeMeta as GitBadge
} from '../../utils/gitStatusBadge'
import WorkbenchSearch from './WorkbenchSearch'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchGitPanel from './WorkbenchGitPanel'
import WorkbenchVaultPopover from './WorkbenchVaultPopover'
import WorkbenchWorkspaceSettings from './WorkbenchWorkspaceSettings'
import { AppIcon, type AppIconName } from '../icons/AppIcon'
import Modal from '../ui/Modal'
import { Button } from '../ui/FormControls'
import { requestUploadNodesToAi } from './workbenchAiEvents'

/**
 * 基于已加载文件树判断 Markdown 文档是否存在托管附件（`<同级>/assets/<文档名>/` 下至少有 1 个文件）。
 * 零 I/O 且同步返回，避免右键菜单异步跳动；若用户主动在 `.gitignore` 中忽略了 `assets/`，仍可通过工作区设置批量扫描兜底。
 */
function hasManagedDocumentAssets(tree: WorkbenchFileNode[], node: WorkbenchFileNode): boolean {
  if (node.isDirectory) return false
  const ext = `.${node.name.split('.').pop()?.toLowerCase() ?? ''}`
  if (!MARKDOWN_EXTENSIONS.has(ext)) return false
  if (node.path.split('/').includes('assets')) return false

  const slashIdx = node.path.lastIndexOf('/')
  let siblings = tree
  if (slashIdx !== -1) {
    const dirSegments = node.path.slice(0, slashIdx).split('/')
    for (const segment of dirSegments) {
      const dirNode = siblings.find((item) => item.isDirectory && item.name === segment)
      if (!dirNode?.children) return false
      siblings = dirNode.children
    }
  }

  const assetsDir = siblings.find((item) => item.isDirectory && item.name === 'assets')
  const docAssetsDir = assetsDir?.children?.find(
    (item) => item.isDirectory && item.name === node.name
  )
  return Boolean(docAssetsDir?.children?.some((item) => !item.isDirectory))
}

/** 新建节点输入框默认占位名，提交时若用户未修改则使用 */
const DEFAULT_FILE_NAME = '未命名笔记.md'
const DEFAULT_FOLDER_NAME = '新建文件夹'
/** 左侧栏窄于该宽度时底栏切换为紧凑模式（隐藏 Git 分支名并收紧留白），确保工作区名称可读 */
const COMPACT_FOOTER_WIDTH_THRESHOLD = 320

function resolveMultichatFolderVisual(
  nodePath: string
): { icon: AppIconName; colorClass: string } | null {
  const normalized = nodePath.replace(/\\/g, '/').toLowerCase()
  if (normalized === '.multichat') {
    return { icon: 'folder_managed', colorClass: 'text-slate-500 dark:text-slate-400' }
  }
  if (normalized === '.multichat/image' || normalized === '.multichat/images') {
    return { icon: 'image', colorClass: 'text-sky-500' }
  }
  if (normalized === '.multichat/mindmap' || normalized === '.multichat/mindmaps') {
    return { icon: 'diagram_flow_horizontal', colorClass: 'text-indigo-500' }
  }
  if (normalized === '.multichat/annotation' || normalized === '.multichat/annotations') {
    return { icon: 'annotation', colorClass: 'text-emerald-500' }
  }
  return null
}

interface ContextMenuState {
  x: number
  y: number
  node: WorkbenchFileNode | null
}

interface ActionModalState {
  type: 'delete' | 'deleteMulti' | 'cleanImages'
  targetNode: WorkbenchFileNode | null
  defaultValue?: string
  // cleanImages 用：待清理的未引用图片列表
  unreferencedImages?: string[]
  // 删除确认用：关联的文档数与导图数，用于提前告知绑定会如何处理
  mindmapImpact?: { documents: number; mindmaps: number }
  // 删除确认用：即将一起删除的文档标注条数
  annotationCount?: number
}

/**
 * 树内联"新建"输入框状态（VSCode 风格）
 * parentDir 为目标父目录的相对路径，'' 表示根目录
 */
interface InlineCreateState {
  type: 'file' | 'folder'
  parentDir: string
}

interface InlineRenameState {
  node: WorkbenchFileNode
}

/**
 * 计算重命名时的初始选中区间（VSCode 风格：文件选中除去后缀名的基本名，避免用户误删后缀名；文件夹/无后缀文件全选）
 */
export function getRenameSelectionRange(name: string, isDirectory: boolean): [number, number] {
  if (isDirectory) {
    return [0, name.length]
  }
  const lastDot = name.lastIndexOf('.')
  if (lastDot > 0) {
    return [0, lastDot]
  }
  return [0, name.length]
}

interface DragState {
  node: WorkbenchFileNode
  /** 参与拖拽的全部路径（多选时为整组，单选时仅自身） */
  paths: string[]
}

/** 树内剪贴板：记录待粘贴节点的相对路径与剪切/复制模式，用于失效检测 */
interface TreeClipboard {
  paths: string[]
  mode: 'copy' | 'cut'
}

/** 从拖拽/粘贴的 File 对象提取本地绝对路径（Electron：.path 或 webUtils.getPathForFile） */
export function extractLocalPath(file: File): string {
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
export function collectLocalPaths(files: FileList | File[] | null | undefined): string[] {
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

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif', '.tiff', '.tif'
])

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

interface TreeSortOption {
  key: SortMenuKey
  order: 'asc' | 'desc'
}

function sortNodeList(nodes: WorkbenchFileNode[], fileSort: TreeSortOption): WorkbenchFileNode[] {
  const { key, order } = fileSort
  const dir = order === 'asc' ? 1 : -1
  return [...nodes].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    if (key === 'name') {
      return dir * NAME_COLLATOR.compare(a.name, b.name)
    }
    if (key === 'mtime') {
      return dir * ((a.mtime ?? 0) - (b.mtime ?? 0))
    }
    // size：目录没有 size 概念，统一按名称排序保持一致体验
    if (!a.isDirectory && !b.isDirectory) {
      const diff = (a.size ?? 0) - (b.size ?? 0)
      if (diff !== 0) return dir * diff
    }
    return NAME_COLLATOR.compare(a.name, b.name)
  })
}

function sortTreeNodes(nodes: WorkbenchFileNode[], fileSort: TreeSortOption): WorkbenchFileNode[] {
  return sortNodeList(nodes, fileSort).map((node) =>
    node.isDirectory && node.children && node.children.length > 0
      ? { ...node, children: sortTreeNodes(node.children, fileSort) }
      : node
  )
}


function getNodeIcon(node: WorkbenchFileNode): { icon: string; color: string } {
  if (node.isDirectory) {
    return { icon: 'folder', color: 'text-amber-500' }
  }

  const ext = (node.extension || '').toLowerCase()

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return { icon: 'description', color: 'text-blue-500 dark:text-blue-400' }
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return { icon: 'image', color: 'text-purple-500 dark:text-purple-400' }
  }

  if (ext === '.svg') {
    return { icon: 'draw', color: 'text-purple-500 dark:text-purple-400' }
  }

  return { icon: 'draft', color: 'text-text-secondary/70' }
}

interface InlineCreateInputProps {
  type: 'file' | 'folder'
  level: number
  isCreating: boolean
  onCommit: (value: string) => void
  onCancel: () => void
}

/** 独立管理输入状态的新建输入框，避免键入时重渲染整棵文件树 */
const InlineCreateInput = memo(function InlineCreateInput({
  type,
  level,
  isCreating,
  onCommit,
  onCancel
}: InlineCreateInputProps): JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancelledRef = useRef(false)
  const submittedRef = useRef(false)
  const isFile = type === 'file'

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      style={{ paddingLeft: `${level * 14 + (isFile ? 24 : 8)}px` }}
      className="flex items-center gap-1.5 py-1 px-2"
    >
      {!isFile && <span className="w-[19px] h-[19px] shrink-0" />}
      {isFile && (
        <AppIcon name="description" size={19} className="shrink-0 text-blue-500 dark:text-blue-400" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.nativeEvent.isComposing) return
            e.preventDefault()
            submittedRef.current = true
            onCommit(value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelledRef.current = true
            onCancel()
          }
        }}
        onBlur={() => {
          if (cancelledRef.current || submittedRef.current) return
          submittedRef.current = true
          onCommit(value)
        }}
        disabled={isCreating}
        placeholder={isFile ? DEFAULT_FILE_NAME : DEFAULT_FOLDER_NAME}
        className="flex-1 min-w-0 h-6 px-1.5 rounded-sm border border-primary/70 bg-white dark:bg-gray-900 text-text-primary text-body focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
    </div>
  )
})

interface InlineRenameInputProps {
  initialName: string
  isDirectory: boolean
  isBusy: boolean
  onCommit: (value: string) => void
  onCancel: () => void
}

/** 独立管理输入状态的重命名输入框，避免键入时重渲染整棵文件树 */
const InlineRenameInput = memo(function InlineRenameInput({
  initialName,
  isDirectory,
  isBusy,
  onCommit,
  onCancel
}: InlineRenameInputProps): JSX.Element {
  const [value, setValue] = useState(initialName)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancelledRef = useRef(false)
  const submittedRef = useRef(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.scrollIntoView({ block: 'nearest' })
      input.focus()
      const [start, end] = getRenameSelectionRange(initialName, isDirectory)
      input.setSelectionRange(start, end)
    })
    return () => cancelAnimationFrame(raf)
  }, [initialName, isDirectory])

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (e.nativeEvent.isComposing) return
          e.preventDefault()
          e.stopPropagation()
          submittedRef.current = true
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancelledRef.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (cancelledRef.current || submittedRef.current) return
        submittedRef.current = true
        onCommit(value)
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      disabled={isBusy}
      className="flex-1 min-w-0 h-6 px-1.5 rounded-sm border border-primary/70 bg-white dark:bg-gray-900 text-text-primary text-body focus:outline-none focus:ring-1 focus:ring-primary/40"
    />
  )
})

interface FileTreeRowProps {
  node: WorkbenchFileNode
  level: number
  isExpanded: boolean
  isSelected: boolean
  isActive: boolean
  isRenaming: boolean
  isRenamingBusy: boolean
  isDropTarget: boolean
  isCut: boolean
  gitBadge: GitBadge | null
  onNodeClick: (e: React.MouseEvent, node: WorkbenchFileNode) => void
  onNodeDoubleClick: (node: WorkbenchFileNode) => void
  onContextMenu: (e: React.MouseEvent, node: WorkbenchFileNode) => void
  onDragStart: (e: React.DragEvent, node: WorkbenchFileNode) => void
  onDragEnd: () => void
  onNodeDragOver: (e: React.DragEvent, node: WorkbenchFileNode) => void
  onNodeDragLeave: (node: WorkbenchFileNode) => void
  onNodeDrop: (e: React.DragEvent, node: WorkbenchFileNode) => void
  onFileDragOver: (e: React.DragEvent, node: WorkbenchFileNode) => void
  onFileDrop: (e: React.DragEvent, node: WorkbenchFileNode) => void
  onCommitRename: (value: string) => void
  onCancelRename: () => void
}

const FileTreeRow = memo(function FileTreeRow({
  node,
  level,
  isExpanded,
  isSelected,
  isActive,
  isRenaming,
  isRenamingBusy,
  isDropTarget,
  isCut,
  gitBadge,
  onNodeClick,
  onNodeDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onNodeDragOver,
  onNodeDragLeave,
  onNodeDrop,
  onFileDragOver,
  onFileDrop,
  onCommitRename,
  onCancelRename
}: FileTreeRowProps): JSX.Element {
  // 仅当前激活文件行订阅 isDirty，编辑器变脏/保存不再重渲染整棵树
  const isDirty = useWorkbenchStore((s) => (isActive && !node.isDirectory ? s.isDirty : false))
  // 剪切中的条目半透明（业界惯例），选择高亮不受影响
  const cutDimClass = isCut && !isRenaming ? 'opacity-50' : ''

  const gitBadgeElement = gitBadge ? (
    <span
      className={`ml-auto shrink-0 text-caption font-semibold leading-none ${gitBadge.colorClass}`}
      title={`Git: ${gitBadge.label}`}
    >
      {gitBadge.letter}
    </span>
  ) : null

  if (node.isDirectory) {
    // assets/ 目录受管：不可拖拽（避免与文档附件目录联动逻辑冲突）
    const isManagedAssetsDir = node.path.split('/').includes('assets')
    const isAssetsDirRoot = node.path.split('/').pop() === 'assets'
    const multichatVisual = resolveMultichatFolderVisual(node.path)

    return (
      <div
        draggable={!isManagedAssetsDir && !multichatVisual && !isRenaming}
        data-folder-node={node.path}
        onDragStart={(e) => onDragStart(e, node)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onNodeDragOver(e, node)}
        onDragLeave={() => onNodeDragLeave(node)}
        onDrop={(e) => onNodeDrop(e, node)}
        onContextMenu={(e) => {
          if (isRenaming) return
          onContextMenu(e, node)
        }}
        onClick={(e) => {
          if (isRenaming) return
          onNodeClick(e, node)
        }}
        title={
          isManagedAssetsDir
            ? '附件目录：文档图片等资产由应用自动管理'
            : multichatVisual
            ? '应用数据目录：导图、标注等数据由应用自动管理'
            : undefined
        }
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        className={`select-none flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-body transition-colors group ${
          isDropTarget
            ? 'bg-primary/15 ring-1 ring-inset ring-primary/50'
            : isSelected || isRenaming
            ? 'bg-black/10 dark:bg-white/10'
            : 'hover:bg-black/5 dark:hover:bg-white/5'
        } text-text-primary`}
      >
        <AppIcon
          name={isExpanded ? 'expand_more' : 'chevron_right'}
          size={19}
          className="text-text-secondary transition-transform duration-150 shrink-0"
        />
        {isRenaming ? (
          <InlineRenameInput
            initialName={node.name}
            isDirectory={true}
            isBusy={isRenamingBusy}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          <>
            {multichatVisual && (
              <AppIcon
                name={multichatVisual.icon}
                size={15}
                className={`shrink-0 ${multichatVisual.colorClass}`}
              />
            )}
            {isAssetsDirRoot && (
              <AppIcon name="attachment" size={15} className="shrink-0 text-slate-400" />
            )}
            <span
              className={`truncate min-w-0 font-medium ${cutDimClass} ${
                multichatVisual ? 'text-text-secondary/70' : ''
              }`}
            >
              {node.name}
            </span>
            {gitBadgeElement}
          </>
        )}
      </div>
    )
  }

  const ext = (node.extension || '').toLowerCase()
  const useAppIcon = MARKDOWN_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext) || ext === '.svg'
  const iconVisual = useAppIcon ? getNodeIcon(node) : null

  return (
    <div
      data-file-node={node.path}
      draggable={!isRenaming}
      onDragStart={(e) => onDragStart(e, node)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onFileDragOver(e, node)}
      onDrop={(e) => onFileDrop(e, node)}
      onContextMenu={(e) => {
        if (isRenaming) return
        onContextMenu(e, node)
      }}
      onClick={(e) => {
        if (isRenaming) return
        onNodeClick(e, node)
      }}
      onDoubleClick={(e) => {
        if (isRenaming) return
        e.stopPropagation()
        onNodeDoubleClick(node)
      }}
      style={{ paddingLeft: `${level * 14 + 24}px` }}
      className={`flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-body transition-colors group select-none ${
        isActive
          ? 'bg-blue-500/10 dark:bg-blue-500/20 text-primary dark:text-blue-400 font-medium'
          : isSelected || isRenaming
          ? 'bg-black/10 dark:bg-white/10 text-text-primary'
          : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {iconVisual ? (
        <AppIcon name={iconVisual.icon} size={19} className={`shrink-0 ${iconVisual.color} ${cutDimClass}`} />
      ) : (
        <span className={cutDimClass}>
          <FileTypeIcon node={node} className="w-[19px] h-[19px] shrink-0" />
        </span>
      )}
      {isRenaming ? (
        <InlineRenameInput
          initialName={node.name}
          isDirectory={false}
          isBusy={isRenamingBusy}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <>
          <span className={`truncate flex-1 ${cutDimClass}`}>{node.name}</span>
          {isActive && isDirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="未保存的修改" />
          )}
          {gitBadgeElement}
        </>
      )}
    </div>
  )
})

type VisibleTreeRow =
  | { kind: 'node'; node: WorkbenchFileNode; level: number; isExpanded: boolean }
  | { kind: 'inlineCreate'; key: string; type: 'file' | 'folder'; level: number }
  | { kind: 'empty'; key: string; level: number }

function WorkbenchFileTree(): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const workspaceName = useWorkbenchStore((s) => s.workspaceName)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const expandedFolderIds = useWorkbenchStore((s) => s.expandedFolderIds)
  const isLoadingTree = useWorkbenchStore((s) => s.isLoadingTree)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const leftPaneWidth = useWorkbenchStore((s) => s.leftPaneWidth)
  const isCompactFooter = leftPaneWidth < COMPACT_FOOTER_WIDTH_THRESHOLD
  const gitChanges = useWorkbenchStore((s) => (s.gitStatus?.isRepository ? s.gitStatus.changes : null))

  const loadFileTree = useWorkbenchStore((s) => s.loadFileTree)
  const toggleFolder = useWorkbenchStore((s) => s.toggleFolder)
  const collapseAllFolders = useWorkbenchStore((s) => s.collapseAllFolders)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const createFile = useWorkbenchStore((s) => s.createFile)
  const createFolder = useWorkbenchStore((s) => s.createFolder)
  const renameNode = useWorkbenchStore((s) => s.renameNode)
  const deleteNode = useWorkbenchStore((s) => s.deleteNode)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const fileSort = useWorkbenchStore((s) => s.fileSort)
  const setFileSort = useWorkbenchStore((s) => s.setFileSort)
  const moveNodes = useWorkbenchStore((s) => s.moveNodes)
  const findUnreferencedImages = useWorkbenchStore((s) => s.findUnreferencedImages)
  const deleteNodes = useWorkbenchStore((s) => s.deleteNodes)
  const importExternalItems = useWorkbenchStore((s) => s.importExternalItems)
  const moveExternalItems = useWorkbenchStore((s) => s.moveExternalItems)
  const moveToWorkspace = useWorkbenchStore((s) => s.moveToWorkspace)
  const recentWorkspaces = useWorkbenchStore((s) => s.recentWorkspaces)
  const defaultWorkspacePath = useWorkbenchStore((s) => s.defaultWorkspacePath)
  const setDraggingNodes = useWorkbenchStore((s) => s.setDraggingNodes)

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null)
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null)
  const [isRootDropActive, setIsRootDropActive] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [anchorPath, setAnchorPath] = useState<string | null>(null)
  const [treeClipboard, setTreeClipboard] = useState<TreeClipboard | null>(null)
  const [isVaultMenuOpen, setIsVaultMenuOpen] = useState(false)
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; maxHeight?: number; flippedY?: boolean } | null>(null)
  const [moveMenuPos, setMoveMenuPos] = useState<{ left: number; top: number; maxHeight: number; flippedX?: boolean } | null>(null)

  const [isWorkspaceSettingsOpen, setIsWorkspaceSettingsOpen] = useState(false)
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [inlineRename, setInlineRename] = useState<InlineRenameState | null>(null)
  const [isRenamingBusy, setIsRenamingBusy] = useState(false)
  const [isCleaningImages, setIsCleaningImages] = useState(false)
  const searchButtonRef = useRef<HTMLButtonElement | null>(null)
  const isRenamingBusyRef = useRef(false)
  const isCreatingRef = useRef(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const moveTriggerRef = useRef<HTMLDivElement | null>(null)
  const moveMenuRef = useRef<HTMLDivElement | null>(null)
  // 子菜单 portal 到 body 后与触发项不再是 DOM 父子，移出触发项用短延迟关闭；
  // 指针斜向进入子菜单或穿过间隙时，由子菜单/触发项的 mouseenter 取消这次关闭
  const moveCloseTimerRef = useRef<number | null>(null)
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)

  const cancelMoveMenuClose = useCallback(() => {
    if (moveCloseTimerRef.current !== null) {
      window.clearTimeout(moveCloseTimerRef.current)
      moveCloseTimerRef.current = null
    }
  }, [])

  const closeMoveMenuNow = useCallback(() => {
    cancelMoveMenuClose()
    setIsMoveMenuOpen(false)
  }, [cancelMoveMenuClose])

  const scheduleMoveMenuClose = useCallback(() => {
    cancelMoveMenuClose()
    moveCloseTimerRef.current = window.setTimeout(() => {
      moveCloseTimerRef.current = null
      setIsMoveMenuOpen(false)
    }, 250)
  }, [cancelMoveMenuClose])

  const fileTreeRef = useRef(fileTree)
  fileTreeRef.current = fileTree
  const selectedPathsRef = useRef(selectedPaths)
  selectedPathsRef.current = selectedPaths
  const anchorPathRef = useRef(anchorPath)
  anchorPathRef.current = anchorPath
  const dragStateRef = useRef(dragState)
  dragStateRef.current = dragState
  const inlineCreateRef = useRef(inlineCreate)
  inlineCreateRef.current = inlineCreate
  const inlineRenameRef = useRef(inlineRename)
  inlineRenameRef.current = inlineRename

  // 切换工作区/文件树刷新时清理失效选中与内联命名态
  useEffect(() => {
    setSelectedPaths(new Set())
    setAnchorPath(null)
    setTreeClipboard(null)
    setInlineCreate(null)
    setInlineRename(null)
  }, [workspacePath])

  const handleSearchToggle = useCallback(() => {
    if (!isSearchMode) {
      setIsSearchMode(true)
      return
    }

    const searchInput = document.querySelector<HTMLInputElement>('[data-workbench-search-input]')
    searchInput?.focus()
  }, [isSearchMode])

  const closeSearch = useCallback(() => {
    setIsSearchMode(false)
    requestAnimationFrame(() => searchButtonRef.current?.focus())
  }, [])

  // 外部动作（修改摘要卡片 / 工具调用文件名）打开文件后，让树跟随定位：
  // openFile 已展开祖先目录，这里等 DOM 更新后把节点滚进视野。
  useEffect(() => {
    if (!activeFilePath || isSearchMode) return
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-file-node="${CSS.escape(activeFilePath)}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [activeFilePath, isSearchMode, fileTree])

  // 文件树重扫后校验剪贴板快照：复制过的节点可能已被删除/移动，逐条剔除失效项
  useEffect(() => {
    setTreeClipboard((prev) => {
      if (!prev) return prev
      const alive = new Set<string>()
      const walk = (nodes: WorkbenchFileNode[]): void => {
        for (const n of nodes) {
          alive.add(n.path)
          if (n.children) walk(n.children)
        }
      }
      walk(fileTree)
      const paths = prev.paths.filter((p) => alive.has(p))
      if (!paths.length) return null
      if (paths.length === prev.paths.length) return prev
      return { ...prev, paths }
    })
  }, [fileTree])

  // 右键菜单定位：绘制前按真实尺寸裁剪到窗口安全边距内，靠底部时优先向上展开
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) {
      setMenuPos(null)
      return
    }
    const EDGE = 8
    const rect = menuRef.current.getBoundingClientRect()
    const maxH = Math.max(120, window.innerHeight - EDGE * 2)
    const effectiveHeight = Math.min(rect.height, maxH)
    const left = Math.max(EDGE, Math.min(contextMenu.x, window.innerWidth - rect.width - EDGE))
    let top = contextMenu.y
    if (top + effectiveHeight + EDGE > window.innerHeight) {
      const flippedTop = contextMenu.y - effectiveHeight
      top =
        flippedTop >= EDGE
          ? flippedTop
          : Math.max(EDGE, window.innerHeight - effectiveHeight - EDGE)
    }
    setMenuPos({
      left,
      top,
      maxHeight: rect.height > maxH ? maxH : undefined,
      flippedY: top < contextMenu.y - 8
    })
  }, [contextMenu])

  // "移动到其他工作区"子菜单定位：同样按真实尺寸贴合触发项并防溢出视口
  useLayoutEffect(() => {
    if (!contextMenu || !isMoveMenuOpen || !moveTriggerRef.current || !moveMenuRef.current) {
      setMoveMenuPos(null)
      return
    }
    const EDGE = 8
    const triggerRect = moveTriggerRef.current.getBoundingClientRect()
    const subRect = moveMenuRef.current.getBoundingClientRect()
    const maxHeight = Math.min(280, Math.max(120, window.innerHeight - EDGE * 2))
    const effectiveHeight = Math.min(subRect.height, maxHeight)
    const flippedX = triggerRect.right + subRect.width + EDGE > window.innerWidth
    const left = !flippedX
      ? triggerRect.right
      : Math.max(EDGE, triggerRect.left - subRect.width)
    const top = Math.max(
      EDGE,
      Math.min(triggerRect.top - 4, window.innerHeight - effectiveHeight - EDGE)
    )
    setMoveMenuPos({ left, top, maxHeight, flippedX })
  }, [contextMenu, isMoveMenuOpen, menuPos])

  // 右键菜单关闭或组件卸载时，清掉子菜单挂起的延迟关闭
  useEffect(() => {
    if (!contextMenu) cancelMoveMenuClose()
    return cancelMoveMenuClose
  }, [contextMenu, cancelMoveMenuClose])

  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const inMenu = menuRef.current?.contains(target)
      const inSubmenu = moveMenuRef.current?.contains(target)
      if (!inMenu && !inSubmenu) setContextMenu(null)
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

  const sortedFileTree = useMemo(() => sortTreeNodes(fileTree, fileSort), [fileTree, fileSort])

  const gitFileBadges = useMemo(() => {
    const map = new Map<string, GitBadge>()
    if (!gitChanges) return map
    for (const change of gitChanges) {
      map.set(change.path, resolveFileGitBadge(change))
      if (change.oldPath && !map.has(change.oldPath)) {
        map.set(change.oldPath, resolveFileGitBadge(change))
      }
    }
    return map
  }, [gitChanges])

  const gitDirBadges = useMemo(() => {
    const dirCodes = new Map<string, Set<GitBadgeCode>>()
    for (const [filePath, badge] of gitFileBadges) {
      const lastSlash = filePath.lastIndexOf('/')
      let dir = lastSlash === -1 ? '' : filePath.slice(0, lastSlash)
      while (dir) {
        let codes = dirCodes.get(dir)
        if (!codes) {
          codes = new Set()
          dirCodes.set(dir, codes)
        }
        codes.add(badge.letter)
        const idx = dir.lastIndexOf('/')
        dir = idx === -1 ? '' : dir.slice(0, idx)
      }
    }
    const map = new Map<string, GitBadge>()
    for (const [dir, codes] of dirCodes) {
      const code = mergeGitBadgeCodes(codes)
      if (!code) continue
      map.set(dir, GIT_BADGE_STYLES[code])
    }
    return map
  }, [gitFileBadges])

  const moveTargets = useMemo(() => {
    const seen = new Set<string>()
    const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const current = workspacePath ? normalize(workspacePath) : ''
    const out: Array<{ path: string; name: string }> = []
    for (const candidate of [defaultWorkspacePath, ...recentWorkspaces]) {
      if (!candidate || !candidate.trim()) continue
      const key = normalize(candidate)
      if (key === current || seen.has(key)) continue
      seen.add(key)
      out.push({ path: candidate, name: candidate.split(/[/\\]/).filter(Boolean).pop() || candidate })
    }
    return out
  }, [defaultWorkspacePath, recentWorkspaces, workspacePath])

  const flatVisibleNodes = useMemo(() => {
    const out: WorkbenchFileNode[] = []
    const walk = (nodes: WorkbenchFileNode[]) => {
      for (const n of nodes) {
        out.push(n)
        if (n.isDirectory && expandedFolderIds.has(n.id) && n.children) {
          walk(n.children)
        }
      }
    }
    walk(sortedFileTree)
    return out
  }, [sortedFileTree, expandedFolderIds])

  const flatVisibleNodesRef = useRef(flatVisibleNodes)
  flatVisibleNodesRef.current = flatVisibleNodes

  const visibleRows = useMemo<VisibleTreeRow[]>(() => {
    const rows: VisibleTreeRow[] = []
    if (inlineCreate && inlineCreate.parentDir === '') {
      rows.push({ kind: 'inlineCreate', key: '__create_root__', type: inlineCreate.type, level: 0 })
    }
    const walk = (nodes: WorkbenchFileNode[], level: number): void => {
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i]
        const isExpanded = n.isDirectory && expandedFolderIds.has(n.id)
        rows.push({ kind: 'node', node: n, level, isExpanded })
        if (isExpanded) {
          const showInlineHere = inlineCreate !== null && inlineCreate.parentDir === n.path
          if (showInlineHere) {
            rows.push({
              kind: 'inlineCreate',
              key: `__create_${n.path}__`,
              type: inlineCreate.type,
              level: level + 1
            })
          }
          if (n.children && n.children.length > 0) {
            walk(n.children, level + 1)
          } else if (!showInlineHere) {
            rows.push({ kind: 'empty', key: `__empty_${n.path}__`, level: level + 1 })
          }
        }
      }
    }
    walk(sortedFileTree, 0)
    return rows
  }, [sortedFileTree, expandedFolderIds, inlineCreate])

  const handleNodeClick = useCallback(
    (e: React.MouseEvent, node: WorkbenchFileNode) => {
      const isCtrl = e.ctrlKey || e.metaKey
      const isShift = e.shiftKey
      const currentAnchor = anchorPathRef.current
      const visible = flatVisibleNodesRef.current

      if (isShift && currentAnchor) {
        const ai = visible.findIndex((n) => n.path === currentAnchor)
        const bi = visible.findIndex((n) => n.path === node.path)
        if (ai !== -1 && bi !== -1) {
          const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai]
          const range = visible.slice(lo, hi + 1).map((n) => n.path)
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
        if (!isCtrl && !isShift) void openFile(node.path, { preview: true })
      }
    },
    [toggleFolder, openFile]
  )

  const handleNodeDoubleClick = useCallback(
    (node: WorkbenchFileNode) => {
      if (!node.isDirectory) {
        void openFile(node.path, { forcePermanent: true })
      }
    },
    [openFile]
  )

  const expandAncestors = useCallback((dirPaths: Iterable<string>) => {
    const next = new Set(useWorkbenchStore.getState().expandedFolderIds)
    for (const dirPath of Array.from(dirPaths)) {
      let p: string | null = dirPath
      while (p) {
        next.add(p)
        const idx = p.lastIndexOf('/')
        p = idx === -1 ? null : p.slice(0, idx)
      }
    }
    useWorkbenchStore.setState({ expandedFolderIds: next })
  }, [])

  const resolveParentDir = useCallback(
    (node: WorkbenchFileNode | null): string => {
      if (node) {
        if (node.isDirectory) return node.path
        const idx = node.path.lastIndexOf('/')
        return idx === -1 ? '' : node.path.slice(0, idx)
      }
      // 无右键上下文时：跟随最后一个选中项（VSCode 语义）
      const currentAnchor = anchorPathRef.current
      const visible = flatVisibleNodesRef.current
      const activePath = useWorkbenchStore.getState().activeFilePath
      const anchor =
        currentAnchor && visible.find((n) => n.path === currentAnchor)
          ? visible.find((n) => n.path === currentAnchor)!
          : activePath
          ? visible.find((n) => n.path === activePath) ?? null
          : null
      if (anchor) {
        if (anchor.isDirectory) return anchor.path
        const idx = anchor.path.lastIndexOf('/')
        return idx === -1 ? '' : anchor.path.slice(0, idx)
      }
      return ''
    },
    []
  )

  const beginInlineCreate = useCallback(
    (type: 'file' | 'folder', contextNode: WorkbenchFileNode | null) => {
      setInlineRename(null)
      const parentDir = resolveParentDir(contextNode)
      if (parentDir) {
        expandAncestors([parentDir])
      }
      setInlineCreate({ type, parentDir })
    },
    [resolveParentDir, expandAncestors]
  )

  const cancelInlineCreate = useCallback(() => {
    setInlineCreate(null)
  }, [])

  const commitInlineCreate = useCallback(async (rawValue: string) => {
    const targetCreate = inlineCreateRef.current
    if (!targetCreate || isCreatingRef.current) return
    const fallback = targetCreate.type === 'file' ? DEFAULT_FILE_NAME : DEFAULT_FOLDER_NAME
    const name = rawValue.trim() || fallback
    isCreatingRef.current = true
    setIsCreating(true)
    try {
      if (targetCreate.type === 'file') {
        await createFile(targetCreate.parentDir, name)
      } else {
        await createFolder(targetCreate.parentDir, name)
      }
    } finally {
      isCreatingRef.current = false
      setIsCreating(false)
      setInlineCreate(null)
    }
  }, [createFile, createFolder])

  const beginInlineRename = useCallback((node: WorkbenchFileNode) => {
    setInlineCreate(null)
    setInlineRename({ node })
    setSelectedPaths(new Set([node.path]))
    setAnchorPath(node.path)
  }, [])

  const cancelInlineRename = useCallback(() => {
    setInlineRename(null)
  }, [])

  const commitInlineRename = useCallback(async (rawValue: string) => {
    const currentRename = inlineRenameRef.current
    if (!currentRename || isRenamingBusyRef.current) return

    const targetNode = currentRename.node
    const trimmed = rawValue.trim()

    if (!trimmed || trimmed === targetNode.name) {
      setInlineRename(null)
      return
    }

    if (/[\\/:*?"<>|]/.test(trimmed)) {
      setInlineRename(null)
      useWorkbenchStore.setState({ error: '名称不能包含 \\ / : * ?" < > |' })
      return
    }

    isRenamingBusyRef.current = true
    setIsRenamingBusy(true)
    try {
      const parts = targetNode.path.split('/')
      parts[parts.length - 1] = trimmed
      const newPath = parts.join('/')
      const ok = await renameNode(targetNode.path, newPath)
      if (ok) {
        setSelectedPaths((prev) => {
          if (!prev.has(targetNode.path)) return prev
          const next = new Set(prev)
          next.delete(targetNode.path)
          next.add(newPath)
          return next
        })
        setAnchorPath((prev) => (prev === targetNode.path ? newPath : prev))
      }
    } finally {
      isRenamingBusyRef.current = false
      setIsRenamingBusy(false)
      setInlineRename(null)
    }
  }, [renameNode])

  const handleDragStart = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
      e.dataTransfer.effectAllowed = 'copyMove'
      e.dataTransfer.setData('text/plain', node.fullPath || node.path)
      const currentSelected = selectedPathsRef.current
      // 拖已选中集合中的一项 → 整组移动；拖未选中项 → 改为单选并只拖它
      const paths =
        currentSelected.has(node.path) && currentSelected.size > 1
          ? Array.from(currentSelected)
          : [node.path]
      if (!currentSelected.has(node.path)) {
        setSelectedPaths(new Set([node.path]))
        setAnchorPath(node.path)
      }
      setDragState({ node, paths })

      // 提取被选中的完整节点对象，供工作区跨栏拖拽（如上传至 AI 侧边栏）使用
      const pathSet = new Set(paths)
      const nodesToDrag: WorkbenchFileNode[] = []
      const walk = (items: WorkbenchFileNode[]) => {
        for (const item of items) {
          if (pathSet.has(item.path)) {
            nodesToDrag.push(item)
          }
          if (item.children?.length) {
            walk(item.children)
          }
        }
      }
      walk(fileTreeRef.current)
      if (nodesToDrag.length === 0) {
        nodesToDrag.push(node)
      }
      setDraggingNodes(nodesToDrag)

      try {
        e.dataTransfer.setData(
          'application/x-multichat-workspace-files',
          JSON.stringify(
            nodesToDrag.map((n) => ({
              path: n.path,
              fullPath: n.fullPath || n.path,
              name: n.name,
              isDirectory: n.isDirectory,
              size: n.size,
              extension: n.extension
            }))
          )
        )
      } catch {
        // ignore
      }
    },
    [setDraggingNodes]
  )

  const handleDragEnd = useCallback(() => {
    setDragState(null)
    setDropTargetDir(null)
    setIsRootDropActive(false)
    setDraggingNodes(null)
  }, [setDraggingNodes])

  const isValidDropDir = useCallback(
    (node: WorkbenchFileNode): boolean => {
      const currentDrag = dragStateRef.current
      if (!currentDrag || !node.isDirectory) return false
      // 不允许拖到任一被拖目录自身或其后代
      return !currentDrag.paths.some(
        (p) => node.path === p || node.path.startsWith(`${p}/`)
      )
    },
    []
  )

  const isExternalFileDrag = useCallback((e: React.DragEvent): boolean => {
    return !dragStateRef.current && e.dataTransfer.types.includes('Files')
  }, [])

  /** 拖到文件上 = 放入其父目录（VSCode 行为），返回父目录路径，无效则 null */
  const resolveFileDropParent = useCallback(
    (node: WorkbenchFileNode): string | null => {
      const currentDrag = dragStateRef.current
      if (!currentDrag || node.isDirectory) return null
      if (currentDrag.paths.includes(node.path)) return null // 拖到被拖文件自身
      const idx = node.path.lastIndexOf('/')
      return idx === -1 ? '' : node.path.slice(0, idx)
    },
    []
  )

  const handleNodeDragOver = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
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

  const handleNodeDragLeave = useCallback((node: WorkbenchFileNode) => {
    setDropTargetDir((v) => (v === node.path ? null : v))
  }, [])

  const handleNodeDrop = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
      e.preventDefault()
      e.stopPropagation()
      if (isExternalFileDrag(e)) {
        const paths = collectLocalPaths(e.dataTransfer.files)
        if (paths.length) {
          expandAncestors([node.path])
          void importExternalItems(node.path, paths)
        }
        setDropTargetDir(null)
        return
      }
      const currentDrag = dragStateRef.current
      if (isValidDropDir(node) && currentDrag) {
        expandAncestors([node.path])
        void moveNodes(currentDrag.paths, node.path)
      }
      handleDragEnd()
    },
    [isValidDropDir, expandAncestors, moveNodes, handleDragEnd, isExternalFileDrag, importExternalItems]
  )

  const handleFileDragOver = useCallback(
    (e: React.DragEvent, node: WorkbenchFileNode) => {
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
      const currentDrag = dragStateRef.current
      if (parent !== null && currentDrag) {
        void moveNodes(currentDrag.paths, parent)
      }
      handleDragEnd()
    },
    [resolveFileDropParent, moveNodes, handleDragEnd, isExternalFileDrag, importExternalItems]
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
      if (!dragStateRef.current) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsRootDropActive(true)
      setDropTargetDir(null)
    },
    [isExternalFileDrag]
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
      const currentDrag = dragStateRef.current
      if (currentDrag) {
        void moveNodes(currentDrag.paths, '')
      }
      handleDragEnd()
    },
    [moveNodes, handleDragEnd, isExternalFileDrag, importExternalItems]
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkbenchFileNode | null) => {
    e.preventDefault()
    e.stopPropagation()
    // VSCode：右键未选中节点时，先将其变为单选；已选中则保留多选作用于菜单
    if (node && !selectedPathsRef.current.has(node.path)) {
      setSelectedPaths(new Set([node.path]))
      setAnchorPath(node.path)
    }
    setIsMoveMenuOpen(false)
    setMenuPos(null)
    setMoveMenuPos(null)
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const getUploadNodes = useCallback((): WorkbenchFileNode[] => {
    const node = contextMenu?.node
    if (!node) return []
    const paths =
      selectedPaths.size > 1 && selectedPaths.has(node.path)
        ? Array.from(selectedPaths)
        : [node.path]
    const pathSet = new Set(paths)
    const nodes: WorkbenchFileNode[] = []
    const walk = (items: WorkbenchFileNode[]): void => {
      for (const item of items) {
        if (pathSet.has(item.path)) nodes.push(item)
        if (item.children?.length) walk(item.children)
      }
    }
    walk(fileTree)
    return nodes.length > 0 ? nodes : [node]
  }, [contextMenu, fileTree, selectedPaths])

  /**
   * 粘贴（Ctrl+V / 系统粘贴）：把剪贴板中的本地文件放进上下文目录（VSCode 语义）。
   * 剪贴板带"剪切"标记时按移动处理（Windows 资源管理器 Ctrl+X 或应用内剪切）。
   */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      // 重命名/内联新建输入框内粘贴不接管：移动语义不可撤销，必须避免误触发
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return // 文本/图片粘贴不接管（图片走编辑器插件）
      const collected = collectLocalPaths(files)
      if (!collected.length) return
      e.preventDefault()
      const parentDir = resolveParentDir(null)
      expandAncestors(parentDir ? [parentDir] : [])
      if (!workspacePath) return
      void (async () => {
        // 系统剪贴板是权威来源：优先用它判定剪切态，没有文件列表时退回事件里的文件
        let paths = collected
        let isMove = false
        try {
          const res = await window.api.workbench.readClipboardFileDrop()
          if (res.success && res.data) {
            if (res.data.paths.length) paths = res.data.paths
            isMove = res.data.move === true
          }
        } catch {
          // 读取失败按复制兜底
        }
        if (isMove) {
          await moveExternalItems(parentDir, paths, paths)
        } else {
          await importExternalItems(parentDir, paths)
        }
      })()
    },
    [resolveParentDir, expandAncestors, importExternalItems, moveExternalItems, workspacePath]
  )

  const handleCopy = useCallback(
    (e: React.ClipboardEvent) => {
      // 正在输入（重命名/内联新建）或选中了文字时，保留原生文字复制行为
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.toString()) return
      if (!selectedPaths.size) return
      e.preventDefault()
      const paths = Array.from(selectedPaths)
      setTreeClipboard({ paths, mode: 'copy' })
      if (workspacePath) {
        void window.api.workbench.copyToClipboard(workspacePath, paths)
      }
    },
    [selectedPaths, workspacePath]
  )

  const handleCut = useCallback(
    (e: React.ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.toString()) return
      if (!selectedPaths.size) return
      e.preventDefault()
      const paths = Array.from(selectedPaths)
      setTreeClipboard({ paths, mode: 'cut' })
      if (workspacePath) {
        void window.api.workbench.copyToClipboard(workspacePath, paths, { move: true })
      }
    },
    [selectedPaths, workspacePath]
  )

  /**
   * 应用内粘贴：
   * - 复制模式：节点复制到目标目录，生成 `-n` 副本
   * - 剪切模式：移动节点到目标目录（原地粘贴为无操作），成功后清空剪贴板
   */
  const pasteTreeClipboard = useCallback(
    (targetDir: string) => {
      if (!treeClipboard || !workspacePath || !treeClipboard.paths.length) return
      const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
      const paths = treeClipboard.paths.filter((p) => {
        if (p === targetDir) return false
        // 剪切：原地粘贴为无操作（与资源管理器一致）；复制：允许生成 `-n` 副本
        if (treeClipboard.mode === 'cut') {
          const idx = p.lastIndexOf('/')
          const parent = idx === -1 ? '' : p.slice(0, idx)
          if (parent === targetDir) return false
        }
        // 过滤会把目录放进自身内部的源（target 位于源之下），与后端校验一致
        return targetDir === '' || !targetDir.startsWith(`${p}/`)
      })
      if (!paths.length) return
      expandAncestors(targetDir ? [targetDir] : [])
      if (treeClipboard.mode === 'cut') {
        void moveNodes(paths, targetDir).then((ok) => {
          if (!ok) return
          setTreeClipboard(null)
          // 剪贴板里的绝对路径已失效，阻止之后在资源管理器里误粘贴。
          // 注意传过滤前的全量路径：部分项原地无操作仍在剪贴板里，数量不一致会导致清空被跳过
          void window.api.workbench.clearClipboardFileDrop(treeClipboard.paths.map((p) => `${root}/${p}`))
        })
        return
      }
      const absPaths = paths.map((p) => `${root}/${p}`)
      void importExternalItems(targetDir, absPaths)
    },
    [treeClipboard, workspacePath, expandAncestors, importExternalItems, moveNodes]
  )

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Escape') {
        if (isSearchMode) {
          e.preventDefault()
          closeSearch()
          return
        }
        // 与资源管理器一致：Esc 取消剪切态
        if (treeClipboard?.mode === 'cut') {
          e.preventDefault()
          setTreeClipboard(null)
        }
        return
      }

      // F2: 重命名选中的节点（VSCode 风格快捷键）
      if (e.key === 'F2') {
        const targetPath =
          anchorPath && flatVisibleNodes.some((n) => n.path === anchorPath)
            ? anchorPath
            : selectedPaths.size === 1
            ? Array.from(selectedPaths)[0]
            : activeFilePath
        if (targetPath) {
          const node = flatVisibleNodes.find((n) => n.path === targetPath)
          if (node) {
            e.preventDefault()
            beginInlineRename(node)
            return
          }
        }
      }

      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k !== 'c' && k !== 'x' && k !== 'v') return
      if (k === 'c') {
        if (!selectedPaths.size) return
        e.preventDefault()
        const paths = Array.from(selectedPaths)
        setTreeClipboard({ paths, mode: 'copy' })
        if (workspacePath) {
          void window.api.workbench.copyToClipboard(workspacePath, paths)
        }
      } else if (k === 'x') {
        if (!selectedPaths.size) return
        e.preventDefault()
        const paths = Array.from(selectedPaths)
        setTreeClipboard({ paths, mode: 'cut' })
        if (workspacePath) {
          void window.api.workbench.copyToClipboard(workspacePath, paths, { move: true })
        }
      } else {
        if (!treeClipboard) return
        e.preventDefault()
        pasteTreeClipboard(resolveParentDir(null))
      }
    },
    [selectedPaths, treeClipboard, pasteTreeClipboard, resolveParentDir, anchorPath, flatVisibleNodes, activeFilePath, beginInlineRename, workspacePath, isSearchMode, closeSearch]
  )

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!actionModal) return

    const { type, targetNode } = actionModal

    // 确认即关闭弹窗：删除在后台进行，进度不阻塞界面（与 VSCode 一致）。
    // 命中当前文档的切换逻辑已收敛到 store，多选统一走一次批量 IPC。
    const targets = type === 'deleteMulti'
      ? Array.from(selectedPaths)
      : type === 'cleanImages'
      ? actionModal.unreferencedImages ?? []
      : targetNode
      ? [targetNode.path]
      : []

    setActionModal(null)
    if (!targets.length) return

    if (type === 'deleteMulti' || type === 'cleanImages') {
      setSelectedPaths(new Set())
      void deleteNodes(targets)
    } else {
      void deleteNode(targets[0])
    }
  }

  return (
    <div
      tabIndex={-1}
      className="flex flex-col h-full overflow-hidden text-body select-none border-r border-black/5 dark:border-white/5 outline-none"
      onMouseDown={(e) => {
        // 点击任意处让容器获得焦点，从而能接收 paste 事件；不打断子元素交互
        if (e.target instanceof HTMLInputElement) return
        e.currentTarget.focus()
      }}
      onKeyDown={handleTreeKeyDown}
      onCopy={handleCopy}
      onCut={handleCut}
      onPaste={handlePaste}
    >
      <div className="h-12 px-3 border-b border-black/5 dark:border-white/5 flex items-center justify-center gap-1 shrink-0">
        <div className="flex items-center gap-0.5 text-text-secondary">
          <button
            ref={searchButtonRef}
            type="button"
            onClick={handleSearchToggle}
            className={`w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${
              isSearchMode ? 'text-primary bg-black/5 dark:bg-white/10' : ''
            }`}
            title="搜索笔记"
            aria-label="搜索笔记"
          >
            <AppIcon name="search" size={20} />
          </button>
          <button
            type="button"
            onClick={() => beginInlineCreate('file', null)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="新建笔记"
          >
            <AppIcon name="note_add" size={20} />
          </button>
          <button
            type="button"
            onClick={() => beginInlineCreate('folder', null)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="新建文件夹"
          >
            <AppIcon name="create_new_folder" size={20} />
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
              <AppIcon name="sort" size={20} />
            </button>
            {isSortMenuOpen && (
              <div
                ref={sortMenuRef}
                className="absolute top-full left-0 mt-1 z-popover min-w-[150px] py-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-body context-menu-animate"
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
                      <AppIcon name="check" size={19} className="text-primary" />
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
                  <AppIcon name={fileSort.order === 'asc' ? 'arrow_upward' : 'arrow_downward'} size={19} className="text-text-secondary" />
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
            <AppIcon name="unfold_less" size={20} />
          </button>
          <button
            type="button"
            onClick={async () => {
              setIsRefreshing(true)
              try {
                await loadFileTree()
              } finally {
                setIsRefreshing(false)
              }
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="刷新目录"
          >
            <AppIcon name="refresh" size={20} className={`${isRefreshing || isLoadingTree ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

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
          <WorkbenchSearch onClose={closeSearch} />
        ) : (
          <>
            {fileTree.length === 0 && !isLoadingTree && (
              <div className="py-10 px-4 flex flex-col items-center justify-center text-center text-text-secondary/70">
                <AppIcon name="folder_off" size={24} className="mx-auto mb-2 opacity-40 block" />
                <span>当前工作区为空，点击上方图标新建笔记</span>
              </div>
            )}
            {visibleRows.map((row) => {
              if (row.kind === 'inlineCreate') {
                return (
                  <InlineCreateInput
                    key={row.key}
                    type={row.type}
                    level={row.level}
                    isCreating={isCreating}
                    onCommit={commitInlineCreate}
                    onCancel={cancelInlineCreate}
                  />
                )
              }
              if (row.kind === 'empty') {
                return (
                  <div
                    key={row.key}
                    style={{ paddingLeft: `${row.level * 14 + 24}px` }}
                    className="py-1 text-body text-text-secondary/60 italic"
                  >
                    (空目录)
                  </div>
                )
              }
              const { node, level, isExpanded } = row
              const isRenaming = inlineRename?.node.id === node.id
              const gitBadge = node.isDirectory
                ? gitDirBadges.get(node.path) ?? null
                : gitFileBadges.get(node.path) ?? null
              return (
                <FileTreeRow
                  key={node.id}
                  node={node}
                  level={level}
                  isExpanded={isExpanded}
                  isSelected={selectedPaths.has(node.path)}
                  isActive={activeFilePath === node.path}
                  isRenaming={isRenaming}
                  isRenamingBusy={isRenaming && isRenamingBusy}
                  isDropTarget={node.isDirectory && dropTargetDir === node.path}
                  isCut={treeClipboard?.mode === 'cut' && treeClipboard.paths.includes(node.path)}
                  gitBadge={gitBadge}
                  onNodeClick={handleNodeClick}
                  onNodeDoubleClick={handleNodeDoubleClick}
                  onContextMenu={handleContextMenu}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onNodeDragOver={handleNodeDragOver}
                  onNodeDragLeave={handleNodeDragLeave}
                  onNodeDrop={handleNodeDrop}
                  onFileDragOver={handleFileDragOver}
                  onFileDrop={handleFileDrop}
                  onCommitRename={commitInlineRename}
                  onCancelRename={cancelInlineRename}
                />
              )
            })}
          </>
        )}
      </div>

      <div className="relative shrink-0 border-t border-black/5 dark:border-white/5">
        <div className={`flex h-10 items-center ${isCompactFooter ? 'gap-1 px-1.5' : 'gap-1.5 px-2'}`}>
          <button
            ref={workspaceButtonRef}
            type="button"
            onClick={() => {
              setIsWorkspaceSettingsOpen(false)
              setIsVaultMenuOpen((v) => !v)
            }}
            className={`flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg text-body font-medium text-text-primary transition-colors ${
              isCompactFooter ? 'px-1.5' : 'px-2'
            } ${
              isVaultMenuOpen ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title={workspacePath || ''}
          >
            <AppIcon name="folder_open" size={19} className="shrink-0 text-amber-500" />
            <span className="min-w-0 truncate text-left">{workspaceName || '未选工作区'}</span>
            <AppIcon name="unfold_more" size={16} className="shrink-0 text-text-secondary/70" />
          </button>
          <div className="h-4 w-px shrink-0 bg-black/10 dark:bg-white/10" aria-hidden="true" />
          <div className={`flex shrink-0 items-center ${isCompactFooter ? 'gap-1.5' : 'gap-2.5'}`}>
            <WorkbenchGitPanel
              compact={isCompactFooter}
              onOpenWorkspaceSettings={() => setIsWorkspaceSettingsOpen(true)}
            />
            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => {
                setIsVaultMenuOpen(false)
                setIsWorkspaceSettingsOpen((v) => !v)
              }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                isWorkspaceSettingsOpen
                  ? 'bg-black/5 text-text-primary dark:bg-white/10'
                  : 'text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5'
              }`}
              title="工作区设置"
            >
              <AppIcon name="settings_2" size={16} />
            </button>
          </div>
        </div>

        {isVaultMenuOpen && (
          <WorkbenchVaultPopover
            anchorRef={workspaceButtonRef}
            onClose={() => setIsVaultMenuOpen(false)}
          />
        )}
      </div>

      {contextMenu && createPortal(
        <div
          ref={menuRef}
          key={`${contextMenu.x}-${contextMenu.y}`}
          className={`fixed z-popover min-w-[170px] py-1 liquid-glass-menu rounded-xl text-body ${
            menuPos
              ? menuPos.flippedY
                ? 'context-menu-animate context-menu-animate-up'
                : 'context-menu-animate'
              : ''
          }`}
          style={{
            left: menuPos?.left ?? contextMenu.x,
            top: menuPos?.top ?? contextMenu.y,
            ...(menuPos?.maxHeight ? { maxHeight: menuPos.maxHeight, overflowY: 'auto' } : {})
          }}
        >
          {contextMenu.node && (
            <button
              type="button"
              onClick={() => {
                if (contextMenu.node) {
                  beginInlineRename(contextMenu.node)
                }
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="edit" size={19} />
              <span>重命名</span>
            </button>
          )}
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
                <AppIcon name="note_add" size={19} className="text-blue-500" />
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
                <AppIcon name="create_new_folder" size={19} className="text-amber-500" />
                <span>新建文件夹</span>
              </button>
              <div className="my-1 border-t border-black/5 dark:border-white/5" />
            </>
          )}

          {/* 复制/粘贴：无上下文节点时仅"粘贴"可用；有节点时提供复制与单节点创建副本 */}
          {contextMenu.node ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const paths =
                    selectedPaths.size > 1 && selectedPaths.has(contextMenu.node!.path)
                      ? Array.from(selectedPaths)
                      : [contextMenu.node!.path]
                  setTreeClipboard({ paths, mode: 'cut' })
                  if (workspacePath) {
                    void window.api.workbench.copyToClipboard(workspacePath, paths, { move: true })
                  }
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <AppIcon name="content_cut" size={19} />
                <span>
                  {selectedPaths.size > 1 && contextMenu.node && selectedPaths.has(contextMenu.node.path)
                    ? `剪切 ${selectedPaths.size} 项`
                    : '剪切'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const paths =
                    selectedPaths.size > 1 && selectedPaths.has(contextMenu.node!.path)
                      ? Array.from(selectedPaths)
                      : [contextMenu.node!.path]
                  setTreeClipboard({ paths, mode: 'copy' })
                  if (workspacePath) {
                    void window.api.workbench.copyToClipboard(workspacePath, paths)
                  }
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <AppIcon name="content_copy" size={19} />
                <span>
                  {selectedPaths.size > 1 && contextMenu.node && selectedPaths.has(contextMenu.node.path)
                    ? `复制 ${selectedPaths.size} 项`
                    : '复制'}
                </span>
              </button>
            </>
          ) : null}
          {treeClipboard && (
            <button
              type="button"
              onClick={() => {
                const targetDir = resolveParentDir(contextMenu.node)
                pasteTreeClipboard(targetDir)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="content_paste" size={19} />
              <span>粘贴{treeClipboard.paths.length > 1 ? ` ${treeClipboard.paths.length} 项` : ''}</span>
            </button>
          )}
          {contextMenu.node && (
            <button
              type="button"
              onClick={() => {
                const node = contextMenu.node!
                const root = (workspacePath ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
                const idx = node.path.lastIndexOf('/')
                const parentDir = idx === -1 ? '' : node.path.slice(0, idx)
                expandAncestors(parentDir ? [parentDir] : [])
                void importExternalItems(parentDir, [`${root}/${node.path}`])
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="file_copy" size={19} />
              <span>创建副本</span>
            </button>
          )}
          {contextMenu.node && (
            <button
              type="button"
              onClick={() => {
                const node = contextMenu.node!
                const root = (workspacePath ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
                // 多选时复制整组路径，与 Windows 资源管理器一致：每个路径独立一行
                const multi = selectedPaths.size > 1 && selectedPaths.has(node.path)
                const relativePaths = multi ? Array.from(selectedPaths) : [node.path]
                const text = relativePaths
                  .map((p) => (root ? `${root}/${p}` : p))
                  .join('\n')
                void navigator.clipboard.writeText(text)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="link" size={19} />
              <span>
                {selectedPaths.size > 1 && contextMenu.node && selectedPaths.has(contextMenu.node.path)
                  ? `复制 ${selectedPaths.size} 项路径`
                  : '复制文件路径'}
              </span>
            </button>
          )}
          {(contextMenu.node || treeClipboard) && (
            <div className="my-1 border-t border-black/5 dark:border-white/5" />
          )}

          {contextMenu.node && (
            <>
              <button
                type="button"
                onClick={() => {
                  const nodes = getUploadNodes()
                  setContextMenu(null)
                  if (nodes.length > 0) requestUploadNodesToAi({ nodes })
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <AppIcon name="send" size={19} className="text-blue-500" />
                <span>上传到 AI</span>
              </button>
              {!contextMenu.node.isDirectory && moveTargets.length > 0 && (
                <div
                  ref={moveTriggerRef}
                  className="relative"
                  onMouseEnter={() => {
                    cancelMoveMenuClose()
                    setIsMoveMenuOpen(true)
                  }}
                  onMouseLeave={scheduleMoveMenuClose}
                >
                  <button
                    type="button"
                    onClick={() => {
                      cancelMoveMenuClose()
                      setIsMoveMenuOpen((v) => !v)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <AppIcon name="folder_output" size={19} />
                    <span className="flex-1">移动到其他工作区</span>
                    <AppIcon name="chevron_right" size={16} />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (contextMenu.node) void revealFile(contextMenu.node.path)
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <AppIcon name="folder" size={19} />
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
                  <AppIcon name="open_in_new" size={19} />
                  <span>使用系统默认程序打开</span>
                </button>
              )}
              {/* Markdown 文档：仅当存在托管附件文件时显示“清理未引用图片” */}
              {contextMenu.node && hasManagedDocumentAssets(fileTree, contextMenu.node) && (
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
                  <AppIcon name="image_not_supported" size={19} />
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
                  // 删除文档会一并删除 documents/ 旁路；确认框要写明影响范围（二进制/媒体文件无文本标注，跳过查询）。
                  let annotationCount = 0
                  if (workspacePath && !multi && contextMenu.node && !contextMenu.node.isDirectory) {
                    const category = contextMenu.node.category ?? getFileCategory(contextMenu.node.name)
                    if (category === 'markdown' || category === 'text' || category === 'code') {
                      const result = await window.api.annotations.listDocument(workspacePath, contextMenu.node.path)
                      if (result.success && result.data) annotationCount = result.data.length
                    }
                  }
                  setActionModal(
                    multi
                      ? { type: 'deleteMulti', targetNode: contextMenu.node, mindmapImpact: impact?.data }
                      : { type: 'delete', targetNode: contextMenu.node, mindmapImpact: impact?.data, annotationCount }
                  )
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
              >
                <AppIcon name="delete" size={19} />
                <span>
                  {selectedPaths.size > 1 && contextMenu.node && selectedPaths.has(contextMenu.node.path)
                    ? `删除 ${selectedPaths.size} 项 (移至回收站)`
                    : '删除 (移至回收站)'}
                </span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* "移动到其他工作区"子菜单：必须脱离主菜单 DOM 单独 portal。
          主菜单的 liquid-glass-menu 带 backdrop-filter，Chromium 里它会成为
          fixed 后代的包含块，导致子菜单按视口算好的坐标被二次偏移、渲染到视口外。 */}
      {contextMenu && isMoveMenuOpen && createPortal(
        <div
          ref={moveMenuRef}
          onMouseEnter={cancelMoveMenuClose}
          onMouseLeave={scheduleMoveMenuClose}
          style={{
            left: moveMenuPos?.left ?? contextMenu.x,
            top: moveMenuPos?.top ?? contextMenu.y,
            maxHeight: moveMenuPos?.maxHeight ?? 280
          }}
          className={`fixed z-popover min-w-[190px] max-w-[240px] overflow-y-auto liquid-glass-menu rounded-xl py-1 text-body ${
            moveMenuPos
              ? moveMenuPos.flippedX
                ? 'context-menu-animate context-menu-animate-left'
                : 'context-menu-animate context-menu-animate-right'
              : ''
          }`}
        >
          {moveTargets.map((target) => (
            <button
              key={target.path}
              type="button"
              onClick={() => {
                const node = contextMenu.node
                closeMoveMenuNow()
                setContextMenu(null)
                if (!node) return
                const multi = selectedPaths.size > 1 && selectedPaths.has(node.path)
                const paths = (multi ? Array.from(selectedPaths) : [node.path]).filter(p => {
                  const item = flatVisibleNodes.find(n => n.path === p)
                  return item ? !item.isDirectory : true
                })
                if (!paths.length) return
                void moveToWorkspace(target.path, paths)
                setSelectedPaths(new Set())
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              title={target.path}
            >
              <AppIcon name="folder" size={19} />
              <span className="truncate">{target.name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}

      <Modal
        open={actionModal !== null}
        onClose={() => setActionModal(null)}
        size="sm"
        variant="glass"
        className="w-[360px] p-5 text-body"
      >
        {actionModal && (
          <form onSubmit={handleModalSubmit} className="flex flex-col gap-4">
            <div className="flex items-center justify-between font-semibold text-title text-text-primary">
              <span>
                {actionModal.type === 'deleteMulti'
                  ? '确认批量删除'
                  : actionModal.type === 'cleanImages'
                  ? '清理未引用图片'
                  : '确认删除'}
              </span>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
              >
                <AppIcon name="close" size={19} />
              </button>
            </div>

            {actionModal.type === 'deleteMulti' || actionModal.type === 'delete' ? (
              <div className="text-text-secondary text-body leading-relaxed space-y-2">
                <p>
                  {actionModal.type === 'deleteMulti'
                    ? <>确定要将选中的 <strong className="text-text-primary">{selectedPaths.size}</strong> 项移至系统回收站吗？</>
                    : <>确定要将「<strong className="text-text-primary">{actionModal.targetNode?.name}</strong>」移至系统回收站吗？</>}
                </p>
                {!!actionModal.mindmapImpact?.mindmaps && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    <p>
                      <strong>{actionModal.mindmapImpact.documents}</strong> 篇文档的{' '}
                      <strong>{actionModal.mindmapImpact.mindmaps}</strong> 张思维导图会一并删除，且无法恢复；
                      文档本身仍可从回收站还原。
                    </p>
                  </div>
                )}
                {!!actionModal.annotationCount && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    <p>
                      文档里的 <strong>{actionModal.annotationCount}</strong> 条标注会一起删除；
                      原文标注不受影响。
                    </p>
                  </div>
                )}
              </div>
            ) : actionModal.type === 'cleanImages' ? (
              <div className="text-text-secondary text-body leading-relaxed">
                {actionModal.unreferencedImages && actionModal.unreferencedImages.length > 0 ? (
                  <>
                    <p className="mb-2">
                      「<strong className="text-text-primary">{actionModal.targetNode?.name}</strong>」
                      的附件目录中有 <strong className="text-rose-500">{actionModal.unreferencedImages.length}</strong> 张图片未被文档引用：
                    </p>
                    <div className="max-h-[180px] overflow-y-auto rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2 font-mono text-label">
                      {actionModal.unreferencedImages.map((p) => (
                        <div key={p} className="truncate py-0.5" title={p}>
                          {p.split('/').pop()}
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-label">确认后将移至系统回收站（可恢复）。</p>
                  </>
                ) : (
                  <p>该文档的附件目录中没有未引用的图片。</p>
                )}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActionModal(null)}>
                取消
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={actionModal.type === 'cleanImages' && !(actionModal.unreferencedImages?.length)}
              >
                {actionModal.type === 'delete' || actionModal.type === 'deleteMulti'
                  ? '确认移入回收站'
                  : `清理 ${actionModal.unreferencedImages?.length ?? 0} 张`}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {isWorkspaceSettingsOpen && (
        <WorkbenchWorkspaceSettings
          anchorRef={settingsButtonRef}
          onClose={() => {
            setIsWorkspaceSettingsOpen(false)
          }}
        />
      )}
    </div>
  )
}

export default memo(WorkbenchFileTree)
