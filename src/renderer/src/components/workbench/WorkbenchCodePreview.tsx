import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WorkbenchFindReplaceBar from './WorkbenchFindReplaceBar'
import { AppIcon } from '../icons/AppIcon'

// 零依赖高性能单行语法高亮器
function highlightCodeLine(line: string): React.ReactNode {
  if (!line) return ' '

  const tokenRegex =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|from|export|default|class|interface|type|extends|implements|new|this|typeof|instanceof|async|await|try|catch|finally|throw|def|self|yield|lambda|in|is|not|and|or|pass|elif|print|SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP)\b)|(\b(?:true|false|null|undefined|None|True|False|nil)\b)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|0x[0-9a-fA-F]+\b)|(\b(?:string|number|boolean|any|void|never|unknown|object|Array|Promise|Record|Map|Set|int|float|str)\b)|(\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\())/g

  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index))
    }
    const [full, comment, str, kw, bool, num, type, fn] = match
    if (comment) {
      nodes.push(<span key={match.index} className="text-slate-500 italic">{comment}</span>)
    } else if (str) {
      nodes.push(<span key={match.index} className="text-emerald-400">{str}</span>)
    } else if (kw) {
      nodes.push(<span key={match.index} className="text-purple-400 font-semibold">{kw}</span>)
    } else if (bool) {
      nodes.push(<span key={match.index} className="text-rose-400">{bool}</span>)
    } else if (num) {
      nodes.push(<span key={match.index} className="text-amber-400">{num}</span>)
    } else if (type) {
      nodes.push(<span key={match.index} className="text-sky-300">{type}</span>)
    } else if (fn) {
      nodes.push(<span key={match.index} className="text-blue-300">{fn}</span>)
    } else {
      nodes.push(full)
    }
    lastIndex = match.index + full.length
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex))
  }

  return nodes
}

