import { randomUUID } from 'crypto'
import type { TaskSplitTask } from '../../shared/types/taskSplit'
import { buildTaskSplitPrompt, parseSubtasksXml, parseSubtasksLenient, SUBTASK_TAGS } from '../../shared/utils/taskSplit'
import { generateMindmapPageStateScript, generateMindmapResponseScript, type MindmapResponse } from '../../shared/utils/webviewScripts'
import { isConversationUrlForPlatform } from '../../shared/utils/conversationUrl'
import { automationService } from './AutomationService'
import { sessionManager } from './SessionManager'
import type { BrowserWindow } from 'electron'
import { showBackgroundPreview } from '../webviewManager'

const TERMINAL_PHASES = ['done', 'error', 'cancelled']
const sessionKey = (id: string): string => `__tasksplit_${id}`
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const IDLE_TIMEOUT = 2 * 60_000
const TEMPORARY_IDLE_TIMEOUT = 10 * 60_000
const GENERATION_TIMEOUT = 120_000

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

export class TaskSplitService {
  private task: TaskSplitTask | null = null
  private controller: AbortController | null = null
  private ownerId = 0
  private idle: { key: string; platformId: string; initialized: boolean } | null = null
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private lastPage: { taskId: string; key: string; initialized: boolean; platformId: string; conversationUrl?: string } | null = null
  private trackedWindows = new WeakSet<BrowserWindow>()

  constructor(private notify: (task: TaskSplitTask) => void) {}

  getTask(): TaskSplitTask | null { return this.task ? { ...this.task } : null }

