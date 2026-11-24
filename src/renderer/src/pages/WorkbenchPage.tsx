import { useEffect, useState, useCallback } from 'react'
import { useWorkbenchStore, WORKBENCH_MIN_EDITOR_WIDTH } from '../store/workbenchStore'
import WorkbenchFileTree from '../components/workbench/WorkbenchFileTree'
import WorkbenchEditor from '../components/workbench/WorkbenchEditor'
import WorkbenchAiSidebar from '../components/workbench/WorkbenchAiSidebar'
import WorkbenchMindmapPanel from '../components/workbench/WorkbenchMindmapPanel'
import { requestUploadNodesToAi } from '../components/workbench/workbenchAiEvents'
import { AppIcon } from '../components/icons/AppIcon'

interface WorkbenchPageProps {
  isActive?: boolean
}

export default function WorkbenchPage({ isActive = true }: WorkbenchPageProps): JSX.Element {
  const isInitialized = useWorkbenchStore((s) => s.isInitialized)
  const initWorkbench = useWorkbenchStore((s) => s.initWorkbench)
  const leftPaneWidth = useWorkbenchStore((s) => s.leftPaneWidth)
  const rightPaneWidth = useWorkbenchStore((s) => s.rightPaneWidth)
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const rightPane = useWorkbenchStore((s) => s.rightPane)
  const isAiSidebar2Open = useWorkbenchStore((s) => s.isAiSidebar2Open)
  const setLeftPaneWidth = useWorkbenchStore((s) => s.setLeftPaneWidth)
  const setRightPaneWidth = useWorkbenchStore((s) => s.setRightPaneWidth)
  const error = useWorkbenchStore((s) => s.error)
  const clearError = useWorkbenchStore((s) => s.clearError)
  const notice = useWorkbenchStore((s) => s.notice)
  const clearNotice = useWorkbenchStore((s) => s.clearNotice)
  const draggingNodes = useWorkbenchStore((s) => s.draggingNodes)
  const openRightPane = useWorkbenchStore((s) => s.openRightPane)
  const pendingMindmapDeletions = useWorkbenchStore((s) => s.pendingMindmapDeletions)
  const confirmMindmapDeletions = useWorkbenchStore((s) => s.confirmMindmapDeletions)

  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [mountedRightPanes, setMountedRightPanes] = useState<Set<'mindmap'>>(() => {
    return new Set(rightPane === 'mindmap' ? ['mindmap'] : [])
  })

  // 初始化加载上次偏好与工作区
  useEffect(() => {
    void initWorkbench()
  }, [initWorkbench])

  // AI 侧栏必须常驻以接收同步 CustomEvent；导图首次打开后保持挂载，兼顾内存与编辑态。
  useEffect(() => {
    if (rightPane !== 'mindmap') return
    setMountedRightPanes((previous) => {
      if (previous.has(rightPane)) return previous
      const next = new Set(previous)
      next.add(rightPane)
      return next
    })
  }, [rightPane])

  // 处理拖拽分隔条 (Left Splitter)
  const handleLeftSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const splitter = e.currentTarget
    const pointerId = e.pointerId
    splitter.setPointerCapture(pointerId)
    setIsDraggingLeft(true)
    let currentWidth = useWorkbenchStore.getState().leftPaneWidth
    const handlePointerMove = (moveEvent: PointerEvent) => {
      // 拖拽高频过程中仅更新内存状态，避免每帧高频 IPC 写盘引发界面粘滞卡顿
      currentWidth = setLeftPaneWidth(moveEvent.clientX, false)
    }
    const handlePointerUp = () => {
      setIsDraggingLeft(false)
      try {
        splitter.releasePointerCapture(pointerId)
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      // 拖拽结束时单次持久化落盘
      void window.api.storeSet('workbench_leftPaneWidth', currentWidth)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [setLeftPaneWidth])

  // 处理拖拽分隔条 (Right Splitter)
  const handleRightSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const splitter = e.currentTarget
    const pointerId = e.pointerId
    splitter.setPointerCapture(pointerId)
    setIsDraggingRight(true)
    let currentWidth = useWorkbenchStore.getState().rightPaneWidth
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = window.innerWidth - moveEvent.clientX
      // 拖拽高频过程中仅更新内存状态，避免每帧高频 IPC 写盘引发界面粘滞卡顿
      currentWidth = setRightPaneWidth(nextWidth, false)
    }
    const handlePointerUp = () => {
      setIsDraggingRight(false)
      try {
        splitter.releasePointerCapture(pointerId)
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      // 拖拽结束时单次持久化落盘
      void window.api.storeSet('workbench_rightPaneWidth', currentWidth)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [setRightPaneWidth])

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div
      className="flex h-full w-full overflow-hidden relative select-none"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      {/* 调整窗格宽度时的透明事件保护遮罩 */}
      {(isDraggingLeft || isDraggingRight) && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none bg-transparent" />
      )}

      {/* 错误提示浮层 */}
      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-rose-500 text-white rounded-xl shadow-xl flex items-center gap-2 text-xs animate-in fade-in slide-in-from-top duration-200">
          <AppIcon name="error" size={16} />
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="w-4 h-4 flex items-center justify-center hover:bg-white/20 rounded-full"
          >
            <AppIcon name="close" size={12} />
          </button>
        </div>
      )}

      {/* 成功类轻提示：与错误条共用位置，不堆叠 */}
      {!error && notice && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-emerald-500 text-white rounded-xl shadow-xl flex items-center gap-2 text-xs animate-in fade-in slide-in-from-top duration-200">
          <AppIcon name="check_circle" size={16} />
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={clearNotice}
            className="w-4 h-4 flex items-center justify-center hover:bg-white/20 rounded-full"
          >
            <AppIcon name="close" size={12} />
          </button>
        </div>
      )}

      {/* 对账判定为外部删除的导图确认条 */}
      {pendingMindmapDeletions && pendingMindmapDeletions.length > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-amber-500 text-white rounded-xl shadow-xl flex items-center gap-3 text-xs animate-in fade-in slide-in-from-top duration-200">
          <span>检测到 {pendingMindmapDeletions.length} 份文档已消失，将删除对应笔记记录</span>
          <button
            type="button"
            onClick={() => void confirmMindmapDeletions(pendingMindmapDeletions)}
            className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded"
          >全部确认</button>
          <button
            type="button"
            onClick={() => useWorkbenchStore.setState({ pendingMindmapDeletions: null })}
            className="px-2 py-1 hover:bg-white/20 rounded"
          >忽略</button>
        </div>
      )}

      <div className="flex flex-1 h-full min-w-0">
        {/* 左栏：文件树与搜索 */}
        {!isLeftCollapsed && (
          <div
            className="h-full shrink-0 overflow-hidden"
            style={{ width: `${leftPaneWidth}px` }}
          >
            <WorkbenchFileTree />
          </div>
        )}

        {/* 左栏可拖拽 Splitter */}
        {!isLeftCollapsed && (
          <div
            onPointerDown={handleLeftSplitterPointerDown}
            className={`group relative w-[10px] -ml-[5px] h-full cursor-col-resize z-30 select-none shrink-0 ${
              isDraggingLeft ? 'bg-primary/60' : 'bg-transparent'
            }`}
            title="拖拽调整左栏宽度"
          >
            <div
              className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[4px] transition-colors group-hover:bg-blue-500/40 ${
                isDraggingLeft ? 'bg-primary/60' : ''
              }`}
            />
          </div>
        )}

        {/* 中栏：Meta Lexical 编辑器（侧栏折叠时对应角贴齐窗口边缘，不再圆角） */}
        <div className={`flex-1 h-full min-w-[${WORKBENCH_MIN_EDITOR_WIDTH}px] overflow-hidden flex flex-col bg-white dark:bg-gray-900 border-l border-t border-r border-black/5 dark:border-white/5 ${isLeftCollapsed ? '' : 'rounded-tl-xl'} ${rightPane ? 'rounded-tr-xl' : ''}`}>
          <WorkbenchEditor />
        </div>

        {/* 右栏可拖拽 Splitter */}
        {(rightPane || isAiSidebar2Open) && (
          <div
            onPointerDown={handleRightSplitterPointerDown}
            className={`group relative w-[10px] -mr-[5px] h-full cursor-col-resize z-30 select-none shrink-0 ${
              isDraggingRight ? 'bg-primary/60' : 'bg-transparent'
            }`}
            title="拖拽调整侧边栏宽度"
          >
            <div
              className={`absolute inset-y-0 right-0 w-[4px] transition-colors group-hover:bg-blue-500/40 ${
                isDraggingRight ? 'bg-primary/60' : ''
              }`}
            />
          </div>
        )}

        {/* 右栏：AI Webview / 思维导图 侧边栏 */}
        <div
          className="h-full shrink-0 overflow-hidden rounded-tl-xl bg-white dark:bg-gray-900 border-t border-black/5 dark:border-white/5"
          style={{
            width: rightPane || isAiSidebar2Open ? `${rightPaneWidth}px` : 0,
            maxWidth: rightPane || isAiSidebar2Open
              ? `calc(100% - ${!isLeftCollapsed ? `${leftPaneWidth}px - 10px` : '5px'} - ${WORKBENCH_MIN_EDITOR_WIDTH}px)`
              : undefined,
            display: rightPane || isAiSidebar2Open ? 'flex' : 'none'
          }}
        >
          {/* AI 常驻；第二 AI 侧边栏按需挂载，导图首次打开后保持挂载。 */}
          <div className="h-full min-w-0" style={{ display: rightPane === 'ai' ? 'flex' : 'none', flex: 1 }}>
            <WorkbenchAiSidebar isActive={isActive} />
          </div>
          <div
            className="h-full min-w-0 border-l border-black/5 dark:border-white/5"
            style={{ display: isAiSidebar2Open ? 'flex' : 'none', flex: 1 }}
          >
            <WorkbenchAiSidebar isActive={isActive} instanceId="secondary" />
          </div>
          {mountedRightPanes.has('mindmap') && (
            <div className="h-full min-w-0 border-l border-black/5 dark:border-white/5" style={{ display: rightPane === 'mindmap' ? 'flex' : 'none', flex: 1 }}>
              <WorkbenchMindmapPanel />
            </div>
          )}
        </div>

        {/* 当拖拽工作区文件且 AI 侧边栏未展开时，右侧显示展开停靠感应区（绝对浮层，避免挤压中间编辑器导致抖动） */}
        {draggingNodes && rightPane !== 'ai' && !isAiSidebar2Open && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              e.preventDefault()
              openRightPane('ai')
              const dragTypes = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
              if (dragTypes.includes('Files') && !dragTypes.includes('application/x-multichat-workspace-files')) {
                return
              }
              const nodes = useWorkbenchStore.getState().draggingNodes
              if (nodes?.length) requestUploadNodesToAi({ nodes })
            }}
            className="absolute right-0 top-0 bottom-0 w-14 flex flex-col items-center justify-center bg-primary/15 hover:bg-primary/25 border-l-2 border-dashed border-primary/60 cursor-pointer animate-in fade-in slide-in-from-right duration-200 z-40 transition-colors shadow-2xl backdrop-blur-sm"
            title="拖拽到此处展开 AI 侧边栏"
          >
            <div className="flex flex-col items-center gap-2 text-primary font-medium text-xs select-none p-2 text-center pointer-events-none">
              <AppIcon name="smart_toy" size={20} className="animate-bounce" />
              <span className="[writing-mode:vertical-lr] tracking-widest text-[11px]">展开 AI 侧边栏</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
