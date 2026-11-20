import { useMemo, useCallback, useState } from 'react'
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
import MarkdownSyncPlugin, { WORKBENCH_TRANSFORMERS } from './MarkdownSyncPlugin'
import WorkbenchSelectionMenuPlugin from './WorkbenchSelectionMenuPlugin'
import WorkbenchFloatingToolbarPlugin from './WorkbenchFloatingToolbarPlugin'
import WorkbenchDraggableBlockPlugin from './WorkbenchDraggableBlockPlugin'
import WorkbenchTableCellResizerPlugin from './WorkbenchTableCellResizerPlugin'
import WorkbenchTableActionMenuPlugin from './WorkbenchTableActionMenuPlugin'
import WorkbenchSourceEditor from './WorkbenchSourceEditor'
import WorkbenchCodePreview from './WorkbenchCodePreview'
import WorkbenchImagePreview from './WorkbenchImagePreview'
import WorkbenchPdfPreview from './WorkbenchPdfPreview'
import WorkbenchDocxCard from './WorkbenchDocxCard'

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
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const setEditorMode = useWorkbenchStore((s) => s.setEditorMode)
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const toggleLeftCollapse = useWorkbenchStore((s) => s.toggleLeftCollapse)
  const createFile = useWorkbenchStore((s) => s.createFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)

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
        HorizontalRuleNode
      ],
      onError: (error: Error) => {
        console.error('[WorkbenchEditor] Lexical Error:', error)
      }
    }),
    []
  )

  // 字符和词数统计
  const charCount = activeFileContent.length
  const wordCount = activeFileContent.trim() ? activeFileContent.trim().split(/\s+/).length : 0

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
    return <WorkbenchCodePreview key={activeFilePath} />
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
    return <WorkbenchCodePreview key={activeFilePath} />
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
        className="flex-1 h-full flex flex-col overflow-hidden bg-white dark:bg-gray-900"
        data-workbench-editor="true"
      >
        {/* 源码模式顶部栏：路径、统计、自动保存状态与视图切换 */}
        <div className="h-12 px-3 bg-white/70 dark:bg-gray-800/70 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 select-none text-sm">
          <div className="flex items-center gap-2 truncate">
            {isLeftCollapsed && (
              <button
                type="button"
                onClick={toggleLeftCollapse}
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
                title="展开侧边栏"
                aria-label="展开侧边栏"
              >
                <span className="material-symbols-outlined text-base">left_panel_open</span>
              </button>
            )}
            <span className="font-mono text-text-secondary text-sm truncate" title={activeFilePath}>
              {activeFilePath} (源码视图)
            </span>
          </div>

          <div className="flex items-center gap-2.5 text-text-secondary text-sm shrink-0">
            <span className="hidden sm:inline" title={`字数: ${wordCount}，字符数: ${charCount}`}>
              {wordCount} 词 · {charCount} 字符
            </span>

            {/* 保存状态指示 */}
            <div className="flex items-center gap-1.5 font-medium">
              {saveStatus === 'saving' ? (
                <span className="flex items-center gap-1 text-amber-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>保存中...</span>
                </span>
              ) : saveStatus === 'error' ? (
                <span className="flex items-center gap-1 text-rose-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  <span>保存失败</span>
                </span>
              ) : (
                <span className="text-text-secondary">已保存</span>
              )}
            </div>

            {/* 模式分段控件 */}
            <div className="flex items-center p-0.5 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
              <button
                type="button"
                onClick={() => setEditorMode('wysiwyg')}
                className="px-2.5 py-1 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary transition-all"
                title="预览模式"
              >
                预览
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('source')}
                className="px-2.5 py-1 rounded-md text-sm font-medium bg-white dark:bg-gray-700 text-primary shadow-xs transition-all"
                title="原始 Markdown 源码模式"
              >
                源码
              </button>
            </div>
          </div>
        </div>

        <WorkbenchSourceEditor
          value={activeFileContent}
          onChange={updateActiveContent}
        />
      </div>
    )
  }

  // 富文本编辑模式 (Meta Lexical)
  return (
    <div
      className="flex-1 h-full flex flex-col overflow-hidden bg-white dark:bg-gray-900"
      data-workbench-editor="true"
    >
      <LexicalComposer initialConfig={initialConfig}>
        {/* 顶部富文本格式工具栏 */}
        <WorkbenchToolbar />

        {/* 编辑器画布可滚动容器 */}
        <div className="flex-1 overflow-y-auto relative flex justify-center">
          <div ref={onRef} className="relative w-full max-w-[900px] pl-14 pr-8 py-6 min-h-full">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="max-w-none min-h-[500px] focus:outline-none text-text-primary select-text"
                  spellCheck={false}
                />
              }
              placeholder={
                <div className="absolute top-6 left-14 text-gray-400 dark:text-gray-500 text-[16px] pointer-events-none select-none">
                  输入 Markdown 或富文本内容，支持使用 #、-、&gt; 等即时补全语法...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />

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
        <WorkbenchSelectionMenuPlugin />
        <WorkbenchTableCellResizerPlugin />
      </LexicalComposer>
    </div>
  )
}
