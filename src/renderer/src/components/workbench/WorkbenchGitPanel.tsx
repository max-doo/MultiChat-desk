import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { GitFileChange, GitHistoryItem, GitStatus } from '../../../../shared/types/workbench'
import type { GitCommitDetail, GitCommitFile } from '../../../../shared/types/workbench'
import { buildGitGraphLayout } from '../../utils/gitGraphLayout'
import {
  GIT_BADGE_LEGEND_ORDER,
  GIT_BADGE_STYLES,
  resolveFileGitBadge,
  type GitStatusBadgeMeta
} from '../../utils/gitStatusBadge'
import ConfirmModal from '../ConfirmModal'
import { AppIcon } from '../icons/AppIcon'
import GitHistoryGraph from './GitHistoryGraph'
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

/** footer 只展示短分支名；完整名称通过 tooltip 和弹层标题补足 */
function branchName(status: GitStatus | null): string | null {
  if (!status) return null
  if (status.detached) return '游离状态'
  const branch = status.branch?.trim()
  if (branch) return branch
  const upstream = status.upstream?.trim()
  if (upstream) {
    const remote = status.remoteName?.trim()
    if (remote && upstream.startsWith(`${remote}/`)) {
      return upstream.slice(remote.length + 1)
    }
    const separator = upstream.indexOf('/')
    return separator >= 0 ? upstream.slice(separator + 1) : upstream
  }
  return 'HEAD'
}

