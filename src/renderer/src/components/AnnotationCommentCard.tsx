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
      className={`w-[360px] liquid-glass-menu rounded-xl border-amber-500/70 p-4 text-text-primary no-drag dark:border-amber-400/70 ${className}`}
      style={style}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-body font-semibold">{title}</strong>
        <button
          type="button"
          aria-label="关闭"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
          onClick={onCancel}
        >
          <AppIcon name="close" size={16} />
        </button>
      </div>
      <p className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-amber-50/70 p-2.5 text-label text-text-secondary dark:bg-amber-300/10">
        {quote}
      </p>
      {showInput && (
        <textarea
          autoFocus={autoFocus}
          className="mt-3 min-h-24 w-full resize-y rounded-lg border border-black/10 bg-white/80 p-2.5 text-body text-text-primary outline-none focus:border-primary dark:border-white/10 dark:bg-transparent"
          placeholder={placeholder}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      )}
      {error && <p className="mt-1 text-label text-rose-600">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0">{footerStart}</div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className="h-8 rounded-lg px-3 text-label text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-8 rounded-lg bg-primary px-4 text-label font-medium text-white hover:opacity-90 disabled:opacity-40"
            onClick={onSave}
          >
            {busy ? '保存中…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
