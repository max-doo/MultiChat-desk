import { randomUUID } from 'crypto'
import type { MindmapTask, NoteConversation, MindmapModifyRequest, MindmapCandidate, MindmapGenerationSession, ConversationMindmap, MindmapSourceContext } from '../../shared/types/notes'
import { applyMindmapTextEdits, buildMindmapEditPrompt, normalizeMindmapNewlines, parseMindmapModifyResponse, validateMindmapMarkdown } from '../../shared/utils/mindmapEdits'
import { buildMindmapPrompt, inspectMindmapOutline, MINDMAP_INPUT_LIMIT, MINDMAP_TAGS } from '../../shared/utils/mindmap'
import { generateMindmapPageStateScript, generateMindmapResponseScript, type MindmapResponse } from '../../shared/utils/webviewScripts'
import { automationService } from './AutomationService'
import { sessionManager } from './SessionManager'
import type { NoteManager } from '../noteManager'
import type { BrowserWindow } from 'electron'
import { showBackgroundPreview } from '../webviewManager'

const TERMINAL_PHASES = ['done', 'error', 'cancelled']
const sessionKey = (id: string): string => `__mindmap_${id}`
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const CONFLICT = '导图在生成期间发生了修改，请基于当前版本重新调整'
const IDLE_TIMEOUT = 2 * 60_000
const TEMPORARY_IDLE_TIMEOUT = 10 * 60_000

/** 限制一次异步操作的等待时间；网页脚本迟到的返回值不会继续推进任务。 */
function waitFor<T>(operation: Promise<T>, timeoutMs: number, stage: string, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error(`${stage}超时，网页操作未返回`)), timeoutMs)
    const aborted = (): void => finish(new Error('任务已中止'))
    const finish = (error?: Error, value?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      if (error) reject(error)
      else resolve(value as T)
    }
    signal.addEventListener('abort', aborted, { once: true })
    operation.then(value => finish(undefined, value), error => finish(error instanceof Error ? error : new Error(String(error))))
    if (signal.aborted) aborted()
  })
}

export class MindmapService {
  private task: MindmapTask | null = null
  private controller: AbortController | null = null
  private ownerId = 0
  private idle: { key: string; mapId: string; platformId: string; initialized: boolean; pendingAttachment?: boolean } | null = null
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private lastPage: { taskId: string; key: string; mapId: string; initialized: boolean; binding: MindmapGenerationSession } | null = null
  private trackedWindows = new WeakSet<BrowserWindow>()
  private candidates = new Map<number, Map<string, MindmapCandidate>>()
  private applying = new Set<string>()

  constructor(private notes: NoteManager, private notify: (task: MindmapTask) => void, private notesChanged: () => void) {}

  getTask(): MindmapTask | null { return this.task ? { ...this.task } : null }

  async start(conversation: NoteConversation, platform: string, additionalRequirements = '', ownerId = 0): Promise<MindmapTask> {
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有导图正在生成，请等待或取消后再试')
    if (conversation.snapshot.length > MINDMAP_INPUT_LIMIT) throw new Error('对话超过 60000 字符，暂不支持直接生成；内容未截断')
    if (!conversation.snapshot.trim()) throw new Error('没有可整理的对话内容')
    await automationService.getPlatformSelectors(platform)
    // 异步检查后再检查一次，防止两个窗口同时启动。
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有导图正在生成')
    this.releaseIdle()
    this.lastPage = null
    this.ownerId = ownerId
    this.controller = new AbortController()
    const task: MindmapTask = { id: randomUUID(), conversationId: conversation.id, sourceTitle: conversation.title, platform, phase: 'loading', kind: 'generate' }
    this.task = task
    this.notify({ ...task })
    void this.run(task, conversation, this.controller.signal, additionalRequirements)
    return { ...task }
  }

  private releaseIdle(): void {
    this.clearIdleTimer()
    const idle = this.idle
    this.idle = null
    if (idle) sessionManager.destroySession(idle.key)
  }

