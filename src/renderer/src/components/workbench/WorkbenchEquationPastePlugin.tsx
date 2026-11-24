import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type PasteCommandType
} from 'lexical'
import { $isCodeNode } from '@lexical/code'
import { $generateNodesFromMarkdownString } from '@lexical/markdown'
import { WORKBENCH_TRANSFORMERS } from './MarkdownSyncPlugin'

/**
 * 粘贴含 $...$ / $$...$$ 的纯文本时，按 markdown 重新生成节点，
 * 让公式立即转成 WorkbenchEquationNode，而不是以纯文本落进段落被 export 二次转义。
 *
 * 只在 text/plain 且确实含 $ 时拦截，含 HTML / 文件的剪贴板仍走 Lexical 默认粘贴；
 * 代码块/inline-code 内的粘贴放行原样插入（公式语法在代码里是字面量）。
 */
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

        const nodes = $generateNodesFromMarkdownString(text, WORKBENCH_TRANSFORMERS)
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
