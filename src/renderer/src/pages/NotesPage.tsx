import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { NoteConversation, NoteNavigation } from '../../../shared/types/notes'
import ConversationMindmapPanel from '../components/ConversationMindmapPanel'
import CustomDropdown from '../components/CustomDropdown'
import NotesSourcePane from '../components/NotesSourcePane'
import NotesConversationCards from '../components/NotesConversationCards'
import { useAppStore } from '../store/appStore'
import '../styles/notesWorkspace.css'

const DEFAULT_SOURCE_WIDTH = 460
const MIN_SOURCE_WIDTH = 320
const MAX_SOURCE_WIDTH = 640

function initialSourceWidth(): number {
  try {
    const value = Number(localStorage.getItem('notes_source_width'))
    if (value >= MIN_SOURCE_WIDTH && value <= MAX_SOURCE_WIDTH) return value
  } catch { /* 本地偏好不可用时使用默认宽度 */ }
  return DEFAULT_SOURCE_WIDTH
}

export default function NotesPage({ initialNavigation }: { initialNavigation?: NoteNavigation }): JSX.Element {
  const models = useAppStore(state => state.models)
  const [conversations, setConversations] = useState<NoteConversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<NoteConversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null)
  const [searching, setSearching] = useState(false)
  const [platform, setPlatform] = useState('all')
  const [contentFilter, setContentFilter] = useState('all')
  const [sort, setSort] = useState<'updated' | 'title'>('updated')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'notes' | 'mindmap'>('notes')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceVisited, setSourceVisited] = useState(false)
  const [mapVisited, setMapVisited] = useState(false)
  const homeScroll = useRef(0)
  const orderRef = useRef<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)
  const [sourceWidth, setSourceWidth] = useState(initialSourceWidth)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ x: number; width: number; pointerId: number } | null>(null)
  const widthRef = useRef(sourceWidth)
  const searchRef = useRef<HTMLInputElement>(null)
  const notesScrollRef = useRef<HTMLDivElement>(null)
  const reloadSequence = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const sequence = ++reloadSequence.current
    try {
      const result = await window.api.notesSummaries()
      if (sequence !== reloadSequence.current) return
      if (!result.success) throw new Error(result.error || '读取笔记失败')
      const items = [...(result.data || [])].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      setConversations(items)
      setSelectedId(current => current && items.some(item => item.id === current) ? current : null)
    } catch (cause) {
      if (sequence === reloadSequence.current) setError(cause instanceof Error ? cause.message : '读取笔记失败')
    } finally { if (sequence === reloadSequence.current) setLoading(false) }
  }, [])
  useEffect(() => {
    void reload()
    const unsubscribe = window.api.onNotesChanged(() => void reload())
    return () => { unsubscribe(); reloadSequence.current++ }
  }, [reload])
  useEffect(() => {
    let active = true
    if (!selectedId) { setSelectedDetail(null); setDetailLoading(false); return }
    setDetailLoading(true)
    void window.api.notesGet(selectedId).then(result => {
      if (!active) return
      if (!result.success || !result.data) { setSelectedDetail(null); setError(result.error || '读取笔记正文失败') }
      else setSelectedDetail(result.data)
    }).catch(() => { if (active) { setSelectedDetail(null); setError('读取笔记正文失败，请重试') } }).finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selectedId, conversations])
  useEffect(() => {
    let active = true
    if (!query.trim()) { setSearchIds(null); setSearching(false); return }
    setSearchIds(null); setSearching(true)
    const timer = setTimeout(() => {
      void window.api.notesSummaries(query).then(result => {
        if (!active) return
        if (!result.success) throw new Error(result.error || '搜索失败')
        setSearchIds(new Set((result.data || []).map(item => item.id)))
      }).catch(() => { if (active) { setSearchIds(new Set()); setError('搜索失败，请重试') } }).finally(() => { if (active) setSearching(false) })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [query, conversations])

  const platforms = useMemo(() => Array.from(new Set(conversations.map(item => item.platform))), [conversations])
  const visible = useMemo(() => {
    const items = conversations.filter(item => {
      if (contentFilter === 'notes' && !item.notes.length) return false
      if (contentFilter === 'mindmaps' && !item.mindmaps.length) return false
      if (platform !== 'all' && item.platform !== platform) return false
      return !query.trim() || !!searchIds?.has(item.id)
    }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    const key = JSON.stringify([contentFilter, platform, query, sort])
    if (orderRef.current.key !== key || sort === 'title') orderRef.current = { key, ids: items.map(item => item.id) }
    else if (!searching) {
      const ids = new Set(items.map(item => item.id))
      const known = new Set(orderRef.current.ids)
      orderRef.current.ids = [...items.filter(item => !known.has(item.id)).map(item => item.id), ...orderRef.current.ids.filter(id => ids.has(id))]
    }
    const rank = new Map(orderRef.current.ids.map((id, index) => [id, index]))
    return items.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  }, [conversations, contentFilter, platform, query, searchIds, sort, searching])
  const selected = selectedDetail?.id === selectedId ? selectedDetail : null
  const selectedSummary = conversations.find(item => item.id === selectedId)
  const cardItems = mode === 'mindmap' && selectedSummary ? [selectedSummary, ...visible.filter(item => item.id !== selectedId)] : visible
  const logoFor = (name: string): string | undefined => models.find(model => model.name.toLowerCase() === name.toLowerCase())?.logo
  const platformOptions = useMemo(() => [
    { value: 'all', label: '全部平台' },
    ...platforms.map(name => ({ value: name, label: name, logo: logoFor(name) }))
  ], [platforms, models])
  const sortOptions = useMemo(() => [
    { value: 'updated' as const, label: '最近更新' },
    { value: 'title' as const, label: '按标题' }
  ], [])

  // 切换会话仅重置导图缓存，原文是否展开由用户操作决定。
  useEffect(() => { setMapVisited(false) }, [selectedId])
  useEffect(() => {
    if (!initialNavigation || !conversations.some(item => item.id === initialNavigation.conversationId)) return
    setSelectedId(initialNavigation.conversationId)
    setQuery(''); setPlatform('all'); setContentFilter('all')
    setMode(initialNavigation.mindmapId ? 'mindmap' : 'notes')
    if (!initialNavigation.mindmapId) { setSourceVisited(true); setSourceOpen(true) }
  }, [initialNavigation, conversations.length])
  useEffect(() => { if (mode === 'mindmap') setMapVisited(true) }, [mode, selectedId])
  useEffect(() => {
    if (focusedNoteId && selected && !selected.notes.some(note => note.id === focusedNoteId)) setFocusedNoteId(null)
  }, [selected, focusedNoteId])

  const openSource = useCallback(() => { setSourceVisited(true); setSourceOpen(true) }, [])
  const openConversation = useCallback((conversationId: string, noteId?: string): void => {
    setSelectedId(conversationId); setFocusedNoteId(noteId || null); setSourceText('')
    setFocusTick(value => value + 1); openSource()
  }, [openSource])
  const openMap = (conversationId: string): void => {
    if (mode === 'notes') homeScroll.current = notesScrollRef.current?.scrollTop || 0
    if (selectedId !== conversationId) { setFocusedNoteId(null); setSourceText('') }
    setSelectedId(conversationId); setMode('mindmap')
  }
  const closeMap = (): void => { setMode('notes') }
  useEffect(() => {
    if (notesScrollRef.current) notesScrollRef.current.scrollTop = mode === 'notes' ? homeScroll.current : 0
  }, [mode])
  const selectFromSource = useCallback((id: string): void => {
    setFocusedNoteId(id); setSourceText(''); setFocusTick(value => value + 1)
  }, [])
  useEffect(() => {
    if (!focusedNoteId) return
    const frame = requestAnimationFrame(() => {
      const scroll = notesScrollRef.current
      const element = scroll?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(focusedNoteId)}"]`)
      if (!scroll || !element) return
      const top = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
      scroll.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedNoteId, focusTick])
  const viewNodeSource = useCallback((text: string): void => {
    setSourceText(text); setFocusedNoteId(null); setFocusTick(value => value + 1); openSource()
  }, [openSource])
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  useEffect(() => {
    if (!resizing) return
    const cursor = document.body.style.cursor, selection = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    return () => { document.body.style.cursor = cursor; document.body.style.userSelect = selection }
  }, [resizing])
  const updateWidth = (width: number): void => {
    const max = Math.min(MAX_SOURCE_WIDTH, Math.max(MIN_SOURCE_WIDTH, window.innerWidth - 700))
    const next = Math.max(MIN_SOURCE_WIDTH, Math.min(max, width))
    widthRef.current = next; setSourceWidth(next)
  }
  const persistWidth = (): void => { try { localStorage.setItem('notes_source_width', String(widthRef.current)) } catch { /* 偏好保存失败不影响阅读 */ } }
  const saveComment = async (conversationId: string, noteId: string): Promise<void> => {
    if (commentSaving) return
    setCommentSaving(true)
    try {
      const result = await window.api.notesUpdate(conversationId, noteId, commentDraft.trim())
      if (!result.success) throw new Error(result.error || '保存评论失败')
      setEditingNoteId(null); await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存评论失败') }
    finally { setCommentSaving(false) }
  }
  const removeNote = async (conversationId: string, noteId: string): Promise<void> => {
    if (deletingNoteId || !window.confirm('确定删除这条批注吗？')) return
    setDeletingNoteId(noteId)
    try {
      const result = await window.api.notesDelete(conversationId, noteId)
      if (!result.success) throw new Error(result.error || '删除失败')
      if (editingNoteId === noteId) setEditingNoteId(null)
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败') }
    finally { setDeletingNoteId(null) }
  }
  const exportNotes = async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    try {
      const result = await window.api.notesExport()
      if (!result.success) throw new Error(result.error || '导出失败')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败') }
    finally { setExporting(false) }
  }

  return <div className={`notes-workspace notes-home ${mode === 'mindmap' ? 'is-map-open' : ''}`} style={{ '--notes-source-width': `${sourceWidth}px` } as CSSProperties}>
    <header className="notes-main-header">
      <div className="notes-document-title"><span className="material-symbols-outlined" aria-hidden="true">auto_stories</span><div><h1>{mode === 'mindmap' ? selectedSummary?.title || '思维导图' : '我的笔记'}</h1>{mode === 'mindmap' && <p>{selectedSummary?.platform} · 思维导图</p>}</div></div>
      <div className="notes-home-tools">
        <div className="notes-home-filters">
          <div className="notes-filters" role="group" aria-label="内容筛选">{[['all', '全部'], ['notes', '有批注'], ['mindmaps', '有导图']].map(([value, label]) => <button key={value} aria-pressed={contentFilter === value} onClick={() => setContentFilter(value)}>{label}</button>)}</div>
          <div className="notes-selects">
            <CustomDropdown
              options={platformOptions}
              value={platform}
              onChange={setPlatform}
              className="notes-dropdown"
              buttonClassName="notes-dropdown-trigger"
              dropdownWidth="min-w-[148px] w-max !rounded-xl !border-gray-200/80 !bg-white/95 !p-1 !shadow-lg"
              renderOption={(option, isSelected, onSelect) => (
                <button type="button" onClick={onSelect} className={`notes-dropdown-option ${isSelected ? 'is-selected' : ''}`}>
                  {option.logo ? <img src={option.logo} alt="" className="notes-dropdown-logo" /> : <span className="material-symbols-outlined notes-dropdown-icon" aria-hidden="true">{option.value === 'all' ? 'apps' : 'smart_toy'}</span>}
                  <span className="notes-dropdown-label">{option.label}</span>
                  {isSelected && <span className="material-symbols-outlined notes-dropdown-check" aria-hidden="true">check</span>}
                </button>
              )}
            />
            <CustomDropdown
              options={sortOptions}
              value={sort}
              onChange={nextSort => { orderRef.current.key = ''; setSort(nextSort) }}
              className="notes-dropdown"
              buttonClassName="notes-dropdown-trigger"
              dropdownWidth="min-w-[132px] w-max !rounded-xl !border-gray-200/80 !bg-white/95 !p-1 !shadow-lg"
              renderOption={(option, isSelected, onSelect) => (
                <button type="button" onClick={onSelect} className={`notes-dropdown-option ${isSelected ? 'is-selected' : ''}`}>
                  <span className="material-symbols-outlined notes-dropdown-icon" aria-hidden="true">{option.value === 'updated' ? 'schedule' : 'sort_by_alpha'}</span>
                  <span className="notes-dropdown-label">{option.label}</span>
                  {isSelected && <span className="material-symbols-outlined notes-dropdown-check" aria-hidden="true">check</span>}
                </button>
              )}
            />
          </div>
        </div>
        <div className="notes-search"><span className="material-symbols-outlined" aria-hidden="true">search</span><input ref={searchRef} aria-label="搜索笔记" placeholder="搜索标题、批注、导图" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="notes-icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><span className="material-symbols-outlined">close</span></button>}</div>
      </div>
      <div className="notes-header-actions">
        <button className="notes-icon-button" aria-label="导出全部笔记" title="导出全部笔记" disabled={exporting} onClick={() => void exportNotes()}><span className="material-symbols-outlined">ios_share</span></button>
        {selectedId && <button className={`notes-source-toggle ${sourceOpen ? 'is-active' : ''}`} aria-expanded={sourceOpen} onClick={() => { if (sourceOpen) setSourceOpen(false); else openSource() }}><span className="material-symbols-outlined" aria-hidden="true">{sourceOpen ? 'right_panel_close' : 'right_panel_open'}</span><span>{sourceOpen ? '收起原文' : '对照原文'}</span></button>}
      </div>
    </header>
    {error && <div className="notes-error" role="alert"><span>{error}</span><button onClick={() => { setError(''); void reload() }}>重试</button><button aria-label="关闭提示" onClick={() => setError('')}><span className="material-symbols-outlined">close</span></button></div>}
    <div className={`notes-reading-layout ${sourceOpen ? 'has-source' : ''}`}>
      <div ref={notesScrollRef} className="notes-home-scroll" aria-label={mode === 'mindmap' ? '笔记侧栏' : '全部笔记'} aria-busy={loading || searching} onScroll={event => { if (mode === 'notes') homeScroll.current = event.currentTarget.scrollTop }}>
        {loading ? <div className="notes-list-loading" role="status"><span className="sr-only">正在读取笔记</span>{[0, 1, 2].map(key => <div key={key} className="notes-skeleton" />)}</div> : !cardItems.length ? <div className="notes-empty notes-main-empty" role="status"><span className="material-symbols-outlined" aria-hidden="true">{searching ? 'search' : 'auto_stories'}</span><p>{searching ? '搜索中…' : conversations.length ? '没有匹配的笔记' : '还没有笔记'}</p><span>{conversations.length ? '试试其他关键词，或清除筛选。' : '在对话中选中文字，右键保存批注或生成导图。'}</span>{conversations.length > 0 && !searching && <button className="notes-text-button" onClick={() => { setQuery(''); setPlatform('all'); setContentFilter('all') }}>清除筛选</button>}</div> : <NotesConversationCards conversations={cardItems} sidebar={mode === 'mindmap'} selectedId={sourceOpen || mode === 'mindmap' ? selectedId : null} focusedNoteId={focusedNoteId} editingNoteId={editingNoteId} commentDraft={commentDraft} commentSaving={commentSaving} deletingNoteId={deletingNoteId} logoFor={logoFor} onOpen={openConversation} onMap={openMap} onEdit={(id, comment) => { setEditingNoteId(id); if (comment !== undefined) setCommentDraft(comment) }} onDraft={setCommentDraft} onSave={(conversationId, noteId) => void saveComment(conversationId, noteId)} onDelete={(conversationId, noteId) => void removeNote(conversationId, noteId)} />}
      </div>
      {(mapVisited || mode === 'mindmap') && <div className="notes-map" style={{ display: mode === 'mindmap' ? undefined : 'none' }}>{selected ? <ConversationMindmapPanel key={selected.id} conversation={selected} initialMapId={initialNavigation?.conversationId === selected.id ? initialNavigation.mindmapId : undefined} onViewSource={viewNodeSource} onClose={closeMap} /> : <div className="notes-empty notes-main-empty"><p>{detailLoading ? '正在读取思维导图…' : '无法读取这份资料'}</p><button className="notes-icon-button" title="关闭思维导图" aria-label="关闭思维导图" onClick={closeMap}><span className="material-symbols-outlined">close</span></button></div>}</div>}
      {sourceVisited && <>
            <div className="notes-source-resizer" style={{ display: sourceOpen ? undefined : 'none' }} role="separator" aria-label="调整原文栏宽度" aria-orientation="vertical" aria-valuemin={MIN_SOURCE_WIDTH} aria-valuemax={MAX_SOURCE_WIDTH} aria-valuenow={sourceWidth} tabIndex={0} title="拖动调整原文栏宽度，双击恢复默认" onPointerDown={event => { event.preventDefault(); dragRef.current = { x: event.clientX, width: sourceWidth, pointerId: event.pointerId }; setResizing(true); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { const drag = dragRef.current; if (drag && drag.pointerId === event.pointerId) updateWidth(drag.width + drag.x - event.clientX) }} onPointerUp={event => { if (dragRef.current?.pointerId !== event.pointerId) return; dragRef.current = null; setResizing(false); event.currentTarget.releasePointerCapture(event.pointerId); persistWidth() }} onPointerCancel={() => { dragRef.current = null; setResizing(false) }} onDoubleClick={() => { updateWidth(DEFAULT_SOURCE_WIDTH); persistWidth() }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); updateWidth(sourceWidth + (event.key === 'ArrowLeft' ? 20 : -20)); persistWidth() } }} />
        {selected ? <NotesSourcePane key={selected.id} conversation={selected} open={sourceOpen} focusedNoteId={focusedNoteId} sourceText={sourceText} focusTick={focusTick} onNoteSelect={selectFromSource} onClose={() => setSourceOpen(false)} resizing={resizing} /> : sourceOpen && <aside className="notes-source"><div className="notes-source-header"><span>原会话</span><button className="notes-icon-button" aria-label="收起原文" onClick={() => setSourceOpen(false)}><span className="material-symbols-outlined">close</span></button></div><div className="notes-empty"><p>{detailLoading ? '正在读取原会话…' : '无法读取原会话'}</p></div></aside>}
      </>}
    </div>
  </div>
}
