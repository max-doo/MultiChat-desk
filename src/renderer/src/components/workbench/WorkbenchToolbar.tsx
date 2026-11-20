import { useCallback, useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $createParagraphNode,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type ElementFormatType
} from 'lexical'
import { $createHeadingNode, $createQuoteNode, $isHeadingNode } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
  $isListNode,
  ListNode
} from '@lexical/list'
import { $createCodeNode } from '@lexical/code'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { INSERT_TABLE_COMMAND } from '@lexical/table'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { $getNearestNodeOfType } from '@lexical/utils'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WorkbenchDropDown, {
  WorkbenchDropDownItem,
  WorkbenchDropDownDivider
} from './WorkbenchDropDown'

type BlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bullet'
  | 'number'
  | 'check'
  | 'quote'
  | 'code'

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  paragraph: '正文段落',
  h1: '一级标题',
  h2: '二级标题',
  h3: '三级标题',
  h4: '四级标题',
  h5: '五级标题',
  h6: '六级标题',
  bullet: '无序列表',
  number: '有序列表',
  check: '待办清单',
  quote: '引用区块',
  code: '代码区块'
}

const ELEMENT_FORMATS: { format: ElementFormatType; icon: string; label: string }[] = [
  { format: 'left', icon: 'format_align_left', label: '左对齐' },
  { format: 'center', icon: 'format_align_center', label: '居中对齐' },
  { format: 'right', icon: 'format_align_right', label: '右对齐' },
  { format: 'justify', icon: 'format_align_justify', label: '两端对齐' }
]

