import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $addUpdateTag,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $createRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  HISTORIC_TAG,
  SKIP_SELECTION_FOCUS_TAG,
  SELECTION_CHANGE_COMMAND,
  $setSelection,
  type ElementNode,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
  type TextNode
} from 'lexical'
import { $createMarkNode, $isMarkNode, MarkNode } from '@lexical/mark'
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationAnchorReason,
  AnnotationAnchorState,
  DocumentResolution
} from '../../../../shared/types/annotations'
import {
  buildAnchorAt,
  compactAnnotationText,
  compactWithOffsets,
  resolveAnnotationAnchors,
  resolveAnchors
} from '../../../../shared/utils/annotationAnchors'
import { readConversationSource } from '../../../../shared/utils/conversationSource'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAnnotationStore } from '../../store/annotationStore'
import AnnotationCommentCard from '../AnnotationCommentCard'
import { serializeWorkbenchMarkdown } from './MarkdownSyncPlugin'
import { allMarks, markAtTarget, unwrapAllMarks, unwrapMark } from './workbenchAnnotationUtils'

export const WORKBENCH_ANNOTATE_COMMAND: LexicalCommand<void> = createCommand(
  'WORKBENCH_ANNOTATE_COMMAND'
)

export const WORKBENCH_REANCHOR_COMMAND: LexicalCommand<string> = createCommand(
  'WORKBENCH_REANCHOR_COMMAND'
)

// 标注投影和定位都是后台副作用，不能把焦点从评论输入框或弹层抢回正文。
const ANNOTATION_SYNC_TAGS = ['annotation-sync', HISTORIC_TAG, SKIP_SELECTION_FOCUS_TAG]

interface TextSlice {
  node: TextNode
  start: number
  end: number
}

interface BlockText {
  block: ElementNode
  text: string
  slices: TextSlice[]
  start: number
  end: number
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
  return { block, text, slices, start: 0, end: 0 }
}

function collectDocumentText(): { text: string; blocks: BlockText[] } {
  const blocks: BlockText[] = []
  for (const child of $getRoot().getChildren()) {
    if (!$isElementNode(child)) continue
    const block = collectBlockText(child)
    if (!block) continue
    blocks.push(block)
  }
  let cursor = 0
  for (const block of blocks) {
    block.start = cursor
    block.end = cursor + block.text.length
    cursor = block.end + 1
  }
  return { text: blocks.map(block => block.text).join('\n'), blocks }
}

function collectTextNodes(node: LexicalNode, out: TextNode[]): void {
  if ($isTextNode(node)) {
    out.push(node)
    return
  }
  if ($isElementNode(node)) node.getChildren().forEach(child => collectTextNodes(child, out))
}

/**
 * 把 Lexical 选区端点换算成 block 内的纯文本偏移。
 * 端点可能是 TextNode（字符偏移），也可能是 ElementNode（子节点索引）：
 * 整段被选中、行首行尾或跨格式选择时，Lexical 常给出元素端点。
 */
