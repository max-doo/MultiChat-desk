import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ModelSelector } from '../config/selectors'
import type { WebviewCardRef } from '../components/WebviewCard'
import { generateGetInputTextScript, generateInsertTextScript } from '../utils/webviewScripts'
import { NOTE_CLICK_PREFIX, NOTE_DISMISS_PREFIX } from '../../../shared/types/notes'

// 页面加载诊断（首次加载及后续导航共用）。
const LOAD_TIMEOUT_MS = 30_000

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

interface UseWebviewLifecycleParams {
  webviewRef: RefObject<Electron.WebviewTag>
  id: string
  name: string
  url: string
  enabled: boolean
  selectors: ModelSelector | undefined
  expectedUrl?: string
  onWebviewReady?: (webContentsId: number) => void
}

type WebviewLifecycleMethods = Pick<WebviewCardRef,
  | 'reload'
  | 'resetToInitial'
  | 'getCurrentUrl'
  | 'loadURL'
  | 'suspend'
  | 'resume'
  | 'isHibernated'
>

/** 页面加载、导航、历史 URL 检查与休眠共享同一组状态和计时器。 */
export function useWebviewLifecycle({
  webviewRef, id, name, url, enabled, selectors, expectedUrl, onWebviewReady
}: UseWebviewLifecycleParams) {
  const [isLoading, setIsLoading] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [loadError, updateLoadError] = useState<LoadErrorInfo | null>(null)
  // Webview 监听器在 React 重新渲染前也可能连续触发，同步保留最新错误。
  const loadErrorRef = useRef<LoadErrorInfo | null>(null)
  const setLoadError = (error: LoadErrorInfo | null): void => {
    loadErrorRef.current = error
    updateLoadError(error)
  }
  const expectedUrlRef = useRef(expectedUrl)
  const urlRef = useRef(url)
  expectedUrlRef.current = expectedUrl
  urlRef.current = url
  const [urlMismatch, setUrlMismatch] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  // 跟踪已加载的 URL，避免重复 loadURL
  const loadedUrlRef = useRef<string | null>(null)

  // ── 加载诊断状态 / refs ──
  // elapsedSeconds：用于在 spinner 下方动态显示 "已等待 Ns..."
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  // 页面加载超时计时器
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 已等待秒数 interval
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 是否处于首次加载（dom-ready 后置 false；resetToInitial 重新置 true）
  const isFirstLoadRef = useRef<boolean>(true)

  // 休眠 URL、输入草稿与恢复互斥标记。
  const [isHibernated, setIsHibernated] = useState(false)
  const hibernatedUrlRef = useRef<string | null>(null)
  const hibernatedDraftRef = useRef<string>('')
  const isResumingRef = useRef(false)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !enabled || !onWebviewReady) return
    const report = (): void => {
      try {
        const id = webview.getWebContentsId()
        if (id > 0) onWebviewReady(id)
      } catch { /* Webview 尚未附着 */ }
    }
    webview.addEventListener('dom-ready', report)
    report()
    return () => { webview.removeEventListener('dom-ready', report) }
  }, [webviewRef, enabled, onWebviewReady])

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
   * 若平台会话 ID 位于 query，需为该平台保留对应参数。
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
    const expectedUrl = expectedUrlRef.current
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

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !enabled) return

    // 监听加载事件
    const handleDomReady = (): void => {
      let currentUrl = ''
      try {
        currentUrl = webview.getURL() || ''
      } catch {
        // 忽略获取 URL 异常
      }
      // chrome-error:// / data:text/html：Chromium 把连接/DNS/SSL 等错误直接渲染成内部错误页，
      // 主帧 did-fail-load 不再发出。若不在此主动判定为失败，覆盖层永远不弹（用户只见白屏或 Chromium 自带错误页）。
      if (currentUrl && (currentUrl.startsWith('chrome-error://') || currentUrl.startsWith('data:text/html'))) {
        clearLoadTimers()
        setIsLoading(false)
        isFirstLoadRef.current = false
        const failHost = getHostname(loadedUrlRef.current || currentUrl || '')
        setLoadError({
          category: 'connection',
          icon: 'cloud_off',
          title: `无法连接到 ${failHost}`,
          subtitle: '页面加载失败，请点击重试',
          errorCode: null, // chrome-error 页无 errorCode 透出，null 表示非 did-fail-load 来源
          hostname: failHost
        })
        return
      }
      clearLoadTimers()
      isFirstLoadRef.current = false // 首次加载完成
      setIsLoading(false)
      setIsReady(true)
      setLoadError(null)
      // 不在此处 checkUrlMismatch()：dom-ready 时 SPA 可能仍处于中间重定向 URL，
      // 此刻比较会先误报「URL 与历史不符」、加载完成后再消失，造成覆盖层闪烁。
      // 最终判定交给 handleLoadStop（页面稳定、URL 已落定）。
      syncNavigationState()
    }

    const handleLoadStart = (): void => {
      // 不在这里清空 setLoadError(null)，防止 did-fail-load 报网络错误后 Chromium 内部尝试跳转错误页时触发 start-loading 导致错误弹窗消失
      setIsLoading(true)
      startLoadTimers()
    }

    const handleLoadStop = (): void => {
      // 已判定失败（loadError 存在）或仍在 chrome-error:// 残留态时，不清计时器/不改状态，
      // 避免慢速失败路径上 Chromium 先发的中间态 did-stop-loading 把 30s 超时兜底清掉、
      // 以及错误覆盖层被中间态 stop 抢清。
      if (loadErrorRef.current) {
        syncNavigationState()
        return
      }
      try {
        const u = webview.getURL() || ''
        if (u.startsWith('chrome-error://') || u.startsWith('data:text/html')) {
          syncNavigationState()
          return
        }
      } catch {
        // 忽略获取 URL 异常，按正常 stop 处理
      }
      clearLoadTimers()
      setIsLoading(false)
      syncNavigationState()
      // 加载结束、URL 已落定，此时做最终的不匹配判定，避免加载中途的中间 URL 误报闪烁。
      checkUrlMismatch()
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
      // 笔记消息由 useWebviewNotes 处理，不写入平台日志。
      if (event.message.startsWith(NOTE_DISMISS_PREFIX) || event.message.startsWith(NOTE_CLICK_PREFIX)) return
      if (event.message.startsWith('__MM_LOG__:')) {
        console.log(`[${name}] ${event.message.substring(9)}`)
        return
      }

      // 记录所有级别的消息（0=verbose, 1=info, 2=warning, 3=error）
      if (event.level >= 2) { // 只记录警告和错误
        console.log(`[${name}] Level ${event.level}: ${event.message}`)
      }
    }

    const handleRenderProcessGone = (event: Event & Partial<Electron.RenderProcessGoneDetails> & { details?: Partial<Electron.RenderProcessGoneDetails> }): void => {
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
        hostname: getHostname(loadedUrlRef.current || urlRef.current)
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
    const handleDidNavigate = (): void => {
      // 不在这里清空 setLoadError(null)，由 handleDomReady、主动 loadURL 或重试操作负责清空
      syncNavigationState()
      // 不在此处 checkUrlMismatch()：did-navigate 在重定向链的每一跳都触发，
      // 中间跳的 URL 与历史 expectedUrl 必然不一致，会触发覆盖层闪烁；
      // 最终 URL 的判定由 handleLoadStop 负责。
    }

    const handleDidNavigateInPage = (): void => {
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
  }, [webviewRef, enabled, name, id])

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
  }, [webviewRef, url, enabled, name])

  const methods: WebviewLifecycleMethods = {
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
          webview.removeEventListener('did-stop-loading', handleStop)
          webview.removeEventListener('did-fail-load', handleFail)
        }

        webview.addEventListener('did-stop-loading', handleStop)
        webview.addEventListener('did-fail-load', handleFail)
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
        // 唤醒视同首次加载：复用 30s 超时保护与 -3 中断的错误展示，避免唤醒失败时静默无提示
        isFirstLoadRef.current = true

        const targetUrl = hibernatedUrlRef.current || url
        const draftToRestore = hibernatedDraftRef.current

        console.log(`[${name}] Webview 恢复中:`, targetUrl)

        // 同步 ref，防止 F3 的 loadURL effect 因 loadedUrlRef 为 null 而重复导航
        loadedUrlRef.current = targetUrl
        webview.loadURL(targetUrl)

        // 等待输入框出现并恢复草稿，然后才完成唤醒，避免新注入覆盖草稿。
        if (draftToRestore) {
          let restored = false
          for (let attempt = 0; attempt < 30; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            if (!webviewRef.current || webviewRef.current !== webview) break
            try {
              const code = generateInsertTextScript(draftToRestore, id, selectors)
              const result = await webview.executeJavaScript(code)
              if (result?.success) {
                restored = true
                break
              }
            } catch (e) {
              if (attempt === 29) {
                console.warn(`[${name}] 恢复输入草稿失败:`, e)
              }
            }
          }
          if (!restored) {
            console.warn(`[${name}] 恢复输入草稿超时`)
            setIsHibernated(true)
            return { success: false, error: '恢复输入草稿超时' }
          }
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
  }

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

  const startNewConversation = () => {
    const webview = webviewRef.current
    if (!webview) return
    const newUrl = selectors?.newConversationUrl
    if (!newUrl) return
    setLoadError(null)
    setIsLoading(true)
    webview.loadURL(newUrl)
  }

  return {
    isLoading, isReady, loadError, urlMismatch, canGoBack, canGoForward,
    elapsedSeconds, isHibernated, methods,
    handleRefresh, handleRetry, handleCancelLoad, handleGoBack, handleGoForward,
    startNewConversation
  }
}
