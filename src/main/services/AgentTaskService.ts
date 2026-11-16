import { randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { BrowserWindow, WebContents } from 'electron'
import {
  AGENT_TASK_DEFAULT_TIMEOUT_MS,
  AGENT_TASK_MAX_TIMEOUT_MS,
  AGENT_TASK_PERSIST_LIMIT,
  AGENT_TASK_PERSIST_TTL_MS,
  AGENT_TASK_QUERY_MAX,
  AGENT_TASK_RESEARCH_TIMEOUT_MS,
  isAgentTaskTerminal,
  type AgentPlatformCapability,
  type AgentTask,
  type AgentTaskError,
  type AgentTaskErrorCode,
  type AgentTaskPhase,
  type AgentTaskResult,
  type AgentTaskSubmitRequest,
  type AgentTaskView
} from '../../shared/types/agentTask'
import { generationStopSelectors } from '../../shared/config/selectors'
import {
  generateEnableDeepResearchScript,
  generateGetLatestResponseScript,
  generateMindmapPageStateScript,
  generateSendMessageScript
} from '../../shared/utils/webviewScripts'
import { canonicalizeConversationUrl, isAuthWallUrl, isConversationUrlForPlatform } from '../../shared/utils/conversationUrl'
import { automationService } from './AutomationService'
import { sessionManager } from './SessionManager'

const POLL_INTERVAL_MS = 1500
const READY_PROBE_DEADLINE_MS = 30_000
const SCRIPT_TIMEOUT_MS = 10_000
const EMPTY_READS_LIMIT = 8

class TaskError extends Error {
  constructor(public readonly code: AgentTaskErrorCode, message: string) {
    super(message)
  }
}

interface TaskEntry extends AgentTask {
  abort: AbortController
  abortReason?: AgentTaskError
  emptyReads: number
  stableCount: number
  authSuspects: number
  execErrors: number
  queueTimer?: ReturnType<typeof setTimeout>
  timeoutTimer?: ReturnType<typeof setTimeout>
  removeCloseListener?: () => void
}

/** taskId 经 randomUUID 生成，文件名仅做存在性拼接。 */
interface PersistedAgentTaskRecord {
  version: 1
  savedAt: number
  taskId: string
  platform: string
  model?: string
  mode: AgentTask['mode']
  phase: AgentTaskPhase
  conversationUrl?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: AgentTaskError
  replyChars: number
  reply?: string
}

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(), ms)
    const aborted = (): void => finish(new Error('任务已中止'))
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (error) reject(error)
      else resolve()
    }
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
  })

/** 限制一次异步操作的等待时间；与 MindmapService.waitFor 同范式。 */
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

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href
  } catch {
    return a === b
  }
}

/**
 * Agent CLI 任务服务：任务注册表 + 状态机 + per-platform FIFO 租约 + 回复轮询 + 结果持久化。
 * 每平台一个后台会话（sessionKey = `__agent_${platform}`），与 UI 共享 persist:shared 登录态。
 */
export class AgentTaskService {
  private tasks = new Map<string, TaskEntry>()
  private queues = new Map<string, string[]>()
  private running = new Map<string, string>()
  private listeners = new Set<() => void>()
  private persistedIndex = new Map<string, PersistedAgentTaskRecord>()
  private persistDir = ''
  private shuttingDown = false

  /** 注入数据根目录（便携版重定向后的 getDataPath()），启动时惰性清理过期记录。 */
  public init(dataPath: string): void {
    this.persistDir = join(dataPath, 'agent-tasks')
    void this.sweepPersisted().catch(err => console.warn('[AgentTask] 持久化目录清理失败:', err))
  }

  // ==================== 对外 API（daemon 调用） ====================

