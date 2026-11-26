import { useState, useEffect, useRef, Fragment } from 'react'
import type React from 'react'
import { AppIcon } from './icons/AppIcon'

export interface DropdownOption<T = string> {
  value: T
  label: string
  logo?: string
  description?: string
  [key: string]: unknown
}

interface CustomDropdownProps<T = string> {
  options?: DropdownOption<T>[]
  value: T | null
  onChange: (value: T) => void
  placeholder?: string
  label?: string
  disabled?: boolean
  className?: string
  dropdownWidth?: string
  direction?: 'down' | 'up'
  buttonClassName?: string
  /** 提供时忽略 options；参数用于关闭菜单。 */
  renderContent?: (onClose: () => void) => React.ReactNode
  renderOption?: (option: DropdownOption<T>, isSelected: boolean, onSelect: () => void) => React.ReactNode
  /** 未提供时按当前 value 从 options 派生显示文本。 */
  displayText?: string
  renderButton?: () => React.ReactNode
  onOpenChange?: (open: boolean) => void
  hideArrow?: boolean
}

function CustomDropdown<T = string>({
  options = [],
  value,
  onChange,
  placeholder = '请选择',
  label,
  disabled = false,
  className = '',
  dropdownWidth = 'w-full',
  direction = 'down',
  buttonClassName = '',
  renderContent,
  renderOption,
  displayText: customDisplayText,
  renderButton,
  onOpenChange,
  hideArrow = false
}: CustomDropdownProps<T>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onOpenChange?.(isOpen)
  }, [isOpen, onOpenChange])

  const selectedOption = options.find(opt => opt.value === value)
  const displayText = customDisplayText || selectedOption?.label || placeholder

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | PointerEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    const handleWindowBlur = (): void => {
      setIsOpen(false)
    }

    const handleResize = (): void => {
      setIsOpen(false)
    }

    if (isOpen) {
      window.addEventListener('pointerdown', handleClickOutside, true)
      window.addEventListener('mousedown', handleClickOutside, true)
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('blur', handleWindowBlur)
      window.addEventListener('resize', handleResize)
    }

    return () => {
      window.removeEventListener('pointerdown', handleClickOutside, true)
      window.removeEventListener('mousedown', handleClickOutside, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('resize', handleResize)
    }
  }, [isOpen])

  const handleSelect = (optionValue: T): void => {
    onChange(optionValue)
    setIsOpen(false)
  }

  const dropdownPositionClass = direction === 'up'
    ? 'bottom-full mb-2'
    : 'top-full mt-1'

  const defaultButtonClass = `w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary text-sm focus:outline-none flex items-center justify-between hover:bg-gray-100 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''
    }`

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {label && (
        <label className="block text-xs text-text-secondary mb-1">{label}</label>
      )}

      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={buttonClassName || defaultButtonClass}
      >
        {renderButton ? (
          <>
            {renderButton()}
            {!hideArrow && (
              <AppIcon name={isOpen ? (direction === 'up' ? 'expand_more' : 'expand_less') : (direction === 'up' ? 'expand_less' : 'expand_more')} size={16} className="text-text-secondary" />
            )}
          </>
        ) : (
          <>
            <span>{displayText}</span>
            {!hideArrow && (
              <AppIcon name={isOpen ? (direction === 'up' ? 'expand_more' : 'expand_less') : (direction === 'up' ? 'expand_less' : 'expand_more')} size={16} className="text-text-secondary" />
            )}
          </>
        )}
      </button>

      {isOpen && !disabled && (
        <>
          <div
            className="fixed inset-0 z-20"
            onPointerDown={() => setIsOpen(false)}
            onClick={() => setIsOpen(false)}
          />
          <div className={`absolute ${dropdownPositionClass} left-0 ${dropdownWidth} liquid-glass-menu rounded-xl z-30 py-1 max-h-64 overflow-y-auto`}>
            {renderContent ? (
              renderContent(() => setIsOpen(false))
            ) : options.length > 0 ? (
              options.map((option) => {
                const isSelected = option.value === value
                if (renderOption) {
                  return (
                    <Fragment key={String(option.value)}>
                      {renderOption(option, isSelected, () => handleSelect(option.value))}
                    </Fragment>
                  )
                } else {
                  return (
                    <button
                      key={String(option.value)}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-left"
                    >
                      <span className={`text-sm ${isSelected ? 'text-primary' : 'text-text-secondary'}`}>
                        {option.label}
                      </span>
                      {isSelected && (
                        <AppIcon name="check" size={14} className="text-primary ml-auto" />
                      )}
                    </button>
                  )
                }
              })
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

export default CustomDropdown