  async start(goal: string, platform: string, windowCount: number, ownerId = 0): Promise<TaskSplitTask> {
    if (typeof goal !== 'string' || !goal.trim()) throw new Error('目标不能为空')
    if (goal.length > 20000) throw new Error('目标过长，请控制在 20000 字符以内')
    if (!Number.isInteger(windowCount) || windowCount < 1 || windowCount > 12) throw new Error('窗口数无效')
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有拆解任务正在执行，请等待或取消后再试')
    await automationService.getPlatformSelectors(platform)
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有拆解任务正在执行')
    this.releaseIdle()
    this.lastPage = null
    this.ownerId = ownerId
    this.controller = new AbortController()
    const task: TaskSplitTask = { id: randomUUID(), platform, goal: goal.trim(), windowCount, phase: 'loading' }
    this.task = task
    this.notify({ ...task })
    void this.run(task, this.controller.signal)
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
  private async retainTerminalPage(task: TaskSplitTask, key: string): Promise<void> {
    if (this.task?.id !== task.id || !TERMINAL_PHASES.includes(task.phase) || this.idle?.key !== key) return
    const window = sessionManager.getSession(key)
    if (!window) return
    window.webContents.setBackgroundThrottling(true)
    const url = window.webContents.getURL()
    const binding = await this.conversationBinding(task.platform, url)
    if (this.task?.id !== task.id || !TERMINAL_PHASES.includes(task.phase) || this.idle?.key !== key || window.isDestroyed()) return
    this.lastPage = { taskId: task.id, key, platformId: task.platform, initialized: this.idle.initialized, conversationUrl: binding }
    this.scheduleIdleRelease(task, key)
  }

  private scheduleIdleRelease(task: TaskSplitTask, key: string): void {
    if (this.task?.id !== task.id || !TERMINAL_PHASES.includes(task.phase) || this.idle?.key !== key) return
    const window = sessionManager.getSession(key)
    if (!window) return
    this.clearIdleTimer()
    if (window.isVisible()) return
    if (task.phase === 'cancelled') { this.releaseIdle(); return }
    const timeout = this.lastPage?.conversationUrl ? IDLE_TIMEOUT : TEMPORARY_IDLE_TIMEOUT
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      if (this.task?.id === task.id && TERMINAL_PHASES.includes(task.phase) && this.idle?.key === key && !window.isDestroyed() && !window.isVisible()) this.releaseIdle()
    }, timeout)
  }

  private change(task: TaskSplitTask, phase: TaskSplitTask['phase'], error?: string): void {
    if (this.task?.id !== task.id || task.phase === 'cancelled') return
    task.phase = phase
    task.error = error
    this.notify({ ...task })
  }

  /** 会话地址仅用于恢复查看；不是平台对话地址则返回 undefined。 */
  private async conversationBinding(platformId: string, currentUrl: string): Promise<string | undefined> {
    try {
      const selectors = await automationService.getPlatformSelectors(platformId)
      const baseUrl = automationService.getPlatformUrl(platformId, selectors)
      return isConversationUrlForPlatform(platformId, currentUrl, baseUrl) ? new URL(currentUrl).href : undefined
    } catch { return undefined }
  }

  private async restoreConversationUrl(platformId: string, url?: string): Promise<string | undefined> {
    if (!url) return undefined
    const checked = await this.conversationBinding(platformId, url)
    if (!checked) throw new Error('拆解会话地址无效，请重新拆解')
    return checked
  }

  private async run(task: TaskSplitTask, signal: AbortSignal): Promise<void> {
    const key = sessionKey(task.id)
    let generationTimer: ReturnType<typeof setTimeout> | undefined
    let stage = '准备拆解网页'
    let captured: MindmapResponse = { text: '', source: 'empty', editorCount: 0, codeCount: 0, messageCount: 0 }
    let pageBusy: boolean | undefined
    let stable = 0
    let lastText = ''
    let lastMessageId = ''
    const diagnostics = (): string => `阶段：${stage}；来源：${captured.source}；读取 ${captured.text.length} 字符，回复 ${captured.messageCount} 个；网页生成状态：${pageBusy === undefined ? '未读取' : pageBusy ? '生成中' : '空闲'}；稳定 ${stable} 次`
    try {
      const ready = automationService.ensureSessionReady(task.platform, key)
      const releaseLateWindow = (): void => {
        if ((signal.aborted || this.task?.id !== task.id || TERMINAL_PHASES.includes(task.phase)) && this.idle?.key !== key) sessionManager.destroySession(key)
      }
      void ready.then(releaseLateWindow, releaseLateWindow)
      const wc = await waitFor(ready, 30_000, stage, signal)
      if (signal.aborted || this.task?.id !== task.id) {
        if (this.idle?.key !== key) sessionManager.destroySession(key)
        return
      }
      this.idle = { key, platformId: task.platform, initialized: false }
      this.trackWindow(key)
      wc.setBackgroundThrottling(false)
      const selectors = await waitFor(automationService.getPlatformSelectors(task.platform), 10_000, '读取平台配置', signal)
      const stateScript = generateMindmapPageStateScript(selectors, task.platform)
      const responseScript = generateMindmapResponseScript(selectors, 'markdown', false, 'task_split')
      const readyDeadline = Date.now() + 30_000
      while (!signal.aborted) {
        const state = await waitFor(wc.executeJavaScript(stateScript) as Promise<{ ready: boolean; busy: boolean }>, 5_000, '检查网页就绪状态', signal)
        if (state.ready && !state.busy) break
        if (Date.now() > readyDeadline) throw new Error('拆解网页未就绪，请打开拆解网页检查登录或验证码后重试')
        await delay(500)
      }
      if (signal.aborted) return
      stage = '检查空白对话'
      const baseline = await waitFor(wc.executeJavaScript(generateMindmapResponseScript(selectors, 'markdown', true, 'task_split')) as Promise<MindmapResponse>, 10_000, stage, signal)
      if (baseline.messageCount || baseline.text.trim()) throw new Error('平台未进入空白新对话，请打开拆解网页检查后重试')
      stage = '发送拆解请求'
      const prompt = buildTaskSplitPrompt(task.goal, task.windowCount)
      const sent = await waitFor(automationService.executeCommand(task.platform, prompt, key, { signal }), 30_000, stage, signal)
      if (signal.aborted) return
      if (!sent.success) throw new Error(sent.error || '发送失败，请检查拆解网页')
      if (this.idle?.key === key) this.idle.initialized = true
      this.change(task, 'generating')
      generationTimer = setTimeout(() => {
        const reason = !captured.text.trim() ? '未抓取到 AI 回复' : !captured.text.includes(SUBTASK_TAGS.end) ? '回复缺少 </task_split> 闭合标签（可能仍在生成中）' : '未取得可解析的稳定拆解结果'
        this.change(task, 'error', `拆解超时：${reason}（${diagnostics()}）。请打开拆解网页查看；不会自动重发`)
        this.controller?.abort()
      }, GENERATION_TIMEOUT)
      while (!signal.aborted) {
        stage = '等待读取回复'
        await delay(1500)
        if (signal.aborted) return
        if (wc.isDestroyed()) throw new Error('拆解网页已关闭，请重新拆解')
        stage = '读取网页回复'
        captured = await waitFor(wc.executeJavaScript(responseScript) as Promise<MindmapResponse>, 10_000, stage, signal)
        const newReply = !!captured.messageId && captured.messageId !== baseline.messageId && (baseline.messageCount === 0 || (captured.messageId.startsWith('stable:') && !baseline.messageIds?.includes(captured.messageId)) || (captured.baselineConnected && captured.messageCount > baseline.messageCount))
        if (!newReply) { stable = 0; continue }
        const parsed = parseSubtasksXml(captured.text, task.windowCount)
        const state = await waitFor(wc.executeJavaScript(stateScript) as Promise<{ busy: boolean }>, 5_000, '读取生成状态', signal)
        pageBusy = state.busy
        stable = !state.busy && captured.text === lastText && captured.messageId === lastMessageId ? stable + 1 : 0
        lastText = captured.text; lastMessageId = captured.messageId || ''
        if (parsed.status === 'ready' && stable >= 2) {
          clearTimeout(generationTimer)
          generationTimer = undefined
          task.subtasks = parsed.subtasks
          this.change(task, 'done')
          this.idle = { key, platformId: task.platform, initialized: true }
          return
        }
        // pending 或未稳定：继续等；invalid 需等空闲稳定后才报，避免流式中途误判。
        if (parsed.status !== 'ready' && !state.busy && stable >= 2) {
          // 平台常回显提示词/松包裹——严格包络坏时，退到逐 <subtask> 兜底再判定。
          const loose = parseSubtasksLenient(captured.text, task.windowCount)
          if (loose.length >= Math.max(1, task.windowCount)) {
            clearTimeout(generationTimer); generationTimer = undefined
            task.subtasks = loose
            this.change(task, 'done')
            this.idle = { key, platformId: task.platform, initialized: true }
            return
          }
          if (parsed.status === 'invalid') throw new Error(`拆解结果无法解析：${parsed.error}`)
        }
      }
    } catch (error) {
      if (!signal.aborted && this.task?.id === task.id) {
        if (!this.idle && sessionManager.getSession(key)) {
          this.idle = { key, platformId: task.platform, initialized: false }
          this.trackWindow(key)
        }
        this.change(task, 'error', `${error instanceof Error ? error.message : '拆解未完成'}（${diagnostics()}）。请打开拆解网页查看；不会自动重发`)
      }
    } finally {
      clearTimeout(generationTimer)
      if (signal.aborted && this.idle?.key !== key) sessionManager.destroySession(key)
      await this.retainTerminalPage(task, key)
    }
  }

  cancel(id: string, ownerId?: number): void {
    if (ownerId !== undefined && ownerId !== this.ownerId) throw new Error('任务不属于当前窗口')
    if (this.task?.id !== id || TERMINAL_PHASES.includes(this.task.phase)) return
    this.controller?.abort()
    this.task.phase = 'cancelled'
    this.notify({ ...this.task })
    const window = this.idle ? sessionManager.getSession(this.idle.key) : undefined
    if (window && this.idle) {
      const url = window.webContents.getURL()
      this.lastPage = { taskId: id, key: this.idle.key, platformId: this.idle.platformId, initialized: this.idle.initialized }
      void this.conversationBinding(this.idle.platformId, url).then(conversationUrl => {
        if (this.lastPage?.taskId === id) this.lastPage.conversationUrl = conversationUrl
      }).catch(() => undefined)
    }
    if (!window?.isVisible()) this.releaseIdle()
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
      if (page?.taskId !== id) throw new Error('拆解网页已释放，未取得可恢复的会话地址，请重新拆解')
      const url = await this.restoreConversationUrl(page.platformId, page.conversationUrl)
      if (!url) throw new Error('拆解网页已释放，原会话没有可恢复地址，请重新拆解')
      if (this.task?.id !== id || !owner || owner.isDestroyed()) throw new Error('任务已切换或所属窗口已关闭')
      key = page.key
      window = sessionManager.getOrCreateSession(key, url)
      this.idle = { key, platformId: page.platformId, initialized: page.initialized }
      this.trackWindow(key)
      window.webContents.setBackgroundThrottling(true)
    }
    this.clearIdleTimer()
    showBackgroundPreview(window, owner, () => this.idle?.key !== key || !this.task || TERMINAL_PHASES.includes(this.task.phase))
    if (TERMINAL_PHASES.includes(task.phase)) window.webContents.setBackgroundThrottling(true)
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
  }

  shutdown(): void {
    this.controller?.abort()
    this.releaseIdle()
    this.lastPage = null
    if (this.task) sessionManager.destroySession(sessionKey(this.task.id))
  }
}
