import { ReactNode, useEffect, useRef, useState } from 'react'
import { useAppStore, ProductMode, DisplayMode } from '../store/appStore'
import { AppIcon } from './icons/AppIcon'

// 主页面模式切换分段控件中各模式的展示元数据
const PRODUCT_MODE_LABELS: Record<ProductMode, { label: string; title: string }> = {
  multi_ai: { label: '多AI', title: '默认模式：多个平台展示不同AI' },
  task_assignment: { label: '任务分配', title: '支持多个窗口选择同一个AI分配不同任务' },
  debate: { label: '辩论', title: '辩论模式：支持2个AI交互对抗' },
  workbench: { label: '工作台', title: '工作台模式：本地 Markdown 知识库与 AI 深度协同' }
}
import { useWorkbenchStore } from '../store/workbenchStore'
import { useUpdateReminder } from '../hooks/useUpdateState'
import SettingsDrawer from './SettingsDrawer'
import CustomContextMenu from './CustomContextMenu'
import CliAgentHint from './CliAgentHint'

type WindowsCaptionIconName = 'minimize' | 'maximize' | 'restore' | 'close'

function WindowsCaptionIcon({ name }: { name: WindowsCaptionIconName }): JSX.Element {
  if (name === 'minimize') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M0 5h10v1H0z" fill="currentColor" shapeRendering="crispEdges" />
      </svg>
    )
  }

  if (name === 'maximize') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path
          fillRule="evenodd"
          d="M0 0h10v10H0V0Zm1 1v8h8V1H1Z"
          fill="currentColor"
          shapeRendering="crispEdges"
        />
      </svg>
    )
  }

  if (name === 'restore') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        {/* Windows 原生向下还原 (ChromeRestore / 0xE923): 后层窗口仅露出顶边、右边和连接角，不穿透前层窗口内部 */}
        <path
          d="M2 0h8v8h-2v-1h1v-6h-6v1h-1v-2Z"
          fill="currentColor"
          shapeRendering="crispEdges"
        />
        <path
          fillRule="evenodd"
          d="M0 2h8v8H0V2Zm1 1v6h6V3H1Z"
          fill="currentColor"
          shapeRendering="crispEdges"
        />
      </svg>
    )
  }

  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" shapeRendering="crispEdges" />
    </svg>
  )
}

function WorkbenchTopBar(): JSX.Element {
  const workspaceName = useWorkbenchStore((s) => s.workspaceName)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)

  return (
    <div className="flex items-center gap-2 text-xs select-none max-w-[420px] truncate">
      <span className="font-semibold text-text-primary flex items-center gap-1">
        <span>{workspaceName || '工作台'}</span>
      </span>

      {activeFilePath && (
        <>
          <span className="text-text-secondary/50">/</span>
          <span className="text-text-secondary font-mono truncate" title={activeFilePath}>
            {activeFilePath}
          </span>
          {isDirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="未保存" />
          )}
          {saveStatus === 'saving' && (
            <span className="text-xs text-amber-500 font-medium shrink-0">保存中...</span>
          )}
        </>
      )}
    </div>
  )
}

interface LayoutProps {
  children: ReactNode
}

/**
 * 工作台的右侧面板切换：思维导图与 AI 对话互斥，与快捷窗口的侧边栏规则一致。
 * 统一采用与顶栏其他功能按钮一致的尺寸（w-7 h-7）和图标规范（size=16）。
 */
function WorkbenchPaneToggles(): JSX.Element {
  const rightPane = useWorkbenchStore((s) => s.rightPane)
  const openRightPane = useWorkbenchStore((s) => s.openRightPane)
  const closeRightPane = useWorkbenchStore((s) => s.closeRightPane)
  const tone = (active: boolean): string =>
    `w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 no-drag ${
      active
        ? 'text-primary bg-primary/10 hover:bg-primary/15 dark:bg-primary/20 dark:hover:bg-primary/25'
        : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
    }`
  return (
    <>
      <button
        type="button"
        aria-label={rightPane === 'mindmap' ? '收起思维导图' : '打开思维导图'}
        title={rightPane === 'mindmap' ? '收起思维导图' : '打开思维导图'}
        onClick={() => rightPane === 'mindmap' ? closeRightPane() : openRightPane('mindmap')}
        className={tone(rightPane === 'mindmap')}
      >
        <AppIcon name="diagram_flow_horizontal" size={16} />
      </button>
      <button
        type="button"
        aria-label={rightPane === 'annotations' ? '收起标注' : '打开标注'}
        title={rightPane === 'annotations' ? '收起标注' : '打开标注'}
        onClick={() => rightPane === 'annotations' ? closeRightPane() : openRightPane('annotations')}
        className={tone(rightPane === 'annotations')}
      >
        <AppIcon name="sticky_note_2" size={16} />
      </button>
      <button
        type="button"
        aria-label={rightPane === 'ai' ? '收起 AI 侧边栏' : '打开 AI 侧边栏'}
        title={rightPane === 'ai' ? '收起 AI 侧边栏' : '打开 AI 侧边栏'}
        onClick={() => rightPane === 'ai' ? closeRightPane() : openRightPane('ai')}
        className={tone(rightPane === 'ai')}
      >
        <AppIcon name={rightPane === 'ai' ? 'right_panel_close' : 'right_panel_open'} size={16} />
      </button>
    </>
  )
}

