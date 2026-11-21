import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '../icons/AppIcon'

export const WORKBENCH_FOOTER_POPOVER_WIDTH = 420

interface WorkbenchFooterPopoverProps {
  anchorRef: { current: HTMLElement | null }
  onRequestClose: () => void
  children: ReactNode
  ariaLabel: string
  align?: 'right' | 'left'
}

export default function WorkbenchFooterPopover({
  anchorRef,
  onRequestClose,
  children,
  ariaLabel,
  align = 'right'
}: WorkbenchFooterPopoverProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(WORKBENCH_FOOTER_POPOVER_WIDTH, window.innerWidth - 16)
    const left = align === 'left' ? rect.left : rect.right - width
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      bottom: window.innerHeight - rect.top + 4
    })
  }, [align, anchorRef])

  useEffect(() => {
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [updatePosition])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onRequestClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onRequestClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, onRequestClose])

  if (!position) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      style={{ left: position.left, bottom: position.bottom }}
      className="fixed z-50 flex max-h-[min(720px,calc(100vh-32px))] w-[420px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-black/10 bg-white text-sm shadow-xl animate-in fade-in zoom-in-95 duration-100 dark:border-white/10 dark:bg-gray-800"
    >
      {children}
    </div>,
    document.body
  )
}

export function WorkbenchFooterPopoverHeader({
  title,
  subtitle,
  actions,
  onClose
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  onClose: () => void
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2.5 dark:border-white/5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary" title={title}>
          {title}
        </div>
        {subtitle && (
          <div className="truncate text-[11px] text-text-secondary" title={subtitle}>
            {subtitle}
          </div>
        )}
      </div>
      {actions}
      <button
        type="button"
        onClick={onClose}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
        title="关闭"
      >
        <AppIcon name="close" size={15} />
      </button>
    </div>
  )
}
