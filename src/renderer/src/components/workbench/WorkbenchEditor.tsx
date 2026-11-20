import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'

import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode, AutoLinkNode } from '@lexical/link'

import { useWorkbenchStore } from '../../store/workbenchStore'
import WorkbenchToolbar from './WorkbenchToolbar'
import WorkbenchSourceToolbar from './WorkbenchSourceToolbar'
import MarkdownSyncPlugin, {
  WORKBENCH_TRANSFORMERS,
  parseMarkdownWithFrontmatter
} from './MarkdownSyncPlugin'
import FrontmatterPanel from './FrontmatterPanel'
import WorkbenchTitleBar from './WorkbenchTitleBar'
import { PendingInsertNode } from './PendingInsertNode'
import { PendingBarNode } from './PendingBarNode'
import { WorkbenchImageNode } from './WorkbenchImageNode'
import WorkbenchImagePlugin from './WorkbenchImagePlugin'
import WorkbenchSelectionMenuPlugin from './WorkbenchSelectionMenuPlugin'
import WorkbenchFloatingToolbarPlugin from './WorkbenchFloatingToolbarPlugin'
import WorkbenchDraggableBlockPlugin from './WorkbenchDraggableBlockPlugin'
import WorkbenchTableCellResizerPlugin from './WorkbenchTableCellResizerPlugin'
import WorkbenchTableActionMenuPlugin from './WorkbenchTableActionMenuPlugin'
import WorkbenchCodeHighlightPlugin from './WorkbenchCodeHighlightPlugin'
import WorkbenchSourceEditor from './WorkbenchSourceEditor'
import type { WorkbenchSourceEditorHandle } from './WorkbenchSourceEditor'
import WorkbenchCodePreview from './WorkbenchCodePreview'
import WorkbenchImagePreview from './WorkbenchImagePreview'
import WorkbenchPdfPreview from './WorkbenchPdfPreview'
import WorkbenchDocxCard from './WorkbenchDocxCard'
import WorkbenchStatusPill from './WorkbenchStatusPill'
import WorkbenchFindReplaceBar from './WorkbenchFindReplaceBar'
import WorkbenchFindHighlightPlugin, { revealRangeInLexical } from './WorkbenchFindHighlightPlugin'

