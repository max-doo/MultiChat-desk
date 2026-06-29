import re

with open('src/renderer/src/components/WebviewCard.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace webviewRef with hostRef and viewId
content = content.replace(
    'const webviewRef = useRef<Electron.WebviewTag>(null)',
    'const hostRef = useRef<HTMLDivElement>(null)\n    const [viewId, setViewId] = useState<string | null>(null)'
)

content = content.replace(
    '''    const syncNavigationState = (): void => {
      const webview = webviewRef.current
      if (!webview) return
      try {
        setCanGoBack(webview.canGoBack())
        setCanGoForward(webview.canGoForward())
      } catch {
        setCanGoBack(false)
        setCanGoForward(false)
      }
    }''',
    '''    const syncNavigationState = async (): Promise<void> => {
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

      const initView = async () => {
        const res = await window.api.createWebviewView({
          slotKey: `slot-${slotIndex}-${id}`,
          partition: 'persist:shared'
        })
        if (res.success && res.data?.viewId) {
          activeViewId = res.data.viewId
          setViewId(activeViewId)

          // 绑定 ResizeObserver
          if (hostRef.current) {
            resizeObserver = new ResizeObserver((entries) => {
              for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect()
                window.api.setWebviewBounds({
                  viewId: activeViewId!,
                  bounds: {
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                  }
                })
              }
            })
            resizeObserver.observe(hostRef.current)
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
        if (resizeObserver) resizeObserver.disconnect()
        if (activeViewId) {
          window.api.removeWebviewView({ viewId: activeViewId })
        }
      }
    }, [enabled, id, slotIndex])'''
)

# 2. Event listener replacement
old_events_start = content.find("    useEffect(() => {\n      const webview = webviewRef.current\n      if (!webview || !enabled) return")
old_events_end = content.find("    }, [enabled, name, selectors])") + len("    }, [enabled, name, selectors])")

new_events = '''    // ── 事件订阅 ──
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
    }, [enabled, name, selectors, viewId])'''

content = content[:old_events_start] + new_events + content[old_events_end:]

# 3. F3 effect replacement
content = content.replace(
'''    useEffect(() => {
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
    }, [url, enabled, name])''',
'''    useEffect(() => {
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
    }, [url, enabled, name, viewId])'''
)

# 4. useImperativeHandle block replacement
start_idx = content.find('    useImperativeHandle(ref, () => ({')
end_idx = content.find('    // 获取状态指示器的显示内容')

new_block = '''    // 暴露方法给父组件
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
          try { window.api.clearWebviewHistory(viewId) } catch {}
        }
        setLoadError(null)
        setIsLoading(true)
        setElapsedSeconds(0)
        isFirstLoadRef.current = true
        clearNavigationState()
        loadedUrlRef.current = url
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          let timeoutHandle: any;
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
'''
content = content[:start_idx] + new_block + content[end_idx:]

# 5. triggerLoadTimeout, render buttons & host element
content = content.replace(
'''    const triggerLoadTimeout = (): void => {
      try { webviewRef.current?.stop() } catch { /* ignore */ }''',
'''    const triggerLoadTimeout = async (): Promise<void> => {
      try { if (viewId) await window.api.webviewStop(viewId) } catch { /* ignore */ }'''
)

content = content.replace('webviewRef.current?.reload()', 'if (viewId) window.api.reloadWebview(viewId)')

content = content.replace(
'''    const handleGoBack = () => {
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
    }''',
'''    const handleGoBack = () => {
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
    }'''
)

content = content.replace(
'''    const handleNewConversation = () => {
      const webview = webviewRef.current
      if (!webview) return
      const newUrl = selectors?.newConversationUrl
      if (!newUrl) return
      setLoadError(null)
      setIsLoading(true)
      webview.loadURL(newUrl)''',
'''    const handleNewConversation = () => {
      if (!viewId) return
      const newUrl = selectors?.newConversationUrl
      if (!newUrl) return
      setLoadError(null)
      setIsLoading(true)
      window.api.loadWebviewURL(viewId, newUrl)'''
)

content = content.replace(
'''          {/* 
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
            className={`w-full h-full ${loadError ? 'invisible pointer-events-none' : ''}`}
            allowpopups
            tabIndex={-1}
          />''',
'''          {/* 主进程 WebContentsView 容器 */}
          <div
            ref={hostRef}
            id={`webview-host-${id}`}
            data-mm-view-id={viewId}
            className={`w-full h-full ${loadError ? 'invisible pointer-events-none' : ''}`}
          />'''
)

with open('src/renderer/src/components/WebviewCard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
