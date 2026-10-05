import { useState, type RefObject } from 'react'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { ModelSelector } from '../config/selectors'
import type { WebviewCardRef } from '../components/WebviewCard'
import {
  generateSendMessageScript,
  generateInsertTextScript,
  generateSendOnlyScript,
  generateClearInputScript,
  generateGetInputTextScript,
  generateEnableDeepResearchScript,
  generateDisableDeepResearchScript,
  generateEnableImageGenerationScript,
  generateDisableImageGenerationScript,
  generateExtractImagesScript,
  generateClickDownloadButtonsScript,
  generateGetLatestResponseScript,
  generateMindmapPageStateScript,
  generateFileDropPointScript,
  generateDetectUploadedFileScript,
  type FileUploadData
} from '../utils/webviewScripts'
import { extractGeminiCanvasContent } from '../utils/geminiCanvasExtractor'
import { extractQwenReportContent } from '../utils/qwenReportExtractor'
import { buildProbeScript, parseProbeResult, type ProbeReport, buildResearchProbeScript, parseResearchProbeResult, type ResearchProbeReport, buildPickerScript, parseDomProbeResult, type DomProbeReport, type DomProbeOptions } from '../utils/selectorDiagnostics'

/** 任务分配两段式发送：注入后等待 host 端延时，再点发送按钮（给千问 React 收敛窗口） */
const TWO_PHASE_SEND_DELAY_MS = 1000


// 创建 Turndown 实例用于 HTML 转 Markdown
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
})

// 使用 GFM 插件支持表格、删除线、任务列表等
turndownService.use(gfm)

interface UseWebviewActionsParams {
  webviewRef: RefObject<Electron.WebviewTag>
  id: string
  name: string
  selectors: ModelSelector | undefined
  isReady: boolean
  isLoading: boolean
  isHibernated: boolean
}

type WebviewActions = Pick<WebviewCardRef,
  | 'getWebContentsId'
  | 'getConversationIdentity'
  | 'sendMessage'
  | 'insertText'
  | 'clearInput'
  | 'getInputText'
  | 'uploadFile'
  | 'enableDeepResearch'
  | 'disableDeepResearch'
  | 'enableImageGeneration'
  | 'disableImageGeneration'
  | 'extractGeneratedImages'
  | 'clickDownloadButtons'
  | 'getLatestResponse'
  | 'probeMessageContainer'
  | 'probeResearchMode'
  | 'probeDomStructure'
>