const lexicalTheme = {
  paragraph: 'PlaygroundEditorTheme__paragraph',
  heading: {
    h1: 'PlaygroundEditorTheme__h1',
    h2: 'PlaygroundEditorTheme__h2',
    h3: 'PlaygroundEditorTheme__h3',
    h4: 'PlaygroundEditorTheme__h4',
    h5: 'PlaygroundEditorTheme__h5',
    h6: 'PlaygroundEditorTheme__h6'
  },
  list: {
    ul: 'PlaygroundEditorTheme__ul',
    checklist: 'PlaygroundEditorTheme__checklist',
    listitem: 'PlaygroundEditorTheme__listItem',
    listitemChecked: 'PlaygroundEditorTheme__listItemChecked',
    listitemUnchecked: 'PlaygroundEditorTheme__listItemUnchecked',
    nested: {
      listitem: 'PlaygroundEditorTheme__nestedListItem'
    },
    ol: 'PlaygroundEditorTheme__ol1',
    olDepth: [
      'PlaygroundEditorTheme__ol1',
      'PlaygroundEditorTheme__ol2',
      'PlaygroundEditorTheme__ol3',
      'PlaygroundEditorTheme__ol4',
      'PlaygroundEditorTheme__ol5'
    ],
    ulDepth: [
      'PlaygroundEditorTheme__ulDepth1',
      'PlaygroundEditorTheme__ulDepth2',
      'PlaygroundEditorTheme__ulDepth3'
    ]
  },
  quote: 'PlaygroundEditorTheme__quote',
  code: 'PlaygroundEditorTheme__code',
  codeHighlight: {
    atrule: 'PlaygroundEditorTheme__tokenAttr',
    attr: 'PlaygroundEditorTheme__tokenAttr',
    boolean: 'PlaygroundEditorTheme__tokenProperty',
    builtin: 'PlaygroundEditorTheme__tokenSelector',
    cdata: 'PlaygroundEditorTheme__tokenComment',
    char: 'PlaygroundEditorTheme__tokenSelector',
    class: 'PlaygroundEditorTheme__tokenFunction',
    'class-name': 'PlaygroundEditorTheme__tokenFunction',
    comment: 'PlaygroundEditorTheme__tokenComment',
    constant: 'PlaygroundEditorTheme__tokenProperty',
    deleted: 'PlaygroundEditorTheme__tokenProperty',
    doctype: 'PlaygroundEditorTheme__tokenComment',
    entity: 'PlaygroundEditorTheme__tokenOperator',
    function: 'PlaygroundEditorTheme__tokenFunction',
    important: 'PlaygroundEditorTheme__tokenVariable',
    inserted: 'PlaygroundEditorTheme__tokenSelector',
    keyword: 'PlaygroundEditorTheme__tokenAttr',
    namespace: 'PlaygroundEditorTheme__tokenVariable',
    number: 'PlaygroundEditorTheme__tokenProperty',
    operator: 'PlaygroundEditorTheme__tokenOperator',
    prolog: 'PlaygroundEditorTheme__tokenComment',
    property: 'PlaygroundEditorTheme__tokenProperty',
    punctuation: 'PlaygroundEditorTheme__tokenPunctuation',
    regex: 'PlaygroundEditorTheme__tokenVariable',
    selector: 'PlaygroundEditorTheme__tokenSelector',
    string: 'PlaygroundEditorTheme__tokenSelector',
    symbol: 'PlaygroundEditorTheme__tokenProperty',
    tag: 'PlaygroundEditorTheme__tokenProperty',
    url: 'PlaygroundEditorTheme__tokenOperator',
    variable: 'PlaygroundEditorTheme__tokenVariable'
  },
  text: {
    bold: 'PlaygroundEditorTheme__textBold',
    italic: 'PlaygroundEditorTheme__textItalic',
    underline: 'PlaygroundEditorTheme__textUnderline',
    strikethrough: 'PlaygroundEditorTheme__textStrikethrough',
    underlineStrikethrough: 'PlaygroundEditorTheme__textUnderlineStrikethrough',
    code: 'PlaygroundEditorTheme__textCode',
    subscript: 'PlaygroundEditorTheme__textSubscript',
    superscript: 'PlaygroundEditorTheme__textSuperscript',
    uppercase: 'PlaygroundEditorTheme__textUppercase',
    lowercase: 'PlaygroundEditorTheme__textLowercase',
    capitalize: 'PlaygroundEditorTheme__textCapitalize',
    highlight: 'PlaygroundEditorTheme__textHighlight'
  },
  link: 'PlaygroundEditorTheme__link',
  table: 'PlaygroundEditorTheme__table',
  tableCell: 'PlaygroundEditorTheme__tableCell',
  tableCellHeader: 'PlaygroundEditorTheme__tableCellHeader',
  tableCellResizer: 'PlaygroundEditorTheme__tableCellResizer',
  tableCellSelected: 'PlaygroundEditorTheme__tableCellSelected',
  tableSelected: 'PlaygroundEditorTheme__tableSelected',
  tableSelection: 'PlaygroundEditorTheme__tableSelection',
  tableScrollableWrapper: 'PlaygroundEditorTheme__tableScrollableWrapper',
  tableRowStriping: 'PlaygroundEditorTheme__tableRowStriping',
  tableAlignment: {
    center: 'PlaygroundEditorTheme__tableAlignmentCenter',
    right: 'PlaygroundEditorTheme__tableAlignmentRight'
  },
  hr: 'PlaygroundEditorTheme__hr',
  hrSelected: 'PlaygroundEditorTheme__hrSelected'
}

