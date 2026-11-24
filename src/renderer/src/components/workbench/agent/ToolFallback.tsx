import { useState } from 'react'
import { Wrench, ChevronDown, ChevronRight, AlertCircle, Loader2 } from 'lucide-react'

interface ToolFallbackProps {
  toolName: string
  args?: unknown
  result?: unknown
  isError?: boolean
  isRunning?: boolean
}

export function ToolFallback({
  toolName,
  args,
  result,
  isError = false,
  isRunning = false
}: ToolFallbackProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const argsSummary = args
    ? typeof args === 'string'
      ? args
      : Object.entries(args as Record<string, unknown>)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(', ')
    : ''

  return (
    <div className="my-1 text-xs font-mono select-none">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-100 cursor-pointer text-text-secondary hover:text-text-primary transition-colors group"
      >
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
        ) : isError ? (
          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
        ) : (
          <Wrench className="w-3.5 h-3.5 text-text-secondary shrink-0" />
        )}

        <span className="truncate flex-1 font-medium text-text-primary">
          {isRunning ? '正在调用: ' : isError ? '调用出错: ' : '调用工具: '}
          <span className="text-text-primary font-semibold">{toolName}</span>
          {argsSummary && <span className="text-text-secondary font-normal ml-1">({argsSummary})</span>}
        </span>

        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        )}
      </div>

      {expanded && (
        <div className="mt-1 ml-5 p-2 rounded-lg bg-gray-50 border border-gray-200 text-[11px] relative select-text space-y-2">
          {args !== undefined && (
            <div>
              <div className="text-[10px] text-gray-400 uppercase font-semibold mb-1">参数</div>
              <pre className="p-2 rounded bg-white border border-gray-100 whitespace-pre-wrap break-all text-gray-700 font-mono">
                {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {result !== undefined && (
            <div>
              <div className="text-[10px] text-gray-400 uppercase font-semibold mb-1">结果</div>
              <pre className="max-h-48 overflow-y-auto p-2 rounded bg-white border border-gray-100 whitespace-pre-wrap break-all text-gray-700 font-mono">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
