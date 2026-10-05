import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationMindmap, MindmapTask, NoteConversation, MindmapCandidate } from '../../../shared/types/notes'
import { diffMindmapLines, normalizeMindmapNewlines } from '../../../shared/utils/mindmapEdits'
import { consumeMindmapSelection, subscribeMindmapSelection, type PendingMindmapSelection } from '../utils/mindmapSelection'
import { noteConversationKey } from '../../../shared/utils/noteIdentity'
import { MINDMAP_REQUIREMENTS_LIMIT } from '../../../shared/utils/mindmap'
import LocalMindmapPanel, { type LocalMindmapPanelRef } from './LocalMindmapPanel'
import type { WebviewCardRef } from './WebviewCard'
import { useAppStore } from '../store/appStore'
import CustomDropdown from './CustomDropdown'

export interface MindmapSource {
  id: string
  name: string
  getRef: () => WebviewCardRef | null | undefined
}

interface Draft { markdown: string; title: string; updatedAt: number; error?: string }
// 保存失败/切换画布时保留编辑稿，回到该图后可以恢复，不复制对话快照。
const drafts = new Map<string, Draft>()
const saveQueues = new Map<string, Promise<void>>()
function downloadMarkdown(markdown: string, title: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.replace(/[<>:"/\\|?*]/g, '_') || 'mindmap'}.md`
  link.click()
  URL.revokeObjectURL(url)
}

function extractRootTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+([^\r\n]+)/m)
  return match ? match[1].trim() : null
}

function updateMarkdownRootTitle(markdown: string, newTitle: string): string {
  const cleanTitle = newTitle.replace(/[\r\n]/g, ' ').trim()
  if (!cleanTitle) return markdown
  if (/^#\s+[^\r\n]*/m.test(markdown)) {
    return markdown.replace(/^#\s+[^\r\n]*/m, `# ${cleanTitle}`)
  }
  return `# ${cleanTitle}\n\n${markdown}`
}

export function MindmapEditor({
  conversationId,
  map,
  onReload,
  controls,
  notice,
  panelRef,
  bottomLeftContent,
  onClose,
  draggableHeader,
  onDragStart,
  editorRef,
  previewMarkdown,
  changedLines,
  onAskNode,
  onEdit
}: {
  conversationId: string
  map: ConversationMindmap
  onReload: () => void
  controls: ReactNode
  notice: ReactNode
  panelRef?: React.MutableRefObject<LocalMindmapPanelRef | null>
  bottomLeftContent?: ReactNode
  onClose?: () => void
  draggableHeader?: boolean
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void
  editorRef?: React.MutableRefObject<MindmapEditorRef | null>
  previewMarkdown?: string
  changedLines?: number[]
  onAskNode?: (path: string[]) => void
  onEdit?: () => void
}): JSX.Element {
  const ownPanelRef = useRef<LocalMindmapPanelRef | null>(null)
  const localRef = panelRef || ownPanelRef
  const applyingRef = useRef(false)
  const [initial, setInitial] = useState(() => drafts.get(map.id)?.markdown ?? map.markdown)
  const [title, setTitle] = useState(() => drafts.get(map.id)?.title ?? map.title)
  const [status, setStatus] = useState(drafts.get(map.id)?.error || '已保存')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef({ markdown: initial, title, updatedAt: drafts.get(map.id)?.updatedAt ?? map.updatedAt })
  useEffect(() => {
    // 保存回执与 notes:changed 刷新可能交错；相同或更旧的快照不能回退保存版本。
    if (applyingRef.current || drafts.has(map.id) || map.updatedAt <= current.current.updatedAt) return
    if (map.markdown === current.current.markdown && map.title === current.current.title) { current.current.updatedAt = map.updatedAt; return }
    current.current = { markdown: map.markdown, title: map.title, updatedAt: map.updatedAt }
    setInitial(map.markdown); setTitle(map.title); setStatus('已保存')
  }, [map.id, map.updatedAt, map.markdown, map.title])

  const flush = useCallback((retry = false): Promise<void> => {
    const operation = (saveQueues.get(map.id) || Promise.resolve()).then(async () => {
      const draft = drafts.get(map.id)
      if (!draft || (draft.error && !retry)) return
      setStatus('保存中…')
      try {
        const result = await window.api.mindmapsUpdate(conversationId, map.id, draft.markdown, draft.title, draft.updatedAt)
        if (!result.success || !result.data) throw new Error(result.error || '保存失败')
        current.current.updatedAt = result.data.updatedAt
        const pending = drafts.get(map.id)
        if (pending === draft) { drafts.delete(map.id); setStatus('已保存') }
        else if (pending) { pending.updatedAt = result.data.updatedAt; setStatus('待保存…') }
      } catch (error) {
        const message = error instanceof Error ? error.message : '保存失败，请重试'
        const pending = drafts.get(map.id)
        if (pending) pending.error = message
        setStatus(message)
      }
    })
    saveQueues.set(map.id, operation)
    void operation.then(() => { if (saveQueues.get(map.id) === operation) saveQueues.delete(map.id) })
    return operation
  }, [conversationId, map.id])

  const edit = useCallback((markdown: string, overrideTitle?: string) => {
    onEdit?.()
    const rootTitle = extractRootTitle(markdown)
    const nextTitle = overrideTitle !== undefined ? overrideTitle : (rootTitle || current.current.title)
    if (nextTitle !== current.current.title) {
      setTitle(nextTitle)
    }
    const previous = drafts.get(map.id)
    current.current = { markdown, title: nextTitle, updatedAt: previous?.updatedAt ?? current.current.updatedAt }
    setInitial(markdown)
    drafts.set(map.id, { ...current.current, error: previous?.error })
    setStatus(previous?.error || '待保存…')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 500)
  }, [map.id, flush, onEdit])

  const saveSnapshot = useCallback(async () => {
    localRef.current?.getMarkdown()
    if (timer.current) clearTimeout(timer.current)
    const frozen = { ...current.current }
    await flush(true)
    if (drafts.has(map.id)) throw new Error(drafts.get(map.id)?.error || '保存期间产生新编辑，请完成保存后重试')
    if (current.current.markdown !== frozen.markdown || current.current.title !== frozen.title) throw new Error('保存期间导图已改变，请重新提交')
    return { ...current.current }
  }, [flush, localRef, map.id])
  useEffect(() => {
    if (!editorRef) return
    editorRef.current = {
      saveSnapshot,
      snapshot: () => ({ ...current.current }),
      applyCandidate: async candidate => {
        if (applyingRef.current) throw new Error('正在应用修改')
        applyingRef.current = true
        try {
          const snapshot = await saveSnapshot()
          if (normalizeMindmapNewlines(snapshot.markdown) !== candidate.baseMarkdown || snapshot.title !== candidate.baseTitle || snapshot.updatedAt !== candidate.baseUpdatedAt) throw new Error('导图在生成期间发生了修改，请基于当前版本重新调整')
          const result = await window.api.mindmapsApply(map.id, candidate.id)
          if (!result.success || !result.data) throw new Error(result.error || '保存失败，候选已保留')
          const saved = result.data
          localRef.current?.commitMarkdown(saved.markdown, false)
          current.current = { markdown: saved.markdown, title: saved.title, updatedAt: saved.updatedAt }
          drafts.delete(map.id)
          setInitial(saved.markdown); setTitle(saved.title); setStatus('已保存')
          return saved
        } finally { applyingRef.current = false }
      }
    }
    return () => { editorRef.current = null }
  }, [editorRef, saveSnapshot, localRef, map.id])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (drafts.has(map.id)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (timer.current) clearTimeout(timer.current)
      void flush()
    }
  }, [map.id, flush])

  const failed = !!drafts.get(map.id)?.error
  return <div className="h-full flex flex-col min-h-0 bg-white select-none">
    <div
      className={`px-3 py-2.5 border-b border-gray-200/70 bg-white flex items-center justify-between gap-2 ${
        draggableHeader ? 'drag-region' : ''
      }`}
      onPointerDown={draggableHeader ? (e) => {
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('.no-drag') || target.closest('input') || target.closest('select')) return
        if (target.closest('.drag-region') || target === e.currentTarget) {
          e.currentTarget.setPointerCapture(e.pointerId)
          window.api.windowDragStart()
          if (onDragStart) {
            onDragStart(e)
          }
        }
      } : undefined}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="material-symbols-outlined text-primary text-xl shrink-0">account_tree</span>
        <input
          aria-label="导图标题"
          title="点击修改标题"
          className="min-w-0 flex-1 h-7 px-1 font-medium text-sm text-text-primary bg-transparent border border-transparent rounded hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none truncate no-drag"
          value={title}
          disabled={previewMarkdown !== undefined}
          maxLength={200}
          onChange={event => {
            const nextTitle = event.target.value
            setTitle(nextTitle)
            const syncedMarkdown = updateMarkdownRootTitle(current.current.markdown, nextTitle)
            setInitial(syncedMarkdown)
            edit(syncedMarkdown, nextTitle)
          }}
        />
        {!failed && status !== '已保存' && <span title={status} aria-label={status} className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {controls}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors no-drag"
            title="收起侧边栏"
            aria-label="收起侧边栏"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        )}
      </div>
    </div>
    {notice}
    {failed && <div role="alert" className="px-3 py-2 bg-red-50 flex flex-wrap items-start gap-3 text-sm select-text">
      <details className="min-w-0 flex-1 text-red-600"><summary className="cursor-pointer">保存失败</summary><p className="mt-1 break-words">{status}</p></details>
      <button className="text-primary" onClick={() => { void flush(true) }}>重试</button>
      <button className="text-gray-500" onClick={() => { if (window.confirm('重新载入将放弃当前未保存编辑，请先导出大纲。继续吗？')) { drafts.delete(map.id); onReload() } }}>重新载入</button>
    </div>}
    <div className="flex-1 min-h-0 relative">
      <LocalMindmapPanel ref={localRef} initialMarkdown={initial} onChange={edit} previewMarkdown={previewMarkdown} changedLines={changedLines} onAskNode={onAskNode} />
      {bottomLeftContent && (
        <div className="absolute left-3 bottom-3 z-30">
          {bottomLeftContent}
        </div>
      )}
    </div>
  </div>
}

