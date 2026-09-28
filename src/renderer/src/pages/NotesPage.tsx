import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NoteConversation } from '../../../shared/types/notes'
import { generateNoteHighlightScript } from '../../../shared/utils/webviewScripts'
import { handleNoteHighlightClick, NOTE_CLICK_PREFIX } from '../utils/noteInteractions'
import { useAppStore } from '../store/appStore'

interface OutlineItem { id: string; level: 1 | 2; title: string }

function noteOutline(markdown: string): OutlineItem[] {
  let fenced = false
  return markdown.split('\n').flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return [] }
    if (fenced) return []
    const match = /^(#{1,2})\s+(.+)$/.exec(line)
    if (!match) return []
    return [{ id: `note-heading-${index + 1}`, level: match[1].length as 1 | 2, title: match[2].replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_`]/g, '').trim() }]
  })
}

export default function NotesPage(): JSX.Element {
  const models = useAppStore(state => state.models)
  const [conversations, setConversations] = useState<NoteConversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('all')
  const [error, setError] = useState('')
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null)
  const [showSnapshot, setShowSnapshot] = useState(true)
  const [snapshotNoteId, setSnapshotNoteId] = useState<string | null>(null)
  const [matchedCount, setMatchedCount] = useState<number | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [drawerReady, setDrawerReady] = useState(false)
  const [commentEditing, setCommentEditing] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [annotationTop, setAnnotationTop] = useState(0)
  const [annotationVisible, setAnnotationVisible] = useState(false)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const commentRailRef = useRef<HTMLDivElement>(null)
  const lastTranscriptFocusRef = useRef('')
  const focusedNoteIdRef = useRef<string | null>(null)
  focusedNoteIdRef.current = drawerNoteId

  const reload = async (): Promise<void> => {
    const result = await window.api.notesList()
    if (!result.success) { setError(result.error || '读取笔记失败'); return }
    const items = result.data || []
    setConversations(items)
    setSelectedId(current => current && items.some(item => item.id === current) ? current : items[0]?.id || null)
    setError('')
  }

  useEffect(() => {
    void reload()
    const onUpdated = (): void => { void reload() }
    const unsubscribeNotes = window.api.onNotesChanged(onUpdated)
    return unsubscribeNotes
  }, [])

  const platforms = useMemo(() => Array.from(new Set(conversations.map(item => item.platform))), [conversations])
  const visible = useMemo(() => conversations.filter(item => {
    if (platform !== 'all' && item.platform !== platform) return false
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return [item.title, item.platform, ...item.notes.flatMap(note => [note.quote, note.comment])]
      .some(value => value.toLowerCase().includes(needle))
  }), [conversations, platform, query])
  const selected = conversations.find(item => item.id === selectedId) || null
  const platformLogo = models.find(model => model.name === selected?.platform)?.logo
  const drawerOpen = drawerNoteId !== null
  const activeNote = selected?.notes.find(note => note.id === snapshotNoteId) || selected?.notes[selected.notes.length - 1] || null
  const displaySnapshot = activeNote?.snapshot || ''
  const outline = useMemo(() => noteOutline(displaySnapshot), [displaySnapshot])
  const focusNote = (noteId: string): void => {
    setSnapshotNoteId(noteId)
    setShowSnapshot(true)
    setFocusTick(value => value + 1)
  }

  useEffect(() => {
    setCommentDraft(activeNote?.comment || '')
    setCommentEditing(false)
  }, [activeNote?.id, activeNote?.comment])

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
        if (match) { startAt = match.index; endAt = match.index + match[0].length }
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
    const focused = matches.find(item => item.note.id === activeNote.id)
    const focusKey = `${selected.id}:${activeNote.id}:${focusTick}`
    if (focused && lastTranscriptFocusRef.current !== focusKey) {
      lastTranscriptFocusRef.current = focusKey
      focused.range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    const updateAnnotationPosition = (): void => {
      const rail = commentRailRef.current
      if (!focused || !rail || drawerOpen) { setAnnotationVisible(false); return }
      const highlightRect = focused.range.getBoundingClientRect()
      const railRect = rail.getBoundingClientRect()
      setAnnotationVisible(highlightRect.bottom > railRect.top && highlightRect.top < railRect.bottom)
      setAnnotationTop(Math.max(12, Math.min(highlightRect.top - railRect.top, rail.clientHeight - 260)))
    }
    updateAnnotationPosition()
    const scroll = transcriptScrollRef.current
    scroll?.addEventListener('scroll', updateAnnotationPosition, { passive: true })
    window.addEventListener('resize', updateAnnotationPosition)
    const onClick = (event: MouseEvent): void => {
      const hit = matches.find(item => Array.from(item.range.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom))
      if (hit) focusNote(hit.note.id)
    }
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      scroll?.removeEventListener('scroll', updateAnnotationPosition)
      window.removeEventListener('resize', updateAnnotationPosition)
      CSS.highlights.delete('multichat-local-note')
    }
  }, [selected, activeNote?.id, activeNote?.snapshot, showSnapshot, focusTick, drawerOpen])

  const saveComment = async (): Promise<void> => {
    if (!selected || !activeNote || commentSaving) return
    setCommentSaving(true)
    const result = await window.api.notesUpdate(selected.id, activeNote.id, commentDraft.trim())
    setCommentSaving(false)
    if (!result.success) { setError(result.error || '保存评论失败'); return }
    setCommentEditing(false)
    await reload()
  }

  const remove = async (noteId: string): Promise<void> => {
    if (!selected || !window.confirm('确定删除这条笔记吗？')) return
    const result = await window.api.notesDelete(selected.id, noteId)
    if (!result.success) { setError(result.error || '删除失败'); return }
    if (drawerNoteId === noteId) { setDrawerNoteId(null); setDrawerReady(false) }
    await reload()
  }

  useEffect(() => {
    if (!drawerNoteId || !selected || !webviewRef.current) return
    const webview = webviewRef.current
    const retryTimers: Array<ReturnType<typeof setTimeout>> = []
    const applyHighlights = (): void => {
      try {
        const script = generateNoteHighlightScript(selected.notes, focusedNoteIdRef.current || undefined)
        void webview.executeJavaScript(script).then((result: { matched?: number }) => {
          setMatchedCount(result?.matched ?? 0)
        }).catch(() => setMatchedCount(null))
      } catch {
        setMatchedCount(null)
      }
    }
    const onReady = (): void => {
      retryTimers.splice(0).forEach(clearTimeout)
      setDrawerReady(true)
      try {
        void webview.insertCSS('::highlight(multichat-notes){background:#fff176;color:inherit}::highlight(multichat-note-focus){background:#fff176;color:inherit}').catch(() => undefined)
      } catch { /* 页面导航期间 Webview 可能尚未就绪 */ }
      applyHighlights()
      retryTimers.push(setTimeout(applyHighlights, 1500), setTimeout(applyHighlights, 4000))
    }
    const onConsole = (event: Electron.ConsoleMessageEvent): void => {
      if (event.message.startsWith(NOTE_CLICK_PREFIX)) void handleNoteHighlightClick(webview, event.message)
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
  }, [selected?.id, selected?.notes, drawerOpen])

  useEffect(() => {
    if (!drawerNoteId || !drawerReady || !selected || !webviewRef.current) return
    try {
      void webviewRef.current.executeJavaScript(generateNoteHighlightScript(selected.notes, drawerNoteId))
        .then((result: { matched?: number }) => setMatchedCount(result?.matched ?? 0))
        .catch(() => undefined)
    } catch {
      setDrawerReady(false)
    }
  }, [drawerNoteId, drawerReady, selected?.notes])

  return <div className="flex h-full overflow-hidden bg-white text-text-primary">
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-gray-200 bg-sidebar/40">
      <div className="border-b border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between"><h1 className="text-lg font-semibold">笔记</h1><button type="button" className="text-xs text-primary hover:underline" onClick={() => { void window.api.notesExport().then(result => { if (!result.success) setError(result.error || '导出失败') }) }}>导出</button></div>
        <input className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary" placeholder="搜索原文、我的笔记或对话" value={query} onChange={event => setQuery(event.target.value)} />
        <select className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" value={platform} onChange={event => setPlatform(event.target.value)}>
          <option value="all">全部平台</option>
          {platforms.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {visible.length === 0 && <p className="p-4 text-sm text-text-secondary">{conversations.length ? '没有匹配的会话' : '还没有笔记。在对话中划词并右键，即可记下重点。'}</p>}
        {visible.map(item => <div key={item.id} className={`mb-2 rounded-xl border ${selectedId === item.id ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white'}`}>
          <button type="button" onClick={() => { setSelectedId(item.id); setShowSnapshot(true); setSnapshotNoteId(null); setDrawerNoteId(null); setDrawerReady(false) }} className="w-full p-3 text-left">
            <div className="line-clamp-2 text-sm font-medium">{item.title}</div>
            <div className="mt-2 flex justify-between text-xs text-text-secondary"><span>{item.platform} · {item.notes.length} 条笔记</span><span>{new Date(item.updatedAt).toLocaleDateString()}</span></div>
          </button>
          {selectedId === item.id && <div className="space-y-1 border-t border-blue-100 px-2 py-2">
            {item.notes.map((note, index) => <div key={note.id} className="flex items-start gap-1 rounded-lg hover:bg-white/70">
              <button type="button" className="min-w-0 flex-1 p-2 text-left text-xs" onClick={() => focusNote(note.id)}><span className="mr-1 text-primary">{index + 1}.</span><span className="line-clamp-2 bg-[#fff176]">{note.quote}</span>{note.comment && <span className="mt-1 block truncate text-text-secondary">评论：{note.comment}</span>}</button>
              <button type="button" className="shrink-0 p-2 text-xs text-text-secondary hover:text-red-600" aria-label={`删除笔记 ${index + 1}`} onClick={() => void remove(note.id)}>删除</button>
            </div>)}
          </div>}
        </div>)}
      </div>
    </aside>
    <nav className="w-[170px] shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50/70 p-3" aria-label="对话目录">
      <h3 className="mb-3 text-xs font-semibold text-text-secondary">对话目录</h3>
      {outline.length === 0 && <p className="text-xs text-text-secondary">暂无一级或二级标题</p>}
      {outline.map(item => <button key={item.id} type="button" className={`mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-blue-50 ${item.level === 1 ? 'font-semibold' : 'pl-4 text-text-secondary'}`} title={item.title} onClick={() => document.getElementById(item.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{item.title}</button>)}
    </nav>
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-gray-200">
      {error && <p className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {!selected && <p className="mt-16 text-center text-text-secondary">选择左侧会话查看笔记</p>}
      {selected && <>
        <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-start justify-between gap-4">
            <div className="min-w-0"><h2 className="truncate text-xl font-semibold">{selected.title}</h2><p className="mt-1 text-xs text-text-secondary">{selected.platform} · {selected.notes.length} 条笔记 · 最近保存于 {new Date(selected.updatedAt).toLocaleString()}</p></div>
            <button type="button" className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-primary" onClick={() => { setDrawerReady(false); setDrawerNoteId(activeNote?.id || null); setMatchedCount(null) }}>{drawerOpen ? '原对话已打开' : '查看原对话'}</button>
          </div>
        </header>
        <div ref={transcriptScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-3xl">
        {showSnapshot && <div ref={transcriptRef} className="prose max-w-none rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          h1: ({ node, children }) => <h1 id={`note-heading-${node?.position?.start.line || 0}`}>{children}</h1>,
          h2: ({ node, children }) => <h2 id={`note-heading-${node?.position?.start.line || 0}`}>{children}</h2>
        }}>{displaySnapshot}</ReactMarkdown></div>}
        </div></div>
      </>}
    </section>
    {!drawerOpen && selected && <aside className="flex h-full w-[275px] shrink-0 flex-col bg-white" aria-label="笔记评论">
      <div className="h-[72px] shrink-0 border-b border-gray-200" />
      <div ref={commentRailRef} className="relative min-h-0 flex-1">
        {activeNote && annotationVisible && <div className="absolute left-2 right-3" style={{ top: annotationTop }}>
          {commentEditing ? <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <p className="mb-2 line-clamp-2 text-xs text-text-secondary">{activeNote.quote}</p>
            <textarea autoFocus className="min-h-24 w-full resize-y rounded-lg border border-gray-200 p-2 text-sm outline-none focus:border-primary" aria-label="评论内容" placeholder="写下你的评论…" value={commentDraft} onChange={event => setCommentDraft(event.target.value)} />
            <div className="mt-2 flex justify-end gap-2"><button type="button" className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100" onClick={() => { setCommentEditing(false); setCommentDraft(activeNote.comment) }}>取消</button><button type="button" disabled={commentSaving} className="rounded-lg bg-primary px-3 py-1 text-xs text-white disabled:opacity-50" onClick={() => void saveComment()}>{commentSaving ? '保存中…' : '保存评论'}</button></div>
          </div> : activeNote.comment ? <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <p className="mb-2 line-clamp-2 text-xs text-text-secondary">{activeNote.quote}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{activeNote.comment}</p>
            <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setCommentEditing(true)}>编辑评论</button>
          </div> : <button type="button" aria-label="添加评论" title="添加评论" className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-text-secondary shadow-sm hover:border-primary hover:text-primary" onClick={() => setCommentEditing(true)}><span className="material-symbols-outlined text-[18px]">add_comment</span></button>}
        </div>}
      </div>
    </aside>}
    {drawerNoteId && selected && <aside className="flex h-full w-[42%] min-w-[360px] flex-col bg-white">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4">
          <div className="flex min-w-0 items-center gap-2">{platformLogo && <img src={platformLogo} alt="" className="h-6 w-6 shrink-0 object-contain" />}<div className="min-w-0"><p className="truncate text-sm font-medium">{selected.platform}</p><p className="truncate text-[11px] text-text-secondary">{matchedCount === null ? '正在定位高亮…' : matchedCount === 0 ? '暂未在网页中找到原文' : `${selected.title} · 已标出 ${matchedCount} 处笔记`}</p></div></div>
          <button type="button" className="text-text-secondary hover:text-text-primary" aria-label="关闭原对话" onClick={() => { setDrawerNoteId(null); setDrawerReady(false) }}><span className="material-symbols-outlined">close</span></button>
        </div>
        <webview key={selected.id} ref={webviewRef} src={selected.url} partition="persist:shared" className="min-h-0 flex-1" />
    </aside>}
  </div>
}