export default function WorkbenchCodePreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileUrl = useWorkbenchStore((s) => s.activeFileUrl)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const [isEditing, setIsEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findReplaceFocus, setFindReplaceFocus] = useState(false)
  // HTML 文件支持浏览器式渲染预览；viewMode 两态：render / source（源码即编辑）
  const [viewMode, setViewMode] = useState<'render' | 'source'>('source')

  const isHtmlFile = useMemo(() => {
    const lower = (activeFilePath || '').toLowerCase()
    return lower.endsWith('.html') || lower.endsWith('.htm')
  }, [activeFilePath])

  // HTML 源码模式即为可编辑状态；其他代码文件沿用查看/编辑分离
  const isEditable = isHtmlFile ? viewMode === 'source' : isEditing

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const codePreRef = useRef<HTMLPreElement | null>(null)
  const lineNumbersRef = useRef<HTMLDivElement | null>(null)

  // 切换文件重置编辑与菜单状态；HTML 默认进入渲染预览
  useEffect(() => {
    setIsEditing(false)
    setViewMode(isHtmlFile ? 'render' : 'source')
  }, [activeFilePath, isHtmlFile])

  const lines = useMemo(() => {
    return activeFileContent.split('\n')
  }, [activeFileContent])

  const formattedSize = useMemo(() => {
    if (activeFileSize === null) return ''
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

  // Ctrl+S 保存
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void saveActiveFile()
      } else if (k === 'f' || k === 'h') {
        e.preventDefault()
        setFindReplaceFocus(k === 'h')
        setFindOpen(true)
      }
    },
    [saveActiveFile]
  )

  // 切换文件时关闭查找条
  useEffect(() => {
    setFindOpen(false)
  }, [activeFilePath])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // 滚动同步
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const target = e.currentTarget
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = target.scrollTop
    }
    // 编辑态：textarea 驱动背景高亮层滚动对齐
    if (isEditable && codePreRef.current && target !== codePreRef.current) {
      codePreRef.current.scrollTop = target.scrollTop
      codePreRef.current.scrollLeft = target.scrollLeft
    }
  }

  // 内容变化后保持高亮层与行号槽对齐（文件切换 / 外部更新）
  useEffect(() => {
    const ta = textareaRef.current
    if (lineNumbersRef.current && ta) {
      lineNumbersRef.current.scrollTop = ta.scrollTop
    }
    if (isEditable && codePreRef.current && ta) {
      codePreRef.current.scrollTop = ta.scrollTop
      codePreRef.current.scrollLeft = ta.scrollLeft
    }
  }, [activeFileContent, isEditable])

  // 复制全文
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFileContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-900 text-slate-100 select-text">
      {/* 顶部工具栏 */}
      <div className="h-10 px-3 bg-slate-800/90 border-b border-slate-700/60 flex items-center justify-between gap-2 shrink-0 select-none text-sm">
        {/* 左侧：文件信息 */}
        <div className="flex items-center gap-2 truncate">
          <AppIcon name="code" size={19} className="text-amber-400" />
          <span className="font-mono text-sm text-slate-200 truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
        </div>

        {/* 右侧：统计与操作 */}
        <div className="flex items-center gap-2 text-slate-400 text-sm shrink-0">
          {/* 保存状态提示 (编辑模式下展示) */}
          {isEditable && (
            <div className="flex items-center gap-1 font-medium">
              {saveStatus === 'conflict' ? (
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span>冲突</span>
                </span>
              ) : saveStatus === 'saving' ? (
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>保存中</span>
                </span>
              ) : saveStatus === 'error' ? (
                <span className="flex items-center gap-1 text-rose-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                  <span>保存失败</span>
                </span>
              ) : isDirty ? (
                <span className="flex items-center gap-1 text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span>未保存</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>已保存</span>
                </span>
              )}
            </div>
          )}

          {/* 模式切换：HTML 为 渲染/源码（源码即编辑）；其他代码为 查看/编辑 */}
          <div className="flex items-center p-0.5 bg-slate-950/60 rounded-lg border border-slate-700/50">
            {isHtmlFile ? (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode('render')}
                  className={`px-2 py-0.5 rounded text-sm transition-colors ${
                    viewMode === 'render'
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="浏览器渲染预览（磁盘已保存版本）"
                >
                  渲染
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('source')}
                  className={`px-2 py-0.5 rounded text-sm transition-colors ${
                    viewMode === 'source'
                      ? 'bg-blue-600 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="源码编辑模式（Ctrl+S 保存）"
                >
                  源码
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className={`px-2 py-0.5 rounded text-sm transition-colors ${
                    !isEditing
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="只读代码高亮视图"
                >
                  查看
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className={`px-2 py-0.5 rounded text-sm transition-colors ${
                    isEditing
                      ? 'bg-blue-600 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="代码编辑模式 (可保存)"
                >
                  编辑
                </button>
              </>
            )}
          </div>

          {/* 复制按钮 */}
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="复制代码全文"
          >
            <AppIcon name={copied ? 'check' : 'content_copy'} size={19} />
          </button>

          {/* 系统默认编辑器打开 */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="在系统默认编辑器中打开 (如 VSCode)"
          >
            <AppIcon name="open_in_new" size={19} />
          </button>

          {/* 在资源管理器定位 */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void revealFile(activeFilePath)
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="在资源管理器中显示"
          >
            <AppIcon name="folder_open" size={19} />
          </button>
        </div>
      </div>

      {/* 代码内容区域 */}
      <div className="flex-1 flex overflow-hidden relative">
        {isHtmlFile && viewMode === 'render' ? (
          /* HTML 浏览器渲染预览：走 workbench-file:// 白名单协议，
             sandbox 允许脚本执行但禁止弹窗/顶层导航/同源特权访问，
             预览的是磁盘已保存版本 */
          <div className="flex-1 h-full relative bg-white">
            {activeFileUrl ? (
              <iframe
                key={`${activeFilePath}-${saveStatus}-${isDirty}`}
                src={activeFileUrl}
                sandbox="allow-scripts"
                className="w-full h-full border-0 block"
                title={activeFilePath || 'HTML Preview'}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-slate-900 text-slate-400">
                <AppIcon name="error" size={36} className="mb-3" />
                <p className="text-sm">未能生成预览地址</p>
              </div>
            )}
            {isDirty && (
              <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-lg bg-slate-900/85 text-xs text-amber-300 border border-amber-400/30 backdrop-blur-sm select-none">
                预览为磁盘已保存版本，有未保存修改
              </div>
            )}
          </div>
        ) : activeFileOversized ? (
          <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-slate-900 select-none">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-4">
              <AppIcon name="code" size={30} />
            </div>
            <h3 className="text-base font-semibold text-slate-100 mb-1">代码文件超出直接加载上限</h3>
            <p className="text-sm text-slate-400 max-w-sm mb-6 leading-relaxed">
              当前文件大小为 <span className="font-semibold text-slate-200">{formattedSize}</span>，超出工作台 5MB 文本直接加载与渲染保护上限。建议在本地系统默认关联的代码编辑器（如 VSCode）中全速打开查看。
            </p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="h-10 px-5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium flex items-center gap-2 shadow-sm transition-all"
            >
              <AppIcon name="open_in_new" size={19} />
              <span>在系统编辑器中打开</span>
            </button>
          </div>
        ) : (
          <>
            {/* 行号侧边栏 */}
            <div
              ref={lineNumbersRef}
              className="w-12 py-4 select-none overflow-hidden text-right pr-3 font-mono text-sm leading-6 text-slate-600 bg-slate-950/40 border-r border-slate-800 shrink-0"
            >
              {lines.map((_, idx) => (
                <div key={idx}>{idx + 1}</div>
              ))}
            </div>

            {/* 编辑模式 / 查看模式（HTML 源码态即可编辑） */}
            {isEditable ? (
              /* 编辑态：背景高亮层 + 前景透明 textarea，与查看态共用同一高亮器 */
              <div className="flex-1 relative overflow-hidden">
                <pre
                  ref={codePreRef}
                  aria-hidden="true"
                  className="absolute inset-0 h-full py-4 px-4 font-mono text-sm leading-6 bg-transparent text-slate-100 overflow-auto whitespace-pre tab-4 m-0 pointer-events-none"
                >
                  <code>
                    {lines.map((line, idx) => (
                      <div key={idx} className="leading-6">
                        {highlightCodeLine(line)}
                      </div>
                    ))}
                  </code>
                </pre>
                <textarea
                  ref={textareaRef}
                  value={activeFileContent}
                  onChange={(e) => updateActiveContent(e.target.value)}
                  onScroll={handleScroll}
                  placeholder="输入或粘贴代码..."
                  className="absolute inset-0 w-full h-full py-4 px-4 font-mono text-sm leading-6 resize-none bg-transparent text-transparent caret-slate-100 focus:outline-none overflow-auto whitespace-pre tab-4 placeholder:text-slate-500"
                  spellCheck={false}
                />
              </div>
            ) : (
              <pre
                ref={codePreRef}
                onScroll={handleScroll}
                className="flex-1 h-full py-4 px-4 font-mono text-sm sm:text-sm leading-6 bg-transparent text-slate-100 overflow-auto whitespace-pre tab-4 m-0 selection:bg-blue-600/40"
              >
                <code>
                  {lines.map((line, idx) => (
                    <div key={idx} className="leading-6">
                      {highlightCodeLine(line)}
                    </div>
                  ))}
                </code>
              </pre>
            )}

          </>
        )}

        {/* 编辑器内查找替换（Ctrl+F / Ctrl+H）；只读/渲染预览下禁用替换 */}
        <WorkbenchFindReplaceBar
          open={findOpen && !activeFileOversized}
          replaceFocus={findReplaceFocus}
          onClose={() => setFindOpen(false)}
          canReplace={isEditable && !(isHtmlFile && viewMode === 'render')}
        />
      </div>
    </div>
  )
}
