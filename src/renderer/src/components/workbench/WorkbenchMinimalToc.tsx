import { useCallback, useEffect, useState, type JSX } from 'react'
import { $getRoot, type LexicalNode, type NodeKey } from 'lexical'
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import WorkbenchTocRail, { type TocItem } from './WorkbenchTocRail'

export interface HeadingItem {
  key: string
  level: number
  title: string
}

interface Props {
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * Workbench 极简原位变形 Markdown 大纲导航（Lexical 数据源）
 * UI 复用 WorkbenchTocRail，本组件只负责：
 * 1. 监听 Lexical 编辑器状态，提取所有 HeadingNode；
 * 2. 提供 key → DOM 的解析能力给 scrollspy 与点击定位。
 */
export default function WorkbenchMinimalToc({ scrollContainerRef }: Props): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState<TocItem[]>([])

  // 扫描与监听 Lexical 编辑器中的所有标题节点（仅在标题变更时 200ms 防抖重建）
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const updateHeadings = (): void => {
      editor.getEditorState().read(() => {
        const root = $getRoot()
        const items: TocItem[] = []
        for (const child of root.getChildren()) {
          if ($isHeadingNode(child)) {
            const tag = child.getTag()
            const level = parseInt(tag.slice(1), 10) || 2
            const title = child.getTextContent().trim()
            if (title) {
              items.push({
                key: child.getKey(),
                level,
                title
              })
            }
          }
        }
        setHeadings((prev) => {
          if (
            prev.length === items.length &&
            prev.every(
              (item, idx) =>
                item.key === items[idx].key &&
                item.level === items[idx].level &&
                item.title === items[idx].title
            )
          ) {
            return prev
          }
          return items
        })
      })
    }

    const scheduleUpdate = (): void => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        updateHeadings()
      }, 200)
    }

    updateHeadings()
    const unregister = mergeRegister(
      editor.registerMutationListener(HeadingNode, () => {
        scheduleUpdate()
      }),
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
        if (tags.has('sync-external')) {
          if (debounceTimer) {
            clearTimeout(debounceTimer)
            debounceTimer = null
          }
          updateHeadings()
          return
        }
        // 正文普通段落打字时快速检查 dirty 节点是否涉及 HeadingNode，避免每键扫全树
        const touchesHeading = editorState.read(() => {
          const hasHeadingAncestor = (nodeKey: NodeKey): boolean => {
            let node: LexicalNode | null = editorState._nodeMap.get(nodeKey) ?? null
            while (node) {
              if ($isHeadingNode(node)) return true
              node = node.getParent()
            }
            return false
          }
          for (const key of dirtyLeaves) {
            if (hasHeadingAncestor(key)) return true
          }
          for (const [key] of dirtyElements) {
            if (key !== 'root' && hasHeadingAncestor(key)) return true
          }
          return false
        })
        if (touchesHeading) {
          scheduleUpdate()
        }
      })
    )

    return () => {
      unregister()
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
    }
  }, [editor])

  const resolveElement = useCallback(
    (key: string): HTMLElement | null => editor.getElementByKey(key),
    [editor]
  )

  return (
    <WorkbenchTocRail
      items={headings}
      scrollContainerRef={scrollContainerRef}
      resolveElement={resolveElement}
    />
  )
}
