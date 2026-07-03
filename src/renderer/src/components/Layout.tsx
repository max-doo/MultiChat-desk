import { ReactNode, useEffect, useMemo, useState, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import SettingsDrawer from './SettingsDrawer'

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

  // 窗口拖拽状态引用
  const isDraggingRef = useRef(false)
  
  useEffect(() => {
    const handlePointerMove = (_e: PointerEvent) => {
      if (isDraggingRef.current) {
        window.api.windowDragMove()
      }
    }
    
    const handlePointerUp = (_e: PointerEvent) => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        window.api.windowDragEnd()
      }
    }
    
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])
  
  const { displayMode, setDisplayMode, resetPaneRatios, isSettingsOpen, setSettingsOpen, setHistoryOpen, productMode, setProductMode, currentPage, apiConfig, setApiConfig, isNewSession, textInserted, activeModels, debateState } = useAppStore()

  const summarySource: 'api' | 'webview' = apiConfig?.summarySource ?? 'webview'
  const setSummarySource = (next: 'api' | 'webview') => {
    if (apiConfig) {
      setApiConfig({ ...apiConfig, summarySource: next })
    }
  }

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
        items.push({
          key: 'copy', label: '复制', icon: 'content_copy', action: async () => {
            // 直接使用已捕获的选中文本写入剪贴板，这是最可靠的方式
            if (payload.selectionText) {
              try {
                await navigator.clipboard.writeText(payload.selectionText)
                console.log('[Layout] 复制成功')
              } catch (err) {
                console.error('[Layout] 复制失败:', err)
              }
            }
          }
        })
        if (editable) {
          items.push({
            key: 'paste', label: '粘贴', icon: 'content_paste', action: async () => {
              try {
                // 读取剪贴板内容
                const clipText = await navigator.clipboard.readText()
                if (!clipText) {
                  console.log('[Layout] 剪贴板为空')
                  return
                }

                // 请求主进程执行粘贴
                console.log('[Layout] 请求主进程执行粘贴, wcId:', payload.wcId)
                await window.electron?.ipcRenderer?.invoke('perform-contextmenu-action', { wcId: payload.wcId, action: 'paste' })
              } catch (err) {
                console.error('[Layout] 粘贴失败:', err)
              }
            }
          })
        }
      }
      if (payload.linkURL) {
        items.push({ key: 'copy_link', label: '复制链接', icon: 'link', action: () => { navigator.clipboard.writeText(payload.linkURL as string) } })
      }
      if (payload.srcURL && (payload.mediaType === 'image' || payload.hasImageContents)) {
        items.push({
          key: 'save_image', label: '图片另存为...', icon: 'download', action: () => {
            window.electron?.ipcRenderer?.invoke('perform-contextmenu-action', { wcId: payload.wcId, action: 'save-image', data: { url: payload.srcURL } })
          }
        })
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
        <div className="min-w-[60px] rounded-xl bg-sidebar/95 backdrop-blur-sm border border-gray-200 shadow-float overflow-hidden">
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
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:text-primary hover:bg-gray-100 focus:outline-none"
            >
              <span className="material-symbols-outlined text-base text-text-secondary">{item.icon || ''}</span>
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    ) : null
  ), [menuVisible, menuX, menuY, menuItems])

  return (
    <div className="flex flex-col h-screen bg-transparent">
      {/* 自定义标题栏 */}
      <div 
        className="relative h-[38px] w-full shrink-0 grid items-center px-4 drag-region" 
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
        onPointerDown={(e) => {
          // 只在点击 drag-region 且不在 no-drag 内部时触发拖拽
          const target = e.target as HTMLElement
          if (target.closest('.no-drag')) return
          if (target.closest('.drag-region') || target === e.currentTarget) {
            isDraggingRef.current = true
            // Capture pointer to ensure we get pointermove even if mouse leaves window
            const currentTarget = e.currentTarget
            currentTarget.setPointerCapture(e.pointerId)
            window.api.windowDragStart()
          }
        }}
      >
        <div className="flex items-center gap-3 select-none drag-region h-full">
          <div className="flex items-center gap-3 drag-region">
            <img src="./assets/logo.png" alt="logo" className="w-4 h-4 opacity-80" onError={(e) => e.currentTarget.style.display = 'none'} />
            
            {/* 模式选择分段控件 */}
            <div
              className={`flex items-center p-0.5 bg-gray-200/60 dark:bg-gray-700/60 rounded-lg text-xs gap-0.5 no-drag ${currentPage === 'summary' || debateState.phase === 'running' || debateState.phase === 'paused' ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {[
                { key: 'multi_ai', label: '多AI', title: '默认模式：多个平台展示不同AI' },
                { key: 'task_assignment', label: '任务分配', title: '支持多个窗口选择同一个AI分配不同任务' },
                { key: 'debate', label: '辩论', title: '辩论模式：支持2个AI交互对抗' }
              ].map(item => (
                <button
                  key={item.key}
                  type="button"
                  title={item.title}
                  onClick={() => {
                    setProductMode(item.key as any)
                    if (item.key === 'debate') {
                      setDisplayMode('two')
                      resetPaneRatios()
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all duration-200 ${
                    productMode === item.key 
                      ? 'bg-white dark:bg-gray-800 text-primary shadow-xs' 
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/30'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 no-drag">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-primary hover:bg-white/60 rounded-full transition-all duration-200"
              title="设置"
            >
              <span className="material-symbols-outlined text-lg">settings</span>
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-primary hover:bg-white/60 rounded-full transition-all duration-200"
              title="历史记录"
            >
              <span className="material-symbols-outlined text-lg">history</span>
            </button>
          </div>
        </div>

        {/* 居中的窗口布局或总结模式控件 */}
        <div className="flex justify-center drag-region h-full items-center">
          {currentPage === 'main' ? (
            <div 
              className={`flex items-center p-[2px] gap-[2px] glass-panel shadow-soft rounded-full transition-opacity no-drag ${
                productMode === 'debate' ? 'opacity-40 pointer-events-none' : ''
              }`}
              title={productMode === 'debate' ? '辩论模式固定为双窗口' : '切换窗口数量'}
            >
              {['one', 'two', 'three', 'four'].map(mode => {
                const isSessionActive = !isNewSession || textInserted
                let isDisabled = false
                if (isSessionActive && activeModels.length > 0) {
                  const modeCount = mode === 'one' ? 1 : mode === 'two' ? 2 : mode === 'three' ? 3 : 4
                  if (modeCount > activeModels.length) {
                    isDisabled = true
                  }
                }
                return (
                <button
                  key={mode}
                  type="button"
                  disabled={isDisabled}
                  title={isDisabled ? `当前会话锁定了 ${activeModels.length} 个模型，无法增加窗口` : ''}
                  onClick={() => {
                    setDisplayMode(mode as any)
                    resetPaneRatios()
                  }}
                  className={`w-8 h-[22px] flex flex-col items-center justify-center rounded-full transition-all duration-200 border ${displayMode === mode
                      ? 'bg-blue-50/80 text-primary border-blue-200 shadow-sm'
                      : isDisabled ? 'opacity-30 cursor-not-allowed border-transparent text-text-secondary' : 'border-transparent text-text-secondary hover:text-primary hover:bg-white/50'
                    }`}
                >
                  <div className={`w-[18px] h-2.5 border-[1.5px] border-current rounded-[2px] ${mode === 'four' ? 'grid grid-cols-2 grid-rows-2' : mode === 'two' ? 'flex' : mode === 'three' ? 'flex' : ''}`}>
                    {mode === 'two' && <><div className="flex-1 border-r-[1.5px] border-current" /><div className="flex-1" /></>}
                    {mode === 'three' && <><div className="flex-1 border-r-[1.5px] border-current" /><div className="flex-1 border-r-[1.5px] border-current" /><div className="flex-1" /></>}
                    {mode === 'four' && <><div className="border-r-[1.5px] border-b-[1.5px] border-current" /><div className="border-b-[1.5px] border-current" /><div className="border-r-[1.5px] border-current" /><div /></>}
                  </div>
                </button>
              )})}
            </div>
          ) : currentPage === 'summary' ? (
            <div 
              className="flex items-center p-[2px] gap-[2px] glass-panel shadow-soft rounded-full text-xs transition-opacity no-drag"
            >
              <button
                type="button"
                onClick={() => setSummarySource('api')}
                className={`px-3 h-[22px] flex items-center justify-center rounded-full font-medium transition-all duration-200 border ${
                  summarySource === 'api' 
                    ? 'bg-blue-50/80 text-primary border-blue-200 shadow-sm' 
                    : 'border-transparent text-text-secondary hover:text-primary hover:bg-white/50'
                }`}
              >
                API
              </button>
              <button
                type="button"
                onClick={() => setSummarySource('webview')}
                className={`px-3 h-[22px] flex items-center justify-center rounded-full font-medium transition-all duration-200 border ${
                  summarySource === 'webview' 
                    ? 'bg-blue-50/80 text-primary border-blue-200 shadow-sm' 
                    : 'border-transparent text-text-secondary hover:text-primary hover:bg-white/50'
                }`}
              >
                Webview
              </button>
            </div>
          ) : null}
        </div>
        
        {/* 预留右侧窗口控件空间，避免点击冲突 */}
        <div className="min-w-[120px] drag-region h-full"></div>
      </div>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
      {menu}
      <SettingsDrawer isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default Layout
