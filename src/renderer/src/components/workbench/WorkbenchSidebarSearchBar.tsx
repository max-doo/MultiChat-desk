import { forwardRef, type InputHTMLAttributes } from 'react'
import { AppIcon } from '../icons/AppIcon'

interface WorkbenchSidebarSearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  isLoading?: boolean
  onClose?: () => void
  closeLabel?: string
  className?: string
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder' | 'type'> & {
    'data-workbench-search-input'?: boolean
  }
}

/** 侧边栏（文件搜索 / 全部标注 / 历史记录）共用的顶部搜索框。 */
const WorkbenchSidebarSearchBar = forwardRef<HTMLInputElement, WorkbenchSidebarSearchBarProps>(
  function WorkbenchSidebarSearchBar(
    {
      value,
      onChange,
      placeholder,
      isLoading = false,
      onClose,
      closeLabel = '关闭',
      className = 'p-2 pb-1.5 shrink-0',
      inputProps
    },
    ref
  ): JSX.Element {
    const { className: extraInputClassName, ...restInputProps } = inputProps ?? {}
    const hasRightSlot = Boolean(isLoading || onClose)
    return (
      <div className={className}>
        <div className="relative flex items-center">
          <AppIcon
            name="search"
            size={19}
            className="text-text-secondary absolute left-2 pointer-events-none"
          />
          <input
            ref={ref}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`w-full h-8 pl-8 ${hasRightSlot ? 'pr-9' : 'pr-3'} rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-primary/40 focus:bg-white dark:focus:bg-gray-800 text-text-primary text-body placeholder:text-text-secondary/60 focus:outline-none transition-all ${extraInputClassName ?? ''}`}
            {...restInputProps}
          />
          {hasRightSlot && (
            <div className="absolute right-1.5 flex items-center gap-1">
              {isLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : null}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10"
                  title={closeLabel}
                  aria-label={closeLabel}
                >
                  <AppIcon name="close" size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
)

export default WorkbenchSidebarSearchBar
