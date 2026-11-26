import { useEffect, useState, useCallback, useMemo } from 'react'
import type {
  ContextMenuItem,
  WebviewContextMenuData,
  WorkbenchHtmlContextMenuData
} from '../../../shared/types/contextMenu'
import { WORKBENCH_HTML_ANNOTATION_EVENT } from '../../../shared/types/htmlAnnotations'
import { useWorkbenchStore } from '../store/workbenchStore'
import { useAgentSessionStore } from '../store/agentSessionStore'
import { captureContextOf } from '../utils/annotationCaptureContext'
import { AppIcon } from './icons/AppIcon'
import { requestAskWebview, requestSendImageToAi } from './workbench/workbenchAiEvents'

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
  workbenchStyle?: boolean
}

function isEditableEl(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const cmdOrCtrl = isMac ? '⌘' : 'Ctrl+'

/**
 * 右键"复制图片"的通用实现：
 * - ClipboardItem 只可靠支持 PNG/JPEG，BMP/WebP 等先经 canvas 转成 PNG 再写。
 * - workbench-file:// 与 blob: 对主进程不可见，必须在渲染层完成复制。
 */
async function copyImageElementToClipboard(img: HTMLImageElement): Promise<void> {
  const blob = await fetch(img.src).then((res) => {
    if (!res.ok) throw new Error(`下载失败: ${res.status}`)
    return res.blob()
  })

  const writePngBlob = async (png: Blob): Promise<void> => {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  }

  if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return
  }

  // 非 PNG/JPEG（如 docx 内嵌 BMP）：canvas 转 PNG 再写剪贴板
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 canvas 上下文')
    ctx.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('图片转码失败')
    await writePngBlob(png)
  } finally {
    bitmap.close()
  }
}

