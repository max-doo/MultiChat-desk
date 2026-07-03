import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { defaultSelectors } from '../config/selectors'
import { useAppStore, DEEP_RESEARCH_SUPPORTED_MODEL_IDS, IMAGE_GENERATION_SUPPORTED_MODEL_IDS } from '../store/appStore'
import CustomDropdown, { type DropdownOption } from './CustomDropdown'
import {
  generateSendMessageScript,
  generateInsertTextScript,
  generateClearInputScript,
  generateGetInputTextScript,
  generateEnableDeepResearchScript,
  generateDisableDeepResearchScript,
  generateEnableImageGenerationScript,
  generateDisableImageGenerationScript,
  generateGetLatestResponseScript,
  type FileUploadData
} from '../utils/webviewScripts'
import { extractGeminiCanvasContent } from '../utils/geminiCanvasExtractor'
import { buildProbeScript, parseProbeResult, type ProbeReport } from '../utils/selectorDiagnostics'
import ModelOutputCard from './ModelOutputCard'

// 创建 Turndown 实例用于 HTML 转 Markdown
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
})

// 使用 GFM 插件支持表格、删除线、任务列表等
turndownService.use(gfm)

// ── Webview 初始加载诊断 ──────────────────────────────────────────
// 仅覆盖 loadURL() 首次加载到 dom-ready 之间的生命周期
const LOAD_TIMEOUT_MS = 30_000 // 首次加载超时阈值

// Electron did-fail-load errorCode 分类集合（基于 Chromium net error）
const NO_NETWORK_CODES = new Set<number>([-106]) // ERR_INTERNET_DISCONNECTED
const DNS_CODES = new Set<number>([-105, -137]) // ERR_NAME_NOT_RESOLVED / ERR_NAME_RESOLUTION_FAILED
const TIMEOUT_CODES = new Set<number>([-118]) // ERR_CONNECTION_TIMED_OUT

type ErrorCategory = 'no_network' | 'dns' | 'timeout' | 'connection'

interface LoadErrorInfo {
  category: ErrorCategory
  icon: string
  title: string
  subtitle: string
  errorCode: number | null
  hostname: string
}

// 从 URL 中提取 hostname，失败时回退为原字符串
function getHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname || urlStr
  } catch {
    return urlStr
  }
}

// 判断当前是否离线（渲染层 navigator.onLine）
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * 将 Electron did-fail-load 的 errorCode（或超时场景下的 null）归类为
 * 用户可理解的错误信息。
 * - errorCode === null 表示由 30s 超时计时器触发
 * - errorCode === -3（用户主动取消）应在调用前过滤，不进入本函数
 */
function classifyError(errorCode: number | null, hostname: string): LoadErrorInfo {
  if (errorCode !== null && NO_NETWORK_CODES.has(errorCode) || (errorCode !== null && isOffline())) {
    return { category: 'no_network', icon: 'wifi_off', title: '网络连接已断开', subtitle: '请检查网络后重试', errorCode, hostname }
  }
  if (errorCode !== null && DNS_CODES.has(errorCode)) {
    return { category: 'dns', icon: 'dns', title: '无法解析域名', subtitle: '请检查地址是否正确', errorCode, hostname }
  }
  if (errorCode === null || (errorCode !== null && TIMEOUT_CODES.has(errorCode))) {
    return { category: 'timeout', icon: 'hourglass_empty', title: '页面加载超时', subtitle: '请检查网络或稍后重试', errorCode, hostname }
  }
  return { category: 'connection', icon: 'cloud_off', title: `无法连接到 ${hostname}`, subtitle: `错误码: ${errorCode}`, errorCode, hostname }
}

interface WebviewCardProps {
  id: string
  name: string
  url: string
  logo: string
  enabled: boolean
  slotIndex: number  // 当前卡片所在的位置索引
  compact?: boolean  // 紧凑模式：去掉 min-h 限制，适合嵌套在 flex 容器中
  hideHeader?: boolean  // 隐藏头部（平台名称、刷新、状态等），适合嵌套在已有控制栏的容器中
  onModelChange?: (modelId: string) => void  // 自定义平台切换回调，覆盖默认的 swapModelInSlot
  isolated?: boolean // 隔离模式：不受主界面对话状态（会话锁定、模型阵容锁定）的影响
  headerActions?: React.ReactNode // 自定义头部操作区按钮
  draggableHeader?: boolean // 是否允许头部拖拽窗口
  /** 辩论模式下的阵营标签（正方/反方），仅 productMode='debate' 时传入 */
  sideLabel?: '正方' | '反方'
  /** 只读历史快照：URL 不匹配/网页打不开时，用本地存的该模型历史回复替代真实页面。reason 表示触发原因。 */
  readonlySnapshot?: { content: string; reason: 'url_mismatch' | 'load_error' | 'no_snapshot' } | null
  /** 历史记录里该模型的原始 URL，用于检测 webview 是否仍停在历史会话页。为空则跳过检测。 */
  expectedUrl?: string
  flat?: boolean // 扁平无边框模式：去除圆角、外边框与阴影，占满整个容器
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void // 开始拖拽窗口的回调
}

// 重新导出 FileUploadData 类型供其他组件使用
export type { FileUploadData }

