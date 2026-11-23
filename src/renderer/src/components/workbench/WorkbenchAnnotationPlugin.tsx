import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $createRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  SKIP_SELECTION_FOCUS_TAG,
  SELECTION_CHANGE_COMMAND,
  $setSelection,
  type ElementNode,
  type LexicalCommand,
  type LexicalNode,
  type TextNode
} from 'lexical'
import { $createMarkNode, $isMarkNode } from '@lexical/mark'
import type { Annotation } from '../../../../shared/types/annotations'
import { buildAnchorAt, resolveAnchors } from '../../../../shared/utils/annotationAnchors'
import { readConversationSource } from '../../../../shared/utils/conversationSource'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAnnotationStore } from '../../store/annotationStore'
import AnnotationCommentCard from '../AnnotationCommentCard'
import { serializeWorkbenchMarkdown } from './MarkdownSyncPlugin'
import { allMarks, markAtTarget, unwrapAllMarks, unwrapMark } from './workbenchAnnotationUtils'

export const WORKBENCH_ANNOTATE_COMMAND: LexicalCommand<void> = createCommand(
  'WORKBENCH_ANNOTATE_COMMAND'
)

// 标注投影和定位都是后台副作用，不能把焦点从评论输入框或弹层抢回正文。
const ANNOTATION_SYNC_TAGS = ['annotation-sync', SKIP_SELECTION_FOCUS_TAG]

interface TextSlice {
  node: TextNode
  start: number
  end: number
}

interface BlockText {
  block: ElementNode
  text: string
  slices: TextSlice[]
}

