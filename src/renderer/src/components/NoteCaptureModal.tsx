import { useEffect, useState } from 'react'
import type { NoteDraft, NoteHighlight, NoteSelectionRect } from '../../../shared/types/notes'
import { generateNoteHighlightScript } from '../../../shared/utils/webviewScripts'
import { notePositionInWindow, type NotePopoverRequest } from '../utils/noteInteractions'

/** 右键后直接保存，高亮旁只显示非模态评论卡片。 */
export default function NoteCaptureModal(): JSX.Element | null {
  const [popover, setPopover] = useState<NotePopoverRequest | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const request = (event as CustomEvent<NotePopoverRequest>).detail
      setPopover(request)
      setComment(request.note.comment)
      setError('')
    }
    window.addEventListener('notes:open-popover', onOpen)
    return () => window.removeEventListener('notes:open-popover', onOpen)
  }, [])

  useEffect(() => window.api.onNoteCapture(payload => {
    if (payload.error) { setError(payload.error); return }
    if (!payload.draft) return
    const draft: NoteDraft = payload.draft
    const webContentsId = payload.webContentsId
    const selectionRect: NoteSelectionRect | undefined = payload.rect
    void window.api.notesSave(draft, '').then(result => {
      if (!result.success || !result.data) { setError(result.error || '保存笔记失败'); return }
      const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim()
      const saved = result.data.notes.find(note => normalized(note.quote) === normalized(draft.quote))
      if (!saved) return
      const note: NoteHighlight = { id: saved.id, conversationId: result.data.id, quote: saved.quote, anchor: saved.anchor, comment: saved.comment }
      const webview = Array.from(document.querySelectorAll('webview')).find(element => {
        try { return (element as Electron.WebviewTag).getWebContentsId() === webContentsId } catch { return false }
      }) as Electron.WebviewTag | undefined
      if (webview) {
        try {
          void webview.insertCSS('::highlight(multichat-notes){background:#fff176;color:inherit}::highlight(multichat-note-focus){background:#fff176;color:inherit}').catch(() => undefined)
          void webview.executeJavaScript(generateNoteHighlightScript(result.data.notes, saved.id)).catch(() => undefined)
        } catch { /* Webview 导航期间由加载监听器恢复高亮 */ }
      }
      const position = webview && selectionRect
        ? notePositionInWindow(webview, selectionRect.right, selectionRect.bottom)
        : { x: window.innerWidth - 340, y: 80 }
      window.dispatchEvent(new CustomEvent<NotePopoverRequest>('notes:open-popover', { detail: { note, ...position } }))
    }).catch(() => setError('保存笔记失败'))
  }), [])

  useEffect(() => {
    if (!popover) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setPopover(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popover])

  const update = async (): Promise<void> => {
    if (!popover || saving) return
    setSaving(true)
    const result = await window.api.notesUpdate(popover.note.conversationId, popover.note.id, comment)
    setSaving(false)
    if (!result.success) { setError(result.error || '保存评论失败'); return }
    setPopover({ ...popover, note: { ...popover.note, comment } })
    setError('')
  }

  const remove = async (): Promise<void> => {
    if (!popover || saving) return
    setSaving(true)
    const result = await window.api.notesDelete(popover.note.conversationId, popover.note.id)
    setSaving(false)
    if (!result.success) { setError(result.error || '删除笔记失败'); return }
    setPopover(null)
    setError('')
  }

  if (!popover && !error) return null
  const left = popover ? Math.max(12, Math.min(popover.x + 8, window.innerWidth - 332)) : 12
  const top = popover ? Math.max(48, Math.min(popover.y + 8, window.innerHeight - 270)) : 48
  return <>
    {popover && <div className="fixed z-[95] w-[320px] rounded-xl border border-yellow-300 bg-white p-3 text-text-primary shadow-xl no-drag" style={{ left, top }}>
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">高亮笔记</strong><button type="button" aria-label="关闭评论卡片" className="text-text-secondary hover:text-text-primary" onClick={() => { setPopover(null); setError('') }}>×</button></div>
      <p className="mt-2 max-h-20 overflow-y-auto border-l-4 border-[#fff176] pl-2 text-xs text-text-secondary">{popover.note.quote}</p>
      <textarea className="mt-3 min-h-20 w-full resize-y rounded-lg border border-gray-200 p-2 text-sm outline-none focus:border-primary" placeholder="添加评论…" value={comment} onChange={event => setComment(event.target.value)} autoFocus />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex items-center justify-between"><button type="button" className="text-xs text-red-600 hover:underline" disabled={saving} onClick={() => void remove()}>删除高亮</button><div className="flex gap-2"><button type="button" className="rounded-lg px-2 py-1 text-xs text-text-secondary" onClick={() => setPopover(null)}>关闭</button><button type="button" className="rounded-lg bg-primary px-3 py-1 text-xs text-white disabled:opacity-40" disabled={saving || comment === popover.note.comment} onClick={() => void update()}>保存评论</button></div></div>
    </div>}
    {!popover && error && <div className="fixed right-4 top-12 z-[95] rounded-lg border border-red-200 bg-white px-4 py-2 text-sm text-red-600 shadow-lg" role="alert">{error}<button type="button" className="ml-3" onClick={() => setError('')}>关闭</button></div>}
  </>
}
