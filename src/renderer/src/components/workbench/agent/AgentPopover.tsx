import { useEffect, useRef } from 'react'

export interface AgentPopoverProps {
  open: boolean
  onClose: () => void
  align?: 'left' | 'right'
  className?: string
  children: React.ReactNode
}

/**
 * 统一的 Agent 输入框弹窗组件容器
 * 锚定在触发选择器上方弹出，具备统一的圆角、阴影、层级和过渡动画
 */
export function AgentPopover({
  open,
  onClose,
  align = 'right',
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
      {/* 弹窗实体：直接位于触发选择器的正上方 */}
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-full mb-2 ${
          align === 'left' ? 'left-0' : 'right-0'
        } rounded-2xl border border-slate-200/90 bg-white shadow-xl z-popover overflow-hidden text-label animate-in fade-in zoom-in-95 duration-100 ${className}`}
      >
        {children}
      </div>
    </>
  )
}
