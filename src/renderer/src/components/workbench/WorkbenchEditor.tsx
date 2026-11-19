import { useEffect, useMemo, useCallback } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TRANSFORMERS } from '@lexical/markdown'

import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode, AutoLinkNode } from '@lexical/link'

import { useWorkbenchStore } from '../../store/workbenchStore'
import WorkbenchToolbar from './WorkbenchToolbar'
import MarkdownSyncPlugin from './MarkdownSyncPlugin'
import WorkbenchSelectionMenuPlugin from './WorkbenchSelectionMenuPlugin'

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
    listitem: 'leading-relaxed',
    nested: {
      listitem: 'list-none'
    }
  },
  quote: 'border-l-4 border-blue-500/70 pl-4 py-1.5 my-3 italic text-text-secondary bg-blue-50/20 dark:bg-blue-900/10 rounded-r',
  code: 'bg-black/5 dark:bg-white/5 text-rose-600 dark:text-rose-400 font-mono text-[13px] px-1.5 py-0.5 rounded border border-black/5 dark:border-white/5',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
    code: 'bg-black/5 dark:bg-white/5 text-rose-600 dark:text-rose-400 font-mono text-[13px] px-1.5 py-0.5 rounded'
  },
  table: 'border-collapse border border-black/10 dark:border-white/10 my-4 w-full text-sm',
  tableRow: 'border-b border-black/10 dark:border-white/10',
  tableCell: 'border border-black/10 dark:border-white/10 p-2 align-top text-text-primary',
  tableCellHeader: 'bg-black/5 dark:bg-white/5 font-semibold text-text-primary'
}

export default function WorkbenchEditor(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const createFile = useWorkbenchStore((s) => s.createFile)

  // 全局 Ctrl+S / Cmd+S 保存快捷键
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActiveFile()
      }
    },
    [saveActiveFile]
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
        AutoLinkNode
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

  // 纯源码编辑模式
  if (editorMode === 'source') {
    return (
      <div className="flex-1 h-full flex flex-col overflow-hidden bg-white dark:bg-gray-900" data-workbench-editor="true">
        <div className="h-10 px-4 bg-white/70 dark:bg-gray-800/70 border-b border-black/5 dark:border-white/5 flex items-center justify-between text-xs">
          <span className="font-mono text-text-secondary truncate">{activeFilePath} (源码视图)</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-secondary">Ctrl+S 保存</span>
          </div>
        </div>
        <textarea
          value={activeFileContent}
          onChange={(e) => updateActiveContent(e.target.value)}
          placeholder="编写 Markdown 内容..."
          className="flex-1 w-full p-6 font-mono text-[13px] leading-relaxed resize-none bg-transparent text-text-primary focus:outline-none overflow-y-auto"
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
          <div className="w-full max-w-[860px] px-8 py-6 min-h-full">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="prose dark:prose-invert max-w-none min-h-[500px] focus:outline-none text-text-primary select-text"
                  spellCheck={false}
                />
              }
              placeholder={
                <div className="absolute top-6 left-8 text-gray-400 dark:text-gray-500 text-[15px] pointer-events-none select-none">
                  输入 Markdown 或富文本内容，支持使用 #、-、&gt; 等即时补全语法...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
        </div>

        {/* 内部插件注入 */}
        <HistoryPlugin />
        <AutoFocusPlugin />
        <ListPlugin />
        <LinkPlugin />
        <TablePlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <MarkdownSyncPlugin />
        <WorkbenchSelectionMenuPlugin />
      </LexicalComposer>
    </div>
  )
}
