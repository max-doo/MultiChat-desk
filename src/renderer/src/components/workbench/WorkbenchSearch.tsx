import { useRef, useEffect } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { WorkbenchSearchResult } from '../../../../shared/types/workbench'

interface WorkbenchSearchProps {
  onClose?: () => void
}

export default function WorkbenchSearch({ onClose }: WorkbenchSearchProps): JSX.Element {
  const searchQuery = useWorkbenchStore((s) => s.searchQuery)
  const isSearching = useWorkbenchStore((s) => s.isSearching)
  const searchResults = useWorkbenchStore((s) => s.searchResults)
  const searchFiles = useWorkbenchStore((s) => s.searchFiles)
  const clearSearch = useWorkbenchStore((s) => s.clearSearch)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleResultClick = async (result: WorkbenchSearchResult) => {
    await openFile(result.filePath)
  }

  // 高亮匹配关键词文本
  const renderHighlightedSnippet = (preview: string, query: string) => {
    if (!query) return preview
    const lowerPreview = preview.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const index = lowerPreview.indexOf(lowerQuery)
    if (index === -1) return preview

    const before = preview.slice(0, index)
    const match = preview.slice(index, index + query.length)
    const after = preview.slice(index + query.length)

    return (
      <>
        <span>{before}</span>
        <span className="font-semibold text-blue-600 dark:text-blue-400 bg-blue-100/70 dark:bg-blue-900/40 rounded px-0.5">
          {match}
        </span>
        <span>{after}</span>
      </>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">
      {/* 搜索输入框 */}
      <div className="p-2 border-b border-black/5 dark:border-white/5">
        <div className="relative flex items-center">
          <span className="material-symbols-outlined text-[17px] text-text-secondary absolute left-2 pointer-events-none">
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => searchFiles(e.target.value)}
            placeholder="全文搜索笔记与内容..."
            className="w-full h-8 pl-8 pr-14 rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-primary/40 focus:bg-white dark:focus:bg-gray-800 text-text-primary text-xs placeholder:text-text-secondary/60 focus:outline-none transition-all"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            {isSearching ? (
              <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : searchQuery ? (
              <button
                type="button"
                onClick={clearSearch}
                className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10"
                title="清空搜索"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            ) : null}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10"
                title="返回文件树"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 搜索结果列表 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
          <div className="py-8 text-center text-text-secondary/70">
            <span className="material-symbols-outlined text-2xl mb-1 opacity-50 block">search_off</span>
            未找到包含 &ldquo;{searchQuery}&rdquo; 的匹配项
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="px-2 py-1 text-[11px] text-text-secondary font-medium">
            共找到 {searchResults.length} 处匹配
          </div>
        )}

        {searchResults.map((result, idx) => (
          <button
            key={`${result.filePath}-${result.line}-${idx}`}
            type="button"
            onClick={() => void handleResultClick(result)}
            className="w-full text-left p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group flex flex-col gap-1 border border-transparent hover:border-black/5 dark:hover:border-white/5"
          >
            <div className="flex items-center justify-between text-text-primary">
              <span className="font-medium truncate group-hover:text-primary transition-colors">
                {result.fileName}
              </span>
              <span className="text-[10px] font-mono text-text-secondary/70 bg-black/5 dark:bg-white/5 px-1 rounded">
                第 {result.line} 行
              </span>
            </div>
            <div className="text-[11px] text-text-secondary/80 truncate font-mono">
              {renderHighlightedSnippet(result.preview || result.content, searchQuery)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
