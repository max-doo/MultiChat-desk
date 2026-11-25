import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchHtmlEditToolbar, {
  type WorkbenchHtmlEditCommand
} from './WorkbenchHtmlEditToolbar'
import {
  WORKBENCH_HTML_EDIT_MESSAGE_SOURCE,
  WORKBENCH_HTML_EDIT_QUERY
} from '../../../../shared/utils/workbenchHtmlEditor'

interface SelectionRect {
  top: number
  left: number
  width: number
  height: number
  right: number
  bottom: number
}

interface HtmlEditSelection {
  rect: SelectionRect
  crumb: string
  textColor: string
  backgroundColor: string
  canReorder: boolean
  canAdd: boolean
  canDuplicate: boolean
  canDelete: boolean
  interactive: boolean
}

interface PendingSerialization {
  resolve: (html: string) => void
  reject: (error: Error) => void
  timer: number
}

interface SerializedMessage {
  source?: string
  type?: string
  id?: string
  html?: string
  rect?: SelectionRect
  crumb?: string
  textColor?: string
  backgroundColor?: string
  canReorder?: boolean
  canAdd?: boolean
  canDuplicate?: boolean
  canDelete?: boolean
  interactive?: boolean
}

export interface WorkbenchHtmlVisualEditorHandle {
  hasChanges: () => boolean
  markSaved: () => void
  serializeCurrent: () => Promise<string>
}

interface WorkbenchHtmlVisualEditorProps {
  filePath: string
  fileUrl: string
  onDirtyChange: (dirty: boolean) => void
  onRequestSave: () => void
}

const READY_TIMEOUT_MS = 4500
const SERIALIZE_TIMEOUT_MS = 4000
const DRAG_HANDLE_SIZE = 24
const DRAG_HANDLE_GAP = 6
const DRAG_HANDLE_EDGE_INSET = 4

function buildEditUrl(fileUrl: string): string {
  try {
    const url = new URL(fileUrl)
    url.searchParams.set(WORKBENCH_HTML_EDIT_QUERY, '1')
    url.searchParams.set('v', String(Date.now()))
    return url.toString()
  } catch {
    return fileUrl
  }
}

const WorkbenchHtmlVisualEditor = forwardRef<
  WorkbenchHtmlVisualEditorHandle,
  WorkbenchHtmlVisualEditorProps
