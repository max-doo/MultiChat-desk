import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OFFICE_PREVIEW_MAX_BYTES } from '../../../../shared/types/workbench'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'
import { useWorkbenchSelectionAi } from './useWorkbenchSelectionAi'
import {
  PreviewFallbackState,
  PreviewHeader,
  PreviewMetaPill
} from './WorkbenchPreviewChrome'
import type {
  PptxParseResult,
  PptxShape,
  PptxWorkerRequest,
  PptxWorkerResponse
} from '../../workers/officePptx.worker'

/**
 * pptx 内容预览：jszip 解包 + XML 定向提取在 Worker 内完成，
 * 渲染侧只做 HTML 绝对定位排版。定位是"内容预览"——读清每张幻灯片的
 * 文字与配图、看懂结构；形状 geometry / 母版装饰 / 动画 / 图表不还原。
 *
 * 缩放：slide 按容器宽度等比缩放（transform scale），坐标换算集中在
 * EMU→px 的固定比例上，不随缩放逐元素重算。
 */

/** 1 inch = 914400 EMU；CSS 96dpi → 1px = 9525 EMU */
const EMU_PER_PX = 9525

/** slide 适配宽度时预留的边距（px），给滚动条与呼吸感 */
const SLIDE_FIT_PADDING = 16

type LoadState = 'loading' | 'ready' | 'error'

interface SlideMetrics {
  widthPx: number
  heightPx: number
  scale: number
  scaledHeight: number
}

