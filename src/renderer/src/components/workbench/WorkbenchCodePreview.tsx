import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useWorkbenchStore, type WorkbenchAiAction } from '../../store/workbenchStore'

// 语言标签与高亮线索映射
function getLanguageLabel(pathOrExt: string): string {
  const lower = pathOrExt.toLowerCase()
  const baseName = lower.split(/[/\\]/).pop() || ''
  if (baseName === 'dockerfile') return 'Dockerfile'
  if (baseName === '.gitignore') return 'GitIgnore'
  if (baseName.startsWith('.env')) return 'Env'

  const lastDot = lower.lastIndexOf('.')
  const ext = lastDot !== -1 ? lower.slice(lastDot) : ''
  switch (ext) {
    case '.ts': return 'TypeScript'
    case '.tsx': return 'TypeScript (React)'
    case '.js': return 'JavaScript'
    case '.jsx': return 'JavaScript (React)'
    case '.json':
    case '.json5': return 'JSON'
    case '.html':
    case '.htm': return 'HTML'
    case '.css': return 'CSS'
    case '.scss':
    case '.less':
    case '.sass': return 'Sass/Less'
    case '.py':
    case '.pyw': return 'Python'
    case '.java': return 'Java'
    case '.c': return 'C'
    case '.cpp':
    case '.cc': return 'C++'
    case '.h':
    case '.hpp': return 'C/C++ Header'
    case '.cs': return 'C#'
    case '.rs': return 'Rust'
    case '.go': return 'Go'
    case '.php': return 'PHP'
    case '.rb': return 'Ruby'
    case '.sql': return 'SQL'
    case '.sh':
    case '.bash':
    case '.zsh': return 'Shell Script'
    case '.ps1': return 'PowerShell'
    case '.bat':
    case '.cmd': return 'Batch Script'
    case '.yaml':
    case '.yml': return 'YAML'
    case '.xml': return 'XML'
    case '.toml': return 'TOML'
    case '.ini': return 'INI'
    case '.vue': return 'Vue'
    case '.svelte': return 'Svelte'
    default: return ext ? ext.slice(1).toUpperCase() : 'Code'
  }
}

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
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const askAi = useWorkbenchStore((s) => s.askAi)

  const [isEditing, setIsEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [showAiMenu, setShowAiMenu] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const codePreRef = useRef<HTMLPreElement | null>(null)
  const lineNumbersRef = useRef<HTMLDivElement | null>(null)

  // 切换文件重置编辑与菜单状态
  useEffect(() => {
    setIsEditing(false)
    setSelectedText('')
    setShowAiMenu(false)
  }, [activeFilePath])

  const lines = useMemo(() => {
    return activeFileContent.split('\n')
  }, [activeFileContent])

  const lineCount = lines.length
  const charCount = activeFileContent.length
  const wordCount = activeFileContent.trim() ? activeFileContent.trim().split(/\s+/).length : 0
  const language = getLanguageLabel(activeFilePath || '')

  // 格式化文件大小
  const formattedSize = useMemo(() => {
    if (!activeFileSize && activeFileSize !== 0) return ''
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

  // Ctrl+S 保存
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActiveFile()
      }
    },
    [saveActiveFile]
  )

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
  }

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

  // 监听选中文字
  const handleMouseUp = () => {
    const selection = window.getSelection()?.toString() || ''
    setSelectedText(selection.trim())
  }

  const handleAiAction = (action: WorkbenchAiAction) => {
    const textToAsk = selectedText || activeFileContent
    askAi(textToAsk, action)
    setShowAiMenu(false)
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-900 text-slate-100 select-text">
      {/* 顶部工具栏 */}
      <div className="h-10 px-3 bg-slate-800/90 border-b border-slate-700/60 flex items-center justify-between gap-2 shrink-0 select-none text-xs">
        {/* 左侧：文件信息与语言标签 */}
        <div className="flex items-center gap-2 truncate">
          <span className="material-symbols-outlined text-[17px] text-amber-400">code</span>
          <span className="font-mono text-xs text-slate-200 truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-400/30">
            {language}
          </span>
        </div>

        {/* 右侧：统计与操作 */}
        <div className="flex items-center gap-2 text-slate-400 text-xs shrink-0">
          <span className="hidden sm:inline font-mono">
            {lineCount} 行 · {wordCount} 词 · {charCount} 字符 {formattedSize && `· ${formattedSize}`}
          </span>

          {/* 保存状态提示 (编辑模式下展示) */}
          {isEditing && (
            <div className="flex items-center gap-1 font-medium">
              {saveStatus === 'saving' ? (
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

          {/* 模式切换 (查看 / 编辑) */}
          <div className="flex items-center p-0.5 bg-slate-950/60 rounded-lg border border-slate-700/50">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                !isEditing ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="只读代码高亮视图"
            >
              查看
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                isEditing ? 'bg-blue-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="代码编辑模式 (可保存)"
            >
              编辑
            </button>
          </div>

          {/* AI 助手操作下拉菜单 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAiMenu(!showAiMenu)}
              className="h-7 px-2 flex items-center gap-1 rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-400/30 transition-colors"
              title="对当前代码或选中片段进行 AI 辅助"
            >
              <span className="material-symbols-outlined text-[16px]">smart_toy</span>
              <span className="hidden md:inline">AI 助手</span>
              <span className="material-symbols-outlined text-[14px]">expand_more</span>
            </button>

            {showAiMenu && (
              <div className="absolute right-0 top-8 z-50 w-44 py-1.5 bg-slate-800 rounded-xl shadow-2xl border border-slate-700 text-slate-200 text-xs">
                <div className="px-3 py-1 text-[11px] text-slate-400 border-b border-slate-700/50 mb-1">
                  {selectedText ? '针对选中代码片段' : '针对全部代码'}
                </div>
                <button
                  type="button"
                  onClick={() => handleAiAction('explain')}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-500/20 hover:text-purple-300 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px] text-purple-400">help</span>
                  <span>解释代码逻辑</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAiAction('polish')}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-500/20 hover:text-purple-300 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px] text-blue-400">auto_fix_high</span>
                  <span>优化重构代码</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAiAction('ask')}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-500/20 hover:text-purple-300 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px] text-amber-400">chat</span>
                  <span>发送到侧边栏提问</span>
                </button>
              </div>
            )}
          </div>

          {/* 复制按钮 */}
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="复制代码全文"
          >
            <span className="material-symbols-outlined text-[16px]">
              {copied ? 'check' : 'content_copy'}
            </span>
          </button>

          {/* 系统默认编辑器打开 */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="在系统默认编辑器中打开 (如 VSCode)"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>

          {/* 在资源管理器定位 */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void revealFile(activeFilePath)
            }}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="在资源管理器中显示"
          >
            <span className="material-symbols-outlined text-[16px]">folder_open</span>
          </button>
        </div>
      </div>

      {/* 代码内容区域 */}
      <div className="flex-1 flex overflow-hidden relative">
        {activeFileOversized ? (
          <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-slate-900 select-none">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-4">
              <span className="material-symbols-outlined text-3xl">code</span>
            </div>
            <h3 className="text-base font-semibold text-slate-100 mb-1">代码文件超出直接加载上限</h3>
            <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
              当前文件大小为 <span className="font-semibold text-slate-200">{formattedSize}</span>，超出工作台 5MB 文本直接加载与渲染保护上限。建议在本地系统默认关联的代码编辑器（如 VSCode）中全速打开查看。
            </p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="h-9 px-5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-xs font-medium flex items-center gap-2 shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[17px]">open_in_new</span>
              <span>在系统编辑器中打开</span>
            </button>
          </div>
        ) : (
          <>
            {/* 行号侧边栏 */}
            <div
              ref={lineNumbersRef}
              className="w-12 py-4 select-none overflow-hidden text-right pr-3 font-mono text-xs leading-6 text-slate-600 bg-slate-950/40 border-r border-slate-800 shrink-0"
            >
              {lines.map((_, idx) => (
                <div key={idx}>{idx + 1}</div>
              ))}
            </div>

            {/* 编辑模式 / 查看模式 */}
            {isEditing ? (
              <textarea
                ref={textareaRef}
                value={activeFileContent}
                onChange={(e) => updateActiveContent(e.target.value)}
                onScroll={handleScroll}
                onMouseUp={handleMouseUp}
                placeholder="输入或粘贴代码..."
                className="flex-1 h-full py-4 px-4 font-mono text-xs sm:text-sm leading-6 resize-none bg-transparent text-slate-100 focus:outline-none overflow-auto whitespace-pre tab-4"
                spellCheck={false}
              />
            ) : (
              <pre
                ref={codePreRef}
                onScroll={handleScroll}
                onMouseUp={handleMouseUp}
                className="flex-1 h-full py-4 px-4 font-mono text-xs sm:text-sm leading-6 bg-transparent text-slate-100 overflow-auto whitespace-pre tab-4 m-0 selection:bg-blue-600/40"
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

            {/* 选中文字浮动 AI 快捷提示 */}
            {selectedText && (
              <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1.5 p-1.5 bg-slate-800/95 backdrop-blur-md rounded-xl border border-slate-700 shadow-xl">
                <span className="text-[11px] text-slate-400 pl-1.5 pr-0.5">已选 {selectedText.length} 字</span>
                <button
                  type="button"
                  onClick={() => handleAiAction('explain')}
                  className="px-2 py-1 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">help</span>
                  <span>解释</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAiAction('polish')}
                  className="px-2 py-1 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                  <span>重构</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
