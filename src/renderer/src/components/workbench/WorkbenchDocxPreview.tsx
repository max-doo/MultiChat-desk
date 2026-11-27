import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Options } from 'docx-preview'
import { OFFICE_PREVIEW_MAX_BYTES } from '../../../../shared/types/workbench'
import { useWorkbenchStore, type WorkbenchAiAction } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import { convertMetafileImages } from '../../utils/docxMetafileImages'
import { normalizeWideFloatingTables, paginateDocxFlow } from '../../utils/docxPagination'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'
import WorkbenchDocxToc, { type DocxDocumentLike } from './WorkbenchDocxToc'
import WorkbenchSelectionMenu, { WORKBENCH_AI_SELECTION_ACTIONS } from './WorkbenchSelectionMenu'
import WorkbenchReaderThemePicker from './WorkbenchReaderThemePicker'
import {
  PreviewFallbackState,
  PreviewHeader,
  PreviewMetaPill,
  PreviewZoomControls
} from './WorkbenchPreviewChrome'

const ZOOM_MIN = 0.3
const ZOOM_MAX = 3
const ZOOM_STEP = 0.1
const WHEEL_ZOOM_THRESHOLD = 100

// 与 Word 字数口径一致的统计：CJK 逐字计数，西文按词计数；
// CJK 范围覆盖假名、谚文音节、扩展 A、兼容表意字、全角标点与竖排标点。
const CJK_CHAR_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯가-힯]/g

interface DocxStats {
  words: number
  cjkChars: number
  westernWords: number
  charsNoSpace: number
  charsWithSpace: number
  paragraphs: number
}

function countDocxStats(container: HTMLElement): DocxStats {
  const text = container.textContent ?? ''
  const cjkChars = (text.match(CJK_CHAR_RE) || []).length
  const westernWords = text
    .replace(CJK_CHAR_RE, ' ')
    .split(/\s+/)
    .filter(Boolean).length
  const paragraphs = Array.from(container.querySelectorAll('p')).filter(
    (p) => (p.textContent ?? '').trim().length > 0
  ).length
  return {
    words: cjkChars + westernWords,
    cjkChars,
    westernWords,
    charsNoSpace: text.replace(/\s/g, '').length,
    // Word 的“字符数(计空格)”不含段落换行
    charsWithSpace: text.replace(/[\r\n]/g, '').length,
    paragraphs
  }
}

function countWordsInText(text: string): number {
  const cjkChars = (text.match(CJK_CHAR_RE) || []).length
  const westernWords = text
    .replace(CJK_CHAR_RE, ' ')
    .split(/\s+/)
    .filter(Boolean).length
  return cjkChars + westernWords
}

interface DocxMenuState {
  x: number
  y: number
  text: string
}

interface DocxTocItem {
  text: string
  level: number
}

interface DocxParagraphNodeLike {
  type?: string
  styleName?: string
  outlineLevel?: number
  children?: DocxParagraphNodeLike[]
  text?: string
}

function readParagraphText(node: DocxParagraphNodeLike): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.children)) return ''
  let out = ''
  for (let i = 0; i < node.children.length; i += 1) {
    out += readParagraphText(node.children[i])
  }
  return out
}

/**
 * 同步提取轻量的目录大纲，避免把体积庞大的 WordDocument AST 长期留在 React state。
 */
function extractDocxTocItems(doc: DocxDocumentLike): DocxTocItem[] {
  const styleLevelById = new Map<string, number>()
  const styles = doc.stylesPart?.styles
  if (Array.isArray(styles)) {
    for (let i = 0; i < styles.length; i += 1) {
      const style = styles[i]
      const level = style?.paragraphProps?.outlineLevel
      if (style?.id && typeof level === 'number') {
        styleLevelById.set(style.id, level)
      }
    }
  }

  const items: DocxTocItem[] = []
  const visit = (node: DocxParagraphNodeLike): void => {
    if (!node) return
    if (node.type === 'paragraph') {
      const own = typeof node.outlineLevel === 'number' ? node.outlineLevel : undefined
      const viaStyle = node.styleName ? styleLevelById.get(node.styleName) : undefined
      const level = own ?? viaStyle
      if (typeof level === 'number' && level >= 0 && level < 9) {
        const text = readParagraphText(node).trim()
        if (text) items.push({ text, level: level + 1 })
      }
    }
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i += 1) {
        visit(node.children[i])
      }
    }
  }

  const bodyChildren = doc.documentPart?.body?.children as DocxParagraphNodeLike[] | undefined
  if (Array.isArray(bodyChildren)) {
    for (let i = 0; i < bodyChildren.length; i += 1) {
      visit(bodyChildren[i])
    }
  }
  return items
}

