import { AppIcon } from '../icons/AppIcon'
import Modal from '../ui/Modal'

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
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      variant="solid"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      className="p-5 text-body"
    >
      <div aria-labelledby="workbench-html-edit-leave-title">
        <div className="flex items-center justify-between font-semibold text-text-primary">
          <h3 id="workbench-html-edit-leave-title" className="text-title">保存修改？</h3>
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

        <p className="mt-4 text-body leading-relaxed text-text-secondary">
          退出编辑前，将当前修改写回原文件。
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="mr-auto rounded-lg px-2.5 py-1.5 text-body font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-default disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            放弃修改
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-body font-medium text-text-secondary transition-colors hover:bg-black/5 disabled:cursor-default disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="rounded-lg bg-primary px-3 py-1.5 text-body font-medium text-white shadow-xs transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存并退出'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
