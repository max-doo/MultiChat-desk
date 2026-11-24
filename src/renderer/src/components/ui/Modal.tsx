import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '../icons/AppIcon'

export type ModalVariant = 'solid' | 'glass'
export type ModalSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg'
}

const PANEL_CLASS: Record<ModalVariant, string> = {
  solid:
    'bg-app border border-gray-200 rounded-xl shadow-2xl dark:border-gray-700 dark:bg-gray-800',
  glass: 'glass-panel-heavy rounded-2xl shadow-float'
}

// 入场动画：遮罩淡入 + 面板缩放淡入（替代之前无效的 animate-in/zoom-in-95 类）
const OVERLAY_ANIM = 'animate-[modal-fade-in_0.2s_ease-out]'
const PANEL_ANIM = 'animate-[modal-zoom-in_0.2s_ease-out]'

export interface ModalProps {
  open: boolean
  onClose: () => void
  variant?: ModalVariant
  size?: ModalSize
  /** 点遮罩是否关闭，默认 true */
  closeOnBackdrop?: boolean
  /** Escape 是否关闭，默认 true */
  closeOnEscape?: boolean
  /** 内容区最大高度，默认 85vh */
  maxHeight?: string
  className?: string
  children: ReactNode
}

/**
 * 统一模态弹窗基础组件。
 * - variant 'solid'：实色卡片（ConfirmModal / RenameModal / HtmlEditLeaveDialog 风格）
 * - variant 'glass'：玻璃拟态（ModelOrderModal / ProductModeOrderModal 风格）
 * 只负责遮罩 + 容器壳 + 层级 + 动画，不约束内部 header/body/footer 结构。
 */
export default function Modal({
  open,
  onClose,
  variant = 'solid',
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  maxHeight = '85vh',
  className = '',
  children
}: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open || !closeOnEscape) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, closeOnEscape, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${OVERLAY_ANIM}`}
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{ maxHeight }}
        className={`relative w-full ${SIZE_CLASS[size]} ${PANEL_CLASS[variant]} flex flex-col overflow-hidden ${PANEL_ANIM} ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

export interface ModalHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  icon?: string
  iconClassName?: string
  onClose?: () => void
  closeLabel?: string
  children?: ReactNode
}

/** 可选的统一 header：icon + 标题/副标题 + 右侧关闭按钮 + 自定义操作区 */
export function ModalHeader({
  title,
  subtitle,
  icon,
  iconClassName = 'text-primary',
  onClose,
  closeLabel = '关闭',
  children
}: ModalHeaderProps): JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-black/5 p-4 dark:border-white/10">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <AppIcon name={icon as never} size={20} className={`shrink-0 ${iconClassName}`} />}
        <div className="min-w-0">
          <h3 className="truncate text-title font-semibold text-text-primary">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-caption text-text-secondary">{subtitle}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {children}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
          >
            <AppIcon name="close" size={20} />
          </button>
        )}
      </div>
    </div>
  )
}

export interface ModalFooterProps {
  children: ReactNode
  className?: string
}

/** 可选的统一 footer：上边框 + 按钮区 */
export function ModalFooter({ children, className = '' }: ModalFooterProps): JSX.Element {
  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-t border-black/5 p-4 dark:border-white/10 ${className}`}
    >
      {children}
    </div>
  )
}
