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

export function getNodeIcon(node: WorkbenchFileNode): { icon: string; color: string } {
  if (node.isDirectory) {
    return { icon: 'folder', color: 'text-amber-500' }
  }

  const ext = (node.extension || '').toLowerCase()
  const name = node.name.toLowerCase()

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
  if (ext === '.docx' || ext === '.doc') {
    return { icon: 'article', color: 'text-indigo-600 dark:text-indigo-400' }
  }

  // 纯文本专属图标
  if (['.txt', '.log', '.csv', '.tsv'].includes(ext)) {
    return { icon: 'text_snippet', color: 'text-slate-500 dark:text-slate-400' }
  }

  // 代码文件专属图标 (按语言与用途细分)
  if (['.ts', '.tsx'].includes(ext)) {
    return { icon: 'code', color: 'text-blue-600 dark:text-blue-400' }
  }
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return { icon: 'javascript', color: 'text-amber-500 dark:text-amber-400' }
  }
  if (['.html', '.htm', '.vue', '.svelte'].includes(ext)) {
    return { icon: 'html', color: 'text-orange-500 dark:text-orange-400' }
  }
  if (['.css', '.scss', '.less', '.sass'].includes(ext)) {
    return { icon: 'css', color: 'text-sky-500 dark:text-sky-400' }
  }
  if (['.json', '.json5'].includes(ext)) {
    return { icon: 'data_object', color: 'text-amber-500 dark:text-amber-400' }
  }
  if (['.yaml', '.yml', '.xml', '.toml', '.ini'].includes(ext)) {
    return { icon: 'settings', color: 'text-emerald-500 dark:text-emerald-400' }
  }
  if (['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd'].includes(ext)) {
    return { icon: 'terminal', color: 'text-emerald-500 dark:text-emerald-400' }
  }
  if (['.py', '.pyw'].includes(ext)) {
    return { icon: 'code', color: 'text-teal-600 dark:text-teal-400' }
  }
  if (
    ['.java', '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.rs', '.go', '.php', '.rb', '.sql'].includes(ext) ||
    name === 'dockerfile' ||
    name.startsWith('.env') ||
    name === '.gitignore'
  ) {
    return { icon: 'code', color: 'text-cyan-600 dark:text-cyan-400' }
  }

  return { icon: 'draft', color: 'text-text-secondary/70' }
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

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null)
  const [isVaultMenuOpen, setIsVaultMenuOpen] = useState(false)
  const [isVaultManageOpen, setIsVaultManageOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const vaultMenuRef = useRef<HTMLDivElement | null>(null)

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
            className="flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-text-primary transition-colors text-sm group"
          >
            <span className="material-symbols-outlined text-[19px] text-text-secondary transition-transform duration-150">
              {isExpanded ? 'expand_more' : 'chevron_right'}
            </span>
            <span className="material-symbols-outlined text-[19px] text-amber-500">
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
              className="py-1 text-sm text-text-secondary/60 italic"
            >
              (空目录)
            </div>
          )}
        </div>
      )
    }

    // 文件节点
    const iconVisuals = getNodeIcon(node)
    return (
      <div
        key={node.id}
        data-file-node={node.path}
        onContextMenu={(e) => handleContextMenu(e, node)}
        onClick={() => void openFile(node.path)}
        style={{ paddingLeft: `${level * 14 + 24}px` }}
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer text-sm transition-colors group select-none ${
          isActive
            ? 'bg-blue-500/10 dark:bg-blue-500/20 text-primary dark:text-blue-400 font-medium'
            : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        <span className={`material-symbols-outlined text-[19px] shrink-0 ${iconVisuals.color}`}>
          {iconVisuals.icon}
        </span>
        <span className="truncate flex-1">{node.name}</span>
        {isActive && isDirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="未保存的修改" />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm select-none border-r border-black/5 dark:border-white/5">
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
            onClick={() => {
              setInputValue('未命名笔记.md')
              setActionModal({ type: 'createFile', targetNode: null })
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="新建笔记"
          >
            <span className="material-symbols-outlined text-[20px]">note_add</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setInputValue('新建文件夹')
              setActionModal({ type: 'createFolder', targetNode: null })
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="新建文件夹"
          >
            <span className="material-symbols-outlined text-[20px]">create_new_folder</span>
          </button>
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
            {recentWorkspaces.length === 0 && !workspacePath && (
              <div className="px-3 py-2 text-text-secondary/70 text-xs">暂无历史工作区</div>
            )}
            {recentWorkspaces.map((p) => {
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
                  setInputValue('未命名笔记.md')
                  setActionModal({ type: 'createFile', targetNode: contextMenu.node })
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
                  setInputValue('新建文件夹')
                  setActionModal({ type: 'createFolder', targetNode: contextMenu.node })
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
              <div className="my-1 border-t border-black/5 dark:border-white/5" />
              <button
                type="button"
                onClick={() => {
                  setActionModal({ type: 'delete', targetNode: contextMenu.node })
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
              >
                <span className="material-symbols-outlined text-[19px]">delete</span>
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
            className="w-[360px] p-5 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 flex flex-col gap-4 text-sm"
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
                <span className="material-symbols-outlined text-[19px]">close</span>
              </button>
            </div>

            {actionModal.type === 'delete' ? (
              <p className="text-text-secondary text-sm leading-relaxed">
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
              {recentWorkspaces.length === 0 && (
                <div className="py-8 text-center text-text-secondary/70 text-xs">
                  暂无历史工作区
                </div>
              )}
              {recentWorkspaces.map((p) => {
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
              {workspacePath && (
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
