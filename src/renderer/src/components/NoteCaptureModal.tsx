import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotationCaptureRequest, CapturedDocumentRef } from '../../../shared/types/annotations'
import { useWorkbenchStore } from '../store/workbenchStore'
import { captureContextOf } from '../utils/annotationCaptureContext'
import {
  ANNOTATION_CARD_WIDTH,
  clampPopoverPosition,
  notePositionInWindow
} from '../utils/noteInteractions'
import AnnotationCommentCard from './AnnotationCommentCard'
import { StatusBanner } from './ui/FormControls'

interface PendingCapture {
  request: AnnotationCaptureRequest
  left: number
  top: number
}

/**
 * 原文选区采集：右键“标注 / 摘录为文档”后的小评论框。
 * 主进程只把选区和快照发过来；写 source 标注、补会话文档都由 annotations:capture-source 完成。
 */
export default function NoteCaptureModal(): JSX.Element | null {
  const [pending, setPending] = useState<PendingCapture | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ document?: CapturedDocumentRef } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const workspaceRoot = useWorkbenchStore(s => s.workspacePath)

  useEffect(() => {
    const onCapture = (request: AnnotationCaptureRequest): void => {
      setError(null)
      setNotice(null)
      setSuccess(null)
      setComment('')
      const webview = Array.from(document.querySelectorAll('webview')).find(element => {
        try {
          return (element as Electron.WebviewTag).getWebContentsId() === request.webContentsId
        } catch {
          return false
        }
      }) as Electron.WebviewTag | undefined
      const position =
        webview && request.rect
          ? notePositionInWindow(webview, request.rect.right, request.rect.bottom)
          : { x: window.innerWidth - ANNOTATION_CARD_WIDTH - 12, y: 80 }
      const clamped = clampPopoverPosition(
        position.x + 8,
        position.y + 8,
        { width: window.innerWidth, height: window.innerHeight },
        {},
        12,
        48
      )
      setPending({
        request,
        ...clamped
      })
    }
    const offCapture = window.api.onAnnotationCapture(onCapture)
    const offError = window.api.onAnnotationCaptureError(payload => setError(payload.error))
    return () => {
      offCapture()
      offError()
    }
  }, [])

  useEffect(() => {
    if (!pending) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (boxRef.current && target && !boxRef.current.contains(target)) setPending(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPending(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [pending])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(null), 5000)
    return () => clearTimeout(timer)
  }, [success])

  const save = useCallback(
    async (saveToLibrary = false): Promise<void> => {
      if (!pending || busy) return
      const { request } = pending
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const captureContext = saveToLibrary ? 'global' : captureContextOf(request.webContentsId)
        if (request.mode === 'excerpt') {
          const result = await window.api.annotations.captureExcerpt({
            captureContext,
            workspaceRoot: captureContext === 'workbench' ? workspaceRoot ?? undefined : undefined,
            platform: request.platform,
            title: request.title,
            url: request.url,
            quote: request.quote,
            comment: comment.trim() || undefined
          })
          if (!result.success) {
            setError(result.error || '摘录保存失败')
            return
          }
          if (!result.data?.document) {
            setError(documentErrorMessage(result.data?.documentError))
            return
          }
          setPending(null)
          if (captureContext === 'global') setSuccess({ document: result.data.document })
          return
        }

        const result = await window.api.annotations.captureSource({
          annotationId: request.annotationId ?? crypto.randomUUID(),
          captureContext,
          workspaceRoot: captureContext === 'workbench' ? workspaceRoot ?? undefined : undefined,
          platform: request.platform,
          title: request.title,
          url: request.url,
          snapshot: request.snapshot,
          quote: request.quote,
          anchor: request.anchor,
          comment: comment.trim()
        })
        if (!result.success) {
          setError(result.error || '标注保存失败')
          return
        }
        if (result.data?.documentError) {
          setNotice(documentErrorMessage(result.data.documentError))
        } else {
          setPending(null)
          if (captureContext === 'global') setSuccess({ document: result.data?.document })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存失败')
      } finally {
        setBusy(false)
      }
    },
    [busy, comment, pending, workspaceRoot]
  )

  if (!pending && !error && !notice && !success) return null

  const pendingIsWorkbench = pending ? captureContextOf(pending.request.webContentsId) === 'workbench' : false

  return (
    <>
      {pending && (
        <AnnotationCommentCard
          ref={boxRef}
          className="fixed z-[95]"
          style={{ left: pending.left, top: pending.top }}
          clampBounds="viewport"
          clampMargin={12}
          clampMinTop={48}
          title={pending.request.mode === 'excerpt' ? '摘录为文档' : '标注'}
          quote={pending.request.quote}
          value={comment}
          onChange={setComment}
          onCancel={() => setPending(null)}
          onSave={() => void save(false)}
          saveLabel={pendingIsWorkbench
            ? (pending.request.mode === 'excerpt' ? '保存文档' : '保存标注')
            : '存入默认工作区'}
          busy={busy}
          error={error}
          showInput={pending.request.mode === 'annotate'}
          footerStart={
            pending.request.mode === 'annotate' &&
            pendingIsWorkbench ? (
              <button
                type="button"
                disabled={busy}
                className="text-caption text-text-secondary hover:text-primary disabled:opacity-40"
                onClick={() => void save(true)}
              >
                存入默认工作区
              </button>
            ) : null
          }
        />
      )}
      {!pending && error && (
        <StatusBanner
          tone="error"
          message={error}
          onClose={() => setError(null)}
        />
      )}
      {!pending && !error && notice && (
        <StatusBanner
          tone="warning"
          variant="soft"
          message={notice}
          onClose={() => setNotice(null)}
        />
      )}
      {!pending && success && (
        <StatusBanner
          tone="success"
          variant="soft"
          message="已存入默认工作区"
          onClose={() => setSuccess(null)}
          actions={
            success.document ? (
              <button
                type="button"
                className="px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/15"
                onClick={() => {
                  const ref = success.document
                  if (!ref) return
                  setSuccess(null)
                  void window.api.annotations.openCapturedDocument(ref)
                }}
              >
                打开
              </button>
            ) : undefined
          }
        />
      )}
    </>
  )
}

function documentErrorMessage(error?: string): string {
  switch (error) {
    case 'NO_ACTIVE_WORKSPACE':
      return '当前没有活动工作区，标注已保存，可改存默认工作区'
    case 'WORKSPACE_UNAVAILABLE':
      return '当前工作区暂不可用，标注已保存，文档未生成'
    case 'SCAN_INCOMPLETE':
      return '来源扫描未完成，标注已保存，文档未生成'
    case 'OVERSIZE':
      return '会话过大，无法生成可打开的工作台文档'
    case 'SOURCE_NOT_FOUND':
      return '默认工作区里没有这段会话的标注'
    case 'WRITE_FAILED':
      return '文档写入失败，标注已保存'
    default:
      return error ? `文档未生成：${error}` : ''
  }
}
