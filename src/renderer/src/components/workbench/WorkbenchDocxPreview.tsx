import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Options } from 'docx-preview'
import { DOCX_PREVIEW_MAX_BYTES } from '../../../../shared/types/workbench'
import { useWorkbenchStore, type WorkbenchAiAction } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
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

const ZOOM_MIN = 0.5
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

/**
 * docx-preview 把内嵌图片与字体转成 blob URL；卸载或重渲染前必须回收，
 * 否则每次打开文档都会留下无法释放的 Blob。
 */
function revokeDocxBlobUrls(root: HTMLElement): void {
  root.querySelectorAll('img[src^="blob:"]').forEach((img) => {
    URL.revokeObjectURL((img as HTMLImageElement).src)
  })
  root.querySelectorAll('style').forEach((style) => {
    const matches = style.textContent?.match(/blob:[^)"'\s]+/g)
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
    activeFileOversized || (typeof activeFileSize === 'number' && activeFileSize > DOCX_PREVIEW_MAX_BYTES)

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
   * 按容器宽度缩放整页文档。
   * Word 页宽通常 21cm（约 794px），窄于容器时保持 1:1，避免文字被放大；
   * 适应宽度只缩小不放大，用户手动缩放在此基础上叠加。
   */
  const fitToWidth = useCallback(() => {
    const scroller = scrollRef.current
    const container = contentRef.current
    if (!scroller || !container) return
    // 只处理本次渲染换入的 wrapper，避免匹配到游离节点或残留内容
    const wrapper = Array.from(container.children).find((el) =>
      el.classList.contains('docx-wrapper')
    ) as HTMLElement | undefined
    const page = wrapper?.querySelector<HTMLElement>('section.docx')
    if (!wrapper || !page) return

    // 先归零再量，避免上一次 zoom 影响测量结果
    wrapper.style.zoom = '1'
    // 与容器左右 padding 对齐（px-6 = 24px/侧）
    const available = scroller.clientWidth - 48
    const pageWidth = page.getBoundingClientRect().width
    if (pageWidth <= 0 || available <= 0) return
    wrapper.style.zoom = String(Math.min(1, available / pageWidth) * zoomRef.current)
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
    setLoadState('loading')
    setLoadError('')
    clearDocxContainer(container)

    const render = async (): Promise<void> => {
      const result = await window.api.workbench.readDocxBytes(workspacePath, activeFilePath)
      if (cancelled) return
      if (!result.success || !result.data) {
        throw new Error(result.error || '读取 Word 文档失败')
      }
      const { renderAsync } = await import('docx-preview')
      if (cancelled) return

      // 先让加载态完成一次绘制，再进入同步的 OOXML 解析与 DOM 构建。
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (cancelled) return

      // 渲染到游离节点再整体换入：刷新或切换文件时旧渲染不会追加到新内容上。
      const staging = document.createElement('div')
      const options: Partial<Options> = {
        inWrapper: true,
        breakPages: false,
        // 保留 Word 页宽（ignoreWidth 会把页面压成窄条、正文宽度失真），
        // 渲染后按容器宽度整体缩放，等价于常见的文档预览“适应宽度”。
        ignoreWidth: false,
        ignoreHeight: true,
        renderComments: false,
        renderChanges: false,
        // altChunk 会把文档内嵌的原始 HTML 放进 iframe srcdoc，
        // 等同在宿主页面执行未审查内容；预览不需要该特性，直接关闭。
        renderAltChunks: false
      }
      // renderAsync 返回 parseAsync 产出的 WordDocument，里面保留了
      // OOXML 大纲信息（outlineLevel/style 继承），TOC 靠它识别标题。
      const doc = (await renderAsync(
        result.data.bytes,
        staging,
        staging,
        options
      )) as DocxDocumentLike
      if (cancelled) {
        clearDocxContainer(staging)
        return
      }
      container.replaceChildren(...Array.from(staging.childNodes))
      setDocxDocument(doc)
      fitToWidth()
      setStats(countDocxStats(container))
      setLoadState('ready')
    }

    void render().catch((error: unknown) => {
      if (cancelled) return
      console.error('[WorkbenchDocxPreview] 渲染 Word 文档失败:', error)
      clearDocxContainer(container)
      setDocxDocument(null)
      setLoadError(error instanceof Error ? error.message : String(error))
      setLoadState('error')
    })

    return () => {
      cancelled = true
      clearDocxContainer(container)
      setDocxDocument(null)
    }
  }, [workspacePath, activeFilePath, oversized, reloadKey, fitToWidth])

  // 右栏展开/折叠或窗口缩放后重算适应宽度
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const observer = new ResizeObserver(() => fitToWidth())
    observer.observe(scroller)
    return () => observer.disconnect()
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
  display: block;
}
.docx-preview-content .docx-wrapper > section.docx {
  margin: 0 auto 20px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12), 0 10px 28px -16px rgba(15, 23, 42, 0.35);
}
.docx-preview-content .docx-wrapper > section.docx:last-child { margin-bottom: 0; }
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
                <div className="absolute bottom-full right-0 mb-2 w-52 rounded-xl border border-black/10 bg-white/95 p-3 text-label shadow-float backdrop-blur-md dark:border-white/10 dark:bg-gray-900/95">
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
