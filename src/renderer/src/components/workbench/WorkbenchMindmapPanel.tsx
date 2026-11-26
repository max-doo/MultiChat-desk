import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteConversation } from '../../../../shared/types/notes'
import { MARKDOWN_EXTENSIONS } from '../../../../shared/types/workbench'
import { mindmapFileKindOfPath } from '../../../../shared/utils/mindmap'
import { useWorkbenchStore } from '../../store/workbenchStore'
import ConversationMindmapPanel, { type MindmapMaterialRequest, type MindmapSource, type MindmapFileSyncHooks, type MindmapSelectionPreview } from '../ConversationMindmapPanel'
import { MindmapVisibilityContext } from '../LocalMindmapPanel'

/** 去掉 frontmatter 与图片语法：导图只关心文字结构，图片地址会干扰模型判断。 */
function documentText(content: string): string {
  return content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function WorkbenchMindmapPanel({ isVisible = true }: { isVisible?: boolean }): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileCategory = useWorkbenchStore((s) => s.activeFileCategory)
  const pendingSelection = useWorkbenchStore((s) => s.pendingMindmapSelection)
  const setPendingSelection = useWorkbenchStore((s) => s.setPendingMindmapSelection)
  const closeRightPane = useWorkbenchStore((s) => s.closeRightPane)

  const [recordState, setRecordState] = useState<{ path: string; record: NoteConversation | null }>({ path: '', record: null })
  const [loading, setLoading] = useState(false)
  const pathRef = useRef(activeFilePath)
  pathRef.current = activeFilePath
  const record = activeFilePath && recordState.path === activeFilePath ? recordState.record : null
  const hasRecordForActivePath = Boolean(activeFilePath && recordState.path === activeFilePath && recordState.record)

  const supported = useMemo(() => {
    if (!activeFilePath) return false
    if (mindmapFileKindOfPath(activeFilePath)) return true
    if (activeFileCategory === 'markdown' || activeFileCategory === 'text' || activeFileCategory === 'code') return true
    const lower = activeFilePath.toLowerCase()
    return [...MARKDOWN_EXTENSIONS].some(ext => lower.endsWith(ext))
  }, [activeFilePath, activeFileCategory])

  const selectionText = pendingSelection?.text.trim() || ''
  const selectionPreview = useMemo<MindmapSelectionPreview | undefined>(() => {
    if (!selectionText) return undefined
    return { text: selectionText, onClear: () => setPendingSelection(null) }
  }, [selectionText, setPendingSelection])
  const clearSelection = useCallback(() => {
    setPendingSelection(null)
  }, [setPendingSelection])

  // 打开面板 / 切换文档即建档：用户主动点开思维导图侧栏即视为有生成意图，
  // 这里建一条空记录，让 ConversationMindmapPanel 的草稿键从一开始就稳定。
  // 隐藏态下暂停自动建档 IPC 与变更监听，等再次可见时再同步。
  useEffect(() => {
    if (!isVisible) return
    if (!workspacePath || !activeFilePath || !supported) {
      setRecordState({ path: activeFilePath || '', record: null })
      return
    }
    let alive = true
    if (!hasRecordForActivePath) {
      setLoading(true)
    }
    const title = activeFilePath.split('/').pop() || activeFilePath
    const kind = mindmapFileKindOfPath(activeFilePath)
    const activeContent = useWorkbenchStore.getState().activeFileContent
    // create=true：面板一旦打开就建档，避免子组件在生成中途才补档导致内部状态跳变。
    // HTML 虽是原文件上传，但编辑器里是文本，传内存内容才能记录当前版本。
    void window.api.workbench.mindmapSource(workspacePath, activeFilePath, title, true, kind && kind !== 'html' ? undefined : activeContent).then(result => {
      if (!alive) return
      if (!result.success) { setRecordState({ path: activeFilePath, record: null }); return }
      setRecordState({ path: activeFilePath, record: result.data ?? null })
    }).finally(() => { if (alive) setLoading(false) })
    // 外部修改导图（删除/重命名/同步）后按当前路径再查一次；create=false 防止被删后立刻复活。
    const off = window.api.onNotesChanged(() => {
      void window.api.workbench.mindmapSource(workspacePath, activeFilePath, title, false).then(result => {
        if (alive && result.success) setRecordState({ path: activeFilePath, record: result.data ?? null })
      })
    })
    return () => { alive = false; off() }
  }, [isVisible, workspacePath, activeFilePath, supported, hasRecordForActivePath])

  // 无 record 时按需建立并返回真实 id；已有 record 时直接复用。
  // 现在打开面板时已经建档，这里只兜底外部删除后第一次生成的边界情况。
  const ensureRecord = useCallback(async (): Promise<NoteConversation | null> => {
    const state = useWorkbenchStore.getState()
    const workspace = state.workspacePath
    const path = pathRef.current
    if (!workspace || !path) return null
    const title = path.split('/').pop() || path
    const kind = mindmapFileKindOfPath(path)
    const result = await window.api.workbench.mindmapSource(workspace, path, title, true, kind && kind !== 'html' ? undefined : state.activeFileContent)
    if (!result.success || !result.data) return null
    setRecordState({ path, record: result.data })
    return result.data
  }, [])

  // 文档来源对面板而言是「固定 id + 材料提供者」，不需要 webview 引用。
  // source.id 直接用 record.id（若已建档）；activeFilePath 兜底尚未建档的瞬时状态。
  const source = useMemo<MindmapSource | undefined>(() => {
    if (!activeFilePath) return undefined
    return {
      id: record?.id || activeFilePath,
      name: record?.title || activeFilePath.split('/').pop() || activeFilePath,
      getRef: () => null,
      resolveId: async () => {
        // 每次提交前按当前编辑器内容刷新记录：文本文档修改时，“带上来源文档”
        // 必须发送最新正文，不能复用面板打开时的旧快照。文件材料只会更新指纹。
        const created = await ensureRecord()
        if (!created) throw new Error('创建导图来源失败')
        return created.id
      }
    }
  }, [record?.id, record?.title, activeFilePath, ensureRecord])

  const materialProvider = useCallback(async (): Promise<MindmapMaterialRequest> => {
    const path = pathRef.current || ''
    const fileName = path.split('/').pop() || 'document'
    const state = useWorkbenchStore.getState()
    const selection = state.pendingMindmapSelection
    const workspace = state.workspacePath
    const kind = mindmapFileKindOfPath(path)
    const wantsFile = !!kind && !selection?.text.trim()
    // HTML 是可编辑文本：先落盘，保证上传的是用户当前看到的版本，而不是旧磁盘内容。
    if (wantsFile && kind === 'html' && state.isDirty) {
      const saved = await state.saveActiveFile()
      if (!saved.saved) throw new Error('文档保存失败，未上传')
    }
    // 首次生成时才落记录，后续刷新沿用同一条来源。
    if (workspace && path) {
      const created = await ensureRecord()
      if (!created) throw new Error('创建导图来源失败')
    }
    // PDF/Word/PPT/HTML 不经过文本提取，直接上传原文件；选区只用于文本格式。
    if (wantsFile) {
      return {
        fileName,
        kind,
        workspaceRoot: workspace || undefined,
        relativePath: path,
        scope: { scope: 'document', contentHash: '' }
      }
    }
    const content = documentText(state.activeFileContent)
    if (selection?.text.trim()) {
      return {
        text: selection.text.trim(),
        fileName: `selection-${fileName}`,
        kind: 'selection',
        scope: { scope: 'selection', contentHash: '', selectionText: selection.text.trim(), headingPath: selection.headingPath }
      }
    }
    return { text: content, fileName, kind: 'document', scope: { scope: 'document', contentHash: '' } }
  }, [ensureRecord])

  const fileSyncHooks = useMemo<MindmapFileSyncHooks | undefined>(() => {
    if (!workspacePath || !activeFilePath) return undefined
    return {
      workspaceRoot: workspacePath,
      relativePath: activeFilePath,
      refresh: async () => {
        const result = await window.api.workbench.mindmapFileStatus(workspacePath, activeFilePath)
        return result.success ? result.data! : null
      },
      revealFile: async (mindmapId) => {
        const result = await window.api.workbench.mindmapFileReveal(workspacePath, activeFilePath, mindmapId)
        return !!result.success
      }
    }
  }, [workspacePath, activeFilePath])

  // 切换文档时丢弃旧选区，避免把上一段的选中内容带到下一篇。
  useEffect(() => {
    setPendingSelection(null)
  }, [activeFilePath, setPendingSelection])

  if (!workspacePath || !activeFilePath) {
    return <div className="w-full h-full flex items-center justify-center p-6 text-body text-text-secondary">打开一篇文档后即可生成思维导图</div>
  }
  if (!supported) {
    return <div className="w-full h-full flex items-center justify-center p-6 text-body text-text-secondary">该格式暂不支持生成思维导图</div>
  }
  // 文件来源没有可编辑正文；有选区时按文本片段生成，没有选区才上传原文件。
  if (loading && !record) {
    return <div className="w-full h-full flex items-center justify-center text-body text-text-secondary">正在载入…</div>
  }

  // 隐藏态切到新文档时，不新建或挂载新的导图子面板，避免子组件被动触发 create=true 建档。
  if (!isVisible && recordState.path !== activeFilePath) {
    return <div className="w-full h-full" />
  }

  return (
    <MindmapVisibilityContext.Provider value={isVisible}>
      <div className="w-full min-w-0 h-full flex flex-col min-h-0">
        <div className="flex-1 min-h-0">
          <ConversationMindmapPanel
            key={activeFilePath}
            source={source}
            conversation={record ?? undefined}
            variant="document"
            materialProvider={materialProvider}
            onClose={closeRightPane}
            fileSyncHooks={fileSyncHooks}
            selectionPreview={selectionPreview}
            onSelectionGenerated={clearSelection}
          />
        </div>
      </div>
    </MindmapVisibilityContext.Provider>
  )
}

export default memo(WorkbenchMindmapPanel)
