import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { readConversationSource } from '../../../../shared/utils/conversationSource'
import { resolveSourceConversation } from '../../utils/noteSourceConversation'
import { AppIcon } from '../icons/AppIcon'

const WINDOWS_INVALID_CHARS = /[\\/:*?"<>|]/

/**
 * Obsidian 式文档标题栏：预览区顶部显示文件名（去扩展名），
 * 点击进入行内重命名；Enter/blur 提交、Esc 取消。
 * 提交前先落盘清 dirty，再调 renameNode（含 assets 目录联动）。
 */
export default function WorkbenchTitleBar(): JSX.Element | null {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const renameNode = useWorkbenchStore((s) => s.renameNode)
  const openConversationInAiSidebar = useWorkbenchStore((s) => s.openConversationInAiSidebar)
  const models = useAppStore((s) => s.models)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const conversationSource = useMemo(
    () => (activeFileContent ? readConversationSource(activeFileContent) : null),
    [activeFileContent]
  )
  const sourceTarget = useMemo(
    () => (conversationSource ? resolveSourceConversation(conversationSource.url, models) : null),
    [conversationSource, models]
  )

  const fileName = activeFilePath?.split('/').pop() ?? ''
  const dotIdx = fileName.lastIndexOf('.')
  const baseName = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : ''

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  // 切文件时退出编辑态
  useEffect(() => {
    setEditing(false)
  }, [activeFilePath])

  if (!activeFilePath) return null

  const startEdit = (): void => {
    setDraft(baseName)
    setEditing(true)
  }

  const commit = async (): Promise<void> => {
    const next = draft.trim()
    if (!next || next === baseName) {
      setEditing(false)
      return
    }
    if (WINDOWS_INVALID_CHARS.test(next)) {
      useWorkbenchStore.setState({ error: '文件名不能包含 \\ / : * ? " < > |' })
      setEditing(false)
      return
    }

    setBusy(true)
    try {
      // 脏内容先落盘，避免 autosave 用旧路径覆盖磁盘上的新文件
      if (isDirty) {
        const saved = await saveActiveFile()
        if (!saved.saved) return
      }

      const parent = activeFilePath.includes('/')
        ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/'))
        : ''
      const newPath = parent ? `${parent}/${next}${ext}` : `${next}${ext}`
      const ok = await renameNode(activeFilePath, newPath)
      if (ok) setEditing(false)
      // 失败时 store 已 set error；编辑态保留，让用户看到当前输入
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2 select-none" data-workbench-title="true">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-full bg-transparent text-title-lg font-bold leading-tight text-text-primary border-b border-primary/60 focus:outline-none focus:border-primary placeholder:text-gray-400/60"
          placeholder="文件名"
          aria-label="重命名文档"
        />
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={startEdit}
            title="点击重命名"
            className="min-w-0 flex-1 text-left text-title-lg font-bold leading-tight text-text-primary hover:bg-gray-100/60 dark:hover:bg-gray-800/40 rounded-md -mx-1 px-1 transition-colors truncate"
          >
            {baseName}
          </button>
          {sourceTarget && (
            <button
              type="button"
              onClick={() =>
                openConversationInAiSidebar(sourceTarget.platformId, sourceTarget.url)
              }
              title="在侧边栏查看原文"
              aria-label="在侧边栏查看原文"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
            >
              <AppIcon name="forum" size={19} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
