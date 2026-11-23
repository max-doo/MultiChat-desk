import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type {
  EditorState,
  LexicalEditor,
  LexicalNode,
  ParsableSerializedNode,
  PointType
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
import { $createTextNode, $isParagraphNode, $isTextNode } from 'lexical'
import { $findMatchingParent } from '@lexical/utils'
import {
  $createAutoLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  AutoLinkNode
} from '@lexical/link'
import {
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $createRangeSelection,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_EDITOR
} from 'lexical'
import {
  HorizontalRuleNode,
  $createHorizontalRuleNode,
  $isHorizontalRuleNode
} from '@lexical/react/LexicalHorizontalRuleNode'
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
import { normalizeWorkbenchLocalFileLink } from './workbenchLinks'
import { allMarks } from './workbenchAnnotationUtils'

export const HR_TRANSFORMER: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node: LexicalNode) => {
    return $isHorizontalRuleNode(node) ? '***' : null
  },
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const line = $createHorizontalRuleNode()

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

const HTML_TABLE_MARKER_PREFIX = '@@MC_WORKBENCH_HTML_TABLE_V1:'
const HTML_TABLE_MARKER_SUFFIX = '@@'
const HTML_TABLE_MARKER_REG_EXP = /^@@MC_WORKBENCH_HTML_TABLE_V1:([0-9a-f]+)@@$/

function encodeHtmlTableMarker(html: string): string {
  const bytes = new TextEncoder().encode(html)
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return `${HTML_TABLE_MARKER_PREFIX}${hex}${HTML_TABLE_MARKER_SUFFIX}`
}

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
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let fence: { char: string; length: number } | null = null

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = { char: marker[0], length: marker.length }
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null
      }
      output.push(line)
      continue
    }
    if (fence) {
      output.push(line)
      continue
    }

    if (!/^\s{0,3}<table(?:\s|>)/i.test(line)) {
      output.push(line)
      continue
    }

    let endLineIndex = -1
    let closingIndex = -1
    for (let cursor = index; cursor < lines.length; cursor++) {
      const found = lines[cursor].toLowerCase().indexOf('</table>')
      if (found >= 0) {
        endLineIndex = cursor
        closingIndex = found + '</table>'.length
        break
      }
    }
    if (endLineIndex < 0) {
      output.push(line)
      continue
    }

    const trailing = lines[endLineIndex].slice(closingIndex)
    if (trailing.trim()) {
      output.push(line)
      continue
    }

    const html = lines.slice(index, endLineIndex + 1).join('\n')
    output.push(encodeHtmlTableMarker(html))
    index = endLineIndex
  }

  return output.join('\n')
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
    return `![${node.getAltText()}](${node.getSrc()})`
  },
  regExp: /^!\[([^\]]*)\]\(([^)\s]+)\)$/,
  replace: (parentNode, _children, match) => {
    const [, altText, src] = match
    const img = $createWorkbenchImageNode(src, altText || '')
    parentNode.replace(img)
    img.selectNext()
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

export const WORKBENCH_TRANSFORMERS = [
  HTML_TABLE_TRANSFORMER,
  TABLE_TRANSFORMER,
  CHECK_LIST,
  HR_TRANSFORMER,
  IMAGE_TRANSFORMER,
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

/**
 * 分离 YAML Frontmatter 元数据与正文 Markdown
 */
export function parseMarkdownWithFrontmatter(rawContent: string): {
  frontmatter: string | null
  markdownBody: string
} {
  const frontmatterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/
  const match = rawContent.match(frontmatterRegex)
  if (match) {
    return {
      frontmatter: match[0],
      markdownBody: rawContent.slice(match[0].length)
    }
  }
  return { frontmatter: null, markdownBody: rawContent }
}

/**
 * Markdown 双向同步插件
 * 1. 切换文件或从源码模式切回富文本模式时，将 Markdown 解析为 Lexical AST
 * 2. 编辑器内容变化时，实时转换回 Markdown 字符串并保留 Frontmatter
 */
export default function MarkdownSyncPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const editorMode = useWorkbenchStore((s) => s.editorMode)

  const frontmatterRef = useRef<string | null>(null)
  const isSyncingFromExternalRef = useRef(false)
  const lastLoadedPathRef = useRef<string | null>(null)
  const lastSyncedContentRef = useRef<string>('')
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
      // 插入回复属于会话资料：先补 frontmatter，再让 Lexical 的后续回写带上它。
      const upserted = upsertConversationFrontmatter(frontmatterRef.current ?? '', {
        url: detail.conversationUrl,
        platform: detail.platform
      })
      if (upserted.conflict.length) {
        // 普通笔记里已有同名属性时保住用户值，只提示未自动关联来源。
        useWorkbenchStore.setState({
          error: '当前文档已有来源属性，已保留原值，未自动关联本次来源'
        })
      } else {
        frontmatterRef.current = upserted.content
      }
      editor.dispatchCommand(INSERT_REPLY_COMMAND, md)
    }
    window.addEventListener('workbench:insert-reply', handler)
    return () => window.removeEventListener('workbench:insert-reply', handler)
  }, [editor])

  // 桥接：FrontmatterPanel 编辑属性 → 同步 frontmatterRef，
  // 否则后续 Lexical 回写会用旧 frontmatter 覆盖面板改动
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ frontmatter?: string | null }>).detail
      if (!detail) return
      frontmatterRef.current = detail.frontmatter ?? null
      // 对齐 lastSyncedContentRef，避免被当成"外部改动"又回灌一遍
      const body = lastSyncedContentRef.current.replace(
        /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
        ''
      )
      lastSyncedContentRef.current = (frontmatterRef.current || '') + body
    }
    window.addEventListener('workbench:frontmatter-changed', handler)
    return () => window.removeEventListener('workbench:frontmatter-changed', handler)
  }, [])

  // 当外部文件切换或从源码模式切回富文本时，更新 Lexical 编辑器内容
  useEffect(() => {
    const isNewFile = activeFilePath !== lastLoadedPathRef.current
    const isReturningToWysiwyg =
      editorMode === 'wysiwyg' && activeFileContent !== lastSyncedContentRef.current

    if (isNewFile || isReturningToWysiwyg) {
      lastLoadedPathRef.current = activeFilePath
      lastSyncedContentRef.current = activeFileContent
      const { frontmatter, markdownBody } = parseMarkdownWithFrontmatter(activeFileContent)
      frontmatterRef.current = frontmatter

      isSyncingFromExternalRef.current = true
      editor.update(
        () => {
          $convertFromMarkdownString(
            prepareHtmlTablesForLexical(markdownBody),
            WORKBENCH_TRANSFORMERS
          )
        },
        { tag: 'sync-external', discrete: true }
      )
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

  // 监听 Lexical 内部改动，同步写回 workbenchStore
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      // 忽略由外部载入触发的更新或无内容变化的选区变动
      if (tags.has('sync-external') || isSyncingFromExternalRef.current) return
      // 标注应用是旁路投影：不能触发 Markdown 回写，否则会把正文改坏
      if (tags.has('annotation-sync')) return
      // 点击代码块外侧只为建立落点段落，不应把空段落写回 Markdown
      if (tags.has('code-exit')) return
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return

      const bodyMarkdown = serializeWorkbenchMarkdown(editor, editorState)
      const fullMarkdown = (frontmatterRef.current || '') + bodyMarkdown

      // 仅在内容实质发生改变时通知 store
      if (fullMarkdown !== lastSyncedContentRef.current) {
        lastSyncedContentRef.current = fullMarkdown
        updateActiveContent(fullMarkdown)
      }
    })
  }, [editor, updateActiveContent])

  return null
}
