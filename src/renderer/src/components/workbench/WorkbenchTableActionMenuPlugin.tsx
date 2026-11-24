import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { AppIcon } from '../icons/AppIcon'
import {
  $computeTableCellRectBoundary,
  $computeTableMap,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getNodeTriplet,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $getTableRowIndexFromTableCellNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableSelection,
  $mergeCells,
  $setTableColumnIsHeader,
  $setTableRowIsHeader,
  $unmergeCell,
  getTableElement,
  getTableObserverFromTableElement,
  TableCellHeaderStates,
  TableCellNode,
  type TableSelection
} from '@lexical/table'
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  type ElementNode,
  getActiveElementDeep,
  getDOMSelection,
  getDOMSelectionPoints,
  getRootOwnerDocument,
  isDOMNode,
  mergeRegister,
  registerEventListener,
  SELECTION_CHANGE_COMMAND
} from 'lexical'

/**
 * 移植 playground plugins/TableActionMenuPlugin（裁剪版）：
 * 光标进入表格单元格时，右上角浮出"∨"按钮，点击展开表格操作菜单：
 * 合并/拆分、上下插行、左右插列、删行/删列/删表、行/列表头、斑马纹。
 * 与 playground 一致：portal 挂到 anchorElem，按单元格 rect 用 transform 定位。
 */

function $computeSelectionCounts(selection: TableSelection): {
  columns: number
  rows: number
} {
  const anchorCell = selection.anchor.getNode()
  const focusCell = selection.focus.getNode()
  if (!$isTableCellNode(anchorCell) || !$isTableCellNode(focusCell)) {
    return { columns: 1, rows: 1 }
  }
  const tableNode = $getTableNodeFromLexicalNodeOrThrow(anchorCell)
  const [map, cellAMap, cellBMap] = $computeTableMap(tableNode, anchorCell, focusCell)
  const { minColumn, maxColumn, minRow, maxRow } = $computeTableCellRectBoundary(
    map,
    cellAMap,
    cellBMap
  )
  return {
    columns: maxColumn - minColumn + 1,
    rows: maxRow - minRow + 1
  }
}

function $canUnmerge(): boolean {
  const selection = $getSelection()
  if (
    ($isRangeSelection(selection) && !selection.isCollapsed()) ||
    ($isTableSelection(selection) && !selection.anchor.is(selection.focus)) ||
    (!$isRangeSelection(selection) && !$isTableSelection(selection))
  ) {
    return false
  }
  const [cell] = $getNodeTriplet(selection.anchor)
  return cell.__colSpan > 1 || cell.__rowSpan > 1
}

function $selectLastDescendant(node: ElementNode): void {
  const lastDescendant = node.getLastDescendant()
  if ($isTextNode(lastDescendant)) {
    lastDescendant.select()
  } else if ($isElementNode(lastDescendant)) {
    lastDescendant.selectEnd()
  } else if (lastDescendant !== null) {
    lastDescendant.selectNext()
  }
}

