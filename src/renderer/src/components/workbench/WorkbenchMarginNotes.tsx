import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { createPortal } from 'react-dom'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAnnotationStore } from '../../store/annotationStore'
import type { Annotation } from '../../../../shared/types/annotations'
import { isUnresolvedAnchorState } from '../../../../shared/utils/annotationAnchors'
import { WORKBENCH_REANCHOR_COMMAND } from './WorkbenchAnnotationPlugin'
import { resolveSourceConversation } from '../../utils/noteSourceConversation'
import { useAppStore } from '../../store/appStore'
import { findMarkDom, removeMarkById } from './workbenchAnnotationUtils'
import { AppIcon } from '../icons/AppIcon'

const MARGIN_NOTES_WIDTH = 220
const MARGIN_NOTES_MIN_WIDTH = 170
const MARGIN_NOTES_GAP = 16
const ANNOTATION_CLEANUP_THRESHOLD = 400

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
  const resolutionById = useAnnotationStore(s => s.resolutionById)
  const models = useAppStore(s => s.models)
  const openConversationInAiSidebar = useWorkbenchStore(s => s.openConversationInAiSidebar)
  const setSelected = useAnnotationStore(s => s.setSelected)
  const upsertLocal = useAnnotationStore(s => s.upsertLocal)
  const removeLocal = useAnnotationStore(s => s.removeLocal)

  // 文档切换的同一帧里 store 仍可能持有上一份文档的标注；
  // 不按身份过滤会让旧卡片先渲染一帧，表现为切文档时闪烁。
  const annotationsReady =
    annotationsWorkspaceRoot === workspacePath && annotationsRelativePath === activeFilePath
  const allNotes = useMemo(() => {
    if (!annotationsReady) return []
    return [...documentAnnotations, ...sourceAnnotations].filter(
      item => !isUnresolvedAnchorState(resolutionById[item.id]?.state)
    )
  }, [annotationsReady, documentAnnotations, sourceAnnotations, resolutionById])

  const unresolvedDocumentNotes = useMemo(() => {
    if (!annotationsReady) return []
    return documentAnnotations.filter(item => isUnresolvedAnchorState(resolutionById[item.id]?.state))
  }, [annotationsReady, documentAnnotations, resolutionById])

  const unresolvedSourceNotes = useMemo(() => {
    if (!annotationsReady) return []
    return sourceAnnotations.filter(item => isUnresolvedAnchorState(resolutionById[item.id]?.state))
  }, [annotationsReady, sourceAnnotations, resolutionById])

  const unresolvedDocumentIds = useMemo(
    () => unresolvedDocumentNotes.map(item => item.id),
    [unresolvedDocumentNotes]
  )

  const [positions, setPositions] = useState<Map<string, number>>(new Map())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftComment, setDraftComment] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showCleanup, setShowCleanup] = useState(false)
  const [cleanupIds, setCleanupIds] = useState<string[]>([])
  const [showCompactUnresolved, setShowCompactUnresolved] = useState(false)
  const [compactMode, setCompactMode] = useState(false)
  const [notesBox, setNotesBox] = useState<{ left: number; width: number } | null>(null)
  const [anchorBox, setAnchorBox] = useState<{ marginTop: number; left: number } | null>(null)
  const [headerBox, setHeaderBox] = useState<{ left: number; top: number } | null>(null)
  const [asideEl, setAsideEl] = useState<HTMLElement | null>(null)
  const [editorRootEl, setEditorRootEl] = useState<HTMLElement | null>(null)
  const [unresolvedPanelHeight, setUnresolvedPanelHeight] = useState(0)
  const unresolvedPanelRef = useRef<HTMLDivElement | null>(null)
  const cardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  // 没有任何旁注时不渲染入口与栏头，避免空白控件常驻正文首行。
  const unresolvedCount = unresolvedDocumentNotes.length + unresolvedSourceNotes.length
  const totalCount = allNotes.length + unresolvedCount
  const documentAnnotationCount = annotationsReady ? documentAnnotations.length : 0
  const showAnchorTrigger = totalCount > 0 && (compactMode || !showMarginNotes)
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

  const handleToggleMarginNotes = useCallback((): void => {
    toggleMarginNotes()
  }, [toggleMarginNotes])

  // 正文固定居中，旁注只使用右侧留白；留白不足时退出布局，避免挤压正文。
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const syncLayout = (): void => {
      const article = stage.querySelector<HTMLElement>('[data-workbench-article]')
      if (!article) return
      const stageRect = stage.getBoundingClientRect()
      const content = article.querySelector<HTMLElement>('[contenteditable="true"]')
      // 以正文右边缘为基准：正文居中后，旁注只占用其右侧留白。
      const textRight = (content ?? article).getBoundingClientRect().right
      const left = Math.round(textRight - stageRect.left + MARGIN_NOTES_GAP)
      const available = Math.round(stageRect.width - left - 8)
      // 右侧留白足够时用满栏宽，不足时按可用宽度收窄但仍保持可读。
      const next = available < MARGIN_NOTES_MIN_WIDTH
      const width = next
        ? MARGIN_NOTES_MIN_WIDTH
        : Math.min(MARGIN_NOTES_WIDTH, available)
      setCompactMode(previous => (previous === next ? previous : next))
      // 窄屏只显示折叠入口，入口停在正文右缘外侧，不再用栏宽撑出布局。
      setNotesBox({ left, width })
    }

    syncLayout()
    const observer = new ResizeObserver(syncLayout)
    observer.observe(stage)
    const article = stage.querySelector<HTMLElement>('[data-workbench-article]')
    if (article) observer.observe(article)
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
      const content = article.querySelector<HTMLElement>('[contenteditable="true"]')
      const firstLine = (content?.firstElementChild as HTMLElement | null) ?? content ?? article
      const lineRect = firstLine.getBoundingClientRect()
      const textRight = (content ?? article).getBoundingClientRect().right
      setAnchorBox({
        marginTop: Math.max(0, Math.round(lineRect.top - stageRect.top)),
        left: compactMode
          ? Math.max(8, Math.min(stage.clientWidth - 64, Math.round(textRight - stageRect.left + 8)))
          : Math.max(0, Math.round(textRight - stageRect.left + MARGIN_NOTES_GAP))
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
      // 栏头与旁注列同左缘，展开/收起时横向位置保持一致。
      setHeaderBox({
        left: Math.max(0, Math.round(asideEl.getBoundingClientRect().left - editorRect.left)),
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
    setShowCompactUnresolved(false)
  }, [activeFilePath])

  useEffect(() => {
    if (unresolvedCount === 0) setShowCompactUnresolved(false)
  }, [unresolvedCount])

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
    // 未解决面板绝对定位在 aside 顶部，不占文档流；卡片必须从它的底部开始，
    // 否则第一条已定位卡片会被面板盖住。
    const panelBottom = unresolvedPanelHeight > 0 ? unresolvedPanelHeight + CARD_GAP : 0
    let currentBottom = 0

    for (const { item, desiredTop } of located) {
      let finalTop = Math.max(desiredTop, panelBottom)
      if (finalTop < currentBottom) {
        finalTop = currentBottom
      }
      nextPositions.set(item.id, finalTop)

      const cardEl = cardElementsRef.current.get(item.id)
      const height = cardEl ? cardEl.offsetHeight : 64
      currentBottom = finalTop + height + CARD_GAP
    }

    setPositions(nextPositions)
  }, [allNotes, compactMode, editor, showMarginNotes, stageRef, unresolvedPanelHeight])

  // 面板高度会随“清理未解决”展开和未解决条目增减变化，用 ResizeObserver 跟随。
  useLayoutEffect(() => {
    const element = unresolvedPanelRef.current
    if (!element) {
      setUnresolvedPanelHeight(0)
      return
    }
    const sync = (): void => setUnresolvedPanelHeight(element.offsetHeight)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    return () => observer.disconnect()
  }, [compactMode, showCleanup, showMarginNotes, unresolvedCount])

  // 当标注更新、编辑器变化或窗口缩放时重算
  useLayoutEffect(() => {
    computeLayout()
  }, [computeLayout, editingId])

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      // 标注投影走 annotation-sync 更新，MarkNode 落到 DOM 后才能测到位置；
      // 统一在下一帧重算，避免停留在"找不到锚点"的旧状态。
      requestAnimationFrame(() => {
        computeLayout()
      })
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
        const saved = await saveActiveFile()
        if (!saved.saved) {
          upsertLocal(annotation)
          setEditingId(id)
          window.alert(saved.reason === 'oversized' ? '文档过大，注释未保存' : '正文未保存，注释未写入')
          return
        }
        const result = await window.api.annotations.updateDocumentComment(
          workspacePath,
          activeFilePath,
          next.id,
          next.comment,
          annotation.updatedAt
        )
        if (!result.success) {
          upsertLocal(annotation)
          setEditingId(id)
          window.alert(result.error || '注释保存失败')
          return
        }
        upsertLocal(result.data ?? next)
      }
    } else if (next.source) {
      const result = await window.api.annotations.updateSourceComment(
        next.source.key,
        next.id,
        next.comment,
        annotation.updatedAt
      )
      if (!result.success) {
        upsertLocal(annotation)
        setEditingId(id)
        window.alert(result.error || '注释保存失败')
        return
      }
      upsertLocal(result.data ?? next)
    } else {
      upsertLocal(annotation)
      setEditingId(id)
      window.alert('原文标注缺少来源信息')
    }
  }

  // 直接删除标注
  const handleDeleteNote = async (event: React.MouseEvent, item: Annotation): Promise<void> => {
    event.stopPropagation()
    if (busyId) return
    if (item.scope === 'document' && !window.confirm('删除这条标注？')) return
    if (item.scope === 'source' && !window.confirm('删除原文标注会删除所有工作区里的原文高亮。')) return
    setBusyId(item.id)
    try {
      let result: { success: boolean; error?: string } = { success: true }
      if (item.scope === 'document') {
        if (workspacePath && activeFilePath) {
          result = await window.api.annotations.deleteDocument(workspacePath, activeFilePath, item.id)
        }
      } else if (item.source) {
        result = await window.api.annotations.deleteSource(item.source.key, item.id)
      }
      if (!result.success) {
        window.alert(result.error || '删除注释失败')
        return
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

  const openCleanup = useCallback((): void => {
    setCleanupIds(unresolvedDocumentIds)
    setShowCleanup(true)
  }, [unresolvedDocumentIds])

  const cleanupUnresolved = async (): Promise<void> => {
    if (!workspacePath || !activeFilePath || busyId) return
    const ids = [...new Set(cleanupIds)]
    if (!ids.length) {
      setShowCleanup(false)
      return
    }
    if (!window.confirm(`删除选中的 ${ids.length} 条未解决文档注释？`)) return
    const failed: string[] = []
    for (const id of ids) {
      setBusyId(id)
      try {
        const result = await window.api.annotations.deleteDocument(
          workspacePath,
          activeFilePath,
          id
        )
        if (result.success) {
          removeLocal(id)
          removeMarkById(editor, id)
        } else {
          failed.push(id)
        }
      } catch {
        failed.push(id)
      }
    }
    setBusyId(null)
    setCleanupIds(failed)
    if (failed.length) {
      window.alert(`${failed.length} 条未解决注释删除失败，已保留在列表中`)
    } else {
      setShowCleanup(false)
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
        title={`${compactMode ? '打开' : '展开'}注释 (${totalCount})${unresolvedCount ? `，未解决 ${unresolvedCount}` : ''}`}
        aria-label={`${compactMode ? '打开' : '展开'}注释，共 ${totalCount} 条，未解决 ${unresolvedCount} 条`}
      >
        <AppIcon name="annotation" size={16} />
        <span className="text-xs font-semibold">{allNotes.length}</span>
        {unresolvedCount > 0 && (
          <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
            · {unresolvedCount}
          </span>
        )}
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

  const unresolvedPanel =
    unresolvedCount > 0 ? (
      <div
        ref={unresolvedPanelRef}
        className="rounded-lg border border-rose-500/30 border-l-[3px] border-l-rose-500/70 bg-white p-2.5 text-left shadow-sm dark:bg-gray-800 dark:border-rose-400/30 dark:border-l-rose-400/60"
      >
        <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          未解决 {unresolvedCount}
          {unresolvedDocumentNotes.length > 0 && (
            <button
              type="button"
              onClick={openCleanup}
              className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-normal text-rose-600/80 hover:bg-rose-100 dark:text-rose-400/80 dark:hover:bg-rose-900/40"
            >
              清理未解决
            </button>
          )}
        </div>
        {showCleanup && (
          <div className="mt-1.5 rounded-md border border-rose-500/20 bg-rose-50/60 p-1.5 text-[11px] dark:bg-rose-950/20">
            {unresolvedDocumentNotes.map(item => (
              <label key={item.id} className="flex items-start gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={cleanupIds.includes(item.id)}
                  onChange={event => {
                    setCleanupIds(previous =>
                      event.target.checked
                        ? [...new Set([...previous, item.id])]
                        : previous.filter(id => id !== item.id)
                    )
                  }}
                  className="mt-0.5"
                />
                <span className="line-clamp-2 break-words text-text-secondary">
                  {item.originalQuote || item.quote}
                </span>
              </label>
            ))}
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCleanup(false)}
                className="rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!cleanupIds.length || Boolean(busyId)}
                onClick={() => void cleanupUnresolved()}
                className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                删除
              </button>
            </div>
          </div>
        )}
        <div className="mt-1.5 space-y-1.5">
          {unresolvedDocumentNotes.map(item => {
            const resolution = resolutionById[item.id]
            return (
              <div
                key={item.id}
                className="rounded-md bg-rose-50/70 p-1.5 text-[11px] dark:bg-rose-950/30"
              >
                <div className="line-through decoration-rose-400/60 break-words text-text-secondary/70">
                  {item.originalQuote || item.quote}
                </div>
                <div className="mt-0.5 break-words text-text-primary">{item.comment || '点击添加注释...'}</div>
                <div className="mt-0.5 text-rose-600/90 dark:text-rose-400/90">
                  {resolution?.reason === 'cross-block'
                    ? '跨段落暂不支持'
                    : resolution?.reason === 'overlap'
                      ? '与另一条注释重叠'
                      : resolution?.state === 'ambiguous'
                        ? '存在多处相似文字'
                        : '原文未找到'}
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    // 重新定位读取的是正文当前选区；按下按钮不能把焦点从编辑器抢走。
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => editor.dispatchCommand(WORKBENCH_REANCHOR_COMMAND, item.id)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-40"
                  >
                    重新定位
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={event => void handleDeleteNote(event, item)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-100 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-900/40"
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
          {unresolvedSourceNotes.map(item => {
            const resolution = resolutionById[item.id]
            const sourceTarget = item.source
              ? resolveSourceConversation(item.source.url, models)
              : null
            return (
              <div
                key={item.id}
                className="rounded-md bg-amber-50/70 p-1.5 text-[11px] dark:bg-amber-950/30"
              >
                <div className="line-through decoration-amber-400/60 break-words text-text-secondary/70">
                  {item.originalQuote || item.quote}
                </div>
                <div className="mt-0.5 break-words text-text-primary">{item.comment || '点击添加注释...'}</div>
                <div className="mt-0.5 text-amber-700/90 dark:text-amber-400/90">
                  {resolution?.reason === 'overlap'
                    ? '与另一条注释重叠；原文高亮仍有效'
                    : '文档投影未找到；原文高亮仍有效'}
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (sourceTarget) {
                        openConversationInAiSidebar(sourceTarget.platformId, sourceTarget.url)
                      } else if (item.source?.url) {
                        window.open(item.source.url, '_blank', 'noopener,noreferrer')
                      }
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                  >
                    打开原文
                  </button>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event('workbench:markdown-imported'))}
                    className="rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    刷新投影
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={event => void handleDeleteNote(event, item)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-100 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-900/40"
                  >
                    删除原文标注
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    ) : null

  if (compactMode || !showMarginNotes) {
    if (!anchorBox || totalCount === 0) return null
    return (
      <>
        <div className="absolute inset-0 z-30 no-drag pointer-events-none select-none">
          <div
            className="sticky pointer-events-auto w-fit"
            style={{ top: '8px', marginTop: `${anchorBox.marginTop}px`, marginLeft: `${anchorBox.left}px` }}
          >
            <div className="flex flex-col items-end gap-2">
              {anchorTrigger}
              {unresolvedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCompactUnresolved(previous => !previous)}
                  className="h-7 rounded-md border border-rose-500/30 bg-white/95 px-2 text-[11px] font-semibold text-rose-600 shadow-sm hover:bg-rose-50 dark:border-rose-400/30 dark:bg-gray-800/95 dark:text-rose-400"
                >
                  未解决 {unresolvedCount}
                </button>
              )}
              {showCompactUnresolved && unresolvedPanel && (
                <div className="pointer-events-auto w-[320px] max-h-[60vh] overflow-y-auto">
                  {unresolvedPanel}
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  // 展开态但没有旁注：不渲染占宽的旁注列与空白栏头。
  if (totalCount === 0) return null
  // 首次测量完成前不渲染，避免旁注列在默认 left=0 处闪一帧。
  if (!notesBox) return null

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
                  {totalCount}
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
        className="absolute top-0 min-h-full select-none"
        style={{
          left: `${notesBox?.left ?? 0}px`,
          width: `${notesBox?.width ?? MARGIN_NOTES_WIDTH}px`
        }}
        aria-label="文档原位旁注"
      >
      {totalCount === 0 && (
        <div className="pt-8 text-center text-xs text-text-secondary/50 leading-relaxed px-2">
          选中文本后点击“标注”<br />注释将直接停靠在文字右侧
        </div>
      )}

      {documentAnnotationCount >= ANNOTATION_CLEANUP_THRESHOLD && (
        <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-50/80 p-2 text-[11px] text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300">
          当前文档标注 {documentAnnotationCount} 条，建议清理未解决注释
        </div>
      )}

      {unresolvedPanel && (
        <div className="absolute left-0 w-full z-10">{unresolvedPanel}</div>
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
