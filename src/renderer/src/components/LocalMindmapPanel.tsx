import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { globalCSS } from 'markmap-view'
import CustomDropdown from './CustomDropdown'
import MindmapMarkdownEditor from './MindmapMarkdownEditor'
import { parseMarkdownToTree, treeToMarkdown, type MindNode } from '../utils/mindmapTree'
import { useMindmapCanvas } from '../hooks/useMindmapCanvas'
import { exportMindmapPng, exportMindmapSvg } from '../utils/mindmapExport'
import mindmapCSS from '../styles/localMindmap.css?inline'

export interface LocalMindmapPanelRef {
  exportPng: () => void
  exportSvg: () => void
}

const STORAGE_KEY = 'multichat_local_mindmap_markdown'

const LocalMindmapPanel = forwardRef<LocalMindmapPanelRef, { initialMarkdown?: string; onChange?: (markdown: string) => void }>(function LocalMindmapPanel({ initialMarkdown, onChange }, ref): JSX.Element {
  const [viewMode, setViewMode] = useState<'mindmap' | 'markdown'>('mindmap')

  // Markdown 与树
  const [markdown, setMarkdown] = useState<string>(() => {
    if (initialMarkdown !== undefined) return initialMarkdown
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved !== null ? saved : '# 思维导图\n'
    } catch {
      return '# 思维导图\n'
    }
  })

  const [tree, setTree] = useState<MindNode>(() => parseMarkdownToTree(markdown))
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const persistMarkdown = useCallback((content: string) => {
    if (onChangeRef.current) onChangeRef.current(content)
    else localStorage.setItem(STORAGE_KEY, content)
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
  }, [updateHistoryState, persistMarkdown])

  const handleRedo = useCallback(() => {
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
  }, [updateHistoryState, persistMarkdown])

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

  const { containerRef, svgRef, handleZoom, handleFit, handleExpandAll, handleFoldAll } = useMindmapCanvas({
    tree,
    active: viewMode === 'mindmap',
    editingNodeIdRef,
    onTreeChange: commitTreeChange,
    handleUndo,
    handleRedo,
    showToast
  })

  // Markdown 大纲编辑，同时同步导图与持久化。
  const handleMarkdownChange = useCallback(
    (newVal: string) => {
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
    [updateHistoryState, persistMarkdown]
  )

  const handleExportSvg = useCallback(() => {
    showToast(exportMindmapSvg(svgRef.current, tree.content))
  }, [svgRef, tree.content, showToast])

  const handleExportPng = useCallback(() => {
    void exportMindmapPng(svgRef.current, tree.content).then(showToast)
  }, [svgRef, tree.content, showToast])

  useImperativeHandle(ref, () => ({
    exportPng: handleExportPng,
    exportSvg: handleExportSvg
  }), [handleExportPng, handleExportSvg])

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
      className="h-full w-full flex flex-col bg-white relative overflow-hidden select-text"
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0
        e.currentTarget.scrollLeft = 0
      }}
    >
      {/* Markmap 基础样式与幕布风格黑白灰折线高质感样式 */}
      <style>{globalCSS}</style>
      <style>{mindmapCSS}</style>

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

        {/* 右下角工具栏：撤回、重做、放大、缩小、适应、展开、收起、导出 */}
        <div className="absolute right-3 bottom-3 z-20 flex items-center gap-1 p-1 bg-white/90 backdrop-blur border border-gray-200/80 rounded-lg shadow-sm">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
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
            disabled={!canRedo}
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

          <CustomDropdown value={null} onChange={() => {}} displayText="更多" direction="up" dropdownWidth="w-56 !left-auto right-0 !z-50 !max-h-[70vh]" buttonClassName="h-7 px-2 rounded text-gray-500 hover:bg-gray-100 flex items-center gap-1 text-sm" renderContent={close => <div className="p-1 text-sm">
            <button className="w-full text-left px-3 py-2 rounded hover:bg-gray-100" onClick={() => { close(); handleExpandAll() }}>展开全部</button>
            <button className="w-full text-left px-3 py-2 rounded hover:bg-gray-100" onClick={() => { close(); handleFoldAll() }}>收起子节点</button>
            <button className="w-full text-left px-3 py-2 rounded hover:bg-gray-100" onClick={() => { close(); handleExportPng() }}>导出图片（PNG）</button>
            <button className="w-full text-left px-3 py-2 rounded hover:bg-gray-100" onClick={() => { close(); handleExportSvg() }}>导出图片（SVG）</button>
            <div className="mt-1 px-3 py-2 border-t border-gray-100 text-gray-500 space-y-1"><p>双击节点编辑</p><p>Tab 添加子节点</p><p>Delete 删除节点</p><p>Ctrl+Z 撤销 · Ctrl+Y 重做</p></div>
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
            value={markdown}
            onChange={handleMarkdownChange}
            active={viewMode === 'markdown'}
            viewSwitcher={viewSwitcher}
            actions={<>
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
