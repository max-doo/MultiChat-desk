import { Check } from 'lucide-react'
import type { AgentThinkingLevel } from '../../../types/agent'

interface AgentThinkingPickerProps {
  current: AgentThinkingLevel
  levels: AgentThinkingLevel[]
  onSelect: (level: AgentThinkingLevel) => void
  onClose: () => void
}

export const THINKING_LABELS: Record<AgentThinkingLevel, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大'
}

export function AgentThinkingPicker({
  current,
  levels,
  onSelect,
  onClose
}: AgentThinkingPickerProps): JSX.Element {
  return (
    <div className="absolute bottom-full right-0 mb-2 w-40 rounded-xl border border-gray-200 bg-white shadow-lg z-popover py-1 text-label">
      <div className="px-3 py-1 text-caption text-text-secondary">思考强度</div>
      {levels.map((level) => {
        const isActive = current === level
        return (
          <button
            key={level}
            type="button"
            onClick={() => {
              onSelect(level)
              onClose()
            }}
            className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors ${
              isActive ? 'bg-blue-50/60 text-primary' : 'text-text-primary hover:bg-gray-50'
            }`}
          >
            <span>{THINKING_LABELS[level]}</span>
            {isActive && <Check className="w-3.5 h-3.5" />}
          </button>
        )
      })}
    </div>
  )
}
