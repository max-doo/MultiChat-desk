import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationMindmap, MindmapTask, NoteConversation, MindmapCandidate, MindmapMaterial, MindmapFileState, MindmapFileReason } from '../../../shared/types/notes'
import { diffMindmapLines, mergeMindmapCandidate, normalizeMindmapNewlines } from '../../../shared/utils/mindmapEdits'
import { consumeMindmapSelection, subscribeMindmapSelection, type PendingMindmapSelection } from '../utils/mindmapSelection'
import { noteConversationKey } from '../../../shared/utils/noteIdentity'
import { MINDMAP_REQUIREMENTS_LIMIT } from '../../../shared/utils/mindmap'
import { stripMindmapInlineFormat } from '../utils/mindmapInlineFormat'
import LocalMindmapPanel, { type LocalMindmapPanelRef } from './LocalMindmapPanel'
import type { WebviewCardRef } from './WebviewCard'
import { useAppStore } from '../store/appStore'
import CustomDropdown from './CustomDropdown'
import { AppIcon } from './icons/AppIcon'

export interface MindmapSource {
  id: string
  name: string
  getRef: () => WebviewCardRef | null | undefined
  /** 文档来源：无 record 时首次生成前由上层先建记录；返回真实 conversationId。 */
  resolveId?: () => Promise<string>
}

