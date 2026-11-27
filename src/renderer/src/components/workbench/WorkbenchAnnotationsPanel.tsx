import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Annotation, WorkspaceAnnotationDocumentGroup } from '../../../../shared/types/annotations'
import type { WorkbenchFileNode } from '../../../../shared/types/workbench'
import { isUnresolvedAnchorState } from '../../../../shared/utils/annotationAnchors'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAnnotationStore } from '../../store/annotationStore'
import { AppIcon } from '../icons/AppIcon'
import { WorkbenchDocumentIcon } from './FileTypeIcon'
import WorkbenchSidebarSearchBar from './WorkbenchSidebarSearchBar'

interface WorkbenchAnnotationsPanelProps {
  onClose?: () => void
}

function buildDocumentNode(relativePath: string): WorkbenchFileNode {
  const name = relativePath.split('/').pop() || relativePath
  const dotIdx = name.lastIndexOf('.')
  const extension = dotIdx > 0 ? name.slice(dotIdx).toLowerCase() : ''
  return {
    id: relativePath,
    name,
    path: relativePath,
    fullPath: relativePath,
    isDirectory: false,
    extension
  }
}

function splitDocumentPath(relativePath: string): { fileName: string; dirPath: string } {
  const idx = relativePath.lastIndexOf('/')
  if (idx === -1) return { fileName: relativePath, dirPath: '' }
  return {
    fileName: relativePath.slice(idx + 1),
    dirPath: relativePath.slice(0, idx)
  }
}

function renderHighlightedText(text: string, query: string): ReactNode {
  const target = query.trim()
  if (!target) return text
  const lowerText = text.toLowerCase()
  const lowerTarget = target.toLowerCase()
  const index = lowerText.indexOf(lowerTarget)
  if (index === -1) return text

  return (
    <>
      <span>{text.slice(0, index)}</span>
      <span className="font-semibold text-blue-600 dark:text-blue-400 bg-blue-100/70 dark:bg-blue-900/40 rounded px-0.5">
        {text.slice(index, index + lowerTarget.length)}
      </span>
      <span>{text.slice(index + lowerTarget.length)}</span>
    </>
  )
}

