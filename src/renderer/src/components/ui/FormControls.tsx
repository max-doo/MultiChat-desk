import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode, Ref } from 'react'
import { AppIcon } from '../icons/AppIcon'

/** DESIGN.md 统一输入框样式基准。 */
export const WORKBENCH_INPUT_CLASS =
  'h-9 rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-body text-text-primary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none disabled:bg-slate-100/70 disabled:text-text-secondary/70 dark:border-slate-700/80 dark:bg-slate-800/50 dark:disabled:bg-slate-800/30 dark:focus:bg-slate-800'

export type UiButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type UiButtonSize = 'sm' | 'md'

const BUTTON_VARIANT_CLASS: Record<UiButtonVariant, string> = {
  primary: 'bg-primary text-white hover:opacity-90 shadow-sm',
  secondary:
    'border border-gray-200 bg-sidebar text-text-secondary hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10',
  danger: 'bg-red-600 text-white hover:opacity-90 shadow-sm',
  ghost: 'text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10'
}

const BUTTON_SIZE_CLASS: Record<UiButtonSize, string> = {
  sm: 'h-8 px-3 text-label',
  md: 'h-9 px-4 text-body'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: UiButtonVariant
  size?: UiButtonSize
}

/** 遵循 DESIGN.md 按钮规范的轻量基础按钮。 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANT_CLASS[variant]} ${BUTTON_SIZE_CLASS[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputRef?: Ref<HTMLInputElement>
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  /** 右侧附加节点（如加载指示器或返回按钮），显示在清除按钮之后 */
  trailing?: ReactNode
  clearLabel?: string
  className?: string
  inputClassName?: string
}

/** 统一带搜索图标与一键清除的搜索输入框。 */
export function SearchInput({
  value,
  onChange,
  placeholder = '搜索...',
  inputRef,
  onKeyDown,
  trailing,
  clearLabel = '清空搜索',
  className = '',
  inputClassName = ''
}: SearchInputProps): JSX.Element {
  return (
    <div className={`relative flex items-center ${className}`}>
      <AppIcon
        name="search"
        size={16}
        className="pointer-events-none absolute left-2.5 text-text-secondary"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`h-8 w-full rounded-lg border border-slate-200/80 bg-slate-50/80 pl-8 pr-8 text-label text-text-primary placeholder:text-text-secondary/60 transition-colors focus:border-primary/60 focus:bg-white focus:outline-none dark:border-white/10 dark:bg-white/5 dark:focus:bg-gray-800 ${inputClassName}`}
      />
      {(value || trailing) && (
        <div className="absolute right-1.5 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex h-5 w-5 items-center justify-center rounded-full text-text-secondary hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
              title={clearLabel}
              aria-label={clearLabel}
            >
              <AppIcon name="close" size={12} />
            </button>
          )}
          {trailing}
        </div>
      )}
    </div>
  )
}

export type StatusBannerTone = 'error' | 'success' | 'warning' | 'info'

const BANNER_TONE_CLASS: Record<StatusBannerTone, string> = {
  error: 'bg-rose-500 text-white',
  success: 'bg-emerald-500 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-primary text-white'
}

const BANNER_TONE_ICON: Record<StatusBannerTone, string> = {
  error: 'error',
  success: 'check_circle',
  warning: 'warning',
  info: 'info'
}

export interface StatusBannerProps {
  tone: StatusBannerTone
  message: ReactNode
  onClose?: () => void
  actions?: ReactNode
  showIcon?: boolean
  className?: string
}

/** 顶部悬浮提示条（WorkbenchPage 等共用），统一 z-popover 与圆角/字号规范。 */
export function StatusBanner({
  tone,
  message,
  onClose,
  actions,
  showIcon = true,
  className = ''
}: StatusBannerProps): JSX.Element {
  return (
    <div
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-popover px-4 py-2 rounded-xl shadow-xl flex items-center gap-2 text-label font-medium ${BANNER_TONE_CLASS[tone]} ${className}`}
    >
      {showIcon && <AppIcon name={BANNER_TONE_ICON[tone]} size={16} />}
      <span>{message}</span>
      {actions}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="w-4 h-4 flex items-center justify-center hover:bg-white/20 rounded-full"
          aria-label="关闭提示"
        >
          <AppIcon name="close" size={12} />
        </button>
      )}
    </div>
  )
}