function TableActionMenu({
  contextRef,
  onClose,
  tableCellNode: _tableCellNode,
  setIsMenuOpen
}: {
  contextRef: { current: HTMLButtonElement | null }
  onClose: () => void
  tableCellNode: TableCellNode
  setIsMenuOpen: (open: boolean) => void
}): ReactPortal {
  const [editor] = useLexicalComposerContext()
  const dropDownRef = useRef<HTMLDivElement | null>(null)
  const [tableCellNode, updateTableCellNode] = useState(_tableCellNode)
  const [selectionCounts, updateSelectionCounts] = useState({ columns: 1, rows: 1 })
  const [canMergeCells, setCanMergeCells] = useState(false)
  const [canUnmergeCell, setCanUnmergeCell] = useState(false)

  useEffect(() => {
    return editor.registerMutationListener(
      TableCellNode,
      (nodeMutations) => {
        if (nodeMutations.get(tableCellNode.getKey()) === 'updated') {
          editor.read('latest', () => {
            updateTableCellNode(tableCellNode.getLatest())
          })
        }
      },
      { skipInitialization: true }
    )
  }, [editor, tableCellNode])

  useEffect(() => {
    editor.read('latest', () => {
      const selection = $getSelection()
      if ($isTableSelection(selection)) {
        const counts = $computeSelectionCounts(selection)
        updateSelectionCounts(counts)
        const isCollapsedTableSelection = selection.anchor.is(selection.focus)
        setCanMergeCells(
          !isCollapsedTableSelection && (counts.columns > 1 || counts.rows > 1)
        )
      }
      setCanUnmergeCell($canUnmerge())
    })
  }, [editor])

  // useLayoutEffect：绘制前完成定位，避免菜单在按钮旁闪现后瞬移
  useLayoutEffect(() => {
    const menuButtonElement = contextRef.current
    const dropDownElement = dropDownRef.current
    const rootElement = editor.getRootElement()

    if (menuButtonElement != null && dropDownElement != null && rootElement != null) {
      const rootEleRect = rootElement.getBoundingClientRect()
      const menuButtonRect = menuButtonElement.getBoundingClientRect()
      dropDownElement.style.opacity = '1'
      const dropDownElementRect = dropDownElement.getBoundingClientRect()
      const margin = 5
      let leftPosition = menuButtonRect.right + margin
      if (
        leftPosition + dropDownElementRect.width > window.innerWidth ||
        leftPosition + dropDownElementRect.width > rootEleRect.right
      ) {
        const position = menuButtonRect.left - dropDownElementRect.width - margin
        leftPosition = (position < 0 ? margin : position) + window.scrollX
      }
      dropDownElement.style.left = `${leftPosition + window.scrollX}px`

      let topPosition = menuButtonRect.top
      if (topPosition + dropDownElementRect.height > window.innerHeight) {
        const position = menuButtonRect.bottom - dropDownElementRect.height
        topPosition = position < 0 ? margin : position
      }
      dropDownElement.style.top = `${topPosition}px`
    }
  }, [contextRef, editor])

  // 外部点击关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropDownRef.current != null &&
        contextRef.current != null &&
        isDOMNode(event.target) &&
        !dropDownRef.current.contains(event.target) &&
        !contextRef.current.contains(event.target)
      ) {
        setIsMenuOpen(false)
      }
    }
    return registerEventListener(window, 'click', handleClickOutside)
  }, [setIsMenuOpen, contextRef])

  const clearTableSelection = useCallback(() => {
    editor.update(() => {
      if (tableCellNode.isAttached()) {
        const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
        const tableElement = getTableElement(
          tableNode,
          editor.getElementByKey(tableNode.getKey())
        )
        if (tableElement === null) {
          throw new Error('TableActionMenu: Expected to find tableElement in DOM')
        }
        const tableObserver = getTableObserverFromTableElement(tableElement)
        if (tableObserver !== null) {
          tableObserver.$clearHighlight()
        }
        tableNode.markDirty()
        updateTableCellNode(tableCellNode.getLatest())
      }
      $setSelection(null)
    })
  }, [editor, tableCellNode])

  const mergeTableCellsAtSelection = () => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isTableSelection(selection)) {
        return
      }
      const nodes = selection.getNodes()
      const tableCells = nodes.filter($isTableCellNode)
      const targetCell = $mergeCells(tableCells)
      if (targetCell) {
        $selectLastDescendant(targetCell)
        onClose()
      }
    })
  }

  const unmergeTableCellsAtSelection = () => {
    editor.update(() => {
      $unmergeCell()
      clearTableSelection()
    })
  }

  const insertTableRowAtSelection = useCallback(
    (shouldInsertAfter: boolean) => {
      editor.update(() => {
        for (let i = 0; i < selectionCounts.rows; i++) {
          $insertTableRowAtSelection(shouldInsertAfter)
        }
        onClose()
      })
    },
    [editor, onClose, selectionCounts.rows]
  )

  const insertTableColumnAtSelection = useCallback(
    (shouldInsertAfter: boolean) => {
      editor.update(() => {
        for (let i = 0; i < selectionCounts.columns; i++) {
          $insertTableColumnAtSelection(shouldInsertAfter)
        }
        onClose()
      })
    },
    [editor, onClose, selectionCounts.columns]
  )

  const deleteTableRowAtSelection = useCallback(() => {
    editor.update(() => {
      $deleteTableRowAtSelection()
      onClose()
    })
  }, [editor, onClose])

  const deleteTableAtSelection = useCallback(() => {
    editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
      tableNode.remove()
      clearTableSelection()
      onClose()
    })
  }, [editor, tableCellNode, clearTableSelection, onClose])

  const deleteTableColumnAtSelection = useCallback(() => {
    editor.update(() => {
      $deleteTableColumnAtSelection()
      onClose()
    })
  }, [editor, onClose])

  const toggleTableRowIsHeader = useCallback(() => {
    editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
      const rowIndex = $getTableRowIndexFromTableCellNode(tableCellNode)
      const isHeader = !tableCellNode.hasHeaderState(TableCellHeaderStates.ROW)
      $setTableRowIsHeader(tableNode, rowIndex, isHeader)
      clearTableSelection()
      onClose()
    })
  }, [editor, tableCellNode, clearTableSelection, onClose])

  const toggleTableColumnIsHeader = useCallback(() => {
    editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
      const [, cellMap] = $computeTableMap(tableNode, tableCellNode, tableCellNode)
      const columnIndex = cellMap.startColumn
      const isHeader = !tableCellNode.hasHeaderState(TableCellHeaderStates.COLUMN)
      $setTableColumnIsHeader(tableNode, columnIndex, isHeader)
      clearTableSelection()
      onClose()
    })
  }, [editor, tableCellNode, clearTableSelection, onClose])

  const toggleRowStriping = useCallback(() => {
    editor.update(() => {
      if (tableCellNode.isAttached()) {
        const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode)
        tableNode.setRowStriping(!tableNode.getRowStriping())
      }
      clearTableSelection()
      onClose()
    })
  }, [editor, tableCellNode, clearTableSelection, onClose])

  const itemClass =
    'w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors'
  const dividerClass = 'my-1 border-t border-black/5 dark:border-white/5'

  return createPortal(
    <div
      ref={dropDownRef}
      className="fixed z-50 w-56 py-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-black/10 dark:border-white/10 opacity-0"
      style={{ top: -10000, left: -10000 }}
      role="menu"
    >
      {canMergeCells && (
        <button type="button" className={itemClass} onClick={mergeTableCellsAtSelection}>
          合并单元格
        </button>
      )}
      {canUnmergeCell && (
        <button type="button" className={itemClass} onClick={unmergeTableCellsAtSelection}>
          拆分单元格
        </button>
      )}
      {(canMergeCells || canUnmergeCell) && <div className={dividerClass} />}

      <button
        type="button"
        className={itemClass}
        onClick={() => insertTableRowAtSelection(false)}
      >
        在上方插入{selectionCounts.rows === 1 ? '行' : ` ${selectionCounts.rows} 行`}
      </button>
      <button
        type="button"
        className={itemClass}
        onClick={() => insertTableRowAtSelection(true)}
      >
        在下方插入{selectionCounts.rows === 1 ? '行' : ` ${selectionCounts.rows} 行`}
      </button>
      <div className={dividerClass} />
      <button
        type="button"
        className={itemClass}
        onClick={() => insertTableColumnAtSelection(false)}
      >
        在左侧插入{selectionCounts.columns === 1 ? '列' : ` ${selectionCounts.columns} 列`}
      </button>
      <button
        type="button"
        className={itemClass}
        onClick={() => insertTableColumnAtSelection(true)}
      >
        在右侧插入{selectionCounts.columns === 1 ? '列' : ` ${selectionCounts.columns} 列`}
      </button>
      <div className={dividerClass} />

      <button type="button" className={itemClass} onClick={deleteTableRowAtSelection}>
        删除行
      </button>
      <button type="button" className={itemClass} onClick={deleteTableColumnAtSelection}>
        删除列
      </button>
      <button type="button" className={itemClass} onClick={deleteTableAtSelection}>
        删除表格
      </button>
      <div className={dividerClass} />

      <button type="button" className={itemClass} onClick={toggleTableRowIsHeader}>
        {(tableCellNode.__headerState & TableCellHeaderStates.ROW) ===
        TableCellHeaderStates.ROW
          ? '取消行表头'
          : '设为行表头'}
      </button>
      <button type="button" className={itemClass} onClick={toggleTableColumnIsHeader}>
        {(tableCellNode.__headerState & TableCellHeaderStates.COLUMN) ===
        TableCellHeaderStates.COLUMN
          ? '取消列表头'
          : '设为列表头'}
      </button>
      <button type="button" className={itemClass} onClick={toggleRowStriping}>
        切换斑马纹
      </button>
    </div>,
    editor.getRootElement()?.ownerDocument?.body ?? document.body
  )
}

