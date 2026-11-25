import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { GitRemoteInfo, GitignoreCategory } from '../../../../shared/types/workbench'
import type {
  LegacyMigrationPendingSummary,
  LegacyMigrationProgress,
  LegacyMigrationResult,
  MigrationBlockedReason
} from '../../../../shared/types/annotations'
import type { FrontmatterBackupSummary } from '../../../../shared/types/workbench'
import { AppIcon } from '../icons/AppIcon'
import { WORKBENCH_INPUT_CLASS } from '../ui/FormControls'
import WorkbenchFooterPopover, { WorkbenchFooterPopoverHeader } from './WorkbenchFooterPopover'

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const SHORT_CATEGORY_LABELS: Record<string, string> = {
  system: '系统临时',
  archive: '压缩包',
  installer: '安装包',
  office: 'PDF与文档',
  video: '视频文件',
  design: '设计源文件',
  node: 'Node 依赖',
  python: 'Python 缓存',
  build: '构建产物',
  editor: '编辑器临时',
  ide: 'IDE 配置',
  'app-state': '应用生成物',
  'obsidian-state': 'Obsidian 状态'
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
  const gitStatus = useWorkbenchStore((s) => s.gitStatus)
  const refreshGitStatus = useWorkbenchStore((s) => s.refreshGitStatus)
  const loadFileTree = useWorkbenchStore((s) => s.loadFileTree)
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
  /** 已放弃的 jobId：迟到的进度事件和刷新结果都不能再把进度/阻塞刷回来。 */
  const abandonedJobRef = useRef<string | null>(null)
  const [backups, setBackups] = useState<FrontmatterBackupSummary | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupNotice, setBackupNotice] = useState<string | null>(null)
  // 打开时磁盘上的文本快照，用于保存前检测外部修改
  const [diskText, setDiskText] = useState('')
  const [activeTab, setActiveTab] = useState<'sync' | 'storage'>('sync')

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
    void window.api.notesFrontmatterBackups().then(result => {
      if (!alive) return
      if (result.success && result.data) setBackups(result.data)
    }).catch(() => undefined)
    const off = window.api.onNotesMigrationProgress(progress => {
      if (progress.jobId === abandonedJobRef.current) return
      setMigrationProgress(progress)
    })
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
    abandonedJobRef.current = null
    setMigrationProgress(null)
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
      setMigrationProgress(null)
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
    abandonedJobRef.current = jobId
    setMigrationResult(null)
    setMigrationProgress(null)
    const pending = await window.api.notesMigrationPending()
    if (pending.success && pending.data) {
      setMigrationPending(pending.data)
      setMigrationLoadError(null)
    }
  }

  /** 清理迁移前备份：只删原文档仍存在的备份，正文已丢失的保留。 */
  const clearBackups = async (): Promise<void> => {
    if (backupBusy) return
    const orphans = backups?.orphans ?? 0
    const message = orphans > 0
      ? `删除正文仍存在的原始备份？正文已不存在的 ${orphans} 份会保留。`
      : '删除迁移前留下的原始备份？正文不受影响。'
    if (!window.confirm(message)) return
    setBackupBusy(true)
    setBackupNotice(null)
    setError(null)
    try {
      const result = await window.api.notesClearFrontmatterBackups()
      if (!result.success || !result.data) {
        setError(result.error || '清理备份失败')
        return
      }
      const { removed, kept, errors } = result.data
      setBackupNotice(
        errors.length
          ? `已删除 ${removed} 份，${errors.length} 份失败`
          : kept > 0
            ? `已删除 ${removed} 份，保留 ${kept} 份`
            : `已删除 ${removed} 份`
      )
      const summary = await window.api.notesFrontmatterBackups()
      if (summary.success && summary.data) setBackups(summary.data)
    } finally {
      setBackupBusy(false)
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
  /** 分类勾选态：全部规则都在、只有部分在、一条都不在。 */
  type CategoryState = 'all' | 'partial' | 'none'
  const categoryState = (category: GitignoreCategory): CategoryState => {
    const hit = category.patterns.filter((pattern) => hasPattern(pattern)).length
    if (hit === 0) return 'none'
    return hit === category.patterns.length ? 'all' : 'partial'
  }

  // 文本编辑器允许调整顺序、注释和空行，因此按原文比较
  const isIgnoreDirty = ignoreText !== diskText
  const remoteChanged = Boolean(remoteUrl.trim()) && remoteUrl.trim() !== (remotes[0]?.url ?? '')
  const conversationDirChanged = conversationDirDraft.trim() !== conversationDir && Boolean(conversationDirDraft.trim())
  const isDirty = isIgnoreDirty || remoteChanged || conversationDirChanged

  /** 关闭前确认未保存的设置，避免点遮罩或关闭按钮时静默丢弃改动 */
  const requestClose = (): void => {
    if (isDirty && !window.confirm('工作区设置尚未保存，确定放弃这些改动？')) return
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
    // 部分选中时点击视为补齐，只有全部命中才取消整组。
    const selected = categoryState(category) === 'all'
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
      await loadFileTree()
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
    if (!isDirty) {
      setSaved(true)
      return
    }
    if (conversationDirChanged) {
      await saveConversationDir()
    }
    if (isIgnoreDirty) {
      await saveIgnore()
    }
    if (remoteChanged) {
      await saveRemote()
    }
    setSaved(true)
  }

  const largeUntracked = gitStatus?.largeUntracked ?? []
  const quickIgnoreExtensions = Array.from(
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
  )
  const ignoreLineCount = ignoreText ? ignoreText.split(/\r?\n/).length : 0
  const migrationPendingCount = migrationPending?.pendingConversations ?? 0
  const migrationBlockedCount = migrationPending?.blockedConversations ?? 0
  /** 有任务进行中/暂停时仍要露出进度与暂停入口，即使当前没有待迁移记录。 */
  const migrationJobActive =
    migrationPending?.job?.status === 'running' || migrationPending?.job?.status === 'paused'
  /** 没有任何可迁移资产、也没有任务在跑时，整块迁移入口都不显示。 */
  const showMigrationSection =
    migrationPendingCount > 0 ||
    migrationBlockedCount > 0 ||
    migrationJobActive ||
    migrationProgress !== null ||
    migrationResult !== null

  if (!workspacePath) return <></>

  return (
    <WorkbenchFooterPopover
      anchorRef={anchorRef}
      ariaLabel="工作区设置"
      onRequestClose={requestClose}
    >
      <WorkbenchFooterPopoverHeader
        title="工作区设置"
        onClose={requestClose}
      />

      {/* 顶部标签栏 */}
      <div className="flex shrink-0 gap-5 border-b border-black/5 bg-white px-4 pt-2.5 text-body dark:border-white/5 dark:bg-gray-800">
        <button
          type="button"
          onClick={() => setActiveTab('sync')}
          className={`pb-2 font-medium transition-colors ${
            activeTab === 'sync'
              ? 'border-b-2 border-primary text-primary'
              : 'border-b-2 border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          代码与忽略
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('storage')}
          className={`flex items-center gap-1.5 pb-2 font-medium transition-colors ${
            activeTab === 'storage'
              ? 'border-b-2 border-primary text-primary'
              : 'border-b-2 border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          <span>存储与维护</span>
          {migrationPendingCount + migrationBlockedCount > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-tiny font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {migrationPendingCount + migrationBlockedCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex h-[470px] max-h-[min(640px,calc(100vh-80px))] min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-body text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}

          {activeTab === 'sync' ? (
            <>
              {largeUntracked.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-body text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <div className="flex items-center justify-between font-medium">
                    <span className="flex items-center gap-1.5">
                      <AppIcon name="warning" size={16} className="text-amber-600 dark:text-amber-400" />
                      发现未跟踪的大文件
                    </span>
                    <span className="font-mono text-caption text-amber-700 dark:text-amber-300">
                      {formatSize(largeUntracked[0].size)}
                    </span>
                  </div>
                  <div
                    className="mt-1 truncate font-mono text-caption text-amber-800 dark:text-amber-300"
                    title={largeUntracked.map((item) => item.path).join('\n')}
                  >
                    {largeUntracked[0].path}
                    {largeUntracked.length > 1 ? ` 等 ${largeUntracked.length} 项` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickIgnoreExtensions.map((ext) => (
                      <button
                        key={ext}
                        type="button"
                        onClick={() => {
                          addPatterns([ext.startsWith('*.') ? ext : `*.${ext}`])
                          setSaved(false)
                        }}
                        className="rounded bg-amber-100 px-2 py-0.5 text-caption font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/60 dark:text-amber-200 dark:hover:bg-amber-800"
                      >
                        + 忽略 {ext.startsWith('*.') ? ext : `*.${ext}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 远程仓库 */}
              <section>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <h3 className="text-body font-semibold text-text-primary">远程仓库</h3>
                  <span className="font-mono text-caption text-text-secondary">origin</span>
                </div>
                <input
                  value={remoteUrl}
                  disabled={!gitStatus?.isRepository && remotes.length === 0}
                  onChange={(event) => {
                    setRemoteUrl(event.target.value)
                    setSaved(false)
                  }}
                  placeholder={
                    !gitStatus?.isRepository && remotes.length === 0
                      ? '工作区尚未启用 Git 仓库'
                      : remotes.find((item) => item.name === (gitStatus?.remoteName ?? remotes[0]?.name))?.redacted
                      ? '重新输入远程地址（当前地址含凭据）'
                      : 'https://github.com/user/repo.git'
                  }
                  aria-label="远程仓库地址"
                  className={`w-full px-2.5 font-mono ${WORKBENCH_INPUT_CLASS}`}
                />
                {isSavingRemote && <p className="mt-1 text-caption text-text-secondary">正在保存远程地址…</p>}
              </section>

              {/* 忽略规则 */}
              <section>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-body font-semibold text-text-primary">忽略规则</h3>
                  <span className="font-mono text-caption text-text-secondary" title="工作区根目录的 .gitignore">
                    {isLoading ? '读取中…' : isIgnoreDirty ? '未保存' : '.gitignore'}
                  </span>
                </div>

                {/* 智能预设胶囊 */}
                {categories.length > 0 && (
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    {categories.map((category) => {
                      const state = categoryState(category)
                      const displayLabel = SHORT_CATEGORY_LABELS[category.id] ?? category.label
                      return (
                        <button
                          key={category.id}
                          type="button"
                          aria-pressed={state === 'all'}
                          title={`${category.description}\n${category.patterns.join('\n')}${
                            state === 'partial' ? '\n\n当前只应用了部分规则，点击补齐' : ''
                          }`}
                          onClick={() => toggleCategory(category)}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-body font-medium transition-all ${
                            state === 'all'
                              ? 'border border-blue-200 bg-blue-50 text-blue-700 shadow-sm dark:border-blue-800/80 dark:bg-blue-950/60 dark:text-blue-300'
                              : state === 'partial'
                                ? 'border border-blue-200/70 bg-blue-50/50 text-blue-600 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300'
                              : 'border border-slate-200/80 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-slate-800'
                          }`}
                        >
                          {state === 'all' ? (
                            <svg className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : state === 'partial' ? (
                            <svg className="h-3 w-3 shrink-0 text-blue-500 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          ) : (
                            <svg className="h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          )}
                          <span className="truncate">{displayLabel}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* 直接可见的 .gitignore 编辑区 */}
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70 shadow-inner dark:border-slate-700/80 dark:bg-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100/80 px-2.5 py-1.5 font-mono text-caption text-text-secondary dark:border-slate-800 dark:bg-slate-900/80">
                    <span>规则源码</span>
                    <span>{ignoreLineCount} 行</span>
                  </div>
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
                    rows={8}
                    className="block w-full resize-y bg-transparent p-2.5 font-mono text-body leading-relaxed text-text-primary focus:outline-none"
                  />
                </div>
              </section>
            </>
          ) : (
            <>
              {/* 会话归档 */}
              <section>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <h3 className="text-body font-semibold text-text-primary">会话归档目录</h3>
                  <span className="font-mono text-caption text-text-secondary">工作区相对路径</span>
                </div>
                <input
                  value={conversationDirDraft}
                  onChange={event => {
                    setConversationDirDraft(event.target.value)
                    setSaved(false)
                  }}
                  placeholder="conversations"
                  aria-label="会话归档目录"
                  className={`w-full px-2.5 font-mono ${WORKBENCH_INPUT_CLASS}`}
                />
                {conversationDirWarning && (
                  <p className="mt-1 text-caption text-amber-600 dark:text-amber-400">
                    {conversationDirWarning}
                  </p>
                )}
              </section>

              {/* 默认会话库 */}
              <section className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-semibold text-text-primary">全局默认会话库</h3>
                  {defaultWorkspaceError ? (
                    <span className="flex items-center gap-1 text-caption font-medium text-rose-600 dark:text-rose-400">
                      <AppIcon name="warning" size={16} />
                      不可用
                    </span>
                  ) : defaultWorkspace && !defaultWorkspace.writable ? (
                    <span className="flex items-center gap-1 text-caption font-medium text-amber-600 dark:text-amber-400">
                      <AppIcon name="warning" size={16} />
                      无写入权限
                    </span>
                  ) : null}
                </div>
                <p
                  className="mt-1 truncate font-mono text-caption text-text-secondary"
                  title={defaultWorkspace?.path}
                >
                  {defaultWorkspace?.path ?? defaultWorkspaceError ?? '—'}
                </p>
                {defaultWorkspace?.legacyPath && (
                  <p className="mt-1 truncate font-mono text-caption text-amber-600 dark:text-amber-400" title={defaultWorkspace.legacyPath}>
                    旧缓存位置：{defaultWorkspace.legacyPath}
                  </p>
                )}
              </section>

              {/* 旧笔记迁移：没有可迁移资产时整块隐藏，避免出现永远无法消除的提示 */}
              {showMigrationSection && (
              <section className="rounded-lg border border-slate-200/80 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-body font-semibold text-text-primary">旧笔记迁移</h3>
                      {migrationPending?.pendingConversations ? (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-tiny font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                          {migrationPending.pendingConversations} 条待迁移
                        </span>
                      ) : migrationPending?.blockedConversations ? (
                        <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-tiny font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
                          {migrationPending.blockedConversations} 条阻塞
                        </span>
                      ) : null}
                    </div>
                    {migrationPending && (
                      <p className="mt-0.5 text-caption text-text-secondary">
                        {migrationPending.pendingAnnotations} 条标注 · {migrationPending.pendingMindmaps} 张导图
                      </p>
                    )}
                    {migrationLoadError && (
                      <p className="mt-0.5 text-caption text-rose-600 dark:text-rose-400">
                        {migrationLoadError}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {migrationPending?.job?.status === 'running' ? (
                      <button
                        type="button"
                        onClick={() => void pauseMigration()}
                        className="rounded px-2 py-1 text-body text-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
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
                        className="rounded bg-blue-50 px-2.5 py-1 text-body font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-400 dark:hover:bg-blue-900/50 disabled:opacity-40"
                      >
                        {migrationPending?.job?.status === 'paused' ? '继续迁移' : '开始迁移'}
                      </button>
                    )}
                    {migrationPending?.job && migrationPending.job.status !== 'abandoned' && (
                      <button
                        type="button"
                        onClick={() => void abandonMigration()}
                        className="text-body text-text-secondary hover:text-rose-500"
                      >
                        放弃
                      </button>
                    )}
                  </div>
                </div>

                {migrationProgress && (
                  <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2 text-caption dark:border-slate-800">
                    <div className="flex justify-between text-text-secondary">
                      <span className="truncate">{migrationProgress.currentTitle || '迁移中'}</span>
                      <span className="font-mono">
                        {migrationProgress.completed}/{migrationProgress.total}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                        style={{
                          width: `${migrationProgress.total > 0 ? (migrationProgress.completed / migrationProgress.total) * 100 : 0}%`
                        }}
                      />
                    </div>
                    {migrationProgress.blocked + migrationProgress.failed > 0 && (
                      <p className="text-amber-600 dark:text-amber-400">
                        阻塞 {migrationProgress.blocked} · 失败 {migrationProgress.failed}
                      </p>
                    )}
                  </div>
                )}

                {migrationResult && (
                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-caption text-text-secondary dark:border-slate-800">
                    <p>
                      完成 {migrationResult.migrated} · 阻塞 {migrationResult.blocked} · 失败 {migrationResult.failed}
                    </p>
                  </div>
                )}

                {!!migrationPending?.blockedRecords.length && (
                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                    {migrationPending.blockedRecords.slice(0, 3).map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2">
                        <span
                          className="min-w-0 truncate text-caption text-text-secondary"
                          title={`${item.title}：${blockedReasonLabel(item.reason)}`}
                        >
                          {item.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => void retryBlocked(item.id)}
                          className="shrink-0 text-caption text-blue-600 hover:underline"
                        >
                          重试
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              )}

              {/* 迁移前备份：只在存在备份时出现，避免常驻空区块 */}
              {!!backups?.files && (
                <section className="rounded-lg border border-slate-200/80 p-3 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-body font-semibold text-text-primary">迁移备份</h3>
                      <p className="mt-0.5 text-caption text-text-secondary">
                        {backups.files} 份 · {formatSize(backups.bytes)}
                        {backups.orphans > 0 ? ` · ${backups.orphans} 份正文已缺失` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={backupBusy}
                      onClick={() => void clearBackups()}
                      className="shrink-0 rounded px-2 py-1 text-body text-text-secondary hover:bg-black/5 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-white/5"
                    >
                      {backupBusy ? '清理中' : '清理'}
                    </button>
                  </div>
                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                    {backups.groups.slice(0, 3).map((group) => (
                      <div key={group.workspaceRoot} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-caption text-text-secondary" title={group.workspaceRoot}>
                          {group.workspaceRoot}
                        </span>
                        <span className="shrink-0 font-mono text-caption text-text-secondary">{group.files}</span>
                      </div>
                    ))}
                    {backups.groups.length > 3 && (
                      <p className="text-caption text-text-secondary">等 {backups.groups.length} 个工作区</p>
                    )}
                  </div>
                  {backupNotice && (
                    <p className="mt-1.5 text-caption text-emerald-600 dark:text-emerald-400">{backupNotice}</p>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {/* 底部保存与状态操作栏 */}
        <div className="flex shrink-0 items-center justify-between border-t border-black/5 bg-black/[0.02] px-4 py-2.5 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="text-caption text-text-secondary">
            {isDirty ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">未保存改动</span>
            ) : saved ? (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">已保存</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg px-3 py-1.5 text-body text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving || isSavingRemote || conversationSaving || isLoading || !isDirty}
              className="min-w-[68px] rounded-lg bg-primary px-4 py-1.5 text-body font-medium text-white hover:bg-primary/90 transition-all shadow-sm disabled:opacity-40 disabled:pointer-events-none"
            >
              {isSaving || isSavingRemote || conversationSaving ? '保存中' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </WorkbenchFooterPopover>
  )
}
