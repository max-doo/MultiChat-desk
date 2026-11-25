import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as ReactDOM from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
import { AppIcon } from '../icons/AppIcon'
import {
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type NodeKey,
  registerEventListener
} from 'lexical'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND
} from '@lexical/list'
import { $createCodeNode } from '@lexical/code'
import { INSERT_TABLE_COMMAND } from '@lexical/table'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { $createWorkbenchEquationNode } from './WorkbenchEquationNode'
import WorkbenchEquationEditor from './WorkbenchEquationEditor'
import { useWorkbenchStore } from '../../store/workbenchStore'

/**
 * 移植 playground DraggableBlockPlugin + ComponentPickerPlugin：
 * - 左侧拖拽 handle 前加一个 "+" 按钮，点击弹出组件选择菜单（在该块下方插入新内容）
 * - 菜单带 "Filter blocks..." 搜索框、键盘上下/回车导航、Esc/外部点击关闭
 * - 按住 Alt/Ctrl 点击可在该块上方插入
 * - 输入 "3x3" 这类文本时提供动态表格尺寸选项
 */

type PickerState = {
  insertBefore: boolean
  targetNodeKey: NodeKey
}

interface PickerOption {
  key: string
  title: string
  icon: string
  keywords: string[]
  /**
   * 默认由 selectOption 先在目标位置插入占位段落、把选区放进去再调用本回调；
   * 返回 'defer-insert' 表示不走占位流程（例如需要先弹出编辑器的块类型），
   * 由调用方在完成编辑后自行把节点插入 pickerState 指向的位置。
   */
  onSelect: () => 'defer-insert' | void
}

function isOnMenu(element: HTMLElement): boolean {
  return Boolean(element.closest('.draggable-block-menu'))
}

