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
  SELECTION_CHANGE_COMMAND,
  $setSelection,
  type ElementNode,
  type LexicalCommand,
  type LexicalNode,
  type TextNode
} from 'lexical'
import { $createMarkNode, $isMarkNode, MarkNode } from '@lexical/mark'
import { $convertToMarkdownString } from '@lexical/markdown'
import type { Annotation } from '../../../../shared/types/annotations'
import { buildAnchorAt, resolveAnchors } from '../../../../shared/utils/annotationAnchors'
import { noteConversationKey } from '../../../../shared/utils/noteIdentity'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAnnotationStore } from '../../store/annotationStore'
import {
  WORKBENCH_TRANSFORMERS,
  parseMarkdownWithFrontmatter
} from './MarkdownSyncPlugin'

export const WORKBENCH_ANNOTATE_COMMAND: LexicalCommand<void> = createCommand(
  'WORKBENCH_ANNOTATE_COMMAND'
)

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

function unwrapMark(mark: MarkNode): void {
  const children = mark.getChildren()
  children.forEach(child => mark.insertBefore(child))
  mark.remove()
}

function allMarks(): MarkNode[] {
  const marks: MarkNode[] = []
  const walk = (node: LexicalNode): void => {
    if ($isMarkNode(node)) marks.push(node)
    if ($isElementNode(node)) node.getChildren().forEach(walk)
  }
  walk($getRoot())
  return marks
}

function unwrapAllMarks(): void {
  allMarks().forEach(unwrapMark)
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
  const seen = new Set<string>()
  for (const mark of allMarks()) {
    const ids = mark.getIDs().filter(Boolean)
    if (!ids.length) {
      unwrapMark(mark)
      continue
    }
    const unique = ids.filter(id => !seen.has(id))
    if (unique.length !== ids.length) {
      if (unique.length) mark.setIDs(unique)
      else {
        unwrapMark(mark)
        continue
      }
    }
    unique.forEach(id => seen.add(id))
    // 两路标注都加载完成前不清理未知 id，避免把异步到达的 source 投影删掉。
    if (complete && !unique.every(id => validIds.has(id))) unwrapMark(mark)
  }
}

interface CommentPopover {
  id: string
  quote: string
  left: number
  top: number
}