  private clearIdleTimer(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private trackWindow(key: string): void {
    const window = sessionManager.getSession(key)
    if (!window || this.trackedWindows.has(window)) return
    this.trackedWindows.add(window)
    window.on('show', () => { if (this.idle?.key === key) this.clearIdleTimer() })
    window.on('hide', () => {
      if (this.task && this.idle?.key === key) this.scheduleIdleRelease(this.task, key)
    })
    window.on('closed', () => {
      if (this.idle?.key === key) {
        this.clearIdleTimer()
        this.idle = null
      }
    })
  }

  /** 只给已结束且隐藏的网页计时；保留地址，不保留网页进程。 */
  private async retainTerminalPage(task: MindmapTask, key: string): Promise<void> {
    if (this.task?.id !== task.id || !TERMINAL_PHASES.includes(task.phase) || this.idle?.key !== key) return
    const window = sessionManager.getSession(key)
    if (!window) return
    window.webContents.setBackgroundThrottling(true)
    const binding = await this.sessionBinding(task.platform, window.webContents.getURL()).catch(() => ({ platformId: task.platform } as MindmapGenerationSession))
    if (this.task?.id !== task.id || !TERMINAL_PHASES.includes(task.phase) || this.idle?.key !== key || window.isDestroyed()) return
    this.lastPage = { taskId: task.id, key, mapId: this.idle.mapId, initialized: this.idle.initialized, binding }
    this.scheduleIdleRelease(task, key)
  }

  private scheduleIdleRelease(task: MindmapTask, key: string): void {
    if (this.task?.id !== task.id || !TERMINAL_PHASES.includes(task.phase) || this.idle?.key !== key) return
    const window = sessionManager.getSession(key)
    if (!window) return
    this.clearIdleTimer()
    if (window.isVisible()) return
    if (task.phase === 'cancelled') { this.releaseIdle(); return }
    const timeout = this.lastPage?.binding.conversationUrl ? IDLE_TIMEOUT : TEMPORARY_IDLE_TIMEOUT
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      if (this.task?.id === task.id && TERMINAL_PHASES.includes(task.phase) && this.idle?.key === key && !window.isDestroyed() && !window.isVisible()) this.releaseIdle()
    }, timeout)
  }

  getCandidate(ownerId: number, mapId: string): MindmapCandidate | null {
    const candidate = this.candidates.get(ownerId)?.get(mapId)
    return candidate ? { ...candidate, generationSession: { ...candidate.generationSession } } : null
  }

  private async checkBase(candidate: Pick<MindmapCandidate, 'conversationId' | 'mindmapId' | 'baseUpdatedAt' | 'baseMarkdown' | 'baseTitle'>): Promise<ConversationMindmap> {
    const source = await this.notes.get(candidate.conversationId)
    const map = source.mindmaps.find(item => item.id === candidate.mindmapId)
    if (!map) throw new Error('导图不存在')
    if (map.updatedAt !== candidate.baseUpdatedAt || normalizeMindmapNewlines(map.markdown) !== candidate.baseMarkdown || map.title !== candidate.baseTitle) throw new Error(CONFLICT)
    return map
  }

  async modify(request: MindmapModifyRequest, ownerId: number, loadContext?: (source: NoteConversation) => Promise<MindmapSourceContext>): Promise<MindmapTask> {
    if (!request || typeof request.conversationId !== 'string' || typeof request.mindmapId !== 'string' || !Number.isFinite(request.expectedUpdatedAt) || typeof request.platformId !== 'string' || typeof request.instructions !== 'string' || !request.instructions.trim() || request.instructions.length > 1000 || (request.newSession !== undefined && typeof request.newSession !== 'boolean') || (request.candidateId !== undefined && typeof request.candidateId !== 'string')) throw new Error('调整参数无效，请输入不超过 1000 字符的要求')
    if ((request.includeSourceContext !== undefined && typeof request.includeSourceContext !== 'boolean') || (request.source !== undefined && (!request.source || (request.source.webContentsId !== undefined && (!Number.isInteger(request.source.webContentsId) || request.source.webContentsId <= 0)) || typeof request.source.platformId !== 'string' || !request.source.platformId || typeof request.source.name !== 'string' || request.source.name.length > 200))) throw new Error('来源上下文参数无效')
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有导图任务正在执行')
    const source = await this.notes.get(request.conversationId)
    const map = source.mindmaps.find(item => item.id === request.mindmapId)
    if (!map || map.updatedAt !== request.expectedUpdatedAt) throw new Error(CONFLICT)
    const previous = this.getCandidate(ownerId, map.id)
    if (request.candidateId && (previous?.id !== request.candidateId || previous.conversationId !== source.id)) throw new Error('候选已失效，请重新打开导图')
    const base: MindmapCandidate = request.candidateId && previous ? previous : {
      id: '', conversationId: source.id, mindmapId: map.id, baseMarkdown: normalizeMindmapNewlines(map.markdown), baseTitle: map.title, baseUpdatedAt: map.updatedAt,
      candidateMarkdown: normalizeMindmapNewlines(map.markdown), generationSession: map.generationSession || { platformId: request.platformId }
    }
    await this.checkBase(base)
    if (base.candidateMarkdown.length + normalizeMindmapNewlines(request.instructions).length > MINDMAP_INPUT_LIMIT) throw new Error('导图与修改要求合计超过 60000 字符，请缩小内容；未截断')
    validateMindmapMarkdown(base.candidateMarkdown)
    await automationService.getPlatformSelectors(request.platformId)
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有导图任务正在执行')
    if (this.applying.has(`${ownerId}:${map.id}`)) throw new Error('正在应用候选，请稍候')
    if (this.idle?.mapId !== map.id || this.idle.platformId !== request.platformId || request.newSession || this.idle.pendingAttachment) this.releaseIdle()
    this.clearIdleTimer()
    this.lastPage = null
    this.controller = new AbortController()
    this.ownerId = ownerId
    const task: MindmapTask = { id: randomUUID(), kind: 'modify', conversationId: source.id, mindmapId: map.id, sourceTitle: source.title, platform: request.platformId, phase: 'loading', baseUpdatedAt: base.baseUpdatedAt }
    this.task = task
    this.notify({ ...task })
    void this.run(task, source, this.controller.signal, request.instructions, { base, newSession: request.newSession === true, includeSourceContext: request.includeSourceContext === true, loadContext })
    return { ...task }
  }

  async apply(ownerId: number, mapId: string, candidateId: string): Promise<ConversationMindmap> {
    const candidate = this.getCandidate(ownerId, mapId)
    if (!candidate || candidate.id !== candidateId) throw new Error('候选不存在或不属于当前窗口')
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase) && this.task.mindmapId === mapId) throw new Error('请等待当前调整完成')
    const key = `${ownerId}:${mapId}`
    if (this.applying.has(key)) throw new Error('正在应用修改')
    this.applying.add(key)
    try {
      await this.checkBase(candidate)
      const saved = await this.notes.updateMindmap(candidate.conversationId, mapId, candidate.candidateMarkdown, validateMindmapMarkdown(candidate.candidateMarkdown), candidate.baseUpdatedAt, candidate.generationSession)
      this.candidates.get(ownerId)?.delete(mapId)
      this.notesChanged()
      return saved
    } finally { this.applying.delete(key) }
  }

  discard(ownerId: number, mapId: string, candidateId: string): void {
    if (this.applying.has(`${ownerId}:${mapId}`)) throw new Error('正在应用修改，请稍候')
    const candidate = this.getCandidate(ownerId, mapId)
    if (!candidate || candidate.id !== candidateId) throw new Error('候选不存在或不属于当前窗口')
    if (this.ownerId === ownerId && this.task?.mindmapId === mapId) this.cancel(this.task.id, ownerId)
    this.candidates.get(ownerId)?.delete(mapId)
  }

  forgetMap(mapId: string): void {
    if (this.task?.mindmapId === mapId) this.cancel(this.task.id)
    if (this.idle?.mapId === mapId) this.releaseIdle()
    if (this.lastPage?.mapId === mapId) this.lastPage = null
    for (const candidates of this.candidates.values()) candidates.delete(mapId)
  }

  forgetOwner(ownerId: number): void {
    if (this.ownerId === ownerId && this.task) {
      this.controller?.abort()
      if (!TERMINAL_PHASES.includes(this.task.phase)) {
        this.task.phase = 'cancelled'
        this.notify({ ...this.task })
      }
      this.releaseIdle()
      this.lastPage = null
    }
    this.candidates.delete(ownerId)
  }

  private async sessionBinding(platformId: string, currentUrl: string): Promise<MindmapGenerationSession> {
    const selectors = await automationService.getPlatformSelectors(platformId)
    const initial = new URL(automationService.getPlatformUrl(platformId, selectors))
    try {
      const url = new URL(currentUrl)
      const conversationPath = /\/(?:c|chat|app|search|thread|conversation|session|s)\/[^/]+/i.test(url.pathname)
      const conversationQuery = ['conversation_id', 'conversationId', 'chatId'].some(key => !!url.searchParams.get(key))
      const stable = url.protocol === 'https:' && !url.username && !url.password && url.origin === initial.origin && (conversationPath || conversationQuery) && !/\/(?:new|login|auth|temporary)(?:\/|$)/i.test(url.pathname)
      return { platformId, ...(stable ? { conversationUrl: url.href } : {}) }
    } catch { return { platformId } }
  }

  private async restoreUrl(binding: MindmapGenerationSession): Promise<string | undefined> {
    if (!binding.conversationUrl) return undefined
    const checked = await this.sessionBinding(binding.platformId, binding.conversationUrl)
    if (!checked.conversationUrl) throw new Error('生成会话地址无效，请建立新的生成对话继续修改')
    return checked.conversationUrl
  }

  private change(task: MindmapTask, phase: MindmapTask['phase'], error?: string): void {
    if (this.task?.id !== task.id || task.phase === 'cancelled') return
    task.phase = phase
    task.error = error
    this.notify({ ...task })
  }

  private async run(task: MindmapTask, source: NoteConversation, cancelSignal: AbortSignal, additionalRequirements: string, edit?: { base: MindmapCandidate; newSession: boolean; includeSourceContext: boolean; loadContext?: (source: NoteConversation) => Promise<MindmapSourceContext> }): Promise<void> {
    const key = edit && this.idle ? this.idle.key : sessionKey(task.id)
    const initialized = !!edit && this.idle?.initialized === true
    const ownerId = this.ownerId
    const controller = new AbortController()
    const signal = controller.signal
    const abort = (): void => controller.abort()
    cancelSignal.addEventListener('abort', abort, { once: true })
    let generationTimer: ReturnType<typeof setTimeout> | undefined
    let stage = '准备生成网页'
    let captured: MindmapResponse = { text: '', source: 'empty', editorCount: 0, codeCount: 0, messageCount: 0 }
    let pageBusy: boolean | undefined
    let stable = 0
    const diagnostics = (): string => `阶段：${stage}；来源：${captured.source}；读取 ${captured.text.length} 字符，回复 ${captured.messageCount} 个，编辑器 ${captured.editorCount} 个，代码节点 ${captured.codeCount} 个${edit ? `，修改文档 ${captured.documentCount ?? '未识别'} 份` : ''}；网页生成状态：${pageBusy === undefined ? '未读取' : pageBusy ? '生成中' : '空闲'}；大纲稳定 ${stable} 次`
    try {
      if (cancelSignal.aborted) return
      const binding = edit?.base.generationSession
      const samePlatform = binding?.platformId === task.platform && !edit?.newSession
      const restore = samePlatform && !this.idle ? await this.restoreUrl(binding!) : undefined
      if (signal.aborted || this.task?.id !== task.id) return
      if (edit && samePlatform && !this.idle && !restore && binding?.conversationUrl === undefined && source.mindmaps.find(map => map.id === task.mindmapId)?.generationSession) throw new Error('原生成网页已释放，且会话地址不可恢复，请勾选“建立新的生成对话继续修改”；完整来源上下文将重新作为附件发送')
      const reused = !!edit && samePlatform && !edit.newSession && (initialized || !!restore)
      let context: MindmapSourceContext | undefined
      if (edit && (!reused || edit.includeSourceContext)) {
        stage = '读取来源主会话上下文'
        context = edit.loadContext ? await waitFor(edit.loadContext(source), 30_000, stage, signal) : { snapshot: source.snapshot, origin: 'snapshot' }
        context = { ...context, snapshot: normalizeMindmapNewlines(context.snapshot) }
        task.contextSource = context.origin
        this.change(task, 'loading')
        if (!context.snapshot.trim()) throw new Error('没有可用的来源会话内容，请打开来源主会话并加载完整对话后重试')
        if (edit.base.candidateMarkdown.length + normalizeMindmapNewlines(additionalRequirements).length + context.snapshot.length > MINDMAP_INPUT_LIMIT) throw new Error('来源上下文、当前导图与修改要求合计超过 60000 字符，请缩小内容；未截断、未发送')
      }
      if (signal.aborted || this.task?.id !== task.id) return
      stage = '准备生成网页'
      const ready = automationService.ensureSessionReady(task.platform, key, restore)
      // 取消可能先于页面创建完成；迟到的加载也必须释放自己的窗口。
      const releaseLateWindow = (): void => {
        if ((signal.aborted || this.task?.id !== task.id || TERMINAL_PHASES.includes(task.phase)) && this.idle?.key !== key) sessionManager.destroySession(key)
      }
      void ready.then(releaseLateWindow, releaseLateWindow)
      const wc = await waitFor(ready, 30_000, stage, signal)
      if (signal.aborted || this.task?.id !== task.id) {
        if (this.idle?.key !== key) sessionManager.destroySession(key)
        return
      }
      this.idle = { key, mapId: task.mindmapId || task.id, platformId: task.platform, initialized }
      this.trackWindow(key)
      wc.setBackgroundThrottling(false)
      const selectors = await waitFor(automationService.getPlatformSelectors(task.platform), 10_000, '读取平台配置', signal)
      const stateScript = generateMindmapPageStateScript(selectors, task.platform)
      const responseScript = generateMindmapResponseScript(selectors, edit ? 'edits' : 'markdown')
      const readyDeadline = Date.now() + 30_000
      while (!signal.aborted) {
        const state = await waitFor(wc.executeJavaScript(stateScript) as Promise<{ ready: boolean; busy: boolean }>, 5_000, '检查网页就绪状态', signal)
        if (state.ready && !state.busy) break
        if (Date.now() > readyDeadline) throw new Error('生成网页未就绪，请打开生成网页检查登录或验证码后重试')
        await delay(500)
      }
      if (signal.aborted) return
      if (edit && samePlatform && (restore || binding?.conversationUrl)) {
        const expected = new URL(restore || binding!.conversationUrl!)
        const actual = new URL(wc.getURL())
        if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search) throw new Error('生成会话未能恢复，请查看网页或建立新的生成对话继续修改')
      }
      // Only newly created generation sessions require an empty conversation.
      stage = '检查空白对话'
      const baseline = await waitFor(wc.executeJavaScript(generateMindmapResponseScript(selectors, edit ? 'edits' : 'markdown', true)) as Promise<MindmapResponse>, 10_000, stage, signal)
      if (!reused && (baseline.messageCount || baseline.text.trim())) throw new Error('平台未进入空白新对话，请打开生成网页检查后重试')
      if (edit) await this.checkBase(edit.base)
      if (signal.aborted) return
      let attachment: { fileName: string; origin: MindmapSourceContext['origin'] } | undefined
      const uploadContext = edit ? context : { snapshot: source.snapshot, origin: 'snapshot' as const }
      if (uploadContext) {
        stage = '上传完整主会话附件'
        if (this.idle?.key === key) this.idle.pendingAttachment = true
        const uploaded = await automationService.uploadMarkdownContext(task.platform, uploadContext.snapshot, key, signal)
        if (signal.aborted || this.task?.id !== task.id) return
        if (!uploaded.success || !uploaded.data) throw new Error(uploaded.error || '主会话附件上传失败，未发送请求')
        attachment = { ...uploaded.data, origin: uploadContext.origin }
        if (edit) await this.checkBase(edit.base)
      }
      if (signal.aborted) return
      let prompt: string
      if (edit) prompt = buildMindmapEditPrompt(edit.base.candidateMarkdown, additionalRequirements, attachment)
      else {
        if (!attachment) throw new Error('来源会话附件缺失，未发送生成请求')
        prompt = buildMindmapPrompt(attachment.fileName, additionalRequirements)
      }
      stage = '发送生成请求'
      const sent = await waitFor(automationService.executeCommand(task.platform, prompt, key, { attachmentFileName: attachment?.fileName, signal }), 30_000, stage, signal)
      if (signal.aborted) return
      if (!sent.success) throw new Error(sent.error || '发送失败，请检查生成网页')
      if (this.idle?.key === key) { this.idle.initialized = true; this.idle.pendingAttachment = false }
      this.change(task, 'generating')
      let lastOutline = ''
      let lastText = ''
      let idleStable = 0
      let lastMessageId = ''
      // 独立于网页脚本执行的总超时，避免停在 await 时永远无法检查截止时间。
      generationTimer = setTimeout(() => {
        const reason = edit ? '未取得可确认的本轮完整 <mindmap_edits> 或 <mindmap_rewrite> 修改回复' : !captured.text.trim() ? '未抓取到 AI 回复' : !captured.text.includes(MINDMAP_TAGS.begin) ? '抓取结果缺少 <mindmap> 开始标签' : !captured.text.includes(MINDMAP_TAGS.end) ? '抓取结果缺少 </mindmap> 闭合标签' : '未取得稳定且可解析的完整大纲'
        this.change(task, 'error', `生成超时：${reason}（${diagnostics()}）。请打开生成网页查看；不会自动重发`)
        controller.abort()
      }, 180_000)
      while (!signal.aborted) {
        stage = '等待读取回复'
        await delay(1500)
        if (signal.aborted) return
        if (wc.isDestroyed()) throw new Error('生成网页已关闭，请重新生成')
        stage = '读取网页回复'
        captured = await waitFor(wc.executeJavaScript(responseScript) as Promise<MindmapResponse>, 10_000, stage, signal)
        const newReply = !!captured.messageId && captured.messageId !== baseline.messageId && (baseline.messageCount === 0 || (captured.messageId.startsWith('stable:') && !baseline.messageIds?.includes(captured.messageId)) || (captured.baselineConnected && captured.messageCount > baseline.messageCount))
        if (!newReply) { stable = 0; continue }
        if (edit) {
          const state = await waitFor(wc.executeJavaScript(stateScript) as Promise<{ busy: boolean }>, 5_000, '读取生成状态', signal)
          pageBusy = state.busy
          stable = !state.busy && captured.text === lastText && captured.messageId === lastMessageId ? stable + 1 : 0
          lastText = captured.text; lastMessageId = captured.messageId || ''
          if (stable < 1) continue
          if (captured.source === 'virtual-dom') throw new Error('无法读取本轮代码框完整文档')
          if ((captured.documentCount ?? captured.editorCount + captured.codeCount) > 1) throw new Error('本轮回复包含多份不同的修改标签结果，无法确定应应用哪一份')
          stage = '校验回复格式'
          if (captured.formatError) throw new Error(captured.formatError)
          if (!captured.text.trim()) throw new Error('未读取到本轮修改回复正文，请打开生成网页检查回复内容')
          stage = '校验修改标签'
          const parsed = parseMindmapModifyResponse(captured.text)
          stage = parsed.kind === 'edits' ? '校验精确替换' : '生成覆写候选'
          const markdown = parsed.kind === 'edits' ? applyMindmapTextEdits(edit.base.candidateMarkdown, parsed.edits) : parsed.markdown
          if (signal.aborted || this.task?.id !== task.id) return
          const generatedBinding = await this.sessionBinding(task.platform, wc.getURL())
          if (signal.aborted || this.task?.id !== task.id) return
          // Persist a successful generation binding without overwriting edits made while waiting.
          const latestSource = await this.notes.get(edit.base.conversationId)
          const latest = latestSource.mindmaps.find(map => map.id === edit.base.mindmapId)
          if (!latest) throw new Error('导图已删除')
          if (latest.updatedAt === edit.base.baseUpdatedAt && normalizeMindmapNewlines(latest.markdown) === edit.base.baseMarkdown && latest.title === edit.base.baseTitle && JSON.stringify(latest.generationSession) !== JSON.stringify(generatedBinding)) {
            const saved = await this.notes.updateMindmap(latestSource.id, latest.id, latest.markdown, latest.title, latest.updatedAt, generatedBinding)
            edit.base = { ...edit.base, baseUpdatedAt: saved.updatedAt }
            task.baseUpdatedAt = saved.updatedAt
            this.notesChanged()
          }
          if (signal.aborted || this.task?.id !== task.id) return
          if (markdown === edit.base.candidateMarkdown) {
            task.outcome = 'unchanged'
            const previous = this.candidates.get(ownerId)?.get(edit.base.mindmapId)
            if (previous) this.candidates.get(ownerId)?.set(previous.mindmapId, { ...previous, baseUpdatedAt: edit.base.baseUpdatedAt, generationSession: generatedBinding })
          } else {
            const candidate: MindmapCandidate = { ...edit.base, id: randomUUID(), candidateMarkdown: markdown, generationSession: generatedBinding }
            const owned = this.candidates.get(ownerId) || new Map<string, MindmapCandidate>()
            owned.set(candidate.mindmapId, candidate)
            this.candidates.set(ownerId, owned)
            task.candidateId = candidate.id
            task.outcome = 'candidate'
          }
          this.change(task, 'done')
          return
        }
        stage = '解析大纲'
        let outline = inspectMindmapOutline(captured.text)
        // 同一条回复的原文和还原结果逐一验证，不能因首个带标签的片段无效而提前失败。
        for (const candidate of captured.candidates || []) {
          if (candidate.source === 'virtual-dom') continue
          const inspected = inspectMindmapOutline(candidate.text)
          if (inspected.status !== 'ready') continue
          captured = { ...captured, text: candidate.text, source: candidate.source }
          outline = inspected
          break
        }
        const response = captured.text
        if (captured.source === 'virtual-dom' || outline.status !== 'ready') {
          stable = 0; lastOutline = ''
          stage = '读取网页生成状态'
          const state = await waitFor(wc.executeJavaScript(stateScript) as Promise<{ busy: boolean }>, 5_000, stage, signal)
          pageBusy = state.busy
          idleStable = response.trim() && !state.busy && response === lastText ? idleStable + 1 : 0
          lastText = response
          if (idleStable >= 2) {
            if (captured.source === 'virtual-dom') throw new Error('检测到虚拟代码框，但无法读取完整文档；可见行不能作为完整大纲保存')
            if (outline.status === 'invalid') throw new Error(`AI 已结束输出，但大纲无法解析：${outline.error}`)
          }
          continue
        }
        // 闭合且可解析的大纲是完成依据；只比较大纲，网页其他文本和忙碌标记不能否决它。
        stable = outline.markdown === lastOutline ? stable + 1 : 0
        lastOutline = outline.markdown
        stage = '等待完整大纲稳定'
        if (stable < 2) continue
        if (signal.aborted) return
        clearTimeout(generationTimer)
        generationTimer = undefined
        stage = '保存导图'
        this.change(task, 'saving')
        const saved = await this.notes.addMindmap(source, outline.markdown, task.platform, await this.sessionBinding(task.platform, wc.getURL()))
        task.conversationId = saved.conversationId
        task.mindmapId = saved.mindmap.id
        this.notesChanged()
        if (signal.aborted || this.task?.id !== task.id) return
        this.change(task, 'done')
        this.idle = { key, mapId: saved.mindmap.id, platformId: task.platform, initialized: true }
        return
      }
    } catch (error) {
      if (!signal.aborted && this.task?.id === task.id) {
        // 初始加载失败时窗口可能已经创建，仍须纳入失败后的查看和释放逻辑。
        if (!this.idle && sessionManager.getSession(key)) {
          this.idle = { key, mapId: task.mindmapId || task.id, platformId: task.platform, initialized }
          this.trackWindow(key)
        }
        this.change(task, 'error', `${error instanceof Error ? error.message : '生成未完成'}（${diagnostics()}）。请打开生成网页查看；不会自动重发`)
      }
    } finally {
      clearTimeout(generationTimer)
      cancelSignal.removeEventListener('abort', abort)
      if (cancelSignal.aborted && this.idle?.key !== key) sessionManager.destroySession(key)
      await this.retainTerminalPage(task, key)
    }
  }

  cancel(id: string, ownerId?: number): void {
    if (ownerId !== undefined && ownerId !== this.ownerId) throw new Error('任务不属于当前窗口')
    if (this.task?.id !== id || TERMINAL_PHASES.includes(this.task.phase)) return
    if (this.task.phase === 'saving') throw new Error('正在保存，请稍候')
    this.controller?.abort()
    this.task.phase = 'cancelled'
    this.notify({ ...this.task })
    const window = this.idle ? sessionManager.getSession(this.idle.key) : undefined
    if (window && this.idle) {
      // 取消后立即释放也保留地址候选；重新打开前由 restoreUrl 严格校验。
      this.lastPage = { taskId: id, key: this.idle.key, mapId: this.idle.mapId, initialized: this.idle.initialized, binding: { platformId: this.task.platform, conversationUrl: window.webContents.getURL() } }
    }
    // 未提交附件时，即使预览可见也销毁，阻止迟到的脚本提交；其他取消只释放隐藏网页。
    if (this.idle?.pendingAttachment || !window?.isVisible()) this.releaseIdle()
    else void this.retainTerminalPage(this.task, this.idle!.key)
  }

  async show(id: string, owner: BrowserWindow | null): Promise<void> {
    if (owner?.webContents.id !== this.ownerId) throw new Error('任务不属于当前窗口')
    if (this.task?.id !== id) throw new Error('任务不存在')
    const task = this.task
    let key = this.idle?.key || sessionKey(id)
    let window = sessionManager.getSession(key)
    if (!window) {
      const page = this.lastPage
      if (page?.taskId !== id) throw new Error('生成网页已释放，未取得可恢复的会话地址，请重新生成或建立新会话')
      const url = await this.restoreUrl(page.binding)
      if (!url) throw new Error('生成网页已释放，原会话没有可恢复地址，请建立新的生成对话继续修改')
      if (this.task?.id !== id || !owner || owner.isDestroyed()) throw new Error('任务已切换或所属窗口已关闭')
      key = page.key
      // 仅恢复网页供查看，不重新注入或提交生成请求。
      window = sessionManager.getOrCreateSession(key, url)
      this.idle = { key, mapId: page.mapId, platformId: page.binding.platformId, initialized: page.initialized }
      this.trackWindow(key)
      window.webContents.setBackgroundThrottling(true)
    }
    this.clearIdleTimer()
    showBackgroundPreview(window, owner, () => this.idle?.key !== key || !this.task || TERMINAL_PHASES.includes(this.task.phase))
    if (TERMINAL_PHASES.includes(task.phase)) window.webContents.setBackgroundThrottling(true)
  }

  shutdown(): void {
    this.controller?.abort()
    this.releaseIdle()
    this.lastPage = null
    if (this.task) sessionManager.destroySession(sessionKey(this.task.id))
    this.candidates.clear()
  }
}
