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
  const multiAiSlots = useAppStore((state) => state.multiAiSlots)
  const debateSlots = useAppStore((state) => state.debateSlots)
  const setMultiAiSlots = useAppStore((state) => state.setMultiAiSlots)
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

  // 注册 webview ref 的回调，并使用 refCallbacks 缓存引用以避免闭包陷阱
  const refCallbacks = useRef<Record<string, (ref: WebviewCardRef | null) => void>>({})
  const getRefCallback = useCallback((id: string, slotIndex: number) => {
    const key = `${slotIndex}-${id}`
    if (!refCallbacks.current[key]) {
      let lastRef: WebviewCardRef | null = null
      refCallbacks.current[key] = (ref: WebviewCardRef | null) => {
        const slotKey = `slot-${slotIndex}`
        const state = useAppStore.getState()
        if (ref) {
          lastRef = ref
          state.registerWebviewRef(slotKey, ref)
          state.registerWebviewRef(id, ref)
        } else {
          state.unregisterWebviewRef(slotKey, lastRef)
          state.unregisterWebviewRef(id, lastRef)
          lastRef = null
        }
      }
    }
    return refCallbacks.current[key]
  }, [])

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
    return getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
  }, [models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots])

  // 获取各个模式下的模型列表，确保切走后保留会话
  const modeModels = useMemo(() => ({
    multi_ai: getDisplayedModels(models, 'four', 'multi_ai', taskAssignmentSlots, multiAiSlots, debateSlots),
    task_assignment: getDisplayedModels(models, 'four', 'task_assignment', taskAssignmentSlots, multiAiSlots, debateSlots),
    debate: getDisplayedModels(models, 'two', 'debate', taskAssignmentSlots, multiAiSlots, debateSlots)
  }), [models, taskAssignmentSlots, multiAiSlots, debateSlots])

  // 跟踪曾挂载过的 Webview（组合键：mode-index）
  const [mountedWebviews, setMountedWebviews] = useState<Set<string>>(() => {
    const init = new Set<string>()
    const count = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots).length
    for (let i = 0; i < count; i++) {
      init.add(`${productMode}-${i}`)
    }
    return init
  })

  useEffect(() => {
    setMountedWebviews((prev) => {
      const next = new Set(prev)
      let changed = false
      for (let i = 0; i < displayedModels.length; i++) {
        const key = `${productMode}-${i}`
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [displayedModels.length, productMode])

  const gutterWidthPx = 16
  const MIN_PANE_WIDTH = 320
  
  // 优化UI：当四窗模式下，页面宽度不够时，不再出现田字格模式，允许左右溢出，通过滚动条滑动查看
  const useGridForFour = false

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

  const columnWidths = useMemo(() => {
    const ratios = paneRatios || Array.from({ length: paneCount }, () => 1 / paneCount)
    return ratios.map((ratio) => availableWidth * ratio)
  }, [paneRatios, paneCount, availableWidth])

  const containerStyle = useMemo<CSSProperties>(() => {
    if (displayMode === 'one') {
      return {
        display: 'grid',
        gridTemplateColumns: '1fr',
        gridTemplateRows: '1fr',
        width: '100%',
        height: '100%'
      }
    }
    const widths = columnWidths
    if (useGridForFour) {
      return {
        display: 'grid',
        gridTemplateColumns: `${widths[0] ?? 0}px 16px ${widths[1] ?? 0}px`,
        gridTemplateRows: '1fr 1fr',
        rowGap: '1rem',
        width: '100%',
        height: '100%',
        transition: (isResizing || suppressPaneTransition || !isActive) ? 'none' : 'grid-template-columns 160ms ease'
      }
    }
    const cols: string[] = []
    for (let i = 0; i < displayedModels.length; i++) {
      if (i > 0) cols.push('16px')
      cols.push(`${widths[i] ?? 0}px`)
    }
    return {
      display: 'grid',
      gridTemplateColumns: cols.join(' '),
      gridTemplateRows: '1fr',
      width: '100%',
      minWidth: displayMode === 'four' ? `${4 * MIN_PANE_WIDTH + 3 * gutterWidthPx}px` : '100%',
      height: '100%',
      transition: (isResizing || suppressPaneTransition || !isActive) ? 'none' : 'grid-template-columns 160ms ease'
    }
  }, [displayMode, useGridForFour, columnWidths, displayedModels.length, isResizing, suppressPaneTransition, isActive])

  const getSlotWrapperStyle = useCallback((index: number): CSSProperties => {
    if (index >= displayedModels.length) {
      return {
        position: 'absolute',
        visibility: 'hidden',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none'
      }
    }
    if (useGridForFour) {
      const col = (index === 0 || index === 2) ? 1 : 3
      const row = (index === 0 || index === 1) ? 1 : 2
      return {
        gridColumn: `${col}`,
        gridRow: `${row}`,
        position: 'relative',
        visibility: 'visible',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0
      }
    }
    const col = 2 * index + 1
    return {
      gridColumn: `${col}`,
      gridRow: '1',
      position: 'relative',
      visibility: 'visible',
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0
    }
  }, [displayedModels.length, useGridForFour])

  const getGutterWrapperStyle = useCallback((index: number): CSSProperties => {
    if (useGridForFour) {
      if (index === 0) {
        return {
          gridColumn: '2',
          gridRow: '1 / span 2',
          position: 'relative',
          visibility: 'visible',
          width: '16px',
          height: '100%'
        }
      }
      return {
        position: 'absolute',
        visibility: 'hidden',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none'
      }
    }
    if (index < displayedModels.length - 1) {
      const col = 2 * index + 2
      return {
        gridColumn: `${col}`,
        gridRow: '1',
        position: 'relative',
        visibility: 'visible',
        width: '16px',
        height: '100%'
      }
    }
    return {
      position: 'absolute',
      visibility: 'hidden',
      width: 0,
      height: 0,
      overflow: 'hidden',
      pointerEvents: 'none'
    }
  }, [useGridForFour, displayedModels.length])

  const renderLayoutChildren = () => {
    const children: JSX.Element[] = []
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        children.push(
          <div
            key={`gutter-${i - 1}`}
            className="relative flex items-stretch justify-center cursor-col-resize select-none"
            style={getGutterWrapperStyle(i - 1)}
            onPointerDown={handleGutterPointerDown(i - 1)}
            onPointerMove={handleGutterPointerMove}
            onPointerUp={handleGutterPointerUp}
            onPointerCancel={handleGutterPointerUp}
          >
            <div className="w-0.5 my-2 rounded-full bg-gray-100/60 transition-colors hover:bg-primary/60" />
          </div>
        )
      }
      children.push(
        <div key={`slot-wrapper-${i}`} style={getSlotWrapperStyle(i)}>
          {['multi_ai', 'task_assignment', 'debate'].map((mode) => {
            const isMounted = mountedWebviews.has(`${mode}-${i}`)
            const model = modeModels[mode as keyof typeof modeModels][i]
            if (!isMounted || !model) return null

            return (
              <div key={`mode-wrapper-${mode}-${i}`} style={{ display: productMode === mode ? 'block' : 'none', width: '100%', height: '100%' }}>
                <WebviewCard
                  key={`webview-${mode}-${i}-${model.id}`}
                  ref={productMode === mode ? getRefCallback(model.id, i) : undefined}
                  id={model.id}
                  name={model.name}
                  url={model.url}
                  logo={model.logo}
                  enabled={true}
                  slotIndex={i}
                />
              </div>
            )
          })}
        </div>
      )
    }
    return children
  }

  return (
    <div className="flex flex-col h-full">
      {/* Webview 卡片区域的外层滚动容器，处理 padding 以防阴影被裁切 */}
      <div className="flex-grow min-h-0 overflow-auto px-4 pt-4 sm:px-6 sm:pt-6 pb-5">
        {/* 用于计算宽度和 CSS Grid 布局的内层无 padding 容器 */}
        <div ref={containerRef} style={containerStyle}>
          {renderLayoutChildren()}
        </div>
      </div>

      {/* 底部控制栏（单窗口模式下隐藏） */}
      {displayMode !== 'one' && (
        <div className="px-4 pb-4 sm:px-6 sm:pb-6 bg-transparent">
          <ControlBar
            ref={controlBarRef}
            onGenerateReport={handleGenerateReport}
          />
        </div>
      )}

      {/* 历史记录抽屉 */}
      <HistoryDrawer
        isOpen={isHistoryOpen && isActive}
        onClose={() => setHistoryOpen(false)}
        activeHistoryId={activeHistoryId}
        onSelectHistory={(item) => {
          // 标记不再是新会话，因为我们是从历史记录加载的
          const appStore = useAppStore.getState()
          appStore.setNewSession(false)

          // 锁定恢复的模型，确保顶部分段控件能正确锁定窗口数量
          const historyModels = item.models.map(id => models.find(m => m.id === id)).filter(Boolean) as typeof models
          appStore.setActiveModels(historyModels)

          // 记录当前激活的历史记录 ID
          setActiveHistoryId(item.id)

          // 1. 清空输入框（历史消息已存在于 turns 中，恢复后直接续写）
          if (controlBarRef.current) {
            controlBarRef.current.setMessage('')
          }

          // 2. 自动恢复产品模式与窗口数量
          let targetProductMode = productMode;
          let targetDisplayMode = displayMode;

          if (item.productMode) {
            targetProductMode = item.productMode;
            appStore.setProductMode(targetProductMode);
          }

          if (item.displayMode) {
            targetDisplayMode = item.displayMode;
            appStore.setDisplayMode(targetDisplayMode);
          } else {
            // 兼容旧历史记录：根据模型数量推断
            if (targetProductMode === 'multi_ai' || targetProductMode === 'task_assignment') {
              const modelCount = item.models.length;
              if (modelCount === 1) targetDisplayMode = 'one';
              else if (modelCount === 2) targetDisplayMode = 'two';
              else if (modelCount === 3) targetDisplayMode = 'three';
              else if (modelCount >= 4) targetDisplayMode = 'four';
              
              if (targetDisplayMode !== displayMode) {
                console.log(`[MainPage] 旧历史记录：发现模型数量(${modelCount})与当前视图不匹配，正在切换布局到 ${targetDisplayMode}`)
                appStore.setDisplayMode(targetDisplayMode);
              }
            }
          }

          // 3. 检查并切换模型到当前视图
          const currentDisplayedIds = getDisplayedModels(models, targetDisplayMode, targetProductMode, taskAssignmentSlots, multiAiSlots).map(m => m.id)
          const missingModelIds = item.models.filter((id) => !currentDisplayedIds.includes(id))

          if (missingModelIds.length > 0) {
            console.log(`[MainPage] 历史记录：发现缺失模型 ${missingModelIds.join(', ')}，正在调整顺序`)
            // 将历史记录中的模型排到前面
            const newOrder = [...item.models]
            // 添加其他模型保持原样，填充可能剩下的槽位
            models.forEach((m) => {
              if (!newOrder.includes(m.id)) {
                newOrder.push(m.id)
              }
            })
            
            // 根据目标模式更新对应的槽位
            if (targetProductMode === 'task_assignment') {
              appStore.setTaskAssignmentSlots(newOrder)
            } else {
              setMultiAiSlots(newOrder)
            }
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
