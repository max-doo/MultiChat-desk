import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'

interface WorkbenchFooterPopoverProps {
  anchorRef: { current: HTMLElement | null }
  onRequestClose: () => void
  children: ReactNode
  ariaLabel: string
  /** 存在二级右键菜单或确认弹窗时暂停外部点击与 Esc 关闭，避免底层浮层先一步消失 */
  disableDismiss?: boolean
  /**
   * 内容区固定高度（px）。不传时弹层高度随内容伸缩（原有行为）；
   * 传入后弹层高度固定为该值 + 触发器间隙，并在窗口变矮时自动压缩。
   */
  contentHeight?: number
}

export default function WorkbenchFooterPopover({
  anchorRef,
  onRequestClose,
  children,
  ariaLabel,
  disableDismiss = false,
  contentHeight
}: WorkbenchFooterPopoverProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [bottom, setBottom] = useState<number | null>(null)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  // 弹层宽度跟随左侧边栏，拖动分隔条时实时贴合
  const leftPaneWidth = useWorkbenchStore((s) => s.leftPaneWidth)

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    setBottom(window.innerHeight - rect.top + 4)
    setViewportHeight(window.innerHeight)
  }, [anchorRef])

  useEffect(() => {
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [updatePosition])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (disableDismiss) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (target instanceof Element && target.closest('[data-footer-popover-portal="true"]')) return
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onRequestClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (disableDismiss) return
      if (event.key === 'Escape') onRequestClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, disableDismiss, onRequestClose])

  if (bottom === null) return null

  // 弹层宽度与左侧边栏一致，左右各留 4px 呼吸缝，形成"从侧栏浮起"的一体感
  const inset = 4
  const width = Math.max(200, Math.min(leftPaneWidth - inset * 2, window.innerWidth - inset * 2))
  // 内容区可用高度上限：视口减去触发器占用的底部距离，再留 8px 顶边距
  const maxContentHeight = Math.max(120, viewportHeight - bottom - 8)
  // 窗口过矮时允许压缩到 maxContentHeight，保证弹层不超出视口顶部
  const resolvedContentHeight =
    contentHeight === undefined ? undefined : Math.min(contentHeight, maxContentHeight)

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      style={{ left: inset, bottom, width }}
      className="fixed z-popover flex max-h-[min(720px,calc(100vh-32px))] flex-col overflow-hidden liquid-glass-modal rounded-xl text-body"
    >
      {resolvedContentHeight === undefined ? (
        children
      ) : (
        <div className="flex min-h-0 flex-col" style={{ height: resolvedContentHeight }}>
          {children}
        </div>
      )}
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
    <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5" title={subtitle ? `${title} ${subtitle}` : title}>
        <span className="shrink-0 text-body font-semibold text-text-primary">{title}</span>
        {subtitle && <span className="min-w-0 truncate text-caption text-text-secondary">{subtitle}</span>}
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