function collectBlockText(block: ElementNode): BlockText | null {
  const type = block.getType()
  if (type === 'code' || type === 'image' || type === 'html-table') return null
  const slices: TextSlice[] = []
  let text = ''
  const visit = (node: LexicalNode): void => {
    if ($isTextNode(node)) {
      const start = text.length
      text += node.getTextContent()
      slices.push({ node, start, end: text.length })
      return
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  block.getChildren().forEach(visit)
  return { block, text, slices }
}

function collectDocumentText(): { text: string; blocks: BlockText[] } {
  const blocks: BlockText[] = []
  const textParts: string[] = []
  for (const child of $getRoot().getChildren()) {
    if (!$isElementNode(child)) continue
    const block = collectBlockText(child)
    if (!block) continue
    blocks.push(block)
    textParts.push(block.text)
  }
  return { text: textParts.join('\n'), blocks }
}

/** 把纯文本偏移映射成 Lexical 选区并滚动到可见区域。 */
function selectOffset(start: number, end: number): boolean {
  const { blocks } = collectDocumentText()
  let cursor = 0
  for (const block of blocks) {
    const blockStart = cursor
    const blockEnd = cursor + block.text.length
    if (start >= blockStart && start < blockEnd) {
      const localStart = start - blockStart
      const localEnd = Math.min(block.text.length, Math.max(localStart + 1, end - blockStart))
      const sliceAt = (offset: number): TextSlice | null =>
        block.slices.find(slice => slice.start <= offset && offset < slice.end) ?? null
      const anchorSlice = sliceAt(localStart)
      const focusSlice = sliceAt(localEnd - 1)
      if (!anchorSlice || !focusSlice) return false
      const selection = $createRangeSelection()
      selection.anchor.set(anchorSlice.node.getKey(), localStart - anchorSlice.start, 'text')
      selection.focus.set(focusSlice.node.getKey(), localEnd - focusSlice.start, 'text')
      $setSelection(selection)
      return true
    }
    cursor = blockEnd + 1
  }
  return false
}

/**
 * 把纯文本偏移映射回 TextNode 并包 MarkNode。
 * 跨 block、已重叠或落在代码/图片/HTML 表格内时返回失败原因。
 */
function wrapRange(
  start: number,
  end: number,
  id: string,
  blocks: BlockText[]
): { ok: boolean; reason?: 'cross-block' | 'overlap' | 'empty' | 'not-found' } {
  let cursor = 0
  for (const block of blocks) {
    const blockStart = cursor
    const blockEnd = cursor + block.text.length
    if (start >= blockStart && end <= blockEnd) {
      const localStart = start - blockStart
      const localEnd = end - blockStart
      if (localStart === localEnd) return { ok: false, reason: 'empty' }
      const targets: TextNode[] = []
      for (const slice of block.slices) {
        const from = Math.max(localStart, slice.start)
        const to = Math.min(localEnd, slice.end)
        if (from >= to) continue
        let target = slice.node
        if (from > slice.start) {
          const parts = target.splitText(from - slice.start)
          target = parts[1] ?? target
        }
        const length = to - from
        if (target.getTextContentSize() > length) {
          const parts = target.splitText(length)
          target = parts[0]
        }
        if (!$isTextNode(target) || !target.getTextContentSize()) continue
        if ($isMarkNode(target.getParent())) return { ok: false, reason: 'overlap' }
        targets.push(target)
      }
      if (!targets.length) return { ok: false, reason: 'not-found' }
      for (const target of targets) {
        const mark = $createMarkNode([id])
        target.replace(mark)
        mark.append(target)
      }
      return { ok: true }
    }
    cursor = blockEnd + 1
  }
  return { ok: false, reason: 'cross-block' }
}

function cleanMarkNodes(validIds: Set<string>, complete: boolean): void {
  for (const mark of allMarks()) {
    const ids = mark.getIDs().filter(Boolean)
    if (!ids.length) {
      unwrapMark(mark)
      continue
    }
    // 同一条标注可能跨多个 TextNode，每个片段都是独立 MarkNode。
    // 这里只能去掉单个 MarkNode 内的重复 id，不能跨节点去重，否则只保留第一段。
    const unique = [...new Set(ids)]
    if (unique.length !== ids.length) {
      mark.setIDs(unique)
    }
    // 两路标注都加载完成前不清理未知 id，避免把异步到达的 source 投影删掉。
    if (complete && !unique.every(id => validIds.has(id))) unwrapMark(mark)
  }
}

interface CommentPopover {
  id: string
  /** 打开评论卡时所属文档；切换文档后旧卡片不得先渲染一帧。 */
  documentKey: string
  quote: string
  left: number
  top: number
  mode: 'create' | 'edit'
}

export default function WorkbenchAnnotationPlugin({
  anchorElem
}: {
  anchorElem?: HTMLElement | null
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const workspacePath = useWorkbenchStore(s => s.workspacePath)
  const activeFilePath = useWorkbenchStore(s => s.activeFilePath)
  const activeFileContent = useWorkbenchStore(s => s.activeFileContent)
  const editorMode = useWorkbenchStore(s => s.editorMode)
  const saveActiveFile = useWorkbenchStore(s => s.saveActiveFile)
  const selectedId = useAnnotationStore(s => s.selectedId)
  const documentAnnotations = useAnnotationStore(s => s.documentAnnotations)
  const sourceAnnotations = useAnnotationStore(s => s.sourceAnnotations)
  const [popover, setPopover] = useState<CommentPopover | null>(null)
  const [comment, setComment] = useState('')
  const popoverRef = useRef<CommentPopover | null>(null)
  popoverRef.current = popover
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef<{ document: boolean; source: boolean; token: number }>({
    document: false,
    source: false,
    token: 0
  })
  const importedRef = useRef<{ token: number; version: number }>({ token: 0, version: 0 })
  const appliedRef = useRef<{ token: number; version: number }>({ token: 0, version: -1 })

  const sourceKey = readConversationSource(activeFileContent)?.sourceKey ?? null
  const documentKey = `${workspacePath ?? ''}\n${activeFilePath ?? ''}`

  /** 撤回尚未保存的新建标注：去掉旁路记录和正文里的临时标记。 */
  const discardDraft = useCallback(
    (id: string): void => {
      useAnnotationStore.getState().removeLocal(id)
      editor.update(
        () => {
          for (const mark of allMarks()) {
            if (!mark.hasID(id)) continue
            if (mark.getIDs().length > 1) mark.deleteID(id)
            else unwrapMark(mark)
          }
        },
        { tag: ANNOTATION_SYNC_TAGS, discrete: true }
      )
    },
    [editor]
  )

  // 正文切换后，旧的浮层坐标和评论草稿不能再指向新文档。
  // 提交阶段同步丢弃，避免旧评论卡在新文档上先渲染一帧再消失。
  if (popoverRef.current && popoverRef.current.documentKey !== documentKey) {
    popoverRef.current = null
  }
  useEffect(() => {
    setPopover(null)
    setComment('')
  }, [documentKey])

  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 2800)
  }, [])

  useEffect(() => () => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
  }, [])

  const applyAnnotations = useCallback((): void => {
    const state = useAnnotationStore.getState()
    if (state.workspaceRoot !== workspacePath || state.relativePath !== activeFilePath) return
    if (!readyRef.current.document || !readyRef.current.source) return
    const token = state.token
    if (readyRef.current.token !== token) return
    if (importedRef.current.token !== token) return
    if (appliedRef.current.token === token && appliedRef.current.version === importedRef.current.version) return

    const annotations = [...state.documentAnnotations, ...state.sourceAnnotations]
    const before = serializeWorkbenchMarkdown(editor)

    const unlocated: string[] = []
    editor.update(
      () => {
        // 先移除旧投影，再按当前锚点完整重绘。只清理无效 id 会让仍然有效、
        // 但文本已移动或跨多个 TextNode 的旧 MarkNode 停在错误范围。
        unwrapAllMarks()
        // 一次收集文本与 TextNode 切片，后续标注只做偏移映射，避免每条标注重走整棵节点树。
        const { text, blocks } = collectDocumentText()
        const resolved = resolveAnchors(text, annotations)
        for (const annotation of annotations) {
          const hit = resolved.find(item => item.id === annotation.id)
          if (!hit) {
            unlocated.push(annotation.id)
            continue
          }
          const wrapped = wrapRange(hit.start, hit.end, annotation.id, blocks)
          if (!wrapped.ok) {
            // 重叠只表示这条投影暂不显示；找不到或跨 block 才是未定位。
            if (wrapped.reason === 'cross-block' || wrapped.reason === 'not-found') {
              unlocated.push(annotation.id)
            }
          }
        }
      },
      // 标注投影是后台副作用；失焦对账时若让 Lexical 同步选区焦点，
      // 会把正在编辑的评论 textarea 焦点抢回正文。
      { tag: ANNOTATION_SYNC_TAGS, discrete: true }
    )

    const after = serializeWorkbenchMarkdown(editor)
    if (after !== before) {
      editor.update(() => unwrapAllMarks(), {
        tag: ANNOTATION_SYNC_TAGS,
        discrete: true
      })
      console.error('[Annotation] 应用标注改变了 Markdown 序列化结果，已撤销本次应用')
      showHint('标注未能安全应用，正文保持不变')
      return
    }
    appliedRef.current = { token, version: importedRef.current.version }
    useAnnotationStore.getState().setUnlocated(unlocated, token)
  }, [activeFilePath, editor, showHint, workspacePath])

  // 标注增删改后重新投影：删除要清掉正文残留，评论保存和撤销重做要重算未定位。
  useEffect(() => {
    if (editorMode !== 'wysiwyg') return
    const token = useAnnotationStore.getState().token
    importedRef.current = { token, version: importedRef.current.version + 1 }
    applyAnnotations()
  }, [documentAnnotations, sourceAnnotations, editorMode, applyAnnotations])

  // 文档切换：并行拉取 document 与 source 两路标注。
  useEffect(() => {
    if (!workspacePath || !activeFilePath || editorMode !== 'wysiwyg') return
    const token = useAnnotationStore.getState().token + 1
    useAnnotationStore.getState().resetForDocument(workspacePath, activeFilePath, sourceKey)
    readyRef.current = { document: false, source: !sourceKey, token }
    importedRef.current = { token, version: -1 }
    appliedRef.current = { token, version: -1 }
    void window.api.annotations
      .listDocument(workspacePath, activeFilePath)
      .then(result => {
        if (readyRef.current.token !== token) return
        if (result.success && result.data) {
          useAnnotationStore.getState().setDocumentAnnotations(result.data, token)
        } else if (result.error) {
          useAnnotationStore.getState().setError(result.error)
        }
        readyRef.current.document = true
        useAnnotationStore.getState().setLoading(false)
        applyAnnotations()
      })
      .catch(() => {
        if (readyRef.current.token !== token) return
        readyRef.current.document = true
        useAnnotationStore.getState().setLoading(false)
      })
    if (sourceKey) {
      void window.api.annotations
        .listSource(sourceKey)
        .then(result => {
          if (readyRef.current.token !== token) return
          if (result.success && result.data) {
            useAnnotationStore.getState().setSourceAnnotations(result.data.annotations, token)
          } else if (result.error) {
            // source 读取失败时跳过清理，保留现有投影，等默认库恢复后再对账。
            useAnnotationStore.getState().setError(result.error)
            return
          }
          readyRef.current.source = true
          applyAnnotations()
        })
        .catch(() => {
          if (readyRef.current.token !== token) return
          useAnnotationStore.getState().setError('原文标注读取失败')
        })
    }
  }, [workspacePath, activeFilePath, sourceKey, editorMode, applyAnnotations])

  // 会话端删除/修改 source 标注后，文档里的投影必须重新读取并移除。
  // 文档标注也可能被另一个窗口修改，这里一并刷新。
  useEffect(() => {
    if (!workspacePath || !activeFilePath) return
    const off = window.api.annotations.onChanged(event => {
      if (
        event.scope === 'document' &&
        event.workspaceRoot === workspacePath &&
        event.relativePath === activeFilePath
      ) {
        const token = useAnnotationStore.getState().token
        void window.api.annotations
          .listDocument(workspacePath, activeFilePath)
          .then(result => {
            if (result.success && result.data) {
              useAnnotationStore.getState().setDocumentAnnotations(result.data, token)
            }
          })
        return
      }
      if (event.scope === 'source' && sourceKey && event.sourceKey === sourceKey) {
        const token = useAnnotationStore.getState().token
        void window.api.annotations
          .listSource(sourceKey)
          .then(result => {
            if (result.success && result.data) {
              useAnnotationStore.getState().setSourceAnnotations(result.data.annotations, token)
            }
          })
      }
    })
    return off
  }, [workspacePath, activeFilePath, sourceKey])

  // 由 MarkdownSyncPlugin 在正文导入完成时通知；先有正文，后有标注。
  useEffect(() => {
    const handler = (): void => {
      const state = useAnnotationStore.getState()
      if (state.workspaceRoot !== workspacePath || state.relativePath !== activeFilePath) return
      importedRef.current = {
        token: state.token,
        version: importedRef.current.token === state.token ? importedRef.current.version + 1 : 0
      }
      // 正文刚替换时 Lexical 尚未提交新的 DOM 和节点树，必须等下一帧再包标注，
      // 否则旧文档的标记会被套到新正文上或直接丢失。
      requestAnimationFrame(() => applyAnnotations())
    }
    window.addEventListener('workbench:markdown-imported', handler)
    return () => window.removeEventListener('workbench:markdown-imported', handler)
  }, [workspacePath, activeFilePath, applyAnnotations])

  // 侧栏卡片（或正文点击）选中后，定位并滚动到对应文本。
  useEffect(() => {
    if (!selectedId) return
    // 窄屏旁注入口已自行滚动定位；这里再建选区会让浮动格式条停在评论卡上方。
    if (document.querySelector('[data-margin-notes-mode="compact"]')) return
    const annotation = [
      ...useAnnotationStore.getState().documentAnnotations,
      ...useAnnotationStore.getState().sourceAnnotations
    ].find(item => item.id === selectedId)
    if (!annotation) return
    let located = false
    editor.update(
      () => {
        const { text } = collectDocumentText()
        const hit = resolveAnchors(text, [annotation])[0]
        if (hit) located = selectOffset(hit.start, hit.end)
      },
      { tag: ANNOTATION_SYNC_TAGS, discrete: true }
    )
    if (!located) return
    requestAnimationFrame(() => {
      // rAF 已离开 update/read 上下文，不能直接遍历 Lexical 节点。
      const childKey = editor.getEditorState().read(() => {
        const mark = allMarks().find(item => item.hasID(selectedId))
        return mark?.getChildren()[0]?.getKey() ?? null
      })
      if (!childKey) return
      const dom = editor.getElementByKey(childKey)
      if (!dom) return
      try {
        dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {
        // 容器尚未布局完成时忽略
      }
    })
  }, [editor, selectedId])

  // 每次 update 清理重复 id、零 id 和跨文档粘贴的无效 id。
  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ tags }) => {
        if (tags.has('sync-external') || tags.has('annotation-sync')) return
        const state = useAnnotationStore.getState()
        const complete = readyRef.current.document && readyRef.current.source
        const valid = new Set(
          [...state.documentAnnotations, ...state.sourceAnnotations].map(item => item.id)
        )
        editor.update(() => cleanMarkNodes(valid, complete), {
          tag: ANNOTATION_SYNC_TAGS,
          discrete: true
        })
      }),
      editor.registerCommand(SELECTION_CHANGE_COMMAND, () => false, COMMAND_PRIORITY_LOW)
    )
  }, [editor])

  // 编辑器失焦 / 切换文档 / 关闭前：重算 document 标注的 quote 与上下文。
  // 只动 document 标注；source 投影的 anchor 不随文档编辑变化。
  useEffect(() => {
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null
    const reconcile = (): void => {
      if (reconcileTimer) clearTimeout(reconcileTimer)
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null
        const state = useAnnotationStore.getState()
        if (!workspacePath || !activeFilePath) return
        if (state.workspaceRoot !== workspacePath || state.relativePath !== activeFilePath) return
        const documentAnnotations = state.documentAnnotations
        if (!documentAnnotations.length) return
        const next = editor.getEditorState().read(() => {
          const { text } = collectDocumentText()
          const resolved = resolveAnchors(text, documentAnnotations)
          return resolved.map(hit => {
            const annotation = documentAnnotations.find(item => item.id === hit.id)
            if (!annotation) return null
            return {
              ...annotation,
              quote: text.slice(hit.start, hit.end),
              anchor: buildAnchorAt(text, hit.start, hit.end)
            }
          }).filter((item): item is Annotation => Boolean(item))
        })
        if (!next.length) return
        void saveActiveFile().then(saved => {
          if (!saved.saved) return
          void window.api.annotations.reconcileDocument(
            workspacePath,
            activeFilePath,
            next.map(item => ({ id: item.id, quote: item.quote, anchor: item.anchor }))
          ).then(result => {
            if (result.success) {
              for (const item of next) useAnnotationStore.getState().upsertLocal(item)
            }
          })
        })
      }, 400)
    }
    const root = editor.getRootElement()
    root?.addEventListener('blur', reconcile)
    window.addEventListener('beforeunload', reconcile)
    return () => {
      root?.removeEventListener('blur', reconcile)
      window.removeEventListener('beforeunload', reconcile)
      if (reconcileTimer) clearTimeout(reconcileTimer)
    }
  }, [editor, workspacePath, activeFilePath, saveActiveFile])

  // 浮动工具栏“标注”：单 block 选区 → MarkNode → 评论框。
  useEffect(() => {
    const create = (): boolean => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return false
      const anchorNode = selection.anchor.getNode()
      const focusNode = selection.focus.getNode()
      const block = anchorNode.getTopLevelElement()
      if (!block || block !== focusNode.getTopLevelElement()) {
        showHint('请选择单个段落内的正文文本')
        return true
      }
      const blockText = collectBlockText(block)
      if (!blockText) {
        showHint('代码块和图片不能标注')
        return true
      }
      const anchorSlice = blockText.slices.find(slice => slice.node === anchorNode)
      const focusSlice = blockText.slices.find(slice => slice.node === focusNode)
      if (!anchorSlice || !focusSlice) return false
      const from = anchorSlice.start + selection.anchor.offset
      const to = focusSlice.start + selection.focus.offset
      const start = Math.min(from, to)
      const end = Math.max(from, to)
      const quote = blockText.text.slice(start, end)
      if (!quote.trim()) return false
      const domSelection = editor.getRootElement()?.ownerDocument.getSelection()
      const rect = domSelection?.rangeCount ? domSelection.getRangeAt(0).getBoundingClientRect() : null
      const id = crypto.randomUUID()
      const now = Date.now()
      const annotation: Annotation = {
        id,
        scope: 'document',
        quote,
        anchor: buildAnchorAt(blockText.text, start, end),
        comment: '',
        createdAt: now,
        updatedAt: now
      }
      const wrapped = wrapRange(start, end, id, [blockText])
      if (!wrapped.ok) {
        showHint(
          wrapped.reason === 'cross-block'
            ? '请选择单个段落内的正文文本'
            : wrapped.reason === 'overlap'
              ? '该范围已有标注'
              : '无法创建标注'
        )
        return true
      }
      useAnnotationStore.getState().upsertLocal(annotation)
      useAnnotationStore.getState().setSelected(id)
      // 先弹评论卡，保存时才落盘；取消则撤回这条临时标注。
      if (rect && anchorElem) {
        const anchorRect = anchorElem.getBoundingClientRect()
        setPopover({
          id,
          documentKey,
          quote,
          left: Math.max(8, rect.left - anchorRect.left),
          top: rect.bottom - anchorRect.top + 8,
          mode: 'create'
        })
      } else {
        setPopover({ id, documentKey, quote, left: 8, top: 8, mode: 'create' })
      }
      setComment('')
      return true
    }
    return editor.registerCommand(WORKBENCH_ANNOTATE_COMMAND, create, COMMAND_PRIORITY_EDITOR)
  }, [editor, anchorElem, showHint, documentKey])

  const cancelPopover = useCallback(() => {
    if (!popover) return
    if (popover.mode !== 'create') {
      setPopover(null)
      setComment('')
      return
    }
    setPopover(null)
    setComment('')
    discardDraft(popover.id)
  }, [discardDraft, popover])

  // 点击浮层外部关闭；新建标注被取消时同时撤回尚未保存的空标注。
  useEffect(() => {
    if (!popover) return
    const handler = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editor.getRootElement()?.contains(target)) return
      if (target instanceof Element && target.closest('[data-annotation-popover]')) return
      cancelPopover()
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [cancelPopover, editor, popover])

  const commitComment = async (): Promise<void> => {
    if (!popover || !workspacePath || !activeFilePath) return
    const state = useAnnotationStore.getState()
    const annotation = [...state.documentAnnotations, ...state.sourceAnnotations].find(
      item => item.id === popover.id
    )
    if (!annotation) return
    const next: Annotation = { ...annotation, comment: comment.trim(), updatedAt: Date.now() }
    useAnnotationStore.getState().upsertLocal(next)
    setPopover(null)
    if (next.scope === 'document') {
      const saved = await saveActiveFile()
      if (!saved.saved) {
        showHint(saved.reason === 'oversized' ? '文档过大，标注未保存' : '正文未保存，标注未写入')
        return
      }
      const result = await window.api.annotations.upsertDocument(
        workspacePath,
        activeFilePath,
        next
      )
      if (!result.success) showHint(result.error || '标注保存失败')
      return
    }
    if (!next.source) {
      showHint('原文标注缺少来源信息')
      return
    }
    const result = await window.api.annotations.upsertSource(next.source.key, next.source, next)
    if (!result.success) showHint(result.error || '原文标注保存失败')
  }

  const openCommentCard = useCallback(
    (annotation: Annotation, clientX: number, clientY: number): void => {
      useAnnotationStore.getState().setSelected(annotation.id)
      const previous = popoverRef.current
      if (previous && previous.mode === 'create' && previous.id !== annotation.id) {
        discardDraft(previous.id)
      }
      const anchorRect = anchorElem?.getBoundingClientRect()
      const left = anchorRect
        ? Math.max(8, Math.min(clientX - anchorRect.left - 24, anchorRect.width - 328))
        : 8
      const top = anchorRect ? Math.max(8, clientY - anchorRect.top + 12) : 8
      setComment(annotation.comment)
      setPopover({
        id: annotation.id,
        documentKey,
        quote: annotation.quote,
        left,
        top,
        mode: 'edit'
      })
    },
    [anchorElem, discardDraft, documentKey]
  )

  /**
   * 点击正文里的高亮：命中标注就弹出同一个评论卡；点空白处先撤回
   * 尚未保存的新建标注，再关闭浮层，避免草稿残留。
   */
  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    const handler = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      const hit = editor.getEditorState().read(() => markAtTarget(editor, target))
      if (!hit) {
        const draft = popoverRef.current
        if (draft?.mode === 'create') discardDraft(draft.id)
        setPopover(null)
        setComment('')
        return
      }
      const state = useAnnotationStore.getState()
      const annotation = [...state.documentAnnotations, ...state.sourceAnnotations].find(
        item => item.id === hit
      )
      if (!annotation) return
      openCommentCard(annotation, event.clientX, event.clientY)
    }
    root.addEventListener('click', handler)
    return () => root.removeEventListener('click', handler)
  }, [discardDraft, editor, openCommentCard])

  // 窄屏旁注入口没有可点击的正文坐标，交给侧栏通过事件请求同一条评论卡
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{
        id?: string
        clientX?: number
        clientY?: number
      }>).detail
      if (!detail?.id) return

      const state = useAnnotationStore.getState()
      const annotation = [...state.documentAnnotations, ...state.sourceAnnotations].find(
        item => item.id === detail.id
      )
      if (!annotation) return
      openCommentCard(annotation, detail.clientX ?? 0, detail.clientY ?? 0)
    }
    window.addEventListener('workbench:annotation-open', handler)
    return () => window.removeEventListener('workbench:annotation-open', handler)
  }, [openCommentCard])

  const deletePopoverAnnotation = async (): Promise<void> => {
    if (!popover) return
    const state = useAnnotationStore.getState()
    const annotation = [...state.documentAnnotations, ...state.sourceAnnotations].find(
      item => item.id === popover.id
    )
    if (!annotation) {
      setPopover(null)
      setComment('')
      return
    }
    const message =
      annotation.scope === 'source'
        ? '删除后所有工作区的原文高亮都会消失，确定删除？'
        : '删除这条文档标注？正文中的标记会一起移除。'
    if (!window.confirm(message)) return
    if (annotation.scope === 'document') {
      if (!workspacePath || !activeFilePath) return
      const result = await window.api.annotations.deleteDocument(
        workspacePath,
        activeFilePath,
        annotation.id
      )
      if (!result.success) {
        showHint(result.error || '删除标注失败')
        return
      }
    } else {
      if (!annotation.source) {
        showHint('原文标注缺少来源信息')
        return
      }
      const result = await window.api.annotations.deleteSource(
        annotation.source.key,
        annotation.id
      )
      if (!result.success) {
        showHint(result.error || '删除原文标注失败')
        return
      }
    }
    useAnnotationStore.getState().removeLocal(annotation.id)
    setPopover(null)
    setComment('')
  }

  return (
    <>
      {hint && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs shadow-lg">
          {hint}
        </div>
      )}
      {popover &&
        popover.documentKey === documentKey &&
        anchorElem &&
        createPortal(
          <AnnotationCommentCard
            className="absolute z-50"
            style={{ left: popover.left, top: popover.top }}
            title={popover.mode === 'create' ? '标注' : '修改评论'}
            quote={popover.quote}
            value={comment}
            onChange={setComment}
            onCancel={cancelPopover}
            onSave={() => void commitComment()}
            saveLabel="保存标注"
            placeholder="添加评论…"
            footerStart={
              popover.mode === 'edit' ? (
                <button
                  type="button"
                  className="text-[11px] text-rose-500 hover:underline"
                  onClick={() => void deletePopoverAnnotation()}
                >
                  删除标注
                </button>
              ) : null
            }
          />,
          anchorElem
        )}
    </>
  )
}
