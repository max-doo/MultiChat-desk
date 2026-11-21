import { useCallback } from 'react'
import type { LexicalEditor } from 'lexical'
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type RangeSelection
} from 'lexical'
import { $findMatchingParent } from '@lexical/utils'
import { $createLinkNode, $isLinkNode, $toggleLink, type LinkNode } from '@lexical/link'
import WorkbenchUrlInputPopover from './WorkbenchUrlInputPopover'

function $getSelectedLinkNode(selection: RangeSelection): LinkNode | null {
  const linkNode = $findMatchingParent(selection.anchor.getNode(), $isLinkNode)
  return linkNode && $isLinkNode(linkNode) ? linkNode : null
}

interface WorkbenchLinkEditorProps {
  editor: LexicalEditor
  anchorRect: DOMRect
  initialUrl: string | null
  onClose: () => void
}

/**
 * Lexical 链接编辑：把通用 URL 弹层的结果应用到当前选区，
 * 已有链接支持直接移除。
 */
export default function WorkbenchLinkEditor({
  editor,
  anchorRect,
  initialUrl,
  onClose
}: WorkbenchLinkEditorProps): JSX.Element {
  const applyLink = useCallback(
    (nextUrl: string) => {
      editor.update(
        () => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return

          const existingLink = $getSelectedLinkNode(selection)
          if (existingLink) {
            existingLink.setURL(nextUrl)
            existingLink.setRel('noreferrer')
            return
          }

          if (selection.isCollapsed()) {
            const linkNode = $createLinkNode(nextUrl, { rel: 'noreferrer' })
            linkNode.append($createTextNode(nextUrl))
            selection.insertNodes([linkNode])
            linkNode.selectNext(0, 0)
            return
          }

          $toggleLink(nextUrl, { rel: 'noreferrer' })
        },
        { discrete: true }
      )
      editor.focus()
    },
    [editor]
  )

  const removeLink = useCallback(() => {
    editor.update(
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const linkNode = $getSelectedLinkNode(selection)
        if (!linkNode) return

        for (const child of linkNode.getChildren().slice()) {
          linkNode.insertBefore(child)
        }
        linkNode.remove()
      },
      { discrete: true }
    )
    editor.focus()
  }, [editor])

  return (
    <WorkbenchUrlInputPopover
      anchorRect={anchorRect}
      initialUrl={initialUrl}
      onApply={applyLink}
      onRemove={initialUrl !== null ? removeLink : undefined}
      onClose={onClose}
    />
  )
}