export default function WorkbenchEditor(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const activeFileCategory = useWorkbenchStore((s) => s.activeFileCategory)
  const activeFileDataUrl = useWorkbenchStore((s) => s.activeFileDataUrl)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const createFile = useWorkbenchStore((s) => s.createFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)
  const sourceEditorRef = useRef<WorkbenchSourceEditorHandle>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findReplaceFocus, setFindReplaceFocus] = useState(false)

  // Ctrl+F / Ctrl+H / Ctrl+S：编辑器内查找、查找替换、保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || !activeFilePath) return
      const k = e.key.toLowerCase()
      if (k === 'f' || k === 'h') {
        e.preventDefault()
        setFindReplaceFocus(k === 'h')
        setFindOpen(true)
      } else if (k === 's') {
        e.preventDefault()
        void saveActiveFile()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeFilePath, saveActiveFile])

  // 切换文件或文件类别时关闭查找条
  useEffect(() => {
    setFindOpen(false)
  }, [activeFilePath, activeFileCategory])

  // frontmatter 与正文分离：面板编辑属性，Lexical 只吃 body
  const parsedFrontmatter = useMemo(
    () => parseMarkdownWithFrontmatter(activeFileContent).frontmatter,
    [activeFileContent]
  )

  // 面板编辑 frontmatter 后：拼回正文 + 通知 MarkdownSyncPlugin 更新 frontmatterRef，
  // 否则 Lexical 下次回写会用旧 ref 把面板改动覆盖掉
  const handleFrontmatterChange = useCallback(
    (nextFrontmatter: string | null) => {
      const { markdownBody } = parseMarkdownWithFrontmatter(activeFileContent)
      const next = (nextFrontmatter || '') + markdownBody
      if (next === activeFileContent) return
      window.dispatchEvent(
        new CustomEvent('workbench:frontmatter-changed', {
          detail: { frontmatter: nextFrontmatter }
        })
      )
      updateActiveContent(next)
    },
    [activeFileContent, updateActiveContent]
  )

  const onRef = useCallback((_floatingAnchorElem: HTMLDivElement | null) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem)
    }
  }, [])

  const initialConfig = useMemo(
    () => ({
      namespace: 'WorkbenchLexicalEditor',
      theme: lexicalTheme,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        TableNode,
        TableRowNode,
        TableCellNode,
        CodeNode,
        CodeHighlightNode,
        LinkNode,
        AutoLinkNode,
        HorizontalRuleNode,
        PendingInsertNode,
        PendingBarNode,
        WorkbenchImageNode
      ],
      onError: (error: Error) => {
        console.error('[WorkbenchEditor] Lexical Error:', error)
      }
    }),
    []
  )

  // 空状态引导
  if (!activeFilePath) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-white/40 dark:bg-gray-800/40 select-none">
        <div className="w-16 h-16 mb-4 rounded-2xl bg-blue-500/10 dark:bg-blue-400/10 flex items-center justify-center text-blue-500 dark:text-blue-400">
          <span className="material-symbols-outlined text-3xl">edit_note</span>
        </div>
        <h3 className="text-base font-semibold text-text-primary mb-1">未打开任何文档</h3>
        <p className="text-xs text-text-secondary max-w-sm mb-5 leading-relaxed">
          从左侧文件树选择笔记进行阅读与编辑，或直接新建一篇 Markdown 文档开始知识创作。
        </p>
        <button
          type="button"
          onClick={() => void createFile('', '未命名笔记.md')}
          className="h-8 px-4 rounded-lg bg-primary text-white hover:bg-primary/90 text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all"
        >
          <span className="material-symbols-outlined text-[17px]">note_add</span>
          <span>新建笔记</span>
        </button>
      </div>
    )
  }

  // 代码文件专属预览与编辑
  if (activeFileCategory === 'code') {
    return (
      <div className="relative flex-1 h-full flex flex-col overflow-hidden">
        <WorkbenchCodePreview key={activeFilePath} />
        <WorkbenchStatusPill />
      </div>
    )
  }

  // 图片文件专属画布预览
  if (activeFileCategory === 'image') {
    return <WorkbenchImagePreview key={activeFilePath} />
  }

  // PDF 文件专属文档预览
  if (activeFileCategory === 'pdf') {
    return <WorkbenchPdfPreview key={activeFilePath} />
  }

  // Word 文档卡片
  if (activeFileCategory === 'document') {
    return <WorkbenchDocxCard key={activeFilePath} />
  }

  // 纯文本文件 (txt, log, csv 等)
  if (activeFileCategory === 'text') {
    return (
      <div className="relative flex-1 h-full flex flex-col overflow-hidden">
        <WorkbenchCodePreview key={activeFilePath} />
        <WorkbenchStatusPill />
      </div>
    )
  }

  // 未识别格式的二进制文件处理
  if (activeFileCategory === 'other' && !activeFileContent && !activeFileDataUrl) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-900 select-none">
        <div className="w-16 h-16 rounded-2xl bg-slate-500/10 flex items-center justify-center text-slate-500 mb-4">
          <span className="material-symbols-outlined text-3xl">draft</span>
        </div>
        <h3 className="text-base font-semibold text-text-primary mb-1">未识别格式的二进制文件</h3>
        <p className="text-xs text-text-secondary max-w-sm mb-6 leading-relaxed">
          该文件属于二进制或暂不支持直接预览的格式。您可以在系统默认关联应用中打开它。
        </p>
        <button
          type="button"
          onClick={() => {
            if (activeFilePath) void openInSystem(activeFilePath)
          }}
          className="h-9 px-5 rounded-xl bg-primary text-white hover:bg-primary/90 text-xs font-medium flex items-center gap-2 shadow-sm transition-all"
        >
          <span className="material-symbols-outlined text-[17px]">open_in_new</span>
          <span>在系统默认程序中打开</span>
        </button>
      </div>
    )
  }

  // 纯源码编辑模式
  if (editorMode === 'source') {
    return (
      <div
        className="relative flex-1 h-full flex flex-col overflow-hidden bg-white dark:bg-gray-900"
        data-workbench-editor="true"
      >
        <WorkbenchSourceToolbar editorRef={sourceEditorRef} />
        <WorkbenchSourceEditor
          ref={sourceEditorRef}
          value={activeFileContent}
          onChange={updateActiveContent}
        />
        <WorkbenchFindReplaceBar
          open={findOpen}
          replaceFocus={findReplaceFocus}
          onClose={() => setFindOpen(false)}
          canReplace={true}
          onRevealMatch={(start, end) => {
            sourceEditorRef.current?.setSelection(start, end)
            return true
          }}
        />
        <WorkbenchStatusPill />
      </div>
    )
  }

  // 富文本编辑模式 (Meta Lexical)
  return (
    <div
      className="relative flex-1 h-full flex flex-col overflow-hidden bg-white dark:bg-gray-900"
      data-workbench-editor="true"
    >
      <LexicalComposer initialConfig={initialConfig}>
        {/* 顶部富文本格式工具栏 */}
        <WorkbenchToolbar />

        {/* 编辑器画布可滚动容器 */}
        <div className="flex-1 overflow-y-auto relative flex justify-center">
          <div ref={onRef} className="relative w-full max-w-[900px] pl-14 pr-8 py-6 min-h-full">
            {/* Obsidian 式文档标题：点击行内重命名 */}
            <WorkbenchTitleBar />

            {/* Obsidian 式笔记属性面板：frontmatter 与正文分离，不进入 Lexical */}
            <FrontmatterPanel
              frontmatter={parsedFrontmatter}
              onChange={handleFrontmatterChange}
            />

            {/* placeholder 与正文同容器定位，避免标题/属性面板高度变化后漂移 */}
            <div className="relative">
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    className="max-w-none min-h-[500px] focus:outline-none text-text-primary select-text"
                    spellCheck={false}
                  />
                }
                placeholder={
                  <div className="absolute top-0 left-0 text-gray-400 dark:text-gray-500 text-[16px] pointer-events-none select-none">
                    输入 Markdown 或富文本内容，支持使用 #、-、&gt; 等即时补全语法...
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>

            {/* 文字块拖动 Handle + "+" 插入菜单（复刻 playground） */}
            {floatingAnchorElem && (
              <WorkbenchDraggableBlockPlugin anchorElem={floatingAnchorElem} />
            )}

            {/* 选中文本时的浮动格式工具栏（复刻 playground） */}
            {floatingAnchorElem && (
              <WorkbenchFloatingToolbarPlugin anchorElem={floatingAnchorElem} />
            )}

            {/* 表格单元格操作按钮 + 菜单（复刻 playground） */}
            {floatingAnchorElem && (
              <WorkbenchTableActionMenuPlugin anchorElem={floatingAnchorElem} />
            )}
          </div>
        </div>

        {/* 内部插件注入 */}
        <HistoryPlugin />
        <AutoFocusPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <ClickableLinkPlugin />
        <TablePlugin />
        <HorizontalRulePlugin />
        <TabIndentationPlugin />
        <MarkdownShortcutPlugin transformers={WORKBENCH_TRANSFORMERS} />
        <MarkdownSyncPlugin />
        <WorkbenchCodeHighlightPlugin />
        <WorkbenchImagePlugin />
        <WorkbenchSelectionMenuPlugin />
        <WorkbenchTableCellResizerPlugin />
        <WorkbenchFindHighlightPlugin />
      </LexicalComposer>
      <WorkbenchFindReplaceBar
        open={findOpen}
        replaceFocus={findReplaceFocus}
        onClose={() => setFindOpen(false)}
        canReplace={true}
        onRevealMatch={(start, end) => revealRangeInLexical(start, end)}
      />
      <WorkbenchStatusPill />
    </div>
  )
}
