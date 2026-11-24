import { useState } from 'react'
import { Terminal, ChevronDown, ChevronRight, Check, Copy, AlertCircle, Loader2 } from 'lucide-react'

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

  // Tail last 200 lines if too long
  const lines = outputText.split('\n')
  const truncatedText =
    lines.length > 200
      ? `... [已折叠前 ${lines.length - 200} 行]\n` + lines.slice(-200).join('\n')
      : outputText

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
          <Terminal className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 shrink-0" />
        )}

        <span className="truncate flex-1 font-medium text-text-primary">
          {isRunning ? '正在运行: ' : isError ? '运行出错: ' : '已运行: '}
          <span className="text-text-secondary font-normal">{displayCommand}</span>
        </span>

        {durationMs !== undefined && (
          <span className="text-[10px] text-gray-400 shrink-0">{durationMs}ms</span>
        )}

        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        )}
      </div>

      {expanded && (
        <div className="mt-1 ml-5 p-2.5 rounded-lg bg-gray-900 text-gray-100 border border-gray-800 text-[11px] leading-relaxed relative select-text">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-gray-800 text-gray-400">
            <span className="truncate pr-2 font-mono text-[10.5px] text-gray-300">$ {displayCommand}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors shrink-0"
              title="复制命令及输出"
            >
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-all font-mono">
            {truncatedText || (isRunning ? '等待命令输出...' : '(无标准输出)')}
          </pre>
        </div>
      )}
    </div>
  )
}
