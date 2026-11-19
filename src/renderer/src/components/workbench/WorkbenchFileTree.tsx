import { useState, useRef, useEffect, useCallback } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { WorkbenchFileNode } from '../../../../shared/types/workbench'
import WorkbenchSearch from './WorkbenchSearch'

interface ContextMenuState {
  x: number
  y: number
  node: WorkbenchFileNode | null
}

interface ActionModalState {
  type: 'createFile' | 'createFolder' | 'rename' | 'delete'
  targetNode: WorkbenchFileNode | null
  defaultValue?: string
}

export default function WorkbenchFileTree(): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const workspaceName = useWorkbenchStore((s) => s.workspaceName)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const expandedFolderIds = useWorkbenchStore((s) => s.expandedFolderIds)
  const isLoadingTree = useWorkbenchStore((s) => s.isLoadingTree)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const isDirty = useWorkbenchStore((s) => s.isDirty)

  const selectWorkspaceFolder = useWorkbenchStore((s) => s.selectWorkspaceFolder)
  const closeWorkspace = useWorkbenchStore((s) => s.closeWorkspace)
  const loadFileTree = useWorkbenchStore((s) => s.loadFileTree)
  const toggleFolder = useWorkbenchStore((s) => s.toggleFolder)
  const collapseAllFolders = useWorkbenchStore((s) => s.collapseAllFolders)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const createFile = useWorkbenchStore((s) => s.createFile)
  const createFolder = useWorkbenchStore((s) => s.createFolder)
  const renameNode = useWorkbenchStore((s) => s.renameNode)
  const deleteNode = useWorkbenchStore((s) => s.deleteNode)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (actionModal && actionModal.type !== 'delete') {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [actionModal])

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

  const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkbenchFileNode | null) => {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setContextMenu({ x, y, node })
  }, [])

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!actionModal) return

    const { type, targetNode } = actionModal
    const trimmed = inputValue.trim()

    if (type === 'createFile') {
      const parent = targetNode ? (targetNode.isDirectory ? targetNode.path : targetNode.path.split('/').slice(0, -1).join('/')) : ''
      if (trimmed) {
        await createFile(parent, trimmed)
      }
    } else if (type === 'createFolder') {
      const parent = targetNode ? (targetNode.isDirectory ? targetNode.path : targetNode.path.split('/').slice(0, -1).join('/')) : ''
      if (trimmed) {
        await createFolder(parent, trimmed)
      }
    } else if (type === 'rename' && targetNode) {
      if (trimmed && trimmed !== targetNode.name) {
        const parts = targetNode.path.split('/')
        parts[parts.length - 1] = trimmed
        const newPath = parts.join('/')
        await renameNode(targetNode.path, newPath)
      }
    } else if (type === 'delete' && targetNode) {
      await deleteNode(targetNode.path)
    }

    setActionModal(null)
    setInputValue('')
  }

  // 递归渲染树节点
  const renderNode = (node: WorkbenchFileNode, level = 0) => {
    const isExpanded = expandedFolderIds.has(node.id)
    const isActive = activeFilePath === node.path

    if (node.isDirectory) {
      return (
        <div key={node.id} className="select-none">
          <div
            onContextMenu={(e) => handleContextMenu(e, node)}
            onClick={() => toggleFolder(node.id)}
            style={{ paddingLeft: `${level * 14 + 8}px` }}
            className="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-text-primary transition-colors text-xs group"
          >
            <span className="material-symbols-outlined text-[15px] text-text-secondary transition-transform duration-150">
              {isExpanded ? 'expand_more' : 'chevron_right'}
            </span>
            <span className="material-symbols-outlined text-[16px] text-amber-500">
              {isExpanded ? 'folder_open' : 'folder'}
            </span>
            <span className="truncate flex-1 font-medium">{node.name}</span>
          </div>
          {isExpanded && node.children && node.children.length > 0 && (
            <div>{node.children.map((child: WorkbenchFileNode) => renderNode(child, level + 1))}</div>
          )}
          {isExpanded && (!node.children || node.children.length === 0) && (
            <div
              style={{ paddingLeft: `${(level + 1) * 14 + 24}px` }}
              className="py-1 text-[11px] text-text-secondary/60 italic"
            >
              (空目录)
            </div>
          )}
        </div>
      )
    }

    // 文件节点
    const isMarkdown = node.extension === '.md' || node.extension === '.markdown'
    return (
      <div
        key={node.id}
        onContextMenu={(e) => handleContextMenu(e, node)}
        onClick={() => void openFile(node.path)}
        style={{ paddingLeft: `${level * 14 + 24}px` }}
        className={`flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-xs transition-colors group select-none ${
          isActive
            ? 'bg-blue-500/10 dark:bg-blue-500/20 text-primary dark:text-blue-400 font-medium'
            : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        <span
          className={`material-symbols-outlined text-[15px] ${
            isMarkdown ? 'text-blue-500/80 dark:text-blue-400/80' : 'text-text-secondary/70'
          }`}
        >
          {isMarkdown ? 'description' : 'draft'}
        </span>
        <span className="truncate flex-1">{node.name}</span>
        {isActive && isDirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="未保存的修改" />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-slate-50/70 dark:bg-gray-900/50 backdrop-blur-md overflow-hidden text-xs select-none border-r border-black/5 dark:border-white/5">
      {/* 头部：工作区名称与核心操作 */}
      <div className="h-10 px-3 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-1 shrink-0">
        <div
          className="flex items-center gap-1.5 font-semibold text-text-primary truncate cursor-pointer hover:text-primary transition-colors"
          title={`当前工作区: ${workspacePath}`}
          onClick={() => void selectWorkspaceFolder()}
        >
          <span className="material-symbols-outlined text-[17px] text-amber-500">folder_open</span>
          <span className="truncate text-xs">{workspaceName || '未选工作区'}</span>
        </div>

        {/* 快捷按钮组 */}
        <div className="flex items-center gap-0.5 text-text-secondary">
          <button
            type="button"
            onClick={() => setIsSearchMode(!isSearchMode)}
            className={`w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
              isSearchMode ? 'text-primary bg-black/5 dark:bg-white/5' : ''
            }`}
            title="搜索笔记"
          >
            <span className="material-symbols-outlined text-[16px]">search</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setInputValue('未命名笔记.md')
              setActionModal({ type: 'createFile', targetNode: null })
            }}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary transition-colors"
            title="新建笔记"
          >
            <span className="material-symbols-outlined text-[16px]">note_add</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setInputValue('新建文件夹')
              setActionModal({ type: 'createFolder', targetNode: null })
            }}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary transition-colors"
            title="新建文件夹"
          >
            <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
          </button>
          <button
            type="button"
            onClick={collapseAllFolders}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary transition-colors"
            title="折叠全部"
          >
            <span className="material-symbols-outlined text-[16px]">unfold_less</span>
          </button>
          <button
            type="button"
            onClick={() => void loadFileTree()}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary transition-colors"
            title="刷新目录"
          >
            <span className={`material-symbols-outlined text-[16px] ${isLoadingTree ? 'animate-spin' : ''}`}>
              refresh
            </span>
          </button>
          <button
            type="button"
            onClick={() => void closeWorkspace()}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 hover:text-rose-500 transition-colors"
            title="关闭工作区"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      {/* 搜索视图或树状文件列表 */}
      <div className="flex-1 overflow-y-auto p-1.5" onContextMenu={(e) => handleContextMenu(e, null)}>
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
            {fileTree.map((node) => renderNode(node))}
          </>
        )}
      </div>

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[170px] py-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-xs animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {(!contextMenu.node || contextMenu.node.isDirectory) && (
            <>
              <button
                type="button"
                onClick={() => {
                  setInputValue('未命名笔记.md')
                  setActionModal({ type: 'createFile', targetNode: contextMenu.node })
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[16px] text-blue-500">note_add</span>
                <span>新建笔记</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputValue('新建文件夹')
                  setActionModal({ type: 'createFolder', targetNode: contextMenu.node })
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[16px] text-amber-500">create_new_folder</span>
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
                <span className="material-symbols-outlined text-[16px]">edit</span>
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
                <span className="material-symbols-outlined text-[16px]">folder</span>
                <span>在资源管理器中显示</span>
              </button>
              <div className="my-1 border-t border-black/5 dark:border-white/5" />
              <button
                type="button"
                onClick={() => {
                  setActionModal({ type: 'delete', targetNode: contextMenu.node })
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>删除 (移至回收站)</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 新建 / 重命名 / 删除 弹窗 */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <form
            onSubmit={handleModalSubmit}
            className="w-[360px] p-5 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 flex flex-col gap-4 text-xs"
          >
            <div className="flex items-center justify-between font-semibold text-sm text-text-primary">
              <span>
                {actionModal.type === 'createFile'
                  ? '新建笔记'
                  : actionModal.type === 'createFolder'
                  ? '新建文件夹'
                  : actionModal.type === 'rename'
                  ? '重命名'
                  : '确认删除'}
              </span>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="text-text-secondary hover:text-text-primary"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {actionModal.type === 'delete' ? (
              <p className="text-text-secondary text-xs leading-relaxed">
                确定要将「<strong className="text-text-primary">{actionModal.targetNode?.name}</strong>」移至系统回收站吗？
              </p>
            ) : (
              <div>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="请输入名称..."
                  className="w-full h-8 px-3 rounded-lg border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/5 focus:bg-white dark:focus:bg-gray-900 text-text-primary focus:outline-none focus:border-primary text-xs"
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
                className={`px-3 py-1.5 rounded-lg text-white font-medium shadow-xs ${
                  actionModal.type === 'delete'
                    ? 'bg-rose-500 hover:bg-rose-600'
                    : 'bg-primary hover:bg-primary/90'
                }`}
              >
                {actionModal.type === 'delete' ? '确认移入回收站' : '确定'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
