import { useState, useMemo } from 'react'
import { FileEdit, ChevronDown, ChevronRight, AlertCircle, Loader2, Copy, Check } from 'lucide-react'
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
          <FileEdit className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        )}

        <span className="truncate flex-1 font-medium text-text-primary">
          {isRunning ? '正在编辑: ' : isError ? '编辑出错: ' : '编辑了: '}
          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-normal border border-blue-200/60 ml-1">
            {fileName}
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
            <span className="truncate pr-2 font-mono text-gray-600">{path}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors shrink-0"
              title="复制 Diff 文本"
            >
              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto overflow-x-auto rounded bg-white border border-gray-100">
            {parsedFiles.length > 0 ? (
              parsedFiles.map((file, i) => (
                <Diff key={i} viewType="unified" diffType={file.type} hunks={file.hunks}>
                  {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                </Diff>
              ))
            ) : diffContent ? (
              <pre className="p-2 whitespace-pre font-mono text-gray-800 leading-normal">
                {diffContent}
              </pre>
            ) : (
              <div className="p-3 text-center text-gray-400">
                {isRunning ? '编辑进行中...' : '无 Diff 变更详情'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
