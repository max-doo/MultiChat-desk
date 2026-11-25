import type { ReactNode } from 'react'
import { AppIcon } from '../icons/AppIcon'

interface PreviewHeaderProps {
  left: ReactNode
  right?: ReactNode
  theme?: 'light' | 'dark'
  compact?: boolean
}

/** 预览视图顶部工具栏骨架：统一浅色 h-12 与代码深色 h-10 顶栏规范。 */
export function PreviewHeader({
  left,
  right,
  theme = 'light',
  compact = false
}: PreviewHeaderProps): JSX.Element {
  const barClass =
    theme === 'dark'
      ? `${compact ? 'h-10' : 'h-12'} px-3 bg-slate-800/90 border-b border-slate-700/60 flex items-center justify-between gap-2 shrink-0 select-none text-body`
      : `${compact ? 'h-10' : 'h-12'} px-3 bg-white/80 dark:bg-gray-800/80 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 select-none text-body`

  return (
    <div className={barClass}>
      <div className="flex items-center gap-2 truncate">{left}</div>
      {right && (
        <div
          className={`flex items-center shrink-0 ${
            theme === 'dark' ? 'gap-2 text-slate-400 text-body' : 'gap-1.5 text-text-secondary'
          }`}
        >
          {right}
        </div>
      )}
    </div>
  )
}

interface PreviewZoomControlsProps {
  zoom: number
  minZoom: number
  maxZoom: number
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
  theme?: 'light' | 'dark'
  zoomOutTitle?: string
  zoomInTitle?: string
  resetTitle?: string
}

/** PDF / Word / 图片 / HTML 渲染共用的缩放步进与复位控件组。 */
export function PreviewZoomControls({
  zoom,
  minZoom,
  maxZoom,
  onZoomOut,
  onZoomIn,
  onReset,
  theme = 'light',
  zoomOutTitle = '缩小',
  zoomInTitle = '放大',
  resetTitle = '恢复到 100%'
}: PreviewZoomControlsProps): JSX.Element {
  const btnClass =
    theme === 'dark'
      ? 'w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-transparent'
      : 'w-7 h-7 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent'
  const labelClass =
    theme === 'dark'
      ? 'min-w-[44px] h-7 px-1 rounded-md text-label font-medium tabular-nums text-slate-300 hover:bg-slate-700 hover:text-white transition-colors'
      : 'min-w-[46px] h-7 px-1 rounded-md text-label font-medium tabular-nums hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors'

  return (
    <div className="flex items-center gap-0.5 rounded-md">
      <button
        type="button"
        onClick={onZoomOut}
        disabled={zoom <= minZoom}
        className={btnClass}
        title={zoomOutTitle}
      >
        <AppIcon name="zoom_out" size={19} />
      </button>
      <button
        type="button"
        onClick={onReset}
        className={labelClass}
        title={resetTitle}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={zoom >= maxZoom}
        className={btnClass}
        title={zoomInTitle}
      >
        <AppIcon name="zoom_in" size={19} />
      </button>
    </div>
  )
}

interface PreviewFallbackStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actionLabel?: string
  onAction?: () => void
  actionIcon?: string
  theme?: 'light' | 'dark'
  framed?: boolean
}

/** 预览超限 / 失败 / 不支持的二进制文件共用兜底视图。 */
export function PreviewFallbackState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon = 'open_in_new',
  theme = 'light',
  framed = false
}: PreviewFallbackStateProps): JSX.Element {
  const containerClass =
    theme === 'dark'
      ? 'flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-slate-900 select-none'
      : 'w-full h-full flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-900 text-text-primary select-none'

  const inner = (
    <>
      {icon}
      <h3
        className={`text-body-lg font-semibold mb-1 ${
          theme === 'dark' ? 'text-slate-100' : 'text-text-primary'
        }`}
      >
        {title}
      </h3>
      {description && (
        <p
          className={`text-body max-w-sm mb-6 leading-relaxed ${
            theme === 'dark' ? 'text-slate-400' : 'text-text-secondary'
          }`}
        >
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="h-9 px-4 rounded-lg bg-primary text-white hover:opacity-90 text-body font-medium flex items-center gap-2 shadow-sm transition-all"
        >
          <AppIcon name={actionIcon} size={19} />
          <span>{actionLabel}</span>
        </button>
      )}
    </>
  )

  if (framed) {
    return (
      <div className="flex flex-col items-center gap-3 text-text-secondary max-w-sm text-center p-6 bg-white/80 dark:bg-gray-800/80 rounded-xl shadow-lg border border-black/5 dark:border-white/5">
        {inner}
      </div>
    )
  }

  return <div className={containerClass}>{inner}</div>
}

/** 预览面板右下角悬浮标签胶囊。 */
export function PreviewMetaPill({
  children,
  title,
  className = ''
}: {
  children: ReactNode
  title?: string
  className?: string
}): JSX.Element {
  return (
    <div
      className={`flex h-9 items-center gap-2 rounded-full border border-black/5 bg-white/85 px-2.5 text-label text-text-secondary shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-gray-900/80 ${className}`}
      title={title}
    >
      {children}
    </div>
  )
}