interface MindmapEditorRef {
  saveSnapshot: () => Promise<{ markdown: string; title: string; updatedAt: number }>
  snapshot: () => { markdown: string; title: string; updatedAt: number }
  applyCandidate: (candidate: MindmapCandidate) => Promise<ConversationMindmap>
}

const composerDrafts = new Map<string, { generate: string; modify: string }>()
const pendingCandidates = new Set<string>()
window.addEventListener('beforeunload', event => {
  if (pendingCandidates.size || drafts.size) { event.preventDefault(); event.returnValue = '' }
})
const taskLabels: Record<MindmapTask['phase'], string> = { loading: '正在准备生成网页…', generating: 'AI 正在生成…', saving: '正在保存导图…', done: '导图已保存', error: '生成失败', cancelled: '已取消' }

export default function ConversationMindmapPanel({ source, conversation: fixedConversation, initialMapId, onOpenMubu, onClose, draggableHeader, onDragStart }: {
  source?: MindmapSource
  conversation?: NoteConversation
  initialMapId?: string
  onOpenMubu?: () => void
  onClose?: () => void
  draggableHeader?: boolean
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void
}): JSX.Element {
  const models = useAppStore(state => state.models)
  const savedPlatform = useAppStore(state => state.mindmapPlatformId)
  const [platform, setPlatform] = useState(savedPlatform || models[0]?.id || '')
  const [conversation, setConversation] = useState<NoteConversation | null>(fixedConversation || null)
  const [mapId, setMapId] = useState(initialMapId || '')
  const [task, setTask] = useState<MindmapTask | null>(null)
  const [candidate, setCandidate] = useState<MindmapCandidate | null>(null)
  const [compareView, setCompareView] = useState<'before' | 'after'>('after')
  const [mode, setMode] = useState<'generate' | 'modify'>('generate')
  const [request, setRequest] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const preparingRef = useRef(false)
  const [error, setError] = useState('')
  const [marks, setMarks] = useState<ReturnType<typeof diffMindmapLines> | null>(null)
  const [editorRevision, setEditorRevision] = useState(0)
  const [newSession, setNewSession] = useState(false)
  const [includeSourceContext, setIncludeSourceContext] = useState(false)
  const [dismissedTask, setDismissedTask] = useState('')
  const [question, setQuestion] = useState('')
  const [questionError, setQuestionError] = useState('')
  const [selection, setSelection] = useState<{ source: PendingMindmapSelection; targetId: string; parentId: string; parentLabel: string; markdown: string; text: string; choose: boolean; direct: boolean } | null>(null)
  const panelRef = useRef<LocalMindmapPanelRef | null>(null)
  const editorRef = useRef<MindmapEditorRef | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sourceRef = useRef(source); sourceRef.current = source
  const conversationRef = useRef(conversation); conversationRef.current = conversation
  const sourceKeyRef = useRef('')
  const refreshSequence = useRef(0)
  const sorted = useMemo(() => [...(conversation?.mindmaps || [])].sort((a, b) => b.createdAt - a.createdAt), [conversation?.mindmaps])
  const activeMap = conversation?.mindmaps.find(map => map.id === mapId) || sorted[0]
  const activeMapRef = useRef(activeMap); activeMapRef.current = activeMap
  const candidateRef = useRef(candidate); candidateRef.current = candidate
  const busy = !!task && !['done', 'error', 'cancelled'].includes(task.phase)
  const draftKey = activeMap?.id || sourceKeyRef.current || conversation?.id || source?.id || 'empty'
  const modeRef = useRef(mode); modeRef.current = mode
  const draftKeyRef = useRef(draftKey); draftKeyRef.current = draftKey
  const clearMarks = useCallback(() => setMarks(null), [])

  useEffect(() => { if (fixedConversation) setConversation(fixedConversation) }, [fixedConversation])
  useEffect(() => { if (initialMapId) setMapId(initialMapId) }, [initialMapId])
  const refresh = useCallback(async (force = false) => {
    const sequence = ++refreshSequence.current
    const currentSource = sourceRef.current
    if (!currentSource) {
      const id = conversationRef.current?.id
      if (!id) return
      const result = await window.api.notesGet(id)
      if (sequence === refreshSequence.current && result.success && result.data) setConversation(result.data)
      return
    }
    const identity = await currentSource.getRef()?.getConversationIdentity()
    if (sequence !== refreshSequence.current) return
    if (!identity?.url.startsWith('https://')) { sourceKeyRef.current = ''; setConversation(null); return }
    const key = noteConversationKey(identity.url, identity.title)
    const changed = key !== sourceKeyRef.current
    if (!changed && !force) return
    sourceKeyRef.current = key
    if (changed) { setConversation(null); setMapId(''); setCandidate(null); setMarks(null); setError('') }
    const result = await window.api.notesForSource(key)
    if (sequence !== refreshSequence.current) return
    if (!result.success) { setError(result.error || '读取导图失败'); return }
    setConversation(result.data || null)
  }, [])
  useEffect(() => {
    void refresh()
    const interval = source ? setInterval(() => void refresh(), 2000) : undefined
    const off = window.api.onNotesChanged(() => void refresh(true))
    return () => { clearInterval(interval); off(); refreshSequence.current++ }
  }, [source?.id, refresh])

  useEffect(() => {
    let alive = true, revision = 0
    const update = (next: MindmapTask): void => {
      if (!alive) return
      setTask(next)
      if (next.phase === 'done' && next.kind === 'modify' && next.mindmapId) {
        if (next.conversationId === conversationRef.current?.id && next.mindmapId === activeMapRef.current?.id) void refresh(true)
        void window.api.mindmapsCandidate(next.mindmapId).then(result => {
          if (result.data) pendingCandidates.add(result.data.mindmapId)
        })
      }
      if (next.phase !== 'done' || next.kind === 'modify' || next.conversationId !== conversationRef.current?.id) return
      void window.api.notesGet(next.conversationId).then(result => {
        if (alive && result.success && result.data && result.data.id === conversationRef.current?.id) {
          setConversation(result.data); setMapId(next.mindmapId || ''); setMode('modify')
        }
      })
    }
    const off = window.api.onMindmapTaskChanged(next => { revision++; update(next) })
    const before = revision
    void window.api.mindmapsTask().then(result => { if (before === revision && result.data) update(result.data) })
    return () => { alive = false; off() }
  }, [])

  useEffect(() => {
    const nextMode = activeMap ? 'modify' : 'generate'
    setMode(nextMode); setRequest(composerDrafts.get(draftKey)?.[nextMode] || '')
    setMarks(null); setCandidate(null); setNewSession(false); setIncludeSourceContext(false)
    const binding = activeMap?.generationSession?.platformId
    if (binding && models.some(model => model.id === binding)) setPlatform(binding)
    else if (!models.some(model => model.id === platform)) setPlatform(models[0]?.id || '')
  }, [draftKey])
  useEffect(() => {
    let alive = true
    const id = activeMap?.id
    if (!id) return
    void window.api.mindmapsCandidate(id).then(result => {
      if (!alive) return
      if (!result.success) { setError(result.error || '读取候选失败'); return }
      setCandidate(result.data || null); setCompareView('after')
      if (result.data) pendingCandidates.add(id)
      else pendingCandidates.delete(id)
    })
    return () => { alive = false }
  }, [activeMap?.id, task?.id, task?.phase])
  const changeRequest = (value: string): void => {
    setRequest(value)
    const saved = composerDrafts.get(draftKey) || { generate: '', modify: '' }
    saved[mode] = value; composerDrafts.set(draftKey, saved)
  }
  const changeMode = (next: 'generate' | 'modify'): void => {
    if (busy || preparing || candidate || (next === 'modify' && !activeMap)) return
    setMode(next); setRequest(composerDrafts.get(draftKey)?.[next] || ''); setNewSession(false)
  }
  const capture = async (): Promise<NoteConversation> => {
    const currentSource = sourceRef.current
    if (!currentSource) {
      if (!conversationRef.current) throw new Error('来源会话不存在')
      return conversationRef.current
    }
    const id = currentSource.getRef()?.getWebContentsId()
    if (!id) throw new Error('当前对话尚未就绪')
    const result = await window.api.notesCaptureSource(id, currentSource.id, currentSource.name)
    if (!result.success || !result.data) throw new Error(result.error || '读取对话失败')
    if (result.data.sourceKey !== sourceKeyRef.current) throw new Error('来源页面已切换，请重新提交')
    return result.data
  }
  const createBlank = async (): Promise<void> => {
    if (preparingRef.current || busy || candidate) return
    preparingRef.current = true; setPreparing(true); setError('')
    try {
      const captured = await capture()
      const result = await window.api.mindmapsAdd(captured.id, '# 我的知识导图\n')
      if (!result.success || !result.data) throw new Error(result.error || '新建失败')
      const latest = await window.api.notesGet(captured.id)
      if (!sourceRef.current || captured.sourceKey === sourceKeyRef.current) { setConversation(latest.data || captured); setMapId(result.data.id) }
    } catch (exception) { setError(exception instanceof Error ? exception.message : '新建失败') }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  const submit = async (): Promise<void> => {
    if (preparingRef.current || busy || (mode === 'modify' && !request.trim())) return
    preparingRef.current = true; setPreparing(true); setError(''); setMarks(null)
    const key = draftKey, submittedMode = mode, instructions = request
    try {
      if (activeMap) await editorRef.current?.saveSnapshot()
      if (mode === 'generate') {
        if (candidate) throw new Error('请先应用或放弃候选')
        const captured = await capture()
        const result = await window.api.mindmapsStart(captured.id, platform, instructions)
        if (!result.success || !result.data) throw new Error(result.error || '启动失败')
        setTask(result.data)
        if (!sourceRef.current || captured.sourceKey === sourceKeyRef.current) setConversation(captured)
        // New-map requirements survive cancellation/failure, and clear only after a successful result.
      } else {
        const map = activeMapRef.current, currentSource = conversationRef.current
        const snapshot = editorRef.current?.snapshot()
        if (!map || !currentSource || !snapshot || key !== draftKeyRef.current) throw new Error('当前导图已切换，请重新提交')
        if (candidate && (normalizeMindmapNewlines(snapshot.markdown) !== candidate.baseMarkdown || snapshot.title !== candidate.baseTitle || snapshot.updatedAt !== candidate.baseUpdatedAt)) throw new Error('导图在生成期间发生了修改，请基于当前版本重新调整')
        const liveSource = sourceRef.current
        const webContentsId = liveSource?.getRef()?.getWebContentsId()
        const result = await window.api.mindmapsModify({ conversationId: currentSource.id, mindmapId: map.id, expectedUpdatedAt: snapshot.updatedAt, platformId: platform, instructions, candidateId: candidate?.id, newSession, includeSourceContext, source: liveSource ? { webContentsId: webContentsId || undefined, platformId: liveSource.id, name: liveSource.name } : undefined })
        if (!result.success || !result.data) throw new Error(result.error || '调整启动失败')
        setTask(result.data); setNewSession(false)
        const saved = composerDrafts.get(key)
        if (saved) saved[submittedMode] = ''
        if (draftKeyRef.current === key) setRequest('')
      }
    } catch (exception) { setError(exception instanceof Error ? exception.message : '操作失败') }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  useEffect(() => {
    if (task?.kind !== 'generate' || task.phase !== 'done' || task.mindmapId !== activeMap?.id) return
    for (const key of [draftKey, conversation?.sourceKey || '', conversation?.id || '']) {
      const saved = composerDrafts.get(key); if (saved) saved.generate = ''
    }
  }, [task?.id, task?.phase, activeMap?.id])

  const apply = async (): Promise<void> => {
    if (!candidate || !editorRef.current || preparingRef.current || busy) return
    preparingRef.current = true; setPreparing(true); setError('')
    const before = candidate
    try {
      const saved = await editorRef.current.applyCandidate(before)
      pendingCandidates.delete(saved.id)
      if (activeMapRef.current?.id === saved.id) {
        setCandidate(null); setMarks(diffMindmapLines(before.baseMarkdown, saved.markdown))
        setConversation(current => current && { ...current, mindmaps: current.mindmaps.map(map => map.id === saved.id ? saved : map) })
      }
    } catch (exception) { setError(exception instanceof Error ? exception.message : '保存失败，候选已保留') }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  const discard = async (): Promise<void> => {
    if (!candidate || preparingRef.current) return
    preparingRef.current = true; setPreparing(true)
    try {
      const result = await window.api.mindmapsDiscard(candidate.mindmapId, candidate.id)
      if (!result.success) throw new Error(result.error || '放弃失败')
      pendingCandidates.delete(candidate.mindmapId); setCandidate(null); setMarks(null); setError('')
    } catch (exception) { setError(exception instanceof Error ? exception.message : '放弃失败') }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  const ask = (path: string[]): void => { setQuestion(`关于导图中的「${path.join(' → ')}」，请进一步解释这个概念，并给出一个具体例子。`); setQuestionError('') }
  const injectQuestion = async (): Promise<void> => {
    const currentSource = sourceRef.current, current = conversationRef.current
    const id = currentSource?.getRef()?.getWebContentsId()
    if (!id || !currentSource || !current) { setQuestionError('请先回到来源对话，问题草稿已保留'); return }
    const result = await window.api.mindmapsAsk(id, currentSource.id, current.id, question)
    if (!result.success) { setQuestionError(result.error || '注入失败，草稿已保留'); return }
    setQuestion(''); setError('追问已追加到主会话输入框，由你确认后发送')
  }

  useEffect(() => {
    const receive = (): void => {
      const id = sourceRef.current?.getRef()?.getWebContentsId()
      if (!id) return
      const pending = consumeMindmapSelection(id)
      if (!pending) return
      const map = activeMapRef.current, target = panelRef.current?.getTarget()
      const frozenMarkdown = panelRef.current?.getMarkdown() || map?.markdown || ''
      const fixedMapId = map?.id || '', fixedParent = target?.id || ''
      void sourceRef.current?.getRef()?.getConversationIdentity().then(async identity => {
        if (!identity || identity.url !== pending.url) { setError('来源页面已切换，选区未加入导图'); return }
        const key = noteConversationKey(pending.url, pending.title)
        if (map && (activeMapRef.current?.id !== map.id || conversationRef.current?.sourceKey !== key)) { setError('来源或目标导图已切换，请重新选择文字'); return }
        let maps = conversationRef.current?.sourceKey === key ? conversationRef.current.mindmaps : []
        if (!map) {
          const saved = await window.api.notesForSource(key)
          if (!saved.success) { setError(saved.error || '无法确定目标导图'); return }
          const latestIdentity = await sourceRef.current?.getRef()?.getConversationIdentity()
          if (latestIdentity?.url !== pending.url) { setError('来源页面已切换，请重新选择文字'); return }
          maps = saved.data?.mindmaps || []
          if (saved.data) setConversation(saved.data)
        }
        if (candidateRef.current) { setError('请先应用或放弃候选，再添加节点'); return }
        const choose = (pending.chooseTarget || !map) && maps.length > 1
        const text = pending.text.replace(/\s+/g, ' ').trim()
        setSelection({ source: pending, targetId: choose ? '' : fixedMapId || maps[0]?.id || '', parentId: fixedParent, parentLabel: target?.label || '导图根节点', markdown: frozenMarkdown, text, choose, direct: !choose && pending.text.length <= 32 && !/[\r\n]/.test(pending.text) })
      })
    }
    const off = subscribeMindmapSelection(receive)
    receive()
    return off
  }, [source?.id, activeMap?.id])
  useEffect(() => {
    if (!selection?.targetId || selection.parentId || activeMap?.id !== selection.targetId) return
    const target = panelRef.current?.getTarget(), markdown = panelRef.current?.getMarkdown()
    if (target && markdown !== undefined) setSelection(current => current && { ...current, parentId: target.id, parentLabel: target.label, markdown })
  }, [selection?.targetId, activeMap?.id])
  const addSelection = async (): Promise<void> => {
    if (!selection || !selection.text.trim() || (selection.choose && !selection.targetId) || preparingRef.current || busy) return
    preparingRef.current = true; setPreparing(true); setError('')
    try {
      const ref = sourceRef.current?.getRef()
      const identity = await ref?.getConversationIdentity()
      if (ref?.getWebContentsId() !== selection.source.webContentsId || identity?.url !== selection.source.url) throw new Error('来源页面已切换，请重新选择文字')
      if (candidateRef.current) throw new Error('请先应用或放弃候选')
      if (!selection.targetId) {
        const result = await window.api.mindmapsBlankSource(selection.source.webContentsId, selection.source.url, sourceRef.current?.name || '')
        if (!result.success || !result.data) throw new Error(result.error || '添加失败')
        const { conversation: savedSource, mindmap } = result.data
        if (savedSource.sourceKey !== sourceKeyRef.current) throw new Error('来源页面已切换，已创建的空白图可从来源会话打开')
        setConversation(savedSource); setMapId(mindmap.id)
        setSelection({ ...selection, targetId: mindmap.id, parentId: '', markdown: '', direct: true })
        return
      } else {
        if (activeMapRef.current?.id !== selection.targetId || panelRef.current?.getMarkdown() !== selection.markdown || !selection.parentId) throw new Error('导图或父节点已变化，请重新选择添加位置')
        if (!panelRef.current?.insertNode(selection.parentId, selection.text.replace(/\s+/g, ' ').trim())) throw new Error('父节点已删除，请重新选择位置')
      }
      setSelection(null)
    } catch (exception) { setError(exception instanceof Error ? exception.message : '添加失败'); setSelection(current => current && { ...current, direct: false }) }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  useEffect(() => {
    if (selection?.direct && (!selection.targetId || selection.parentId)) void addSelection()
  }, [selection, preparing])
  const diff = useMemo(() => candidate ? diffMindmapLines(candidate.baseMarkdown, candidate.candidateMarkdown) : marks, [candidate, marks])
  const candidateConflict = candidate && activeMap && (activeMap.updatedAt !== candidate.baseUpdatedAt || normalizeMindmapNewlines(activeMap.markdown) !== candidate.baseMarkdown || activeMap.title !== candidate.baseTitle || drafts.has(activeMap.id))
  const reload = async (): Promise<void> => { await refresh(true); setMarks(null); setEditorRevision(value => value + 1) }
  const currentModel = models.find(model => model.id === platform)
  const platformName = currentModel?.name || platform
  const controls = (
    <CustomDropdown
      value={null}
      onChange={() => {}}
      hideArrow
      dropdownWidth="w-60 !left-auto right-0 !z-50 !max-h-[min(540px,85vh)]"
      buttonClassName="h-7 w-7 rounded-lg text-text-secondary hover:text-text-primary hover:bg-gray-100 active:bg-gray-200 flex items-center justify-center transition-colors no-drag"
      renderButton={() => (
        <span className="material-symbols-outlined text-[20px]" title="导图选项">
          more_horiz
        </span>
      )}
      renderContent={close => {
        const renderItem = ({
          icon,
          label,
          onClick,
          disabled = false,
          danger = false,
          active = false,
          title,
          extra
        }: {
          icon: string
          label: string
          onClick: () => void
          disabled?: boolean
          danger?: boolean
          active?: boolean
          title?: string
          extra?: ReactNode
        }) => (
          <button
            type="button"
            disabled={disabled}
            title={title || label}
            onClick={onClick}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left group select-none disabled:opacity-40 disabled:cursor-not-allowed ${
              danger
                ? 'text-red-600 hover:bg-red-50 active:bg-red-100/70'
                : active
                ? 'text-primary bg-primary/8 font-medium'
                : 'text-text-primary hover:bg-gray-100/80 active:bg-gray-200/60'
            }`}
          >
            <span
              className={`material-symbols-outlined text-[17px] shrink-0 transition-colors ${
                danger
                  ? 'text-red-500 group-hover:text-red-600'
                  : active
                  ? 'text-primary'
                  : 'text-gray-400 group-hover:text-gray-600'
              }`}
            >
              {icon}
            </span>
            <span className="truncate flex-1">{label}</span>
            {extra}
          </button>
        )

        return (
          <div className="p-1 space-y-0.5">
            {sorted.length > 0 && (
              <div>
                {sorted.length > 1 && (
                  <div className="px-2.5 py-1 text-[11px] font-medium text-text-secondary/70 select-none">
                    导图版本 ({sorted.length})
                  </div>
                )}
                {sorted.map(map => {
                  const isActive = map.id === activeMap?.id
                  return renderItem({
                    icon: 'account_tree',
                    label: map.title,
                    active: isActive,
                    disabled: preparing,
                    title: map.title,
                    extra: isActive ? (
                      <span className="material-symbols-outlined text-[16px] text-primary shrink-0 ml-1">
                        check
                      </span>
                    ) : undefined,
                    onClick: () => {
                      close()
                      setMapId(map.id)
                    }
                  })
                })}
                <div className="my-1 border-t border-gray-100" />
              </div>
            )}

            {renderItem({
              icon: 'add',
              label: '新建空白导图',
              disabled: busy || preparing || !!candidate,
              onClick: () => {
                close()
                void createBlank()
              }
            })}

            {activeMap && (
              <>
                <div className="my-1 border-t border-gray-100" />
                {renderItem({
                  icon: 'description',
                  label: '导出 Markdown',
                  onClick: () => {
                    close()
                    downloadMarkdown(
                      drafts.get(activeMap.id)?.markdown || activeMap.markdown,
                      drafts.get(activeMap.id)?.title || activeMap.title
                    )
                  }
                })}
                {renderItem({
                  icon: 'image',
                  label: '导出图片（PNG）',
                  onClick: () => {
                    close()
                    panelRef.current?.exportPng()
                  }
                })}
                {renderItem({
                  icon: 'draw',
                  label: '导出图片（SVG）',
                  onClick: () => {
                    close()
                    panelRef.current?.exportSvg()
                  }
                })}

                <div className="my-1 border-t border-gray-100" />
                {renderItem({
                  icon: 'edit_note',
                  label: '在笔记中打开',
                  onClick: () => {
                    close()
                    if (conversation) {
                      void window.api.notesOpen({
                        conversationId: conversation.id,
                        mindmapId: activeMap.id
                      })
                    }
                  }
                })}
              </>
            )}

            {onOpenMubu &&
              renderItem({
                icon: 'open_in_new',
                label: '打开幕布',
                onClick: () => {
                  close()
                  onOpenMubu()
                }
              })}

            {activeMap && (
              <>
                <div className="my-1 border-t border-gray-100" />
                {renderItem({
                  icon: 'delete_outline',
                  label: '删除导图',
                  danger: true,
                  disabled: busy || preparing,
                  onClick: () => {
                    close()
                    if (!conversation || !window.confirm('确定删除这份导图吗？')) return
                    void window.api.mindmapsDelete(conversation.id, activeMap.id).then(result => {
                      if (!result.success) {
                        setError(result.error || '删除失败')
                        return
                      }
                      drafts.delete(activeMap.id)
                      pendingCandidates.delete(activeMap.id)
                      setCandidate(null)
                      setMapId('')
                      void refresh(true)
                    })
                  }
                })}
              </>
            )}
          </div>
        )
      }}
    />
  )
  const notice = <>
    {error && <div role="alert" className="px-3 py-2 text-sm bg-amber-50 text-amber-800 flex gap-2"><span className="flex-1 break-words">{error}</span><button onClick={() => setError('')} aria-label="关闭提示">×</button></div>}
    {task?.mindmapId === activeMap?.id && task?.contextSource === 'snapshot' && task.id !== dismissedTask && <div role="status" className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50">本次使用本地保存的来源快照，可能不是最新内容。获取最新内容请回到来源主会话。</div>}
    {task && task.id !== dismissedTask && (busy || task.phase === 'error' || (task.kind === 'modify' && task.phase === 'done' && task.outcome === 'unchanged')) && <div role="status" className="px-3 py-2 text-sm bg-gray-50 flex flex-wrap gap-3">
      <span className="flex-1 min-w-0 break-words">{task.error || (task.outcome === 'unchanged' ? '未检测到变化，上一份候选仍保留' : taskLabels[task.phase])}</span>
      {busy && task.phase !== 'saving' && <button className="text-gray-600" onClick={() => void window.api.mindmapsCancel(task.id).then(result => { if (!result.success) setError(result.error || '取消失败') })}>取消</button>}
      {['loading', 'generating', 'error'].includes(task.phase) && <button className="text-primary" onClick={() => void window.api.mindmapsShow(task.id).then(result => { if (!result.success) setError(result.error || '网页已关闭') })}>查看生成网页</button>}
      {!busy && <button aria-label="关闭任务提示" className="text-gray-400" onClick={() => setDismissedTask(task.id)}>×</button>}
    </div>}
    {candidate && <div className="px-3 py-2 border-b border-gray-100 text-sm space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <button aria-pressed={compareView === 'before'} className={`px-2 py-1 rounded ${compareView === 'before' ? 'bg-gray-200' : 'bg-gray-50'}`} onClick={() => setCompareView('before')}>修改前</button>
        <button aria-pressed={compareView === 'after'} className={`px-2 py-1 rounded ${compareView === 'after' ? 'bg-primary/10 text-primary' : 'bg-gray-50'}`} onClick={() => setCompareView('after')}>修改后</button>
        <span className="ml-auto text-gray-500">待应用 · 只读预览</span>
      </div>
      {candidateConflict && <p className="text-amber-700">导图在生成期间发生了修改，请放弃候选后基于当前版本重新调整。候选仍可查看或复制。</p>}
      <div className="flex gap-2">
        <button disabled={busy || preparing || !!candidateConflict} className="bg-primary text-white rounded px-3 py-1.5 disabled:opacity-40" onClick={() => void apply()}>应用修改</button>
        <button disabled={busy || preparing || !!candidateConflict} className="rounded px-2 py-1.5 hover:bg-gray-100 disabled:opacity-40" onClick={() => { setCollapsed(false); textareaRef.current?.focus() }}>继续调整</button>
        <button disabled={preparing} className="rounded px-2 py-1.5 hover:bg-gray-100 disabled:opacity-40" onClick={() => void discard()}>放弃</button>
        <button className="ml-auto text-gray-500" onClick={() => void navigator.clipboard.writeText(candidate.candidateMarkdown)}>复制候选</button>
      </div>
    </div>}
    {diff && <div className="px-3 py-1.5 text-sm border-b border-gray-100 flex flex-wrap gap-3 items-start">
      <span className="text-primary">● 本次变化</span>
      {!!diff.removed.length && <details className="flex-1 min-w-0"><summary className="cursor-pointer text-gray-500">原内容变化（{diff.removed.length}）</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs mt-2 select-text">{diff.removed.join('\n')}</pre></details>}
      {!candidate && <button className="ml-auto text-gray-500" onClick={() => setMarks(null)}>清除标记</button>}
    </div>}
  </>
  useEffect(() => {
    const input = textareaRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(72, Math.max(32, input.scrollHeight))}px`
  }, [request, collapsed, activeMap?.id])
  const submitLabel = preparing ? '处理中…' : busy ? '生成中…' : mode === 'generate' ? '生成新图' : candidate ? '继续调整' : '调整导图'
  const expectsNewSession = newSession || !activeMap?.generationSession || platform !== activeMap.generationSession.platformId
  const composer = <div className="shrink-0 px-2 py-2 bg-white">
    {collapsed ? <button className="w-full text-xs text-text-secondary hover:text-primary py-1" onClick={() => setCollapsed(false)}>展开输入区 ↑</button> : <>
      <div className="flex items-end gap-1.5 p-1.5 bg-white/85 border border-gray-200/80 rounded-2xl shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-colors">
        <CustomDropdown value={mode} disabled={busy || preparing || !!candidate} onChange={value => changeMode(value)} options={[...(activeMap ? [{ value: 'modify' as const, label: '调整当前图' }] : []), { value: 'generate' as const, label: '生成新图' }]} direction="up" dropdownWidth="min-w-max" className="shrink-0" buttonClassName="h-8 px-2 rounded-full text-xs font-medium flex items-center gap-1 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/15 disabled:opacity-50" />
        <CustomDropdown value={platform} disabled={busy || preparing} onChange={value => setPlatform(String(value))} options={models.map(model => ({ value: model.id, label: model.name, logo: model.logo }))} direction="up" dropdownWidth="w-48" hideArrow className="shrink-0" buttonClassName="h-8 w-7 rounded-full flex items-center justify-center text-text-secondary hover:bg-gray-100 disabled:opacity-50" renderButton={() => <span title={`生成模型：${models.find(model => model.id === platform)?.name || platform}`} aria-label={`生成模型：${models.find(model => model.id === platform)?.name || platform}`}>
          {models.find(model => model.id === platform)?.logo ? <img src={models.find(model => model.id === platform)?.logo} alt="生成模型" className="w-4 h-4 object-contain" /> : <span className="material-symbols-outlined text-base">smart_toy</span>}
        </span>} />
        <textarea ref={textareaRef} aria-label={mode === 'generate' ? '新图要求（选填）' : '导图修改要求'} rows={1} maxLength={MINDMAP_REQUIREMENTS_LIMIT} value={request} disabled={busy || preparing} onChange={event => changeRequest(event.target.value)} placeholder={mode === 'generate' ? '输入新图要求（可选）…' : candidate ? '继续调整候选稿…' : '描述想调整的内容…'} className="flex-1 min-w-0 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none leading-5 py-1.5 px-1 max-h-[72px] disabled:opacity-50" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} />
        <button type="button" disabled={busy || preparing || !platform || !models.some(model => model.id === platform) || (mode === 'modify' && (!request.trim() || !!candidateConflict))} aria-label={submitLabel} title={submitLabel} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-primary text-white hover:brightness-95 disabled:bg-gray-100 disabled:text-gray-400" onClick={() => void submit()}><span className={`material-symbols-outlined text-[18px] ${busy || preparing ? 'animate-spin' : ''}`}>{busy || preparing ? 'sync' : 'arrow_upward'}</span></button>
        <button type="button" aria-label="收起输入区" title="收起输入区" className="h-8 w-4 shrink-0 text-gray-400 hover:text-primary flex items-center justify-center" onClick={() => setCollapsed(true)}><span className="material-symbols-outlined text-sm">expand_more</span></button>
      </div>
      {mode === 'modify' && <div className="mt-1.5 px-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        <label className="flex gap-1 items-center" title={expectsNewSession ? '新生成对话会自动携带来源上下文' : source ? '本轮采集来源主会话已加载的完整内容；不勾选时只提交导图和要求' : '来源主会话未打开，将使用本地保存的快照，可能不是最新内容'}><input type="checkbox" disabled={busy || preparing || expectsNewSession} checked={includeSourceContext || expectsNewSession} onChange={event => setIncludeSourceContext(event.target.checked)} />{source ? '带上主会话最新内容' : '带上来源快照'}</label>
        {task?.phase === 'error' && <label className="flex gap-1 items-center" title="新开后台生成对话，携带来源上下文及当前导图；仍修改当前图"><input type="checkbox" disabled={busy || preparing} checked={newSession} onChange={event => setNewSession(event.target.checked)} />使用新的 AI 对话调整当前图</label>}
      </div>}
    </>}
  </div>
  const modal = (title: string, children: ReactNode, close: () => void): ReactNode => createPortal(<div className="fixed inset-0 z-[100] bg-black/25 flex items-center justify-center p-4 no-drag" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape' && !preparing) close()
    if (event.key === 'Tab') {
      const fields = event.currentTarget.querySelectorAll<HTMLElement>('textarea:not(:disabled),select:not(:disabled),button:not(:disabled),input:not(:disabled)')
      const first = fields[0], last = fields[fields.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl space-y-3"><h2 className="text-base font-medium">{title}</h2>{children}</div>
  </div>, document.body)
  return <div className="h-full flex flex-col min-h-0 bg-white">
    <div className="flex-1 min-h-0">
      {activeMap && conversation ? <MindmapEditor key={`${activeMap.id}:${editorRevision}`} conversationId={conversation.id} map={activeMap} onReload={() => void reload()} controls={controls} notice={notice} panelRef={panelRef} editorRef={editorRef} onClose={onClose} draggableHeader={draggableHeader} onDragStart={onDragStart} previewMarkdown={candidate ? compareView === 'before' ? candidate.baseMarkdown : candidate.candidateMarkdown : undefined} changedLines={candidate && compareView === 'before' ? undefined : diff?.changedLines} onAskNode={source && conversation.url ? ask : undefined} onEdit={clearMarks} /> : <div className="h-full flex flex-col">
        <div
          className={`px-3 py-2.5 border-b border-gray-200/70 bg-white flex items-center justify-between gap-2 select-none ${
            draggableHeader ? 'drag-region' : ''
          }`}
          onPointerDown={draggableHeader ? (e) => {
            const target = e.target as HTMLElement
            if (target.closest('button') || target.closest('.no-drag') || target.closest('input') || target.closest('select')) return
            if (target.closest('.drag-region') || target === e.currentTarget) {
              e.currentTarget.setPointerCapture(e.pointerId)
              window.api.windowDragStart()
              if (onDragStart) {
                onDragStart(e)
              }
            }
          } : undefined}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-primary text-xl shrink-0">account_tree</span>
            <span className="text-sm font-medium text-text-primary truncate">思维导图</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onOpenMubu && controls}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors no-drag"
                title="收起侧边栏"
                aria-label="收起侧边栏"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
          </div>
        </div>
        {notice}
        <div className="flex-1 min-h-0 flex flex-col p-5 overflow-y-auto">
          {/* 顶部插画与引导标题 */}
          <div className="flex flex-col items-center text-center mt-3 mb-5 shrink-0">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3 border border-primary/20 shadow-2xs">
              <span className="material-symbols-outlined text-3xl">hub</span>
            </div>
            <h2 className="text-base font-semibold text-gray-800">把当前对话整理成思维导图</h2>
          </div>

          {/* 生成配置卡片（模型选择器 + 额外要求合体） */}
          <div className="bg-gray-50/80 border border-gray-200/80 rounded-xl p-3 space-y-2.5 mb-3 shrink-0">
            {/* 顶部：模型选择器（药丸按钮居左，适度加大） */}
            <div className="flex items-center justify-between">
              <CustomDropdown
                value={platform}
                disabled={preparing || busy}
                onChange={val => setPlatform(val)}
                options={models.map(m => ({ value: m.id, label: m.name, logo: m.logo }))}
                dropdownWidth="w-56"
                buttonClassName="h-8 px-2.5 bg-white border border-gray-200/90 hover:border-gray-300 rounded-lg flex items-center gap-2 shadow-2xs transition-colors disabled:opacity-50 text-left"
                renderButton={() => (
                  <div className="flex items-center gap-2 min-w-0">
                    {currentModel?.logo ? (
                      <img src={currentModel.logo} alt={currentModel.name} className="w-4 h-4 object-contain rounded-xs shrink-0" />
                    ) : (
                      <span className="material-symbols-outlined text-base text-gray-400 shrink-0">smart_toy</span>
                    )}
                    <span className="text-[13px] font-medium text-gray-800 truncate max-w-[130px]">{currentModel?.name || platform}</span>
                  </div>
                )}
                renderOption={(option, isSelected, onSelect) => {
                  const m = models.find(item => item.id === option.value)
                  return (
                    <button
                      key={String(option.value)}
                      type="button"
                      onClick={onSelect}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-100 transition-colors text-left ${
                        isSelected ? 'bg-primary/5 text-primary font-medium' : 'text-gray-700'
                      }`}
                    >
                      {m?.logo ? (
                        <img src={m.logo} alt={m.name} className="w-4 h-4 object-contain rounded-xs shrink-0" />
                      ) : (
                        <span className="material-symbols-outlined text-sm text-gray-400 shrink-0">smart_toy</span>
                      )}
                      <span className="text-xs truncate flex-1">{option.label}</span>
                      {isSelected && (
                        <span className="material-symbols-outlined text-primary text-sm ml-auto shrink-0">check</span>
                      )}
                    </button>
                  )
                }}
              />
              {request.trim().length > 0 && (
                <button
                  type="button"
                  disabled={preparing || busy}
                  onClick={() => changeRequest('')}
                  className="text-[11px] text-gray-400 hover:text-red-500 transition-colors px-1"
                >
                  清空
                </button>
              )}
            </div>

            {/* 底部：额外要求输入框（直接展开，无单独图标，无字数限制） */}
            <textarea
              value={request}
              disabled={preparing || busy}
              maxLength={MINDMAP_REQUIREMENTS_LIMIT}
              rows={3}
              onChange={event => changeRequest(event.target.value)}
              placeholder="额外要求（选填，例如：重点提炼核心论点与结论，省略客套与类比）..."
              className="w-full text-xs p-2.5 border border-gray-200/80 rounded-lg outline-none focus:border-primary bg-white resize-y text-gray-700 placeholder:text-gray-400 disabled:opacity-60"
            />
          </div>

          {/* 操作按钮区域（并排置于卡片正下方） */}
          <div className="grid grid-cols-2 gap-2.5 mb-4 shrink-0">
            {/* 主按钮：生成导图 */}
            <button
              disabled={preparing || busy || !platform}
              title={`将当前对话发送到 ${platformName}，生成新导图并保存到笔记`}
              onClick={() => { void submit() }}
              className="h-9 rounded-xl bg-primary hover:brightness-95 active:brightness-90 text-white font-medium text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all disabled:opacity-40 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">auto_awesome</span>
              <span className="truncate">{preparing ? '读取中…' : busy ? '生成中…' : '生成导图'}</span>
            </button>

            {/* 次按钮：手动创建 */}
            <button
              type="button"
              disabled={preparing || busy}
              title="创建一份空白导图并直接进入编辑"
              onClick={() => { void createBlank() }}
              className="h-9 rounded-xl bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-200 text-gray-700 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm text-gray-400">edit_square</span>
              <span className="truncate">手动创建空白导图</span>
            </button>
          </div>
        </div>
      </div>}
    </div>
    {activeMap && composer}
    {question && modal('在主会话中追问', <>
      <textarea autoFocus aria-label="追问草稿" value={question} onChange={event => setQuestion(event.target.value)} rows={5} className="w-full border rounded-lg p-3 text-sm" />
      {questionError && <p role="alert" className="text-sm text-red-600">{questionError}</p>}
      <div className="flex justify-end gap-2"><button className="px-3 py-2 text-sm" onClick={() => setQuestion('')}>取消</button><button className="px-3 py-2 text-sm" onClick={() => void navigator.clipboard.writeText(question)}>复制草稿</button><button disabled={!question.trim()} className="px-3 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-40" onClick={() => void injectQuestion()}>填入主会话</button></div>
    </>, () => setQuestion(''))}
    {selection && !selection.direct && modal(`添加到「${selection.parentLabel}」`, <>
      {selection.choose && <select autoFocus aria-label="选择目标导图" value={selection.targetId} className="w-full border rounded-lg p-2 text-sm" onChange={event => {
        const id = event.target.value; setMapId(id)
        setSelection({ ...selection, targetId: id, parentId: '', markdown: '' })
      }}><option value="">选择已有导图</option>{sorted.map(map => <option key={map.id} value={map.id}>{map.title}</option>)}</select>}
      <p className="text-sm text-gray-500">整理成一行节点文字后添加。</p>
      <textarea autoFocus={!selection.choose} aria-label="选区节点文字" rows={4} value={selection.text} onChange={event => setSelection({ ...selection, text: event.target.value })} className="w-full border rounded-lg p-3 text-sm" />
      <div className="flex justify-end gap-2"><button disabled={preparing} className="px-3 py-2 text-sm" onClick={() => setSelection(null)}>取消</button><button disabled={preparing || !selection.text.trim() || (selection.choose && !selection.targetId)} className="px-3 py-2 text-sm bg-primary text-white rounded-lg disabled:opacity-40" onClick={() => void addSelection()}>添加节点</button></div>
    </>, () => setSelection(null))}
  </div>
}
