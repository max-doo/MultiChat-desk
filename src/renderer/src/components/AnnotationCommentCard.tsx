import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { clampPopoverPosition } from '../utils/noteInteractions'
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
  clampBounds?: 'viewport' | 'parent'
  clampMargin?: number
  clampMinTop?: number
}

/** 原文采集、正文高亮和原文高亮共用的评论卡。 */
const AnnotationCommentCard = forwardRef<HTMLDivElement, Props>(function AnnotationCommentCard(
  {
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
    style,
    clampBounds,
    clampMargin = 8,
    clampMinTop = clampMargin
  },
  forwardedRef
): JSX.Element {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null)

  const setRef = (node: HTMLDivElement | null): void => {
    innerRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  const rawLeft = typeof style?.left === 'number' ? style.left : null
  const rawTop = typeof style?.top === 'number' ? style.top : null

  useLayoutEffect(() => {
    if (!clampBounds || rawLeft === null || rawTop === null) {
      setClamped(null)
      return
    }
    const el = innerRef.current
    if (!el) return

    const update = (): void => {
      const rect = el.getBoundingClientRect()
      const parent = el.offsetParent as HTMLElement | null
      const bounds =
        clampBounds === 'parent' && parent
          ? { width: parent.clientWidth, height: parent.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight }
      const next = clampPopoverPosition(
        rawLeft,
        rawTop,
        bounds,
        { width: rect.width, height: rect.height },
        clampMargin,
        clampMinTop
      )
      setClamped(prev =>
        prev && prev.left === next.left && prev.top === next.top ? prev : next
      )
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [clampBounds, clampMargin, clampMinTop, rawLeft, rawTop])

  const mergedStyle: CSSProperties | undefined =
    clamped && style ? { ...style, left: clamped.left, top: clamped.top } : style

  return (
    <div
      ref={setRef}
      data-annotation-popover="true"
      className={`w-[360px] max-w-[calc(100vw-16px)] liquid-glass-menu rounded-xl border-amber-500/70 p-4 text-text-primary no-drag dark:border-amber-400/70 ${className}`}
      style={mergedStyle}
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
})

export default AnnotationCommentCard
