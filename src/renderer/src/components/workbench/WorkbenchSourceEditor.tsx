import {
  useRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef
} from 'react'
import { Annotation, Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
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
import { isCitationInner } from './workbenchCitations'

/**
 * 源码模式编辑器：CodeMirror 6 内核。
 * - 原生 lineNumbers + 自定义 Git Gutter 与 lineWrapping 像素级对齐，
 *   彻底解决旧「透明 textarea + gutterRef」在软折行下的行号错位。
 * - 视口虚拟滚动，数万行文档 DOM 常驻仅几十行。
 * - 通过 ref 暴露 applyAction / setSelection，供工具栏与查找定位复用。
 */

const externalChange = Annotation.define<boolean>()

// Compartment 用于按需重配置 Git Gutter 与主题扩展，避免重建整个编辑器
const gitGutterCompartment = new Compartment()
const themeCompartment = new Compartment()

const lightMarkdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--color-primary, #1d4ed8)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: '#2563eb' },
  { tag: tags.monospace, color: '#953800' },
  { tag: tags.quote, color: '#57606a' },
  // HTML 注释（含行内 <!-- --> 与块级注释）：lezer-markdown 统一标记为 tags.comment
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: '#64748b' }
])

const darkMarkdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#79c0ff', fontWeight: '600' },
  { tag: tags.strong, color: '#f4f4f5', fontWeight: '700' },
  { tag: tags.emphasis, color: '#e4e4e7', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#a1a1aa', textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: '#79c0ff' },
  { tag: tags.monospace, color: '#ffa657' },
  { tag: tags.quote, color: '#a1a1aa' },
  { tag: tags.comment, color: '#858585', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: '#858585' }
])

// —— Pandoc 引文 [@key] 源码高亮 ——
// lezer-markdown 不识别引文语法，用轻量 ViewPlugin 全文扫描补色；
// 与渲染模式共用 workbenchCitations 的判定，跳过围栏代码块与行内代码。

const CITATION_SCAN_GLOBAL_RE = /\[[^\]\n]*@[^\]\n]*\]/g
const INLINE_CODE_SPAN_RE = /(`+)([^`\n]*?)\1/g
const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/

const citationDecoration = Decoration.mark({ class: 'cm-citation' })

function blankOut(text: string): string {
  return ' '.repeat(text.length)
}

/** 若该引文括号后是 `(` 或 `[`，实为链接/图片语法的一部分，跳过不高亮 */
function isCitationInsideLinkSyntax(maskedLine: string, matchEnd: number): boolean {
  const next = maskedLine[matchEnd]
  return next === '(' || next === '['
}

/** 扫描文档中的引文区间：逐行进行，围栏代码块整行剔除，行内代码片段按等长空格屏蔽 */
function collectCitationRanges(doc: Text): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  let fence: { char: string; length: number } | null = null

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo)
    const fenceMatch = line.text.match(FENCE_LINE_RE)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = { char: marker[0], length: marker.length }
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fence) continue

    const masked = line.text.replace(INLINE_CODE_SPAN_RE, (match) => blankOut(match))
    CITATION_SCAN_GLOBAL_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CITATION_SCAN_GLOBAL_RE.exec(masked)) !== null) {
      const inner = match[0].slice(1, -1)
      if (!isCitationInner(inner)) continue
      if (isCitationInsideLinkSyntax(masked, match.index + match[0].length)) continue
      ranges.push({ from: line.from + match.index, to: line.from + match.index + match[0].length })
    }
  }
  return ranges
}

function buildCitationDecorations(doc: Text): DecorationSet {
  const ranges = collectCitationRanges(doc)
  return Decoration.set(ranges.map((r) => citationDecoration.range(r.from, r.to)))
}

const citationHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildCitationDecorations(view.state.doc)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = buildCitationDecorations(update.state.doc)
      }
    }
  },
  { decorations: (value) => value.decorations }
)

