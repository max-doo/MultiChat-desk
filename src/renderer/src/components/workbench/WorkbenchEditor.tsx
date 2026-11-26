import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'

import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode, AutoLinkNode } from '@lexical/link'
import { MarkNode } from '@lexical/mark'

import { isNewTabPath, useWorkbenchStore } from '../../store/workbenchStore'
import WorkbenchToolbar from './WorkbenchToolbar'
import WorkbenchSourceToolbar from './WorkbenchSourceToolbar'
import { AppIcon } from '../icons/AppIcon'
import MarkdownSyncPlugin, {
  WORKBENCH_TRANSFORMERS,
  parseMarkdownWithFrontmatter
} from './MarkdownSyncPlugin'
import FrontmatterPanel from './FrontmatterPanel'
import WorkbenchTitleBar from './WorkbenchTitleBar'
import { PendingInsertNode } from './PendingInsertNode'
import { PendingBarNode } from './PendingBarNode'
import { WorkbenchImageNode } from './WorkbenchImageNode'
import { WorkbenchHtmlTableNode } from './WorkbenchHtmlTableNode'
import { WorkbenchEquationNode } from './WorkbenchEquationNode'
import {
  WorkbenchFootnoteDefNode,
  WorkbenchFootnoteRefNode
} from './WorkbenchFootnoteNode'
import { WorkbenchHorizontalRuleNode } from './WorkbenchHorizontalRuleNode'
import WorkbenchImagePlugin from './WorkbenchImagePlugin'
import WorkbenchImageLightboxPlugin from './WorkbenchImageLightboxPlugin'
import WorkbenchFootnotePlugin from './WorkbenchFootnotePlugin'
import WorkbenchSelectionMenuPlugin from './WorkbenchSelectionMenuPlugin'
import WorkbenchFloatingToolbarPlugin from './WorkbenchFloatingToolbarPlugin'
import WorkbenchLinkHoverPlugin from './WorkbenchLinkHoverPlugin'
import WorkbenchLinkClickPlugin from './WorkbenchLinkClickPlugin'
import WorkbenchLinkPastePlugin from './WorkbenchLinkPastePlugin'
import WorkbenchEquationPastePlugin from './WorkbenchEquationPastePlugin'
import WorkbenchDraggableBlockPlugin from './WorkbenchDraggableBlockPlugin'
import WorkbenchTableCellResizerPlugin from './WorkbenchTableCellResizerPlugin'
import WorkbenchTableActionMenuPlugin from './WorkbenchTableActionMenuPlugin'
import WorkbenchCodeHighlightPlugin from './WorkbenchCodeHighlightPlugin'
import WorkbenchSourceEditor from './WorkbenchSourceEditor'
import WorkbenchAnnotationPlugin from './WorkbenchAnnotationPlugin'
import WorkbenchMarginNotes from './WorkbenchMarginNotes'
import WorkbenchGitGutterPlugin from './WorkbenchGitGutterPlugin'
import WorkbenchMinimalToc from './WorkbenchMinimalToc'
import type { WorkbenchSourceEditorHandle } from './WorkbenchSourceEditor'
import WorkbenchCodePreview from './WorkbenchCodePreview'
import WorkbenchImagePreview from './WorkbenchImagePreview'
import WorkbenchPdfPreview from './WorkbenchPdfPreview'
import WorkbenchDocxPreview from './WorkbenchDocxPreview'
import WorkbenchDocxCard from './WorkbenchDocxCard'
import WorkbenchStatusPill from './WorkbenchStatusPill'
import WorkbenchFindReplaceBar from './WorkbenchFindReplaceBar'
import WorkbenchFindHighlightPlugin, { revealRangeInLexical } from './WorkbenchFindHighlightPlugin'
import {
  readEditorScroll,
  rememberEditorScroll
} from './workbenchEditorScroll'
import 'katex/dist/katex.min.css'

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
  mark: 'PlaygroundEditorTheme__mark',
  markOverlap: 'PlaygroundEditorTheme__markOverlap',
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
  hrSelected: 'PlaygroundEditorTheme__hrSelected',
  footnoteRef: 'PlaygroundEditorTheme__footnoteRef',
  footnoteDef: 'PlaygroundEditorTheme__footnoteDef'
}

