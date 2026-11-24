import { useState } from 'react'
import { Wrench, ChevronDown, AlertCircle, Loader2 } from 'lucide-react'

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
    <div className="my-2 select-none rounded-xl border border-slate-200/90 bg-slate-50/50 shadow-2xs overflow-hidden transition-all duration-150">
      <button
        type="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-slate-100/60 transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* 工具小图标 Badge */}
          <div
            className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
              isRunning
                ? 'bg-primary/10 text-primary'
                : isError
                ? 'bg-red-50 text-red-500'
                : 'bg-slate-200/60 text-slate-700'
            }`}
          >
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isError ? (
              <AlertCircle className="w-3.5 h-3.5" />
            ) : (
              <Wrench className="w-3.5 h-3.5" />
            )}
          </div>

          <span className="text-caption font-medium text-text-primary shrink-0">
            {isRunning ? '正在调用' : isError ? '调用出错' : '调用工具'}
          </span>

          <span className="px-2 py-0.5 rounded-md bg-white text-text-primary border border-slate-200/80 font-mono text-caption truncate max-w-[140px] shadow-2xs font-semibold">
            {toolName}
          </span>

          {argsSummary && (
            <span className="text-text-secondary font-mono text-caption truncate max-w-[160px]">
              ({argsSummary})
            </span>
          )}
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-text-secondary transition-transform duration-200 shrink-0 ml-2 ${
            expanded ? 'rotate-180 text-text-primary' : 'group-hover:text-text-primary'
          }`}
        />
      </button>

      {/* 展开的浅色参数与输出视窗 */}
      {expanded && (
        <div className="border-t border-slate-200/80 bg-white p-3 text-caption leading-relaxed relative select-text space-y-2.5">
          {args !== undefined && (
            <div>
              <div className="text-tiny text-text-secondary uppercase font-semibold mb-1 tracking-wider">参数</div>
              <pre className="p-2.5 rounded-lg bg-slate-50/70 border border-slate-100 whitespace-pre-wrap break-all text-slate-700 font-mono text-caption leading-relaxed">
                {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {result !== undefined && (
            <div>
              <div className="text-tiny text-text-secondary uppercase font-semibold mb-1 tracking-wider">结果</div>
              <pre className="max-h-52 overflow-y-auto p-2.5 rounded-lg bg-slate-50/70 border border-slate-100 whitespace-pre-wrap break-all text-slate-700 font-mono text-caption leading-relaxed selection:bg-blue-100">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
