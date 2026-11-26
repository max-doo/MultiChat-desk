import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type {
  EditorState,
  LexicalEditor,
  LexicalNode,
  ParsableSerializedNode,
  PointType,
  TextNode
} from 'lexical'
import {
  $addUpdateTag,
  $createTextNode,
  $isParagraphNode,
  $isTextNode,
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $createRangeSelection,
  CLEAR_HISTORY_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_EDITOR
} from 'lexical'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  LINK,
  TRANSFORMERS,
  CHECK_LIST,
  isTableRowDivider,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextMatchTransformer
} from '@lexical/markdown'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableRowNode,
  TableCellNode,
  TableNode
} from '@lexical/table'
import { $findMatchingParent } from '@lexical/utils'
import {
  $createAutoLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  AutoLinkNode
} from '@lexical/link'
import {
  $isHorizontalRuleNode
} from '@lexical/react/LexicalHorizontalRuleNode'
import {
  $createWorkbenchHorizontalRuleNode,
  $isWorkbenchHorizontalRuleNode,
  WorkbenchHorizontalRuleNode,
  type HorizontalRuleMarkerStyle
} from './WorkbenchHorizontalRuleNode'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { upsertConversationFrontmatter } from '../../../../shared/utils/conversationFrontmatter'
import {
  $createPendingInsertNode,
  $isPendingInsertNode,
  INSERT_REPLY_COMMAND,
  CONFIRM_INSERT_COMMAND,
  CANCEL_INSERT_COMMAND
} from './PendingInsertNode'
import { $createPendingBarNode, $isPendingBarNode } from './PendingBarNode'
import {
  $createWorkbenchHtmlTableNode,
  $isWorkbenchHtmlTableNode,
  WorkbenchHtmlTableNode
} from './WorkbenchHtmlTableNode'
import {
  $createWorkbenchImageNode,
  $isWorkbenchImageNode,
  WorkbenchImageNode
} from './WorkbenchImageNode'
import {
  BARE_URL_REGEXP,
  matchBareLink,
  trimBareUrl
} from './workbenchBareLinks'
import {
  $createWorkbenchEquationNode,
  $isWorkbenchEquationNode,
  WorkbenchEquationNode
} from './WorkbenchEquationNode'
import {
  $createWorkbenchFootnoteDefNode,
  $createWorkbenchFootnoteRefNode,
  $isWorkbenchFootnoteDefNode,
  $isWorkbenchFootnoteRefNode,
  WorkbenchFootnoteDefNode,
  WorkbenchFootnoteRefNode
} from './WorkbenchFootnoteNode'
import { FOOTNOTE_DEF_PREFIX_RE, FOOTNOTE_REF_MATCH_RE } from './workbenchFootnotes'
import { normalizeWorkbenchLocalFileLink } from './workbenchLinks'
import {
  $createWorkbenchWikiLinkNode,
  $isWorkbenchWikiLinkNode,
  WorkbenchWikiLinkNode
} from './WorkbenchWikiLinkNode'
import { composeWikiLinkMarkdown } from './workbenchWikiLinks'
import { allMarks } from './workbenchAnnotationUtils'
import {
  IMAGE_BLOCK_REGEX,
  assembleIncrementalMarkdown,
  buildWorkbenchSourceState,
  collectDirtyTopLevelBlocks,
  extractMarkdownEnvelope,
  initializeCompositeGroupBaselines,
  parseMarkdownWithFrontmatter,
  prepareBodyWithLineMap,
  scanMarkdownSourceBlocks,
  type WorkbenchSourceState
} from './markdownSourceMap'

export { parseMarkdownWithFrontmatter }

export const HR_TRANSFORMER: ElementTransformer = {
  dependencies: [WorkbenchHorizontalRuleNode],
  export: (node: LexicalNode) => {
    if (!$isHorizontalRuleNode(node)) return null
    if ($isWorkbenchHorizontalRuleNode(node)) {
      return node.getMarkerStyle() ?? '***'
    }
    return '***'
  },
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, match, isImport) => {
    const markerStyle: HorizontalRuleMarkerStyle | null = isImport
      ? ((match[0].trim() as HorizontalRuleMarkerStyle) ?? null)
      : null
    const line = $createWorkbenchHorizontalRuleNode(markerStyle)

    // 对齐 playground plugins/MarkdownTransformers 的 HR：
    // 末尾输入 --- 后 Enter 时，不能把最后一行替换成 hr，
    // 否则光标无处安放；应在段前插入并把光标移到下一行
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line)
    } else {
      parentNode.insertBefore(line)
    }

    line.selectNext()
  },
  triggerOnEnter: true,
  type: 'element'
}

