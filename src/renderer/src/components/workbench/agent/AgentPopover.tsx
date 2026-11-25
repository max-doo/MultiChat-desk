import { useEffect, useRef } from 'react'

export interface AgentPopoverProps {
  open: boolean
  onClose: () => void
  align?: 'left' | 'right'
  /** 弹出方向：top 在触发器上方（默认，用于底部 Composer）；bottom 在触发器下方（用于顶栏） */
  placement?: 'top' | 'bottom'
  className?: string
  children: React.ReactNode
}

/**
 * 统一的 Agent 弹窗组件容器
 * 锚定在触发选择器上方或下方弹出，具备统一的圆角、阴影、层级和点击外部/Esc 关闭
 */
export function AgentPopover({
  open,
  onClose,
  align = 'right',
  placement = 'top',
  className = '',
  children
}: AgentPopoverProps): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const positionClass = placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-2'

  return (
    <>
      {/* 外部遮罩：点击外部区域关闭 */}
      <div
        className="fixed inset-0 z-popover"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      />
      {/* 弹窗实体 */}
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        className={`absolute ${positionClass} ${
          align === 'left' ? 'left-0' : 'right-0'
        } rounded-xl border border-slate-200/90 bg-white shadow-xl z-popover overflow-hidden text-label dark:border-white/10 dark:bg-gray-800 ${className}`}
      >
        {children}
      </div>
    </>
  )
}
