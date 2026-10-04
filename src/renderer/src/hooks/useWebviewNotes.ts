import { useEffect, type RefObject } from 'react'
import { generateNoteHighlightScript } from '../utils/webviewScripts'
import {
  handleNoteHighlightClick, closeNotePopover, NOTE_CLICK_PREFIX, NOTE_DISMISS_PREFIX
} from '../utils/noteInteractions'

/** 同步网页笔记高亮并处理点击消息；包含订阅、防抖和失效结果清理。 */
export function useWebviewNotes(webviewRef: RefObject<Electron.WebviewTag>, enabled: boolean): void {
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    const handleConsoleMessage = (event: Electron.ConsoleMessageEvent): void => {
      if (event.message.startsWith(NOTE_DISMISS_PREFIX)) {
        closeNotePopover()
      } else if (event.message.startsWith(NOTE_CLICK_PREFIX)) {
        void handleNoteHighlightClick(webview, event.message)
      }
    }
    const refresh = (): void => {
      if (timer) clearTimeout(timer)
      const current = ++generation
      timer = setTimeout(() => {
        let currentUrl: string
        try { currentUrl = webview.getURL() } catch { return }
        if (!currentUrl?.startsWith('https://')) return
        void window.api.notesAnchorsForUrl(currentUrl).then(result => {
          if (current !== generation || !result.success) return
          try {
            void webview.insertCSS('::highlight(multichat-notes){background:#fde68a;color:inherit}::highlight(multichat-note-focus){background:#fbbf24;color:inherit}').catch(() => undefined)
            void webview.executeJavaScript(generateNoteHighlightScript(result.data || [])).catch(() => undefined)
          } catch { /* Webview 可能已导航 */ }
        })
      }, 500)
    }
    webview.addEventListener('console-message', handleConsoleMessage)
    webview.addEventListener('dom-ready', refresh)
    webview.addEventListener('did-stop-loading', refresh)
    webview.addEventListener('did-navigate-in-page', refresh)
    const unsubscribeNotes = window.api.onNotesChanged(refresh)
    return () => {
      generation++
      if (timer) clearTimeout(timer)
      webview.removeEventListener('console-message', handleConsoleMessage)
      webview.removeEventListener('dom-ready', refresh)
      webview.removeEventListener('did-stop-loading', refresh)
      webview.removeEventListener('did-navigate-in-page', refresh)
      unsubscribeNotes()
    }
  }, [webviewRef, enabled])
}
