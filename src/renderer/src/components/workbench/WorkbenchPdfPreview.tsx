import { useCallback, useMemo, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'
import WorkbenchPdfViewer from './WorkbenchPdfViewer'
import {
  PreviewFallbackState,
  PreviewHeader,
  PreviewMetaPill,
  PreviewZoomControls
} from './WorkbenchPreviewChrome'

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

  const formattedSize = useMemo(() => formatFileSize(activeFileSize), [activeFileSize])

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
      <PreviewHeader
        left={
          <>
            <FileTypeIcon node={pdfNode} className="w-[19px] h-[19px]" />
            <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
              {activeFilePath}
            </span>
          </>
        }
        right={
          <>
            <PreviewZoomControls
              zoom={zoom}
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              onZoomOut={() => zoomStep(-1)}
              onZoomIn={() => zoomStep(1)}
              onReset={() => setZoom(1)}
            />

            <div className="h-5 w-px bg-black/10 dark:bg-white/10 mx-0.5" />

            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="刷新文档渲染"
            >
              <AppIcon name="refresh" size={19} />
            </button>

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
          </>
        }
      />

      {/* PDF 渲染容器 */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-gray-200 dark:bg-gray-950">
        {activeFileOversized ? (
          <PreviewFallbackState
            icon={
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4">
                <FileTypeIcon node={pdfNode} className="w-[30px] h-[30px]" />
              </div>
            }
            title="PDF 文档超出内嵌预览上限"
            description={
              <>
                该文件大小为 <span className="font-semibold text-text-primary">{formattedSize}</span>，超出工作台内嵌 50MB 预览上限。建议直接使用系统默认的专业 PDF 阅读器（如 Edge、Adobe Acrobat 或 Foxit）查看与批注。
              </>
            }
            actionLabel="在系统阅读器中打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : loadState === 'error' || !workspacePath || !activeFilePath || !activeFileSize ? (
          <PreviewFallbackState
            icon={<AppIcon name="error" size={24} className="text-rose-400 mb-2" />}
            title="未能加载 PDF 数据或文件已损坏"
            description={loadError || '缺少可加载的文件路径'}
            actionLabel="在外部阅读器中打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
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
        <div className="absolute bottom-3 right-3 z-dropdown flex items-center gap-2">
          <WorkbenchSendToAiButton />
          {formattedSize && (
            <PreviewMetaPill title={`大小 ${formattedSize}`}>
              <span className="whitespace-nowrap">{formattedSize}</span>
            </PreviewMetaPill>
          )}
        </div>
      </div>
    </div>
  )
}
