import { NOTE_CLICK_PREFIX, type NoteHighlight } from '../../../shared/types/notes'
export { NOTE_CLICK_PREFIX }

export interface NotePopoverRequest {
  note: NoteHighlight
  x: number
  y: number
}

export function openNotePopover(request: NotePopoverRequest): void {
  window.dispatchEvent(new CustomEvent<NotePopoverRequest>('notes:open-popover', { detail: request }))
}

export function notePositionInWindow(webview: Electron.WebviewTag, x: number, y: number): { x: number; y: number } {
  const rect = webview.getBoundingClientRect()
  return { x: rect.left + x, y: rect.top + y }
}

/** Webview 只传回笔记 ID 与点击坐标；评论内容留在应用渲染层。 */
export async function handleNoteHighlightClick(webview: Electron.WebviewTag, message: string): Promise<boolean> {
  if (!message.startsWith(NOTE_CLICK_PREFIX)) return false
  let payload: { id?: string; x?: number; y?: number }
  try { payload = JSON.parse(message.slice(NOTE_CLICK_PREFIX.length)) as typeof payload }
  catch { return true }
  if (typeof payload.id !== 'string' || typeof payload.x !== 'number' || typeof payload.y !== 'number') return true
  let url: string
  try { url = webview.getURL() } catch { return true }
  if (!url.startsWith('https://')) return true
  const result = await window.api.notesAnchorsForUrl(url)
  const note = result.data?.find(item => item.id === payload.id)
  if (result.success && note) openNotePopover({ note, ...notePositionInWindow(webview, payload.x, payload.y) })
  return true
}
