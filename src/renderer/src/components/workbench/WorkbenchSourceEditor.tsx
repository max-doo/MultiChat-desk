import {
  useRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef
} from 'react'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  gutter,
  GutterMarker,
  placeholder
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory
} from '@codemirror/commands'
import { indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags } from '@lezer/highlight'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { readEditorScroll, rememberEditorScroll } from './workbenchEditorScroll'
import { useGitLineDiff } from '../../hooks/useGitLineDiff'
import {
  collectFootnoteStateFromMarkdown,
  isValidFootnoteId
} from './workbenchFootnotes'

/**
 * 源码模式编辑器：CodeMirror 6 内核。
 * - 原生 lineNumbers + 自定义 Git Gutter 与 lineWrapping 像素级对齐，
 *   彻底解决旧「透明 textarea + gutterRef」在软折行下的行号错位。
 * - 视口虚拟滚动，数万行文档 DOM 常驻仅几十行。
 * - 通过 ref 暴露 applyAction / setSelection，供工具栏与查找定位复用。
 */

const externalChange = Annotation.define<boolean>()

// Compartment 用于按需重配置 Git Gutter 扩展，避免重建整个编辑器
const gitGutterCompartment = new Compartment()

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--color-primary, #1d4ed8)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: '#2563eb' },
  { tag: tags.monospace, color: '#953800' },
  { tag: tags.quote, color: '#57606a' },
  { tag: tags.processingInstruction, color: '#64748b' }
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    color: 'var(--color-text-primary, #1f2937)',
    backgroundColor: 'transparent'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace",
    lineHeight: '1.7'
  },
  '.cm-content': {
    padding: '24px 16px 80px',
    caretColor: 'var(--color-primary, #3b82f6)'
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': {
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    color: 'var(--color-text-secondary, #94a3b8)',
    border: 'none',
    borderRight: '1px solid rgba(0, 0, 0, 0.05)'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 10px 0 6px',
    minWidth: '3.5rem',
    textAlign: 'right'
  },
  '.cm-gitGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    width: '8px',
    padding: '0'
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'rgba(59, 130, 246, 0.06)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(59, 130, 246, 0.16)'
  },
  '.cm-content ::selection': { backgroundColor: 'rgba(59, 130, 246, 0.16)' }
})

class GitGutterMarker extends GutterMarker {
  constructor(
    private readonly kind: 'added' | 'modified' | 'deleted',
    private readonly alsoDeleted = false
  ) {
    super()
  }
  override toDOM(): Node {
    const el = document.createElement('span')
    el.className = `cm-git-gutter-marker git-${this.kind}`
    if (this.alsoDeleted) el.classList.add('git-also-deleted')
    return el
  }
}

function buildGitGutterExtension(
  lineMarks: Array<'added' | 'modified' | undefined>,
  deletedAfter: Map<number, number>
): Extension {
  return gutter({
    class: 'cm-gitGutter',
    lineMarker(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number - 1
      const del = deletedAfter.get(lineNo)
      const mark = lineMarks[lineNo]
      if (mark === 'added' || mark === 'modified') {
        return new GitGutterMarker(mark, !!del)
      }
      if (del) return new GitGutterMarker('deleted')
      return null
    },
    // Compartment.reconfigure 触发的 update 中 docChanged/viewportChanged 均为 false，
    // 必须始终返回 true 让 marker 随 diff 结果刷新。
    lineMarkerChange: () => true
  })
}

export type SourceToolbarAction =
  | { kind: 'wrap'; before: string; after?: string; placeholder?: string }
  | { kind: 'linePrefix'; prefix: string }
  | { kind: 'insert'; text: string; ensureBlankLine?: boolean }
  | {
      kind: 'insertFootnote'
      id: string
      content: string
      mode?: 'create' | 'reuse-ref' | 'fill-missing-def'
    }

export interface WorkbenchSourceEditorHandle {
  applyAction: (action: SourceToolbarAction) => void
  /** 选中并滚动到 [start, end) 文本区间 */
  setSelection: (start: number, end: number) => void
}

const WorkbenchSourceEditor = forwardRef<
  WorkbenchSourceEditorHandle,
  { value: string; onChange: (v: string) => void }
