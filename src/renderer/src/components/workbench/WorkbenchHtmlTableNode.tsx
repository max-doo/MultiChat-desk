import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { $applyNodeReplacement, $getNodeByKey } from 'lexical'
import type { ElementFormatType, LexicalNode, NodeKey, Spread } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode
} from '@lexical/react/LexicalDecoratorBlockNode'
import { BlockWithAlignableContents } from '@lexical/react/LexicalBlockWithAlignableContents'

export type SerializedWorkbenchHtmlTableNode = Spread<
  {
    html: string
  },
  SerializedDecoratorBlockNode
>

/**
 * 工作台 HTML 表格节点
 * - 保留原始 HTML，源码模式与 Markdown 回写不会丢失 rowspan/colspan
 * - 富文本模式按安全白名单渲染，并允许修改已有单元格内容
 */
export class WorkbenchHtmlTableNode extends DecoratorBlockNode {
  __html: string

  static getType(): string {
    return 'workbench-html-table'
  }

  static clone(node: WorkbenchHtmlTableNode): WorkbenchHtmlTableNode {
    return new WorkbenchHtmlTableNode(node.__html, node.__key)
  }

  constructor(html: string, key?: NodeKey) {
    super('', key)
    this.__html = html
  }

  exportJSON(): SerializedWorkbenchHtmlTableNode {
    return {
      ...super.exportJSON(),
      html: this.__html
    }
  }

  static importJSON(serializedNode: SerializedWorkbenchHtmlTableNode): WorkbenchHtmlTableNode {
    return $applyNodeReplacement($createWorkbenchHtmlTableNode(serializedNode.html))
  }

  getHtml(): string {
    return this.getLatest().__html
  }

  setHtml(html: string): this {
    const self = this.getWritable()
    self.__html = html
    return self
  }

  getTextContent(): string {
    return this.getLatest().__html
  }

  createDOM(): HTMLElement {
    return document.createElement('div')
  }

  updateDOM(): false {
    return false
  }

  isInline(): false {
    return false
  }

  decorate(): JSX.Element {
    return (
      <WorkbenchHtmlTableComponent
        html={this.__html}
        nodeKey={this.getKey()}
        format={this.__format as ElementFormatType}
      />
    )
  }
}

export function $createWorkbenchHtmlTableNode(html: string): WorkbenchHtmlTableNode {
  return $applyNodeReplacement(new WorkbenchHtmlTableNode(html))
}

export function $isWorkbenchHtmlTableNode(
  node: LexicalNode | null | undefined
): node is WorkbenchHtmlTableNode {
  return node instanceof WorkbenchHtmlTableNode
}

interface WorkbenchHtmlTableComponentProps {
  html: string
  nodeKey: NodeKey
  format: ElementFormatType | ''
}

interface TableCellModel {
  index: number
  tag: 'th' | 'td'
  rowSpan?: number
  colSpan?: number
  align?: 'left' | 'center' | 'right'
  content: ReactNode
}

interface TableRowModel {
  cells: TableCellModel[]
}

interface TableSectionModel {
  tag: 'thead' | 'tbody' | 'tfoot'
  rows: TableRowModel[]
}

interface TableModel {
  caption: ReactNode
  sections: TableSectionModel[]
}

const SAFE_INLINE_TAGS = new Set([
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'strike',
  'code',
  'mark',
  'small',
  'sub',
  'sup',
  'span'
])

const SAFE_BLOCK_TAGS = new Set(['p', 'div'])
const SAFE_FRAGMENT_TAGS = new Set([...SAFE_INLINE_TAGS, ...SAFE_BLOCK_TAGS])

function parseSpan(value: string | null): number | undefined {
  if (!value) return undefined
  const span = Number.parseInt(value, 10)
  return Number.isFinite(span) && span > 0 ? Math.min(span, 1000) : undefined
}

function parseAlign(cell: HTMLTableCellElement): 'left' | 'center' | 'right' | undefined {
  const attr = (cell.getAttribute('align') || '').toLowerCase()
  if (attr === 'left' || attr === 'center' || attr === 'right') return attr

  const styleAlign = cell.style.textAlign.toLowerCase()
  if (styleAlign === 'left' || styleAlign === 'center' || styleAlign === 'right') {
    return styleAlign
  }
  return undefined
}

function isSafeLink(href: string | null): href is string {
  if (!href) return false
  try {
    const url = new URL(href, window.location.href)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sanitizeHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.nodeValue || '')
  }
  if (!(node instanceof HTMLElement)) return ''

  const tag = node.tagName.toLowerCase()
  const children = Array.from(node.childNodes).map(sanitizeHtmlNode).join('')
  if (tag === 'br') return '<br>'
  if (tag === 'a') {
    const href = node.getAttribute('href')
    return isSafeLink(href) ? `<a href="${escapeHtml(href)}">${children}</a>` : children
  }
  if (SAFE_FRAGMENT_TAGS.has(tag)) {
    return `<${tag}>${children}</${tag}>`
  }
  return children
}

