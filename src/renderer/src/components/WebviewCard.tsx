import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { defaultSelectors } from '../config/selectors'
import { useAppStore } from '../store/appStore'
import CustomDropdown, { type DropdownOption } from './CustomDropdown'
import {
  generateSendMessageScript,
  generateInsertTextScript,
  generateClearInputScript,
  generateEnableDeepResearchScript,
  generateDisableDeepResearchScript,
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

interface WebviewCardProps {
  id: string
  name: string
  url: string
  logo: string
  enabled: boolean
  slotIndex: number  // 当前卡片所在的位置索引
}

// 重新导出 FileUploadData 类型供其他组件使用
export type { FileUploadData }

// 暴露给父组件的方法
export interface WebviewCardRef {
  sendMessage: (message: string) => Promise<{ success: boolean; error?: string }>
  insertText: (message: string) => Promise<{ success: boolean; error?: string }>
  clearInput: () => Promise<{ success: boolean; error?: string }>
  uploadFile: (fileData: FileUploadData) => Promise<{ success: boolean; error?: string }>
  enableDeepResearch: () => Promise<{ success: boolean; error?: string }>
  disableDeepResearch: () => Promise<{ success: boolean; error?: string }>
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
  ({ id, name, url, logo, enabled, slotIndex }, ref) => {
    const webviewRef = useRef<Electron.WebviewTag>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isReady, setIsReady] = useState(false)
    const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
    const [loadError, setLoadError] = useState<string | null>(null)
    const [canGoBack, setCanGoBack] = useState(false)
    const [canGoForward, setCanGoForward] = useState(false)

    // 从 store 获取所有模型和切换方法
    const models = useAppStore((state) => state.models)
    const swapModelInSlot = useAppStore((state) => state.swapModelInSlot)

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

    // 获取可切换的其他模型（排除当前模型）
    const availableModels = models.filter(m => m.id !== id)

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
        setIsLoading(false)
        setIsReady(true)
        setLoadError(null)
        syncNavigationState()
      }

      const handleLoadStart = (): void => {
        setLoadError(null)
        setIsLoading(true)
      }

      const handleLoadStop = (): void => {
        setIsLoading(false)
        syncNavigationState()
      }

      const handleLoadFail = (event: Electron.DidFailLoadEvent): void => {
        if (!event.isMainFrame) return
        if (event.errorCode === -3) return
        const errorInfo = {
          errorCode: event.errorCode,
          errorDescription: event.errorDescription,
          validatedURL: event.validatedURL,
          isMainFrame: event.isMainFrame
        }
        console.error(`${name} 加载失败:`, errorInfo)
        setIsLoading(false)
        setLoadError(`加载失败: ${event.errorDescription || `错误代码 ${event.errorCode}`}`)
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



      webview.addEventListener('dom-ready', handleDomReady)
      webview.addEventListener('did-start-loading', handleLoadStart)
      webview.addEventListener('did-stop-loading', handleLoadStop)
      webview.addEventListener('did-fail-load', handleLoadFail)
      webview.addEventListener('console-message', handleConsoleMessage)

      // 监听导航事件
      const handleDidNavigate = (_event: any): void => {
        setLoadError(null) // 清除之前的错误
        syncNavigationState()
      }

      const handleDidNavigateInPage = (_event: any): void => {
        syncNavigationState()
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
        webview.removeEventListener('dom-ready', handleDomReady)
        webview.removeEventListener('did-start-loading', handleLoadStart)
        webview.removeEventListener('did-stop-loading', handleLoadStop)
        webview.removeEventListener('did-fail-load', handleLoadFail)
        webview.removeEventListener('console-message', handleConsoleMessage)
        webview.removeEventListener('did-navigate', handleDidNavigate)
        webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage)
        webview.removeEventListener('did-finish-load', handleDidFinishLoad)
      }
    }, [enabled, name, selectors])

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
          const result = await webview.executeJavaScript(code)
          return { success: result.success, error: result.error }
        } catch (error) {
          return { success: false, error: String(error) }
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

          if (detected) {
            return { success: true }
          }
          return { success: false, error: '未检测到上传结果（已触发受信任拖拽）' }
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
        clearNavigationState()

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
          const handleFail = (event: any): void => {
            setIsLoading(false)
            setLoadError(`加载失败: ${event?.errorDescription || `错误代码 ${event?.errorCode}`}`)
            cleanup()
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
      loadURL: (url: string): void => {
        if (webviewRef.current) {
          setIsLoading(true)
          webviewRef.current.loadURL(url)
        }
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

    const status = getStatusDisplay()

    // 单独刷新当前 webview 窗口
    const handleRefresh = () => {
      setLoadError(null)
      setIsLoading(true)
      webviewRef.current?.reload()
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

    if (!enabled) {
      return (
        <div className="flex flex-col h-full min-h-[480px] rounded-lg bg-gray-800/30 ring-1 ring-inset ring-gray-700 opacity-50">
          <div className="p-4 border-b border-gray-700 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <img alt={`${name} logo`} className="w-6 h-6" src={logo} />
              <h2 className="font-semibold text-gray-500">{name}</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500"></span>
              </span>
              已禁用
            </div>
          </div>
          <div className="flex-1 p-4 flex items-center justify-center text-gray-600 min-h-0">
            此模型已禁用
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-col h-full min-h-[480px] rounded-lg bg-gray-800/30 ring-1 ring-inset ring-primary/50 neon-border">
        {/* 卡片头部 */}
        <div className="p-4 border-b border-primary/20 flex justify-between items-center">
          {/* 左侧：模型信息和下拉选择器 */}
          <CustomDropdown
            value={id}
            onChange={(modelId) => {
              swapModelInSlot(slotIndex, modelId)
            }}
            placeholder={name}
            className="relative"
            dropdownWidth="w-48"
            buttonClassName="flex items-center justify-between gap-2 hover:bg-gray-700/50 rounded-lg px-2 py-1 -ml-2 transition-colors"
            renderButton={() => (
              <div className="flex items-center gap-2">
                <img alt={`${name} logo`} className="w-6 h-6" src={logo} />
                <h2 className="font-semibold text-white">{name}</h2>
              </div>
            )}
            renderOption={(option, isSelected, onSelect) => {
              const model = availableModels.find(m => m.id === option.value)
              return (
                <button
                  onClick={onSelect}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-700 transition-colors text-left"
                >
                  <img alt={model?.name || option.label} className="w-5 h-5" src={model?.logo || option.logo} />
                  <span className="text-gray-300 text-sm">{option.label}</span>
                </button>
              )
            }}
            options={modelOptions}
          />

          {/* 右侧：刷新按钮 + 状态指示器 */}
          <div className="flex items-center gap-3 group">
            <button
              type="button"
              onClick={handleGoBack}
              disabled={!canGoBack}
              className={`flex items-center justify-center rounded-full transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${canGoBack ? 'text-gray-300 hover:text-primary' : 'text-gray-600'}`}
              title="后退"
            >
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </button>
            <button
              type="button"
              onClick={handleGoForward}
              disabled={!canGoForward}
              className={`flex items-center justify-center rounded-full transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${canGoForward ? 'text-gray-300 hover:text-primary' : 'text-gray-600'}`}
              title="前进"
            >
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center justify-center rounded-full text-gray-300 hover:text-primary transition-colors"
              title="刷新当前窗口"
            >
              <span className="material-symbols-outlined text-xl">refresh</span>
            </button>
            <div className={`flex items-center gap-2 text-xs ${status.color}`}>
              <span className="relative flex h-2 w-2">
                {status.pulse && (
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${status.dot} opacity-75`}></span>
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${status.dot}`}></span>
              </span>
              {status.text}
            </div>
          </div>
        </div>

        {/* Webview 容器 */}
        <div className="flex-1 relative min-h-0">
          {isLoading && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-gray-400">加载中...</span>
              </div>
            </div>
          )}

          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
              <div className="flex flex-col items-center gap-3 p-4">
                <span className="material-symbols-outlined text-red-500 text-4xl">error</span>
                <p className="text-sm text-red-400 text-center">{loadError}</p>
                <button
                  onClick={() => {
                    setLoadError(null)
                    setIsLoading(true)
                    webviewRef.current?.reload()
                  }}
                  className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
                >
                  重试
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
            src={url}
            partition="persist:shared"
            className="w-full h-full"
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
