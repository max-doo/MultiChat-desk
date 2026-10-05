import { useCallback, useEffect, useState } from 'react'
import type { NoteConversation } from '../../../shared/types/notes'
import { MindmapEditor } from './ConversationMindmapPanel'

const LEGACY_KEY = 'multichat_local_mindmap_markdown'

export default function StandaloneMindmapPanel({ onOpenMubu }: { onOpenMubu: () => void }): JSX.Element {
  const [conversation, setConversation] = useState<NoteConversation | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    const result = await window.api.notesForSource('local-mindmap-legacy')
    if (!result.success) { setError(result.error || '读取本地导图失败'); return }
    setConversation(result.data || null)
  }, [])
  useEffect(() => {
    let active = true
    const initialize = async (): Promise<void> => {
      let saved: string | null = null
      try { saved = localStorage.getItem(LEGACY_KEY) } catch { /* 旧存储不可用时仍可打开主进程导图。 */ }
      const result = await window.api.notesStandalone(saved || undefined)
      if (!active) return
      if (!result.success || !result.data) { setError(result.error || '初始化本地导图失败'); return }
      if (saved && result.data.mindmaps.some(map => map.markdown === saved)) {
        try { if (localStorage.getItem(LEGACY_KEY) === saved) localStorage.removeItem(LEGACY_KEY) } catch { /* 迁入内容已保存，下次可重试清理。 */ }
      }
      setConversation(result.data)
    }
    void initialize().catch(() => { if (active) setError('初始化本地导图失败，请重新打开') })
    const off = window.api.onNotesChanged(() => { if (active) void reload() })
    return () => { active = false; off() }
  }, [reload])
  const map = conversation?.mindmaps[0]
  if (!conversation || !map) return <div className="p-4 text-sm text-text-secondary">{error || '正在载入本地导图…'}</div>
  return <MindmapEditor key={map.id} conversationId={conversation.id} map={map} onReload={() => void reload()}
    controls={<button className="px-2 py-1 text-sm text-text-secondary hover:text-primary" onClick={onOpenMubu}>打开幕布</button>}
    notice={error && <span className="text-sm text-red-600">{error}</span>} />
}
