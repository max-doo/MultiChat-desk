import React, { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { globalCSS } from 'markmap-view'
import CustomDropdown from './CustomDropdown'
import MindmapMarkdownEditor from './MindmapMarkdownEditor'
import { parseMarkdownToTree, treeToMarkdown, type MindNode } from '../utils/mindmapTree'
import { hasWholeNodeFormat } from '../utils/mindmapInlineFormat'
import { useMindmapCanvas } from '../hooks/useMindmapCanvas'
import { exportMindmapPng, exportMindmapSvg } from '../utils/mindmapExport'
import mindmapCSS from '../styles/localMindmap.css?inline'

export interface LocalMindmapPanelRef {
  exportPng: () => void
  exportSvg: () => void
  getMarkdown: () => string
  commitMarkdown: (markdown: string, notify?: boolean) => void
  getTarget: () => { id: string; label: string }
  insertNode: (parentId: string, text: string) => boolean
}

const LocalMindmapPanel = forwardRef<LocalMindmapPanelRef, { initialMarkdown?: string; onChange?: (markdown: string) => void; onOpenMubu?: () => void; previewMarkdown?: string; changedLines?: number[]; onAskNode?: (path: string[]) => void; onViewSource?: (text: string) => void }>(function LocalMindmapPanel({ initialMarkdown, onChange, onOpenMubu, previewMarkdown, changedLines, onAskNode, onViewSource }, ref): JSX.Element {
  const [viewMode, setViewMode] = useState<'mindmap' | 'markdown'>('mindmap')

  // Markdown 与树
  const [markdown, setMarkdown] = useState<string>(() => initialMarkdown ?? '# 思维导图\n')

  const [tree, setTree] = useState<MindNode>(() => parseMarkdownToTree(markdown))
  const markdownRef = useRef(markdown)
  markdownRef.current = markdown
  const readOnly = previewMarkdown !== undefined
  const previewTree = useMemo(() => previewMarkdown !== undefined ? parseMarkdownToTree(previewMarkdown) : null, [previewMarkdown])
  const [nodeMenu, setNodeMenu] = useState<{ id: string; path: string[]; x: number; y: number } | null>(null)
  const openNodeMenu = useCallback((id: string, path: string[], x: number, y: number) => setNodeMenu({ id, path, x, y }), [])
  useEffect(() => {
    if (!nodeMenu) return
    const close = (): void => setNodeMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', close) }
  }, [nodeMenu])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const persistMarkdown = useCallback((content: string) => {
    markdownRef.current = content
    if (onChangeRef.current) onChangeRef.current(content)

  }, [])
  // 画布编辑状态在撤销/重做时同步清除。
  const editingNodeIdRef = useRef<string | null>(null)

  // 历史栈 (Undo / Redo)
  const historyRef = useRef<string[]>([markdown])
  const historyIndexRef = useRef<number>(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const updateHistoryState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0)
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1)
  }, [])

  const prevInitialMarkdownRef = useRef(initialMarkdown)

  useEffect(() => {
    if (initialMarkdown !== undefined && initialMarkdown !== prevInitialMarkdownRef.current) {
      prevInitialMarkdownRef.current = initialMarkdown
      setMarkdown(initialMarkdown)
      const parsed = parseMarkdownToTree(initialMarkdown)
      setTree(parsed)
      historyRef.current = [initialMarkdown]
      historyIndexRef.current = 0
      updateHistoryState()
    }
  }, [initialMarkdown, updateHistoryState])

  // 提交树变动并保存
  const commitTreeChange = useCallback(
    (newTree: MindNode) => {
      const newMd = treeToMarkdown(newTree)
      prevInitialMarkdownRef.current = newMd
      setTree(newTree)
      setMarkdown(newMd)

      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
      historyRef.current.push(newMd)
      historyIndexRef.current = historyRef.current.length - 1
      updateHistoryState()

      try {
        persistMarkdown(newMd)
      } catch (err) {
        console.warn('[LocalMindmap] 持久化失败:', err)
      }
    },
    [updateHistoryState, persistMarkdown]
  )

  // 撤回 / 重做
  const handleUndo = useCallback(() => {
    if (readOnly) return
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current -= 1
    const prevMd = historyRef.current[historyIndexRef.current]
    const parsed = parseMarkdownToTree(prevMd)
    prevInitialMarkdownRef.current = prevMd
    setTree(parsed)
    setMarkdown(prevMd)
    editingNodeIdRef.current = null
    updateHistoryState()
    try {
      persistMarkdown(prevMd)
    } catch {
      // ignore
    }
  }, [updateHistoryState, persistMarkdown, readOnly])

  const handleRedo = useCallback(() => {
    if (readOnly) return
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current += 1
    const nextMd = historyRef.current[historyIndexRef.current]
    const parsed = parseMarkdownToTree(nextMd)
    prevInitialMarkdownRef.current = nextMd
    setTree(parsed)
    setMarkdown(nextMd)
    editingNodeIdRef.current = null
    updateHistoryState()
    try {
      persistMarkdown(nextMd)
    } catch {
      // ignore
    }
  }, [updateHistoryState, persistMarkdown, readOnly])

  // Toast 提示
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMessage(msg)
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null)
    }, 1800)
  }, [])

  const canvas = useMindmapCanvas({
    tree: previewTree || tree,
    active: viewMode === 'mindmap',
    editingNodeIdRef,
    onTreeChange: commitTreeChange,
    handleUndo,
    handleRedo,
    showToast,
    readOnly,
    changedLines,
    onNodeContextMenu: openNodeMenu,
    onNodeSelect: onViewSource
  })
  const { containerRef, svgRef, handleZoom, handleFit, handleExpandAll, handleFoldAll } = canvas
  const selectedContents = canvas.selectedNodeContents
  const boldCount = selectedContents.filter(content => hasWholeNodeFormat(content, 'bold')).length
  const highlightCount = selectedContents.filter(content => hasWholeNodeFormat(content, 'highlight')).length
  const allBold = selectedContents.length > 0 && boldCount === selectedContents.length
  const allHighlighted = selectedContents.length > 0 && highlightCount === selectedContents.length

  // Markdown 大纲编辑，同时同步导图与持久化。
  const handleMarkdownChange = useCallback(
    (newVal: string) => {
      if (readOnly) return
      setMarkdown(newVal)
      prevInitialMarkdownRef.current = newVal
      try {
        persistMarkdown(newVal)
      } catch {
        // ignore
      }
      const parsed = parseMarkdownToTree(newVal)
      setTree(parsed)
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
      historyRef.current.push(newVal)
      historyIndexRef.current = historyRef.current.length - 1
      updateHistoryState()
    },
    [updateHistoryState, persistMarkdown, readOnly]
  )

  const handleExportSvg = useCallback(() => {
    showToast(exportMindmapSvg(svgRef.current, tree.content))
  }, [svgRef, tree.content, showToast])

  const handleExportPng = useCallback(() => {
    void exportMindmapPng(svgRef.current, tree.content).then(showToast)
  }, [svgRef, tree.content, showToast])

  useImperativeHandle(ref, () => ({
    exportPng: handleExportPng,
    exportSvg: handleExportSvg,
    getMarkdown: () => { canvas.commitCurrentEditing(); return markdownRef.current },
    getTarget: canvas.getTarget,
    insertNode: canvas.insertNode,
    commitMarkdown: (value, notify = true) => {
      prevInitialMarkdownRef.current = value
      markdownRef.current = value
      setMarkdown(value); setTree(parseMarkdownToTree(value))
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
      historyRef.current.push(value); historyIndexRef.current++
      updateHistoryState()
      if (notify) persistMarkdown(value)
    }
  }), [handleExportPng, handleExportSvg, canvas, updateHistoryState, persistMarkdown])

  const viewSwitcher = (
    <div className={`flex shrink-0 items-center bg-white/95 backdrop-blur border border-gray-200/80 p-0.5 rounded-lg shadow-sm ${viewMode === 'mindmap' ? 'absolute right-3 top-3 z-30' : ''}`}>
      <button
        type="button"
        onClick={() => setViewMode('mindmap')}
        className={`px-2.5 py-1 rounded-md text-sm font-medium flex items-center gap-1 transition-all ${
          viewMode === 'mindmap'
            ? 'bg-gray-100 text-gray-900 font-semibold shadow-2xs'
            : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        <span className="material-symbols-outlined text-sm">hub</span>
        <span>导图</span>
      </button>
      <button
        type="button"
        onClick={() => setViewMode('markdown')}
        className={`px-2.5 py-1 rounded-md text-sm font-medium flex items-center gap-1 transition-all ${
          viewMode === 'markdown'
            ? 'bg-gray-100 text-gray-900 font-semibold shadow-2xs'
            : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        <span className="material-symbols-outlined text-sm">article</span>
        <span>大纲</span>
      </button>
    </div>
  )

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="h-full w-full flex flex-col bg-white relative overflow-hidden select-text outline-none"
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0
        e.currentTarget.scrollLeft = 0
      }}
    >
      {/* Markmap 基础样式与幕布风格黑白灰折线高质感样式 */}
      <style>{globalCSS}</style>
      <style>{mindmapCSS}</style>
      {nodeMenu && createPortal(<div role="menu" className="fixed z-[110] min-w-48 p-1 rounded-lg border border-gray-200 bg-white shadow-xl text-sm" style={{ left: Math.max(8, Math.min(nodeMenu.x, window.innerWidth - 240)), top: Math.max(8, Math.min(nodeMenu.y, window.innerHeight - 185)) }} onPointerDown={event => event.stopPropagation()}>
        <button role="menuitem" className="w-full px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-40" disabled={!onAskNode} title={!onAskNode ? '请先打开来源主会话' : undefined} onClick={() => { onAskNode?.(nodeMenu.path); setNodeMenu(null) }}>在主会话中追问</button>
        <div className="border-t border-gray-100 my-1" />
        <button role="menuitem" disabled={readOnly} className="w-full px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-40" onClick={() => { canvas.addChild(nodeMenu.id); setNodeMenu(null) }}>添加子节点</button>
        <button role="menuitem" disabled={readOnly} className="w-full px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-40" onClick={() => { canvas.editNode(nodeMenu.id); setNodeMenu(null) }}>编辑节点</button>
        <button role="menuitem" disabled={readOnly || nodeMenu.id === (previewTree || tree).id} className="w-full px-3 py-2 text-left text-red-500 hover:bg-red-50 disabled:opacity-40" onClick={() => { canvas.deleteSelection(); setNodeMenu(null) }}>删除节点</button>
      </div>, document.body)}

      {/* 浮动 Toast 提示 */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-lg bg-gray-900/85 text-white text-xs shadow-lg backdrop-blur-sm pointer-events-none transition-all">
          {toastMessage}
        </div>
      )}

      {viewMode === 'mindmap' && viewSwitcher}

      {/* ── 视图 A：思维导图交互画布 ── */}
      <div
        className="flex-1 w-full h-full relative overflow-hidden"
        style={{ display: viewMode === 'mindmap' ? 'block' : 'none' }}
        onScroll={(e) => {
          e.currentTarget.scrollTop = 0
          e.currentTarget.scrollLeft = 0
        }}
      >
        <svg
          ref={svgRef}
          className="markmap block w-full h-full"
        />

        {!readOnly && selectedContents.length > 0 && (
          <div role="toolbar" aria-label="节点文字格式" className="absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl select-none">
            {selectedContents.length > 1 && <span className="px-2 text-xs text-zinc-400 whitespace-nowrap">已选 {selectedContents.length} 个</span>}
            <button
              type="button"
              aria-label={allBold ? '取消所选节点加粗' : '加粗所选节点'}
              aria-pressed={boldCount > 0 && !allBold ? 'mixed' : allBold}
              title={allBold ? '取消所选节点加粗' : '加粗所选节点（**文字**）'}
              onClick={() => canvas.toggleNodeFormat('bold')}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${allBold ? 'bg-white text-zinc-950' : boldCount > 0 ? 'bg-zinc-700 text-white ring-1 ring-inset ring-zinc-500' : 'text-zinc-200 hover:bg-zinc-700 hover:text-white'}`}
            >
              <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">format_bold</span>
              加粗
            </button>
            <button
              type="button"
              aria-label={allHighlighted ? '取消所选节点高亮' : '高亮所选节点'}
              aria-pressed={highlightCount > 0 && !allHighlighted ? 'mixed' : allHighlighted}
              title={allHighlighted ? '取消所选节点高亮' : '高亮所选节点（==文字==）'}
              onClick={() => canvas.toggleNodeFormat('highlight')}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${allHighlighted ? 'bg-amber-300 text-amber-950' : highlightCount > 0 ? 'bg-zinc-700 text-amber-200 ring-1 ring-inset ring-amber-300/50' : 'text-zinc-200 hover:bg-zinc-700 hover:text-white'}`}
            >
              <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">ink_highlighter</span>
              高亮
            </button>
          </div>
        )}

        {/* 左上角工具栏：撤回、重做、放大、缩小、适应、展开、收起、导出 */}
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1 p-1 bg-white/90 backdrop-blur border border-gray-200/80 rounded-lg shadow-sm">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo || readOnly}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              canUndo ? 'text-text-secondary hover:text-text-primary hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'
            }`}
            title="撤回 (Ctrl+Z)"
            aria-label="撤回"
          >
            <span className="material-symbols-outlined text-base">undo</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo || readOnly}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              canRedo ? 'text-text-secondary hover:text-text-primary hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'
            }`}
            title="重做 (Ctrl+Y)"
            aria-label="重做"
          >
            <span className="material-symbols-outlined text-base">redo</span>
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-0.5" />

          <button
            type="button"
            onClick={() => {
              handleZoom(1.25)
            }}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="放大"
            aria-label="放大"
          >
            <span className="material-symbols-outlined text-base">zoom_in</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleZoom(0.8)
            }}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="缩小"
            aria-label="缩小"
          >
            <span className="material-symbols-outlined text-base">zoom_out</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleFit()
            }}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="适应视口居中"
            aria-label="适应视口居中"
          >
            <span className="material-symbols-outlined text-base">center_focus_strong</span>
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-0.5" />

          <CustomDropdown value={null} onChange={() => {}} displayText="更多" direction="down" dropdownWidth="w-56 left-0 !z-50 !max-h-[70vh]" buttonClassName="h-7 px-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-gray-100 flex items-center gap-1 text-xs transition-colors" renderContent={close => <div className="p-1 space-y-0.5">
            {onOpenMubu && (
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-primary hover:bg-gray-100/80 active:bg-gray-200/60 transition-colors text-left group select-none"
                onClick={() => { close(); onOpenMubu() }}
              >
                <span className="material-symbols-outlined text-[17px] text-gray-400 group-hover:text-gray-600 shrink-0 transition-colors">
                  open_in_new
                </span>
                <span className="truncate flex-1">打开幕布</span>
              </button>
            )}
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-primary hover:bg-gray-100/80 active:bg-gray-200/60 transition-colors text-left group select-none"
              onClick={() => { close(); handleExpandAll() }}
            >
              <span className="material-symbols-outlined text-[17px] text-gray-400 group-hover:text-gray-600 shrink-0 transition-colors">
                unfold_more
              </span>
              <span className="truncate flex-1">展开全部</span>
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-primary hover:bg-gray-100/80 active:bg-gray-200/60 transition-colors text-left group select-none"
              onClick={() => { close(); handleFoldAll() }}
            >
              <span className="material-symbols-outlined text-[17px] text-gray-400 group-hover:text-gray-600 shrink-0 transition-colors">
                unfold_less
              </span>
              <span className="truncate flex-1">收起子节点</span>
            </button>
            <div className="my-1 border-t border-gray-100" />
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-primary hover:bg-gray-100/80 active:bg-gray-200/60 transition-colors text-left group select-none"
              onClick={() => { close(); handleExportPng() }}
            >
              <span className="material-symbols-outlined text-[17px] text-gray-400 group-hover:text-gray-600 shrink-0 transition-colors">
                image
              </span>
              <span className="truncate flex-1">导出图片（PNG）</span>
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-primary hover:bg-gray-100/80 active:bg-gray-200/60 transition-colors text-left group select-none"
              onClick={() => { close(); handleExportSvg() }}
            >
              <span className="material-symbols-outlined text-[17px] text-gray-400 group-hover:text-gray-600 shrink-0 transition-colors">
                draw
              </span>
              <span className="truncate flex-1">导出图片（SVG）</span>
            </button>
            <div className="my-1 border-t border-gray-100" />
            <div className="px-2.5 py-1.5 text-text-secondary/80 text-[11px] space-y-0.5 select-none bg-gray-50/50 rounded-lg">
              <div className="font-medium text-gray-400 pb-0.5">快捷键指南</div>
              <p>左键空白处拖动框选</p>
              <p>Ctrl / Shift 点击多选</p>
              <p>右键拖动平移 · 滚轮缩放</p>
              <p>拖到节点中间成为子节点</p>
              <p>拖到节点上下沿调整顺序</p>
              <p>双击节点编辑 · Tab 添加子节点</p>
              <p>Delete 删除选中分支及子节点</p>
              <p>Esc 取消拖动或清空选择</p>
              <p>Ctrl+Z 撤销 · Ctrl+Y 重做</p>
            </div>
          </div>} />
        </div>

      </div>

      {/* ── 视图 B：Markdown 大纲编辑 ── */}
      <div
        className="flex-1 w-full h-full flex flex-col overflow-hidden"
        style={{ display: viewMode === 'markdown' ? 'flex' : 'none' }}
      >
        <div className="flex-1 min-h-0 flex flex-col">
          <MindmapMarkdownEditor
            value={previewMarkdown ?? markdown}
            readOnly={readOnly}
            onChange={handleMarkdownChange}
            active={viewMode === 'markdown'}
            viewSwitcher={viewSwitcher}
            actions={<>
              {onOpenMubu && <CustomDropdown value={null} onChange={() => {}} displayText="更多" dropdownWidth="w-40 !left-auto right-0 !z-50" buttonClassName="h-7 px-2 rounded text-gray-500 hover:bg-gray-100 flex items-center gap-1 text-sm" renderContent={close => <div className="p-1 text-sm">
                <button type="button" className="w-full text-left px-3 py-2 rounded hover:bg-gray-100" onClick={() => { close(); onOpenMubu() }}>打开幕布</button>
              </div>} />}
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(markdown)
                  showToast('已复制大纲')
                }}
                className="p-1 rounded hover:bg-gray-100 text-text-secondary hover:text-text-primary transition-colors"
                title="复制大纲"
                aria-label="复制大纲"
              >
                <span className="material-symbols-outlined text-base">content_copy</span>
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  if (window.confirm('确定清空内容吗？')) {
                    handleMarkdownChange('# 思维导图\n\n- ')
                    showToast('已清空')
                  }
                }}
                className="p-1 rounded hover:bg-gray-100 text-text-secondary hover:text-red-500 transition-colors"
                title="清空"
              >
                <span className="material-symbols-outlined text-base">delete_sweep</span>
              </button>
            </>}
          />
        </div>
      </div>
    </div>
  )
})

export default LocalMindmapPanel
