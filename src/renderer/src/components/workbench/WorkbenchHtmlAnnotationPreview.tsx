import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Annotation, AnnotationAnchor } from '../../../../shared/types/annotations'
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
  zoom?: number
  onZoomStep?: (direction: -1 | 1) => void
  onZoomReset?: () => void
}

interface CommentCardState {
  id: string
  mode: 'create' | 'edit' | 'relocate'
  quote: string
  anchor: AnnotationAnchor
  left: number
  top: number
}

const CARD_WIDTH = 320
const CARD_ESTIMATED_HEIGHT = 250
const FRAME_READY_TIMEOUT_MS = 4500
const CAPTURE_TIMEOUT_MS = 3500
const RELOCATE_TIMEOUT_MS = 10_000
const WHEEL_ZOOM_THRESHOLD = 60

function buildResolutionFingerprint(items: Annotation[], unlocated: string[]): string {
  return `${items
    .map((item) => `${item.id}|${item.anchorRevision ?? 1}|${JSON.stringify(item.anchor)}`)
    .sort()
    .join('\n')}|${[...unlocated].sort().join(',')}`
}

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
  fileUrl,
  zoom = 1,
  onZoomStep,
  onZoomReset
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
  const [unlocatedIds, setUnlocatedIds] = useState<string[]>([])
  const [showUnresolved, setShowUnresolved] = useState(false)
  const [showCleanup, setShowCleanup] = useState(false)
  const [cleanupIds, setCleanupIds] = useState<string[]>([])
  const [unresolvedError, setUnresolvedError] = useState<string | null>(null)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const cardRef = useRef<CommentCardState | null>(null)
  const draftRef = useRef<Annotation | null>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const frameReadyRef = useRef(false)
  const busyRef = useRef(false)
  const cleanupIdsRef = useRef<string[]>([])
  const loadSeqRef = useRef(0)
  const captureSeqRef = useRef(0)
  const captureIdRef = useRef<string | null>(null)
  const captureTimerRef = useRef<number | null>(null)
  const pendingRelocateIdRef = useRef<string | null>(null)
  const relocateTimerRef = useRef<number | null>(null)
  const resolutionFingerprintRef = useRef('')
  const readyTimerRef = useRef<number | null>(null)
  const hintTimerRef = useRef<number | null>(null)
  const zoomRef = useRef(zoom)
  const onZoomStepRef = useRef(onZoomStep)
  const onZoomResetRef = useRef(onZoomReset)

  cardRef.current = card
  draftRef.current = draft
  busyRef.current = busy
  cleanupIdsRef.current = cleanupIds
  zoomRef.current = zoom
  onZoomStepRef.current = onZoomStep
  onZoomResetRef.current = onZoomReset

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

  const clearRelocateTimer = useCallback(() => {
    pendingRelocateIdRef.current = null
    if (relocateTimerRef.current !== null) {
      window.clearTimeout(relocateTimerRef.current)
      relocateTimerRef.current = null
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
    setUnlocatedIds([])
    setShowUnresolved(false)
    setShowCleanup(false)
    setCleanupIds([])
    setUnresolvedError(null)
    resolutionFingerprintRef.current = ''
    clearRelocateTimer()
  }, [clearRelocateTimer, filePath, workspacePath])

  useEffect(() => {
    if (!frameReady) return
    syncFrame(allAnnotations)
  }, [allAnnotations, frameReady, syncFrame])

  const closeCard = useCallback((discardDraft = true) => {
    const current = cardRef.current
    clearRelocateTimer()
    if (current?.mode === 'create' && discardDraft) {
      setDraft((previous) => (previous?.id === current.id ? null : previous))
    }
    if (current?.mode === 'edit') {
      postToFrame({ type: 'focus', id: '' })
    }
    setCard(null)
    setComment('')
    setError(null)
  }, [clearRelocateTimer, postToFrame])

  useEffect(() => {
    if (!frameReady) return
    postToFrame({ type: 'zoom', zoom })
    if (cardRef.current) closeCard()
  }, [closeCard, frameReady, postToFrame, zoom])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let accumulatedDelta = 0

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()

      const deltaScale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? 100
            : 1
      const delta = event.deltaY * deltaScale
      if (delta === 0) return

      if (Math.sign(delta) !== Math.sign(accumulatedDelta)) accumulatedDelta = 0
      accumulatedDelta += delta
      const steps = Math.trunc(accumulatedDelta / WHEEL_ZOOM_THRESHOLD)
      if (steps === 0) return

      accumulatedDelta =
        Math.abs(delta) >= WHEEL_ZOOM_THRESHOLD
          ? 0
          : accumulatedDelta - steps * WHEEL_ZOOM_THRESHOLD
      onZoomStepRef.current?.(steps > 0 ? -1 : 1)
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [])

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
        postToFrame({ type: 'zoom', zoom: zoomRef.current })
        syncFrame(annotationsRef.current)
        return
      }

      if (data.type === 'zoom-step' && (data.direction === 1 || data.direction === -1)) {
        onZoomStepRef.current?.(data.direction)
        return
      }

      if (data.type === 'zoom-reset') {
        onZoomResetRef.current?.()
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
        const pendingRelocateId = pendingRelocateIdRef.current
        if (pendingRelocateId) {
          clearRelocateTimer()
          const target = annotationsRef.current.find((item) => item.id === pendingRelocateId)
          if (!target) {
            showHint('原注释已删除')
            return
          }
          setCard({
            id: target.id,
            mode: 'relocate',
            quote: data.quote ?? target.quote,
            anchor: data.anchor,
            ...placeCard(data.rect)
          })
          setComment(target.comment)
          setError(null)
          setDraft((previous) => (previous?.id === target.id ? null : previous))
          return
        }
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
          anchor: next.anchor,
          ...placeCard(data.rect)
        })
        return
      }

      if (data.type === 'capture-error' && data.id === captureIdRef.current) {
        clearCaptureTimer()
        clearRelocateTimer()
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
          anchor: annotation.anchor,
          ...placeCard(
            data.rect ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
          )
        })
        return
      }

      if (data.type === 'dismiss') {
        clearRelocateTimer()
        if (busyRef.current) return
        closeCard()
      }

      if (data.type === 'resolved' && Array.isArray(data.unlocated)) {
        setUnlocatedIds(data.unlocated)
        const unlocated = data.unlocated as string[]
        const fingerprint = buildResolutionFingerprint(allAnnotations, unlocated)
        if (fingerprint === resolutionFingerprintRef.current) return
        if (!workspacePath || !filePath) return
        const resolutions = allAnnotations.map((item) => ({
          id: item.id,
          state: unlocated.includes(item.id) ? 'unlocated' as const : 'anchored' as const,
          baseAnchorRevision: item.anchorRevision ?? 1
        }))
        void window.api.annotations
          .reconcileDocument(workspacePath, filePath, resolutions)
          .then((result) => {
            if (!result.success) {
              resolutionFingerprintRef.current = ''
              setUnresolvedError(result.error || '标注状态保存失败')
              return
            }
            setUnresolvedError(null)
            if (result.success && result.data) {
              resolutionFingerprintRef.current = buildResolutionFingerprint(
                result.data.annotations,
                unlocated
              )
              setAnnotations(result.data.annotations)
            }
          })
          .catch(() => {
            resolutionFingerprintRef.current = ''
            setUnresolvedError('标注状态保存失败')
          })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [
    allAnnotations,
    clearCaptureTimer,
    clearRelocateTimer,
    closeCard,
    filePath,
    placeCard,
    postToFrame,
    showHint,
    syncFrame,
    workspacePath
  ])

  useEffect(() => {
    const handleAnnotateRequest = (): void => {
      if (!workspacePath || !filePath) return
      if (!frameReadyRef.current) {
        showHint('页面标注未就绪')
        return
      }
      if (captureIdRef.current) return
      if (!pendingRelocateIdRef.current) clearRelocateTimer()

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
  }, [clearRelocateTimer, filePath, postToFrame, showHint, workspacePath])

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
      clearRelocateTimer()
    }
  }, [clearRelocateTimer])

  const handleFrameLoad = useCallback((): void => {
    frameReadyRef.current = false
    setFrameReady(false)
    setFrameFailed(false)
    clearRelocateTimer()
    setUnlocatedIds([])
    resolutionFingerprintRef.current = ''
    armReadyTimer()
    postToFrame({ type: 'ping' })
  }, [armReadyTimer, clearRelocateTimer, postToFrame])

  const commitComment = async (): Promise<void> => {
    const current = cardRef.current
    if (!current || !workspacePath || !filePath || busyRef.current) return
    if (current.mode === 'relocate') {
      const annotation = annotationsRef.current.find((item) => item.id === current.id)
      if (!annotation) {
        closeCard()
        return
      }
      setBusy(true)
      setError(null)
      try {
        const result = await window.api.annotations.reanchorDocument(
          workspacePath,
          filePath,
          current.id,
          current.quote,
          current.anchor,
          annotation.anchorRevision ?? 1
        )
        if (!result.success || !result.data) {
          setError(result.error || '重新定位失败')
          return
        }
        const saved = result.data
        setAnnotations((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
        setUnlocatedIds((previous) => previous.filter((item) => item !== saved.id))
        closeCard(false)
        showHint('注释已重新定位')
      } catch {
        setError('重新定位失败')
      } finally {
        setBusy(false)
      }
      return
    }
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
      const result = draftRef.current?.id === current.id
        ? await window.api.annotations.createDocument(workspacePath, filePath, {
            ...next,
            id: draftRef.current.id,
            originalQuote: draftRef.current.originalQuote || next.quote,
            anchorState: 'anchored',
            anchorRevision: 1,
            lastAnchoredAt: Date.now()
          })
        : await window.api.annotations.updateDocumentComment(
            workspacePath,
            filePath,
            current.id,
            next.comment,
            annotation.updatedAt
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

  const deleteUnlocatedAnnotation = async (id: string): Promise<void> => {
    if (!workspacePath || !filePath || busyRef.current) return
    if (!window.confirm('删除这条未定位标注？')) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.annotations.deleteDocument(workspacePath, filePath, id)
      if (!result.success) {
        setError(result.error || '删除标注失败')
        return
      }
      setAnnotations((previous) => previous.filter((item) => item.id !== id))
      setUnlocatedIds((previous) => previous.filter((item) => item !== id))
    } catch {
      setError('删除标注失败')
    } finally {
      setBusy(false)
    }
  }

  const openCleanup = useCallback((): void => {
    setCleanupIds(unlocatedIds)
    setShowCleanup(true)
    setShowUnresolved(false)
  }, [unlocatedIds])

  const deleteUnlocatedAnnotations = async (): Promise<void> => {
    const ids = [...new Set(cleanupIdsRef.current)]
    if (!ids.length) {
      setShowCleanup(false)
      return
    }
    if (!window.confirm(`删除选中的 ${ids.length} 条未定位标注？`)) return
    if (!workspacePath || !filePath || busyRef.current) return
    setBusy(true)
    setError(null)
    const failedIds: string[] = []
    try {
      for (const id of ids) {
        const result = await window.api.annotations.deleteDocument(workspacePath, filePath, id)
        if (result.success) {
          setAnnotations((previous) => previous.filter((item) => item.id !== id))
          setUnlocatedIds((previous) => previous.filter((item) => item !== id))
          setCleanupIds((previous) => previous.filter((item) => item !== id))
        } else {
          failedIds.push(id)
        }
      }
      if (failedIds.length) {
        setCleanupIds(failedIds)
        setError(`${failedIds.length} 条标注删除失败`)
      } else {
        setShowCleanup(false)
        showHint('未定位标注已清理')
      }
    } catch {
      setError('未定位标注清理失败')
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

      {annotations.length >= 400 && (
        <div className="absolute left-1/2 top-12 z-30 -translate-x-1/2 rounded-lg border border-amber-500/30 bg-amber-50/95 px-3 py-1.5 text-xs text-amber-700 shadow-sm dark:border-amber-400/30 dark:bg-amber-950/80 dark:text-amber-300">
          当前文档标注 {annotations.length} 条，建议清理未解决注释
        </div>
      )}

      {unresolvedError && (
        <div className="absolute left-1/2 top-12 z-30 -translate-x-1/2 rounded-lg border border-rose-500/30 bg-rose-50/95 px-3 py-1.5 text-xs text-rose-600 shadow-sm dark:border-rose-400/30 dark:bg-rose-950/80 dark:text-rose-300">
          {unresolvedError}
        </div>
      )}

      {unlocatedIds.length > 0 && (
        <div className="absolute right-3 top-3 z-20">
          <button
            type="button"
            onClick={() => setShowUnresolved((previous) => !previous)}
            className="rounded-lg border border-rose-500/30 bg-white/95 px-2 py-1 text-xs font-semibold text-rose-600 shadow-sm dark:bg-gray-800/95 dark:text-rose-400"
          >
            未定位 {unlocatedIds.length}
          </button>
          {showUnresolved && (
            <div className="absolute right-0 top-9 w-64 max-h-72 overflow-y-auto rounded-lg border border-rose-500/30 bg-white p-2 text-left shadow-lg dark:bg-gray-800">
              {unlocatedIds.map((id) => {
                const annotation = annotations.find((item) => item.id === id)
                if (!annotation) return null
                return (
                  <div key={id} className="mb-2 rounded-md bg-rose-50/70 p-2 text-caption dark:bg-rose-950/30">
                    <div className="line-through decoration-rose-400/60 break-words text-text-secondary/70">
                      {annotation.originalQuote || annotation.quote}
                    </div>
                    <div className="mt-1 break-words text-text-primary">
                      {annotation.comment || '暂无评论'}
                    </div>
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          clearRelocateTimer()
                          pendingRelocateIdRef.current = id
                          relocateTimerRef.current = window.setTimeout(() => {
                            clearRelocateTimer()
                            showHint('重新定位超时')
                          }, RELOCATE_TIMEOUT_MS)
                          setShowUnresolved(false)
                          showHint('请选择新文字，再点击“标注”保存位置')
                        }}
                        className="rounded px-1.5 py-0.5 text-tiny text-primary hover:bg-primary/10"
                      >
                        重新定位
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (busyRef.current) return
                          void deleteUnlocatedAnnotation(id)
                        }}
                        className="rounded px-1.5 py-0.5 text-tiny text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-900/40"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                )
              })}
              <div className="mt-1.5 border-t border-rose-500/10 pt-1.5">
                <button
                  type="button"
                  onClick={openCleanup}
                  className="w-full rounded px-1.5 py-0.5 text-tiny text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-900/40"
                >
                  清理未解决
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showCleanup && (
        <div className="absolute right-3 top-14 z-30 w-72 rounded-lg border border-rose-500/30 bg-white p-3 text-left shadow-lg dark:bg-gray-800">
          <div className="text-xs font-semibold text-text-primary">清理未解决</div>
          {unlocatedIds.map((id) => {
            const annotation = annotations.find((item) => item.id === id)
            if (!annotation) return null
            return (
              <label key={id} className="mt-1.5 flex items-start gap-2 text-caption text-text-secondary">
                <input
                  type="checkbox"
                  checked={cleanupIds.includes(id)}
                  onChange={(event) => {
                    setCleanupIds((previous) =>
                      event.target.checked
                        ? [...new Set([...previous, id])]
                        : previous.filter((item) => item !== id)
                    )
                  }}
                  className="mt-0.5"
                />
                <span className="line-clamp-2 break-words">
                  {annotation.originalQuote || annotation.quote}
                </span>
              </label>
            )
          })}
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCleanup(false)}
              className="rounded px-2 py-1 text-caption text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || cleanupIds.length === 0}
              onClick={() => void deleteUnlocatedAnnotations()}
              className="rounded bg-rose-600 px-2 py-1 text-caption font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
            >
              删除
            </button>
          </div>
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
          saveLabel={card.mode === 'relocate' ? '保存位置' : '保存标注'}
          placeholder="添加评论…"
          busy={busy}
          error={error}
          footerStart={
            card.mode === 'edit' ? (
              <button
                type="button"
                className="text-caption text-rose-500 hover:underline disabled:opacity-40"
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
