import { useState, useMemo } from 'react'
import { parseDiff, Diff, Hunk } from 'react-diff-view'
import 'react-diff-view/style/index.css'
import { AppIcon } from '../../icons/AppIcon'
import type { PiContentPart } from '../../../types/agent'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import { resolveAbsolute, toWorkspaceRelative } from './filePathUtils'

interface ToolGroupProps {
  parts: PiContentPart[]
  isRunning?: boolean
  /** 会话 cwd：read/edit 工具行的文件名点击时用于把工具上报路径
   *  归一到 workspace 相对路径再 openFile + 侧边栏定位。 */
  cwd?: string
}

interface SingleItemProps {
  part: PiContentPart
  isRunning?: boolean
  defaultExpanded?: boolean
  cwd?: string
}

// 编辑类工具名集合（与 AgentSessionService 的文件改动捕获保持一致）
const EDIT_TOOL_NAMES = new Set(['edit', 'write', 'edit_file', 'str_replace', 'multi_edit', 'apply_patch'])

// 从工具入参中提取路径（覆盖 path / filePath / file_path 三种形态）
function extractArgPath(args: unknown): string {
  if (typeof args !== 'object' || args === null) return ''
  const obj = args as { path?: string; filePath?: string; file_path?: string }
  return obj.path || obj.filePath || obj.file_path || ''
}

