import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { createPortal } from 'react-dom'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAnnotationStore } from '../../store/annotationStore'
import type { Annotation } from '../../../../shared/types/annotations'
import { allMarks, findMarkDom, removeMarkById } from './workbenchAnnotationUtils'
import { AppIcon } from '../icons/AppIcon'

const COMPACT_MARGIN_NOTES_WIDTH = 960

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
  const annotationsRelativePath = useAnnotationStore(s => s.relativePath)
  const annotationsWorkspaceRoot = useAnnotationStore(s => s.workspaceRoot)
  const unlocatedIds = useAnnotationStore(s => s.unlocatedIds)
  const setSelected = useAnnotationStore(s => s.setSelected)
  const upsertLocal = useAnnotationStore(s => s.upsertLocal)
  const removeLocal = useAnnotationStore(s => s.removeLocal)

  // 文档切换的同一帧里 store 仍可能持有上一份文档的标注；
  // 不按身份过滤会让旧卡片先渲染一帧，表现为切文档时闪烁。
  const annotationsReady =
    annotationsWorkspaceRoot === workspacePath && annotationsRelativePath === activeFilePath
  const allNotes = useMemo(() => {
    if (!annotationsReady) return []
    // 正文里已找不到锚点的标注（例如原文被删掉）不再计入旁注数量与列表，
    // 否则清空正文后仍会残留"1 条注释"。
    const unlocated = new Set(unlocatedIds)
    return [...documentAnnotations, ...sourceAnnotations].filter(item => !unlocated.has(item.id))
  }, [annotationsReady, documentAnnotations, sourceAnnotations, unlocatedIds])

  const [positions, setPositions] = useState<Map<string, number>>(new Map())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftComment, setDraftComment] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [compactMode, setCompactMode] = useState(false)
  const [anchorBox, setAnchorBox] = useState<{ marginTop: number; left: number } | null>(null)
  const [headerBox, setHeaderBox] = useState<{ left: number; top: number } | null>(null)
  const [asideEl, setAsideEl] = useState<HTMLElement | null>(null)
  const [editorRootEl, setEditorRootEl] = useState<HTMLElement | null>(null)
  const cardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  // 展开/收起 aside 会撑开 flex 行使 stage 高度重排，滚动容器随之漂移；
  // 记录切换前的 scrollTop，在布局稳定后恢复，避免"展开跳回顶部"。
  const pendingScrollTopRef = useRef<number | null>(null)
  // 没有任何旁注时不渲染入口与栏头，避免空白控件常驻正文首行。
  const showAnchorTrigger = allNotes.length > 0 && (compactMode || !showMarginNotes)
  const orderedNotes = useMemo(
    () =>
      [...allNotes].sort(
        (a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      ),
    [allNotes, positions]
  )
  const activeNoteIndex = useMemo(
    () => orderedNotes.findIndex(item => item.id === selectedId),
    [orderedNotes, selectedId]
  )

  const scrollerOf = useCallback((): HTMLElement | null => {
    return (
      stageRef.current
        ?.closest<HTMLElement>('[data-workbench-editor="true"]')
        ?.querySelector<HTMLElement>('.overflow-y-auto') ?? null
    )
  }, [stageRef])

  const handleToggleMarginNotes = useCallback((): void => {
    pendingScrollTopRef.current = scrollerOf()?.scrollTop ?? null
    toggleMarginNotes()
  }, [scrollerOf, toggleMarginNotes])

  // aside 挂载/卸载后 flex 行高度重排完成时恢复 scrollTop
  useLayoutEffect(() => {
    const target = pendingScrollTopRef.current
    if (target == null) return
    pendingScrollTopRef.current = null
    const scroller = scrollerOf()
    if (!scroller) return
    // 等两帧，让 aside 的 min-h-full 与卡片绝对定位完成布局
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (Math.abs(scroller.scrollTop - target) > 1) {
          scroller.scrollTop = target
        }
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [showMarginNotes, scrollerOf])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const syncMode = (): void => {
      const next = stage.clientWidth < COMPACT_MARGIN_NOTES_WIDTH
      setCompactMode(previous => (previous === next ? previous : next))
    }

    syncMode()
    const observer = new ResizeObserver(syncMode)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [stageRef])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.dataset.marginNotesMode = compactMode ? 'compact' : 'wide'
    return () => {
      delete stage.dataset.marginNotesMode
    }
  }, [compactMode, stageRef])

  // 折叠入口用 position:sticky：初始 marginTop 对齐正文首行，滚动越过后
  // 由合成器原生吸附在 scroller 视口顶部，无 JS 测量延迟，避免"先跟动再回顶"。
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || !showAnchorTrigger) {
      setAnchorBox(null)
      return
    }
    const article = stage.querySelector<HTMLElement>('[data-workbench-article]')
    if (!article) return

    const measure = (): void => {
      const stageRect = stage.getBoundingClientRect()
      const articleRect = article.getBoundingClientRect()
      const content = article.querySelector<HTMLElement>('[contenteditable="true"]')
      const firstLine = (content?.firstElementChild as HTMLElement | null) ?? content ?? article
      const lineRect = firstLine.getBoundingClientRect()
      setAnchorBox({
        marginTop: Math.max(0, Math.round(lineRect.top - stageRect.top)),
        left: compactMode
          ? Math.max(8, stage.clientWidth - 64)
          : Math.max(0, Math.round(articleRect.right - stageRect.left + 24))
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(article)
    const content = article.querySelector<HTMLElement>('[contenteditable="true"]')
    if (content) observer.observe(content)
    const scroller = stage.closest<HTMLElement>('[data-workbench-editor="true"]')
      ?.querySelector<HTMLElement>('.overflow-y-auto')
    scroller?.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      scroller?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [stageRef, showAnchorTrigger, compactMode, allNotes.length, activeFilePath])

  // 展开态栏头复用折叠入口的吸附位置：折叠入口用 sticky 贴在视口顶部，
  // 展开后栏头出现在同一水平/垂直位置，而不是跳到编辑器最顶端。
  useLayoutEffect(() => {
    const stage = stageRef.current
    const editorRoot =
      stage?.closest<HTMLElement>('[data-workbench-editor="true"]') ?? null
    setEditorRootEl(editorRoot)
    if (!stage || !editorRoot || compactMode || !showMarginNotes || !asideEl) {
      setHeaderBox(null)
      return
    }

    const measure = (): void => {
      const scroller = editorRoot.querySelector<HTMLElement>('.overflow-y-auto')
      if (!scroller) return
      const editorRect = editorRoot.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const article = stage.querySelector<HTMLElement>('[data-workbench-article]')
      const content = article?.querySelector<HTMLElement>('[contenteditable="true"]')
      const firstLine = (content?.firstElementChild as HTMLElement | null) ?? content ?? article
      const lineRect = firstLine?.getBoundingClientRect()
      // 与折叠入口一致：首行在视口内时跟随首行，越过视口顶部后吸附。
      const firstLineTop = lineRect ? Math.round(lineRect.top - editorRect.top) : 8
      const stickyTop = Math.round(scrollerRect.top - editorRect.top + 8)
      // 水平基准与折叠入口相同（正文右边缘 + 24），切换时栏头不会横向跳动。
      const articleRect = article?.getBoundingClientRect()
      setHeaderBox({
        left: Math.max(
          0,
          Math.round(
            (articleRect ? articleRect.right + 24 : asideEl.getBoundingClientRect().left) -
              editorRect.left
          )
        ),
        top: Math.max(stickyTop, firstLineTop)
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    observer.observe(asideEl)
    const scroller = stage
      .closest<HTMLElement>('[data-workbench-editor="true"]')
      ?.querySelector<HTMLElement>('.overflow-y-auto')
    scroller?.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      scroller?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [stageRef, compactMode, showMarginNotes, activeFilePath, asideEl])

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

  // 切文档时丢弃上一份文档的就地编辑草稿
  useEffect(() => {
    setEditingId(null)
    setDraftComment('')
  }, [activeFilePath])

  // 测量与避让布局计算
  // 折叠态也持续维护 positions：否则展开首帧 positions 为空、卡片 top=0
  // 会全部堆在 aside 顶部（文档开头）闪一帧才归位。
  const computeLayout = useCallback((): void => {
    if (!stageRef.current || allNotes.length === 0) {
      setPositions(new Map())
      return
    }

    const stageRect = stageRef.current.getBoundingClientRect()
    const headerOffset = 44
    const itemsWithDesired = allNotes.map(item => {
      const dom = findMarkDom(editor, item.id)
      // 找不到正文锚点时不给卡片位置，避免落到文档顶部形成"卡片跑到最上面"。
      if (!dom) return { item, desiredTop: null }
      const domRect = dom.getBoundingClientRect()
      // aside 与正文同处文档流，卡片用文档坐标定位即可随滚动自然跟随。
      return { item, desiredTop: Math.max(headerOffset, domRect.top - stageRect.top) }
    })

    const located = itemsWithDesired.filter(
      (entry): entry is { item: (typeof allNotes)[number]; desiredTop: number } =>
        entry.desiredTop !== null
    )
    // 按期望垂直位置升序排序
    located.sort((a, b) => a.desiredTop - b.desiredTop)

    const nextPositions = new Map<string, number>()
    const CARD_GAP = 10
    let currentBottom = 0

    for (const { item, desiredTop } of located) {
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
  }, [allNotes, compactMode, editor, showMarginNotes, stageRef])

  // 窄屏下把旁注序号写到正文 MarkNode，宽屏时移除，避免影响原位旁注列
  const syncMarkIndexes = useCallback((): void => {
    const indexById = new Map(allNotes.map((note, index) => [note.id, index + 1]))
    editor.getEditorState().read(() => {
      for (const mark of allMarks()) {
        const markIndex = mark
          .getIDs()
          .map(id => indexById.get(id))
          .filter((index): index is number => index !== undefined)
          .sort((a, b) => a - b)[0]

        const dom = editor.getElementByKey(mark.getKey()) as HTMLElement | null
        if (!dom) continue
        if (compactMode && markIndex) {
          dom.dataset.annotationIndex = String(markIndex)
        } else {
          delete dom.dataset.annotationIndex
        }
      }
    })
  }, [allNotes, compactMode, editor])

  // 当标注更新、编辑器变化或窗口缩放时重算
  useLayoutEffect(() => {
    computeLayout()
    syncMarkIndexes()
  }, [computeLayout, editingId, syncMarkIndexes])

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      // 标注投影走 annotation-sync 更新，MarkNode 落到 DOM 后才能测到位置；
      // 统一在下一帧重算，避免停留在"找不到锚点"的旧状态。
      requestAnimationFrame(() => {
        computeLayout()
        syncMarkIndexes()
      })
    })
  }, [computeLayout, editor, syncMarkIndexes])

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

  const handleNavigateNote = (direction: -1 | 1): void => {
    if (!orderedNotes.length) return
    const nextIndex =
      activeNoteIndex === -1
        ? direction === 1
          ? 0
          : orderedNotes.length - 1
        : (activeNoteIndex + direction + orderedNotes.length) % orderedNotes.length
    handleSelectNote(orderedNotes[nextIndex].id)
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

  // 窄屏入口复用正文标注的评论卡：定位到当前标注后打开同一编辑浮层
  const handleOpenCompactNote = useCallback((): void => {
    const targetId =
      selectedId && allNotes.some(item => item.id === selectedId)
        ? selectedId
        : allNotes[0]?.id
    if (!targetId) return

    const dom = findMarkDom(editor, targetId)
    if (!dom) return
    try {
      dom.scrollIntoView({ block: 'center' })
    } catch {
      // ignore
    }

    requestAnimationFrame(() => {
      const rect = dom.getBoundingClientRect()
      window.dispatchEvent(
        new CustomEvent('workbench:annotation-open', {
          detail: {
            id: targetId,
            clientX: rect.left + Math.min(rect.width / 2, 120),
            clientY: rect.bottom
          }
        })
      )
    })
  }, [allNotes, editor, selectedId])

  // 折叠入口：跟随正文第一行并在越过首行后吸附到视口顶部
  const anchorTrigger = (
    <div className="flex items-center gap-1 h-9 rounded-lg border border-black/10 bg-white/95 dark:bg-gray-800/95 dark:border-white/10 shadow-sm pl-1.5 pr-1 select-none">
      <button
        type="button"
        onClick={compactMode ? handleOpenCompactNote : handleToggleMarginNotes}
        className="h-7 px-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:bg-amber-500/10 dark:hover:bg-amber-400/10 flex items-center gap-1 transition-colors"
        title={`${compactMode ? '打开' : '展开'}注释 (${allNotes.length})`}
        aria-label={`${compactMode ? '打开' : '展开'}注释，共 ${allNotes.length} 条`}
      >
        <AppIcon name="annotation" size={16} />
        <span className="text-xs font-semibold">{allNotes.length}</span>
      </button>
      {!compactMode && orderedNotes.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => handleNavigateNote(-1)}
            className="h-7 w-6 rounded-md text-text-secondary/70 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
            title="上一条注释"
            aria-label="上一条注释"
          >
            <AppIcon name="keyboard_arrow_up" size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleNavigateNote(1)}
            className="h-7 w-6 rounded-md text-text-secondary/70 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
            title="下一条注释"
            aria-label="下一条注释"
          >
            <AppIcon name="keyboard_arrow_down" size={14} />
          </button>
        </>
      )}
    </div>
  )

  if (compactMode || !showMarginNotes) {
    if (!anchorBox || allNotes.length === 0) return null
    return (
      <>
        <div className="absolute inset-0 z-30 no-drag pointer-events-none select-none">
          <div
            className="sticky pointer-events-auto w-fit"
            style={{ top: '8px', marginTop: `${anchorBox.marginTop}px`, marginLeft: `${anchorBox.left}px` }}
          >
            {anchorTrigger}
          </div>
        </div>
        {/* 折叠时保留旁注列宽度占位，避免展开/收起时正文与控件横向跳动。 */}
        {!compactMode && <aside className="w-[260px] shrink-0" aria-hidden="true" />}
      </>
    )
  }

  // 展开态但没有旁注：不渲染占宽的旁注列与空白栏头。
  if (allNotes.length === 0) return null

  return (
    <>
      {headerBox &&
        editorRootEl &&
        createPortal(
          <div
            data-margin-notes-header="true"
            className="absolute z-30 select-none"
            style={{ left: `${headerBox.left}px`, top: `${headerBox.top}px` }}
          >
            <div className="flex items-center gap-1 h-9 rounded-lg border border-black/10 bg-white/95 dark:bg-gray-800/95 dark:border-white/10 shadow-sm pl-1.5 pr-1">
              <button
                type="button"
                onClick={handleToggleMarginNotes}
                className="h-7 px-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:bg-amber-500/10 dark:hover:bg-amber-400/10 flex items-center gap-1 transition-colors"
                title="收起注释"
                aria-label="收起注释"
              >
                <AppIcon name="annotation" size={16} />
                <span className="text-xs font-semibold">注释</span>
                <span className="text-xs font-semibold text-amber-600/70 dark:text-amber-400/70">
                  {allNotes.length}
                </span>
              </button>
              <div className="flex items-center gap-0.5">
                {orderedNotes.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleNavigateNote(-1)}
                      className="h-7 w-6 rounded-md text-text-secondary/70 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                      title="上一条注释"
                      aria-label="上一条注释"
                    >
                      <AppIcon name="keyboard_arrow_up" size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNavigateNote(1)}
                      className="h-7 w-6 rounded-md text-text-secondary/70 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                      title="下一条注释"
                      aria-label="下一条注释"
                    >
                      <AppIcon name="keyboard_arrow_down" size={14} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleToggleMarginNotes}
                  className="h-7 w-6 rounded-md text-text-secondary/70 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                  title="隐藏注释"
                  aria-label="隐藏注释"
                >
                  <AppIcon name="close" size={13} />
                </button>
              </div>
            </div>
          </div>,
          editorRootEl
        )}

      <aside
        ref={setAsideEl}
        className="w-[260px] shrink-0 relative min-h-full select-none"
        aria-label="文档原位旁注"
      >
      {allNotes.length === 0 && (
        <div className="pt-8 text-center text-xs text-text-secondary/50 leading-relaxed px-2">
          选中文本后点击“标注”<br />注释将直接停靠在文字右侧
        </div>
      )}

      {/* 原位便签卡片列表 */}
      {allNotes.map(item => {
        const top = positions.get(item.id)
        // 正文里找不到锚点的标注不渲染卡片，避免堆在顶部。
        if (top === undefined) return null
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
            className={`absolute left-0 w-full rounded-lg border border-black/10 border-l-[3px] border-l-amber-500/60 bg-white text-left shadow-sm transition-all duration-200 cursor-pointer dark:border-white/10 dark:border-l-amber-500/50 ${
              isSelected
                ? 'shadow-md ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/15'
                : 'hover:shadow-md dark:bg-gray-800'
            } p-2.5 z-10`}
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
                  className="w-full h-18 resize-none rounded-lg border border-black/10 bg-white p-2 text-xs text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:bg-gray-900 dark:border-white/10"
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
                      className="px-2.5 py-0.5 text-[11px] rounded-lg bg-primary hover:bg-primary/90 text-white font-medium shadow-xs"
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
                  className="text-[13px] leading-relaxed text-text-primary break-words whitespace-pre-wrap"
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
                      className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary"
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
    </>
  )
}