function pointToBlockOffset(
  blockText: BlockText,
  pointNode: LexicalNode,
  pointOffset: number
): number | null {
  const sliceOf = (node: LexicalNode): TextSlice | undefined =>
    blockText.slices.find(slice => slice.node === node)

  if ($isTextNode(pointNode)) {
    const slice = sliceOf(pointNode)
    if (!slice) return null
    return slice.start + Math.max(0, Math.min(pointOffset, slice.end - slice.start))
  }
  if (!$isElementNode(pointNode)) return null

  const children = pointNode.getChildren()
  for (let index = Math.max(0, pointOffset); index < children.length; index++) {
    const nodes: TextNode[] = []
    collectTextNodes(children[index], nodes)
    for (const node of nodes) {
      const slice = sliceOf(node)
      if (slice) return slice.start
    }
  }
  for (let index = Math.min(pointOffset, children.length) - 1; index >= 0; index--) {
    const nodes: TextNode[] = []
    collectTextNodes(children[index], nodes)
    for (let cursor = nodes.length - 1; cursor >= 0; cursor--) {
      const slice = sliceOf(nodes[cursor])
      if (slice) return slice.end
    }
  }
  return null
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
 * 读取当前单 block 选区，换算成 quote 与全文锚点。
 * 必须在 Lexical update 上下文中调用。
 */
function captureSelectionAnchor(): { quote: string; anchor: AnnotationAnchor } | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return null
  const anchorNode = selection.anchor.getNode()
  const focusNode = selection.focus.getNode()
  const block = anchorNode.getTopLevelElement()
  if (!block || block !== focusNode.getTopLevelElement()) return null
  const blockText = collectBlockText(block)
  if (!blockText) return null
  const from = pointToBlockOffset(blockText, anchorNode, selection.anchor.offset)
  const to = pointToBlockOffset(blockText, focusNode, selection.focus.offset)
  if (from === null || to === null) return null
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  if (start === end) return null
  const { text, blocks } = collectDocumentText()
  const targetBlock = blocks.find(item => item.block === block)
  if (!targetBlock) return null
  const quote = text.slice(targetBlock.start + start, targetBlock.start + end)
  if (!quote.trim()) return null
  return {
    quote,
    anchor: buildAnchorAt(text, targetBlock.start + start, targetBlock.start + end)
  }
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

interface MarkRangeGroup {
  id: string
  blockIndex: number
  start: number
  end: number
  text: string
}

function markIdsAtTextNode(node: TextNode, block: ElementNode): string[] {
  const ids: string[] = []
  let parent: LexicalNode | null = node.getParent()
  while (parent && parent !== block) {
    if ($isMarkNode(parent)) ids.push(...parent.getIDs().filter(Boolean))
    parent = parent.getParent()
  }
  return [...new Set(ids)]
}

/** 只合并同 block 内首尾相接的片段；中间有未标注文字时视为分离副本。 */
function collectMarkRangeGroups(blocks: BlockText[]): Map<string, MarkRangeGroup[]> {
  const groups = new Map<string, MarkRangeGroup[]>()
  blocks.forEach((block, blockIndex) => {
    const fragments = new Map<string, Array<{ start: number; end: number }>>()
    for (const slice of block.slices) {
      for (const id of markIdsAtTextNode(slice.node, block.block)) {
        const values = fragments.get(id) ?? []
        values.push({ start: slice.start, end: slice.end })
        fragments.set(id, values)
      }
    }
    for (const [id, values] of fragments) {
      values.sort((left, right) => left.start - right.start)
      let current: { start: number; end: number } | null = null
      const merged: Array<{ start: number; end: number }> = []
      for (const value of values) {
        if (!current) {
          current = { ...value }
          continue
        }
        if (value.start <= current.end) {
          current.end = Math.max(current.end, value.end)
          continue
        }
        merged.push(current)
        current = { ...value }
      }
      if (current) merged.push(current)
      const next = groups.get(id) ?? []
      for (const range of merged) {
        const text = block.text.slice(range.start, range.end)
        if (!text) continue
        next.push({ id, blockIndex, start: range.start, end: range.end, text })
      }
      groups.set(id, next)
    }
  })
  for (const items of groups.values()) {
    items.sort((left, right) => left.blockIndex - right.blockIndex || left.start - right.start)
  }
  return groups
}

interface MarkResolution {
  state: AnnotationAnchorState
  reason?: AnnotationAnchorReason
  start?: number
  end?: number
}

function resolveMarkGroups(
  annotation: Annotation,
  groups: MarkRangeGroup[] | undefined,
  blocks: BlockText[]
): MarkResolution | null {
  if (!groups?.length) return null
  const expected = compactAnnotationText(annotation.quote)
  const complete = groups.filter(
    group => compactAnnotationText(group.text) === expected && expected.length > 0
  )
  const selected = complete[0] ?? null
  if (selected) {
    const block = blocks[selected.blockIndex]
    return { state: 'anchored', start: block.start + selected.start, end: block.start + selected.end }
  }
  const crossBlock = new Set(groups.map(group => group.blockIndex)).size > 1
  if (crossBlock) {
    return { state: 'unlocated', reason: 'cross-block' }
  }
  if (groups.length === 1) {
    const group = groups[0]
    const block = blocks[group.blockIndex]
    return { state: 'anchored', start: block.start + group.start, end: block.start + group.end }
  }
  const first = groups[0]
  const block = blocks[first.blockIndex]
  return { state: 'anchored', start: block.start + first.start, end: block.start + first.end }
}

interface ProjectedResolution {
  annotation: Annotation
  state: AnnotationAnchorState
  reason?: AnnotationAnchorReason
  start?: number
  end?: number
  quote?: string
  anchor?: AnnotationAnchor
}

function rangesOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number }
): boolean {
  return left.start < right.end && right.start < left.end
}

