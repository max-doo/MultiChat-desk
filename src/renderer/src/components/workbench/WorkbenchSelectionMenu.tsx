import { forwardRef } from 'react'
import type { WorkbenchAiAction } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'

export interface SelectionMenuActionItem {
  action: WorkbenchAiAction | 'mindmap'
  label: string
  icon: string
  color: string
}

export const WORKBENCH_AI_SELECTION_ACTIONS: SelectionMenuActionItem[] = [
  { action: 'ask', label: '向 AI 提问', icon: 'chat', color: 'text-blue-500' },
  { action: 'explain', label: '解释此内容', icon: 'psychology', color: 'text-purple-500' },
  { action: 'polish', label: '语言润色', icon: 'auto_fix_high', color: 'text-emerald-500' },
  { action: 'summarize', label: '提取关键要点', icon: 'format_list_bulleted', color: 'text-cyan-500' },
  { action: 'mindmap', label: '生成思维导图', icon: 'diagram_flow_horizontal', color: 'text-indigo-500' }
]

interface WorkbenchSelectionMenuProps {
  x: number
  y: number
  items: SelectionMenuActionItem[]
  onSelectAction: (action: WorkbenchAiAction | 'mindmap') => void
  onCopy: () => void
}

/** Markdown / PDF / Word 文本选区共用的 AI 快捷右键菜单。 */
const WorkbenchSelectionMenu = forwardRef<HTMLDivElement, WorkbenchSelectionMenuProps>(
  function WorkbenchSelectionMenu({ x, y, items, onSelectAction, onCopy }, ref) {
    return (
      <div
        ref={ref}
        className="fixed z-popover min-w-[190px] py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-body"
        style={{ left: x, top: y }}
      >
        {items.map((item) => (
          <button
            key={item.action}
            type="button"
            onClick={() => onSelectAction(item.action)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <AppIcon name={item.icon} size={19} className={item.color} />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
        <div className="my-1 border-t border-black/5 dark:border-white/5" />
        <button
          type="button"
          onClick={onCopy}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <AppIcon name="content_copy" size={19} />
          <span>复制选中文本</span>
        </button>
      </div>
    )
  }
)

export default WorkbenchSelectionMenu
