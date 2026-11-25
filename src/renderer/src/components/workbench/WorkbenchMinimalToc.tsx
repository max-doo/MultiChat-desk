import { useCallback, useEffect, useState, type JSX } from 'react'
import { $getRoot } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'
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

  // 扫描与监听 Lexical 编辑器中的所有标题节点
  useEffect(() => {
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

    updateHeadings()
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
      updateHeadings()
    })
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