interface Draft { markdown: string; title: string; updatedAt: number; error?: string; conflict?: 'file-changed' }
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
  return match ? stripMindmapInlineFormat(match[1].trim()) : null
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
  resolveConversationId,
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
  onViewSource,
  onEdit
}: {
  conversationId: string
  /** 记录尚未建立时（只读壳）按需补建，返回真实 id。 */
  resolveConversationId?: () => Promise<string | null>
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
  onViewSource?: (text: string) => void
  onEdit?: () => void
}): JSX.Element {
  const ownPanelRef = useRef<LocalMindmapPanelRef | null>(null)
  const localRef = panelRef || ownPanelRef
  const applyingRef = useRef(false)
  const [initial, setInitial] = useState(() => drafts.get(map.id)?.markdown ?? map.markdown)
  const [title, setTitle] = useState(() => drafts.get(map.id)?.title ?? map.title)
  const [status, setStatus] = useState(drafts.get(map.id)?.error || '已保存')
  const [externalChange, setExternalChange] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef({ markdown: initial, title, updatedAt: drafts.get(map.id)?.updatedAt ?? map.updatedAt })
  /** 最近一次与服务端同步的正文：保存时用它判断文件是否被外部改过。 */
  const baseline = useRef(map.markdown)
  useEffect(() => {
    // 保存回执与 notes:changed 刷新可能交错；相同或更旧的快照不能回退保存版本。
    if (applyingRef.current || drafts.has(map.id)) return
    if (map.markdown === current.current.markdown && map.title === current.current.title) {
      if (map.updatedAt > current.current.updatedAt) current.current.updatedAt = map.updatedAt
      return
    }
    // 外部软件改正文不会推进 frontmatter 的 updatedAt：版本没变但内容变了，提示用户裁决。
    if (map.updatedAt <= current.current.updatedAt) { setExternalChange(true); return }
    current.current = { markdown: map.markdown, title: map.title, updatedAt: map.updatedAt }
    baseline.current = map.markdown
    setExternalChange(false)
    setInitial(map.markdown); setTitle(map.title); setStatus('已保存')
  }, [map.id, map.updatedAt, map.markdown, map.title])

  const flush = useCallback((retry = false, force = false): Promise<void> => {
    const operation = (saveQueues.get(map.id) || Promise.resolve()).then(async () => {
      const draft = drafts.get(map.id)
      if (!draft || (draft.error && !retry)) return
      setStatus('保存中…')
      try {
        // 记录被清掉但导图文件还在时，面板会拿到只读壳（id 为空）。
        // 第一次真正保存时再补建来源记录，避免“能看不能改”。
        const id = conversationId || await resolveConversationId?.()
        if (!id) throw new Error('创建导图来源失败')
        const result = await window.api.mindmapsUpdate(id, map.id, draft.markdown, draft.title, draft.updatedAt, baseline.current, force)
        if (!result.success || !result.data) {
          const pending = drafts.get(map.id)
          if (result.conflict === 'file-changed' && pending) {
            pending.error = result.error || '导图文件已在外部修改'
            pending.conflict = 'file-changed'
            setStatus(pending.error)
            return
          }
          throw new Error(result.error || '保存失败')
        }
        current.current.updatedAt = result.data.updatedAt
        baseline.current = result.data.markdown
        setExternalChange(false)
        const pending = drafts.get(map.id)
        if (pending === draft) { drafts.delete(map.id); setStatus('已保存') }
        else if (pending) { pending.updatedAt = result.data.updatedAt; pending.conflict = undefined; setStatus('待保存…') }
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
  }, [conversationId, map.id, resolveConversationId])

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
    drafts.set(map.id, { ...current.current, error: previous?.error, conflict: previous?.conflict })
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
          // 只读壳没有记录 id：先补建，否则主进程读不到来源记录，候选应用必然失败。
          if (!conversationId) {
            const id = await resolveConversationId?.()
            if (!id) throw new Error('创建导图来源失败')
          }
          const snapshot = await saveSnapshot()
          mergeMindmapCandidate(candidate.baseMarkdown, candidate.candidateMarkdown, snapshot.markdown)
          const result = await window.api.mindmapsApply(map.id, candidate.id)
          if (!result.success || !result.data) {
            if (result.conflict === 'file-changed') {
              const pending = drafts.get(map.id)
              if (pending) { pending.error = result.error || '导图文件已在外部修改'; pending.conflict = 'file-changed' }
              setStatus(result.error || '导图文件已在外部修改')
            }
            throw new Error(result.error || '保存失败，候选已保留')
          }
          const saved = result.data
          localRef.current?.commitMarkdown(saved.markdown, false)
          current.current = { markdown: saved.markdown, title: saved.title, updatedAt: saved.updatedAt }
          baseline.current = saved.markdown
          drafts.delete(map.id)
          setInitial(saved.markdown); setTitle(saved.title); setStatus('已保存')
          return saved
        } finally { applyingRef.current = false }
      }
    }
    return () => { editorRef.current = null }
  }, [editorRef, saveSnapshot, localRef, map.id, conversationId, resolveConversationId])

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
  const fileChanged = drafts.get(map.id)?.conflict === 'file-changed'
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
        <AppIcon name="diagram_flow_horizontal" size={20} className="text-primary shrink-0" />
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
            title="关闭思维导图"
            aria-label="关闭思维导图"
          >
            <AppIcon name="close" size={16} />
          </button>
        )}
      </div>
    </div>
    {notice}
    {(failed && fileChanged) || externalChange ? <div role="alert" className="px-3 py-2 bg-amber-50 flex flex-wrap items-start gap-3 text-sm select-text">
      <span className="min-w-0 flex-1 text-amber-800 break-words">导图文件已在外部修改。{drafts.has(map.id) ? '覆盖会丢失文件里的改动，载入会丢弃画布上未保存的编辑。' : ''}</span>
      {drafts.has(map.id) && <button className="text-primary" onClick={() => { void flush(true, true) }}>覆盖文件</button>}
      <button className="text-gray-600" onClick={() => { drafts.delete(map.id); setExternalChange(false); onReload() }}>载入文件</button>
    </div> : null}
    {failed && !fileChanged && <div role="alert" className="px-3 py-2 bg-red-50 flex flex-wrap items-start gap-3 text-sm select-text">
      <details className="min-w-0 flex-1 text-red-600"><summary className="cursor-pointer">保存失败</summary><p className="mt-1 break-words">{status}</p></details>
      <button className="text-primary" onClick={() => { void flush(true) }}>重试</button>
      <button className="text-gray-500" onClick={() => { if (window.confirm('重新载入将放弃当前未保存编辑，请先导出大纲。继续吗？')) { drafts.delete(map.id); onReload() } }}>重新载入</button>
    </div>}
    <div className="flex-1 min-h-0 relative">
      <LocalMindmapPanel ref={localRef} initialMarkdown={initial} onChange={edit} previewMarkdown={previewMarkdown} changedLines={changedLines} onAskNode={onAskNode} onViewSource={onViewSource} />
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

/** 工作台文档来源：生成时用文档正文或选区替代对话快照，并记录生成范围。 */
export type MindmapMaterialRequest = MindmapMaterial

/** 工作台导图文件同步钩子：由 WorkbenchMindmapPanel 注入。 */
export interface MindmapFileSyncHooks {
  workspaceRoot: string
  relativePath: string
  refresh: () => Promise<{ files: Record<string, { state: MindmapFileState; reason?: MindmapFileReason; relativePath?: string }>; unreadable: string[]; overflow: boolean } | null>
  revealFile: (mindmapId: string) => Promise<boolean>
}

