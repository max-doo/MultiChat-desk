import { randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, isAbsolute, join, sep } from 'path'
import type { BrowserWindow, WebContents } from 'electron'
import {
  AGENT_TASK_DEFAULT_TIMEOUT_MS,
  AGENT_TASK_IMAGE_MAX,
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
import { authWallSelectors, generationStopSelectors, loginRequiredPlatforms } from '../../shared/config/selectors'
import {
  generateEnableDeepResearchScript,
  generateEnableImageGenerationScript,
  generateClickDownloadButtonsScript,
  generateExtractImagesScript,
  generateGetLatestResponseScript,
  generateMindmapPageStateScript,
  generateSendMessageScript
} from '../../shared/utils/webviewScripts'
import { canonicalizeConversationUrl, isAuthWallUrl, isConversationUrlForPlatform } from '../../shared/utils/conversationUrl'
import { automationService } from './AutomationService'
import { authStateService, type PlatformAuthState } from './AuthStateService'
import { sessionManager } from './SessionManager'
import { registerAgentImageDownload, awaitImageDownloadResult } from './ImageDownloadService'

const POLL_INTERVAL_MS = 1500
const READY_PROBE_DEADLINE_MS = 30_000
const SCRIPT_TIMEOUT_MS = 10_000
const EMPTY_READS_LIMIT = 8
/** 任务结束且无新排队任务后，无头浏览器窗口的空闲保活时间（3 分钟后销毁回收内存） */
const IDLE_SESSION_TIMEOUT_MS = 3 * 60_000
/** 内存中保留的终态任务与索引上限 */
const MAX_IN_MEMORY_TERMINAL_TASKS = 100
/** 内存中保留完整 reply 正文的最近终态任务数；更早任务按需从磁盘回读 */
const INLINE_REPLY_KEEP_RECENT = 10

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
  replyChars?: number
  replyStripped?: boolean
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
  genImage?: boolean
  phase: AgentTaskPhase
  conversationUrl?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: AgentTaskError
  replyChars: number
  reply?: string
  replyFile?: string
  imageFiles?: string[]
  imageError?: string
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
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private listeners = new Set<() => void>()
  private persistedIndex = new Map<string, PersistedAgentTaskRecord>()
  private persistDir = ''
  private imageDir = ''
  private resultsDir = ''
  private shuttingDown = false

  /** 注入数据根目录（便携版重定向后的 getDataPath()），启动时惰性清理过期记录。 */
  public init(dataPath: string): void {
    this.persistDir = join(dataPath, 'agent-tasks')
    this.imageDir = join(dataPath, '.multichat', 'image')
    this.resultsDir = join(dataPath, '.multichat', 'task-results')
    void this.migrateLegacyResultsDir(dataPath).catch(err => console.warn('[AgentTask] 旧产物目录迁移失败:', err))
    void this.sweepPersisted().catch(err => console.warn('[AgentTask] 持久化目录清理失败:', err))
  }

  /** results/ → task-results/ 一次性迁移：搬移旧 TXT 并把 agent-tasks JSON 里的 replyFile 路径同步改写。 */
  private async migrateLegacyResultsDir(dataPath: string): Promise<void> {
    const legacyDir = join(dataPath, '.multichat', 'results')
    if (legacyDir === this.resultsDir) return
    const legacyPrefix = legacyDir + sep
    const files = await readdir(legacyDir).catch(() => [] as string[])
    if (files.length > 0) {
      await mkdir(this.resultsDir, { recursive: true })
      for (const name of files) {
        await rename(join(legacyDir, name), join(this.resultsDir, name)).catch(() => undefined)
      }
    }
    await rm(legacyDir, { recursive: true, force: true }).catch(() => undefined)
    const jsonEntries = await readdir(this.persistDir).catch(() => [] as string[])
    for (const name of jsonEntries) {
      if (!name.endsWith('.json')) continue
      const file = join(this.persistDir, name)
      try {
        const raw = await readFile(file, 'utf8')
        const record = JSON.parse(raw) as PersistedAgentTaskRecord
        if (!record.replyFile?.startsWith(legacyPrefix)) continue
        record.replyFile = join(this.resultsDir, basename(record.replyFile))
        const temporary = `${file}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(record), 'utf8')
        await rename(temporary, file)
      } catch {
        // 单条损坏/无权限不影响其余迁移；sweep 会兜底清理坏文件
      }
    }
  }

  /** 产物目录：优先任务级 artifactDir（CLI 传项目 cwd），回退应用数据目录。 */
  private artifactDirs(task: TaskEntry): { imageDir: string; resultsDir: string } {
    const base = task.artifactDir && isAbsolute(task.artifactDir) ? task.artifactDir : ''
    return {
      imageDir: base ? join(base, 'image') : this.imageDir,
      resultsDir: base ? join(base, 'task-results') : this.resultsDir
    }
  }

  // ==================== 对外 API（daemon 调用） ====================

  public async submit(req: AgentTaskSubmitRequest): Promise<{ success: boolean; data?: { taskId: string; phase: AgentTaskPhase; queuedPosition?: number }; error?: string; code?: AgentTaskErrorCode }> {
    try {
      if (this.shuttingDown) throw new TaskError('SESSION_LOST', 'MultiChat 正在退出')
      const platform = typeof req.platform === 'string' ? req.platform.trim() : ''
      if (!platform) throw new TaskError('INVALID_PARAMS', '缺少必填参数 platform')
      if (req.query !== undefined && typeof req.query !== 'string') throw new TaskError('INVALID_PARAMS', 'query 非法')
      const query = typeof req.query === 'string' ? req.query : ''
      if (query.length > AGENT_TASK_QUERY_MAX) throw new TaskError('INVALID_PARAMS', `query 超过 ${AGENT_TASK_QUERY_MAX} 字符上限`)

      const images = Array.isArray(req.images) ? req.images.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : []
      if (images.length > AGENT_TASK_IMAGE_MAX) throw new TaskError('INVALID_PARAMS', `images 超过 ${AGENT_TASK_IMAGE_MAX} 张上限`)
      for (const imagePath of images) {
        if (!isAbsolute(imagePath)) throw new TaskError('INVALID_PARAMS', `图片路径须为绝对路径: ${imagePath}`)
        const info = await stat(imagePath).catch(() => null)
        if (!info?.isFile()) throw new TaskError('INVALID_PARAMS', `图片文件不存在: ${imagePath}`)
      }
      if (!query.trim() && images.length === 0) throw new TaskError('INVALID_PARAMS', '缺少必填参数 query 或 images（至少一项）')
      const mode = req.mode === 'deep_research' ? 'deep_research' : 'chat'
      const genImage = req.genImage === true
      const model = typeof req.model === 'string' && req.model.trim() ? req.model.trim() : undefined

      if (genImage && mode === 'deep_research') {
        throw new TaskError('INVALID_PARAMS', '--gen-image 与 --research 不能同时使用')
      }

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
      if (genImage && !selectors.imageDownload?.steps?.length) {
        throw new TaskError('CAPABILITY_UNSUPPORTED', `平台未适配生图下载链路（imageDownload 未配置）: ${platform}`)
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

      // 登录门槛平台在入队前用 cookie 快速失败：明确未登录时不必排队等页面探测。
      // 判定为"未知"（平台未收录名单）不拦，交由页面侧检测兜底，避免误杀。
      if (loginRequiredPlatforms.includes(platform)) {
        const auth = await authStateService.getState(platform, automationService.getPlatformUrl(platform, selectors))
        if (auth.signedIn === false) {
          throw new TaskError('AUTH_REQUIRED', `${platform} 需要登录后才能使用（当前为游客状态），请在应用内完成登录后重试`)
        }
      }

      const sessionKey = `__agent_${platform}`
      if (req.idempotencyKey) {
        // 幂等去重：同平台同键的内存任务（含已完成的内存视图）直接复用原 taskId，
        // 根治调用方被杀后盲重投导致的同平台 FIFO 重复排队；跨重启不保证（不落盘）。
        for (const existing of this.tasks.values()) {
          if (existing.idempotencyKey === req.idempotencyKey && existing.sessionKey === sessionKey) {
            console.log(`[AgentTask] idempotent hit taskId=${existing.id} key=${req.idempotencyKey}`)
            return { success: true, data: { taskId: existing.id, phase: existing.phase, queuedPosition: this.queuedPosition(existing) } }
          }
        }
      }
      const task: TaskEntry = {
        id: randomUUID(),
        platform,
        model,
        mode,
        genImage,
        query,
        ...(images.length ? { images } : {}),
        sessionKey,
        idempotencyKey: req.idempotencyKey,
        followUpUrl,
        ...(typeof req.artifactDir === 'string' && req.artifactDir.trim() && isAbsolute(req.artifactDir) ? { artifactDir: req.artifactDir } : {}),
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
      console.log(`[AgentTask] submit taskId=${task.id} platform=${platform} mode=${mode} queryChars=${query.length}${images.length ? ` images=${images.length}` : ''}`)
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
    if (task) {
      if (task.phase === 'done' && task.replyStripped) {
        const record = await this.readPersisted(taskId)
        if (record) {
          return {
            taskId,
            phase: record.phase,
            ...(record.reply !== undefined ? { reply: record.reply } : {}),
            ...(record.replyFile ? { replyFile: record.replyFile } : {}),
            ...(record.imageFiles?.length ? { imageFiles: record.imageFiles } : {}),
            ...(record.imageError ? { imageError: record.imageError } : {}),
            ...(record.conversationUrl ? { conversationUrl: record.conversationUrl } : {}),
            ...(record.startedAt !== undefined && record.completedAt !== undefined ? { durationMs: record.completedAt - record.createdAt } : {}),
            ...(record.error ? { error: record.error } : {})
          }
        }
      }
      return this.toResult(task)
    }
    const record = await this.readPersisted(taskId)
    if (!record) return null
    return {
      taskId,
      phase: record.phase,
      ...(record.phase === 'done' && record.reply !== undefined ? { reply: record.reply } : {}),
      ...(record.replyFile ? { replyFile: record.replyFile } : {}),
      ...(record.imageFiles?.length ? { imageFiles: record.imageFiles } : {}),
      ...(record.imageError ? { imageError: record.imageError } : {}),
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
      const baseUrl = automationService.getPlatformUrl(id, selectors)
      // 能力表是高频列举接口，不为读 localStorage 触发整页加载：只读 cookie 与已打开页面，
      // 凭证只在 localStorage 且页面未打开的平台（如 kimi）此处返回未知，精确结果用 `auth.status`。
      const auth = await authStateService.getState(id, baseUrl).catch(() => ({ platform: id } as PlatformAuthState))
      result.push({
        id,
        deepResearch: !!(selectors.researchMode?.steps?.length || selectors.researchMode?.button),
        imageGeneration: !!selectors.imageGeneration?.steps?.length,
        imageDownload: !!selectors.imageDownload?.steps?.length,
        busySignal: generationStopSelectors[id]?.length ? 'adapted' : 'generic',
        followUp: true,
        ...(auth.signedIn !== undefined ? { signedIn: auth.signedIn } : {}),
        loginRequired: loginRequiredPlatforms.includes(id)
      })
    }
    return result
  }

  /** `auth.status`：按平台返回 cookie 判定的登录态；不传 platform 时返回全部平台。 */
  public async authStates(platform?: string): Promise<{
    success: boolean
    data?: Array<{ platform: string; signedIn?: boolean; matchedCookie?: string; loginRequired: boolean }>
    error?: string
    code?: AgentTaskErrorCode
  }> {
    try {
      const ids = platform ? [platform] : await automationService.listPlatformIds()
      const rows: Array<{ platform: string; signedIn?: boolean; matchedCookie?: string; loginRequired: boolean }> = []
      for (const id of ids) {
        const selectors = await automationService.getPlatformSelectors(id).catch(() => null)
        if (!selectors) {
          if (platform) throw new TaskError('PLATFORM_UNKNOWN', `平台未配置选择器: ${id}`)
          continue
        }
        const baseUrl = automationService.getPlatformUrl(id, selectors)
        // 显式查询登录态：允许临时加载站点读取 localStorage（Kimi 等凭证不在 cookie）。
        const auth = await authStateService.getState(id, baseUrl, { allowPageLoad: true })
        rows.push({
          platform: id,
          ...(auth.signedIn !== undefined ? { signedIn: auth.signedIn } : {}),
          ...(auth.matchedCookie ? { matchedCookie: auth.matchedCookie } : {}),
          loginRequired: loginRequiredPlatforms.includes(id)
        })
      }
      return { success: true, data: rows }
    } catch (error) {
      const code = error instanceof TaskError ? error.code : 'INTERNAL'
      return { success: false, error: error instanceof Error ? error.message : String(error), code }
    }
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
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer)
    }
    this.idleTimers.clear()
    for (const task of this.tasks.values()) {
      if (isAgentTaskTerminal(task.phase)) continue
      task.abortReason ??= { code: 'SESSION_LOST', message: 'MultiChat 正在退出' }
      task.abort.abort()
      this.finalize(task, 'failed', task.abortReason)
    }
    this.emit()
  }

  private clearIdleTimer(sessionKey: string): void {
    const timer = this.idleTimers.get(sessionKey)
    if (timer) {
      clearTimeout(timer)
      this.idleTimers.delete(sessionKey)
    }
  }

  private scheduleIdleRelease(sessionKey: string): void {
    this.clearIdleTimer(sessionKey)
    if (this.shuttingDown || this.running.has(sessionKey)) return
    if ((this.queues.get(sessionKey)?.length ?? 0) > 0) return
    const timer = setTimeout(() => {
      this.idleTimers.delete(sessionKey)
      if (this.shuttingDown || this.running.has(sessionKey)) return
      if ((this.queues.get(sessionKey)?.length ?? 0) > 0) return
      if (sessionManager.destroySession(sessionKey)) {
        console.log(`[AgentTask] 释放空闲无头会话窗口: ${sessionKey}`)
      }
    }, IDLE_SESSION_TIMEOUT_MS)
    this.idleTimers.set(sessionKey, timer)
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
      this.clearIdleTimer(sessionKey)
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
      const stateScript = generateMindmapPageStateScript(selectors, task.platform, authWallSelectors)
      const readyDeadline = Date.now() + READY_PROBE_DEADLINE_MS
      let authHits = 0
      for (;;) {
        if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
        if (isAuthWallUrl(wc.getURL(), baseUrl)) throw new TaskError('AUTH_REQUIRED', '页面跳转至登录/鉴权页，请在应用内完成登录后重试')
        // 页面水合/重定向期间脚本可能瞬时不可用，按空采继续轮询而不是直接 INTERNAL
        const state = await this.exec<{ ready: boolean; busy: boolean; authWall?: boolean; authStrong?: boolean }>(wc, stateScript, '检查网页就绪状态', signal).catch(() => null)
        // 只有强信号（人机验证/密码框）可提前判墙；页内"登录"按钮不能作判据——
        // gemini/doubao 等游客可用平台也常驻该入口，提前判会误伤。
        authHits = state?.authStrong ? authHits + 1 : 0
        if (authHits >= 2) throw new TaskError('AUTH_REQUIRED', '平台页面处于未登录/人机验证状态，请在应用内完成登录后重试')
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

      // 生图任务需先开启平台生图模式，否则附件/提示词不会进入图生图流程。
      // imageGeneration.steps 未配置的平台（如 kimi 已下架）跳过，由后续下载捕获兜底报错。
      if (task.genImage && selectors.imageGeneration?.steps?.length) {
        const enabled = await this.exec<{ success: boolean; error?: string }>(wc, generateEnableImageGenerationScript(selectors.imageGeneration), '开启生图模式', signal)
        if (!enabled?.success) throw new TaskError('PAGE_NOT_READY', `生图模式开启失败: ${enabled?.error || '未知原因'}`)
        await delay(500, signal)
      }

      // 附件仍在 preparing 阶段上传：cancel 对 sending 不中止在途脚本，
      // 提前上传可让取消请求经 abort 信号及时打断逐张拖拽轮询。
      let attachmentFileName: string | undefined
      if (task.images?.length) {
        const uploaded = await automationService.uploadAttachments(task.platform, task.images, sessionKey, signal)
        if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
        if (!uploaded.success || !uploaded.data?.fileNames.length) {
          throw new TaskError('SEND_FAILED', uploaded.error || '图片附件上传失败')
        }
        attachmentFileName = uploaded.data.fileNames[uploaded.data.fileNames.length - 1]
      }

      // 发送：agent 任务强制 verifySubmission（确认输入框清空才算提交成功）
      task.phase = 'sending'
      this.emit()
      const sendScript = generateSendMessageScript(task.query, task.platform, selectors, attachmentFileName, true)
      const sent = await this.exec<{ success: boolean; error?: string }>(wc, sendScript, '发送消息', signal, 30_000)
      if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
      if (!sent?.success) {
        // 发送失败时才用"页内登录入口"归因：未登录页输入框照常渲染，只有走到提交才暴露；
        // 放在这里可避免误伤游客可用平台（它们同样常驻登录入口但能正常发送）。
        const probe = await this.exec<{ authWall?: boolean }>(wc, stateScript, '确认发送失败原因', signal).catch(() => null)
        if (probe?.authWall) throw new TaskError('AUTH_REQUIRED', '平台要求登录后才能发送，请在应用内完成登录后重试')
        throw new TaskError('SEND_FAILED', sent?.error || '发送脚本未确认提交')
      }

      task.phase = 'generating'
      this.emit()
      await this.poll(task, wc, stateScript, replyScript, baseUrl, signal, selectors)
      if (signal.aborted || task.cancelRequested) return this.settleAborted(task)

      if (task.genImage) {
        await this.captureGeneratedImage(task, wc, selectors, signal)
        if (signal.aborted || task.cancelRequested) return this.settleAborted(task)
      }

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

  /** 生图产物抓取：等图片挂载 → 注册 will-download 上下文 → 注入点击 → 等落盘 → best-effort 关闭生图模式。 */
  private async captureGeneratedImage(task: TaskEntry, wc: WebContents, selectors: Awaited<ReturnType<typeof automationService.getPlatformSelectors>>, signal: AbortSignal): Promise<void> {
    try {
      // 图片 DOM 常晚于文本稳定数十秒才挂载（豆包实测 30-90s）。
      // 探针用 generateExtractImagesScript(genImageOnly=true)：只认生图专用容器内 img/canvas/a[download]/blob，
      // 返回真实图片数量——比"下载按钮存在"更可靠（yiyan 的 cos-icon-download 恒在会误判）。
      // genImageOnly 避免把用户上传附件的回显缩略图当成"已生成"产物。
      const probeScript = generateExtractImagesScript(selectors, true)
      let hasImage = false
      let lastSel = ''
      const imgDeadline = Date.now() + 120_000
      while (Date.now() < imgDeadline) {
        if (signal.aborted || task.cancelRequested) return
        const res = await this.exec<{ success: boolean; images?: Array<{ src: string }>; containerSel?: string }>(wc, probeScript, '探测最新生图', signal).catch(() => null)
        if (res?.containerSel) lastSel = res.containerSel
        if (res?.success && res.images?.length) {
          hasImage = true
          break
        }
        await delay(1500, signal)
      }
      if (!hasImage) {
        task.imageError = `生成超时未检测到图片（containerSel=${lastSel || 'none'}）`
        return
      }
      const dirs = this.artifactDirs(task)
      if (!dirs.imageDir) {
        task.imageError = '生图目录未初始化'
        return
      }
      await registerAgentImageDownload(wc.id, {
        platform: task.platform,
        taskId: task.id,
        dir: dirs.imageDir,
        expectedFromClick: 1
      })
      const click = await this.exec<{ clicked?: number; error?: string }>(wc, generateClickDownloadButtonsScript(selectors), '触发生图下载', signal, 15_000)
      if (click?.clicked) {
        const result = await awaitImageDownloadResult(wc.id)
        if (result.savedPaths.length) {
          task.imageFiles = result.savedPaths
          return
        }
        // 点击已发生但下载没落盘 → 走兜底直存
        console.warn(`[AgentTask] click-download miss taskId=${task.id} errors=${result.errors.join(';')}, fallback to extract`)
      } else {
        console.warn(`[AgentTask] click-download failed taskId=${task.id} err=${click?.error || '未命中'}, fallback to extract`)
      }

      // 兜底：把 extract 返回的 src 列表直接落盘（data:/blob: 直接写文件；http(s): 走 downloadURL）。
      // qwen 的 imageDownload.steps[0] 是 imageItem- 容器选择器，DOM 改版后 hover 不命中即走这里。
      const extracted = await this.exec<{ success: boolean; images?: Array<{ src: string; mime?: string }> }>(wc, probeScript, '兜底提取生图', signal).catch(() => null)
      const srcs = (extracted?.images ?? []).map(i => i.src).filter(Boolean).slice(0, 4)
      if (!srcs.length) {
        task.imageError = click?.error || '生图元素未命中且兜底提取为空'
        return
      }
      const savedPaths: string[] = []
      const errors: string[] = []
      for (let idx = 0; idx < srcs.length; idx++) {
        const src = srcs[idx]
        try {
          const saved = await this.saveExtractedImage(wc, task, src, dirs.imageDir, `${task.platform}-${task.id.slice(0, 8)}-${idx + 1}`)
          if (saved) savedPaths.push(saved)
          else errors.push(`图 ${idx + 1}: 保存失败`)
        } catch (err) {
          errors.push(`图 ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (savedPaths.length) task.imageFiles = savedPaths
      if (errors.length && !savedPaths.length) {
        task.imageError = errors.join('; ')
      }
    } catch (error) {
      if (signal.aborted || task.cancelRequested) throw error
      task.imageError = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 兜底落盘单个图。data: → Buffer 写文件；blob:/http(s): → webContents.downloadURL + will-download ctx。
   * 返回保存的绝对路径；失败返回 null。
   */
  private async saveExtractedImage(wc: WebContents, task: TaskEntry, src: string, dir: string, fileBase: string): Promise<string | null> {
    if (/^data:/.test(src)) {
      const m = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s)
      if (!m) return null
      const mime = m[1].toLowerCase()
      const ext = mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
      const file = join(dir, `${fileBase}.${ext}`)
      await mkdir(dir, { recursive: true })
      await writeFile(file, Buffer.from(m[2], 'base64'))
      return file
    }
    if (/^blob:|^https?:/.test(src)) {
      await registerAgentImageDownload(wc.id, {
        platform: task.platform,
        taskId: task.id,
        dir,
        expectedFromClick: 1,
        filePrefix: fileBase
      })
      wc.downloadURL(src)
      const res = await awaitImageDownloadResult(wc.id)
      return res.savedPaths[0] ?? null
    }
    return null
  }

  /** 中止信号落地：按 abortReason 归约为 cancelled / failed，无原因则视为取消。 */
  private settleAborted(task: TaskEntry): void {
    if (isAgentTaskTerminal(task.phase)) return
    const reason = task.abortReason ?? { code: 'TASK_CANCELLED' as const, message: '任务已中止' }
    this.finalize(task, reason.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed', reason)
  }

  /** generating 轮询：停止按钮消失 + 内容稳定 N 轮判定完成。生图任务额外把"图片元素已挂载"作为内容信号——纯图片回复无 markdown 文本时 text 恒空。 */
  private async poll(task: TaskEntry, wc: WebContents, stateScript: string, replyScript: string, baseUrl: string, signal: AbortSignal, selectors?: Awaited<ReturnType<typeof automationService.getPlatformSelectors>>): Promise<void> {
    const isAdapted = !!generationStopSelectors[task.platform]?.length
    const stableThreshold = task.mode === 'chat' && isAdapted ? 3 : 8
    // 生图任务：图片探针用 extractImages(genImageOnly=true，只认生图容器内 img/canvas），
    // 不用 imageDownload.steps[0]——它是"下载按钮"不是图片元素，yiyan 等平台会误判。
    const imageProbe = task.genImage && selectors ? generateExtractImagesScript(selectors, true) : ''

    while (!signal.aborted) {
      await delay(POLL_INTERVAL_MS, signal)
      if (signal.aborted) return
      if (wc.isDestroyed() || wc.isCrashed()) throw new TaskError('SESSION_LOST', '后台会话窗口已销毁')
      if (task.cancelRequested) return

      // 单轮脚本失败按空采容错：发送后整页导航/重载会让 executeJavaScript 瞬时 reject
      let state: { ready: boolean; busy: boolean; authWall?: boolean; authStrong?: boolean } | undefined
      let text = ''
      try {
        state = await this.exec<{ ready: boolean; busy: boolean; authWall?: boolean; authStrong?: boolean }>(wc, stateScript, '读取网页生成状态', signal)
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
      } else if (state?.authStrong) {
        // 生成中掉登录常以页面内弹窗形式出现，URL 不变；只信强信号，弱信号在生成期噪声大
        if (++task.authSuspects >= 2) throw new TaskError('AUTH_LOST', '生成期间页面出现登录/人机验证墙')
      } else {
        task.authSuspects = 0
      }

      let imageReady = false
      if (task.genImage && imageProbe) {
        try {
          const res = await this.exec<{ success: boolean; images?: Array<{ src: string }> }>(wc, imageProbe, '探测生图元素', signal)
          imageReady = !!(res?.success && res.images?.length)
        } catch { imageReady = false }
      }

      if (imageReady && !task.busy) {
        // 图片已挂载且生成停止：无论 markdown 文本是否采到，都计入稳定
        task.emptyReads = 0
        task.stableCount++
      } else if (!text || text === task.baseline) {
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
      if (!this.running.has(task.sessionKey) && (this.queues.get(task.sessionKey)?.length ?? 0) === 0) {
        this.scheduleIdleRelease(task.sessionKey)
      }
    }
    task.replyChars = task.reply.length
    task.baseline = ''
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
      replyChars: task.replyChars ?? task.reply.length,
      busy: task.busy,
      elapsedMs: (task.completedAt ?? Date.now()) - task.createdAt,
      ...(task.conversationUrl || task.followUpUrl ? { conversationUrl: task.conversationUrl ?? task.followUpUrl } : {}),
      ...(task.replyFile ? { replyFile: task.replyFile } : {}),
      ...(task.imageFiles?.length ? { imageFiles: task.imageFiles } : {}),
      ...(task.imageError ? { imageError: task.imageError } : {}),
      ...(task.error ? { error: task.error } : {})
    }
  }

  private toResult(task: TaskEntry): AgentTaskResult {
    return {
      taskId: task.id,
      phase: task.phase,
      ...(task.phase === 'done' ? { reply: task.reply } : {}),
      ...(task.phase === 'done' && task.replyFile ? { replyFile: task.replyFile } : {}),
      ...(task.phase === 'done' && task.imageFiles?.length ? { imageFiles: task.imageFiles } : {}),
      ...(task.phase === 'done' && task.imageError ? { imageError: task.imageError } : {}),
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
      ...(record.replyFile ? { replyFile: record.replyFile } : {}),
      ...(record.imageFiles?.length ? { imageFiles: record.imageFiles } : {}),
      ...(record.imageError ? { imageError: record.imageError } : {}),
      ...(record.error ? { error: record.error } : {})
    }
  }

  // ==================== 磁盘持久化 ====================

  private async persist(task: TaskEntry): Promise<void> {
    if (!this.persistDir) return
    // 先写 TXT（done 态即落盘，即便 reply 为空也保留占位文件），拿路径后再一次性构造 record 写 JSON
    let replyFile: string | undefined
    const dirs = this.artifactDirs(task)
    if (task.phase === 'done' && dirs.resultsDir) {
      try {
        await mkdir(dirs.resultsDir, { recursive: true })
        const file = join(dirs.resultsDir, `${task.platform}-${task.id.slice(0, 8)}.txt`)
        await writeFile(file, task.reply ?? '', 'utf8')
        replyFile = file
        task.replyFile = file
      } catch (err) {
        console.warn(`[AgentTask] replyFile 落盘失败 taskId=${task.id}:`, err)
      }
    }
    const record: PersistedAgentTaskRecord = {
      version: 1,
      savedAt: Date.now(),
      taskId: task.id,
      platform: task.platform,
      ...(task.model ? { model: task.model } : {}),
      mode: task.mode,
      ...(task.genImage ? { genImage: true } : {}),
      phase: task.phase,
      ...(task.conversationUrl || task.followUpUrl ? { conversationUrl: task.conversationUrl ?? task.followUpUrl } : {}),
      createdAt: task.createdAt,
      ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
      ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
      ...(task.error ? { error: task.error } : {}),
      replyChars: task.reply.length,
      ...(task.phase === 'done' ? { reply: task.reply } : {}),
      ...(replyFile ? { replyFile } : {}),
      ...(task.imageFiles?.length ? { imageFiles: task.imageFiles } : {}),
      ...(task.imageError ? { imageError: task.imageError } : {})
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
    this.persistedIndex.set(task.id, this.stripPersistedReply(record))
    this.pruneInMemoryTerminalTasks()
  }

  private stripPersistedReply(record: PersistedAgentTaskRecord): PersistedAgentTaskRecord {
    if (record.reply === undefined) return record
    const { reply: _reply, ...summary } = record
    return summary
  }

  private pruneInMemoryTerminalTasks(): void {
    const terminalTasks: TaskEntry[] = []
    for (const entry of this.tasks.values()) {
      if (isAgentTaskTerminal(entry.phase)) {
        terminalTasks.push(entry)
      }
    }
    if (terminalTasks.length > INLINE_REPLY_KEEP_RECENT) {
      terminalTasks.sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))
      for (let i = INLINE_REPLY_KEEP_RECENT; i < terminalTasks.length; i++) {
        const entry = terminalTasks[i]
        if (entry.reply && this.persistedIndex.has(entry.id)) {
          entry.replyChars = entry.reply.length
          entry.reply = ''
          entry.replyStripped = true
        }
        if (i >= MAX_IN_MEMORY_TERMINAL_TASKS && this.persistedIndex.has(entry.id)) {
          this.tasks.delete(entry.id)
        }
      }
    }

    if (this.persistedIndex.size > MAX_IN_MEMORY_TERMINAL_TASKS) {
      const sorted = Array.from(this.persistedIndex.values()).sort(
        (a, b) => (b.completedAt ?? b.savedAt) - (a.completedAt ?? a.savedAt)
      )
      for (const overflow of sorted.slice(MAX_IN_MEMORY_TERMINAL_TASKS)) {
        this.persistedIndex.delete(overflow.taskId)
      }
    }
  }

  private async readPersisted(taskId: string): Promise<PersistedAgentTaskRecord | null> {
    // taskId 来自外部请求，限制字符集防路径穿越
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId)) return null
    if (!this.persistDir) return this.persistedIndex.get(taskId) ?? null
    try {
      const raw = await readFile(join(this.persistDir, `${taskId}.json`), 'utf8')
      const record = JSON.parse(raw) as PersistedAgentTaskRecord
      if (record?.version !== 1 || record.taskId !== taskId) return null
      this.persistedIndex.set(taskId, this.stripPersistedReply(record))
      this.pruneInMemoryTerminalTasks()
      return record
    } catch {
      return null
    }
  }

  /** 启动惰性清理：加载索引 + 删除过期/超量记录（最多 200 条或 7 天），内存索引剥离大正文并限制 100 条。 */
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
        records.push(this.stripPersistedReply(record))
      } catch {
        await rm(join(this.persistDir, entry.name), { force: true }).catch(() => undefined)
      }
    }
    records.sort((a, b) => b.savedAt - a.savedAt)
    for (const overflow of records.slice(AGENT_TASK_PERSIST_LIMIT)) {
      await rm(join(this.persistDir, `${overflow.taskId}.json`), { force: true }).catch(() => undefined)
    }
    for (const record of records.slice(0, Math.min(AGENT_TASK_PERSIST_LIMIT, MAX_IN_MEMORY_TERMINAL_TASKS))) {
      this.persistedIndex.set(record.taskId, record)
    }
  }
}

export const agentTaskService = new AgentTaskService()
