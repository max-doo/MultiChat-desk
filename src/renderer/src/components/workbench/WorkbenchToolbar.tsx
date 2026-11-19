import { useCallback, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND
} from 'lexical'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND
} from '@lexical/list'
import { useWorkbenchStore } from '../../store/workbenchStore'

export default function WorkbenchToolbar(): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const setEditorMode = useWorkbenchStore((s) => s.setEditorMode)
  const [formatMenuOpen, setFormatMenuOpen] = useState(false)

  // 格式操作方法
  const applyHeading = useCallback(
    (level: 'h1' | 'h2' | 'h3') => {
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(level))
        }
      })
      setFormatMenuOpen(false)
    },
    [editor]
  )

  const applyParagraph = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode())
      }
    })
    setFormatMenuOpen(false)
  }, [editor])

  const applyQuote = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode())
      }
    })
    setFormatMenuOpen(false)
  }, [editor])

  const applyBulletList = useCallback(() => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
  }, [editor])

  const applyNumberedList = useCallback(() => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
  }, [editor])

  const applyFormat = useCallback(
    (format: 'bold' | 'italic' | 'strikethrough' | 'code') => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    },
    [editor]
  )

  const handleUndo = useCallback(() => {
    editor.dispatchCommand(UNDO_COMMAND, undefined)
  }, [editor])

  const handleRedo = useCallback(() => {
    editor.dispatchCommand(REDO_COMMAND, undefined)
  }, [editor])

  // 字数与字符统计
  const charCount = activeFileContent.length
  const wordCount = activeFileContent.trim() ? activeFileContent.trim().split(/\s+/).length : 0

  return (
    <div className="h-10 px-3 bg-white/70 dark:bg-gray-800/70 backdrop-blur-md border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 select-none text-xs">
      {/* 左侧：格式化与排版工具组 */}
      <div className="flex items-center gap-0.5">
        {/* 段落类型下拉 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setFormatMenuOpen(!formatMenuOpen)}
            className="h-7 px-2 flex items-center gap-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors font-medium"
            title="选择段落格式"
          >
            <span>段落格式</span>
            <span className="material-symbols-outlined text-[15px]">arrow_drop_down</span>
          </button>

          {formatMenuOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-32 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-black/10 dark:border-white/10 z-30 animate-in fade-in zoom-in-95 duration-100"
              onMouseLeave={() => setFormatMenuOpen(false)}
            >
              <button
                type="button"
                onClick={applyParagraph}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-xs"
              >
                正文段落
              </button>
              <button
                type="button"
                onClick={() => applyHeading('h1')}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-xs font-bold"
              >
                一级标题 H1
              </button>
              <button
                type="button"
                onClick={() => applyHeading('h2')}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-xs font-semibold"
              >
                二级标题 H2
              </button>
              <button
                type="button"
                onClick={() => applyHeading('h3')}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-xs"
              >
                三级标题 H3
              </button>
              <div className="my-1 border-t border-black/5 dark:border-white/5" />
              <button
                type="button"
                onClick={applyQuote}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-xs italic"
              >
                引用区块
              </button>
            </div>
          )}
        </div>

        <div className="w-[1px] h-4 bg-black/10 dark:border-white/10 mx-1" />

        {/* 行内加粗、斜体、删除线、行内代码 */}
        <button
          type="button"
          onClick={() => applyFormat('bold')}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="粗体 (Ctrl+B)"
        >
          <span className="material-symbols-outlined text-[17px]">format_bold</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('italic')}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="斜体 (Ctrl+I)"
        >
          <span className="material-symbols-outlined text-[17px]">format_italic</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('strikethrough')}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="删除线"
        >
          <span className="material-symbols-outlined text-[17px]">format_strikethrough</span>
        </button>
        <button
          type="button"
          onClick={() => applyFormat('code')}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="行内代码"
        >
          <span className="material-symbols-outlined text-[17px]">code</span>
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:border-white/10 mx-1" />

        {/* 列表 */}
        <button
          type="button"
          onClick={applyBulletList}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="无序列表"
        >
          <span className="material-symbols-outlined text-[17px]">format_list_bulleted</span>
        </button>
        <button
          type="button"
          onClick={applyNumberedList}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="有序列表"
        >
          <span className="material-symbols-outlined text-[17px]">format_list_numbered</span>
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:border-white/10 mx-1" />

        {/* 撤销 / 重做 */}
        <button
          type="button"
          onClick={handleUndo}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="撤销 (Ctrl+Z)"
        >
          <span className="material-symbols-outlined text-[17px]">undo</span>
        </button>
        <button
          type="button"
          onClick={handleRedo}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-primary transition-colors"
          title="重做 (Ctrl+Y)"
        >
          <span className="material-symbols-outlined text-[17px]">redo</span>
        </button>
      </div>

      {/* 右侧：保存状态、字数统计、富文本/源码切换、快捷保存 */}
      <div className="flex items-center gap-3 text-text-secondary text-[11px]">
        {/* 字数与字符统计 */}
        <span title={`字数: ${wordCount}，字符数: ${charCount}`}>
          {wordCount} 词 · {charCount} 字符
        </span>

        {/* 保存状态指示 */}
        <div className="flex items-center gap-1.5 font-medium">
          {saveStatus === 'saving' ? (
            <span className="flex items-center gap-1 text-amber-500">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>正在保存...</span>
            </span>
          ) : saveStatus === 'error' ? (
            <span className="flex items-center gap-1 text-rose-500" title="点击重试保存">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              <span>保存失败</span>
            </span>
          ) : isDirty ? (
            <span className="flex items-center gap-1 text-text-secondary">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span>未保存修改</span>
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
          className={`h-6 px-2 flex items-center gap-1 rounded font-medium transition-all ${
            isDirty
              ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-xs'
              : 'text-text-secondary/60 hover:text-text-primary'
          }`}
          title="保存文档 (Ctrl+S)"
        >
          <span className="material-symbols-outlined text-[14px]">save</span>
          <span>保存</span>
        </button>

        {/* 富文本 / 源码模式切换 */}
        <div className="flex items-center p-0.5 bg-black/5 dark:bg-white/5 rounded">
          <button
            type="button"
            onClick={() => setEditorMode('wysiwyg')}
            className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
              editorMode === 'wysiwyg'
                ? 'bg-white dark:bg-gray-700 text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="富文本渲染模式"
          >
            富文本
          </button>
          <button
            type="button"
            onClick={() => setEditorMode('source')}
            className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-all ${
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
