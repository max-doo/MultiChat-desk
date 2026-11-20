import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { LexicalNode, PointType } from 'lexical'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
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
import {
  $createPendingInsertNode,
  $isPendingInsertNode,
  INSERT_REPLY_COMMAND,
  CONFIRM_INSERT_COMMAND,
  CANCEL_INSERT_COMMAND
} from './PendingInsertNode'
import { $createPendingBarNode, $isPendingBarNode } from './PendingBarNode'
import {
  $createWorkbenchImageNode,
  $isWorkbenchImageNode,
  WorkbenchImageNode
} from './WorkbenchImageNode'

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

export const WORKBENCH_TRANSFORMERS = [
  TABLE_TRANSFORMER,
  CHECK_LIST,
  HR_TRANSFORMER,
  IMAGE_TRANSFORMER,
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
        const nodes = $generateNodesFromMarkdownString(md, WORKBENCH_TRANSFORMERS)
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
      const detail = (e as CustomEvent<{ replyMd?: string }>).detail
      const md = detail?.replyMd
      if (!md) return
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
      // 点击代码块外侧只为建立落点段落，不应把空段落写回 Markdown
      if (tags.has('code-exit')) return
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
