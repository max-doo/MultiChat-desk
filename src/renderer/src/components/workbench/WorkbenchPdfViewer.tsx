import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useWorkbenchStore, type WorkbenchAiAction } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_INITIAL_CHUNK_BYTES = 256 * 1024
const PDF_RANGE_CHUNK_BYTES = 256 * 1024

interface PdfPageProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  width: number
  onSelect: (event: MouseEvent, pageElement: HTMLDivElement) => void
}

/**
 * 单页：canvas 负责绘制，textLayer 负责文字选区。
 * 只在接近视口时渲染，离开较远后释放位图，避免长文档把内存吃满。
 */
function PdfPage({ pdf, pageNumber, width, onSelect }: PdfPageProps): JSX.Element {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const element = pageRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting)
        setNear(visible)
      },
      { rootMargin: '1200px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 先量出页面尺寸占位，渲染时再按同一尺寸绘制，避免滚动跳动
  useEffect(() => {
    let cancelled = false
    void pdf
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: width / base.width })
        setSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber, width])

  useEffect(() => {
    const canvas = canvasRef.current
    const textContainer = textRef.current
    if (!near || !size || !canvas || !textContainer) return

    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null
    let textLayer: { cancel: () => void } | null = null

    const render = async (): Promise<void> => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      const baseViewport = page.getViewport({ scale: 1 })
      const scale = width / baseViewport.width
      const viewport = page.getViewport({ scale })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)

      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
      if (cancelled) return

      textContainer.replaceChildren()
      textContainer.style.width = `${viewport.width}px`
      textContainer.style.height = `${viewport.height}px`
      textContainer.style.setProperty('--total-scale-factor', '1')
      const layer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textContainer,
        viewport
      })
      textLayer = layer
      await layer.render()
    }

    void render().catch((error: unknown) => {
      // 取消渲染属于正常路径（快速翻页/切换文件），不当作错误
      if (!cancelled && (error as { name?: string })?.name !== 'RenderingCancelledException') {
        console.error('[WorkbenchPdfViewer] 页面渲染失败:', error)
      }
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      // 离开视口后释放位图，长文档滚动时内存不会线性增长
      canvas.width = 0
      canvas.height = 0
      textContainer.replaceChildren()
    }
  }, [near, size, pdf, pageNumber, width])

  return (
    <div
      ref={pageRef}
      data-pdf-page={pageNumber}
      className="relative mx-auto bg-white shadow-[0_2px_10px_rgba(15,23,42,0.14)]"
      style={{ width: Math.floor(width), height: size ? size.height : 640 }}
      onContextMenu={(event) => onSelect(event.nativeEvent, event.currentTarget)}
    >
      <canvas ref={canvasRef} className="block" />
      <div ref={textRef} className="pdf-text-layer" />
    </div>
  )
}

interface PdfMenuState {
  x: number
  y: number
  selectedText: string
}

interface WorkbenchPdfViewerProps {
  workspacePath: string
  relativePath: string
  fileSize: number
  reloadKey: number
  zoom: number
  onLoadState: (state: 'loading' | 'ready' | 'error', message?: string) => void
}

