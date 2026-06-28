import { sessionManager } from './SessionManager'
import { getSelectors, defaultSelectors, type ModelSelector } from '../../shared/config/selectors'
import { generateSendMessageScript, generateGetLatestResponseScript } from '../../shared/utils/webviewScripts'

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

/**
 * 后台自动化执行内核服务
 * 负责在无头或长驻的会话 WebContents 中执行发送输入、点击按钮以及提取结果
 */
export class AutomationService {
  /**
   * 获取指定平台的选择器配置
   */
  private async getPlatformSelectors(platformId: string): Promise<ModelSelector> {
    const selectorsConfig = await getSelectors()
    const selectors = selectorsConfig.platforms[platformId] || defaultSelectors.platforms[platformId]
    if (!selectors) {
      throw new Error(`平台选择器未配置: ${platformId}`)
    }
    return selectors
  }

  /**
   * 获取指定平台的默认或初始加载网址
   */
  private getPlatformUrl(platformId: string, selectors: ModelSelector): string {
    const url = PLATFORM_DEFAULT_URLS[platformId] || selectors.newConversationUrl
    if (!url) {
      throw new Error(`平台网址未配置: ${platformId}`)
    }
    return url
  }

  /**
   * 确保平台的会话窗口已创建且完成初始页面加载
   */
  private async ensureSessionReady(platformId: string): Promise<Electron.WebContents> {
    const selectors = await this.getPlatformSelectors(platformId)
    const url = this.getPlatformUrl(platformId, selectors)
    const win = sessionManager.getOrCreateSession(platformId, url)
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
  public async executeCommand(platformId: string, prompt: string): Promise<AutomationResponse> {
    try {
      if (!platformId || !prompt) {
        return { success: false, error: '缺少必填参数 platformId 或 prompt' }
      }

      const selectors = await this.getPlatformSelectors(platformId)
      const webContents = await this.ensureSessionReady(platformId)

      const script = generateSendMessageScript(prompt, platformId, selectors)
      const result = await webContents.executeJavaScript(script)

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

  /**
   * 收集输出结果：执行查询脚本提取目标平台上最新的回复内容
   * @param platformId 平台 ID
   */
  public async collectResult(platformId: string): Promise<AutomationResponse<string>> {
    try {
      if (!platformId) {
        return { success: false, error: '缺少必填参数 platformId' }
      }

      const win = sessionManager.getSession(platformId)
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
