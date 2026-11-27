import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface AgentPopoverProps {
  open: boolean
  onClose: () => void
  align?: 'left' | 'right'
  /** 弹出方向：top 在触发器上方（默认，用于底部 Composer）；bottom 在触发器下方（用于顶栏） */
  placement?: 'top' | 'bottom'
  className?: string
  children: React.ReactNode
}

const VIEWPORT_PADDING = 12

interface ClippingBounds {
  left: number
  right: number
  top: number
  bottom: number
  containers: HTMLElement[]
}

/**
 * 向上遍历祖先元素，收集所有会产生裁剪的容器（overflow 非 visible）并与视口取交集，
 * 作为弹窗不得溢出的安全边界。
 */
function getClippingBounds(el: HTMLElement): ClippingBounds {
  let left = 0
  let right = window.innerWidth
  let top = 0
  let bottom = window.innerHeight
  const containers: HTMLElement[] = []

  let cur = el.parentElement
  while (cur && cur !== document.documentElement) {
    const style = window.getComputedStyle(cur)
    const clipsX = /(hidden|clip|auto|scroll)/.test(style.overflowX)
    const clipsY = /(hidden|clip|auto|scroll)/.test(style.overflowY)
    if (clipsX || clipsY) {
      const r = cur.getBoundingClientRect()
      if (clipsX) {
        left = Math.max(left, r.left)
        right = Math.min(right, r.right)
      }
      if (clipsY) {
        top = Math.max(top, r.top)
        bottom = Math.min(bottom, r.bottom)
      }
      containers.push(cur)
    }
    cur = cur.parentElement
  }

  return {
    left: left + VIEWPORT_PADDING,
    right: right - VIEWPORT_PADDING,
    top: top + VIEWPORT_PADDING,
    bottom: bottom - VIEWPORT_PADDING,
    containers
  }
}

/**
 * 统一的 Agent 弹窗组件容器
 * 锚定在触发选择器上方或下方弹出，具备统一的圆角、阴影、层级、点击外部/Esc 关闭以及可视区域防溢出纠偏
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
  const [positioned, setPositioned] = useState(false)

  useEffect(() => {
    if (!open) {
      setPositioned(false)
      return
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useLayoutEffect(() => {
    if (!open) return
    const el = popoverRef.current
    if (!el) return

    let observedContainers: HTMLElement[] = []

    const clampPosition = (): void => {
      el.style.translate = ''
      el.style.maxWidth = ''
      el.style.maxHeight = ''
      el.style.overflowY = ''

      const bounds = getClippingBounds(el)
      observedContainers = bounds.containers

      const availableWidth = Math.max(120, bounds.right - bounds.left)
      el.style.maxWidth = `${Math.floor(availableWidth)}px`

      let rect = el.getBoundingClientRect()

      if (placement === 'top' && rect.top < bounds.top) {
        const availHeight = Math.max(120, rect.bottom - bounds.top)
        el.style.maxHeight = `${Math.floor(availHeight)}px`
        el.style.overflowY = 'auto'
        rect = el.getBoundingClientRect()
      } else if (placement === 'bottom' && rect.bottom > bounds.bottom) {
        const availHeight = Math.max(120, bounds.bottom - rect.top)
        el.style.maxHeight = `${Math.floor(availHeight)}px`
        el.style.overflowY = 'auto'
        rect = el.getBoundingClientRect()
      }

      let shiftX = 0
      if (rect.left < bounds.left) {
        shiftX = bounds.left - rect.left
      } else if (rect.right > bounds.right) {
        shiftX = bounds.right - rect.right
      }
      if (shiftX !== 0) {
        if (rect.left + shiftX < bounds.left) {
          shiftX = bounds.left - rect.left
        }
        // 使用独立 CSS translate 属性避免与入场动画的 transform: scale() 互相覆盖
        el.style.translate = `${Math.round(shiftX)}px 0`
      }
    }

    clampPosition()
    setPositioned(true)

    const ro = new ResizeObserver(() => {
      clampPosition()
    })
    ro.observe(el)
    for (const container of observedContainers) {
      ro.observe(container)
    }
    window.addEventListener('resize', clampPosition)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', clampPosition)
    }
  }, [open, align, placement])

  if (!open) return null

  const positionClass = placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-2'

  return (
    <>
      <div
        className="fixed inset-0 z-popover"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      />
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        className={`absolute ${positionClass} ${
          align === 'left' ? 'left-0' : 'right-0'
        } liquid-glass-menu rounded-xl z-popover overflow-hidden text-label ${
          positioned
            ? placement === 'top'
              ? align === 'right'
                ? 'context-menu-animate context-menu-animate-up context-menu-origin-bottom-right'
                : 'context-menu-animate context-menu-animate-up'
              : align === 'right'
                ? 'context-menu-animate context-menu-origin-top-right'
                : 'context-menu-animate'
            : ''
        } ${className}`}
      >
        {children}
      </div>
    </>
  )
}
