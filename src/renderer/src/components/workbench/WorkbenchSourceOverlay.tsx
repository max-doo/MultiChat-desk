import { useEffect, useRef, useState } from 'react'
import { useSourceAnnotations } from '../../hooks/useSourceAnnotations'
import { AppIcon } from '../icons/AppIcon'
import type { ConversationSourceInfo } from '../../../../shared/utils/conversationSource'
import WebviewFindBar from '../WebviewFindBar'

/**
 * 会话文档的原文覆盖层。
 * 始终从默认会话库读取 source 标注；即使文档在仓库里，也不读当前仓库的 sources/。
 */
export default function WorkbenchSourceOverlay({
  source,
  onClose
}: {
  source: ConversationSourceInfo
  onClose: () => void
}): JSX.Element {
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const { annotations, error: sourceError, hit, closeHit, refresh } = useSourceAnnotations(
    webviewRef,
    true,
    source.sourceKey
  )
  const readyRef = useRef(false)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    const ready = (): void => {
      try {
        if (webview.getURL().startsWith('chrome-error://')) {
          readyRef.current = false
          setStatus('failed')
          setError('原始网页未能加载')
          return
        }
      } catch {
        return
      }
      readyRef.current = true
      setStatus('ready')
      setError('')
    }
    const fail = (event: Electron.DidFailLoadEvent): void => {
      if (!event.isMainFrame || event.errorCode === -3) return
      readyRef.current = false
      setStatus('failed')
      setError('原始网页未能加载')
    }
    webview.addEventListener('dom-ready', ready)
    webview.addEventListener('did-stop-loading', ready)
    webview.addEventListener('did-fail-load', fail)
    return () => {
      webview.removeEventListener('dom-ready', ready)
      webview.removeEventListener('did-stop-loading', ready)
      webview.removeEventListener('did-fail-load', fail)
    }
  }, [])

  const removeAnnotation = async (): Promise<void> => {
    if (!hit) return
    if (!window.confirm('删除后所有工作区的原文高亮都会消失，确定删除？')) return
    const result = await window.api.annotations.deleteSource(source.sourceKey, hit.id)
    if (!result.success) {
      setError(result.error || '删除原文标注失败')
      return
    }
    closeHit()
    refresh()
  }

  useEffect(() => {
    if (!hit) {
      setEditing(false)
      return
    }
    setDraft(hit.comment)
    setEditing(false)
  }, [hit])

  const saveComment = async (): Promise<void> => {
    if (!hit) return
    const annotation = annotations.find(item => item.id === hit.id)
    if (!annotation?.source) return
    const next = { ...annotation, comment: draft.trim(), updatedAt: Date.now() }
    const result = await window.api.annotations.upsertSource(annotation.source.key, annotation.source, next)
    if (!result.success) {
      setError(result.error || '评论保存失败')
      return
    }
    setEditing(false)
    closeHit()
    refresh()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6 backdrop-blur-xs">
      <div className="relative flex h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-black/5 px-3 dark:border-white/5">
          <AppIcon name="article" size={16} className="text-text-secondary" />
          <span className="truncate text-xs text-text-secondary">{source.title || source.url}</span>
          <span className="ml-auto text-[11px] text-text-secondary/70">{annotations.length} 条原文标注</span>
          <button
            type="button"
            onClick={() => {
              const webview = webviewRef.current
              if (!webview) return
              try {
                webview.reload()
                setStatus('loading')
              } catch {
                setStatus('failed')
              }
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
            title="刷新原文"
          >
            <AppIcon name="refresh" size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
            title="关闭原文"
          >
            <AppIcon name="close" size={16} />
          </button>
        </div>
        {status === 'loading' && (
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-black/5 px-3 text-[11px] text-text-secondary dark:border-white/5">
            <span className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
            正在加载原文…
          </div>
        )}
        {(error || sourceError) && (
          <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {error || sourceError}
          </div>
        )}
        <div className="relative flex-1">
          <WebviewFindBar webviewRef={webviewRef} disabled={status !== 'ready'} />
          <webview
            ref={webviewRef}
            src={source.url}
            partition="persist:shared"
            className="h-full w-full"
          />
        </div>
        {hit && (
          <div className="absolute bottom-4 right-4 w-[300px] rounded-xl border border-black/10 bg-white p-3 text-xs shadow-xl dark:border-white/10 dark:bg-gray-800">
            <p className="line-clamp-2 text-[11px] text-text-secondary">{hit.quote}</p>
            {editing ? (
              <textarea
                autoFocus
                value={draft}
                onChange={event => setDraft(event.target.value)}
                className="mt-1.5 h-20 w-full resize-none rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-xs text-text-primary focus:border-primary/60 focus:outline-none dark:border-white/10"
                placeholder="评论"
              />
            ) : (
              <p className="mt-1.5 whitespace-pre-wrap text-text-primary">{hit.comment || '无评论'}</p>
            )}
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void removeAnnotation()}
                  className="text-[11px] text-rose-500 hover:underline"
                >
                  删除标注
                </button>
                {!editing && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="text-[11px] text-text-secondary hover:text-text-primary"
                  >
                    编辑评论
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => (editing ? void saveComment() : closeHit())}
                className="text-[11px] text-text-secondary hover:text-text-primary"
              >
                {editing ? '保存' : '关闭'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
