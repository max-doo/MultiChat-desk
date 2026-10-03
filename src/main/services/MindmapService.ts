import { randomUUID } from 'crypto'
import type { MindmapTask, NoteConversation } from '../../shared/types/notes'
import { buildMindmapPrompt, inspectMindmapOutline, MINDMAP_INPUT_LIMIT, MINDMAP_TAGS } from '../../shared/utils/mindmap'
import { generateMindmapPageStateScript, generateMindmapResponseScript, type MindmapResponse } from '../../shared/utils/webviewScripts'
import { automationService } from './AutomationService'
import { sessionManager } from './SessionManager'
import type { NoteManager } from '../noteManager'

const TERMINAL_PHASES = ['done', 'error', 'cancelled']
const sessionKey = (id: string): string => `__mindmap_${id}`
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

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

  constructor(private notes: NoteManager, private notify: (task: MindmapTask) => void, private notesChanged: () => void) {}

  getTask(): MindmapTask | null { return this.task ? { ...this.task } : null }

  async start(conversation: NoteConversation, platform: string, additionalRequirements = ''): Promise<MindmapTask> {
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有导图正在生成，请等待或取消后再试')
    if (conversation.snapshot.length > MINDMAP_INPUT_LIMIT) throw new Error('对话超过 60000 字符，暂不支持直接生成；内容未截断')
    if (!conversation.snapshot.trim()) throw new Error('没有可整理的对话内容')
    await automationService.getPlatformSelectors(platform)
    // 异步检查后再检查一次，防止两个窗口同时启动。
    if (this.task && !TERMINAL_PHASES.includes(this.task.phase)) throw new Error('已有导图正在生成')
    if (this.task) sessionManager.destroySession(sessionKey(this.task.id))
    this.controller = new AbortController()
    const task: MindmapTask = { id: randomUUID(), conversationId: conversation.id, sourceTitle: conversation.title, platform, phase: 'loading' }
    this.task = task
    this.notify({ ...task })
    void this.run(task, conversation, this.controller.signal, additionalRequirements)
    return { ...task }
  }

  private change(task: MindmapTask, phase: MindmapTask['phase'], error?: string): void {
    if (this.task?.id !== task.id || task.phase === 'cancelled') return
    task.phase = phase
    task.error = error
    this.notify({ ...task })
  }

  private async run(task: MindmapTask, source: NoteConversation, cancelSignal: AbortSignal, additionalRequirements: string): Promise<void> {
    const key = sessionKey(task.id)
    const controller = new AbortController()
    const signal = controller.signal
    const abort = (): void => controller.abort()
    cancelSignal.addEventListener('abort', abort, { once: true })
    let generationTimer: ReturnType<typeof setTimeout> | undefined
    let stage = '准备生成网页'
    let captured: MindmapResponse = { text: '', source: 'empty', editorCount: 0, codeCount: 0, messageCount: 0 }
    let pageBusy: boolean | undefined
    let stable = 0
    const diagnostics = (): string => `阶段：${stage}；来源：${captured.source}；读取 ${captured.text.length} 字符，回复 ${captured.messageCount} 个，编辑器 ${captured.editorCount} 个，代码节点 ${captured.codeCount} 个；网页生成状态：${pageBusy === undefined ? '未读取' : pageBusy ? '生成中' : '空闲'}；大纲稳定 ${stable} 次`
    try {
      if (cancelSignal.aborted) return
      const wc = await waitFor(automationService.ensureSessionReady(task.platform, key), 30_000, stage, signal)
      const selectors = await waitFor(automationService.getPlatformSelectors(task.platform), 10_000, '读取平台配置', signal)
      const stateScript = generateMindmapPageStateScript(selectors, task.platform)
      const responseScript = generateMindmapResponseScript(selectors)
      const readyDeadline = Date.now() + 30_000
      while (!signal.aborted) {
        const state = await waitFor(wc.executeJavaScript(stateScript) as Promise<{ ready: boolean; busy: boolean }>, 5_000, '检查网页就绪状态', signal)
        if (state.ready && !state.busy) break
        if (Date.now() > readyDeadline) throw new Error('生成网页未就绪，请打开生成网页检查登录或验证码后重试')
        await delay(500)
      }
      if (signal.aborted) return
      // 新建专用窗口不会复用 CLI/原网页的会话；若平台自动恢复旧会话则拒绝发送。
      stage = '检查空白对话'
      const baseline = await waitFor(automationService.collectResult(task.platform, key), 10_000, stage, signal)
      if (!baseline.success) throw new Error('无法确认生成网页是否为新对话，请检查后重试')
      if (baseline.data?.trim()) throw new Error('平台未进入空白新对话，请打开生成网页检查后重试')
      stage = '发送生成请求'
      const sent = await waitFor(automationService.executeCommand(task.platform, buildMindmapPrompt(source.snapshot, additionalRequirements), key), 30_000, stage, signal)
      if (signal.aborted) return
      if (!sent.success) throw new Error(sent.error || '发送失败，请检查生成网页')
      this.change(task, 'generating')
      let lastOutline = ''
      let lastText = ''
      let idleStable = 0
      // 独立于网页脚本执行的总超时，避免停在 await 时永远无法检查截止时间。
      generationTimer = setTimeout(() => {
        const reason = !captured.text.trim() ? '未抓取到 AI 回复' : !captured.text.includes(MINDMAP_TAGS.begin) ? '抓取结果缺少 <mindmap> 开始标签' : !captured.text.includes(MINDMAP_TAGS.end) ? '抓取结果缺少 </mindmap> 闭合标签' : '未取得稳定且可解析的完整大纲'
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
        const response = captured.text
        stage = '解析大纲'
        const outline = inspectMindmapOutline(response)
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
        const saved = await this.notes.addMindmap(source, outline.markdown, task.platform)
        task.conversationId = saved.conversationId
        task.mindmapId = saved.mindmap.id
        this.notesChanged()
        this.change(task, 'done')
        sessionManager.destroySession(key)
        return
      }
    } catch (error) {
      if (!signal.aborted) this.change(task, 'error', `${error instanceof Error ? error.message : '生成未完成'}（${diagnostics()}）。请打开生成网页查看；不会自动重发`)
    } finally {
      clearTimeout(generationTimer)
      cancelSignal.removeEventListener('abort', abort)
      if (cancelSignal.aborted) sessionManager.destroySession(key)
    }
  }

  cancel(id: string): void {
    if (this.task?.id !== id || TERMINAL_PHASES.includes(this.task.phase)) return
    if (this.task.phase === 'saving') throw new Error('正在保存，请稍候')
    this.controller?.abort()
    this.task.phase = 'cancelled'
    sessionManager.destroySession(sessionKey(id))
    this.notify({ ...this.task })
  }

  show(id: string): void {
    if (this.task?.id !== id) throw new Error('任务不存在')
    const window = sessionManager.getSession(sessionKey(id))
    if (!window) throw new Error('生成网页已关闭，请重新生成')
    window.show()
    window.focus()
  }

  shutdown(): void {
    this.controller?.abort()
    if (this.task) sessionManager.destroySession(sessionKey(this.task.id))
  }
}
