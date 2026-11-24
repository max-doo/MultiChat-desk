import { useState } from 'react'

interface ThinkingBlockProps {
  thinking: string
  isRunning?: boolean
}

/**
 * 极简思维链呈现：
 * 默认折叠成一行避免占用过多屏幕；点击可展开/收起查看完整思考过程。
 */
export function ThinkingBlock({ thinking, isRunning = false }: ThinkingBlockProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (!thinking && !isRunning) return null

  const trimmed = thinking.trim()
  // 折叠态压缩为单行；展开态保留原始换行与缩进
  const collapsedText = trimmed.replace(/\s+/g, ' ')

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="w-full flex items-start gap-2 py-0.5 my-1 text-caption font-sans text-slate-400 select-text min-w-0 text-left hover:bg-slate-50/60 rounded transition-colors cursor-pointer"
      title={expanded ? '点击收起' : '点击展开完整思考'}
    >
      <span className="pt-1 shrink-0">
        <span className="block w-1.5 h-1.5 rounded-full bg-slate-300" />
      </span>

      <span
        className={`italic tracking-tight flex-1 min-w-0 ${
          isRunning ? 'text-shimmer' : 'text-slate-500'
        } ${
          expanded ? 'whitespace-pre-wrap break-words' : 'truncate'
        }`}
      >
        {expanded
          ? trimmed || (isRunning ? '正在思考…' : '')
          : collapsedText || (isRunning ? '正在思考…' : '')}
      </span>
    </button>
  )
}
