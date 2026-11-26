import { useEffect, useMemo, useRef, useState } from 'react'
import { flattenSortedFiles, useWorkbenchStore } from '../../store/workbenchStore'
import type { WorkbenchFileNode } from '../../../../shared/types/workbench'
import Modal from '../ui/Modal'
import { AppIcon } from '../icons/AppIcon'
import { WorkbenchDocumentIcon } from './FileTypeIcon'

function getParentRelativeDir(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/')
  return idx === -1 ? '根目录' : relativePath.slice(0, idx)
}

/**
 * 工作台快速打开文件弹窗（Ctrl/Cmd+O 或空白页“打开文件”触发）。
 * 不依赖左侧文件树展开状态，支持按文件名与路径模糊过滤并用键盘快速打开。
 */
export default function WorkbenchQuickOpenModal(): JSX.Element {
  const isQuickOpenOpen = useWorkbenchStore((s) => s.isQuickOpenOpen)
  const setQuickOpenOpen = useWorkbenchStore((s) => s.setQuickOpenOpen)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const fileSort = useWorkbenchStore((s) => s.fileSort)
  const openTabs = useWorkbenchStore((s) => s.openTabs)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const createUntitledNote = useWorkbenchStore((s) => s.createUntitledNote)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const allFiles = useMemo<WorkbenchFileNode[]>(
    () => flattenSortedFiles(fileTree, fileSort),
    [fileTree, fileSort]
  )

  const openPathSet = useMemo(() => new Set(openTabs.map((t) => t.path)), [openTabs])

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allFiles.slice(0, 80)
    const nameStarts: WorkbenchFileNode[] = []
    const nameContains: WorkbenchFileNode[] = []
    const pathContains: WorkbenchFileNode[] = []
    for (const file of allFiles) {
      const nameLower = file.name.toLowerCase()
      const pathLower = file.path.toLowerCase()
      if (nameLower.startsWith(q)) nameStarts.push(file)
      else if (nameLower.includes(q)) nameContains.push(file)
      else if (pathLower.includes(q)) pathContains.push(file)
    }
    return [...nameStarts, ...nameContains, ...pathContains].slice(0, 80)
  }, [allFiles, query])

  useEffect(() => {
    if (!isQuickOpenOpen) return
    setQuery('')
    setSelectedIndex(0)
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [isQuickOpenOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!isQuickOpenOpen) return
    const item = listRef.current?.querySelector<HTMLElement>(`[data-quick-open-idx="${selectedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [isQuickOpenOpen, selectedIndex])

  const handleOpenSelected = (file: WorkbenchFileNode | undefined) => {
    if (!file) return
    setQuickOpenOpen(false)
    void openFile(file.path, { forcePermanent: true })
  }

  return (
    <Modal
      open={isQuickOpenOpen}
      onClose={() => setQuickOpenOpen(false)}
      size="md"
      variant="glass"
    >
      <div className="p-2.5 border-b border-black/5 dark:border-white/10">
        <div className="h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-white/75 dark:bg-gray-900/70 flex items-center gap-2 focus-within:border-primary/50">
          <AppIcon name="search" size={16} className="text-text-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex((i) => (filteredFiles.length ? (i + 1) % filteredFiles.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex((i) =>
                  filteredFiles.length ? (i - 1 + filteredFiles.length) % filteredFiles.length : 0
                )
              } else if (e.key === 'Enter') {
                e.preventDefault()
                handleOpenSelected(filteredFiles[selectedIndex])
              }
            }}
            placeholder="输入文件名或路径以打开..."
            className="w-full bg-transparent text-body text-text-primary placeholder:text-text-secondary/60 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="w-5 h-5 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="清空搜索"
            >
              <AppIcon name="close" size={12} />
            </button>
          )}
        </div>
      </div>

      <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5 space-y-0.5 select-none">
        {allFiles.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center text-center gap-3">
            <span className="text-label text-text-secondary">当前工作区暂无文档</span>
            <button
              type="button"
              onClick={() => {
                setQuickOpenOpen(false)
                void createUntitledNote()
              }}
              className="h-8 px-3 rounded-lg border border-black/10 dark:border-white/10 text-label text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-1.5 transition-colors"
            >
              <AppIcon name="note_add" size={14} />
              <span>新建笔记</span>
            </button>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="py-8 text-center text-label text-text-secondary">未找到匹配文件</div>
        ) : (
          filteredFiles.map((file, idx) => {
            const active = idx === selectedIndex
            const isAlreadyOpen = openPathSet.has(file.path)
            return (
              <button
                key={file.path}
                type="button"
                data-quick-open-idx={idx}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => handleOpenSelected(file)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <WorkbenchDocumentIcon node={file} size={15} className="w-[15px] h-[15px]" />
                <div className="flex-1 min-w-0">
                  <div className={`text-label truncate ${active ? 'font-medium' : ''}`}>{file.name}</div>
                  <div className="text-caption text-text-secondary truncate font-mono">
                    {getParentRelativeDir(file.path)}
                  </div>
                </div>
                {isAlreadyOpen && (
                  <span className="text-tiny px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-text-secondary shrink-0">
                    已打开
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-black/5 dark:border-white/10 flex items-center justify-between text-caption text-text-secondary select-none">
        <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
        <span>共 {allFiles.length} 项</span>
      </div>
    </Modal>
  )
}