function TableCellActionMenuContainer({
  anchorElem
}: {
  anchorElem: HTMLElement
}): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const menuButtonRef = useRef<HTMLDivElement | null>(null)
  const menuRootRef = useRef<HTMLButtonElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [tableCellNode, setTableMenuCellNode] = useState<TableCellNode | null>(null)

  const checkTableCellOverflow = useCallback(
    (tableCellParentNodeDOM: HTMLElement): boolean => {
      const scrollableContainer = tableCellParentNodeDOM.closest(
        '.PlaygroundEditorTheme__tableScrollableWrapper'
      )
      if (scrollableContainer) {
        const containerRect = (
          scrollableContainer as HTMLElement
        ).getBoundingClientRect()
        const cellRect = tableCellParentNodeDOM.getBoundingClientRect()
        const actionButtonRight = cellRect.right - 5
        const actionButtonLeft = actionButtonRight - 28
        if (actionButtonRight > containerRect.right || actionButtonLeft < containerRect.left) {
          return true
        }
      }
      return false
    },
    []
  )

  const $moveMenu = useCallback(() => {
    const menu = menuButtonRef.current
    const selection = $getSelection()
    const nativeSelection = getDOMSelection(editor._window)
    const activeElement = getActiveElementDeep(
      getRootOwnerDocument(editor.getRootElement())
    )
    const disable = () => {
      if (menu) {
        menu.classList.remove('workbench-table-action-active')
        menu.classList.add('workbench-table-action-inactive')
      }
      setTableMenuCellNode(null)
    }

    if (selection == null || menu == null) {
      return disable()
    }

    const rootElement = editor.getRootElement()
    let tableObserver = null
    let tableCellParentNodeDOM: HTMLElement | null = null

    if (
      $isRangeSelection(selection) &&
      rootElement !== null &&
      nativeSelection !== null &&
      rootElement.contains(
        getDOMSelectionPoints(nativeSelection, rootElement).anchorNode
      )
    ) {
      const tableCellNodeFromSelection = $getTableCellNodeFromLexicalNode(
        selection.anchor.getNode()
      )

      if (tableCellNodeFromSelection == null) {
        return disable()
      }

      tableCellParentNodeDOM = editor.getElementByKey(tableCellNodeFromSelection.getKey())
      if (tableCellParentNodeDOM == null || !tableCellNodeFromSelection.isAttached()) {
        return disable()
      }
      if (checkTableCellOverflow(tableCellParentNodeDOM)) {
        return disable()
      }

      const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNodeFromSelection)
      const tableElement = getTableElement(
        tableNode,
        editor.getElementByKey(tableNode.getKey())
      )
      if (tableElement === null) {
        throw new Error('TableActionMenu: Expected to find tableElement in DOM')
      }
      tableObserver = getTableObserverFromTableElement(tableElement)
      setTableMenuCellNode(tableCellNodeFromSelection)
    } else if ($isTableSelection(selection)) {
      const anchorNode = $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
      if (!$isTableCellNode(anchorNode)) {
        return disable()
      }
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(anchorNode)
      const tableElement = getTableElement(
        tableNode,
        editor.getElementByKey(tableNode.getKey())
      )
      if (tableElement === null) {
        throw new Error('TableActionMenu: Expected to find tableElement in DOM')
      }
      tableObserver = getTableObserverFromTableElement(tableElement)
      tableCellParentNodeDOM = editor.getElementByKey(anchorNode.getKey())
      if (tableCellParentNodeDOM === null) {
        return disable()
      }
      if (checkTableCellOverflow(tableCellParentNodeDOM)) {
        return disable()
      }
    } else if (!activeElement) {
      return disable()
    }

    if (tableCellParentNodeDOM === null) {
      return disable()
    }
    const enabled = !tableObserver || !tableObserver.isSelecting
    menu.classList.toggle('workbench-table-action-active', enabled)
    menu.classList.toggle('workbench-table-action-inactive', !enabled)
    if (enabled) {
      const tableCellRect = tableCellParentNodeDOM.getBoundingClientRect()
      const anchorRect = anchorElem.getBoundingClientRect()
      const top = tableCellRect.top - anchorRect.top
      const left = tableCellRect.right - anchorRect.left
      menu.style.transform = `translate(${left}px, ${top}px)`
    }
  }, [editor, anchorElem, checkTableCellOverflow])

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
    const callback = () => {
      timeoutId = undefined
      editor.read('latest', $moveMenu)
    }
    const delayedCallback = () => {
      if (timeoutId === undefined) {
        timeoutId = setTimeout(callback, 0)
      }
      return false
    }
    return mergeRegister(
      editor.registerUpdateListener(delayedCallback),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        delayedCallback,
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerRootListener((rootElement) => {
        if (rootElement) {
          delayedCallback()
          return registerEventListener(rootElement, 'pointerup', delayedCallback)
        }
      }),
      () => clearTimeout(timeoutId)
    )
  }, [editor, $moveMenu])

  const prevTableCellDOM = useRef(tableCellNode)
  useEffect(() => {
    if (prevTableCellDOM.current !== tableCellNode) {
      setIsMenuOpen(false)
    }
    prevTableCellDOM.current = tableCellNode
  }, [tableCellNode])

  return (
    <div
      ref={menuButtonRef}
      className="workbench-table-action-container absolute left-0 top-0 z-30 will-change-transform"
    >
      {tableCellNode != null && (
        <button
          type="button"
          ref={menuRootRef}
          onClick={(e) => {
            e.stopPropagation()
            setIsMenuOpen(!isMenuOpen)
          }}
          className="w-5 h-5 -translate-x-full mt-1 mr-1 flex items-center justify-center rounded-full bg-white dark:bg-gray-700 border border-black/10 dark:border-white/10 shadow-md hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
          title="表格操作"
        >
          <AppIcon name="expand_more" size={14} />
        </button>
      )}
      {isMenuOpen && tableCellNode != null && (
        <TableActionMenu
          contextRef={menuRootRef}
          setIsMenuOpen={setIsMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          tableCellNode={tableCellNode}
        />
      )}
    </div>
  )
}

export default function WorkbenchTableActionMenuPlugin({
  anchorElem
}: {
  anchorElem: HTMLElement | null
}): null | ReactPortal {
  const isEditable = useLexicalEditable()
  if (anchorElem === null) {
    return null
  }
  return createPortal(
    isEditable ? <TableCellActionMenuContainer anchorElem={anchorElem} /> : null,
    anchorElem
  )
}
