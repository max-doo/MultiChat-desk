import { useState, useEffect, useRef, Fragment } from 'react'
import type React from 'react'

/**
 * 自定义下拉菜单组件的选项类型
 */
export interface DropdownOption<T = string> {
  value: T
  label: string
  logo?: string // 可选的 logo 属性
  description?: string // 可选的描述
  [key: string]: unknown // 允许额外的属性
}

/**
 * 自定义下拉菜单组件 Props
 */
interface CustomDropdownProps<T = string> {
  /** 选项列表 */
  options?: DropdownOption<T>[]
  /** 当前选中的值 */
  value: T | null
  /** 选择改变时的回调 */
  onChange: (value: T) => void
  /** 占位符文本 */
  placeholder?: string
  /** 标签文本 */
  label?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义样式类名 */
  className?: string
  /** 下拉菜单宽度，默认为 'w-full' */
  dropdownWidth?: string
  /** 下拉方向：'down' (默认) 或 'up' */
  direction?: 'down' | 'up'
  /** 自定义按钮样式类名 */
  buttonClassName?: string
  /** 自定义渲染选项内容，如果提供则忽略 options。接收关闭函数作为参数 */
  renderContent?: (onClose: () => void) => React.ReactNode
  /** 自定义渲染单个选项，如果提供则使用此函数渲染选项 */
  renderOption?: (option: DropdownOption<T>, isSelected: boolean, onSelect: () => void) => React.ReactNode
  /** 显示文本，如果不提供则从 options 中查找 */
  displayText?: string
  /** 自定义渲染按钮内容，如果提供则使用此函数渲染按钮内部内容 */
  renderButton?: () => React.ReactNode
}

/**
 * 自定义下拉菜单组件
 * 参照 WebviewCard 中的下拉菜单样式实现
 */
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
  renderButton
}: CustomDropdownProps<T>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 获取当前选中项的显示文本
  const selectedOption = options.find(opt => opt.value === value)
  const displayText = customDisplayText || selectedOption?.label || placeholder

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleSelect = (optionValue: T): void => {
    onChange(optionValue)
    setIsOpen(false)
  }

  // 下拉菜单的位置类名
  const dropdownPositionClass = direction === 'up'
    ? 'bottom-full mb-2'
    : 'top-full mt-1'

  // 默认按钮样式
  const defaultButtonClass = `w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary text-sm focus:outline-none flex items-center justify-between hover:bg-gray-100 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''
    }`

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* 标签 */}
      {label && (
        <label className="block text-xs text-text-secondary mb-1">{label}</label>
      )}

      {/* 下拉选择按钮 */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={buttonClassName || defaultButtonClass}
      >
        {renderButton ? (
          <>
            {renderButton()}
            <span className="material-symbols-outlined text-base text-text-secondary">
              {isOpen ? (direction === 'up' ? 'expand_more' : 'expand_less') : (direction === 'up' ? 'expand_less' : 'expand_more')}
            </span>
          </>
        ) : (
          <>
            <span>{displayText}</span>
            <span className="material-symbols-outlined text-base text-text-secondary">
              {isOpen ? (direction === 'up' ? 'expand_more' : 'expand_less') : (direction === 'up' ? 'expand_less' : 'expand_more')}
            </span>
          </>
        )}
      </button>

      {/* 下拉菜单 */}
      {isOpen && !disabled && (
        <>
          {/* 点击外部关闭的遮罩层 */}
          <div
            className="fixed inset-0 z-20"
            onClick={() => setIsOpen(false)}
          />
          <div className={`absolute ${dropdownPositionClass} left-0 ${dropdownWidth} bg-sidebar border border-gray-200 rounded-lg shadow-xl z-30 py-1 max-h-64 overflow-y-auto`}>
            {renderContent ? (
              // 使用自定义内容渲染，传入关闭函数
              renderContent(() => setIsOpen(false))
            ) : options.length > 0 ? (
              // 使用选项列表渲染
              options.map((option) => {
                const isSelected = option.value === value
                if (renderOption) {
                  // 使用自定义选项渲染函数
                  return (
                    <Fragment key={String(option.value)}>
                      {renderOption(option, isSelected, () => handleSelect(option.value))}
                    </Fragment>
                  )
                } else {
                  // 默认选项渲染
                  return (
                    <button
                      key={String(option.value)}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-100 transition-colors text-left"
                    >
                      <span className={`text-sm ${isSelected ? 'text-primary' : 'text-text-secondary'}`}>
                        {option.label}
                      </span>
                      {isSelected && (
                        <span className="material-symbols-outlined text-primary text-sm ml-auto">check</span>
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

