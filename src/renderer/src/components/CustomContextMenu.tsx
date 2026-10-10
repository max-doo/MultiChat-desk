import { useEffect, useState, useCallback, useMemo } from 'react'
import type { ContextMenuItem, WebviewContextMenuData } from '../../../shared/types/contextMenu'

interface ExtendedMenuItem extends ContextMenuItem {
  action?: () => void
}

type ExtendedContextMenuEntry = ExtendedMenuItem | { type: 'separator' }

function isSeparator(entry: ExtendedContextMenuEntry): entry is { type: 'separator' } {
  return 'type' in entry && (entry as { type?: unknown }).type === 'separator'
}

interface MenuState {
  visible: boolean
  x: number
  y: number
  items: ExtendedContextMenuEntry[]
  wcId?: number
}

function isEditableEl(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const cmdOrCtrl = isMac ? '⌘' : 'Ctrl+'

export default function CustomContextMenu(): JSX.Element | null {
  const [menuState, setMenuState] = useState<MenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: []
  })

  const closeMenu = useCallback(() => {
    setMenuState((prev) => (prev.visible ? { ...prev, visible: false } : prev))
  }, [])

  // 1. 监听来自 WebView 的 IPC 上下文菜单事件
  useEffect(() => {
    if (!window.api?.onWebviewContextMenu) return
    const removeListener = window.api.onWebviewContextMenu((data: WebviewContextMenuData) => {
      if (!data.items || data.items.length === 0) return
      setMenuState({
        visible: true,
        x: data.x,
        y: data.y,
        items: data.items,
        wcId: data.wcId
      })
    })
    return removeListener
  }, [])

  // 2. 监听宿主非 WebView DOM 元素的原生右键菜单
  useEffect(() => {
    const handleDomContextMenu = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      if (!target) return
      // 如果发生在 webview 标签内部，交给 webContents 的 context-menu 事件处理
      if (target.closest('webview')) return
      // 如果事件已经被组件阻止（如思维导图画布自定义右键），不显示全局菜单
      if (e.defaultPrevented) return

      const selectionText = window.getSelection()?.toString().trim() || ''
      const editable = isEditableEl(target)
      const linkEl = target.closest('a') as HTMLAnchorElement | null
      const imgEl = target.closest('img') as HTMLImageElement | null

      const items: ExtendedContextMenuEntry[] = []

      if (selectionText || editable) {
        items.push({
          key: 'copy',
          label: '复制',
          icon: 'content_copy',
          shortcut: `${cmdOrCtrl}C`,
          disabled: !selectionText && !editable,
          action: async () => {
            if (selectionText) {
              await navigator.clipboard.writeText(selectionText)
              return
            }
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
              const start = target.selectionStart ?? 0
              const end = target.selectionEnd ?? target.value.length
              const text = start !== end ? target.value.slice(start, end) : target.value
              if (text) await navigator.clipboard.writeText(text)
              return
            }
            const text = target.innerText || target.textContent || ''
            if (text) await navigator.clipboard.writeText(text)
          }
        })
      }

      if (editable) {
        if (items.length > 0) items.push({ type: 'separator' })
        items.push({
          key: 'cut',
          label: '剪切',
          icon: 'content_cut',
          shortcut: `${cmdOrCtrl}X`,
          action: () => {
            document.execCommand('cut')
          }
        })
        items.push({
          key: 'paste',
          label: '粘贴',
          icon: 'content_paste',
          shortcut: `${cmdOrCtrl}V`,
          action: async () => {
            try {
              const text = await navigator.clipboard.readText()
              if (!text) return
              if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
                target.focus()
                const start = target.selectionStart ?? target.value.length
                const end = target.selectionEnd ?? target.value.length
                target.setRangeText(text, start, end, 'end')
                target.dispatchEvent(new Event('input', { bubbles: true }))
                return
              }
              if (target.isContentEditable) {
                target.focus()
                document.execCommand('insertText', false, text)
              }
            } catch (err) {
              console.error('[ContextMenu] 粘贴失败:', err)
            }
          }
        })
        items.push({
          key: 'select_all',
          label: '全选',
          icon: 'select_all',
          shortcut: `${cmdOrCtrl}A`,
          action: () => {
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
              target.select()
              return
            }
            if (target.isContentEditable) {
              document.execCommand('selectAll')
            }
          }
        })
      }

      if (linkEl?.href) {
        if (items.length > 0) items.push({ type: 'separator' })
        items.push({
          key: 'copy_link',
          label: '复制链接',
          icon: 'link',
          action: () => {
            void navigator.clipboard.writeText(linkEl.href)
          }
        })
      }

      if (imgEl?.src) {
        if (items.length > 0) items.push({ type: 'separator' })
        items.push({
          key: 'save_image',
          label: '图片另存为...',
          icon: 'download',
          action: () => {
            void window.api?.saveImageFromURL?.(imgEl.src)
          }
        })
      }

      if (!items.length) {
        closeMenu()
        return
      }

      e.preventDefault()
      setMenuState({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        items
      })
    }

    document.addEventListener('contextmenu', handleDomContextMenu)
    return () => {
      document.removeEventListener('contextmenu', handleDomContextMenu)
    }
  }, [closeMenu])

  // 3. 点击外部、窗口失焦、按下 Esc 键关闭菜单
  useEffect(() => {
    if (!menuState.visible) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    const handleBlur = (): void => closeMenu()

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('resize', closeMenu)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menuState.visible, closeMenu])

  // 点击菜单项
  const handleItemClick = useCallback(
    (item: ExtendedMenuItem) => {
      if (item.disabled) return
      closeMenu()

      if (item.action) {
        item.action()
        return
      }

      if (menuState.wcId !== undefined) {
        void window.api?.executeWebviewContextMenuAction?.({
          wcId: menuState.wcId,
          actionKey: item.key
        })
      }
    },
    [closeMenu, menuState.wcId]
  )

  // 坐标边界检测
  const menuPosition = useMemo(() => {
    const menuWidth = 208
    const itemHeight = 36
    const separatorHeight = 9
    const estimatedHeight =
      menuState.items.reduce(
        (acc, it) => acc + (isSeparator(it) ? separatorHeight : itemHeight),
        0
      ) + 16

    const left = Math.max(8, Math.min(menuState.x, window.innerWidth - menuWidth - 8))
    const top = Math.max(8, Math.min(menuState.y, window.innerHeight - estimatedHeight - 8))
    return { x: left, y: top }
  }, [menuState.x, menuState.y, menuState.items])

  if (!menuState.visible || !menuState.items.length) return null

  return (
    <>
      {/* 全屏透明捕获遮罩，覆盖在 webview 和 DOM 上，点击任意处关闭菜单 */}
      <div
        className="fixed inset-0 z-40 bg-transparent"
        onMouseDown={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault()
          closeMenu()
        }}
      />

      {/* 自绘上下文菜单浮层 */}
      <div
        className="fixed z-50 w-52 rounded-2xl bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border border-gray-200/80 dark:border-gray-700/80 shadow-float p-1.5 transition-all select-none animate-in fade-in zoom-in-95 duration-100"
        style={{ left: menuPosition.x, top: menuPosition.y }}
        onMouseDown={(e) => e.stopPropagation()}
        role="menu"
      >
        {menuState.items.map((item, idx) => {
          if (isSeparator(item)) {
            return (
              <div
                key={`sep-${idx}`}
                className="my-1 border-t border-gray-100 dark:border-gray-700/60 mx-1"
                role="separator"
              />
            )
          }

          return (
            <button
              key={item.key}
              disabled={item.disabled}
              role="menuitem"
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleItemClick(item)
              }}
              className={`group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs sm:text-sm text-text-primary transition-all duration-150 ${
                item.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-primary/10 hover:text-primary active:scale-[0.98] cursor-pointer'
              }`}
            >
              <span className="material-symbols-outlined text-[18px] text-text-secondary group-hover:text-primary transition-colors shrink-0">
                {item.icon}
              </span>
              <span className="flex-1 text-left font-medium truncate">{item.label}</span>
              {item.shortcut && (
                <span className="text-[11px] font-mono text-text-secondary/60 group-hover:text-primary/70 tracking-wider">
                  {item.shortcut}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
