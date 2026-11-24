import { useState, useMemo } from 'react'
import { FileEdit, ChevronDown, AlertCircle, Loader2, Copy, Check } from 'lucide-react'
import { parseDiff, Diff, Hunk } from 'react-diff-view'
import 'react-diff-view/style/index.css'

interface EditToolUIProps {
  path?: string
  diff?: string
  result?: unknown
  isError?: boolean
  isRunning?: boolean
}

export function EditToolUI({
  path = '',
  diff = '',
  result,
  isError = false,
  isRunning = false
}: EditToolUIProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const diffContent = useMemo(() => {
    if (diff) return diff
    if (typeof result === 'string') return result
    if (result && typeof result === 'object' && 'diff' in result) {
      return String((result as { diff: unknown }).diff || '')
    }
    return ''
  }, [diff, result])

  const parsedFiles = useMemo(() => {
    if (!diffContent) return []
    try {
      return parseDiff(diffContent)
    } catch {
      return []
    }
  }, [diffContent])

  const fileName = path ? path.split(/[/\\]/).pop() || path : '文件'

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void navigator.clipboard.writeText(diffContent || path)
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
          {/* 编辑小图标 Badge */}
          <div
            className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
              isRunning
                ? 'bg-primary/10 text-primary'
                : isError
                ? 'bg-red-50 text-red-500'
                : 'bg-purple-50 text-purple-600'
            }`}
          >
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isError ? (
              <AlertCircle className="w-3.5 h-3.5" />
            ) : (
              <FileEdit className="w-3.5 h-3.5" />
            )}
          </div>

          <span className="text-caption font-medium text-text-primary shrink-0">
            {isRunning ? '正在编辑' : isError ? '编辑出错' : '已编辑'}
          </span>

          {/* 文件名胶囊 */}
          <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-mono text-caption border border-blue-200/60 truncate max-w-[240px] shadow-2xs">
            {fileName}
          </span>
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-text-secondary transition-transform duration-200 shrink-0 ml-2 ${
            expanded ? 'rotate-180 text-text-primary' : 'group-hover:text-text-primary'
          }`}
        />
      </button>

      {/* 展开的浅色 Diff 视窗 */}
      {expanded && (
        <div className="border-t border-slate-200/80 bg-white p-3 text-caption leading-relaxed relative select-text">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
            <span className="truncate pr-2 font-mono text-caption text-text-primary font-medium" title={path}>
              {path}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 p-1 px-1.5 rounded hover:bg-slate-100 text-text-secondary hover:text-text-primary transition-colors shrink-0 text-tiny"
              title="复制 Diff 文本"
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

          <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg bg-white border border-slate-200/80 text-caption font-mono selection:bg-blue-100">
            {parsedFiles.length > 0 ? (
              parsedFiles.map((file, i) => (
                <Diff key={i} viewType="unified" diffType={file.type} hunks={file.hunks}>
                  {(hunks) =>
                    hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
                  }
                </Diff>
              ))
            ) : (
              <pre className="p-3 text-caption font-mono text-slate-600 whitespace-pre-wrap break-all leading-relaxed bg-slate-50/50">
                {diffContent || (isRunning ? '生成 Diff 中...' : '(无详细变更差异)')}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
