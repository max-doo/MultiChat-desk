import { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { AppIcon } from '../icons/AppIcon'
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
import { $isLinkNode } from '@lexical/link'
import { INSERT_TABLE_COMMAND } from '@lexical/table'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { INSERT_WORKBENCH_IMAGE_COMMAND } from './WorkbenchImagePlugin'
import { $createWorkbenchEquationNode } from './WorkbenchEquationNode'
import { $findMatchingParent, $getNearestNodeOfType } from '@lexical/utils'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WorkbenchDropDown, {
  WorkbenchDropDownItem,
  WorkbenchDropDownDivider
} from './WorkbenchDropDown'
import WorkbenchLinkEditor from './WorkbenchLinkEditor'
import WorkbenchEquationEditor from './WorkbenchEquationEditor'
import WorkbenchFootnotePopover, { type FootnoteInsertMode } from './WorkbenchFootnotePopover'
import { INSERT_FOOTNOTE_COMMAND } from './WorkbenchFootnotePlugin'
import {
  collectFootnoteStateFromLexical,
  type FootnoteUsageSnapshot
} from './workbenchFootnotes'

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
  const contentWidth = useWorkbenchStore((s) => s.contentWidth)
  const setContentWidth = useWorkbenchStore((s) => s.setContentWidth)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const largeDocument = (activeFileSize ?? 0) > 2 * 1024 * 1024
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
  const [isSuperscript, setIsSuperscript] = useState(false)
  const [isSubscript, setIsSubscript] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [isEditable, setIsEditable] = useState(() => editor.isEditable())
  const [linkEditor, setLinkEditor] = useState<{
    anchorRect: DOMRect
    initialUrl: string | null
  } | null>(null)
  const linkButtonRef = useRef<HTMLButtonElement | null>(null)
  const equationButtonRef = useRef<HTMLButtonElement | null>(null)
  const [equationEditor, setEquationEditor] = useState<{
    anchorRect: DOMRect
    inline: boolean
  } | null>(null)
  const footnoteButtonRef = useRef<HTMLButtonElement | null>(null)
  const [footnoteEditor, setFootnoteEditor] = useState<{
    anchorRect: DOMRect
    snapshot: FootnoteUsageSnapshot
  } | null>(null)

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
      setIsSuperscript(selection.hasFormat('superscript'))
      setIsSubscript(selection.hasFormat('subscript'))

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
    (
      format:
        | 'bold'
        | 'italic'
        | 'underline'
        | 'strikethrough'
        | 'code'
        | 'highlight'
        | 'superscript'
        | 'subscript'
    ) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    },
    [editor]
  )

  // Ctrl+. 上标 / Ctrl+, 下标（对齐 Google Docs / Word 约定）
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '.') {
        e.preventDefault()
        applyFormat('superscript')
      } else if (e.key === ',') {
        e.preventDefault()
        applyFormat('subscript')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [applyFormat])

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

  // 在光标处插入公式节点：块级插入到当前块之后，行内插入选区内
  const insertEquation = useCallback(
    (inline: boolean) => {
      const button = equationButtonRef.current
      if (!button) return
      setEquationEditor({ anchorRect: button.getBoundingClientRect(), inline })
    },
    []
  )

  // 插入脚注：扫描当前 Lexical 状态内所有引用与定义，计算不冲突的自增编号
  const openFootnoteEditor = useCallback(() => {
    const button = footnoteButtonRef.current
    if (!button) return
    let snapshot: FootnoteUsageSnapshot | null = null
    editor.getEditorState().read(() => {
      snapshot = collectFootnoteStateFromLexical()
    })
    if (!snapshot) return
    setFootnoteEditor({
      anchorRect: button.getBoundingClientRect(),
      snapshot
    })
  }, [editor])

  const applyFootnote = useCallback(
    (payload: { id: string; content: string; mode: FootnoteInsertMode }) => {
      editor.dispatchCommand(INSERT_FOOTNOTE_COMMAND, payload)
    },
    [editor]
  )

  const applyEquation = useCallback(
    (equation: string) => {
      const inline = equationEditor?.inline ?? false
      editor.update(
        () => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          const node = $createWorkbenchEquationNode(equation, inline)
          if (inline) {
            selection.insertNodes([node])
          } else {
            // 块级公式：取锚点所在顶层块，插到它后面，光标落到新段落
            const topBlock = selection.anchor.getNode().getTopLevelElementOrThrow()
            topBlock.insertAfter(node)
          }
          node.selectNext()
        },
        { discrete: true }
      )
    },
    [editor, equationEditor]
  )

  const openLinkEditor = useCallback(() => {
    const button = linkButtonRef.current
    if (!button) return

    let initialUrl: string | null = null
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const linkNode = $findMatchingParent(selection.anchor.getNode(), $isLinkNode)
      if (linkNode && $isLinkNode(linkNode)) {
        initialUrl = linkNode.getURL()
      }
    })
    setLinkEditor({ anchorRect: button.getBoundingClientRect(), initialUrl })
  }, [editor])

  const insertImage = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (!files.length) return
      // 通过隐藏 input 选择本地文件，转成 File 对象走 dataUrl 通道
      // （input 拿到的 file.path 在沙盒渲染进程可能为空，统一用 FileReader）
      void (async () => {
        const workspacePath = useWorkbenchStore.getState().workspacePath
        const activeFilePath = useWorkbenchStore.getState().activeFilePath
        if (!workspacePath || !activeFilePath) return

        const results: { src: string; altText?: string }[] = []
        for (const file of files) {
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result as string)
              r.onerror = reject
              r.readAsDataURL(file)
            })
            const res = await window.api.workbench.saveImage(workspacePath, activeFilePath, {
              dataUrl,
              fileName: file.name
            })
            if (res.success && res.data) {
              results.push({ src: res.data.relativePath, altText: file.name })
            }
          } catch (err) {
            console.error('[WorkbenchImage] 工具栏插入图片失败:', err)
          }
        }
        if (results.length) {
          editor.dispatchCommand(INSERT_WORKBENCH_IMAGE_COMMAND, results)
          void useWorkbenchStore.getState().loadFileTree()
        }
      })()
    }
    input.click()
  }, [editor])

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
    <>
      <div className="h-12 px-3 bg-white/70 dark:bg-gray-800/70 backdrop-blur-md border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 select-none text-body">
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
              <AppIcon name="left_panel_open" size={20} />
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
          <AppIcon name="undo" size={20} />
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo || !isEditable}
          className="w-8 h-8 flex items-center justify-center rounded-md text-text-primary hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
          title="重做 (Ctrl+Y)"
        >
          <AppIcon name="redo" size={20} />
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 段落类型下拉：portal 渲染到 body，按钮回显当前块类型 */}
        <WorkbenchDropDown
          buttonAriaLabel="段落格式选项"
          buttonTitle="段落格式"
          buttonClassName="h-8 px-2.5 flex items-center gap-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-text-primary transition-colors font-medium text-body"
          buttonContent={
            <>
              <span className="min-w-[3.5rem] text-left">{BLOCK_TYPE_LABELS[blockType]}</span>
              <AppIcon name="arrow_drop_down" size={19} />
            </>
          }
        >
          <WorkbenchDropDownItem className={itemClass(blockType === 'paragraph')} onClick={formatParagraph}>
            <AppIcon name="notes" size={19} className="text-text-secondary" />
            <span>正文段落</span>
          </WorkbenchDropDownItem>
          {(['h1', 'h2', 'h3', 'h4'] as const).map((level) => (
            <WorkbenchDropDownItem
              key={level}
              className={itemClass(blockType === level)}
              onClick={() => formatHeading(level)}
            >
              <span className="text-label font-mono text-text-secondary w-5">{level.toUpperCase()}</span>
              <span className={level === 'h1' ? 'font-bold' : level === 'h2' ? 'font-semibold' : ''}>
                {BLOCK_TYPE_LABELS[level]}
              </span>
            </WorkbenchDropDownItem>
          ))}
          <WorkbenchDropDownDivider />
          <WorkbenchDropDownItem className={itemClass(blockType === 'bullet')} onClick={formatBulletList}>
            <AppIcon name="format_list_bulleted" size={19} className="text-text-secondary" />
            <span>无序列表</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(blockType === 'number')} onClick={formatNumberedList}>
            <AppIcon name="format_list_numbered" size={19} className="text-text-secondary" />
            <span>有序列表</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(blockType === 'check')} onClick={formatCheckList}>
            <AppIcon name="checklist" size={19} className="text-text-secondary" />
            <span>待办清单</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownDivider />
          <WorkbenchDropDownItem className={itemClass(blockType === 'quote')} onClick={formatQuote}>
            <AppIcon name="format_quote" size={19} className="text-text-secondary" />
            <span>引用区块</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(blockType === 'code')} onClick={formatCodeBlock}>
            <AppIcon name="terminal" size={19} className="text-text-secondary" />
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
          <AppIcon name="format_bold" size={20} />
        </button>
        <button
          type="button"
          onClick={() => applyFormat('italic')}
          className={iconBtnClass(isItalic)}
          title="斜体 (Ctrl+I)"
          aria-label="斜体"
        >
          <AppIcon name="format_italic" size={20} />
        </button>
        <button
          type="button"
          onClick={() => applyFormat('underline')}
          className={iconBtnClass(isUnderline)}
          title="下划线 (Ctrl+U)"
          aria-label="下划线"
        >
          <AppIcon name="format_underlined" size={20} />
        </button>
        <button
          type="button"
          onClick={() => applyFormat('strikethrough')}
          className={iconBtnClass(isStrikethrough)}
          title="删除线"
          aria-label="删除线"
        >
          <AppIcon name="format_strikethrough" size={20} />
        </button>
        <button
          type="button"
          onClick={() => applyFormat('code')}
          className={iconBtnClass(isCode)}
          title="行内代码"
          aria-label="行内代码"
        >
          <AppIcon name="code" size={20} />
        </button>
        <button
          type="button"
          onClick={() => applyFormat('highlight')}
          className={iconBtnClass(isHighlight)}
          title="高亮"
          aria-label="高亮"
        >
          <AppIcon name="ink_highlighter" size={20} />
        </button>

        {/* 上标 / 下标：Markdown 序列化为 <sup>/<sub>，Word 式紧凑下拉 */}
        <WorkbenchDropDown
          buttonAriaLabel="上下标"
          buttonTitle="上下标 (Ctrl+. / Ctrl+,)"
          buttonClassName={`h-8 px-1.5 flex items-center justify-center rounded-md transition-colors font-medium ${
            isSuperscript || isSubscript
              ? 'bg-primary/15 text-primary'
              : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
          }`}
          buttonContent={
            <span className="text-body leading-none">
              x{isSubscript ? '₂' : '²'}
            </span>
          }
        >
          <WorkbenchDropDownItem
            className={itemClass(isSuperscript)}
            onClick={() => applyFormat('superscript')}
          >
            <AppIcon name="format_superscript" size={19} className="text-text-secondary" />
            <span>上标</span>
            <span className="ml-auto text-label text-text-secondary">Ctrl+.</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem
            className={itemClass(isSubscript)}
            onClick={() => applyFormat('subscript')}
          >
            <AppIcon name="format_subscript" size={19} className="text-text-secondary" />
            <span>下标</span>
            <span className="ml-auto text-label text-text-secondary">Ctrl+,</span>
          </WorkbenchDropDownItem>
        </WorkbenchDropDown>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 列表快捷按钮：active 态跟随块类型 */}
        <button
          type="button"
          onClick={formatBulletList}
          className={iconBtnClass(blockType === 'bullet')}
          title="无序列表"
        >
          <AppIcon name="format_list_bulleted" size={20} />
        </button>
        <button
          type="button"
          onClick={formatNumberedList}
          className={iconBtnClass(blockType === 'number')}
          title="有序列表"
        >
          <AppIcon name="format_list_numbered" size={20} />
        </button>
        <button
          type="button"
          onClick={formatCheckList}
          className={iconBtnClass(blockType === 'check')}
          title="待办清单 (Checklist)"
        >
          <AppIcon name="checklist" size={20} />
        </button>
        <button
          type="button"
          onClick={formatQuote}
          className={iconBtnClass(blockType === 'quote')}
          title="引用区块"
        >
          <AppIcon name="format_quote" size={20} />
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 插入组件：表格、水平分割线、超链接 */}
        <button
          type="button"
          onClick={applyInsertTable}
          className={iconBtnClass(false)}
          title="插入表格 (3x3)"
        >
          <AppIcon name="table_chart" size={20} />
        </button>
        <button
          type="button"
          onClick={applyHorizontalRule}
          className={iconBtnClass(false)}
          title="插入水平分割线"
        >
          <AppIcon name="horizontal_rule" size={20} />
        </button>
        <button
          ref={linkButtonRef}
          type="button"
          onClick={openLinkEditor}
          className={iconBtnClass(isLink)}
          title={isLink ? '编辑链接' : '插入超链接'}
        >
          <AppIcon name="link" size={20} />
        </button>
        <button
          type="button"
          onClick={insertImage}
          className={iconBtnClass(false)}
          title="插入图片"
        >
          <AppIcon name="image" size={20} />
        </button>

        <WorkbenchDropDown
          buttonAriaLabel="插入公式"
          buttonTitle="插入公式"
          buttonClassName="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-text-primary transition-colors"
          buttonContent={
            <span ref={equationButtonRef} className="flex items-center justify-center">
              <AppIcon name="function" size={20} />
            </span>
          }
        >
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => insertEquation(true)}>
            <AppIcon name="function" size={19} className="text-text-secondary" />
            <span>行内公式</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => insertEquation(false)}>
            <AppIcon name="function" size={19} className="text-text-secondary" />
            <span>块级公式</span>
          </WorkbenchDropDownItem>
        </WorkbenchDropDown>

        {/* 插入脚注：编号 [^id] 引用插到光标处，定义行追加到文末 */}
        <button
          ref={footnoteButtonRef}
          type="button"
          onClick={openFootnoteEditor}
          className={iconBtnClass(false)}
          title="插入脚注"
          aria-label="插入脚注"
        >
          <AppIcon name="footnote" size={20} />
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        {/* 对齐方式下拉：portal + 当前对齐回显 */}
        <WorkbenchDropDown
          buttonAriaLabel="对齐方式"
          buttonTitle="对齐方式"
          buttonClassName="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-text-primary transition-colors"
          buttonContent={
            <AppIcon name={ELEMENT_FORMATS.find((f) => f.format === elementFormat)?.icon ?? 'format_align_left'} size={20} />
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
                <AppIcon name={icon} size={20} />
              </button>
            ))}
          </div>
        </WorkbenchDropDown>
      </div>

      {/* 右侧：富文本/源码切换（字数与保存状态悬浮在编辑区右下角） */}
      <div className="flex items-center gap-2.5 text-text-secondary text-body shrink-0">
        <WorkbenchDropDown
          buttonAriaLabel="正文宽度选项"
          buttonTitle="正文宽度"
          buttonClassName="h-8 px-2.5 flex items-center gap-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-text-secondary transition-colors text-body"
          buttonContent={
            <>
              <span>
                {contentWidth === 'narrow' ? '窄' : contentWidth === 'wide' ? '宽' : '中'}
              </span>
              <AppIcon name="arrow_drop_down" size={16} />
            </>
          }
        >
          {(
            [
              { value: 'narrow', label: '窄', hint: '640px' },
              { value: 'medium', label: '中', hint: '720px' },
              { value: 'wide', label: '宽', hint: '880px' }
            ] as const
          ).map((item) => (
            <WorkbenchDropDownItem
              key={item.value}
              className={itemClass(contentWidth === item.value)}
              onClick={() => setContentWidth(item.value)}
            >
              <span className="w-6">{item.label}</span>
              <span className="text-label text-text-secondary">{item.hint}</span>
            </WorkbenchDropDownItem>
          ))}
        </WorkbenchDropDown>
        <div className="flex items-center p-0.5 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
          <button
            type="button"
            disabled={largeDocument}
            onClick={() => setEditorMode('wysiwyg')}
            className={`px-2.5 py-1 rounded-md text-body font-medium transition-all ${
              editorMode === 'wysiwyg'
                ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            } disabled:cursor-not-allowed disabled:opacity-40`}
            title={largeDocument ? '超过 2MB 的文档固定使用源码模式' : '预览模式'}
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setEditorMode('source')}
            className={`px-2.5 py-1 rounded-md text-body font-medium transition-all ${
              editorMode === 'source'
                ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="原始 Markdown 源码模式"
          >
            源码
          </button>
        </div>
      </div>
      </div>
      {linkEditor && (
        <WorkbenchLinkEditor
          editor={editor}
          anchorRect={linkEditor.anchorRect}
          initialUrl={linkEditor.initialUrl}
          onClose={() => setLinkEditor(null)}
        />
      )}
      {equationEditor && (
        <WorkbenchEquationEditor
          anchorRect={equationEditor.anchorRect}
          initialEquation=""
          inline={equationEditor.inline}
          onApply={applyEquation}
          onClose={() => setEquationEditor(null)}
        />
      )}
      {footnoteEditor && (
        <WorkbenchFootnotePopover
          anchorRect={footnoteEditor.anchorRect}
          defaultId={footnoteEditor.snapshot.nextId}
          existingDefinitions={footnoteEditor.snapshot.definitions}
          usedIds={footnoteEditor.snapshot.usedIds}
          onApply={applyFootnote}
          onClose={() => setFootnoteEditor(null)}
        />
      )}
    </>
  )
}
