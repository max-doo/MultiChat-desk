import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Annotation } from '../../../../shared/types/annotations'
import {
  WORKBENCH_HTML_ANNOTATION_EVENT,
  WORKBENCH_HTML_ANNOTATION_MESSAGE_SOURCE,
  WORKBENCH_HTML_ANNOTATION_QUERY,
  type WorkbenchHtmlAnnotationFrameMessage,
  type WorkbenchHtmlAnnotationRect
} from '../../../../shared/types/htmlAnnotations'
import { useWorkbenchStore } from '../../store/workbenchStore'
import AnnotationCommentCard from '../AnnotationCommentCard'
import { AppIcon } from '../icons/AppIcon'

interface WorkbenchHtmlAnnotationPreviewProps {
  filePath: string
  fileUrl: string
}

interface CommentCardState {
  id: string
  mode: 'create' | 'edit'
  quote: string
  left: number
  top: number
}

const CARD_WIDTH = 320
const CARD_ESTIMATED_HEIGHT = 250
const FRAME_READY_TIMEOUT_MS = 4500
const CAPTURE_TIMEOUT_MS = 3500

function buildAnnotationUrl(fileUrl: string): string {
  try {
    const url = new URL(fileUrl)
    url.searchParams.set(WORKBENCH_HTML_ANNOTATION_QUERY, '1')
    url.searchParams.set('v', String(Date.now()))
    return url.toString()
  } catch {
    return fileUrl
  }
}

const CAPTURE_ERRORS: Record<string, string> = {
  'no-selection': '没有可标注的选中文字',
  'invalid-selection': '所选文字不在页面正文中',
  'empty-selection': '请选择有内容的文字',
  'too-large': '所选文字过长，无法标注'
}

