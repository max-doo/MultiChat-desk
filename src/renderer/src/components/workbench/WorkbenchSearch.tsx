import { useRef, useEffect } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import type { WorkbenchFileNode, WorkbenchSearchResult } from '../../../../shared/types/workbench'
import { AppIcon } from '../icons/AppIcon'

interface WorkbenchSearchProps {
  onClose?: () => void
}

export default function WorkbenchSearch({ onClose }: WorkbenchSearchProps): JSX.Element {
  const searchQuery = useWorkbenchStore((s) => s.searchQuery)
  const isSearching = useWorkbenchStore((s) => s.isSearching)
  const searchResults = useWorkbenchStore((s) => s.searchResults)
  const searchFiles = useWorkbenchStore((s) => s.searchFiles)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const setDraggingNodes = useWorkbenchStore((s) => s.setDraggingNodes)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose?.()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleResultClick = async (result: WorkbenchSearchResult) => {
    const opened = await openFile(result.filePath)
    if (opened) onClose?.()
  }

  // 高亮匹配关键词文本
  const renderHighlightedSnippet = (preview: string, query: string) => {
    if (!query) return preview
    let target = query.trim()
    if (/^tag:/i.test(target)) {
      target = target.slice(4).trim()
    }
    const lowerPreview = preview.toLowerCase()
    let lowerTarget = target.toLowerCase()
    let index = lowerPreview.indexOf(lowerTarget)

    if (index === -1 && lowerTarget.startsWith('#')) {
      lowerTarget = lowerTarget.slice(1)
      index = lowerPreview.indexOf(lowerTarget)
    }

    if (index === -1) return preview

    const before = preview.slice(0, index)
    const match = preview.slice(index, index + lowerTarget.length)
    const after = preview.slice(index + lowerTarget.length)

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
    <div className="flex flex-col h-full overflow-hidden text-body">
      <div className="p-2 border-b border-black/5 dark:border-white/5">
        <div className="relative flex items-center">
          <AppIcon name="search" size={19} className="text-text-secondary absolute left-2 pointer-events-none" />
          <input
            ref={inputRef}
            data-workbench-search-input
            type="text"
            value={searchQuery}
            onChange={(e) => searchFiles(e.target.value)}
            placeholder="全文搜索或搜索标签 (#tag, tag:#tag)..."
            className="w-full h-8 pl-8 pr-9 rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-primary/40 focus:bg-white dark:focus:bg-gray-800 text-text-primary text-body placeholder:text-text-secondary/60 focus:outline-none transition-all"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            {isSearching ? (
              <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10"
              title="退出搜索"
              aria-label="退出搜索"
            >
              <AppIcon name="close" size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
          <div className="py-8 px-4 flex flex-col items-center justify-center text-center text-text-secondary/70">
            <AppIcon name="search_off" size={24} className="mx-auto mb-1 opacity-50 block" />
            <span>未找到包含 &ldquo;{searchQuery}&rdquo; 的匹配项</span>
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="px-2 py-1 text-label text-text-secondary font-medium">
            共找到 {searchResults.length} 处匹配
          </div>
        )}

        {searchResults.map((result, idx) => (
          <div
            key={`${result.filePath}-${result.line}-${idx}`}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'copyMove'
              const cleanRoot = (workspacePath || '').replace(/[/\\]+$/, '')
              const cleanRel = result.filePath.replace(/^[/\\]+/, '')
              const sep = cleanRoot.includes('\\') ? '\\' : '/'
              const fullPath = cleanRoot ? `${cleanRoot}${sep}${cleanRel.replace(/\//g, sep)}` : result.filePath
              e.dataTransfer.setData('text/plain', fullPath)
              const node: WorkbenchFileNode = {
                id: result.filePath,
                name: result.fileName,
                path: result.filePath,
                fullPath,
                isDirectory: false
              }
              setDraggingNodes([node])
              try {
                e.dataTransfer.setData(
                  'application/x-multichat-workspace-files',
                  JSON.stringify([
                    {
                      path: node.path,
                      fullPath: node.fullPath,
                      name: node.name,
                      isDirectory: false,
                      size: 0
                    }
                  ])
                )
              } catch {
                // ignore
              }
            }}
            onDragEnd={() => {
              setDraggingNodes(null)
            }}
            onClick={() => void handleResultClick(result)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                void handleResultClick(result)
              }
            }}
            className="w-full text-left p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group flex flex-col gap-1 border border-transparent hover:border-black/5 dark:hover:border-white/5 cursor-pointer select-none"
          >
            <div className="flex items-center justify-between gap-2 text-text-primary">
              <span
                className="font-medium truncate min-w-0 flex-1 group-hover:text-primary transition-colors"
                title={result.fileName}
              >
                {result.fileName}
              </span>
              <span className="text-caption font-mono text-text-secondary/70 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap select-none">
                第 {result.line} 行
              </span>
            </div>
            <div className="text-label text-text-secondary/80 truncate font-mono">
              {renderHighlightedSnippet(result.preview || result.content, searchQuery)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