export default function ConversationMindmapPanel({ source, conversation: fixedConversation, initialMapId, onOpenMubu, onClose, draggableHeader, onDragStart, onViewSource, materialProvider, variant = 'conversation', fileSyncHooks }: {
  source?: MindmapSource
  conversation?: NoteConversation
  initialMapId?: string
  onOpenMubu?: () => void
  onViewSource?: (text: string) => void
  onClose?: () => void
  draggableHeader?: boolean
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void
  /** 存在时走文档生成链路：不使用对话快照，改用返回的材料与范围。 */
  materialProvider?: () => Promise<MindmapMaterialRequest>
  variant?: 'conversation' | 'document'
  /** 工作台导图文件同步钩子：由 WorkbenchMindmapPanel 注入。 */
  fileSyncHooks?: MindmapFileSyncHooks
}): JSX.Element {
  const models = useAppStore(state => state.models)
  const savedPlatform = useAppStore(state => state.mindmapPlatformId)
  const setMindmapPlatformId = useAppStore(state => state.setMindmapPlatformId)
  const [platform, setPlatform] = useState(() => models.some(model => model.id === savedPlatform) ? savedPlatform : models[0]?.id || '')
  const [conversation, setConversation] = useState<NoteConversation | null>(fixedConversation || null)
  const [mapId, setMapId] = useState(initialMapId || '')
  const [task, setTask] = useState<MindmapTask | null>(null)
  const [candidate, setCandidate] = useState<MindmapCandidate | null>(null)
  const [adjustFromCurrent, setAdjustFromCurrent] = useState(false)
  const submittedModify = useRef<{ taskId: string; key: string; instructions: string } | null>(null)
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
  const [fileStates, setFileStates] = useState<Record<string, { state: MindmapFileState; reason?: MindmapFileReason; relativePath?: string }>>({})
  const [unreadableFiles, setUnreadableFiles] = useState<string[]>([])
  const [scanOverflow, setScanOverflow] = useState(false)
  const sorted = useMemo(() => [...(conversation?.mindmaps || [])].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id)), [conversation?.mindmaps])
  const activeMap = conversation?.mindmaps.find(map => map.id === mapId) || sorted[0]
  const activeMapRef = useRef(activeMap); activeMapRef.current = activeMap
  const candidateRef = useRef(candidate); candidateRef.current = candidate
  const busy = !!task && !['done', 'error', 'cancelled'].includes(task.phase)
  const draftKey = activeMap?.id || sourceKeyRef.current || conversation?.id || source?.id || 'empty'
  const modeRef = useRef(mode); modeRef.current = mode
  const draftKeyRef = useRef(draftKey); draftKeyRef.current = draftKey
  const clearMarks = useCallback(() => setMarks(null), [])
  useEffect(() => { setAdjustFromCurrent(false) }, [candidate?.id, activeMap?.id])

  useEffect(() => { if (fixedConversation) setConversation(fixedConversation) }, [fixedConversation])
  useEffect(() => { if (initialMapId) setMapId(initialMapId) }, [initialMapId])
  const refreshFileSync = useCallback(() => {
    if (!fileSyncHooks) return
    void fileSyncHooks.refresh().then(result => {
      if (!result) return
      setFileStates(result.files)
      setUnreadableFiles(result.unreadable)
      setScanOverflow(result.overflow)
    })
  }, [fileSyncHooks])
  useEffect(() => {
    refreshFileSync()
  }, [refreshFileSync, conversation?.id])
  const refresh = useCallback(async (force = false) => {
    const sequence = ++refreshSequence.current
    // 文件同步状态跟随每次记录刷新：导出/回读/删除后 notesChanged 广播会走到这里。
    if (fileSyncHooks) refreshFileSync()
    const currentSource = sourceRef.current
    if (!currentSource) {
      const id = conversationRef.current?.id
      if (!id) return
      const result = await window.api.notesGet(id)
      if (sequence === refreshSequence.current && result.success && result.data) setConversation(result.data)
      return
    }
    if (materialProvider) {
      // 文档来源在首次建档完成前只有路径，不能把路径当笔记 ID 去读。
      // resolveId 会先确保记录存在，再返回真正的 UUID。
      let id = currentSource.id
      try {
        if (currentSource.resolveId) id = await currentSource.resolveId()
      } catch (exception) {
        if (sequence === refreshSequence.current) setError(exception instanceof Error ? exception.message : '读取导图失败')
        return
      }
      if (sequence !== refreshSequence.current) return
      const result = await window.api.notesGet(id)
      if (sequence !== refreshSequence.current) return
      if (!result.success) { setError(result.error || '读取导图失败'); return }
      if (result.data) setConversation(result.data)
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
  }, [fileSyncHooks, refreshFileSync])
  useEffect(() => {
    void refresh()
    // 文档来源没有外部页面可轮询，只靠 notes:changed 刷新，避免无意义的 2 秒读盘。
    const interval = source && !materialProvider ? setInterval(() => void refresh(), 2000) : undefined
    const off = window.api.onNotesChanged(() => void refresh(true))
    return () => { clearInterval(interval); off(); refreshSequence.current++ }
  }, [source?.id, refresh, materialProvider])

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
    else if (models.some(model => model.id === savedPlatform)) setPlatform(savedPlatform)
    else if (!models.some(model => model.id === platform)) setPlatform(models[0]?.id || '')
  }, [draftKey])
  useEffect(() => {
    let alive = true
    const id = activeMap?.id
    if (!id) return
    void window.api.mindmapsCandidate(id).then(result => {
      if (!alive) return
      if (!result.success) { setError(result.error || '读取候选失败'); return }
      setCandidate(result.data || null)
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
  const applyPlatform = (value: string): void => {
    setPlatform(value)
    if (value && models.some(model => model.id === value)) void setMindmapPlatformId(value).catch(() => {})
  }
  const capture = async (): Promise<NoteConversation> => {
    const currentSource = sourceRef.current
    if (!currentSource) {
      if (!conversationRef.current) throw new Error('来源会话不存在')
      return conversationRef.current
    }
    // 文档来源：记录由上层按路径建立，这里只需取最新快照。
    if (materialProvider) {
      const id = currentSource.resolveId ? await currentSource.resolveId() : currentSource.id
      const latest = await window.api.notesGet(id)
      if (!latest.success || !latest.data) throw new Error(latest.error || '读取文档记录失败')
      return latest.data
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
      // 文档来源：直接在当前记录上新建，不经过 webview 采集。
      const captured = await capture()
      const result = await window.api.mindmapsAdd(captured.id, '# 我的知识导图\n')
      if (!result.success || !result.data) throw new Error(result.error || '新建失败')
      const latest = await window.api.notesGet(captured.id)
      if (materialProvider || !sourceRef.current || captured.sourceKey === sourceKeyRef.current) { setConversation(latest.data || captured); setMapId(result.data.id) }
    } catch (exception) { setError(exception instanceof Error ? exception.message : '新建失败') }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  const submit = async (): Promise<void> => {
    if (preparingRef.current || busy || (mode === 'modify' && !request.trim())) return
    preparingRef.current = true; setPreparing(true); setError(''); setMarks(null)
    const key = draftKey, instructions = request
    try {
      if (activeMap) await editorRef.current?.saveSnapshot()
      if (mode === 'generate') {
        if (candidate) throw new Error('请先应用或放弃候选')
        const captured = await capture()
        const material = materialProvider ? await materialProvider() : undefined
        const result = await window.api.mindmapsStart(captured.id, platform, instructions, material)
        if (!result.success || !result.data) throw new Error(result.error || '启动失败')
        setTask(result.data)
        if (!sourceRef.current || captured.sourceKey === sourceKeyRef.current) setConversation(captured)
        // New-map requirements survive cancellation/failure, and clear only after a successful result.
      } else {
        const map = activeMapRef.current, currentSource = conversationRef.current
        const snapshot = editorRef.current?.snapshot()
        if (!map || !currentSource || !snapshot || key !== draftKeyRef.current) throw new Error('当前导图已切换，请重新提交')
        // 记录被清掉、面板拿到只读壳时 id 为空：调整前补建记录，否则主进程读不到来源。
        const conversationId = currentSource.id || await sourceRef.current?.resolveId?.()
        if (!conversationId) throw new Error('创建导图来源失败')
        // 补建后把 id 回填到本地状态：任务完成时按 conversationId 匹配刷新，
        // 否则仍拿着空 id 的只读壳，生成结果不会自动出现在面板上。
        if (!currentSource.id) {
          const adopted = { ...currentSource, id: conversationId }
          conversationRef.current = adopted
          setConversation(adopted)
        }
        if (candidate && !adjustFromCurrent) mergeMindmapCandidate(candidate.baseMarkdown, candidate.candidateMarkdown, snapshot.markdown)
        // 文档来源没有 webview 可采集，主进程会直接用保存的正文作为上下文。
        const liveSource = materialProvider ? undefined : sourceRef.current
        const webContentsId = liveSource?.getRef()?.getWebContentsId()
        const result = await window.api.mindmapsModify({ conversationId, mindmapId: map.id, expectedUpdatedAt: snapshot.updatedAt, platformId: platform, instructions, candidateId: adjustFromCurrent ? undefined : candidate?.id, newSession, includeSourceContext, source: liveSource ? { webContentsId: webContentsId || undefined, platformId: liveSource.id, name: liveSource.name } : undefined })
        if (!result.success || !result.data) throw new Error(result.error || '调整启动失败')
        setTask(result.data); setNewSession(false)
        submittedModify.current = { taskId: result.data.id, key, instructions }
      }
    } catch (exception) { setError(exception instanceof Error ? exception.message : '操作失败') }
    finally { preparingRef.current = false; setPreparing(false) }
  }
  useEffect(() => {
    const submitted = submittedModify.current
    if (!submitted || task?.id !== submitted.taskId || !['done', 'error', 'cancelled'].includes(task.phase)) return
    submittedModify.current = null
    if (task.phase !== 'done') return
    const saved = composerDrafts.get(submitted.key)
    if (saved?.modify === submitted.instructions) saved.modify = ''
    if (draftKeyRef.current === submitted.key) setRequest(value => value === submitted.instructions ? '' : value)
  }, [task?.id, task?.phase])
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
        setCandidate(null); setMarks(null)
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
  const candidatePreview = useMemo(() => {
    if (!candidate || !activeMap) return null
    try {
      return { markdown: mergeMindmapCandidate(candidate.baseMarkdown, candidate.candidateMarkdown, activeMap.markdown), conflict: '', rebased: normalizeMindmapNewlines(activeMap.markdown) !== candidate.baseMarkdown }
    } catch (exception) {
      return { markdown: candidate.candidateMarkdown, conflict: exception instanceof Error ? exception.message : '无法自动合并，候选已保留', rebased: false }
    }
  }, [candidate, activeMap])
  const diff = useMemo(() => candidatePreview && activeMap ? diffMindmapLines(activeMap.markdown, candidatePreview.markdown) : marks, [candidatePreview, activeMap, marks])
  const candidateConflict = candidatePreview?.conflict
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
        <AppIcon name="more_horiz" size={20} title="导图选项" />
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
            <AppIcon name={icon} size={17} className={`text-[17px] shrink-0 transition-colors ${
 danger
 ? 'text-red-500 group-hover:text-red-600'
 : active
 ? 'text-primary'
 : 'text-gray-400 group-hover:text-gray-600'
 }`} />
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
                    icon: 'diagram_flow_horizontal',
                    label: map.title,
                    active: isActive,
                    disabled: preparing,
                    title: map.title,
                    extra: isActive ? (
                      <AppIcon name="check" size={16} className="text-primary shrink-0 ml-1" />
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
                  icon: 'code',
                  label: '导出图片（SVG）',
                  onClick: () => {
                    close()
                    panelRef.current?.exportSvg()
                  }
                })}

                {variant === 'document' && fileSyncHooks && activeMap && fileStates[activeMap.id]?.relativePath && (
                  renderItem({
                    icon: 'folder_open',
                    label: '在文件夹中显示',
                    onClick: () => {
                      close()
                      void fileSyncHooks.revealFile(activeMap.id)
                    }
                  })
                )}

                <div className="my-1 border-t border-gray-100" />
                {variant !== 'document' && renderItem({
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
                      void (async () => {
                        const id = conversation.id || await source?.resolveId?.()
                        if (!id) { setError('创建导图来源失败'); return }
                        const result = await window.api.mindmapsDelete(id, activeMap.id)
                        if (!result.success) { setError(result.error || '删除失败'); return }
                        const conflict = result.data?.conflict
                        if (conflict === 'duplicate') {
                          setError('目录里有多份同 id 文件，请先清理再删除')
                          return
                        }
                        if (conflict === 'source-mismatch') {
                          setError('导图已改绑到其他文档，请刷新后再操作')
                          return
                        }
                        drafts.delete(activeMap.id)
                        pendingCandidates.delete(activeMap.id)
                        setCandidate(null)
                        setMapId('')
                        void refresh(true)
                      })()
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
    {fileSyncHooks && unreadableFiles.length > 0 && (
      <div role="status" className="px-3 py-1.5 text-xs bg-gray-50 text-text-secondary">
        {unreadableFiles.length} 个导图文件无法识别：{unreadableFiles.slice(0, 3).join('、')}{unreadableFiles.length > 3 ? ' 等' : ''}
      </div>
    )}
    {fileSyncHooks && scanOverflow && (
      <div role="status" className="px-3 py-1.5 text-xs bg-amber-50 text-amber-800">
        导图目录文件过多，暂时无法列出导图，请先清理 .multichat/mindmaps
      </div>
    )}
    {fileSyncHooks && activeMap && fileStates[activeMap.id] && fileStates[activeMap.id].state === 'invalid' && (() => {
      const reason = fileStates[activeMap.id].reason
      const text = reason === 'duplicate' ? '目录里有多份同 id 导图文件，请先清理'
        : reason === 'content' ? '导图文件内容无法识别，请检查文件'
        : '导图文件状态异常'
      return (
        <div role="status" className="px-3 py-1.5 text-xs bg-amber-50 text-amber-800">
          {text}
        </div>
      )
    })()}
    {task?.mindmapId === activeMap?.id && task?.contextSource === 'snapshot' && task.id !== dismissedTask && variant !== 'document' && <div role="status" className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50">本次使用本地保存的来源快照，可能不是最新内容。获取最新内容请回到来源主会话。</div>}
    {task && task.id !== dismissedTask && (busy || task.phase === 'error' || (task.kind === 'modify' && task.phase === 'done' && task.outcome === 'unchanged')) && <div role="status" className="px-3 py-2 text-sm bg-gray-50 flex flex-wrap gap-3">
      <span className="flex-1 min-w-0 break-words">{task.error || (task.outcome === 'unchanged' ? '未检测到变化，上一份候选仍保留' : taskLabels[task.phase])}</span>
      {busy && task.phase !== 'saving' && <button className="text-gray-600" onClick={() => void window.api.mindmapsCancel(task.id).then(result => { if (!result.success) setError(result.error || '取消失败') })}>取消</button>}
      {['loading', 'generating', 'error'].includes(task.phase) && <button className="text-primary" onClick={() => void window.api.mindmapsShow(task.id).then(result => { if (!result.success) setError(result.error || '网页已关闭') })}>查看生成网页</button>}
      {!busy && <button aria-label="关闭任务提示" className="text-gray-400" onClick={() => setDismissedTask(task.id)}>×</button>}
    </div>}
    {candidate && <div className="px-3 py-2 border-b border-gray-100 text-sm space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <button disabled={busy || preparing || !!candidateConflict} className="bg-primary text-white rounded px-3 py-1.5 disabled:opacity-40" onClick={() => void apply()}>{candidatePreview?.rebased ? '合并并应用' : '应用修改'}</button>
        <button disabled={busy || preparing} className="rounded px-2 py-1.5 hover:bg-gray-100 disabled:opacity-40" onClick={() => { setAdjustFromCurrent(!!candidateConflict); setCollapsed(false); textareaRef.current?.focus() }}>{candidateConflict ? '基于当前图重新调整' : '继续调整'}</button>
        <button disabled={preparing} className="rounded px-2 py-1.5 hover:bg-gray-100 disabled:opacity-40" onClick={() => void discard()}>放弃</button>
        <span className="text-gray-500 text-xs">待应用 · 只读预览</span>
        <button className="ml-auto text-gray-500 hover:text-text-primary text-xs" onClick={() => void navigator.clipboard.writeText(candidatePreview?.markdown ?? candidate.candidateMarkdown)}>复制候选</button>
      </div>
      {candidateConflict ? <p className="text-amber-700">{candidateConflict}</p> : candidatePreview?.rebased && <p className="text-gray-600">已合并生成期间的修改，预览包含当前图与候选的改动。</p>}
      {adjustFromCurrent && <p className="text-gray-600">下一次调整将以当前图为基础；生成成功前保留这份候选。请在下方输入修改要求。</p>}
    </div>}

  </>
  useEffect(() => {
    const input = textareaRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(72, Math.max(32, input.scrollHeight))}px`
  }, [request, collapsed, activeMap?.id])
  const submitLabel = preparing ? '处理中…' : busy ? '生成中…' : mode === 'generate' ? '生成新图' : adjustFromCurrent ? '基于当前图调整' : candidate ? '继续调整' : '调整导图'
  const expectsNewSession = newSession || !activeMap?.generationSession || platform !== activeMap.generationSession.platformId
  const composer = <div className="shrink-0 px-2 py-2 bg-white">
    {collapsed ? <button className="w-full text-xs text-text-secondary hover:text-primary py-1" onClick={() => setCollapsed(false)}>展开输入区 ↑</button> : <>
      <div className="flex items-end gap-1.5 p-1.5 bg-white/85 border border-gray-200/80 rounded-2xl shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-colors">
        <CustomDropdown value={mode} disabled={busy || preparing || !!candidate} onChange={value => changeMode(value)} options={[...(activeMap ? [{ value: 'modify' as const, label: '调整当前图' }] : []), { value: 'generate' as const, label: '生成新图' }]} direction="up" dropdownWidth="min-w-max" className="shrink-0" buttonClassName="h-8 px-2 rounded-full text-xs font-medium flex items-center gap-1 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/15 disabled:opacity-50" />
        <CustomDropdown value={platform} disabled={busy || preparing} onChange={value => applyPlatform(String(value))} options={models.map(model => ({ value: model.id, label: model.name, logo: model.logo }))} direction="up" dropdownWidth="w-48" hideArrow className="shrink-0" buttonClassName="h-8 w-7 rounded-full flex items-center justify-center text-text-secondary hover:bg-gray-100 disabled:opacity-50" renderButton={() => <span title={`生成模型：${models.find(model => model.id === platform)?.name || platform}`} aria-label={`生成模型：${models.find(model => model.id === platform)?.name || platform}`}>
          {models.find(model => model.id === platform)?.logo ? <img src={models.find(model => model.id === platform)?.logo} alt="生成模型" className="w-4 h-4 object-contain" /> : <AppIcon name="smart_toy" size={16} />}
        </span>} />
        <textarea ref={textareaRef} aria-label={mode === 'generate' ? '新图要求（选填）' : '导图修改要求'} rows={1} maxLength={mode === 'modify' ? MINDMAP_REQUIREMENTS_LIMIT : undefined} value={request} disabled={busy || preparing} onChange={event => changeRequest(event.target.value)} placeholder={mode === 'generate' ? '输入新图要求（可选）…' : adjustFromCurrent ? '基于当前图描述想调整的内容…' : candidate ? '继续调整候选稿…' : '描述想调整的内容…'} className="flex-1 min-w-0 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none leading-5 py-1.5 px-1 max-h-[72px] disabled:opacity-50" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} />
        <button type="button" disabled={busy || preparing || !platform || !models.some(model => model.id === platform) || (mode === 'modify' && (!request.trim() || (!!candidateConflict && !adjustFromCurrent)))} aria-label={submitLabel} title={submitLabel} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-primary text-white hover:brightness-95 disabled:bg-gray-100 disabled:text-gray-400" onClick={() => void submit()}><AppIcon name={busy || preparing ? 'sync' : 'arrow_upward'} size={18} className={`text-[18px] ${busy || preparing ? 'animate-spin' : ''}`} /></button>
      </div>
      <div className="mt-1.5 px-1 flex items-center justify-between gap-2 text-xs text-gray-500">
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-center min-w-0 flex-1">
          {mode === 'modify' && (
            <>
              <label className="flex gap-1 items-center" title={expectsNewSession ? '新生成对话会自动携带来源上下文' : variant === 'document' ? '勾选后重新上传来源文档；不勾选时只提交导图和要求' : source ? '本轮采集来源主会话已加载的完整内容；不勾选时只提交导图和要求' : '来源主会话未打开，将使用本地保存的快照，可能不是最新内容'}><input type="checkbox" disabled={busy || preparing || expectsNewSession} checked={includeSourceContext || expectsNewSession} onChange={event => setIncludeSourceContext(event.target.checked)} />{variant === 'document' ? '带上来源文档' : source ? '带上主会话最新内容' : '带上来源快照'}</label>
              {task?.phase === 'error' && <label className="flex gap-1 items-center" title="新开后台生成对话，携带来源上下文及当前导图；仍修改当前图"><input type="checkbox" disabled={busy || preparing} checked={newSession} onChange={event => setNewSession(event.target.checked)} />使用新的 AI 对话调整当前图</label>}
            </>
          )}
        </div>
        <button
          type="button"
          aria-label="折叠输入区"
          title="折叠输入区"
          className="ml-auto flex items-center gap-0.5 text-xs text-gray-400 hover:text-primary transition-colors py-0.5 px-1 rounded hover:bg-gray-100 select-none shrink-0"
          onClick={() => setCollapsed(true)}
        >
          <span>折叠</span>
          <AppIcon name="expand_more" size={15} />
        </button>
      </div>
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
      {activeMap && conversation ? <MindmapEditor key={`${activeMap.id}:${editorRevision}`} conversationId={conversation.id} resolveConversationId={source?.resolveId} map={activeMap} onReload={() => void reload()} controls={controls} notice={notice} panelRef={panelRef} editorRef={editorRef} onClose={onClose} draggableHeader={draggableHeader} onDragStart={onDragStart} previewMarkdown={candidatePreview?.markdown} changedLines={diff?.changedLines} onAskNode={source && conversation.url && variant !== 'document' ? ask : undefined} onViewSource={onViewSource} onEdit={clearMarks} /> : <div className="h-full flex flex-col">
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
        <AppIcon name="diagram_flow_horizontal" size={20} className="text-primary shrink-0" />
            <span className="text-sm font-medium text-text-primary truncate">思维导图</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onOpenMubu && controls}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors no-drag"
                title="关闭思维导图"
                aria-label="关闭思维导图"
              >
                <AppIcon name="close" size={16} />
              </button>
            )}
          </div>
        </div>
        {notice}
        <div className="flex-1 min-h-0 flex flex-col p-5 overflow-y-auto">
          {/* 顶部插画与引导标题 */}
          <div className="flex flex-col items-center text-center mt-3 mb-5 shrink-0">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3 border border-primary/20 shadow-2xs">
              <AppIcon name="diagram_flow_horizontal" size={30} />
            </div>
            <h2 className="text-base font-semibold text-gray-800">
              {variant === 'document' ? '把这篇文档整理成思维导图' : '把当前对话整理成思维导图'}
            </h2>
          </div>

          {/* 生成配置卡片（模型选择器 + 额外要求合体） */}
          <div className="bg-gray-50/80 border border-gray-200/80 rounded-xl p-3 space-y-2.5 mb-3 shrink-0">
            {/* 顶部：模型选择器（药丸按钮居左，适度加大） */}
            <div className="flex items-center justify-between">
              <CustomDropdown
                value={platform}
                disabled={preparing || busy}
                onChange={val => applyPlatform(val)}
                options={models.map(m => ({ value: m.id, label: m.name, logo: m.logo }))}
                dropdownWidth="w-56"
                buttonClassName="h-8.5 px-3 bg-white border border-gray-200/90 hover:border-gray-300 rounded-lg flex items-center gap-2 shadow-2xs transition-colors disabled:opacity-50 text-left"
                renderButton={() => (
                  <div className="flex items-center gap-2 min-w-0">
                    {currentModel?.logo ? (
                      <img src={currentModel.logo} alt={currentModel.name} className="w-4 h-4 object-contain rounded-xs shrink-0" />
                    ) : (
                      <AppIcon name="smart_toy" size={16} className="text-gray-400 shrink-0" />
                    )}
                    <span className="text-sm font-medium text-text-primary truncate max-w-[140px]">{currentModel?.name || platform}</span>
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
                        <AppIcon name="smart_toy" size={14} className="text-gray-400 shrink-0" />
                      )}
                      <span className="text-xs truncate flex-1">{option.label}</span>
                      {isSelected && (
                        <AppIcon name="check" size={14} className="text-primary ml-auto shrink-0" />
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
                  className="text-xs text-text-secondary hover:text-red-500 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100"
                >
                  清空
                </button>
              )}
            </div>

            {/* 底部：额外要求输入框（字号调整为 text-sm，呼吸感更强） */}
            <textarea
              value={request}
              disabled={preparing || busy}
              rows={4}
              onChange={event => changeRequest(event.target.value)}
              placeholder="额外要求（选填，例如：重点提炼核心论点与结论，省略客套与类比）..."
              className="w-full text-sm leading-relaxed p-3 border border-gray-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 bg-white resize-y text-text-primary placeholder:text-text-secondary/50 disabled:opacity-60 transition-all"
            />
          </div>

          {/* 操作按钮区域（并排置于卡片正下方） */}
          <div className="grid grid-cols-2 gap-2.5 mb-4 shrink-0">
            {/* 主按钮：生成导图 */}
            <button
              disabled={preparing || busy || !platform}
              title={`将当前对话发送到 ${platformName}，生成新导图并保存到笔记`}
              onClick={() => { void submit() }}
              className="h-10 rounded-xl bg-primary hover:brightness-95 active:brightness-90 text-white font-medium text-sm flex items-center justify-center gap-1.5 shadow-xs transition-all disabled:opacity-40 cursor-pointer"
            >
              <AppIcon name="auto_awesome" size={18} />
              <span className="truncate">{preparing ? '读取中…' : busy ? '生成中…' : '生成导图'}</span>
            </button>

            {/* 次按钮：手动创建 */}
            <button
              type="button"
              disabled={preparing || busy}
              title="创建一份空白导图并直接进入编辑"
              onClick={() => { void createBlank() }}
              className="h-10 rounded-xl bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-200 text-text-primary font-medium text-sm flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <AppIcon name="edit_square" size={18} className="text-gray-400" />
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
