import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { GitRemoteInfo, GitignoreCategory } from '../../../../shared/types/workbench'
import type {
  LegacyMigrationPendingSummary,
  LegacyMigrationProgress,
  LegacyMigrationResult,
  MigrationBlockedReason
} from '../../../../shared/types/annotations'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchFooterPopover, { WorkbenchFooterPopoverHeader } from './WorkbenchFooterPopover'

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** 阻塞原因只展示用户能据此行动的中文说明；未映射的值保留原样便于诊断。 */
const BLOCKED_REASON_LABELS: Record<MigrationBlockedReason, string> = {
  oversize: '会话过大',
  'empty-snapshot': '快照为空',
  'unlocatable-source': '标注无法定位',
  'annotation-overflow': '标注过多',
  'mindmap-conflict': '导图冲突',
  'workbench-unresolved': '原工作区文档不可用',
  'verify-failed': '目标文件校验失败'
}
const blockedReasonLabel = (reason: MigrationBlockedReason): string =>
  BLOCKED_REASON_LABELS[reason] ?? reason

/**
 * 工作区设置：忽略规则与远程仓库。
 * 忽略规则直接读写工作区 .gitignore，保持与终端/其他编辑器同一份事实来源。
 */
export default function WorkbenchWorkspaceSettings({
  onClose,
  anchorRef
}: {
  onClose: () => void
  anchorRef: { current: HTMLElement | null }
}): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const workspaceName = useWorkbenchStore((s) => s.workspaceName)
  const gitStatus = useWorkbenchStore((s) => s.gitStatus)
  const refreshGitStatus = useWorkbenchStore((s) => s.refreshGitStatus)
  const gitSetRemote = useWorkbenchStore((s) => s.gitSetRemote)

  const [ignoreText, setIgnoreText] = useState('')
  const [categories, setCategories] = useState<GitignoreCategory[]>([])
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([])
  const [remoteUrl, setRemoteUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isSavingRemote, setIsSavingRemote] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationDir, setConversationDir] = useState('conversations')
  const [conversationDirWarning, setConversationDirWarning] = useState<string | null>(null)
  const [conversationDirDraft, setConversationDirDraft] = useState('conversations')
  const [conversationSaving, setConversationSaving] = useState(false)
  const [defaultWorkspace, setDefaultWorkspace] = useState<{
    path: string
    writable: boolean
    legacyPath?: string
  } | null>(null)
  const [defaultWorkspaceError, setDefaultWorkspaceError] = useState<string | null>(null)
  const [migrationPending, setMigrationPending] = useState<LegacyMigrationPendingSummary | null>(null)
  const [migrationLoadError, setMigrationLoadError] = useState<string | null>(null)
  const [migrationProgress, setMigrationProgress] = useState<LegacyMigrationProgress | null>(null)
  const [migrationResult, setMigrationResult] = useState<LegacyMigrationResult | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const migrationBusyRef = useRef(false)
  // 打开时磁盘上的文本快照，用于保存前检测外部修改
  const [diskText, setDiskText] = useState('')

  const load = useCallback(async () => {
    if (!workspacePath) return
    setIsLoading(true)
    setError(null)
    try {
      const [ignoreRes, categoryRes, remoteRes] = await Promise.all([
        window.api.workbench.readGitignore(workspacePath),
        window.api.workbench.gitignoreCategories(),
        window.api.workbench.gitRemotes(workspacePath)
      ])
      if (ignoreRes.success && ignoreRes.data) {
        setIgnoreText(ignoreRes.data.content)
        setDiskText(ignoreRes.data.content)
      }
      if (categoryRes.success && categoryRes.data) {
        setCategories(categoryRes.data)
      }
      if (remoteRes.success && remoteRes.data) {
        setRemotes(remoteRes.data)
        // listRemotes 已把 origin 排在最前；没有 origin 时取第一个
        const origin = remoteRes.data[0]
        // 含凭据的地址只展示脱敏值；不回填，避免用户直接保存把 *** 写回仓库
        setRemoteUrl(origin && !origin.redacted ? origin.url : '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!workspacePath) return
    let alive = true
    void window.api.workbench.getSettings(workspacePath).then(result => {
      if (!alive || !result.success || !result.data) return
      setConversationDir(result.data.conversationDir)
      setConversationDirDraft(result.data.conversationDir)
      setConversationDirWarning(result.data.warning ?? null)
    }).catch(error => {
      if (alive) setError(error instanceof Error ? error.message : String(error))
    })
    void window.api.workbench.getDefaultWorkspace().then(result => {
      if (!alive) return
      if (result.success && result.data) {
        setDefaultWorkspace(result.data)
        setDefaultWorkspaceError(null)
      } else {
        setDefaultWorkspace(null)
        setDefaultWorkspaceError(result.error || '默认会话库不可用')
      }
    }).catch(error => {
      if (!alive) return
      setDefaultWorkspace(null)
      setDefaultWorkspaceError(error instanceof Error ? error.message : '默认会话库不可用')
    })
    void window.api.notesMigrationPending().then(result => {
      if (!alive) return
      if (result.success && result.data) {
        setMigrationPending(result.data)
        setMigrationLoadError(null)
      } else {
        setMigrationLoadError(result.error || '旧笔记读取失败')
      }
    }).catch(error => {
      if (!alive) return
      setMigrationLoadError(error instanceof Error ? error.message : '旧笔记读取失败')
    })
    const off = window.api.onNotesMigrationProgress(progress => setMigrationProgress(progress))
    return () => {
      alive = false
      off()
    }
  }, [workspacePath])

  const saveConversationDir = async (): Promise<void> => {
    if (!workspacePath || conversationSaving) return
    setConversationSaving(true)
    setError(null)
    try {
      const result = await window.api.workbench.setSettings(workspacePath, {
        conversationDir: conversationDirDraft
      })
      if (!result.success || !result.data) {
        setError(result.error || '保存会话目录失败')
        return
      }
      setConversationDir(result.data.conversationDir)
      setConversationDirDraft(result.data.conversationDir)
      setConversationDirWarning(null)
    } finally {
      setConversationSaving(false)
    }
  }

  const migrateLegacy = async (jobId?: string): Promise<void> => {
    // 重试按钮会在同一次交互里先清阻塞再调用迁移；用 ref 防重入，
    // 避免 state 尚未提交时被第二次点击当成“未在迁移”。
    if (migrationBusyRef.current) return
    migrationBusyRef.current = true
    setMigrationBusy(true)
    setError(null)
    // 进度事件不带 status；先把本地 job 置为 running，让“暂停”在迁移期间可见。
    setMigrationPending(prev => {
      if (!prev?.job) return prev
      return { ...prev, job: { ...prev.job, status: 'running' } }
    })
    try {
      const result = await window.api.notesMigrateLegacy(jobId)
      if (!result.success || !result.data) {
        setError(result.error || '迁移失败')
        return
      }
      setMigrationResult(result.data)
      const pending = await window.api.notesMigrationPending()
      if (pending.success && pending.data) {
        setMigrationPending(pending.data)
        setMigrationLoadError(null)
      }
    } finally {
      migrationBusyRef.current = false
      setMigrationBusy(false)
      const pending = await window.api.notesMigrationPending().catch(() => null)
      if (pending?.success && pending.data) {
        setMigrationPending(pending.data)
        setMigrationLoadError(null)
      }
    }
  }

  const pauseMigration = async (): Promise<void> => {
    const jobId = migrationPending?.job?.jobId
    if (!jobId) return
    const result = await window.api.notesCancelMigration(jobId)
    if (!result.success) setError(result.error || '暂停迁移失败')
  }

  const resumeMigration = async (): Promise<void> => {
    const jobId = migrationPending?.job?.jobId
    if (!jobId) return
    const resumed = await window.api.notesResumeMigration(jobId)
    if (!resumed.success) {
      setError(resumed.error || '继续迁移失败')
      return
    }
    await migrateLegacy(jobId)
  }

  const abandonMigration = async (): Promise<void> => {
    const jobId = migrationPending?.job?.jobId
    if (!jobId) return
    if (
      !window.confirm(
        '放弃本次迁移？已完成记录会留在实际目标（普通会话在默认会话库，工作台记录在原工作区）。'
      )
    ) {
      return
    }
    const result = await window.api.notesAbandonMigration(jobId)
    if (!result.success) {
      setError(result.error || '放弃迁移失败')
      return
    }
    setMigrationResult(null)
    const pending = await window.api.notesMigrationPending()
    if (pending.success && pending.data) {
      setMigrationPending(pending.data)
      setMigrationLoadError(null)
    }
  }

  const retryBlocked = async (id: string): Promise<void> => {
    if (!window.confirm('清除这条记录的阻塞标记并重新迁移？')) return
    const result = await window.api.notesRetryMigrationRecord(id)
    if (!result.success) {
      setError(result.error || '重试迁移失败')
      return
    }
    // “重试”应当直接执行一次迁移，而不是只清标记让用户再点一次“开始迁移”。
    await migrateLegacy()
  }

  /** 忽略规则行；注释和空行不参与分类勾选状态 */
  const activePatterns = ignoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const hasPattern = (pattern: string): boolean => activePatterns.includes(pattern)
  // 勾选状态以当前列表为准：手动删掉组内任意规则后，复选框自动回到未勾选
  const isCategoryChecked = (category: GitignoreCategory): boolean =>
    category.patterns.every((pattern) => hasPattern(pattern))

  // 文本编辑器允许调整顺序、注释和空行，因此按原文比较
  const isIgnoreDirty = ignoreText !== diskText

  /** 关闭前确认未保存的忽略规则，避免点遮罩或关闭按钮时静默丢弃勾选 */
  const requestClose = (): void => {
    if (isIgnoreDirty && !window.confirm('忽略规则尚未保存，确定放弃这些改动？')) return
    onClose()
  }

  /** 只添加缺失规则；用于大文件按扩展名快速忽略 */
  const addPatterns = (patterns: string[]): void => {
    setSaved(false)
    setIgnoreText((prev) => {
      const existing = new Set(
        prev
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
      )
      const added = patterns.filter((pattern) => !existing.has(pattern))
      if (!added.length) return prev
      const trimmed = prev.replace(/\s+$/, '')
      return `${trimmed}${trimmed ? '\n' : ''}${added.join('\n')}\n`
    })
  }

  /** 勾选/取消一个分类：只增删该组规则，不触碰其他组和用户手写条目 */
  const toggleCategory = (category: GitignoreCategory): void => {
    const selected = isCategoryChecked(category)
    setSaved(false)
    setIgnoreText((prev) => {
      const lines = prev.split(/\r?\n/)
      if (selected) {
        const remove = new Set(category.patterns)
        return lines.filter((line) => !remove.has(line.trim())).join('\n')
      }
      const existing = new Set(
        lines.map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
      )
      const added = category.patterns
        .filter((pattern) => !existing.has(pattern))
      if (!added.length) return prev
      const trimmed = prev.replace(/\s+$/, '')
      return `${trimmed}${trimmed ? '\n' : ''}${added.join('\n')}\n`
    })
  }

  const saveIgnore = async (): Promise<void> => {
    if (!workspacePath || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const snapshot = await window.api.workbench.readGitignore(workspacePath)
      const currentDisk = snapshot.success && snapshot.data ? snapshot.data.content : ''
      const changedOnDisk = currentDisk !== diskText
      if (changedOnDisk) {
        const overwrite = window.confirm(
          '.gitignore 已在其他程序中修改。继续保存会用当前编辑内容覆盖这些改动，是否继续？'
        )
        if (!overwrite) return
      }
      const res = await window.api.workbench.writeGitignore(workspacePath, ignoreText)
      if (!res.success) {
        setError(res.error || '保存忽略规则失败')
        return
      }
      await refreshGitStatus()
      setDiskText(ignoreText)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  const saveRemote = async (): Promise<void> => {
    if (!remoteUrl.trim() || isSavingRemote) return
    const remoteName = gitStatus?.remoteName ?? remotes[0]?.name ?? 'origin'
    setIsSavingRemote(true)
    setError(null)
    try {
      const result = await gitSetRemote(remoteUrl.trim(), remoteName)
      if (!result.success) {
        setError(result.error || '保存远程地址失败')
        return
      }
      setSaved(true)
    } finally {
      setIsSavingRemote(false)
    }
  }

  const save = async (): Promise<void> => {
    const remoteChanged = Boolean(remoteUrl.trim()) && remoteUrl.trim() !== remotes[0]?.url
    if (!isIgnoreDirty && !remoteChanged) {
      setSaved(true)
      return
    }
    if (isIgnoreDirty) {
      await saveIgnore()
    }
    if (remoteChanged) {
      await saveRemote()
    }
  }

  const largeUntracked = gitStatus?.largeUntracked ?? []

  if (!workspacePath) return <></>

  return (
    <WorkbenchFooterPopover
      anchorRef={anchorRef}
      ariaLabel="工作区设置"
      onRequestClose={requestClose}
    >
      <WorkbenchFooterPopoverHeader
        title="工作区设置"
        subtitle={workspaceName}
        onClose={requestClose}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}

          {largeUntracked.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-medium">
                <AppIcon name="warning" size={14} />
                <span>{largeUntracked.length} 个未跟踪文件超过 50 MB</span>
              </div>
              <div className="mt-1 truncate" title={largeUntracked.map((item) => item.path).join('\n')}>
                {largeUntracked[0].path} · {formatSize(largeUntracked[0].size)}
                {largeUntracked.length > 1 ? ` 等 ${largeUntracked.length} 项` : ''}
              </div>
            </div>
          )}

          <section className="pb-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-medium text-text-primary">会话归档</h3>
              <span className="text-[11px] text-text-secondary">{conversationDir}</span>
            </div>
            <input
              value={conversationDirDraft}
              onChange={event => setConversationDirDraft(event.target.value)}
              placeholder="conversations"
              aria-label="会话归档目录"
              className="h-8 w-full rounded-lg border border-black/10 bg-black/[0.02] px-2.5 font-mono text-xs text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-white/10 dark:bg-white/[0.02] dark:focus:bg-gray-900"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-[11px] text-text-secondary">
                {conversationDirWarning ??
                  (conversationDirDraft !== conversationDir ? '尚未保存' : '工作区内相对目录')}
              </span>
              <button
                type="button"
                onClick={() => void saveConversationDir()}
                disabled={conversationSaving || conversationDirDraft === conversationDir}
                className="h-6 rounded-md px-2 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </section>

          <section className="border-t border-black/5 pb-3 pt-3 dark:border-white/5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-medium text-text-primary">默认会话库</h3>
              <span className="text-[11px] text-text-secondary">
                {defaultWorkspaceError
                  ? '不可用'
                  : defaultWorkspace
                  ? defaultWorkspace.writable
                    ? '可写'
                    : '不可写'
                  : '读取中…'}
              </span>
            </div>
            <p
              className="truncate text-[11px] text-text-secondary"
              title={defaultWorkspace?.path}
            >
              {defaultWorkspace?.path ?? defaultWorkspaceError ?? '—'}
            </p>
            {defaultWorkspace?.legacyPath && (
              <p className="mt-1 truncate text-[11px] text-amber-600 dark:text-amber-400" title={defaultWorkspace.legacyPath}>
                旧缓存位置：{defaultWorkspace.legacyPath}
              </p>
            )}
          </section>

          <section className="border-t border-black/5 pb-3 pt-3 dark:border-white/5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-medium text-text-primary">旧笔记迁移</h3>
              <span className="text-[11px] text-text-secondary">
                {migrationLoadError
                  ? '读取失败'
                  : migrationPending
                  ? migrationPending.pendingConversations
                    ? `${migrationPending.pendingConversations} 条待迁移`
                    : migrationPending.blockedConversations
                      ? `${migrationPending.blockedConversations} 条阻塞`
                      : migrationPending.job
                        ? '已全部处理'
                        : '暂无旧数据'
                  : '读取中…'}
              </span>
            </div>
            {migrationLoadError && (
              <p className="text-[11px] leading-4 text-rose-600 dark:text-rose-400">
                {migrationLoadError}
              </p>
            )}
            {migrationPending && (
              <p className="text-[11px] leading-4 text-text-secondary">
                {migrationPending.pendingAnnotations} 条标注 · {migrationPending.pendingMindmaps} 张导图。
                普通会话写入默认会话库，工作台记录留在原工作区；旧数据不会删除。
              </p>
            )}
            {migrationProgress && (
              <div className="mt-2 rounded-lg bg-black/[0.03] px-2.5 py-2 text-[11px] text-text-secondary dark:bg-white/[0.04]">
                <div className="flex justify-between">
                  <span className="truncate">{migrationProgress.currentTitle || '迁移中'}</span>
                  <span>
                    {migrationProgress.completed}/{migrationProgress.total}
                  </span>
                </div>
                {migrationProgress.blocked + migrationProgress.failed > 0 && (
                  <p className="mt-0.5 text-amber-600 dark:text-amber-400">
                    阻塞 {migrationProgress.blocked} · 失败 {migrationProgress.failed}
                  </p>
                )}
              </div>
            )}
            {migrationResult && (
              <div className="mt-2 space-y-1 text-[11px] text-text-secondary">
                <p>
                  完成 {migrationResult.migrated} · 阻塞 {migrationResult.blocked} · 失败{' '}
                  {migrationResult.failed}
                </p>
                {migrationResult.report
                  .filter(item => item.status !== 'migrated')
                  .slice(0, 5)
                  .map(item => (
                    <p key={item.id} className="truncate" title={item.message || item.reason}>
                      {item.title}：{item.reason ? blockedReasonLabel(item.reason) : item.message || item.status}
                    </p>
                  ))}
              </div>
            )}
            {!!migrationPending?.blockedRecords.length && (
              <div className="mt-2 space-y-1">
                {migrationPending.blockedRecords.slice(0, 5).map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] text-text-secondary" title={`${item.title}：${blockedReasonLabel(item.reason)}`}>
                      {item.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => void retryBlocked(item.id)}
                      className="shrink-0 text-[11px] text-primary hover:underline"
                    >
                      重试
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {migrationPending?.job?.status === 'running' ? (
                <button
                  type="button"
                  onClick={() => void pauseMigration()}
                  className="text-[11px] text-text-secondary hover:text-text-primary"
                >
                  暂停
                </button>
              ) : (
                <button
                  type="button"
                  disabled={migrationBusy || (!migrationPending?.pendingConversations && !migrationPending?.blockedConversations)}
                  onClick={() =>
                    void (migrationPending?.job?.status === 'paused'
                      ? resumeMigration()
                      : migrateLegacy(migrationPending?.job?.jobId))
                  }
                  className="text-[11px] text-primary hover:underline disabled:opacity-40"
                >
                  {migrationPending?.job?.status === 'paused' ? '继续迁移' : '开始迁移'}
                </button>
              )}
              {migrationPending?.job && migrationPending.job.status !== 'abandoned' && (
                <button
                  type="button"
                  onClick={() => void abandonMigration()}
                  className="text-[11px] text-text-secondary hover:text-rose-500"
                >
                  放弃
                </button>
              )}
            </div>
          </section>

          <section className="pb-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-medium text-text-primary">远程仓库</h3>
              <span className="max-w-[55%] truncate text-[11px] text-text-secondary">
                {gitStatus?.remoteName ?? remotes[0]?.name}
              </span>
            </div>
            {gitStatus?.isRepository || remotes.length > 0 ? (
              <input
                value={remoteUrl}
                onChange={(event) => {
                  setRemoteUrl(event.target.value)
                  setSaved(false)
                }}
                placeholder={
                  remotes.find((item) => item.name === (gitStatus?.remoteName ?? remotes[0]?.name))?.redacted
                    ? '重新输入远程地址（当前地址含凭据）'
                    : 'https://github.com/user/repo.git'
                }
                aria-label="远程仓库地址"
                className="h-8 w-full rounded-lg border border-black/10 bg-black/[0.02] px-2.5 text-xs text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-white/10 dark:bg-white/[0.02] dark:focus:bg-gray-900"
              />
            ) : (
              <div className="flex h-8 items-center text-xs text-text-secondary">
                {!gitStatus ? '读取中…' : gitStatus.available ? '尚未启用 Git' : '未检测到 Git'}
              </div>
            )}
            {isSavingRemote && <p className="mt-1 text-[11px] text-text-secondary">正在保存远程地址…</p>}
          </section>

          <section className="border-t border-black/5 pt-3 dark:border-white/5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-medium text-text-primary">忽略规则</h3>
              <span className="text-[11px] text-text-secondary" title="工作区根目录的 .gitignore">
                {isLoading ? '读取中…' : isIgnoreDirty ? '未保存' : '.gitignore'}
              </span>
            </div>

            {categories.length > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {categories.map((category) => {
                  const checked = isCategoryChecked(category)
                  return (
                    <label
                      key={category.id}
                      title={`${category.description}\n${category.patterns.join('\n')}`}
                      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-1 text-text-primary hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          toggleCategory(category)
                          setSaved(false)
                        }}
                        className="h-3.5 w-3.5 shrink-0 accent-primary"
                      />
                      <span className="truncate text-[11px]">{category.label}</span>
                    </label>
                  )
                })}
              </div>
            )}

            <textarea
              value={ignoreText}
              onChange={(event) => {
                setSaved(false)
                setIgnoreText(event.target.value)
              }}
              readOnly={isLoading}
              spellCheck={false}
              aria-label=".gitignore 内容"
              placeholder="*.log"
              className="min-h-[220px] w-full resize-y rounded-lg border border-black/10 bg-black/[0.02] p-2.5 font-mono text-xs leading-5 text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-white/10 dark:bg-white/[0.02] dark:focus:bg-gray-900"
            />

            {largeUntracked.length > 0 && (
              <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/5">
                <div className="mb-1.5 text-[11px] text-text-secondary">发现的未跟踪大文件，可快速忽略：</div>
                <div className="flex flex-wrap gap-2">
                  {Array.from(
                    new Set(
                      largeUntracked
                        .map((item) => {
                          const name = item.path.split('/').pop() ?? item.path
                          // 没有扩展名时忽略整个文件名，避免生成 `*.` 这类无效规则
                          if (!name.includes('.')) return name
                          return `*.${name.split('.').pop()?.toLowerCase() ?? ''}`
                        })
                        .filter(Boolean)
                    )
                  ).map((ext) => (
                    <button
                      key={ext}
                      type="button"
                      onClick={() => {
                        addPatterns([ext.startsWith('*.') ? ext : `*.${ext}`])
                        setSaved(false)
                      }}
                      className="text-[11px] text-primary hover:underline"
                    >
                      忽略 {ext.startsWith('*.') ? ext : `*.${ext}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-black/5 px-4 py-3 dark:border-white/5">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg px-3 py-1.5 text-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving || isSavingRemote || isLoading || (!isIgnoreDirty && !remoteUrl.trim() && !saved)}
            className="min-w-[72px] rounded-lg bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary/90 disabled:opacity-40"
          >
            {isSaving || isSavingRemote ? '保存中' : saved && !isIgnoreDirty ? '已保存' : '保存'}
          </button>
        </div>
      </div>
    </WorkbenchFooterPopover>
  )
}
