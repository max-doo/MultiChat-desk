import type { CSSProperties, ReactNode } from 'react'
import { AppIcon } from './icons/AppIcon'

interface Props {
  title: string
  quote: string
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
  saveLabel?: string
  busy?: boolean
  error?: string | null
  placeholder?: string
  showInput?: boolean
  autoFocus?: boolean
  footerStart?: ReactNode
  className?: string
  style?: CSSProperties
}

/** 原文采集、正文高亮和原文高亮共用的评论卡。 */
export default function AnnotationCommentCard({
  title,
  quote,
  value,
  onChange,
  onCancel,
  onSave,
  saveLabel = '保存标注',
  busy = false,
  error,
  placeholder = '添加评论…',
  showInput = true,
  autoFocus = true,
  footerStart,
  className = '',
  style
}: Props): JSX.Element {
  return (
    <div
      data-annotation-popover="true"
      className={`w-[320px] liquid-glass-menu rounded-xl p-3 text-text-primary no-drag ${className}`}
      style={style}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{title}</strong>
        <button
          type="button"
          aria-label="关闭"
          className="text-text-secondary hover:text-text-primary"
          onClick={onCancel}
        >
          <AppIcon name="close" size={16} />
        </button>
      </div>
      <p className="mt-2 max-h-20 overflow-y-auto rounded-r-md border-l-4 border-amber-300 bg-amber-50/60 p-2 text-xs text-text-secondary dark:bg-amber-300/10">
        {quote}
      </p>
      {showInput && (
        <textarea
          autoFocus={autoFocus}
          className="mt-3 min-h-20 w-full resize-y rounded-lg border border-black/10 p-2 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-transparent"
          placeholder={placeholder}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">{footerStart}</div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs text-text-secondary"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-1 text-xs text-white disabled:opacity-40"
            onClick={onSave}
          >
            {busy ? '保存中…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
