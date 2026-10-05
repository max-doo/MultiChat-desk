import type Store from 'electron-store'
import type { WebContents } from 'electron'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { sessionManager } from './SessionManager'
import { getSelectors, defaultSelectors, type ModelSelector, type SelectorsConfig } from '../../shared/config/selectors'
import { generateSendMessageScript, generateGetLatestResponseScript, generateFileDropPointScript, generateFileUploadStateScript } from '../../shared/utils/webviewScripts'

const PLATFORM_DEFAULT_URLS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com',
  claude: 'https://claude.ai',
  perplexity: 'https://www.perplexity.ai/',
  arena: 'https://arena.ai/',
  doubao: 'https://www.doubao.com/chat',
  yuanbao: 'https://yuanbao.tencent.com/chat',
  qwen: 'https://tongyi.aliyun.com/qianwen',
  deepseek: 'https://chat.deepseek.com',
  kimi: 'https://kimi.moonshot.cn',
  chatglm: 'https://chatglm.cn/main/alltoolsdetail?lang=zh',
  yiyan: 'https://chat.baidu.com/'
}

export interface AutomationResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error('附件操作已中止'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** 前台总结与后台导图共享同一拖拽上传实现。 */
export async function dispatchFileDrop(wc: WebContents, filePath: string, x: number, y: number, signal?: AbortSignal): Promise<AutomationResponse> {
  let attachedByUs = false
  try {
    if (signal?.aborted) throw new Error('附件操作已中止')
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3')
      attachedByUs = true
    }
    const data = { items: [], files: [filePath], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      if (signal?.aborted) throw new Error('附件操作已中止')
      await abortable(wc.debugger.sendCommand('Input.dispatchDragEvent', { type, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), data }), signal)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    try { if (attachedByUs && !wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach() } catch { /* 页面关闭时调试器已分离。 */ }
  }
}

/**
 * 后台自动化执行内核服务
 * 负责在无头或长驻的会话 WebContents 中执行发送输入、点击按钮以及提取结果
 */
export class AutomationService {
  private store: Store<Record<string, unknown>> | null = null

  /**
   * 初始化自动化服务并注入 store
   */
  public init(store: Store<Record<string, unknown>>): void {
    this.store = store
  }

  /**
   * 获取指定平台的选择器配置
   */
  public async getPlatformSelectors(platformId: string): Promise<ModelSelector> {
    let customModelSelector: ModelSelector | undefined

    if (this.store) {
      try {
        const stored = this.store.get('selectors') as SelectorsConfig | undefined
        if (stored && stored.models && stored.models[platformId]) {
          customModelSelector = stored.models[platformId]
        }
      } catch (err) {
        console.warn(`[AutomationService] 从 store 读取自定义选择器失败 (${platformId}):`, err)
      }
    }

    const selectorsConfig = await getSelectors()
    const selectors = customModelSelector || (selectorsConfig.models ? selectorsConfig.models[platformId] : undefined) || (defaultSelectors.models ? defaultSelectors.models[platformId] : undefined)

    if (!selectors) {
      throw new Error(`平台选择器未配置: ${platformId}`)
    }
    return selectors
  }

  /**
   * 获取指定平台的默认或初始加载网址
   */
  public getPlatformUrl(platformId: string, selectors: ModelSelector): string {
    const url = selectors.newConversationUrl || PLATFORM_DEFAULT_URLS[platformId]
    if (!url) {
      throw new Error(`平台网址未配置: ${platformId}`)
    }
    return url
  }

  /**
   * 确保平台的会话窗口已创建且完成初始页面加载
   */
  public async ensureSessionReady(platformId: string, sessionKey = platformId, restoreUrl?: string): Promise<Electron.WebContents> {
    const selectors = await this.getPlatformSelectors(platformId)
    const url = restoreUrl || this.getPlatformUrl(platformId, selectors)
    const win = sessionManager.getOrCreateSession(sessionKey, url)
    const webContents = win.webContents

    const currentUrl = webContents.getURL()
    const isBlank = currentUrl === '' || currentUrl === 'about:blank'

    if (webContents.isLoading() || webContents.isLoadingMainFrame() || isBlank) {
      await new Promise<void>((resolve, reject) => {
        if (!webContents.isLoading() && !webContents.isLoadingMainFrame() && !isBlank) {
          resolve()
          return
        }

        const timeout = setTimeout(() => {
          // 即使加载超时也尝试解析，某些动态网页可能在超时时已部分可用
          webContents.removeListener('did-finish-load', didFinishLoad)
          webContents.removeListener('did-fail-load', didFailLoad)
          resolve()
        }, 20000)

        const didFinishLoad = () => {
          clearTimeout(timeout)
          webContents.removeListener('did-fail-load', didFailLoad)
          resolve()
        }

        const didFailLoad = (_event: unknown, errorCode: number, errorDescription: string) => {
          clearTimeout(timeout)
          webContents.removeListener('did-finish-load', didFinishLoad)
          reject(new Error(`页面加载失败: ${errorDescription} (${errorCode})`))
        }

        webContents.once('did-finish-load', didFinishLoad)
        webContents.once('did-fail-load', didFailLoad)
      })

      // 等待前端框架（React/Vue/Angular等）水合及 DOM 初始化
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }

    return webContents
  }

  /**
   * 执行发送指令：在目标平台的 WebContents 注入脚本完成输入与提交
   * @param platformId 平台 ID
   * @param prompt 要发送的提示词内容
   */
  public async executeCommand(platformId: string, prompt: string, sessionKey = platformId, options?: { attachmentFileName?: string; signal?: AbortSignal }): Promise<AutomationResponse> {
    try {
      if (!platformId || !prompt) {
        return { success: false, error: '缺少必填参数 platformId 或 prompt' }
      }

      const selectors = await this.getPlatformSelectors(platformId)
      const webContents = await this.ensureSessionReady(platformId, sessionKey)

      if (options?.signal?.aborted) return { success: false, error: '任务已中止' }

      const script = generateSendMessageScript(prompt, platformId, selectors, options?.attachmentFileName)
      const result = await abortable(webContents.executeJavaScript(script), options?.signal)

      if (result && typeof result === 'object' && result.success === false) {
        return { success: false, error: result.error || '执行自动化指令失败' }
      }

      return { success: true, data: result }
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error)
      console.error(`[AutomationService] executeCommand 异常 (${platformId}):`, errMessage)
      return { success: false, error: errMessage }
    }
  }

  /** 完整来源会话写入临时 Markdown，附件状态确认后才允许发送。 */
  public async uploadMarkdownContext(platformId: string, content: string, sessionKey: string, cancelSignal: AbortSignal): Promise<AutomationResponse<{ fileName: string }>> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    cancelSignal.addEventListener('abort', abort, { once: true })
    if (cancelSignal.aborted) abort()
    const signal = controller.signal
    const timer = setTimeout(abort, 60_000)
    let tempDir: string | undefined
    try {
      if (signal.aborted) throw new Error('附件操作已中止')
      if (!content.trim()) throw new Error('主会话附件内容为空')
      const selectors = await abortable(this.getPlatformSelectors(platformId), signal)
      const wc = await abortable(this.ensureSessionReady(platformId, sessionKey), signal)
      const fileName = `source-conversation-${randomUUID()}.md`
      tempDir = await mkdtemp(join(tmpdir(), 'multichat-mindmap-context-'))
      const filePath = join(tempDir, fileName)
      await writeFile(filePath, content, 'utf8')
      if (signal.aborted) throw new Error('附件操作已中止')
      const point = await abortable(wc.executeJavaScript(generateFileDropPointScript(selectors)) as Promise<{ x: number; y: number }>, signal)
      const dropped = await dispatchFileDrop(wc, filePath, point.x, point.y, signal)
      if (!dropped.success) throw new Error(dropped.error || '附件拖拽上传失败')
      const script = generateFileUploadStateScript(selectors, fileName)
      let stable = 0
      while (!signal.aborted) {
        const state = await abortable(wc.executeJavaScript(script) as Promise<{ found: boolean; busy: boolean; error?: string }>, signal)
        if (state.error) throw new Error(state.error)
        stable = state.found && !state.busy ? stable + 1 : 0
        if (stable >= 3) return { success: true, data: { fileName } }
        await abortable(new Promise<void>(resolve => setTimeout(resolve, 500)), signal)
      }
      throw new Error('主会话附件上传已中止')
    } catch (error) {
      return { success: false, error: cancelSignal.aborted ? '附件上传已取消' : signal.aborted ? '主会话附件上传超时，未发送请求' : error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
      cancelSignal.removeEventListener('abort', abort)
      // tempDir only comes from this operation's mkdtemp, never from renderer input.
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => console.warn('[AutomationService] 主会话附件临时目录清理失败'))
    }
  }

  /**
   * 收集输出结果：执行查询脚本提取目标平台上最新的回复内容
   * @param platformId 平台 ID
   */
  public async collectResult(platformId: string, sessionKey = platformId): Promise<AutomationResponse<string>> {
    try {
      if (!platformId) {
        return { success: false, error: '缺少必填参数 platformId' }
      }

      const win = sessionManager.getSession(sessionKey)
      if (!win || win.isDestroyed()) {
        return { success: false, error: `后台会话不存在或已关闭: ${platformId}` }
      }

      const selectors = await this.getPlatformSelectors(platformId)
      const script = generateGetLatestResponseScript(selectors)
      const content = await win.webContents.executeJavaScript(script)

      const textResult = typeof content === 'string' ? content : (content ? String(content) : '')
      return { success: true, data: textResult }
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error)
      console.error(`[AutomationService] collectResult 异常 (${platformId}):`, errMessage)
      return { success: false, error: errMessage }
    }
  }
}

export const automationService = new AutomationService()