function relativeTime(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (diff < 60) return '刚刚'
  const minutes = Math.floor(diff / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

/** 展开详情里展示的完整时间戳 */
function fullTimeLabel(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function isDeletedChange(change: GitFileChange): boolean {
  return change.staged === 'deleted' || change.unstaged === 'deleted'
}

/** 历史提交文件状态 → 状态徽标字母；typechange 归并到 Modified */
function commitFileBadgeCode(status: GitCommitFile['status']): 'M' | 'A' | 'D' | 'R' | 'C' {
  switch (status) {
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'copied': return 'C'
    default: return 'M'
  }
}

type ChangeMenuEntry =
  | { type: 'separator' }
  | {
      key: string
      label: string
      icon: string
      danger?: boolean
      action: () => void
    }

interface ConfirmChangeAction {
  kind: 'discard' | 'trash'
  change: GitFileChange
}

/**
 * 工作区版本管理：状态、提交与远程同步。
 * 入口由 footer 与仓库切换并排提供，这里只负责状态徽标与向上展开的面板。
 */
export default function WorkbenchGitPanel({
  compact = false,
  onOpenWorkspaceSettings
}: {
  compact?: boolean
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
  const gitDiscardFile = useWorkbenchStore((s) => s.gitDiscardFile)
  const gitTrashFile = useWorkbenchStore((s) => s.gitTrashFile)
  const gitIgnorePath = useWorkbenchStore((s) => s.gitIgnorePath)
  const clearGitNotice = useWorkbenchStore((s) => s.clearGitNotice)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'changes' | 'history'>('changes')
  const [logItems, setLogItems] = useState<GitHistoryItem[]>([])
  const [isLogLoading, setIsLogLoading] = useState(false)
  const [logLoaded, setLogLoaded] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null)
  const [commitDetails, setCommitDetails] = useState<Record<string, GitCommitDetail | 'loading' | 'error'>>({})
  const [isSyncing, setIsSyncing] = useState(false)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; change: GitFileChange } | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmChangeAction | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [badgeTooltip, setBadgeTooltip] = useState<{ meta: GitStatusBadgeMeta; x: number; y: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const legendButtonRef = useRef<HTMLButtonElement | null>(null)
  const legendPopoverRef = useRef<HTMLDivElement | null>(null)

  const fetchLog = useCallback(async () => {
    if (!workspacePath) return
    setIsLogLoading(true)
    setLogError(null)
    try {
      const res = await window.api.workbench.gitLog(workspacePath, 50)
      if (res.success && res.data) {
        setLogItems(res.data)
        setLogLoaded(true)
      } else {
        setLogError(res.error ?? '读取提交历史失败')
      }
    } catch (err: unknown) {
      setLogError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLogLoading(false)
    }
  }, [workspacePath])

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

  // 工作区是仓库子目录时，把仓库相对路径换算回工作区相对路径用于 openFile/revealFile
  const toWorkspaceRelativePath = useCallback(
    (repoRelativePath: string): string | null => {
      if (!status?.repoRoot || !workspacePath) return repoRelativePath
      const repoRoot = normalizePath(status.repoRoot).replace(/\/+$/, '')
      const ws = normalizePath(workspacePath).replace(/\/+$/, '')
      if (repoRoot === ws) return repoRelativePath
      const prefix = `${repoRoot}/`
      if (!ws.startsWith(prefix)) return null
      // 工作区相对仓库根的目录前缀，加上文件在仓库内的相对路径
      const workspacePrefixInRepo = ws.slice(prefix.length)
      if (!repoRelativePath.startsWith(`${workspacePrefixInRepo}/`)) return null
      return repoRelativePath.slice(workspacePrefixInRepo.length + 1)
    },
    [status?.repoRoot, workspacePath]
  )

  const toggleCommitDetail = useCallback(
    (commitId: string) => {
      if (expandedCommitId === commitId) {
        setExpandedCommitId(null)
        return
      }
      setExpandedCommitId(commitId)
      if (commitDetails[commitId] || !workspacePath) return
      setCommitDetails((prev) => ({ ...prev, [commitId]: 'loading' }))
      void window.api.workbench
        .gitCommitDetail(workspacePath, commitId)
        .then((res) => {
          setCommitDetails((prev) => ({
            ...prev,
            [commitId]: res.success && res.data ? res.data : 'error'
          }))
        })
        .catch(() => {
          setCommitDetails((prev) => ({ ...prev, [commitId]: 'error' }))
        })
    },
    [expandedCommitId, commitDetails, workspacePath]
  )

  const open = useCallback(() => {
    setIsOpen(true)
    setTitle('')
    setTitleTouched(false)
    setLogLoaded(false)
    void refreshGitStatus({ showLoading: true })
  }, [refreshGitStatus])

  const closePopover = useCallback(() => {
    setIsOpen(false)
    const currentNotice = useWorkbenchStore.getState().gitNotice
    if (currentNotice && (currentNotice.tone === 'success' || currentNotice.tone === 'info')) {
      clearGitNotice()
    }
  }, [clearGitNotice])

  useEffect(() => {
    if (isOpen && activeTab === 'changes') titleRef.current?.focus()
  }, [isOpen, activeTab])

  useEffect(() => {
    if (isOpen && activeTab === 'history' && status?.isRepository && !logLoaded && !isLogLoading) {
      void fetchLog()
    }
  }, [isOpen, activeTab, status?.isRepository, logLoaded, isLogLoading, fetchLog])

  // 切换工作区时关闭，避免把上一个仓库的提交标题带到新工作区
  useEffect(() => {
    setIsOpen(false)
    setActiveTab('changes')
    setLogItems([])
    setLogLoaded(false)
    setLogError(null)
    setExpandedCommitId(null)
    setCommitDetails({})
    setContextMenu(null)
    setConfirmAction(null)
    setLegendOpen(false)
    setBadgeTooltip(null)
  }, [workspacePath])

  useEffect(() => {
    if (!isOpen || activeTab !== 'changes') {
      setContextMenu(null)
      setLegendOpen(false)
      setBadgeTooltip(null)
    }
  }, [isOpen, activeTab])

  useEffect(() => {
    if (!legendOpen) return
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (
        target instanceof Node &&
        (legendPopoverRef.current?.contains(target) || legendButtonRef.current?.contains(target))
      ) {
        return
      }
      setLegendOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setLegendOpen(false)
      }
    }
    const close = (): void => setLegendOpen(false)
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [legendOpen])

  useEffect(() => {
    if (!contextMenu) return
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return
      setContextMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setContextMenu(null)
      }
    }
    const close = (): void => setContextMenu(null)
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  const graphLayout = useMemo(() => buildGitGraphLayout(logItems), [logItems])

  const branchLabel = useMemo(() => {
    if (!status) return '版本管理'
    if (!status.available) return '版本管理'
    if (!status.isRepository) return '未启用'
    return branchName(status) ?? 'HEAD'
  }, [status])

  const footerTitle = useMemo(() => {
    const lines = ['版本管理']
    if (!status) return lines.join('\n')
    if (!status.available) return [...lines, status.error ?? '未检测到 Git'].join('\n')
    if (!status.isRepository) return [...lines, '当前工作区还不是 Git 仓库'].join('\n')

    lines.push(`分支：${branchName(status) ?? 'HEAD'}`)
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
      setLogLoaded(false)
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
            const pullResult = await gitPull()
            if (pullResult.success) setLogLoaded(false)
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
      const result = await gitPull()
      if (result.success) setLogLoaded(false)
    } finally {
      setIsSyncing(false)
    }
  }

  const handlePush = async (): Promise<void> => {
    if (!status) return
    if (status.unborn) {
      useWorkbenchStore.getState().setGitNotice({ tone: 'warning', message: '先提交一次，再推送' })
      return
    }
    if (!status.upstream) {
      const confirmed = window.confirm(
        `将当前分支「${branchName(status) ?? 'HEAD'}」推送到远程，并关联为跟踪分支？`
      )
      if (!confirmed) return
      const result = await gitPush(true)
      if (result.success) setLogLoaded(false)
      return
    }
    setIsSyncing(true)
    try {
      const result = await gitPush(false)
      if (result.success) setLogLoaded(false)
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
      const result = await gitMergeUpstream()
      if (result.success) setLogLoaded(false)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleInit = async (): Promise<void> => {
    const confirmed = window.confirm('在当前工作区初始化 Git 仓库？现有文件不会被修改。')
    if (confirmed) await gitInit()
  }

  const buildChangeMenuItems = (change: GitFileChange): ChangeMenuEntry[] => {
    const deleted = isDeletedChange(change)
    const fileName = change.path.split('/').pop() ?? change.path
    const dotIndex = fileName.lastIndexOf('.')
    const ext = dotIndex > 0 ? fileName.slice(dotIndex) : ''
    const isGitignore = change.path === '.gitignore'
    const isRenameOrCopy = change.staged === 'renamed' || change.staged === 'copied'
    const isStagedAdded = change.staged === 'added' && !deleted

    const items: ChangeMenuEntry[] = []
    if (!deleted) {
      items.push(
        {
          key: 'open',
          label: '打开文件',
          icon: 'article',
          action: () => {
            void openFile(change.path)
          }
        },
        {
          key: 'reveal',
          label: '在资源管理器中显示',
          icon: 'folder',
          action: () => {
            void revealFile(change.path)
          }
        }
      )
    }

    if (change.conflicted) {
      return items
    }

    if (deleted) {
      if (change.staged === 'added') {
        items.push({
          key: 'unstage',
          label: '移出待提交列表',
          icon: 'undo',
          action: () => {
            void gitDiscardFile({ path: change.path })
          }
        })
      } else {
        items.push({
          key: 'restore-deleted',
          label: '恢复已删除的文件',
          icon: 'undo',
          action: () => {
            void gitDiscardFile({ path: change.path, oldPath: change.oldPath })
          }
        })
      }
      return items
    }

    if (change.untracked) {
      items.push({ type: 'separator' })
      if (!isGitignore) {
        items.push({
          key: 'ignore-file',
          label: '忽略此文件',
          icon: 'visibility_off',
          action: () => {
            void gitIgnorePath(change.path, 'file')
          }
        })
        if (ext) {
          items.push({
            key: 'ignore-ext',
            label: `忽略此类文件 (*${ext})`,
            icon: 'visibility_off',
            action: () => {
              void gitIgnorePath(change.path, 'extension')
            }
          })
        }
        items.push({ type: 'separator' })
      }
      items.push({
        key: 'trash',
        label: '删除文件 (移入回收站)',
        icon: 'delete',
        danger: true,
        action: () => {
          setConfirmAction({ kind: 'trash', change })
        }
      })
      return items
    }

    if (isRenameOrCopy) {
      items.push({ type: 'separator' })
      if (change.staged === 'renamed') {
        items.push({
          key: 'revert-rename',
          label: '撤回重命名/移动',
          icon: 'undo',
          danger: true,
          action: () => {
            setConfirmAction({ kind: 'discard', change })
          }
        })
      } else {
        items.push({
          key: 'unstage-copy',
          label: '移出待提交列表 (保留文件)',
          icon: 'undo',
          action: () => {
            void gitDiscardFile({ path: change.path, oldPath: change.oldPath })
          }
        })
      }
      return items
    }

    if (isStagedAdded) {
      items.push(
        { type: 'separator' },
        {
          key: 'unstage-added',
          label: '移出待提交列表 (保留文件)',
          icon: 'undo',
          action: () => {
            void gitDiscardFile({ path: change.path })
          }
        },
        {
          key: 'trash',
          label: '删除文件 (移入回收站)',
          icon: 'delete',
          danger: true,
          action: () => {
            setConfirmAction({ kind: 'trash', change })
          }
        }
      )
      return items
    }

    items.push(
      { type: 'separator' },
      {
        key: 'discard',
        label: '撤回修改 (还原到上次提交)',
        icon: 'undo',
        danger: true,
        action: () => {
          setConfirmAction({ kind: 'discard', change })
        }
      }
    )
    return items
  }

  const contextMenuItems = contextMenu ? buildChangeMenuItems(contextMenu.change) : []
  const contextMenuPosition = useMemo(() => {
    if (!contextMenu) return null
    const menuWidth = 224
    const estimatedHeight =
      contextMenuItems.reduce((acc, entry) => acc + ('type' in entry ? 9 : 34), 0) + 12
    const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuWidth - 8))
    const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - estimatedHeight - 8))
    return { left, top }
  }, [contextMenu, contextMenuItems])

  const handleConfirmAction = async (): Promise<void> => {
    const action = confirmAction
    if (!action) return
    try {
      if (action.kind === 'trash') {
        await gitTrashFile(action.change.path)
      } else {
        await gitDiscardFile({ path: action.change.path, oldPath: action.change.oldPath })
      }
    } finally {
      setConfirmAction(null)
    }
  }

  const confirmDialogCopy = useMemo(() => {
    if (!confirmAction) return null
    const { kind, change } = confirmAction
    const fileName = change.path.split('/').pop() ?? change.path
    if (kind === 'trash') {
      const hasAssetsTip = fileName.toLowerCase().endsWith('.md')
        ? '（同级关联附件也会一并移入回收站）'
        : ''
      return {
        title: `删除文件「${fileName}」？`,
        message: `将把该文件移至系统回收站${hasAssetsTip}，需要时可在回收站中找回。`,
        confirmText: '移入回收站'
      }
    }
    if (change.staged === 'renamed') {
      return {
        title: `撤回「${fileName}」的重命名/移动？`,
        message: `将把文件恢复到原路径「${change.oldPath ?? ''}」并还原为上次提交时的内容，移动后对内容做的修改也将丢失。`,
        confirmText: '确认恢复'
      }
    }
    return {
      title: `撤回「${fileName}」的修改？`,
      message: '将丢弃当前未提交的修改并还原为上次提交的版本，此操作会覆盖磁盘文件内容且无法通过回收站找回。',
      confirmText: '确认撤回'
    }
  }, [confirmAction])

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
              <AppIcon name="arrow_downward" size={12} />
              {status.behind}
            </span>
          )}
          {status.ahead > 0 && (
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400" title={`领先远程 ${status.ahead} 个提交`}>
              <AppIcon name="arrow_upward" size={12} />
              {status.ahead}
            </span>
          )}
        </>
      )}
    </>
  )

  const hasBranchBadge = Boolean(
    status?.isRepository &&
      (status.conflictCount > 0 || changeCount > 0 || status.behind > 0 || status.ahead > 0)
  )

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? closePopover() : open())}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg text-label font-medium transition-colors ${
          compact ? 'px-2' : 'px-2.5'
        } ${
          isOpen
            ? 'bg-black/5 text-text-primary dark:bg-white/10'
            : 'text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5'
        }`}
        title={footerTitle}
      >
        <AppIcon name="git_branch" size={15} className="shrink-0" />
        {/* 宽栏展示分支名，窄栏仅保留图标与状态计数以保证工作区名称可读 */}
        {!compact && <span className="max-w-[84px] truncate">{branchLabel}</span>}
        {hasBranchBadge && <span className="flex shrink-0 items-center gap-1">{branchBadge}</span>}
        {hasLargeUntracked && (
          <span className="shrink-0 text-amber-500" title="有较大的未跟踪文件">
            <AppIcon name="warning" size={12} />
          </span>
        )}
      </button>

      {isOpen && (
        <WorkbenchFooterPopover
          anchorRef={triggerRef}
          ariaLabel="版本管理"
          contentHeight={480}
          disableDismiss={Boolean(confirmAction || contextMenu || legendOpen)}
          onRequestClose={() => {
            if (!useWorkbenchStore.getState().isGitBusy) closePopover()
          }}
        >
          <WorkbenchFooterPopoverHeader
            title="版本管理"
            subtitle={status?.isRepository ? branchLabel : undefined}
            onClose={closePopover}
            actions={
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    void refreshGitStatus({ showLoading: true })
                    if (activeTab === 'history' && status?.isRepository) {
                      void fetchLog()
                    } else {
                      setLogLoaded(false)
                    }
                  }}
                  disabled={isGitLoading || isLogLoading}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40"
                  title="刷新"
                >
                  <AppIcon name="refresh" size={15} className={isGitLoading || isLogLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            }
          />

          {!status ? (
            <div className="px-3 py-6 text-center text-label text-text-secondary">
              {isGitLoading ? '读取中…' : '暂无状态'}
            </div>
          ) : !status.available ? (
            <div className="px-3 py-5 text-label leading-relaxed text-text-secondary">
              {status.error ?? '未检测到 Git'}
            </div>
          ) : !status.isRepository ? (
            <div className="flex flex-col gap-3 px-3 py-4">
              <p className="text-label text-text-secondary">当前工作区还不是 Git 仓库</p>
              <button
                type="button"
                onClick={() => void handleInit()}
                disabled={isGitBusy}
                className="h-8 rounded-lg bg-primary px-3 text-label font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                初始化仓库
              </button>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 border-b border-black/5 px-3 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setActiveTab('changes')}
                  className={`relative flex items-center gap-1.5 px-3 py-2 text-body transition-colors ${
                    activeTab === 'changes'
                      ? 'font-semibold text-primary'
                      : 'font-medium text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <span>改动</span>
                  {changeCount > 0 && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 text-tiny font-medium text-amber-600 dark:text-amber-400">
                      {changeCount}
                    </span>
                  )}
                  {activeTab === 'changes' && (
                    <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className={`relative flex items-center gap-1.5 px-3 py-2 text-body transition-colors ${
                    activeTab === 'history'
                      ? 'font-semibold text-primary'
                      : 'font-medium text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <span>历史</span>
                  {activeTab === 'history' && (
                    <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
                {activeTab === 'changes' && (
                  <button
                    ref={legendButtonRef}
                    type="button"
                    onClick={() => {
                      setContextMenu(null)
                      setBadgeTooltip(null)
                      setLegendOpen((prev) => !prev)
                    }}
                    aria-expanded={legendOpen}
                    className={`ml-auto flex items-center gap-1 self-center rounded-full px-2 py-0.5 text-caption transition-colors ${
                      legendOpen
                        ? 'bg-primary/10 text-primary'
                        : 'text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5'
                    }`}
                    title="状态符号说明"
                  >
                    <AppIcon name="help" size={14} />
                    <span>状态说明</span>
                  </button>
                )}
                {activeTab === 'history' && (
                  <div className="ml-auto flex items-center gap-1.5 pr-1 text-caption text-text-secondary/75">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
                    <span>已推送</span>
                    <span className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>未推送</span>
                  </div>
                )}
              </div>

              <div className="relative flex min-h-0 flex-1 flex-col">
                {activeTab === 'changes' ? (
                  <>
                    {status.merging && (
                      <div className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-label text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
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
                          className="mt-2 h-7 w-full rounded-md bg-amber-500/90 text-label font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                        >
                          撤销本次拉取
                        </button>
                      </div>
                    )}

                    {hasLargeUntracked && (
                      <div className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-label leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        <div className="flex items-center gap-1.5 font-medium">
                          <AppIcon name="warning" size={14} />
                          <span>{status.largeUntracked.length} 个未跟踪文件超过 50 MB</span>
                        </div>
                        <p className="mt-1 truncate text-caption" title={status.largeUntracked.map((item) => item.path).join('\n')}>
                          {status.largeUntracked[0].path}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            closePopover()
                            onOpenWorkspaceSettings()
                          }}
                          className="mt-1.5 h-7 rounded-md bg-amber-500/90 px-2.5 text-label font-medium text-white hover:bg-amber-500"
                        >
                          去忽略
                        </button>
                      </div>
                    )}

                    {changeCount > 0 ? (
                      <div
                        onScroll={() => {
                          setContextMenu(null)
                          setBadgeTooltip(null)
                        }}
                        className="h-full min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5"
                      >
                        {changes.map((change) => {
                          const badge = resolveFileGitBadge(change)
                          const deleted = isDeletedChange(change)
                          const isMenuTarget =
                            contextMenu?.change.path === change.path &&
                            contextMenu?.change.oldPath === change.oldPath
                          return (
                            <div
                              key={`${change.oldPath ?? ''}:${change.path}`}
                              onClick={deleted ? undefined : () => void openFile(change.path)}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                if (isGitBusy) return
                                setLegendOpen(false)
                                setBadgeTooltip(null)
                                setContextMenu({ x: event.clientX, y: event.clientY, change })
                              }}
                              className={`flex items-center gap-2 rounded-md px-2 py-1 text-body transition-colors ${
                                deleted
                                  ? `cursor-default opacity-60 ${isMenuTarget ? 'bg-black/5 dark:bg-white/5' : 'hover:bg-black/5 dark:hover:bg-white/5'}`
                                  : `cursor-pointer ${isMenuTarget ? 'bg-black/5 dark:bg-white/5' : 'hover:bg-black/5 dark:hover:bg-white/5'}`
                              }`}
                              title={
                                deleted
                                  ? `${change.path}（已删除，右键可恢复）`
                                  : change.oldPath
                                    ? `${change.oldPath} → ${change.path}`
                                    : change.path
                              }
                            >
                              <span
                                onMouseEnter={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  setBadgeTooltip({ meta: badge, x: rect.left, y: rect.top })
                                }}
                                onMouseLeave={() => setBadgeTooltip(null)}
                                aria-label={badge.tooltip}
                                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded font-mono text-caption font-semibold ${badge.bgClass} ${badge.colorClass}`}
                              >
                                {badge.letter}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-text-primary">
                                {change.path.split('/').pop()}
                              </span>
                              <span className="max-w-[40%] shrink-0 truncate text-caption text-text-secondary/70">
                                {change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''}
                              </span>
                            </div>
                          )
                        })}
                        {status.changesTruncated && (
                          <div className="px-2 py-1 text-caption text-text-secondary">仅显示前 500 项</div>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-full flex-1 items-center justify-center px-3 py-5 text-label text-text-secondary">
                        没有未提交的改动
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-full min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
                    {isLogLoading && logItems.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-3 py-6 text-label text-text-secondary">
                        读取中…
                      </div>
                    ) : logError ? (
                      <div className="flex h-full items-center justify-center px-3 py-5 text-label text-rose-500">{logError}</div>
                    ) : graphLayout.rows.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-3 py-6 text-label text-text-secondary">
                        还没有提交记录
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {graphLayout.rows.map((row) => {
                          const { item } = row
                          const timeLabel = relativeTime(item.date)
                          const fullDate = new Date(item.date * 1000).toLocaleString()
                          const tooltipLines = [
                            `${item.id} ${item.message}`,
                            `${item.author} · ${fullDate}`
                          ]
                          if (item.refs.length > 0) {
                            tooltipLines.push(`分支/标签：${item.refs.join(', ')}`)
                          }
                          tooltipLines.push(
                            item.pushed ? '已在远程仓库' : '仅本地，尚未推送到远程'
                          )
                          const isExpanded = expandedCommitId === item.id
                          const detail = commitDetails[item.id]
                          return (
                            <div key={item.id} className="rounded-md">
                              <div
                                role="button"
                                tabIndex={0}
                                aria-expanded={isExpanded}
                                onClick={() => toggleCommitDetail(item.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    toggleCommitDetail(item.id)
                                  }
                                }}
                                className={`flex h-10 cursor-pointer items-center gap-1.5 rounded-md px-1 hover:bg-black/5 dark:hover:bg-white/5 ${
                                  isExpanded ? 'bg-black/5 dark:bg-white/5' : ''
                                }`}
                                title={tooltipLines.join('\n')}
                              >
                                <GitHistoryGraph row={row} laneCount={graphLayout.laneCount} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="min-w-0 flex-1 truncate text-body leading-5 text-text-primary">
                                      {item.message}
                                    </span>
                                    {item.refs.slice(0, 2).map((ref) => (
                                      <span
                                        key={ref}
                                        className="max-w-[96px] shrink-0 truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-tiny font-semibold leading-none text-primary"
                                      >
                                        {ref}
                                      </span>
                                    ))}
                                    <AppIcon
                                      name={isExpanded ? 'expand_less' : 'expand_more'}
                                      size={14}
                                      className="shrink-0 text-text-secondary/60"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1.5 text-caption leading-4 text-text-secondary/75">
                                    <span className="shrink-0 font-mono">{item.shortId}</span>
                                    <span className="truncate">{item.author}</span>
                                    <span className="ml-auto shrink-0">{timeLabel}</span>
                                  </div>
                                </div>
                              </div>
                              {isExpanded && (
                                <div className="ml-[13px] border-l border-black/10 pl-2.5 pr-1 pb-1.5 dark:border-white/10">
                                  {detail === 'loading' || detail === undefined ? (
                                    <div className="px-2 py-2 text-caption text-text-secondary">读取文件列表…</div>
                                  ) : detail === 'error' ? (
                                    <div className="px-2 py-2 text-caption text-rose-500">读取提交详情失败</div>
                                  ) : (
                                    <>
                                      <div className="px-2 pt-1.5 text-caption text-text-secondary/75">
                                        {detail.author} · {fullTimeLabel(detail.date)}
                                      </div>
                                      {detail.body && (
                                        <div className="whitespace-pre-wrap px-2 pt-1.5 text-caption leading-relaxed text-text-secondary">
                                          {detail.body}
                                        </div>
                                      )}
                                      <div className="px-2 pt-1 text-caption text-text-secondary/75">
                                        {detail.files.length} 个文件
                                        {(detail.insertions > 0 || detail.deletions > 0) && (
                                          <span className="ml-1.5 font-mono">
                                            <span className="text-emerald-600 dark:text-emerald-400">+{detail.insertions}</span>
                                            {' / '}
                                            <span className="text-rose-500">-{detail.deletions}</span>
                                          </span>
                                        )}
                                      </div>
                                      <div className="pt-0.5">
                                        {detail.files.map((file) => {
                                          const badge = GIT_BADGE_STYLES[commitFileBadgeCode(file.status)]
                                          const wsPath = toWorkspaceRelativePath(file.path)
                                          const openable = file.status !== 'deleted' && wsPath !== null
                                          return (
                                            <div
                                              key={`${file.oldPath ?? ''}:${file.path}`}
                                              onClick={openable ? () => void openFile(wsPath) : undefined}
                                              className={`flex items-center gap-2 rounded-md px-2 py-1 text-caption ${
                                                openable
                                                  ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5'
                                                  : 'cursor-default opacity-70'
                                              }`}
                                              title={
                                                file.status === 'deleted'
                                                  ? `${file.path}（已删除）`
                                                  : wsPath === null
                                                    ? `${file.path}（不在当前工作区内）`
                                                    : file.path
                                              }
                                            >
                                              <span
                                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-tiny font-semibold ${badge.bgClass} ${badge.colorClass}`}
                                              >
                                                {badge.letter}
                                              </span>
                                              <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                                                {file.oldPath ? `${file.oldPath.split('/').pop()} → ${file.path.split('/').pop()}` : file.path.split('/').pop()}
                                              </span>
                                              {(file.insertions !== null || file.deletions !== null) && (
                                                <span className="shrink-0 font-mono text-tiny">
                                                  {file.insertions !== null && file.insertions > 0 && (
                                                    <span className="text-emerald-600 dark:text-emerald-400">+{file.insertions}</span>
                                                  )}
                                                  {file.deletions !== null && file.deletions > 0 && (
                                                    <span className="text-rose-500"> -{file.deletions}</span>
                                                  )}
                                                </span>
                                              )}
                                            </div>
                                          )
                                        })}
                                        {detail.filesTruncated && (
                                          <div className="px-2 py-1 text-caption text-text-secondary">仅显示前 500 个文件</div>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {gitNotice && (gitNotice.tone === 'success' || gitNotice.tone === 'info') && (
                  <div className="pointer-events-none absolute inset-x-3 bottom-2.5 flex justify-center">
                    <button
                      type="button"
                      onClick={clearGitNotice}
                      title="点击关闭"
                      className={`pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-label font-medium shadow-md backdrop-blur-md transition-opacity hover:opacity-90 ${
                        gitNotice.tone === 'success'
                          ? 'border-emerald-200/80 bg-white/95 text-emerald-700 dark:border-emerald-500/30 dark:bg-gray-800/95 dark:text-emerald-300'
                          : 'border-black/10 bg-white/95 text-text-primary dark:border-white/10 dark:bg-gray-800/95'
                      }`}
                    >
                      <AppIcon
                        name={gitNotice.tone === 'success' ? 'check_circle' : 'info'}
                        size={14}
                        className={gitNotice.tone === 'success' ? 'shrink-0 text-emerald-500' : 'shrink-0 text-primary'}
                      />
                      <span className="truncate">{gitNotice.message}</span>
                    </button>
                  </div>
                )}
              </div>

              {activeTab === 'changes' && (
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
                      if (event.key === 'Escape') closePopover()
                    }}
                    className="mb-2 h-8 w-full rounded-lg border border-black/15 bg-black/5 px-2.5 text-label text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:bg-white focus:outline-none dark:border-white/15 dark:bg-white/5 dark:focus:bg-gray-900"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCommit()}
                    disabled={!canCommit || isGitBusy}
                    className="mb-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-label font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <AppIcon name="git_commit" size={15} />
                    <span>提交 {changeCount > 0 ? changeCount : ''} 项改动</span>
                  </button>

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void (diverged ? handleMerge() : handlePull())}
                      disabled={isGitBusy || isSyncing || !status.upstream}
                      className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-black/10 text-label text-text-primary hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
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
                      <AppIcon name={diverged ? 'git_merge' : 'cloud_download'} size={15} />
                      <span>{diverged ? '合并' : '拉取'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePush()}
                      disabled={isGitBusy || isSyncing || status.detached || status.unborn || (!status.hasRemote && !status.upstream)}
                      className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-black/10 text-label text-text-primary hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
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
                      <AppIcon name="cloud_upload" size={15} />
                      <span>推送</span>
                    </button>
                  </div>
                  {!status.hasRemote && !status.upstream && (
                    <button
                      type="button"
                      onClick={() => {
                        closePopover()
                        onOpenWorkspaceSettings()
                      }}
                      className="mt-1.5 h-8 w-full rounded-md text-label text-primary hover:bg-primary/5"
                    >
                      设置远程仓库
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {gitNotice && (gitNotice.tone === 'error' || gitNotice.tone === 'warning') && (
            <div
              className={`mx-2.5 mb-2.5 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-label leading-relaxed ${
                gitNotice.tone === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
              }`}
            >
              <AppIcon
                name={gitNotice.tone === 'error' ? 'error' : 'warning'}
                size={15}
                className="mt-0.5 shrink-0"
              />
              <span className="flex-1 break-words">{gitNotice.message}</span>
              <button
                type="button"
                onClick={clearGitNotice}
                aria-label="关闭提示"
                className="mt-0.5 shrink-0 opacity-60 hover:opacity-100"
              >
                <AppIcon name="close" size={14} />
              </button>
            </div>
          )}
        </WorkbenchFooterPopover>
      )}

      {contextMenu && contextMenuPosition && contextMenuItems.length > 0 && createPortal(
        <div
          ref={contextMenuRef}
          key={`${contextMenu.x}-${contextMenu.y}`}
          data-footer-popover-portal="true"
          role="menu"
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          className={`fixed z-popover min-w-[208px] liquid-glass-menu rounded-xl py-1 text-body context-menu-animate ${
            contextMenuPosition.top < contextMenu.y - 8 ? 'context-menu-animate-up' : ''
          }`}
        >
          {contextMenuItems.map((entry, idx) => {
            if ('type' in entry) {
              return <div key={`sep-${idx}`} className="my-1 border-t border-black/5 dark:border-white/5" role="separator" />
            }
            return (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                disabled={isGitBusy}
                onClick={() => {
                  setContextMenu(null)
                  entry.action()
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 ${
                  entry.danger
                    ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20'
                    : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <AppIcon
                  name={entry.icon}
                  size={16}
                  className={entry.danger ? 'shrink-0 text-rose-500' : 'shrink-0 text-text-secondary'}
                />
                <span className="truncate">{entry.label}</span>
              </button>
            )
          })}
        </div>,
        document.body
      )}

      <ConfirmModal
        isOpen={Boolean(confirmAction && confirmDialogCopy)}
        title={confirmDialogCopy?.title ?? ''}
        message={confirmDialogCopy?.message ?? ''}
        confirmText={confirmDialogCopy?.confirmText ?? '确认'}
        cancelText="取消"
        type="danger"
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />

      {badgeTooltip && !contextMenu && createPortal(
        <div
          role="tooltip"
          style={{
            left: Math.max(8, Math.min(badgeTooltip.x, window.innerWidth - 260)),
            top: Math.max(8, badgeTooltip.y - 34)
          }}
          className="pointer-events-none fixed z-popover flex items-center gap-1.5 liquid-glass-menu rounded-lg px-2.5 py-1 text-caption text-text-primary"
        >
          <span className={`font-mono font-semibold ${badgeTooltip.meta.colorClass}`}>
            {badgeTooltip.meta.letter}
          </span>
          <span>{badgeTooltip.meta.label}</span>
          <span className="font-mono text-text-secondary">({badgeTooltip.meta.gitWord})</span>
          <span className="text-text-secondary">· {badgeTooltip.meta.shortDesc}</span>
        </div>,
        document.body
      )}

      {legendOpen && legendButtonRef.current && (() => {
        const rect = legendButtonRef.current.getBoundingClientRect()
        const width = 272
        const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
        const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 310))
        return createPortal(
          <div
            ref={legendPopoverRef}
            data-footer-popover-portal="true"
            role="dialog"
            aria-label="状态符号说明"
            style={{ left, top, width }}
            onMouseDown={(event) => event.stopPropagation()}
            className="fixed z-popover liquid-glass-menu rounded-xl p-3 context-menu-animate context-menu-origin-top-right"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-label font-semibold text-text-primary">状态说明</span>
              <span className="text-caption text-text-secondary">悬停徽标可查看</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {GIT_BADGE_LEGEND_ORDER.map((code) => {
                const meta = GIT_BADGE_STYLES[code]
                return (
                  <div
                    key={code}
                    className="flex items-center gap-2 rounded-lg bg-black/[0.03] px-2 py-1 dark:bg-white/[0.04]"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-caption font-semibold ${meta.bgClass} ${meta.colorClass}`}
                    >
                      {meta.letter}
                    </span>
                    <span className="text-label font-medium text-text-primary">{meta.label}</span>
                    <span className="text-caption text-text-secondary">{meta.shortDesc}</span>
                    <span className="ml-auto font-mono text-tiny text-text-secondary/75">{meta.gitWord}</span>
                  </div>
                )
              })}
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}