function buildLightweightDocxOutlineDoc(items: DocxTocItem[]): DocxDocumentLike | null {
  if (items.length === 0) return null
  return {
    documentPart: {
      body: {
        children: items.map((item) => ({
          type: 'paragraph',
          outlineLevel: item.level - 1,
          text: item.text
        }))
      }
    }
  }
}

/**
 * docx-preview 把内嵌图片与字体转成 blob URL；卸载或重渲染前必须回收，
 * 否则每次打开文档都会留下无法释放的 Blob。
 */
function revokeDocxBlobUrls(root: HTMLElement): void {
  root.querySelectorAll('img[src^="blob:"]').forEach((img) => {
    URL.revokeObjectURL((img as HTMLImageElement).src)
  })
  root.querySelectorAll('image').forEach((img) => {
    const href = img.getAttribute('href')
    if (href && href.startsWith('blob:')) URL.revokeObjectURL(href)
    const xlinkHref = img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (xlinkHref && xlinkHref.startsWith('blob:')) URL.revokeObjectURL(xlinkHref)
  })
  root.querySelectorAll('style').forEach((style) => {
    const matches = style.textContent?.match(/blob:[^)"'\s]+/g)
    matches?.forEach((url) => URL.revokeObjectURL(url))
  })
  root.querySelectorAll('[style*="blob:"]').forEach((el) => {
    const matches = el.getAttribute('style')?.match(/blob:[^)"'\s]+/g)
    matches?.forEach((url) => URL.revokeObjectURL(url))
  })
}

function clearDocxContainer(container: HTMLElement): void {
  revokeDocxBlobUrls(container)
  container.replaceChildren()
}

export default function WorkbenchDocxPreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const askAi = useWorkbenchStore((s) => s.askAi)
  const docxBackgroundTheme = useWorkbenchStore((s) => s.docxBackgroundTheme)
  const setDocxBackgroundTheme = useWorkbenchStore((s) => s.setDocxBackgroundTheme)
  const isDark = docxBackgroundTheme === 'dark'

  const contentRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  // 右键会让 Chromium 先折叠选区，用最近一次文档内选区兜住操作对象；
  // 左键重新点选、切换文件或执行动作后即失效。
  const lastSelectionRef = useRef('')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedText, setSelectedText] = useState('')
  const [menu, setMenu] = useState<DocxMenuState | null>(null)
  const [stats, setStats] = useState<DocxStats | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const basePageWidthRef = useRef(0)
  const statsChipRef = useRef<HTMLDivElement | null>(null)
  const [docxDocument, setDocxDocument] = useState<DocxDocumentLike | null>(null)

  const zoomStep = useCallback((direction: -1 | 1) => {
    setZoom((current) =>
      Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, Math.round((current + direction * ZOOM_STEP) * 10) / 10)
      )
    )
  }, [])

  const oversized =
    activeFileOversized || (typeof activeFileSize === 'number' && activeFileSize > OFFICE_PREVIEW_MAX_BYTES)

  const formattedSize = useMemo(() => formatFileSize(activeFileSize), [activeFileSize])

  const docxNode = useMemo(
    () => ({
      id: activeFilePath || 'preview.docx',
      name: activeFilePath?.split(/[/\\]/).pop() || 'preview.docx',
      path: activeFilePath || 'preview.docx',
      fullPath: activeFilePath || 'preview.docx',
      isDirectory: false,
      extension: '.docx'
    }),
    [activeFilePath]
  )

  useEffect(() => {
    setSelectedText('')
    setMenu(null)
    setStats(null)
    setStatsOpen(false)
    lastSelectionRef.current = ''
  }, [activeFilePath])

  const selectedWords = useMemo(
    () => (selectedText ? countWordsInText(selectedText) : 0),
    [selectedText]
  )

  /**
   * 按容器宽度缩放文档页面并排布多列。
   * 缩放作用在每个 page section 上，列数由缩放后的页宽除以容器宽度显式计算
   * （不依赖 flex-wrap 的内在宽度推断——zoom 缩放与 fit-content 组合在 Chromium
   * 下换行判定不可靠），wrapper 宽度按列数精确给定，等价于 Word 阅读版式多页视图。
   * 基准取全部页的最大宽度，避免横向页面溢出容器。
   */
  const fitToWidth = useCallback(() => {
    const scroller = scrollRef.current
    const container = contentRef.current
    if (!scroller || !container) return
    const wrapper = Array.from(container.children).find((el) =>
      el.classList.contains('docx-wrapper')
    ) as HTMLElement | undefined
    if (!wrapper) return

    const pages = Array.from(wrapper.querySelectorAll<HTMLElement>(':scope > section.docx'))
    if (pages.length === 0) return
    // 与容器左右 padding 对齐（px-6 = 24px/侧）
    const available = scroller.clientWidth - 48
    if (available <= 0) return

    let baseWidth = basePageWidthRef.current
    if (baseWidth <= 0) {
      // zoom 未应用前量一次原始页宽；已应用过时按当前缩放值还原
      const first = pages[0]
      const currentZoom = parseFloat(first.style.zoom) || 1
      baseWidth = Math.max(...pages.map((p) => p.getBoundingClientRect().width / currentZoom))
      if (baseWidth > 0) basePageWidthRef.current = baseWidth
    }
    if (baseWidth <= 0) return

    const scale = Math.min(1, available / baseWidth) * zoomRef.current
    for (const page of pages) {
      page.style.zoom = scale === 1 ? '' : String(scale)
    }

    // 显式网格列控制：列数与轨道宽度都由 JS 计算，不依赖 flex-wrap 的内在
    // 宽度推断（zoom 缩放 + flex 换行在 Chromium 下对复杂内容的判定不可靠）。
    const gap = 20
    const scaledWidth = baseWidth * scale
    const columns = Math.max(1, Math.floor((available + gap) / (scaledWidth + gap)))
    wrapper.style.gridTemplateColumns = `repeat(${columns}, ${scaledWidth}px)`
  }, [])

  // 手动缩放改变时重算；走 ref 是为了避免 fitToWidth 依赖 zoom 后
  // 被渲染 effect 级联触发整份文档重渲染。
  useEffect(() => {
    zoomRef.current = zoom
    fitToWidth()
  }, [zoom, fitToWidth])

  // 渲染整份文档：字节只在本 effect 内流转，不进入全局 store；
  // docx-preview 体积较大，改为按需动态加载，避免拖慢工作台首屏。
  useEffect(() => {
    const container = contentRef.current
    if (!container || !workspacePath || !activeFilePath || oversized) return

    let cancelled = false
    let staging: HTMLDivElement | null = null
    basePageWidthRef.current = 0
    setLoadState('loading')
    setLoadError('')
    clearDocxContainer(container)

    const render = async (): Promise<void> => {
      const result = await window.api.workbench.readOfficeBytes(workspacePath, activeFilePath)
      if (cancelled) return
      if (!result.success || !result.data) {
        throw new Error(result.error || '读取 Word 文档失败')
      }
      const { renderAsync } = await import('docx-preview')
      if (cancelled) return

      // 先让加载态完成一次绘制，再进入同步的 OOXML 解析与 DOM 构建。
      // 窗口隐藏时 Chromium 会完全停发 rAF，裸等会死锁在加载态，必须带超时兜底。
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 120)
        requestAnimationFrame(() => {
          clearTimeout(timer)
          resolve()
        })
      })
      if (cancelled) return

      // 渲染到游离节点再整体换入：刷新或切换文件时旧渲染不会追加到新内容上。
      staging = document.createElement('div')
      const options: Partial<Options> = {
        inWrapper: true,
        // 打开内嵌分页标记支持：Word 重存过的文档能拿到精确分页；
        // 没有标记的文档再由下方的重流分页引擎按版面高度近似切分。
        breakPages: true,
        // 保留 Word 页宽（ignoreWidth 会把页面压成窄条、正文宽度失真），
        // 渲染后按容器宽度整体缩放，等价于常见的文档预览“适应宽度”。
        ignoreWidth: false,
        ignoreHeight: false,
        renderComments: false,
        renderChanges: false,
        // altChunk 会把文档内嵌的原始 HTML 放进 iframe srcdoc，
        // 等同在宿主页面执行未审查内容；预览不需要该特性，直接关闭。
        renderAltChunks: false
      }
      // renderAsync 返回 parseAsync 产出的 WordDocument，里面保留了
      // OOXML 大纲信息（outlineLevel/style 继承），同步提取轻量大纲后即释放重 AST。
      const doc = (await renderAsync(
        result.data.bytes,
        staging,
        staging,
        options
      )) as DocxDocumentLike
      if (cancelled) {
        clearDocxContainer(staging)
        staging = null
        return
      }
      // 先把 WMF/EMF 图元文件原位转成 PNG，再整体换入容器，
      // 避免用户先看到一帧裂图；Chromium 没有图元解码器，转换是显示的唯一途径。
      await convertMetafileImages(staging)
      if (cancelled) {
        clearDocxContainer(staging)
        staging = null
        return
      }
      const outlineDoc = buildLightweightDocxOutlineDoc(extractDocxTocItems(doc))
      container.replaceChildren(...Array.from(staging.childNodes))
      staging = null

      const wrapper = Array.from(container.children).find((el) =>
        el.classList.contains('docx-wrapper')
      ) as HTMLElement | undefined
      if (wrapper) {
        // 修正宽浮动表格的锚定位失真，再按真实版面高度把超长内容重流为分页。
        // 两步都同步完成，用户看不到中间态。
        normalizeWideFloatingTables(wrapper)
        paginateDocxFlow(wrapper)
        const firstPage = wrapper.querySelector<HTMLElement>('section.docx')
        basePageWidthRef.current = firstPage ? firstPage.getBoundingClientRect().width : 0
      }

      setDocxDocument(outlineDoc)
      fitToWidth()
      setStats(countDocxStats(container))
      setLoadState('ready')
    }

    void render().catch((error: unknown) => {
      if (staging) {
        clearDocxContainer(staging)
        staging = null
      }
      if (cancelled) return
      console.error('[WorkbenchDocxPreview] 渲染 Word 文档失败:', error)
      clearDocxContainer(container)
      setDocxDocument(null)
      setLoadError(error instanceof Error ? error.message : String(error))
      setLoadState('error')
    })

    return () => {
      cancelled = true
      if (staging) {
        clearDocxContainer(staging)
        staging = null
      }
      basePageWidthRef.current = 0
      clearDocxContainer(container)
      setDocxDocument(null)
    }
  }, [workspacePath, activeFilePath, oversized, reloadKey, fitToWidth])

  // 右栏展开/折叠或窗口缩放后重算适应宽度（rAF 节流）
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        fitToWidth()
      })
    })
    observer.observe(scroller)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [fitToWidth])

  // 点击字数 chip 以外区域收起统计详情
  useEffect(() => {
    if (!statsOpen) return
    const handleMouseDown = (event: MouseEvent): void => {
      if (statsChipRef.current && !statsChipRef.current.contains(event.target as Node)) {
        setStatsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setStatsOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [statsOpen])

  // Ctrl/Cmd + 滚轮缩放，与 PDF 预览一致：累计滚轮增量换算成步进，避免触控板过于灵敏
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
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
      const steps = Math.trunc(accumulatedDelta / WHEEL_ZOOM_THRESHOLD)
      if (steps === 0) return

      accumulatedDelta -= steps * WHEEL_ZOOM_THRESHOLD
      zoomStep(steps > 0 ? -1 : 1)
    }

    scroller.addEventListener('wheel', handleWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', handleWheel)
  }, [zoomStep])

  const readSelectionInside = useCallback((): string => {
    const container = contentRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return ''
    // 选区跨到文档外时，getSelection 仍会返回整段文本；
    // 以整段 Range 的公共祖先是否在容器内判定，避免把文件树等选区误当作文档内容。
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return ''
    return selection.toString().trim()
  }, [])

  const handleMouseUp = useCallback(() => {
    const text = readSelectionInside()
    lastSelectionRef.current = text
    setSelectedText(text)
  }, [readSelectionInside])

  // 文档内的链接不能在主窗口内导航，否则整个工作台会被替换成目标页。
  // 外链交给系统浏览器；书签锚点在预览容器内滚动。
  const handleLinkClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement | null)?.closest('a')
    const href = anchor?.getAttribute('href')?.trim()
    if (!href) return
    event.preventDefault()

    if (href.startsWith('#')) {
      const target = contentRef.current?.querySelector<HTMLElement>(
        `[id="${CSS.escape(href.slice(1))}"], [name="${CSS.escape(href.slice(1))}"]`
      )
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    if (/^https?:\/\//i.test(href)) void window.api.openBrowserWindow(href)
  }, [])

  // 点到文档外收起快捷气泡；点击气泡自身不算
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (bubbleRef.current?.contains(target)) return
      const container = contentRef.current
      if (container?.contains(target)) {
        // 左键开始新的点选，旧选区不再代表用户意图
        if (event.button === 0) lastSelectionRef.current = ''
        setMenu(null)
        return
      }
      setSelectedText('')
      lastSelectionRef.current = ''
      setMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelectedText('')
        lastSelectionRef.current = ''
        setMenu(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // 只接管本文档内的选区；选区已被折叠时退回最近一次文档内选区。
      const text = readSelectionInside() || lastSelectionRef.current
      if (!text) return
      event.preventDefault()
      event.stopPropagation()
      setSelectedText(text)
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 220),
        y: Math.min(event.clientY, window.innerHeight - 260),
        text
      })
    },
    [readSelectionInside]
  )

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

  const runAction = (text: string, action: WorkbenchAiAction): void => {
    if (!text) return
    askAi(text, action)
    window.getSelection()?.removeAllRanges()
    lastSelectionRef.current = ''
    setSelectedText('')
    setMenu(null)
  }

  const copyText = async (text: string): Promise<void> => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setMenu(null)
  }

  const docxSelectionActions = useMemo(
    () => WORKBENCH_AI_SELECTION_ACTIONS.filter((item) => item.action !== 'mindmap'),
    []
  )

  const headerIconBtnClass = isDark
    ? 'w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#D4D4D4] hover:text-white transition-colors'
    : 'w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors'

  return (
    <div
      className={`flex-1 h-full flex flex-col overflow-hidden ${
        isDark ? 'dark bg-[#1E1E1E]' : 'bg-slate-100 dark:bg-gray-900'
      }`}
      data-reader-theme={isDark ? 'dark' : undefined}
    >
      <style>{`
.docx-preview-content .docx-wrapper {
  background: transparent;
  padding: 0;
  display: grid;
  justify-content: center;
  justify-items: center;
  align-items: start;
  gap: 20px;
  margin: 0 auto;
  width: fit-content;
  min-width: 100%;
}
.docx-preview-content .docx-wrapper > section.docx {
  margin: 0;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12), 0 10px 28px -16px rgba(15, 23, 42, 0.35);
}
`}</style>

      <PreviewHeader
        theme={isDark ? 'dark' : 'light'}
        left={
          <>
            <FileTypeIcon node={docxNode} className="w-[19px] h-[19px]" />
            <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
              {activeFilePath}
            </span>
          </>
        }
        right={
          <>
            <PreviewZoomControls
              theme={isDark ? 'dark' : 'light'}
              zoom={zoom}
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              onZoomOut={() => zoomStep(-1)}
              onZoomIn={() => zoomStep(1)}
              onReset={() => setZoom(1)}
            />

            <WorkbenchReaderThemePicker
              value={docxBackgroundTheme}
              onChange={setDocxBackgroundTheme}
            />

            <div className={`h-5 w-px mx-0.5 ${isDark ? 'bg-white/10' : 'bg-black/10 dark:bg-white/10'}`} />

            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className={headerIconBtnClass}
              title="刷新文档渲染"
            >
              <AppIcon name="refresh" size={19} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className={headerIconBtnClass}
              title="使用系统默认程序打开"
            >
              <AppIcon name="open_in_new" size={19} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void revealFile(activeFilePath)
              }}
              className={headerIconBtnClass}
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
            theme={isDark ? 'dark' : 'light'}
            icon={
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4">
                <FileTypeIcon node={docxNode} className="w-[30px] h-[30px]" />
              </div>
            }
            title="Word 文档超出内嵌预览上限"
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
            theme={isDark ? 'dark' : 'light'}
            icon={<AppIcon name="error" size={24} className="text-rose-400 mb-2" />}
            title="未能渲染这份 Word 文档"
            description={loadError || '文件已损坏或格式不受支持'}
            actionLabel="在本地打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : (
          <div
            ref={scrollRef}
            className="w-full h-full overflow-auto py-6 px-6 wb-docx-viewport transition-colors duration-150"
            data-docx-theme={docxBackgroundTheme}
          >
            <div
              ref={contentRef}
              className="docx-preview-content select-text"
              data-workbench-editor="true"
              onMouseUp={handleMouseUp}
              onClick={handleLinkClick}
              onContextMenu={handleContextMenu}
            />
          </div>
        )}

        {/* 极简原位变形 Word 大纲导航 */}
        {!oversized && loadState === 'ready' && (
          <WorkbenchDocxToc
            document={docxDocument}
            contentRef={contentRef}
            scrollContainerRef={scrollRef}
            loadState={loadState}
          />
        )}

        {loadState === 'loading' && !oversized && (
          <div
            className={`absolute inset-0 flex items-center justify-center text-text-secondary text-body ${
              isDark ? 'bg-[#1E1E1E]/85' : 'bg-slate-100/80 dark:bg-gray-900/80'
            }`}
          >
            <AppIcon name="refresh" size={19} className="animate-spin mr-2" />
            正在渲染文档
          </div>
        )}

        {selectedText && !menu && (
          <div
            ref={bubbleRef}
            // 点击气泡不能抢走文档选区，否则选区折叠后动作拿不到文本
            onMouseDown={(event) => event.preventDefault()}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-dropdown flex items-center gap-1 rounded-full border border-black/5 bg-white/95 px-3 py-1.5 text-label text-text-secondary shadow-float backdrop-blur-md dark:border-white/10 dark:bg-gray-900/90"
          >
            <span className="whitespace-nowrap pr-1 tabular-nums">已选 {selectedText.length} 字</span>
            <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
            <button
              type="button"
              onClick={() => runAction(selectedText, 'ask')}
              className="w-7 h-7 flex items-center justify-center rounded-full text-blue-500 hover:bg-blue-500/10 transition-colors"
              title="发送到 AI 侧边栏"
            >
              <AppIcon name="send" size={16} />
            </button>
            <button
              type="button"
              onClick={() => runAction(selectedText, 'explain')}
              className="w-7 h-7 flex items-center justify-center rounded-full text-purple-500 hover:bg-purple-500/10 transition-colors"
              title="解释此内容"
            >
              <AppIcon name="psychology" size={16} />
            </button>
            <button
              type="button"
              onClick={() => runAction(selectedText, 'summarize')}
              className="w-7 h-7 flex items-center justify-center rounded-full text-cyan-500 hover:bg-cyan-500/10 transition-colors"
              title="提取关键要点"
            >
              <AppIcon name="format_list_bulleted" size={16} />
            </button>
            <button
              type="button"
              onClick={() => void copyText(selectedText)}
              className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title="复制选中文本"
            >
              <AppIcon name="content_copy" size={16} />
            </button>
          </div>
        )}

        {menu && (
          <WorkbenchSelectionMenu
            ref={menuRef}
            x={menu.x}
            y={menu.y}
            items={docxSelectionActions}
            onSelectAction={(action) => {
              if (action !== 'mindmap') runAction(menu.text, action)
            }}
            onCopy={() => void copyText(menu.text)}
          />
        )}

        <div className="absolute bottom-3 right-3 z-dropdown flex items-center gap-2">
          <WorkbenchSendToAiButton />
          {stats && loadState === 'ready' && (
            <div ref={statsChipRef} className="relative">
              <button
                type="button"
                onClick={() => setStatsOpen((open) => !open)}
                className="flex h-9 items-center gap-1 rounded-full border border-black/5 bg-white/85 px-2.5 text-label text-text-secondary shadow-sm backdrop-blur-md transition-colors hover:text-text-primary dark:border-white/10 dark:bg-gray-900/80"
                title="字数统计"
              >
                <AppIcon name="match_word" size={14} />
                <span className="tabular-nums">
                  {selectedText ? `${selectedWords} / ${stats.words.toLocaleString()}` : stats.words.toLocaleString()} 字
                </span>
              </button>
              {statsOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-52 rounded-xl border border-black/10 bg-white/95 p-3 text-label shadow-float backdrop-blur-md dark:border-white/10 dark:bg-gray-900/95 context-menu-animate context-menu-animate-up context-menu-origin-bottom-right">
                  <dl className="space-y-1.5">
                    <div className="flex justify-between">
                      <dt className="text-text-secondary">字数</dt>
                      <dd className="tabular-nums text-text-primary">{stats.words.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-secondary">字符数（不计空格）</dt>
                      <dd className="tabular-nums text-text-primary">{stats.charsNoSpace.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-secondary">字符数（计空格）</dt>
                      <dd className="tabular-nums text-text-primary">{stats.charsWithSpace.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-secondary">段落数</dt>
                      <dd className="tabular-nums text-text-primary">{stats.paragraphs.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-secondary">中文字符</dt>
                      <dd className="tabular-nums text-text-primary">{stats.cjkChars.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-secondary">英文单词</dt>
                      <dd className="tabular-nums text-text-primary">{stats.westernWords.toLocaleString()}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}
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
