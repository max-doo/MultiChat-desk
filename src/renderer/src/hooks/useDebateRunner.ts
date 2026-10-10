import { useRef, useCallback, useEffect } from 'react'
import { useAppStore, waitForSavableUrl, captureResponseTargets } from '../store/appStore'
import type { DebateTurnRecord } from '../store/appStore'
import { buildDebatePrompt } from '../utils/debatePrompts'

/**
 * 辩论轮转驱动：正方(slot-0) ↔ 反方(slot-1) 自动交替。
 * 通过 store 的 debateState 推进；本 hook 持有 abort 标志与定时器。
 */
export function useDebateRunner() {
  const abortRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conversationIdRef = useRef<string | null>(null)
  const finalizeDebateHistoryRef = useRef<() => void>(() => {})
  const controllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const runVersionRef = useRef(0)
  const pendingTurnRef = useRef<{ key: string; baseline: string; webContentsId: number | null; sent: boolean } | null>(null)

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  // 采集两 slot 的最终 URL（按 slotIndex，避开同 modelId 冲突）
  const collectSlotUrls = async (): Promise<Record<number, string>> => {
    const { webviewRefs, debateSlots } = useAppStore.getState()
    const result: Record<number, string> = {}
    for (const slotIndex of [0, 1] as const) {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      const modelId = debateSlots[slotIndex]
      if (!ref || !modelId) continue
      try {
        const savable = await waitForSavableUrl(modelId, ref)
        if (savable) result[slotIndex] = savable
      } catch { /* 忽略 */ }
    }
    return result
  }

  // 辩论结束兜底：采集两 slot 最终 URL 写入历史
  const finalizeDebateHistory = async () => {
    const cid = conversationIdRef.current
    if (!cid) return
    conversationIdRef.current = null
    const slotUrls = await collectSlotUrls()
    useAppStore.getState().finalizeDebateHistory(cid, slotUrls)
  }
  useEffect(() => { finalizeDebateHistoryRef.current = finalizeDebateHistory })

  useEffect(() => () => {
    abortRef.current = true
    runVersionRef.current++
    controllerRef.current?.abort()
    clearTimer()
    if (useAppStore.getState().debateState.phase === 'running') useAppStore.getState().setDebatePhase('paused')
  }, [])

  const buildPrompt = (topic: string, round: number, turn: 0 | 1): string => {
    const state = useAppStore.getState().debateState
    // 找对手最近一次发言
    let opponentSpeech = ''
    if (turn === 0) {
      // 正方发言：对手是上一轮的反方
      opponentSpeech = state.rounds[round - 1]?.opponent || ''
    } else {
      // 反方发言：对手是本轮的正方
      opponentSpeech = state.rounds[round]?.proponent || ''
    }
    return buildDebatePrompt({
      topic,
      round,
      turn,
      totalRounds: state.totalRounds,
      opponentSpeech
    })
  }

  const runNextTurn = useCallback(async () => {
    const store = useAppStore.getState()
    if (store.productMode !== 'debate' || store.debateState.phase !== 'running' || abortRef.current || inFlightRef.current) return
    clearTimer()
    inFlightRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    const version = runVersionRef.current
    const cid = conversationIdRef.current
    const isCurrent = (): boolean => !controller.signal.aborted && version === runVersionRef.current && !abortRef.current && useAppStore.getState().productMode === 'debate' && useAppStore.getState().currentConversationId === cid && useAppStore.getState().debateState.phase === 'running'

    try {
      const { currentRound, currentTurn, topic, totalRounds } = store.debateState
      if (currentRound >= totalRounds) {
        store.setDebatePhase('finished')
        void finalizeDebateHistoryRef.current()
        return
      }

      const slotIndex = currentTurn // 0=正方 slot-0, 1=反方 slot-1
      const prompt = buildPrompt(topic, currentRound, currentTurn)

      const key = `${cid}-${currentRound}-${currentTurn}`
      if (pendingTurnRef.current?.key !== key) {
        // 发送前取基线；发送后的快速回复不能被当成旧内容。
        const [target] = await captureResponseTargets([{ slotIndex, modelId: store.debateSlots[slotIndex] }])
        if (!isCurrent()) return
        pendingTurnRef.current = { key, baseline: target.baseline, webContentsId: target.webContentsId, sent: false }
      }
      const pending = pendingTurnRef.current
      if (useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)?.getWebContentsId() !== pending.webContentsId) {
        pendingTurnRef.current = null
        store.setDebatePhase('paused')
        return
      }
      if (!pending.sent) {
        const sendRes = await store.sendToSlot(slotIndex, prompt)
        // 暂停不会取消网页已收到的消息；继续时只等待该条回复，避免再次注入。
        pending.sent = sendRes.success
        if (!isCurrent()) return
        if (!sendRes.success) { store.setDebatePhase('paused'); return }
        if (cid) await store.recordConversationTurn(cid, { turnId: key, userMessage: prompt, timestamp: Date.now(), responses: {} })
      }
      if (!isCurrent()) return

      const speech = await store.getResponseFromSlot(slotIndex, undefined, pending.baseline, controller.signal)
      if (!isCurrent()) return

      // 超时或读取失败时暂停，保留已完成回合与当前发送状态供继续采集
      if (!speech || !speech.trim()) {
        store.setDebatePhase('paused')
        return
      }

      // 落库本轮发言（按 round upsert；currentTurn=0 写 proponent，=1 写 opponent）
      if (cid) {
        const modelId = useAppStore.getState().debateSlots[slotIndex]
        const record: DebateTurnRecord = {
          round: currentRound,
          ...(currentTurn === 0
            ? { proponent: { modelId, speech, timestamp: Date.now() } }
            : { opponent: { modelId, speech, timestamp: Date.now() } }),
        }
        useAppStore.getState().appendDebateTurnToHistory(cid, record)
        await store.recordConversationTurn(cid, {
          turnId: key, userMessage: prompt, timestamp: record.proponent?.timestamp ?? record.opponent!.timestamp,
          responses: { [`slot-${slotIndex}`]: speech, [modelId]: speech }
        })
        const ref = useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)
        if (ref?.getWebContentsId() === pending.webContentsId) {
          const item = useAppStore.getState().history.find(item => item.id === cid)
          store.finalizeDebateHistory(cid, { ...item?.slotUrls, [slotIndex]: ref.getCurrentUrl() })
        }
      } else {
        console.warn('[useDebateRunner] appendDebateTurnToHistory 跳过：conversationId 未就绪', { currentRound, currentTurn })
      }
      if (!isCurrent()) return
      pendingTurnRef.current = null
      store.appendDebateSpeech(currentRound, currentTurn, speech)
      store.advanceDebateTurn()

      // 下一轮稍作延迟
      const next = useAppStore.getState().debateState
      if (next.phase === 'finished') {
        // 自然跑完所有轮：advanceDebateTurn 已把 phase 置 finished，runNextTurn 入口守卫会拦截
        // 下一轮调用，所以 finalize 必须在此处补——否则 slotUrls 不落盘、恢复时不加载 URL。
        void finalizeDebateHistoryRef.current()
        return
      }
    } catch {
      if (isCurrent()) store.setDebatePhase('paused')
    } finally {
      inFlightRef.current = false
      if (!abortRef.current && useAppStore.getState().productMode === 'debate' && useAppStore.getState().debateState.phase === 'running') {
        timerRef.current = setTimeout(() => { void runNextTurn() }, 600)
      }
    }
  }, [])

  const start = useCallback((topic: string) => {
    if (!topic.trim()) return
    abortRef.current = false
    runVersionRef.current++
    controllerRef.current?.abort()
    pendingTurnRef.current = null
    clearTimer()
    // 防御：清掉上一场可能残留的 conversationId（正常路径 finalize 已置 null，
    // 但若上一场异常中断未走 finalize，残留旧 id 会在 IIFE 覆盖前被误用）
    conversationIdRef.current = null
    const store = useAppStore.getState()
    store.setDebateTopic(topic)
    // 重置回合
    useAppStore.setState((s) => ({
      debateState: { ...s.debateState, phase: 'running', currentRound: 0, currentTurn: 0, rounds: [], totalRounds: s.debateTotalRounds }
    }))
    // 创建/续写历史会话：必须 await 完成再 runNextTurn，否则首轮 appendDebateTurnToHistory
    // 会因 conversationIdRef 未就绪被守卫丢弃（Spec §6 半成品辩论恢复依赖每轮落盘完整）。
    void (async () => {
      const { webviewRefs, debateSlots } = useAppStore.getState()
      const currentUrls: Record<string, string> = {}
      for (const slotIndex of [0, 1] as const) {
        const ref = webviewRefs.get(`slot-${slotIndex}`)
        const modelId = debateSlots[slotIndex]
        if (!ref || !modelId) continue
        try {
          const url = ref.getCurrentUrl()
          if (url && url !== 'about:blank') currentUrls[modelId] = url
        } catch { /* 忽略 */ }
      }
      const successModelIds = debateSlots.filter(Boolean) as string[]
      const { conversationId } = await useAppStore.getState().beginConversation({
        successModelIds,
        currentUrls,
        productMode: 'debate',
        displayMode: 'two', // 辩论 displayMode 恒为 'two'（appStore.ts:799 强制）
      })
      if (abortRef.current || useAppStore.getState().productMode !== 'debate' || useAppStore.getState().currentConversationId !== conversationId) return
      conversationIdRef.current = conversationId
      // 把辩题写入历史标题，供 HistoryDrawer 与恢复时使用（Spec §5.6）
      useAppStore.getState().updateHistory(conversationId, { title: topic })
      // conversationId 已就位，启动首轮流转
      runNextTurn()
    })()
  }, [runNextTurn])

  const pause = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase !== 'running') return
    abortRef.current = true
    controllerRef.current?.abort()
    clearTimer()
    store.setDebatePhase('paused')
  }, [])

  const resume = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase !== 'paused') return
    abortRef.current = false
    store.setDebatePhase('running')
    runNextTurn()
  }, [runNextTurn])

  const stop = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase === 'idle' || store.debateState.phase === 'finished') return
    abortRef.current = true
    runVersionRef.current++
    controllerRef.current?.abort()
    pendingTurnRef.current = null
    clearTimer()
    store.setDebatePhase('finished')
    void finalizeDebateHistoryRef.current()
  }, [])

  const reset = useCallback(() => {
    abortRef.current = true
    runVersionRef.current++
    controllerRef.current?.abort()
    pendingTurnRef.current = null
    clearTimer()
    useAppStore.getState().resetDebate()
  }, [])

  return { start, pause, resume, stop, reset }
}