function buildEditorTheme(isDark: boolean): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: '13px',
      color: isDark ? '#e4e4e7' : 'var(--wb-reader-text, #1f2937)',
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
      caretColor: isDark ? '#60a5fa' : 'var(--color-primary, #3b82f6)'
    },
    '.cm-line': { padding: '0' },
    '.cm-gutters': {
      backgroundColor: isDark ? '#181818' : 'rgba(0, 0, 0, 0.02)',
      color: isDark ? '#858585' : 'var(--color-text-secondary, #94a3b8)',
      border: 'none',
      borderRight: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.05)'
    },
    '.cm-lineNumbers': {
      fontVariantNumeric: 'tabular-nums'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 6px',
      // 2 位数字保底 + 左右 padding(16px)，避免小文件过宽；3 位以上由 CM6 原生 spacer 自动撑开
      minWidth: 'calc(2ch + 16px)',
      textAlign: 'right'
    },
    '.cm-gitGutter': {
      // 固定列宽 + 空占位 marker，保证无 marker 时该列不塌缩，.cm-gutters 整体宽度恒定
      width: '8px',
      flexShrink: '0'
    },
    '.cm-gitGutter .cm-gutterElement': {
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'flex-end',
      width: '8px',
      padding: '0'
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(59, 130, 246, 0.06)'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: isDark ? 'rgba(59, 130, 246, 0.28)' : 'rgba(59, 130, 246, 0.16)'
    },
    '.cm-content ::selection': {
      backgroundColor: isDark ? 'rgba(59, 130, 246, 0.28)' : 'rgba(59, 130, 246, 0.16)'
    },
    '.cm-citation': {
      // 与渲染模式引文同色：仅字体颜色区分，无背景装饰
      color: isDark ? 'rgb(94, 234, 212)' : 'rgb(13, 148, 136)'
    }
  })
}

function buildThemeExtensions(isDark: boolean): Extension[] {
  return [
    syntaxHighlighting(isDark ? darkMarkdownHighlight : lightMarkdownHighlight),
    buildEditorTheme(isDark)
  ]
}

class GitGutterMarker extends GutterMarker {
  constructor(
    private readonly kind: 'added' | 'modified' | 'deleted',
    private readonly alsoDeleted = false
  ) {
    super()
  }
  override eq(other: GutterMarker): boolean {
    return (
      other instanceof GitGutterMarker &&
      other.kind === this.kind &&
      other.alsoDeleted === this.alsoDeleted
    )
  }
  override toDOM(): Node {
    const el = document.createElement('span')
    el.className = `cm-git-gutter-marker git-${this.kind}`
    if (this.alsoDeleted) el.classList.add('git-also-deleted')
    return el
  }
}

const ADDED_MARKER = new GitGutterMarker('added', false)
const ADDED_DELETED_MARKER = new GitGutterMarker('added', true)
const MODIFIED_MARKER = new GitGutterMarker('modified', false)
const MODIFIED_DELETED_MARKER = new GitGutterMarker('modified', true)
const DELETED_MARKER = new GitGutterMarker('deleted', false)

// 空占位 marker：保证无 git 变化的行也渲染 gutterElement，防止 git gutter 列塌缩
class EmptyGitGutterMarker extends GutterMarker {
  override eq(other: GutterMarker): boolean {
    return other instanceof EmptyGitGutterMarker
  }
}
const EMPTY_MARKER = new EmptyGitGutterMarker()

const SOURCE_SYNC_DEBOUNCE_MS = 250

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
      if (mark === 'added') return del ? ADDED_DELETED_MARKER : ADDED_MARKER
      if (mark === 'modified') return del ? MODIFIED_DELETED_MARKER : MODIFIED_MARKER
      if (del) return DELETED_MARKER
      // 返回空占位 marker 而不是 null：保证该行 gutterElement 一定被创建，列宽恒定
      return EMPTY_MARKER
    },
    // 仅在文档内容变更或 Compartment.reconfigure 刷新 diff 时重算 gutter marker，避免光标移动重建 DOM
    lineMarkerChange(update) {
      return (
        update.docChanged ||
        update.transactions.some((tr) => tr.reconfigured)
      )
    }
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
  { value?: string; onChange?: (v: string) => void }