export default function WorkbenchPptxPreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const contentRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const selection = useWorkbenchSelectionAi({ containerRef: contentRef })

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [parsed, setParsed] = useState<PptxParseResult | null>(null)
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)

  const oversized =
    activeFileOversized || (typeof activeFileSize === 'number' && activeFileSize > OFFICE_PREVIEW_MAX_BYTES)

  const formattedSize = useMemo(() => formatFileSize(activeFileSize), [activeFileSize])

  const pptxNode = useMemo(
    () => ({
      id: activeFilePath || 'preview.pptx',
      name: activeFilePath?.split(/[/\\]/).pop() || 'preview.pptx',
      path: activeFilePath || 'preview.pptx',
      fullPath: activeFilePath || 'preview.pptx',
      isDirectory: false,
      extension: '.pptx'
    }),
    [activeFilePath]
  )

  // 视口宽度跟踪：slide 按可用宽度等比缩放
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setViewportWidth(width)
    })
    observer.observe(viewport)
    setViewportWidth(viewport.clientWidth)
    return () => observer.disconnect()
  }, [loadState])

  useEffect(() => {
    if (!workspacePath || !activeFilePath || oversized) return
    let cancelled = false
    const blobUrls: string[] = []
    // 一份文件只需一次解析，结果回传后即可 terminate；
    // terminate 不会吞掉已 post 出来的消息（消息先入主线程事件队列）。
    let worker: Worker | null = null

    setLoadState('loading')
    setLoadError('')
    setParsed(null)
    setMediaUrls([])

    const run = async (): Promise<void> => {
      const result = await window.api.workbench.readOfficeBytes(workspacePath, activeFilePath)
      if (cancelled) return
      if (!result.success || !result.data) {
        throw new Error(result.error || '读取演示文稿失败')
      }

      worker = new Worker(new URL('../../workers/officePptx.worker.ts', import.meta.url), {
        type: 'module'
      })

      const byteSrc = result.data.bytes
      const buffer = byteSrc.buffer.slice(
        byteSrc.byteOffset,
        byteSrc.byteOffset + byteSrc.byteLength
      ) as ArrayBuffer

      const parseResult = await new Promise<PptxParseResult>((resolve, reject) => {
        const currentWorker = worker
        if (!currentWorker) {
          reject(new Error('解析线程创建失败'))
          return
        }
        const seq = 1
        currentWorker.onmessage = (event: MessageEvent<PptxWorkerResponse>) => {
          if (event.data.seq !== seq) return
          if (event.data.ok) resolve(event.data.result)
          else reject(new Error(event.data.error || '解析演示文稿失败'))
        }
        currentWorker.onerror = () => reject(new Error('解析线程异常终止'))
        const request: PptxWorkerRequest = { seq, type: 'parse', buffer }
        currentWorker.postMessage(request, [buffer])
      })
      if (cancelled) return

      const urls = parseResult.media.map((entry) =>
        URL.createObjectURL(new Blob([entry.bytes], { type: entry.mime }))
      )
      blobUrls.push(...urls)
      if (cancelled) return
      setMediaUrls(urls)
      setParsed(parseResult)
      setLoadState('ready')
    }

    run().catch((error: unknown) => {
      if (cancelled) return
      setLoadError(error instanceof Error ? error.message : String(error))
      setLoadState('error')
    })

    return () => {
      cancelled = true
      worker?.terminate()
      // blob URL 随组件销毁/切文件统一回收（docx 预览同款回收约定）
      for (const url of blobUrls) URL.revokeObjectURL(url)
    }
  }, [workspacePath, activeFilePath, oversized, reloadKey])

  const emuToPx = useCallback((emu: number): number => emu / EMU_PER_PX, [])

  const slideMetrics = useMemo((): SlideMetrics | null => {
    if (!parsed) return null
    const widthPx = emuToPx(parsed.slideWidthEmu)
    const heightPx = emuToPx(parsed.slideHeightEmu)
    const available = Math.max(120, viewportWidth - SLIDE_FIT_PADDING)
    const scale = available / widthPx
    return { widthPx, heightPx, scale, scaledHeight: heightPx * scale }
  }, [parsed, viewportWidth, emuToPx])

  const renderShape = (shape: PptxShape, key: number): JSX.Element | null => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: emuToPx(shape.x),
      top: emuToPx(shape.y),
      width: emuToPx(shape.cx),
      height: emuToPx(shape.cy)
    }
    if (shape.type === 'text') {
      return (
        <div key={key} style={{ ...baseStyle, overflow: 'hidden' }}>
          {shape.paragraphs.map((para, paraIdx) => (
            <div
              key={paraIdx}
              style={{
                textAlign: para.align,
                whiteSpace: 'pre-line',
                lineHeight: 1.3,
                minHeight: '1em',
                // OOXML 默认缩进 457200 EMU/级 ≈ 48px（未缩放坐标系内）
                paddingLeft: para.indentLevel ? para.indentLevel * 48 : 0
              }}
            >
              {para.runs.map((run, runIdx) => (
                <span
                  key={runIdx}
                  style={{
                    fontSize: `${((run.fontSizePt ?? 18) * 96) / 72}px`,
                    fontWeight: run.bold ? 700 : undefined,
                    color: run.color ?? '#1f1f1f'
                  }}
                >
                  {run.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      )
    }
    if (shape.type === 'image') {
      const url = mediaUrls[shape.mediaIndex]
      if (!url) return null
      return (
        <img
          key={key}
          src={url}
          alt=""
          draggable={false}
          style={{ ...baseStyle, objectFit: 'fill' }}
        />
      )
    }
    // 表格按文本块定位呈现：细边框 + 紧凑 padding，服务"读数据"而非还原版式
    return (
      <div key={key} style={{ ...baseStyle, overflow: 'hidden' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
            color: '#1f1f1f',
            tableLayout: 'fixed'
          }}
        >
          <tbody>
            {shape.rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    style={{
                      border: '1px solid rgba(15, 23, 42, 0.25)',
                      padding: '3px 8px',
                      whiteSpace: 'pre-line',
                      verticalAlign: 'top'
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-gray-900">
      <PreviewHeader
        left={
          <>
            <FileTypeIcon node={pptxNode} className="w-[19px] h-[19px]" />
            <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
              {activeFilePath}
            </span>
          </>
        }
        right={
          <>
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

      <div className="flex-1 w-full h-full relative overflow-hidden">
        {oversized ? (
          <PreviewFallbackState
            icon={
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4">
                <FileTypeIcon node={pptxNode} className="w-[30px] h-[30px]" />
              </div>
            }
            title="演示文稿超出内嵌预览上限"
            description={
              <>
                该文件大小为 <span className="font-semibold text-text-primary">{formattedSize}</span>，超过工作台
                10MB 的内嵌预览上限。可用系统默认应用打开查看与编辑。
              </>
            }
            actionLabel="在本地打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : loadState === 'error' ? (
          <PreviewFallbackState
            icon={<AppIcon name="error" size={24} className="text-rose-400 mb-2" />}
            title="未能渲染这份演示文稿"
            description={loadError || '文件已损坏或格式不受支持'}
            actionLabel="在本地打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : (
          <div ref={viewportRef} className="w-full h-full overflow-auto py-6 px-6">
            {parsed && slideMetrics && (
              <div
                ref={contentRef}
                className="select-text mx-auto"
                style={{ width: slideMetrics.widthPx * slideMetrics.scale }}
                data-workbench-editor="true"
                onMouseUp={selection.onMouseUp}
                onContextMenu={selection.onContextMenu}
              >
                {parsed.slides.map((slide, slideIdx) => (
                  <div key={slideIdx} className="mb-5 last:mb-0">
                    <div
                      className="relative bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_10px_28px_-16px_rgba(15,23,42,0.35)] overflow-hidden"
                      style={{ height: slideMetrics.scaledHeight }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: slideMetrics.widthPx,
                          height: slideMetrics.heightPx,
                          transform: `scale(${slideMetrics.scale})`,
                          transformOrigin: 'top left'
                        }}
                      >
                        {slide.shapes.map((shape, shapeIdx) => renderShape(shape, shapeIdx))}
                      </div>
                    </div>
                    <div className="mt-1 pr-1 text-right text-caption text-text-secondary/50 select-none tabular-nums">
                      {slideIdx + 1} / {parsed.slides.length}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loadState === 'loading' && !oversized && (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-body bg-slate-100/80 dark:bg-gray-900/80">
            <AppIcon name="refresh" size={19} className="animate-spin mr-2" />
            正在渲染文档
          </div>
        )}

        {selection.overlay}

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
