import { useState } from 'react'
import { Terminal, ChevronDown, Check, Copy, AlertCircle, Loader2 } from 'lucide-react'

interface BashToolUIProps {
  command?: string
  result?: unknown
  isError?: boolean
  isRunning?: boolean
  durationMs?: number
}

export function BashToolUI({
  command = '',
  result,
  isError = false,
  isRunning = false,
  durationMs
}: BashToolUIProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const outputText = typeof result === 'string' ? result : result ? JSON.stringify(result, null, 2) : ''
  const displayCommand = command || '(empty command)'

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const textToCopy = outputText ? `${displayCommand}\n\n${outputText}` : displayCommand
    void navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 截断过长输出防止极端卡顿（保留后 200 行）
  const lines = outputText.split('\n')
  const truncatedText =
    lines.length > 200
      ? `... [已折叠前 ${lines.length - 200} 行]\n` + lines.slice(-200).join('\n')
      : outputText

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
              <Terminal className="w-3.5 h-3.5" />
            )}
          </div>

          <span className="text-caption font-medium text-text-primary shrink-0">
            {isRunning ? '正在运行' : isError ? '运行出错' : '已运行'}
          </span>

          {/* 命令胶囊 */}
          <span className="px-2 py-0.5 rounded-md bg-white text-text-primary border border-slate-200/80 font-mono text-caption truncate max-w-[240px] shadow-2xs">
            {displayCommand}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {durationMs !== undefined && (
            <span className="text-tiny font-mono text-text-secondary">{durationMs}ms</span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-text-secondary transition-transform duration-200 ${
              expanded ? 'rotate-180 text-text-primary' : 'group-hover:text-text-primary'
            }`}
          />
        </div>
      </button>

      {/* 展开的浅色终端视窗 */}
      {expanded && (
        <div className="border-t border-slate-200/80 bg-white p-3 text-caption leading-relaxed relative select-text">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
            <span className="truncate pr-2 font-mono text-caption text-text-primary font-medium">
              $ {displayCommand}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 p-1 px-1.5 rounded hover:bg-slate-100 text-text-secondary hover:text-text-primary transition-colors shrink-0 text-tiny"
              title="复制命令与输出"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span className="text-emerald-600 font-medium">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>复制</span>
                </>
              )}
            </button>
          </div>

          <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all font-mono text-caption text-slate-700 bg-slate-50/70 p-3 rounded-lg border border-slate-100 leading-relaxed selection:bg-blue-100">
            {truncatedText || (isRunning ? '等待命令输出...' : '(无标准输出)')}
          </pre>
        </div>
      )}
    </div>
  )
}
