import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NoteConversation, NoteNavigation } from '../../../shared/types/notes'
import ConversationMindmapPanel from '../components/ConversationMindmapPanel'
import { generateNoteHighlightScript } from '../../../shared/utils/webviewScripts'
import { normalizeNoteTranscriptMarkdown, parseSnapshotBlocks } from '../../../shared/utils/noteTranscript'
import { handleNoteHighlightClick, closeNotePopover, NOTE_CLICK_PREFIX, NOTE_DISMISS_PREFIX } from '../utils/noteInteractions'
import { useAppStore } from '../store/appStore'

interface OutlineItem {
  id: string
  level: 1 | 2
  title: string
}

function noteOutline(markdown: string): OutlineItem[] {
  let fenced = false
  return markdown.split('\n').flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return []
    }
    if (fenced) return []
    const match = /^(#{1,2})\s+(.+)$/.exec(line)
    if (!match) return []
    return [
      {
        id: `note-heading-${index + 1}`,
        level: match[1].length as 1 | 2,
        title: match[2].replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_`]/g, '').trim()
      }
    ]
  })
}

const DEFAULT_RIGHT_SIDEBAR_WIDTH = 320
const MIN_RIGHT_SIDEBAR_WIDTH = 260
const MAX_RIGHT_SIDEBAR_WIDTH = 520

function getInitialRightSidebarWidth(): number {
  try {
    const saved = localStorage.getItem('notes_right_sidebar_width')
    if (saved) {
      const parsed = parseInt(saved, 10)
      if (!Number.isNaN(parsed) && parsed >= MIN_RIGHT_SIDEBAR_WIDTH && parsed <= MAX_RIGHT_SIDEBAR_WIDTH) {
        return parsed
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_RIGHT_SIDEBAR_WIDTH
}

export default function NotesPage({ initialNavigation }: { initialNavigation?: NoteNavigation }): JSX.Element {
  const models = useAppStore(state => state.models)
  const [conversations, setConversations] = useState<NoteConversation[]>([])
  const [selectedDetail, setSelectedDetail] = useState<NoteConversation | null>(null)
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('all')
  const [contentFilter, setContentFilter] = useState('all')
  const [error, setError] = useState('')
  const [snapshotMissingIds, setSnapshotMissingIds] = useState<string[]>([])

  // 视图控制：中间画布模式（快照 vs 原始网页）
  const [centerView, setCenterView] = useState<'snapshot' | 'webview' | 'mindmap'>('snapshot')
  // 右侧智能面板 Tab（批注列表 vs 目录大纲）
  const [rightTab, setRightTab] = useState<'notes' | 'outline'>('notes')

  // 右侧边栏宽度及调整状态（限制最小与最大宽度）
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(getInitialRightSidebarWidth)
  const [isResizing, setIsResizing] = useState(false)
  const latestWidthRef = useRef(rightSidebarWidth)
  const resizeDragRef = useRef<{
    startX: number
    startWidth: number
    pointerId: number
  } | null>(null)

  useEffect(() => {
    latestWidthRef.current = rightSidebarWidth
  }, [rightSidebarWidth])

  // 窗口大小变化时，保证侧边栏宽度在安全范围内
  useEffect(() => {
    const handleWindowResize = (): void => {
      setRightSidebarWidth(prev => {
        const maxAllowed = Math.min(
          MAX_RIGHT_SIDEBAR_WIDTH,
          Math.max(MIN_RIGHT_SIDEBAR_WIDTH, window.innerWidth - 620)
        )
        return Math.min(prev, maxAllowed)
      })
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  // 拖拽中防止文本选区与改变全局光标
  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      return () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    return undefined
  }, [isResizing])

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    resizeDragRef.current = {
      startX: event.clientX,
      startWidth: rightSidebarWidth,
      pointerId: event.pointerId
    }
    setIsResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = resizeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const deltaX = drag.startX - event.clientX
    const maxAllowed = Math.min(
      MAX_RIGHT_SIDEBAR_WIDTH,
      Math.max(MIN_RIGHT_SIDEBAR_WIDTH, window.innerWidth - 620)
    )
    const nextWidth = Math.max(
      MIN_RIGHT_SIDEBAR_WIDTH,
      Math.min(maxAllowed, drag.startWidth + deltaX)
    )
    latestWidthRef.current = nextWidth
    setRightSidebarWidth(nextWidth)
  }

  const handleResizePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = resizeDragRef.current
    if (drag && drag.pointerId === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
      resizeDragRef.current = null
      setIsResizing(false)
      try {
        localStorage.setItem('notes_right_sidebar_width', String(latestWidthRef.current))
      } catch {
        // ignore
      }
    }
  }

  const handleResizeDoubleClick = (): void => {
    setRightSidebarWidth(DEFAULT_RIGHT_SIDEBAR_WIDTH)
    latestWidthRef.current = DEFAULT_RIGHT_SIDEBAR_WIDTH
    try {
      localStorage.setItem('notes_right_sidebar_width', String(DEFAULT_RIGHT_SIDEBAR_WIDTH))
    } catch {
      // ignore
    }
  }

  const [snapshotNoteId, setSnapshotNoteId] = useState<string | null>(null)
  const [matchedCount, setMatchedCount] = useState<number | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [webviewReady, setWebviewReady] = useState(false)

  // 批注编辑状态
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)

  const webviewRef = useRef<Electron.WebviewTag>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const lastTranscriptFocusRef = useRef('')
  const focusedNoteIdRef = useRef<string | null>(null)

  const reload = async (): Promise<void> => {
    const result = await window.api.notesSummaries()
    if (!result.success) {
      setError(result.error || '读取笔记失败')
      return
    }
    const items = result.data || []
    setConversations(items)
    setSelectedId(current =>
      current && items.some(item => item.id === current) ? current : items[0]?.id || null
    )
    setError('')
  }

  useEffect(() => {
    void reload()
    const onUpdated = (): void => {
      void reload()
    }
    const unsubscribeNotes = window.api.onNotesChanged(onUpdated)
    return unsubscribeNotes
  }, [])

  useEffect(() => {
    let active = true
    if (!selectedId) { setSelectedDetail(null); return }
    void window.api.notesGet(selectedId).then(result => {
      if (!active) return
      if (result.success && result.data) setSelectedDetail(result.data)
      else { setSelectedDetail(null); setError(result.error || '读取笔记正文失败') }
    })
    return () => { active = false }
  }, [selectedId, conversations])
  useEffect(() => {
    let active = true
    if (!query.trim()) { setSearchIds(null); return }
    const timer = setTimeout(() => { void window.api.notesSummaries(query).then(result => {
      if (active && result.success) setSearchIds(new Set((result.data || []).map(item => item.id)))
    }) }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [query, conversations])
  const platforms = useMemo(
    () => Array.from(new Set(conversations.map(item => item.platform))),
    [conversations]
  )

  const visible = useMemo(
    () =>
      conversations.filter(item => {
        if (contentFilter === 'notes' && !item.notes.length) return false
        if (contentFilter === 'mindmaps' && !item.mindmaps.length) return false
        if (platform !== 'all' && item.platform !== platform) return false
        return !query.trim() || !!searchIds?.has(item.id)
      }),
    [conversations, platform, query, contentFilter, searchIds]
  )

  const selected = selectedDetail?.id === selectedId ? selectedDetail : null
  const selectedLogo = models.find(m => m.name.toLowerCase() === selected?.platform.toLowerCase())?.logo

  const activeNote =
    selected?.notes.find(note => note.id === snapshotNoteId) ||
    selected?.notes[selected.notes.length - 1] ||
    null

  focusedNoteIdRef.current = activeNote?.id || null

  const rawSnapshot = selected?.snapshot || ''
  const displaySnapshot = useMemo(
    () => normalizeNoteTranscriptMarkdown(rawSnapshot),
    [rawSnapshot]
  )
  const outline = useMemo(() => noteOutline(displaySnapshot), [displaySnapshot])
  const blocks = useMemo(() => parseSnapshotBlocks(displaySnapshot), [displaySnapshot])

  const focusNote = (noteId: string): void => {
    if (centerView === 'mindmap') setCenterView('snapshot')
    setSnapshotNoteId(noteId)
    setFocusTick(value => value + 1)

    // 如果在快照模式，确保快照可见；如果在 Webview 模式，通过脚本定位
    if (centerView === 'webview' && webviewRef.current && selected) {
      try {
        void webviewRef.current.executeJavaScript(
          generateNoteHighlightScript(selected.notes, noteId)
        )
      } catch {
        /* ignore */
      }
    }
  }

  // 快照文本高亮与滚动联动（利用 CSS Custom Highlight API）
  useEffect(() => {
    const root = transcriptRef.current
    if (!root || !selected || !activeNote?.quote || !CSS.highlights || !window.Highlight) return

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Array<{ node: Node; start: number; end: number }> = []
    let content = ''
    while (walker.nextNode()) {
      const node = walker.currentNode
      const value = node.textContent || ''
      nodes.push({ node, start: content.length, end: content.length + value.length })
      content += value
    }

    const matches = selected.notes.flatMap(note => {
      const quote = note.quote.trim()
      let startAt = content.indexOf(quote)
      let endAt = startAt + quote.length
      if (startAt < 0) {
        const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
        const match = new RegExp(escaped).exec(content)
        if (match) {
          startAt = match.index
          endAt = match.index + match[0].length
        }
      }
      if (startAt < 0) return []
      const start = nodes.find(item => item.start <= startAt && startAt < item.end)
      const end = nodes.find(item => item.start < endAt && endAt <= item.end)
      if (!start || !end) return []
      const range = document.createRange()
      range.setStart(start.node, startAt - start.start)
      range.setEnd(end.node, endAt - end.start)
      return [{ note, range }]
    })

    CSS.highlights.set('multichat-local-note', new Highlight(...matches.map(item => item.range)))
    setSnapshotMissingIds(selected.notes.filter(note => !matches.some(match => match.note.id === note.id)).map(note => note.id))

    const focused = matches.find(item => item.note.id === activeNote.id)
    if (focused) {
      CSS.highlights.set('multichat-local-note-focus', new Highlight(focused.range))
    } else {
      CSS.highlights.delete('multichat-local-note-focus')
    }

    const focusKey = `${selected.id}:${activeNote.id}:${focusTick}`
    if (focused && lastTranscriptFocusRef.current !== focusKey) {
      lastTranscriptFocusRef.current = focusKey
      focused.range.startContainer.parentElement?.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
      })
    }

    const onClick = (event: MouseEvent): void => {
      const hit = matches.find(item =>
        Array.from(item.range.getClientRects()).some(
          rect =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
        )
      )
      if (hit) {
        focusNote(hit.note.id)
        setRightTab('notes')
      }
    }

    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      CSS.highlights.delete('multichat-local-note')
      CSS.highlights.delete('multichat-local-note-focus')
    }
  }, [selected, activeNote?.id, focusTick, centerView, displaySnapshot])

  useEffect(() => {
    if (!initialNavigation || !conversations.some(item => item.id === initialNavigation.conversationId)) return
    setSelectedId(initialNavigation.conversationId)
    setQuery(''); setPlatform('all'); setContentFilter('all')
    setCenterView(initialNavigation.mindmapId ? 'mindmap' : 'snapshot')
  }, [initialNavigation, conversations.length])

  // 保存评论
  const saveComment = async (noteId: string): Promise<void> => {
    if (!selected || commentSaving) return
    setCommentSaving(true)
    const result = await window.api.notesUpdate(selected.id, noteId, commentDraft.trim())
    setCommentSaving(false)
    if (!result.success) {
      setError(result.error || '保存评论失败')
      return
    }
    setEditingNoteId(null)
    await reload()
  }

  // 删除单条笔记
  const remove = async (noteId: string): Promise<void> => {
    if (!selected || !window.confirm('确定删除这条笔记吗？')) return
    const result = await window.api.notesDelete(selected.id, noteId)
    if (!result.success) {
      setError(result.error || '删除失败')
      return
    }
    if (snapshotNoteId === noteId) {
      setSnapshotNoteId(null)
    }
    await reload()
  }

  // 导出笔记
  const handleExport = async (): Promise<void> => {
    const result = await window.api.notesExport()
    if (!result.success) {
      setError(result.error || '导出失败')
    }
  }

  // Webview 事件监听与高亮注入
  useEffect(() => {
    if (!selected || !webviewRef.current) return
    const webview = webviewRef.current
    const retryTimers: Array<ReturnType<typeof setTimeout>> = []

    const applyHighlights = (): void => {
      try {
        const script = generateNoteHighlightScript(selected.notes, focusedNoteIdRef.current || undefined)
        void webview
          .executeJavaScript(script)
          .then((result: { matched?: number }) => {
            setMatchedCount(result?.matched ?? 0)
          })
          .catch(() => setMatchedCount(null))
      } catch {
        setMatchedCount(null)
      }
    }

    const onReady = (): void => {
      retryTimers.splice(0).forEach(clearTimeout)
      setWebviewReady(true)
      try {
        void webview
          .insertCSS(
            '::highlight(multichat-notes){background:#fde68a;color:inherit}::highlight(multichat-note-focus){background:#fbbf24;color:inherit}'
          )
          .catch(() => undefined)
      } catch {
        /* ignore */
      }
      applyHighlights()
      retryTimers.push(setTimeout(applyHighlights, 1500), setTimeout(applyHighlights, 4000))
    }

    const onConsole = (event: Electron.ConsoleMessageEvent): void => {
      if (event.message.startsWith(NOTE_DISMISS_PREFIX)) {
        closeNotePopover()
        return
      }
      if (event.message.startsWith(NOTE_CLICK_PREFIX)) {
        void handleNoteHighlightClick(webview, event.message)
      }
    }

    webview.addEventListener('dom-ready', onReady)
    webview.addEventListener('did-navigate-in-page', onReady)
    webview.addEventListener('console-message', onConsole)
    return () => {
      retryTimers.forEach(clearTimeout)
      webview.removeEventListener('dom-ready', onReady)
      webview.removeEventListener('did-navigate-in-page', onReady)
      webview.removeEventListener('console-message', onConsole)
    }
  }, [selected?.id, selected?.notes])

  // 当聚焦的笔记变化时，通知 Webview 重新定位高亮
  useEffect(() => {
    if (!webviewReady || !selected || !webviewRef.current) return
    try {
      void webviewRef.current
        .executeJavaScript(
          generateNoteHighlightScript(selected.notes, activeNote?.id || undefined)
        )
        .then((result: { matched?: number }) => setMatchedCount(result?.matched ?? 0))
        .catch(() => undefined)
    } catch {
      setWebviewReady(false)
    }
  }, [activeNote?.id, webviewReady, selected?.notes])

  // 点击大纲项：若处于 Webview 则切回快照并顺滑定位
  const handleOutlineClick = (headingId: string): void => {
    if (centerView !== 'snapshot') {
      setCenterView('snapshot')
    }
    setTimeout(() => {
      document.getElementById(headingId)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 80)
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-transparent text-text-primary select-none">
      {/* 左侧栏：笔记会话列表 */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-gray-200/70 bg-white/75 backdrop-blur-md">
        {/* 顶部操作区 */}
        <div className="border-b border-gray-200/70 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">edit_note</span>
              <h1 className="text-base font-semibold text-text-primary">我的笔记</h1>
            </div>
            <button
              type="button"
              onClick={() => void handleExport()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-white/80 hover:text-primary transition-all duration-150"
              title="导出全部笔记到本地文件"
            >
              <span className="material-symbols-outlined text-base">ios_share</span>
              <span>导出</span>
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative mt-3">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-base">
              search
            </span>
            <input
              className="w-full rounded-xl border border-gray-200/80 bg-white/90 pl-9 pr-8 py-2 text-sm text-text-primary placeholder:text-gray-400 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="搜索标题、批注或导图..."
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
          </div>

          {/* 平台筛选 */}
          <div className="flex gap-1 mt-2 text-xs">
            {[['all', '全部'], ['notes', '有批注'], ['mindmaps', '有导图']].map(([value, label]) => <button key={value} onClick={() => setContentFilter(value)} className={`px-2 py-1 rounded ${contentFilter === value ? 'bg-primary/10 text-primary' : 'text-gray-500'}`}>{label}</button>)}
          </div>
          <div className="mt-2.5">
            <select
              className="w-full rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2 text-sm text-text-secondary outline-none focus:border-primary cursor-pointer transition-colors"
              value={platform}
              onChange={event => setPlatform(event.target.value)}
            >
              <option value="all">全部平台 ({conversations.length})</option>
              {platforms.map(item => (
                <option key={item} value={item}>
                  {item} ({conversations.filter(c => c.platform === item).length})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 会话卡片列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {visible.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <span className="material-symbols-outlined text-gray-300 text-4xl mb-2">
                content_paste_off
              </span>
              <p className="text-xs text-text-secondary leading-relaxed">
                {conversations.length
                  ? '未找到匹配的会话内容'
                  : '还没有笔记。在对话窗口中选中文字右键，即可记为笔记。'}
              </p>
            </div>
          )}

          {visible.map(item => {
            const isSelected = selectedId === item.id
            const logo = models.find(m => m.name.toLowerCase() === item.platform.toLowerCase())?.logo

            return (
              <div
                key={item.id}
                className={`group rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden ${
                  isSelected
                    ? 'border-primary/50 bg-white shadow-soft ring-2 ring-primary/20'
                    : 'border-gray-200/70 bg-white/60 hover:bg-white/90 hover:border-gray-300/80 hover:shadow-xs'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id)
                    setSnapshotNoteId(null)
                  }}
                  className="w-full p-3 text-left block"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {logo && (
                        <img
                          src={logo}
                          alt=""
                          className="h-4.5 w-4.5 shrink-0 rounded-full object-contain p-0.5 bg-gray-50 border border-gray-100"
                        />
                      )}
                      <span className="text-xs font-medium text-text-secondary truncate">
                        {item.platform}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        · {item.notes.length} 条批注 · {item.mindmaps.length} 份导图
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div
                    className={`line-clamp-2 text-sm leading-snug transition-colors ${
                      isSelected ? 'text-primary font-semibold' : 'text-text-primary font-medium'
                    }`}
                  >
                    {item.title}
                  </div>
                </button>

                {/* 选中态下的划词快速索引列表 */}
                {isSelected && item.notes.length > 0 && (
                  <div className="border-t border-gray-100 bg-gray-50/50 p-2 space-y-1">
                    {item.notes.map((note, index) => {
                      const isNoteActive = activeNote?.id === note.id
                      return (
                        <div
                          key={note.id}
                          className={`group/note flex items-start gap-1 p-2 rounded-lg transition-colors ${
                            isNoteActive
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'hover:bg-white text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => focusNote(note.id)}
                            className="min-w-0 flex-1 flex items-start gap-1.5 text-left"
                            title="点击在正文中定位"
                          >
                            <span className="text-xs font-bold shrink-0 mt-0.5 text-primary">
                              {index + 1}.
                            </span>
                            <span className="line-clamp-2 flex-1 text-xs leading-relaxed break-words">
                              {note.quote}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void remove(note.id)
                            }}
                            className="opacity-0 group-hover/note:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-all shrink-0 mt-0.5"
                            title="删除该笔记"
                            aria-label={`删除笔记 ${index + 1}`}
                          >
                            <span className="material-symbols-outlined text-base">delete</span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>

      {/* 中间主内容区（精读快照 vs 原始网页） */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        {error && (
          <div className="m-3 flex items-center justify-between rounded-xl border border-red-200 bg-red-50/90 px-4 py-2.5 text-xs text-red-600 shadow-xs">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="text-xs text-red-400 hover:text-red-700"
            >
              关闭
            </button>
          </div>
        )}

        {!selected && (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <span className="material-symbols-outlined text-5xl text-gray-300 mb-3">
              auto_stories
            </span>
            <p className="text-sm font-medium text-text-primary">选择左侧会话查看笔记详情</p>
            <p className="mt-1 text-xs text-text-secondary">
              支持查看提炼快照或随时切入原始网页核对上下文
            </p>
          </div>
        )}

        {selected && (
          <>
            {/* 中栏顶部 Header 与视图切换器 */}
            <header className="shrink-0 h-16 border-b border-gray-200/70 bg-white/75 backdrop-blur-md px-6 flex items-center justify-between gap-4">
              <div className="min-w-0 flex items-center gap-3">
                {selectedLogo && (
                  <img
                    src={selectedLogo}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full object-contain p-1 bg-white border border-gray-200/80 shadow-xs"
                  />
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-text-primary">
                    {selected.title}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-text-secondary">
                    {selected.platform} · {selected.notes.length} 条批注 · {selected.mindmaps.length} 份导图 · 最近更新于{' '}
                    {new Date(selected.updatedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* 分段选择器：[ 本地快照 ] / [ 原始网页 ] */}
              <div className="flex items-center p-1 bg-gray-100/80 rounded-xl border border-gray-200/60 shadow-xs">
                <button type="button" onClick={() => setCenterView('mindmap')} className={`px-3 py-1.5 rounded-lg text-sm ${centerView === 'mindmap' ? 'bg-white text-primary shadow-xs' : 'text-text-secondary'}`}>思维导图 ({selected.mindmaps.length})</button>
                <button
                  type="button"
                  onClick={() => setCenterView('snapshot')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    centerView === 'snapshot'
                      ? 'bg-white text-primary shadow-xs'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">article</span>
                  <span>本地快照</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCenterView('webview')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    centerView === 'webview'
                      ? 'bg-white text-primary shadow-xs'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">open_in_browser</span>
                  <span>原始网页</span>
                  {matchedCount !== null && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-xs bg-primary/10 text-primary font-semibold">
                      {matchedCount}
                    </span>
                  )}
                </button>
              </div>
            </header>

            {/* 快照视图：居中纸白卡片排版 */}
            <div className="flex-1 min-h-0" style={{ display: centerView === 'mindmap' ? 'block' : 'none' }}>
              {centerView === 'mindmap' && <ConversationMindmapPanel key={selected.id} conversation={selected} initialMapId={initialNavigation?.conversationId === selected.id ? initialNavigation.mindmapId : undefined} />}
            </div>
            <div
              ref={transcriptScrollRef}
              className="flex-1 overflow-y-auto px-6 py-6"
              style={{ display: centerView === 'snapshot' ? 'block' : 'none' }}
            >
              {activeNote && snapshotMissingIds.includes(activeNote.id) && <p className="mb-3 text-xs text-amber-700">当前共享快照中未找到这条批注的原文，引用和评论仍保留在右侧。</p>}
              <div className="mx-auto max-w-3xl">
                <div
                  ref={transcriptRef}
                  className="rounded-2xl border border-white/90 bg-white/95 p-8 shadow-soft text-sm text-text-primary select-text"
                >
                  {blocks.map((block, bIdx) => {
                    if (block.type === 'user') {
                      return (
                        <div
                          key={`user-${bIdx}-${block.startLine}`}
                          className="my-5 rounded-2xl border border-blue-200/80 bg-blue-50/70 p-4 sm:p-5 shadow-xs"
                        >
                          <div className="flex items-center justify-between gap-2 mb-2.5">
                            <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-700">
                              <span className="material-symbols-outlined text-lg text-blue-600">
                                account_circle
                              </span>
                              <span>你说</span>
                            </div>
                            {block.time && (
                              <span className="text-xs text-blue-500/80 font-medium">
                                {block.time}
                              </span>
                            )}
                          </div>
                          <div className="text-sm leading-relaxed text-slate-800 font-medium whitespace-pre-wrap select-text">
                            {block.content}
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div key={`content-${bIdx}-${block.startLine}`} className="my-5 first:mt-0">
                        {block.type === 'assistant' && (
                          <div className="flex items-center gap-2 mb-3 mt-6 first:mt-2 text-sm font-semibold text-gray-800">
                            {selectedLogo ? (
                              <img
                                src={selectedLogo}
                                alt=""
                                className="w-6 h-6 rounded-full object-contain p-0.5 bg-white border border-gray-200 shadow-2xs"
                              />
                            ) : (
                              <span className="material-symbols-outlined text-xl text-primary">
                                smart_toy
                              </span>
                            )}
                            <span>{selected.platform} 回复</span>
                          </div>
                        )}
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ node, children }) => {
                              const originalLine = block.startLine + (node?.position?.start.line || 1) - 1
                              return (
                                <h1
                                  id={`note-heading-${originalLine}`}
                                  className="text-xl font-bold text-gray-900 border-b border-gray-200/80 pb-2 mb-4 mt-6 first:mt-0"
                                >
                                  {children}
                                </h1>
                              )
                            },
                            h2: ({ node, children }) => {
                              const originalLine = block.startLine + (node?.position?.start.line || 1) - 1
                              return (
                                <h2
                                  id={`note-heading-${originalLine}`}
                                  className="text-base font-semibold text-gray-800 mb-3 mt-6 border-l-2 border-primary/70 pl-3"
                                >
                                  {children}
                                </h2>
                              )
                            },
                            p: ({ children }) => (
                              <p className="leading-relaxed text-gray-700 my-3">{children}</p>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-4 border-gray-300 bg-gray-50/80 rounded-r-lg px-4 py-2.5 my-3 text-gray-600">
                                {children}
                              </blockquote>
                            ),
                            code: ({ children }) => (
                              <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 font-mono text-xs border border-gray-200/60">
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs font-mono my-3 overflow-x-auto shadow-xs">
                                {children}
                              </pre>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside space-y-1.5 my-3 text-gray-700">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-inside space-y-1.5 my-3 text-gray-700">
                                {children}
                              </ol>
                            )
                          }}
                        >
                          {block.content}
                        </ReactMarkdown>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Webview 视图：原网页实时嵌入（常驻保持挂载） */}
            <div
              className="flex-1 flex-col min-h-0 bg-white"
              style={{ display: centerView === 'webview' ? 'flex' : 'none' }}
            >
              {/* Webview 状态子提示条 */}
              <div className="h-9 px-4 bg-gray-50/90 border-b border-gray-200/60 flex items-center justify-between text-xs text-text-secondary shrink-0">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                  <span className="truncate">
                    {matchedCount === null
                      ? '正在网页中检索并定位高亮…'
                      : matchedCount === 0
                      ? '未在当前网页找到原文段落（可能对话较长需要滚动）'
                      : `已在原网页中自动标出 ${matchedCount} 处划词`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (webviewRef.current) {
                      setMatchedCount(null)
                      webviewRef.current.reload()
                    }
                  }}
                  className="hover:text-primary flex items-center gap-1.5 shrink-0 ml-3 text-xs font-medium"
                  title="刷新原网页"
                >
                  <span className="material-symbols-outlined text-base">refresh</span>
                  <span>刷新页面</span>
                </button>
              </div>

              {/* 真实 Webview */}
              <webview
                key={selected.id}
                ref={webviewRef}
                src={selected.url || 'about:blank'}
                partition="persist:shared"
                className={`flex-1 w-full h-full ${isResizing ? 'pointer-events-none' : ''}`}
              />
            </div>
          </>
        )}
      </section>

      {/* 右侧栏：智能检查器（大纲与批注二合一） */}
      {selected && (
        <>
          {/* 侧边栏宽度调节手柄 */}
          <div
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            title="拖拽调整侧边栏宽度（双击恢复默认）"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            onDoubleClick={handleResizeDoubleClick}
            className={`group relative flex w-1.5 shrink-0 cursor-col-resize items-stretch justify-center select-none z-10 transition-colors ${
              isResizing ? 'bg-primary/20' : 'hover:bg-primary/10 active:bg-primary/20'
            }`}
          >
            <div
              className={`w-px h-full transition-colors ${
                isResizing ? 'bg-primary' : 'bg-gray-200/70 group-hover:bg-primary'
              }`}
            />
          </div>

          <aside
            style={{ width: `${rightSidebarWidth}px` }}
            className="flex shrink-0 flex-col bg-white/75 backdrop-blur-md"
            aria-label="智能面板"
          >
          {/* 顶部 Tab 切换器 */}
          <div className="h-16 px-4 flex items-center shrink-0">
            <div className="flex w-full p-1 bg-gray-100/80 rounded-xl border border-gray-200/60 shadow-xs">
              <button
                type="button"
                onClick={() => setRightTab('notes')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                  rightTab === 'notes'
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-lg">comment</span>
                <span>批注 ({selected.notes.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setRightTab('outline')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                  rightTab === 'outline'
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-lg">format_list_bulleted</span>
                <span>目录</span>
              </button>
            </div>
          </div>

          {/* Tab 1: 批注与笔记列表 */}
          {rightTab === 'notes' && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {selected.notes.length === 0 && (
                <div className="py-12 px-4 text-center text-xs text-text-secondary">
                  <span className="material-symbols-outlined text-gray-300 text-3xl mb-1 block">
                    chat_bubble_outline
                  </span>
                  暂无批注记录
                </div>
              )}

              {selected.notes.map(note => {
                const isFocused = activeNote?.id === note.id
                const isEditing = editingNoteId === note.id

                return (
                  <div
                    key={note.id}
                    className={`rounded-xl border p-3.5 transition-all duration-200 ${
                      isFocused
                        ? 'border-primary/60 bg-white shadow-soft ring-2 ring-primary/20'
                        : 'border-gray-200/80 bg-white/80 hover:bg-white hover:border-gray-300 shadow-2xs'
                    }`}
                  >
                    {/* 引文内容：完整展示，点击定位 */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => focusNote(note.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') focusNote(note.id)
                      }}
                      className="cursor-pointer rounded-lg border-l-4 border-primary/60 bg-gray-50/90 p-3 text-sm text-slate-800 leading-relaxed hover:bg-blue-50/40 transition-colors whitespace-pre-wrap break-words"
                      title="点击在正文或网页中定位"
                    >
                      {note.quote}
                    </div>

                    {/* 评论展示（非编辑态） */}
                    {note.comment && !isEditing && (
                      <div className="mt-2.5 rounded-lg bg-gray-50/80 p-2.5 border border-gray-100">
                        <p className="whitespace-pre-wrap break-words text-sm text-gray-800 leading-relaxed">
                          {note.comment}
                        </p>
                      </div>
                    )}

                    {/* 评论编辑区（编辑态） */}
                    {isEditing ? (
                      <div className="mt-2.5 space-y-2">
                        <textarea
                          autoFocus
                          className="min-h-20 w-full resize-y rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:border-primary bg-white leading-relaxed"
                          placeholder="写下你的思考或评论…"
                          value={commentDraft}
                          onChange={e => setCommentDraft(e.target.value)}
                        />
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => void remove(note.id)}
                            className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1 font-medium"
                            title="删除该笔记"
                          >
                            <span className="material-symbols-outlined text-base">delete</span>
                            <span>删除</span>
                          </button>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
                              onClick={() => {
                                setEditingNoteId(null)
                                setCommentDraft('')
                              }}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={commentSaving}
                              className="rounded-lg bg-primary px-3.5 py-1.5 text-sm text-white disabled:opacity-50 font-medium"
                              onClick={() => void saveComment(note.id)}
                            >
                              {commentSaving ? '保存中…' : '保存'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* 底部操作行：添加/修改评论 与 右对齐删除按钮 */
                      <div className="mt-3 flex items-center justify-between pt-0.5">
                        {note.comment ? (
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
                            onClick={() => {
                              setEditingNoteId(note.id)
                              setCommentDraft(note.comment)
                            }}
                          >
                            <span className="material-symbols-outlined text-base">edit</span>
                            <span>修改评论</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNoteId(note.id)
                              setCommentDraft('')
                            }}
                            className="text-xs text-text-secondary hover:text-primary font-medium flex items-center gap-1 transition-colors"
                          >
                            <span className="material-symbols-outlined text-base">add_comment</span>
                            <span>添加评论</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void remove(note.id)}
                          className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors flex items-center gap-1"
                          title="删除该笔记"
                          aria-label="删除笔记"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                          <span>删除</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Tab 2: 目录大纲 */}
          {rightTab === 'outline' && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-1">
              {outline.length === 0 && (
                <div className="py-12 px-4 text-center text-xs text-text-secondary">
                  <span className="material-symbols-outlined text-gray-300 text-3xl mb-1 block">
                    toc
                  </span>
                  本篇对话暂无一级或二级标题
                </div>
              )}
              {outline.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`block w-full truncate rounded-lg px-3 py-2 text-left transition-colors hover:bg-blue-50/80 hover:text-primary ${
                    item.level === 1 ? 'font-semibold text-text-primary text-sm' : 'pl-6 text-xs text-text-secondary'
                  }`}
                  title={item.title}
                  onClick={() => handleOutlineClick(item.id)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
        </aside>
        </>
      )}
    </div>
  )
}