export default function WorkbenchAnnotationsPanel({
  onClose
}: WorkbenchAnnotationsPanelProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const selectedId = useAnnotationStore((s) => s.selectedId)

  const [groups, setGroups] = useState<WorkspaceAnnotationDocumentGroup[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const loadWorkspaceAnnotations = useCallback(
    async (silent = false): Promise<void> => {
      if (!workspacePath) {
        setGroups([])
        setLoading(false)
        setError(null)
        return
      }
      if (!silent) setLoading(true)
      try {
        const result = await window.api.annotations.listWorkspace(workspacePath)
        if (useWorkbenchStore.getState().workspacePath !== workspacePath) return
        if (result.success && result.data) {
          setGroups(result.data)
          setError(null)
        } else {
          setError(result.error || '加载标注失败')
        }
      } catch {
        if (useWorkbenchStore.getState().workspacePath !== workspacePath) return
        setError('加载标注失败')
      } finally {
        if (useWorkbenchStore.getState().workspacePath === workspacePath) {
          setLoading(false)
        }
      }
    },
    [workspacePath]
  )

  useEffect(() => {
    void loadWorkspaceAnnotations(false)
  }, [loadWorkspaceAnnotations])

  // 文档树更新（重命名/删除/移动）或标注变更时静默刷新列表
  useEffect(() => {
    if (!workspacePath) return
    void loadWorkspaceAnnotations(true)
  }, [fileTree, loadWorkspaceAnnotations, workspacePath])

  useEffect(() => {
    if (!workspacePath) return
    return window.api.annotations.onChanged((event) => {
      if (event.scope === 'source' || event.workspaceRoot === workspacePath) {
        void loadWorkspaceAnnotations(true)
      }
    })
  }, [loadWorkspaceAnnotations, workspacePath])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const totalAnnotations = useMemo(
    () => groups.reduce((sum, group) => sum + group.annotations.length, 0),
    [groups]
  )

  const filteredGroups = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase()
    if (!normalized) return groups
    const next: WorkspaceAnnotationDocumentGroup[] = []
    for (const group of groups) {
      const matched = group.annotations.filter((item) => {
        const quote = (item.quote || item.originalQuote || '').toLowerCase()
        const comment = (item.comment || '').toLowerCase()
        return comment.includes(normalized) || quote.includes(normalized)
      })
      if (matched.length > 0) {
        next.push({ ...group, annotations: matched })
      }
    }
    return next
  }, [groups, searchQuery])

  const handleOpenDocument = useCallback(
    async (relativePath: string): Promise<void> => {
      await openFile(relativePath)
    },
    [openFile]
  )

  const handleLocateAnnotation = useCallback(
    async (relativePath: string, annotation: Annotation): Promise<void> => {
      if (!workspacePath) return
      const annotationStore = useAnnotationStore.getState()
      annotationStore.requestReveal(workspacePath, relativePath, annotation.id)
      const opened = await openFile(relativePath)
      if (!opened) {
        useAnnotationStore.getState().clearReveal()
        return
      }
      const wb = useWorkbenchStore.getState()
      if (
        wb.activeFilePath === relativePath &&
        wb.activeFileCategory === 'markdown' &&
        wb.editorMode === 'source' &&
        !wb.activeFileOversized
      ) {
        wb.setEditorMode('wysiwyg')
      }
    },
    [openFile, workspacePath]
  )

  return (
    <div className="flex flex-col h-full overflow-hidden text-body">
      <WorkbenchSidebarSearchBar
        ref={inputRef}
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={
          totalAnnotations > 0
            ? `搜索标注或引用文字 (共 ${totalAnnotations} 条)...`
            : '搜索标注或引用文字...'
        }
        onClose={onClose}
        closeLabel="返回文件列表"
      />

      <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
        {loading && groups.length === 0 ? (
          <div className="py-10 flex items-center justify-center text-text-secondary/60">
            <span className="w-4 h-4 border-2 border-primary/60 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error && groups.length === 0 ? (
          <div className="py-10 px-4 text-center text-body text-text-secondary/70">
            {error}
          </div>
        ) : groups.length === 0 ? (
          <div className="py-10 px-4 flex flex-col items-center justify-center text-center text-text-secondary/70">
            <AppIcon name="annotation" size={24} className="mx-auto mb-2 opacity-40 block" />
            <span>当前工作区暂无标注</span>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="py-10 px-4 flex flex-col items-center justify-center text-center text-text-secondary/70">
            <AppIcon name="search_off" size={24} className="mx-auto mb-2 opacity-40 block" />
            <span>未找到包含 &ldquo;{searchQuery.trim()}&rdquo; 的标注</span>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const { fileName, dirPath } = splitDocumentPath(group.relativePath)
            const isDocActive = activeFilePath === group.relativePath
            const docNode = buildDocumentNode(group.relativePath)

            return (
              <section
                key={group.relativePath}
                className={`rounded-xl border transition-colors overflow-hidden ${
                  isDocActive
                    ? 'border-primary/30 bg-white/90 dark:bg-white/[0.05]'
                    : 'border-black/5 dark:border-white/10 bg-white/65 dark:bg-white/[0.03]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void handleOpenDocument(group.relativePath)}
                  title={group.relativePath}
                  className="w-full px-2.5 py-2 flex items-center gap-1.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
                >
                  <WorkbenchDocumentIcon node={docNode} size={19} className="w-[19px] h-[19px] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium text-text-primary truncate">
                      {fileName}
                    </div>
                    {dirPath && (
                      <div className="text-label text-text-secondary/60 truncate">
                        {dirPath}
                      </div>
                    )}
                  </div>
                  <span className="text-label text-text-secondary/70 tabular-nums shrink-0">
                    {group.annotations.length}
                  </span>
                </button>

                <div className="divide-y divide-black/5 dark:divide-white/5 border-t border-black/5 dark:border-white/5">
                  {group.annotations.map((item) => {
                    const isSelected = isDocActive && selectedId === item.id
                    const unresolved = isUnresolvedAnchorState(item.anchorState)
                    const quoteText = (item.quote || item.originalQuote || '').trim()
                    const commentText = item.comment.trim()

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleLocateAnnotation(group.relativePath, item)}
                        className={`w-full px-2.5 py-2 text-left transition-colors block ${
                          isSelected
                            ? 'bg-amber-500/10 dark:bg-amber-400/15'
                            : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        {quoteText && (
                          <div className="border-l-2 border-amber-400/80 pl-2 text-label text-text-secondary line-clamp-2 break-words">
                            {renderHighlightedText(quoteText, searchQuery)}
                          </div>
                        )}
                        {commentText && (
                          <div
                            className={`${quoteText ? 'mt-1.5' : ''} text-body text-text-primary line-clamp-2 break-words leading-relaxed`}
                          >
                            {renderHighlightedText(commentText, searchQuery)}
                          </div>
                        )}
                        {unresolved && (
                          <div className="mt-1 text-label text-rose-500/80 dark:text-rose-400/80">
                            未定位
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