>(function WorkbenchSourceEditor({ value, onChange }, ref): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  valueRef.current = value
  onChangeRef.current = onChange

  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const gitDiff = useGitLineDiff(value)

  // 保存滚动位置：用户滚动时实时记忆，组件卸载前由 store 兜底
  useEffect(() => {
    if (!hostRef.current) return

    const gitGutter = buildGitGutterExtension(
      gitDiff.active ? gitDiff.lineMarks : [],
      gitDiff.active ? gitDiff.deletedAfter : new Map()
    )

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          gitGutterCompartment.of(gitGutter),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          markdown({ base: markdownLanguage, completeHTMLTags: false, pasteURLAsLink: false }),
          keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap]),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          editorTheme,
          placeholder('编写 Markdown 内容...'),
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown 源码编辑器',
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off'
          }),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return
            if (update.transactions.some(tr => tr.annotation(externalChange))) return
            onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            scroll: (_event, view) => {
              if (activeFilePath) {
                rememberEditorScroll(workspacePath, activeFilePath, 'source', view.scrollDOM.scrollTop)
              }
            }
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
    // 仅在文件切换时重建编辑器；gitGutter 随 diff 变化由下方 effect 更新
  }, [activeFilePath])

  // diff 变化时重建 gutter 扩展（轻量，gutter 只渲染视口内行）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const ext = buildGitGutterExtension(
      gitDiff.active ? gitDiff.lineMarks : [],
      gitDiff.active ? gitDiff.deletedAfter : new Map()
    )
    // CodeMirror 不允许直接替换已注册 gutter；用 dispatch 重配置代价高，
    // 改为整体重建 editor state 代价过大。采用 Compartment 按需重配置。
    // 这里直接重建整个扩展槽：把旧 gutter 替换为新配置。
    view.dispatch({
      effects: gitGutterCompartment.reconfigure(ext)
    })
  }, [gitDiff])

  // 外部内容变化（切文件、外部修改、富文本回写）时同步进 CM；
  // 用 externalChange 注解避免被当成用户输入再次回写。
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalChange.of(true), isolateHistory.of('full')]
    })
  }, [value])

  // 从预览切回源码时恢复上次滚动位置
  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || !activeFilePath) return
    const saved = readEditorScroll(workspacePath, activeFilePath, 'source')
    view.scrollDOM.scrollTop = saved
  }, [activeFilePath, workspacePath])

  const commitEdit = (start: number, end: number, text: string, selStart: number, selEnd: number): void => {
    const view = viewRef.current
    if (!view) {
      onChange(valueRef.current.slice(0, start) + text + valueRef.current.slice(end))
      return
    }
    view.dispatch({
      changes: { from: start, to: end, insert: text },
      selection: { anchor: selStart, head: selEnd },
      userEvent: 'input'
    })
    view.focus()
  }

  // 行内包裹：给选中文本加/去 before..after 标记（**、*、`、==、<u>…</u>）
  const applyWrap = (before: string, after: string, placeholder?: string): void => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()
    const selected = doc.slice(from, to)

    if (
      from >= before.length &&
      doc.slice(from - before.length, from) === before &&
      doc.slice(to, to + after.length) === after
    ) {
      commitEdit(from - before.length, to + after.length, selected, from - before.length, to - before.length)
      return
    }

    const content = selected || placeholder || ''
    const wrapped = before + content + after
    commitEdit(from, to, wrapped, from + before.length, from + before.length + content.length)
  }

  // 行前缀：对选区覆盖到的每一行加/去前缀（# 、- 、1. 、[ ]、> 、```）
  const applyLinePrefix = (prefix: string): void => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()
    const lineStart = doc.lastIndexOf('\n', from - 1) + 1
    let lineEnd = doc.indexOf('\n', to)
    if (lineEnd === -1) lineEnd = doc.length

    const block = doc.slice(lineStart, lineEnd)
    const lines = block.split('\n')
    const allPrefixed = lines.every((l) => l.startsWith(prefix) || l.trim() === '')
    const nextLines = allPrefixed
      ? lines.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l))
      : lines.map((l) => (l.trim() === '' ? l : prefix + l))
    const nextBlock = nextLines.join('\n')
    commitEdit(lineStart, lineEnd, nextBlock, lineStart, lineStart + nextBlock.length)
  }

  // 字面量插入：表格模板、分割线等；ensureBlankLine 保证与前文之间有空行
  const applyInsert = (text: string, ensureBlankLine?: boolean): void => {
    const view = viewRef.current
    if (!view) {
      onChange(valueRef.current + text)
      return
    }
    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()
    let prefix = ''
    if (ensureBlankLine) {
      const before = doc.slice(0, from)
      if (before.length > 0 && !before.endsWith('\n\n')) {
        prefix = before.endsWith('\n') ? '\n' : '\n\n'
      }
    }
    commitEdit(from, to, prefix + text, from + prefix.length + text.length, from + prefix.length + text.length)
  }

  // 插入脚注：标记 [^id] 落在光标处；仅当该 id 尚无定义且非复用模式时，才在文末追加定义行（绝不覆盖旧定义）
  const applyInsertFootnote = (
    rawId: string,
    rawContent: string,
    mode: 'create' | 'reuse-ref' | 'fill-missing-def' = 'create'
  ): void => {
    const id = rawId.trim()
    const content = rawContent.trim()
    if (!isValidFootnoteId(id)) return

    const view = viewRef.current
    const marker = `[^${id}]`
    const definitionLine = content ? `[^${id}]: ${content}` : `[^${id}]:`
    if (!view) {
      const snapshot = collectFootnoteStateFromMarkdown(valueRef.current)
      const shouldAppendDef = !snapshot.defIds.has(id) && mode !== 'reuse-ref'
      onChange(
        shouldAppendDef
          ? valueRef.current + marker + '\n\n' + definitionLine
          : valueRef.current + marker
      )
      return
    }
    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()
    const snapshot = collectFootnoteStateFromMarkdown(doc)
    const shouldAppendDef = !snapshot.defIds.has(id) && mode !== 'reuse-ref'

    const changes: Array<{ from: number; to: number; insert: string }> = [
      { from, to, insert: marker }
    ]
    if (shouldAppendDef) {
      const tail =
        to === doc.length
          ? '\n\n'
          : doc.endsWith('\n\n')
            ? ''
            : doc.endsWith('\n')
              ? '\n'
              : '\n\n'
      changes.push({ from: doc.length, to: doc.length, insert: tail + definitionLine })
    }

    view.dispatch({
      changes,
      selection: { anchor: from + marker.length },
      userEvent: 'input'
    })
    view.focus()
  }

  // 在光标处插入 markdown 图片语法，并同步调整光标位置
  const insertMarkdownAtCursor = (text: string): void => {
    const view = viewRef.current
    if (!view) {
      onChange(valueRef.current + text)
      return
    }
    const { from } = view.state.selection.main
    commitEdit(from, from, text, from + text.length, from + text.length)
  }

  useImperativeHandle(
    ref,
    () => ({
      setSelection: (start: number, end: number) => {
        const view = viewRef.current
        if (!view) return
        const docLen = view.state.doc.length
        const anchor = Math.min(Math.max(0, start), docLen)
        const head = Math.min(Math.max(0, end), docLen)
        view.dispatch({
          selection: { anchor, head },
          effects: EditorView.scrollIntoView(head, { y: 'center' })
        })
        view.focus()
      },
      applyAction: (action) => {
        switch (action.kind) {
          case 'wrap':
            applyWrap(action.before, action.after ?? action.before, action.placeholder)
            break
          case 'linePrefix':
            applyLinePrefix(action.prefix)
            break
          case 'insert':
            applyInsert(action.text, action.ensureBlankLine)
            break
          case 'insertFootnote':
            applyInsertFootnote(action.id, action.content, action.mode)
            break
        }
      }
    }),
    []
  )

  // 粘贴图片：clipboard 中的图片 File → 存 assets → 插入 ![](path)
  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>): Promise<void> => {
    const files = Array.from(e.clipboardData?.files ?? [])
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length || !workspacePath || !activeFilePath) return
    e.preventDefault()

    for (const file of images) {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = reject
          r.readAsDataURL(file)
        })
        const res = await window.api.workbench.saveImage(workspacePath, activeFilePath, {
          dataUrl
        })
        if (res.success && res.data) {
          insertMarkdownAtCursor(`![${file.name}](${res.data.relativePath})`)
          void useWorkbenchStore.getState().loadFileTree()
        }
      } catch (err) {
        console.error('[SourceEditor] 粘贴图片失败:', err)
      }
    }
  }

  // 拖拽图片：本地文件 → 存 assets → 插入 ![](path)
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length || !workspacePath || !activeFilePath) return
    e.preventDefault()

    for (const file of images) {
      try {
        const absPath = (file as File & { path?: string }).path ?? ''
        let saved: { relativePath: string } | null = null
        if (absPath) {
          const res = await window.api.workbench.importImageFile(workspacePath, activeFilePath, absPath)
          if (res.success && res.data) saved = res.data
        } else {
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
          if (res.success && res.data) saved = res.data
        }
        if (saved) {
          insertMarkdownAtCursor(`![${file.name}](${saved.relativePath})`)
          void useWorkbenchStore.getState().loadFileTree()
        }
      } catch (err) {
        console.error('[SourceEditor] 拖拽图片失败:', err)
      }
    }
  }

  return (
    <div className="workbench-source-editor flex-1 flex overflow-hidden bg-white dark:bg-gray-900 font-mono text-body">
      <div
        ref={hostRef}
        className="flex-1 h-full overflow-hidden"
        onPaste={(e) => void handlePaste(e)}
        onDrop={(e) => void handleDrop(e)}
      />
    </div>
  )
})

export default WorkbenchSourceEditor