>(function WorkbenchHtmlVisualEditor(
  { filePath, fileUrl, onDirtyChange, onRequestSave },
  ref
): JSX.Element {
  const setHtmlEditFlusher = useWorkbenchStore((s) => s.setHtmlEditFlusher)
  const setHtmlVisualEditing = useWorkbenchStore((s) => s.setHtmlVisualEditing)
  const markActiveFileDirty = useWorkbenchStore((s) => s.markActiveFileDirty)

  const [editSrc] = useState(() => buildEditUrl(fileUrl))
  const [selection, setSelection] = useState<HtmlEditSelection | null>(null)
  const [toolbarPos, setToolbarPos] = useState<{ left: number; top: number } | null>(null)
  const [dragHandlePos, setDragHandlePos] = useState<{
    left: number
    top: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [failed, setFailed] = useState(false)
  const [layoutTick, setLayoutTick] = useState(0)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const toolbarWrapRef = useRef<HTMLDivElement | null>(null)
  const dirtyRef = useRef(false)
  const readyRef = useRef(false)
  const readyTimerRef = useRef<number | null>(null)
  const serializeSeqRef = useRef(0)
  const pendingRef = useRef(new Map<string, PendingSerialization>())
  const onDirtyChangeRef = useRef(onDirtyChange)
  const onRequestSaveRef = useRef(onRequestSave)

  onDirtyChangeRef.current = onDirtyChange
  onRequestSaveRef.current = onRequestSave

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: WORKBENCH_HTML_EDIT_MESSAGE_SOURCE, ...message },
      '*'
    )
  }, [])

  const requestSerialization = useCallback((): Promise<string> => {
    // 编辑脚本尚未就绪时没有可视化改动，直接回落到已加载的源码，避免阻塞切文件。
    if (!readyRef.current) {
      return Promise.resolve(useWorkbenchStore.getState().activeFileContent)
    }
    const id = `mve-${++serializeSeqRef.current}`
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(id)
        reject(new Error('编辑页面响应超时'))
      }, SERIALIZE_TIMEOUT_MS)
      pendingRef.current.set(id, { resolve, reject, timer })
      postToFrame({ type: 'serialize', id })
    })
  }, [postToFrame])

  const armReadyTimer = useCallback(() => {
    if (readyTimerRef.current !== null) window.clearTimeout(readyTimerRef.current)
    readyTimerRef.current = window.setTimeout(() => {
      if (!readyRef.current) setFailed(true)
    }, READY_TIMEOUT_MS)
  }, [])

  // 保存、切文件、关闭工作区等路径统一由 store 在写盘前拉取 iframe 最新 DOM。
  useEffect(() => {
    setHtmlEditFlusher(requestSerialization)
    setHtmlVisualEditing(true)
    return () => {
      setHtmlEditFlusher(null)
      setHtmlVisualEditing(false)
    }
  }, [requestSerialization, setHtmlEditFlusher, setHtmlVisualEditing])

  useEffect(() => {
    armReadyTimer()
    return () => {
      if (readyTimerRef.current !== null) window.clearTimeout(readyTimerRef.current)
    }
  }, [armReadyTimer])

  useEffect(() => {
    return () => {
      for (const pending of pendingRef.current.values()) {
        window.clearTimeout(pending.timer)
        pending.reject(new Error('编辑页面已关闭'))
      }
      pendingRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<SerializedMessage>): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (!data || data.source !== WORKBENCH_HTML_EDIT_MESSAGE_SOURCE) return

      if (data.type === 'ready') {
        readyRef.current = true
        setFailed(false)
        if (readyTimerRef.current !== null) {
          window.clearTimeout(readyTimerRef.current)
          readyTimerRef.current = null
        }
        return
      }
      if (data.type === 'dirty') {
        if (!dirtyRef.current) {
          dirtyRef.current = true
          onDirtyChangeRef.current(true)
          markActiveFileDirty()
        }
        return
      }
      if (data.type === 'selection' && data.rect && typeof data.crumb === 'string') {
        setSelection({
          rect: data.rect,
          crumb: data.crumb,
          textColor: typeof data.textColor === 'string' ? data.textColor : '',
          backgroundColor:
            typeof data.backgroundColor === 'string' ? data.backgroundColor : '',
          canReorder: !!data.canReorder,
          canAdd: !!data.canAdd,
          canDuplicate: !!data.canDuplicate,
          canDelete: !!data.canDelete,
          interactive: !!data.interactive
        })
        return
      }
      if (data.type === 'selection-cleared') {
        setSelection(null)
        return
      }
      if (data.type === 'save-request') {
        onRequestSaveRef.current()
        return
      }
      if (data.type === 'drag-ended') {
        setIsDragging(false)
        return
      }
      if (data.type === 'serialized' && data.id) {
        const pending = pendingRef.current.get(data.id)
        if (!pending) return
        pendingRef.current.delete(data.id)
        window.clearTimeout(pending.timer)
        if (typeof data.html === 'string') pending.resolve(data.html)
        else pending.reject(new Error('编辑页面返回了空内容'))
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [markActiveFileDirty])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setLayoutTick((value) => value + 1))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!selection) {
      setToolbarPos(null)
      setDragHandlePos(null)
      return
    }
    const stage = stageRef.current
    const iframe = iframeRef.current
    const wrap = toolbarWrapRef.current
    if (!stage || !iframe || !wrap) return

    const stageRect = stage.getBoundingClientRect()
    const iframeRect = iframe.getBoundingClientRect()
    const toolbarWidth = wrap.offsetWidth
    const toolbarHeight = wrap.offsetHeight
    let top =
      iframeRect.top - stageRect.top + selection.rect.top - toolbarHeight - 8
    if (top < 6) {
      top =
        iframeRect.top -
        stageRect.top +
        Math.min(selection.rect.bottom + 8, iframeRect.height - toolbarHeight - 6)
    }
    let left = iframeRect.left - stageRect.left + selection.rect.left
    left = Math.max(
      6,
      Math.min(left, iframeRect.right - stageRect.left - toolbarWidth - 6)
    )
    setToolbarPos((previous) =>
      previous &&
      Math.abs(previous.left - left) < 0.5 &&
      Math.abs(previous.top - top) < 0.5
        ? previous
        : { left, top }
    )

    if (!selection.canReorder) {
      setDragHandlePos(null)
      return
    }
    const iframeLeft = iframeRect.left - stageRect.left
    const iframeTop = iframeRect.top - stageRect.top
    const elementLeft = iframeLeft + selection.rect.left
    const elementTop = iframeTop + selection.rect.top
    const minLeft = iframeLeft + DRAG_HANDLE_EDGE_INSET
    const minTop = iframeTop + DRAG_HANDLE_EDGE_INSET
    const maxLeft =
      iframeRect.right - stageRect.left - DRAG_HANDLE_SIZE - DRAG_HANDLE_EDGE_INSET
    const maxTop =
      iframeRect.bottom - stageRect.top - DRAG_HANDLE_SIZE - DRAG_HANDLE_EDGE_INSET

    // 手柄必须完整落在选中容器外侧；贴边时宁可隐藏，也不压住正文。
    const leftPlacement = elementLeft - DRAG_HANDLE_SIZE - DRAG_HANDLE_GAP
    const abovePlacement = elementTop - DRAG_HANDLE_SIZE - DRAG_HANDLE_GAP
    let nextPos: { left: number; top: number } | null = null
    if (
      leftPlacement >= minLeft &&
      leftPlacement <= maxLeft &&
      elementTop >= minTop &&
      elementTop <= maxTop
    ) {
      nextPos = { left: leftPlacement, top: elementTop }
    } else if (abovePlacement >= minTop && abovePlacement <= maxTop) {
      nextPos = {
        left: Math.max(minLeft, Math.min(elementLeft, maxLeft)),
        top: abovePlacement
      }
    }
    setDragHandlePos((previous) =>
      nextPos
        ? previous &&
          Math.abs(previous.left - nextPos.left) < 0.5 &&
          Math.abs(previous.top - nextPos.top) < 0.5
          ? previous
          : nextPos
        : null
    )
  }, [selection, layoutTick])

  useEffect(() => {
    if (!isDragging) return
    const coordinates = (event: PointerEvent): { x: number; y: number } => {
      const iframe = iframeRef.current
      if (!iframe) return { x: 0, y: 0 }
      const rect = iframe.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top))
      }
    }
    const handleMove = (event: PointerEvent): void => {
      const { x, y } = coordinates(event)
      postToFrame({ type: 'drag-move', x, y })
    }
    const handleUp = (event: PointerEvent): void => {
      const { x, y } = coordinates(event)
      postToFrame({ type: 'drag-end', x, y })
      setIsDragging(false)
    }
    const handleCancel = (): void => {
      postToFrame({ type: 'drag-cancel' })
      setIsDragging(false)
    }
    window.addEventListener('pointermove', handleMove, true)
    window.addEventListener('pointerup', handleUp, true)
    window.addEventListener('pointercancel', handleCancel, true)
    window.addEventListener('blur', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove, true)
      window.removeEventListener('pointerup', handleUp, true)
      window.removeEventListener('pointercancel', handleCancel, true)
      window.removeEventListener('blur', handleCancel)
    }
  }, [isDragging, postToFrame])

  useEffect(() => {
    if (!isDragging) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      postToFrame({ type: 'drag-cancel' })
      setIsDragging(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDragging, postToFrame])

  const handleCommand = useCallback(
    (
      command: WorkbenchHtmlEditCommand,
      value?: string,
      options?: { preserveFocus?: boolean }
    ) => {
      postToFrame({
        type: 'command',
        command,
        value,
        preserveFocus: options?.preserveFocus
      })
    },
    [postToFrame]
  )

  const handleBeginDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!selection?.canReorder || !readyRef.current) return
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 部分环境不支持指针捕获时，仍由拖拽遮罩兜底接管移动事件。
      }
      setIsDragging(true)
      postToFrame({ type: 'drag-start' })
    },
    [postToFrame, selection]
  )

  const handleFrameLoad = useCallback(() => {
    readyRef.current = false
    setFailed(false)
    armReadyTimer()
    postToFrame({ type: 'ping' })
  }, [armReadyTimer, postToFrame])

  useImperativeHandle(
    ref,
    () => ({
      hasChanges: () => dirtyRef.current,
      markSaved: () => {
        dirtyRef.current = false
        onDirtyChangeRef.current(false)
        setSelection(null)
        postToFrame({ type: 'saved' })
        postToFrame({ type: 'deselect' })
      },
      serializeCurrent: requestSerialization
    }),
    [postToFrame, requestSerialization]
  )

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden">
      <div ref={stageRef} className="flex-1 min-h-0 relative bg-white overflow-hidden">
        <iframe
          ref={iframeRef}
          src={editSrc}
          sandbox="allow-scripts"
          onLoad={handleFrameLoad}
          title={`${filePath} 可视化编辑`}
          className="w-full h-full border-0 block"
        />

        {selection && (
          <div
            ref={toolbarWrapRef}
            className="absolute z-dropdown"
            style={{
              left: toolbarPos?.left ?? 0,
              top: toolbarPos?.top ?? 0,
              visibility: toolbarPos ? 'visible' : 'hidden'
            }}
          >
            <WorkbenchHtmlEditToolbar
              canReorder={selection.canReorder}
              textColor={selection.textColor}
              backgroundColor={selection.backgroundColor}
              onCommand={handleCommand}
            />
          </div>
        )}

        {selection?.canReorder && dragHandlePos && (
          <button
            type="button"
            title="拖动排序"
            aria-label="拖动排序"
            data-html-drag-handle
            onPointerDown={handleBeginDrag}
            className={`absolute z-dropdown flex h-6 w-6 items-center justify-center rounded-md border border-primary/40 bg-white/95 text-primary shadow-md backdrop-blur-sm transition-colors dark:bg-gray-800/95 ${
              isDragging
                ? 'cursor-grabbing bg-primary text-white'
                : 'cursor-grab hover:bg-primary hover:text-white'
            }`}
            style={{ left: dragHandlePos.left, top: dragHandlePos.top }}
          >
            <AppIcon name="drag_indicator" size={15} />
          </button>
        )}

        {isDragging && <div className="absolute inset-0 z-dropdown cursor-grabbing" />}

        {failed && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-amber-500/95 px-3 py-2 text-label text-white">
            <AppIcon name="warning" size={15} />
            <span>编辑脚本未启动，请使用源码模式</span>
          </div>
        )}
      </div>

      <div className="h-8 px-3 bg-slate-800/90 border-t border-slate-700/60 flex items-center justify-between gap-4 shrink-0 select-none text-xs text-slate-400">
        <span className="truncate">{selection?.crumb || '点击页面元素开始编辑'}</span>
        <span className="shrink-0">
          {failed
            ? '编辑未就绪'
            : isDragging
              ? '拖到目标位置松开'
              : selection?.interactive
                ? '交互元素仅支持文字与样式'
                : 'Esc 取消选择 · Ctrl+S 保存'}
        </span>
      </div>
    </div>
  )
})

export default WorkbenchHtmlVisualEditor
