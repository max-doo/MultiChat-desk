import { useState, useMemo } from 'react'
import {
  ChevronDown,
  Terminal,
  FileEdit,
  FileText,
  Wrench,
  Loader2,
  AlertCircle,
  Check,
  Copy,
  X
} from 'lucide-react'
import { parseDiff, Diff, Hunk } from 'react-diff-view'
import 'react-diff-view/style/index.css'
import type { PiContentPart } from '../../../types/agent'

interface ToolGroupProps {
  parts: PiContentPart[]
  isRunning?: boolean
}

interface SingleItemProps {
  part: PiContentPart
  isRunning?: boolean
}

// 深度提取与格式化工具调用输出文本（支持 pi-agent-core 的 content 数组及各种结构）
function extractToolResultText(result: unknown): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result

  if (Array.isArray(result)) {
    const texts = result
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          if ('text' in item && typeof (item as { text?: unknown }).text === 'string') {
            return (item as { text: string }).text
          }
          if ('content' in item) {
            return extractToolResultText((item as { content: unknown }).content)
          }
        }
        return ''
      })
      .filter(Boolean)
    if (texts.length > 0) return texts.join('\n')
  }

  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>

    // 1. content 数组或嵌套对象（pi-agent-core 标准结构）
    if ('content' in obj) {
      const extracted = extractToolResultText(obj.content)
      if (extracted) return extracted
    }

    // 2. diff 字段（针对文件修改）
    if ('diff' in obj && typeof obj.diff === 'string') {
      return obj.diff
    }

    // 3. 直接 output / stdout / text 字段
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.stdout === 'string') return obj.stdout
    if (typeof obj.text === 'string') return obj.text

    // 4. details 内部包含
    if ('details' in obj && obj.details && typeof obj.details === 'object') {
      const det = obj.details as Record<string, unknown>
      if (typeof det.output === 'string') return det.output
      if (typeof det.stdout === 'string') return det.stdout
    }

    try {
      return JSON.stringify(result, null, 2)
    } catch {
      return String(result)
    }
  }

  return String(result)
}