function sanitizeCellInnerHtml(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(documentNode.body.childNodes).map(sanitizeHtmlNode).join('')
}

function updateTableCellHtml(sourceHtml: string, cellIndex: number, cellHtml: string): string {
  const documentNode = new DOMParser().parseFromString(sourceHtml, 'text/html')
  const table = documentNode.body.querySelector('table')
  if (!table) return sourceHtml

  const cell = Array.from(table.rows)
    .flatMap((row) => Array.from(row.cells))
    .find((_cell, index) => index === cellIndex)
  if (!cell || cell.innerHTML === cellHtml) return sourceHtml

  cell.innerHTML = cellHtml
  const tableStart = sourceHtml.toLowerCase().indexOf('<table')
  const tableEndTag = '</table>'
  const tableEnd = sourceHtml.toLowerCase().lastIndexOf(tableEndTag)
  if (tableStart < 0 || tableEnd < tableStart) return table.outerHTML
  return sourceHtml.slice(0, tableStart) + table.outerHTML + sourceHtml.slice(tableEnd + tableEndTag.length)
}

function renderHtmlNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue
  }
  if (!(node instanceof HTMLElement)) return null

  const tag = node.tagName.toLowerCase()
  const children = Array.from(node.childNodes).map((child, index) =>
    renderHtmlNode(child, `${key}-${index}`)
  )

  if (tag === 'br') return <br key={key} />
  if (tag === 'strong' || tag === 'b') return <strong key={key}>{children}</strong>
  if (tag === 'em' || tag === 'i') return <em key={key}>{children}</em>
  if (tag === 'u') return <u key={key}>{children}</u>
  if (tag === 's' || tag === 'del' || tag === 'strike') return <s key={key}>{children}</s>
  if (tag === 'code') {
    return (
      <code key={key} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/10">
        {children}
      </code>
    )
  }
  if (tag === 'mark') {
    return (
      <mark key={key} className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-400/30">
        {children}
      </mark>
    )
  }
  if (tag === 'small') return <small key={key}>{children}</small>
  if (tag === 'sub') return <sub key={key}>{children}</sub>
  if (tag === 'sup') return <sup key={key}>{children}</sup>
  if (tag === 'a') {
    const href = node.getAttribute('href')
    if (!isSafeLink(href)) return <span key={key}>{children}</span>
    return (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    )
  }
  if (SAFE_BLOCK_TAGS.has(tag)) {
    return (
      <span key={key} className="block">
        {children}
      </span>
    )
  }
  if (SAFE_INLINE_TAGS.has(tag)) {
    return <span key={key}>{children}</span>
  }

  return <span key={key}>{children}</span>
}

function parseHtmlTable(html: string): TableModel | null {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  const table = documentNode.body.querySelector('table')
  if (!table) return null
  const cellIndexByElement = new Map<Element, number>()
  let nextCellIndex = 0
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      cellIndexByElement.set(cell, nextCellIndex++)
    }
  }

  const caption = Array.from(table.children).find(
    (child) => child.tagName.toLowerCase() === 'caption'
  )
  const sections: TableSectionModel[] = []
  let implicitBody: TableSectionModel | null = null

  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toLowerCase()
    if (tag === 'caption') continue

    let sectionTag: TableSectionModel['tag']
    let rowElements: Element[]
    if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      sectionTag = tag
      rowElements = Array.from(child.children).filter(
        (row): row is Element => row.tagName.toLowerCase() === 'tr'
      )
    } else if (tag === 'tr') {
      sectionTag = 'tbody'
      rowElements = [child]
    } else {
      continue
    }

    const rows = rowElements.map((rowElement, rowIndex) => {
      const cells = Array.from(rowElement.children)
        .filter((cell) => {
          const cellTag = cell.tagName.toLowerCase()
          return cellTag === 'td' || cellTag === 'th'
        })
        .map((cellElement, cellIndex): TableCellModel | null => {
          if (!(cellElement instanceof HTMLTableCellElement)) return null
          const tagName = cellElement.tagName.toLowerCase()
          const flatCellIndex = cellIndexByElement.get(cellElement)
          if (flatCellIndex === undefined) return null
          return {
            index: flatCellIndex,
            tag: tagName === 'th' ? 'th' : 'td',
            rowSpan: parseSpan(cellElement.getAttribute('rowspan')),
            colSpan: parseSpan(cellElement.getAttribute('colspan')),
            align: parseAlign(cellElement),
            content: Array.from(cellElement.childNodes).map((node, nodeIndex) =>
              renderHtmlNode(node, `cell-${rowIndex}-${cellIndex}-${nodeIndex}`)
            )
          }
        })
        .filter((cell): cell is TableCellModel => cell !== null)

      return { cells }
    })

    if (!rows.some((row) => row.cells.length > 0)) continue
    if (tag === 'tr') {
      implicitBody ||= { tag: 'tbody', rows: [] }
      implicitBody.rows.push(...rows)
    } else {
      sections.push({ tag: sectionTag, rows })
    }
  }

  if (implicitBody) sections.push(implicitBody)
  if (sections.length === 0) return null

  return {
    caption: caption
      ? Array.from(caption.childNodes).map((node, index) =>
          renderHtmlNode(node, `caption-${index}`)
        )
      : null,
    sections
  }
}