// —— 移植 playground plugins/MarkdownTransformers 的 TABLE transformer ——
// 让表格在源码与富文本间以 `| a | b |` GFM 语法双向转换
const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/

const HTML_TABLE_MARKER_REG_EXP = /^@@MC_WORKBENCH_HTML_TABLE_V1:([0-9a-f]+)@@$/

function decodeHtmlTableMarker(marker: string): string | null {
  const match = marker.match(HTML_TABLE_MARKER_REG_EXP)
  if (!match) return null

  const hex = match[1]
  if (hex.length % 2 !== 0) return null

  try {
    const bytes = new Uint8Array(hex.length / 2)
    for (let index = 0; index < hex.length; index += 2) {
      bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * 把块级 HTML 表格替换为单行标记，交给 Lexical 的 element transformer。
 * 代码围栏内的内容保持原样，避免把示例 HTML 也渲染成表格。
 */
export function prepareHtmlTablesForLexical(markdown: string): string {
  return prepareBodyWithLineMap(markdown.replace(/\r\n?/g, '\n')).preparedMarkdown
}

export const HTML_TABLE_TRANSFORMER: ElementTransformer = {
  dependencies: [WorkbenchHtmlTableNode],
  export: (node) => {
    return $isWorkbenchHtmlTableNode(node) ? node.getHtml() : null
  },
  regExp: HTML_TABLE_MARKER_REG_EXP,
  replace: (parentNode, _children, match) => {
    const html = decodeHtmlTableMarker(match[0])
    if (!html) return false
    parentNode.replace($createWorkbenchHtmlTableNode(html))
    return true
  },
  type: 'element'
}

function getTableColumnsSize(table: TableNode): number {
  const row = table.getFirstChild()
  return $isTableRowNode(row) ? row.getChildrenSize() : 0
}

const $createTableCell = (textContent: string): TableCellNode => {
  textContent = textContent.replace(/\\n/g, '\n')
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
  $convertFromMarkdownString(textContent, WORKBENCH_TRANSFORMERS, cell)
  return cell
}

const mapToTableCells = (textContent: string): TableCellNode[] | null => {
  const match = textContent.match(TABLE_ROW_REG_EXP)
  if (!match || !match[1]) {
    return null
  }
  return match[1].split('|').map((text) => $createTableCell(text.replace(/^[ \t]+|[ \t]+$/g, '')))
}

export const TABLE_TRANSFORMER: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node: LexicalNode) => {
    if (!$isTableNode(node)) {
      return null
    }

    const output: string[] = []

    for (const row of node.getChildren()) {
      const rowOutput: string[] = []
      if (!$isTableRowNode(row)) {
        continue
      }

      let isHeaderRow = false
      for (const cell of row.getChildren()) {
        if ($isTableCellNode(cell)) {
          rowOutput.push(
            $convertToMarkdownString(WORKBENCH_TRANSFORMERS, cell)
              .replace(/\n/g, '\\n')
              .trim()
          )
          if (cell.__headerState === TableCellHeaderStates.ROW) {
            isHeaderRow = true
          }
        }
      }

      output.push(`| ${rowOutput.join(' | ')} |`)
      if (isHeaderRow) {
        output.push(`| ${rowOutput.map(() => '---').join(' | ')} |`)
      }
    }

    return output.join('\n')
  },
  regExp: TABLE_ROW_REG_EXP,
  replace: (parentNode, _children, match) => {
    // Header row divider：把前一行标记为表头
    if (isTableRowDivider(match[0])) {
      const table = parentNode.getPreviousSibling()
      if (!table || !$isTableNode(table)) {
        return
      }

      const rows = table.getChildren()
      const lastRow = rows[rows.length - 1]
      if (!lastRow || !$isTableRowNode(lastRow)) {
        return
      }

      lastRow.getChildren().forEach((cell) => {
        if (!$isTableCellNode(cell)) {
          return
        }
        cell.setHeaderStyles(TableCellHeaderStates.ROW, TableCellHeaderStates.ROW)
      })

      parentNode.remove()
      return
    }

    const matchCells = mapToTableCells(match[0])
    if (matchCells == null) {
      return
    }

    const rows = [matchCells]
    let sibling = parentNode.getPreviousSibling()
    let maxCells = matchCells.length

    while (sibling) {
      if (!$isParagraphNode(sibling)) {
        break
      }
      if (sibling.getChildrenSize() !== 1) {
        break
      }
      const firstChild = sibling.getFirstChild()
      if (!$isTextNode(firstChild)) {
        break
      }
      const cells = mapToTableCells(firstChild.getTextContent())
      if (cells == null) {
        break
      }

      maxCells = Math.max(maxCells, cells.length)
      rows.unshift(cells)
      const previousSibling = sibling.getPreviousSibling()
      sibling.remove()
      sibling = previousSibling
    }

    const table = $createTableNode()

    for (const cells of rows) {
      const tableRow = $createTableRowNode()
      table.append(tableRow)

      for (let i = 0; i < maxCells; i++) {
        tableRow.append(i < cells.length ? cells[i] : $createTableCell(''))
      }
    }

    const previousSibling = parentNode.getPreviousSibling()
    if ($isTableNode(previousSibling) && getTableColumnsSize(previousSibling) === maxCells) {
      previousSibling.append(...table.getChildren())
      parentNode.remove()
    } else {
      parentNode.replace(table)
    }

    table.selectEnd()
  },
  type: 'element'
}

export const IMAGE_TRANSFORMER: ElementTransformer = {
  dependencies: [WorkbenchImageNode],
  export: (node: LexicalNode) => {
    if (!$isWorkbenchImageNode(node)) return null
    const rawSrc = node.getSrc()
    const title = node.getTitle()
    const attributes = node.getAttributes() ?? ''
    const formattedSrc = title !== undefined && /\s/.test(rawSrc) ? `<${rawSrc}>` : rawSrc
    const titlePart = title !== undefined ? ` "${title.replace(/"/g, '\\"')}"` : ''
    return `![${node.getAltText()}](${formattedSrc}${titlePart})${attributes}`
  },
  regExp: IMAGE_BLOCK_REGEX,
  replace: (parentNode, _children, match) => {
    const [, altText, angleSrc, plainSrc, doubleTitle, singleTitle, attributes] = match
    const src = (angleSrc ?? plainSrc ?? '').trim()
    if (!src) return false
    const title = doubleTitle ?? singleTitle
    const img = $createWorkbenchImageNode(src, altText || '', title, attributes)
    parentNode.replace(img)
    img.selectNext()
    return true
  },
  type: 'element'
}

export const BARE_LINK_TRANSFORMER: TextMatchTransformer = {
  dependencies: [AutoLinkNode],
  export: (node, exportChildren) => {
    if (!$isAutoLinkNode(node)) return null
    const text = node.getTextContent()
    const url = node.getURL()
    const isPlainText = node
      .getChildren()
      .every(
        (child) =>
          $isTextNode(child) && child.getFormat() === 0 && child.getStyle() === ''
      )
    if (isPlainText && (text === url || url === `https://${text}`)) {
      return text
    }
    return `[${exportChildren(node)}](${url.replace(/([\\()])/g, '\\$1')})`
  },
  importRegExp: BARE_URL_REGEXP,
  regExp: BARE_URL_REGEXP,
  getEndIndex: (_node, match) => {
    const startIndex = match.index ?? 0
    const url = trimBareUrl(match[0])
    return url ? startIndex + url.length : false
  },
  replace: (textNode) => {
    if ($findMatchingParent(textNode, $isLinkNode)) return

    const match = matchBareLink(textNode.getTextContent())
    if (!match || match.text !== textNode.getTextContent()) return

    const linkNode = $createAutoLinkNode(match.url)
    const linkText = $createTextNode(match.text)
    linkNode.append(linkText)
    textNode.replace(linkNode)
    return linkText
  },
  type: 'text-match'
}

/**
 * 块级公式 $$...$$ → WorkbenchEquationNode（inline=false）
 * 匹配以 $$ 开头、以 $$ 结尾的整段内容（可多行）。
 */
export const BLOCK_EQUATION_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [WorkbenchEquationNode],
  export: (node: LexicalNode) => {
    if (!$isWorkbenchEquationNode(node) || node.isInlineMode()) return null
    const equation = node.getEquation()
    if (!equation) return null
    return `$$\n${equation}\n$$`
  },
  regExpStart: /^\$\$/,
  regExpEnd: /^\$\$\s*$/,
  replace: (rootNode, _children, _startMatch, _endMatch, linesInBetween) => {
    const equation = (linesInBetween ?? []).join('\n').trim()
    const equationNode = $createWorkbenchEquationNode(equation, false)
    rootNode.append(equationNode)
    equationNode.selectNext()
    return true
  },
  type: 'multiline-element'
}

