import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnnotationStore, visibleAnnotations, type AnnotationFilter } from '../../store/annotationStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { Annotation } from '../../../../shared/types/annotations'
import { readConversationSource } from '../../../../shared/utils/conversationSource'
import { AppIcon } from '../icons/AppIcon'

const FILTERS: Array<{ key: AnnotationFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'document', label: '文档' },
  { key: 'source', label: '原文' },
  { key: 'unlocated', label: '未定位' }
]

function formatTime(value: number): string {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function AnnotationCard({
  annotation,
  active,
  unlocated,
  onSelect,
  onSave,
  onDelete
}: {
  annotation: Annotation
  active: boolean
  unlocated: boolean
  onSelect: () => void
  onSave: (comment: string) => Promise<void>
  onDelete: () => Promise<void>
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(annotation.comment)
  const [saving, setSaving] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing) setDraft(annotation.comment)
  }, [annotation.comment, editing])

  // 正文里点击标注后，对应卡片要进入可视区域。
  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
      className={`group rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
        active
          ? 'border-primary/50 bg-primary/5'
          : 'border-black/5 bg-transparent hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-2">
        <AppIcon
          name={annotation.scope === 'source' ? 'link' : 'sticky_note_2'}
          size={14}
          className={unlocated ? 'mt-0.5 shrink-0 text-amber-500' : 'mt-0.5 shrink-0 text-text-secondary'}
        />
        <div className="min-w-0 flex-1">
          <p className={`line-clamp-2 text-xs leading-5 ${unlocated ? 'text-text-secondary' : 'text-text-primary'}`}>
            {annotation.quote || '（空引文）'}
          </p>
          {unlocated && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <AppIcon name="warning" size={11} />
              正文中未找到
            </p>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2" onClick={event => event.stopPropagation()}>
          <textarea
            autoFocus
            value={draft}
            onChange={event => setDraft(event.target.value)}
            className="h-20 w-full resize-none rounded-md border border-black/10 bg-white/70 px-2 py-1.5 text-xs text-text-primary focus:border-primary/60 focus:outline-none dark:border-white/10 dark:bg-gray-900/60"
            placeholder="评论"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDraft(annotation.comment)
                setEditing(false)
              }}
              className="h-6 rounded px-2 text-[11px] text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="h-6 rounded bg-primary px-2 text-[11px] text-white hover:bg-primary/90 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 pl-5" onClick={event => event.stopPropagation()}>
          {annotation.comment ? (
            <p className="whitespace-pre-wrap break-words text-[11px] leading-4 text-text-secondary">
              {annotation.comment}
            </p>
          ) : (
            <p className="text-[11px] text-text-secondary/60">无评论</p>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-secondary/60">{formatTime(annotation.updatedAt)}</span>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
                title="编辑评论"
              >
                <AppIcon name="edit" size={13} />
              </button>
              <button
                type="button"
                onClick={() => void onDelete()}
                className="flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:bg-rose-500/10 hover:text-rose-500"
                title="删除标注"
              >
                <AppIcon name="delete" size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WorkbenchAnnotationPanel(): JSX.Element {
  const workspacePath = useWorkbenchStore(s => s.workspacePath)
  const activeFilePath = useWorkbenchStore(s => s.activeFilePath)
  const saveActiveFile = useWorkbenchStore(s => s.saveActiveFile)
  const closeRightPane = useWorkbenchStore(s => s.closeRightPane)
  const store = useAnnotationStore()
  const items = useMemo(() => visibleAnnotations(store), [store])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const editorMode = useWorkbenchStore(s => s.editorMode)
  const activeFileContent = useWorkbenchStore(s => s.activeFileContent)

  useEffect(() => {
    useWorkbenchStore.setState({ activeAnnotationCount: store.documentAnnotations.length })
  }, [store.documentAnnotations.length])

  // 源码模式下 Lexical 插件不挂载；面板自己按文档加载，保证卡片列表与正文一致。
  useEffect(() => {
    if (editorMode !== 'source' || !workspacePath || !activeFilePath) return
    if (store.workspaceRoot === workspacePath && store.relativePath === activeFilePath) return
    const sourceKey = readConversationSource(activeFileContent)?.sourceKey ?? null
    const token = useAnnotationStore.getState().token + 1
    useAnnotationStore.getState().resetForDocument(workspacePath, activeFilePath, sourceKey)
    void window.api.annotations.listDocument(workspacePath, activeFilePath).then(result => {
      if (result.success && result.data) {
        useAnnotationStore.getState().setDocumentAnnotations(result.data, token)
      } else if (result.error) {
        useAnnotationStore.getState().setError(result.error)
      }
      useAnnotationStore.getState().setLoading(false)
    })
    if (sourceKey) {
      void window.api.annotations.listSource(sourceKey).then(result => {
        if (result.success && result.data) {
          useAnnotationStore.getState().setSourceAnnotations(result.data.annotations, token)
        }
      })
    }
  }, [editorMode, workspacePath, activeFilePath, activeFileContent, store.workspaceRoot, store.relativePath])

  const refresh = async (): Promise<void> => {
    if (!workspacePath || !activeFilePath) return
    const token = useAnnotationStore.getState().token
    const [docResult, sourceResult] = await Promise.all([
      window.api.annotations.listDocument(workspacePath, activeFilePath),
      store.sourceKey ? window.api.annotations.listSource(store.sourceKey) : Promise.resolve(null)
    ])
    if (docResult.success && docResult.data) {
      useAnnotationStore.getState().setDocumentAnnotations(docResult.data, token)
    }
    if (sourceResult?.success && sourceResult.data) {
      useAnnotationStore.getState().setSourceAnnotations(sourceResult.data.annotations, token)
    }
  }

  const updateComment = async (annotation: Annotation, comment: string): Promise<void> => {
    const next = { ...annotation, comment, updatedAt: Date.now() }
    useAnnotationStore.getState().upsertLocal(next)
    if (annotation.scope === 'document') {
      if (!workspacePath || !activeFilePath) return
      const saved = await saveActiveFile()
      if (!saved.saved) {
        setNotice(saved.reason === 'oversized' ? '文档过大，标注未保存' : '正文未保存，标注未写入')
        return
      }
      const result = await window.api.annotations.upsertDocument(workspacePath, activeFilePath, next)
      if (!result.success) setNotice(result.error || '标注保存失败')
      return
    }
    if (!annotation.source) return
    const result = await window.api.annotations.upsertSource(
      annotation.source.key,
      annotation.source,
      next
    )
    if (!result.success) setNotice(result.error || '原文标注保存失败')
  }

  const remove = async (annotation: Annotation): Promise<void> => {
    const message =
      annotation.scope === 'source'
        ? '删除后所有工作区的原文高亮都会消失，确定删除？'
        : '删除这条文档标注？正文中的标记会一起移除。'
    if (!window.confirm(message)) return
    setBusyId(annotation.id)
    try {
      if (annotation.scope === 'document') {
        if (!workspacePath || !activeFilePath) return
        const result = await window.api.annotations.deleteDocument(
          workspacePath,
          activeFilePath,
          annotation.id
        )
        if (!result.success) {
          setNotice(result.error || '删除标注失败')
          return
        }
      } else if (annotation.source) {
        const result = await window.api.annotations.deleteSource(
          annotation.source.key,
          annotation.id
        )
        if (!result.success) {
          setNotice(result.error || '删除原文标注失败')
          return
        }
      }
      useAnnotationStore.getState().removeLocal(annotation.id)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const sourceKey = store.sourceKey

  /** 源码模式不渲染 MarkNode：按 quote 在正文里查找并滚动到选区。 */
  const revealInSource = (annotation: Annotation): void => {
    if (editorMode !== 'source') return
    const quote = annotation.anchor.exact || annotation.quote
    if (!quote) return
    let at = activeFileContent.indexOf(quote)
    if (at < 0) {
      const compact = (value: string): string => value.replace(/\s+/g, '')
      const compactQuote = compact(quote)
      if (!compactQuote) return
      const map: number[] = []
      let searchable = ''
      for (let i = 0; i < activeFileContent.length; i++) {
        if (/\s/.test(activeFileContent[i])) continue
        map.push(i)
        searchable += activeFileContent[i]
      }
      const hit = searchable.indexOf(compactQuote)
      if (hit < 0) return
      at = map[hit]
    }
    window.dispatchEvent(
      new CustomEvent('workbench:source-reveal', {
        detail: { start: at, end: at + quote.length }
      })
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-black/5 px-3 dark:border-white/5">
        <div className="flex items-center gap-1">
          {FILTERS.map(filter => (
            <button
              key={filter.key}
              type="button"
              onClick={() => store.setFilter(filter.key)}
              className={`h-7 rounded-md px-2 text-[11px] transition-colors ${
                store.filter === filter.key
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={closeRightPane}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
          title="收起标注"
        >
          <AppIcon name="right_panel_close" size={16} />
        </button>
      </div>

      {notice && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className="mx-3 mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-left text-[11px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {notice}
        </button>
      )}
      {!notice && store.error && (
        <button
          type="button"
          onClick={() => store.setError(null)}
          className="mx-3 mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-left text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {store.error === 'CONVERSATION_LIBRARY_UNAVAILABLE'
            ? '会话库暂不可用'
            : `标注读取失败：${store.error}`}
        </button>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {!activeFilePath && (
          <p className="py-10 text-center text-xs text-text-secondary/70">打开文档后显示标注</p>
        )}
        {activeFilePath && store.loading && (
          <p className="py-10 text-center text-xs text-text-secondary/70">读取中…</p>
        )}
        {activeFilePath && !store.loading && !items.length && (
          <p className="py-10 text-center text-xs text-text-secondary/70">
            {store.filter === 'unlocated' ? '没有未定位标注' : '选中正文后添加标注'}
          </p>
        )}
        {items.map(annotation => (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            active={store.selectedId === annotation.id}
            unlocated={store.unlocatedIds.includes(annotation.id)}
            onSelect={() => {
              store.setSelected(annotation.id)
              revealInSource(annotation)
            }}
            onSave={comment => updateComment(annotation, comment)}
            onDelete={() => (busyId === annotation.id ? Promise.resolve() : remove(annotation))}
          />
        ))}
      </div>

      {sourceKey && (
        <div className="shrink-0 border-t border-black/5 px-3 py-2 dark:border-white/5">
          <p className="truncate text-[10px] text-text-secondary/70" title={sourceKey}>
            原文 {store.sourceAnnotations.length} 条
          </p>
        </div>
      )}
    </div>
  )
}