function WorkbenchHtmlTableComponent({
  html,
  nodeKey,
  format
}: WorkbenchHtmlTableComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [table, setTable] = useState<TableModel | null>(() => parseHtmlTable(html))
  const lastCommittedHtmlRef = useRef<string | null>(null)
  const focusedCellRef = useRef<{ index: number; html: string } | null>(null)

  useEffect(() => {
    if (html === lastCommittedHtmlRef.current) return
    setTable(parseHtmlTable(html))
  }, [html])

  const commitCell = useCallback(
    (cellIndex: number, cellElement: HTMLTableCellElement, baselineHtml: string): void => {
      const currentHtml = cellElement.innerHTML
      if (currentHtml === baselineHtml) return

      const nextHtml = updateTableCellHtml(
        html,
        cellIndex,
        sanitizeCellInnerHtml(currentHtml)
      )
      if (nextHtml === html) return

      lastCommittedHtmlRef.current = nextHtml
      editor.update(
        () => {
          const node = $getNodeByKey(nodeKey)
          if ($isWorkbenchHtmlTableNode(node)) node.setHtml(nextHtml)
        },
        { discrete: true }
      )
    },
    [editor, html, nodeKey]
  )

  return (
    <BlockWithAlignableContents
      className={{
        base: 'my-4 max-w-full overflow-x-auto',
        focus: 'ring-2 ring-primary/40 rounded-lg'
      }}
      format={format}
      nodeKey={nodeKey}
    >
      {table ? (
        <table className="w-full border-collapse text-sm leading-relaxed">
          {table.caption && (
            <caption className="mb-2 text-left text-xs text-text-secondary">
              {table.caption}
            </caption>
          )}
          {table.sections.map((section, sectionIndex) => {
            const SectionTag = section.tag
            return (
              <SectionTag key={sectionIndex}>
                {section.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={
                      section.tag === 'thead' || (sectionIndex === 0 && rowIndex === 0)
                        ? 'bg-black/[0.04] dark:bg-white/[0.06]'
                        : undefined
                    }
                  >
                    {row.cells.map((cell, cellIndex) => {
                      const CellTag = cell.tag
                      const header =
                        cell.tag === 'th' || (sectionIndex === 0 && rowIndex === 0)
                      return (
                        <CellTag
                          key={cellIndex}
                          rowSpan={cell.rowSpan}
                          colSpan={cell.colSpan}
                          style={cell.align ? { textAlign: cell.align } : undefined}
                          contentEditable
                          suppressContentEditableWarning
                          spellCheck={false}
                          data-workbench-html-table-cell={cell.index}
                          onFocus={(event) => {
                            focusedCellRef.current = {
                              index: cell.index,
                              html: event.currentTarget.innerHTML
                            }
                          }}
                          onBlur={(event) => {
                            const focused = focusedCellRef.current
                            focusedCellRef.current = null
                            if (!focused || focused.index !== cell.index) return
                            commitCell(cell.index, event.currentTarget, focused.html)
                          }}
                          onKeyDown={(event) => {
                            if (!(event.ctrlKey || event.metaKey)) return
                            if (event.key.toLowerCase() !== 's') return
                            const focused = focusedCellRef.current
                            if (!focused || focused.index !== cell.index) return
                            commitCell(cell.index, event.currentTarget, focused.html)
                          }}
                          className={`cursor-text select-text border border-black/15 px-3 py-2 align-top outline-none transition-colors hover:bg-black/[0.02] focus:bg-primary/[0.04] focus:ring-1 focus:ring-inset focus:ring-primary/30 dark:border-white/15 dark:hover:bg-white/[0.03] ${
                            header ? 'font-medium text-text-primary' : 'text-text-primary'
                          }`}
                        >
                          {cell.content}
                        </CellTag>
                      )
                    })}
                  </tr>
                ))}
              </SectionTag>
            )
          })}
        </table>
      ) : (
        <pre className="overflow-x-auto rounded-lg bg-black/5 p-3 text-xs text-text-secondary dark:bg-white/5">
          {html}
        </pre>
      )}
    </BlockWithAlignableContents>
  )
}
