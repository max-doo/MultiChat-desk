import {
  $getRoot,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode
} from 'lexical'
import { $isMarkNode, MarkNode } from '@lexical/mark'

export function unwrapMark(mark: MarkNode): void {
  const children = mark.getChildren()
  children.forEach(child => mark.insertBefore(child))
  mark.remove()
}

export function allMarks(): MarkNode[] {
  const marks: MarkNode[] = []
  const walk = (node: LexicalNode): void => {
    if ($isMarkNode(node)) marks.push(node)
    if ($isElementNode(node)) node.getChildren().forEach(walk)
  }
  walk($getRoot())
  return marks
}

export function unwrapAllMarks(): void {
  allMarks().forEach(unwrapMark)
}

/** 沿子节点反查命中 MarkNode 对应的 annotation ID */
export function markAtTarget(editor: LexicalEditor, target: Node): string | null {
  for (const mark of allMarks()) {
    for (const child of mark.getChildren()) {
      const dom = editor.getElementByKey(child.getKey())
      if (dom?.contains(target)) return mark.getIDs().find(Boolean) ?? null
    }
  }
  return null
}

/** 查找指定 ID 的标注在正文中的第一个 DOM 节点，用于精确测量垂直定位 */
export function findMarkDom(editor: LexicalEditor, id: string): HTMLElement | null {
  return editor.getEditorState().read(() => {
    for (const mark of allMarks()) {
      if (mark.hasID(id)) {
        for (const child of mark.getChildren()) {
          const dom = editor.getElementByKey(child.getKey())
          if (dom) return dom as HTMLElement
        }
      }
    }
    return null
  })
}

/** 在 Lexical 中安全解除指定 ID 的 MarkNode 包裹，恢复正文原始文本 */
export function removeMarkById(editor: LexicalEditor, id: string): void {
  editor.update(
    () => {
      for (const mark of allMarks()) {
        if (mark.hasID(id)) {
          if (mark.getIDs().length > 1) {
            mark.deleteID(id)
          } else {
            unwrapMark(mark)
          }
        }
      }
    },
    { tag: 'annotation-sync', discrete: true }
  )
}