const selectFrontmatterSlice = (state: { activeFileContent: string }): string | null =>
  parseMarkdownWithFrontmatter(state.activeFileContent).frontmatter

/**
 * 独立订阅 frontmatter 切片：正文编辑不改变 frontmatter 字符串引用，
 * 避免每 250ms 写回触发 WorkbenchEditor 与 LexicalComposer 全量重渲染。
 */
const WorkbenchFrontmatterSection = memo(function WorkbenchFrontmatterSection({
  activeFilePath
}: {
  activeFilePath: string
}): JSX.Element {
  const parsedFrontmatter = useWorkbenchStore(selectFrontmatterSlice)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const gitBaselineContent = useWorkbenchStore((s) => s.gitBaselineContent)
  const gitBaselineStatus = useWorkbenchStore((s) => s.gitBaselineStatus)
  const gitBaselinePath = useWorkbenchStore((s) => s.gitBaselinePath)

  const frontmatterGitModified = useMemo(() => {
    if (
      gitBaselineStatus !== 'ok' ||
      gitBaselineContent === null ||
      gitBaselinePath !== activeFilePath
    ) {
      return false
    }
    const baselineFm = parseMarkdownWithFrontmatter(gitBaselineContent).frontmatter
    // baseline 已 LF 归一化，activeFileContent 保留磁盘原始换行：两侧统一再比
    const normalize = (value: string | null): string | null =>
      value === null ? null : value.replace(/\r\n?/g, '\n')
    return normalize(baselineFm) !== normalize(parsedFrontmatter)
  }, [gitBaselineStatus, gitBaselineContent, gitBaselinePath, activeFilePath, parsedFrontmatter])

  // 面板编辑 frontmatter 后：拼回正文（保留前导 BOM）+ 通知 MarkdownSyncPlugin 更新 frontmatterRef，
  // 否则 Lexical 下次回写会用旧 ref 把面板改动覆盖掉
  const handleFrontmatterChange = useCallback(
    (nextFrontmatter: string | null) => {
      const currentContent = useWorkbenchStore.getState().activeFileContent
      const { bom, markdownBody } = parseMarkdownWithFrontmatter(currentContent)
      const next = bom + (nextFrontmatter || '') + markdownBody
      if (next === currentContent) return
      window.dispatchEvent(
        new CustomEvent('workbench:frontmatter-changed', {
          detail: { frontmatter: nextFrontmatter }
        })
      )
      updateActiveContent(next)
    },
    [updateActiveContent]
  )

  return (
    <FrontmatterPanel
      frontmatter={parsedFrontmatter}
      filePath={activeFilePath}
      onChange={handleFrontmatterChange}
      gitModified={frontmatterGitModified}
    />
  )
})

interface WorkbenchEditorProps {
  isActive?: boolean
}

