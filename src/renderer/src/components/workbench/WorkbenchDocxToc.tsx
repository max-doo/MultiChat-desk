import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import WorkbenchTocRail, { type TocItem } from './WorkbenchTocRail'

interface DocxParagraphLike {
  type?: string
  styleName?: string
  outlineLevel?: number
  children?: DocxParagraphLike[] | undefined
  text?: string
}

export interface DocxDocumentLike {
  documentPart?: {
    body?: {
      children?: DocxParagraphLike[]
    }
  }
  stylesPart?: {
    styles?: Array<{ id?: string; paragraphProps?: { outlineLevel?: number } }>
  }
}

interface Props {
  /** docx-preview parseAsync 返回的 WordDocument（保留结构，非类型化）。 */
  document: DocxDocumentLike | null
  contentRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  /** docx-preview 异步渲染完成才扫描 DOM；loading/error 时清空。 */
  loadState: 'loading' | 'ready' | 'error'
}

/**
 * 递归收集 paragraph 内所有 text 字段，跳过 tab/break 等非文本节点。
 * docx-preview 的 Text 节点是 { type:'text', text } 平铺字段，
 * Run/Hyperlink/SmartTag 等再包一层 children。
 */
function paragraphText(p: DocxParagraphLike): string {
  if (typeof p.text === 'string') return p.text
  if (!Array.isArray(p.children)) return ''
  return p.children.map(paragraphText).join('')
}

/**
 * docx-preview 不会把 outlineLevel 渲染到 DOM，所以从 WordDocument 树里
 * 按文档顺序收集 outlineLevel < 9 的段落文本（Word 大纲的真正来源），
 * 再按出现顺序匹配到渲染后的 <p> 元素。
 *
 * outlineLevel 的语义是 Word 的 w:outlineLvl：0=一级，依次递增；
 * 显示时 +1 与 Word UI 的"1 级/2 级"对齐。
 *
 * 段落本身没写 outlineLvl 时，按 styleName 回查样式表继承；
 * 目录域 (docx_toc*) 等段落不带 outlineLevel，天然被排除。
 */
function collectOutlines(document: DocxDocumentLike): Array<{ text: string; level: number }> {
  const styles = document.stylesPart?.styles
  const styleLevelById = new Map<string, number>()
  if (Array.isArray(styles)) {
    for (const s of styles) {
      const level = s?.paragraphProps?.outlineLevel
      if (s?.id && typeof level === 'number') styleLevelById.set(s.id, level)
    }
  }

  const out: Array<{ text: string; level: number }> = []
  const visit = (node: DocxParagraphLike): void => {
    if (!node) return
    if (node.type === 'paragraph') {
      const own = typeof node.outlineLevel === 'number' ? node.outlineLevel : undefined
      const viaStyle = node.styleName ? styleLevelById.get(node.styleName) : undefined
      const level = own ?? viaStyle
      if (typeof level === 'number' && level >= 0 && level < 9) {
        const text = paragraphText(node).trim()
        if (text) out.push({ text, level: level + 1 })
      }
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) visit(c)
    }
  }

  const body = document.documentPart?.body
  if (body?.children) {
    for (const c of body.children) visit(c)
  }
  return out
}

/**
 * 把 WordDocument 中提取到的标题序列与渲染后 DOM 的 <p> 按顺序对齐。
 * 两段文本完全相等才匹配；同一标题文字出现多次时，
 * 用游标单调前进保证不会错位回滚。
 */
function matchHeadingsToDom(
  outlines: Array<{ text: string; level: number }>,
  container: HTMLElement
): Array<{ key: string; element: HTMLElement; level: number; title: string }> {
  const paragraphs = Array.from(container.querySelectorAll<HTMLElement>('p'))
  const items: Array<{ key: string; element: HTMLElement; level: number; title: string }> = []
  let cursor = 0
  for (const outline of outlines) {
    for (let i = cursor; i < paragraphs.length; i++) {
      const p = paragraphs[i]
      if ((p.textContent ?? '').trim() !== outline.text) continue
      items.push({
        key: String(i),
        element: p,
        level: outline.level,
        title: outline.text
      })
      cursor = i + 1
      break
    }
  }
  return items
}

/**
 * Workbench 极简原位变形 Word 大纲导航（docx-preview 数据源）
 *
 * UI 复用 WorkbenchTocRail，本组件只负责：
 * 1. 从 WordDocument 树中提取 outlineLevel 段落；
 * 2. 按文档顺序把标题匹配到渲染后 DOM 的 <p>；
 * 3. 提供 key → DOM 的解析能力给 scrollspy 与点击定位。
 */
export default function WorkbenchDocxToc({
  document: docxDocument,
  contentRef,
  scrollContainerRef,
  loadState
}: Props): JSX.Element | null {
  const [items, setItems] = useState<TocItem[]>([])
  const elementMapRef = useRef<Map<string, HTMLElement>>(new Map())

  // 渲染完成后从 docx 文档树收集 outline 并匹配到 DOM；loading/error 状态清空
  useEffect(() => {
    elementMapRef.current.clear()
    if (loadState !== 'ready' || !docxDocument || !contentRef.current) {
      setItems([])
      return
    }
    const outlines = collectOutlines(docxDocument)
    const matched = matchHeadingsToDom(outlines, contentRef.current)
    for (const m of matched) {
      elementMapRef.current.set(m.key, m.element)
    }
    setItems(matched.map((m) => ({ key: m.key, level: m.level, title: m.title })))
  }, [loadState, docxDocument, contentRef])

  const resolveElement = useCallback(
    (key: string): HTMLElement | null => elementMapRef.current.get(key) ?? null,
    []
  )

  return (
    <WorkbenchTocRail
      items={items}
      scrollContainerRef={scrollContainerRef}
      resolveElement={resolveElement}
    />
  )
}
