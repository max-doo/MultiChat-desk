import * as React from 'react'
import {
  type JSX,
  useLayoutEffect,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

/**
 * 参考 lexical-playground 的 ui/DropDown.tsx 实现的工具栏下拉组件。
 * 关键行为与 playground 保持一致：
 * - 菜单通过 createPortal 挂到 document.body，fixed 定位，不受工具栏 overflow 裁剪
 * - 点击外部 / Esc / Tab 关闭，关闭后焦点还给触发按钮
 * - 打开时自动高亮第一项，支持 ArrowUp/ArrowDown 在菜单项间移动焦点
 */

type WorkbenchDropDownContextType = {
  registerItem: (ref: React.RefObject<HTMLButtonElement | null>) => void
}

const WorkbenchDropDownContext = React.createContext<WorkbenchDropDownContextType | null>(null)

const DROP_DOWN_PADDING = 4
const VIEWPORT_EDGE_PADDING = 8

export function WorkbenchDropDownItem({
  children,
  className,
  onClick,
  title
}: {
  children: ReactNode
  className?: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  title?: string
}): JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null)
  const context = React.useContext(WorkbenchDropDownContext)

  if (context === null) {
    throw new Error('WorkbenchDropDownItem must be used within a WorkbenchDropDown')
  }

  const { registerItem } = context

  useEffect(() => {
    if (ref.current) {
      registerItem(ref)
    }
  }, [registerItem])

  return (
    <button ref={ref} className={className} onClick={onClick} title={title} type="button">
      {children}
    </button>
  )
}

export function WorkbenchDropDownDivider(): JSX.Element {
  return <div className="my-1 border-t border-black/5 dark:border-white/5" />
}

function DropDownItems({
  children,
  dropDownRef,
  onClose,
  isDark = false
}: {
  children: ReactNode
  dropDownRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  isDark?: boolean
}): JSX.Element {
  const [items, setItems] = useState<React.RefObject<HTMLButtonElement | null>[]>()
  const [highlightedItem, setHighlightedItem] =
    useState<React.RefObject<HTMLButtonElement | null>>()

  const registerItem = useCallback(
    (itemRef: React.RefObject<HTMLButtonElement | null>) => {
      setItems((prev) => (prev ? [...prev, itemRef] : [itemRef]))
    },
    [setItems]
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key

    if (['Escape', 'ArrowUp', 'ArrowDown', 'Tab'].includes(key)) {
      event.preventDefault()
    }

    if (key === 'Escape' || key === 'Tab') {
      onClose()
      return
    }
    if (!items) return

    if (key === 'ArrowUp') {
      setHighlightedItem((prev) => {
        if (!prev) return items[0]
        const index = items.indexOf(prev) - 1
        return items[index === -1 ? items.length - 1 : index]
      })
    } else if (key === 'ArrowDown') {
      setHighlightedItem((prev) => {
        if (!prev) return items[0]
        return items[items.indexOf(prev) + 1]
      })
    }
  }

  const contextValue = useMemo(() => ({ registerItem }), [registerItem])

  useEffect(() => {
    if (items && !highlightedItem) {
      setHighlightedItem(items[0])
    }
    if (highlightedItem?.current) {
      highlightedItem.current.focus()
    }
  }, [items, highlightedItem])

  return (
    <WorkbenchDropDownContext.Provider value={contextValue}>
      <div
        ref={dropDownRef as React.RefObject<HTMLDivElement>}
        onKeyDown={handleKeyDown}
        data-reader-dropdown={isDark ? 'dark' : 'light'}
        className={`fixed z-popover py-1 liquid-glass-menu rounded-xl text-body context-menu-animate ${isDark ? 'dark' : ''}`}
        style={{ top: -10000, left: -10000 }}
        role="menu"
      >
        {children}
      </div>
    </WorkbenchDropDownContext.Provider>
  )
}

export default function WorkbenchDropDown({
  disabled = false,
  buttonAriaLabel,
  buttonTitle,
  buttonContent,
  buttonClassName = '',
  isDark = false,
  children
}: {
  disabled?: boolean
  buttonAriaLabel?: string
  buttonTitle?: string
  buttonContent: ReactNode
  buttonClassName?: string
  isDark?: boolean
  children: ReactNode
}): JSX.Element {
  const dropDownRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [showDropDown, setShowDropDown] = useState(false)

  const handleClose = useCallback(() => {
    setShowDropDown(false)
    buttonRef.current?.focus()
  }, [])

  // useLayoutEffect：浏览器绘制前同步完成定位，避免首帧闪现后瞬移的跳动
  useLayoutEffect(() => {
    const button = buttonRef.current
    const dropDown = dropDownRef.current
    if (showDropDown && button !== null && dropDown !== null) {
      const { top, left } = button.getBoundingClientRect()
      dropDown.style.top = `${top + button.offsetHeight + DROP_DOWN_PADDING}px`
      dropDown.style.left = `${Math.max(
        VIEWPORT_EDGE_PADDING,
        Math.min(left, window.innerWidth - dropDown.offsetWidth - VIEWPORT_EDGE_PADDING)
      )}px`
    }
  }, [showDropDown])

  useEffect(() => {
    const button = buttonRef.current
    if (button !== null && showDropDown) {
      const handle = (event: PointerEvent) => {
        const target = event.target
        if (!(target instanceof Node)) return
        if (dropDownRef.current?.contains(target)) return
        if (!button.contains(target)) {
          setShowDropDown(false)
        }
      }
      const doc = button.ownerDocument
      doc.addEventListener('click', handle)
      return () => doc.removeEventListener('click', handle)
    }
  }, [showDropDown])

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={buttonAriaLabel}
        title={buttonTitle}
        className={buttonClassName}
        onClick={() => setShowDropDown((prev) => !prev)}
        ref={buttonRef}
      >
        {buttonContent}
      </button>

      {showDropDown &&
        createPortal(
          <DropDownItems dropDownRef={dropDownRef} onClose={handleClose} isDark={isDark}>
            {children}
          </DropDownItems>,
          buttonRef.current?.ownerDocument?.body ?? document.body
        )}
    </>
  )
}
