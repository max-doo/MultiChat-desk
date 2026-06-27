import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import WebviewCard, { WebviewCardRef } from '../components/WebviewCard'
import ControlBar, { ControlBarRef } from '../components/ControlBar'
import HistoryDrawer from '../components/HistoryDrawer'
import { useAppStore, getDisplayedModels, SummaryHistoryItem } from '../store/appStore'

interface MainPageProps {
  onNavigateToSummary: (historyItem?: SummaryHistoryItem) => void
  isActive: boolean
}

/**
 * 主页面组件
 * 包含 Webview 卡片、控制栏和抽屉组件
 */
function MainPage({ onNavigateToSummary, isActive }: MainPageProps): JSX.Element {
  const isHistoryOpen = useAppStore((state) => state.isHistoryOpen)
  const setHistoryOpen = useAppStore((state) => state.setHistoryOpen)
  const [activeHistoryId, setActiveHistoryId] = useState<string | undefined>(undefined)
  const [containerWidth, setContainerWidth] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const [suppressPaneTransition, setSuppressPaneTransition] = useState(false)

  const models = useAppStore((state) => state.models)
  const displayMode = useAppStore((state) => state.displayMode)
  const productMode = useAppStore((state) => state.productMode)
  const taskAssignmentSlots = useAppStore((state) => state.taskAssignmentSlots)
  const registerWebviewRef = useAppStore((state) => state.registerWebviewRef)
  const reorderModels = useAppStore((state) => state.reorderModels)
  const getAllResponses = useAppStore((state) => state.getAllResponses)
  const setPendingSummarySession = useAppStore((state) => state.setPendingSummarySession)
  const history = useAppStore((state) => state.history)
  const paneRatios = useAppStore((state) => state.paneRatios)
  const setPaneRatios = useAppStore((state) => state.setPaneRatios)
  const resetPaneRatios = useAppStore((state) => state.resetPaneRatios)

  // ControlBar 的 ref
  const controlBarRef = useRef<ControlBarRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRatiosRef = useRef<number[] | null>(null)
  const dragRef = useRef<{
    gutterIndex: number
    pointerId: number
    startX: number
    startLeftPx: number
    startRightPx: number
    availableWidth: number
    minPaneWidthPx: number
    paneCount: number
  } | null>(null)

  const scrapingControllerRef = useRef<AbortController | null>(null)

  // 为每个模型创建 ref
  const webviewRefs = useRef<Map<string, WebviewCardRef>>(new Map())

  // 注册 webview ref 的回调 - 增加 slotIndex
  const createRefCallback = useCallback((id: string, slotIndex: number) => (ref: WebviewCardRef | null) => {
    const slotKey = `slot-${slotIndex}`
    if (ref) {
      webviewRefs.current.set(slotKey, ref)
      webviewRefs.current.set(id, ref)
      registerWebviewRef(slotKey, ref)
      registerWebviewRef(id, ref)
    } else {
      webviewRefs.current.delete(slotKey)
      webviewRefs.current.delete(id)
    }
  }, [registerWebviewRef])

  const handleGenerateReport = async () => {
    if (scrapingControllerRef.current) {
      scrapingControllerRef.current.abort()
    }
    const controller = new AbortController()
    scrapingControllerRef.current = controller

    // 显示"正在爬取"通知（不自动清除）
    if (controlBarRef.current) {
      controlBarRef.current.showNotification('info', '正在爬取模型回答... (按 ESC 强行退出)', 0)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && scrapingControllerRef.current === controller) {
        controller.abort()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    try {
      const responses = await getAllResponses({ signal: controller.signal, timeoutMs: 10000 })

      if (controller.signal.aborted) {
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('info', '已强行退出爬取模型回答')
        }
        return
      }

      const validResponses: Record<string, string> = {}
      Object.entries(responses).forEach(([id, content]) => {
        if (content && content.trim().length > 0) {
          validResponses[id] = content
        }
      })

      // 清除"正在爬取"通知
      if (controlBarRef.current) {
        controlBarRef.current.clearNotification()
      }

      const modelCount = Object.keys(validResponses).length
      if (modelCount > 0) {
        // 显示成功通知
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('success', `成功爬取 ${modelCount} 个模型的回答`)
        }
      } else {
        // 没有获取到有效回复
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('error', '未获取到有效的模型回复')
        }
      }

      // 构建一次性导航数据包（无论是否抓到内容都设置，空对象表示本次无数据）
      const latestHistoryItem = history[0]
      setPendingSummarySession({
        modelResponses: validResponses,
        urls: latestHistoryItem?.urls,
        sourceHistoryId: latestHistoryItem?.id,
        timestamp: Date.now()
      })

      // 延迟一下再跳转，让用户看到提示
      setTimeout(() => {
        onNavigateToSummary()
      }, 500)
    } catch (error) {
      if (controller.signal.aborted) {
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('info', '已强行退出爬取模型回答')
        }
        return
      }
      console.error('[MainPage] 生成报告失败:', error)
      // 清除"正在爬取"通知
      if (controlBarRef.current) {
        controlBarRef.current.clearNotification()
      }
      // 显示错误通知
      if (controlBarRef.current) {
        controlBarRef.current.showNotification('error', '爬取模型回答失败')
      }
      // 异常时也设置空数据包，避免残留旧数据
      const latestHistoryItem = history[0]
      setPendingSummarySession({
        modelResponses: {},
        urls: latestHistoryItem?.urls,
        sourceHistoryId: latestHistoryItem?.id,
        timestamp: Date.now()
      })
      onNavigateToSummary()
    } finally {
      window.removeEventListener('keydown', handleKeyDown)
      if (scrapingControllerRef.current === controller) {
        scrapingControllerRef.current = null
      }
    }
  }

  // 获取要显示的模型列表
  const displayedModels = useMemo(() => {
    return getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots)
  }, [models, displayMode, productMode, taskAssignmentSlots])

  const gutterWidthPx = 16
  const MIN_PANE_WIDTH = 320
  
  // 估计容器宽度，未初始化时使用 window.innerWidth 估算
  const estimatedContainerWidth = containerWidth || (window.innerWidth - 48)
  
  // 判断四个窗口时是否需要田字格布局：四个窗口并排的平均宽度小于最小宽度
  const useGridForFour = displayMode === 'four' && 
    ((estimatedContainerWidth - 3 * gutterWidthPx) / 4 < MIN_PANE_WIDTH)

  const paneCount = useGridForFour ? 2 : displayedModels.length

  const availableWidth = useMemo(() => {
    if (paneCount <= 1) return 0
    const width = Math.max(0, containerWidth - (paneCount - 1) * gutterWidthPx)
    return width
  }, [containerWidth, paneCount])

  useEffect(() => {
    paneRatiosRef.current = paneRatios
  }, [paneRatios])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (): void => setContainerWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(() => {
      if (!isActive) return
      update()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    const el = containerRef.current
    if (!el) return
    setSuppressPaneTransition(true)
    setContainerWidth(el.clientWidth)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSuppressPaneTransition(false))
    })
  }, [isActive])

  useEffect(() => {
    if (paneCount <= 1) {
      if (paneRatios && paneRatios.length > 0) resetPaneRatios()
      return
    }
    if (!paneRatios || paneRatios.length !== paneCount) {
      setPaneRatios(Array.from({ length: paneCount }, () => 1 / paneCount))
      return
    }
    const sum = paneRatios.reduce((acc, v) => acc + v, 0)
    if (!Number.isFinite(sum) || sum <= 0) {
      setPaneRatios(Array.from({ length: paneCount }, () => 1 / paneCount))
      return
    }
    if (Math.abs(sum - 1) > 0.001) {
      setPaneRatios(paneRatios.map((v) => v / sum))
    }
  }, [paneCount, paneRatios, resetPaneRatios, setPaneRatios])

  const handleGutterPointerDown = useCallback((gutterIndex: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const ratios = paneRatiosRef.current
    if (!ratios || gutterIndex < 0 || gutterIndex >= ratios.length - 1) return
    const el = containerRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const paneCountNow = ratios.length
    const available = Math.max(0, rect.width - (paneCountNow - 1) * gutterWidthPx)
    if (available <= 0) return

    const startLeftPx = ratios[gutterIndex] * available
    const startRightPx = ratios[gutterIndex + 1] * available
    const totalPx = startLeftPx + startRightPx
    const mobileMinPx = 320
    const minPx = Math.min(mobileMinPx, Math.floor(totalPx / 2))

    dragRef.current = {
      gutterIndex,
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeftPx,
      startRightPx,
      availableWidth: available,
      minPaneWidthPx: minPx,
      paneCount: paneCountNow
    }

    setIsResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [gutterWidthPx])

  const handleGutterPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const ratios = paneRatiosRef.current
    if (!ratios || ratios.length !== drag.paneCount) return

    const deltaX = event.clientX - drag.startX
    const totalPx = drag.startLeftPx + drag.startRightPx

    let nextLeftPx = drag.startLeftPx + deltaX
    const minPx = drag.minPaneWidthPx
    const maxLeftPx = totalPx - minPx
    nextLeftPx = Math.max(minPx, Math.min(maxLeftPx, nextLeftPx))
    const nextRightPx = totalPx - nextLeftPx

    const nextRatios = [...ratios]
    nextRatios[drag.gutterIndex] = nextLeftPx / drag.availableWidth
    nextRatios[drag.gutterIndex + 1] = nextRightPx / drag.availableWidth
    setPaneRatios(nextRatios)
  }, [setPaneRatios])

  const handleGutterPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setIsResizing(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // pointer capture 可能已被释放，忽略错误
    }
  }, [])

  const paneStyle = useCallback((index: number): CSSProperties => {
    const ratios = paneRatiosRef.current
    const ratio = ratios && ratios.length === paneCount ? ratios[index] : (paneCount > 0 ? 1 / paneCount : 1)
    const basisPx = paneCount > 1 ? (availableWidth * ratio) : availableWidth
    return {
      flexBasis: `${basisPx}px`,
      flexGrow: 0,
      flexShrink: 0,
      transition: (isResizing || suppressPaneTransition || !isActive) ? 'none' : 'flex-basis 160ms ease'
    }
  }, [availableWidth, isActive, isResizing, paneCount, suppressPaneTransition])

  const gutter = (index: number): JSX.Element => (
    <div
      key={`gutter-${index}`}
      className="relative flex items-stretch justify-center w-4 cursor-col-resize select-none"
      onPointerDown={handleGutterPointerDown(index)}
      onPointerMove={handleGutterPointerMove}
      onPointerUp={handleGutterPointerUp}
      onPointerCancel={handleGutterPointerUp}
    >
      <div className="w-0.5 my-2 rounded-full bg-gray-100/60 transition-colors hover:bg-primary/60" />
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Webview 卡片区域的外层滚动容器，处理 padding 以防阴影被裁切 */}
      <div className="flex-grow min-h-0 overflow-y-auto px-4 pt-4 sm:px-6 sm:pt-6 pb-10">
        {/* 用于计算宽度和 flex 布局的内层无 padding 容器 */}
        <div ref={containerRef} className="h-full">
        {displayMode === 'one' && displayedModels[0] && (
          <div className="w-full h-full">
            <WebviewCard
              key={`slot-0-${displayedModels[0].id}`}
              ref={createRefCallback(displayedModels[0].id, 0)}
              id={displayedModels[0].id}
              name={displayedModels[0].name}
              url={displayedModels[0].url}
              logo={displayedModels[0].logo}
              enabled={true}
              slotIndex={0}
            />
          </div>
        )}

        {displayMode !== 'one' && !useGridForFour && (
          <div className="flex w-full min-h-full items-stretch">
            {displayedModels.map((model, index) => (
              <div key={`slot-${index}-${model.id}`} className="min-w-0" style={paneStyle(index)}>
                <WebviewCard
                  ref={createRefCallback(model.id, index)}
                  id={model.id}
                  name={model.name}
                  url={model.url}
                  logo={model.logo}
                  enabled={true}
                  slotIndex={index}
                />
              </div>
            )).reduce<JSX.Element[]>((acc, pane, index) => {
              if (index > 0) acc.push(gutter(index - 1))
              acc.push(pane)
              return acc
            }, [])}
          </div>
        )}

        {useGridForFour && (
          <div className="flex w-full min-h-full items-stretch">
            <div className="min-w-0" style={paneStyle(0)}>
              <div className="grid grid-rows-[minmax(480px,1fr)_minmax(480px,1fr)] gap-4 min-h-full">
                {displayedModels[0] && (
                  <WebviewCard
                    key={`slot-0-${displayedModels[0].id}`}
                    ref={createRefCallback(displayedModels[0].id, 0)}
                    id={displayedModels[0].id}
                    name={displayedModels[0].name}
                    url={displayedModels[0].url}
                    logo={displayedModels[0].logo}
                    enabled={true}
                    slotIndex={0}
                  />
                )}
                {displayedModels[2] && (
                  <WebviewCard
                    key={`slot-2-${displayedModels[2].id}`}
                    ref={createRefCallback(displayedModels[2].id, 2)}
                    id={displayedModels[2].id}
                    name={displayedModels[2].name}
                    url={displayedModels[2].url}
                    logo={displayedModels[2].logo}
                    enabled={true}
                    slotIndex={2}
                  />
                )}
              </div>
            </div>

            {gutter(0)}

            <div className="min-w-0" style={paneStyle(1)}>
              <div className="grid grid-rows-[minmax(480px,1fr)_minmax(480px,1fr)] gap-4 min-h-full">
                {displayedModels[1] && (
                  <WebviewCard
                    key={`slot-1-${displayedModels[1].id}`}
                    ref={createRefCallback(displayedModels[1].id, 1)}
                    id={displayedModels[1].id}
                    name={displayedModels[1].name}
                    url={displayedModels[1].url}
                    logo={displayedModels[1].logo}
                    enabled={true}
                    slotIndex={1}
                  />
                )}
                {displayedModels[3] && (
                  <WebviewCard
                    key={`slot-3-${displayedModels[3].id}`}
                    ref={createRefCallback(displayedModels[3].id, 3)}
                    id={displayedModels[3].id}
                    name={displayedModels[3].name}
                    url={displayedModels[3].url}
                    logo={displayedModels[3].logo}
                    enabled={true}
                    slotIndex={3}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div></div>

      {/* 底部控制栏 */}
      <div className="px-4 pb-4 sm:px-6 sm:pb-6 bg-transparent">
        <ControlBar
          ref={controlBarRef}
          onGenerateReport={handleGenerateReport}
        />
      </div>

      {/* 历史记录抽屉 */}
      <HistoryDrawer
        isOpen={isHistoryOpen && isActive}
        onClose={() => setHistoryOpen(false)}
        activeHistoryId={activeHistoryId}
        onSelectHistory={(item) => {
          // 标记不再是新会话，因为我们是从历史记录加载的
          useAppStore.getState().setNewSession(false)

          // 记录当前激活的历史记录 ID
          setActiveHistoryId(item.id)

          // 1. 清空输入框（历史消息已存在于 turns 中，恢复后直接续写）
          if (controlBarRef.current) {
            controlBarRef.current.setMessage('')
          }

          // 2. 检查并切换模型到当前视图
          const currentDisplayedIds = models.slice(0, displayCount).map((m) => m.id)
          const missingModelIds = item.models.filter((id) => !currentDisplayedIds.includes(id))

          if (missingModelIds.length > 0) {
            console.log(`[MainPage] 历史记录：发现缺失模型 ${missingModelIds.join(', ')}，正在调整顺序`)
            // 将历史记录中的模型排到前面
            const newOrder = [...item.models]
            // 添加其他模型保持原样
            models.forEach((m) => {
              if (!newOrder.includes(m.id)) {
                newOrder.push(m.id)
              }
            })
            reorderModels(newOrder)
          }

          // 3. 如果有保存的 URL，自动加载
          // 使用 setTimeout 确保模型切换后的 Webview 已加载并注册 ref
          setTimeout(
            () => {
              if (item.urls) {
                // 获取当前 Gemini 模型的 URL（可能包含账号信息如 /u/1/）
                const currentGeminiModel = models.find(m => m.id === 'gemini')
                const currentGeminiUrl = currentGeminiModel?.url || 'https://gemini.google.com/app'

                // 解析当前 Gemini URL 获取账号前缀
                let geminiUrlPrefix = 'https://gemini.google.com/app'
                try {
                  const u = new URL(currentGeminiUrl)
                  const parts = u.pathname.split('/').filter(Boolean)
                  if (parts[0] === 'u' && parts[2] === 'app') {
                    // 当前是多账号格式：/u/N/app
                    geminiUrlPrefix = `https://gemini.google.com/u/${parts[1]}/app`
                  }
                } catch {
                  // URL 解析失败，使用默认前缀
                }

                Object.entries(item.urls).forEach(([modelId, url]) => {
                  const webviewRef = useAppStore.getState().webviewRefs.get(modelId)
                  if (webviewRef && url) {
                    let finalUrl = url
                    // 对 Gemini URL 进行转换，使用当前账号的 URL 前缀
                    if (modelId === 'gemini' && url.includes('gemini.google.com')) {
                      try {
                        const u = new URL(url)
                        const parts = u.pathname.split('/').filter(Boolean)
                        // 提取对话 ID
                        let conversationId: string | undefined
                        if (parts[0] === 'app' && parts[1]) {
                          conversationId = parts[1]
                        } else if (parts[0] === 'u' && parts[2] === 'app' && parts[3]) {
                          conversationId = parts[3]
                        }
                        if (conversationId) {
                          finalUrl = `${geminiUrlPrefix}/${conversationId}`
                          console.log(`[MainPage] 历史记录：转换 Gemini URL: ${url} -> ${finalUrl}`)
                        }
                      } catch {
                        // URL 解析失败，使用原始 URL
                      }
                    }
                    console.log(`[MainPage] 历史记录：正在为 ${modelId} 加载 URL: ${finalUrl}`)
                    webviewRef.loadURL(finalUrl)
                  }
                })
              }
            },
            missingModelIds.length > 0 ? 500 : 0
          )
        }}
        onSelectSummaryHistory={(item) => {
          onNavigateToSummary(item)
        }}
      />
    </div>
  )
}

export default MainPage