/**
 * 行内公式 $...$ → WorkbenchEquationNode（inline=true）
 * 匹配同一文本节点内、不含 $$/换行/首尾空格的 $...$ 片段。
 */
export const INLINE_EQUATION_TRANSFORMER: TextMatchTransformer = {
  dependencies: [WorkbenchEquationNode],
  export: (node: LexicalNode) => {
    if (!$isWorkbenchEquationNode(node) || !node.isInlineMode()) return null
    const equation = node.getEquation()
    if (!equation) return null
    return `$${equation}$`
  },
  importRegExp: /(?<!\$)\$([^$\n]|[^$\n][^$\n]*[^$\n ])\$(?!\$)/,
  regExp: /^((?<!\$)\$([^$\n]|[^$\n][^$\n]*[^$\n ])\$(?!\$))$/,
  replace: (textNode, match) => {
    const matched = match[0]
    const equation = matched.slice(1, -1).trim()
    if (!equation) return
    const equationNode = $createWorkbenchEquationNode(equation, true)
    textNode.replace(equationNode)
  },
  trigger: '$',
  type: 'text-match'
}

// —— 上下标 <sup>..</sup> / <sub>..</sub>：markdown 无原生语法，按行内 HTML 处理 ——
// export 用 TextNode 自带的 hasFormat('superscript'/'subscript')；
// import 把 <sup>..</sup> 拆出后对该 TextNode 打对应 format。
const SUPERSCRIPT_REGEX = /<sup>([^<]+)<\/sup>/
const SUBSCRIPT_REGEX = /<sub>([^<]+)<\/sub>/

