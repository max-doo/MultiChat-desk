import { useEffect } from 'react'
import { AppIcon } from '../icons/AppIcon'

interface WorkbenchHtmlEditLeaveDialogProps {
  busy: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export default function WorkbenchHtmlEditLeaveDialog({
  busy,
  onSave,
  onDiscard,
  onCancel
}: WorkbenchHtmlEditLeaveDialogProps): JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onCancel])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workbench-html-edit-leave-title"
        className="w-[380px] max-w-full rounded-2xl border border-black/10 bg-white p-5 text-sm shadow-2xl dark:border-white/10 dark:bg-gray-800"
      >
        <div className="flex items-center justify-between font-semibold text-text-primary">
          <h3 id="workbench-html-edit-leave-title">保存修改？</h3>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="text-text-secondary transition-colors hover:text-text-primary disabled:cursor-default disabled:opacity-40"
            title="关闭"
            aria-label="关闭"
          >
            <AppIcon name="close" size={19} />
          </button>
        </div>

        <p className="mt-4 leading-relaxed text-text-secondary">
          退出编辑前，将当前修改写回原文件。
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="mr-auto rounded-lg px-2.5 py-1.5 font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-default disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            放弃修改
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-black/10 px-3 py-1.5 font-medium text-text-secondary transition-colors hover:bg-black/5 disabled:cursor-default disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="rounded-lg bg-primary px-3 py-1.5 font-medium text-white shadow-xs transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存并退出'}
          </button>
        </div>
      </div>
    </div>
  )
}