export default function WorkbenchHtmlAnnotationPreview({
  filePath,
  fileUrl
}: WorkbenchHtmlAnnotationPreviewProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const [src] = useState(() => buildAnnotationUrl(fileUrl))
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [card, setCard] = useState<CommentCardState | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [frameFailed, setFrameFailed] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const cardRef = useRef<CommentCardState | null>(null)
  const draftRef = useRef<Annotation | null>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const frameReadyRef = useRef(false)
  const busyRef = useRef(false)
  const loadSeqRef = useRef(0)
  const captureSeqRef = useRef(0)
  const captureIdRef = useRef<string | null>(null)
  const captureTimerRef = useRef<number | null>(null)
  const readyTimerRef = useRef<number | null>(null)
  const hintTimerRef = useRef<number | null>(null)

  cardRef.current = card
  draftRef.current = draft
  busyRef.current = busy

  const allAnnotations = useMemo(() => {
    if (!draft) return annotations
    const exists = annotations.some((item) => item.id === draft.id)
    return exists
      ? annotations.map((item) => (item.id === draft.id ? draft : item))
      : [...annotations, draft]
  }, [annotations, draft])
  annotationsRef.current = allAnnotations

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: WORKBENCH_HTML_ANNOTATION_MESSAGE_SOURCE, ...message },
      '*'
    )
  }, [])

  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null
      setHint(null)
    }, 2800)
  }, [])

  const syncFrame = useCallback(
    (items: Annotation[]) => {
      if (!frameReadyRef.current) return
      postToFrame({
        type: 'sync',
        annotations: items.map((item) => ({ id: item.id, anchor: item.anchor }))
      })
    },
    [postToFrame]
  )

  const clearCaptureTimer = useCallback(() => {
    captureIdRef.current = null
    if (captureTimerRef.current !== null) {
      window.clearTimeout(captureTimerRef.current)
      captureTimerRef.current = null
    }
  }, [])

  const loadAnnotations = useCallback(async (): Promise<void> => {
    if (!workspacePath || !filePath) {
      setAnnotations([])
      return
    }
    const seq = ++loadSeqRef.current
    try {
      const result = await window.api.annotations.listDocument(workspacePath, filePath)
      if (seq !== loadSeqRef.current) return
      if (result.success) {
        setAnnotations(result.data ?? [])
        return
      }
      setAnnotations([])
      showHint(result.error || '标注读取失败')
    } catch {
      if (seq !== loadSeqRef.current) return
      setAnnotations([])
      showHint('标注读取失败')
    }
  }, [filePath, showHint, workspacePath])

  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])

  useEffect(() => {
    if (!workspacePath || !filePath) return
    return window.api.annotations.onChanged((event) => {
      if (
        event.scope === 'document' &&
        event.workspaceRoot === workspacePath &&
        event.relativePath === filePath
      ) {
        void loadAnnotations()
      }
    })
  }, [filePath, loadAnnotations, workspacePath])

  useEffect(() => {
    setCard(null)
    setComment('')
    setError(null)
    setDraft(null)
  }, [filePath, workspacePath])

  useEffect(() => {
    if (!frameReady) return
    syncFrame(allAnnotations)
  }, [allAnnotations, frameReady, syncFrame])

  const closeCard = useCallback((discardDraft = true) => {
    const current = cardRef.current
    if (current?.mode === 'create' && discardDraft) {
      setDraft((previous) => (previous?.id === current.id ? null : previous))
    }
    if (current?.mode === 'edit') {
      postToFrame({ type: 'focus', id: '' })
    }
    setCard(null)
    setComment('')
    setError(null)
  }, [postToFrame])

  const placeCard = useCallback(
    (rect: WorkbenchHtmlAnnotationRect): { left: number; top: number } => {
      const stage = stageRef.current
      const iframe = iframeRef.current
      const stageRect = stage?.getBoundingClientRect()
      const frameRect = iframe?.getBoundingClientRect()
      const offsetLeft = (frameRect?.left ?? 0) - (stageRect?.left ?? 0)
      const offsetTop = (frameRect?.top ?? 0) - (stageRect?.top ?? 0)
      const width = stage?.clientWidth ?? 0
      const height = stage?.clientHeight ?? 0

      const left = Math.max(
        8,
        Math.min(offsetLeft + rect.left, Math.max(8, width - CARD_WIDTH - 8))
      )
      const below = offsetTop + rect.bottom + 8
      const above = offsetTop + rect.top - CARD_ESTIMATED_HEIGHT - 8
      const top =
        below + CARD_ESTIMATED_HEIGHT <= height - 8
          ? below
          : Math.max(8, Math.min(above, height - CARD_ESTIMATED_HEIGHT - 8))
      return { left, top }
    },
    []
  )

  const armReadyTimer = useCallback(() => {
    if (readyTimerRef.current !== null) window.clearTimeout(readyTimerRef.current)
    readyTimerRef.current = window.setTimeout(() => {
      readyTimerRef.current = null
      if (!frameReadyRef.current) setFrameFailed(true)
    }, FRAME_READY_TIMEOUT_MS)
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<WorkbenchHtmlAnnotationFrameMessage>): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (!data || data.source !== WORKBENCH_HTML_ANNOTATION_MESSAGE_SOURCE) return

      if (data.type === 'ready') {
        frameReadyRef.current = true
        setFrameReady(true)
        setFrameFailed(false)
        if (readyTimerRef.current !== null) {
          window.clearTimeout(readyTimerRef.current)
          readyTimerRef.current = null
        }
        syncFrame(annotationsRef.current)
        return
      }

      if (
        data.type === 'capture-result' &&
        data.id === captureIdRef.current &&
        data.anchor &&
        data.rect
      ) {
        clearCaptureTimer()
        postToFrame({ type: 'focus', id: '' })
        const now = Date.now()
        const next: Annotation = {
          id: crypto.randomUUID(),
          scope: 'document',
          quote: data.quote ?? '',
          anchor: data.anchor,
          comment: '',
          createdAt: now,
          updatedAt: now
        }
        setDraft(next)
        setComment('')
        setError(null)
        setCard({
          id: next.id,
          mode: 'create',
          quote: next.quote,
          ...placeCard(data.rect)
        })
        return
      }

      if (data.type === 'capture-error' && data.id === captureIdRef.current) {
        clearCaptureTimer()
        showHint(
          (data.error && CAPTURE_ERRORS[data.error]) || '没有获取到可标注的文字'
        )
        return
      }

      if (data.type === 'hit' && typeof data.id === 'string') {
        const annotation = annotationsRef.current.find((item) => item.id === data.id)
        if (!annotation) {
          syncFrame(annotationsRef.current)
          return
        }
        if (draftRef.current && draftRef.current.id !== annotation.id) {
          setDraft(null)
        }
        setComment(annotation.comment)
        setError(null)
        setCard({
          id: annotation.id,
          mode: 'edit',
          quote: annotation.quote,
          ...placeCard(
            data.rect ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
          )
        })
        return
      }

      if (data.type === 'dismiss') {
        if (busyRef.current) return
        closeCard()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [clearCaptureTimer, closeCard, placeCard, postToFrame, showHint, syncFrame])

  useEffect(() => {
    const handleAnnotateRequest = (): void => {
      if (!workspacePath || !filePath) return
      if (!frameReadyRef.current) {
        showHint('页面标注未就绪')
        return
      }
      if (captureIdRef.current) return

      const id = `mha-${++captureSeqRef.current}`
      captureIdRef.current = id
      captureTimerRef.current = window.setTimeout(() => {
        captureIdRef.current = null
        captureTimerRef.current = null
        showHint('没有获取到选中的文字，请重新选择')
      }, CAPTURE_TIMEOUT_MS)
      postToFrame({ type: 'capture', id })
    }

    window.addEventListener(WORKBENCH_HTML_ANNOTATION_EVENT, handleAnnotateRequest)
    return () =>
      window.removeEventListener(WORKBENCH_HTML_ANNOTATION_EVENT, handleAnnotateRequest)
  }, [filePath, postToFrame, showHint, workspacePath])

  useEffect(() => {
    if (!card) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-annotation-popover]')) return
      if (busyRef.current) return
      closeCard()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busyRef.current) return
      event.preventDefault()
      closeCard()
    }
    const handleResize = (): void => closeCard()
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [card, closeCard])

  useEffect(() => {
    return () => {
      if (captureTimerRef.current !== null) window.clearTimeout(captureTimerRef.current)
      if (readyTimerRef.current !== null) window.clearTimeout(readyTimerRef.current)
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    }
  }, [])

  const handleFrameLoad = useCallback((): void => {
    frameReadyRef.current = false
    setFrameReady(false)
    setFrameFailed(false)
    armReadyTimer()
    postToFrame({ type: 'ping' })
  }, [armReadyTimer, postToFrame])

  const commitComment = async (): Promise<void> => {
    const current = cardRef.current
    if (!current || !workspacePath || !filePath || busyRef.current) return
    const annotation = annotationsRef.current.find((item) => item.id === current.id)
    if (!annotation) {
      closeCard()
      return
    }

    setBusy(true)
    setError(null)
    try {
      const next: Annotation = {
        ...annotation,
        comment: comment.trim(),
        updatedAt: Date.now()
      }
      const result = await window.api.annotations.upsertDocument(
        workspacePath,
        filePath,
        next
      )
      if (!result.success) {
        setError(result.error || '标注保存失败')
        return
      }
      const saved = result.data ?? next
      setAnnotations((previous) => {
        const exists = previous.some((item) => item.id === saved.id)
        return exists
          ? previous.map((item) => (item.id === saved.id ? saved : item))
          : [...previous, saved]
      })
      setDraft((previous) => (previous?.id === saved.id ? null : previous))
      closeCard(false)
    } catch {
      setError('标注保存失败')
    } finally {
      setBusy(false)
    }
  }

  const deleteAnnotation = async (): Promise<void> => {
    const current = cardRef.current
    if (!current || !workspacePath || !filePath || busyRef.current) return
    if (!window.confirm('删除这条标注？页面中的高亮会一起移除。')) return

    setBusy(true)
    setError(null)
    try {
      const result = await window.api.annotations.deleteDocument(
        workspacePath,
        filePath,
        current.id
      )
      if (!result.success) {
        setError(result.error || '删除标注失败')
        return
      }
      setAnnotations((previous) => previous.filter((item) => item.id !== current.id))
      setDraft((previous) => (previous?.id === current.id ? null : previous))
      closeCard(false)
    } catch {
      setError('删除标注失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={stageRef} className="relative flex-1 h-full overflow-hidden bg-white">
      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts"
        onLoad={handleFrameLoad}
        className="w-full h-full border-0 block"
        title={filePath ? `${filePath} 标注预览` : 'HTML 标注预览'}
      />

      {frameFailed && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-amber-500/95 px-3 py-2 text-xs text-white">
          <AppIcon name="warning" size={15} />
          <span>标注脚本未启动，暂时无法添加标注</span>
        </div>
      )}

      {hint && (
        <div
          className={`pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs text-white shadow-lg ${
            frameFailed ? 'top-12' : 'top-3'
          }`}
        >
          {hint}
        </div>
      )}

      {card && (
        <AnnotationCommentCard
          className="absolute z-30"
          style={{ left: card.left, top: card.top }}
          title={card.mode === 'create' ? '标注' : '修改评论'}
          quote={card.quote}
          value={comment}
          onChange={setComment}
          onCancel={() => closeCard()}
          onSave={() => void commitComment()}
          saveLabel="保存标注"
          placeholder="添加评论…"
          busy={busy}
          error={error}
          footerStart={
            card.mode === 'edit' ? (
              <button
                type="button"
                className="text-[11px] text-rose-500 hover:underline disabled:opacity-40"
                disabled={busy}
                onClick={() => void deleteAnnotation()}
              >
                删除标注
              </button>
            ) : null
          }
        />
      )}
    </div>
  )
}
