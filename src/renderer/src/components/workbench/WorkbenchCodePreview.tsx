import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  useWorkbenchStore,
  type HtmlEditLeaveDecision
} from '../../store/workbenchStore'
import WorkbenchFindReplaceBar from './WorkbenchFindReplaceBar'
import WorkbenchHtmlVisualEditor, {
  type WorkbenchHtmlVisualEditorHandle
} from './WorkbenchHtmlVisualEditor'
import WorkbenchHtmlEditLeaveDialog from './WorkbenchHtmlEditLeaveDialog'
import WorkbenchHtmlAnnotationPreview from './WorkbenchHtmlAnnotationPreview'
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
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const toggleLeftCollapse = useWorkbenchStore((s) => s.toggleLeftCollapse)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const discardActiveFileChanges = useWorkbenchStore((s) => s.discardActiveFileChanges)
  const setHtmlEditLeaveGuard = useWorkbenchStore((s) => s.setHtmlEditLeaveGuard)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const [isEditing, setIsEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findReplaceFocus, setFindReplaceFocus] = useState(false)
  // HTML 文件支持渲染 / 可视化编辑 / 源码三态；源码态即文本编辑
  const [viewMode, setViewMode] = useState<'render' | 'edit' | 'source'>('source')
  const [visualDirty, setVisualDirty] = useState(false)
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [editSession, setEditSession] = useState(0)
  // 渲染预览刷新：只重新挂载 iframe，不触发磁盘重读
  const [previewReloadKey, setPreviewReloadKey] = useState(0)
  const visualEditorRef = useRef<WorkbenchHtmlVisualEditorHandle | null>(null)
  const visualBaselineRef = useRef<string | null>(null)
  const visualDirtyRef = useRef(false)
  const leaveRequestRef = useRef<{
    promise: Promise<HtmlEditLeaveDecision>
    resolve: (decision: HtmlEditLeaveDecision) => void
  } | null>(null)
  const hadConflictRef = useRef(false)

  const isHtmlFile = useMemo(() => {
    const lower = (activeFilePath || '').toLowerCase()
    return lower.endsWith('.html') || lower.endsWith('.htm')
  }, [activeFilePath])

  // HTML 源码模式即为可编辑状态；其他代码文件沿用查看/编辑分离
  const isEditable = isHtmlFile ? viewMode === 'source' : isEditing
  const isVisualEditing = isHtmlFile && viewMode === 'edit'

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const codePreRef = useRef<HTMLPreElement | null>(null)
  const lineNumbersRef = useRef<HTMLDivElement | null>(null)

  // 切换文件重置编辑与菜单状态；HTML 默认进入渲染预览
  useEffect(() => {
    setIsEditing(false)
    setViewMode(isHtmlFile ? 'render' : 'source')
    setVisualDirty(false)
    visualDirtyRef.current = false
    setLeaveDialogOpen(false)
    setLeaveBusy(false)
    setEditSession(0)
    setPreviewReloadKey(0)
    visualBaselineRef.current = null
    hadConflictRef.current = false
  }, [activeFilePath, isHtmlFile])

  useEffect(() => {
    if (isVisualEditing) setFindOpen(false)
  }, [isVisualEditing])

  // 冲突裁决走通用状态胶囊（take-disk / keep-mine）时，重建编辑 iframe 以对齐最终磁盘状态。
  useEffect(() => {
    if (saveStatus === 'conflict') {
      hadConflictRef.current = true
      return
    }
    if (
      hadConflictRef.current &&
      isVisualEditing &&
      saveStatus === 'saved' &&
      !isDirty
    ) {
      hadConflictRef.current = false
      setVisualDirty(false)
      visualDirtyRef.current = false
      visualBaselineRef.current = useWorkbenchStore.getState().activeFileContent
      setEditSession((value) => value + 1)
    }
  }, [saveStatus, isDirty, isVisualEditing])

  const lines = useMemo(() => {
    return activeFileContent.split('\n')
  }, [activeFileContent])

  const formattedSize = useMemo(() => {
    if (activeFileSize === null) return ''
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

  const finishLeaveRequest = useCallback((decision: HtmlEditLeaveDecision) => {
    const request = leaveRequestRef.current
    leaveRequestRef.current = null
    setLeaveDialogOpen(false)
    request?.resolve(decision)
  }, [])

  const requestLeaveVisualEdit = useCallback((): Promise<HtmlEditLeaveDecision> => {
    if (!visualDirtyRef.current && !visualEditorRef.current?.hasChanges()) {
      return Promise.resolve('saved')
    }
    if (leaveRequestRef.current) return leaveRequestRef.current.promise

    let resolve!: (decision: HtmlEditLeaveDecision) => void
    const promise = new Promise<HtmlEditLeaveDecision>((next) => {
      resolve = next
    })
    leaveRequestRef.current = { promise, resolve }
    setLeaveDialogOpen(true)
    return promise
  }, [])

  const handleVisualSave = useCallback(async (): Promise<boolean> => {
    if (saveStatus === 'saving') return false
    const result = await saveActiveFile()
    if (!result.saved) return false
    visualEditorRef.current?.markSaved()
    setVisualDirty(false)
    visualDirtyRef.current = false
    visualBaselineRef.current = useWorkbenchStore.getState().activeFileContent
    return true
  }, [saveActiveFile, saveStatus])

  const handleModeClick = useCallback(
    async (nextMode: 'render' | 'edit' | 'source') => {
      if (nextMode === viewMode || saveStatus === 'saving' || leaveDialogOpen) return

      // 进入可视化编辑前先落盘源码改动，避免编辑的是旧磁盘版本。
      if (nextMode === 'edit') {
        if (!isHtmlFile || !activeFileUrl || activeFileOversized) return
        if (isDirty) {
          const saved = await saveActiveFile()
          if (!saved.saved) return
        }
        visualBaselineRef.current = useWorkbenchStore.getState().activeFileContent
        setVisualDirty(false)
        visualDirtyRef.current = false
        setViewMode('edit')
        return
      }

      // 退出可视化编辑时保留未保存结果，由用户决定写回还是放弃。
      if (isVisualEditing) {
        const decision = await requestLeaveVisualEdit()
        if (decision === 'cancelled') return
      }
      setViewMode(nextMode)
    },
    [
      viewMode,
      saveStatus,
      isHtmlFile,
      activeFileUrl,
      activeFileOversized,
      isDirty,
      saveActiveFile,
      isVisualEditing,
      leaveDialogOpen,
      requestLeaveVisualEdit
    ]
  )

  const handleConfirmSaveAndLeave = useCallback(async () => {
    if (leaveBusy) return
    setLeaveBusy(true)
    const saved = await handleVisualSave()
    setLeaveBusy(false)
    // 保存失败/冲突时关闭确认框并留在编辑态，让用户看到状态栏里的处理入口。
    finishLeaveRequest(saved ? 'saved' : 'cancelled')
  }, [finishLeaveRequest, handleVisualSave, leaveBusy])

  const handleDiscardAndLeave = useCallback(() => {
    discardActiveFileChanges(visualBaselineRef.current ?? undefined)
    setVisualDirty(false)
    visualDirtyRef.current = false
    // 目标文件/工作区切换若失败，仍留在编辑态时必须重建 iframe，避免画布继续显示已放弃的改动。
    setEditSession((value) => value + 1)
    finishLeaveRequest('discarded')
  }, [discardActiveFileChanges, finishLeaveRequest])

  const handleCancelLeave = useCallback(() => {
    if (leaveBusy) return
    finishLeaveRequest('cancelled')
  }, [finishLeaveRequest, leaveBusy])

  const handleVisualDirtyChange = useCallback((dirty: boolean) => {
    visualDirtyRef.current = dirty
    setVisualDirty(dirty)
  }, [])

  // 文件树、搜索、链接与工作区切换都在 store 内统一走这个确认入口。
  useEffect(() => {
    if (!isVisualEditing) return
    setHtmlEditLeaveGuard(requestLeaveVisualEdit)
    return () => setHtmlEditLeaveGuard(null)
  }, [isVisualEditing, requestLeaveVisualEdit, setHtmlEditLeaveGuard])

  useEffect(() => {
    return () => {
      const request = leaveRequestRef.current
      leaveRequestRef.current = null
      request?.resolve('cancelled')
    }
  }, [])

  // Ctrl+S 保存；Ctrl+F/H 在可视化编辑态不打开代码查找条
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (leaveDialogOpen) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        if (isVisualEditing) {
          if (visualDirty || visualEditorRef.current?.hasChanges()) void handleVisualSave()
        } else {
          void saveActiveFile()
        }
      } else if ((k === 'f' || k === 'h') && !isVisualEditing) {
        e.preventDefault()
        setFindReplaceFocus(k === 'h')
        setFindOpen(true)
      }
    },
    [handleVisualSave, isVisualEditing, leaveDialogOpen, saveActiveFile, visualDirty]
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
      const text = isVisualEditing
        ? (await visualEditorRef.current?.serializeCurrent()) ?? activeFileContent
        : activeFileContent
      await navigator.clipboard.writeText(text)
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
          {isLeftCollapsed && (
            <>
              <button
                type="button"
                onClick={toggleLeftCollapse}
                className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-all duration-200 shrink-0"
                title="展开侧边栏"
                aria-label="展开侧边栏"
              >
                <AppIcon name="left_panel_open" size={20} />
              </button>
              <div className="w-[1px] h-4 bg-white/10 shrink-0" />
            </>
          )}
          <AppIcon name="code" size={19} className="text-amber-400" />
          <span className="font-mono text-sm text-slate-200 truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
        </div>

        {/* 右侧：统计与操作 */}
        <div className="flex items-center gap-2 text-slate-400 text-sm shrink-0">
          {/* 保存状态提示 (文本编辑或可视化编辑时展示) */}
          {(isEditable || isVisualEditing) && (
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

          {/* 保存按钮位于模式分组之前，模式分组与右侧文件操作保持固定位置 */}
          {isVisualEditing && (
            <button
              type="button"
              disabled={!visualDirty || saveStatus === 'saving'}
              onClick={() => void handleVisualSave()}
              className="h-7 px-2.5 flex items-center gap-1 rounded-md bg-primary text-white text-xs font-medium transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-40"
              title="保存到原文件 (Ctrl+S)"
            >
              <AppIcon
                name={saveStatus === 'saving' ? 'progress_activity' : 'save'}
                size={16}
                className={saveStatus === 'saving' ? 'animate-spin' : ''}
              />
              <span>保存</span>
            </button>
          )}

          {/* 模式切换：HTML 为 渲染/编辑/源码；其他代码为 查看/编辑 */}
          <div className="flex items-center p-0.5 bg-slate-950/60 rounded-lg border border-slate-700/50">
            {isHtmlFile ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleModeClick('render')}
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
                  disabled={!activeFileUrl || activeFileOversized || saveStatus === 'saving'}
                  onClick={() => void handleModeClick('edit')}
                  className={`px-2 py-0.5 rounded text-sm transition-colors disabled:cursor-default disabled:opacity-40 ${
                    viewMode === 'edit'
                      ? 'bg-primary text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={
                    activeFileOversized
                      ? '文件过大，无法启用可视化编辑'
                      : '直接在渲染结果上修改文字与结构'
                  }
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => void handleModeClick('source')}
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

          {/* HTML 渲染预览：重新加载 iframe，获取外部修改后的磁盘版本 */}
          {isHtmlFile && viewMode === 'render' && (
            <button
              type="button"
              onClick={() => setPreviewReloadKey((k) => k + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="刷新渲染预览"
            >
              <AppIcon name="refresh" size={19} />
            </button>
          )}

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
             sandbox 允许脚本执行但禁止弹窗/顶层导航/同源特权访问；
             标注高亮与评论卡在宿主层叠加，不占用正文宽度。 */
          <div className="flex-1 h-full relative bg-white">
            {activeFileUrl ? (
              <WorkbenchHtmlAnnotationPreview
                key={`${activeFilePath}-${saveStatus}-${isDirty}-${previewReloadKey}`}
                filePath={activeFilePath || ''}
                fileUrl={activeFileUrl}
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
        ) : isVisualEditing && activeFileUrl ? (
          <WorkbenchHtmlVisualEditor
            key={`${activeFilePath || 'html-visual-editor'}-${editSession}`}
            ref={visualEditorRef}
            filePath={activeFilePath || ''}
            fileUrl={activeFileUrl}
            onDirtyChange={handleVisualDirtyChange}
            onRequestSave={() => {
              if (visualEditorRef.current?.hasChanges()) void handleVisualSave()
            }}
          />
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
          open={findOpen && !activeFileOversized && !isVisualEditing}
          replaceFocus={findReplaceFocus}
          onClose={() => setFindOpen(false)}
          canReplace={isEditable && !(isHtmlFile && viewMode === 'render')}
        />
      </div>

      {leaveDialogOpen && (
        <WorkbenchHtmlEditLeaveDialog
          busy={leaveBusy}
          onSave={() => void handleConfirmSaveAndLeave()}
          onDiscard={handleDiscardAndLeave}
          onCancel={handleCancelLeave}
        />
      )}
    </div>
  )
}
