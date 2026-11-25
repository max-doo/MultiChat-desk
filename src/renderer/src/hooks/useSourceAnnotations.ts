import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Annotation, AnnotationAnchor } from '../../../shared/types/annotations'
import { NOTE_CLICK_PREFIX, NOTE_DISMISS_PREFIX } from '../../../shared/types/notes'
import { generateNoteHighlightScript } from '../utils/webviewScripts'
import { notePositionInWindow } from '../utils/noteInteractions'

const HIGHLIGHT_CSS =
  '::highlight(multichat-notes){background:rgba(251,191,36,.42);color:inherit;text-decoration:underline dashed rgba(217,119,6,.6)}' +
  '::highlight(multichat-note-focus){background:rgba(251,191,36,.72);color:inherit;text-decoration:underline solid rgba(217,119,6,.9)}'

export interface SourceHighlight {
  id: string
  quote: string
  anchor: AnnotationAnchor
  comment: string
  x: number
  y: number
}

export interface SourceAnnotationsState {
  annotations: Annotation[]
  /** 默认库不可用或读取失败时的可操作错误；不退回当前仓库。 */
  error: string | null
  loading: boolean
  /** 点击原文高亮后的评论位置；评论内容只在渲染层保留。 */
  hit: SourceHighlight | null
  closeHit: () => void
  refresh: () => void
  /** 原文高亮的评论被编辑后同步本地列表；持久化由调用方写回默认库。 */
  updateHitComment: (id: string, comment: string) => void
}

/**
 * 原文标注的共享回显层：只接收 sourceKey，读写根固定为主进程默认工作区。
 * 用于 WebviewCard 与工作台 AI 侧栏；捕捉时由调用方给出 captureContext。
 */
export function useSourceAnnotations(
  webviewRef: RefObject<Electron.WebviewTag>,
  enabled: boolean,
  sourceKey: string | null
): SourceAnnotationsState {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hit, setHit] = useState<SourceHighlight | null>(null)
  const generationRef = useRef(0)
  const cssKeyRef = useRef<string | null>(null)
  const injectedRef = useRef(false)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick(value => value + 1), [])
  const closeHit = useCallback(() => setHit(null), [])
  const updateHitComment = useCallback((id: string, comment: string) => {
    setAnnotations(items => items.map(item => (item.id === id ? { ...item, comment } : item)))
    setHit(current => (current?.id === id ? { ...current, comment } : current))
  }, [])

  // 读取默认库里的 source 标注；sourceKey 变化或外部广播时重拉。
  useEffect(() => {
    if (!enabled || !sourceKey) {
      setAnnotations([])
      setError(null)
      return
    }
    let alive = true
    const current = ++generationRef.current
    setLoading(true)
    void window.api.annotations
      .listSource(sourceKey)
      .then(result => {
        if (!alive || current !== generationRef.current) return
        if (!result.success) {
          setError(result.error || '会话库暂不可用')
          setAnnotations([])
          return
        }
        setAnnotations(result.data?.annotations ?? [])
        setError(null)
      })
      .catch(() => {
        if (alive && current === generationRef.current) setError('会话库暂不可用')
      })
      .finally(() => {
        if (alive && current === generationRef.current) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [enabled, sourceKey, tick])

  useEffect(() => {
    const off = window.api.annotations.onChanged(event => {
      if (event.scope === 'source' && (!sourceKey || event.sourceKey === sourceKey)) refresh()
    })
    return off
  }, [sourceKey, refresh])

  // 绘制高亮并监听点击；每次 DOM 重绘由脚本自己的 MutationObserver 补画。
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !enabled || !sourceKey) return
    if (annotations.length === 0) {
      if (injectedRef.current) {
        injectedRef.current = false
        try {
          void webview.executeJavaScript('window.__multichatNoteDispose?.()').catch(() => undefined)
        } catch {
          // guest 已销毁
        }
      }
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const draw = (): void => {
      if (disposed) return
      try {
        if (!webview.isConnected) return
      } catch {
        return
      }
      if (cssKeyRef.current === null) {
        void webview
          .insertCSS(HIGHLIGHT_CSS)
          .then(key => {
            if (disposed) {
              void webview.removeInsertedCSS(key).catch(() => undefined)
              return
            }
            cssKeyRef.current = key
          })
          .catch(() => undefined)
      }
      injectedRef.current = true
      void webview
        // 只把定位所需字段交给第三方页面；评论正文留在渲染层。
        .executeJavaScript(
          generateNoteHighlightScript(
            annotations.map(item => ({ id: item.id, anchor: item.anchor })),
            undefined,
            false
          )
        )
        .catch(() => undefined)
    }
    const schedule = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(draw, 400)
    }
    const resetStylesheet = (): void => {
      cssKeyRef.current = null
    }
    const onConsole = (event: Electron.ConsoleMessageEvent): void => {
      if (event.message.startsWith(NOTE_DISMISS_PREFIX)) {
        setHit(null)
        return
      }
      if (!event.message.startsWith(NOTE_CLICK_PREFIX)) return
      let payload: { id?: string; x?: number; y?: number }
      try {
        payload = JSON.parse(event.message.slice(NOTE_CLICK_PREFIX.length)) as typeof payload
      } catch {
        return
      }
      if (typeof payload.id !== 'string' || typeof payload.x !== 'number' || typeof payload.y !== 'number') return
      const note = annotations.find(item => item.id === payload.id)
      if (!note) return
      setHit({
        id: note.id,
        quote: note.quote,
        anchor: note.anchor,
        comment: note.comment,
        ...notePositionInWindow(webview, payload.x, payload.y)
      })
    }
    webview.addEventListener('console-message', onConsole)
    webview.addEventListener('dom-ready', resetStylesheet)
    webview.addEventListener('did-navigate', resetStylesheet)
    webview.addEventListener('dom-ready', schedule)
    webview.addEventListener('did-stop-loading', schedule)
    webview.addEventListener('did-navigate-in-page', schedule)
    schedule()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      webview.removeEventListener('console-message', onConsole)
      webview.removeEventListener('dom-ready', resetStylesheet)
      webview.removeEventListener('did-navigate', resetStylesheet)
      webview.removeEventListener('dom-ready', schedule)
      webview.removeEventListener('did-stop-loading', schedule)
      webview.removeEventListener('did-navigate-in-page', schedule)
      if (injectedRef.current) {
        injectedRef.current = false
        try {
          void webview.executeJavaScript('window.__multichatNoteDispose?.()').catch(() => undefined)
        } catch {
          // guest 已销毁
        }
      }
    }
  }, [webviewRef, enabled, sourceKey, annotations])

  return { annotations, error, loading, hit, closeHit, refresh, updateHitComment }
}

/** 用同一份评论数据刷新原文高亮；捕捉成功后由调用方触发。 */
export function useAnnotationCaptureListener(
  handler: (request: {
    mode: 'annotate' | 'excerpt'
    annotationId?: string
    platform: string
    title: string
    url: string
    snapshot: string
    quote: string
    anchor: AnnotationAnchor
    rect?: { left: number; top: number; right: number; bottom: number }
  }) => void
): void {
  useEffect(() => window.api.onAnnotationCapture(handler), [handler])
}
