import { useEffect, useState, useCallback } from 'react'
import { useWorkbenchStore } from '../store/workbenchStore'
import WorkbenchFileTree from '../components/workbench/WorkbenchFileTree'
import WorkbenchEditor from '../components/workbench/WorkbenchEditor'
import WorkbenchAiSidebar from '../components/workbench/WorkbenchAiSidebar'

interface WorkbenchPageProps {
  isActive?: boolean
}

export default function WorkbenchPage({ isActive = true }: WorkbenchPageProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const isInitialized = useWorkbenchStore((s) => s.isInitialized)
  const initWorkbench = useWorkbenchStore((s) => s.initWorkbench)
  const selectWorkspaceFolder = useWorkbenchStore((s) => s.selectWorkspaceFolder)
  const setWorkspaceFolder = useWorkbenchStore((s) => s.setWorkspaceFolder)
  const leftPaneWidth = useWorkbenchStore((s) => s.leftPaneWidth)
  const rightPaneWidth = useWorkbenchStore((s) => s.rightPaneWidth)
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const isRightCollapsed = useWorkbenchStore((s) => s.isRightCollapsed)
  const setLeftPaneWidth = useWorkbenchStore((s) => s.setLeftPaneWidth)
  const setRightPaneWidth = useWorkbenchStore((s) => s.setRightPaneWidth)
  const error = useWorkbenchStore((s) => s.error)
  const clearError = useWorkbenchStore((s) => s.clearError)

  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  // 初始化加载上次偏好与工作区
  useEffect(() => {
    void initWorkbench()
  }, [initWorkbench])

  // 处理拖拽分隔条 (Left Splitter)
  const handleLeftSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const splitter = e.currentTarget
    const pointerId = e.pointerId
    splitter.setPointerCapture(pointerId)
    setIsDraggingLeft(true)
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setLeftPaneWidth(moveEvent.clientX)
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
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = window.innerWidth - moveEvent.clientX
      setRightPaneWidth(nextWidth)
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
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [setRightPaneWidth])

  // 文件夹拖入窗口打开工作区支持
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const fileWithElectronPath = e.dataTransfer.files[0] as unknown as { path?: string }
      const droppedPath = fileWithElectronPath?.path
      if (droppedPath) {
        void setWorkspaceFolder(droppedPath)
      }
    }
  }

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // 空工作区状态引导
  if (!workspacePath) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`flex items-center justify-center h-full p-6 transition-colors select-none ${
          isDragOver ? 'bg-blue-50/50 dark:bg-blue-950/20' : 'bg-transparent'
        }`}
      >
        <div className="max-w-md w-full p-8 rounded-3xl bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-2xl flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 mb-5">
            <span className="material-symbols-outlined text-3xl">auto_stories</span>
          </div>

          <h2 className="text-xl font-bold text-text-primary mb-2">MultiChat 工作台</h2>
          <p className="text-xs text-text-secondary leading-relaxed mb-6">
            基于本地 Markdown 知识库与 Web 大模型的沉浸式生产力空间。纯本地存储，零格式入侵，100% 兼容 Obsidian 库。
          </p>

          <button
            type="button"
            onClick={() => void selectWorkspaceFolder()}
            className="w-full h-10 px-5 rounded-xl bg-primary text-white hover:bg-primary/95 active:scale-[0.98] font-medium text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">folder_open</span>
            <span>选择本地工作区文件夹...</span>
          </button>

          <div className="mt-4 text-xs text-text-secondary/70">
            或将文件夹拖拽至此窗口直接开启
          </div>
        </div>
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
          <span className="material-symbols-outlined text-[16px]">error</span>
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="w-4 h-4 flex items-center justify-center hover:bg-white/20 rounded-full"
          >
            <span className="material-symbols-outlined text-[12px]">close</span>
          </button>
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

        {/* 中栏：Meta Lexical 编辑器（左栏折叠时左上角贴齐窗口边缘、右栏折叠时右上角贴齐，不再圆角） */}
        <div className={`flex-1 h-full min-w-[480px] overflow-hidden flex flex-col bg-white dark:bg-gray-900 border-l border-t border-r border-black/5 dark:border-white/5 ${isLeftCollapsed ? '' : 'rounded-tl-xl'} ${isRightCollapsed ? '' : 'rounded-tr-xl'}`}>
          <WorkbenchEditor />
        </div>

        {/* 右栏可拖拽 Splitter */}
        {!isRightCollapsed && (
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

        {/* 右栏：AI Webview 侧边栏 */}
        <div
          className="h-full shrink-0 overflow-hidden rounded-tl-xl bg-white dark:bg-gray-900 border-t border-black/5 dark:border-white/5"
          style={{
            width: isRightCollapsed ? 0 : `${rightPaneWidth}px`,
            display: isRightCollapsed ? 'none' : 'block'
          }}
        >
          <WorkbenchAiSidebar />
        </div>
      </div>
    </div>
  )
}
