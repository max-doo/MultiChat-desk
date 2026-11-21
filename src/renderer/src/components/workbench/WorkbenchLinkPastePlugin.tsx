import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createLineBreakNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type PasteCommandType,
  type LexicalNode
} from 'lexical'
import { $isCodeNode } from '@lexical/code'
import { $createAutoLinkNode, $isLinkNode } from '@lexical/link'
import { matchBareLink } from './workbenchBareLinks'

function $createNodesFromPlainText(text: string): LexicalNode[] | null {
  const nodes: LexicalNode[] = []
  let hasLink = false
  const lines = text.split(/\r?\n/)

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) nodes.push($createLineBreakNode())

    let cursor = 0
    while (cursor < line.length) {
      const match = matchBareLink(line.slice(cursor))
      if (!match) {
        nodes.push($createTextNode(line.slice(cursor)))
        break
      }

      if (match.index > 0) {
        nodes.push($createTextNode(line.slice(cursor, cursor + match.index)))
      }

      const linkNode = $createAutoLinkNode(match.url)
      linkNode.append($createTextNode(match.text))
      nodes.push(linkNode)
      hasLink = true
      cursor += match.index + match.length
    }
  })

  return hasLink ? nodes : null
}

function isBareLinkOnly(text: string): boolean {
  let hasLink = false
  for (const line of text.split(/\r?\n/)) {
    let rest = line.trim()
    while (rest) {
      const match = matchBareLink(rest)
      if (!match || match.index !== 0) return false
      hasLink = true
      rest = rest.slice(match.length).trimStart()
    }
  }
  return hasLink
}

/**
 * 粘贴纯文本时立即把裸 URL 转成 AutoLinkNode，避免等重新打开文档后才识别。
 * 带 HTML 的剪贴板继续交给 Lexical 默认粘贴以保留富文本结构；
 * 唯一例外是整个剪贴板只有裸链接，此时格式没有保留价值，直接识别更符合预期。
 */
export default function WorkbenchLinkPastePlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: PasteCommandType) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false
        if (event.clipboardData.files.length > 0) return false

        const text = event.clipboardData.getData('text/plain')
        if (!text) return false
        if (
          event.clipboardData.getData('text/html').trim() &&
          !isBareLinkOnly(text)
        ) {
          return false
        }

        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        const anchorNode = selection.anchor.getNode()
        if (
          $isCodeNode(anchorNode) ||
          $isCodeNode(anchorNode.getParent()) ||
          $isLinkNode(anchorNode) ||
          $isLinkNode(anchorNode.getParent()) ||
          ($isTextNode(anchorNode) && anchorNode.hasFormat('code'))
        ) {
          return false
        }

        const nodes = $createNodesFromPlainText(text)
        if (!nodes) return false
        selection.insertNodes(nodes)
        event.preventDefault()
        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor])

  return null
}
