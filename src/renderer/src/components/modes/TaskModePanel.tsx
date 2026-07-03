import { useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import SubtaskList from './SubtaskList'
import TaskSplitModal from './TaskSplitModal'

interface TaskModePanelProps {
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}

/**
 * 任务模式 ControlBar 中段：
 * - idle: 输入框可编辑 query，按钮=拆解
 * - split: 输入框只读显示原 query，上方子任务弹层，按钮=一键发送；取消回到 idle
 * - sent: 已发送
 */
function TaskModePanel({ showNotification }: TaskModePanelProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const taskState = useAppStore((s) => s.taskState)
  const setTaskQuery = useAppStore((s) => s.setTaskQuery)
  const setTaskPhase = useAppStore((s) => s.setTaskPhase)
  const setTaskSubtasks = useAppStore((s) => s.setTaskSubtasks)
  const resetTask = useAppStore((s) => s.resetTask)
  const webviewRefs = useAppStore((s) => s.webviewRefs)
  const { split, isLoading } = useTaskSplit()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const isSplit = taskState.phase === 'split'
  const isSent = taskState.phase === 'sent'

  const handleSplit = async () => {
    if (!taskState.query.trim() || isLoading) return
    const r = await split(taskState.query)
    if (!r.ok) {
      setModalError(r.error ?? '拆解失败')
      setModalOpen(true)
    }
  }

  const handleCancel = () => {
    setTaskPhase('idle')
    setTaskSubtasks([])
    setTimeout(() => textareaRef.current?.focus(), 50)
    showNotification('info', '已取消拆解，可继续编辑')
  }

  // 一键发送：按子任务 slotIndex 分组，每个槽位发送其指派的子任务文本。
  // 直接用 slotIndex（而非 modelId 反查 taskAssignmentSlots）——多窗口选同一模型时
  // modelId 无法区分槽位，靠 slotIndex 才能保证每个窗口各收一条。
  const handleSend = async () => {
    if (taskState.subtasks.length === 0) return
    setTaskPhase('sent')
    const bySlot = new Map<number, string[]>()
    taskState.subtasks.forEach((st) => {
      const slotIndex = Math.max(0, st.slotIndex)
      if (!bySlot.has(slotIndex)) bySlot.set(slotIndex, [])
      bySlot.get(slotIndex)!.push(st.text)
    })
    let okCount = 0
    let failCount = 0
    for (const [slotIndex, texts] of bySlot) {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      if (!ref) { failCount++; continue }
      const combined = texts.map((t, i) => `【子任务${i + 1}】\n${t}`).join('\n\n')
      try {
        const r = await ref.sendMessage(combined)
        if (r.success) okCount++; else failCount++
      } catch {
        failCount++
      }
    }
    if (failCount === 0) showNotification('success', `已向 ${okCount} 个槽位发送子任务`)
    else if (okCount === 0) showNotification('error', '所有槽位发送失败')
    else showNotification('info', `${okCount} 成功，${failCount} 失败`)
  }

  const handleNewRound = () => {
    resetTask()
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  return (
    <div className="relative flex-grow flex items-center gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float focus-within:border-gray-200 focus-within:ring-1 focus-within:ring-gray-200" style={{ height: '96px', flexShrink: 0, boxSizing: 'border-box' }}>
      {/* 子任务弹层（仅 split 阶段） */}
      {isSplit && <SubtaskList subtasks={taskState.subtasks} collapsed={taskState.collapsed} />}

      {/* 输入框 */}
      <textarea
        ref={textareaRef}
        value={taskState.query}
        onChange={(e) => { if (taskState.phase === 'idle') setTaskQuery(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current && taskState.phase === 'idle') {
            e.preventDefault()
            handleSplit()
          }
        }}
        onCompositionStart={() => {
          isComposingRef.current = true
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false
        }}
        readOnly={isSplit || isSent}
        placeholder={isSent ? '子任务已发送，点击右侧新建一轮拆解' : '输入总目标，点击拆解自动分配子任务…'}
        className="flex-grow bg-transparent border-0 focus:ring-0 focus:outline-none text-text-primary placeholder-text-secondary p-0 resize-none disabled:cursor-not-allowed"
        style={{ lineHeight: '24px', height: '72px', overflowY: 'auto' }}
      />

      {/* 按钮区 */}
      <div className="flex items-center gap-2 flex-shrink-0 self-end">
        {isSplit && (
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-xl bg-gray-200 text-gray-600 hover:bg-gray-300 text-sm"
          >
            取消
          </button>
        )}
        {isSent ? (
          <button
            onClick={handleNewRound}
            className="h-12 w-12 rounded-full bg-primary text-white hover:opacity-90 flex items-center justify-center"
            title="新建一轮拆解"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        ) : (
          <button
            onClick={isSplit ? handleSend : handleSplit}
            disabled={isLoading || (!isSplit && !taskState.query.trim())}
            className={`rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 ${
              isSplit
                ? 'bg-primary text-white hover:opacity-90 px-4 h-12'
                : taskState.query.trim() ? 'bg-primary text-white hover:opacity-90 h-12 w-12' : 'h-12 w-12 bg-gray-100 hover:bg-gray-200 text-text-secondary'
            }`}
            title={isSplit ? '一键发送所有子任务' : '拆解总目标'}
          >
            {isLoading ? (
              <span className="material-symbols-outlined animate-spin">sync</span>
            ) : isSplit ? (
              <>
                <span className="material-symbols-outlined">send</span>
                <span className="text-sm font-bold">一键发送</span>
              </>
            ) : (
              <span className="material-symbols-outlined">call_split</span>
            )}
          </button>
        )}
      </div>
      <TaskSplitModal
        open={modalOpen}
        initialError={modalError}
        onClose={() => setModalOpen(false)}
        showNotification={showNotification}
      />
    </div>
  )
}

export default TaskModePanel
