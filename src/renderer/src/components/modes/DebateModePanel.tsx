import { useRef, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { useDebateRunner } from '../../hooks/useDebateRunner'

interface DebateModePanelProps {
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}

/**
 * 辩论模式 ControlBar 中段（固定 96px 高）。
 * 左侧 funcGroup 区放轮次 stepper（由 ControlBar 渲染，本组件只渲染中段）。
 * 中段：idle=主题输入；进行中=圆点滚动条 + 右侧固定按钮。
 */
function DebateModePanel({ showNotification }: DebateModePanelProps): JSX.Element {
  const debateState = useAppStore((s) => s.debateState)
  const debateSlots = useAppStore((s) => s.debateSlots)
  const models = useAppStore((s) => s.models)
  const productMode = useAppStore((s) => s.productMode)
  const { start, pause, resume, stop, reset } = useDebateRunner()
  const dotsRef = useRef<HTMLDivElement>(null)

  const { phase, currentRound, currentTurn, totalRounds, topic } = debateState
  const isIdle = phase === 'idle'
  const isRunning = phase === 'running'
  const isPaused = phase === 'paused'
  const isFinished = phase === 'finished'

  // 自动滚动到当前圆点
  useEffect(() => {
    const active = dotsRef.current?.querySelector('.debate-dot.active') as HTMLElement | null
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [currentRound, currentTurn, phase])

  // 完成时通知：仅在辩论模式内显示，且自动消失，避免泄漏到 multi_ai 等模式
  useEffect(() => {
    if (phase === 'finished' && productMode === 'debate') {
      showNotification('success', '辩论已结束，可生成裁判评析', 4000)
    }
  }, [phase, productMode, showNotification])

  const handleStart = () => {
    if (!topic.trim()) { showNotification('error', '请输入辩论主题'); return }
    start(topic)
  }

  // 圆点数据：每轮 2 个
  const dots: { round: number; turn: 0 | 1 }[] = []
  for (let r = 0; r < totalRounds; r++) {
    dots.push({ round: r, turn: 0 })
    dots.push({ round: r, turn: 1 })
  }
  const doneIdx = currentRound * 2 + (currentTurn === 1 && !isIdle ? 1 : 0)

  const speakingRole = currentTurn === 0 ? '正方' : '反方'
  const speakingModel = models.find(m => m.id === (currentTurn === 0 ? debateSlots[0] : debateSlots[1]))

  if (isIdle) {
    return (
      <div className="relative flex-grow flex items-center gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float focus-within:border-gray-200 focus-within:ring-1 focus-within:ring-gray-200" style={{ height: '96px', flexShrink: 0, boxSizing: 'border-box' }}>
        <span className="material-symbols-outlined text-text-secondary flex-shrink-0">forum</span>
        <textarea
          value={topic}
          onChange={(e) => useAppStore.getState().setDebateTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStart() } }}
          placeholder="输入辩论主题，例如：AI 是否会取代程序员？"
          className="flex-grow bg-transparent border-0 focus:ring-0 focus:outline-none text-text-primary placeholder-text-secondary p-0 resize-none"
          style={{ lineHeight: '24px', height: '72px', overflowY: 'auto' }}
        />
        <button
          onClick={handleStart}
          disabled={!topic.trim()}
          className="rounded-full bg-primary text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 px-4 h-12 flex-shrink-0 self-end"
        >
          <span className="material-symbols-outlined">play_arrow</span>
          <span className="text-sm font-bold">开始辩论</span>
        </button>
      </div>
    )
  }

  // running / paused / finished
  return (
    <div className="relative flex-grow flex items-center gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float" style={{ height: '96px', flexShrink: 0, boxSizing: 'border-box', minWidth: 0, overflow: 'hidden' }}>
      {/* 左：状态信息 */}
      <div className="flex flex-col flex-shrink-0 min-w-[120px]">
        <span className="text-xs text-text-secondary">
          轮次 {Math.min(currentRound + 1, totalRounds)}/{totalRounds}
        </span>
        <span className="text-sm font-medium text-text-primary flex items-center gap-1">
          {isRunning && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
          {isPaused && <span className="w-2 h-2 rounded-full bg-yellow-500" />}
          {isFinished && <span className="w-2 h-2 rounded-full bg-green-500" />}
          {isRunning ? `${speakingRole}发言中…` : isPaused ? `暂停于第${currentRound + 1}轮${speakingRole}` : `共${totalRounds}轮完成`}
        </span>
        <span className="text-xs text-text-secondary truncate">{speakingModel?.name}</span>
      </div>

      {/* 中：圆点滚动条 */}
      <div ref={dotsRef} className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto py-1" style={{ scrollbarWidth: 'thin' }}>
        {dots.map((d, i) => {
          let cls = 'debate-dot border border-gray-300 text-text-secondary bg-white/40'
          let icon = 'radio_button_unchecked'
          if (i < doneIdx || isFinished) { cls = 'debate-dot bg-green-100 text-green-600 border-green-300'; icon = 'check' }
          else if (i === doneIdx && (isRunning || isPaused)) { cls = 'debate-dot active bg-blue-50 text-primary border-blue-300 scale-110'; icon = 'radio_button_checked' }
          return (
            <div key={`${d.round}-${d.turn}`} className={`debate-dot ${cls} flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all`} title={`第${d.round + 1}轮 ${d.turn === 0 ? '正方' : '反方'}`}>
              <span className="material-symbols-outlined text-base">{icon}</span>
            </div>
          )
        })}
      </div>

      {/* 右：固定按钮 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isRunning && (
          <button onClick={pause} className="px-3 py-2 rounded-xl bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm flex items-center gap-1">
            <span className="material-symbols-outlined text-base">pause</span>暂停
          </button>
        )}
        {isPaused && (
          <button onClick={resume} className="px-3 py-2 rounded-xl bg-primary text-white hover:opacity-90 text-sm flex items-center gap-1">
            <span className="material-symbols-outlined text-base">play_arrow</span>继续
          </button>
        )}
        {(isRunning || isPaused) && (
          <button onClick={stop} className="px-3 py-2 rounded-xl bg-red-100 text-red-600 hover:bg-red-200 text-sm flex items-center gap-1">
            <span className="material-symbols-outlined text-base">stop</span>终止
          </button>
        )}
        {isFinished && (
          <button onClick={reset} className="h-10 w-10 rounded-full bg-primary text-white hover:opacity-90 flex items-center justify-center" title="新辩论">
            <span className="material-symbols-outlined">add</span>
          </button>
        )}
      </div>
    </div>
  )
}

export default DebateModePanel