function $importScriptFormat(
  textNode: TextNode,
  match: RegExpMatchArray,
  format: 'superscript' | 'subscript'
): void {
  const matched = match[1]
  if (!matched) return
  const node = $createTextNode(matched)
  node.setFormat(format)
  textNode.replace(node)
}

export const SUPERSCRIPT_TRANSFORMER: TextMatchTransformer = {
  dependencies: [],
  export: (node: LexicalNode, _exportChildren, exportFormat) => {
    if (!$isTextNode(node) || !node.hasFormat('superscript')) return null
    return `<sup>${exportFormat(node, node.getTextContent())}</sup>`
  },
  importRegExp: SUPERSCRIPT_REGEX,
  regExp: SUPERSCRIPT_REGEX,
  replace: (textNode, match) => $importScriptFormat(textNode, match, 'superscript'),
  trigger: '>',
  type: 'text-match'
}

export const SUBSCRIPT_TRANSFORMER: TextMatchTransformer = {
  dependencies: [],
  export: (node: LexicalNode, _exportChildren, exportFormat) => {
    if (!$isTextNode(node) || !node.hasFormat('subscript')) return null
    return `<sub>${exportFormat(node, node.getTextContent())}</sub>`
  },
  importRegExp: SUBSCRIPT_REGEX,
  regExp: SUBSCRIPT_REGEX,
  replace: (textNode, match) => $importScriptFormat(textNode, match, 'subscript'),
  trigger: '>',
  type: 'text-match'
}

// —— 脚注定义行 [^id]: 内容 ——
// 块级 ElementNode：编辑器内显示渲染态序号徽章，内部保留完整行内富文本编辑能力，
// 导出回标准 GFM `[^id]: 内容`（空定义导出为 `[^id]:`）。
export const FOOTNOTE_DEF_TRANSFORMER: ElementTransformer = {
  dependencies: [WorkbenchFootnoteDefNode],
  export: (node: LexicalNode, exportChildren) => {
    if (!$isWorkbenchFootnoteDefNode(node)) return null
    const body = exportChildren(node)
    return body.length > 0 ? `[^${node.getFootnoteId()}]: ${body}` : `[^${node.getFootnoteId()}]:`
  },
  regExp: FOOTNOTE_DEF_PREFIX_RE,
  replace: (parentNode, children, match, isImport) => {
    const id = match[1]
    if (!id) return false
    if (!isImport) {
      // 在编辑器内手动键入 `[^id]: ` 快捷转换时，避免产生重复 id 的定义块
      const root = $getRoot()
      for (const child of root.getChildren()) {
        if ($isWorkbenchFootnoteDefNode(child) && child.getFootnoteId() === id) {
          return false
        }
      }
    }
    const defNode = $createWorkbenchFootnoteDefNode(id)
    defNode.append(...children)
    parentNode.replace(defNode)
    if (!isImport) {
      defNode.selectEnd()
    }
    return true
  },
  type: 'element'
}

