import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type LexicalNode,
  type PasteCommandType
} from 'lexical'
import { $isCodeNode } from '@lexical/code'
import { $generateNodesFromMarkdownString } from '@lexical/markdown'
import { WORKBENCH_TRANSFORMERS } from './MarkdownSyncPlugin'
import { $createWorkbenchEquationNode } from './WorkbenchEquationNode'
import { splitEquationPaste } from './equationPaste'

/**
 * 公式块直接建 WorkbenchEquationNode，文本块走标准 markdown 导入。
 * $$ 块不走 markdown 导入：@lexical/markdown 会把 LaTeX 反斜杠与行尾硬换行吃掉。
 */
export function $buildEquationPasteNodes(text: string): LexicalNode[] | null {
  const slices = splitEquationPaste(text)
  if (!slices) return null
  const nodes: LexicalNode[] = []
  for (const slice of slices) {
    if (slice.kind === 'equation') {
      nodes.push($createWorkbenchEquationNode(slice.text, false))
    } else {
      nodes.push(...$generateNodesFromMarkdownString(slice.text, WORKBENCH_TRANSFORMERS))
    }
  }
  return nodes
}

export default function WorkbenchEquationPastePlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: PasteCommandType) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false
        if (event.clipboardData.files.length > 0) return false

        const text = event.clipboardData.getData('text/plain')
        console.info('[EquationPaste] PASTE_COMMAND 收到', {
          hasText: Boolean(text),
          hasDollar: text.includes('$'),
          preview: text.slice(0, 80)
        })
        if (!text || !text.includes('$')) return false

        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        const anchorNode = selection.anchor.getNode()
        if (
          $isCodeNode(anchorNode) ||
          $isCodeNode(anchorNode.getParent()) ||
          ($isTextNode(anchorNode) && anchorNode.hasFormat('code'))
        ) {
          return false
        }

        const blockNodes = $buildEquationPasteNodes(text)
        const nodes =
          blockNodes ?? $generateNodesFromMarkdownString(text, WORKBENCH_TRANSFORMERS)
        if (nodes.length === 0) return false

        // 没有任何方程节点时放行，避免误伤普通含 $ 的文本（如货币 $100）
        const hasEquationNode = nodes.some((node) =>
          node.getType() === 'workbench-equation'
        )
        if (!hasEquationNode) return false

        selection.insertNodes(nodes)
        event.preventDefault()
        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor])

  return null
}