// 暴露给父组件的方法
export interface WebviewCardRef {
  sendMessage: (message: string) => Promise<{ success: boolean; error?: string }>
  insertText: (message: string) => Promise<{ success: boolean; error?: string }>
  clearInput: () => Promise<{ success: boolean; error?: string }>
  getInputText: () => Promise<{ success: boolean; text?: string; error?: string }>
  uploadFile: (fileData: FileUploadData) => Promise<{ success: boolean; error?: string }>
  enableDeepResearch: () => Promise<{ success: boolean; error?: string }>
  disableDeepResearch: () => Promise<{ success: boolean; error?: string }>
  enableImageGeneration: () => Promise<{ success: boolean; error?: string }>
  disableImageGeneration: () => Promise<{ success: boolean; error?: string }>
  getLatestResponse: () => Promise<string>
  reload: () => void
  resetToInitial: () => Promise<{ success: boolean; error?: string }>
  getCurrentUrl: () => string
  loadURL: (url: string) => void
  /** 休眠 webview：保存输入草稿与当前 URL，导航到 about:blank 以释放页面层 V8 堆/DOM（决策 D1：真卸载） */
  suspend: () => Promise<{ success: boolean; savedUrl?: string; savedDraft?: string; error?: string }>
  /** 唤醒 webview：重新加载保存的 URL 并恢复输入草稿 */
  resume: () => Promise<{ success: boolean; error?: string }>
  /** 查询是否处于休眠状态 */
  isHibernated: () => boolean
  /** dev-only：对当前页面跑 messageContainer 探针，返回每候选命中报告 */
  probeMessageContainer: () => Promise<ProbeReport>
}

/**
 * Webview 卡片组件
 * 嵌入 AI 平台的 Web 界面，支持消息发送和响应抓取
 */
