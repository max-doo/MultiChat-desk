import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import WebviewCard, { WebviewCardRef } from '../components/WebviewCard'
import ControlBar, { ControlBarRef } from '../components/ControlBar'
import HistoryDrawer from '../components/HistoryDrawer'
import { useAppStore, getDisplayedModels, SummaryHistoryItem, ModelConfig } from '../store/appStore'

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
  // activeHistoryId 的 ref 镜像，供休眠调度器 useCallback 在不增加依赖的前提下读到最新回溯态
  const activeHistoryIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    activeHistoryIdRef.current = activeHistoryId
  }, [activeHistoryId])
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
  const currentConversationId = useAppStore((state) => state.currentConversationId)
  const isNewSession = useAppStore((state) => state.isNewSession)
  const textInserted = useAppStore((state) => state.textInserted)
  const activeModels = useAppStore((state) => state.activeModels)
  const paneRatios = useAppStore((state) => state.paneRatios)
  const setPaneRatios = useAppStore((state) => state.setPaneRatios)
  const resetPaneRatios = useAppStore((state) => state.resetPaneRatios)

  // 当开启新对话时，清除当前回溯的历史快照状态，防止遗留的 activeHistoryId 导致加载快照而非真实页面
  useEffect(() => {
    if (isNewSession) {
      setActiveHistoryId(undefined)
    }
  }, [isNewSession])

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
  // 延迟跳转 SummaryPage 的定时器；重入与 unmount 时需清理，避免叠加跳转 / 卸载后触发
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── 休眠调度器状态（片段 B）──
  // R1: 主页面切换模型后，被切走的旧模型 30 秒后真卸载（D1）
  const HIBERNATE_DELAY_MS = 30 * 1000 // 30 秒
  // R4: 主窗口关闭(托盘隐藏)后，显示中的模型 5 分钟后休眠（片段 B'）
  const HIBERNATE_DELAY_HIDE_MS = 5 * 60 * 1000 // 5 分钟
  // 各模型的休眠倒计时定时器；key = model.id
  const hibernateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // 跟踪上一轮显示的模型 id，用于判定「被切走」启动倒计时 vs「仍显示」保持唤醒
  const prevDisplayedIdsRef = useRef<string[]>([])

  // ── 模式感知休眠追踪 ──
  // 休眠专用 ref 追踪：key = `${mode}-${slotIndex}`，所有已挂载模式的 WebviewCard 都在此注册
  // 独立于 store.webviewRefs，确保后台模式（display: none）下的 webview 在被切走后仍能通过 ref 调用 suspend 进入休眠
  const hibernationRefsMap = useRef<Map<string, WebviewCardRef>>(new Map())
  const productModeRef = useRef<string>(productMode)
  const modeModelsRef = useRef<Record<string, ModelConfig[]>>({})

  // 获取模式感知的休眠 ref 回调，使用 ref 缓存防止重复创建导致 react re-render 时冲突
  const hibernationRefCallbacks = useRef<Record<string, (ref: WebviewCardRef | null) => void>>({})
  const getHibernationRefCallback = useCallback((mode: string, slotIndex: number, modelId: string) => {
    const key = `${mode}-${slotIndex}-${modelId}`
    if (!hibernationRefCallbacks.current[key]) {
      let lastRef: WebviewCardRef | null = null
      hibernationRefCallbacks.current[key] = (ref: WebviewCardRef | null) => {
        const state = useAppStore.getState()
        const currentProductMode = productModeRef.current

        if (ref) {
          lastRef = ref
          hibernationRefsMap.current.set(`${mode}-${slotIndex}`, ref)
          if (currentProductMode === mode) {
            state.registerWebviewRef(`slot-${slotIndex}`, ref)
            state.registerWebviewRef(modelId, ref)
          }
        } else {
          hibernationRefsMap.current.delete(`${mode}-${slotIndex}`)
          if (currentProductMode === mode && lastRef) {
            state.unregisterWebviewRef(`slot-${slotIndex}`, lastRef)
            state.unregisterWebviewRef(modelId, lastRef)
          }
          lastRef = null
        }
      }
    }
    return hibernationRefCallbacks.current[key]
  }, [])

  // 追踪主窗口是否可见，以便在窗口隐藏时即使在回溯历史态也允许休眠
  const isWindowVisibleRef = useRef<boolean>(true)
  // 追踪当前页面是否激活，以便在切换到总结页等其他模式时允许模型休眠
  const isActiveRef = useRef<boolean>(isActive)
  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  // 回溯历史时，预计算各模型最后一轮 turn 的快照 + 历史原始 URL，
  // 供 WebviewCard 做 URL 不匹配检测与只读快照显示。非回溯态（无 activeHistoryId）返回空。
  // 同时带出该历史条目所属 productMode：快照/URL 只应作用于与之匹配的模式，
  // 否则同一 modelId 在 multi_ai/task_assignment/debate 三套常驻 webview 间会串扰
  // （隐藏模式的 WebviewCard 仍会跑 checkUrlMismatch 并武装快照覆盖层）。
  const { historySnapshots, historyUrls, activeHistoryMode } = useMemo(() => {
    if (!activeHistoryId) return { historySnapshots: {} as Record<string, string>, historyUrls: {} as Record<string, string>, activeHistoryMode: undefined }
    const item = history.find((h) => h.id === activeHistoryId)
    if (!item || item.turns.length === 0) return { historySnapshots: {}, historyUrls: {} as Record<string, string>, activeHistoryMode: item?.productMode }
    const lastTurn = item.turns[item.turns.length - 1]
    return {
      historySnapshots: lastTurn.responses ?? {},
      historyUrls: item.urls ?? {},
      activeHistoryMode: item.productMode
    }
  }, [activeHistoryId, history])


  // 组件卸载时清理未触发的跳转定时器，避免卸载后仍触发 onNavigateToSummary
  useEffect(() => {
    return () => {
      if (navigateTimerRef.current) {
        clearTimeout(navigateTimerRef.current)
        navigateTimerRef.current = null
      }
    }
  }, [])

  // ── 休眠调度器（片段 B）──
  // 清理某模型的休眠倒计时
  const clearHibernateTimer = useCallback((modelId: string) => {
    const timer = hibernateTimersRef.current.get(modelId)
    if (timer) {
      clearTimeout(timer)
      hibernateTimersRef.current.delete(modelId)
    }
  }, [])

  // 执行休眠：白名单检查通过后调用 ref.suspend()（D1 真卸载）
  const executeHibernate = useCallback(async (modelId: string) => {
    const state = useAppStore.getState()

    // 活动任务判断：发送中、抓取监控中、辩论运行中、上传文件进行中
    const isTaskRunning =
      state.isSending ||
      !!state.monitor?.isMonitoring ||
      state.debateState?.phase === 'running' ||
      state.isUploading

    if (isTaskRunning) {
      console.log(`[MainPage] 活动任务运行中，跳过休眠: ${modelId}`)
      return
    }

    // 只有在主窗口可见且当前页面激活时，才应用以下白名单保护：
    // 1. 回溯历史态（用户在主动浏览历史，属于活跃交互）
    // 2. 属于当前活跃会话的模型（避免后台被休眠导致漏收接下来的消息）
    // 如果主窗口已隐藏（关闭至托盘）或切换到了其他页面（如总结页），则允许它们休眠以释放内存。
    if (isWindowVisibleRef.current && isActiveRef.current) {
      if (activeHistoryIdRef.current) {
        console.log(`[MainPage] 主窗口可见、页面激活且处于回溯历史态，跳过 ${modelId} 休眠`)
        return
      }
      if (state.activeModels.some(m => m.id === modelId)) {
        console.log(`[MainPage] 主窗口可见、页面激活且 ${modelId} 属于当前活跃会话，跳过休眠`)
        return
      }
    }

    const ref = state.webviewRefs.get(modelId)
    if (ref && !ref.isHibernated()) {
      console.log(`[MainPage] 休眠 webview: ${modelId}`)
      const result = await ref.suspend()
      if (result.success) {
        console.log(`[MainPage] ${modelId} 已休眠，保存 URL: ${result.savedUrl}`)
      } else {
        console.warn(`[MainPage] ${modelId} 休眠失败:`, result.error)
      }
    }
  }, [])

  // 调度休眠：delayMs 后执行（默认 5min；主窗口关闭用 15min）
  const scheduleHibernate = useCallback((modelId: string, delayMs: number = HIBERNATE_DELAY_MS) => {
    clearHibernateTimer(modelId)
    const timer = setTimeout(() => {
      void executeHibernate(modelId)
    }, delayMs)
    hibernateTimersRef.current.set(modelId, timer)
    console.log(`[MainPage] ${modelId} 休眠倒计时启动: ${delayMs}ms`)
  }, [clearHibernateTimer, executeHibernate])

  // 唤醒 webview：清理倒计时并在确实休眠时 resume
  const wakeWebview = useCallback(async (modelId: string) => {
    clearHibernateTimer(modelId)
    const store = useAppStore.getState()
    const ref = store.webviewRefs.get(modelId)
    if (ref) {
      if (ref.isHibernated()) {
        console.log(`[MainPage] 唤醒 webview: ${modelId}`)
        const result = await ref.resume()
        if (result.success) {
          console.log(`[MainPage] ${modelId} 已唤醒`)
          store.markWebviewActive(modelId)
          void store.enforceWebviewCapacity()
        } else {
          console.warn(`[MainPage] ${modelId} 唤醒失败:`, result.error)
        }
      } else {
        store.markWebviewActive(modelId)
      }
    }
  }, [clearHibernateTimer])

  // 各 mode-slot 的休眠倒计时定时器；key = `${mode}-${slotIndex}`
  const hibernateModeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // 清理指定 mode-slot 的休眠定时器
  const clearHibernateModeTimer = useCallback((modeSlotKey: string) => {
    const timer = hibernateModeTimersRef.current.get(modeSlotKey)
    if (timer) {
      clearTimeout(timer)
      hibernateModeTimersRef.current.delete(modeSlotKey)
    }
  }, [])

  // 执行指定 mode-slot 的休眠（D1 真卸载）
  const executeHibernateByModeSlot = useCallback(async (modeSlotKey: string) => {
    const state = useAppStore.getState()

    // 活动任务判断：发送中、抓取监控中、辩论运行中、上传文件进行中（跳过休眠）
    const isTaskRunning =
      state.isSending ||
      !!state.monitor?.isMonitoring ||
      state.debateState?.phase === 'running' ||
      state.isUploading

    if (isTaskRunning) {
      console.log(`[MainPage] 活动任务运行中，跳过模式休眠: ${modeSlotKey}`)
      return
    }

    const ref = hibernationRefsMap.current.get(modeSlotKey)
    if (ref && !ref.isHibernated()) {
      console.log(`[MainPage] 休眠 webview (mode-slot): ${modeSlotKey}`)
      const result = await ref.suspend()
      if (result.success) {
        console.log(`[MainPage] ${modeSlotKey} 已休眠，保存 URL: ${result.savedUrl}`)
      } else {
        console.warn(`[MainPage] ${modeSlotKey} 休眠失败:`, result.error)
      }
    }
  }, [])

  // 调度模式休眠
  const scheduleHibernateByModeSlot = useCallback((modeSlotKey: string, delayMs: number = HIBERNATE_DELAY_MS) => {
    clearHibernateModeTimer(modeSlotKey)
    const timer = setTimeout(() => {
      void executeHibernateByModeSlot(modeSlotKey)
    }, delayMs)
    hibernateModeTimersRef.current.set(modeSlotKey, timer)
    console.log(`[MainPage] ${modeSlotKey} 模式休眠倒计时启动: ${delayMs}ms`)
  }, [clearHibernateModeTimer, executeHibernateByModeSlot])

  // 唤醒模式 webview
  const wakeWebviewByModeSlot = useCallback(async (modeSlotKey: string) => {
    clearHibernateModeTimer(modeSlotKey)
    const ref = hibernationRefsMap.current.get(modeSlotKey)
    if (ref && ref.isHibernated()) {
      console.log(`[MainPage] 唤醒 webview (mode-slot): ${modeSlotKey}`)
      await ref.resume()
    }
  }, [clearHibernateModeTimer])

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
      // 辩论模式：裁判评析直接读 debateState.rounds，绕开 webview 抓取与快照兜底。
      // 否则 getAllResponses 会沿用上一次多AI会话的 activeModels 抓到错误 webview 的回复。
      if (productMode === 'debate') {
        const ds = useAppStore.getState().debateState
        const [proId, oppId] = debateSlots
        const proName = models.find((m) => m.id === proId)?.name ?? '正方'
        const oppName = models.find((m) => m.id === oppId)?.name ?? '反方'
        const proText = ds.rounds
          .map((r, i) => `【第${i + 1}轮·正方】\n${r.proponent ?? ''}`)
          .filter((s) => s.trim())
          .join('\n\n')
        const oppText = ds.rounds
          .map((r, i) => `【第${i + 1}轮·反方】\n${r.opponent ?? ''}`)
          .filter((s) => s.trim())
          .join('\n\n')
        const validResponses: Record<string, string> = {}
        if (proText) validResponses[proId] = `（正方：${proName}）\n${proText}`
        if (oppText) validResponses[oppId] = `（反方：${oppName}）\n${oppText}`
        if (controlBarRef.current) {
          controlBarRef.current.clearNotification()
          const n = Object.keys(validResponses).length
          if (n > 0) {
            controlBarRef.current.showNotification('success', `成功获取 ${n} 个辩论方发言`)
          } else {
            controlBarRef.current.showNotification('error', '未获取到辩论发言')
          }
        }
        setPendingSummarySession({
          modelResponses: validResponses,
          urls: undefined,
          sourceHistoryId: undefined,
          timestamp: Date.now(),
          snapshotModelIds: [],
          presetSummaryMode: '3' // 辩论裁决：辩论模式进入总结时默认选中
        })
        if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current)
        navigateTimerRef.current = setTimeout(() => {
          navigateTimerRef.current = null
          onNavigateToSummary()
        }, 500)
        return
      }

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

      // 兜底：对实时抓空的模型，用当前会话最后一轮 turn 的历史快照补上。
      // 这是三层兜底里最可靠的一层——不依赖任何 URL 判定，只要 getAllResponses 抓空且 history 有该模型回复就补。
      // 注意：兜底针对 webview 抓空（未登录/打不开/被重定向到非会话页导致 getLatestResponse 返回空），
      // 不是"抓到了旧内容"——回溯历史时 webview 显示旧会话，实时值与 history 最后一轮同源，
      // 兜底仅在 webview 真正不可用时才有意义。
      const snapshotModelIds: string[] = []
      const latestHistoryItem = history.find((h) => h.id === currentConversationId) ?? null
      const lastTurn = latestHistoryItem?.turns?.[latestHistoryItem.turns.length - 1]
      const lastResponses = lastTurn?.responses ?? {}
      // ⚠️ 目标模型列表必须与 getAllResponses 内部选取逻辑完全一致：
      // getAllResponses（appStore.ts:1146-1149）在会话活跃（!isNewSession || textInserted）且
      // activeModels 非空时用 state.activeModels，否则才回落到 getDisplayedModels。
      // 若这里用 getDisplayedModels 而 getAllResponses 用 activeModels，会遍历到本次根本没参与
      // 对话的模型（其 validResponses[id] 本就 undefined），把它误判为"抓空"并补上多余快照。
      // 因此这里复刻同一判定：
      const isSessionActive = !isNewSession || textInserted
      const targetModelList = isSessionActive && activeModels.length > 0
        ? activeModels
        : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
      for (const model of targetModelList) {
        if (!validResponses[model.id] && lastResponses[model.id]?.trim()) {
          validResponses[model.id] = lastResponses[model.id]
          snapshotModelIds.push(model.id)
        }
      }

      // 清除"正在爬取"通知
      if (controlBarRef.current) {
        controlBarRef.current.clearNotification()
      }

      const modelCount = Object.keys(validResponses).length
      if (modelCount > 0) {
        if (controlBarRef.current) {
          const snapshotNote =
            snapshotModelIds.length > 0
              ? `（含 ${snapshotModelIds.length} 个历史快照）`
              : ''
          controlBarRef.current.showNotification('success', `成功获取 ${modelCount} 个模型的回答${snapshotNote}`)
        }
      } else {
        // 没有获取到有效回复
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('error', '未获取到有效的模型回复')
        }
      }

      // 构建一次性导航数据包（无论是否抓到内容都设置，空对象表示本次无数据）
      setPendingSummarySession({
        modelResponses: validResponses,
        urls: latestHistoryItem?.urls,
        sourceHistoryId: latestHistoryItem?.id,
        timestamp: Date.now(),
        snapshotModelIds,
        presetSummaryMode: productMode === 'task_assignment' ? '4' : undefined // 成稿汇总：任务分配模式进入总结时默认选中
      })

      // 延迟一下再跳转，让用户看到提示
      if (navigateTimerRef.current) {
        clearTimeout(navigateTimerRef.current)
      }
      navigateTimerRef.current = setTimeout(() => {
        navigateTimerRef.current = null
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
      const latestHistoryItem = history.find((h) => h.id === currentConversationId) ?? null
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

  // ── 更新 productModeRef 和 modeModelsRef ──
  useEffect(() => {
    productModeRef.current = productMode
  }, [productMode])

  useEffect(() => {
    modeModelsRef.current = modeModels
  }, [modeModels])

  // 当产品模式切换时，动态更新 store 中的 webviewRefs（供 sendMessage/getAllResponses 等使用）
  useEffect(() => {
    const state = useAppStore.getState()
    const currentModeModels = modeModels[productMode as keyof typeof modeModels]
    
    // 1. 注册当前活跃模式的所有 slots 实例
    for (let i = 0; i < currentModeModels.length; i++) {
      const ref = hibernationRefsMap.current.get(`${productMode}-${i}`)
      if (ref) {
        state.registerWebviewRef(`slot-${i}`, ref)
        state.registerWebviewRef(currentModeModels[i].id, ref)
      }
    }

    return () => {
      // 2. 清理注销（在下一次切换模式前触发）
      const prevModeModels = modeModels[productMode as keyof typeof modeModels]
      for (let i = 0; i < prevModeModels.length; i++) {
        const ref = hibernationRefsMap.current.get(`${productMode}-${i}`)
        if (ref) {
          state.unregisterWebviewRef(`slot-${i}`, ref)
          state.unregisterWebviewRef(prevModeModels[i].id, ref)
        }
      }
    }
  }, [productMode, modeModels])

  // ── 模式切换休眠调度 ──
  const prevProductModeRef = useRef<string>(productMode)

  useEffect(() => {
    const prevMode = prevProductModeRef.current
    prevProductModeRef.current = productMode

    if (prevMode === productMode) return

    // 1. 旧模式的所有 webview 启动休眠倒计时
    const oldModeModels = modeModels[prevMode as keyof typeof modeModels]
    if (oldModeModels) {
      for (let i = 0; i < oldModeModels.length; i++) {
        const modeSlotKey = `${prevMode}-${i}`
        scheduleHibernateByModeSlot(modeSlotKey)
      }
    }

    // 2. 新模式的所有 webview 立即唤醒
    const newModeModels = modeModels[productMode as keyof typeof modeModels]
    if (newModeModels) {
      for (let i = 0; i < newModeModels.length; i++) {
        const modeSlotKey = `${productMode}-${i}`
        void wakeWebviewByModeSlot(modeSlotKey)
      }
    }
  }, [productMode, modeModels, scheduleHibernateByModeSlot, wakeWebviewByModeSlot])

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

  // 跟踪每插槽 modelId 的变化：换模型时回收旧 (mode-slotIndex-oldModelId) 的 ref 回调，
  // 避免 hibernationRefCallbacks.current 只增不减、陈旧 webview ref 无法 GC
  const prevSlotModelIds = useRef<string[]>([])
  useEffect(() => {
    const currentIds = displayedModels.map(m => m?.id ?? '').filter(Boolean)
    const prev = prevSlotModelIds.current

    // 对每个插槽，若 modelId 变了，回收旧键
    currentIds.forEach((modelId, slotIndex) => {
      const oldId = prev[slotIndex]
      if (oldId && oldId !== modelId) {
        const oldKey = `${productMode}-${slotIndex}-${oldId}`
        const oldCb = hibernationRefCallbacks.current[oldKey]
        if (oldCb) {
          // 以 null 触发旧回调：unregister 旧 webview ref + 置空 lastRef
          oldCb(null)
          delete hibernationRefCallbacks.current[oldKey]
        }
      }
    })

    // 处理插槽数减少：prev 比 current 长的部分，回收所有旧键
    if (prev.length > currentIds.length) {
      for (let slotIndex = currentIds.length; slotIndex < prev.length; slotIndex++) {
        const oldId = prev[slotIndex]
        if (!oldId) continue
        const oldKey = `${productMode}-${slotIndex}-${oldId}`
        const oldCb = hibernationRefCallbacks.current[oldKey]
        if (oldCb) {
          oldCb(null)
          delete hibernationRefCallbacks.current[oldKey]
        }
      }
    }

    prevSlotModelIds.current = currentIds
  }, [displayedModels, productMode])

  // ── 休眠调度触发（片段 B）──
  // 显示模型变化：新显示的唤醒，被切走的启动 5min 倒计时（R1）
  useEffect(() => {
    const currentIds = displayedModels.map(m => m.id)
    const prevIds = prevDisplayedIdsRef.current

    // 新显示的模型：唤醒（若曾休眠）
    for (const modelId of currentIds) {
      if (!prevIds.includes(modelId)) {
        void wakeWebview(modelId)
      } else {
        // 仍显示，保持唤醒、清掉倒计时
        clearHibernateTimer(modelId)
      }
    }
    // 不再显示的模型：启动 5min 休眠倒计时
    for (const modelId of prevIds) {
      if (!currentIds.includes(modelId)) {
        scheduleHibernate(modelId)
      }
    }

    prevDisplayedIdsRef.current = currentIds
  }, [displayedModels, scheduleHibernate, wakeWebview, clearHibernateTimer])

  // 页面激活态变化：切回主页面唤醒所有显示模型；切走（去总结页）启动倒计时
  useEffect(() => {
    if (isActive) {
      for (const model of displayedModels) {
        void wakeWebview(model.id)
      }
    } else {
      for (const model of displayedModels) {
        scheduleHibernate(model.id)
      }
    }
  }, [isActive, displayedModels, scheduleHibernate, wakeWebview])

  // 主窗口 hide/show 事件（片段 B'，决策 R4）：
  // 隐藏到托盘后 15 分钟休眠显示中的模型；重新显示时立即唤醒。
  // 注意：必须读到「订阅时刻的」displayedModels，故用 displayedModelsRef 镜像避免闭包过期。
  useEffect(() => {
    const off = window.api.onWindowVisibility((visible) => {
      isWindowVisibleRef.current = visible
      const state = useAppStore.getState()
      state.setMainWindowVisible(visible)
      
      if (visible) {
        // 重新显示时：只唤醒当前模式下的显示模型
        const currentModels = modeModels[productMode as keyof typeof modeModels]
        for (let i = 0; i < currentModels.length; i++) {
          void wakeWebviewByModeSlot(`${productMode}-${i}`)
        }
      } else {
        // 隐藏到托盘时：将所有挂载模式的所有 webview 均投入 5 分钟休眠倒计时
        for (const [modeSlotKey] of hibernationRefsMap.current.entries()) {
          scheduleHibernateByModeSlot(modeSlotKey, HIBERNATE_DELAY_HIDE_MS)
        }
      }
    })
    return () => { off() }
  }, [productMode, modeModels, scheduleHibernateByModeSlot, wakeWebviewByModeSlot])

  // 组件卸载时清理所有休眠倒计时，避免卸载后仍触发 suspend
  useEffect(() => {
    return () => {
      for (const [, timer] of hibernateTimersRef.current.entries()) {
        clearTimeout(timer)
      }
      hibernateTimersRef.current.clear()
      for (const [, timer] of hibernateModeTimersRef.current.entries()) {
        clearTimeout(timer)
      }
      hibernateModeTimersRef.current.clear()
    }
  }, [])

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
            // 快照/URL 只作用于该历史条目所属的模式，避免跨模式串扰
            // （隐藏模式的 webview 仍会消费这些 prop 并武装覆盖层）
            const isHistoryMode = mode === activeHistoryMode

            return (
              <div key={`mode-wrapper-${mode}-${i}`} style={{ display: productMode === mode ? 'block' : 'none', width: '100%', height: '100%' }}>
                <WebviewCard
                  key={`webview-${mode}-${i}-${model.id}`}
                  ref={getHibernationRefCallback(mode, i, model.id)}
                  id={model.id}
                  name={model.name}
                  url={model.url}
                  logo={model.logo}
                  enabled={true}
                  slotIndex={i}
                  sideLabel={mode === 'debate' ? (i === 0 ? '正方' : '反方') : undefined}
                  expectedUrl={isHistoryMode ? historyUrls[model.id] : undefined}
                  readonlySnapshot={
                    !isHistoryMode || !activeHistoryId
                      ? null
                      : historySnapshots[model.id]
                        ? { content: historySnapshots[model.id], reason: 'url_mismatch' as const }
                        : { content: '', reason: 'no_snapshot' as const }
                  }
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
          // 同步持久化"当前对话"锚点（P0-1b）：恢复历史后发新消息/生成报告需走 ID 查找而非 history[0]，
          // 否则 currentConversationId 仍指向上一次对话，发新消息会串到错误 historyItem
          appStore.setCurrentConversationId(item.id)

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

          // —— 辩论模式专用恢复：先重填 debateSlots + debateState，再让下方 missingModelIds 用正确槽位判空 ——
          if (targetProductMode === 'debate' && item.debateTurns) {
            // 恢复两 slot 模型（item.models 至少 2 个；不足则补空串，避免 as cast 越界）
            const slot0 = item.models[0] ?? ''
            const slot1 = item.models[1] ?? ''
            useAppStore.setState({ debateSlots: [slot0, slot1] as [string, string] })
            // 重填辩论面板（只读浏览，phase='finished'）；topic 取已持久化的 HistoryItem.title（Task 4 Step 8 写入）
            useAppStore.getState().restoreDebateState({
              topic: item.title ?? '',
              totalRounds: item.debateTurns.length,
              debateTurns: item.debateTurns,
            })
            // 按 slotUrls 加载两 slot（若辩论未 finalize 则 slotUrls 缺失，跳过 URL 加载）
            if (item.slotUrls) {
              setTimeout(() => {
                for (const slotIndex of [0, 1] as const) {
                  const url = item.slotUrls?.[slotIndex]
                  if (!url) continue
                  const ref = useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)
                  if (ref) ref.loadURL(url)
                }
              }, 0)
            }
            return // 辩论恢复不走下方普通 item.urls 加载（辩论 URL 在 slotUrls，不在 urls）
          }

          // 3. 检查并切换模型到当前视图
          const currentDisplayedIds = getDisplayedModels(models, targetDisplayMode, targetProductMode, taskAssignmentSlots, multiAiSlots, debateSlots).map(m => m.id)
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

                // 按目标模式的槽位顺序定位 webview（slot-${i}），而非按 modelId 取 ref。
                // 原因：webviewRefs 在 model.id 键上跨模式共享（仅激活模式注册），
                // 用 modelId 取 ref 可能落到其他模式的 webview，造成跨模式 URL 串扰。
                const storeState = useAppStore.getState()
                let modeSlots: string[]
                if (targetProductMode === 'task_assignment') {
                  modeSlots = storeState.taskAssignmentSlots
                } else if (targetProductMode === 'debate') {
                  modeSlots = storeState.debateSlots
                } else {
                  modeSlots = storeState.multiAiSlots
                }
                // 槽位顺序兜底：若 store 槽位为空或长度不足，退回历史记录的 models 顺序
                const slotsForLookup = modeSlots.length >= item.models.length ? modeSlots : item.models

                Object.entries(item.urls).forEach(([modelId, url]) => {
                  const slotIndex = slotsForLookup.indexOf(modelId)
                  if (slotIndex === -1) return
                  const webviewRef = useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)
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
