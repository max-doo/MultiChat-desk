import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { GitFileChange } from '../../../../shared/types/workbench'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchFooterPopover, { WorkbenchFooterPopoverHeader } from './WorkbenchFooterPopover'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  // 渲染层拿不到 process；盘符路径按 Windows 规则忽略大小写，POSIX 路径保持原样
  return /^[a-zA-Z]:(\/|$)/.test(normalized) ? normalized.toLowerCase() : normalized
}

/** 默认提交标题：普通提交用日期 + 时间；仓库首次提交沿用通用命名 */
function defaultCommitTitle(isFirstCommit: boolean): string {
  if (isFirstCommit) return 'Initial commit'
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function changeBadge(change: GitFileChange): { label: string; className: string } {
  if (change.conflicted) return { label: '!', className: 'text-rose-500' }
  if (change.untracked) return { label: 'U', className: 'text-emerald-500' }
  const code = change.staged ?? change.unstaged
  switch (code) {
    case 'added':
      return { label: 'A', className: 'text-emerald-500' }
    case 'deleted':
      return { label: 'D', className: 'text-rose-500' }
    case 'renamed':
      return { label: 'R', className: 'text-amber-500' }
    case 'copied':
      return { label: 'C', className: 'text-sky-500' }
    default:
      return { label: 'M', className: 'text-amber-500' }
  }
}

/**
 * 工作区版本管理：状态、提交与远程同步。
 * 入口由 footer 与仓库切换并排提供，这里只负责状态徽标与向上展开的面板。
 */
export default function WorkbenchGitPanel({
  onOpenWorkspaceSettings
}: {
  onOpenWorkspaceSettings: () => void
}): JSX.Element | null {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const gitStatus = useWorkbenchStore((s) => s.gitStatus)
  const isGitBusy = useWorkbenchStore((s) => s.isGitBusy)
  const isGitLoading = useWorkbenchStore((s) => s.isGitLoading)
  const gitNotice = useWorkbenchStore((s) => s.gitNotice)
  const refreshGitStatus = useWorkbenchStore((s) => s.refreshGitStatus)
  const gitCommit = useWorkbenchStore((s) => s.gitCommit)
  const gitPull = useWorkbenchStore((s) => s.gitPull)
  const gitMergeUpstream = useWorkbenchStore((s) => s.gitMergeUpstream)
  const gitAbortMerge = useWorkbenchStore((s) => s.gitAbortMerge)
  const gitPush = useWorkbenchStore((s) => s.gitPush)
  const gitInit = useWorkbenchStore((s) => s.gitInit)
  const clearGitNotice = useWorkbenchStore((s) => s.clearGitNotice)

  const [isOpen, setIsOpen] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)

  const status = gitStatus
  const changes = status?.changes ?? []
  const changeCount = status?.changeCount ?? 0
  // 未输入时按当前时间生成标题，避免把上一次的标题带到下一次提交
  const effectiveTitle = titleTouched && title.trim() ? title.trim() : defaultCommitTitle(Boolean(status?.unborn))
  const canCommit = Boolean(status?.isRepository) && changeCount > 0 && effectiveTitle.length > 0
  // 只有已跟踪文件的改动会阻止拉取；未跟踪文件若与远程同名，Git 会拒绝并给出明确提示。
  const dirtyForSync = Boolean(status && status.blockingChangeCount > 0)
  const diverged = Boolean(status && status.ahead > 0 && status.behind > 0)
  const behindOnly = Boolean(status && status.ahead === 0 && status.behind > 0)
  const hasLargeUntracked = Boolean(status?.largeUntracked.length)
  // 工作区可能是更大仓库的子目录：提交已限定在工作区内，但拉取/合并会更新整个仓库。
  const isNestedWorkspace = Boolean(
    status?.repoRoot && workspacePath && normalizePath(status.repoRoot) !== normalizePath(workspacePath)
  )

  const open = useCallback(() => {
    setIsOpen(true)
    setTitle('')
    setTitleTouched(false)
    void refreshGitStatus({ showLoading: true })
  }, [refreshGitStatus])

  useEffect(() => {
    if (isOpen) titleRef.current?.focus()
  }, [isOpen])

  // 切换工作区时关闭，避免把上一个仓库的提交标题带到新工作区
  useEffect(() => {
    setIsOpen(false)
  }, [workspacePath])

  const branchLabel = useMemo(() => {
    if (!status) return '版本管理'
    if (!status.available) return '版本管理'
    if (!status.isRepository) return '未启用'
    return status.branch ?? (status.detached ? '游离状态' : '未命名分支')
  }, [status])

  const footerTitle = useMemo(() => {
    const lines = ['版本管理']
    if (!status) return lines.join('\n')
    if (!status.available) return [...lines, status.error ?? '未检测到 Git'].join('\n')
    if (!status.isRepository) return [...lines, '当前工作区还不是 Git 仓库'].join('\n')

    lines.push(`分支：${status.branch ?? (status.detached ? '游离状态' : '未命名分支')}`)
    if (status.conflictCount > 0) lines.push(`冲突：${status.conflictCount}`)
    if (status.changeCount > 0) lines.push(`改动：${status.changeCount}`)
    if (status.behind > 0) lines.push(`落后远程：${status.behind}`)
    if (status.ahead > 0) lines.push(`领先远程：${status.ahead}`)
    if (hasLargeUntracked) lines.push(`${status.largeUntracked.length} 个未跟踪文件超过 50 MB`)
    return lines.join('\n')
  }, [hasLargeUntracked, status])

  const handleCommit = async (): Promise<void> => {
    if (!canCommit) return
    let allowLargeFiles = false
    if (hasLargeUntracked) {
      const confirmed = window.confirm(
        `有 ${status?.largeUntracked.length ?? 0} 个未跟踪文件超过 50 MB。提交会把它们一起加入仓库，托管平台可能拒绝或拖慢同步。\n\n仍要提交吗？`
      )
      if (!confirmed) return
    }
    allowLargeFiles = hasLargeUntracked
    const result = await gitCommit(effectiveTitle, undefined, allowLargeFiles)
    if (result.success) {
      setTitle('')
      setTitleTouched(false)
    }
  }

  const handlePull = async (): Promise<void> => {
    if (isNestedWorkspace) {
      const confirmed = window.confirm(
        '当前工作区是仓库的子目录，拉取会同步整个仓库，包括工作区之外的文件。\n\n继续？'
      )
      if (!confirmed) return
    }
    if (dirtyForSync) {
      const confirmed = window.confirm(
        '本地还有未提交的改动。先提交这些改动，再拉取？'
      )
      if (confirmed) {
        setIsSyncing(true)
        try {
          // 同步流程不替用户确认大文件：命中时保留改动，引导去设置里忽略。
          const result = await gitCommit(effectiveTitle)
          if (result.success) {
            await gitPull()
          } else if (result.failure === 'large-files') {
            onOpenWorkspaceSettings()
          }
        } finally {
          setIsSyncing(false)
        }
      }
      return
    }
    setIsSyncing(true)
    try {
      await gitPull()
    } finally {
      setIsSyncing(false)
    }
  }

  const handlePush = async (): Promise<void> => {
    if (!status) return
    if (status.unborn) {
      useWorkbenchStore.getState().setGitNotice({ tone: 'info', message: '先提交一次，再推送' })
      return
    }
    if (!status.upstream) {
      const confirmed = window.confirm(
        `将当前分支「${status.branch ?? 'HEAD'}」推送到远程，并关联为跟踪分支？`
      )
      if (!confirmed) return
      await gitPush(true)
      return
    }
    setIsSyncing(true)
    try {
      await gitPush(false)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleMerge = async (): Promise<void> => {
    const confirmed = window.confirm(
      `本地和远程都有新的提交，将把远程提交合并到当前分支。${
        isNestedWorkspace ? '\n\n当前工作区是仓库的子目录，合并会影响整个仓库。' : ''
      }\n\n若出现冲突，会撤销这次合并并恢复操作前的文件。继续？`
    )
    if (!confirmed) return
    setIsSyncing(true)
    try {
      await gitMergeUpstream()
    } finally {
      setIsSyncing(false)
    }
  }

  const handleInit = async (): Promise<void> => {
    const confirmed = window.confirm('在当前工作区初始化 Git 仓库？现有文件不会被修改。')
    if (confirmed) await gitInit()
  }

  if (!workspacePath) return null

  const branchBadge = (
    <>
      {status?.isRepository && (
        <>
          {status.conflictCount > 0 ? (
            <span className="text-rose-500">{status.conflictCount} 冲突</span>
          ) : (
            changeCount > 0 && <span className="text-amber-500">{changeCount}</span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center gap-0.5 text-sky-500" title={`落后远程 ${status.behind} 个提交`}>
              <AppIcon name="arrow_downward" size={13} />
              {status.behind}
            </span>
          )}
          {status.ahead > 0 && (
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400" title={`领先远程 ${status.ahead} 个提交`}>
              <AppIcon name="arrow_upward" size={13} />
              {status.ahead}
            </span>
          )}
        </>
      )}
    </>
  )

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        className="flex h-10 min-w-0 max-w-[52%] items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        title={footerTitle}
      >
        <AppIcon name="git_branch" size={17} className="shrink-0" />
        <span className="min-w-0 max-w-[72px] truncate">{branchLabel}</span>
        <span className="flex shrink-0 items-center gap-1">{branchBadge}</span>
        {hasLargeUntracked && (
          <span className="shrink-0 text-amber-500" title="有较大的未跟踪文件">
            <AppIcon name="warning" size={13} />
          </span>
        )}
      </button>

      {isOpen && (
        <WorkbenchFooterPopover
          anchorRef={triggerRef}
          ariaLabel="版本管理"
          onRequestClose={() => {
            if (!useWorkbenchStore.getState().isGitBusy) setIsOpen(false)
          }}
        >
          <WorkbenchFooterPopoverHeader
            title="版本管理"
            subtitle={status?.isRepository ? branchLabel : undefined}
            onClose={() => setIsOpen(false)}
            actions={
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void refreshGitStatus({ showLoading: true })}
                  disabled={isGitLoading}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40"
                  title="刷新"
                >
                  <AppIcon name="refresh" size={15} className={isGitLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            }
          />

          {!status ? (
            <div className="px-3 py-6 text-center text-xs text-text-secondary">
              {isGitLoading ? '读取中…' : '暂无状态'}
            </div>
          ) : !status.available ? (
            <div className="px-3 py-5 text-xs leading-relaxed text-text-secondary">
              {status.error ?? '未检测到 Git'}
            </div>
          ) : !status.isRepository ? (
            <div className="flex flex-col gap-3 px-3 py-4">
              <p className="text-xs text-text-secondary">当前工作区还不是 Git 仓库</p>
              <button
                type="button"
                onClick={() => void handleInit()}
                disabled={isGitBusy}
                className="h-8 rounded-lg bg-primary text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                初始化仓库
              </button>
            </div>
          ) : (
            <>
              {status.merging && (
                <div className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AppIcon name="warning" size={14} />
                    <span>合并尚未完成</span>
                  </div>
                  <p className="mt-1 leading-relaxed">
                    {status.conflictCount > 0
                      ? `${status.conflictCount} 个文件有冲突。撤销后文件回到拉取前的状态。`
                      : '撤销后文件回到拉取前的状态。'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void gitAbortMerge()}
                    disabled={isGitBusy}
                    className="mt-2 h-7 w-full rounded-md bg-amber-500/90 text-[11px] font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                  >
                    撤销本次拉取
                  </button>
                </div>
              )}

              {hasLargeUntracked && (
                <div className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AppIcon name="warning" size={14} />
                    <span>{status.largeUntracked.length} 个未跟踪文件超过 50 MB</span>
                  </div>
                  <p className="mt-1 truncate" title={status.largeUntracked.map((item) => item.path).join('\n')}>
                    {status.largeUntracked[0].path}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false)
                      onOpenWorkspaceSettings()
                    }}
                    className="mt-1.5 h-6 rounded-md bg-amber-500/90 px-2 text-[11px] font-medium text-white hover:bg-amber-500"
                  >
                    去忽略
                  </button>
                </div>
              )}

              {changeCount > 0 ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
                  {changes.map((change) => {
                    const badge = changeBadge(change)
                    return (
                      <div
                        key={`${change.oldPath ?? ''}:${change.path}`}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs"
                        title={change.oldPath ? `${change.oldPath} → ${change.path}` : change.path}
                      >
                        <span className={`w-3 shrink-0 text-center font-mono font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                        <span className="truncate flex-1 text-text-primary">{change.path.split('/').pop()}</span>
                        <span className="max-w-[45%] shrink-0 truncate text-[10px] text-text-secondary/70">
                          {change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''}
                        </span>
                      </div>
                    )
                  })}
                  {status.changesTruncated && (
                    <div className="px-1.5 py-1 text-[11px] text-text-secondary">仅显示前 500 项</div>
                  )}
                </div>
              ) : (
                <div className="px-3 py-4 text-center text-xs text-text-secondary">没有未提交的改动</div>
              )}

              <div className="border-t border-black/5 p-2.5 dark:border-white/5">
                <input
                  ref={titleRef}
                  value={titleTouched ? title : ''}
                  placeholder={defaultCommitTitle(Boolean(status.unborn))}
                  onChange={(event) => {
                    setTitle(event.target.value)
                    setTitleTouched(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleCommit()
                    if (event.key === 'Escape') setIsOpen(false)
                  }}
                  className="mb-2 h-8 w-full rounded-lg border border-black/15 bg-black/5 px-2.5 text-xs text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-white/15 dark:bg-white/5 dark:focus:bg-gray-900"
                />
                <button
                  type="button"
                  onClick={() => void handleCommit()}
                  disabled={!canCommit || isGitBusy}
                  className="mb-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <AppIcon name="git_commit" size={15} />
                  <span>提交 {changeCount > 0 ? changeCount : ''} 项改动</span>
                </button>

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void (diverged ? handleMerge() : handlePull())}
                    disabled={isGitBusy || isSyncing || !status.upstream}
                    className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-black/10 text-[11px] text-text-primary hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                    title={
                      !status.upstream
                        ? '尚未关联远程分支'
                        : dirtyForSync
                          ? '先提交或忽略本地改动再拉取'
                          : diverged
                            ? '本地与远程都有新提交，点击合并'
                            : behindOnly
                              ? `拉取 ${status.behind} 个提交`
                              : '已是最新'
                    }
                  >
                    <AppIcon name={diverged ? 'git_merge' : 'cloud_download'} size={14} />
                    <span>{diverged ? '合并' : '拉取'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePush()}
                    disabled={isGitBusy || isSyncing || status.detached || status.unborn || (!status.hasRemote && !status.upstream)}
                    className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-black/10 text-[11px] text-text-primary hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                    title={
                      !status.hasRemote && !status.upstream
                        ? '尚未配置远程仓库，可在工作区设置中填写地址'
                        : status.detached
                          ? '当前不在任何分支上'
                          : !status.upstream
                            ? '首次推送并关联远程分支'
                            : status.ahead > 0
                              ? `推送 ${status.ahead} 个提交`
                              : '已是最新'
                    }
                  >
                    <AppIcon name="cloud_upload" size={14} />
                    <span>推送</span>
                  </button>
                </div>
                {!status.hasRemote && !status.upstream && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false)
                      onOpenWorkspaceSettings()
                    }}
                    className="mt-1.5 h-7 w-full rounded-md text-[11px] text-primary hover:bg-primary/5"
                  >
                    设置远程仓库
                  </button>
                )}
              </div>
            </>
          )}

          {gitNotice && (
            <div
              className={`flex items-start gap-1.5 border-t px-3 py-2 text-[11px] leading-relaxed ${
                gitNotice.tone === 'error'
                  ? 'border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                  : gitNotice.tone === 'warning'
                    ? 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200'
                    : gitNotice.tone === 'success'
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'border-black/5 bg-black/[0.02] text-text-secondary dark:border-white/5 dark:bg-white/[0.02]'
              }`}
            >
              <span className="flex-1">{gitNotice.message}</span>
              <button type="button" onClick={clearGitNotice} className="shrink-0 opacity-60 hover:opacity-100">
                <AppIcon name="close" size={12} />
              </button>
            </div>
          )}
        </WorkbenchFooterPopover>
      )}
    </div>
  )
}