const WebviewCard = forwardRef<WebviewCardRef, WebviewCardProps>(
  ({ id, name, url, logo, enabled, slotIndex, compact, hideHeader, onModelChange, isolated, headerActions, draggableHeader, flat, onDragStart, readonlySnapshot, expectedUrl, sideLabel }, ref) => {
    const webviewRef = useRef<Electron.WebviewTag>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isReady, setIsReady] = useState(false)
    const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
    const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null)
    const [urlMismatch, setUrlMismatch] = useState(false)
    const [canGoBack, setCanGoBack] = useState(false)
    const [canGoForward, setCanGoForward] = useState(false)
    // 跟踪已加载的 URL，避免重复 loadURL
    const loadedUrlRef = useRef<string | null>(null)

    // ── 加载诊断状态 / refs ──
    // elapsedSeconds：用于在 spinner 下方动态显示 "已等待 Ns..."
    const [elapsedSeconds, setElapsedSeconds] = useState(0)
    // 首次加载超时计时器（仅 isFirstLoad 时启用）
    const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 已等待秒数 interval
    const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    // 是否处于首次加载（dom-ready 后置 false；resetToInitial 重新置 true）
    const isFirstLoadRef = useRef<boolean>(true)

    // ── 休眠状态管理（片段 A）──
    const [isHibernated, setIsHibernated] = useState(false)
    const hibernatedUrlRef = useRef<string | null>(null)
    const hibernatedDraftRef = useRef<string>('')
    const isResumingRef = useRef(false)

    // 从 store 获取所有模型、状态和切换方法
    const models = useAppStore((state) => state.models)
    const swapModelInSlot = useAppStore((state) => state.swapModelInSlot)
    const productMode = useAppStore((state) => state.productMode)
    const setTaskAssignmentSlot = useAppStore((state) => state.setTaskAssignmentSlot)
    const isNewSession = useAppStore((state) => state.isNewSession)
    const textInserted = useAppStore((state) => state.textInserted)
    const activeModels = useAppStore((state) => state.activeModels)

    // 判断会话是否在进行中：如果不是新会话，或者输入框已经有内容（准备发送），则锁定当前阵容；处于隔离模式（如总结页）则不锁定
    const isSessionActive = !isolated && (!isNewSession || textInserted)
    // 如果当前处于活动会话，且当前模型在活动阵容中，则当前窗口被锁死；处于隔离模式则不锁死
    const isLockedModel = !isolated && isSessionActive && activeModels.some(m => m.id === id)

    // 获取当前模型的选择器配置
    const selectors = defaultSelectors.models[id]

    const syncNavigationState = (): void => {
      const webview = webviewRef.current
      if (!webview) return
      try {
        setCanGoBack(webview.canGoBack())
        setCanGoForward(webview.canGoForward())
      } catch {
        setCanGoBack(false)
        setCanGoForward(false)
      }
    }

    /**
     * 规范化 URL：只保留 origin + pathname，去掉 query/hash。
     * 用于和历史记录的 expectedUrl 比较——query/hash 常含无关参数（ref/utm/continued 等），
     * 直接字符串比较会误判。会话 ID 在 chatgpt/gemini/claude 均在 pathname 中，此规范够用。
     * ⚠️ 若实测某平台会话 ID 在 query，需在此函数对该平台做特例保留——见计划「阻塞项与后续」。
     */
    const normalizeUrl = (raw: string): string => {
      if (!raw) return ''
      try {
        const u = new URL(raw)
        return u.origin + u.pathname
      } catch {
        return raw
      }
    }

    // 检测当前 webview URL 是否偏离历史会话页（被重定向到登录页/错误页/别的会话等）。
    // 仅作提醒信号：SPA 正常的 URL normalize 也可能触发不一致，故不静默切换，只设 urlMismatch 供覆盖层提示。
    const checkUrlMismatch = (): void => {
      if (!expectedUrl) {
        setUrlMismatch(false)
        return
      }
      const webview = webviewRef.current
      if (!webview) {
        setUrlMismatch(false)
        return
      }
      try {
        const currentUrl = webview.getURL() || ''
        setUrlMismatch(normalizeUrl(currentUrl) !== normalizeUrl(expectedUrl))
      } catch {
        setUrlMismatch(false)
      }
    }

    // ── 加载诊断计时器辅助 ──
    // 清除超时与已等待秒数计时器
    const clearLoadTimers = (): void => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current)
        elapsedIntervalRef.current = null
      }
    }

    // 超时触发：停止 webview、清计时器、设置 timeout 错误覆盖层
    const triggerLoadTimeout = (): void => {
      try { webviewRef.current?.stop() } catch { /* ignore */ }
      clearLoadTimers()
      setIsLoading(false)
      const hostname = getHostname(loadedUrlRef.current || '')
      setLoadError(classifyError(null, hostname))
    }

    // 在 did-start-loading 时启动：已等待秒数 interval + 30s 超时（覆盖首次加载与后续导航）
    const startLoadTimers = (): void => {
      clearLoadTimers()
      setElapsedSeconds(0)
      elapsedIntervalRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1)
      }, 1000)
      loadTimeoutRef.current = setTimeout(() => {
        triggerLoadTimeout()
      }, LOAD_TIMEOUT_MS)
    }

    // 任务分配模式或隔离模式支持选择所有 AI，因此可选列表为全量模型；多 AI 模式下排除自身
    const availableModels = (productMode === 'task_assignment' || isolated || !!onModelChange) ? models : models.filter(m => m.id !== id)

    // 将模型列表转换为下拉菜单选项格式
    const modelOptions: DropdownOption<string>[] = availableModels.map(m => ({
      value: m.id,
      label: m.name,
      logo: m.logo // 保存 logo 信息
    }))

    useEffect(() => {
      const webview = webviewRef.current
      if (!webview || !enabled) return

      // 监听加载事件
      const handleDomReady = (): void => {
        try {
          const currentUrl = webview.getURL()
          if (currentUrl && (currentUrl.startsWith('chrome-error://') || currentUrl.startsWith('data:text/html'))) {
            return
          }
        } catch {
          // 忽略获取 URL 异常
        }
        clearLoadTimers()
        isFirstLoadRef.current = false // 首次加载完成，后续导航不再启用超时
        setIsLoading(false)
        setIsReady(true)
        setLoadError(null)
        checkUrlMismatch()
        syncNavigationState()
      }

      const handleLoadStart = (): void => {
        // 不在这里清空 setLoadError(null)，防止 did-fail-load 报网络错误后 Chromium 内部尝试跳转错误页时触发 start-loading 导致错误弹窗消失
        setIsLoading(true)
        startLoadTimers()
      }

      const handleLoadStop = (): void => {
        clearLoadTimers()
        setIsLoading(false)
        syncNavigationState()
      }

      const handleLoadFail = (event: Electron.DidFailLoadEvent): void => {
        if (!event.isMainFrame) return
        if (event.errorCode === -3) {
          // 用户主动取消或网卡路由切换（如 TUN 模式）导致中断时，清除计时器与加载状态
          clearLoadTimers()
          setIsLoading(false)
          if (isFirstLoadRef.current) {
            const failHost = getHostname(event.validatedURL || loadedUrlRef.current || '')
            setLoadError({
              category: 'connection',
              icon: 'cloud_off',
              title: '网络连接或路由切换中断',
              subtitle: 'TUN 代理切网卡中或请求中断 (-3)，请点击重试',
              errorCode: -3,
              hostname: failHost
            })
          }
          return
        }
        clearLoadTimers()
        const errorInfo = {
          errorCode: event.errorCode,
          errorDescription: event.errorDescription,
          validatedURL: event.validatedURL,
          isMainFrame: event.isMainFrame
        }
        console.error(`${name} 加载失败:`, errorInfo)
        setIsLoading(false)
        const failHost = getHostname(event.validatedURL || loadedUrlRef.current || '')
        setLoadError(classifyError(event.errorCode, failHost))
      }

      const handleConsoleMessage = (event: Electron.ConsoleMessageEvent): void => {
        if (event.message.startsWith('__MM_LOG__:')) {
          console.log(`[${name}] ${event.message.substring(9)}`)
          return
        }

        // 记录所有级别的消息（0=verbose, 1=info, 2=warning, 3=error）
        if (event.level >= 2) { // 只记录警告和错误
          console.log(`[${name}] Level ${event.level}: ${event.message}`)
        }
      }

      const handleRenderProcessGone = (event: any): void => {
        const details = event?.details || event
        console.error(`[${name}] 渲染进程崩溃/退出! reason: ${details?.reason || 'unknown'}, exitCode: ${details?.exitCode ?? 'none'}`, details)
        clearLoadTimers()
        setIsLoading(false)
        setLoadError({
          category: 'connection',
          icon: 'error',
          title: '页面渲染进程意外退出',
          subtitle: '点击重试重新加载页面',
          errorCode: -1,
          hostname: getHostname(loadedUrlRef.current || url)
        })
      }

      webview.addEventListener('dom-ready', handleDomReady)
      webview.addEventListener('did-start-loading', handleLoadStart)
      webview.addEventListener('did-stop-loading', handleLoadStop)
      webview.addEventListener('did-fail-load', handleLoadFail)
      webview.addEventListener('console-message', handleConsoleMessage)
      webview.addEventListener('render-process-gone', handleRenderProcessGone)
      webview.addEventListener('crashed', handleRenderProcessGone)

      // 监听导航事件
      const handleDidNavigate = (_event: any): void => {
        // 不在这里清空 setLoadError(null)，由 handleDomReady、主动 loadURL 或重试操作负责清空
        syncNavigationState()
        checkUrlMismatch()
      }

      const handleDidNavigateInPage = (_event: any): void => {
        syncNavigationState()
        checkUrlMismatch()
      }

      const handleDidFinishLoad = (): void => {
        syncNavigationState()
      }

      webview.addEventListener('did-navigate', handleDidNavigate)
      webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage)

      // 注意：移除了 handleNewWindow 事件监听器
      // 外部链接打开功能由主进程的注入脚本 (openUrl -> __OPEN_LINK__) 和 setWindowOpenHandler 处理
      // 保留 handleNewWindow 会导致重复打开窗口

      // 页面加载完成后检查内容
      webview.addEventListener('did-finish-load', handleDidFinishLoad)

      return () => {
        clearLoadTimers()
        webview.removeEventListener('dom-ready', handleDomReady)
        webview.removeEventListener('did-start-loading', handleLoadStart)
        webview.removeEventListener('did-stop-loading', handleLoadStop)
        webview.removeEventListener('did-fail-load', handleLoadFail)
        webview.removeEventListener('console-message', handleConsoleMessage)
        webview.removeEventListener('render-process-gone', handleRenderProcessGone)
        webview.removeEventListener('crashed', handleRenderProcessGone)
        webview.removeEventListener('did-navigate', handleDidNavigate)
        webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage)
        webview.removeEventListener('did-finish-load', handleDidFinishLoad)
      }
    }, [enabled, name, selectors])

    // F3: 使用 loadURL() 主动导航，替代不可靠的 <webview src> 属性
    // Electron <webview> 的 src 属性在冷启动时经常不触发导航，导致页面空白
    useEffect(() => {
      const webview = webviewRef.current
      if (!webview || !enabled || !url) return
      // URL 没变则跳过
      if (loadedUrlRef.current === url) return

      const doLoad = (): void => {
        try {
          console.log(`[${name}] loadURL: ${url}`)
          loadedUrlRef.current = url
          setIsLoading(true)
          setLoadError(null)
          webview.loadURL(url)
        } catch (e) {
          console.error(`[${name}] loadURL failed:`, e)
        }
      }

      // 如果 webview 已挂载（有 getURL 方法），直接加载
      // 否则等一个 tick 让 Electron 完成内部初始化
      if (typeof webview.getURL === 'function') {
        try {
          webview.getURL() // 测试是否已就绪
          doLoad()
        } catch {
          // webview 尚未就绪，等待 did-attach
          const timer = setTimeout(doLoad, 200)
          return () => clearTimeout(timer)
        }
      } else {
        const timer = setTimeout(doLoad, 200)
        return () => clearTimeout(timer)
      }
    }, [url, enabled, name])

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      /**
       * 发送消息到当前平台
       */
      sendMessage: async (message: string): Promise<{ success: boolean; error?: string }> => {
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
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('执行超时')), 400))
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
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('执行超时')), 400))
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
          const webContentsId = typeof (webview as any).getWebContentsId === 'function' ? (webview as any).getWebContentsId() : null
          if (!window.api?.dispatchFileDrop) {
            return { success: false, error: '缺少 dispatchFileDrop，无法拖拽上传' }
          }
          if (!fileData?.filePath) {
            return { success: false, error: '缺少 filePath，无法拖拽上传' }
          }
          if (typeof webContentsId !== 'number') {
            return { success: false, error: '无法获取 webContentsId，无法拖拽上传' }
          }

          const point = await webview.executeJavaScript(`
            (function () {
              const textareaSelectors = ${JSON.stringify(selectors.textarea || [])};
              let target = null;
              for (const selector of textareaSelectors) {
                const el = document.querySelector(selector);
                if (el) { target = el; break; }
              }
              if (!target) target = document.body || document.documentElement;
              if (!target) return { x: 10, y: 10 };
              try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
              const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
              const x = rect.left + Math.max(10, rect.width / 2);
              const y = rect.top + Math.max(10, rect.height / 2);
              return { x, y };
            })();
          `)

          const dropResult = await window.api.dispatchFileDrop(webContentsId, fileData.filePath, point?.x ?? 10, point?.y ?? 10)
          if (!dropResult?.success) {
            return { success: false, error: dropResult?.error || '文件拖拽上传失败' }
          }

          // 信任 dispatchFileDrop 的成功结果；DOM 检测仅作为辅助确认，
          // 不再因 DOM 中未出现文件名而判定失败（部分平台上传 UI 延迟或不显示文件名）
          const detected = await webview.executeJavaScript(`
            (async function () {
              const fileName = ${JSON.stringify(fileData.fileName)};
              const deadline = Date.now() + 8000;
              while (Date.now() < deadline) {
                const bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';
                if (bodyText && bodyText.includes(fileName)) return true;
                const nodes = document.querySelectorAll('[aria-label],[title],[data-file-name]');
                for (const node of nodes) {
                  const aria = (node.getAttribute && node.getAttribute('aria-label')) || '';
                  const title = (node.getAttribute && node.getAttribute('title')) || '';
                  const dataName = (node.getAttribute && node.getAttribute('data-file-name')) || '';
                  if ((aria && aria.includes(fileName)) || (title && title.includes(fileName)) || (dataName && dataName.includes(fileName))) {
                    return true;
                  }
                }
                await new Promise(r => setTimeout(r, 200));
              }
              return false;
            })();
          `)

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
       * 获取最新的 AI 回复
       * 对于 Gemini Canvas 模式，通过点击复制按钮并读取剪贴板获取内容
       */
      getLatestResponse: async (): Promise<string> => {
        const webview = webviewRef.current
        if (!webview || !isReady || !selectors) {
          return ''
        }

        try {
          // 对于 Gemini，先尝试 Canvas 模式的复制方式（使用真实鼠标点击）
          if (id === 'gemini') {
            const canvasContent = await extractGeminiCanvasContent(
              webview,
              window.api as any,
              turndownService
            )
            if (canvasContent) {
              return canvasContent
            }
            // Canvas 模式提取失败，回退到普通 DOM 爬取
          }

          // 普通模式：使用 HTML 转 Markdown
          const code = generateGetLatestResponseScript(selectors)
          return await webview.executeJavaScript(code)
        } catch (error) {
          console.error('获取回复失败:', error)
          return ''
        }
      },

      /**
       * 重新加载 webview
       */
      reload: (): void => {
        webviewRef.current?.reload()
      },

      /**
       * 跳转到初始 URL 并在加载完成后返回
       */
      resetToInitial: async (): Promise<{ success: boolean; error?: string }> => {
        const webview = webviewRef.current
        if (!webview) {
          return { success: false, error: 'Webview ref 为空' }
        }

        const clearNavigationState = (): void => {
          setCanGoBack(false)
          setCanGoForward(false)
          try {
            webview.clearHistory()
          } catch {
            // clearHistory 可能在某些情况下失败，忽略错误
          }
        }

        setLoadError(null)
        setIsLoading(true)
        setElapsedSeconds(0)
        isFirstLoadRef.current = true // resetToInitial 视为首次加载，复用超时逻辑
        clearNavigationState()
        loadedUrlRef.current = url // 同步 ref，防止 F3 effect 重复导航

        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const handleStop = (): void => {
            setIsLoading(false)
            clearNavigationState()
            setTimeout(() => {
              clearNavigationState()
            }, 300)
            cleanup()
            resolve({ success: true })
          }
          const handleFail = (event: Electron.DidFailLoadEvent): void => {
            cleanup()
            if (event?.errorCode === -3) {
              // 用户主动取消：不展示错误覆盖层，直接结束
              resolve({ success: false, error: 'aborted' })
              return
            }
            setIsLoading(false)
            const failHost = getHostname(event?.validatedURL || url)
            setLoadError(classifyError(event?.errorCode ?? null, failHost))
            resolve({ success: false, error: event?.errorDescription || String(event?.errorCode) })
          }
          const cleanup = (): void => {
            webview.removeEventListener('did-stop-loading', handleStop as any)
            webview.removeEventListener('did-fail-load', handleFail as any)
          }

          webview.addEventListener('did-stop-loading', handleStop as any)
          webview.addEventListener('did-fail-load', handleFail as any)
          try {
            webview.loadURL(url)
          } catch (error) {
            cleanup()
            resolve({ success: false, error: String(error) })
          }
        })
      },

      /**
       * 获取当前 webview 的 URL
       */
      getCurrentUrl: (): string => {
        return webviewRef.current?.getURL() || ''
      },

      /**
       * 加载指定的 URL
       */
      loadURL: (targetUrl: string): void => {
        if (webviewRef.current) {
          loadedUrlRef.current = targetUrl // 同步 ref
          setIsLoading(true)
          webviewRef.current.loadURL(targetUrl)
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
       * 休眠 webview：保存输入草稿与当前 URL，然后导航到 about:blank 以释放页面层内存。
       * 决策 D1：必须 loadURL('about:blank') 才真正卸载页面层 V8 堆/DOM，仅靠 className 隐藏不省内存。
       */
      suspend: async (): Promise<{ success: boolean; savedUrl?: string; savedDraft?: string; error?: string }> => {
        const webview = webviewRef.current
        if (!webview) {
          return { success: false, error: 'Webview ref 为空' }
        }
        if (isHibernated) {
          return { success: false, error: 'Already hibernated' }
        }

        try {
          // Phase 1: 保存输入框草稿
          let savedDraft = ''
          if (isReady && selectors) {
            try {
              const code = generateGetInputTextScript(selectors)
              const result = await webview.executeJavaScript(code)
              if (result && result.text) {
                savedDraft = result.text
              }
            } catch (e) {
              console.warn(`[${name}] 休眠时保存输入草稿失败:`, e)
            }
          }

          // Phase 2: 保存当前 URL（优先用真实当前 URL，回退到 props.url）
          let savedUrl = ''
          try {
            savedUrl = webview.getURL() || url
          } catch (e) {
            console.warn(`[${name}] 休眠时获取 URL 失败:`, e)
            savedUrl = url
          }

          // Phase 3: 先保存状态再导航，避免导航事件回调读到已清空的状态
          hibernatedUrlRef.current = savedUrl
          hibernatedDraftRef.current = savedDraft

          // Phase 4: 真卸载页面层 —— 导航到 about:blank 释放 V8 堆/DOM（D1）
          try {
            webview.loadURL('about:blank')
          } catch (e) {
            console.warn(`[${name}] 休眠时导航到 about:blank 失败:`, e)
          }

          setIsHibernated(true)
          // 休眠后页面层已卸载，loadedUrlRef 置空，唤醒时由 resume 重新 loadURL
          loadedUrlRef.current = null

          console.log(`[${name}] Webview 已休眠:`, {
            url: savedUrl,
            draftLength: savedDraft.length,
          })

          return { success: true, savedUrl, savedDraft }
        } catch (error) {
          console.error(`[${name}] 休眠失败:`, error)
          return { success: false, error: String(error) }
        }
      },

      /**
       * 唤醒 webview：重新加载保存的 URL 并恢复输入草稿
       */
      resume: async (): Promise<{ success: boolean; error?: string }> => {
        const webview = webviewRef.current
        if (!webview) {
          return { success: false, error: 'Webview ref 为空' }
        }
        if (!isHibernated) {
          return { success: false, error: 'Not hibernated' }
        }
        if (isResumingRef.current) {
          return { success: false, error: 'Already resuming' }
        }

        isResumingRef.current = true

        try {
          setIsHibernated(false)
          setIsLoading(true)
          setIsReady(false)

          const targetUrl = hibernatedUrlRef.current || url
          const draftToRestore = hibernatedDraftRef.current

          console.log(`[${name}] Webview 恢复中:`, targetUrl)

          // 同步 ref，防止 F3 的 loadURL effect 因 loadedUrlRef 为 null 而重复导航
          loadedUrlRef.current = targetUrl
          webview.loadURL(targetUrl)

          // 页面就绪后恢复输入草稿（轮询 isReady，最多约 30s）
          if (draftToRestore) {
            const tryInsertText = async (attempts = 0): Promise<void> => {
              if (attempts > 30) {
                console.warn(`[${name}] 恢复输入草稿超时`)
                return
              }
              if (isReady) {
                try {
                  const code = generateInsertTextScript(draftToRestore, id, selectors)
                  const result = await webview.executeJavaScript(code)
                  if (result && result.success) {
                    console.log(`[${name}] 输入草稿已恢复`)
                    return
                  }
                } catch (e) {
                  console.warn(`[${name}] 恢复输入草稿失败:`, e)
                }
              }
              await new Promise(r => setTimeout(r, 1000))
              return tryInsertText(attempts + 1)
            }
            // 延迟开始恢复，给页面加载时间
            setTimeout(() => {
              void tryInsertText()
            }, 2000)
          }

          // 清理休眠状态
          hibernatedUrlRef.current = null
          hibernatedDraftRef.current = ''

          return { success: true }
        } catch (error) {
          console.error(`[${name}] 唤醒失败:`, error)
          return { success: false, error: String(error) }
        } finally {
          isResumingRef.current = false
        }
      },

      /**
       * 查询是否处于休眠状态
       */
      isHibernated: (): boolean => {
        return isHibernated
      }
    }))

    // 获取状态指示器的显示内容
    const getStatusDisplay = () => {
      if (!enabled) {
        return { text: '已禁用', color: 'text-gray-500', dot: 'bg-gray-500' }
      }
      if (isLoading) {
        return { text: '加载中...', color: 'text-yellow-500', dot: 'bg-yellow-500', pulse: true }
      }
      switch (sendStatus) {
        case 'sending':
          return { text: '发送中...', color: 'text-yellow-500', dot: 'bg-yellow-500', pulse: true }
        case 'success':
          return { text: '发送成功', color: 'text-primary', dot: 'bg-primary' }
        case 'error':
          return { text: '发送失败', color: 'text-red-500', dot: 'bg-red-500' }
        default:
          return { text: '已启用', color: 'text-primary', dot: 'bg-primary', pulse: true }
      }
    }

    const _status = getStatusDisplay()

    // 单独刷新当前 webview 窗口
    const handleRefresh = () => {
      clearLoadTimers()
      setLoadError(null)
      setUrlMismatch(false)
      setIsLoading(true)
      setElapsedSeconds(0)
      webviewRef.current?.reload()
    }

    // 错误覆盖层“重试”：清除错误并重新加载（保持首次加载超时保护）
    const handleRetry = (): void => {
      clearLoadTimers()
      setLoadError(null)
      setUrlMismatch(false)
      setIsLoading(true)
      setElapsedSeconds(0)
      isFirstLoadRef.current = true
      webviewRef.current?.reload()
    }

    // 加载中“取消”：手动触发超时错误展示
    const handleCancelLoad = (): void => {
      triggerLoadTimeout()
    }

    const handleGoBack = () => {
      const webview = webviewRef.current
      if (!webview) return
      setLoadError(null)
      if (webview.canGoBack()) {
        setIsLoading(true)
        webview.goBack()
      }
    }

    const handleGoForward = () => {
      const webview = webviewRef.current
      if (!webview) return
      setLoadError(null)
      if (webview.canGoForward()) {
        setIsLoading(true)
        webview.goForward()
      }
    }

    const handleNewConversation = () => {
      const webview = webviewRef.current
      if (!webview) return
      const newUrl = selectors?.newConversationUrl
      if (!newUrl) return
      setLoadError(null)
      setIsLoading(true)
      webview.loadURL(newUrl)
      // 只有在非活动状态下才允许其重置全局会话标志，防止破坏其他窗口的锁
      if (!useAppStore.getState().activeModels.length) {
        useAppStore.getState().setNewSession(true)
      }
    }

    if (!enabled) {
      return (
        <div className={`flex flex-col h-full opacity-50 overflow-hidden ${flat ? 'bg-white' : 'rounded-2xl glass-panel shadow-soft'} ${compact ? '' : 'min-h-[480px]'}`}>
          <div className={`p-4 border-b ${flat ? 'border-gray-200/60 bg-white' : 'border-white/40'} flex justify-between items-center`}>
            <div className="flex items-center gap-3 opacity-50">
              <img alt={`${name} logo`} className="w-6 h-6" src={logo} />
              <h2 className="font-semibold text-text-secondary">{name}</h2>
            </div>
          </div>
          <div className="flex-1 p-4 flex items-center justify-center text-gray-600 min-h-0">
            此模型已禁用
          </div>
        </div>
      )
    }

    return (
      <div className={`flex flex-col h-full overflow-hidden ${flat ? 'bg-white' : 'rounded-2xl glass-panel shadow-soft'} ${compact ? '' : 'min-h-[480px]'}`}>
        {!hideHeader && (
          <>
            {/* 卡片头部 */}
            <div 
              className={`p-3 border-b ${flat ? 'border-gray-200/60 bg-white' : 'border-white/40 p-4'} flex justify-between items-center ${draggableHeader ? 'drag-region select-none' : ''}`}
              onPointerDown={draggableHeader ? (e) => {
                const target = e.target as HTMLElement
                if (target.closest('button') || target.closest('.no-drag') || target.closest('input') || target.closest('select')) return
                if (target.closest('.drag-region') || target === e.currentTarget) {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  window.api.windowDragStart()
                  if (onDragStart) {
                    onDragStart(e)
                  }
                }
              } : undefined}
            >
              {/* 左侧：模型信息和下拉选择器 */}
              <div className={draggableHeader ? 'no-drag' : ''} title={isSessionActive ? '当前对话进行中，需开启新对话才可更换模型' : ''}>
                <CustomDropdown
                  value={id}
                  disabled={isSessionActive}
                  onChange={(modelId) => {
                    if (onModelChange) {
                      onModelChange(modelId)
                    } else if (productMode === 'task_assignment') {
                      setTaskAssignmentSlot(slotIndex, modelId)
                    } else {
                      swapModelInSlot(slotIndex, modelId)
                    }
                  }}
                  placeholder={name}
                  className="relative"
                  dropdownWidth="w-48"
                  buttonClassName={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 -ml-2 transition-colors ${isSessionActive ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                  renderButton={() => (
                    <div className="flex items-center gap-2">
                      <img alt={`${name} logo`} className="w-6 h-6" src={logo} />
                      <h2 className="font-semibold text-text-primary">{name}</h2>
                      {sideLabel && (
                        <span
                          className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${
                            sideLabel === '正方'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}
                        >
                          {sideLabel}
                        </span>
                      )}
                    </div>
                  )}
                renderOption={(option, isSelected, onSelect) => {
                  const model = models.find(m => m.id === option.value)
                  const hasDeepResearch = model && DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)
                  const hasImageGen = model && IMAGE_GENERATION_SUPPORTED_MODEL_IDS.has(model.id)
                  return (
                    <button
                      onClick={onSelect}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-100 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <img alt={model?.name || option.label} className="w-5 h-5" src={model?.logo || option.logo} />
                        <span className="text-text-primary text-sm">{option.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasDeepResearch && (
                          <span
                            className="material-symbols-outlined text-base text-gray-400 hover:text-gray-600 transition-colors"
                            title="深度研究"
                          >
                            biotech
                          </span>
                        )}
                        {hasImageGen && (
                          <span
                            className="material-symbols-outlined text-base text-gray-400 hover:text-gray-600 transition-colors"
                            title="AI 生图"
                          >
                            image
                          </span>
                        )}
                      </div>
                    </button>
                  )
                }}
                options={modelOptions}
              />
              </div>

              {/* 右侧：刷新按钮 + 状态指示器 */}
              <div className={`flex items-center gap-3 group ${draggableHeader ? 'no-drag' : ''}`}>
                <button
                  type="button"
                  onClick={handleGoBack}
                  disabled={!canGoBack}
                  className={`flex items-center justify-center rounded-full transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${canGoBack ? 'text-text-secondary hover:text-primary' : 'text-text-secondary'}`}
                  title="后退"
                >
                  <span className="material-symbols-outlined text-xl">arrow_back</span>
                </button>
                <button
                  type="button"
                  onClick={handleGoForward}
                  disabled={!canGoForward}
                  className={`flex items-center justify-center rounded-full transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${canGoForward ? 'text-text-secondary hover:text-primary' : 'text-text-secondary'}`}
                  title="前进"
                >
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
                  title="刷新当前窗口"
                >
                  <span className="material-symbols-outlined text-xl">refresh</span>
                </button>
                {selectors?.newConversationUrl && productMode === 'task_assignment' && (
                  <button
                    type="button"
                    onClick={handleNewConversation}
                    disabled={isLockedModel}
                    className={`flex items-center justify-center rounded-full transition-colors ${isLockedModel ? 'opacity-30 cursor-not-allowed text-text-secondary' : 'text-text-secondary hover:text-primary'}`}
                    title={isLockedModel ? '当前模型参与了全局会话，请使用底部的全局新对话按钮' : '新对话'}
                  >
                    <span className="material-symbols-outlined text-xl">add_comment</span>
                  </button>
                )}
                {headerActions}
              </div>
            </div>
          </>
        )}

        {/* Webview 容器 */}
        <div className="flex-1 relative min-h-0">
          {isLoading && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/50 z-10">
              <div className="flex flex-col items-center gap-3 p-4">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-text-secondary">
                  {elapsedSeconds >= 15 ? '页面加载较慢，请耐心等待...' : `已等待 ${elapsedSeconds}s...`}
                </span>
                {elapsedSeconds >= 25 && (
                  <button
                    type="button"
                    onClick={handleCancelLoad}
                    className="px-4 py-1.5 bg-gray-100 text-text-secondary rounded-lg hover:bg-gray-200 transition-colors text-sm"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          )}

          {(urlMismatch || loadError) && readonlySnapshot && (
            <div className="absolute inset-0 z-20 bg-app flex flex-col">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>history</span>
                <span className="font-medium">历史快照模式</span>
                <span className="text-amber-600">
                  {loadError
                    ? '· 页面加载失败'
                    : readonlySnapshot.reason === 'no_snapshot'
                      ? '· URL 与历史不符且无本地快照'
                      : '· URL 与历史记录不符，显示本地历史回复'}
                </span>
              </div>
              {readonlySnapshot.content ? (
                <div className="flex-1 min-h-0 overflow-auto">
                  <ModelOutputCard
                    id={id}
                    name={name}
                    logo={logo}
                    content={readonlySnapshot.content}
                    selected={true}
                    onToggle={() => {}}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
                  无该模型的本地历史快照，请刷新页面或重试加载
                </div>
              )}
              {loadError && (
                <div className="flex justify-center py-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="px-4 py-1.5 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
                  >
                    重试加载
                  </button>
                </div>
              )}
            </div>
          )}

          {loadError && !readonlySnapshot && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/80 z-10">
              <div className="flex flex-col items-center gap-3 p-6 max-w-sm bg-white rounded-2xl shadow-soft">
                <span className="material-symbols-outlined text-red-500" style={{ fontSize: 48 }}>
                  {loadError.icon}
                </span>
                <p className="text-sm text-text-primary text-center font-medium">{loadError.title}</p>
                <p className="text-xs text-text-secondary text-center font-mono">{loadError.subtitle}</p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-1 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {/* 休眠覆盖层（片段 A，决策 D1）：真卸载页面层后展示，点击唤醒重新 loadURL + 恢复草稿。
              回溯态(readonlySnapshot)优先显示快照覆盖层，休眠调度器白名单(D3)也会在回溯态跳过休眠，此处 && !readonlySnapshot 为防御性兜底。 */}
          {isHibernated && !readonlySnapshot && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/90 z-20 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 p-6 max-w-xs">
                <span className="material-symbols-outlined text-text-secondary text-4xl">bedtime</span>
                <p className="text-sm text-text-primary font-medium text-center">已休眠以节省内存</p>
                <p className="text-xs text-text-secondary text-center">点击唤醒以继续使用</p>
                <button
                  type="button"
                  onClick={() => {
                    if (ref && typeof ref === 'object' && 'current' in ref) {
                      void (ref.current as WebviewCardRef | null)?.resume()
                    }
                  }}
                  className="mt-2 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
                >
                  立即唤醒
                </button>
              </div>
            </div>
          )}

          {/*
            partition: 使用共享的 partition 名称，让所有 webview 共享 cookie 和 session
            - 在一个窗口中登录 Google 账户后，其他窗口也能自动使用已登录状态
            - persist: 前缀确保 session 持久化，关闭应用再打开不需要重新登录
            注意：需要 allowpopups 以便 setWindowOpenHandler 能够拦截弹窗请求
            实际的弹窗控制由主进程的 setWindowOpenHandler 处理
          */}
          <webview
            ref={webviewRef}
            id={`webview-${id}`}
            src="about:blank"
            partition="persist:shared"
            className={`w-full h-full ${((loadError || urlMismatch) && readonlySnapshot) || isHibernated ? 'invisible pointer-events-none' : ''}`}
            allowpopups
            tabIndex={-1}
          />
        </div>
      </div>
    )
  }
)

WebviewCard.displayName = 'WebviewCard'

export default WebviewCard
