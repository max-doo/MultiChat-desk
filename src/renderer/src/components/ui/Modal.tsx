import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '../icons/AppIcon'

export type ModalVariant = 'solid' | 'glass'
export type ModalSize = 'sm' | 'md' | 'lg'
export type ModalBackdrop = 'none' | 'dim'

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg'
}

const PANEL_CLASS: Record<ModalVariant, string> = {
  solid:
    'bg-app border border-gray-200 rounded-xl shadow-2xl dark:border-gray-700 dark:bg-gray-800',
  glass: 'liquid-glass-modal rounded-2xl'
}

const BACKDROP_CLASS: Record<ModalBackdrop, string> = {
  // 保留透明全屏拦截层，避免点击穿透到底层 <webview> 并维持 closeOnBackdrop 语义
  none: 'bg-transparent',
  // 轻量纯色压暗，不使用 backdrop-blur / 透明度动画，避免 Electron 合成器重绘卡顿
  dim: 'bg-black/25'
}

// 仅对弹窗面板做缩放淡入，不对全屏遮罩做淡入动画
const PANEL_ANIM = 'animate-[modal-zoom-in_0.2s_ease-out]'

export interface ModalProps {
  open: boolean
  onClose: () => void
  variant?: ModalVariant
  size?: ModalSize
  /** 背景遮罩模式：默认 'none'（透明拦截层，无视觉遮罩） */
  backdrop?: ModalBackdrop
  /** 点遮罩是否关闭，默认 true */
  closeOnBackdrop?: boolean
  /** Escape 是否关闭，默认 true */
  closeOnEscape?: boolean
  /** 内容区最大高度，默认 85vh */
  maxHeight?: string
  /** 覆盖外层 z-index，默认 z-modal；仅在压在另一个 Modal 之上时传特例并附注释 */
  zIndexClass?: string
  className?: string
  children: ReactNode
}

/**
 * 统一模态弹窗基础组件。
 * - variant 'glass'（默认）：仿液态玻璃（8px 轻模糊 + 高光边缘），所有通用弹窗默认使用
 * - variant 'solid'：实色卡片（仅需要完全不透明背景时显式指定）
 * 只负责事件拦截层/轻量遮罩 + 容器壳 + 层级 + 动画，不约束内部 header/body/footer 结构。
 */
export default function Modal({
  open,
  onClose,
  variant = 'glass',
  size = 'md',
  backdrop,
  closeOnBackdrop = true,
  closeOnEscape = true,
  maxHeight = '85vh',
  zIndexClass = 'z-modal',
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

  const resolvedBackdrop: ModalBackdrop = backdrop ?? 'none'

  return createPortal(
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4`}>
      <div
        className={`absolute inset-0 ${BACKDROP_CLASS[resolvedBackdrop]}`}
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