/** PDF.js 预览：canvas 绘制页面，透明文本层提供可选中的真实文字。 */
export default function WorkbenchPdfViewer({
  workspacePath,
  relativePath,
  fileSize,
  reloadKey,
  zoom,
  onLoadState
}: WorkbenchPdfViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [fitWidth, setFitWidth] = useState(720)
  const [menu, setMenu] = useState<PdfMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const askAi = useWorkbenchStore((s) => s.askAi)
  const setPendingMindmapSelection = useWorkbenchStore((s) => s.setPendingMindmapSelection)
  const openRightPane = useWorkbenchStore((s) => s.openRightPane)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = (): void => {
      const available = element.clientWidth - 48
      setFitWidth(Math.max(320, Math.min(available, 1100)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const width = Math.round(fitWidth * zoom)

  useEffect(() => {
    if (!workspacePath || !relativePath || fileSize <= 0) return
    let cancelled = false
    let failed = false
    let document: PDFDocumentProxy | null = null
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null
    let rangeTransport: pdfjsLib.PDFDataRangeTransport | null = null
    setPdf(null)
    onLoadState('loading')

    const markError = (message: string): void => {
      if (cancelled || failed) return
      failed = true
      onLoadState('error', message)
      void loadingTask?.destroy()
    }

    const load = async (): Promise<void> => {
      // 首段由受信 IPC 读取；PDF.js 后续按 Range 拉取，完整文件不经过 renderer 主堆。
      const initialEnd = Math.min(fileSize - 1, PDF_INITIAL_CHUNK_BYTES - 1)
      const initial = await window.api.workbench.readPdfRange(
        workspacePath,
        relativePath,
        0,
        initialEnd
      )
      if (cancelled) return
      if (!initial.success || !initial.data) {
        throw new Error(initial.error || '读取 PDF 首段失败')
      }

      const transport = new pdfjsLib.PDFDataRangeTransport(initial.data.size, initial.data.bytes)
      transport.requestDataRange = (begin: number, end: number): void => {
        if (cancelled || failed) return
        if (end <= begin) {
          transport.onDataRange(begin, new Uint8Array(0))
          return
        }
        void window.api.workbench
          // PDF.js 的 range 为 [begin, end)，IPC 读取范围按闭区间表达。
          .readPdfRange(workspacePath, relativePath, begin, end - 1)
          .then((result) => {
            if (cancelled || failed) return
            if (!result.success || !result.data) {
              markError(result.error || '读取 PDF 分段失败')
              return
            }
            transport.onDataRange(begin, result.data.bytes)
          })
          .catch((error: unknown) => {
            markError(error instanceof Error ? error.message : String(error))
          })
      }
      rangeTransport = transport

      loadingTask = pdfjsLib.getDocument({
        range: transport,
        rangeChunkSize: PDF_RANGE_CHUNK_BYTES,
        cMapUrl: 'pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'pdfjs/standard_fonts/',
        wasmUrl: 'pdfjs/wasm/',
        iccUrl: 'pdfjs/iccs/'
      })
      document = await loadingTask.promise
      if (cancelled) {
        void document.destroy()
        return
      }
      setPdf(document)
      onLoadState('ready')
    }

    void load().catch((error: unknown) => {
      if (cancelled) return
      console.error('[WorkbenchPdfViewer] 加载 PDF 失败:', error)
      onLoadState('error', error instanceof Error ? error.message : String(error))
    })

    return () => {
      cancelled = true
      rangeTransport?.abort()
      if (document) void document.destroy()
      else if (loadingTask) void loadingTask.destroy()
    }
  }, [workspacePath, relativePath, fileSize, reloadKey, onLoadState])

  const handleSelect = useCallback((event: MouseEvent, pageElement: HTMLDivElement): void => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    if (!text) {
      setMenu(null)
      return
    }
    // 右键按下时 Chromium 会先折叠选区，此时 anchor/focus 已不可靠；
    // 只要选区跨到本页就认为操作对象是这份文档，不再因落到页面外而丢弃。
    const intersectsPage = Array.from(pageElement.querySelectorAll('span')).some((span) =>
      selection?.containsNode(span, true)
    )
    if (selection?.rangeCount && !intersectsPage) {
      const range = selection.getRangeAt(0)
      if (!pageElement.contains(range.commonAncestorContainer)) {
        setMenu(null)
        return
      }
    }
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 260),
      selectedText: text
    })
  }, [])

  useEffect(() => {
    if (!menu) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menu])

  const runAction = (action: WorkbenchAiAction): void => {
    if (menu?.selectedText) askAi(menu.selectedText, action)
    setMenu(null)
  }

  const copySelection = async (): Promise<void> => {
    if (menu?.selectedText) await navigator.clipboard.writeText(menu.selectedText)
    setMenu(null)
  }

  const createMindmap = (): void => {
    const text = menu?.selectedText
    if (!text) return
    setPendingMindmapSelection({ text, headingPath: [] })
    openRightPane('mindmap')
    setMenu(null)
  }

  const actions: Array<{ action: WorkbenchAiAction | 'mindmap'; label: string; icon: string; color: string }> = [
    { action: 'ask', label: '向 AI 提问', icon: 'chat', color: 'text-blue-500' },
    { action: 'explain', label: '解释此内容', icon: 'psychology', color: 'text-purple-500' },
    { action: 'polish', label: '语言润色', icon: 'auto_fix_high', color: 'text-emerald-500' },
    { action: 'summarize', label: '提取关键要点', icon: 'format_list_bulleted', color: 'text-cyan-500' },
    { action: 'mindmap', label: '生成思维导图', icon: 'account_tree', color: 'text-indigo-500' }
  ]

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto bg-gray-200 dark:bg-gray-950 py-6">
      {pdf && (
        <div className="flex flex-col gap-6">
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              pageNumber={index + 1}
              width={width}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[190px] py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-sm animate-in fade-in zoom-in-95 duration-100"
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="px-3 py-1 font-semibold text-sm text-text-secondary/70 uppercase tracking-wider border-b border-black/5 dark:border-white/5 mb-1">
            AI 划词协同
          </div>
          {actions.map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => (item.action === 'mindmap' ? createMindmap() : runAction(item.action))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <AppIcon name={item.icon} size={19} className={`text-[19px] ${item.color}`} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
          <div className="my-1 border-t border-black/5 dark:border-white/5" />
          <button
            type="button"
            onClick={() => void copySelection()}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <AppIcon name="content_copy" size={19} />
            <span>复制选中文本</span>
          </button>
        </div>
      )}
    </div>
  )
}
