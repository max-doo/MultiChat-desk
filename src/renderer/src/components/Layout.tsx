import { ReactNode, useEffect, useRef, useState } from 'react'
import { useAppStore, ProductMode, DisplayMode } from '../store/appStore'
import { useUpdateReminder } from '../hooks/useUpdateState'
import SettingsDrawer from './SettingsDrawer'
import CustomContextMenu from './CustomContextMenu'

interface LayoutProps {
  children: ReactNode
}

/**
 * 主布局组件
 * 包含主内容区域
 */
function Layout({ children }: LayoutProps): JSX.Element {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)

  const { displayMode, setDisplayMode, resetPaneRatios, isSettingsOpen, setSettingsOpen, setHistoryOpen, setHistoryInitialTab, productMode, setProductMode, currentPage, setCurrentPage, isNewSession, textInserted, activeModels, debateState } = useAppStore()
  const { hasUpdate } = useUpdateReminder()
  const isFallbackDraggingRef = useRef(false)
  const dragFrameRef = useRef<number | null>(null)
  const dragMovePendingRef = useRef(false)

  useEffect(() => {
    if (window.api.platform === 'darwin') return

    const flushDragMove = () => {
      dragFrameRef.current = null
      dragMovePendingRef.current = false
      if (isFallbackDraggingRef.current) {
        window.api.windowDragMove()
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (isFallbackDraggingRef.current && (event.buttons & 1) === 0) {
        handlePointerEnd()
        return
      }
      if (!isFallbackDraggingRef.current || dragMovePendingRef.current) return
      dragMovePendingRef.current = true
      dragFrameRef.current = window.requestAnimationFrame(flushDragMove)
    }

    const handlePointerEnd = () => {
      if (!isFallbackDraggingRef.current) return
      isFallbackDraggingRef.current = false
      dragMovePendingRef.current = false
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
        window.api.windowDragMove()
      }
      window.api.windowDragEnd()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('lostpointercapture', handlePointerEnd)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('lostpointercapture', handlePointerEnd)
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
      }
      if (isFallbackDraggingRef.current) {
        window.api.windowDragEnd()
      }
      isFallbackDraggingRef.current = false
      dragMovePendingRef.current = false
      dragFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    if (window.api.platform !== 'win32') return

    const updateMaximizedState = () => {
      const tolerance = 2
      setIsWindowMaximized(
        window.outerWidth >= window.screen.availWidth - tolerance
        && window.outerHeight >= window.screen.availHeight - tolerance
      )
    }

    updateMaximizedState()
    window.addEventListener('resize', updateMaximizedState)
    return () => window.removeEventListener('resize', updateMaximizedState)
  }, [])


  return (
    <div className="flex flex-col h-screen bg-transparent">
      {/* 自定义标题栏 */}
      <div 
        className={`${window.api.platform === 'darwin' ? 'mac-titlebar' : ''} relative h-[38px] w-full shrink-0 grid items-center px-4 drag-region`}
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
        onPointerDown={(event) => {
          if (window.api.platform === 'darwin' || event.button !== 0 || isFallbackDraggingRef.current) return
          const target = event.target as HTMLElement
          if (target.closest('.no-drag, button, a, input, select, textarea')) return

          // Windows/Linux 由 PointerCapture + IPC 负责拖动；macOS 使用原生 app-region。
          isFallbackDraggingRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          window.api.windowDragStart()
        }}
        onDoubleClick={(event) => {
          if (window.api.platform !== 'win32') return
          const target = event.target as HTMLElement
          if (target.closest('.no-drag, button, a, input, select, textarea')) return
          window.api.maximizeWindow()
        }}
      >
        <div className="relative z-10 flex items-center gap-3 select-none drag-region h-full">
          {currentPage === 'notes' ? (
            <button type="button" className="no-drag flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-text-primary hover:bg-white/70" onClick={() => setCurrentPage('main')} aria-label="返回主页面">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
              <span>返回主页面</span>
            </button>
          ) : <>
          <div className="flex items-center gap-3 drag-region">
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
                    setProductMode(item.key as ProductMode)
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
              className="relative h-7 px-2 flex items-center justify-center gap-1 text-text-secondary hover:text-primary hover:bg-white/60 rounded-lg transition-all duration-200"
              title="设置"
            >
              <span className="material-symbols-outlined text-base">settings</span>
              <span className="text-xs font-normal">设置</span>
              {hasUpdate && <span className="absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-red-500 ring-2 ring-white/80" />}
            </button>
            <button
              type="button"
              onClick={() => {
                // 总结页打开历史时自动定位到"总结历史" Tab
                setHistoryInitialTab(currentPage === 'summary' ? 'summary' : 'conversation')
                setHistoryOpen(true)
              }}
              className="h-7 px-2 flex items-center justify-center gap-1 text-text-secondary hover:text-primary hover:bg-white/60 rounded-lg transition-all duration-200"
              title="历史记录"
            >
              <span className="material-symbols-outlined text-base">history</span>
              <span className="text-xs font-normal">历史</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage('notes')}
              className="h-7 px-2 flex items-center justify-center gap-1 rounded-lg transition-all duration-200 text-text-secondary hover:text-primary hover:bg-white/60"
              title="笔记"
            >
              <span className="material-symbols-outlined text-base">edit_note</span>
              <span className="text-xs font-normal">笔记</span>
            </button>
          </div>
          </>}
        </div>

        {/* 居中的窗口布局或总结模式控件 */}
        <div className="relative z-10 flex justify-center drag-region h-full items-center">
          {currentPage === 'main' && productMode !== 'debate' ? (
            <div 
              className="flex items-center p-[2px] gap-[2px] glass-panel shadow-soft rounded-full transition-opacity no-drag"
              title="切换窗口数量"
            >
              {((productMode === 'task_assignment' ? ['two', 'three', 'four'] : ['one', 'two', 'three', 'four']) as DisplayMode[]).map(mode => {
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
                    setDisplayMode(mode)
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
          ) : null}
        </div>
        
        {window.api.platform === 'win32' ? (
          <div className="relative z-20 -mr-4 flex h-full min-w-[138px] items-stretch justify-end drag-region">
            <button
              type="button"
              aria-label="最小化窗口"
              title="最小化"
              onClick={() => window.api.minimizeWindow()}
              className="flex w-[46px] items-center justify-center text-text-secondary transition-colors hover:bg-black/10 hover:text-text-primary"
            >
              <span className="material-symbols-outlined text-[17px]">remove</span>
            </button>
            <button
              type="button"
              aria-label={isWindowMaximized ? '还原窗口' : '最大化窗口'}
              title={isWindowMaximized ? '还原' : '最大化'}
              onClick={() => window.api.maximizeWindow()}
              className="flex w-[46px] items-center justify-center text-text-secondary transition-colors hover:bg-black/10 hover:text-text-primary"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isWindowMaximized ? 'filter_none' : 'crop_square'}
              </span>
            </button>
            <button
              type="button"
              aria-label="关闭窗口"
              title="关闭"
              onClick={() => window.api.closeWindow()}
              className="flex w-[46px] items-center justify-center text-text-secondary transition-colors hover:bg-red-500 hover:text-white"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ) : (
          <div className="relative z-10 min-w-[120px] drag-region h-full" />
        )}
      </div>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
      <CustomContextMenu />
      <SettingsDrawer isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default Layout
