import { useLayoutEffect, useRef, useState } from 'react'
import type { NoteConversation } from '../../../shared/types/notes'

interface Props {
  conversations: NoteConversation[]
  sidebar: boolean
  selectedId: string | null
  focusedNoteId: string | null
  editingNoteId: string | null
  commentDraft: string
  commentSaving: boolean
  deletingNoteId: string | null
  logoFor: (platform: string) => string | undefined
  onOpen: (conversationId: string, noteId?: string) => void
  onMap: (conversationId: string) => void
  onEdit: (noteId: string | null, comment?: string) => void
  onDraft: (value: string) => void
  onSave: (conversationId: string, noteId: string) => void
  onDelete: (conversationId: string, noteId: string) => void
}

/** 卡片顺序保留时间排序，视觉上放入当前最短的一列。 */
export default function NotesConversationCards(props: Props): JSX.Element {
  const { conversations, sidebar, selectedId, focusedNoteId, editingNoteId, commentDraft, commentSaving, deletingNoteId } = props
  const boardRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [fullQuotes, setFullQuotes] = useState<Set<string>>(() => new Set())
  useLayoutEffect(() => {
    const board = boardRef.current
    if (!board) return
    let frame = 0
    const layout = (): void => {
      const cards = Array.from(board.children) as HTMLElement[]
      if (sidebar) {
        board.style.height = ''
        cards.forEach(card => { card.style.cssText = '' })
        return
      }
      const width = board.clientWidth
      const columns = width >= 1500 ? 3 : width >= 820 ? 2 : 1
      const gap = 20, cardWidth = (width - gap * (columns - 1)) / columns
      const heights = Array<number>(columns).fill(0)
      cards.forEach(card => {
        card.style.width = `${cardWidth}px`
        const column = heights.indexOf(Math.min(...heights))
        card.style.position = 'absolute'
        card.style.left = `${column * (cardWidth + gap)}px`
        card.style.top = `${heights[column]}px`
        heights[column] += card.offsetHeight + gap
      })
      board.style.height = `${Math.max(0, ...heights) - (cards.length ? gap : 0)}px`
    }
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout) })
    observer.observe(board)
    Array.from(board.children).forEach(card => observer.observe(card))
    layout()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [conversations, sidebar, expanded, fullQuotes, editingNoteId, commentDraft])

  const toggle = (id: string, setter: typeof setExpanded): void => setter(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return <div ref={boardRef} className={`notes-home-board ${sidebar ? 'is-sidebar' : ''}`}>
    {conversations.map(item => {
      const compact = sidebar && item.id !== selectedId
      const logo = props.logoFor(item.platform)
      const showAll = sidebar || expanded.has(item.id) || item.notes.some(note => note.id === focusedNoteId || note.id === editingNoteId)
      const notes = showAll ? item.notes : item.notes.slice(0, 2)
      return <article key={item.id} data-conversation-id={item.id} className={`notes-conversation-card ${compact ? 'is-compact' : ''} ${selectedId === item.id ? 'is-selected' : ''}`} tabIndex={0} aria-label={`${item.title}，打开原会话`} onClick={event => {
        if ((event.target as HTMLElement).closest('button, [role="button"], input, textarea, select, a, label') || window.getSelection()?.toString()) return
        props.onOpen(item.id)
      }} onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); props.onOpen(item.id) }
      }}>
        <header className="notes-conversation-header">
          <div className="notes-conversation-heading">
            <span className="notes-conversation-logo">{logo ? <img src={logo} alt="" /> : <span className="material-symbols-outlined" aria-hidden="true">article</span>}</span>
            <div className="notes-conversation-title-group">
              <h2 title={item.title}>{item.title}</h2>
              <div className="notes-item-meta"><span>{item.platform}</span><time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })}</time></div>
            </div>
            <button className="notes-card-map" title="展开思维导图" aria-label={`${item.title}：展开思维导图`} onClick={() => props.onMap(item.id)}><span className="material-symbols-outlined" aria-hidden="true">account_tree</span><span>思维导图</span></button>
          </div>
        </header>
        {!compact && <>
          <div className="notes-conversation-body">
            {!notes.length && <div className="notes-card-empty"><p>{item.mindmaps.length ? '这份资料已保存思维导图，暂未添加批注。' : '还没有批注，在原会话中选中文字即可保存。'}</p><button className="notes-text-button" onClick={() => props.onOpen(item.id)}>查看原会话<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button></div>}
            {notes.map(note => <section key={note.id} data-note-id={note.id} className={`notes-annotation ${focusedNoteId === note.id ? 'is-focused' : ''}`}>
              <div className="notes-quote-wrap">
                <button className={`notes-quote ${note.quote.length <= 180 || fullQuotes.has(note.id) ? 'is-expanded' : ''}`} title="点击定位到原文" onClick={() => props.onOpen(item.id, note.id)}><span className="notes-quote-symbol material-symbols-outlined" aria-hidden="true">format_quote</span><span className="notes-quote-text">{note.quote}</span></button>
                <div className="notes-quote-toolbar">
                  <button type="button" className="notes-quote-action" disabled={commentSaving} title={note.comment ? '编辑想法' : '添加想法'} aria-label={note.comment ? '编辑想法' : '添加想法'} onClick={event => { event.stopPropagation(); props.onEdit(note.id, note.comment) }}><span className="material-symbols-outlined" aria-hidden="true">{note.comment ? 'edit' : 'add_comment'}</span></button>
                  <button type="button" className="notes-quote-action is-delete" disabled={!!deletingNoteId || commentSaving} title="删除批注" aria-label="删除批注" onClick={event => { event.stopPropagation(); props.onDelete(item.id, note.id) }}><span className="material-symbols-outlined" aria-hidden="true">delete</span></button>
                </div>
              </div>
              {note.quote.length > 180 && <button className="notes-text-button notes-quote-expand" onClick={() => toggle(note.id, setFullQuotes)}>{fullQuotes.has(note.id) ? '收起摘录' : '展开摘录'}</button>}
              {editingNoteId === note.id ? <div className="notes-comment-editor"><label htmlFor={`note-comment-${note.id}`}>我的想法</label><textarea id={`note-comment-${note.id}`} autoFocus maxLength={100000} value={commentDraft} disabled={commentSaving} onChange={event => props.onDraft(event.target.value)} placeholder="写下你的思考…" /><div><button disabled={commentSaving} onClick={() => props.onEdit(null)}>取消</button><button className="notes-save" disabled={commentSaving} onClick={() => props.onSave(item.id, note.id)}>{commentSaving ? '保存中…' : '保存'}</button></div></div> : note.comment && <div className="notes-comment" role="button" tabIndex={0} title="点击编辑想法" onClick={event => { if (window.getSelection()?.toString()) return; event.stopPropagation(); props.onEdit(note.id, note.comment) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); props.onEdit(note.id, note.comment) } }}><span className="notes-comment-icon material-symbols-outlined" aria-hidden="true">chat_bubble</span><div>{note.comment}</div></div>}
            </section>)}
            {!sidebar && item.notes.length > 2 && <button className="notes-text-button notes-expand-notes" onClick={() => toggle(item.id, setExpanded)}>{showAll ? '收起批注' : '展开更多批注'}</button>}
          </div>
        </>}
      </article>
    })}
  </div>
}
