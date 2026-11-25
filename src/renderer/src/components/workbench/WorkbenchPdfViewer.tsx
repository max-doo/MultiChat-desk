import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  useWorkbenchStore,
  type ReaderBackgroundTheme,
  type WorkbenchAiAction
} from '../../store/workbenchStore'
import WorkbenchSelectionMenu, { WORKBENCH_AI_SELECTION_ACTIONS } from './WorkbenchSelectionMenu'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_INITIAL_CHUNK_BYTES = 256 * 1024
const PDF_RANGE_CHUNK_BYTES = 256 * 1024
const PDF_WHEEL_ZOOM_THRESHOLD = 100

interface ImageBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 解析 PDF.js 操作指令流中的位图绘制坐标，映射到当前视口 CSS 像素矩形。
 * 暗黑模式下用于把局部照片/扫描图原样保留，不被底层整页滤镜反色。
 */
function extractPdfImageBoxes(
  opList: Awaited<ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getOperatorList']>>,
  viewport: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getViewport']>
): ImageBox[] {
  const boxes: ImageBox[] = []
  const stack: number[][] = []
  let ctm: number[] = [...viewport.transform]
  const { OPS, Util } = pdfjsLib

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i]
    const args = opList.argsArray[i]
    if (fn === OPS.save) {
      stack.push([...ctm])
    } else if (fn === OPS.restore) {
      if (stack.length > 0) ctm = stack.pop()!
    } else if (fn === OPS.transform && Array.isArray(args)) {
      ctm = Util.transform(ctm, args as number[])
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push([...ctm])
      if (Array.isArray(args?.[0])) {
        ctm = Util.transform(ctm, args[0] as number[])
      }
    } else if (fn === OPS.paintFormXObjectEnd) {
      if (stack.length > 0) ctm = stack.pop()!
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const bounds = [0, 0, 0, 0]
      Util.axialAlignedBoundingBox([0, 0, 1, 1], ctm, bounds)
      const x0 = Math.max(0, Math.floor(bounds[0]))
      const y0 = Math.max(0, Math.floor(bounds[1]))
      const x1 = Math.min(Math.ceil(viewport.width), Math.ceil(bounds[2]))
      const y1 = Math.min(Math.ceil(viewport.height), Math.ceil(bounds[3]))
      const width = x1 - x0
      const height = y1 - y0
      if (width >= 4 && height >= 4) {
        boxes.push({ x: x0, y: y0, width, height })
      }
    }
  }
  return boxes
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  width: number
  isDark: boolean
  onSelect: (event: MouseEvent, pageElement: HTMLDivElement) => void
}

/**
 * 单页：canvas 负责绘制，textLayer 负责文字选区；暗黑模式下叠加无滤镜图片还原层。
 * 只在接近视口时渲染，离开较远后释放位图，避免长文档把内存吃满。
 */
function PdfPage({ pdf, pageNumber, width, isDark, onSelect }: PdfPageProps): JSX.Element {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const imageBoxesRef = useRef<{
    boxes: ImageBox[]
    ratio: number
    cssWidth: number
    cssHeight: number
  } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [near, setNear] = useState(false)
  const [renderSeq, setRenderSeq] = useState(0)

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
      const cssWidth = Math.floor(viewport.width)
      const cssHeight = Math.floor(viewport.height)

      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
      if (cancelled) return

      const opList = await page.getOperatorList()
      if (cancelled) return
      imageBoxesRef.current = {
        boxes: extractPdfImageBoxes(opList, viewport),
        ratio,
        cssWidth,
        cssHeight
      }
      setRenderSeq((seq) => seq + 1)

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
      if (overlayCanvasRef.current) {
        overlayCanvasRef.current.width = 0
        overlayCanvasRef.current.height = 0
      }
      imageBoxesRef.current = null
      textContainer.replaceChildren()
    }
  }, [near, size, pdf, pageNumber, width])

  // 暗黑模式下把未反色原图区域从底图拷贝到无滤镜叠加层，保证照片/插图保持原貌
  useEffect(() => {
    const overlay = overlayCanvasRef.current
    const baseCanvas = canvasRef.current
    const meta = imageBoxesRef.current
    if (!overlay || !baseCanvas || !meta || !isDark || baseCanvas.width === 0 || meta.boxes.length === 0) {
      if (overlay) {
        overlay.width = 0
        overlay.height = 0
      }
      return
    }
    overlay.width = baseCanvas.width
    overlay.height = baseCanvas.height
    overlay.style.width = `${meta.cssWidth}px`
    overlay.style.height = `${meta.cssHeight}px`
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    for (const box of meta.boxes) {
      const sx = Math.floor(box.x * meta.ratio)
      const sy = Math.floor(box.y * meta.ratio)
      const sw = Math.min(overlay.width - sx, Math.ceil(box.width * meta.ratio))
      const sh = Math.min(overlay.height - sy, Math.ceil(box.height * meta.ratio))
      if (sw > 0 && sh > 0) {
        ctx.drawImage(baseCanvas, sx, sy, sw, sh, sx, sy, sw, sh)
      }
    }
  }, [isDark, renderSeq])

  return (
    <div
      ref={pageRef}
      data-pdf-page={pageNumber}
      className="relative mx-auto bg-white shadow-[0_2px_10px_rgba(15,23,42,0.14)]"
      style={{ width: Math.floor(width), height: size ? size.height : 640 }}
      onContextMenu={(event) => onSelect(event.nativeEvent, event.currentTarget)}
    >
      <canvas ref={canvasRef} data-pdf-base-canvas="true" className="block" />
      <canvas ref={overlayCanvasRef} className="block pointer-events-none absolute inset-0" />
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
  backgroundTheme: ReaderBackgroundTheme
  onZoomStep: (direction: -1 | 1) => void
  onLoadState: (state: 'loading' | 'ready' | 'error', message?: string) => void
}

/** PDF.js 预览：canvas 绘制页面，透明文本层提供可选中的真实文字。 */
export default function WorkbenchPdfViewer({
  workspacePath,
  relativePath,
  fileSize,
  reloadKey,
  zoom,
  backgroundTheme,
  onZoomStep,
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

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let accumulatedDelta = 0

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()

      const deltaScale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? 100
            : 1
      const delta = event.deltaY * deltaScale
      if (delta === 0) return

      if (Math.sign(delta) !== Math.sign(accumulatedDelta)) accumulatedDelta = 0
      accumulatedDelta += delta
      const steps = Math.trunc(accumulatedDelta / PDF_WHEEL_ZOOM_THRESHOLD)
      if (steps === 0) return

      accumulatedDelta -= steps * PDF_WHEEL_ZOOM_THRESHOLD
      // deltaY 为负表示滚轮向上，按通用习惯向上放大、向下缩小
      onZoomStep(steps > 0 ? -1 : 1)
    }

    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [onZoomStep])

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

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto bg-gray-200 dark:bg-[#141414] py-6 wb-pdf-viewport transition-colors duration-150"
      data-pdf-theme={backgroundTheme}
    >
      {pdf && (
        <div className="flex flex-col gap-6">
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              pageNumber={index + 1}
              width={width}
              isDark={backgroundTheme === 'dark'}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}

      {menu && (
        <WorkbenchSelectionMenu
          ref={menuRef}
          x={menu.x}
          y={menu.y}
          items={WORKBENCH_AI_SELECTION_ACTIONS}
          onSelectAction={(action) => (action === 'mindmap' ? createMindmap() : runAction(action))}
          onCopy={() => void copySelection()}
        />
      )}
    </div>
  )
}
