import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/appStore'
import {
  isNewTabPath,
  useWorkbenchStore,
  type WorkbenchTabInsertTarget,
  type WorkbenchTabItem
} from '../../store/workbenchStore'
import type { WorkbenchFileNode } from '../../../../shared/types/workbench'
import { AppIcon } from '../icons/AppIcon'
import { WorkbenchDocumentIcon } from './FileTypeIcon'
import { extractLocalPath } from './WorkbenchFileTree'
import { requestUploadNodesToAi } from './workbenchAiEvents'
import Modal, { ModalFooter, ModalHeader } from '../ui/Modal'

function getFileBaseName(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/')
  return idx === -1 ? relativePath : relativePath.slice(idx + 1)
}

function getParentDirLabel(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/')
  if (idx === -1) return '根目录'
  const parent = relativePath.slice(0, idx)
  const slashIdx = parent.lastIndexOf('/')
  return slashIdx === -1 ? parent : parent.slice(slashIdx + 1)
}

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot).toLowerCase() : ''
}

function joinWorkspaceAbsolutePath(workspacePath: string | null, relativePath: string): string {
  if (!workspacePath) return relativePath
  const sep = workspacePath.includes('\\') ? '\\' : '/'
  const cleanRoot = workspacePath.replace(/[/\\]+$/, '')
  return `${cleanRoot}${sep}${relativePath.replace(/\//g, sep)}`
}

function buildSyntheticFileNode(relativePath: string, workspacePath: string | null): WorkbenchFileNode {
  const name = getFileBaseName(relativePath)
  return {
    id: relativePath,
    name,
    path: relativePath,
    fullPath: joinWorkspaceAbsolutePath(workspacePath, relativePath),
    isDirectory: false,
    extension: getExtension(name)
  }
}

interface TabContextMenuState {
  x: number
  y: number
  tab: WorkbenchTabItem
}

type TabDropHint =
  | { kind: 'tab-edge'; path: string; side: 'left' | 'right' }
  | { kind: 'tab-replace'; path: string }
  | { kind: 'append' }

interface DroppedTabPayload {
  workspaceRelativePaths: string[]
  externalAbsolutePaths: string[]
}

function toWorkspaceRelativePath(workspaceRoot: string | null, absolutePath: string): string | null {
  if (!workspaceRoot || !absolutePath) return null
  const cleanRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const cleanFile = absolutePath.replace(/\\/g, '/')
  if (!cleanRoot) return null
  const isWin = window.api.platform === 'win32'
  const rootCmp = isWin ? cleanRoot.toLowerCase() : cleanRoot
  const fileCmp = isWin ? cleanFile.toLowerCase() : cleanFile
  if (!fileCmp.startsWith(`${rootCmp}/`)) return null
  const rel = cleanFile.slice(cleanRoot.length + 1).replace(/^\/+/, '')
  return rel || null
}

function hasSupportedTabFileDrop(e: React.DragEvent): boolean {
  const dragTypes = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  const hasWorkspacePayload = dragTypes.includes('application/x-multichat-workspace-files')
  const hasExternalFiles = dragTypes.includes('Files')
  const currentDragging =
    hasExternalFiles && !hasWorkspacePayload
      ? null
      : useWorkbenchStore.getState().draggingNodes
  if (currentDragging && currentDragging.length > 0) {
    return currentDragging.some((n) => !n.isDirectory)
  }
  return hasWorkspacePayload || hasExternalFiles
}

