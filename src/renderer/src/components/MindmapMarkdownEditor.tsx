import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, indentWithTab, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags } from '@lezer/highlight'

interface MindmapMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  active: boolean
  actions: ReactNode
  viewSwitcher: ReactNode
}

const externalChange = Annotation.define<boolean>()
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#1d4ed8', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: '#2563eb', textDecoration: 'underline' },
  { tag: [tags.monospace, tags.quote], color: '#7c3aed' },
  { tag: tags.processingInstruction, color: '#64748b' }
])

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', color: '#1f2937', backgroundColor: '#ffffff' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, "SFMono-Regular", monospace', lineHeight: '1.7' },
  '.cm-content': { padding: '12px 0', caretColor: '#2563eb' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: '#f8fafc', color: '#94a3b8', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#eff6ff' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#dbeafe' },
  '.cm-content ::selection': { backgroundColor: '#dbeafe' }
})

export default function MindmapMarkdownEditor({ value, onChange, active, actions, viewSwitcher }: MindmapMarkdownEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  valueRef.current = value
  onChangeRef.current = onChange
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          // Markdown 的 Enter/Backspace 优先于通用按键；Tab 与导图层级统一为两个空格。
          markdown({ base: markdownLanguage, completeHTMLTags: false, pasteURLAsLink: false }),
          keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap]),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          editorTheme,
          placeholder('# 根节点\n## 一级节点\n- 二级节点'),
          EditorView.contentAttributes.of({ 'aria-label': '思维导图 Markdown 编辑器', spellcheck: 'false' }),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return
            setHistoryState({ canUndo: undoDepth(update.state) > 0, canRedo: redoDepth(update.state) > 0 })
            // 画布编辑、恢复模板等外部变更已经保存，不重复触发父组件的保存回调。
            if (update.transactions.some(transaction => transaction.annotation(externalChange))) return
            onChangeRef.current(update.state.doc.toString())
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalChange.of(true), isolateHistory.of('full')]
    })
  }, [value])

  useEffect(() => {
    if (!active) return
    viewRef.current?.requestMeasure()
  }, [active])

  const runCommand = (command: (view: EditorView) => boolean): void => {
    const view = viewRef.current
    if (!view) return
    command(view)
    view.focus()
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 text-xs text-text-secondary select-none">
        <div className="flex flex-wrap items-center gap-1">
          {actions}
          <span className="w-px h-4 bg-gray-200 mx-1" aria-hidden="true" />
          <button type="button" onClick={() => runCommand(undo)} disabled={!historyState.canUndo} title="撤销 (Ctrl+Z)" aria-label="撤销大纲编辑" className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"><span className="material-symbols-outlined text-base">undo</span></button>
          <button type="button" onClick={() => runCommand(redo)} disabled={!historyState.canRedo} title="重做 (Ctrl+Y / Ctrl+Shift+Z)" aria-label="重做大纲编辑" className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"><span className="material-symbols-outlined text-base">redo</span></button>
          <button type="button" onClick={() => runCommand(indentMore)} title="增加缩进 (Tab)" aria-label="增加缩进" className="p-1 rounded hover:bg-gray-100"><span className="material-symbols-outlined text-base">format_indent_increase</span></button>
          <button type="button" onClick={() => runCommand(indentLess)} title="减少缩进 (Shift+Tab)" aria-label="减少缩进" className="p-1 rounded hover:bg-gray-100"><span className="material-symbols-outlined text-base">format_indent_decrease</span></button>
        </div>
        {viewSwitcher}
      </div>
      <div ref={hostRef} className="flex-1 min-h-0 overflow-hidden" />
      <div className="px-3 py-1.5 border-t border-gray-100 text-[11px] text-gray-400 select-none">
        Tab 缩进 · Shift+Tab 取消缩进 · 支持多行选择 · Esc 后 Tab 移出编辑器
      </div>
    </div>
  )
}