  public async submit(req: AgentTaskSubmitRequest): Promise<{ success: boolean; data?: { taskId: string; phase: AgentTaskPhase; queuedPosition?: number }; error?: string; code?: AgentTaskErrorCode }> {
    try {
      if (this.shuttingDown) throw new TaskError('SESSION_LOST', 'MultiChat 正在退出')
      const platform = typeof req.platform === 'string' ? req.platform.trim() : ''
      if (!platform) throw new TaskError('INVALID_PARAMS', '缺少必填参数 platform')
      if (typeof req.query !== 'string' || !req.query.trim()) throw new TaskError('INVALID_PARAMS', '缺少必填参数 query')
      if (req.query.length > AGENT_TASK_QUERY_MAX) throw new TaskError('INVALID_PARAMS', `query 超过 ${AGENT_TASK_QUERY_MAX} 字符上限`)
      const mode = req.mode === 'deep_research' ? 'deep_research' : 'chat'
      const model = typeof req.model === 'string' && req.model.trim() ? req.model.trim() : undefined

      const defaultTimeout = mode === 'deep_research' ? AGENT_TASK_RESEARCH_TIMEOUT_MS : AGENT_TASK_DEFAULT_TIMEOUT_MS
      const timeoutMs = req.timeoutMs ?? defaultTimeout
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > AGENT_TASK_MAX_TIMEOUT_MS) {
        throw new TaskError('INVALID_PARAMS', `timeoutMs 须在 1000-${AGENT_TASK_MAX_TIMEOUT_MS} 之间`)
      }
      const queueTimeoutMs = req.queueTimeoutMs ?? timeoutMs
      if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 1000) throw new TaskError('INVALID_PARAMS', 'queueTimeoutMs 非法')

      const selectors = await automationService.getPlatformSelectors(platform).catch(() => null)
      if (!selectors) throw new TaskError('PLATFORM_UNKNOWN', `平台未配置选择器: ${platform}`)
      if (mode === 'deep_research' && !selectors.researchMode?.steps?.length && !selectors.researchMode?.button) {
        throw new TaskError('CAPABILITY_UNSUPPORTED', `平台未适配深度研究模式: ${platform}`)
      }

      let followUpUrl: string | undefined
      if (req.conversationUrl !== undefined) {
        if (typeof req.conversationUrl !== 'string') throw new TaskError('INVALID_PARAMS', 'conversationUrl 非法')
        const baseUrl = automationService.getPlatformUrl(platform, selectors)
        if (!isConversationUrlForPlatform(platform, req.conversationUrl, baseUrl)) {
          throw new TaskError('INVALID_PARAMS', `conversationUrl 不是 ${platform} 平台的有效会话地址`)
        }
        followUpUrl = req.conversationUrl
      }

