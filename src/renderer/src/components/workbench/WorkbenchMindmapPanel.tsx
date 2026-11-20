import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteConversation } from '../../../../shared/types/notes'
import { MARKDOWN_EXTENSIONS } from '../../../../shared/types/workbench'
import { useWorkbenchStore } from '../../store/workbenchStore'
import ConversationMindmapPanel, { type MindmapMaterialRequest, type MindmapSource } from '../ConversationMindmapPanel'

/** 去掉 frontmatter 与图片语法：导图只关心文字结构，图片地址会干扰模型判断。 */
function documentText(content: string): string {
  return content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function WorkbenchMindmapPanel(): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const activeFileCategory = useWorkbenchStore((s) => s.activeFileCategory)
  const pendingSelection = useWorkbenchStore((s) => s.pendingMindmapSelection)
  const setPendingSelection = useWorkbenchStore((s) => s.setPendingMindmapSelection)
  const closeRightPane = useWorkbenchStore((s) => s.closeRightPane)

  const [record, setRecord] = useState<NoteConversation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const contentRef = useRef(activeFileContent)
  contentRef.current = activeFileContent
  const pathRef = useRef(activeFilePath)
  pathRef.current = activeFilePath

  const supported = useMemo(() => {
    if (!activeFilePath) return false
    if (activeFileCategory === 'markdown' || activeFileCategory === 'text' || activeFileCategory === 'code') return true
    const lower = activeFilePath.toLowerCase()
    return [...MARKDOWN_EXTENSIONS].some(ext => lower.endsWith(ext))
  }, [activeFilePath, activeFileCategory])

  // 切换文档即换绑：已有记录直接带出，没有则等用户主动生成时再建。
  useEffect(() => {
    if (!workspacePath || !activeFilePath || !supported) {
      setRecord(null)
      setError('')
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    const title = activeFilePath.split('/').pop() || activeFilePath
    // 先只读查询：没生成过导图的文档不建空记录。
    void window.api.workbench.mindmapSource(workspacePath, activeFilePath, title, false).then(result => {
      if (!alive) return
      if (!result.success) { setError(result.error || '读取导图失败'); setRecord(null); return }
      setRecord(result.data ?? null)
    }).finally(() => { if (alive) setLoading(false) })
    const off = window.api.onNotesChanged(() => {
      void window.api.workbench.mindmapSource(workspacePath, activeFilePath, title, false).then(result => {
        if (alive && result.success) setRecord(result.data ?? null)
      })
    })
    return () => { alive = false; off() }
  }, [workspacePath, activeFilePath, supported])

  // 文档来源对面板而言是「固定 id + 材料提供者」，不需要 webview 引用。
  const source = useMemo<MindmapSource | undefined>(() => {
    if (!record) return undefined
    return { id: record.id, name: record.title, getRef: () => null }
  }, [record?.id, record?.title])

  const materialProvider = useCallback(async (): Promise<MindmapMaterialRequest> => {
    const content = documentText(contentRef.current)
    const path = pathRef.current || ''
    const fileName = path.split('/').pop() || 'document.md'
    const selection = useWorkbenchStore.getState().pendingMindmapSelection
    const workspace = useWorkbenchStore.getState().workspacePath
    // 首次生成时才落记录，后续刷新沿用同一条来源。
    if (workspace && path) {
      const created = await window.api.workbench.mindmapSource(workspace, path, fileName, true, contentRef.current)
      if (created.success && created.data) setRecord(created.data)
    }
    if (selection?.text.trim()) {
      return {
        text: selection.text.trim(),
        fileName: `selection-${fileName}`,
        kind: 'selection',
        scope: { scope: 'selection', contentHash: '', selectionText: selection.text.trim(), headingPath: selection.headingPath }
      }
    }
    return { text: content, fileName, kind: 'document', scope: { scope: 'document', contentHash: '' } }
  }, [])

  // 切换文档时丢弃旧选区，避免把上一段的选中内容带到下一篇。
  useEffect(() => {
    setPendingSelection(null)
  }, [activeFilePath, setPendingSelection])

  if (!workspacePath || !activeFilePath) {
    return <div className="h-full flex items-center justify-center p-6 text-sm text-text-secondary">打开一篇文档后即可生成思维导图</div>
  }
  if (!supported) {
    return <div className="h-full flex items-center justify-center p-6 text-sm text-text-secondary">该格式暂不支持生成思维导图</div>
  }
  if (loading && !record) {
    return <div className="h-full flex items-center justify-center text-sm text-text-secondary">正在载入…</div>
  }
  if (!record) {
    if (error) return <div className="h-full flex items-center justify-center p-6 text-sm text-text-secondary">{error}</div>
    // 未生成过导图：不预先落记录，等用户点开再建。
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="material-symbols-outlined text-3xl text-primary">account_tree</span>
        <button
          type="button"
          onClick={() => {
            if (!workspacePath || !activeFilePath) return
            const title = activeFilePath.split('/').pop() || activeFilePath
            void window.api.workbench.mindmapSource(workspacePath, activeFilePath, title, true).then(result => {
              if (result.success && result.data) setRecord(result.data)
              else setError(result.error || '创建失败')
            })
          }}
          className="h-9 px-4 rounded-lg bg-primary text-white text-sm hover:brightness-95"
        >
          为这篇文档生成导图
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {pendingSelection && (
        <div className="px-3 py-1.5 text-xs text-primary bg-primary/5 border-b border-primary/10">
          已选中 {pendingSelection.text.length} 个字符，生成时只整理这段内容
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ConversationMindmapPanel
          key={record.id}
          source={source}
          conversation={record}
          variant="document"
          materialProvider={materialProvider}
          onClose={closeRightPane}
        />
      </div>
    </div>
  )
}
