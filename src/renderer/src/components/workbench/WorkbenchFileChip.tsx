import type { ReactNode } from 'react'
import { MARKDOWN_EXTENSIONS } from '../../../../shared/types/workbench'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'

const BITMAP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.tiff', '.tif', '.ico'
])

/**
 * 文件 chip 统一图标：位图 / SVG / Markdown 走 AppIcon 语义色，
 * 其余按扩展名映射到 material 文件图标。
 * 供 Agent 侧栏附件 chip、内联文件 chip 与编辑器双链 chip 共用。
 * size 默认 '1em'，随上下文字号缩放；传入数值则按像素固定。
 */
export function FileChipIcon({
  absPath,
  name,
  size = '1em',
  className = ''
}: {
  absPath: string
  name: string
  size?: number | string
  className?: string
}): JSX.Element {
  const dot = name.lastIndexOf('.')
  const ext = dot !== -1 ? name.slice(dot).toLowerCase() : ''
  const isEm = typeof size === 'string' && /^\d*\.?\d+em$/.test(size)
  const imgClassName = isEm ? 'w-[1em] h-[1em]' : 'w-3.5 h-3.5'
  if (BITMAP_EXTENSIONS.has(ext)) {
    return <AppIcon name="image" size={size} className={`shrink-0 text-purple-500 dark:text-purple-400 ${className}`} />
  }
  if (ext === '.svg') {
    return <AppIcon name="draw" size={size} className={`shrink-0 text-purple-500 dark:text-purple-400 ${className}`} />
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return <AppIcon name="description" size={size} className={`shrink-0 text-blue-500 dark:text-blue-400 ${className}`} />
  }
  return (
    <FileTypeIcon
      node={{ id: absPath, name, path: absPath, fullPath: absPath, isDirectory: false, extension: ext }}
      className={`${imgClassName} ${className}`}
    />
  )
}

/**
 * 行内文件 chip 外壳：icon + 文字。
 * 样式与 Agent 侧栏模型回复正文中的内联文件 chip 一致：
 * 无背景、无描边，图标 + 主题色文字，字号继承上下文；
 * 缺失态（链接目标不存在）改用琥珀色文字与小圆点图标。
 *
 * 只承担视觉外壳，不绑定点击行为与打开语义。
 */
export function WorkbenchFileChip({
  icon,
  label,
  missing = false,
  title,
  className = '',
  onClick,
  onAuxClick,
  children
}: {
  icon: ReactNode
  label?: string
  missing?: boolean
  title?: string
  className?: string
  onClick?: (e: React.MouseEvent) => void
  onAuxClick?: (e: React.MouseEvent) => void
  children?: ReactNode
}): JSX.Element {
  const colorCls = missing
    ? 'text-amber-600 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-400/15'
    : 'text-primary hover:bg-primary/10 dark:text-blue-300 dark:hover:bg-primary/25'
  // 可交互判定：显式点击处理器，或可点击的非缺失 chip（正文行内 chip 的点击
  // 走编辑器容器委托监听，不经 props）；缺失态不可打开，不展示手型光标
  const interactive = Boolean(onClick || onAuxClick) || !missing
  const cls = `mx-0.5 inline-flex items-center gap-1 rounded px-1 -my-0.5 py-0.5 align-baseline font-normal select-none ${interactive ? 'cursor-pointer' : 'cursor-default'} transition-colors ${colorCls} ${className}`
  const inner = (
    <>
      {icon}
      {label !== undefined && (
        <span className="truncate max-w-52">{label}</span>
      )}
      {children}
    </>
  )
  // 传入点击处理器时渲染为 button（侧栏/卡片流），否则保持 span（编辑器正文行内）
  if (onClick || onAuxClick) {
    return (
      <button type="button" className={cls} title={title} onClick={onClick} onAuxClick={onAuxClick}>
        {inner}
      </button>
    )
  }
  return (
    <span className={cls} title={title}>
      {inner}
    </span>
  )
}

/** 缺失目标的占位图标：小琥珀圆点。 */
export function FileChipMissingIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      className={`inline-block w-[0.42em] h-[0.42em] rounded-full bg-amber-500/80 shrink-0 ${className}`}
      aria-hidden="true"
    />
  )
}
