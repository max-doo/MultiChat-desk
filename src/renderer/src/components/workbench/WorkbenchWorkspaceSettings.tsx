import { useCallback, useEffect, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { GitRemoteInfo, GitignoreEntry, GitignoreCategory } from '../../../../shared/types/workbench'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchFooterPopover, { WorkbenchFooterPopoverHeader } from './WorkbenchFooterPopover'

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

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

  const [entries, setEntries] = useState<GitignoreEntry[]>([])
  const [categories, setCategories] = useState<GitignoreCategory[]>([])
  const [newPattern, setNewPattern] = useState('')
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([])
  const [remoteUrl, setRemoteUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [ignoreSaved, setIgnoreSaved] = useState(false)
  const [isSavingRemote, setIsSavingRemote] = useState(false)
  const [remoteSaved, setRemoteSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 打开时磁盘上的规则快照，用于保存前检测外部修改
  const [diskPatterns, setDiskPatterns] = useState<string[]>([])

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
        setEntries(ignoreRes.data.entries)
        setDiskPatterns(ignoreRes.data.entries.map((entry) => entry.pattern))
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

  const hasPattern = (pattern: string): boolean => entries.some((entry) => entry.pattern === pattern)
  // 勾选状态以当前列表为准：手动删掉组内任意规则后，复选框自动回到未勾选
  const isCategoryChecked = (category: GitignoreCategory): boolean =>
    category.patterns.every((pattern) => hasPattern(pattern))

  // 当前列表是否已与磁盘一致；用于区分“已填入”与“已保存”
  // 用排序后的字符串比较：规则顺序不影响 .gitignore 语义
  const isIgnoreDirty = (() => {
    const current = entries.map((entry) => entry.pattern).sort()
    const disk = [...diskPatterns].sort()
    return current.length !== disk.length || current.some((pattern, index) => pattern !== disk[index])
  })()

  /** 关闭前确认未保存的忽略规则，避免点遮罩或关闭按钮时静默丢弃勾选 */
  const requestClose = (): void => {
    if (isIgnoreDirty && !window.confirm('忽略规则尚未保存，确定放弃这些改动？')) return
    onClose()
  }

  /** 只添加缺失规则；用于大文件按扩展名快速忽略 */
  const addPatterns = (patterns: string[]): void => {
    setIgnoreSaved(false)
    setEntries((prev) => {
      const existing = new Set(prev.map((entry) => entry.pattern))
      const added = patterns
        .filter((pattern) => !existing.has(pattern))
        .map((pattern) => ({ pattern, comment: null }))
      return added.length ? [...prev, ...added] : prev
    })
  }

  const addNewPattern = (): void => {
    const pattern = newPattern.trim()
    if (!pattern) return
    setIgnoreSaved(false)
    if (!hasPattern(pattern)) setEntries((prev) => [...prev, { pattern, comment: null }])
    setNewPattern('')
  }

  /** 勾选/取消一个分类：只增删该组规则，不触碰其他组和用户手写条目 */
  const toggleCategory = (category: GitignoreCategory): void => {
    const selected = isCategoryChecked(category)
    setIgnoreSaved(false)
    setEntries((prev) => {
      if (selected) {
        const remove = new Set(category.patterns)
        return prev.filter((entry) => !remove.has(entry.pattern))
      }
      const existing = new Set(prev.map((entry) => entry.pattern))
      const added = category.patterns
        .filter((pattern) => !existing.has(pattern))
        .map((pattern) => ({ pattern, comment: null }))
      return added.length ? [...prev, ...added] : prev
    })
  }

  const saveIgnore = async (): Promise<void> => {
    if (!workspacePath || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const snapshot = await window.api.workbench.readGitignore(workspacePath)
      const currentDisk = snapshot.success && snapshot.data
        ? snapshot.data.entries.map((entry) => entry.pattern).sort()
        : []
      const expectedDisk = [...diskPatterns].sort()
      const changedOnDisk =
        currentDisk.length !== expectedDisk.length ||
        currentDisk.some((pattern, index) => pattern !== expectedDisk[index])
      if (changedOnDisk) {
        const overwrite = window.confirm(
          '.gitignore 已在其他程序中修改。继续保存会用当前列表覆盖这些改动，是否继续？'
        )
        if (!overwrite) return
      }
      const res = await window.api.workbench.writeGitignore(workspacePath, entries)
      if (!res.success) {
        setError(res.error || '保存忽略规则失败')
        return
      }
      await refreshGitStatus()
      setDiskPatterns(entries.map((entry) => entry.pattern))
      setIgnoreSaved(true)
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
      const remoteRes = await window.api.workbench.gitRemotes(workspacePath ?? '')
      if (remoteRes.success && remoteRes.data) {
        setRemotes(remoteRes.data)
        setRemoteSaved(true)
        window.setTimeout(() => setRemoteSaved(false), 2000)
      }
    } finally {
      setIsSavingRemote(false)
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
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
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

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-text-primary">忽略规则</span>
              <span className="text-[11px] text-text-secondary">.gitignore</span>
            </div>
            {categories.length > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                {categories.map((category) => {
                  const checked = isCategoryChecked(category)
                  return (
                    <label
                      key={category.id}
                      title={category.patterns.join('\n')}
                      className={`flex min-w-0 cursor-pointer items-start gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
                        checked
                          ? 'border-primary/30 bg-primary/5'
                          : 'border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(category)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-text-primary">
                          {category.label}
                        </span>
                        <span className="block truncate text-[10px] text-text-secondary">
                          {category.description}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            <div className="max-h-[260px] min-h-[120px] overflow-y-auto rounded-lg border border-black/10 bg-black/[0.02] p-1 dark:border-white/10 dark:bg-white/[0.02]">
              {isLoading ? (
                <div className="px-2 py-3 text-xs text-text-secondary">读取中…</div>
              ) : entries.length === 0 ? (
                <div className="px-2 py-3 text-xs text-text-secondary">尚未设置忽略规则</div>
              ) : (
                entries.map((entry, index) => (
                  <div
                    key={`${entry.pattern}:${index}`}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span className="flex-1 truncate font-mono text-xs text-text-primary" title={entry.pattern}>
                      {entry.pattern}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIgnoreSaved(false)
                        setEntries((prev) => prev.filter((_, i) => i !== index))
                      }}
                      className="shrink-0 text-text-secondary opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                      title="移除"
                    >
                      <AppIcon name="delete" size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-2 flex gap-1.5">
              <input
                value={newPattern}
                onChange={(event) => setNewPattern(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addNewPattern()
                  }
                }}
                placeholder="*.pdf"
                className="h-8 min-w-0 flex-1 rounded-lg border border-black/15 bg-black/5 px-2.5 font-mono text-xs text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-white/15 dark:bg-white/5 dark:focus:bg-gray-900"
              />
              <button
                type="button"
                onClick={addNewPattern}
                disabled={!newPattern.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/10 text-text-secondary hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                title="添加规则"
              >
                <AppIcon name="add" size={17} />
              </button>
            </div>

            {largeUntracked.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
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
                    onClick={() => addPatterns([ext.startsWith('*.') ? ext : `*.${ext}`])}
                    className="h-6 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    忽略 {ext.startsWith('*.') ? ext : `*.${ext}`}
                  </button>
                ))}
              </div>
            )}

          </div>

          {gitStatus?.isRepository && (
            <div className="border-t border-black/5 pt-3 dark:border-white/5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-text-primary">远程仓库</span>
                {remotes.length > 0 && (
                  <span className="text-[11px] text-text-secondary">{gitStatus?.remoteName ?? remotes[0].name}</span>
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  value={remoteUrl}
                  onChange={(event) => {
                    setRemoteUrl(event.target.value)
                    setRemoteSaved(false)
                  }}
                  placeholder={
                    remotes.find((item) => item.name === (gitStatus?.remoteName ?? remotes[0]?.name))?.redacted
                      ? '重新输入远程地址（当前地址含凭据）'
                      : 'https://github.com/user/repo.git'
                  }
                  className="h-8 min-w-0 flex-1 rounded-lg border border-black/15 bg-black/5 px-2.5 text-xs text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-white/15 dark:bg-white/5 dark:focus:bg-gray-900"
                />
                <button
                  type="button"
                  onClick={() => void saveRemote()}
                  disabled={!remoteUrl.trim() || isSavingRemote || remoteSaved}
                  className="h-8 shrink-0 rounded-lg border border-black/10 px-2.5 text-xs text-text-primary hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                >
                  {isSavingRemote ? '保存中' : remoteSaved ? '已保存' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-black/5 pt-3 dark:border-white/5">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-text-secondary hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void saveIgnore()}
            disabled={isSaving || isLoading}
            className="rounded-lg bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary/90 disabled:opacity-40"
          >
            {isSaving ? '保存中' : ignoreSaved && !isIgnoreDirty ? '已保存' : '保存忽略规则'}
          </button>
        </div>
      </div>
    </WorkbenchFooterPopover>
  )
}
