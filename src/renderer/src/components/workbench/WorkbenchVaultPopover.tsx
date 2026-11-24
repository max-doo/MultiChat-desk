import { useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchFooterPopover, { WorkbenchFooterPopoverHeader } from './WorkbenchFooterPopover'

interface WorkbenchVaultPopoverProps {
  anchorRef: { current: HTMLElement | null }
  onClose: () => void
}

/**
 * 知识库管理与切换一体化浮层：
 * 融合原先割裂的“切换工作区”与“管理仓库”二级弹窗。
 * 在单层面板中支持 1 击即时切换、路径查看、在资源管理器中打开、复制路径、以及从列表移除。
 */
export default function WorkbenchVaultPopover({
  anchorRef,
  onClose
}: WorkbenchVaultPopoverProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const defaultWorkspacePath = useWorkbenchStore((s) => s.defaultWorkspacePath)
  const recentWorkspaces = useWorkbenchStore((s) => s.recentWorkspaces)
  const setWorkspaceFolder = useWorkbenchStore((s) => s.setWorkspaceFolder)
  const removeRecentWorkspace = useWorkbenchStore((s) => s.removeRecentWorkspace)
  const selectWorkspaceFolder = useWorkbenchStore((s) => s.selectWorkspaceFolder)

  const [copiedPath, setCopiedPath] = useState<string | null>(null)

  const handleCopyPath = (event: React.MouseEvent, path: string): void => {
    event.stopPropagation()
    void navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setTimeout(() => {
      setCopiedPath((current) => (current === path ? null : current))
    }, 1500)
  }

  const handleOpenInSystem = (event: React.MouseEvent, path: string): void => {
    event.stopPropagation()
    void window.api.workbench.openInSystem(path, '')
  }

  const handleRemove = (event: React.MouseEvent, path: string): void => {
    event.stopPropagation()
    removeRecentWorkspace(path)
  }

  const customWorkspaces = recentWorkspaces.filter((p) => p !== defaultWorkspacePath)

  return (
    <WorkbenchFooterPopover
      anchorRef={anchorRef}
      ariaLabel="切换工作区"
      onRequestClose={onClose}
    >
      <WorkbenchFooterPopoverHeader
        title="切换工作区"
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5 text-sm">
        {/* 默认预设仓库 */}
        {defaultWorkspacePath && (() => {
          const p = defaultWorkspacePath
          const name = p.split(/[/\\]/).filter(Boolean).pop() || p
          const isCurrent = p === workspacePath
          return (
            <div
              key={p}
              className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                isCurrent
                  ? 'bg-primary/10'
                  : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center text-primary">
                <AppIcon name="home" size={19} />
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  if (!isCurrent) {
                    void setWorkspaceFolder(p, name)
                  }
                }}
                className="min-w-0 flex-1 text-left"
                title={p}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`truncate text-sm ${
                      isCurrent
                        ? 'font-semibold text-text-primary'
                        : 'font-medium text-text-primary'
                    }`}
                  >
                    {name}
                  </span>
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-tiny font-medium text-primary">
                    预设
                  </span>
                </div>
                <div className="truncate font-mono text-xs text-text-secondary">{p}</div>
              </button>

              <div className="flex shrink-0 items-center">
                {isCurrent && (
                  <div className="px-1 text-primary group-hover:hidden">
                    <AppIcon name="check" size={18} />
                  </div>
                )}
                <div className="hidden items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={(e) => handleOpenInSystem(e, p)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
                    title="在系统文件管理器中打开"
                  >
                    <AppIcon name="open_in_new" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleCopyPath(e, p)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
                    title={copiedPath === p ? '已复制路径' : '复制绝对路径'}
                  >
                    {copiedPath === p ? (
                      <AppIcon name="check" size={15} className="text-emerald-500" />
                    ) : (
                      <AppIcon name="content_copy" size={15} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {defaultWorkspacePath && <div className="my-1 border-t border-black/5 dark:border-white/5" />}

        {/* 自定义仓库列表 */}
        {customWorkspaces.length === 0 && !workspacePath && (
          <div className="px-3 py-6 text-center text-xs text-text-secondary/70">
            暂无历史工作区
          </div>
        )}

        {customWorkspaces.map((p) => {
          const name = p.split(/[/\\]/).filter(Boolean).pop() || p
          const isCurrent = p === workspacePath
          return (
            <div
              key={p}
              className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                isCurrent
                  ? 'bg-primary/10'
                  : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center text-amber-500">
                <AppIcon name="folder" size={19} />
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  if (!isCurrent) {
                    void setWorkspaceFolder(p, name)
                  }
                }}
                className="min-w-0 flex-1 text-left"
                title={p}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`truncate text-sm ${
                      isCurrent
                        ? 'font-semibold text-text-primary'
                        : 'font-medium text-text-primary'
                    }`}
                  >
                    {name}
                  </span>
                </div>
                <div className="truncate font-mono text-xs text-text-secondary">{p}</div>
              </button>

              <div className="flex shrink-0 items-center">
                {isCurrent && (
                  <div className="px-1 text-primary group-hover:hidden">
                    <AppIcon name="check" size={18} />
                  </div>
                )}
                <div className="hidden items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={(e) => handleOpenInSystem(e, p)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
                    title="在系统文件管理器中打开"
                  >
                    <AppIcon name="open_in_new" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleCopyPath(e, p)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
                    title={copiedPath === p ? '已复制路径' : '复制绝对路径'}
                  >
                    {copiedPath === p ? (
                      <AppIcon name="check" size={15} className="text-emerald-500" />
                    ) : (
                      <AppIcon name="content_copy" size={15} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRemove(e, p)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/10 hover:text-rose-500 dark:hover:bg-white/10"
                    title="从列表移除"
                  >
                    <AppIcon name="delete" size={15} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部快捷操作栏：单一入口打开本地文件夹 */}
      <div className="border-t border-black/5 p-2.5 dark:border-white/5">
        <button
          type="button"
          onClick={() => {
            onClose()
            void selectWorkspaceFolder()
          }}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white shadow-xs transition-colors hover:bg-primary/90"
        >
          <AppIcon name="folder_open" size={16} />
          <span>打开本地文件夹…</span>
        </button>
      </div>
    </WorkbenchFooterPopover>
  )
}