export default function WorkbenchToolbar(): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const setEditorMode = useWorkbenchStore((s) => s.setEditorMode)
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const toggleLeftCollapse = useWorkbenchStore((s) => s.toggleLeftCollapse)

  // 选区状态回显（对齐 playground ToolbarContext 中与本工具栏相关的子集）
  const [blockType, setBlockType] = useState<BlockType>('paragraph')
  const [elementFormat, setElementFormat] = useState<ElementFormatType>('left')
  const [isLink, setIsLink] = useState(false)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isHighlight, setIsHighlight] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [isEditable, setIsEditable] = useState(() => editor.isEditable())

  // 与 playground $updateToolbar 等价：随选区变化刷新块类型 / 行内格式 / 链接 / 对齐
  const $updateToolbar = useCallback(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode()
      const element =
        anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow()

      // 链接状态：选中节点本身或父级为 LinkNode
      const node = (() => {
        const anchor = selection.anchor
        const focus = selection.focus
        const anchorSelNode = anchor.getNode()
        const focusSelNode = focus.getNode()
        if (anchorSelNode === focusSelNode) return anchorSelNode
        return selection.isBackward() ? focusSelNode : anchorSelNode
      })()
      const parent = node.getParent()
      setIsLink($isLinkNode(parent) || $isLinkNode(node))

      if ($isListNode(element)) {
        const parentList = $getNearestNodeOfType(anchorNode, ListNode)
        const type = parentList ? parentList.getListType() : element.getListType()
        setBlockType(type as BlockType)
      } else {
        const type = $isHeadingNode(element) ? element.getTag() : element.getType()
        if (type in BLOCK_TYPE_LABELS) {
          setBlockType(type as BlockType)
        }
      }

      setIsBold(selection.hasFormat('bold'))
      setIsCode(selection.hasFormat('code'))
      setIsItalic(selection.hasFormat('italic'))
      setIsStrikethrough(selection.hasFormat('strikethrough'))
      setIsHighlight(selection.hasFormat('highlight'))
      setIsUnderline(selection.hasFormat('underline'))

      setElementFormat($isElementNode(element) ? element.getFormatType() : 'left')
    }
  }, [])

  useEffect(() => {
    return mergeRegister(
      editor.registerEditableListener((editable) => {
        setIsEditable(editable)
      }),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateToolbar()
        })
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $updateToolbar()
          return false
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload)
          return false
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload)
          return false
        },
        COMMAND_PRIORITY_CRITICAL
      )
    )
  }, [editor, $updateToolbar])

  // —— 段落格式：与 playground 语义一致，选中当前类型再次点击切回正文段落 ——
  const $setBlocksToParagraph = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      $setBlocksType(selection, () => $createParagraphNode())
    })
  }, [editor])

  const formatHeading = useCallback(
    (level: 'h1' | 'h2' | 'h3' | 'h4') => {
      if (blockType !== level) {
        editor.update(() => {
          const selection = $getSelection()
          $setBlocksType(selection, () => $createHeadingNode(level))
        })
      } else {
        $setBlocksToParagraph()
      }
    },
    [blockType, editor, $setBlocksToParagraph]
  )

  const formatParagraph = useCallback(() => {
    $setBlocksToParagraph()
  }, [$setBlocksToParagraph])

  const formatQuote = useCallback(() => {
    if (blockType !== 'quote') {
      editor.update(() => {
        const selection = $getSelection()
        $setBlocksType(selection, () => $createQuoteNode())
      })
    } else {
      $setBlocksToParagraph()
    }
  }, [blockType, editor, $setBlocksToParagraph])

  const formatCodeBlock = useCallback(() => {
    if (blockType !== 'code') {
      editor.update(() => {
        const selection = $getSelection()
        $setBlocksType(selection, () => $createCodeNode())
      })
    } else {
      $setBlocksToParagraph()
    }
  }, [blockType, editor, $setBlocksToParagraph])

  const formatBulletList = useCallback(() => {
    if (blockType !== 'bullet') {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
    } else {
      $setBlocksToParagraph()
    }
  }, [blockType, editor, $setBlocksToParagraph])

  const formatNumberedList = useCallback(() => {
    if (blockType !== 'number') {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
    } else {
      $setBlocksToParagraph()
    }
  }, [blockType, editor, $setBlocksToParagraph])

  const formatCheckList = useCallback(() => {
    if (blockType !== 'check') {
      editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
    } else {
      $setBlocksToParagraph()
    }
  }, [blockType, editor, $setBlocksToParagraph])

  const applyFormat = useCallback(
    (format: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'highlight') => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    },
    [editor]
  )

  const applyAlign = useCallback(
    (align: ElementFormatType) => {
      editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, align)
    },
    [editor]
  )

  const applyInsertTable = useCallback(() => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      columns: '3',
      rows: '3',
      includeHeaders: true
    })
  }, [editor])

  const applyHorizontalRule = useCallback(() => {
    editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
  }, [editor])

  const insertLink = useCallback(() => {
    if (!isLink) {
      const url = window.prompt('请输入链接地址 (URL):', 'https://')
      if (url !== null && url.trim()) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim())
      }
    } else {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    }
  }, [editor, isLink])

  const handleUndo = useCallback(() => {
    editor.dispatchCommand(UNDO_COMMAND, undefined)
  }, [editor])

  const handleRedo = useCallback(() => {
    editor.dispatchCommand(REDO_COMMAND, undefined)
  }, [editor])

  const itemClass = (active: boolean) =>
    `w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
      active
        ? 'bg-primary/10 text-primary font-medium'
        : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
    }`

  const iconBtnClass = (active: boolean) =>
    `w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
      active
        ? 'bg-primary/15 text-primary'
        : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
    }`

  return (
    <div className="h-12 px-3 bg-white/70 dark:bg-gray-800/70 backdrop-blur-md border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 select-none text-sm">
      {/* 左侧：格式化与排版工具组 */}
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
        {isLeftCollapsed && (
          <>
            <button
              type="button"
              onClick={toggleLeftCollapse}
              className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
              title="展开侧边栏"
              aria-label="展开侧边栏"
            >
              <span className="material-symbols-outlined text-base">left_panel_open</span>
            </button>
            <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />
          </>
        )}

        {/* 撤销 / 重做：按 CAN_UNDO/CAN_REDO 命令动态禁用 */}
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo || !isEditable}
          className="w-8 h-8 flex items-center justify-center rounded-md text-text-primary hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
          title="撤销 (Ctrl+Z)"
        >
          <span className="material-symbols-outlined text-[20px]">undo</span>
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo || !isEditable}
          className="w-8 h-8 flex items-center justify-center rounded-md text-text-primary hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
          title="重做 (Ctrl+Y)"
        >
          <span className="material-symbols-outlined text-[20px]">redo</span>
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 段落类型下拉：portal 渲染到 body，按钮回显当前块类型 */}
        <WorkbenchDropDown
          buttonAriaLabel="段落格式选项"
          buttonTitle="段落格式"
          buttonClassName="h-8 px-2.5 flex items-center gap-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-text-primary transition-colors font-medium text-sm"
          buttonContent={
            <>
              <span className="min-w-[3.5rem] text-left">{BLOCK_TYPE_LABELS[blockType]}</span>
              <span className="material-symbols-outlined text-[18px]">arrow_drop_down</span>
            </>
          }
        >
          <WorkbenchDropDownItem className={itemClass(blockType === 'paragraph')} onClick={formatParagraph}>
            <span className="material-symbols-outlined text-[18px] text-text-secondary">notes</span>
            <span>正文段落</span>
          </WorkbenchDropDownItem>
          {(['h1', 'h2', 'h3', 'h4'] as const).map((level) => (
            <WorkbenchDropDownItem
              key={level}
              className={itemClass(blockType === level)}
              onClick={() => formatHeading(level)}
            >
              <span className="text-xs font-mono text-text-secondary w-5">{level.toUpperCase()}</span>
              <span className={level === 'h1' ? 'font-bold' : level === 'h2' ? 'font-semibold' : ''}>
                {BLOCK_TYPE_LABELS[level]}
              </span>
            </WorkbenchDropDownItem>
          ))}
          <WorkbenchDropDownDivider />
          <WorkbenchDropDownItem className={itemClass(blockType === 'bullet')} onClick={formatBulletList}>
            <span className="material-symbols-outlined text-[18px] text-text-secondary">format_list_bulleted</span>
            <span>无序列表</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(blockType === 'number')} onClick={formatNumberedList}>
            <span className="material-symbols-outlined text-[18px] text-text-secondary">format_list_numbered</span>
            <span>有序列表</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(blockType === 'check')} onClick={formatCheckList}>
            <span className="material-symbols-outlined text-[18px] text-text-secondary">checklist</span>
            <span>待办清单</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownDivider />
          <WorkbenchDropDownItem className={itemClass(blockType === 'quote')} onClick={formatQuote}>
            <span className="material-symbols-outlined text-[18px] text-text-secondary">format_quote</span>
            <span>引用区块</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(blockType === 'code')} onClick={formatCodeBlock}>
            <span className="material-symbols-outlined text-[18px] text-text-secondary">terminal</span>
            <span>代码区块</span>
          </WorkbenchDropDownItem>
        </WorkbenchDropDown>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 行内格式按钮：active 态跟随选区格式 */}
        <button
          type="button"
          onClick={() => applyFormat('bold')}
          className={iconBtnClass(isBold)}
          title="粗体 (Ctrl+B)"
          aria-label="粗体"
        >
          <span className="material-symbols-outlined text-[20px]">format_bold</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('italic')}
          className={iconBtnClass(isItalic)}
          title="斜体 (Ctrl+I)"
          aria-label="斜体"
        >
          <span className="material-symbols-outlined text-[20px]">format_italic</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('underline')}
          className={iconBtnClass(isUnderline)}
          title="下划线 (Ctrl+U)"
          aria-label="下划线"
        >
          <span className="material-symbols-outlined text-[20px]">format_underlined</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('strikethrough')}
          className={iconBtnClass(isStrikethrough)}
          title="删除线"
          aria-label="删除线"
        >
          <span className="material-symbols-outlined text-[20px]">format_strikethrough</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('code')}
          className={iconBtnClass(isCode)}
          title="行内代码"
          aria-label="行内代码"
        >
          <span className="material-symbols-outlined text-[20px]">code</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('highlight')}
          className={iconBtnClass(isHighlight)}
          title="高亮"
          aria-label="高亮"
        >
          <span className="material-symbols-outlined text-[20px]">ink_highlighter</span>
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 列表快捷按钮：active 态跟随块类型 */}
        <button
          type="button"
          onClick={formatBulletList}
          className={iconBtnClass(blockType === 'bullet')}
          title="无序列表"
        >
          <span className="material-symbols-outlined text-[20px]">format_list_bulleted</span>
        </button>
        <button
          type="button"
          onClick={formatNumberedList}
          className={iconBtnClass(blockType === 'number')}
          title="有序列表"
        >
          <span className="material-symbols-outlined text-[20px]">format_list_numbered</span>
        </button>
        <button
          type="button"
          onClick={formatCheckList}
          className={iconBtnClass(blockType === 'check')}
          title="待办清单 (Checklist)"
        >
          <span className="material-symbols-outlined text-[20px]">checklist</span>
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 插入组件：表格、水平分割线、超链接 */}
        <button
          type="button"
          onClick={applyInsertTable}
          className={iconBtnClass(false)}
          title="插入表格 (3x3)"
        >
          <span className="material-symbols-outlined text-[20px]">table_chart</span>
        </button>
        <button
          type="button"
          onClick={applyHorizontalRule}
          className={iconBtnClass(false)}
          title="插入水平分割线"
        >
          <span className="material-symbols-outlined text-[20px]">horizontal_rule</span>
        </button>
        <button
          type="button"
          onClick={insertLink}
          className={iconBtnClass(isLink)}
          title={isLink ? '移除链接' : '插入超链接 (Ctrl+K)'}
        >
          <span className="material-symbols-outlined text-[20px]">link</span>
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 对齐方式下拉：portal + 当前对齐回显 */}
        <WorkbenchDropDown
          buttonAriaLabel="对齐方式"
          buttonTitle="对齐方式"
          buttonClassName="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-text-primary transition-colors"
          buttonContent={
            <span className="material-symbols-outlined text-[20px]">
              {ELEMENT_FORMATS.find((f) => f.format === elementFormat)?.icon ?? 'format_align_left'}
            </span>
          }
        >
          <div className="flex items-center gap-1 px-1.5 py-0.5">
            {ELEMENT_FORMATS.map(({ format, icon, label }) => (
              <button
                key={format}
                type="button"
                onClick={() => applyAlign(format)}
                className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                  elementFormat === format
                    ? 'bg-primary/15 text-primary'
                    : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
                }`}
                title={label}
              >
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
              </button>
            ))}
          </div>
        </WorkbenchDropDown>
      </div>

      {/* 右侧：富文本/源码切换（字数与保存状态悬浮在编辑区右下角） */}
      <div className="flex items-center gap-2.5 text-text-secondary text-sm shrink-0">
        <div className="flex items-center p-0.5 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
          <button
            type="button"
            onClick={() => setEditorMode('wysiwyg')}
            className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
              editorMode === 'wysiwyg'
                ? 'bg-white dark:bg-gray-700 text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="预览模式"
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setEditorMode('source')}
            className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
              editorMode === 'source'
                ? 'bg-white dark:bg-gray-700 text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="原始 Markdown 源码模式"
          >
            源码
          </button>
        </div>
      </div>
    </div>
  )
}
