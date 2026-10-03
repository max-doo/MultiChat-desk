import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationMindmap, MindmapTask, NoteConversation } from '../../../shared/types/notes'
import { noteConversationKey } from '../../../shared/utils/noteIdentity'
import { MINDMAP_REQUIREMENTS_LIMIT } from '../../../shared/utils/mindmap'
import LocalMindmapPanel, { DEFAULT_MARKDOWN } from './LocalMindmapPanel'
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
const DISMISSED_TASK_KEY = 'multichat_mindmap_dismissed_task'
const DONE_NOTICE_KEY = 'multichat_mindmap_done_notice'
const NOTICE_DISMISSED_EVENT = 'mindmaps:notice-dismissed'
let dismissedTaskCache = ''

function readDismissedTask(): string {
  try { return sessionStorage.getItem(DISMISSED_TASK_KEY) || dismissedTaskCache }
  catch { return dismissedTaskCache }
}

function downloadMarkdown(markdown: string, title: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.replace(/[<>:"/\\|?*]/g, '_') || 'mindmap'}.md`
  link.click()
  URL.revokeObjectURL(url)
}

function MindmapEditor({ conversationId, map, onReload, controls, notice }: { conversationId: string; map: ConversationMindmap; onReload: () => void; controls: ReactNode; notice: ReactNode }): JSX.Element {
  const [initial, setInitial] = useState(() => drafts.get(map.id)?.markdown ?? map.markdown)
  const [remoteRevision, setRemoteRevision] = useState(0)
  const [title, setTitle] = useState(() => drafts.get(map.id)?.title ?? map.title)
  const [status, setStatus] = useState(drafts.get(map.id)?.error || '已保存')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef({ markdown: initial, title, updatedAt: drafts.get(map.id)?.updatedAt ?? map.updatedAt })
  useEffect(() => {
    if (drafts.has(map.id) || current.current.updatedAt === map.updatedAt) return
    current.current = { markdown: map.markdown, title: map.title, updatedAt: map.updatedAt }
    setInitial(map.markdown); setTitle(map.title); setStatus('已保存')
    setRemoteRevision(value => value + 1)
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

  const edit = useCallback((markdown: string, nextTitle = current.current.title) => {
    const previous = drafts.get(map.id)
    current.current = { markdown, title: nextTitle, updatedAt: previous?.updatedAt ?? current.current.updatedAt }
    drafts.set(map.id, { ...current.current, error: previous?.error })
    setStatus(previous?.error || '待保存…')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 500)
  }, [map.id, flush])

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
  return <div className="h-full flex flex-col min-h-0">
    <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-sm">
      <input aria-label="导图标题" title="点击修改标题" className="min-w-0 flex-1 h-8 px-1 font-medium text-gray-800 bg-transparent border border-transparent rounded hover:border-gray-200 focus:border-primary focus:outline-none" value={title} maxLength={200} onChange={event => { setTitle(event.target.value); edit(current.current.markdown, event.target.value) }} />
      {!failed && status !== '已保存' && <span title={status} aria-label={status} className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
      {controls}
    </div>
    {notice}
    {failed && <div role="alert" className="px-3 py-2 bg-red-50 flex flex-wrap items-start gap-3 text-sm">
      <details className="min-w-0 flex-1 text-red-600"><summary className="cursor-pointer">保存失败</summary><p className="mt-1 break-words">{status}</p></details>
      <button className="text-primary" onClick={() => { void flush(true) }}>重试</button>
      <button className="text-gray-500" onClick={() => { if (window.confirm('重新载入将放弃当前未保存编辑，请先导出大纲。继续吗？')) { drafts.delete(map.id); onReload() } }}>重新载入</button>
    </div>}
    <div className="flex-1 min-h-0"><LocalMindmapPanel key={remoteRevision} initialMarkdown={initial} onChange={edit} /></div>
  </div>
}

const taskLabels: Record<MindmapTask['phase'], string> = { loading: '正在准备生成网页…', generating: 'AI 正在生成大纲…', saving: '正在保存导图…', done: '导图已保存', error: '生成失败', cancelled: '已取消生成' }

export default function ConversationMindmapPanel({ source, conversation: fixedConversation, initialMapId }: { source?: MindmapSource; conversation?: NoteConversation; initialMapId?: string }): JSX.Element {
  const models = useAppStore(state => state.models)
  const [conversation, setConversation] = useState<NoteConversation | null>(fixedConversation || null)
  const [mapId, setMapId] = useState(initialMapId || '')
  const [platform, setPlatform] = useState(source?.id || models.find(model => model.name === fixedConversation?.platform || model.id === fixedConversation?.platform)?.id || models[0]?.id || '')
  const [task, setTask] = useState<MindmapTask | null>(null)
  const taskRef = useRef(task)
  taskRef.current = task
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [requirementsOpen, setRequirementsOpen] = useState(false)
  const [requirements, setRequirements] = useState('')
  const requirementsSourceKey = useRef('')
  const requirementsForm = useRef<HTMLFormElement>(null)
  const generateButtonRef = useRef<HTMLButtonElement>(null)
  const [editorRevision, setEditorRevision] = useState(0)
  const [dismissedTaskId, setDismissedTaskId] = useState(readDismissedTask)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const sourceKeyRef = useRef('')
  const conversationRef = useRef(conversation)
  conversationRef.current = conversation
  const refreshSequence = useRef(0)

  const dismissTask = useCallback((id: string): void => {
    dismissedTaskCache = id
    try { sessionStorage.setItem(DISMISSED_TASK_KEY, id) } catch { /* 存储不可用时仍保留本窗口的关闭状态。 */ }
    setDismissedTaskId(id)
    window.dispatchEvent(new Event(NOTICE_DISMISSED_EVENT))
  }, [])

  useEffect(() => {
    const syncDismissed = (): void => setDismissedTaskId(readDismissedTask())
    window.addEventListener(NOTICE_DISMISSED_EVENT, syncDismissed)
    return () => window.removeEventListener(NOTICE_DISMISSED_EVENT, syncDismissed)
  }, [])

  useEffect(() => {
    if (!task || task.phase !== 'done' || dismissedTaskId === task.id) return
    let expiresAt = Date.now() + 5000
    try {
      const saved = JSON.parse(sessionStorage.getItem(DONE_NOTICE_KEY) || 'null') as { taskId?: string; expiresAt?: number } | null
      if (saved?.taskId === task.id && typeof saved.expiresAt === 'number' && Number.isFinite(saved.expiresAt)) expiresAt = saved.expiresAt
      else sessionStorage.setItem(DONE_NOTICE_KEY, JSON.stringify({ taskId: task.id, expiresAt }))
    } catch { /* 无法保存截止时间时，仍自动关闭当前提示。 */ }
    // 重挂载沿用首次完成时的截止时间，避免旧提示重新获得五秒展示期。
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) { dismissTask(task.id); return }
    const timer = setTimeout(() => dismissTask(task.id), remaining)
    return () => clearTimeout(timer)
  }, [task?.id, task?.phase, dismissedTaskId, dismissTask])

  useEffect(() => { if (source?.id) setPlatform(source.id) }, [source?.id])
  useEffect(() => { if (fixedConversation) setConversation(fixedConversation) }, [fixedConversation])
  useEffect(() => { if (initialMapId) setMapId(initialMapId) }, [initialMapId])
  useEffect(() => {
    setRequirements(''); setRequirementsOpen(false); requirementsSourceKey.current = ''
  }, [source?.id, fixedConversation?.id])
  useEffect(() => {
    if (!requirementsOpen) return
    requirementsForm.current?.querySelector('textarea')?.focus()
    return () => { generateButtonRef.current?.focus() }
  }, [requirementsOpen])

  const refresh = useCallback(async (force = false) => {
    if (!sourceRef.current) return
    const sequence = ++refreshSequence.current
    const identity = await sourceRef.current.getRef()?.getConversationIdentity()
    if (sequence !== refreshSequence.current) return
    if (!identity?.url.startsWith('https://')) {
      setConversation(null); sourceKeyRef.current = ''
      setRequirements(''); setRequirementsOpen(false); requirementsSourceKey.current = ''
      return
    }
    const key = noteConversationKey(identity.url, identity.title)
    const changed = key !== sourceKeyRef.current
    if (!changed && !force) return
    sourceKeyRef.current = key
    if (changed) {
      setConversation(null); setMapId(''); setError('')
      setRequirements(''); setRequirementsOpen(false); requirementsSourceKey.current = ''
    }
    const result = await window.api.notesList()
    if (sequence !== refreshSequence.current) return
    if (!result.success) { setError(result.error || '读取导图失败'); return }
    const next = result.data?.find(item => item.sourceKey === key) || null
    setConversation(next)
  }, [])

  useEffect(() => {
    if (!source) return
    void refresh()
    const timer = setInterval(() => { void refresh() }, 2000)
    const off = window.api.onNotesChanged(() => { void refresh(true) })
    return () => { clearInterval(timer); off(); refreshSequence.current++ }
  }, [source?.id, refresh])

  useEffect(() => {
    let alive = true
    let current: MindmapTask | null = null
    let revision = 0
    let reading = false
    const update = (next: MindmapTask): void => {
      if (!alive) return
      const completed = next.phase === 'done' && (current?.id !== next.id || current.phase !== 'done')
      current = next
      setTask(next)
      if (next.phase === 'done' && next.conversationId === conversationRef.current?.id && !conversationRef.current.mindmaps.length && next.mindmapId) setMapId(next.mindmapId)
      if (completed) void window.api.notesList().then(result => {
        if (!alive || conversationRef.current?.id !== next.conversationId) return
        const saved = result.data?.find(item => item.id === next.conversationId)
        if (result.success && saved) setConversation(saved)
      }).catch(() => { /* 下次打开笔记时可重新读取，任务完成状态仍保留。 */ })
    }
    const sync = async (): Promise<void> => {
      if (reading) return
      reading = true
      const requestRevision = revision
      try {
        const result = await window.api.mindmapsTask()
        // 请求期间收到新事件时，不能用旧快照覆盖新状态。
        if (alive && requestRevision === revision && result.success && result.data) update(result.data)
      } catch { /* 暂时读取失败时保留状态，下次轮询继续核对。 */ }
      finally { reading = false }
    }
    const off = window.api.onMindmapTaskChanged(next => { revision++; update(next) })
    void sync()
    const timer = setInterval(() => {
      const visibleTask = taskRef.current
      if (visibleTask && !['done', 'error', 'cancelled'].includes(visibleTask.phase)) void sync()
    }, 2000)
    return () => { alive = false; clearInterval(timer); off() }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('multichat_local_mindmap_markdown')
    if (!saved) return
    if (saved === DEFAULT_MARKDOWN) { localStorage.removeItem('multichat_local_mindmap_markdown'); return }
    void window.api.mindmapsImportLegacy(saved).then(result => {
      if (result.success && localStorage.getItem('multichat_local_mindmap_markdown') === saved) localStorage.removeItem('multichat_local_mindmap_markdown')
      else if (!result.success) setError(result.error || '旧导图迁移失败，原内容仍保留')
    })
  }, [])

  const capture = async (): Promise<NoteConversation> => {
    const currentSource = sourceRef.current
    if (!currentSource) {
      if (!conversationRef.current) throw new Error('来源会话不存在')
      return conversationRef.current
    }
    const id = currentSource.getRef()?.getWebContentsId()
    if (!id) throw new Error('当前对话尚未就绪')
    // 这里只准备输入，生成成功或创建空白图后才会持久化快照。
    const result = await window.api.notesCaptureSource(id, currentSource.id, currentSource.name)
    if (!result.success || !result.data) throw new Error(result.error || '读取对话失败')
    return result.data
  }

  const generate = async (blank = false, additionalRequirements = '', expectedSourceKey?: string): Promise<void> => {
    if (preparing || (!blank && busy)) return
    if (additionalRequirements.length > MINDMAP_REQUIREMENTS_LIMIT) { setError(`额外要求不能超过 ${MINDMAP_REQUIREMENTS_LIMIT} 字符`); return }
    setPreparing(true); setError('')
    try {
      const captured = await capture()
      // 确认后切换来源时，不能把上一会话的要求发送给新会话。
      if (expectedSourceKey !== undefined && (captured.sourceKey !== expectedSourceKey || (sourceRef.current ? sourceKeyRef.current !== expectedSourceKey : conversationRef.current?.sourceKey !== expectedSourceKey))) {
        throw new Error('对话已切换，请重新打开“按要求生成”')
      }
      if (blank) {
        const result = await window.api.mindmapsAdd(captured.id, `# ${captured.title.replace(/\n/g, ' ')}\n\n## 新分支\n- 新节点`)
        if (!result.success || !result.data) throw new Error(result.error || '新建失败')
        if (task && !busy) dismissTask(task.id)
        const latest = await window.api.notesList()
        if (!sourceRef.current || captured.sourceKey === sourceKeyRef.current) { setConversation(latest.data?.find(item => item.sourceKey === captured.sourceKey) || captured); setMapId(result.data.id) }
      } else {
        if ((!sourceRef.current || captured.sourceKey === sourceKeyRef.current) && captured.mindmaps.length && !mapId) setMapId(captured.mindmaps[captured.mindmaps.length - 1].id)
        const result = await window.api.mindmapsStart(captured.id, platform, additionalRequirements.trim() || undefined)
        if (!result.success || !result.data) throw new Error(result.error || '启动失败')
        if (expectedSourceKey !== undefined) setRequirementsOpen(false)
        setTask(result.data)
        if (!sourceRef.current || captured.sourceKey === sourceKeyRef.current) setConversation(captured)
      }
    } catch (exception) { setError(exception instanceof Error ? exception.message : '操作失败') }
    finally { setPreparing(false) }
  }

  const activeMap = conversation?.mindmaps.find(map => map.id === mapId) || conversation?.mindmaps[conversation.mindmaps.length - 1]
  const busy = !!task && !['done', 'error', 'cancelled'].includes(task.phase)
  const reloadEditor = async (): Promise<void> => {
    const result = await window.api.notesList()
    if (!result.success) { setError(result.error || '重新载入失败'); return }
    const next = result.data?.find(item => item.id === conversationRef.current?.id)
    if (next) { setConversation(next); setEditorRevision(value => value + 1) }
  }
  const platformName = models.find(model => model.id === platform)?.name || platform
  const currentModel = models.find(model => model.id === platform)
  const generateButton = <button ref={generateButtonRef} disabled={preparing || busy || !platform} title={`将当前对话发送到 ${platformName}，生成新导图并保存到笔记`} onClick={() => { void generate() }} className="h-8 shrink-0 rounded-lg bg-primary text-white px-3 text-sm disabled:opacity-40 hover:brightness-95">{preparing ? '读取中…' : busy ? '生成中…' : activeMap ? '生成新图' : '生成导图'}</button>
  const controls = <div className="flex items-center gap-1.5 shrink-0">
    {activeMap && generateButton}
    <CustomDropdown value={null} onChange={() => {}} displayText="更多" dropdownWidth="w-72 !left-auto right-0 !z-50 !max-h-[70vh]" buttonClassName="h-8 px-2 rounded-lg text-gray-500 hover:bg-gray-100 flex items-center gap-1 text-sm" renderContent={close => <div className="p-2 space-y-1 text-sm">
      <label className="flex items-center justify-between gap-3 px-2 py-1.5 text-gray-600">生成平台
        <select aria-label="生成平台" value={platform} disabled={preparing || busy} onChange={event => setPlatform(event.target.value)} className="min-w-0 max-w-[150px] border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800">
          {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      {conversation && conversation.mindmaps.length > 1 && <label className="block px-2 py-1.5 text-gray-600">历史导图 · {conversation.mindmaps.length} 份
        <select aria-label="选择导图" value={activeMap?.id || ''} onChange={event => { setMapId(event.target.value); close() }} className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800">
          {conversation.mindmaps.map(map => <option key={map.id} value={map.id}>{map.title} · {new Date(map.createdAt).toLocaleString()}</option>)}
        </select>
      </label>}
      {activeMap && conversation && activeMap.sourceRevision !== conversation.snapshotRevision && <p className="px-2 py-1 text-amber-700">对话已更新，可生成新图。</p>}
      <div className="border-t border-gray-100 my-1" />
      <button disabled={preparing || busy || !platform} className="w-full text-left px-2 py-2 rounded-md hover:bg-gray-50 disabled:opacity-40" onClick={() => {
        close()
        const key = sourceRef.current ? sourceKeyRef.current : conversationRef.current?.sourceKey
        if (!key) { setError('当前对话尚未就绪，请稍后重试'); return }
        requirementsSourceKey.current = key
        setError(''); setRequirementsOpen(true)
      }}>按要求生成…</button>
      <button disabled={preparing} className="w-full text-left px-2 py-2 rounded-md hover:bg-gray-50 disabled:opacity-40" onClick={() => { close(); void generate(true) }}>新建空白导图</button>
      {activeMap && conversation && <>
        <button className="w-full text-left px-2 py-2 rounded-md hover:bg-gray-50" onClick={() => { close(); const draft = drafts.get(activeMap.id); downloadMarkdown(draft?.markdown ?? activeMap.markdown, draft?.title ?? activeMap.title) }}>导出大纲</button>
        <button className="w-full text-left px-2 py-2 rounded-md hover:bg-gray-50" onClick={() => { close(); void window.api.notesOpen({ conversationId: conversation.id, mindmapId: activeMap.id }).then(result => { if (!result.success) setError(result.error || '打开笔记失败') }) }}>在笔记中打开</button>
        <button className="w-full text-left px-2 py-2 rounded-md text-red-500 hover:bg-red-50" onClick={() => {
          close()
          if (!window.confirm('确定删除这份导图吗？')) return
          void window.api.mindmapsDelete(conversation.id, activeMap.id).then(async result => {
            if (!result.success) { setError(result.error || '删除失败'); return }
            drafts.delete(activeMap.id)
            const latest = await window.api.notesList()
            if (conversationRef.current?.id === conversation.id) { setMapId(''); setConversation(latest.data?.find(item => item.id === conversation.id) || null) }
          })
        }}>删除导图</button>
      </>}
      <p className="px-2 pt-2 pb-1 text-xs text-gray-400 border-t border-gray-100">对话发送到所选平台，结果自动保存到笔记。</p>
    </div>} />
  </div>
  const showTask = task && task.id !== dismissedTaskId && task.phase !== 'cancelled' && !(task.phase === 'done' && task.mindmapId === activeMap?.id)
  const notice = <>
    {error && !requirementsOpen && <div role="alert" className="px-3 py-2 text-sm text-red-600 bg-red-50 flex items-start gap-2"><span className="flex-1 min-w-0 break-words">{error}</span><button aria-label="关闭提示" onClick={() => setError('')} className="shrink-0 material-symbols-outlined text-base">close</button></div>}
    {showTask && task && <div role="status" className="px-3 py-2 bg-gray-50 flex items-start gap-3 text-sm">
      {task.error ? <details className="min-w-0 flex-1 text-red-600"><summary className="cursor-pointer" title={task.sourceTitle}>生成失败 · 查看详情</summary><p className="mt-2 break-words">{task.error}</p></details> : <span className="min-w-0 flex-1 truncate text-gray-500" title={task.sourceTitle}>{task.conversationId !== conversation?.id ? `${task.sourceTitle}：` : ''}{taskLabels[task.phase]}</span>}
      {busy && task.phase !== 'saving' && <button className="shrink-0 text-gray-500 hover:text-gray-800" onClick={() => { void window.api.mindmapsCancel(task.id).then(result => { if (!result.success) setError(result.error || '取消失败') }) }}>取消</button>}
      {['loading', 'generating', 'error'].includes(task.phase) && <button className="shrink-0 text-primary" onClick={() => { void window.api.mindmapsShow(task.id).then(result => { if (!result.success) setError(result.error || '网页已关闭') }) }}>查看网页</button>}
      {task.phase === 'done' && <button className="shrink-0 text-primary" onClick={() => {
        if (task.conversationId === conversation?.id) { void reloadEditor().then(() => setMapId(task.mindmapId || '')) }
        else void window.api.notesOpen({ conversationId: task.conversationId, mindmapId: task.mindmapId }).then(result => { if (!result.success) setError(result.error || '打开结果失败') })
      }}>查看结果</button>}
      {!busy && <button aria-label="关闭生成提示" className="shrink-0 material-symbols-outlined text-base text-gray-400 hover:text-gray-700" onClick={() => dismissTask(task.id)}>close</button>}
    </div>}
  </>
  return <div className="h-full flex flex-col min-h-0 bg-white">
    {requirementsOpen && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4 no-drag" onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape' && !preparing) { event.preventDefault(); setRequirementsOpen(false) }
      if (event.key === 'Tab') {
        const controls = requirementsForm.current?.querySelectorAll<HTMLElement>('select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')
        if (!controls?.length) { event.preventDefault(); return }
        const first = controls[0]; const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }}>
      <form ref={requirementsForm} role="dialog" aria-modal="true" aria-labelledby="mindmap-requirements-title" className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl" onSubmit={event => {
        event.preventDefault()
        void generate(false, requirements, requirementsSourceKey.current)
      }}>
        <h2 id="mindmap-requirements-title" className="text-base font-medium text-gray-800">按要求生成导图</h2>
        <label className="mt-4 flex items-center justify-between gap-3 text-sm text-gray-600">生成平台
          <select aria-label="生成平台" value={platform} disabled={preparing || busy} onChange={event => setPlatform(event.target.value)} className="min-w-0 max-w-[200px] rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-800">
            {models.filter(model => model.enabled || model.id === source?.id || model.id === platform).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-sm text-gray-600">额外要求（选填）
          <textarea value={requirements} disabled={preparing || busy} maxLength={MINDMAP_REQUIREMENTS_LIMIT} rows={5} onChange={event => setRequirements(event.target.value)} placeholder="只整理关于产品价值判断的讨论，重点保留核心结论、依据和适用边界，省略过程中的类比。" className="mt-2 w-full resize-y rounded-lg border border-gray-200 p-3 text-sm text-gray-800 outline-none focus:border-primary disabled:opacity-60" />
        </label>
        <div className="mt-1 flex items-start justify-between gap-3 text-xs text-gray-400"><span>留空时按默认策略提炼，仅用于本次生成。</span><span className="shrink-0">{requirements.length}/{MINDMAP_REQUIREMENTS_LIMIT}</span></div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600 break-words">{error}</p>}
        <p className="mt-3 text-xs text-gray-400">确认后将对话发送到所选平台，新导图自动保存到笔记。</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={preparing} onClick={() => setRequirementsOpen(false)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40">取消</button>
          <button type="submit" disabled={preparing || busy || !platform} className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-40">{preparing ? '读取中…' : busy ? '生成中…' : '生成'}</button>
        </div>
      </form>
    </div>, document.body)}
    {activeMap && conversation ? (
      <MindmapEditor
        key={`${activeMap.id}:${editorRevision}`}
        conversationId={conversation.id}
        map={activeMap}
        controls={controls}
        notice={notice}
        onReload={() => { void reloadEditor() }}
      />
    ) : (
      <>
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
              {requirements.trim().length > 0 && (
                <button
                  type="button"
                  disabled={preparing || busy}
                  onClick={() => setRequirements('')}
                  className="text-[11px] text-gray-400 hover:text-red-500 transition-colors px-1"
                >
                  清空
                </button>
              )}
            </div>

            {/* 底部：额外要求输入框（直接展开，无单独图标，无字数限制） */}
            <textarea
              value={requirements}
              disabled={preparing || busy}
              maxLength={MINDMAP_REQUIREMENTS_LIMIT}
              rows={3}
              onChange={event => setRequirements(event.target.value)}
              placeholder="额外要求（选填，例如：重点提炼核心论点与结论，省略客套与类比）..."
              className="w-full text-xs p-2.5 border border-gray-200/80 rounded-lg outline-none focus:border-primary bg-white resize-y text-gray-700 placeholder:text-gray-400 disabled:opacity-60"
            />
          </div>

          {/* 操作按钮区域（并排置于卡片正下方） */}
          <div className="grid grid-cols-2 gap-2.5 mb-4 shrink-0">
            {/* 主按钮：生成导图 */}
            <button
              ref={generateButtonRef}
              disabled={preparing || busy || !platform}
              title={`将当前对话发送到 ${platformName}，生成新导图并保存到笔记`}
              onClick={() => { void generate(false, requirements) }}
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
              onClick={() => { void generate(true) }}
              className="h-9 rounded-xl bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-200 text-gray-700 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm text-gray-400">edit_square</span>
              <span className="truncate">手动创建空白导图</span>
            </button>
          </div>
        </div>
      </>
    )}
  </div>
}