      const sessionKey = `__agent_${platform}`
      const task: TaskEntry = {
        id: randomUUID(),
        platform,
        model,
        mode,
        query: req.query,
        sessionKey,
        followUpUrl,
        phase: 'queued',
        reply: '',
        baseline: '',
        busy: false,
        createdAt: Date.now(),
        timeoutMs,
        queueTimeoutMs,
        abort: new AbortController(),
        emptyReads: 0,
        stableCount: 0,
        authSuspects: 0,
        execErrors: 0
      }
      this.tasks.set(task.id, task)
      const queue = this.queues.get(sessionKey) ?? []
      queue.push(task.id)
      this.queues.set(sessionKey, queue)
      task.queueTimer = setTimeout(() => {
        if (task.phase === 'queued') {
          this.finalize(task, 'failed', { code: 'QUEUE_TIMEOUT', message: `排队超过 ${Math.round(queueTimeoutMs / 1000)}s 未获得平台会话` })
        }
      }, queueTimeoutMs)
      console.log(`[AgentTask] submit taskId=${task.id} platform=${platform} mode=${mode} queryChars=${req.query.length}`)
      this.emit()
      this.pump(sessionKey)
      return { success: true, data: { taskId: task.id, phase: task.phase, queuedPosition: this.queuedPosition(task) } }
    } catch (error) {
      const code = error instanceof TaskError ? error.code : 'INTERNAL'
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message, code }
    }
  }

  /** 任务视图：内存命中优先，miss 时读持久化记录返回历史终态视图。 */
  public async getView(taskId: string): Promise<AgentTaskView | null> {
    const task = this.tasks.get(taskId)
    if (task) return this.toView(task)
    const record = this.persistedIndex.get(taskId) ?? (await this.readPersisted(taskId))
    if (record) return this.persistedToView(record)
    return null
  }

  public async getResult(taskId: string): Promise<AgentTaskResult | null> {
    const task = this.tasks.get(taskId)
    if (task) return this.toResult(task)
    const record = await this.readPersisted(taskId)
    if (!record) return null
    return {
      taskId,
      phase: record.phase,
      ...(record.phase === 'done' && record.reply !== undefined ? { reply: record.reply } : {}),
      ...(record.conversationUrl ? { conversationUrl: record.conversationUrl } : {}),
      ...(record.startedAt !== undefined && record.completedAt !== undefined ? { durationMs: record.completedAt - record.createdAt } : {}),
      ...(record.error ? { error: record.error } : {})
    }
  }

  /** 幂等取消：终态返回当前视图；queued/preparing 直接中止；sending 标记待脚本返回；generating 立即中止轮询。 */
  public async cancel(taskId: string): Promise<AgentTaskView | null> {
    const task = this.tasks.get(taskId)
    if (!task) {
      const record = this.persistedIndex.get(taskId)
      return record ? this.persistedToView(record) : null
    }
    if (isAgentTaskTerminal(task.phase)) return this.toView(task)
    task.cancelRequested = true
    task.abortReason = { code: 'TASK_CANCELLED', message: '任务已被调用方取消' }
    console.log(`[AgentTask] cancel taskId=${task.id} phase=${task.phase}`)
    if (task.phase === 'queued') {
      // 未占用租约：直接落地终态并出队，否则 pump 仍会提取执行
      task.abort.abort()
      this.finalize(task, 'cancelled', task.abortReason)
    } else if (task.phase !== 'sending') {
      // sending 不中断在途页面脚本，由脚本返回后的检查点落地 cancelled
      task.abort.abort()
    }
    return this.toView(task)
  }

  public async list(includeFinished: boolean, platform?: string): Promise<AgentTaskView[]> {
    const views: AgentTaskView[] = []
    for (const task of this.tasks.values()) {
      if (platform && task.platform !== platform) continue
      if (!includeFinished && isAgentTaskTerminal(task.phase)) continue
      views.push(this.toView(task))
    }
    if (includeFinished) {
      for (const record of this.persistedIndex.values()) {
        if (this.tasks.has(record.taskId)) continue
        if (platform && record.platform !== platform) continue
        views.push(this.persistedToView(record))
      }
    }
    views.sort((a, b) => {
      const at = this.sortKey(a)
      const bt = this.sortKey(b)
      return bt - at
    })
    return views
  }

  private sortKey(view: AgentTaskView): number {
    const task = this.tasks.get(view.taskId)
    if (task) return task.createdAt
    return this.persistedIndex.get(view.taskId)?.createdAt ?? 0
  }

  public async capabilities(): Promise<AgentPlatformCapability[]> {
    const ids = await automationService.listPlatformIds()
    const result: AgentPlatformCapability[] = []
    for (const id of ids) {
      const selectors = await automationService.getPlatformSelectors(id).catch(() => null)
      if (!selectors) continue
      result.push({
        id,
        deepResearch: !!(selectors.researchMode?.steps?.length || selectors.researchMode?.button),
        busySignal: generationStopSelectors[id]?.length ? 'adapted' : 'generic',
        followUp: true
      })
    }
    return result
  }

  /** waitMs 长轮询原语：任意任务事件（phase/conversationUrl/queuedPosition 变化）或超时唤醒。 */
  public waitForChange(timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const listener = (): void => {
        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve()
      }
      const timer = setTimeout(listener, Math.max(1, timeoutMs))
      this.listeners.add(listener)
    })
  }

  /** 应用退出：取消运行中任务并把 pending wait 以 SESSION_LOST 唤醒。 */
  public shutdown(): void {
    this.shuttingDown = true
    for (const task of this.tasks.values()) {
      if (isAgentTaskTerminal(task.phase)) continue
      task.abortReason ??= { code: 'SESSION_LOST', message: 'MultiChat 正在退出' }
      task.abort.abort()
      this.finalize(task, 'failed', task.abortReason)
    }
    this.emit()
  }

  // ==================== 队列与租约 ====================

  private queuedPosition(task: TaskEntry): number | undefined {
    if (task.phase !== 'queued') return undefined
    const queue = this.queues.get(task.sessionKey) ?? []
    const index = queue.indexOf(task.id)
    if (index < 0) return undefined
    return index + (this.running.has(task.sessionKey) ? 1 : 0)
  }

  /** 会话空闲时出队队首并执行；同平台互斥、跨平台并行。 */
  private pump(sessionKey: string): void {
    if (this.shuttingDown || this.running.has(sessionKey)) return
    const queue = this.queues.get(sessionKey)
    while (queue && queue.length > 0) {
      const taskId = queue.shift()
      const task = taskId ? this.tasks.get(taskId) : undefined
      if (!task || task.phase !== 'queued') continue
      this.running.set(sessionKey, task.id)
      if (task.queueTimer) {
        clearTimeout(task.queueTimer)
        task.queueTimer = undefined
      }
      task.phase = 'preparing'
      task.startedAt = Date.now()
      task.timeoutTimer = setTimeout(() => {
        task.abortReason = { code: 'TASK_TIMEOUT', message: `任务超过 ${Math.round(task.timeoutMs / 1000)}s 硬超时` }
        task.abort.abort()
      }, task.timeoutMs)
      this.emit()
      void this.execute(task)
      return
    }
  }

  // ==================== 任务执行 ====================

  private async execute(task: TaskEntry): Promise<void> {
    const signal = task.abort.signal
    const sessionKey = task.sessionKey
    let win: BrowserWindow | undefined
    try {
      const selectors = await automationService.getPlatformSelectors(task.platform)
      const baseUrl = automationService.getPlatformUrl(task.platform, selectors)
      const targetUrl = task.followUpUrl || selectors.newConversationUrl || baseUrl

      // 不传 url：避免新窗口内部 fire 一次 loadURL 后又由本层二次导航
      win = sessionManager.getOrCreateSession(sessionKey)
      if (win.isDestroyed()) throw new TaskError('SESSION_LOST', '后台会话窗口已销毁')
      const onClosed = (): void => {
        task.abortReason = { code: 'SESSION_LOST', message: '后台会话窗口中途销毁' }
        task.abort.abort()
      }
      win.once('closed', onClosed)
      task.removeCloseListener = () => win?.removeListener('closed', onClosed)

      const wc = win.webContents
      // 显式导航：同址且加载中则等待既有导航；加载失败统一映射 PAGE_NOT_READY。
      if (!sameUrl(wc.getURL(), targetUrl)) {
        try {
          await waitFor(wc.loadURL(targetUrl), READY_PROBE_DEADLINE_MS, '导航至平台页面', signal)
        } catch (error) {
          if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
          throw new TaskError('PAGE_NOT_READY', `页面加载失败: ${error instanceof Error ? error.message : String(error)}`)
        }
        await delay(1500, signal)
      } else if (wc.isLoading() || wc.isLoadingMainFrame()) {
        await automationService.ensureSessionReady(task.platform, sessionKey)
      }

      // 就绪探针：textarea 可见才算 ready，覆盖未登录/验证码场景
      const stateScript = generateMindmapPageStateScript(selectors, task.platform)
      const readyDeadline = Date.now() + READY_PROBE_DEADLINE_MS
      for (;;) {
        if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
        if (isAuthWallUrl(wc.getURL(), baseUrl)) throw new TaskError('PAGE_NOT_READY', '页面跳转至登录/鉴权页')
        const state = await this.exec<{ ready: boolean; busy: boolean }>(wc, stateScript, '检查网页就绪状态', signal)
        if (state?.ready) break
        if (Date.now() > readyDeadline) throw new TaskError('PAGE_NOT_READY', '页面未就绪（未登录/验证码/加载失败），请检查平台登录态后重试')
        await delay(500, signal)
      }

      // 空白校验 / 追问基线；assistantOnly 过滤用户消息气泡（通用选择器如 .prose 会命中用户消息）
      const replyScript = generateGetLatestResponseScript(selectors, true)
      const baseline = ((await this.exec<string>(wc, replyScript, '采集页面基线', signal)) || '').trim()
      if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
      if (task.followUpUrl) {
        task.baseline = baseline
      } else if (baseline) {
        throw new TaskError('NOT_BLANK_CONVERSATION', '新对话页面仍存在历史消息，请检查平台会话状态')
      }

      if (task.mode === 'deep_research') {
        const enabled = await this.exec<{ success: boolean; error?: string }>(wc, generateEnableDeepResearchScript(selectors.researchMode), '开启深度研究模式', signal)
        if (!enabled?.success) throw new TaskError('PAGE_NOT_READY', `深度研究模式开启失败: ${enabled?.error || '未知原因'}`)
        await delay(500, signal)
      }

      // 发送：agent 任务强制 verifySubmission（确认输入框清空才算提交成功）
      task.phase = 'sending'
      this.emit()
      const sendScript = generateSendMessageScript(task.query, task.platform, selectors, undefined, true)
      const sent = await this.exec<{ success: boolean; error?: string }>(wc, sendScript, '发送消息', signal, 30_000)
      if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
      if (!sent?.success) throw new TaskError('SEND_FAILED', sent?.error || '发送脚本未确认提交')

      task.phase = 'generating'
      this.emit()
      await this.poll(task, wc, stateScript, replyScript, baseUrl, signal)
      if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
      this.finalize(task, 'done')
    } catch (error) {
      if (isAgentTaskTerminal(task.phase)) return
      if (task.abortReason || task.cancelRequested || signal.aborted) return this.settleAborted(task)
      if (error instanceof TaskError) {
        this.finalize(task, 'failed', { code: error.code, message: error.message })
      } else {
        this.finalize(task, 'failed', { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (task.timeoutTimer) {
        clearTimeout(task.timeoutTimer)
        task.timeoutTimer = undefined
      }
      task.removeCloseListener?.()
      task.removeCloseListener = undefined
    }
  }

  private exec<T>(wc: WebContents, script: string, stage: string, signal: AbortSignal, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<T> {
    return waitFor(wc.executeJavaScript(script) as Promise<T>, timeoutMs, stage, signal)
  }

  /** 中止信号落地：按 abortReason 归约为 cancelled / failed，无原因则视为取消。 */
  private settleAborted(task: TaskEntry): void {
    if (isAgentTaskTerminal(task.phase)) return
    const reason = task.abortReason ?? { code: 'TASK_CANCELLED' as const, message: '任务已中止' }
    this.finalize(task, reason.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed', reason)
  }

  /** generating 轮询：停止按钮消失 + 内容稳定 N 轮判定完成。 */
  private async poll(task: TaskEntry, wc: WebContents, stateScript: string, replyScript: string, baseUrl: string, signal: AbortSignal): Promise<void> {
    const isAdapted = !!generationStopSelectors[task.platform]?.length
    const stableThreshold = task.mode === 'chat' && isAdapted ? 3 : 8

    while (!signal.aborted) {
      await delay(POLL_INTERVAL_MS, signal)
      if (signal.aborted) return
      if (wc.isDestroyed() || wc.isCrashed()) throw new TaskError('SESSION_LOST', '后台会话窗口已销毁')
      if (task.cancelRequested) return

      // 单轮脚本失败按空采容错：发送后整页导航/重载会让 executeJavaScript 瞬时 reject
      let state: { ready: boolean; busy: boolean } | undefined
      let text = ''
      try {
        state = await this.exec<{ ready: boolean; busy: boolean }>(wc, stateScript, '读取网页生成状态', signal)
        if (signal.aborted || task.cancelRequested) return
        task.busy = !!state?.busy
        text = ((await this.exec<string>(wc, replyScript, '读取网页回复', signal)) || '').trim()
        if (signal.aborted || task.cancelRequested) return
      } catch (error) {
        if (signal.aborted || task.cancelRequested) return
        if (wc.isDestroyed() || wc.isCrashed()) throw new TaskError('SESSION_LOST', '后台会话窗口已销毁')
        task.execErrors++
        if (task.execErrors >= EMPTY_READS_LIMIT) {
          throw new TaskError('PAGE_NOT_READY', `页面脚本持续不可用（导航/重载中）: ${error instanceof Error ? error.message : String(error)}`)
        }
        task.stableCount = 0
        continue
      }
      task.execErrors = 0

      // 生成期间持续捕获会话地址（部分平台发送后即变，部分首轮结束才变）
      const currentUrl = wc.getURL()
      if (isConversationUrlForPlatform(task.platform, currentUrl, baseUrl)) {
        const canonical = canonicalizeConversationUrl(task.platform, currentUrl)
        if (canonical && canonical !== task.conversationUrl) {
          task.conversationUrl = canonical
          this.emit()
        }
      }
      if (isAuthWallUrl(currentUrl, baseUrl)) {
        if (++task.authSuspects >= 2) throw new TaskError('AUTH_LOST', '生成期间页面跳转至登录/鉴权页')
      } else {
        task.authSuspects = 0
      }

      if (!text || text === task.baseline) {
        task.emptyReads++
        // 空内容不计稳定、不覆盖已采内容；页面持续不就绪且空采则升级为失败
        task.stableCount = 0
        if (state && !state.ready && task.emptyReads >= EMPTY_READS_LIMIT) {
          throw new TaskError('PAGE_NOT_READY', '生成期间持续读取不到就绪页面与回复（可能登录过期/验证码/页面异常）')
        }
      } else if (text !== task.reply) {
        task.reply = text
        task.stableCount = 0
        task.emptyReads = 0
      } else {
        task.emptyReads = 0
        if (!task.busy) task.stableCount++
      }
      if (task.stableCount >= stableThreshold) return
    }
  }

  // ==================== 终态与持久化 ====================

  /** 终态顺序固定：① 写持久化结果 → ② emit（唤醒 wait 订阅）→ ③ 释放租约 + 出队下一个。 */
  private finalize(task: TaskEntry, phase: AgentTaskPhase, error?: AgentTaskError): void {
    if (isAgentTaskTerminal(task.phase)) return
    task.phase = phase
    task.completedAt = Date.now()
    if (error) task.error = error
    if (task.queueTimer) {
      clearTimeout(task.queueTimer)
      task.queueTimer = undefined
    }
    if (task.timeoutTimer) {
      clearTimeout(task.timeoutTimer)
      task.timeoutTimer = undefined
    }
    task.removeCloseListener?.()
    task.removeCloseListener = undefined
    const queue = this.queues.get(task.sessionKey)
    const queueIndex = queue?.indexOf(task.id) ?? -1
    if (queueIndex >= 0) queue!.splice(queueIndex, 1)

    const release = (): void => {
      this.emit()
      if (this.running.get(task.sessionKey) === task.id) {
        this.running.delete(task.sessionKey)
        this.pump(task.sessionKey)
      }
    }
    void this.persist(task)
      .catch(err => console.warn(`[AgentTask] 结果落盘失败 taskId=${task.id}:`, err))
      .finally(release)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 监听器异常不阻断任务推进
      }
    }
  }

  private toView(task: TaskEntry): AgentTaskView {
    return {
      taskId: task.id,
      platform: task.platform,
      ...(task.model ? { model: task.model } : {}),
      mode: task.mode,
      phase: task.phase,
      ...(this.queuedPosition(task) !== undefined ? { queuedPosition: this.queuedPosition(task) } : {}),
      replyChars: task.reply.length,
      busy: task.busy,
      elapsedMs: (task.completedAt ?? Date.now()) - task.createdAt,
      ...(task.conversationUrl || task.followUpUrl ? { conversationUrl: task.conversationUrl ?? task.followUpUrl } : {}),
      ...(task.error ? { error: task.error } : {})
    }
  }

  private toResult(task: TaskEntry): AgentTaskResult {
    return {
      taskId: task.id,
      phase: task.phase,
      ...(task.phase === 'done' ? { reply: task.reply } : {}),
      ...(task.conversationUrl || task.followUpUrl ? { conversationUrl: task.conversationUrl ?? task.followUpUrl } : {}),
      ...(task.completedAt !== undefined ? { durationMs: task.completedAt - task.createdAt } : {}),
      ...(task.error ? { error: task.error } : {})
    }
  }

  private persistedToView(record: PersistedAgentTaskRecord): AgentTaskView {
    return {
      taskId: record.taskId,
      platform: record.platform,
      ...(record.model ? { model: record.model } : {}),
      mode: record.mode,
      phase: record.phase,
      replyChars: record.replyChars,
      busy: false,
      elapsedMs: (record.completedAt ?? record.savedAt) - record.createdAt,
      ...(record.conversationUrl ? { conversationUrl: record.conversationUrl } : {}),
      ...(record.error ? { error: record.error } : {})
    }
  }

  // ==================== 磁盘持久化 ====================

  private async persist(task: TaskEntry): Promise<void> {
    if (!this.persistDir) return
    const record: PersistedAgentTaskRecord = {
      version: 1,
      savedAt: Date.now(),
      taskId: task.id,
      platform: task.platform,
      ...(task.model ? { model: task.model } : {}),
      mode: task.mode,
      phase: task.phase,
      ...(task.conversationUrl || task.followUpUrl ? { conversationUrl: task.conversationUrl ?? task.followUpUrl } : {}),
      createdAt: task.createdAt,
      ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
      ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
      ...(task.error ? { error: task.error } : {}),
      replyChars: task.reply.length,
      ...(task.phase === 'done' ? { reply: task.reply } : {})
    }
    await mkdir(this.persistDir, { recursive: true })
    const target = join(this.persistDir, `${task.id}.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(record), 'utf8')
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    this.persistedIndex.set(task.id, record)
  }

  private async readPersisted(taskId: string): Promise<PersistedAgentTaskRecord | null> {
    // taskId 来自外部请求，限制字符集防路径穿越
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId)) return null
    if (!this.persistDir) return this.persistedIndex.get(taskId) ?? null
    try {
      const raw = await readFile(join(this.persistDir, `${taskId}.json`), 'utf8')
      const record = JSON.parse(raw) as PersistedAgentTaskRecord
      if (record?.version !== 1 || record.taskId !== taskId) return null
      this.persistedIndex.set(taskId, record)
      return record
    } catch {
      return null
    }
  }

  /** 启动惰性清理：加载索引 + 删除过期/超量记录（最多 200 条或 7 天）。 */
  private async sweepPersisted(): Promise<void> {
    await mkdir(this.persistDir, { recursive: true })
    const entries = await readdir(this.persistDir, { withFileTypes: true })
    const now = Date.now()
    const records: PersistedAgentTaskRecord[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const record = JSON.parse(await readFile(join(this.persistDir, entry.name), 'utf8')) as PersistedAgentTaskRecord
        if (record?.version !== 1 || typeof record.taskId !== 'string' || now - record.savedAt > AGENT_TASK_PERSIST_TTL_MS) {
          await rm(join(this.persistDir, entry.name), { force: true }).catch(() => undefined)
          continue
        }
        records.push(record)
      } catch {
        await rm(join(this.persistDir, entry.name), { force: true }).catch(() => undefined)
      }
    }
    records.sort((a, b) => b.savedAt - a.savedAt)
    for (const overflow of records.slice(AGENT_TASK_PERSIST_LIMIT)) {
      await rm(join(this.persistDir, `${overflow.taskId}.json`), { force: true }).catch(() => undefined)
    }
    for (const record of records.slice(0, AGENT_TASK_PERSIST_LIMIT)) {
      this.persistedIndex.set(record.taskId, record)
    }
  }
}

export const agentTaskService = new AgentTaskService()
