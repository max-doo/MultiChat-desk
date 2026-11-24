import { useState } from 'react'
import { FileText, ChevronDown, AlertCircle, Loader2, Copy, Check } from 'lucide-react'

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
    <div className="my-2 select-none rounded-xl border border-slate-200/90 bg-slate-50/50 shadow-2xs overflow-hidden transition-all duration-150">
      <button
        type="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-slate-100/60 transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* 读取小图标 Badge */}
          <div
            className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
              isRunning
                ? 'bg-primary/10 text-primary'
                : isError
                ? 'bg-red-50 text-red-500'
                : 'bg-amber-50 text-amber-600'
            }`}
          >
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isError ? (
              <AlertCircle className="w-3.5 h-3.5" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
          </div>

          <span className="text-caption font-medium text-text-primary shrink-0">
            {isRunning ? '正在读取' : isError ? '读取出错' : '已读取'}
          </span>

          {/* 文件名胶囊 */}
          <span className="px-2 py-0.5 rounded-md bg-amber-50/80 text-amber-800 font-mono text-caption border border-amber-200/70 truncate max-w-[240px] shadow-2xs">
            {fileName}
            {lineLabel ? `:${lineLabel}` : ''}
          </span>
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-text-secondary transition-transform duration-200 shrink-0 ml-2 ${
            expanded ? 'rotate-180 text-text-primary' : 'group-hover:text-text-primary'
          }`}
        />
      </button>

      {/* 展开的浅色读取内容视窗 */}
      {expanded && (
        <div className="border-t border-slate-200/80 bg-white p-3 text-caption leading-relaxed relative select-text">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
            <span className="truncate pr-2 font-mono text-caption text-text-primary font-medium" title={path}>
              {path} {lineLabel ? `(行: ${lineLabel})` : ''}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 p-1 px-1.5 rounded hover:bg-slate-100 text-text-secondary hover:text-text-primary transition-colors shrink-0 text-tiny"
              title="复制代码内容"
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

          <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all p-3 rounded-lg bg-slate-50/70 border border-slate-100 font-mono text-caption text-slate-700 leading-relaxed selection:bg-blue-100">
            {contentText || (isRunning ? '读取中...' : '(空内容)')}
          </pre>
        </div>
      )}
    </div>
  )
}
