import { useCallback, useMemo, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'
import WorkbenchPdfViewer from './WorkbenchPdfViewer'

export default function WorkbenchPdfPreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const [reloadKey, setReloadKey] = useState(0)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [zoom, setZoom] = useState(1)

  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 3
  const ZOOM_STEP = 0.1
  const zoomStep = useCallback((direction: -1 | 1) => {
    setZoom((current) =>
      Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, Math.round((current + direction * ZOOM_STEP) * 10) / 10)
      )
    )
  }, [])

  // 格式化文件大小
  const formattedSize = useMemo(() => {
    if (!activeFileSize && activeFileSize !== 0) return ''
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

  const handleLoadState = useCallback((state: 'loading' | 'ready' | 'error', message?: string) => {
    setLoadState(state)
    if (state === 'error') setLoadError(message || '渲染 PDF 失败')
  }, [])

  const pdfNode = useMemo(() => ({
    id: activeFilePath || 'preview.pdf',
    name: activeFilePath?.split(/[/\\]/).pop() || 'preview.pdf',
    path: activeFilePath || 'preview.pdf',
    fullPath: activeFilePath || 'preview.pdf',
    isDirectory: false,
    extension: '.pdf'
  }), [activeFilePath])

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-gray-900">
      {/* 顶部工具栏 */}
      <div className="h-12 px-3 bg-white/80 dark:bg-gray-800/80 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 text-sm">
        {/* 左侧：文件信息与规格 */}
        <div className="flex items-center gap-2 truncate">
          <FileTypeIcon node={pdfNode} className="w-[19px] h-[19px]" />
          <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
        </div>

        {/* 右侧：操作与系统集成 */}
        <div className="flex items-center gap-1.5 text-text-secondary">
          {/* 缩放 */}
          <div className="flex items-center gap-0.5 rounded-md">
            <button
              type="button"
              onClick={() => zoomStep(-1)}
              disabled={zoom <= ZOOM_MIN}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              title="缩小"
            >
              <AppIcon name="zoom_out" size={18} />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="min-w-[46px] h-7 px-1 rounded-md text-xs font-medium tabular-nums hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="恢复到 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomStep(1)}
              disabled={zoom >= ZOOM_MAX}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              title="放大"
            >
              <AppIcon name="zoom_in" size={18} />
            </button>
          </div>

          <div className="h-5 w-px bg-black/10 dark:bg-white/10 mx-0.5" />

          {/* 重新加载 */}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="刷新文档渲染"
          >
            <AppIcon name="refresh" size={19} />
          </button>

          {/* 在系统阅读器打开 (如 Edge / Adobe Acrobat) */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="使用系统默认程序打开"
          >
            <AppIcon name="open_in_new" size={19} />
          </button>

          {/* 在资源管理器定位 */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void revealFile(activeFilePath)
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="在系统资源管理器中定位"
          >
            <AppIcon name="folder_open" size={19} />
          </button>
        </div>
      </div>

      {/* PDF 渲染容器 */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-gray-200 dark:bg-gray-950">
        {activeFileOversized ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-900 text-text-primary">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4">
              <FileTypeIcon node={pdfNode} className="w-[30px] h-[30px]" />
            </div>
            <h3 className="text-base font-semibold mb-2">PDF 文档超出内嵌预览上限</h3>
            <p className="text-sm text-text-secondary max-w-sm mb-6 leading-relaxed">
              该文件大小为 <span className="font-semibold text-text-primary">{formattedSize}</span>，超出工作台内嵌 50MB 预览上限。建议直接使用系统默认的专业 PDF 阅读器（如 Edge、Adobe Acrobat 或 Foxit）查看与批注。
            </p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="h-10 px-5 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-medium flex items-center gap-2 shadow-sm transition-all"
            >
              <AppIcon name="open_in_new" size={19} />
              <span>在系统阅读器中打开</span>
            </button>
          </div>
        ) : loadState === 'error' || !workspacePath || !activeFilePath || !activeFileSize ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-text-secondary">
            <AppIcon name="error" size={36} className="text-rose-400 mb-2" />
            <p className="text-sm mb-1">未能加载 PDF 数据或文件已损坏</p>
            <p className="text-xs mb-4 max-w-md break-words">{loadError || '缺少可加载的文件路径'}</p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
            >
              在外部阅读器中打开
            </button>
          </div>
        ) : (
          <WorkbenchPdfViewer
            workspacePath={workspacePath}
            relativePath={activeFilePath}
            fileSize={activeFileSize}
            reloadKey={reloadKey}
            zoom={zoom}
            onZoomStep={zoomStep}
            onLoadState={handleLoadState}
          />
        )}

        {/* 右下角发送与状态 */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
          <WorkbenchSendToAiButton />
          {formattedSize && (
            <div className="flex items-center gap-2 rounded-full border border-black/5 bg-white/85 px-2.5 py-1 text-xs text-text-secondary shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-gray-900/80">
              <span className="whitespace-nowrap" title={`大小 ${formattedSize}`}>
                {formattedSize}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
