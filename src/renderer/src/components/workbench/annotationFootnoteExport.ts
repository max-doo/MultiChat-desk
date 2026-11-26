/** 标注 → 脚注的非破坏性导出：在深拷贝 JSON AST 上变换，影子编辑器序列化。 */

import type { LexicalEditor, ParsableSerializedNode, SerializedEditorState } from 'lexical'
import { $convertToMarkdownString } from '@lexical/markdown'
import { WORKBENCH_TRANSFORMERS } from './MarkdownSyncPlugin'
import { collectFootnoteStateFromLexical, computeNextFootnoteId } from './workbenchFootnotes'
import type { Annotation } from '../../../../shared/types/annotations'

export type FootnoteFormat = 'highlight-footnote' | 'mark-footnote'

export interface FootnoteExportResult {
  markdown: string
  exportedCount: number
  skippedIds: string[]
}

/** Lexical IS_HIGHLIGHT bitmask（1 << 7） */
const IS_HIGHLIGHT = 128

type SerializedTextLikeNode = ParsableSerializedNode & { format?: number }
type SerializedMarkLikeNode = ParsableSerializedNode & { ids?: unknown }

/** 递归为所有 text 节点加 highlight format */
function addHighlightFormat(node: ParsableSerializedNode): void {
  if (node.type === 'text') {
    const textNode = node as SerializedTextLikeNode
    textNode.format = (textNode.format ?? 0) | IS_HIGHLIGHT
    return
  }
  if (node.children) {
    for (const child of node.children) addHighlightFormat(child)
  }
}

/**
 * 收集目标标注在 JSON 树中的出现顺序及最后一个 MarkNode 引用。
 * 同一条标注可能跨越多个 TextNode（例如中间包含加粗/斜体），从而对应多个 MarkNode；
 * 脚注引用应仅插在最后一个片段之后，避免出现多个重复 `[^N]`。
 */
function collectEncounterInfo(
  root: ParsableSerializedNode,
  targetIds: Set<string>
): { order: Map<string, number>; lastMarkNode: Map<string, ParsableSerializedNode> } {
  const order = new Map<string, number>()
  const lastMarkNode = new Map<string, ParsableSerializedNode>()
  let index = 0

  const walk = (node: ParsableSerializedNode): void => {
    const markNode = node as SerializedMarkLikeNode
    if (markNode.type === 'mark' && Array.isArray(markNode.ids)) {
      for (const id of markNode.ids) {
        if (typeof id === 'string' && targetIds.has(id)) {
          if (!order.has(id)) {
            order.set(id, index++)
          }
          lastMarkNode.set(id, node)
        }
      }
    }
    if (node.children) {
      for (const child of node.children) walk(child)
    }
  }

  walk(root)
  return { order, lastMarkNode }
}

/**
 * 变换 JSON AST：
 * - 为目标标注的 MarkNode 子孙加 highlight
 * - 在目标标注最后一个 MarkNode 解包后的末尾插入 FootnoteRefNode
 * - 解包所有 MarkNode（包括非目标的）
 * - 在 root 末尾追加 FootnoteDefNode
 */
