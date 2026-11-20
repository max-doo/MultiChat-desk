import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { LexicalNode } from 'lexical'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  CHECK_LIST,
  isTableRowDivider,
  type ElementTransformer
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
import { $isParagraphNode, $isTextNode } from 'lexical'
import {
  HorizontalRuleNode,
  $createHorizontalRuleNode,
  $isHorizontalRuleNode
} from '@lexical/react/LexicalHorizontalRuleNode'
import { useWorkbenchStore } from '../../store/workbenchStore'

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
  return match[1].split('|').map((text) => $createTableCell(text))
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

export const WORKBENCH_TRANSFORMERS = [
  TABLE_TRANSFORMER,
  CHECK_LIST,
  HR_TRANSFORMER,
  ...TRANSFORMERS
]

/**
 * 分离 YAML Frontmatter 元数据与正文 Markdown
 */
export function parseMarkdownWithFrontmatter(rawContent: string): {
  frontmatter: string | null
  markdownBody: string
} {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
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
          $convertFromMarkdownString(markdownBody, WORKBENCH_TRANSFORMERS)
        },
        { tag: 'sync-external', discrete: true }
      )
      isSyncingFromExternalRef.current = false
    }
  }, [activeFilePath, activeFileContent, editorMode, editor])

  // 监听 Lexical 内部改动，同步写回 workbenchStore
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      // 忽略由外部载入触发的更新或无内容变化的选区变动
      if (tags.has('sync-external') || isSyncingFromExternalRef.current) return
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return

      editorState.read(() => {
        const bodyMarkdown = $convertToMarkdownString(WORKBENCH_TRANSFORMERS)
        const fullMarkdown = (frontmatterRef.current || '') + bodyMarkdown

        // 仅在内容实质发生改变时通知 store
        if (fullMarkdown !== lastSyncedContentRef.current) {
          lastSyncedContentRef.current = fullMarkdown
          updateActiveContent(fullMarkdown)
        }
      })
    })
  }, [editor, updateActiveContent])

  return null
}
