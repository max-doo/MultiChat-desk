import { useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { buildDebatePrompt } from '../utils/debatePrompts'

/**
 * 辩论轮转驱动：正方(slot-0) ↔ 反方(slot-1) 自动交替。
 * 通过 store 的 debateState 推进；本 hook 持有 abort 标志与定时器。
 */
export function useDebateRunner() {
  const abortRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  useEffect(() => () => { abortRef.current = true; clearTimer() }, [])

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
    if (store.debateState.phase !== 'running') return
    if (abortRef.current) return

    const { currentRound, currentTurn, topic, totalRounds } = store.debateState
    if (currentRound >= totalRounds) {
      store.setDebatePhase('finished')
      return
    }

    const slotIndex = currentTurn // 0=正方 slot-0, 1=反方 slot-1
    const prompt = buildPrompt(topic, currentRound, currentTurn)

    // 发送 + 等待回复
    const sendRes = await store.sendToSlot(slotIndex, prompt)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return
    if (!sendRes.success) {
      // 发送失败：标记 finished 并通知（通知由 UI 层读 phase 处理）
      store.setDebatePhase('finished')
      return
    }
    // 发送后立即取基线：此刻新回复尚未渲染，getLatestResponse 读到的是上一轮旧回复或空，
    // 作为「必须出现与之不同的新内容」的参照，避免把旧回复误判为新回复。
    const baselineRef = useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)
    const baseline = baselineRef ? await baselineRef.getLatestResponse().catch(() => '') : ''
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    const speech = await store.getResponseFromSlot(slotIndex, 120000, baseline)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    // 空回复（超时未出现新回复或未稳定）→ 中止辩论，不再写占位回合继续推进
    if (!speech || !speech.trim()) {
      store.setDebatePhase('finished')
      return
    }

    store.appendDebateSpeech(currentRound, currentTurn, speech)
    store.advanceDebateTurn()

    // 下一轮稍作延迟
    const next = useAppStore.getState().debateState
    if (next.phase === 'running') {
      timerRef.current = setTimeout(() => { runNextTurn() }, 600)
    }
  }, [])

  const start = useCallback((topic: string) => {
    if (!topic.trim()) return
    abortRef.current = false
    clearTimer()
    const store = useAppStore.getState()
    store.setDebateTopic(topic)
    // 重置回合
    useAppStore.setState((s) => ({
      debateState: { ...s.debateState, phase: 'running', currentRound: 0, currentTurn: 0, rounds: [], totalRounds: s.debateTotalRounds }
    }))
    runNextTurn()
  }, [runNextTurn])

  const pause = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase !== 'running') return
    abortRef.current = true
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
    clearTimer()
    store.setDebatePhase('finished')
  }, [])

  const reset = useCallback(() => {
    abortRef.current = true
    clearTimer()
    useAppStore.getState().resetDebate()
  }, [])

  return { start, pause, resume, stop, reset }
}