>(function WorkbenchSourceEditor({ value: propValue, onChange: propOnChange }, ref): JSX.Element {
  const storeValue = useWorkbenchStore((s) =>
    propValue === undefined ? s.activeFileContent : ''
  )
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const setSourceSyncFlusher = useWorkbenchStore((s) => s.setSourceSyncFlusher)
  const value = propValue ?? storeValue
  const onChange = propOnChange ?? updateActiveContent

  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const lastEmittedValueRef = useRef(value)
  const pendingSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasPendingSyncRef = useRef(false)
  const flushSyncRef = useRef<() => void>(() => undefined)
  valueRef.current = value
  onChangeRef.current = onChange

  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const markdownBackgroundTheme = useWorkbenchStore((s) => s.markdownBackgroundTheme)
  const isDark = markdownBackgroundTheme === 'dark'
  const gitDiff = useGitLineDiff(value)

  // 注册同步 flusher：保存、切换模式、切文件或 Ctrl+F 前同步落入 store
  useEffect(() => {
    const flushSync = (): void => {
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      if (!hasPendingSyncRef.current) return
      hasPendingSyncRef.current = false
      const view = viewRef.current
      if (!view) return
      const nextText = view.state.doc.toString()
      if (nextText === lastEmittedValueRef.current && nextText === valueRef.current) {
        return
      }
      lastEmittedValueRef.current = nextText
      onChangeRef.current(nextText)
    }
    flushSyncRef.current = flushSync
    setSourceSyncFlusher(flushSync)
    return () => {
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      setSourceSyncFlusher(null)
    }
  }, [setSourceSyncFlusher])

  // 保存滚动位置：用户滚动时实时记忆，组件卸载前由 store 兜底
  useEffect(() => {
    if (!hostRef.current) return

    if (pendingSyncTimerRef.current) {
      clearTimeout(pendingSyncTimerRef.current)
      pendingSyncTimerRef.current = null
    }
    hasPendingSyncRef.current = false
    lastEmittedValueRef.current = valueRef.current

    const gitGutter = buildGitGutterExtension(
      gitDiff.active ? gitDiff.lineMarks : [],
      gitDiff.active ? gitDiff.deletedAfter : new Map()
    )

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          // 依赖 CM6 原生 maxLineNumber spacer 按文档总行数自适应宽度，滚动时不重测、不抖动
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
          EditorView.lineWrapping,
          citationHighlightPlugin,
          themeCompartment.of(buildThemeExtensions(isDark)),
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
            if (!hasPendingSyncRef.current) {
              hasPendingSyncRef.current = true
              useWorkbenchStore.getState().markSourcePendingSync()
            }
            if (pendingSyncTimerRef.current) {
              clearTimeout(pendingSyncTimerRef.current)
            }
            pendingSyncTimerRef.current = setTimeout(() => {
              pendingSyncTimerRef.current = null
              flushSyncRef.current()
            }, SOURCE_SYNC_DEBOUNCE_MS)
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
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      hasPendingSyncRef.current = false
      viewRef.current = null
      view.destroy()
    }
    // 仅在文件切换时重建编辑器；gitGutter 随 diff 变化由下方 effect 更新
  }, [activeFilePath])

  // 主题变化时按 Compartment 原位切换语法高亮与行号/选区配色，保留编辑器实例与撤销历史
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartment.reconfigure(buildThemeExtensions(isDark))
    })
  }, [isDark])

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
  // 用 externalChange 注解避免被当成用户输入再次回写，并借助 lastEmittedValueRef 跳过自身回写触发的 doc.toString() 比对。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (!hasPendingSyncRef.current && value === lastEmittedValueRef.current) {
      return
    }
    if (view.state.doc.toString() === value) {
      lastEmittedValueRef.current = value
      return
    }
    if (pendingSyncTimerRef.current) {
      clearTimeout(pendingSyncTimerRef.current)
      pendingSyncTimerRef.current = null
    }
    hasPendingSyncRef.current = false
    lastEmittedValueRef.current = value
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
    <div
      className="workbench-source-editor wb-reader-canvas flex-1 flex overflow-hidden bg-white dark:bg-[#1E1E1E] font-mono text-body transition-colors duration-150"
      data-reader-canvas={markdownBackgroundTheme}
    >
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
