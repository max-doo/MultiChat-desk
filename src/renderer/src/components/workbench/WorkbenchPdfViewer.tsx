import { memo, useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import {
  useWorkbenchStore,
  type ReaderBackgroundTheme,
  type WorkbenchAiAction
} from '../../store/workbenchStore'
import WorkbenchSelectionMenu, { WORKBENCH_AI_SELECTION_ACTIONS } from './WorkbenchSelectionMenu'

// worker 走 pdfjs 运行时资源的原始字节直出路径（dev 中间件 / 打包时 out/renderer/pdfjs），
// 不能经 vite 模块管线——import 分析注入会破坏 worker 内 emscripten glue 的 wasm 实例化链路
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.mjs', location.href).href

const PDF_INITIAL_CHUNK_BYTES = 256 * 1024
const PDF_RANGE_CHUNK_BYTES = 256 * 1024
const PDF_WHEEL_ZOOM_THRESHOLD = 100
const PDF_RESIZE_DEBOUNCE_MS = 120
const PDF_PAGE_CLEANUP_BUFFER = 6
const DEFAULT_PDF_ASPECT_RATIO = 1.414
// 图片覆盖页面面积超过该比例时视为整页扫描件，深色模式下随页面一起反色而不是原样保留
const PDF_FULL_PAGE_IMAGE_AREA_RATIO = 0.85

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
  const pageArea = viewport.width * viewport.height

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
      // axialAlignedBoundingBox 会把结果与 output 既有值做并集，必须用极值初始化而不是 [0,0,0,0]，
      // 否则每个图片框都会被错误地扩展到页面左上角
      const bounds = [Infinity, Infinity, -Infinity, -Infinity]
      Util.axialAlignedBoundingBox([0, 0, 1, 1], ctm, bounds)
      const x0 = Math.max(0, Math.floor(bounds[0]))
      const y0 = Math.max(0, Math.floor(bounds[1]))
      const x1 = Math.min(Math.ceil(viewport.width), Math.ceil(bounds[2]))
      const y1 = Math.min(Math.ceil(viewport.height), Math.ceil(bounds[3]))
      const width = x1 - x0
      const height = y1 - y0
      if (width >= 4 && height >= 4) {
        const coversPage = width * height >= pageArea * PDF_FULL_PAGE_IMAGE_AREA_RATIO
        if (!coversPage) {
          boxes.push({ x: x0, y: y0, width, height })
        }
      }
    }
  }
  return boxes
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  displayWidth: number
  renderWidth: number
  defaultAspectRatio: number
  initialAspectRatio?: number
  isDark: boolean
  isNear: boolean
  registerPageElement: (pageNumber: number, element: HTMLDivElement | null) => void
  onPageLoaded: (pageNumber: number, page: PDFPageProxy) => void
  onAspectRatio: (pageNumber: number, ratio: number) => void
  onSelect: (event: MouseEvent, pageElement: HTMLDivElement) => void
}

/**
 * 单页：canvas 负责绘制，textLayer 负责文字选区；暗黑模式下按需提取图片坐标并裁剪叠加。
 * 仅在进入共享 IntersectionObserver 的 near 区域后按需调用 getPage()，离开后清空位图。
 */