/** 平台网页操作；页面加载、导航和休眠由 useWebviewLifecycle 管理。 */
export function useWebviewActions({
  webviewRef, id, name, selectors, isReady, isLoading, isHibernated
}: UseWebviewActionsParams) {
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const actions: WebviewActions = {
    getWebContentsId: () => {
      try { return webviewRef.current?.getWebContentsId() || null } catch { return null }
    },
    getConversationIdentity: async () => {
      const webview = webviewRef.current
      if (!webview || !isReady || isHibernated) return null
      try { return await webview.executeJavaScript('({url: location.href, title: document.title})') as { url: string; title: string } }
      catch { return null }
    },
    sendMessage: async (
      message: string,
      twoPhase = false
    ): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview) {
        console.warn(`[${name}] sendMessage: webview ref 为空`)
        return { success: false, error: `Webview ref 为空` }
      }
      if (!isReady) {
        console.warn(`[${name}] sendMessage: webview 未就绪 (isReady: ${isReady}, isLoading: ${isLoading})`)
        return { success: false, error: `Webview 未就绪 (加载中: ${isLoading})` }
      }
      if (!selectors) {
        console.warn(`[${name}] sendMessage: 选择器配置不存在`)
        return { success: false, error: `选择器配置不存在` }
      }

      setSendStatus('sending')

      try {
        if (twoPhase) {
          // 两段式发送：先注入文本，等待 1000ms 给千问等平台 React 收敛，再点发送按钮
          const insertCode = generateInsertTextScript(message, id, selectors)
          const insertResult = await webview.executeJavaScript(insertCode)
          if (!insertResult?.success) {
            setSendStatus('error')
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: false, error: insertResult?.error || '注入失败' }
          }
          await new Promise((resolve) => setTimeout(resolve, TWO_PHASE_SEND_DELAY_MS))
          const sendCode = generateSendOnlyScript(id, selectors)
          const result = await webview.executeJavaScript(sendCode)
          if (result.success) {
            setSendStatus('success')
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: true }
          }
          setSendStatus('error')
          setTimeout(() => setSendStatus('idle'), 3000)
          return { success: false, error: result.error }
        }

        // 原单脚本路径（multi_ai / summary 等默认走此路径）
        const code = generateSendMessageScript(message, id, selectors)
        const result = await webview.executeJavaScript(code)

        if (result.success) {
          setSendStatus('success')
          // 3秒后恢复状态
          setTimeout(() => setSendStatus('idle'), 3000)
          return { success: true }
        } else {
          setSendStatus('error')
          setTimeout(() => setSendStatus('idle'), 3000)
          return { success: false, error: result.error }
        }
      } catch (error) {
        console.error(`[${name}] sendMessage 异常:`, error)
        setSendStatus('error')
        setTimeout(() => setSendStatus('idle'), 3000)
        return { success: false, error: String(error) }
      }
    },

    /**
     * 只输入文字到输入框，不发送
     */
    insertText: async (message: string): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview) {
        console.warn(`[${name}] insertText: webview ref 为空`)
        return { success: false, error: `Webview ref 为空` }
      }
      if (!isReady) {
        console.warn(`[${name}] insertText: webview 未就绪 (isReady: ${isReady}, isLoading: ${isLoading})`)
        return { success: false, error: `Webview 未就绪 (加载中: ${isLoading})` }
      }
      if (!selectors) {
        console.warn(`[${name}] insertText: 选择器配置不存在`)
        return { success: false, error: `选择器配置不存在` }
      }

      try {
        const code = generateInsertTextScript(message, id, selectors)
        const result = await webview.executeJavaScript(code)
        return { success: result.success, error: result.error }
      } catch (error) {
        console.error(`[${name}] insertText 异常:`, error)
        return { success: false, error: String(error) }
      }
    },

    /**
     * 清空输入框内容
     */
    clearInput: async (): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { success: false, error: 'Webview 未就绪' }
      }

      try {
        const code = generateClearInputScript(selectors)
        const result = await Promise.race([
          webview.executeJavaScript(code),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('执行超时')), 400))
        ])
        return { success: result.success, error: result.error }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },

    /**
     * 读取输入框中的当前文本内容（不清空、不发送）
     */
    getInputText: async (): Promise<{ success: boolean; text?: string; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { success: false, text: '', error: 'Webview 未就绪' }
      }

      try {
        const code = generateGetInputTextScript(selectors)
        const result = await Promise.race([
          webview.executeJavaScript(code),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('执行超时')), 400))
        ])
        return { success: result.success, text: result.text || '', error: result.error }
      } catch (error) {
        console.error(`[${name}] getInputText 异常:`, error)
        return { success: false, text: '', error: String(error) }
      }
    },

    /**
     * 上传文件到 webview
     */
    uploadFile: async (fileData: FileUploadData): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { success: false, error: 'Webview 未就绪' }
      }

      try {
        const webContentsId = typeof webview.getWebContentsId === 'function' ? webview.getWebContentsId() : null
        if (!window.api?.dispatchFileDrop) {
          return { success: false, error: '缺少 dispatchFileDrop，无法拖拽上传' }
        }
        if (!fileData?.filePath) {
          return { success: false, error: '缺少 filePath，无法拖拽上传' }
        }
        if (typeof webContentsId !== 'number') {
          return { success: false, error: '无法获取 webContentsId，无法拖拽上传' }
        }

        const point = await webview.executeJavaScript(generateFileDropPointScript(selectors))

        const dropResult = await window.api.dispatchFileDrop(webContentsId, fileData.filePath, point?.x ?? 10, point?.y ?? 10)
        if (!dropResult?.success) {
          return { success: false, error: dropResult?.error || '文件拖拽上传失败' }
        }

        // 信任 dispatchFileDrop 的成功结果；DOM 检测仅作为辅助确认，
        // 不再因 DOM 中未出现文件名而判定失败（部分平台上传 UI 延迟或不显示文件名）
        const detected = await webview.executeJavaScript(generateDetectUploadedFileScript(fileData.fileName))

        if (!detected) {
          console.warn(`[${name}] uploadFile: 未在 DOM 中检测到文件名，但 debugger 拖拽已成功，视为上传成功`)
        }
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },

    /**
     * 启用 Deep Research 模式
     */
    enableDeepResearch: async (): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { success: false, error: 'Webview 未就绪' }
      }

      // 检查是否有 Deep Research 配置
      if (!selectors.researchMode?.button && !selectors.researchMode?.steps) {
        return { success: false, error: '此模型不支持 Deep Research' }
      }

      try {
        // 传递整个 researchMode 配置
        const code = generateEnableDeepResearchScript(selectors.researchMode)
        const result = await webview.executeJavaScript(code)
        return { success: result.success, error: result.error }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },

    disableDeepResearch: async (): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { success: false, error: 'Webview 未就绪' }
      }

      if (!selectors.researchMode?.cancelSteps) {
        return { success: false, error: '此模型不支持取消 Deep Research' }
      }

      try {
        const code = generateDisableDeepResearchScript(selectors.researchMode)
        const result = await webview.executeJavaScript(code)
        return { success: result.success, error: result.error }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },

    /**
     * 启用 AI 生图功能
     */
    enableImageGeneration: async (): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { success: false, error: 'Webview 未就绪' }
      }

      if (!selectors.imageGeneration?.steps) {
        return { success: false, error: '此模型不支持 AI 生图' }
      }

      try {
        const code = generateEnableImageGenerationScript(selectors.imageGeneration)
        const result = await webview.executeJavaScript(code)
        return { success: result.success, error: result.error }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },

    /**
     * 禁用 AI 生图功能
     */
    disableImageGeneration: async (): Promise<{ success: boolean; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { success: false, error: 'Webview 未就绪' }
      }

      if (!selectors.imageGeneration?.cancelSteps) {
        return { success: false, error: '此模型不支持取消 AI 生图' }
      }

      try {
        const code = generateDisableImageGenerationScript(selectors.imageGeneration)
        const result = await webview.executeJavaScript(code)
        return { success: result.success, error: result.error }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },

    /**
     * 提取当前 webview 最新回复中的生图（img/canvas/a[href]/blob→data），返回 src 列表与 wcId
     */
    extractGeneratedImages: async () => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { images: [], wcId: null, error: 'Webview 未就绪' }
      }
      const wcId = typeof webview.getWebContentsId === 'function' ? webview.getWebContentsId() : null
      try {
        const code = generateExtractImagesScript(selectors)
        const result = await webview.executeJavaScript(code)
        if (result && result.success) {
          return { images: result.images || [], wcId }
        }
        return { images: [], wcId, error: result?.error || '提取失败' }
      } catch (error) {
        return { images: [], wcId, error: String(error) }
      }
    },

    /**
     * 按平台 imageDownload.steps 触发网页内置下载（hover/click），返回 {clicked, wcId}
     * dryRun=true 时只校验配置并返回 wcId，不执行点击（主进程 ctx 必须先于点击建立）
     */
    clickDownloadButtons: async (dryRun = false): Promise<{ clicked: number; wcId: number | null; error?: string }> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return { clicked: 0, wcId: null, error: 'Webview 未就绪' }
      }
      if (!selectors.imageDownload?.steps?.length) {
        return { clicked: 0, wcId: null, error: '此模型未配置下载步骤' }
      }
      const wcId = typeof webview.getWebContentsId === 'function' ? webview.getWebContentsId() : null
      if (dryRun) {
        // 只校验配置 + 拿 wcId，不点击；clicked 用 1 表示"配置就绪可触发"
        return { clicked: 1, wcId, error: undefined }
      }
      try {
        const code = generateClickDownloadButtonsScript(selectors)
        const result = await webview.executeJavaScript(code)
        return { clicked: result?.clicked ?? 0, wcId, error: result?.error }
      } catch (error) {
        return { clicked: 0, wcId, error: String(error) }
      }
    },

    /**
     * 获取最新的 AI 回复
     * 对于 Gemini Canvas 模式，通过点击复制按钮并读取剪贴板获取内容
     */
    getLatestResponse: async (options?: { interactive?: boolean }): Promise<string> => {
      const webview = webviewRef.current
      if (!webview || !isReady || !selectors) {
        return ''
      }

      try {
        if (options?.interactive === false) {
          const state = await webview.executeJavaScript(generateMindmapPageStateScript(selectors, id))
          if (state?.busy) return '' // 页面仍在生成，不能用短暂稳定的旧文本推进任务。
        }
        // 对于 Gemini，先尝试 Canvas 模式的复制方式（使用真实鼠标点击）
        if (id === 'gemini' && options?.interactive !== false) {
          const canvasContent = await extractGeminiCanvasContent(
            webview,
            window.api,
            turndownService
          )
          if (canvasContent) {
            return canvasContent
          }
          // Canvas 模式提取失败，回退到普通 DOM 爬取
        }

        // 对于千问，若报告页已打开（复制按钮可见），优先通过点击复制按钮获取完整报告
        if (id === 'qwen' && options?.interactive !== false) {
          const reportContent = await extractQwenReportContent(
            webview,
            window.api,
            turndownService
          )
          if (reportContent) {
            return reportContent
          }
          // 报告页未打开或提取失败，回退到普通 DOM 爬取
        }

        // 普通模式：使用 HTML 转 Markdown
        const code = generateGetLatestResponseScript(selectors)
        const content = await webview.executeJavaScript(code)
        if (typeof content === 'string' && content.trim()) {
          return content.trim()
        }

        return ''
      } catch (error) {
        console.error('获取回复失败:', error)
        return ''
      }
    },

    /**
     * dev-only：对当前页面跑 messageContainer 探针，返回每候选命中报告
     */
    probeMessageContainer: async (): Promise<ProbeReport> => {
      const webview = webviewRef.current
      if (!webview) {
        return { ok: false, candidates: [], error: 'Webview ref 为空' }
      }
      const list = selectors?.messageContainer ?? []
      if (list.length === 0) {
        return { ok: false, candidates: [], error: '该平台无 messageContainer 配置' }
      }
      try {
        const raw = await webview.executeJavaScript(buildProbeScript(list))
        return parseProbeResult(raw)
      } catch (error) {
        return { ok: false, candidates: [], error: `页面未就绪或执行失败: ${String(error)}` }
      }
    },

    /**
     * dev-only：对当前页面跑 researchMode 探针，返回每步命中报告（只读）
     */
    probeResearchMode: async (): Promise<ResearchProbeReport> => {
      const webview = webviewRef.current
      if (!webview) {
        return { ok: false, steps: [], error: 'Webview ref 为空' }
      }
      const steps = selectors?.researchMode?.steps ?? []
      if (steps.length === 0) {
        return { ok: false, steps: [], error: '该平台无 researchMode 配置' }
      }
      try {
        const raw = await webview.executeJavaScript(buildResearchProbeScript(steps))
        return parseResearchProbeResult(raw)
      } catch (error) {
        return { ok: false, steps: [], error: `页面未就绪或执行失败: ${String(error)}` }
      }
    },

    /**
     * dev-only：进入检拾模式，鼠标点选平台页元素后返回其 DOM 结构（祖先链 + 子树）。
     * 注入 picker 脚本（覆盖层 + 高亮 + click 选中 + Esc/超时取消），单次 executeJavaScript 往返。
     * mode 参数预留扩展（当前仅 'pick'）。
     */
    probeDomStructure: async (_mode: 'pick', opts?: DomProbeOptions): Promise<DomProbeReport> => {
      const webview = webviewRef.current
      if (!webview) {
        return { ok: false, error: 'Webview ref 为空' }
      }
      try {
        const raw = await webview.executeJavaScript(buildPickerScript(opts))
        return parseDomProbeResult(raw)
      } catch (error) {
        return { ok: false, error: `页面未就绪或执行失败: ${String(error)}` }
      }
    }
  }

  return { actions, sendStatus }
}
