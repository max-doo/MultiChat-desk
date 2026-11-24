import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  FileCheck2,
  FileWarning,
  FolderOpen,
  Loader2,
  Undo2
} from 'lucide-react'
import ConfirmModal from '../../ConfirmModal'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import { resolveAbsolute, toWorkspaceRelative } from './filePathUtils'
import type {
  AgentFileChange,
  AgentFileSnapshot,
  AgentTurnFileChanges
} from '../../../../../shared/types/agentRuntime'

interface ChangedFilesCardProps {
  sessionId: string
  cwd: string
  /** 1-based turn number this card is bound to. The session record carries
   * the turn that produced the edits; only that turn's closing message should
   * render the card. Records written before turn binding existed have no
   * `turnIndex` — those fall back to `allowLegacy`. */
  turnIndex?: number
  /** Render even when the persisted record has no `turnIndex` (legacy data).
   * Pass `true` only on the last turn-final message so legacy records don't
   * repeat on every turn. */
  allowLegacy?: boolean
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
  turnIndex,
  allowLegacy = false,
  interactive = true
}: ChangedFilesCardProps): JSX.Element | null {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [record, setRecord] = useState<AgentTurnFileChanges | null | 'loading'>('loading')
  const [rows, setRows] = useState<FileRowState[] | null>(null)
  const loadStartedRef = useRef(false)

  const ensureLoaded = useCallback(async (expandAfter = false): Promise<void> => {
    if (loadStartedRef.current) {
      if (expandAfter) setOpen(true)
      return
    }
    loadStartedRef.current = true
    setLoading(true)
    try {
      const res = await window.api.agentGetFileChanges(sessionId)
      if (res.success && res.data && res.data.files.length > 0) {
        const data = res.data
        // The session keeps only the most recent change record. If it belongs
        // to a different turn than this message, don't render here — the card
        // should only hang off the turn that actually produced the edits.
        if (
          data.turnIndex !== undefined
            ? data.turnIndex !== turnIndex
            : !allowLegacy
        ) {
          setRecord(null)
          return
        }
        setRecord(data)
        const paths = data.files.map((f) => f.path)
        const staleRes = await window.api
          .agentCheckFilesStale(sessionId, paths, 'target')
          .catch(() => null)
        const staleMap = staleRes?.data ?? {}
        const nextRows: FileRowState[] = await Promise.all(
          data.files.map(async (f) => {
            const target = data.target[f.path]
            const baseline = data.baseline[f.path]
            const stale = staleMap[f.path] === true
            return { change: f, baseline, target, stale }
          })
        )
        setRows(nextRows)
      } else {
        setRecord(null)
      }
    } catch {
      setRecord(null)
    } finally {
      setLoading(false)
      if (expandAfter) setOpen(true)
    }
  }, [sessionId, cwd, turnIndex, allowLegacy])

  useEffect(() => {
    void ensureLoaded()
  }, [ensureLoaded])

  const staleCount = useMemo(
    () => (rows ?? []).filter((r) => r.stale).length,
    [rows]
  )
  const canUndo =
    interactive &&
    record !== 'loading' &&
    record !== null &&
    record.status === 'applied' &&
    staleCount === 0
  const canRedo =
    interactive &&
    record !== 'loading' &&
    record !== null &&
    record.status === 'undone' &&
    staleCount === 0

  const handleUndo = async (): Promise<void> => {
    setConfirming(false)
    setError(null)
    const res = await window.api.agentRevertFileChanges(sessionId)
    if (!res.success) {
      setError(res.error || '撤销失败')
      return
    }
    setRecord((r) => (r && r !== 'loading' ? { ...r, status: 'undone' } : r))
  }

  const handleRedo = async (): Promise<void> => {
    setError(null)
    const res = await window.api.agentReapplyFileChanges(sessionId)
    if (!res.success) {
      setError(res.error || '恢复失败')
      return
    }
    setRecord((r) => (r && r !== 'loading' ? { ...r, status: 'applied' } : r))
  }

  const handleOpenInEditor = useCallback(
    async (filePath: string): Promise<void> => {
      const abs = resolveAbsolute(cwd, filePath)
      const rel = workspacePath
        ? toWorkspaceRelative(workspacePath, cwd, filePath)
        : null
      if (rel) {
        const opened = await openFile(rel)
        if (opened) return
      }
      // Outside the workspace (or open failed) → fall back to revealing the
      // file in its containing folder so the user can still locate it.
      void window.api.agentRevealFile(abs)
    },
    [cwd, workspacePath, openFile]
  )

  if (record === 'loading') {
    return null
  }
  if (record === null || record.files.length === 0) {
    return null
  }

  const total = record.files.length
  const undone = record.status === 'undone'

  return (
    <>
      <div className="mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs dark:border-white/10 dark:bg-white/[0.03]">
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : void ensureLoaded(true))}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
              undone
                ? 'bg-gray-100 text-gray-500 dark:bg-white/10'
                : staleCount > 0
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-emerald-50 text-emerald-600'
            }`}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : undone ? (
              <Undo2 className="h-3 w-3" />
            ) : staleCount > 0 ? (
              <FileWarning className="h-3 w-3" />
            ) : (
              <FileCheck2 className="h-3 w-3" />
            )}
          </span>
          <span className="min-w-0 flex-1 text-caption text-text-primary">
            <span className="font-medium">
              {undone ? '已撤销' : '已修改'} {total} 个文件
            </span>
            {staleCount > 0 && !undone && (
              <span className="ml-1.5 text-[10px] text-amber-600">
                {staleCount} 个已被外部修改
              </span>
            )}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-text-secondary transition-transform ${
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
                      <button
                        type="button"
                        onClick={() => void handleOpenInEditor(change.path)}
                        title={abs}
                        className="block max-w-full truncate text-left font-mono text-[11.5px] text-text-primary transition-colors hover:text-primary"
                      >
                        {change.name}
                      </button>
                      {hasDir && (
                        <div className="truncate text-[10px] text-text-secondary">
                          {dirPart}
                        </div>
                      )}
                    </div>
                    {change.isNew ? (
                      <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        新建
                      </span>
                    ) : stale ? (
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-text-secondary">
                        已变化
                      </span>
                    ) : null}
                    {!change.isNew && (
                      <span className="shrink-0 font-mono text-[10.5px] text-text-secondary">
                        {change.added > 0 && (
                          <span className="text-emerald-600">+{change.added}</span>
                        )}{' '}
                        {change.deleted > 0 && (
                          <span className="text-rose-500">-{change.deleted}</span>
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void window.api.agentRevealFile(abs)}
                      title="打开所在文件夹"
                      className="shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                    >
                      <FolderOpen className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-1.5 dark:border-white/5 dark:bg-white/[0.02]">
              {error && (
                <span className="mr-auto text-[10.5px] text-rose-500">{error}</span>
              )}
              {!undone && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={!canUndo}
                  title={
                    canUndo
                      ? '回滚到本次任务开始前的状态'
                      : staleCount > 0
                        ? '部分文件已被外部修改，无法安全撤销'
                        : undefined
                  }
                  className="rounded-md border border-gray-200 bg-white px-2.5 py-0.5 text-caption text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:border-white/10 dark:bg-transparent"
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
                  className="rounded-md border border-gray-200 bg-white px-2.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-transparent"
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