// —— 脚注引用 [^id]：行内装饰节点 ——
// importRegExp 用 (?!:) 排除定义前缀，避免把定义行首的标记当成引用。
export const FOOTNOTE_REF_TRANSFORMER: TextMatchTransformer = {
  dependencies: [WorkbenchFootnoteRefNode],
  export: (node: LexicalNode) => {
    if (!$isWorkbenchFootnoteRefNode(node)) return null
    return `[^${node.getFootnoteId()}]`
  },
  importRegExp: FOOTNOTE_REF_MATCH_RE,
  // 不要求行首：MarkdownShortcut 在光标前的文本上 match($ 截断到光标位置)，
  // 去掉 ^ 才能在段落中段输入 `[^id]` 时正确触发节点替换；保留 `$` 与 `(?!:)`
  // 排除 `[^id]:` 定义行前缀。
  regExp: /\[\^([^\]\s:]+)\](?!:)$/,
  replace: (textNode, match) => {
    const id = match[1]
    if (!id) return
    textNode.replace($createWorkbenchFootnoteRefNode(id))
  },
  trigger: ']',
  type: 'text-match'
}

export const WORKBENCH_LINK_TRANSFORMER: TextMatchTransformer = {
  ...LINK,
  replace: (textNode, match) => {
    const result = LINK.replace?.(textNode, match)
    if (!result) return result

    const linkNode = $findMatchingParent(result, $isLinkNode)
    if (!$isLinkNode(linkNode)) return result

    const localTarget = normalizeWorkbenchLocalFileLink(linkNode.getURL())
    if (localTarget) linkNode.setURL(localTarget)
    return result
  }
}

// —— 双链 [[target]] / [[target|display]]：行内装饰节点 ——
// 显示名与默认（去扩展名的文件名）一致时省略别名，保持最短 markdown 形态。
export const WIKI_LINK_TRANSFORMER: TextMatchTransformer = {
  dependencies: [WorkbenchWikiLinkNode],
  export: (node: LexicalNode) => {
    if (!$isWorkbenchWikiLinkNode(node)) return null
    return composeWikiLinkMarkdown(node.getTarget(), node.getDisplayText())
  },
  importRegExp: /\[\[([^\]\n]+)\]\]/,
  regExp: /\[\[([^\]\n]+)\]\]/,
  replace: (textNode, match) => {
    const inner = match[1]
    if (!inner) return
    const pipeIndex = inner.indexOf('|')
    const target = (pipeIndex === -1 ? inner : inner.slice(0, pipeIndex)).trim()
    if (!target) return
    const display = pipeIndex === -1 ? null : inner.slice(pipeIndex + 1).trim() || null
    textNode.replace($createWorkbenchWikiLinkNode(target, display))
  },
  trigger: ']',
  type: 'text-match'
}

export const WORKBENCH_TRANSFORMERS = [
  HTML_TABLE_TRANSFORMER,
  TABLE_TRANSFORMER,
  BLOCK_EQUATION_TRANSFORMER,
  FOOTNOTE_DEF_TRANSFORMER,
  CHECK_LIST,
  HR_TRANSFORMER,
  IMAGE_TRANSFORMER,
  INLINE_EQUATION_TRANSFORMER,
  FOOTNOTE_REF_TRANSFORMER,
  WIKI_LINK_TRANSFORMER,
  SUPERSCRIPT_TRANSFORMER,
  SUBSCRIPT_TRANSFORMER,
  BARE_LINK_TRANSFORMER,
  ...TRANSFORMERS.map((transformer) =>
    transformer === LINK ? WORKBENCH_LINK_TRANSFORMER : transformer
  )
]

function stripMarkNodesForSerialization(node: ParsableSerializedNode): ParsableSerializedNode[] {
  if (node.type === 'mark') {
    return (node.children ?? []).flatMap(stripMarkNodesForSerialization)
  }
  if (!node.children) return [node]
  return [{ ...node, children: node.children.flatMap(stripMarkNodesForSerialization) }]
}

export function serializeWorkbenchMarkdown(
  editor: LexicalEditor,
  state: EditorState = editor.getEditorState()
): string {
  const direct = state.read(() =>
    allMarks().length === 0 ? $convertToMarkdownString(WORKBENCH_TRANSFORMERS) : null
  )
  if (direct !== null) return direct
  const root = stripMarkNodesForSerialization(state.toJSON(true).root)[0]
  const shadow = editor.parseEditorState({ root })
  return shadow.read(() => $convertToMarkdownString(WORKBENCH_TRANSFORMERS))
}

const SYNC_DEBOUNCE_MS = 250

/**
 * Markdown 双向同步插件
 * 1. 切换文件或从源码模式切回富文本模式时，将 Markdown 解析为 Lexical AST 并建立块级 Source Map
 * 2. 编辑器内容变化时，按块增量序列化未改动块原文透传，保留 BOM / Frontmatter / EOL / 末尾换行
 */