function transformForExport(
  root: ParsableSerializedNode,
  targetIds: Set<string>,
  annotationMap: Map<string, Annotation>,
  footnoteAssignment: Map<string, string>,
  lastMarkNode: Map<string, ParsableSerializedNode>
): void {
  const processChildren = (node: ParsableSerializedNode): void => {
    if (!node.children) return

    const newChildren: ParsableSerializedNode[] = []

    for (const child of node.children) {
      const markChild = child as SerializedMarkLikeNode
      if (markChild.type === 'mark' && Array.isArray(markChild.ids)) {
        const ids = markChild.ids.filter((id): id is string => typeof id === 'string')
        const matchingTargetIds = ids.filter(id => targetIds.has(id))

        if (matchingTargetIds.length > 0) {
          addHighlightFormat(child)
        }

        processChildren(child)

        if (child.children) {
          newChildren.push(...child.children)
        }

        // 仅在该标注的最后一个 MarkNode 末尾插入脚注引用
        if (matchingTargetIds.length > 0) {
          const primaryId = matchingTargetIds[0]
          if (lastMarkNode.get(primaryId) === child) {
            const footnoteId = footnoteAssignment.get(primaryId)
            if (footnoteId) {
              newChildren.push({
                type: 'workbench-footnote-ref',
                footnoteId,
                version: 1
              } as ParsableSerializedNode)
            }
          }
        }
      } else {
        processChildren(child)
        newChildren.push(child)
      }
    }

    node.children = newChildren
  }

  processChildren(root)

  const sortedEntries = [...footnoteAssignment.entries()].sort((a, b) => {
    const numA = Number.parseInt(a[1], 10)
    const numB = Number.parseInt(b[1], 10)
    return numA - numB
  })

  for (const [annotationId, footnoteId] of sortedEntries) {
    const annotation = annotationMap.get(annotationId)
    if (!annotation) continue

    const commentText = (annotation.comment || '').trim()
    // 多行评论 → <br> 保持单行脚注定义
    const normalizedComment = commentText.replace(/\r?\n/g, '<br>')

    const textNode: ParsableSerializedNode = {
      type: 'text',
      text: normalizedComment || '',
      format: 0,
      style: '',
      mode: 'normal',
      detail: 0,
      version: 1
    } as ParsableSerializedNode

    const defNode: ParsableSerializedNode = {
      type: 'workbench-footnote-def',
      footnoteId,
      children: normalizedComment ? [textNode] : [],
      direction: null,
      format: 0,
      indent: 0,
      version: 1
    } as ParsableSerializedNode

    if (root.children) {
      root.children.push(defNode)
    }
  }
}

/**
 * 生成带脚注的 Markdown。
 * 完全不修改原始编辑器状态——在深拷贝的 JSON AST 上操作，用影子编辑器序列化。
 */
export function exportAnnotationsAsFootnotedMarkdown(
  editor: LexicalEditor,
  annotations: Annotation[],
  format: FootnoteFormat = 'highlight-footnote'
): FootnoteExportResult {
  if (annotations.length === 0) {
    const markdown = editor.getEditorState().read(() =>
      $convertToMarkdownString(WORKBENCH_TRANSFORMERS)
    )
    return { markdown, exportedCount: 0, skippedIds: [] }
  }

  const targetIds = new Set(annotations.map(a => a.id))
  const annotationMap = new Map(annotations.map(a => [a.id, a]))

  const stateJson = editor.getEditorState().toJSON(true) as SerializedEditorState
  const root = JSON.parse(JSON.stringify(stateJson.root)) as ParsableSerializedNode

  const { order: encounterOrder, lastMarkNode } = collectEncounterInfo(root, targetIds)

  const usedIds = editor.getEditorState().read(() => collectFootnoteStateFromLexical().usedIds)
  const footnoteAssignment = new Map<string, string>()
  const skippedIds: string[] = []

  const sortedByEncounter = [...encounterOrder.entries()].sort((a, b) => a[1] - b[1])
  for (const [annotationId] of sortedByEncounter) {
    const nextId = computeNextFootnoteId(usedIds)
    footnoteAssignment.set(annotationId, nextId)
    usedIds.add(nextId)
  }

  for (const id of targetIds) {
    if (!encounterOrder.has(id)) {
      skippedIds.push(id)
    }
  }

  transformForExport(root, targetIds, annotationMap, footnoteAssignment, lastMarkNode)

  const shadow = editor.parseEditorState({ root })
  let markdown = shadow.read(() => $convertToMarkdownString(WORKBENCH_TRANSFORMERS))

  if (format === 'mark-footnote') {
    markdown = markdown.replace(/==([^=]+)==/g, '<mark>$1</mark>')
  }

  return {
    markdown,
    exportedCount: footnoteAssignment.size,
    skippedIds
  }
}