function appendWorkbenchAiItems(
  items: ExtendedContextMenuEntry[],
  selectedText: string
): void {
  const askAi = useWorkbenchStore.getState().askAi
  items.push(
    {
      key: 'ask_ai',
      label: '向 AI 提问',
      icon: 'chat',
      color: 'text-blue-500',
      action: () => askAi(selectedText, 'ask')
    },
    {
      key: 'explain_ai',
      label: '解释此内容',
      icon: 'psychology',
      color: 'text-purple-500',
      action: () => askAi(selectedText, 'explain')
    },
    {
      key: 'polish_ai',
      label: '语言润色',
      icon: 'auto_fix_high',
      color: 'text-emerald-500',
      action: () => askAi(selectedText, 'polish')
    },
    {
      key: 'summarize_ai',
      label: '提取关键要点',
      icon: 'format_list_bulleted',
      color: 'text-cyan-500',
      action: () => askAi(selectedText, 'summarize')
    }
  )
}

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
      // 摘录为文档会落到工作台工作区，只有工作台内的 AI webview 才有上下文；
      // 其他宿主（多 AI 视图、快捷窗口）下隐藏，避免用户找不到文档落点。
      const items =
        captureContextOf(data.wcId) !== 'workbench'
          ? data.items.filter((entry) => !('key' in entry && entry.key === 'excerpt'))
          : data.items
      if (items.length === 0) return
      setMenuState({
        visible: true,
        x: data.x,
        y: data.y,
        items,
        wcId: data.wcId
      })
    })
    return removeListener
  }, [])

  // 2. HTML 预览 iframe 的右键选区由主进程转发，iframe 事件不会冒泡到宿主 DOM
  useEffect(() => {
    if (!window.api?.workbench?.onHtmlContextMenu) return
    const removeListener = window.api.workbench.onHtmlContextMenu(
      (data: WorkbenchHtmlContextMenuData) => {
        const selectedText = data.selectedText.trim()
        const image = data.image
        if (!selectedText && !image) return

        const items: ExtendedContextMenuEntry[] = []
        if (selectedText && !useWorkbenchStore.getState().htmlVisualEditing) {
          items.push({
            key: 'annotate',
            label: '标注',
            icon: 'annotation',
            color: 'text-amber-500',
            action: () => {
              window.dispatchEvent(new CustomEvent(WORKBENCH_HTML_ANNOTATION_EVENT))
            }
          })
          items.push({ type: 'separator' })
        }
        if (selectedText) {
          appendWorkbenchAiItems(items, selectedText)
          items.push({ type: 'separator' })
          items.push({
            key: 'copy',
            label: '复制',
            icon: 'content_copy',
            shortcut: `${cmdOrCtrl}C`,
            action: async () => {
              await navigator.clipboard.writeText(selectedText)
            }
          })
        }
        if (image?.srcURL) {
          if (items.length) items.push({ type: 'separator' })
          items.push({
            key: 'send_image_to_ai',
            label: '发送到 AI 侧边栏',
            icon: 'send',
            color: 'text-blue-500',
            action: () => {
              requestSendImageToAi({ srcURL: image.srcURL })
            }
          })
          items.push({
            key: 'copy_image',
            label: '复制图片',
            icon: 'image',
            action: async () => {
              await window.api?.workbench?.copyHtmlImageAt?.(image.x, image.y)
            }
          })
          items.push({
            key: 'save_image',
            label: '图片另存为...',
            icon: 'download',
            action: () => {
              void window.api?.saveImageFromURL?.(image.srcURL)
            }
          })
        }
        if (!items.length) return
        setMenuState({
          visible: true,
          x: data.x,
          y: data.y,
          items,
          workbenchStyle: true
        })
      }
    )
    return removeListener
  }, [])

  // 3. 监听宿主非 WebView DOM 元素的原生右键菜单
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

      const isWorkbenchEditor = Boolean(target.closest('[data-workbench-editor="true"]'))
      const activeFileCategory = useWorkbenchStore.getState().activeFileCategory
      const isNonCodeWorkbenchEditor = isWorkbenchEditor && activeFileCategory !== 'code'
      if (isNonCodeWorkbenchEditor && selectionText) {
        appendWorkbenchAiItems(items, selectionText)
        items.push({ type: 'separator' })
      }

      // Agent 侧边栏消息区：选中内容可以回填 Agent 输入框，或投到网页平台侧边栏提问。
      // 输入控件（Composer）自身保留剪切/粘贴原生语义，不出现这两项。
      const agentInstanceEl = target.closest('[data-agent-instance]') as HTMLElement | null
      const agentInstance = agentInstanceEl?.dataset.agentInstance
      if (selectionText && !editable && (agentInstance === 'ai' || agentInstance === 'ai2')) {
        items.push({
          key: 'append_to_agent',
          label: '添加到对话',
          icon: 'annotation',
          color: 'text-emerald-500',
          action: () => {
            useAgentSessionStore.getState().appendPromptText(selectionText)
            window.requestAnimationFrame(() => {
              const textarea = agentInstanceEl?.querySelector('textarea')
              if (!(textarea instanceof HTMLTextAreaElement)) return
              textarea.focus()
              textarea.setSelectionRange(textarea.value.length, textarea.value.length)
            })
          }
        })
        items.push({
          key: 'ask_in_webview',
          label: '在侧边聊天中提问',
          icon: 'chat',
          color: 'text-blue-500',
          action: () => {
            requestAskWebview({ text: selectionText, target: agentInstance === 'ai' ? 'ai2' : 'ai' })
          }
        })
        items.push({ type: 'separator' })
      }

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
          key: 'send_image_to_ai',
          label: '发送到 AI 侧边栏',
          icon: 'send',
          color: 'text-blue-500',
          action: () => {
            requestSendImageToAi({ srcURL: imgEl.src })
          }
        })
        items.push({
          key: 'copy_image',
          label: '复制图片',
          icon: 'image',
          action: async () => {
            try {
              if (imgEl.src.startsWith('workbench-file://') && imgEl.naturalWidth > 0) {
                // 走主进程 copyImageAt，保留原图编码
                const rect = imgEl.getBoundingClientRect()
                const x = rect.left + rect.width / 2
                const y = rect.top + rect.height / 2
                const result = await window.api?.workbench?.copyHtmlImageAt?.(x, y)
                if (result?.success) return
              }
              await copyImageElementToClipboard(imgEl)
            } catch (err) {
              console.error('[ContextMenu] 复制图片失败:', err)
            }
          }
        })
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
        items,
        workbenchStyle: isNonCodeWorkbenchEditor
      })
    }

    document.addEventListener('contextmenu', handleDomContextMenu)
    return () => {
      document.removeEventListener('contextmenu', handleDomContextMenu)
    }
  }, [closeMenu])

  // 4. 点击外部、窗口失焦、按下 Esc 键关闭菜单
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
        className={`fixed z-50 select-none animate-in fade-in zoom-in-95 duration-100 ${
          menuState.workbenchStyle
            ? 'min-w-[190px] py-1.5 liquid-glass-menu rounded-xl text-sm'
            : 'w-52 rounded-2xl liquid-glass-menu p-1.5'
        }`}
        style={{ left: menuPosition.x, top: menuPosition.y }}
        onMouseDown={(e) => e.stopPropagation()}
        role="menu"
      >
        {menuState.items.map((item, idx) => {
          if (isSeparator(item)) {
            return (
              <div
                key={`sep-${idx}`}
                className={`my-1 border-t ${
                  menuState.workbenchStyle
                    ? 'border-black/5 dark:border-white/5'
                    : 'border-gray-100 dark:border-gray-700/60 mx-1'
                }`}
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
              className={
                menuState.workbenchStyle
                  ? `group w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary transition-colors ${
                      item.disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer'
                    }`
                  : `group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs sm:text-sm text-text-primary transition-all duration-150 ${
                      item.disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-primary/10 hover:text-primary active:scale-[0.98] cursor-pointer'
                    }`
              }
            >
              <AppIcon
                name={item.icon}
                size={menuState.workbenchStyle ? 19 : 18}
                className={
                  menuState.workbenchStyle
                    ? `shrink-0 ${item.color ?? 'text-text-secondary'}`
                    : 'text-text-secondary group-hover:text-primary transition-colors shrink-0'
                }
              />
              <span className={menuState.workbenchStyle ? 'font-medium' : 'flex-1 text-left font-medium truncate'}>
                {item.label}
              </span>
              {item.shortcut && !menuState.workbenchStyle && (
                <span className="text-caption font-mono text-text-secondary/60 group-hover:text-primary/70 tracking-wider">
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
