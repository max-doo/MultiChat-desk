import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, ProductMode, DisplayMode } from '../store/appStore'
import { AppIcon } from './icons/AppIcon'

// 主页面模式切换分段控件中各模式的展示元数据
const PRODUCT_MODE_LABELS: Record<ProductMode, { label: string; title: string }> = {
  multi_ai: { label: '多AI', title: '默认模式：多个平台展示不同AI' },
  task_assignment: { label: '任务分配', title: '支持多个窗口选择同一个AI分配不同任务' },
  debate: { label: '辩论', title: '辩论模式：支持2个AI交互对抗' },
  workbench: { label: '工作台', title: '工作台模式：本地 Markdown 知识库与 AI 深度协同' }
}
import {
  useWorkbenchStore,
  WORKBENCH_BASE_MIN_LEFT_WIDTH,
  WORKBENCH_MIN_EDITOR_WIDTH
} from '../store/workbenchStore'
import { useUpdateReminder } from '../hooks/useUpdateState'
import CustomContextMenu from './CustomContextMenu'
import CliAgentHint from './CliAgentHint'
import { AgentSettingsDialog } from './workbench/agent/AgentSettingsDialog'
import { useAgentSettingsDialogStore } from '../store/agentSettingsDialogStore'
import WorkbenchTabBar from './workbench/WorkbenchTabBar'

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
  const isAiSidebar2Open = useWorkbenchStore((s) => s.isAiSidebar2Open)
  const closeAiSidebar2 = useWorkbenchStore((s) => s.closeAiSidebar2)
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
        aria-label={rightPane === 'ai' || isAiSidebar2Open ? '收起 AI 侧边栏' : '打开 AI 侧边栏'}
        title={rightPane === 'ai' || isAiSidebar2Open ? '收起 AI 侧边栏' : '打开 AI 侧边栏'}
        onClick={() => {
          if (rightPane !== 'ai' && !isAiSidebar2Open) {
            openRightPane('ai')
            return
          }
          if (isAiSidebar2Open) closeAiSidebar2()
          if (rightPane === 'ai') closeRightPane()
        }}
        className={tone(rightPane === 'ai' || isAiSidebar2Open)}
      >
        <AppIcon name={rightPane === 'ai' || isAiSidebar2Open ? 'right_panel_close' : 'right_panel_open'} size={16} />
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

  const { displayMode, setDisplayMode, resetPaneRatios, openSettings, closeSettings, settingsReturnPage, setHistoryOpen, setHistoryInitialTab, productMode, setProductMode, currentPage, isNewSession, textInserted, activeModels, debateState } = useAppStore()
  const productModeConfig = useAppStore((s) => s.productModeConfig)
  const visibleProductModes = productModeConfig.order.filter(m => !productModeConfig.hidden.includes(m))
  const { hasUpdate } = useUpdateReminder()
  const agentSettingsOpen = useAgentSettingsDialogStore((s) => s.isOpen)
  const closeAgentSettings = useAgentSettingsDialogStore((s) => s.close)
  const leftPaneWidth = useWorkbenchStore((s) => s.leftPaneWidth)
  const rightPaneWidth = useWorkbenchStore((s) => s.rightPaneWidth)
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const rightPane = useWorkbenchStore((s) => s.rightPane)
  const isAiSidebar2Open = useWorkbenchStore((s) => s.isAiSidebar2Open)
  const toggleLeftCollapse = useWorkbenchStore((s) => s.toggleLeftCollapse)
  const setLeftPaneWidth = useWorkbenchStore((s) => s.setLeftPaneWidth)
  const setLeftPaneMinWidth = useWorkbenchStore((s) => s.setLeftPaneMinWidth)
  const setRightPaneWidth = useWorkbenchStore((s) => s.setRightPaneWidth)
  const modeSwitcherRef = useRef<HTMLDivElement | null>(null)
  const [leftFullLabelsThreshold, setLeftFullLabelsThreshold] = useState(370)
  const [isWideWindow, setIsWideWindow] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1280
  )
  const isFallbackDraggingRef = useRef(false)
  const dragFrameRef = useRef<number | null>(null)
  const dragMovePendingRef = useRef(false)
  const productModeSwitchRef = useRef(false)

  const isWorkbenchView = currentPage === 'main' && productMode === 'workbench'
  const hasWorkbenchRightPane = Boolean(rightPane || isAiSidebar2Open)

  // 根据模式切换胶囊宽度 + 3 个操作按钮（设置、历史、收起左栏）动态计算左侧栏最小宽度与文字展开阈值
  useEffect(() => {
    if (!isWorkbenchView) {
      setLeftPaneMinWidth(WORKBENCH_BASE_MIN_LEFT_WIDTH)
      return
    }
    const isMac = window.api.platform === 'darwin'
    const updateLeftBounds = () => {
      const switcherWidth = modeSwitcherRef.current?.offsetWidth ?? 0
      if (switcherWidth <= 0) return
      const horizontalPad = isMac ? 94 : 20 // pl-[86px]/pl-3 + pr-2
      // 非 macOS：设置(28) + 历史(28) + 折叠(28) + 间距与最小拖拽留白 ≈ 108；macOS：左侧仅折叠按钮 ≈ 40
      const iconOnlyButtonsWidth = isMac ? 40 : 108
      const fullLabelButtonsWidth = isMac ? 40 : 162
      setLeftPaneMinWidth(switcherWidth + horizontalPad + iconOnlyButtonsWidth)
      setLeftFullLabelsThreshold(Math.ceil(switcherWidth + horizontalPad + fullLabelButtonsWidth))
    }

    updateLeftBounds()
    const el = modeSwitcherRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateLeftBounds)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isWorkbenchView, isLeftCollapsed, visibleProductModes.length, setLeftPaneMinWidth])

  useEffect(() => {
    const onResize = () => setIsWideWindow(window.innerWidth >= 1280)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startTopSplitterDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, side: 'left' | 'right') => {
      e.preventDefault()
      e.stopPropagation()
      const splitter = e.currentTarget
      const pointerId = e.pointerId
      splitter.setPointerCapture(pointerId)
      let currentWidth =
        side === 'left'
          ? useWorkbenchStore.getState().leftPaneWidth
          : useWorkbenchStore.getState().rightPaneWidth
      const handlePointerMove = (moveEvent: PointerEvent) => {
        currentWidth =
          side === 'left'
            ? setLeftPaneWidth(moveEvent.clientX, false)
            : setRightPaneWidth(window.innerWidth - moveEvent.clientX, false)
      }
      const handlePointerUp = () => {
        try {
          splitter.releasePointerCapture(pointerId)
        } catch {
          // ignore
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        void window.api.storeSet(
          side === 'left' ? 'workbench_leftPaneWidth' : 'workbench_rightPaneWidth',
          currentWidth
        )
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [setLeftPaneWidth, setRightPaneWidth]
  )

  const handleProductModeChange = useCallback(
    async (nextMode: ProductMode) => {
      if (productModeSwitchRef.current) return

      if (productMode === 'workbench' && nextMode !== 'workbench') {
        const { htmlVisualEditing, htmlEditLeaveGuard } = useWorkbenchStore.getState()
        if (htmlVisualEditing) {
          if (!htmlEditLeaveGuard) {
            useWorkbenchStore.setState({ error: '可视化编辑尚未就绪，无法切换模式' })
            return
          }
          productModeSwitchRef.current = true
          try {
            const decision = await htmlEditLeaveGuard()
            if (decision === 'cancelled') return
          } finally {
            productModeSwitchRef.current = false
          }
        }
      }

      setProductMode(nextMode)
      if (nextMode === 'debate') {
        setDisplayMode('two')
        resetPaneRatios()
      }
    },
    [productMode, resetPaneRatios, setDisplayMode, setProductMode]
  )

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


  const renderEntryButtons = (compact = false): JSX.Element => (
    <div className="flex items-center gap-1 no-drag shrink-0">
      <button
        type="button"
        onClick={() => (currentPage === 'settings' ? closeSettings() : openSettings())}
        className={`relative h-7 ${compact ? 'w-7 px-0' : 'px-2 gap-1'} flex items-center justify-center rounded-lg transition-all duration-200 ${
          currentPage === 'settings'
            ? 'text-primary bg-white/75 dark:bg-white/10 shadow-xs'
            : 'text-text-secondary hover:text-primary hover:bg-white/60 dark:hover:bg-white/10'
        }`}
        title={currentPage === 'settings' ? '返回' : '设置'}
        aria-label={currentPage === 'settings' ? '返回' : '设置'}
      >
        <AppIcon name="settings" size={16} />
        {!compact && <span className="text-xs font-normal whitespace-nowrap">设置</span>}
        {hasUpdate && <span className="absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-red-500 ring-2 ring-white/80" />}
      </button>
      <button
        type="button"
        onClick={() => {
          // 总结页打开历史时自动定位到"总结历史" Tab
          setHistoryInitialTab(currentPage === 'summary' ? 'summary' : 'conversation')
          setHistoryOpen(true)
        }}
        className={`h-7 ${compact ? 'w-7 px-0' : 'px-2 gap-1'} flex items-center justify-center text-text-secondary hover:text-primary hover:bg-white/60 dark:hover:bg-white/10 rounded-lg transition-all duration-200`}
        title="历史记录"
        aria-label="历史记录"
      >
        <AppIcon name="history" size={16} />
        {!compact && <span className="text-xs font-normal whitespace-nowrap">历史</span>}
      </button>
    </div>
  )

  const settingsBackButton = (
    <button
      type="button"
      onClick={closeSettings}
      className="no-drag -ml-1.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-body font-medium text-text-primary transition-all duration-200 hover:bg-white/75 hover:text-primary dark:hover:bg-white/10"
      title={settingsReturnPage === 'summary' ? '返回总结页' : '返回主页'}
    >
      <AppIcon name="arrow_back" size={18} />
      <span>{settingsReturnPage === 'summary' ? '返回总结页' : '返回主页'}</span>
    </button>
  )

  const modeSwitcher = (
    <div
      ref={modeSwitcherRef}
      className={`flex items-center p-0.5 bg-gray-200/60 dark:bg-gray-700/60 rounded-lg text-xs gap-0.5 no-drag shrink-0 ${currentPage === 'summary' || debateState.phase === 'running' || debateState.phase === 'paused' ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {visibleProductModes.map(mode => {
        const item = { key: mode, ...PRODUCT_MODE_LABELS[mode] }
        return (
          <button
            key={item.key}
            type="button"
            title={item.title}
            onClick={() => void handleProductModeChange(item.key as ProductMode)}
            className={`${isWorkbenchView ? 'px-2 py-1' : 'px-2.5 py-1'} rounded-md font-medium whitespace-nowrap transition-all duration-200 ${
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
  )

  const windowsCaptionButtons = (
    <div className="flex h-full items-stretch shrink-0 no-drag">
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
  )

  return (
    <div className="flex flex-col h-screen bg-transparent">
      {/* 自定义标题栏：工作台模式下切分为与下方三栏对齐的通顶顶栏 */}
      <div
        className={`${
          isWorkbenchView
            ? window.api.platform === 'darwin'
              ? 'h-[52px]'
              : 'h-[38px]'
            : window.api.platform === 'darwin'
              ? 'mac-titlebar'
              : 'h-[38px] px-4'
        } relative w-full shrink-0 ${isWorkbenchView ? 'flex items-center' : 'grid items-center'} drag-region`}
        style={isWorkbenchView ? undefined : { gridTemplateColumns: '1fr auto 1fr' }}
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
        {isWorkbenchView ? (
          <>
            {/* 左栏顶区：展开时与 leftPaneWidth 严格对齐；收起时保留模式切换、设置/历史与展开按钮 */}
            {!isLeftCollapsed ? (
              <>
                <div
                  className={`h-full shrink-0 flex items-center gap-1.5 pr-2 drag-region ${
                    window.api.platform === 'darwin' ? 'pl-[86px]' : 'pl-3'
                  }`}
                  style={{ width: `${leftPaneWidth}px` }}
                >
                  {modeSwitcher}
                  {window.api.platform !== 'darwin' && renderEntryButtons(leftPaneWidth < leftFullLabelsThreshold)}
                  <div className="flex-1 min-w-[4px] h-full drag-region" />
                  <button
                    type="button"
                    onClick={toggleLeftCollapse}
                    className="no-drag w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    title="收起侧边栏"
                    aria-label="收起侧边栏"
                  >
                    <AppIcon name="left_panel_close" size={16} />
                  </button>
                </div>
                <div
                  onPointerDown={(e) => startTopSplitterDrag(e, 'left')}
                  className="group relative w-[10px] -ml-[5px] h-full cursor-col-resize z-dropdown select-none shrink-0 no-drag"
                  title="拖拽调整左栏宽度"
                >
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[4px] group-hover:bg-blue-500/40 transition-colors" />
                </div>
              </>
            ) : (
              <div
                className={`h-full shrink-0 flex items-center gap-1.5 pr-1 drag-region ${
                  window.api.platform === 'darwin' ? 'pl-[86px]' : 'pl-3'
                }`}
              >
                {modeSwitcher}
                {window.api.platform !== 'darwin' && renderEntryButtons(!isWideWindow)}
                <button
                  type="button"
                  onClick={toggleLeftCollapse}
                  className="no-drag w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  title="展开侧边栏"
                  aria-label="展开侧边栏"
                >
                  <AppIcon name="left_panel_open" size={16} />
                </button>
                <div className="w-px h-4 bg-black/10 dark:bg-white/10 ml-0.5 shrink-0" />
              </div>
            )}

            {/* 中栏顶区：极简标签栏（宽度严格跟随中间编辑区） */}
            <WorkbenchTabBar isActive={isWorkbenchView} />

            {/* 右栏顶区：展开时与 rightPaneWidth 对齐；收起时紧凑收拢于右上角 */}
            {hasWorkbenchRightPane ? (
              <>
                <div
                  onPointerDown={(e) => startTopSplitterDrag(e, 'right')}
                  className="group relative w-[10px] -mr-[5px] h-full cursor-col-resize z-dropdown select-none shrink-0 no-drag"
                  title="拖拽调整侧边栏宽度"
                >
                  <div className="absolute inset-y-0 right-0 w-[4px] group-hover:bg-blue-500/40 transition-colors" />
                </div>
                <div
                  className={`h-full shrink-0 flex items-center gap-1 pl-2 drag-region ${
                    window.api.platform === 'win32' ? '' : 'pr-4'
                  }`}
                  style={{
                    width: `${rightPaneWidth}px`,
                    maxWidth: `calc(100% - ${!isLeftCollapsed ? `${leftPaneWidth}px - 10px` : '5px'} - ${WORKBENCH_MIN_EDITOR_WIDTH}px)`
                  }}
                >
                  <div className="flex-1 min-w-[4px] h-full drag-region" />
                  <div className={`flex items-center gap-1 shrink-0 no-drag ${window.api.platform === 'win32' ? 'mr-2' : ''}`}>
                    <WorkbenchPaneToggles />
                    {window.api.platform === 'darwin' && renderEntryButtons(rightPaneWidth < 360)}
                  </div>
                  {window.api.platform === 'win32' && windowsCaptionButtons}
                </div>
              </>
            ) : (
              <div
                className={`h-full shrink-0 flex items-center gap-1 pl-1.5 drag-region ${
                  window.api.platform === 'win32' ? '' : 'pr-4'
                }`}
              >
                <div className={`flex items-center gap-1 shrink-0 no-drag ${window.api.platform === 'win32' ? 'mr-2' : ''}`}>
                  <WorkbenchPaneToggles />
                  {window.api.platform === 'darwin' && renderEntryButtons(!isWideWindow)}
                </div>
                {window.api.platform === 'win32' && windowsCaptionButtons}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="relative z-10 flex items-center gap-3 select-none drag-region h-full">
              {currentPage === 'settings' ? settingsBackButton : (
                <>
                  <div className="flex items-center gap-3 drag-region">
                    {modeSwitcher}
                  </div>
                  {window.api.platform !== 'darwin' && renderEntryButtons(false)}
                </>
              )}
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
                    )
                  })}
                </div>
              ) : null}
            </div>

            {window.api.platform === 'win32' ? (
              <div className="relative z-20 -mr-4 flex h-full min-w-[138px] items-center justify-end drag-region">
                {windowsCaptionButtons}
              </div>
            ) : (
              <div className="relative z-10 min-w-[120px] drag-region h-full flex items-center justify-end gap-1">
                {currentPage !== 'settings' && renderEntryButtons(false)}
              </div>
            )}
          </>
        )}
      </div>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
      <CustomContextMenu />
      <CliAgentHint />
      <AgentSettingsDialog isOpen={agentSettingsOpen} onClose={closeAgentSettings} />
    </div>
  )
}

export default Layout
