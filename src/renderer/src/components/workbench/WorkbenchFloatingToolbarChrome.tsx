import type { PointerEventHandler, ReactNode, RefObject } from 'react'
import { AppIcon } from '../icons/AppIcon'

/** 富文本浮动工具条与 HTML 可视化编辑工具条共用的容器外观。 */
export const WORKBENCH_FLOATING_TOOLBAR_BASE_CLASS =
  'flex items-center gap-0.5 p-1 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-black/10 dark:border-white/10'

export function WorkbenchFloatingToolbarButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
  onPointerDown,
  buttonRef,
  children,
  className = ''
}: {
  icon?: string
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  onPointerDown?: PointerEventHandler<HTMLButtonElement>
  buttonRef?: RefObject<HTMLButtonElement>
  children?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors disabled:cursor-default disabled:opacity-35 ${
        active
          ? 'bg-primary/20 text-primary'
          : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
      } ${className}`}
    >
      {icon ? <AppIcon name={icon} size={19} /> : children}
    </button>
  )
}

export function WorkbenchFloatingToolbarDivider(): JSX.Element {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-black/10 dark:bg-white/10" />
}