// 单条工具调用的渲染项（默认折叠，展开后显示内嵌结果）
function ToolItem({ part, isRunning = false }: SingleItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const toolName = (part.toolName || 'tool').toLowerCase()
  const isError = Boolean(part.isError)
  const isPartRunning = isRunning && part.result === undefined && !isError

  const outputText = useMemo(() => extractToolResultText(part.result), [part.result])

  // 命令提取
  const command = useMemo(() => {
    if (typeof part.args === 'string') return part.args
    const obj = part.args as { command?: string; cmd?: string } | undefined
    return obj?.command || obj?.cmd || ''
  }, [part.args])

  // 文件路径提取
  const filePath = useMemo(() => {
    if (typeof part.args === 'object' && part.args !== null) {
      const obj = part.args as { path?: string; filePath?: string }
      return obj.path || obj.filePath || ''
    }
    return ''
  }, [part.args])

  const fileName = filePath ? filePath.split(/[/\\]/).pop() || filePath : ''

  // Diff 解析（针对 edit）
  const parsedDiff = useMemo(() => {
    if (toolName !== 'edit' && toolName !== 'write' && toolName !== 'edit_file') return []
    const resultDetails = (typeof part.result === 'object' && part.result !== null && 'details' in part.result)
      ? (part.result as { details?: unknown }).details
      : undefined
    const detailsDiff = (resultDetails && typeof resultDetails === 'object')
      ? (resultDetails as { patch?: unknown; diff?: unknown })
      : undefined
    const patchStr =
      (typeof detailsDiff?.patch === 'string' && detailsDiff.patch) ||
      ((typeof part.args === 'object' && part.args && 'diff' in part.args)
        ? String((part.args as { diff: unknown }).diff || '')
        : '')
    const diffStr = patchStr || outputText
    if (!diffStr) return []
    try {
      return parseDiff(diffStr)
    } catch {
      return []
    }
  }, [toolName, part.args, part.result, outputText])

  // 展示用 diff 文本：parseDiff 失败时把 details.diff 原样展示，比 "Successfully replaced…" 更有信息量
  const displayDiffText = useMemo(() => {
    if (toolName !== 'edit' && toolName !== 'write' && toolName !== 'edit_file') return ''
    if (parsedDiff.length > 0) return ''
    const resultDetails = (typeof part.result === 'object' && part.result !== null && 'details' in part.result)
      ? (part.result as { details?: unknown }).details
      : undefined
    if (resultDetails && typeof resultDetails === 'object') {
      const d = (resultDetails as { diff?: unknown }).diff
      if (typeof d === 'string' && d) return d
    }
    return ''
  }, [toolName, part.result, parsedDiff])

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const content = outputText ? `${command || filePath}\n\n${outputText}` : (command || filePath || toolName)
    void navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 渲染简短的单行标题
  const renderItemHeader = (): JSX.Element => {
    if (toolName === 'bash' || toolName === 'powershell' || toolName === 'cmd' || toolName === 'terminal' || toolName === 'shell') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Terminal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="font-mono text-body text-slate-800 truncate">
            {command || '运行了命令'}
          </span>
        </div>
      )
    }

    if (toolName === 'edit' || toolName === 'write' || toolName === 'edit_file') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileEdit className="w-3.5 h-3.5 text-purple-600 shrink-0" />
          <span className="text-body text-slate-800 font-medium">已编辑</span>
          <span className="font-mono text-body text-slate-700 truncate underline decoration-slate-300 underline-offset-2">
            {fileName || filePath || '文件'}
          </span>
        </div>
      )
    }

    if (toolName === 'read' || toolName === 'read_file') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="text-body text-slate-800 font-medium">已读取</span>
          <span className="font-mono text-body text-slate-700 truncate underline decoration-slate-300 underline-offset-2">
            {fileName || filePath || '文件'}
          </span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Wrench className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="text-body text-slate-800 font-medium">调用了 {toolName}</span>
      </div>
    )
  }

  return (
    <div className="text-body select-none">
      {/* 极简折叠行 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-slate-100/70 transition-colors text-left group cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isPartRunning ? (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
          ) : isError ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          ) : null}

          {renderItemHeader()}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {part.durationMs !== undefined && (
            <span className="text-caption font-mono text-slate-400">{part.durationMs}ms</span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
              expanded ? 'rotate-180 text-slate-700' : 'group-hover:text-slate-600'
            }`}
          />
        </div>
      </button>

      {/* 点击展开后的内嵌视窗（命令 + 运行结果，绝不单独在外部展示） */}
      {expanded && (
        <div className="my-1.5 ml-5 rounded-lg border border-slate-200/90 bg-slate-50/70 select-text shadow-2xs overflow-hidden">
          {/* 顶栏：标签 + 复制按钮 */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200/60 text-caption font-mono text-slate-500 select-none">
            <span className="font-medium uppercase tracking-wider text-tiny text-slate-500">
              {toolName === 'bash' || toolName === 'powershell' || toolName === 'cmd' ? 'Shell' : toolName}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-tiny text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-slate-200/60 transition-colors"
              title="复制全部"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
          </div>

          {/* 内容区：命令 + 输出，或 diff */}
          <div className="px-3 py-2">
            {/* 如果是命令，首先显示执行的命令行 */}
            {command && (
              <div className="font-mono text-caption text-slate-800 font-semibold mb-2 select-text whitespace-pre-wrap break-all">
                $ {command}
              </div>
            )}

            {/* 如果是 Diff，展示差异（去掉内层卡片边框，直接渲染在容器里） */}
            {parsedDiff.length > 0 ? (
              <div className="max-h-72 overflow-y-auto overflow-x-auto font-mono text-caption">
                {parsedDiff.map((file, i) => (
                  <Diff key={i} viewType="unified" diffType={file.type} hunks={file.hunks}>
                    {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                  </Diff>
                ))}
              </div>
            ) : (
              /* 标准输出 / 结果展示区 */
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all font-mono text-caption text-slate-700 leading-relaxed selection:bg-blue-100">
                {displayDiffText || outputText || (isPartRunning ? '等待输出…' : '(无返回内容)')}
              </pre>
            )}
          </div>

          {/* 状态反馈脚标 */}
          <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-slate-200/60 text-tiny font-medium select-none">
            {isError ? (
              <span className="text-rose-600 flex items-center gap-1">
                <X className="w-3 h-3" /> 执行失败
              </span>
            ) : isPartRunning ? (
              <span className="text-primary flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> 执行中
              </span>
            ) : (
              <span className="text-emerald-600 flex items-center gap-1">
                <Check className="w-3 h-3" /> 成功
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ToolGroup({ parts, isRunning = false }: ToolGroupProps): JSX.Element | null {
  const [groupExpanded, setGroupExpanded] = useState(false)

  if (parts.length === 0) return null

  // 生成聚合摘要文本，例如：
  // 1个命令："运行了命令"
  // 3个命令："运行了 3 个命令"
  // 1个编辑+1个命令："编辑了文件运行了命令"
  const summaryTitle = useMemo(() => {
    let bashCount = 0
    let editCount = 0
    let readCount = 0
    let otherCount = 0

    for (const p of parts) {
      const name = (p.toolName || '').toLowerCase()
      if (name === 'bash' || name === 'powershell' || name === 'cmd' || name === 'terminal' || name === 'shell') {
        bashCount++
      } else if (name === 'edit' || name === 'write' || name === 'edit_file') {
        editCount++
      } else if (name === 'read' || name === 'read_file') {
        readCount++
      } else {
        otherCount++
      }
    }

    const segments: string[] = []
    if (editCount > 0) segments.push(editCount === 1 ? '编辑了文件' : `编辑了 ${editCount} 个文件`)
    if (bashCount > 0) segments.push(bashCount === 1 ? '运行了命令' : `运行了 ${bashCount} 个命令`)
    if (readCount > 0) segments.push(readCount === 1 ? '读取了文件' : `读取了 ${readCount} 个文件`)
    if (otherCount > 0) segments.push(`调用了 ${otherCount} 个工具`)

    return segments.length > 0 ? segments.join('') : '工具操作'
  }, [parts])

  // 判断整组中是否有正在运行或失败
  const hasRunning = isRunning && parts.some((p) => p.result === undefined && !p.isError)
  const hasError = parts.some((p) => p.isError)

  // 决定主图标
  const MainIcon = useMemo(() => {
    const hasEdit = parts.some((p) => {
      const name = (p.toolName || '').toLowerCase()
      return name === 'edit' || name === 'write' || name === 'edit_file'
    })
    if (hasEdit) return FileEdit
    const hasBash = parts.some((p) => {
      const name = (p.toolName || '').toLowerCase()
      return name === 'bash' || name === 'powershell' || name === 'cmd' || name === 'terminal'
    })
    if (hasBash) return Terminal
    const hasRead = parts.some((p) => {
      const name = (p.toolName || '').toLowerCase()
      return name === 'read' || name === 'read_file'
    })
    if (hasRead) return FileText
    return Wrench
  }, [parts])

  // 如果只有 1 个工具调用，也包装进极简折叠组，保持全链路风格 100% 统一
  return (
    <div className="my-2 select-none">
      {/* 极简折叠组总头栏 */}
      <button
        type="button"
        tabIndex={0}
        onClick={() => setGroupExpanded(!groupExpanded)}
        className="flex items-center gap-2 py-1 px-1.5 rounded-md hover:bg-slate-100/70 transition-colors text-left cursor-pointer group text-body text-slate-700"
      >
        {hasRunning ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
        ) : hasError ? (
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
        ) : (
          <MainIcon className="w-4 h-4 text-slate-600 group-hover:text-slate-900 transition-colors shrink-0" />
        )}

        <span className="font-medium text-body text-slate-800">
          {summaryTitle}
        </span>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
            groupExpanded ? 'rotate-180 text-slate-700' : 'group-hover:text-slate-600'
          }`}
        />
      </button>

      {/* 展开后展示的内嵌列表 */}
      {groupExpanded && (
        <div className="mt-1 pl-3.5 border-l-2 border-slate-200/80 space-y-0.5 py-0.5">
          {parts.map((part, idx) => (
            <ToolItem key={part.toolCallId || idx} part={part} isRunning={isRunning} />
          ))}
        </div>
      )}
    </div>
  )
}
