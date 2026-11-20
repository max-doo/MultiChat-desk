import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getNodeByKey,
  $createRangeSelection,
  $setSelection,
  $isTextNode,
  $isElementNode,
  type LexicalNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalEditor
} from 'lexical'
import { useWorkbenchStore } from '../../store/workbenchStore'

/**
 * 富文本（预览）模式下，把 store.activeFileContent（markdown 原文）中的
 * 字符偏移区间 [start, end) 映射为 Lexical 编辑器内的可见文本选区。
 *
 * 原理：按文档顺序遍历每个 TextNode，在 markdown 里用 indexOf 从前一个节点
 * 末尾向后搜到本节点文本的位置，得到「markdown 偏移 ↔ 节点 key + 偏移」的
 * 锚点表。markdown 语法字符（#、**、表格竖线、图片语法、frontmatter）不进入
 * 节点文本，自然落在锚点间隙里，被跳过。
 *
 * 匹配查找仍在 bar 内对 markdown 原文做（与源码模式口径一致），仅定位/高亮
 * 走这里。跨节点的区间取首末锚点，中间的非文本区间由 Lexical 选区自然覆盖。
 */

export const WORKBENCH_REVEAL_RANGE_COMMAND = createCommand<{ start: number; end: number }>(
  'workbench:reveal-range'
)

/** 当前激活的 provider（工作台同时只有一个富文本编辑器实例） */
let activeEditor: LexicalEditor | null = null

/** 在 Lexical 编辑器内选中 markdown 区间 [start, end)；非富文本态时返回 false */
export function revealRangeInLexical(start: number, end: number): boolean {
  const editor = activeEditor
  if (!editor) return false
  editor.dispatchCommand(WORKBENCH_REVEAL_RANGE_COMMAND, { start, end })
  return true
}

interface Anchor {
  /** 该 TextNode 文本在 markdown 中的起始偏移 */
  mdStart: number
  /** TextNode 节点 key */
  key: string
  /** TextNode 文本长度 */
  length: number
}

/** 按文档序收集可见文本节点（含 slots 内的 table/link 文本），与 export 口径一致 */
function $collectTextNodes(): LexicalNode[] {
  const out: LexicalNode[] = []
  const walk = (node: LexicalNode): void => {
    if ($isTextNode(node)) {
      if (node.getTextContent().length > 0) out.push(node)
      return
    }
    if ($isElementNode(node)) {
      const children = node.getChildren()
      for (const child of children) walk(child)
      return
    }
  }
  walk($getRoot())
  return out
}

/**
 * 用 markdown 原文重建锚点表：对每个 TextNode，从 searchFrom 起用 indexOf
 * 定位其文本在 markdown 中的位置。定位失败的节点（重导出改写了文本，如表格
 * 单元格 trim、图片 alt）保留 key 但 mdStart = -1，作为不可命中边界。
 */
function $buildAnchors(markdown: string): Anchor[] {
  const nodes = $collectTextNodes()
  const anchors: Anchor[] = []
  let searchFrom = 0
  for (const n of nodes) {
    const text = n.getTextContent()
    const key = n.getKey()
    const idx = markdown.indexOf(text, searchFrom)
    if (idx === -1) {
      anchors.push({ mdStart: -1, key, length: text.length })
      continue
    }
    anchors.push({ mdStart: idx, key, length: text.length })
    searchFrom = idx + text.length
  }
  return anchors
}

/** markdown 偏移 → (nodeKey, offsetInNode)；不在任何节点内时返回最近的节点边界 */
function locate(
  anchors: Anchor[],
  mdOffset: number
): { key: string; offset: number } | null {
  if (anchors.length === 0) return null
  let prev: Anchor | null = null
  for (const a of anchors) {
    if (a.mdStart === -1) continue
    if (mdOffset < a.mdStart) {
      // 落在 prev 与 a 之间的语法区：归入 prev 末尾（prev 为空则给 a 起点）
      if (prev) return { key: prev.key, offset: prev.length }
      return { key: a.key, offset: 0 }
    }
    if (mdOffset <= a.mdStart + a.length) {
      return { key: a.key, offset: mdOffset - a.mdStart }
    }
    prev = a
  }
  const last = anchors[anchors.length - 1]
  return { key: last.key, offset: last.length }
}

export default function WorkbenchFindHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    activeEditor = editor
    return () => {
      if (activeEditor === editor) activeEditor = null
    }
  }, [editor])

  useEffect(() => {
    return editor.registerCommand(
      WORKBENCH_REVEAL_RANGE_COMMAND,
      (payload) => {
        if (!payload) return false
        const md = useWorkbenchStore.getState().activeFileContent
        const anchors = $buildAnchors(md)
        const a = locate(anchors, payload.start)
        const b = locate(anchors, payload.end)
        if (!a || !b) return false
        const aNode = $getNodeByKey(a.key)
        const bNode = $getNodeByKey(b.key)
        if (!aNode || !bNode || !$isTextNode(aNode) || !$isTextNode(bNode)) return false
        // 先聚焦编辑器，让原生选区高亮在预览态也能渲染
        const sel = $createRangeSelection()
        sel.anchor.set(a.key, a.offset, 'text')
        sel.focus.set(b.key, b.offset, 'text')
        $setSelection(sel)
        editor.focus()
        requestAnimationFrame(() => {
          try {
            editor.getElementByKey(b.key)?.scrollIntoView({ block: 'center' })
          } catch {
            /* noop */
          }
        })
        return true
      },
      COMMAND_PRIORITY_EDITOR
    )
  }, [editor])

  return null
}
