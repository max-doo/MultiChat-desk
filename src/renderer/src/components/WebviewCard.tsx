import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { defaultSelectors } from '../config/selectors'
import { useAppStore, DEEP_RESEARCH_SUPPORTED_MODEL_IDS, IMAGE_GENERATION_SUPPORTED_MODEL_IDS } from '../store/appStore'
import CustomDropdown from './CustomDropdown'
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
}

/**
 * Webview 卡片组件
 * 嵌入 AI 平台的 Web 界面，支持消息发送和响应抓取
 */
const WebviewCard = forwardRef<WebviewCardRef, WebviewCardProps>(
  ({ id, name, url, logo, enabled, slotIndex, compact, hideHeader, onModelChange, isolated, headerActions, draggableHeader, flat, onDragStart }, ref) => {
    const hostRef = useRef<HTMLDivElement>(null)
    const [viewId, setViewId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isReady, setIsReady] = useState(false)
    const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
    const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null)
    const [canGoBack, setCanGoBack] = useState(false)
    const [canGoForward, setCanGoForward] = useState(false)
    const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null)
    const [overlayActive, setOverlayActive] = useState(false)
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)

    const leftOverlayOpen = useAppStore(state => state.leftOverlayOpen)
    const rightOverlayOpen = useAppStore(state => state.rightOverlayOpen)
    const modalOpen = useAppStore(state => state.modalOpen)
    const displayMode = useAppStore(state => state.displayMode)

    const isLeftSlot = (sIdx: number, mode: string): boolean => {
      if (mode === 'one') return true
      if (mode === 'two') return sIdx === 0
      if (mode === 'three') return sIdx === 0
      if (mode === 'four') return sIdx === 0 || sIdx === 2
      return false
    }

    const isRightSlot = (sIdx: number, mode: string): boolean => {
      if (mode === 'one') return true
      if (mode === 'two') return sIdx === 1
      if (mode === 'three') return sIdx === 2
      if (mode === 'four') return sIdx === 1 || sIdx === 3
      return false
    }

    const needsOverlay = 
      modalOpen ||
      leftOverlayOpen ||
      rightOverlayOpen ||
      isDropdownOpen

    useEffect(() => {
      let active = true;
      if (needsOverlay && viewId && isReady) {
        window.api.captureWebviewPage(viewId).then(res => {
          if (!active) return;
          if (res.success && res.data?.dataUrl) {
            setScreenshotDataUrl(res.data.dataUrl)
          }
          setOverlayActive(true)
        }).catch(() => {
          if (active) setOverlayActive(true)
        })
      } else {
        // 当关闭抽屉时，延迟300ms等待CSS过渡动画结束再销毁截图
        const t = setTimeout(() => {
          if (active) {
            setScreenshotDataUrl(null)
            setOverlayActive(false)
          }
        }, 300)
        return () => { active = false; clearTimeout(t) }
      }
      return () => { active = false }
    }, [needsOverlay, viewId, isReady])

    const shouldHideWebview = loadError || isLoading || overlayActive

    // 跟踪已加载 of URL，避免重复 loadURL
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

    const syncNavigationState = async (): Promise<void> => {
      if (!viewId) return
      try {
        const state = await window.api.getWebviewNavState(viewId)
        if (state.success && state.data) {
          setCanGoBack(state.data.canGoBack)
          setCanGoForward(state.data.canGoForward)
        }
      } catch {
        setCanGoBack(false)
        setCanGoForward(false)
      }
    }

    // ── WebContentsView 生命周期与布局同步 ──
    useEffect(() => {
      if (!enabled) return

      let activeViewId: string | null = null
      let resizeObserver: ResizeObserver | null = null
      let scrollCleanup: (() => void) | null = null
      let animationFrameId: number | null = null

      const initView = async () => {
        const res = await window.api.createWebviewView({
          slotKey: `slot-${slotIndex}-${id}`,
          partition: 'persist:shared'
        })
        if (res.success && res.data?.viewId) {
          activeViewId = res.data.viewId
          setViewId(activeViewId)

          // 使用 requestAnimationFrame 节流更新边界并限制溢出
          const requestUpdateBounds = () => {
            if (animationFrameId !== null) return
            animationFrameId = requestAnimationFrame(() => {
              animationFrameId = null
              if (!hostRef.current || !activeViewId) return
              const rect = hostRef.current.getBoundingClientRect()
              
              let x = Math.round(rect.left)
              let y = Math.round(rect.top)
              let width = Math.round(rect.width)
              let height = Math.round(rect.height)
              
              // 限制垂直方向溢出，不覆盖顶部 Toolbar(38px)
              const topToolbarHeight = 38
              if (y < topToolbarHeight) {
                const overflow = topToolbarHeight - y
                y = topToolbarHeight
                height = Math.max(0, height - overflow)
              }
              
              // 限制底部不溢出窗口
              const windowHeight = window.innerHeight
              if (y + height > windowHeight) {
                height = Math.max(0, windowHeight - y)
              }
              
              if (width <= 0 || height <= 0) {
                window.api.hideWebviewView({ viewId: activeViewId })
              } else {
                window.api.showWebviewView({ viewId: activeViewId })
                window.api.setWebviewBounds({
                  viewId: activeViewId,
                  bounds: { x, y, width, height }
                })
              }
            })
          }

          // 绑定 ResizeObserver
          if (hostRef.current) {
            resizeObserver = new ResizeObserver(() => {
              requestUpdateBounds()
            })
            resizeObserver.observe(hostRef.current)
          }

          // 监听滚动事件实时更新
          window.addEventListener('scroll', requestUpdateBounds, true)
          window.addEventListener('resize', requestUpdateBounds)

          scrollCleanup = () => {
            window.removeEventListener('scroll', requestUpdateBounds, true)
            window.removeEventListener('resize', requestUpdateBounds)
          }

          // 初始加载 URL
          if (url) {
            window.api.loadWebviewURL(activeViewId, url)
            loadedUrlRef.current = url
            setIsLoading(true)
            setLoadError(null)
          }
        }
      }

      initView()

      return () => {
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId)
        }
        if (resizeObserver) resizeObserver.disconnect()
        if (scrollCleanup) scrollCleanup()
        if (activeViewId) {
          window.api.removeWebviewView({ viewId: activeViewId })
        }
      }
    }, [enabled, id, slotIndex])

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
    const triggerLoadTimeout = async (): Promise<void> => {
      try { if (viewId) await window.api.webviewStop(viewId) } catch { /* ignore */ }
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


    // ── 事件订阅 ──
    useEffect(() => {
      if (!enabled || !viewId) return

      // 监听加载事件
      const handleDomReady = async (): Promise<void> => {
        try {
          const currentUrlRes = await window.api.getWebviewURL(viewId)
          const currentUrl = currentUrlRes.success && currentUrlRes.data ? currentUrlRes.data.url : ''
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
        syncNavigationState()
      }

      const handleLoadStart = (): void => {
        setIsLoading(true)
        startLoadTimers()
      }

      const handleLoadStop = (): void => {
        clearLoadTimers()
        setIsLoading(false)
        syncNavigationState()
      }

      const handleLoadFail = (data: any): void => {
        if (!data.isMainFrame) return
        if (data.errorCode === -3) {
          clearLoadTimers()
          setIsLoading(false)
          if (isFirstLoadRef.current) {
            const failHost = getHostname(data.validatedURL || loadedUrlRef.current || '')
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
        setIsLoading(false)
        const failHost = getHostname(data.validatedURL || loadedUrlRef.current || '')
        setLoadError(classifyError(data.errorCode, failHost))
      }

      const handleConsoleMessage = (data: any): void => {
        if (!data || !data.message) return
        if (data.message.startsWith('__MM_LOG__:')) {
          console.log(`[${name}] ${data.message.substring(9)}`)
          return
        }
        if (data.level >= 2) {
          console.log(`[${name}] Level ${data.level}: ${data.message}`)
        }
      }

      const handleRenderProcessGone = (data: any): void => {
        console.error(`[${name}] 渲染进程崩溃/退出! reason: ${data?.reason || 'unknown'}`, data)
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

      const handleDidNavigate = (): void => syncNavigationState()
      const handleDidNavigateInPage = (): void => syncNavigationState()
      const handleDidFinishLoad = (): void => syncNavigationState()

      const unsubscribe = window.api.onWebviewEvent((payload) => {
        if (payload.viewId !== viewId) return
        switch (payload.type) {
          case 'dom-ready': handleDomReady(); break;
          case 'did-start-loading': handleLoadStart(); break;
          case 'did-stop-loading': handleLoadStop(); break;
          case 'did-fail-load': handleLoadFail(payload.data); break;
          case 'console-message': handleConsoleMessage(payload.data); break;
          case 'render-process-gone': handleRenderProcessGone(payload.data); break;
          case 'did-navigate': handleDidNavigate(); break;
          case 'did-navigate-in-page': handleDidNavigateInPage(); break;
          case 'did-finish-load': handleDidFinishLoad(); break;
        }
      })

      return () => {
        clearLoadTimers()
        unsubscribe()
      }
    }, [enabled, name, selectors, viewId])

    // F3: 使用 loadURL() 主动导航，替代不可靠的 <webview src> 属性
    // Electron <webview> 的 src 属性在冷启动时经常不触发导航，导致页面空白
    useEffect(() => {
      if (!viewId || !enabled || !url) return
      if (loadedUrlRef.current === url) return

      const doLoad = (): void => {
        try {
          console.log(`[${name}] loadURL: ${url}`)
          loadedUrlRef.current = url
          setIsLoading(true)
          setLoadError(null)
          window.api.loadWebviewURL(viewId, url)
        } catch (e) {
          console.error(`[${name}] loadURL failed:`, e)
        }
      }

      doLoad()
    }, [url, enabled, name, viewId])

    // 暴露方法给父组件
    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      sendMessage: async (message: string): Promise<{ success: boolean; error?: string }> => {
        if (!viewId) return { success: false, error: 'viewId 为空' }
        if (!isReady) return { success: false, error: 'Webview 未就绪' }
        if (!selectors) return { success: false, error: '选择器配置不存在' }
        setSendStatus('sending')
        try {
          const code = generateSendMessageScript(message, id, selectors)
          const result = await window.api.executeWebviewScript(viewId, code)
          if (result.success) {
            setSendStatus('success')
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: true }
          } else {
            setSendStatus('error')
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: false, error: result.error }
          }
        } catch (error) {
          setSendStatus('error')
          setTimeout(() => setSendStatus('idle'), 3000)
          return { success: false, error: String(error) }
        }
      },
      insertText: async (message: string): Promise<{ success: boolean; error?: string }> => {
        if (!viewId) return { success: false, error: 'viewId 为空' }
        if (!isReady) return { success: false, error: 'Webview 未就绪' }
        if (!selectors) return { success: false, error: '选择器配置不存在' }
        try {
          const code = generateInsertTextScript(message, id, selectors)
          const result = await window.api.executeWebviewScript(viewId, code)
          const data = result.data as any || {}
          return { success: result.success && (data.success !== false), error: result.error || data.error }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
      clearInput: async (): Promise<{ success: boolean; error?: string }> => {
        if (!viewId || !isReady || !selectors) return { success: false, error: 'Webview 未就绪' }
        try {
          const code = generateClearInputScript(selectors)
          const result = await Promise.race([
            window.api.executeWebviewScript(viewId, code),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('执行超时')), 400))
          ])
          const data = result.data as any || {}
          return { success: result.success && (data.success !== false), error: result.error || data.error }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
      getInputText: async (): Promise<{ success: boolean; text?: string; error?: string }> => {
        if (!viewId || !isReady || !selectors) return { success: false, text: '', error: 'Webview 未就绪' }
        try {
          const code = generateGetInputTextScript(selectors)
          const result = await Promise.race([
            window.api.executeWebviewScript(viewId, code),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('执行超时')), 400))
          ])
          const data = result.data as any || {}
          return { success: result.success && (data.success !== false), text: data.text || '', error: result.error || data.error }
        } catch (error) {
          return { success: false, text: '', error: String(error) }
        }
      },
      uploadFile: async (fileData: FileUploadData): Promise<{ success: boolean; error?: string }> => {
        if (!viewId || !isReady || !selectors) return { success: false, error: 'Webview 未就绪' }
        try {
          const wcRes = await window.api.getWebviewWebContentsId(viewId)
          const webContentsId = wcRes.success && wcRes.data ? wcRes.data.webContentsId : null
          if (!window.api?.dispatchFileDrop) return { success: false, error: '缺少 dispatchFileDrop，无法拖拽上传' }
          if (!fileData?.filePath) return { success: false, error: '缺少 filePath，无法拖拽上传' }
          if (typeof webContentsId !== 'number') return { success: false, error: '无法获取 webContentsId，无法拖拽上传' }
          const pointRes = await window.api.executeWebviewScript(viewId, `
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
          const point = pointRes.success ? (pointRes.data as any) : null
          const dropResult = await window.api.dispatchFileDrop(webContentsId, fileData.filePath, point?.x ?? 10, point?.y ?? 10)
          if (!dropResult?.success) return { success: false, error: dropResult?.error || '文件拖拽上传失败' }
          const detectedRes = await window.api.executeWebviewScript(viewId, `
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
                  if ((aria && aria.includes(fileName)) || (title && title.includes(fileName)) || (dataName && dataName.includes(fileName))) return true;
                }
                await new Promise(r => setTimeout(r, 200));
              }
              return false;
            })();
          `)
          return { success: true }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
      enableDeepResearch: async (): Promise<{ success: boolean; error?: string }> => {
        if (!viewId || !isReady || !selectors) return { success: false, error: 'Webview 未就绪' }
        if (!selectors.researchMode?.button && !selectors.researchMode?.steps) return { success: false, error: '不支持 Deep Research' }
        try {
          const code = generateEnableDeepResearchScript(selectors.researchMode)
          const result = await window.api.executeWebviewScript(viewId, code)
          const data = result.data as any || {}
          return { success: result.success && (data.success !== false), error: result.error || data.error }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
      disableDeepResearch: async (): Promise<{ success: boolean; error?: string }> => {
        if (!viewId || !isReady || !selectors) return { success: false, error: 'Webview 未就绪' }
        if (!selectors.researchMode?.cancelSteps) return { success: false, error: '不支持取消' }
        try {
          const code = generateDisableDeepResearchScript(selectors.researchMode)
          const result = await window.api.executeWebviewScript(viewId, code)
          const data = result.data as any || {}
          return { success: result.success && (data.success !== false), error: result.error || data.error }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
      enableImageGeneration: async (): Promise<{ success: boolean; error?: string }> => {
        if (!viewId || !isReady || !selectors) return { success: false, error: 'Webview 未就绪' }
        if (!selectors.imageGeneration?.steps) return { success: false, error: '不支持生图' }
        try {
          const code = generateEnableImageGenerationScript(selectors.imageGeneration)
          const result = await window.api.executeWebviewScript(viewId, code)
          const data = result.data as any || {}
          return { success: result.success && (data.success !== false), error: result.error || data.error }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
      disableImageGeneration: async (): Promise<{ success: boolean; error?: string }> => {
        if (!viewId || !isReady || !selectors) return { success: false, error: 'Webview 未就绪' }
        if (!selectors.imageGeneration?.cancelSteps) return { success: false, error: '不支持取消' }
        try {
          const code = generateDisableImageGenerationScript(selectors.imageGeneration)
          const result = await window.api.executeWebviewScript(viewId, code)
          const data = result.data as any || {}
          return { success: result.success && (data.success !== false), error: result.error || data.error }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
      getLatestResponse: async (): Promise<string> => {
        if (!viewId || !isReady || !selectors) return ''
        try {
          if (id === 'gemini') {
            const canvasContent = await extractGeminiCanvasContent(viewId as any, window.api as any, turndownService)
            if (canvasContent) return canvasContent
          }
          const code = generateGetLatestResponseScript(selectors)
          const result = await window.api.executeWebviewScript(viewId, code)
          return result.success ? String(result.data || '') : ''
        } catch (error) {
          return ''
        }
      },
      reload: (): void => {
        if (viewId) window.api.reloadWebview(viewId)
      },
      resetToInitial: async (): Promise<{ success: boolean; error?: string }> => {
        if (!viewId) return { success: false, error: 'viewId 为空' }
        const clearNavigationState = (): void => {
          setCanGoBack(false)
          setCanGoForward(false)
          try { window.api.clearWebviewHistory(viewId) } catch { /* ignore */ }
        }
        setLoadError(null)
        setIsLoading(true)
        setElapsedSeconds(0)
        isFirstLoadRef.current = true
        clearNavigationState()
        loadedUrlRef.current = url
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          let timeoutHandle: ReturnType<typeof setTimeout>
          const unsubscribe = window.api.onWebviewEvent((payload) => {
            if (payload.viewId !== viewId) return
            if (payload.type === 'did-stop-loading') {
              setIsLoading(false)
              clearNavigationState()
              setTimeout(() => clearNavigationState(), 300)
              cleanup()
              resolve({ success: true })
            } else if (payload.type === 'did-fail-load') {
              const event = payload.data as any
              cleanup()
              if (event?.errorCode === -3) {
                resolve({ success: false, error: 'aborted' })
                return
              }
              setIsLoading(false)
              const failHost = getHostname(event?.validatedURL || url)
              setLoadError(classifyError(event?.errorCode ?? null, failHost))
              resolve({ success: false, error: event?.errorDescription || String(event?.errorCode) })
            }
          })
          const cleanup = (): void => {
            if (timeoutHandle) clearTimeout(timeoutHandle)
            unsubscribe()
          }
          timeoutHandle = setTimeout(() => {
            cleanup()
            resolve({ success: false, error: '加载超时' })
          }, LOAD_TIMEOUT_MS)
          try {
            window.api.loadWebviewURL(viewId, url)
          } catch (error) {
            cleanup()
            resolve({ success: false, error: String(error) })
          }
        })
      },
      getCurrentUrl: (): string => {
        return loadedUrlRef.current || ''
      },
      loadURL: (targetUrl: string): void => {
        if (viewId) {
          loadedUrlRef.current = targetUrl
          setIsLoading(true)
          window.api.loadWebviewURL(viewId, targetUrl)
        }
      }
    }))

    // 单独刷新当前 webview 窗口
    const handleRefresh = () => {
      clearLoadTimers()
      setLoadError(null)
      setIsLoading(true)
      setElapsedSeconds(0)
      if (viewId) window.api.reloadWebview(viewId)
    }

    // 错误覆盖层“重试”：清除错误并重新加载（保持首次加载超时保护）
    const handleRetry = (): void => {
      clearLoadTimers()
      setLoadError(null)
      setIsLoading(true)
      setElapsedSeconds(0)
      isFirstLoadRef.current = true
      if (viewId) window.api.reloadWebview(viewId)
    }

    // 加载中“取消”：手动触发超时错误展示
    const handleCancelLoad = (): void => {
      triggerLoadTimeout()
    }

    const handleGoBack = () => {
      if (!viewId) return
      setLoadError(null)
      if (canGoBack) {
        setIsLoading(true)
        window.api.webviewGoBack(viewId)
      }
    }

    const handleGoForward = () => {
      if (!viewId) return
      setLoadError(null)
      if (canGoForward) {
        setIsLoading(true)
        window.api.webviewGoForward(viewId)
      }
    }

    const handleNewConversation = () => {
      if (!viewId) return
      const newUrl = selectors?.newConversationUrl
      if (!newUrl) return
      setLoadError(null)
      setIsLoading(true)
      window.api.loadWebviewURL(viewId, newUrl)
      // 只有在非活动状态下才允许其重置全局会话标志，防止破坏其他窗口的锁
      if (!useAppStore.getState().activeModels.length) {
        useAppStore.getState().setNewSession(true)
      }
    }

    // Replaced native menu with CustomDropdown

    if (!enabled) {
      return (
        <div className={`flex flex-col h-full opacity-50 overflow-hidden ${flat ? 'bg-white' : 'rounded-2xl glass-panel shadow-soft'} min-h-0`}>
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
      <div className={`flex flex-col h-full overflow-hidden ${flat ? 'bg-white' : 'rounded-2xl glass-panel shadow-soft'} min-h-0`}>
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
                  options={(productMode === 'task_assignment' || isolated || !!onModelChange ? models : models.filter(m => m.id !== id)).map((opt: any) => ({
                    value: opt.id,
                    label: opt.name,
                    logo: opt.logo
                  }))}
                  value={id}
                  onChange={(modelId) => {
                    if (onModelChange) {
                      onModelChange(modelId as string)
                    } else if (productMode === 'task_assignment') {
                      setTaskAssignmentSlot(slotIndex, modelId as string)
                    } else {
                      swapModelInSlot(slotIndex, modelId as string)
                    }
                  }}
                  disabled={isSessionActive}
                  onOpenChange={setIsDropdownOpen}
                  buttonClassName={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 -ml-2 transition-colors ${isSessionActive ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                  renderButton={() => (
                    <div className="flex items-center gap-2">
                      <img alt={`${name} logo`} className="w-6 h-6" src={logo} />
                      <h2 className="font-semibold text-text-primary">{name}</h2>
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
                  dropdownWidth="w-48"
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
        <div className="flex-1 relative min-h-0 rounded-b-2xl overflow-hidden bg-white">
          {/* 截屏障眼法图层 */}
          {screenshotDataUrl && (
            <div 
              className="absolute inset-0 z-0 bg-white"
              style={{ backgroundImage: `url(${screenshotDataUrl})`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' }}
            />
          )}

          {isLoading && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/50 z-10 rounded-b-2xl">
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

          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/80 z-10 rounded-b-2xl">
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

          {/* 主进程 WebContentsView 容器 */}
          <div
            ref={hostRef}
            id={`webview-host-${id}`}
            data-mm-view-id={viewId}
            className={`w-full h-full ${shouldHideWebview ? 'hidden' : ''}`}
          />
        </div>
      </div>
    )
  }
)

WebviewCard.displayName = 'WebviewCard'

export default WebviewCard
