import { useAppStore, type TaskSubtask } from '../../store/appStore'

interface SubtaskListProps {
  subtasks: TaskSubtask[]
  collapsed: boolean
}

/**
 * 任务模式的子任务上拉列表：每项可编辑文本。
 * 列表绝对定位在输入框上方（bottom:100%），折叠时不占垂直空间。
 */
function SubtaskList({ subtasks, collapsed }: SubtaskListProps): JSX.Element | null {
  const models = useAppStore((s) => s.models)
  const updateSubtask = useAppStore((s) => s.updateSubtask)
  const toggleTaskCollapsed = useAppStore((s) => s.toggleTaskCollapsed)
  const taskAssignmentSlots = useAppStore((s) => s.taskAssignmentSlots)

  if (collapsed) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 z-40">
        <button
          onClick={toggleTaskCollapsed}
          className="w-full flex items-center justify-between px-4 py-2 rounded-xl glass-panel shadow-float text-sm text-text-primary hover:bg-white/60"
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-primary">checklist</span>
            {subtasks.length} 个子任务（已折叠）
          </span>
          <span className="material-symbols-outlined text-base text-text-secondary">expand_more</span>
        </button>
      </div>
    )
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-40 max-h-[280px] overflow-y-auto rounded-2xl glass-panel-heavy shadow-float border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-bold text-text-secondary flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base text-primary">checklist</span>
          {subtasks.length} 个子任务 · 可编辑与指派
        </span>
        <button
          onClick={toggleTaskCollapsed}
          className="text-text-secondary hover:text-primary"
          title="折叠"
        >
          <span className="material-symbols-outlined text-base">expand_less</span>
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {subtasks.map((st, i) => {
          const modelId = taskAssignmentSlots[st.slotIndex]
          const assigned = models.find(m => m.id === modelId)
          return (
            <div key={i} className="flex items-start gap-2 bg-white/60 rounded-xl p-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <textarea
                value={st.text}
                onChange={(e) => updateSubtask(i, { text: e.target.value })}
                rows={2}
                className="flex-grow min-w-0 bg-transparent border-0 focus:ring-0 focus:outline-none text-sm text-text-primary resize-none p-0"
                style={{ lineHeight: '20px' }}
              />
              <div
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50/50 text-primary/80 text-xs font-medium flex-shrink-0 mt-0.5"
                title={`指派槽位（slot ${st.slotIndex + 1}）`}
              >
                <img src={assigned?.logo} alt="" className="w-3.5 h-3.5" onError={(e) => e.currentTarget.style.display = 'none'} />
                {assigned?.name || '未指派'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SubtaskList
