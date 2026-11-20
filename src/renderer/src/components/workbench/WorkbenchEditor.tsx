import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
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
import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
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
import WorkbenchCodePreview from './WorkbenchCodePreview'
import WorkbenchImagePreview from './WorkbenchImagePreview'
import WorkbenchPdfPreview from './WorkbenchPdfPreview'
import WorkbenchDocxCard from './WorkbenchDocxCard'

const lexicalTheme = {
  paragraph: 'mb-3 leading-relaxed text-text-primary text-[15px]',
  heading: {
    h1: 'text-2xl font-bold mt-6 mb-3 text-text-primary border-b border-black/10 dark:border-white/10 pb-1',
    h2: 'text-xl font-bold mt-5 mb-2 text-text-primary',
    h3: 'text-lg font-semibold mt-4 mb-2 text-text-primary',
    h4: 'text-base font-semibold mt-3 mb-1 text-text-primary',
    h5: 'text-sm font-semibold mt-2 mb-1 text-text-primary',
    h6: 'text-xs font-semibold mt-2 mb-1 text-text-primary uppercase tracking-wider'
  },
  list: {
    ul: 'list-disc pl-6 mb-3 space-y-1 text-text-primary',
    ol: 'list-decimal pl-6 mb-3 space-y-1 text-text-primary',
    checklist: 'lexical-checklist',
    listitem: 'leading-relaxed',
    listitemChecked: 'lexical-checklist-item-checked',
    listitemUnchecked: 'lexical-checklist-item',
    nested: {
      listitem: 'list-none'
    }
  },
  quote: 'border-l-4 border-primary/70 pl-4 py-2 my-3 italic text-text-secondary bg-primary/5 rounded-r',
  code: 'bg-black/5 dark:bg-white/5 text-rose-600 dark:text-rose-400 font-mono text-sm px-1.5 py-0.5 rounded border border-black/5 dark:border-white/5',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
    code: 'bg-black/5 dark:bg-white/5 text-rose-600 dark:text-rose-400 font-mono text-sm px-1.5 py-0.5 rounded'
  },
  table: 'border-collapse border border-gray-200 dark:border-gray-700 my-4 w-full text-sm',
  tableRow: 'border-b border-gray-200 dark:border-gray-700',
  tableCell: 'border border-gray-200 dark:border-gray-700 p-2.5 align-top text-text-primary',
  tableCellHeader: 'bg-black/5 dark:bg-white/5 font-semibold text-text-primary',
  hr: 'lexical-hr'
}

export default function WorkbenchEditor(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const activeFileCategory = useWorkbenchStore((s) => s.activeFileCategory)
  const activeFileDataUrl = useWorkbenchStore((s) => s.activeFileDataUrl)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const setEditorMode = useWorkbenchStore((s) => s.setEditorMode)
  const createFile = useWorkbenchStore((s) => s.createFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const targetLineRef = useRef<HTMLDivElement | null>(null)

  const onRef = useCallback((_floatingAnchorElem: HTMLDivElement | null) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem)
    }
  }, [])

  // 全局 Ctrl+S / Cmd+S 保存快捷键：仅在当前打开可编辑文本格式时触发
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (
          activeFileCategory === 'markdown' ||
          activeFileCategory === 'code' ||
          activeFileCategory === 'text'
        ) {
          void saveActiveFile()
        }
      }
    },
    [saveActiveFile, activeFileCategory]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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
        {/* 源码模式顶部栏：支持一键切回富文本，并显示统计与保存控制 */}
        <div className="h-10 px-3 bg-white/70 dark:bg-gray-800/70 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 select-none text-xs">
          <div className="flex items-center gap-2 truncate">
            <button
              type="button"
              onClick={() => setEditorMode('wysiwyg')}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded-md font-medium transition-colors"
              title="切回可视化富文本编辑器"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              <span>返回富文本模式</span>
            </button>
            <span className="font-mono text-text-secondary text-xs truncate" title={activeFilePath}>
              {activeFilePath} (源码视图)
            </span>
          </div>

          <div className="flex items-center gap-2.5 text-text-secondary text-xs shrink-0">
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
                <span className="flex items-center gap-1 text-rose-500" title="点击重试保存">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  <span>保存失败</span>
                </span>
              ) : isDirty ? (
                <span className="flex items-center gap-1 text-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span>未保存</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>已保存</span>
                </span>
              )}
            </div>

            {/* 保存按钮 */}
            <button
              type="button"
              onClick={() => void saveActiveFile()}
              disabled={!isDirty && saveStatus === 'saved'}
              className={`h-7 px-2.5 flex items-center gap-1 rounded-lg font-medium transition-all ${
                isDirty
                  ? 'bg-primary text-white hover:bg-primary/90 shadow-xs'
                  : 'text-text-secondary/60 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title="保存文档 (Ctrl+S)"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              <span>保存</span>
            </button>

            {/* 模式分段控件 */}
            <div className="flex items-center p-0.5 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
              <button
                type="button"
                onClick={() => setEditorMode('wysiwyg')}
                className="px-2 py-0.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary transition-all"
                title="富文本渲染模式"
              >
                富文本
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('source')}
                className="px-2 py-0.5 rounded-md text-xs font-medium bg-white dark:bg-gray-700 text-primary shadow-xs transition-all"
                title="原始 Markdown 源码模式"
              >
                源码
              </button>
            </div>
          </div>
        </div>

        <textarea
          value={activeFileContent}
          onChange={(e) => updateActiveContent(e.target.value)}
          placeholder="编写 Markdown 内容..."
          className="flex-1 w-full p-6 font-mono text-sm leading-relaxed resize-none bg-transparent text-text-primary focus:outline-none overflow-y-auto"
          spellCheck={false}
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
          <div ref={onRef} className="relative w-full max-w-[860px] pl-10 pr-8 py-6 min-h-full">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="prose dark:prose-invert max-w-none min-h-[500px] focus:outline-none text-text-primary select-text"
                  spellCheck={false}
                />
              }
              placeholder={
                <div className="absolute top-6 left-10 text-gray-400 dark:text-gray-500 text-[15px] pointer-events-none select-none">
                  输入 Markdown 或富文本内容，支持使用 #、-、&gt; 等即时补全语法...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />

            {/* 文字块拖动 Handle 和指示线 */}
            {floatingAnchorElem && (
              <DraggableBlockPlugin_EXPERIMENTAL
                anchorElem={floatingAnchorElem}
                menuRef={menuRef}
                targetLineRef={targetLineRef}
                menuComponent={
                  <div
                    ref={menuRef}
                    className="draggable-block-menu absolute left-0 top-0 flex items-center justify-center w-6 h-6 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors cursor-grab active:cursor-grabbing shadow-xs bg-white/95 dark:bg-gray-800/95 backdrop-blur-xs border border-black/10 dark:border-white/10 will-change-transform z-10"
                    title="按住拖拽调整段落位置"
                  >
                    <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
                  </div>
                }
                targetLineComponent={
                  <div
                    ref={targetLineRef}
                    className="pointer-events-none absolute left-0 top-0 h-[2.5px] bg-primary opacity-0 will-change-transform rounded-full shadow-xs z-10"
                  />
                }
                isOnMenu={(element: HTMLElement) => {
                  return Boolean(menuRef.current?.contains(element))
                }}
              />
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
      </LexicalComposer>
    </div>
  )
}