export default function WorkbenchDraggableBlockPlugin({
  anchorElem
}: {
  anchorElem: HTMLElement | null
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const isDark = useWorkbenchStore((s) => s.markdownBackgroundTheme) === 'dark'
  const menuRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const targetLineRef = useRef<HTMLDivElement | null>(null)
  const draggableElementRef = useRef<HTMLElement | null>(null)
  const handleElementChanged = useCallback((el: HTMLElement | null) => {
    draggableElementRef.current = el
  }, [])
  const [pickerState, setPickerState] = useState<PickerState | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [pickerPosition, setPickerPosition] = useState<{ left: number; top: number } | null>(null)
  const [equationEditor, setEquationEditor] = useState<{ anchorRect: DOMRect } | null>(null)

  const baseOptions = useMemo<PickerOption[]>(
    () => [
      {
        key: 'paragraph',
        title: '正文段落',
        icon: 'notes',
        keywords: ['paragraph', 'p', 'text', '正文', '段落'],
        onSelect: () =>
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createParagraphNode())
            }
          })
      },
      ...([1, 2, 3] as const).map((n) => ({
        key: `h${n}`,
        title: `标题 ${n}`,
        icon: 'title',
        keywords: ['heading', 'header', `h${n}`, `标题${n}`],
        onSelect: () =>
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createHeadingNode(`h${n}`))
            }
          })
      })),
      {
        key: 'table',
        title: '表格',
        icon: 'table_chart',
        keywords: ['table', 'grid', 'spreadsheet', 'rows', 'columns', '表格'],
        onSelect: () =>
          editor.dispatchCommand(INSERT_TABLE_COMMAND, {
            columns: '3',
            rows: '3',
            includeHeaders: true
          })
      },
      {
        key: 'number',
        title: '有序列表',
        icon: 'format_list_numbered',
        keywords: ['numbered list', 'ordered list', 'ol', '有序'],
        onSelect: () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
      },
      {
        key: 'bullet',
        title: '无序列表',
        icon: 'format_list_bulleted',
        keywords: ['bulleted list', 'unordered list', 'ul', '无序'],
        onSelect: () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
      },
      {
        key: 'check',
        title: '待办清单',
        icon: 'checklist',
        keywords: ['check list', 'todo list', '待办'],
        onSelect: () => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
      },
      {
        key: 'quote',
        title: '引用',
        icon: 'format_quote',
        keywords: ['block quote', 'quote', '引用'],
        onSelect: () =>
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createQuoteNode())
            }
          })
      },
      {
        key: 'code',
        title: '代码块',
        icon: 'code',
        keywords: ['javascript', 'python', 'js', 'codeblock', '代码'],
        onSelect: () =>
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              if (selection.isCollapsed()) {
                $setBlocksType(selection, () => $createCodeNode())
              } else {
                const textContent = selection.getTextContent()
                const codeNode = $createCodeNode()
                selection.insertNodes([codeNode])
                selection.insertRawText(textContent)
              }
            }
          })
      },
      {
        key: 'hr',
        title: '分割线',
        icon: 'horizontal_rule',
        keywords: ['horizontal rule', 'divider', 'hr', '分割线'],
        onSelect: () => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
      },
      {
        key: 'equation',
        title: '公式块',
        icon: 'function',
        keywords: ['equation', 'formula', 'latex', 'katex', 'math', '公式', '数学'],
        onSelect: () => {
          // 与 SourceToolbar "插入公式"一致：先打开 LaTeX 编辑弹层，
          // 保存时再把节点插入到 pickerState 指示的位置
          // 弹层是 fixed 定位，锚点要用点击时计算好的 pickerPosition（页面坐标），
          // 而不是 menuRef 的 transform 定位 rect（会跑到视口左上）
          const anchorRect = pickerPosition
            ? new DOMRect(pickerPosition.left, pickerPosition.top, 0, 0)
            : (menuRef.current?.getBoundingClientRect() ?? new DOMRect(8, 8, 0, 0))
          setEquationEditor({ anchorRect })
          return 'defer-insert'
        }
      }
    ],
    [editor, pickerPosition]
  )

  const options = baseOptions

  useEffect(() => {
    if (!isPickerOpen || !options.length) return
    setHighlightedIndex((current) => Math.min(current, Math.max(options.length - 1, 0)))
  }, [isPickerOpen, options.length])

  // 外部点击关闭
  useEffect(() => {
    if (!isPickerOpen || !anchorElem) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (
        (pickerRef.current && target && pickerRef.current.contains(target)) ||
        (menuRef.current && target && menuRef.current.contains(target))
      ) {
        return
      }
      setIsPickerOpen(false)
      setPickerState(null)
    }
    return registerEventListener(anchorElem.ownerDocument, 'mousedown', handleClickOutside)
  }, [isPickerOpen, anchorElem])

  const selectOption = useCallback(
    (option: PickerOption) => {
      if (!pickerState) {
        setIsPickerOpen(false)
        return
      }
      // 需要延迟插入的选项（如公式块先弹编辑器），不走占位流程，直接调 onSelect
      const result = option.onSelect()
      if (result === 'defer-insert') {
        setIsPickerOpen(false)
        return
      }
      setIsPickerOpen(false)
      editor.update(() => {
        const node = $getNodeByKey(pickerState.targetNodeKey)
        if (!node) return
        const placeholder = $createParagraphNode()
        const textNode = $createTextNode('')
        placeholder.append(textNode)
        if (pickerState.insertBefore) {
          node.insertBefore(placeholder)
        } else {
          node.insertAfter(placeholder)
        }
        textNode.select()
        const latestPlaceholder = placeholder.getLatest()
        if ($isParagraphNode(latestPlaceholder)) {
          const onlyChild = latestPlaceholder.getFirstChild()
          if (
            $isTextNode(onlyChild) &&
            onlyChild.getTextContent().length === 0 &&
            latestPlaceholder.getChildrenSize() === 1
          ) {
            latestPlaceholder.remove()
          }
        }
      })
    },
    [editor, pickerState]
  )

  // 公式编辑器保存：把公式节点插入到 "+" 触发位置（pickerState.targetNodeKey 前后）
  const applyEquation = useCallback(
    (equation: string) => {
      if (!pickerState) return
      editor.update(() => {
        const node = $getNodeByKey(pickerState.targetNodeKey)
        if (!node) return
        const equationNode = $createWorkbenchEquationNode(equation, false)
        if (pickerState.insertBefore) {
          node.insertBefore(equationNode)
        } else {
          node.insertAfter(equationNode)
        }
        equationNode.selectNext()
      })
    },
    [editor, pickerState]
  )

  // 键盘导航
  useEffect(() => {
    if (!isPickerOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!options.length) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightedIndex((index) => (index + 1 >= options.length ? 0 : index + 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightedIndex((index) => (index - 1 < 0 ? options.length - 1 : index - 1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const option = options[highlightedIndex]
        if (option) selectOption(option)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setIsPickerOpen(false)
        setPickerState(null)
      }
    }
    return registerEventListener(window, 'keydown', handleKeyDown)
  }, [highlightedIndex, isPickerOpen, options, selectOption])

  const openComponentPicker = useCallback(
    (e: React.MouseEvent) => {
      const draggableElement = draggableElementRef.current
      if (!draggableElement || !editor) return

      let targetNodeKey: NodeKey | null = null
      editor.read(() => {
        const resolvedNode = $getNearestNodeFromDOMNode(draggableElement)
        if (resolvedNode) {
          targetNodeKey = resolvedNode.getKey()
        }
      })

      if (!targetNodeKey) return

      const insertBefore = e.altKey || e.ctrlKey
      const rect = menuRef.current?.getBoundingClientRect()
      setPickerPosition(
        rect
          ? { left: rect.left + rect.width + window.scrollX + 8, top: rect.top + window.scrollY }
          : null
      )
      setPickerState({ insertBefore, targetNodeKey })
      setHighlightedIndex(0)
      setIsPickerOpen(true)
    },
    [editor]
  )

  if (anchorElem === null) {
    return null
  }

  return (
    <>
      {isPickerOpen && pickerPosition
        ? ReactDOM.createPortal(
            <div
              ref={pickerRef}
              data-reader-dropdown={isDark ? 'dark' : 'light'}
              className={`absolute z-popover w-max min-w-40 max-w-64 whitespace-nowrap rounded-xl shadow-lg border overflow-hidden text-body ${
                isDark
                  ? 'dark liquid-glass-menu border-white/15'
                  : 'bg-white dark:bg-gray-800 border-black/10 dark:border-white/10'
              }`}
              style={{ left: pickerPosition.left, top: pickerPosition.top }}
            >
              <ul className="py-1 max-h-64 overflow-y-auto">
                {options.map((option, i) => (
                  <li key={option.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setHighlightedIndex(i)
                        selectOption(option)
                      }}
                      onMouseEnter={() => setHighlightedIndex(i)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        highlightedIndex === i
                          ? isDark
                            ? 'bg-primary/20 text-blue-300'
                            : 'bg-primary/10 text-primary'
                          : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                    >
                      <AppIcon name={option.icon} size={19} className="text-text-secondary shrink-0" />
                      <span>{option.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            anchorElem.ownerDocument.body
          )
        : null}

      <DraggableBlockPlugin_EXPERIMENTAL
        anchorElem={anchorElem}
        menuRef={menuRef}
        targetLineRef={targetLineRef}
        menuComponent={
          <div
            ref={menuRef}
            className="draggable-block-menu absolute left-0 top-0 flex items-center gap-0.5 will-change-transform z-10"
          >
            <button
              type="button"
              onClick={openComponentPicker}
              title="点击下方插入新内容（Alt+点击在上方插入）"
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              <AppIcon name="add" size={19} />
            </button>
            <div
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10 cursor-grab active:cursor-grabbing transition-colors"
              title="按住拖拽调整段落位置"
            >
              <AppIcon name="drag_indicator" size={19} />
            </div>
          </div>
        }
        targetLineComponent={
          <div
            ref={targetLineRef}
            className="pointer-events-none absolute left-0 top-0 h-[2.5px] bg-primary opacity-0 will-change-transform rounded-full shadow-sm z-10"
          />
        }
        isOnMenu={isOnMenu}
        onElementChanged={handleElementChanged}
      />

      {equationEditor && (
        <WorkbenchEquationEditor
          anchorRect={equationEditor.anchorRect}
          initialEquation=""
          inline={false}
          onApply={(equation) => {
            applyEquation(equation)
            setEquationEditor(null)
          }}
          onClose={() => setEquationEditor(null)}
        />
      )}
    </>
  )
}