export default function MarkdownSyncPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const setMarkdownSyncFlusher = useWorkbenchStore((s) => s.setMarkdownSyncFlusher)
  const editorMode = useWorkbenchStore((s) => s.editorMode)

  const frontmatterRef = useRef<string | null>(null)
  // 待确认 AI 插入暂存的 frontmatter（未点“✓ 采纳”前不写入正文信封）
  const pendingFrontmatterRef = useRef<string | null | undefined>(undefined)
  const sourceStateRef = useRef<WorkbenchSourceState | null>(null)
  const isSyncingFromExternalRef = useRef(false)
  const lastLoadedPathRef = useRef<string | null>(null)
  const lastSyncedContentRef = useRef<string>('')
  const pendingSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasPendingSyncRef = useRef(false)
  const wasDirtyBeforePendingRef = useRef(false)
  // 上次光标位置的序列化锚点（anchor key + offset + type），用于"插入到光标处"
  const lastAnchorRef = useRef<{ key: string; offset: number; type: PointType['type'] } | null>(null)
  // 当前待确认插入容器 key（单条 pending）
  const pendingKeyRef = useRef<string | null>(null)
  // 待滚动定位的 pending key（commit 后滚一次即清）
  const pendingScrollKeyRef = useRef<string | null>(null)

  // 记录最近一次的选区锚点（随 selection 更新）
  useEffect(() => {
    const track = (): void => {
      editor.getEditorState().read(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) {
          lastAnchorRef.current = {
            key: sel.anchor.getNode().getKey(),
            offset: sel.anchor.offset,
            type: sel.anchor.type
          }
        }
      })
    }
    const unregister = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        track()
        return false
      },
      COMMAND_PRIORITY_EDITOR
    )
    const unregisterUpdate = editor.registerUpdateListener(({ tags }) => {
      if (tags.has('sync-external') || isSyncingFromExternalRef.current) return
      track()
    })
    return () => {
      unregister()
      unregisterUpdate()
    }
  }, [editor])

  // 处理 插入/采纳/撤回 三个命令
  useEffect(() => {
    // 清掉当前已有 pending 容器（单条 pending）
    const clearPending = (): void => {
      const root = $getRoot()
      root.getChildren().forEach((child) => {
        if ($isPendingInsertNode(child)) {
          child.remove()
        }
      })
      pendingKeyRef.current = null
    }

    const unregisterInsert = editor.registerCommand(
      INSERT_REPLY_COMMAND,
      (replyMd: string) => {
        const md = (replyMd || '').trim()
        if (!md) return false

        // 预览态不进入正文写盘，等待用户显式“✓ 采纳”
        $addUpdateTag('pending-insert-preview')
        clearPending()

        // 生成顶层 block 节点并包进待确认容器
        const nodes = $generateNodesFromMarkdownString(
          prepareHtmlTablesForLexical(md),
          WORKBENCH_TRANSFORMERS
        )
        if (!nodes || nodes.length === 0) return false
        const pending = $createPendingInsertNode()
        nodes.forEach((n) => pending.append(n))
        pending.append($createPendingBarNode())

        // 重建上次光标选区；锚点节点已死则文末兜底
        let inserted = false
        const anchor = lastAnchorRef.current
        if (anchor) {
          const anchorNode = $getNodeByKey(anchor.key)
          if (anchorNode && anchorNode.isAttached()) {
            const sel = $createRangeSelection()
            sel.anchor.set(anchor.key, anchor.offset, anchor.type)
            sel.focus.set(anchor.key, anchor.offset, anchor.type)
            sel.insertNodes([pending])
            inserted = true
          }
        }
        if (!inserted) {
          const root = $getRoot()
          root.selectEnd()
          const sel = $getSelection()
          if ($isRangeSelection(sel)) sel.insertNodes([pending])
          else root.append(pending)
        }
        pendingKeyRef.current = pending.getKey()
        pendingScrollKeyRef.current = pending.getKey()

        // 光标移到 pending 内部末尾（聚焦编辑器）
        try { pending.selectEnd() } catch { /* noop */ }
        return true
      },
      COMMAND_PRIORITY_EDITOR
    )

    // pending 插入完成后（DOM 已 commit），把容器滚动进视口
    const unregisterScroll = editor.registerUpdateListener(() => {
      const key = pendingScrollKeyRef.current
      if (!key) return
      pendingScrollKeyRef.current = null
      requestAnimationFrame(() => {
        const dom = editor.getElementByKey(key)
        if (dom) {
          try { dom.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch { /* noop */ }
        }
      })
    })

    const unregisterConfirm = editor.registerCommand(
      CONFIRM_INSERT_COMMAND,
      () => {
        if (pendingFrontmatterRef.current !== undefined) {
          frontmatterRef.current = pendingFrontmatterRef.current
          if (sourceStateRef.current) {
            sourceStateRef.current.envelope.frontmatter = pendingFrontmatterRef.current
          }
          pendingFrontmatterRef.current = undefined
        }
        const key = pendingKeyRef.current
        const node = key ? $getNodeByKey(key) : null
        if (node && $isPendingInsertNode(node)) {
          // children 提到原位后删容器（采纳）；PendingBarNode 也随容器移除
          const children = node.getChildren().slice()
          children.forEach((child) => {
            if (!$isPendingBarNode(child)) {
              node.insertBefore(child)
            }
          })
          node.remove()
        }
        pendingKeyRef.current = null
        return true
      },
      COMMAND_PRIORITY_EDITOR
    )

    const unregisterCancel = editor.registerCommand(
      CANCEL_INSERT_COMMAND,
      () => {
        $addUpdateTag('pending-insert-preview')
        pendingFrontmatterRef.current = undefined
        const key = pendingKeyRef.current
        const node = key ? $getNodeByKey(key) : null
        if (node && $isPendingInsertNode(node)) {
          node.remove()
        }
        pendingKeyRef.current = null
        return true
      },
      COMMAND_PRIORITY_EDITOR
    )

    return () => {
      unregisterInsert()
      unregisterConfirm()
      unregisterCancel()
      unregisterScroll()
    }
  }, [editor])

  // 桥接：store 派发的 workbench:insert-reply → Lexical INSERT_REPLY_COMMAND
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (
        e as CustomEvent<{ replyMd?: string; conversationUrl?: string; platform?: string }>
      ).detail
      const md = detail?.replyMd
      if (!md) return
      // 插入回复属于会话资料：先暂存待补的 frontmatter，待用户点击“✓ 采纳”后才写入。
      const baseFrontmatter = frontmatterRef.current ?? ''
      const upserted = upsertConversationFrontmatter(baseFrontmatter, {
        url: detail.conversationUrl,
        platform: detail.platform
      })
      if (upserted.conflict.length) {
        // 普通笔记里已有同名属性时保住用户值，只提示未自动关联来源。
        useWorkbenchStore.setState({
          error: '当前文档已有来源属性，已保留原值，未自动关联本次来源'
        })
        pendingFrontmatterRef.current = undefined
      } else {
        pendingFrontmatterRef.current =
          upserted.content !== baseFrontmatter ? upserted.content : undefined
      }
      editor.dispatchCommand(INSERT_REPLY_COMMAND, md)
    }
    window.addEventListener('workbench:insert-reply', handler)
    return () => window.removeEventListener('workbench:insert-reply', handler)
  }, [editor])

  // 桥接：FrontmatterPanel 编辑属性 → 同步 frontmatterRef 与 SourceState 信封，
  // 否则后续 Lexical 回写会用旧 frontmatter 覆盖面板改动
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ frontmatter?: string | null }>).detail
      if (!detail) return
      frontmatterRef.current = detail.frontmatter ?? null
      if (sourceStateRef.current) {
        sourceStateRef.current.envelope.frontmatter = frontmatterRef.current
      }
      // 对齐 lastSyncedContentRef（保留 BOM），避免被当成"外部改动"又回灌一遍
      const parsed = parseMarkdownWithFrontmatter(lastSyncedContentRef.current)
      lastSyncedContentRef.current =
        parsed.bom + (frontmatterRef.current || '') + parsed.markdownBody
    }
    window.addEventListener('workbench:frontmatter-changed', handler)
    return () => window.removeEventListener('workbench:frontmatter-changed', handler)
  }, [])

  // 当外部文件切换或从源码模式切回富文本时，更新 Lexical 编辑器内容并建立块级 Source Map
  useEffect(() => {
    const isNewFile = activeFilePath !== lastLoadedPathRef.current
    const isReturningToWysiwyg =
      editorMode === 'wysiwyg' && activeFileContent !== lastSyncedContentRef.current

    if (isNewFile || isReturningToWysiwyg) {
      // 若同文件下仅 frontmatter 发生变化（例如 saveActiveFile 归一化旧会话头），
      // 只更新信封引用而不整篇重载 Lexical，避免打断当前编辑选区。
      if (!isNewFile && sourceStateRef.current) {
        const nextEnvelope = extractMarkdownEnvelope(activeFileContent)
        const prevEnvelope = sourceStateRef.current.envelope
        if (
          nextEnvelope.bom === prevEnvelope.bom &&
          nextEnvelope.body === prevEnvelope.body &&
          nextEnvelope.frontmatter !== prevEnvelope.frontmatter
        ) {
          frontmatterRef.current = nextEnvelope.frontmatter
          prevEnvelope.frontmatter = nextEnvelope.frontmatter
          sourceStateRef.current.originalFullContent = activeFileContent
          lastSyncedContentRef.current = activeFileContent
          return
        }
      }

      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      hasPendingSyncRef.current = false
      wasDirtyBeforePendingRef.current = false
      pendingFrontmatterRef.current = undefined

      lastLoadedPathRef.current = activeFilePath
      lastSyncedContentRef.current = activeFileContent
      const envelope = extractMarkdownEnvelope(activeFileContent)
      frontmatterRef.current = envelope.frontmatter
      const scanned = scanMarkdownSourceBlocks(envelope.body)

      isSyncingFromExternalRef.current = true
      editor.update(
        () => {
          $convertFromMarkdownString(scanned.preparedMarkdown, WORKBENCH_TRANSFORMERS)
          sourceStateRef.current = buildWorkbenchSourceState(
            activeFileContent,
            envelope,
            scanned
          )
        },
        { tag: 'sync-external', discrete: true }
      )
      if (isNewFile) {
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      }
      if (sourceStateRef.current) {
        initializeCompositeGroupBaselines(
          editor,
          editor.getEditorState(),
          sourceStateRef.current,
          WORKBENCH_TRANSFORMERS
        )
      }
      isSyncingFromExternalRef.current = false
      // 正文导入完成后才允许标注应用；插件监听此事件，避免把上一份文档的标记套到新正文。
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent('workbench:markdown-imported', {
            detail: { workspaceRoot: useWorkbenchStore.getState().workspacePath, relativePath: activeFilePath }
          })
        )
      })
    }
  }, [activeFilePath, activeFileContent, editorMode, editor])

  // 监听 Lexical 内部改动，按块增量拼装并通过 250ms 防抖同步回 workbenchStore
  useEffect(() => {
    const flushSync = (): void => {
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      if (!hasPendingSyncRef.current) return
      hasPendingSyncRef.current = false

      const sourceState = sourceStateRef.current
      if (!sourceState) return

      const fullMarkdown = assembleIncrementalMarkdown(
        editor,
        editor.getEditorState(),
        sourceState,
        WORKBENCH_TRANSFORMERS
      )

      if (fullMarkdown !== lastSyncedContentRef.current) {
        lastSyncedContentRef.current = fullMarkdown
        updateActiveContent(fullMarkdown)
      } else if (!wasDirtyBeforePendingRef.current) {
        // 本次 update 未产生实际源码变化（如对齐、表宽、撤销回原状），恢复干净态
        if (useWorkbenchStore.getState().isDirty) {
          useWorkbenchStore.setState({ isDirty: false })
        }
      }
    }

    setMarkdownSyncFlusher(flushSync)

    const unregister = editor.registerUpdateListener(
      ({ editorState, prevEditorState, dirtyElements, dirtyLeaves, tags }) => {
        // 忽略由外部载入、标注投影、代码块落点、表宽调整、待确认预览触发的更新及纯选区变动
        if (tags.has('sync-external') || isSyncingFromExternalRef.current) return
        if (tags.has('annotation-sync')) return
        if (tags.has('code-exit')) return
        if (tags.has('table-resize')) return
        if (tags.has('pending-insert-preview')) return
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return

        const sourceState = sourceStateRef.current
        if (!sourceState) return

        if (!hasPendingSyncRef.current) {
          wasDirtyBeforePendingRef.current = useWorkbenchStore.getState().isDirty
          hasPendingSyncRef.current = true
          useWorkbenchStore.getState().markMarkdownPendingSync()
        }

        collectDirtyTopLevelBlocks(
          editor,
          editorState,
          prevEditorState,
          dirtyElements,
          dirtyLeaves,
          sourceState,
          WORKBENCH_TRANSFORMERS
        )

        if (pendingSyncTimerRef.current) {
          clearTimeout(pendingSyncTimerRef.current)
        }
        pendingSyncTimerRef.current = setTimeout(() => {
          pendingSyncTimerRef.current = null
          flushSync()
        }, SYNC_DEBOUNCE_MS)
      }
    )

    return () => {
      unregister()
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      setMarkdownSyncFlusher(null)
    }
  }, [editor, setMarkdownSyncFlusher, updateActiveContent])

  return null
}