/**
 * 主布局组件
 * 包含主内容区域
 */
function Layout({ children }: LayoutProps): JSX.Element {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)

  const { displayMode, setDisplayMode, resetPaneRatios, isSettingsOpen, setSettingsOpen, setHistoryOpen, setHistoryInitialTab, productMode, setProductMode, currentPage, setCurrentPage, isNewSession, textInserted, activeModels, debateState } = useAppStore()
  const productModeConfig = useAppStore((s) => s.productModeConfig)
  const visibleProductModes = productModeConfig.order.filter(m => !productModeConfig.hidden.includes(m))
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


  const entryButtons = (
    <div className="flex items-center gap-1 no-drag">
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className="relative h-7 px-2 flex items-center justify-center gap-1 text-text-secondary hover:text-primary hover:bg-white/60 rounded-lg transition-all duration-200"
        title="设置"
      >
        <AppIcon name="settings" size={16} />
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
        <AppIcon name="history" size={16} />
        <span className="text-xs font-normal">历史</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setProductMode('workbench')
          setCurrentPage('main')
          // 工作台可能尚未挂载，等这一帧渲染完成再派发筛选请求。
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('workbench:filter-conversations'))
          }, 0)
        }}
        className="h-7 px-2 flex items-center justify-center gap-1 rounded-lg transition-all duration-200 text-text-secondary hover:text-primary hover:bg-white/60"
        title="对话资料"
      >
        <AppIcon name="edit_note" size={16} />
        <span className="text-xs font-normal">笔记</span>
      </button>
    </div>
  )

  return (
    <div className="flex flex-col h-screen bg-transparent">
      {/* 自定义标题栏 */}
      <div 
        className={`${window.api.platform === 'darwin' ? 'mac-titlebar' : 'h-[38px] px-4'} relative w-full shrink-0 grid items-center drag-region`}
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
              <AppIcon name="arrow_back" size={18} />
              <span>返回主页面</span>
            </button>
          ) : <>
          <div className="flex items-center gap-3 drag-region">
            {/* 模式选择分段控件 */}
            <div
              className={`flex items-center p-0.5 bg-gray-200/60 dark:bg-gray-700/60 rounded-lg text-xs gap-0.5 no-drag ${currentPage === 'summary' || debateState.phase === 'running' || debateState.phase === 'paused' ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {visibleProductModes.map(mode => {
                const item = { key: mode, ...PRODUCT_MODE_LABELS[mode] }
                return (
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
                )
              })}
            </div>
          </div>
          {window.api.platform !== 'darwin' && entryButtons}
          </>}
        </div>

        {/* 居中的窗口布局或总结模式控件 */}
        <div className="relative z-10 flex justify-center drag-region h-full items-center">
          {productMode === 'workbench' ? (
            <WorkbenchTopBar />
          ) : currentPage === 'main' && productMode !== 'debate' ? (
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
          <div className="relative z-20 -mr-4 flex h-full min-w-[138px] items-center justify-end drag-region">
            {productMode === 'workbench' && (
              <div className="flex items-center gap-1 mr-2 no-drag">
                <WorkbenchPaneToggles />
              </div>
            )}
            <div className="flex h-full items-stretch">
              <button
                type="button"
                aria-label="最小化窗口"
                title="最小化"
                onClick={() => window.api.minimizeWindow()}
                className="flex w-[46px] items-center justify-center text-[#202020] transition-colors duration-100 hover:bg-black/[0.05] active:bg-black/[0.08] dark:text-[#e5e5e5] dark:hover:bg-white/[0.06]"
              >
                <WindowsCaptionIcon name="minimize" />
              </button>
              <button
                type="button"
                aria-label={isWindowMaximized ? '还原窗口' : '最大化窗口'}
                title={isWindowMaximized ? '还原' : '最大化'}
                onClick={() => window.api.maximizeWindow()}
                className="flex w-[46px] items-center justify-center text-[#202020] transition-colors duration-100 hover:bg-black/[0.05] active:bg-black/[0.08] dark:text-[#e5e5e5] dark:hover:bg-white/[0.06]"
              >
                <WindowsCaptionIcon name={isWindowMaximized ? 'restore' : 'maximize'} />
              </button>
              <button
                type="button"
                aria-label="关闭窗口"
                title="关闭"
                onClick={() => window.api.closeWindow()}
                className="flex w-[46px] items-center justify-center text-[#202020] transition-colors duration-100 hover:bg-[#c42b1c] hover:text-white active:bg-[#a52a1e] dark:text-[#e5e5e5]"
              >
                <WindowsCaptionIcon name="close" />
              </button>
            </div>
          </div>
        ) : window.api.platform === 'darwin' ? (
          <div className="relative z-10 min-w-[120px] drag-region h-full flex items-center justify-end gap-1">
            {productMode === 'workbench' && <WorkbenchPaneToggles />}
            {currentPage !== 'notes' && entryButtons}
          </div>
        ) : (
          <div className="relative z-10 min-w-[120px] drag-region h-full flex items-center justify-end gap-1">
            {productMode === 'workbench' && <WorkbenchPaneToggles />}
            {currentPage !== 'notes' && entryButtons}
          </div>
        )}
      </div>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
      <CustomContextMenu />
      <CliAgentHint />
      <SettingsDrawer isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default Layout
