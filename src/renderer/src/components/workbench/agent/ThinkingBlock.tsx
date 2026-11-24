import { useState } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'

interface ThinkingBlockProps {
  thinking: string
  isRunning?: boolean
}

export function ThinkingBlock({ thinking, isRunning = false }: ThinkingBlockProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)

  if (!thinking && !isRunning) return null

  return (
    <div className="my-1.5 select-none text-xs">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary cursor-pointer w-fit py-0.5 transition-colors group"
      >
        <Brain className={`w-3.5 h-3.5 ${isRunning ? 'text-primary animate-pulse' : 'text-text-secondary'}`} />
        <span className="font-normal text-[11.5px]">
          {isRunning ? '正在思考中...' : '思考过程'}
        </span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-secondary" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-secondary" />
        )}
      </div>

      {expanded && (
        <div className="mt-1 pl-2.5 border-l-2 border-primary/30 py-1.5 text-[11.5px] text-text-secondary leading-relaxed font-mono bg-blue-50/40 rounded-r-lg whitespace-pre-wrap select-text max-h-56 overflow-y-auto">
          {thinking || '思考中...'}
        </div>
      )}
    </div>
  )
}
