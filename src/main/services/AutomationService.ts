import type Store from 'electron-store'
import type { WebContents } from 'electron'
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { sessionManager } from './SessionManager'
import { getSelectors, defaultSelectors, type ModelSelector, type SelectorsConfig } from '../../shared/config/selectors'
import { generateSendMessageScript, generateGetLatestResponseScript, generateFileDropPointScript, generateFileUploadStateScript, generatePasteFileUploadScript } from '../../shared/utils/webviewScripts'

const PLATFORM_DEFAULT_URLS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com',
  claude: 'https://claude.ai',
  perplexity: 'https://www.perplexity.ai/',
  arena: 'https://arena.ai/',
  doubao: 'https://www.doubao.com/chat',
  yuanbao: 'https://yuanbao.tencent.com/chat',
  qwen: 'https://www.qianwen.com/',
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

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv'
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
        // 与渲染层 getSelectors 的版本语义保持一致：旧版本保存的选择器可能缺少新增字段
        // （如 qwen 的 newConversationUrl 仍指向已废弃站点），低于默认版本时整体作废。
        if (stored && stored.version >= defaultSelectors.version && stored.models && stored.models[platformId]) {
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
   * 返回全部已配置平台 ID（store 自定义选择器与默认配置的并集）。
   */
  public async listPlatformIds(): Promise<string[]> {
    let storedModels: Record<string, ModelSelector> | undefined
    if (this.store) {
      try {
        const stored = this.store.get('selectors') as SelectorsConfig | undefined
        storedModels = stored?.models
      } catch (err) {
        console.warn('[AutomationService] 从 store 读取平台列表失败:', err)
      }
    }
    return Array.from(new Set([...Object.keys(defaultSelectors.models), ...Object.keys(storedModels ?? {})])).sort()
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
   * 后台会话逐张拖拽上传本地文件附件；每张等待平台解析稳定（found && !busy 连续 3 次）再下一张。
   * 与 uploadMarkdownContext 共享 dispatchFileDrop + generateFileUploadStateScript 实现，
   * 差别是文件已存在于磁盘（CLI --image 场景），无需写临时文件。
   * @returns fileNames 供 generateSendMessageScript 的附件门控二次确认
   */
  public async uploadAttachments(platformId: string, filePaths: string[], sessionKey: string, signal?: AbortSignal): Promise<AutomationResponse<{ fileNames: string[] }>> {
    try {
      const selectors = await this.getPlatformSelectors(platformId)
      const wc = await this.ensureSessionReady(platformId, sessionKey)
      const fileNames: string[] = []
      for (const filePath of filePaths) {
        const fileName = basename(filePath)
        if (signal?.aborted) throw new Error('附件操作已中止')
        // 优先走"粘贴式"上传：读文件 bytes → 页内 new File + ClipboardEvent('paste')。
        // 不依赖页面是否监听 drop/落点坐标，主流 AI 输入框都监听 paste 处理附件。
        // paste 派发失败（如页面拦截/不支持）才退回 CDP 拖拽兜底。
        let uploaded = false
        try {
          const buf = await readFile(filePath)
          const mime = MIME_BY_EXT[extname(fileName).toLowerCase()] ?? 'application/octet-stream'
          const pasteScript = generatePasteFileUploadScript(selectors, fileName, mime, buf.toString('base64'))
          const pasted = await abortable(wc.executeJavaScript(pasteScript) as Promise<{ success: boolean; error?: string }>, signal)
          uploaded = !!pasted?.success
        } catch (err) {
          uploaded = false
          console.warn(`[AutomationService] 粘贴上传异常，退回拖拽 (${fileName}):`, err)
        }
        if (!uploaded) {
          const point = await abortable(wc.executeJavaScript(generateFileDropPointScript(selectors)) as Promise<{ x: number; y: number }>, signal)
          const dropped = await dispatchFileDrop(wc, filePath, point?.x ?? 10, point?.y ?? 10, signal)
          if (!dropped.success) return { success: false, error: dropped.error || `附件上传失败: ${fileName}` }
        }
        const stateScript = generateFileUploadStateScript(selectors, fileName)
        // 大图/慢网络/平台 OCR 预检可能把附件 ready 拖过 30s（实测豆包/Gemini 曾踩到）；
        // 主超时给足 90s 仍由 stable>=3 提前退出，不延长快路径。
        const ATTACHMENT_READY_TIMEOUT_MS = 90_000
        const deadline = Date.now() + ATTACHMENT_READY_TIMEOUT_MS
        let stable = 0
        let reason = '未检测到本轮附件'
        for (;;) {
          if (signal?.aborted) throw new Error('附件操作已中止')
          const state = await abortable(wc.executeJavaScript(stateScript) as Promise<{ found: boolean; busy: boolean; error?: string }>, signal)
          if (state.error) return { success: false, error: state.error }
          stable = state.found && !state.busy ? stable + 1 : 0
          if (stable >= 3) break
          reason = !state.found ? '未检测到本轮附件' : '附件仍在上传或解析'
          if (Date.now() >= deadline) {
            return { success: false, error: `等待附件「${fileName}」上传就绪超时（${Math.round(ATTACHMENT_READY_TIMEOUT_MS / 1000)} 秒）：${reason}` }
          }
          await abortable(new Promise<void>(resolve => setTimeout(resolve, 400)), signal)
        }
        fileNames.push(fileName)
      }
      return { success: true, data: { fileNames } }
    } catch (error) {
      return { success: false, error: signal?.aborted ? '附件上传已中止' : error instanceof Error ? error.message : String(error) }
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