const PdfPage = memo(function PdfPage({
  pdf,
  pageNumber,
  displayWidth,
  renderWidth,
  defaultAspectRatio,
  initialAspectRatio,
  isDark,
  isNear,
  registerPageElement,
  onPageLoaded,
  onAspectRatio,
  onSelect
}: PdfPageProps): JSX.Element {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const renderedMetaRef = useRef<{
    page: PDFPageProxy
    viewport: PageViewport
    ratio: number
  } | null>(null)
  const imageBoxesRef = useRef<ImageBox[] | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number>(
    () => initialAspectRatio ?? defaultAspectRatio
  )
  const [renderSeq, setRenderSeq] = useState(0)

  useEffect(() => {
    setAspectRatio(initialAspectRatio ?? defaultAspectRatio)
  }, [pdf, pageNumber, initialAspectRatio, defaultAspectRatio])

  useEffect(() => {
    const element = pageRef.current
    registerPageElement(pageNumber, element)
    return () => registerPageElement(pageNumber, null)
  }, [pageNumber, registerPageElement])

  useEffect(() => {
    const canvas = canvasRef.current
    const textContainer = textRef.current
    if (!isNear || !canvas || !textContainer || renderWidth <= 0) return

    let cancelled = false
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    let textLayer: { cancel: () => void } | null = null

    const render = async (): Promise<void> => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      onPageLoaded(pageNumber, page)
      const baseViewport = page.getViewport({ scale: 1 })
      if (baseViewport.width > 0) {
        const trueRatio = baseViewport.height / baseViewport.width
        onAspectRatio(pageNumber, trueRatio)
        setAspectRatio((prev) => (Math.abs(prev - trueRatio) > 1e-4 ? trueRatio : prev))
      }

      const scale = renderWidth / baseViewport.width
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

      renderedMetaRef.current = { page, viewport, ratio }
      imageBoxesRef.current = null
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
      renderedMetaRef.current = null
      imageBoxesRef.current = null
      textContainer.replaceChildren()
    }
  }, [isNear, pdf, pageNumber, renderWidth, onPageLoaded, onAspectRatio])

  // 暗黑模式下按需提取图片坐标并按实际包围盒尺寸裁剪绘制到无滤镜叠加层，亮色模式完全跳过 getOperatorList
  useEffect(() => {
    const overlay = overlayCanvasRef.current
    const baseCanvas = canvasRef.current
    const meta = renderedMetaRef.current
    if (!overlay || !baseCanvas || !meta || !isDark || baseCanvas.width === 0) {
      if (overlay) {
        overlay.width = 0
        overlay.height = 0
      }
      return
    }

    let cancelled = false

    const paintCroppedOverlay = (boxes: ImageBox[]): void => {
      if (cancelled || !overlay || !baseCanvas || baseCanvas.width === 0 || boxes.length === 0) {
        if (overlay) {
          overlay.width = 0
          overlay.height = 0
        }
        return
      }
      let minX = Infinity
      let minY = Infinity
      let maxX = 0
      let maxY = 0
      for (const box of boxes) {
        const sx = Math.max(0, Math.floor(box.x * meta.ratio))
        const sy = Math.max(0, Math.floor(box.y * meta.ratio))
        const ex = Math.min(baseCanvas.width, Math.ceil((box.x + box.width) * meta.ratio))
        const ey = Math.min(baseCanvas.height, Math.ceil((box.y + box.height) * meta.ratio))
        if (ex > sx && ey > sy) {
          if (sx < minX) minX = sx
          if (sy < minY) minY = sy
          if (ex > maxX) maxX = ex
          if (ey > maxY) maxY = ey
        }
      }
      const cropW = maxX - minX
      const cropH = maxY - minY
      if (cropW <= 0 || cropH <= 0) {
        overlay.width = 0
        overlay.height = 0
        return
      }
      overlay.width = cropW
      overlay.height = cropH
      overlay.style.left = `${minX / meta.ratio}px`
      overlay.style.top = `${minY / meta.ratio}px`
      overlay.style.width = `${cropW / meta.ratio}px`
      overlay.style.height = `${cropH / meta.ratio}px`
      const ctx = overlay.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, cropW, cropH)
      for (const box of boxes) {
        const sx = Math.max(0, Math.floor(box.x * meta.ratio))
        const sy = Math.max(0, Math.floor(box.y * meta.ratio))
        const ex = Math.min(baseCanvas.width, Math.ceil((box.x + box.width) * meta.ratio))
        const ey = Math.min(baseCanvas.height, Math.ceil((box.y + box.height) * meta.ratio))
        const sw = ex - sx
        const sh = ey - sy
        if (sw > 0 && sh > 0) {
          ctx.drawImage(baseCanvas, sx, sy, sw, sh, sx - minX, sy - minY, sw, sh)
        }
      }
    }

    if (imageBoxesRef.current !== null) {
      paintCroppedOverlay(imageBoxesRef.current)
      return () => {
        cancelled = true
      }
    }

    void meta.page
      .getOperatorList()
      .then((opList) => {
        if (cancelled || renderedMetaRef.current !== meta) return
        const boxes = extractPdfImageBoxes(opList, meta.viewport)
        imageBoxesRef.current = boxes
        paintCroppedOverlay(boxes)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [isDark, renderSeq])

  const outerWidth = Math.floor(displayWidth)
  const outerHeight = Math.floor(displayWidth * aspectRatio)
  const committedWidth = Math.floor(renderWidth)
  const committedHeight = Math.floor(renderWidth * aspectRatio)
  const previewScale = renderWidth > 0 && displayWidth !== renderWidth ? displayWidth / renderWidth : 1

  return (
    <div
      ref={pageRef}
      data-pdf-page={pageNumber}
      className="relative mx-auto overflow-hidden bg-white shadow-[0_2px_10px_rgba(15,23,42,0.14)]"
      style={{ width: outerWidth, height: outerHeight }}
      onContextMenu={(event) => onSelect(event.nativeEvent, event.currentTarget)}
    >
      <div
        className="relative"
        style={
          previewScale !== 1
            ? {
                width: committedWidth,
                height: committedHeight,
                transform: `scale(${previewScale})`,
                transformOrigin: 'top left'
              }
            : { width: committedWidth, height: committedHeight }
        }
      >
        <canvas ref={canvasRef} data-pdf-base-canvas="true" className="block" />
        <canvas ref={overlayCanvasRef} className="block pointer-events-none absolute" />
        <div ref={textRef} className="pdf-text-layer" />
      </div>
    </div>
  )
})

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
  const pagesGridRef = useRef<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [defaultAspectRatio, setDefaultAspectRatio] = useState(DEFAULT_PDF_ASPECT_RATIO)
  const [fitWidth, setFitWidth] = useState(720)
  const [availableWidth, setAvailableWidth] = useState(720)
  const displayWidth = Math.round(fitWidth * zoom)
  const [renderWidth, setRenderWidth] = useState(displayWidth)
  const prevPdfRef = useRef<PDFDocumentProxy | null>(null)
  const [nearPages, setNearPages] = useState<Set<number>>(() => new Set())
  const nearPagesRef = useRef<Set<number>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const pageElementsRef = useRef<Map<Element, number>>(new Map())
  const elementByPageRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const aspectRatiosRef = useRef<Map<number, number>>(new Map())
  const loadedPagesRef = useRef<Map<number, PDFPageProxy>>(new Map())
  const [menu, setMenu] = useState<PdfMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const askAi = useWorkbenchStore((s) => s.askAi)
  const setPendingMindmapSelection = useWorkbenchStore((s) => s.setPendingMindmapSelection)
  const openRightPane = useWorkbenchStore((s) => s.openRightPane)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let rafId: number | null = null
    const update = (): void => {
      const available = element.clientWidth - 48
      setAvailableWidth(Math.max(0, available))
      setFitWidth(Math.max(320, Math.min(available, 1100)))
    }
    update()
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        update()
      })
    })
    observer.observe(element)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [])

  // Resize / 缩放防抖 120ms 再重绘高分 Canvas；防抖期间由子页通过 CSS transform: scale 平滑过渡
  useEffect(() => {
    if (prevPdfRef.current !== pdf) {
      prevPdfRef.current = pdf
      setRenderWidth(displayWidth)
      return
    }
    if (displayWidth === renderWidth) return
    const timer = setTimeout(() => {
      setRenderWidth(displayWidth)
    }, PDF_RESIZE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [pdf, displayWidth, renderWidth])

  // 单一共享 IntersectionObserver 监测全部页容器，并对缓冲区间外的离屏页调用 page.cleanup()
  useEffect(() => {
    nearPagesRef.current = new Set()
    setNearPages(new Set())
    const root = containerRef.current
    if (!pdf || !root) return

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false
        const next = new Set(nearPagesRef.current)
        for (const entry of entries) {
          const pageNumber = pageElementsRef.current.get(entry.target)
          if (pageNumber === undefined) continue
          if (entry.isIntersecting) {
            if (!next.has(pageNumber)) {
              next.add(pageNumber)
              changed = true
            }
          } else if (next.has(pageNumber)) {
            next.delete(pageNumber)
            changed = true
          }
        }
        if (!changed) return

        nearPagesRef.current = next
        setNearPages(next)

        if (next.size > 0 && loadedPagesRef.current.size > 0) {
          let minNear = Infinity
          let maxNear = -Infinity
          next.forEach((p) => {
            if (p < minNear) minNear = p
            if (p > maxNear) maxNear = p
          })
          loadedPagesRef.current.forEach((pageProxy, loadedPageNumber) => {
            if (
              loadedPageNumber < minNear - PDF_PAGE_CLEANUP_BUFFER ||
              loadedPageNumber > maxNear + PDF_PAGE_CLEANUP_BUFFER
            ) {
              if (pageProxy.cleanup()) {
                loadedPagesRef.current.delete(loadedPageNumber)
              }
            }
          })
        }
      },
      { root, rootMargin: '1200px 0px' }
    )

    observerRef.current = observer
    pageElementsRef.current.forEach((_pageNumber, element) => {
      observer.observe(element)
    })

    return () => {
      observer.disconnect()
      if (observerRef.current === observer) {
        observerRef.current = null
      }
    }
  }, [pdf])

  const registerPageElement = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    const prev = elementByPageRef.current.get(pageNumber)
    if (prev && prev !== element) {
      observerRef.current?.unobserve(prev)
      pageElementsRef.current.delete(prev)
      elementByPageRef.current.delete(pageNumber)
    }
    if (element) {
      elementByPageRef.current.set(pageNumber, element)
      pageElementsRef.current.set(element, pageNumber)
      observerRef.current?.observe(element)
    }
  }, [])

  const onPageLoaded = useCallback((pageNumber: number, page: PDFPageProxy) => {
    loadedPagesRef.current.set(pageNumber, page)
  }, [])

  const onAspectRatio = useCallback((pageNumber: number, ratio: number) => {
    aspectRatiosRef.current.set(pageNumber, ratio)
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

  useEffect(() => {
    if (!workspacePath || !relativePath || fileSize <= 0) return
    let cancelled = false
    let failed = false
    let document: PDFDocumentProxy | null = null
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null
    let rangeTransport: pdfjsLib.PDFDataRangeTransport | null = null
    aspectRatiosRef.current.clear()
    loadedPagesRef.current.clear()
    setPdf(null)
    setDefaultAspectRatio(DEFAULT_PDF_ASPECT_RATIO)
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
        // pdf.js 的资源 fetch 可能发生在 worker 内部（useWorkerFetch），
        // worker 中相对 URL 是相对 worker 脚本路径解析而不是页面——必须传绝对 URL，
        // 否则 pdfjs/wasm 会变成 pdfjs/pdfjs/wasm 404，JBIG2 扫描件解码静默卡死
        cMapUrl: new URL('pdfjs/cmaps/', location.href).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('pdfjs/standard_fonts/', location.href).href,
        wasmUrl: new URL('pdfjs/wasm/', location.href).href,
        iccUrl: new URL('pdfjs/iccs/', location.href).href
      })
      document = await loadingTask.promise
      if (cancelled) {
        void document.destroy()
        return
      }

      // 打开时仅读取第 1 页获取默认宽高比，其余页等进入视口附近再按需 getPage
      let initialAspect = DEFAULT_PDF_ASPECT_RATIO
      if (document.numPages >= 1) {
        const firstPage = await document.getPage(1)
        if (cancelled) {
          void document.destroy()
          return
        }
        loadedPagesRef.current.set(1, firstPage)
        const vp1 = firstPage.getViewport({ scale: 1 })
        if (vp1.width > 0) {
          initialAspect = vp1.height / vp1.width
          aspectRatiosRef.current.set(1, initialAspect)
        }
      }
      setDefaultAspectRatio(initialAspect)
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
      loadedPagesRef.current.clear()
      aspectRatiosRef.current.clear()
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
      className="w-full h-full overflow-auto bg-gray-200 dark:bg-[#141414] py-6 px-6 wb-pdf-viewport transition-colors duration-150"
      data-pdf-theme={backgroundTheme}
    >
      {pdf && (
        <div
          ref={pagesGridRef}
          className="grid gap-6 justify-center justify-items-center content-start items-start mx-auto w-fit"
          style={{
            // 列数由缩放后的页宽除以容器宽度显式计算，缩小时自动排成多列，
            // 与 Word 阅读版式的多页视图一致；不依赖 flex/grid 的内在宽度推断。
            gridTemplateColumns: `repeat(${Math.max(
              1,
              Math.floor(
                (availableWidth + 24) / (displayWidth + 24)
              )
            )}, ${displayWidth}px)`
          }}
        >
          {Array.from({ length: pdf.numPages }, (_, index) => {
            const pageNumber = index + 1
            return (
              <PdfPage
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                displayWidth={displayWidth}
                renderWidth={renderWidth}
                defaultAspectRatio={defaultAspectRatio}
                initialAspectRatio={aspectRatiosRef.current.get(pageNumber)}
                isDark={backgroundTheme === 'dark'}
                isNear={nearPages.has(pageNumber)}
                registerPageElement={registerPageElement}
                onPageLoaded={onPageLoaded}
                onAspectRatio={onAspectRatio}
                onSelect={handleSelect}
              />
            )
          })}
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