/**
 * 先收集 MarkNode 当前范围，再统一解包重绘。
 * 返回完整解析结果；ambiguous/unlocated 不会被包回正文。
 */
function resolveProjectedAnnotations(
  documentAnnotations: Annotation[],
  sourceAnnotations: Annotation[]
): ProjectedResolution[] {
  const annotations = [...documentAnnotations, ...sourceAnnotations]
  if (!annotations.length) return []
  const { text, blocks } = collectDocumentText()
  const markGroups = collectMarkRangeGroups(blocks)
  const blockRanges = blocks.map(block => ({
    start: block.start,
    end: block.end
  }))
  const precomputedCompact = compactWithOffsets(text)
  const raw = new Map<string, ProjectedResolution>()

  for (const annotation of annotations) {
    let resolution: MarkResolution | null = null
    if (annotation.scope === 'document') {
      resolution = resolveMarkGroups(annotation, markGroups.get(annotation.id), blocks)
    }
    if (!resolution) {
      const [exact] = resolveAnnotationAnchors(
        text,
        [annotation],
        {
          blocks: blockRanges,
          allowFuzzy: annotation.scope === 'document',
          precomputedCompact
        },
        precomputedCompact
      )
      resolution = exact
        ? {
            state: exact.state,
            reason: exact.reason,
            start: exact.start,
            end: exact.end
          }
        : { state: 'unlocated', reason: 'not-found' }
    }
    const start = resolution.start
    const end = resolution.end
    raw.set(annotation.id, {
      annotation,
      state: resolution.state,
      reason: resolution.reason,
      start,
      end,
      quote:
        start !== undefined && end !== undefined ? text.slice(start, end) : undefined,
      anchor:
        start !== undefined && end !== undefined
          ? buildAnchorAt(text, start, end, 48, precomputedCompact)
          : undefined
    })
  }

  const ordered = [...raw.values()].sort((left, right) => {
    const leftScope = left.annotation.scope === 'document' ? 0 : 1
    const rightScope = right.annotation.scope === 'document' ? 0 : 1
    return (
      leftScope - rightScope ||
      (left.start ?? Number.MAX_SAFE_INTEGER) - (right.start ?? Number.MAX_SAFE_INTEGER) ||
      left.annotation.createdAt - right.annotation.createdAt ||
      left.annotation.id.localeCompare(right.annotation.id)
    )
  })
  const occupied: Array<{ start: number; end: number }> = []
  for (const item of ordered) {
    if (
      item.start === undefined ||
      item.end === undefined ||
      item.state === 'ambiguous' ||
      item.state === 'unlocated'
    ) {
      continue
    }
    if (occupied.some(range => rangesOverlap(range, { start: item.start!, end: item.end! }))) {
      item.state = 'unlocated'
      item.reason = 'overlap'
      item.start = undefined
      item.end = undefined
      item.quote = undefined
      item.anchor = undefined
      continue
    }
    occupied.push({ start: item.start, end: item.end })
  }
  return ordered
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
  const [savingComment, setSavingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const popoverRef = useRef<CommentPopover | null>(null)
  popoverRef.current = popover
  // 尚未落盘的新建草稿 id。失焦对账可能在草稿创建前就发出、在创建后才返回，
  // 只用 popover 判断会漏掉这个竞态，必须用同步 ref 保护。
  const pendingCreateRef = useRef<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef<{ document: boolean; source: boolean; token: number }>({
    document: false,
    source: false,
    token: 0
  })
  const importedRef = useRef<{ token: number; version: number }>({ token: 0, version: 0 })
  const appliedRef = useRef<{ token: number; version: number }>({ token: 0, version: -1 })
  const markKeysRef = useRef<Set<NodeKey>>(new Set())
  const lastProjectedSnapshotRef = useRef<{
    token: number
    editorMode: string
    items: Map<
      string,
      {
        state: AnnotationAnchorState | undefined
        quote: string
        exact: string
        occurrence: number | undefined
      }
    >
  } | null>(null)
  const showHintRef = useRef<(text: string) => void>(() => undefined)

  const sourceKey = readConversationSource(activeFileContent)?.sourceKey ?? null
  const documentKey = `${workspacePath ?? ''}\n${activeFilePath ?? ''}`

  /** 撤回尚未保存的新建标注：去掉旁路记录和正文里的临时标记。 */
  const discardDraft = useCallback(
    (id: string): void => {
      if (pendingCreateRef.current === id) pendingCreateRef.current = null
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

  const reanchorFromSelection = useCallback(
    async (id: string): Promise<void> => {
      if (!workspacePath || !activeFilePath) return
      const annotation = useAnnotationStore
        .getState()
        .documentAnnotations.find(item => item.id === id)
      if (!annotation) return
      // 命令在 Lexical update 上下文中执行；这里不能再嵌套 editor.update，
      // 否则回调被排队，紧接着读取 quote/anchor 时还是空值。
      const captured = captureSelectionAnchor()
      if (!captured) {
        showHintRef.current('请选择单个段落内的一段正文')
        return
      }
      const { quote, anchor } = captured
      const saved = await saveActiveFile()
      if (!saved.saved) {
        showHintRef.current('正文未保存，无法重新定位')
        return
      }
      const result = await window.api.annotations.reanchorDocument(
        workspacePath,
        activeFilePath,
        id,
        quote,
        anchor,
        annotation.anchorRevision ?? 1
      )
      if (!result.success || !result.data) {
        showHintRef.current(result.error || '重新定位失败')
        return
      }
      useAnnotationStore.getState().upsertLocal(result.data)
      showHintRef.current('注释已重新定位')
    },
    [activeFilePath, editor, saveActiveFile, showHintRef, workspacePath]
  )

  // 正文切换后，旧的浮层坐标和评论草稿不能再指向新文档。
  // 提交阶段同步丢弃，避免旧评论卡在新文档上先渲染一帧再消失。
  if (popoverRef.current && popoverRef.current.documentKey !== documentKey) {
    popoverRef.current = null
    pendingCreateRef.current = null
  }
  useEffect(() => {
    pendingCreateRef.current = null
    setPopover(null)
    setComment('')
    setCommentError(null)
  }, [documentKey])

  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 2800)
  }, [])
  showHintRef.current = showHint

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

    const snapshotItems = new Map<
      string,
      {
        state: AnnotationAnchorState | undefined
        quote: string
        exact: string
        occurrence: number | undefined
      }
    >()
    for (const item of [...state.documentAnnotations, ...state.sourceAnnotations]) {
      snapshotItems.set(item.id, {
        state: item.anchorState,
        quote: item.quote,
        exact: item.anchor.exact,
        occurrence: item.anchor.occurrence
      })
    }

    if (state.documentAnnotations.length === 0 && state.sourceAnnotations.length === 0) {
      const hasMarks = editor.getEditorState().read(() => allMarks().length > 0)
      if (!hasMarks) {
        appliedRef.current = { token, version: importedRef.current.version }
        lastProjectedSnapshotRef.current = { token, editorMode, items: snapshotItems }
        useAnnotationStore.getState().setResolutions([], token)
        return
      }
    }

    const before = serializeWorkbenchMarkdown(editor)

    const projected = editor.getEditorState().read(() =>
      resolveProjectedAnnotations(state.documentAnnotations, state.sourceAnnotations)
    )
    editor.update(
      () => {
        // 先移除旧投影，再按当前锚点完整重绘。只清理无效 id 会让仍然有效、
        // 但文本已移动或跨多个 TextNode 的旧 MarkNode 停在错误范围。
        unwrapAllMarks()
        // 一次收集文本与 TextNode 切片，后续标注只做偏移映射，避免每条标注重走整棵节点树。
        const { text, blocks } = collectDocumentText()
        void text
        for (const item of projected) {
          if (item.start === undefined || item.end === undefined) continue
          const wrapped = wrapRange(item.start, item.end, item.annotation.id, blocks)
          if (!wrapped.ok) {
            // 重叠只表示这条投影暂不显示；找不到或跨 block 才是未定位。
            if (wrapped.reason === 'cross-block' || wrapped.reason === 'not-found') {
              item.state = 'unlocated'
              item.reason = 'cross-block'
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
    for (const item of projected) {
      const prevMeta = snapshotItems.get(item.annotation.id)
      if (prevMeta) {
        prevMeta.state = item.state
      }
    }
    lastProjectedSnapshotRef.current = { token, editorMode, items: snapshotItems }
    useAnnotationStore.getState().setResolutions(
      projected.map(({ annotation, state, reason }) => ({
        id: annotation.id,
        state,
        reason
      })),
      token
    )
  }, [activeFilePath, editor, editorMode, showHint, workspacePath])

  // 标注增删改后重新投影：删除要清掉正文残留，评论保存和撤销重做要重算未定位；
  // 纯 offsetHint 数值位移或评论内容编辑且正文 MarkNode 完好时，跳过重建与 2 次全篇序列化。
  useEffect(() => {
    if (editorMode !== 'wysiwyg') return
    const token = useAnnotationStore.getState().token
    const allAnnotations = [...documentAnnotations, ...sourceAnnotations]
    const prev = lastProjectedSnapshotRef.current

    const buildSnapshot = () => {
      const items = new Map<
        string,
        {
          state: AnnotationAnchorState | undefined
          quote: string
          exact: string
          occurrence: number | undefined
        }
      >()
      for (const item of allAnnotations) {
        items.set(item.id, {
          state: item.anchorState,
          quote: item.quote,
          exact: item.anchor.exact,
          occurrence: item.anchor.occurrence
        })
      }
      return { token, editorMode, items }
    }

    let needsReproject =
      !prev ||
      prev.token !== token ||
      prev.editorMode !== editorMode ||
      prev.items.size !== allAnnotations.length

    if (!needsReproject && prev) {
      for (const item of allAnnotations) {
        const prevItem = prev.items.get(item.id)
        if (
          !prevItem ||
          prevItem.state !== item.anchorState ||
          prevItem.quote !== item.quote ||
          prevItem.exact !== item.anchor.exact ||
          prevItem.occurrence !== item.anchor.occurrence
        ) {
          needsReproject = true
          break
        }
      }
    }

    if (!needsReproject) {
      // 校验当前编辑器内 MarkNode 集合是否与内存状态一致（例如撤销拆除了 MarkNode）
      const missingOrStaleMark = editor.getEditorState().read(() => {
        if (allAnnotations.length === 0) {
          return markKeysRef.current.size > 0
        }
        const presentIds = new Set<string>()
        for (const mark of allMarks()) {
          for (const id of mark.getIDs()) {
            if (id) presentIds.add(id)
          }
        }
        for (const item of allAnnotations) {
          const isUnresolved =
            item.anchorState === 'unlocated' || item.anchorState === 'ambiguous'
          if (isUnresolved && presentIds.has(item.id)) return true
          if (
            (item.anchorState === 'anchored' || item.anchorState === 'shifted') &&
            !presentIds.has(item.id)
          ) {
            return true
          }
        }
        return false
      })
      if (missingOrStaleMark) {
        needsReproject = true
      }
    }

    if (!needsReproject) {
      lastProjectedSnapshotRef.current = buildSnapshot()
      return
    }

    importedRef.current = { token, version: importedRef.current.version + 1 }
    applyAnnotations()
  }, [documentAnnotations, sourceAnnotations, editorMode, applyAnnotations, editor])

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
    const hasMark = editor.getEditorState().read(() =>
      allMarks().some(item => item.hasID(selectedId))
    )
    if (!hasMark) return
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
    editor.getEditorState().read(() => {
      markKeysRef.current.clear()
      for (const mark of allMarks()) {
        markKeysRef.current.add(mark.getKey())
      }
    })
    let markMutatedThisCycle = false
    return mergeRegister(
      editor.registerMutationListener(MarkNode, mutations => {
        for (const [key, type] of mutations) {
          if (type === 'destroyed') markKeysRef.current.delete(key)
          else markKeysRef.current.add(key)
        }
        markMutatedThisCycle = true
      }),
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
        const hadMarkMutation = markMutatedThisCycle
        markMutatedThisCycle = false
        if (tags.has('sync-external') || tags.has('annotation-sync')) return
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return

        const state = useAnnotationStore.getState()
        const complete = readyRef.current.document && readyRef.current.source
        const valid = new Set(
          [...state.documentAnnotations, ...state.sourceAnnotations].map(item => item.id)
        )

        const needsCleanup = editorState.read(() => {
          // 文档中没有任何 MarkNode 且本次未触及 MarkNode：跳过 discrete 更新
          if (markKeysRef.current.size === 0 && !hadMarkMutation) {
            return false
          }
          let touchesMark = hadMarkMutation
          if (!touchesMark) {
            const hasMarkAncestor = (nodeKey: NodeKey): boolean => {
              let node: LexicalNode | null = editorState._nodeMap.get(nodeKey) ?? null
              while (node) {
                if ($isMarkNode(node)) return true
                node = node.getParent()
              }
              return false
            }
            for (const key of dirtyLeaves) {
              if (hasMarkAncestor(key)) {
                touchesMark = true
                break
              }
            }
            if (!touchesMark) {
              for (const [key] of dirtyElements) {
                if (key !== 'root' && hasMarkAncestor(key)) {
                  touchesMark = true
                  break
                }
              }
            }
          }
          if (!touchesMark) return false

          for (const mark of allMarks()) {
            const ids = mark.getIDs().filter(Boolean)
            if (!ids.length) return true
            if (new Set(ids).size !== ids.length) return true
            if (complete && !ids.every(id => valid.has(id))) return true
          }
          return false
        })

        if (!needsCleanup) return
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
    const buildResolutions = (): {
      resolutions: DocumentResolution[]
      localResolutions: Array<{ id: string; state: AnnotationAnchorState; reason?: AnnotationAnchorReason }>
      next: Annotation[]
    } => {
      const state = useAnnotationStore.getState()
      const documentAnnotations = state.documentAnnotations
      const sourceAnnotations = state.sourceAnnotations
      if (!documentAnnotations.length && !sourceAnnotations.length) {
        return { resolutions: [], localResolutions: [], next: [] }
      }
      // source 投影也随正文变化重新解析，否则删除投影目标后它既不显示也不进未解决分组。
      // 但 source 的锚点以原文为准，不能回写到磁盘，只有 document 进入 resolutions。
      const projected = editor.getEditorState().read(() =>
        resolveProjectedAnnotations(documentAnnotations, sourceAnnotations)
      )
      const next = projected.map(({ annotation, state: anchorState, reason, quote, anchor }) => ({
        ...annotation,
        anchorState,
        anchorReason: reason,
        quote: quote ?? annotation.quote,
        anchor: anchor ?? annotation.anchor
      }))
      const resolutions = projected
        .filter(({ annotation }) => annotation.scope === 'document')
        .map(({ annotation, state: anchorState, reason, quote, anchor }) => ({
          id: annotation.id,
          state: anchorState,
          reason,
          quote,
          anchor,
          baseAnchorRevision: annotation.anchorRevision ?? 1
        }))
      const localResolutions = projected.map(({ annotation, state: anchorState, reason }) => ({
        id: annotation.id,
        state: anchorState,
        reason
      }))
      return { resolutions, localResolutions, next }
    }
    const scheduleReconcile = (): void => {
      if (reconcileTimer) clearTimeout(reconcileTimer)
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null
        // 新建标注在保存评论前只存在于本地 store 与正文 MarkNode 中，磁盘与解析结果里都没有它。
        // 此时回灌投影会把这条草稿从 store 抹掉，保存时找不到记录。等提交后再统一对账。
        if (pendingCreateRef.current) return
        const { localResolutions, next } = buildResolutions()
        const state = useAnnotationStore.getState()
        if (state.workspaceRoot !== workspacePath || state.relativePath !== activeFilePath) return
        // 只更新解析状态不会触发重新投影：撤销恢复后正文回来了，但 MarkNode 已被删除，
        // 高亮不会自己重现。把本次解析出的 quote/anchor 回灌到标注列表，让投影按新结果重绘。
        // source 的锚点属于原文页面，只能跟随本地解析状态，不能被文档投影坐标覆盖。
        const projectedById = new Map(
          next.filter(item => item.scope === 'document').map(item => [item.id, item])
        )
        // 状态跃迁（unlocated -> anchored/shifted）也必须触发重投影：
        // 撤销可能恢复文字但不再恢复 MarkNode，此时锚点本身没变，只有状态变了。
        const changed = state.documentAnnotations.some(item => {
          const projected = projectedById.get(item.id)
          return (
            projected !== undefined &&
            (projected.anchorState !== item.anchorState ||
              projected.quote !== item.quote ||
              projected.anchor.exact !== item.anchor.exact ||
              projected.anchor.prefix !== item.anchor.prefix ||
              projected.anchor.suffix !== item.anchor.suffix ||
              projected.anchor.occurrence !== item.anchor.occurrence ||
              projected.anchor.offsetHint !== item.anchor.offsetHint)
          )
        })
        if (changed) {
          state.setDocumentAnnotations(
            state.documentAnnotations.map(item => projectedById.get(item.id) ?? item),
            state.token
          )
        }
        state.setResolutions(localResolutions)
      }, 600)
    }
    const persistResolutions = async (options?: { save?: boolean }): Promise<{ saved: boolean; error?: string }> => {
      // 新建标注在保存评论前只存在于本地 store 与正文 MarkNode 中，磁盘上还没有记录。
      // 打开评论框会让编辑器失焦；此时若用磁盘结果回写 store，会把这条草稿冲掉，
      // 之后“保存标注”找不到记录而静默失败。等评论提交后再统一对账。
      // 但显式 flush（切文件/关闭窗口）仍要先保存正文，不能连正文一起跳过。
      if (pendingCreateRef.current) {
        if (!options?.save) return { saved: true }
        const saved = await saveActiveFile()
        return saved.saved
          ? { saved: true }
          : { saved: false, error: saved.reason === 'oversized' ? '文档过大，正文未保存' : '正文未保存' }
      }
      const state = useAnnotationStore.getState()
      if (!workspacePath || !activeFilePath) return { saved: true }
      if (state.workspaceRoot !== workspacePath || state.relativePath !== activeFilePath) {
        return { saved: true }
      }
      const { resolutions } = buildResolutions()
      if (!resolutions.length) return { saved: true }
      if (options?.save) {
        const saved = await saveActiveFile()
        if (!saved.saved) {
          return {
            saved: false,
            error:
              saved.reason === 'oversized'
                ? '文档过大，标注状态未保存'
                : saved.reason === 'conflict'
                  ? '文档保存冲突，标注状态未保存'
                  : '正文未保存，标注状态未保存'
          }
        }
      }
      try {
        const result = await window.api.annotations.reconcileDocument(
          workspacePath,
          activeFilePath,
          resolutions
        )
        if (!result.success || !result.data) {
          return { saved: false, error: result.error || '标注状态保存失败' }
        }
        const draftId = pendingCreateRef.current
        const draft = draftId
          ? useAnnotationStore.getState().documentAnnotations.find(item => item.id === draftId)
          : undefined
        const merged = draft
          ? [...result.data.annotations.filter(item => item.id !== draft.id), draft]
          : result.data.annotations
        useAnnotationStore.getState().setDocumentAnnotations(merged, useAnnotationStore.getState().token)
        return { saved: true }
      } catch (error) {
        return { saved: false, error: error instanceof Error ? error.message : '标注状态保存失败' }
      }
    }
    useWorkbenchStore.getState().setDocumentAnnotationFlusher(() =>
      persistResolutions({ save: true })
    )
    const root = editor.getRootElement()
    const persistOnBlur = (): void => {
      void persistResolutions({ save: true })
    }
    root?.addEventListener('blur', persistOnBlur)
    const unregisterReconcileListener = editor.registerUpdateListener(
      ({ dirtyElements, dirtyLeaves, tags }) => {
        if (tags.has('sync-external') || tags.has('annotation-sync')) return
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
        const state = useAnnotationStore.getState()
        if (!state.documentAnnotations.length && !state.sourceAnnotations.length) return
        scheduleReconcile()
      }
    )
    return () => {
      unregisterReconcileListener()
      root?.removeEventListener('blur', persistOnBlur)
      if (reconcileTimer) clearTimeout(reconcileTimer)
      if (useWorkbenchStore.getState().documentAnnotationFlusher) {
        useWorkbenchStore.getState().setDocumentAnnotationFlusher(null)
      }
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
      const from = pointToBlockOffset(blockText, anchorNode, selection.anchor.offset)
      const to = pointToBlockOffset(blockText, focusNode, selection.focus.offset)
      if (from === null || to === null) {
        showHint('请选择单个段落内的正文文本')
        return true
      }
      const start = Math.min(from, to)
      const end = Math.max(from, to)
      const quote = blockText.text.slice(start, end)
      if (!quote.trim()) {
        showHint('请选择一段正文文字')
        return true
      }
      const { text: documentText, blocks: documentBlocks } = collectDocumentText()
      // start/end 是段落内偏移，不能直接和 block.start（全文偏移）比较，
      // 否则除首个 block 外都匹配不到，创建注释会静默失败。
      const targetBlock = documentBlocks.find(item => item.block === block)
      const documentStart = targetBlock ? targetBlock.start + start : undefined
      const documentEnd = targetBlock ? targetBlock.start + end : undefined
      if (documentStart === undefined || documentEnd === undefined) {
        showHint('无法创建标注，请重新选择文字')
        return true
      }
      const domSelection = editor.getRootElement()?.ownerDocument.getSelection()
      const rect = domSelection?.rangeCount ? domSelection.getRangeAt(0).getBoundingClientRect() : null
      const id = crypto.randomUUID()
      const now = Date.now()
      const annotation: Annotation = {
        id,
        scope: 'document',
        quote,
        originalQuote: quote,
        anchor: buildAnchorAt(documentText, documentStart, documentEnd),
        anchorState: 'anchored',
        anchorRevision: 1,
        lastAnchoredAt: now,
        comment: '',
        createdAt: now,
        updatedAt: now
      }
      // 创建标注仅在富文本层投影 MarkNode，不应进入撤销栈、抢焦点或触发正文 Markdown 回写。
      $addUpdateTag('annotation-sync')
      $addUpdateTag(HISTORIC_TAG)
      $addUpdateTag(SKIP_SELECTION_FOCUS_TAG)
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
      pendingCreateRef.current = id
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

  useEffect(() => {
    return editor.registerCommand(
      WORKBENCH_REANCHOR_COMMAND,
      (id: string) => {
        void reanchorFromSelection(id)
        return true
      },
      COMMAND_PRIORITY_EDITOR
    )
  }, [editor, reanchorFromSelection])

  const cancelPopover = useCallback(() => {
    if (!popover) return
    if (popover.mode !== 'create') {
      setPopover(null)
      setComment('')
      return
    }
    setPopover(null)
    setComment('')
    setCommentError(null)
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
    if (!popover || !workspacePath || !activeFilePath || savingComment) return
    const state = useAnnotationStore.getState()
    const annotation = [...state.documentAnnotations, ...state.sourceAnnotations].find(
      item => item.id === popover.id
    )
    if (!annotation) {
      if (pendingCreateRef.current === popover.id) pendingCreateRef.current = null
      setPopover(null)
      showHint('标注草稿已失效，请重新选择文字')
      return
    }
    const next: Annotation = { ...annotation, comment: comment.trim(), updatedAt: Date.now() }
    // 保存失败时保留评论卡和草稿，让用户直接重试；成功后才关闭。
    setSavingComment(true)
    setCommentError(null)
    const fail = (message: string): void => {
      setCommentError(message)
      showHint(message)
    }
    const succeed = (saved: Annotation): void => {
      if (pendingCreateRef.current === saved.id) pendingCreateRef.current = null
      useAnnotationStore.getState().upsertLocal(saved)
      setPopover(null)
      setComment('')
      setCommentError(null)
    }
    try {
      if (next.scope === 'document') {
        const saved = await saveActiveFile()
        if (!saved.saved) {
          fail(saved.reason === 'oversized' ? '文档过大，标注未保存' : '正文未保存，标注未写入')
          return
        }
        const result =
          popover.mode === 'create'
            ? await window.api.annotations.createDocument(workspacePath, activeFilePath, next)
            : await window.api.annotations.updateDocumentComment(
                workspacePath,
                activeFilePath,
                next.id,
                next.comment,
                annotation.updatedAt
              )
        if (result.success && result.data) {
          succeed(result.data)
        } else {
          fail(result.error || '标注保存失败')
        }
        return
      }
      if (!next.source) {
        fail('原文标注缺少来源信息')
        return
      }
      if (popover.mode === 'create') {
        const result = await window.api.annotations.upsertSource(next.source.key, next.source, next)
        if (result.success && result.data) {
          succeed(result.data)
        } else {
          fail(result.error || '原文标注保存失败')
        }
        return
      }
      const result = await window.api.annotations.updateSourceComment(
        next.source.key,
        next.id,
        next.comment,
        annotation.updatedAt
      )
      if (result.success && result.data) {
        succeed(result.data)
      } else {
        fail(result.error || '原文标注保存失败')
      }
    } finally {
      setSavingComment(false)
    }
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
      setCommentError(null)
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
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-popover px-3 py-1.5 rounded-lg bg-amber-500 text-white text-label shadow-lg">
          {hint}
        </div>
      )}
      {popover &&
        popover.documentKey === documentKey &&
        anchorElem &&
        createPortal(
          <AnnotationCommentCard
            className="absolute z-popover"
            style={{ left: popover.left, top: popover.top }}
            title={popover.mode === 'create' ? '标注' : '修改评论'}
            quote={popover.quote}
            value={comment}
            onChange={setComment}
            onCancel={cancelPopover}
            onSave={() => void commitComment()}
            busy={savingComment}
            error={commentError}
            saveLabel="保存标注"
            placeholder="添加评论…"
            footerStart={
              popover.mode === 'edit' ? (
                <button
                  type="button"
                  className="text-caption text-rose-500 hover:underline"
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