// 把 write 工具的 content 参数包装成 unified diff，复用 Diff 视图展示"新文件全文"
function buildWriteDiff(filePath: string, content: string): string {
  if (!content) return ''
  const lines = content.split('\n')
  const name = filePath || 'file'
  const body = lines.map((line) => `+${line}`).join('\n')
  return `--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines.length} @@\n${body}`
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
function ToolItem({ part, isRunning = false, defaultExpanded = false, cwd }: SingleItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState(false)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const openFile = useWorkbenchStore((s) => s.openFile)

  const toolName = (part.toolName || 'tool').toLowerCase()
  const isError = Boolean(part.isError)
  const isPartRunning = isRunning && part.result === undefined && !isError
  const isEditTool = EDIT_TOOL_NAMES.has(toolName)

  const outputText = useMemo(() => extractToolResultText(part.result), [part.result])

  // 命令提取
  const command = useMemo(() => {
    if (typeof part.args === 'string') return part.args
    const obj = part.args as { command?: string; cmd?: string } | undefined
    return obj?.command || obj?.cmd || ''
  }, [part.args])

  // 文件路径提取
  const filePath = useMemo(() => {
    return extractArgPath(part.args)
  }, [part.args])

  const fileName = filePath ? filePath.split(/[/\\]/).pop() || filePath : ''

  // 点击文件名：优先在工作区内 openFile（触发侧边栏定位），落不到
  // workspace 内时退回系统资源管理器定位所在目录。
  const handleFileNameClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!filePath) return
    const rel = cwd && workspacePath ? toWorkspaceRelative(workspacePath, cwd, filePath) : null
    if (rel) {
      void openFile(rel).then((opened) => {
        if (!opened) void window.api.agentRevealFile(resolveAbsolute(cwd!, filePath))
      })
    } else if (cwd) {
      void window.api.agentRevealFile(resolveAbsolute(cwd, filePath))
    }
  }

  // 搜索/生成类工具的关键入参（单行尾随展示）
  const inlineArg = useMemo(() => {
    if (typeof part.args !== 'object' || part.args === null) return ''
    const obj = part.args as { query?: string; prompt?: string; pattern?: string }
    return obj.query || obj.prompt || obj.pattern || ''
  }, [part.args])

  // write 工具：result 没有 details.diff，用 args.content 合成"全文新增"的 diff
  const writeDiff = useMemo(() => {
    if (toolName !== 'write' || typeof part.args !== 'object' || part.args === null) return ''
    const content = (part.args as { content?: unknown }).content
    return typeof content === 'string' ? buildWriteDiff(filePath, content) : ''
  }, [toolName, part.args, filePath])

  // Diff 解析（针对 edit）
  const parsedDiff = useMemo(() => {
    if (!isEditTool) return []
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
    const diffStr = patchStr || writeDiff || outputText
    if (!diffStr) return []
    try {
      return parseDiff(diffStr)
    } catch {
      return []
    }
  }, [isEditTool, part.args, part.result, outputText, writeDiff])

  // 展示用 diff 文本：parseDiff 失败时把 details.diff 原样展示，比 "Successfully replaced…" 更有信息量
  const displayDiffText = useMemo(() => {
    if (!isEditTool) return ''
    if (parsedDiff.length > 0) return ''
    const resultDetails = (typeof part.result === 'object' && part.result !== null && 'details' in part.result)
      ? (part.result as { details?: unknown }).details
      : undefined
    if (resultDetails && typeof resultDetails === 'object') {
      const d = (resultDetails as { diff?: unknown }).diff
      if (typeof d === 'string' && d) return d
    }
    return ''
  }, [isEditTool, part.result, parsedDiff])

  // 无 diff 可解析时的 write 兜底：直接展示写入内容，比 "(无返回内容)" 更有信息量
  const writeContentFallback = useMemo(() => {
    if (toolName !== 'write' || parsedDiff.length > 0 || displayDiffText) return ''
    if (typeof part.args !== 'object' || part.args === null) return ''
    const content = (part.args as { content?: unknown }).content
    return typeof content === 'string' ? content : ''
  }, [toolName, parsedDiff, displayDiffText, part.args])

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
          <AppIcon name="terminal" size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
          <span className="font-mono text-body text-slate-800 dark:text-gray-200 truncate">
            {command || '运行了命令'}
          </span>
        </div>
      )
    }

    if (isEditTool) {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AppIcon name="file_edit" size={14} className="text-purple-600 dark:text-purple-400 shrink-0" />
          <span className="text-body text-slate-800 dark:text-gray-200 font-medium">已编辑</span>
          <button
            type="button"
            onClick={handleFileNameClick}
            title={filePath}
            className="font-mono text-body text-slate-700 dark:text-gray-300 truncate underline decoration-slate-300 dark:decoration-slate-600 underline-offset-2 hover:text-primary transition-colors"
          >
            {fileName || filePath || '文件'}
          </button>
        </div>
      )
    }

    if (toolName === 'web_search') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AppIcon name="public" size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="text-body text-slate-800 dark:text-gray-200 font-medium shrink-0">联网搜索</span>
          {inlineArg && (
            <span className="text-body text-slate-600 dark:text-gray-400 truncate">{inlineArg}</span>
          )}
        </div>
      )
    }

    if (toolName === 'image_gen') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AppIcon name="image" size={14} className="text-violet-600 dark:text-violet-400 shrink-0" />
          <span className="text-body text-slate-800 dark:text-gray-200 font-medium shrink-0">生成图片</span>
          {inlineArg && (
            <span className="text-body text-slate-600 dark:text-gray-400 truncate">{inlineArg}</span>
          )}
        </div>
      )
    }

    if (toolName === 'grep') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AppIcon name="search" size={14} className="text-teal-600 dark:text-teal-400 shrink-0" />
          <span className="text-body text-slate-800 dark:text-gray-200 font-medium shrink-0">搜索</span>
          {inlineArg && (
            <span className="font-mono text-body text-slate-700 dark:text-gray-300 truncate">{inlineArg}</span>
          )}
        </div>
      )
    }

    if (toolName === 'find') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AppIcon name="find_in_page" size={14} className="text-teal-600 dark:text-teal-400 shrink-0" />
          <span className="text-body text-slate-800 dark:text-gray-200 font-medium shrink-0">查找</span>
          {inlineArg && (
            <span className="font-mono text-body text-slate-700 dark:text-gray-300 truncate">{inlineArg}</span>
          )}
        </div>
      )
    }

    if (toolName === 'ls') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AppIcon name="folder_open" size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-body text-slate-800 dark:text-gray-200 font-medium shrink-0">列出目录</span>
          {filePath && (
            <span className="font-mono text-body text-slate-700 dark:text-gray-300 truncate">{filePath}</span>
          )}
        </div>
      )
    }

    if (toolName === 'read' || toolName === 'read_file') {
      return (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AppIcon name="description" size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-body text-slate-800 dark:text-gray-200 font-medium">已读取</span>
          <button
            type="button"
            onClick={handleFileNameClick}
            title={filePath}
            className="font-mono text-body text-slate-700 dark:text-gray-300 truncate underline decoration-slate-300 dark:decoration-slate-600 underline-offset-2 hover:text-primary transition-colors"
          >
            {fileName || filePath || '文件'}
          </button>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <AppIcon name="build" size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="text-body text-slate-800 dark:text-gray-200 font-medium">调用了 {toolName}</span>
      </div>
    )
  }

  return (
    <div className="text-body select-none">
      {/* 极简折叠行 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors text-left group cursor-pointer"
      >
        <div className={`flex items-center gap-2 min-w-0 flex-1 ${isPartRunning ? 'text-shimmer' : ''}`}>
          {isError ? (
            <AppIcon name="error" size={14} className="text-rose-500 shrink-0" />
          ) : null}

          {renderItemHeader()}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {part.durationMs !== undefined && (
            <span className="text-caption font-mono text-slate-400">{part.durationMs}ms</span>
          )}
          <AppIcon
            name="expand_more"
            size={14}
            className={`text-slate-400 transition-transform duration-200 ${
              expanded ? 'rotate-180 text-slate-700 dark:text-gray-200' : 'group-hover:text-slate-600 dark:group-hover:text-gray-300'
            }`}
          />
        </div>
      </button>

      {/* 点击展开后的内嵌视窗（命令 + 运行结果，绝不单独在外部展示） */}
      {expanded && (
        <div className="my-1.5 ml-5 rounded-lg border border-slate-200/90 bg-slate-50/70 select-text shadow-sm overflow-hidden dark:border-white/10 dark:bg-white/[0.03]">
          {/* 顶栏：标签 + 复制按钮 */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200/60 text-caption font-mono text-slate-500 select-none dark:border-white/10 dark:text-slate-400">
            <span className="font-medium uppercase tracking-wider text-caption text-slate-500 dark:text-slate-400">
              {toolName === 'bash' || toolName === 'powershell' || toolName === 'cmd' ? 'Shell' : toolName}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-caption text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-slate-200/60 transition-colors dark:text-slate-400 dark:hover:text-gray-100 dark:hover:bg-white/10"
              title="复制全部"
            >
              {copied ? <AppIcon name="check" size={12} className="text-emerald-600 dark:text-emerald-400" /> : <AppIcon name="content_copy" size={12} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
          </div>

          {/* 内容区：命令 + 输出，或 diff */}
          <div className="px-3 py-2">
            {/* 如果是命令，首先显示执行的命令行 */}
            {command && (
              <div className="font-mono text-caption text-slate-800 dark:text-gray-200 font-semibold mb-2 select-text whitespace-pre-wrap break-all">
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
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all font-mono text-caption text-slate-700 dark:text-slate-300 leading-relaxed selection:bg-blue-100 dark:selection:bg-blue-500/30">
                {displayDiffText || writeContentFallback || outputText || (isPartRunning ? '等待输出…' : '(无返回内容)')}
              </pre>
            )}
          </div>

          {/* 状态反馈脚标 */}
          <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-slate-200/60 text-caption font-medium select-none dark:border-white/10">
            {isError ? (
              <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AppIcon name="close" size={12} /> 执行失败
              </span>
            ) : isPartRunning ? (
              <span className="text-shimmer flex items-center gap-1">
                执行中
              </span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <AppIcon name="check" size={12} /> 成功
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ToolGroup({ parts, isRunning = false, cwd }: ToolGroupProps): JSX.Element | null {
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
      } else if (EDIT_TOOL_NAMES.has(name)) {
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
  const mainIconName = useMemo(() => {
    const hasEdit = parts.some((p) => {
      const name = (p.toolName || '').toLowerCase()
      return EDIT_TOOL_NAMES.has(name)
    })
    if (hasEdit) return 'file_edit'
    const hasBash = parts.some((p) => {
      const name = (p.toolName || '').toLowerCase()
      return name === 'bash' || name === 'powershell' || name === 'cmd' || name === 'terminal'
    })
    if (hasBash) return 'terminal'
    const hasRead = parts.some((p) => {
      const name = (p.toolName || '').toLowerCase()
      return name === 'read' || name === 'read_file'
    })
    if (hasRead) return 'description'
    return 'build'
  }, [parts])

  // 如果只有 1 个工具调用，也包装进极简折叠组，保持全链路风格 100% 统一
  return (
    <div className="my-2 select-none">
      {/* 极简折叠组总头栏 */}
      <button
        type="button"
        tabIndex={0}
        onClick={() => setGroupExpanded(!groupExpanded)}
        className="flex items-center gap-2 py-1 px-1.5 rounded-md hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors text-left cursor-pointer group text-body text-slate-700 dark:text-gray-300"
      >
        {hasError ? (
          <AppIcon name="error" size={16} className="text-rose-500 shrink-0" />
        ) : (
          <AppIcon name={mainIconName} size={16} className="text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors shrink-0" />
        )}

        <span className={`font-medium text-body ${hasRunning ? 'text-shimmer' : 'text-slate-800 dark:text-gray-200'}`}>
          {summaryTitle}
        </span>

        <AppIcon
          name="expand_more"
          size={14}
          className={`text-slate-400 transition-transform duration-200 shrink-0 ${
            groupExpanded ? 'rotate-180 text-slate-700 dark:text-gray-200' : 'group-hover:text-slate-600 dark:group-hover:text-gray-300'
          }`}
        />
      </button>

      {/* 展开后展示的内嵌列表 */}
      {groupExpanded && (
        <div className="mt-1 pl-3.5 border-l-2 border-slate-200/80 dark:border-white/10 space-y-0.5 py-0.5">
          {parts.map((part, idx) => (
            <ToolItem
              key={part.toolCallId || idx}
              part={part}
              isRunning={isRunning}
              defaultExpanded={parts.length === 1}
              cwd={cwd}
            />
          ))}
        </div>
      )}
    </div>
  )
}
