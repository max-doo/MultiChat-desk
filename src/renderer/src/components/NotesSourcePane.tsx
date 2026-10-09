import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NoteAnchor, NoteConversation } from '../../../shared/types/notes'
import { NOTE_CLICK_PREFIX } from '../../../shared/types/notes'
import { generateNoteHighlightScript } from '../../../shared/utils/webviewScripts'
import { normalizeNoteTranscriptMarkdown, parseSnapshotBlocks } from '../../../shared/utils/noteTranscript'

const MAP_SOURCE_ID = '__notes-map-source'

/** Markdown 渲染会改变换行与空白，用锚点上下文在渲染后的文本中消歧。 */
function snapshotRanges(root: HTMLElement, anchors: Array<{ id: string; anchor: NoteAnchor }>): Array<{ id: string; range: Range }> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Node; start: number; end: number }> = []
  let text = ''
  while (walker.nextNode()) {
    const node = walker.currentNode
    const value = node.textContent || ''
    nodes.push({ node, start: text.length, end: text.length + value.length })
    text += value
  }
  const offsets: number[] = []
  let compactText = ''
  for (let i = 0; i < text.length; i++) {
    if (/[\s\u200b-\u200d\ufeff]/.test(text[i])) continue
    offsets.push(i)
    compactText += text[i]
  }
  const compact = (value: string): string => value.replace(/[\s\u200b-\u200d\ufeff]/g, '')
  return anchors.flatMap(({ id, anchor }) => {
    const exact = compact(anchor.exact)
    if (!exact) return []
    const prefix = compact(anchor.prefix), suffix = compact(anchor.suffix)
    let match = -1, best = -1
    let at = compactText.indexOf(exact)
    while (at >= 0) {
      const score = (prefix && compactText.slice(Math.max(0, at - prefix.length), at) === prefix ? 2 : 0) +
        (suffix && compactText.slice(at + exact.length, at + exact.length + suffix.length) === suffix ? 2 : 0)
      if (score > best) { match = at; best = score }
      at = compactText.indexOf(exact, at + exact.length)
    }
    if (match < 0) return []
    const startAt = offsets[match], endAt = offsets[match + exact.length - 1] + 1
    const start = nodes.find(item => item.start <= startAt && startAt < item.end)
    const end = nodes.find(item => item.start < endAt && endAt <= item.end)
    if (!start || !end) return []
    const range = document.createRange()
    range.setStart(start.node, startAt - start.start)
    range.setEnd(end.node, endAt - end.start)
    return [{ id, range }]
  })
}

interface Props {
  conversation: NoteConversation
  open: boolean
  focusedNoteId: string | null
  sourceText: string
  focusTick: number
  onNoteSelect: (id: string) => void
  onClose: () => void
  resizing: boolean
}

