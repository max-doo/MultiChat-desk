import { useState, useRef, useEffect } from 'react'

const BrowserPage = (): JSX.Element => {
  const [url, setUrl] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [_title, setTitle] = useState('')
  // 使用 callback ref 来捕获 webview 实例，确保在挂载时绑定事件
  const [webview, setWebview] = useState<Electron.WebviewTag | null>(null)

  // 保持 webview 实例的引用以便在闭包中使用
  const webviewRef = useRef<Electron.WebviewTag | null>(null)

  useEffect(() => {
    // Parse URL from hash: #browser?url=...
    const parseUrl = () => {
      const hash = window.location.hash
      console.log('[BrowserPage] Current hash:', hash)

      try {
        // Handle cases like #/browser?url=... or #browser?url=...
        const queryPart = hash.includes('?') ? hash.split('?')[1] : ''
        const params = new URLSearchParams(queryPart)
        const targetUrl = params.get('url')

        console.log('[BrowserPage] Parsed targetUrl:', targetUrl)

        if (targetUrl) {
          const decodedUrl = decodeURIComponent(targetUrl)
          setUrl(decodedUrl)
          setInputUrl(decodedUrl)
        } else {
          console.warn('[BrowserPage] No url parameter found in hash')
        }
      } catch (error) {
        console.error('[BrowserPage] Error parsing hash:', error)
      }
    }

    parseUrl()

    // Listen for hash changes just in case
    window.addEventListener('hashchange', parseUrl)
    return () => window.removeEventListener('hashchange', parseUrl)
  }, [])

  // 当 webview 实例变化时绑定事件
  useEffect(() => {
    if (!webview) return

    webviewRef.current = webview

    const handleDidStartLoading = () => {
      setIsLoading(true)
    }

    const handleDidStopLoading = () => {
      setIsLoading(false)
      setTitle(webview.getTitle())
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }

    const handleDidNavigate = (e: any) => {
      setInputUrl(e.url)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }

    const handleDidNavigateInPage = (e: any) => {
      setInputUrl(e.url)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }

    const handleFailLoad = (e: any) => {
      setIsLoading(false)
      console.error('Load failed:', e)
      // 如果是取消加载（通常由重定向引起），不视为错误
      if (e.errorCode === -3) return
    }

    const handleCrashed = () => {
      console.error('Webview crashed')
      setIsLoading(false)
    }

    const handleNewWindow = (e: any) => {
      // 处理新窗口请求
      if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
        // 对于 Google 账号相关的 URL，使用应用内浏览器窗口打开
        // 这允许 OAuth 流程正确完成，特别是账号选择器页面
        if (e.url.includes('accounts.google.com')) {
          window.api.openBrowserWindow(e.url)
        } else {
          // 其他链接在当前 webview 中导航
          webview.loadURL(e.url)
        }
      }
    }

    webview.addEventListener('did-start-loading', handleDidStartLoading)
    webview.addEventListener('did-stop-loading', handleDidStopLoading)
    webview.addEventListener('did-navigate', handleDidNavigate)
    webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage)
    webview.addEventListener('did-fail-load', handleFailLoad)
    webview.addEventListener('crashed', handleCrashed)
    webview.addEventListener('new-window', handleNewWindow)

    // 初始状态检查：不要直接调用 webview.isLoading()，因为此时 webview 可能还未 ready
    // 等待 dom-ready 事件或直接假设初始是 loading
    setIsLoading(true)

    const handleDomReady = () => {
      setIsLoading(false)
      // 尝试在 dom-ready 时再次设置 URL，以防 src 属性未生效
      if (webview.getURL() === 'about:blank' && url) {
        webview.loadURL(url)
      }
    }
    webview.addEventListener('dom-ready', handleDomReady)

    return () => {
      webview.removeEventListener('did-start-loading', handleDidStartLoading)
      webview.removeEventListener('did-stop-loading', handleDidStopLoading)
      webview.removeEventListener('did-navigate', handleDidNavigate)
      webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage)
      webview.removeEventListener('did-fail-load', handleFailLoad)
      webview.removeEventListener('crashed', handleCrashed)
      webview.removeEventListener('new-window', handleNewWindow)
      webview.removeEventListener('dom-ready', handleDomReady)
    }
  }, [webview, url]) // 添加 url 作为依赖

  const handleGoBack = () => {
    webviewRef.current?.goBack()
  }

  const handleGoForward = () => {
    webviewRef.current?.goForward()
  }

  const handleReload = () => {
    webviewRef.current?.reload()
  }

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(inputUrl)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      let newUrl = inputUrl
      if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
        newUrl = 'https://' + newUrl
      }
      setUrl(newUrl)
    }
  }

  return (
    <div className="flex flex-col h-full bg-app text-text-primary overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 bg-sidebar border-b border-gray-200">
        <button
          onClick={handleGoBack}
          disabled={!canGoBack}
          className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${!canGoBack ? 'opacity-30 cursor-not-allowed' : ''}`}
          title="后退"
        >
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </button>

        <button
          onClick={handleGoForward}
          disabled={!canGoForward}
          className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${!canGoForward ? 'opacity-30 cursor-not-allowed' : ''}`}
          title="前进"
        >
          <span className="material-symbols-outlined text-xl">arrow_forward</span>
        </button>

        <button
          onClick={handleReload}
          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          title="刷新"
        >
          <span className={`material-symbols-outlined text-xl ${isLoading ? 'animate-spin' : ''}`}>
            {isLoading ? 'refresh' : 'refresh'}
          </span>
        </button>

        {/* Address Bar */}
        <div className="flex-grow flex items-center bg-app rounded-full px-3 py-1.5 border border-gray-200 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
          <span className="material-symbols-outlined text-gray-500 text-sm mr-2">lock</span>
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleInputKeyDown}
            className="flex-grow bg-transparent border-none outline-none text-base text-text-primary placeholder-gray-500"
            placeholder="输入网址..."
          />
        </div>

        <button
          onClick={handleCopyUrl}
          className="p-2 rounded-full hover:bg-gray-100 transition-colors text-text-secondary hover:text-text-primary"
          title="复制网址"
        >
          <span className="material-symbols-outlined text-xl">content_copy</span>
        </button>
      </div>

      {/* Webview */}
      <div className="flex-grow relative bg-white">
        {!url ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p>未提供 URL</p>
              <p className="text-xs mt-2 opacity-50">{window.location.hash}</p>
            </div>
          </div>
        ) : (
          <>
            <webview
              ref={(el) => setWebview(el as unknown as Electron.WebviewTag | null)}
              src={url}
              className="w-full h-full"
              partition="persist:shared"
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              webpreferences="nativeWindowOpen=yes"
              allowpopups
            />
          </>
        )}
      </div>
    </div>
  )
}

export default BrowserPage