function extractDroppedTabPayload(
  e: React.DragEvent,
  workspacePath: string | null
): DroppedTabPayload {
  const workspaceRelativePaths: string[] = []
  const externalAbsolutePaths: string[] = []
  const seenWorkspace = new Set<string>()
  const seenExternal = new Set<string>()

  const pushWorkspacePath = (rel: string | undefined) => {
    if (!rel) return
    const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized || seenWorkspace.has(normalized)) return
    seenWorkspace.add(normalized)
    workspaceRelativePaths.push(normalized)
  }

  const dragTypes = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  const hasExternalFiles = dragTypes.includes('Files')
  const hasWorkspacePayload = dragTypes.includes('application/x-multichat-workspace-files')
  const currentDragging =
    hasExternalFiles && !hasWorkspacePayload
      ? null
      : useWorkbenchStore.getState().draggingNodes

  if (currentDragging && currentDragging.length > 0) {
    for (const node of currentDragging) {
      if (!node.isDirectory && node.path) {
        pushWorkspacePath(node.path)
      }
    }
  } else if (e.dataTransfer && hasWorkspacePayload) {
    const raw = e.dataTransfer.getData('application/x-multichat-workspace-files')
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Array<{ path?: string; isDirectory?: boolean }>
        for (const item of parsed) {
          if (item && !item.isDirectory && item.path) {
            pushWorkspacePath(item.path)
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (workspaceRelativePaths.length === 0 && e.dataTransfer?.files?.length) {
    const items = e.dataTransfer.items
    const files = Array.from(e.dataTransfer.files)
    files.forEach((file, idx) => {
      const entry = items?.[idx]?.webkitGetAsEntry?.()
      if (entry?.isDirectory) return
      const localPath = extractLocalPath(file)
      if (!localPath) return
      const rel = toWorkspaceRelativePath(workspacePath, localPath)
      if (rel) {
        pushWorkspacePath(rel)
      } else if (!seenExternal.has(localPath)) {
        seenExternal.add(localPath)
        externalAbsolutePaths.push(localPath)
      }
    })
  }

  return { workspaceRelativePaths, externalAbsolutePaths }
}

interface WorkbenchTabBarProps {
  /** 仅用于快捷键作用域判定，确保切到多AI/总结/设置页时不误触工作台快捷键 */
  isActive: boolean
}

/**
 * 工作台顶部极简标签栏（嵌入 Obsidian 式通顶三栏布局的中栏顶行）。
 * 支持：预览态（斜体）与双击/编辑转正、固定标签、弹性收缩 + 滚轮横滑 + 溢出搜索面板、
 * 同名文件自动目录消歧、中键关闭、拖拽重排与拖往右侧 AI 侧栏、右键菜单及快捷键。
 */
export default function WorkbenchTabBar({ isActive }: WorkbenchTabBarProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const openTabs = useWorkbenchStore((s) => s.openTabs)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeTabPath = useWorkbenchStore((s) => s.activeTabPath)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const mruTabOrder = useWorkbenchStore((s) => s.mruTabOrder)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const createNewTab = useWorkbenchStore((s) => s.createNewTab)
  const activateTab = useWorkbenchStore((s) => s.activateTab)
  const createUntitledNote = useWorkbenchStore((s) => s.createUntitledNote)
  const setQuickOpenOpen = useWorkbenchStore((s) => s.setQuickOpenOpen)
  const promoteTab = useWorkbenchStore((s) => s.promoteTab)
  const togglePinTab = useWorkbenchStore((s) => s.togglePinTab)
  const reorderTabs = useWorkbenchStore((s) => s.reorderTabs)
  const closeTab = useWorkbenchStore((s) => s.closeTab)
  const closeOtherTabs = useWorkbenchStore((s) => s.closeOtherTabs)
  const closeRightTabs = useWorkbenchStore((s) => s.closeRightTabs)
  const closeSavedTabs = useWorkbenchStore((s) => s.closeSavedTabs)
  const closeAllTabs = useWorkbenchStore((s) => s.closeAllTabs)
  const reopenLastClosedTab = useWorkbenchStore((s) => s.reopenLastClosedTab)
  const setDraggingNodes = useWorkbenchStore((s) => s.setDraggingNodes)
  const importExternalItems = useWorkbenchStore((s) => s.importExternalItems)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const expandAncestorsOf = useWorkbenchStore((s) => s.expandAncestorsOf)
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const toggleLeftCollapse = useWorkbenchStore((s) => s.toggleLeftCollapse)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const overflowBtnRef = useRef<HTMLButtonElement | null>(null)
  const overflowMenuRef = useRef<HTMLDivElement | null>(null)
  const overflowSearchRef = useRef<HTMLInputElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)

  const [scrollEdge, setScrollEdge] = useState<{ canLeft: boolean; canRight: boolean; activeHidden: boolean }>({
    canLeft: false,
    canRight: false,
    activeHidden: false
  })
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [overflowQuery, setOverflowQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<TabDropHint | null>(null)
  const [confirmClosePath, setConfirmClosePath] = useState<string | null>(null)
  const [mruModalOpen, setMruModalOpen] = useState(false)
  const [mruSelectedIndex, setMruSelectedIndex] = useState(0)

  const pinnedTabs = useMemo(() => openTabs.filter((t) => t.isPinned), [openTabs])
  const normalTabs = useMemo(() => openTabs.filter((t) => !t.isPinned), [openTabs])

  // 统计同名文件，自动展示最短父目录以消歧
  const duplicateBaseNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tab of openTabs) {
      if (isNewTabPath(tab.path)) continue
      const name = getFileBaseName(tab.path)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const dups = new Set<string>()
    counts.forEach((count, name) => {
      if (count > 1) dups.add(name)
    })
    return dups
  }, [openTabs])

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const hasOverflow = el.scrollWidth > el.clientWidth + 2
    const canLeft = hasOverflow && el.scrollLeft > 4
    const canRight = hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 4

    let activeHidden = false
    if (activeTabPath && hasOverflow) {
      const activeEl = el.querySelector<HTMLElement>(`[data-workbench-tab-path="${CSS.escape(activeTabPath)}"]`)
      if (activeEl) {
        const scrollerRect = el.getBoundingClientRect()
        const tabRect = activeEl.getBoundingClientRect()
        activeHidden = tabRect.right < scrollerRect.left + 8 || tabRect.left > scrollerRect.right - 8
      }
    }

    setScrollEdge((prev) =>
      prev.canLeft === canLeft && prev.canRight === canRight && prev.activeHidden === activeHidden
        ? prev
        : { canLeft, canRight, activeHidden }
    )
  }, [activeTabPath])

  useEffect(() => {
    const raf = requestAnimationFrame(updateScrollState)
    return () => cancelAnimationFrame(raf)
  }, [openTabs, activeTabPath, updateScrollState])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => updateScrollState())
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateScrollState])

  // 激活标签变化时自动平顺滚入可见区
  useEffect(() => {
    if (!activeTabPath) return
    const raf = requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (!el) return
      const target = el.querySelector<HTMLElement>(`[data-workbench-tab-path="${CSS.escape(activeTabPath)}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      setTimeout(updateScrollState, 180)
    })
    return () => cancelAnimationFrame(raf)
  }, [activeTabPath, updateScrollState])

  // 滚轮垂直滚动自动映射为标签栏横向滚动
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      e.preventDefault()
      el.scrollLeft += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      updateScrollState()
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [updateScrollState])

  const requestCloseTab = useCallback(
    async (path: string) => {
      const res = await closeTab(path)
      if (res === 'needs-confirm') {
        setConfirmClosePath(path)
      }
    },
    [closeTab]
  )

  const handleDroppedFiles = useCallback(
    async (payload: DroppedTabPayload, initialTarget: WorkbenchTabInsertTarget) => {
      const filesToOpen = [...payload.workspaceRelativePaths]
      if (payload.externalAbsolutePaths.length > 0) {
        const importedRes = await importExternalItems('', payload.externalAbsolutePaths)
        if (importedRes?.imported.length) {
          for (const rel of importedRes.imported) {
            if (!filesToOpen.includes(rel)) filesToOpen.push(rel)
          }
        }
      }
      if (filesToOpen.length === 0) return

      let currentTarget = initialTarget
      for (const rel of filesToOpen) {
        const ok = await openFile(rel, {
          forcePermanent: true,
          insertTarget: currentTarget
        })
        if (!ok) break
        if (currentTarget.kind === 'replace' || currentTarget.kind === 'after') {
          currentTarget = { kind: 'after', path: rel }
        }
      }
    },
    [importExternalItems, openFile]
  )

  useEffect(() => {
    const clearDropState = () => setDropHint(null)
    window.addEventListener('dragend', clearDropState)
    window.addEventListener('drop', clearDropState)
    return () => {
      window.removeEventListener('dragend', clearDropState)
      window.removeEventListener('drop', clearDropState)
    }
  }, [])

  // 溢出浮层 / 右键菜单外部点击与 Esc 收起
  useEffect(() => {
    if (!overflowOpen && !contextMenu) return
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        overflowOpen &&
        !overflowMenuRef.current?.contains(target) &&
        !overflowBtnRef.current?.contains(target)
      ) {
        setOverflowOpen(false)
      }
      if (contextMenu && !contextMenuRef.current?.contains(target)) {
        setContextMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOverflowOpen(false)
        setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKey)
    }
  }, [overflowOpen, contextMenu])

  useEffect(() => {
    if (overflowOpen) {
      const raf = requestAnimationFrame(() => overflowSearchRef.current?.focus())
      return () => cancelAnimationFrame(raf)
    }
    return undefined
  }, [overflowOpen])

  // 有序 MRU 列表（用于 Ctrl+Tab）
  const orderedMruTabs = useMemo(() => {
    const byPath = new Map(openTabs.map((t) => [t.path, t]))
    const result: WorkbenchTabItem[] = []
    const seen = new Set<string>()
    for (const p of mruTabOrder) {
      const t = byPath.get(p)
      if (t && !seen.has(p)) {
        seen.add(p)
        result.push(t)
      }
    }
    for (const t of openTabs) {
      if (!seen.has(t.path)) {
        seen.add(t.path)
        result.push(t)
      }
    }
    return result
  }, [openTabs, mruTabOrder])

  // 工作台快捷键：Ctrl/Cmd+W（关闭）、Ctrl/Cmd+Shift+T（恢复）、Ctrl/Cmd+N（新建笔记）、Ctrl/Cmd+O（打开文件）、Ctrl+Tab（MRU 切换）
  useEffect(() => {
    if (!isActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (useAppStore.getState().currentPage !== 'main') return
      const mod = e.ctrlKey || e.metaKey

      if (mruModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setMruModalOpen(false)
          return
        }
        if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'Tab' && !e.shiftKey)) {
          e.preventDefault()
          setMruSelectedIndex((i) => (orderedMruTabs.length ? (i + 1) % orderedMruTabs.length : 0))
          return
        }
        if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'Tab' && e.shiftKey)) {
          e.preventDefault()
          setMruSelectedIndex((i) =>
            orderedMruTabs.length ? (i - 1 + orderedMruTabs.length) % orderedMruTabs.length : 0
          )
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          const picked = orderedMruTabs[mruSelectedIndex]
          setMruModalOpen(false)
          if (picked) void activateTab(picked.path)
          return
        }
        return
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        if (orderedMruTabs.length < 2) return
        e.preventDefault()
        setMruSelectedIndex(e.shiftKey ? orderedMruTabs.length - 1 : 1)
        setMruModalOpen(true)
        return
      }

      if (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        void reopenLastClosedTab()
        return
      }

      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void createUntitledNote()
        return
      }

      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setQuickOpenOpen(true)
        return
      }

      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
        if (activeTabPath) {
          e.preventDefault()
          void requestCloseTab(activeTabPath)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isActive,
    mruModalOpen,
    mruSelectedIndex,
    orderedMruTabs,
    activeTabPath,
    activateTab,
    createUntitledNote,
    setQuickOpenOpen,
    reopenLastClosedTab,
    requestCloseTab
  ])

  const filteredOverflowTabs = useMemo(() => {
    const q = overflowQuery.trim().toLowerCase()
    if (!q) return openTabs
    return openTabs.filter((t) =>
      (isNewTabPath(t.path) ? '新标签页' : t.path).toLowerCase().includes(q)
    )
  }, [openTabs, overflowQuery])

  const overflowAnchorRect = overflowOpen ? overflowBtnRef.current?.getBoundingClientRect() ?? null : null

  const scrollMaskClass =
    scrollEdge.canLeft && scrollEdge.canRight
      ? 'tab-fade-both'
      : scrollEdge.canLeft
        ? 'tab-fade-left'
        : scrollEdge.canRight
          ? 'tab-fade-right'
          : ''

  const renderTabPill = (tab: WorkbenchTabItem) => {
    const isNewTab = isNewTabPath(tab.path)
    const isTabActive = tab.path === activeTabPath
    const isTabDirty = !isNewTab && isTabActive && isDirty
    const baseName = isNewTab ? '新标签页' : getFileBaseName(tab.path)
    const showDisambig = !isNewTab && duplicateBaseNames.has(baseName)
    const node = isNewTab ? null : buildSyntheticFileNode(tab.path, workspacePath)
    const hintSide = dropHint?.kind === 'tab-edge' && dropHint.path === tab.path ? dropHint.side : null
    const isReplaceHint = dropHint?.kind === 'tab-replace' && dropHint.path === tab.path

    return (
      <div
        key={tab.path}
        data-workbench-tab-path={tab.path}
        draggable
        onClick={() => void activateTab(tab.path)}
        onDoubleClick={() => {
          if (!isNewTab && tab.isPreview) promoteTab(tab.path)
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && !tab.isPinned) {
            e.preventDefault()
            e.stopPropagation()
            void requestCloseTab(tab.path)
          }
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOverflowOpen(false)
          setContextMenu({ x: e.clientX, y: e.clientY, tab })
        }}
        onDragStart={(e) => {
          setDraggedPath(tab.path)
          e.dataTransfer.effectAllowed = node ? 'copyMove' : 'move'
          e.dataTransfer.setData('text/plain', tab.path)
          if (node) {
            try {
              e.dataTransfer.setData(
                'application/x-multichat-workspace-files',
                JSON.stringify([
                  {
                    path: node.path,
                    fullPath: node.fullPath || node.path,
                    name: node.name,
                    isDirectory: node.isDirectory,
                    size: node.size,
                    extension: node.extension
                  }
                ])
              )
            } catch {
              // ignore
            }
            setDraggingNodes([node])
          }
        }}
        onDragEnd={() => {
          setDraggedPath(null)
          setDropHint(null)
          setDraggingNodes(null)
        }}
        onDragOver={(e) => {
          if (draggedPath) {
            e.stopPropagation()
            if (draggedPath === tab.path) return
            const src = openTabs.find((t) => t.path === draggedPath)
            if (!src || src.isPinned !== tab.isPinned) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const rect = e.currentTarget.getBoundingClientRect()
            const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right'
            setDropHint((prev) =>
              prev?.kind === 'tab-edge' && prev.path === tab.path && prev.side === side
                ? prev
                : { kind: 'tab-edge', path: tab.path, side }
            )
            return
          }
          if (!workspacePath || !hasSupportedTabFileDrop(e)) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
          if (isNewTab) {
            setDropHint((prev) =>
              prev?.kind === 'tab-replace' && prev.path === tab.path
                ? prev
                : { kind: 'tab-replace', path: tab.path }
            )
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right'
          setDropHint((prev) =>
            prev?.kind === 'tab-edge' && prev.path === tab.path && prev.side === side
              ? prev
              : { kind: 'tab-edge', path: tab.path, side }
          )
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDropHint((prev) =>
            prev && prev.kind !== 'append' && prev.path === tab.path ? null : prev
          )
        }}
        onDrop={(e) => {
          if (draggedPath) {
            e.preventDefault()
            e.stopPropagation()
            if (draggedPath !== tab.path) {
              reorderTabs(draggedPath, tab.path)
            }
            setDraggedPath(null)
            setDropHint(null)
            setDraggingNodes(null)
            return
          }
          if (!workspacePath || !hasSupportedTabFileDrop(e)) return
          e.preventDefault()
          e.stopPropagation()
          const payload = extractDroppedTabPayload(e, workspacePath)
          const rect = e.currentTarget.getBoundingClientRect()
          const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right'
          const insertTarget: WorkbenchTabInsertTarget = isNewTab
            ? { kind: 'replace', path: tab.path }
            : { kind: side === 'left' ? 'before' : 'after', path: tab.path }
          setDropHint(null)
          setDraggingNodes(null)
          void handleDroppedFiles(payload, insertTarget)
        }}
        title={isNewTab ? '新标签页' : `${tab.path}${tab.isPreview ? '（预览标签：双击转为常驻）' : ''}`}
        style={
          tab.isPinned
            ? { maxWidth: '124px' }
            : { minWidth: '104px', maxWidth: '176px' }
        }
        className={`no-drag group relative h-[28px] shrink-0 flex items-center gap-1.5 rounded-lg cursor-pointer text-label transition-all duration-150 select-none ${
          tab.isPinned ? 'px-2' : 'pl-2.5 pr-1'
        } ${
          isTabActive
            ? 'bg-white dark:bg-gray-800 text-text-primary font-medium shadow-xs border border-black/[0.06] dark:border-white/10'
            : 'text-text-secondary hover:bg-white/50 dark:hover:bg-white/10 hover:text-text-primary border border-transparent'
        } ${isReplaceHint ? 'ring-1 ring-inset ring-primary/70 bg-primary/10 text-primary' : ''}`}
      >
        {hintSide && (
          <span
            className={`pointer-events-none absolute top-1 bottom-1 w-[2px] rounded-full bg-primary z-10 ${
              hintSide === 'left' ? 'left-0' : 'right-0'
            }`}
          />
        )}
        {node ? (
          <WorkbenchDocumentIcon node={node} size={14} className="w-[14px] h-[14px]" />
        ) : (
          <AppIcon name="note_add" size={14} className="text-text-secondary shrink-0" />
        )}
        <div className="flex-1 min-w-0 flex items-baseline gap-1">
          <span className={`truncate ${!isNewTab && tab.isPreview ? 'italic' : ''}`}>{baseName}</span>
          {!tab.isPinned && showDisambig && (
            <span className="text-caption text-text-secondary/75 truncate shrink-0 max-w-[54px]">
              · {getParentDirLabel(tab.path)}
            </span>
          )}
        </div>
        {tab.isPinned ? (
          <AppIcon name="push_pin" size={12} className="text-primary/70 shrink-0" />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void requestCloseTab(tab.path)
            }}
            title={isTabDirty ? '有未保存更改，点击关闭' : '关闭标签 (中键)'}
            aria-label={`关闭 ${baseName}`}
            className={`w-[18px] h-[18px] shrink-0 rounded-md flex items-center justify-center transition-opacity hover:bg-black/10 dark:hover:bg-white/15 ${
              isTabActive || isTabDirty
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {isTabDirty ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-primary group-hover:hidden" />
                <AppIcon
                  name="close"
                  size={12}
                  className="hidden group-hover:block text-text-secondary"
                />
              </>
            ) : (
              <AppIcon name="close" size={12} className="text-text-secondary" />
            )}
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          if (draggedPath) {
            const src = openTabs.find((t) => t.path === draggedPath)
            if (!src || src.isPinned || normalTabs.length === 0) return
            const scroller = scrollerRef.current
            if (
              scroller &&
              scroller.contains(e.target as Node) &&
              e.clientX < scroller.getBoundingClientRect().right - 2
            ) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              return
            }
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropHint((prev) => (prev?.kind === 'append' ? prev : { kind: 'append' }))
            return
          }
          if (!workspacePath || !hasSupportedTabFileDrop(e)) return
          const scroller = scrollerRef.current
          if (
            scroller &&
            normalTabs.length > 0 &&
            scroller.contains(e.target as Node) &&
            e.clientX < scroller.getBoundingClientRect().right - 2
          ) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            return
          }
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropHint((prev) => (prev?.kind === 'append' ? prev : { kind: 'append' }))
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropHint(null)
          }
        }}
        onDrop={(e) => {
          const scroller = scrollerRef.current
          const inScrollerGap =
            Boolean(scroller && scroller.contains(e.target as Node)) &&
            Boolean(scroller && e.clientX < scroller.getBoundingClientRect().right - 2)
          if (draggedPath) {
            e.preventDefault()
            const src = openTabs.find((t) => t.path === draggedPath)
            const edgeTargetPath =
              inScrollerGap && dropHint?.kind === 'tab-edge' ? dropHint.path : null
            const fallbackLast = normalTabs[normalTabs.length - 1]
            const targetPath = edgeTargetPath ?? (src && !src.isPinned ? fallbackLast?.path : null)
            if (targetPath && targetPath !== draggedPath) {
              reorderTabs(draggedPath, targetPath)
            }
            setDraggedPath(null)
            setDropHint(null)
            setDraggingNodes(null)
            return
          }
          if (!workspacePath || !hasSupportedTabFileDrop(e)) return
          e.preventDefault()
          e.stopPropagation()
          const payload = extractDroppedTabPayload(e, workspacePath)
          const insertTarget: WorkbenchTabInsertTarget =
            inScrollerGap && dropHint?.kind === 'tab-edge'
              ? { kind: dropHint.side === 'left' ? 'before' : 'after', path: dropHint.path }
              : { kind: 'append' }
          setDropHint(null)
          setDraggingNodes(null)
          void handleDroppedFiles(payload, insertTarget)
        }}
        className="flex-1 min-w-0 h-full flex items-center px-1.5 drag-region"
      >
        {/* 固定标签区（不随普通标签横向滚走） */}
        {pinnedTabs.length > 0 && (
          <div className="flex items-center gap-1 mr-1 shrink-0 no-drag">
            {pinnedTabs.map(renderTabPill)}
            {normalTabs.length > 0 && (
              <div className="w-px h-3.5 bg-black/10 dark:bg-white/10 ml-0.5 shrink-0" />
            )}
          </div>
        )}

        {/* 左滚动微调箭头 */}
        {scrollEdge.canLeft && (
          <button
            type="button"
            onClick={() => scrollerRef.current?.scrollBy({ left: -160, behavior: 'smooth' })}
            title="向左滚动标签"
            aria-label="向左滚动标签"
            className="no-drag w-5 h-7 mr-0.5 shrink-0 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <AppIcon name="chevron_left" size={14} />
          </button>
        )}

        {/* 普通标签横向滚动区（flex: 0 1 auto 让 + 紧跟末个标签，中间弹性区在溢出时自然缩至 0px） */}
        <div
          ref={scrollerRef}
          onScroll={updateScrollState}
          className={`min-w-0 h-full flex items-center gap-1 overflow-x-auto no-scrollbar ${scrollMaskClass}`}
          style={{ flex: '0 1 auto' }}
        >
          {normalTabs.map(renderTabPill)}
        </div>

        {/* 右滚动微调箭头 */}
        {scrollEdge.canRight && (
          <button
            type="button"
            onClick={() => scrollerRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
            title="向右滚动标签"
            aria-label="向右滚动标签"
            className="no-drag w-5 h-7 ml-0.5 shrink-0 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <AppIcon name="chevron_right" size={14} />
          </button>
        )}

        {/* 末尾落位提示线 */}
        {dropHint?.kind === 'append' && (
          <span className="w-[2px] h-4 ml-0.5 rounded-full bg-primary shrink-0 pointer-events-none" />
        )}

        {/* 新建空白标签页（紧跟末尾标签 / 右滚动箭头） */}
        <button
          type="button"
          onClick={() => void createNewTab()}
          title="新建标签页（也可直接将文件拖入此处打开）"
          aria-label="新建标签页"
          className={`no-drag w-7 h-7 ml-0.5 shrink-0 rounded-lg flex items-center justify-center transition-colors ${
            dropHint?.kind === 'append'
              ? 'text-primary bg-primary/10'
              : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
          }`}
        >
          <AppIcon name="add" size={16} />
        </button>

        {/* 未溢出时提供窗口拖拽空白；溢出时自动收缩至 0px，拖拽悬停时显示柔和落位提示 */}
        <div
          className={`flex-1 min-w-0 h-[28px] rounded-lg drag-region transition-colors ${
            dropHint?.kind === 'append' ? 'bg-primary/[0.06] ring-1 ring-inset ring-primary/25' : ''
          }`}
        />

        {/* 全部打开标签下拉控件：始终对齐中间编辑区右侧边缘 */}
        {openTabs.length > 0 && (
          <button
            ref={overflowBtnRef}
            type="button"
            onClick={() => {
              setContextMenu(null)
              setOverflowQuery('')
              setOverflowOpen((v) => !v)
            }}
            title="查看全部打开的标签页"
            aria-label="查看全部打开的标签页"
            className={`no-drag h-7 px-1.5 ml-0.5 shrink-0 rounded-lg flex items-center gap-1 transition-colors ${
              overflowOpen || scrollEdge.activeHidden
                ? 'text-primary bg-primary/10 hover:bg-primary/15'
                : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            <AppIcon name="keyboard_arrow_down" size={15} />
            <span className="px-1 min-w-[16px] h-[15px] rounded-full text-tiny leading-[15px] text-center font-semibold bg-black/[0.06] dark:bg-white/10">
              {openTabs.length}
            </span>
          </button>
        )}
      </div>

      {/* 溢出 / 全部已打开标签列表浮层 */}
      {overflowOpen && overflowAnchorRect &&
        createPortal(
          <div
            ref={overflowMenuRef}
            style={{
              top: overflowAnchorRect.bottom + 6,
              left: Math.max(8, Math.min(window.innerWidth - 296, overflowAnchorRect.right - 288))
            }}
            className="fixed z-popover w-[288px] max-h-[400px] liquid-glass-menu rounded-xl flex flex-col overflow-hidden select-none"
          >
            <div className="p-2 border-b border-black/5 dark:border-white/10">
              <div className="h-8 px-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/70 dark:bg-gray-900/60 flex items-center gap-1.5">
                <AppIcon name="search" size={14} className="text-text-secondary shrink-0" />
                <input
                  ref={overflowSearchRef}
                  type="text"
                  value={overflowQuery}
                  onChange={(e) => setOverflowQuery(e.target.value)}
                  placeholder="过滤已打开的标签页..."
                  className="w-full bg-transparent text-label text-text-primary placeholder:text-text-secondary/60 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {filteredOverflowTabs.length === 0 ? (
                <div className="py-6 text-center text-label text-text-secondary">无匹配标签页</div>
              ) : (
                filteredOverflowTabs.map((t) => {
                  const isNewTab = isNewTabPath(t.path)
                  const isItemActive = t.path === activeTabPath
                  const itemNode = isNewTab ? null : buildSyntheticFileNode(t.path, workspacePath)
                  const name = isNewTab ? '新标签页' : getFileBaseName(t.path)
                  return (
                    <div
                      key={t.path}
                      onClick={() => {
                        setOverflowOpen(false)
                        void activateTab(t.path)
                      }}
                      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-label transition-colors ${
                        isItemActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      {itemNode ? (
                        <WorkbenchDocumentIcon node={itemNode} size={15} className="w-[15px] h-[15px]" />
                      ) : (
                        <AppIcon name="note_add" size={15} className="text-text-secondary shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`truncate ${!isNewTab && t.isPreview ? 'italic' : ''}`}>{name}</div>
                        {!isNewTab && (
                          <div className="text-caption text-text-secondary truncate font-mono">
                            {getParentDirLabel(t.path)}
                          </div>
                        )}
                      </div>
                      {t.isPinned && (
                        <AppIcon name="push_pin" size={12} className="text-primary/70 shrink-0" />
                      )}
                      {!isNewTab && isItemActive && isDirty && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" title="未保存" />
                      )}
                      {!t.isPinned && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void requestCloseTab(t.path)
                          }}
                          className="w-5 h-5 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/15 text-text-secondary"
                          aria-label={`关闭 ${name}`}
                        >
                          <AppIcon name="close" size={12} />
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            <div className="p-1.5 border-t border-black/5 dark:border-white/10 flex items-center justify-between text-caption">
              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false)
                  void closeSavedTabs()
                }}
                className="px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
              >
                关闭已保存
              </button>
              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false)
                  if (activeTabPath) void closeOtherTabs(activeTabPath)
                }}
                disabled={!activeTabPath}
                className="px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40"
              >
                关闭其他
              </button>
              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false)
                  void closeAllTabs()
                }}
                className="px-2 py-1 rounded-md text-red-600 dark:text-red-400 hover:bg-red-500/10"
              >
                全部关闭
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* 标签右键上下文菜单 */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            style={{
              left: Math.max(8, Math.min(window.innerWidth - 216, contextMenu.x)),
              top: Math.max(8, Math.min(window.innerHeight - 280, contextMenu.y))
            }}
            className="fixed z-popover w-[208px] py-1.5 liquid-glass-menu rounded-xl text-label select-none"
          >
            {!contextMenu.tab.isPinned && (
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.tab.path
                  setContextMenu(null)
                  void requestCloseTab(p)
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span>关闭</span>
                <span className="text-caption text-text-secondary font-mono">Ctrl+W</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const p = contextMenu.tab.path
                setContextMenu(null)
                void closeOtherTabs(p)
              }}
              className="w-full flex items-center px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
            >
              关闭其他标签
            </button>
            {!contextMenu.tab.isPinned && (
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.tab.path
                  setContextMenu(null)
                  void closeRightTabs(p)
                }}
                className="w-full flex items-center px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
              >
                关闭右侧标签
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setContextMenu(null)
                void closeSavedTabs()
              }}
              className="w-full flex items-center px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
            >
              关闭已保存标签
            </button>
            <div className="my-1 border-t border-black/5 dark:border-white/10" />
            {contextMenu.tab.isPreview && (
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.tab.path
                  setContextMenu(null)
                  promoteTab(p)
                }}
                className="w-full flex items-center px-3 py-1.5 text-left text-primary hover:bg-black/5 dark:hover:bg-white/10"
              >
                保持打开（转为常驻）
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const p = contextMenu.tab.path
                setContextMenu(null)
                togglePinTab(p)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
            >
              <AppIcon name="push_pin" size={14} className="text-text-secondary" />
              <span>{contextMenu.tab.isPinned ? '取消固定标签页' : '固定到左侧'}</span>
            </button>
            {!isNewTabPath(contextMenu.tab.path) && (
              <>
                <div className="my-1 border-t border-black/5 dark:border-white/10" />
                <button
                  type="button"
                  onClick={() => {
                    const p = contextMenu.tab.path
                    setContextMenu(null)
                    if (isLeftCollapsed) toggleLeftCollapse()
                    expandAncestorsOf(p)
                    void openFile(p)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <AppIcon name="folder_open" size={14} className="text-text-secondary" />
                  <span>在文件树中定位</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const p = contextMenu.tab.path
                    setContextMenu(null)
                    void revealFile(p)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <AppIcon name="open_in_new" size={14} className="text-text-secondary" />
                  <span>在资源管理器中显示</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const node = buildSyntheticFileNode(contextMenu.tab.path, workspacePath)
                    setContextMenu(null)
                    requestUploadNodesToAi({ nodes: [node], target: 'ai' })
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-primary font-medium hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <AppIcon name="forum" size={14} className="text-primary" />
                  <span>发送到右侧 AI 侧栏</span>
                </button>
              </>
            )}
          </div>,
          document.body
        )}

      {/* Ctrl+Tab MRU 快速切换弹窗 */}
      <Modal
        open={mruModalOpen}
        onClose={() => setMruModalOpen(false)}
        size="sm"
        variant="glass"
      >
        <ModalHeader
          title="最近访问的标签页"
          subtitle="↑↓ 选择 · Enter 切换 · Esc 取消"
          icon="history"
          onClose={() => setMruModalOpen(false)}
        />
        <div className="max-h-[320px] overflow-y-auto p-2 space-y-0.5">
          {orderedMruTabs.map((t, idx) => {
            const isNewTab = isNewTabPath(t.path)
            const node = isNewTab ? null : buildSyntheticFileNode(t.path, workspacePath)
            const name = isNewTab ? '新标签页' : getFileBaseName(t.path)
            const selected = idx === mruSelectedIndex
            return (
              <button
                key={t.path}
                type="button"
                onClick={() => {
                  setMruModalOpen(false)
                  void activateTab(t.path)
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-label transition-colors ${
                  selected
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                {node ? (
                  <WorkbenchDocumentIcon node={node} size={15} className="w-[15px] h-[15px]" />
                ) : (
                  <AppIcon name="note_add" size={15} className="text-text-secondary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{name}</div>
                  {!isNewTab && (
                    <div className="text-caption text-text-secondary truncate font-mono">{t.path}</div>
                  )}
                </div>
                {!isNewTab && t.path === activeFilePath && isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </Modal>

      {/* 外部冲突或未保存失败时的关闭确认弹窗 */}
      <Modal
        open={Boolean(confirmClosePath)}
        onClose={() => setConfirmClosePath(null)}
        size="sm"
        variant="glass"
      >
        <ModalHeader
          title={saveStatus === 'conflict' ? '文件存在磁盘冲突' : '关闭标签页'}
          icon="warning"
          iconClassName="text-amber-500"
          onClose={() => setConfirmClosePath(null)}
        />
        <div className="p-4 text-body text-text-secondary leading-relaxed">
          {saveStatus === 'conflict'
            ? `「${confirmClosePath ? getFileBaseName(confirmClosePath) : ''}」在磁盘上已被外部修改，自动保存已暂停。是否放弃当前未保存改动并关闭？`
            : `「${confirmClosePath ? getFileBaseName(confirmClosePath) : ''}」尚未保存成功，确认直接关闭并放弃未保存更改？`}
        </div>
        <ModalFooter className="justify-end">
          <button
            type="button"
            onClick={() => setConfirmClosePath(null)}
            className="h-9 rounded-lg border border-gray-200 bg-sidebar px-4 text-body text-text-secondary hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              const target = confirmClosePath
              setConfirmClosePath(null)
              if (target) void closeTab(target, { force: true })
            }}
            className="h-9 rounded-lg bg-red-600 px-4 text-body font-medium text-white hover:opacity-90"
          >
            放弃改动并关闭
          </button>
        </ModalFooter>
      </Modal>
    </>
  )
}