function readSourceKey(content: string): string | null {
  const { frontmatter } = parseMarkdownWithFrontmatter(content)
  if (!frontmatter) return null
  const unquote = (value: string): string => value.trim().replace(/^["']|["']$/g, '')
  const key = /^source_key:\s*(.+)$/m.exec(frontmatter)?.[1]
  if (key) return unquote(key)
  const url =
    /^source_url:\s*(.+)$/m.exec(frontmatter)?.[1] ??
    /^source:\s*(https:\/\/.+)$/m.exec(frontmatter)?.[1]
  if (!url) return null
  const title = /^title:\s*(.+)$/m.exec(frontmatter)?.[1]
  try {
    return noteConversationKey(unquote(url), title ? unquote(title) : '')
  } catch {
    return null
  }
}

export default function WorkbenchAnnotationPlugin({
  anchorElem
}: {
  anchorElem: HTMLElement | null
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
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef<{ document: boolean; source: boolean; token: number }>({
    document: false,
    source: false,
    token: 0
  })
  const importedRef = useRef<{ token: number; version: number }>({ token: 0, version: 0 })
  const appliedRef = useRef<{ token: number; version: number }>({ token: 0, version: -1 })

  const sourceKey = readSourceKey(activeFileContent)

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
    const valid = new Set(annotations.map(item => item.id))
    let before = ''
    editor.getEditorState().read(() => {
      before = $convertToMarkdownString(WORKBENCH_TRANSFORMERS)
    })

    const unlocated: string[] = []
    editor.update(
      () => {
        cleanMarkNodes(valid, true)
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
      { tag: 'annotation-sync', discrete: true }
    )

    let after = ''
    editor.getEditorState().read(() => {
      after = $convertToMarkdownString(WORKBENCH_TRANSFORMERS)
    })
    if (after !== before) {
      editor.update(() => unwrapAllMarks(), { tag: 'annotation-sync', discrete: true })
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

  // 由 MarkdownSyncPlugin 在正文导入完成时通知；先有正文，后有标注。
  useEffect(() => {
    const handler = (): void => {
      const state = useAnnotationStore.getState()
      if (state.workspaceRoot !== workspacePath || state.relativePath !== activeFilePath) return
      importedRef.current = {
        token: state.token,
        version: importedRef.current.token === state.token ? importedRef.current.version + 1 : 0
      }
      applyAnnotations()
    }
    window.addEventListener('workbench:markdown-imported', handler)
    return () => window.removeEventListener('workbench:markdown-imported', handler)
  }, [workspacePath, activeFilePath, applyAnnotations])

  // 点击正文 MarkNode → 选中侧栏卡片。
  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    const handler = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      const hit = editor.getEditorState().read(() => {
        for (const mark of allMarks()) {
          const dom = editor.getElementByKey(mark.getKey())
          if (dom && dom.contains(target)) return mark.getIDs().find(Boolean) ?? null
        }
        return null
      })
      if (hit) useAnnotationStore.getState().setSelected(hit)
    }
    root.addEventListener('click', handler)
    return () => root.removeEventListener('click', handler)
  }, [editor])

  // 侧栏卡片（或正文点击）选中后，定位并滚动到对应文本。
  useEffect(() => {
    if (!selectedId) return
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
      { tag: 'annotation-sync', discrete: true }
    )
    if (!located) return
    requestAnimationFrame(() => {
      for (const mark of allMarks()) {
        if (!mark.hasID(selectedId)) continue
        const dom = editor.getElementByKey(mark.getKey())
        if (dom) {
          try {
            dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
          } catch {
            // 容器尚未布局完成时忽略
          }
        }
        break
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
          tag: 'annotation-sync',
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
      if (rect && anchorElem) {
        const anchorRect = anchorElem.getBoundingClientRect()
        setPopover({
          id,
          quote,
          left: Math.max(8, rect.left - anchorRect.left),
          top: rect.bottom - anchorRect.top + 8
        })
      } else {
        setPopover({ id, quote, left: 8, top: 8 })
      }
      setComment('')
      return true
    }
    return editor.registerCommand(WORKBENCH_ANNOTATE_COMMAND, create, COMMAND_PRIORITY_EDITOR)
  }, [editor, anchorElem, showHint])

  const cancelComment = useCallback(() => {
    if (!popover) return
    const id = popover.id
    setPopover(null)
    setComment('')
    useAnnotationStore.getState().removeLocal(id)
    editor.update(
      () => {
        for (const mark of allMarks()) {
          if (mark.hasID(id)) {
            if (mark.getIDs().length > 1) mark.deleteID(id)
            else unwrapMark(mark)
          }
        }
      },
      { tag: 'annotation-sync', discrete: true }
    )
  }, [editor, popover])

  const commitComment = async (): Promise<void> => {
    if (!popover || !workspacePath || !activeFilePath) return
    const annotation = useAnnotationStore
      .getState()
      .documentAnnotations.find(item => item.id === popover.id)
    if (!annotation) return
    const next: Annotation = { ...annotation, comment: comment.trim(), updatedAt: Date.now() }
    useAnnotationStore.getState().upsertLocal(next)
    setPopover(null)
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
  }

  return (
    <>
      {hint && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs shadow-lg">
          {hint}
        </div>
      )}
      {popover &&
        anchorElem &&
        createPortal(
          <div
            className="absolute z-50 w-72 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-gray-800 shadow-2xl p-3"
            style={{ left: popover.left, top: popover.top }}
          >
            <div className="text-[11px] text-text-secondary line-clamp-2 mb-2">{popover.quote}</div>
            <textarea
              autoFocus
              value={comment}
              onChange={event => setComment(event.target.value)}
              placeholder="写下评论"
              className="w-full h-20 resize-none rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-primary/60"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelComment}
                className="h-7 px-2 rounded-md text-xs text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void commitComment()}
                className="h-7 px-2.5 rounded-md text-xs text-white bg-primary hover:bg-primary/90"
              >
                保存
              </button>
            </div>
          </div>,
          anchorElem
        )}
    </>
  )
}