export default function NotesSourcePane({ conversation, open, focusedNoteId, sourceText, focusTick, onNoteSelect, onClose, resizing }: Props): JSX.Element {
  const hasWebSource = /^https:\/\//.test(conversation.url)
  const [mode, setMode] = useState<'web' | 'snapshot'>(hasWebSource ? 'web' : 'snapshot')
  const [webStarted, setWebStarted] = useState(hasWebSource && open)
  const [snapshotStarted, setSnapshotStarted] = useState(!hasWebSource)
  const [webStatus, setWebStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [webError, setWebError] = useState('')
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const readyRef = useRef(false)
  const lastLocatedRef = useRef('')
  const transcriptRef = useRef<HTMLDivElement>(null)
  const selectRef = useRef(onNoteSelect)
  selectRef.current = onNoteSelect
  const anchors = useMemo(() => [
    ...conversation.notes.map(note => ({ id: note.id, anchor: { ...note.anchor, exact: note.anchor.exact || note.quote } })),
    ...(sourceText ? [{ id: MAP_SOURCE_ID, anchor: { exact: sourceText, prefix: '', suffix: '' } }] : [])
  ], [conversation.notes, sourceText])
  const focusedId = sourceText ? MAP_SOURCE_ID : focusedNoteId || undefined
  const markdown = useMemo(() => normalizeNoteTranscriptMarkdown(conversation.snapshot), [conversation.snapshot])
  const blocks = useMemo(() => parseSnapshotBlocks(markdown), [markdown])

  useEffect(() => {
    if (open && mode === 'web') setWebStarted(true)
    if (open && mode === 'snapshot') setSnapshotStarted(true)
  }, [open, mode])

  // 首次展开才创建原网页；收起和切换快照均保留已打开网页的滚动/登录上下文。
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !webStarted) return
    let active = true
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let cssKey: string | undefined
    let insertingCSS = false
    const focusKey = `${focusedId || ''}:${sourceText}:${focusTick}`
    const removeCSS = (key: string): void => {
      // React 卸载时 guest 可能已经销毁；此时 Electron 会同步抛错，Promise.catch 无法捕获。
      if (!webview.isConnected || !readyRef.current) return
      try { void webview.removeInsertedCSS(key).catch(() => undefined) }
      catch { /* 页面已导航或 guest 已销毁，原样式随页面一并释放 */ }
    }
    const apply = async (): Promise<void> => {
      if (!active || !webview.isConnected || !readyRef.current || !open || mode !== 'web') return
      try {
        if (!cssKey && !insertingCSS) {
          insertingCSS = true
          void webview.insertCSS('::highlight(multichat-notes){background:#fde68a;color:inherit}::highlight(multichat-note-focus){background:#fbbf24;color:inherit}').then(key => { if (active) cssKey = key; else removeCSS(key) }).catch(() => undefined).finally(() => { insertingCSS = false })
        }
        const result = await webview.executeJavaScript(generateNoteHighlightScript(anchors, focusedId, lastLocatedRef.current !== focusKey)) as { focusedMatched?: boolean; supported?: boolean }
        if (active && result?.focusedMatched) lastLocatedRef.current = focusKey
      } catch { /* 原句暂未匹配或 guest 尚未就绪时，保留阅读状态并等待后续重试 */ }
    }
    const retry = (): void => {
      void apply()
      timers.splice(0).forEach(clearTimeout)
      for (const delay of [800, 2000, 5000, 10000, 20000]) timers.push(setTimeout(() => void apply(), delay))
    }
    const ready = (): void => {
      // Chromium 错误页也会发出 dom-ready，不能把加载失败覆盖成成功。
      try {
        if (webview.getURL().startsWith('chrome-error://')) {
          readyRef.current = false
          setWebStatus('failed'); setWebError('原始网页未能加载。可以重试，或查看本地快照。')
          return
        }
      } catch { return }
      readyRef.current = true
      setWebStatus('ready'); setWebError('')
      // 导航会使上一份注入样式失效。
      cssKey = undefined
      retry()
    }
    const start = (event: Electron.DidStartNavigationEvent): void => {
      if (!event.isMainFrame || event.isInPlace) return
      readyRef.current = false
      lastLocatedRef.current = ''
      setWebStatus('loading'); setWebError('')
    }
    const fail = (event: Electron.DidFailLoadEvent): void => {
      if (!event.isMainFrame || event.errorCode === -3) return
      readyRef.current = false
      setWebStatus('failed'); setWebError('原始网页未能加载。可以重试，或查看本地快照。')
    }
    const consoleMessage = (event: Electron.ConsoleMessageEvent): void => {
      if (!event.message.startsWith(NOTE_CLICK_PREFIX)) return
      try {
        const payload = JSON.parse(event.message.slice(NOTE_CLICK_PREFIX.length)) as { id?: string }
        if (payload.id && conversation.notes.some(note => note.id === payload.id)) selectRef.current(payload.id)
      } catch { /* 忽略第三方页面中非本功能的日志 */ }
    }
    webview.addEventListener('dom-ready', ready)
    webview.addEventListener('did-navigate-in-page', ready)
    webview.addEventListener('did-stop-loading', retry)
    webview.addEventListener('did-start-navigation', start)
    webview.addEventListener('did-fail-load', fail)
    webview.addEventListener('console-message', consoleMessage)
    retry()
    return () => {
      active = false
      timers.forEach(clearTimeout)
      webview.removeEventListener('dom-ready', ready)
      webview.removeEventListener('did-navigate-in-page', ready)
      webview.removeEventListener('did-stop-loading', retry)
      webview.removeEventListener('did-start-navigation', start)
      webview.removeEventListener('did-fail-load', fail)
      webview.removeEventListener('console-message', consoleMessage)
      if (cssKey) removeCSS(cssKey)
    }
  }, [webStarted, open, mode, anchors, focusedId, sourceText, focusTick, conversation.notes])

  useEffect(() => {
    const root = transcriptRef.current
    if (!root || !open || mode !== 'snapshot' || !CSS.highlights || !window.Highlight) return
    const ranges = snapshotRanges(root, anchors)
    const focused = ranges.find(item => item.id === focusedId)
    CSS.highlights.set('multichat-local-note', new Highlight(...ranges.map(item => item.range)))
    CSS.highlights.set('multichat-local-note-focus', new Highlight(...(focused ? [focused.range] : [])))
    if (focused) focused.range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const click = (event: MouseEvent): void => {
      if (window.getSelection()?.toString()) return
      const hit = ranges.find(item => item.id !== MAP_SOURCE_ID && Array.from(item.range.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom))
      if (hit) selectRef.current(hit.id)
    }
    root.addEventListener('click', click)
    return () => {
      root.removeEventListener('click', click)
      CSS.highlights.delete('multichat-local-note')
      CSS.highlights.delete('multichat-local-note-focus')
    }
  }, [open, mode, snapshotStarted, markdown, anchors, focusedId, focusTick])

  return <aside className="notes-source" aria-label="原文对照" style={{ display: open ? undefined : 'none' }}>
    <header className="notes-source-header">
      <span className="material-symbols-outlined" aria-hidden="true">article</span>
      <select aria-label="原文来源" value={mode} onChange={event => setMode(event.target.value as 'web' | 'snapshot')}>
        {hasWebSource && <option value="web">原始网页</option>}
        <option value="snapshot">本地快照</option>
      </select>
      {mode === 'web' && <button type="button" className="notes-icon-button" title="刷新原始网页" aria-label="刷新原始网页" disabled={webStatus === 'loading'} onClick={() => {
        const webview = webviewRef.current
        if (!webview?.isConnected) return
        try { webview.reload(); setWebStatus('loading'); setWebError('') }
        catch { setWebStatus('failed'); setWebError('原始网页暂时无法刷新。可以稍后重试，或查看本地快照。') }
      }}><span className="material-symbols-outlined">refresh</span></button>}
      <button type="button" className="notes-icon-button" title="收起原文" aria-label="收起原文" onClick={onClose}><span className="material-symbols-outlined">close</span></button>
    </header>
    {mode === 'web' && webStatus === 'loading' && <div className="notes-source-notice" role="status">正在加载原始网页… <button onClick={() => setMode('snapshot')}>查看快照</button></div>}
    {mode === 'web' && webError && <div className="notes-source-notice is-warning" role="alert">{webError}<button onClick={() => setMode('snapshot')}>查看快照</button></div>}
    <div className="notes-source-web" style={{ display: mode === 'web' ? 'flex' : 'none' }}>
      {webStarted && <webview ref={webviewRef} src={conversation.url} partition="persist:shared" className={`w-full flex-1 ${resizing ? 'pointer-events-none' : ''}`} />}
    </div>
    {snapshotStarted && <div className="notes-snapshot-scroll" style={{ display: mode === 'snapshot' ? undefined : 'none' }}>
      <p className="notes-snapshot-meta">{conversation.platform} · 本地保存的原文</p>
      {!markdown ? <div className="notes-empty"><p>这份笔记没有保存快照</p><span>可切换到原始网页查看。</span></div> : <div ref={transcriptRef} className="notes-transcript">
        {blocks.map((block, index) => <div key={index} className={block.type === 'user' ? 'notes-message-user' : 'notes-message-assistant'}>
          {block.type !== 'markdown' && <p className="notes-message-role">{block.type === 'user' ? '我' : conversation.platform}{block.time ? ` · ${block.time}` : ''}</p>}
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
        </div>)}
      </div>}
    </div>}
  </aside>
}
