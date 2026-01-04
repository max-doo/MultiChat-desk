import { ReactNode, useEffect, useMemo, useState } from 'react'

interface LayoutProps {
  children: ReactNode
}

/**
 * 主布局组件
 * 包含主内容区域
 */
function Layout({ children }: LayoutProps): JSX.Element {
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuX, setMenuX] = useState(0)
  const [menuY, setMenuY] = useState(0)
  const [menuItems, setMenuItems] = useState<Array<{ key: string; label: string; icon?: string; action: () => void }>>([])

  const isEditableEl = (el: HTMLElement | null): boolean => {
    if (!el) return false
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true
    return !!el.isContentEditable
  }

  // 创建复制 action（直接传入目标元素，避免闭包问题）
  const createCopyAction = (target: HTMLElement, selectionText: string) => async (): Promise<void> => {
    console.log('[Layout] 执行复制操作, selectionText:', selectionText?.substring(0, 30))
    // 优先使用选中的文本
    if (selectionText) {
      try {
        await navigator.clipboard.writeText(selectionText)
        console.log('[Layout] 复制选中文本成功')
        return
      } catch (err) {
        console.error('[Layout] 复制失败:', err)
      }
    }
    // 如果是输入框，复制输入框内容
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? 0
      const end = target.selectionEnd ?? target.value.length
      const text = start !== end ? target.value.slice(start, end) : target.value
      if (text) {
        try {
          await navigator.clipboard.writeText(text)
          console.log('[Layout] 复制输入框内容成功')
        } catch (err) {
          console.error('[Layout] 复制失败:', err)
        }
      }
      return
    }
    // 复制元素的文本内容
    const text = target.innerText || target.textContent || ''
    if (text) {
      try {
        await navigator.clipboard.writeText(text)
        console.log('[Layout] 复制元素文本成功')
      } catch (err) {
        console.error('[Layout] 复制失败:', err)
      }
    }
  }

  // 创建粘贴 action（直接传入目标元素，避免闭包问题）
  const createPasteAction = (target: HTMLElement) => async (): Promise<void> => {
    console.log('[Layout] 执行粘贴操作, target:', target.tagName)
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        console.log('[Layout] 剪贴板为空')
        return
      }
      console.log('[Layout] 剪贴板内容:', text.substring(0, 30))
      
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        // 先让输入框获得焦点
        target.focus()
        const start = target.selectionStart ?? target.value.length
        const end = target.selectionEnd ?? target.value.length
        target.setRangeText(text, start, end, 'end')
        target.dispatchEvent(new Event('input', { bubbles: true }))
        console.log('[Layout] 粘贴到输入框成功')
        return
      }
      if (target.isContentEditable) {
        target.focus()
        document.execCommand('insertText', false, text)
        console.log('[Layout] 粘贴到 contenteditable 成功')
      }
    } catch (err) {
      console.error('[Layout] 粘贴失败:', err)
    }
  }

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      const inWebview = !!target.closest('webview')
      if (inWebview) return
      e.preventDefault()
      const selectionText = window.getSelection()?.toString() || ''
      const editable = isEditableEl(target)
      const linkEl = target.closest('a') as HTMLAnchorElement | null
      const imgEl = target.closest('img') as HTMLImageElement | null
      const items: Array<{ key: string; label: string; icon?: string; action: () => void }> = []
      if (selectionText || editable) {
        // 直接传入 target 和 selectionText，避免闭包问题
        items.push({ key: 'copy', label: '复制', icon: 'content_copy', action: createCopyAction(target, selectionText) })
        if (editable) items.push({ key: 'paste', label: '粘贴', icon: 'content_paste', action: createPasteAction(target) })
      }
      if (linkEl?.href) {
        items.push({ key: 'copy_link', label: '复制链接', icon: 'link', action: () => { navigator.clipboard.writeText(linkEl.href) } })
      }
      if (imgEl?.src) {
        items.push({ key: 'save_image', label: '图片另存为...', icon: 'download', action: () => { window.api?.saveImageFromURL?.(imgEl.src) } })
      }
      if (!items.length) {
        setMenuVisible(false)
        return
      }
      const menuWidth = 180
      const menuHeight = 44 * items.length
      const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
      const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8)
      setMenuItems(items)
      setMenuX(x)
      setMenuY(y)
      setMenuVisible(true)
    }
    const close = (): void => setMenuVisible(false)
    document.addEventListener('contextmenu', handler)
    document.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('contextmenu', handler)
      document.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  useEffect(() => {
    console.log('[Layout] 初始化 themed-contextmenu 监听器, electron:', !!window.electron)
    
    const sub = (event: any, payload: {
      x: number; y: number; selectionText?: string; isEditable?: boolean; linkURL?: string; srcURL?: string; hasImageContents?: boolean; mediaType?: string; wcId: number
    }): void => {
      console.log('[Layout] 收到 themed-contextmenu 事件:', payload)
      const items: Array<{ key: string; label: string; icon?: string; action: () => void }> = []
      const editable = !!payload.isEditable
      const hasSelection = !!payload.selectionText
      if (hasSelection || editable) {
        items.push({ key: 'copy', label: '复制', icon: 'content_copy', action: async () => {
          // 直接使用已捕获的选中文本写入剪贴板，这是最可靠的方式
          if (payload.selectionText) {
            try {
              await navigator.clipboard.writeText(payload.selectionText)
              console.log('[Layout] 复制成功')
            } catch (err) {
              console.error('[Layout] 复制失败:', err)
            }
          }
        } })
        if (editable) {
          items.push({ key: 'paste', label: '粘贴', icon: 'content_paste', action: async () => {
            try {
              // 读取剪贴板内容
              const clipText = await navigator.clipboard.readText()
              if (!clipText) {
                console.log('[Layout] 剪贴板为空')
                return
              }
              
              // 找到对应的 webview 元素并执行粘贴
              const webviews = Array.from(document.querySelectorAll('webview')) as Electron.WebviewTag[]
              for (const wv of webviews) {
                // 通过比较 webContentsId 找到目标 webview
                if ((wv as any).getWebContentsId?.() === payload.wcId) {
                  console.log('[Layout] 找到目标 webview, 执行粘贴')
                  // 在 webview 中执行 JavaScript 插入文本
                  await wv.executeJavaScript(`
                    (function() {
                      const clipText = ${JSON.stringify(clipText)};
                      
                      // 查找可编辑元素（优先查找之前有焦点的元素）
                      const editables = document.querySelectorAll(
                        'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [contenteditable=""]'
                      );
                      
                      // 找到可见且可编辑的元素
                      for (const el of editables) {
                        const rect = el.getBoundingClientRect();
                        const isVisible = rect.width > 0 && rect.height > 0;
                        const isDisabled = el.disabled || el.readOnly;
                        
                        if (isVisible && !isDisabled) {
                          el.focus();
                          
                          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                            const start = el.selectionStart || el.value.length;
                            const end = el.selectionEnd || el.value.length;
                            el.setRangeText(clipText, start, end, 'end');
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                          } else {
                            document.execCommand('insertText', false, clipText);
                          }
                          return { success: true };
                        }
                      }
                      return { success: false, error: '未找到可编辑元素' };
                    })();
                  `)
                  return
                }
              }
              console.log('[Layout] 未找到匹配的 webview')
            } catch (err) {
              console.error('[Layout] 粘贴失败:', err)
            }
          } })
        }
      }
      if (payload.linkURL) {
        items.push({ key: 'copy_link', label: '复制链接', icon: 'link', action: () => { navigator.clipboard.writeText(payload.linkURL as string) } })
      }
      if (payload.srcURL && (payload.mediaType === 'image' || payload.hasImageContents)) {
        items.push({ key: 'save_image', label: '图片另存为...', icon: 'download', action: () => {
          window.electron?.ipcRenderer?.invoke('perform-contextmenu-action', { wcId: payload.wcId, action: 'save-image', data: { url: payload.srcURL } })
        } })
      }
      if (!items.length) return
      const menuWidth = 180
      const menuHeight = 44 * items.length
      const x = Math.min(payload.x, window.innerWidth - menuWidth - 8)
      const y = Math.min(payload.y, window.innerHeight - menuHeight - 8)
      setMenuItems(items)
      setMenuX(x)
      setMenuY(y)
      setMenuVisible(true)
    }
    window.electron?.ipcRenderer?.on('themed-contextmenu', sub)
    return () => {
      window.electron?.ipcRenderer?.removeListener('themed-contextmenu', sub)
    }
  }, [])

  const menu = useMemo(() => (
    menuVisible ? (
      <div 
        className="fixed z-50" 
        style={{ left: menuX, top: menuY }}
        onMouseDown={(e) => e.stopPropagation()} // 阻止冒泡，防止触发 document 的 mousedown 关闭菜单
      >
        <div className="min-w-[60px] rounded-xl bg-gray-900/95 backdrop-blur-sm border border-gray-700 shadow-2xl ring-1 ring-primary/30 overflow-hidden">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                console.log('[Layout] 菜单按钮被点击:', item.key)
                setMenuVisible(false)
                item.action()
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:text-white hover:bg-gray-800 focus:outline-none"
            >
              <span className="material-symbols-outlined text-base text-gray-400">{item.icon || ''}</span>
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    ) : null
  ), [menuVisible, menuX, menuY, menuItems])

  return (
    <div className="flex flex-col h-screen bg-background-dark">
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
      {menu}
    </div>
  )
}

export default Layout
