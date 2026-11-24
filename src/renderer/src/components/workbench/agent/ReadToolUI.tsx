import { useState } from 'react'
import { FileText, ChevronDown, ChevronRight, AlertCircle, Loader2, Copy, Check } from 'lucide-react'

interface ReadToolUIProps {
  path?: string
  lines?: string | number[]
  result?: unknown
  isError?: boolean
  isRunning?: boolean
}

export function ReadToolUI({
  path = '',
  lines,
  result,
  isError = false,
  isRunning = false
}: ReadToolUIProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const contentText =
    typeof result === 'string'
      ? result
      : result && typeof result === 'object' && 'content' in result
      ? String((result as { content: unknown }).content || '')
      : result
      ? JSON.stringify(result, null, 2)
      : ''

  const fileName = path ? path.split(/[/\\]/).pop() || path : '文件'
  const lineLabel = lines ? (Array.isArray(lines) ? lines.join('-') : String(lines)) : ''

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void navigator.clipboard.writeText(contentText || path)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
          <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        )}

        <span className="truncate flex-1 font-medium text-text-primary">
          {isRunning ? '正在读取: ' : isError ? '读取出错: ' : '读取了: '}
          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-normal border border-amber-200/60 ml-1">
            {fileName}
            {lineLabel ? `:${lineLabel}` : ''}
          </span>
        </span>

        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        )}
      </div>

      {expanded && (
        <div className="mt-1 ml-5 p-2 rounded-lg bg-gray-50 border border-gray-200 text-[11px] relative select-text">
          <div className="flex items-center justify-between pb-1 mb-1.5 border-b border-gray-200 text-gray-500 text-[10.5px]">
            <span className="truncate pr-2 font-mono text-gray-600">
              {path} {lineLabel ? `(lines: ${lineLabel})` : ''}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors shrink-0"
              title="复制代码内容"
            >
              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all p-2 rounded bg-white border border-gray-100 font-mono text-gray-800 leading-relaxed">
            {contentText || (isRunning ? '读取中...' : '(空内容)')}
          </pre>
        </div>
      )}
    </div>
  )
}
