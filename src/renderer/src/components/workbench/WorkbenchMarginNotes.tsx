import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAnnotationStore } from '../../store/annotationStore'
import type { Annotation } from '../../../../shared/types/annotations'
import { findMarkDom, removeMarkById } from './workbenchAnnotationUtils'
import { AppIcon } from '../icons/AppIcon'

function formatTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>
}

export default function WorkbenchMarginNotes({ stageRef }: Props): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const workspacePath = useWorkbenchStore(s => s.workspacePath)
  const activeFilePath = useWorkbenchStore(s => s.activeFilePath)
  const saveActiveFile = useWorkbenchStore(s => s.saveActiveFile)
  const showMarginNotes = useWorkbenchStore(s => s.showMarginNotes)
  const toggleMarginNotes = useWorkbenchStore(s => s.toggleMarginNotes)

  const documentAnnotations = useAnnotationStore(s => s.documentAnnotations)
  const sourceAnnotations = useAnnotationStore(s => s.sourceAnnotations)
  const selectedId = useAnnotationStore(s => s.selectedId)
  const setSelected = useAnnotationStore(s => s.setSelected)
  const upsertLocal = useAnnotationStore(s => s.upsertLocal)
  const removeLocal = useAnnotationStore(s => s.removeLocal)

  const allNotes = useMemo(() => {
    return [...documentAnnotations, ...sourceAnnotations]
  }, [documentAnnotations, sourceAnnotations])

  const [positions, setPositions] = useState<Map<string, number>>(new Map())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftComment, setDraftComment] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const cardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())

  // 监听外部触发的编辑请求（例如刚划词新建了标注）
  useEffect(() => {
    const handleStartEdit = (event: CustomEvent<{ id: string }>): void => {
      const id = event.detail?.id
      if (!id) return
      const target = allNotes.find(item => item.id === id)
      if (target) {
        setEditingId(id)
        setDraftComment(target.comment || '')
        setSelected(id)
      }
    }
    window.addEventListener('workbench:annotation-edit', handleStartEdit as EventListener)
    return () => {
      window.removeEventListener('workbench:annotation-edit', handleStartEdit as EventListener)
    }
  }, [allNotes, setSelected])

  // 测量与避让布局计算
  const computeLayout = useCallback((): void => {
    if (!stageRef.current || allNotes.length === 0) {
      setPositions(new Map())
      return
    }

    const stageRect = stageRef.current.getBoundingClientRect()
    const itemsWithDesired = allNotes.map(item => {
      const dom = findMarkDom(editor, item.id)
      let desiredTop = 30
      if (dom) {
        const domRect = dom.getBoundingClientRect()
        desiredTop = Math.max(0, domRect.top - stageRect.top)
      }
      return { item, desiredTop }
    })

    // 按期望垂直位置升序排序
    itemsWithDesired.sort((a, b) => a.desiredTop - b.desiredTop)

    const nextPositions = new Map<string, number>()
    const CARD_GAP = 10
    let currentBottom = 0

    for (const { item, desiredTop } of itemsWithDesired) {
      let finalTop = desiredTop
      if (finalTop < currentBottom) {
        finalTop = currentBottom
      }
      nextPositions.set(item.id, finalTop)

      const cardEl = cardElementsRef.current.get(item.id)
      const height = cardEl ? cardEl.offsetHeight : 64
      currentBottom = finalTop + height + CARD_GAP
    }

    setPositions(nextPositions)
  }, [allNotes, editor, stageRef])

  // 当标注更新、编辑器变化或窗口缩放时重算
  useLayoutEffect(() => {
    computeLayout()
  }, [computeLayout, editingId])

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      requestAnimationFrame(() => computeLayout())
    })
  }, [computeLayout, editor])

  useEffect(() => {
    window.addEventListener('resize', computeLayout)
    return () => window.removeEventListener('resize', computeLayout)
  }, [computeLayout])

  // 激活标注联动滚动
  const handleSelectNote = (id: string): void => {
    setSelected(id)
    const dom = findMarkDom(editor, id)
    if (dom) {
      try {
        dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {
        // ignore
      }
    }
  }

  // 保存就地修改
  const handleSaveComment = async (id: string, text: string): Promise<void> => {
    const annotation = allNotes.find(item => item.id === id)
    if (!annotation) return
    const nextComment = text.trim()
    const next: Annotation = { ...annotation, comment: nextComment, updatedAt: Date.now() }
    upsertLocal(next)
    setEditingId(null)

    if (next.scope === 'document') {
      if (workspacePath && activeFilePath) {
        await saveActiveFile()
        await window.api.annotations.upsertDocument(workspacePath, activeFilePath, next)
      }
    } else if (next.source) {
      await window.api.annotations.upsertSource(next.source.key, next.source, next)
    }
  }

  // 直接删除标注
  const handleDeleteNote = async (event: React.MouseEvent, item: Annotation): Promise<void> => {
    event.stopPropagation()
    if (busyId) return
    setBusyId(item.id)
    try {
      if (item.scope === 'document') {
        if (workspacePath && activeFilePath) {
          await window.api.annotations.deleteDocument(workspacePath, activeFilePath, item.id)
        }
      } else if (item.source) {
        await window.api.annotations.deleteSource(item.source.key, item.id)
      }
      removeLocal(item.id)
      removeMarkById(editor, item.id)
      if (editingId === item.id) {
        setEditingId(null)
      }
    } finally {
      setBusyId(null)
    }
  }

  // 如果用户选择隐藏旁注栏，则仅显示轻量图钉开关
  if (!showMarginNotes) {
    return (
      <div className="w-8 shrink-0 flex flex-col items-center pt-2">
        <button
          type="button"
          onClick={toggleMarginNotes}
          className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={`展开旁注便签 (${allNotes.length})`}
        >
          <AppIcon name="annotation" size={17} />
          {allNotes.length > 0 && (
            <span className="block text-[10px] text-amber-600 font-semibold">{allNotes.length}</span>
          )}
        </button>
      </div>
    )
  }

  return (
    <aside
      className="w-[260px] shrink-0 relative min-h-full select-none"
      aria-label="文档原位旁注"
    >
      {/* 顶部极简标题与折叠开关 */}
      <div className="flex items-center justify-between pb-2 mb-2 text-xs font-medium text-text-secondary border-b border-black/5 dark:border-white/5">
        <span className="flex items-center gap-1.5">
          <AppIcon name="annotation" size={14} className="text-amber-500" />
          <span>旁注便签</span>
          {allNotes.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
              {allNotes.length}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={toggleMarginNotes}
          className="p-1 text-[11px] rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary/70 hover:text-text-primary"
          title="隐藏旁注"
        >
          <AppIcon name="close" size={13} />
        </button>
      </div>

      {allNotes.length === 0 && (
        <div className="pt-8 text-center text-xs text-text-secondary/50 leading-relaxed px-2">
          选中文本后点击“标注”<br />注释将直接停靠在文字右侧
        </div>
      )}

      {/* 原位便签卡片列表 */}
      {allNotes.map(item => {
        const top = positions.get(item.id) ?? 0
        const isSelected = selectedId === item.id
        const isEditing = editingId === item.id

        return (
          <div
            key={item.id}
            ref={el => {
              if (el) cardElementsRef.current.set(item.id, el)
              else cardElementsRef.current.delete(item.id)
            }}
            style={{ top: `${top}px` }}
            onClick={() => handleSelectNote(item.id)}
            className={`absolute left-0 w-full rounded-lg border text-left transition-all duration-200 cursor-pointer ${
              isSelected
                ? 'border-amber-400 bg-amber-50/90 shadow-md ring-2 ring-amber-400/30 dark:bg-amber-950/30 dark:border-amber-500/60'
                : 'border-amber-200/70 bg-amber-50/50 hover:bg-amber-50/80 hover:border-amber-300 dark:bg-amber-950/15 dark:border-amber-500/20 dark:hover:border-amber-500/40'
            } border-l-[3.5px] border-l-amber-500 p-2.5 z-10`}
          >
            {isEditing ? (
              <div onClick={e => e.stopPropagation()} className="space-y-2">
                <textarea
                  autoFocus
                  value={draftComment}
                  onChange={e => setDraftComment(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleSaveComment(item.id, draftComment)
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingId(null)
                    }
                  }}
                  className="w-full h-18 resize-none rounded border border-amber-300 bg-white/90 p-1.5 text-xs text-text-primary outline-none focus:border-amber-500 dark:bg-gray-900/90 dark:border-amber-600/50"
                  placeholder="写下你的注释笔记 (Enter 保存)..."
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary/60">Enter 保存 / Esc 取消</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-2 py-0.5 text-[11px] rounded text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveComment(item.id, draftComment)}
                      className="px-2.5 py-0.5 text-[11px] rounded bg-amber-500 hover:bg-amber-600 text-white font-medium shadow-xs"
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {/* 便签注释正文：点击可就地编辑 */}
                <div
                  className="text-xs leading-relaxed text-text-primary break-words whitespace-pre-wrap hover:text-amber-900 dark:hover:text-amber-200"
                  title="点击可编辑注释"
                  onClick={e => {
                    e.stopPropagation()
                    setEditingId(item.id)
                    setDraftComment(item.comment || '')
                    setSelected(item.id)
                  }}
                >
                  {item.comment ? (
                    item.comment
                  ) : (
                    <span className="text-text-secondary/50 italic">点击添加注释...</span>
                  )}
                </div>

                {/* 底部信息与操作条 */}
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-secondary/60">
                  <span>{formatTime(item.updatedAt || item.createdAt)}</span>
                  <div className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        setEditingId(item.id)
                        setDraftComment(item.comment || '')
                        setSelected(item.id)
                      }}
                      className="p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30 text-text-secondary hover:text-text-primary"
                      title="编辑注释"
                    >
                      <AppIcon name="edit" size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={e => void handleDeleteNote(e, item)}
                      className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/40 text-text-secondary hover:text-rose-600"
                      title="删除注释"
                    >
                      <AppIcon name="delete" size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}
