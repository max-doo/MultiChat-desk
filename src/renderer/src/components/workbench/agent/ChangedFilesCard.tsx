import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '../../icons/AppIcon'
import ConfirmModal from '../../ConfirmModal'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import { agentChipOpenOptions, resolveAbsolute, toWorkspaceRelative } from './filePathUtils'
import type {
  AgentFileChange,
  AgentFileSnapshot,
  AgentTurnFileChanges
} from '../../../../../shared/types/agentRuntime'

interface ChangedFilesCardProps {
  sessionId: string
  cwd: string
  record: AgentTurnFileChanges
  /** When true, render the undo/redo controls. */
  interactive?: boolean
}

interface FileRowState {
  change: AgentFileChange
  baseline?: AgentFileSnapshot
  target?: AgentFileSnapshot
  /** True when the live file no longer matches the snapshot recorded for it. */
  stale: boolean
}

/**
 * Turn-scoped summary of files the agent touched, plus undo/redo when safe.
 * Rendered by the runtime — the model is not involved in producing this card.
 */
export function ChangedFilesCard({
  sessionId,
  cwd,
  record,
  interactive = true
}: ChangedFilesCardProps): JSX.Element | null {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const setFileChangesStatus = useAgentSessionStore((s) => s.setFileChangesStatus)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staleMap, setStaleMap] = useState<Record<string, boolean>>({})
  const checkSeqRef = useRef(0)

  const checkStale = useCallback(
    async (kind: 'baseline' | 'target'): Promise<void> => {
      if (record.files.length === 0) {
        setStaleMap({})
        return
      }
      const seq = ++checkSeqRef.current
      setLoading(true)
      try {
        const paths = record.files.map((f) => f.path)
        const staleRes = await window.api
          .agentCheckFilesStale(sessionId, paths, kind)
          .catch(() => null)
        if (checkSeqRef.current !== seq) return
        setStaleMap(staleRes?.data ?? {})
      } finally {
        if (checkSeqRef.current === seq) {
          setLoading(false)
        }
      }
    },
    [sessionId, record.files]
  )

  const prevTargetRef = useRef<Record<string, AgentFileSnapshot> | null>(null)

  useEffect(() => {
    // Only refresh target staleness when the record's target snapshots change
    // while applied; flipping applied -> undone should keep redo available.
    if (record.status === 'applied' && prevTargetRef.current !== record.target) {
      prevTargetRef.current = record.target
      void checkStale('target')
    }
  }, [record.status, record.target, checkStale])

  const rows = useMemo<FileRowState[]>(() => {
    return record.files.map((f) => ({
      change: f,
      baseline: record.baseline[f.path],
      target: record.target[f.path],
      stale: staleMap[f.path] === true
    }))
  }, [record, staleMap])

  const staleCount = useMemo(
    () => rows.filter((r) => r.stale).length,
    [rows]
  )
  const hasMissingBaseline = useMemo(
    () => rows.some((r) => r.change.noBaselineBlob === true),
    [rows]
  )
  const canUndo =
    interactive && record.status === 'applied' && staleCount === 0 && !hasMissingBaseline
  const canRedo = interactive && record.status === 'undone' && staleCount === 0

  const handleUndo = async (): Promise<void> => {
    setConfirming(false)
    setError(null)
    const res = await window.api.agentRevertFileChanges(sessionId)
    if (!res.success) {
      setError(res.error || '撤销失败')
      return
    }
    setFileChangesStatus('undone')
  }

  const handleRedo = async (): Promise<void> => {
    setError(null)
    const res = await window.api.agentReapplyFileChanges(sessionId)
    if (!res.success) {
      setError(res.error || '恢复失败')
      return
    }
    setFileChangesStatus('applied')
  }

  const handleToggleOpen = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    void checkStale(record.status === 'undone' ? 'baseline' : 'target')
  }

  const handleOpenInEditor = useCallback(
    async (filePath: string, e: { ctrlKey: boolean; metaKey: boolean; button: number }): Promise<void> => {
      const abs = resolveAbsolute(cwd, filePath)
      const rel = workspacePath
        ? toWorkspaceRelative(workspacePath, cwd, filePath)
        : null
      if (rel) {
        const opened = await openFile(rel, agentChipOpenOptions(e))
        if (opened) return
      }
      // Outside the workspace (or open failed) → fall back to revealing the
      // file in its containing folder so the user can still locate it.
      void window.api.agentRevealFile(abs)
    },
    [cwd, workspacePath, openFile]
  )

  if (record.files.length === 0) {
    return null
  }

  const total = record.files.length
  const undone = record.status === 'undone'

  return (
    <>
      <div className="mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
        <button
          type="button"
          onClick={handleToggleOpen}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
              staleCount > 0 && !undone
                ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
                : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400'
            }`}
          >
            {loading ? (
              <AppIcon name="progress_activity" size={16} className="animate-spin" />
            ) : undone ? (
              <AppIcon name="undo" size={16} />
            ) : staleCount > 0 ? (
              <AppIcon name="file_warning" size={16} />
            ) : (
              <AppIcon name="file_check" size={16} />
            )}
          </span>
          <span className="min-w-0 flex-1 text-caption text-text-primary">
            <span className="font-medium">
              {undone ? '已撤销' : '已修改'} {total} 个文件
            </span>
            {staleCount > 0 && !undone && (
              <span className="ml-1.5 text-caption text-amber-600 dark:text-amber-400">
                {staleCount} 个已被外部修改
              </span>
            )}
          </span>
          <AppIcon
            name="expand_more"
            size={14}
            className={`shrink-0 text-text-secondary transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {open && rows && (
          <>
            <div className="border-t border-gray-100 dark:border-white/5">
              {rows.map(({ change, stale }) => {
                const abs = resolveAbsolute(cwd, change.path)
                const dirPart = change.path.replace(/[/\\][^/\\]+$/, '')
                const hasDir = dirPart !== change.path
                return (
                  <div
                    key={change.path}
                    className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5 last:border-b-0 dark:border-white/5"
                  >
                    <div className="min-w-0 flex-1">
                      {change.isDeleted ? (
                        <div
                          title={abs}
                          className="truncate font-mono text-label text-text-secondary line-through"
                        >
                          {change.name}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => void handleOpenInEditor(change.path, e)}
                          onAuxClick={(e) => {
                            if (e.button !== 1) return
                            e.preventDefault()
                            void handleOpenInEditor(change.path, e)
                          }}
                          title={abs}
                          className="block max-w-full truncate text-left font-mono text-label text-text-primary transition-colors hover:text-primary"
                        >
                          {change.name}
                        </button>
                      )}
                      {hasDir && (
                        <div className="truncate text-caption text-text-secondary">
                          {dirPart}
                        </div>
                      )}
                    </div>
                    {change.isNew ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-tiny font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        新建
                      </span>
                    ) : change.isDeleted ? (
                      <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-tiny font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                        已删除
                      </span>
                    ) : stale ? (
                      <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-tiny font-semibold text-text-secondary dark:bg-white/10">
                        已变化
                      </span>
                    ) : null}
                    {!change.isNew && !change.isDeleted && (
                      <span className="shrink-0 font-mono text-caption text-text-secondary">
                        {change.added > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400">+{change.added}</span>
                        )}{' '}
                        {change.deleted > 0 && (
                          <span className="text-rose-500 dark:text-rose-400">-{change.deleted}</span>
                        )}
                      </span>
                    )}
                    {!change.isDeleted && (
                      <button
                        type="button"
                        onClick={() => void window.api.agentRevealFile(abs)}
                        title="打开所在文件夹"
                        className="shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
                      >
                        <AppIcon name="folder_open" size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-1.5 dark:border-white/5 dark:bg-white/[0.02]">
              {error && (
                <span className="mr-auto text-caption text-rose-500 dark:text-rose-400">{error}</span>
              )}
              {!undone && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={!canUndo}
                  title={
                    canUndo
                      ? '回滚到本次任务开始前的状态'
                      : hasMissingBaseline
                        ? '包含命令修改或超大文件，缺少基线快照，无法安全撤销'
                        : staleCount > 0
                          ? '部分文件已被外部修改，无法安全撤销'
                          : undefined
                  }
                  className="rounded-md border border-gray-200 bg-white px-2.5 py-0.5 text-caption text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:border-white/10 dark:bg-transparent dark:text-rose-400 dark:hover:bg-rose-500/10"
                >
                  撤销全部修改
                </button>
              )}
              {undone && (
                <button
                  type="button"
                  onClick={() => void handleRedo()}
                  disabled={!canRedo}
                  title={
                    canRedo
                      ? '重新应用本次修改'
                      : staleCount > 0
                        ? '文件已被外部修改，无法安全恢复'
                        : undefined
                  }
                  className="rounded-md border border-gray-200 bg-white px-2.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
                >
                  恢复
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={confirming}
        title={`撤销本次的 ${total} 处文件修改？`}
        message="将回滚到本次任务开始前的状态，此操作会覆盖当前文件内容。"
        confirmText="确认撤销"
        cancelText="取消"
        type="danger"
        onConfirm={handleUndo}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}

export default ChangedFilesCard