function WorkbenchEditor({ isActive = true }: WorkbenchEditorProps): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeTabPath = useWorkbenchStore((s) => s.activeTabPath)
  const activeFileCategory = useWorkbenchStore((s) => s.activeFileCategory)
  const activeFileDataUrl = useWorkbenchStore((s) => s.activeFileDataUrl)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const hasOtherTextContent = useWorkbenchStore((s) =>
    s.activeFileCategory === 'other' ? s.activeFileContent.length > 0 : false
  )
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const contentWidth = useWorkbenchStore((s) => s.contentWidth)
  const markdownBackgroundTheme = useWorkbenchStore((s) => s.markdownBackgroundTheme)
  const isMarkdownDark = markdownBackgroundTheme === 'dark'
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const createUntitledNote = useWorkbenchStore((s) => s.createUntitledNote)
  const setQuickOpenOpen = useWorkbenchStore((s) => s.setQuickOpenOpen)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const htmlRenderSurface = useWorkbenchStore((s) => s.htmlRenderSurface)

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)
  const wysiwygScrollRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const restoringWysiwygScrollRef = useRef(false)
  const sourceEditorRef = useRef<WorkbenchSourceEditorHandle>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findReplaceFocus, setFindReplaceFocus] = useState(false)

  // Ctrl+F / Ctrl+H / Ctrl+S：编辑器内查找、查找替换、保存（隐藏工作台时不响应）
  useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || !activeFilePath) return
      const k = e.key.toLowerCase()
      if (k === 'f' || k === 'h') {
        if (activeFileCategory === 'code' || activeFileCategory === 'text') return
        e.preventDefault()
        useWorkbenchStore.getState().flushActiveEditorSync()
        setFindReplaceFocus(k === 'h')
        setFindOpen(true)
      } else if (k === 's') {
        e.preventDefault()
        useWorkbenchStore.getState().flushActiveEditorSync()
        void saveActiveFile()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, activeFilePath, activeFileCategory, saveActiveFile])

  // 切换文件或文件类别时关闭查找条
  useEffect(() => {
    setFindOpen(false)
  }, [activeFilePath, activeFileCategory])

  // 标注面板在源码模式点击卡片：按文本区间定位到 textarea 选区并滚动。
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ start: number; end: number }>).detail
      if (!detail || editorMode !== 'source') return
      sourceEditorRef.current?.setSelection(detail.start, detail.end)
    }
    window.addEventListener('workbench:source-reveal', handler)
    return () => window.removeEventListener('workbench:source-reveal', handler)
  }, [editorMode])

  // 预览与源码切换会卸载当前编辑器；重新进入预览后，等 Markdown 解析完成再恢复滚动位置
  useEffect(() => {
    if (editorMode !== 'wysiwyg' || !activeFilePath) return
    const container = wysiwygScrollRef.current
    if (!container) return
    const target = readEditorScroll(workspacePath, activeFilePath, 'wysiwyg')
    if (target <= 0) {
      container.scrollTop = 0
      return
    }

    // 恢复期间忽略 scroll 事件，避免内容尚未撑开时把被夹紧的值写回记忆
    restoringWysiwygScrollRef.current = true
    let frameId = 0
    let frames = 0
    let stopped = false
    let resizeObserver: ResizeObserver | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const stop = (): void => {
      if (stopped) return
      stopped = true
      restoringWysiwygScrollRef.current = false
      cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
      resizeObserver = null
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = null
    }
    const restore = (): void => {
      if (stopped) return
      container.scrollTop = target
      frames += 1
      if (container.scrollTop >= target || frames >= 60) stop()
    }

    // 图片缩略图与字体在挂载后继续撑高内容，尺寸变化时再尝试一次
    const content = container.firstElementChild
    if (content && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (stopped) return
        container.scrollTop = target
        if (container.scrollTop >= target) stop()
      })
      resizeObserver.observe(content)
    }
    timeoutId = setTimeout(stop, 2000)
    frameId = requestAnimationFrame(restore)

    // 用户主动滚动或输入时立即让出控制权
    const onUserIntent = (): void => stop()
    container.addEventListener('wheel', onUserIntent, { passive: true })
    container.addEventListener('touchstart', onUserIntent, { passive: true })
    container.addEventListener('pointerdown', onUserIntent)
    container.addEventListener('keydown', onUserIntent)
    return () => {
      stop()
      container.removeEventListener('wheel', onUserIntent)
      container.removeEventListener('touchstart', onUserIntent)
      container.removeEventListener('pointerdown', onUserIntent)
      container.removeEventListener('keydown', onUserIntent)
    }
  }, [activeFilePath, editorMode, workspacePath])

  const handleWysiwygScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!activeFilePath || restoringWysiwygScrollRef.current) return
      rememberEditorScroll(workspacePath, activeFilePath, 'wysiwyg', e.currentTarget.scrollTop)
    },
    [activeFilePath, workspacePath]
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
        WorkbenchHorizontalRuleNode,
        PendingInsertNode,
        PendingBarNode,
        WorkbenchImageNode,
        WorkbenchHtmlTableNode,
        WorkbenchEquationNode,
        WorkbenchFootnoteRefNode,
        WorkbenchFootnoteDefNode,
        MarkNode
      ],
      onError: (error: Error) => {
        console.error('[WorkbenchEditor] Lexical Error:', error)
      }
    }),
    []
  )

  // 统一极简空白页：复用于“新标签页”与“未打开任何文档”两种空状态
  if (!activeFilePath) {
    const isVirtualNewTab = isNewTabPath(activeTabPath)
    const actions = [
      {
        key: 'new',
        icon: 'note_add',
        label: '新建笔记',
        shortcut: 'Ctrl+N',
        onClick: () => void createUntitledNote()
      },
      {
        key: 'open',
        icon: 'search',
        label: '打开文件',
        shortcut: 'Ctrl+O',
        onClick: () => setQuickOpenOpen(true)
      }
    ]
    return (
      <div className="relative flex-1 h-full flex flex-col items-center justify-center p-8 bg-white dark:bg-gray-900 select-none">
        <div className="flex flex-col items-center w-[224px] gap-2">
          <p className="text-body font-medium text-text-secondary/80 mb-2">
            {isVirtualNewTab ? '新标签页' : '未打开任何文档'}
          </p>
          {actions.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className="group w-full h-10 px-3.5 rounded-xl border border-gray-200/80 dark:border-white/10 bg-gray-50/60 dark:bg-gray-800/50 hover:bg-blue-50/50 dark:hover:bg-primary/10 hover:border-primary/35 text-body text-text-primary flex items-center justify-between transition-all duration-150"
            >
              <span className="flex items-center gap-2.5">
                <AppIcon
                  name={item.icon}
                  size={16}
                  className="text-text-secondary group-hover:text-primary transition-colors"
                />
                <span className="font-medium group-hover:text-primary transition-colors">
                  {item.label}
                </span>
              </span>
              <span className="text-caption text-text-secondary/50 group-hover:text-primary/70 transition-colors">
                {item.shortcut}
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // 代码文件专属预览与编辑
  if (activeFileCategory === 'code') {
    return (
      <div
        className={`relative flex-1 h-full flex flex-col overflow-hidden ${htmlRenderSurface ? '' : 'dark'}`}
        data-reader-theme={htmlRenderSurface ? undefined : 'dark'}
      >
        <WorkbenchCodePreview key={activeFilePath} isActive={isActive} />
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

  // Word 文档内嵌预览；老格式与 PPT 等仍走提示卡片
  if (activeFileCategory === 'document') {
    if (activeFilePath.toLowerCase().endsWith('.docx')) {
      return <WorkbenchDocxPreview key={activeFilePath} />
    }
    return <WorkbenchDocxCard key={activeFilePath} />
  }

  // 纯文本文件 (txt, log, csv 等)
  if (activeFileCategory === 'text') {
    return (
      <div
        className="relative flex-1 h-full flex flex-col overflow-hidden dark"
        data-reader-theme="dark"
      >
        <WorkbenchCodePreview key={activeFilePath} isActive={isActive} />
        <WorkbenchStatusPill />
      </div>
    )
  }

  // 未识别格式的二进制文件处理
  if (
    activeFileCategory === 'other' &&
    !hasOtherTextContent &&
    !activeFileDataUrl &&
    (activeFileSize ?? 0) >= 0
  ) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-900 select-none">
        <div className="w-16 h-16 rounded-2xl bg-slate-500/10 flex items-center justify-center text-slate-500 mb-4">
          <AppIcon name="draft" size={24} />
        </div>
        <h3 className="text-body-lg font-semibold text-text-primary mb-1">未识别格式的二进制文件</h3>
        <p className="text-body text-text-secondary max-w-sm mb-6 leading-relaxed">
          该文件属于二进制或暂不支持直接预览的格式。您可以在系统默认关联应用中打开它。
        </p>
        <button
          type="button"
          onClick={() => {
            if (activeFilePath) void openInSystem(activeFilePath)
          }}
          className="h-9 px-4 rounded-lg bg-primary text-white hover:opacity-90 text-body font-medium flex items-center gap-2 shadow-sm transition-all"
        >
          <AppIcon name="open_in_new" size={16} />
          <span>在系统默认程序中打开</span>
        </button>
      </div>
    )
  }

  // 纯源码编辑模式
  if (editorMode === 'source') {
    return (
      <div
        className={`relative flex-1 h-full flex flex-col overflow-hidden bg-white ${isMarkdownDark ? 'dark' : ''}`}
        data-workbench-editor="true"
        data-reader-theme={isMarkdownDark ? 'dark' : undefined}
      >
        <WorkbenchSourceToolbar editorRef={sourceEditorRef} />
        <WorkbenchSourceEditor ref={sourceEditorRef} />
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
      className={`relative flex-1 h-full flex flex-col overflow-hidden bg-white ${isMarkdownDark ? 'dark' : ''}`}
      data-workbench-editor="true"
      data-reader-theme={isMarkdownDark ? 'dark' : undefined}
    >
      <LexicalComposer initialConfig={initialConfig}>
        {/* 顶部富文本格式工具栏 */}
        <WorkbenchToolbar />

        {/* 编辑器画布可滚动容器 */}
        <div
          ref={wysiwygScrollRef}
          className="flex-1 overflow-y-auto relative wb-reader-canvas transition-colors duration-150"
          data-reader-canvas={markdownBackgroundTheme}
          onScroll={handleWysiwygScroll}
        >
          <div
            ref={stageRef}
            className="relative w-full min-h-full px-6 pt-6 pb-20"
          >
            <div
              ref={onRef}
              data-workbench-article="true"
              className={`relative mx-auto w-full min-w-0 px-16 ${
                contentWidth === 'narrow'
                  ? 'max-w-[768px]'
                  : contentWidth === 'wide'
                    ? 'max-w-[1008px]'
                    : 'max-w-[848px]'
              }`}
            >
            {/* Obsidian 式文档标题：点击行内重命名 */}
            <WorkbenchTitleBar />

            {/* Obsidian 式笔记属性面板：frontmatter 与正文分离，不进入 Lexical */}
            <WorkbenchFrontmatterSection activeFilePath={activeFilePath} />

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
                  <div className="absolute top-0 left-0 text-gray-400 dark:text-gray-500 text-body-lg pointer-events-none select-none">
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

            {/* 文档标注：MarkNode 投影、评论框与定位 */}
            {floatingAnchorElem && (
              <WorkbenchAnnotationPlugin anchorElem={floatingAnchorElem} />
            )}

            {/* 表格单元格操作按钮 + 菜单（复刻 playground） */}
            {floatingAnchorElem && (
              <WorkbenchTableActionMenuPlugin anchorElem={floatingAnchorElem} />
            )}
          </div>

          {/* 右侧边距原位批注便签 */}
          <WorkbenchMarginNotes stageRef={stageRef} />

          {/* 块级 Git Gutter 外挂覆盖层（不进入 ContentEditable） */}
          <WorkbenchGitGutterPlugin stageRef={stageRef} />
        </div>
        </div>

        {/* 内部插件注入 */}
        {/* 极简原位变形大纲导航 */}
        <WorkbenchMinimalToc scrollContainerRef={wysiwygScrollRef} />

        <HistoryPlugin />
        <AutoFocusPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <TablePlugin />
        <HorizontalRulePlugin />
        <TabIndentationPlugin />
        <MarkdownShortcutPlugin transformers={WORKBENCH_TRANSFORMERS} />
        <MarkdownSyncPlugin />
        <WorkbenchCodeHighlightPlugin />
        <WorkbenchImagePlugin />
        <WorkbenchImageLightboxPlugin />
        <WorkbenchFootnotePlugin />
        <WorkbenchLinkPastePlugin />
        <WorkbenchEquationPastePlugin />
        <WorkbenchLinkClickPlugin />
        <WorkbenchSelectionMenuPlugin />
        <WorkbenchLinkHoverPlugin />
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

export default memo(WorkbenchEditor)
