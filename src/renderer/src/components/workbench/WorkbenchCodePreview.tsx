import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
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
import {
  HighlightStyle,
  StreamLanguage,
  type StringStream,
  syntaxHighlighting
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import {
  useWorkbenchStore,
  type HtmlEditLeaveDecision
} from '../../store/workbenchStore'
import { useGitLineDiff } from '../../hooks/useGitLineDiff'
import { readEditorScroll, rememberEditorScroll } from './workbenchEditorScroll'
import WorkbenchFindReplaceBar from './WorkbenchFindReplaceBar'
import WorkbenchHtmlVisualEditor, {
  type WorkbenchHtmlVisualEditorHandle
} from './WorkbenchHtmlVisualEditor'
import WorkbenchHtmlEditLeaveDialog from './WorkbenchHtmlEditLeaveDialog'
import WorkbenchHtmlAnnotationPreview from './WorkbenchHtmlAnnotationPreview'
import { formatFileSize } from '../../utils/formatBytes'
import { AppIcon } from '../icons/AppIcon'
import {
  PreviewFallbackState,
  PreviewHeader,
  PreviewZoomControls
} from './WorkbenchPreviewChrome'

const HTML_ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const HTML_ZOOM_MIN = HTML_ZOOM_LEVELS[0]
const HTML_ZOOM_MAX = HTML_ZOOM_LEVELS[HTML_ZOOM_LEVELS.length - 1]

function stepHtmlZoom(current: number, direction: -1 | 1): number {
  if (direction > 0) {
    return HTML_ZOOM_LEVELS.find((level) => level > current + 1e-4) ?? HTML_ZOOM_MAX
  }
  for (let i = HTML_ZOOM_LEVELS.length - 1; i >= 0; i -= 1) {
    if (HTML_ZOOM_LEVELS[i] < current - 1e-4) return HTML_ZOOM_LEVELS[i]
  }
  return HTML_ZOOM_MIN
}

const externalChange = Annotation.define<boolean>()
const CODE_SYNC_DEBOUNCE_MS = 250
const LONG_LINE_HIGHLIGHT_LIMIT = 2_000
const LARGE_FILE_HIGHLIGHT_BYTES = 1024 * 1024

const readOnlyCompartment = new Compartment()
const languageCompartment = new Compartment()
const gitGutterCompartment = new Compartment()

const PLAIN_TEXT_EXTENSIONS = new Set([
  'log',
  'txt',
  'csv',
  'tsv',
  'env',
  'ini',
  'conf',
  'lock'
])

const darkCodeHighlight = HighlightStyle.define([
  { tag: tags.comment, color: '#858585', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string)], color: '#34d399' },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword], color: '#c084fc', fontWeight: '600' },
  { tag: [tags.bool, tags.null, tags.atom], color: '#fb7185' },
  { tag: tags.number, color: '#fbbf24' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: '#7dd3fc' },
  { tag: [tags.propertyName, tags.attributeName, tags.function(tags.variableName)], color: '#93c5fd' },
  { tag: tags.heading, color: '#79c0ff', fontWeight: '600' },
  { tag: tags.strong, color: '#f4f4f5', fontWeight: '700' },
  { tag: tags.emphasis, color: '#e4e4e7', fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: '#79c0ff' },
  { tag: tags.monospace, color: '#ffa657' }
])

function buildCodeEditorTheme(isEditable: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: '13px',
        color: '#e4e4e7',
        backgroundColor: 'transparent'
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace",
        lineHeight: '1.65'
      },
      '.cm-content': {
        padding: '16px 16px 80px',
        caretColor: isEditable ? '#e4e4e7' : 'transparent'
      },
      '.cm-cursorLayer': {
        display: isEditable ? 'block' : 'none'
      },
      '.cm-line': { padding: '0' },
      '.cm-gutters': {
        backgroundColor: '#181818',
        color: '#858585',
        border: 'none',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)'
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 6px',
        minWidth: '3rem',
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
        backgroundColor: 'rgba(255, 255, 255, 0.04)'
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'rgba(59, 130, 246, 0.28)'
      },
      '.cm-content ::selection': {
        backgroundColor: 'rgba(59, 130, 246, 0.28)'
      }
    },
    { dark: true }
  )
}

class CodeGitGutterMarker extends GutterMarker {
  constructor(
    private readonly kind: 'added' | 'modified' | 'deleted',
    private readonly alsoDeleted = false
  ) {
    super()
  }
  override eq(other: GutterMarker): boolean {
    return (
      other instanceof CodeGitGutterMarker &&
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

const CODE_ADDED_MARKER = new CodeGitGutterMarker('added', false)
const CODE_ADDED_DELETED_MARKER = new CodeGitGutterMarker('added', true)
const CODE_MODIFIED_MARKER = new CodeGitGutterMarker('modified', false)
const CODE_MODIFIED_DELETED_MARKER = new CodeGitGutterMarker('modified', true)
const CODE_DELETED_MARKER = new CodeGitGutterMarker('deleted', false)

// 空占位 marker：保证无 git 变化的行也渲染 gutterElement，防止 git gutter 列塌缩
class EmptyCodeGitGutterMarker extends GutterMarker {
  override eq(other: GutterMarker): boolean {
    return other instanceof EmptyCodeGitGutterMarker
  }
}
const CODE_EMPTY_MARKER = new EmptyCodeGitGutterMarker()

function buildCodeGitGutter(
  lineMarks: Array<'added' | 'modified' | undefined>,
  deletedAfter: Map<number, number>
): Extension {
  return gutter({
    class: 'cm-gitGutter',
    lineMarker(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number - 1
      const del = deletedAfter.get(lineNo)
      const mark = lineMarks[lineNo]
      if (mark === 'added') return del ? CODE_ADDED_DELETED_MARKER : CODE_ADDED_MARKER
      if (mark === 'modified') return del ? CODE_MODIFIED_DELETED_MARKER : CODE_MODIFIED_MARKER
      if (del) return CODE_DELETED_MARKER
      // 返回空占位 marker 而不是 null：保证该行 gutterElement 一定被创建，列宽恒定
      return CODE_EMPTY_MARKER
    },
    lineMarkerChange(update) {
      return update.docChanged || update.transactions.some((tr) => tr.reconfigured)
    }
  })
}

interface StreamLangSpec {
  keywords: Set<string>
  atoms: Set<string>
  types: Set<string>
  slashComments?: boolean
  hashComments?: boolean
  dashComments?: boolean
  blockComments?: boolean
  markupTags?: boolean
  jsonKeys?: boolean
  yamlKeys?: boolean
  cssMode?: boolean
  backtickStrings?: boolean
}

const COMMON_JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'import', 'from', 'export', 'default',
  'class', 'interface', 'type', 'extends', 'implements', 'new', 'this', 'super',
  'typeof', 'instanceof', 'async', 'await', 'try', 'catch', 'finally', 'throw',
  'in', 'of', 'as', 'enum', 'public', 'private', 'protected', 'readonly', 'static'
])
const COMMON_ATOMS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'None', 'True', 'False', 'nil'])
const COMMON_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'void', 'never', 'unknown', 'object',
  'Array', 'Promise', 'Record', 'Map', 'Set', 'int', 'float', 'str', 'bool', 'usize', 'i32', 'u32'
])

const STREAM_SPECS: Record<string, StreamLangSpec> = {
  js: {
    keywords: COMMON_JS_KEYWORDS,
    atoms: COMMON_ATOMS,
    types: COMMON_TYPES,
    slashComments: true,
    blockComments: true,
    backtickStrings: true
  },
  json: {
    keywords: new Set(),
    atoms: new Set(['true', 'false', 'null']),
    types: new Set(),
    slashComments: true,
    blockComments: true,
    jsonKeys: true
  },
  markup: {
    keywords: new Set(['doctype']),
    atoms: COMMON_ATOMS,
    types: new Set(),
    markupTags: true
  },
  css: {
    keywords: new Set(['@import', '@media', '@keyframes', '@layer', '@supports', 'important']),
    atoms: new Set(['inherit', 'initial', 'unset', 'none', 'auto', 'solid', 'flex', 'grid', 'block', 'inline']),
    types: new Set(),
    blockComments: true,
    cssMode: true
  },
  py: {
    keywords: new Set([
      'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
      'import', 'from', 'as', 'pass', 'raise', 'try', 'except', 'finally', 'with',
      'yield', 'lambda', 'in', 'is', 'not', 'and', 'or', 'async', 'await', 'global', 'nonlocal'
    ]),
    atoms: new Set(['True', 'False', 'None', 'self', 'cls']),
    types: COMMON_TYPES,
    hashComments: true
  },
  shell: {
    keywords: new Set([
      'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
      'in', 'function', 'return', 'exit', 'export', 'local', 'readonly', 'echo', 'cd'
    ]),
    atoms: new Set(['true', 'false']),
    types: new Set(),
    hashComments: true,
    backtickStrings: true
  },
  yaml: {
    keywords: new Set(),
    atoms: new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']),
    types: new Set(),
    hashComments: true,
    yamlKeys: true
  },
  sql: {
    keywords: new Set([
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
      'CREATE', 'TABLE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'AS',
      'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'UNION', 'AND', 'OR', 'NOT', 'IN', 'IS',
      'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete',
      'create', 'table', 'alter', 'drop', 'join', 'left', 'right', 'inner', 'on', 'as',
      'group', 'by', 'order', 'having', 'limit', 'union', 'and', 'or', 'not', 'in', 'is'
    ]),
    atoms: new Set(['NULL', 'TRUE', 'FALSE', 'null', 'true', 'false']),
    types: new Set(['INT', 'INTEGER', 'TEXT', 'VARCHAR', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'int', 'text', 'varchar']),
    dashComments: true,
    blockComments: true
  },
  clike: {
    keywords: new Set([
      ...COMMON_JS_KEYWORDS,
      'struct', 'fn', 'impl', 'trait', 'pub', 'use', 'mod', 'mut', 'match', 'package',
      'func', 'defer', 'go', 'chan', 'select', 'namespace', 'using', 'virtual', 'override', 'void'
    ]),
    atoms: COMMON_ATOMS,
    types: COMMON_TYPES,
    slashComments: true,
    blockComments: true,
    hashComments: true
  }
}

const EXT_TO_LANG_KEY: Record<string, string> = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', mts: 'js', cts: 'js', tsx: 'js',
  json: 'json', jsonc: 'json', json5: 'json',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', svelte: 'markup',
  css: 'css', scss: 'css', less: 'css',
  py: 'py', pyw: 'py',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell', psm1: 'shell',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml',
  sql: 'sql',
  c: 'clike', h: 'clike', cpp: 'clike', cc: 'clike', hpp: 'clike', cs: 'clike',
  java: 'clike', go: 'clike', rs: 'clike', kt: 'clike', swift: 'clike', php: 'clike',
  md: 'markdown', markdown: 'markdown'
}

interface StreamParserState {
  inBlockComment: boolean
  inHtmlComment: boolean
  inTag: boolean
}

const languageCache = new Map<string, Extension>()

function getStreamLanguageExtension(langKey: string): Extension | null {
  const cached = languageCache.get(langKey)
  if (cached) return cached
  const spec = STREAM_SPECS[langKey]
  if (!spec) return null

  const ext = StreamLanguage.define<StreamParserState>({
    startState: () => ({ inBlockComment: false, inHtmlComment: false, inTag: false }),
    token(stream: StringStream, state: StreamParserState): string | null {
      if (state.inBlockComment) {
        if (stream.match(/.*?\*\//)) {
          state.inBlockComment = false
        } else {
          stream.skipToEnd()
        }
        return 'comment'
      }
      if (state.inHtmlComment) {
        if (stream.match(/.*?-->/)) {
          state.inHtmlComment = false
        } else {
          stream.skipToEnd()
        }
        return 'comment'
      }

      if (stream.eatSpace()) return null

      if (spec.markupTags && stream.match('<!--')) {
        if (!stream.match(/.*?-->/)) {
          state.inHtmlComment = true
        }
        return 'comment'
      }

      if (spec.blockComments && stream.match('/*')) {
        if (!stream.match(/.*?\*\//)) {
          state.inBlockComment = true
        }
        return 'comment'
      }
      if (spec.slashComments && stream.match('//')) {
        stream.skipToEnd()
        return 'comment'
      }
      if (spec.hashComments && stream.match('#')) {
        stream.skipToEnd()
        return 'comment'
      }
      if (spec.dashComments && stream.match('--')) {
        stream.skipToEnd()
        return 'comment'
      }

      if (spec.markupTags) {
        if (stream.match(/<\/?[A-Za-z][\w:-]*/)) {
          state.inTag = true
          return 'tagName'
        }
        if (state.inTag) {
          if (stream.match(/\/?>/)) {
            state.inTag = false
            return 'tagName'
          }
          if (stream.match(/[A-Za-z_][\w:-]*(?=\s*=)/)) {
            return 'attributeName'
          }
        }
      }

      const ch = stream.peek()
      if (ch === '"' || ch === "'" || (spec.backtickStrings && ch === '`')) {
        const quote = stream.next()!
        let escaped = false
        while (!stream.eol()) {
          const next = stream.next()
          if (escaped) {
            escaped = false
          } else if (next === '\\') {
            escaped = true
          } else if (next === quote) {
            break
          }
        }
        if (spec.jsonKeys && quote === '"' && stream.match(/^\s*:/, false)) {
          return 'propertyName'
        }
        return 'string'
      }

      if (spec.yamlKeys && stream.sol() && stream.match(/^-?\s*[A-Za-z0-9_.-]+(?=\s*:)/)) {
        return 'propertyName'
      }

      if (spec.cssMode && stream.match(/#[0-9a-fA-F]{3,8}\b/)) {
        return 'number'
      }

      if (stream.match(/0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/)) {
        return 'number'
      }

      if (stream.match(/[A-Za-z_$][\w$-]*/)) {
        const word = stream.current()
        if (spec.cssMode && stream.match(/^\s*:/, false)) return 'propertyName'
        if (spec.keywords.has(word)) return 'keyword'
        if (spec.atoms.has(word)) return 'atom'
        if (spec.types.has(word)) return 'typeName'
        if (stream.match(/^\s*\(/, false)) return 'variableName.function'
        return null
      }

      stream.next()
      return null
    }
  })

  languageCache.set(langKey, ext)
  return ext
}

function getFileExtension(filePath: string | null): string {
  if (!filePath) return ''
  const base = filePath.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function hasVeryLongLine(text: string, limit: number): boolean {
  let lineStart = 0
  for (;;) {
    const nl = text.indexOf('\n', lineStart)
    if (nl === -1) {
      return text.length - lineStart > limit
    }
    if (nl - lineStart > limit) return true
    lineStart = nl + 1
  }
}

export default function WorkbenchCodePreview({
  isActive = true
}: {
  isActive?: boolean
} = {}): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileUrl = useWorkbenchStore((s) => s.activeFileUrl)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)
  const discardActiveFileChanges = useWorkbenchStore((s) => s.discardActiveFileChanges)
  const setHtmlEditLeaveGuard = useWorkbenchStore((s) => s.setHtmlEditLeaveGuard)
  const setSourceSyncFlusher = useWorkbenchStore((s) => s.setSourceSyncFlusher)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const isHtmlFile = useMemo(() => {
    const lower = (activeFilePath || '').toLowerCase()
    return lower.endsWith('.html') || lower.endsWith('.htm')
  }, [activeFilePath])
  const [isEditing, setIsEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findReplaceFocus, setFindReplaceFocus] = useState(false)
  // HTML 文件支持渲染 / 可视化编辑 / 源码三态；源码态即文本编辑（初值与文件类型对齐，避免源码态闪烁）
  const [viewMode, setViewMode] = useState<'render' | 'edit' | 'source'>(() =>
    isHtmlFile ? 'render' : 'source'
  )
  const [visualDirty, setVisualDirty] = useState(false)
  const [visualHistory, setVisualHistory] = useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false
  })
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [editSession, setEditSession] = useState(0)
  // 渲染预览刷新：只重新挂载 iframe，不触发磁盘重读
  const [previewReloadKey, setPreviewReloadKey] = useState(0)
  const [previewZoom, setPreviewZoom] = useState(1)
  const visualEditorRef = useRef<WorkbenchHtmlVisualEditorHandle | null>(null)
  const visualBaselineRef = useRef<string | null>(null)
  const visualDirtyRef = useRef(false)
  const leaveRequestRef = useRef<{
    promise: Promise<HtmlEditLeaveDecision>
    resolve: (decision: HtmlEditLeaveDecision) => void
  } | null>(null)
  const hadConflictRef = useRef(false)

  // HTML 源码模式即为可编辑状态；其他代码文件沿用查看/编辑分离
  const isEditable = isHtmlFile ? viewMode === 'source' : isEditing

  // 同步表面状态到 store：浅色表面决定宿主 UI 配色，可编辑态决定状态徽标显隐。
  useEffect(() => {
    const store = useWorkbenchStore.getState()
    store.setCodePreviewEditable(isEditable)
    store.setHtmlRenderSurface(isHtmlFile && viewMode !== 'source')
  }, [isEditable, isHtmlFile, viewMode])

  useEffect(() => {
    return () => {
      const store = useWorkbenchStore.getState()
      store.setCodePreviewEditable(false)
      store.setHtmlRenderSurface(false)
    }
  }, [])
  const isVisualEditing = isHtmlFile && viewMode === 'edit'
  const showCodeEditor =
    !(isHtmlFile && viewMode === 'render') &&
    !(isVisualEditing && activeFileUrl) &&
    !activeFileOversized

  // Git 行内标记：仅源码/文本编辑态需要；渲染/可视化编辑态仅保留顶栏状态提示
  const gitDiff = useGitLineDiff(showCodeEditor ? activeFileContent : '')
  const gitStatus = useWorkbenchStore((s) => s.gitStatus)
  const fileGitChange = useMemo(() => {
    if (!activeFilePath || !gitStatus?.changes) return null
    return gitStatus.changes.find(c => c.path === activeFilePath) ?? null
  }, [activeFilePath, gitStatus])

  const cmHostRef = useRef<HTMLDivElement | null>(null)
  const cmViewRef = useRef<EditorView | null>(null)
  const contentRef = useRef(activeFileContent)
  const updateActiveContentRef = useRef(updateActiveContent)
  const isEditableRef = useRef(isEditable)
  const lastEmittedValueRef = useRef(activeFileContent)
  const pendingSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasPendingSyncRef = useRef(false)
  const flushSyncRef = useRef<() => void>(() => undefined)
  contentRef.current = activeFileContent
  updateActiveContentRef.current = updateActiveContent
  isEditableRef.current = isEditable

  // 切换文件重置编辑与菜单状态；HTML 默认进入渲染预览
  useEffect(() => {
    setIsEditing(false)
    setViewMode(isHtmlFile ? 'render' : 'source')
    setVisualDirty(false)
    visualDirtyRef.current = false
    setLeaveDialogOpen(false)
    setLeaveBusy(false)
    setEditSession(0)
    setPreviewReloadKey(0)
    setPreviewZoom(1)
    visualBaselineRef.current = null
    hadConflictRef.current = false
  }, [activeFilePath, isHtmlFile])

  useEffect(() => {
    if (isVisualEditing) setFindOpen(false)
  }, [isVisualEditing])

  // 冲突裁决走通用状态胶囊（take-disk / keep-mine）时，重建编辑 iframe 以对齐最终磁盘状态。
  useEffect(() => {
    if (saveStatus === 'conflict') {
      hadConflictRef.current = true
      return
    }
    if (
      hadConflictRef.current &&
      isVisualEditing &&
      saveStatus === 'saved' &&
      !isDirty
    ) {
      hadConflictRef.current = false
      setVisualDirty(false)
      visualDirtyRef.current = false
      visualBaselineRef.current = useWorkbenchStore.getState().activeFileContent
      setEditSession((value) => value + 1)
    }
  }, [saveStatus, isDirty, isVisualEditing])

  // Git 撤回当前文件修改后，重建渲染预览与可视化编辑 iframe，确保画布与磁盘对齐。
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ relativePath?: string }>).detail
      if (!detail?.relativePath || detail.relativePath !== activeFilePath) return
      setVisualDirty(false)
      visualDirtyRef.current = false
      visualBaselineRef.current = useWorkbenchStore.getState().activeFileContent
      setEditSession((value) => value + 1)
      setPreviewReloadKey((value) => value + 1)
    }
    window.addEventListener('workbench:git-file-reloaded', handler)
    return () => window.removeEventListener('workbench:git-file-reloaded', handler)
  }, [activeFilePath])

  const formattedSize = useMemo(() => formatFileSize(activeFileSize), [activeFileSize])

  // 注册源码同步 flusher：保存、切换模式、切文件或 Ctrl+F 前同步落入 store
  useEffect(() => {
    const flushCodeSync = (): void => {
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      if (!hasPendingSyncRef.current) return
      hasPendingSyncRef.current = false
      const view = cmViewRef.current
      if (!view) return
      const nextText = view.state.doc.toString()
      if (nextText === lastEmittedValueRef.current && nextText === contentRef.current) {
        return
      }
      lastEmittedValueRef.current = nextText
      updateActiveContentRef.current(nextText)
    }
    flushSyncRef.current = flushCodeSync
    if (!showCodeEditor) {
      setSourceSyncFlusher(null)
      return
    }
    setSourceSyncFlusher(flushCodeSync)
    return () => {
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      setSourceSyncFlusher(null)
    }
  }, [setSourceSyncFlusher, showCodeEditor])

  // 决定当前文件是否需要语法高亮（.log/.txt/.csv 或超大/超长单行降级纯文本）
  const langKey = useMemo(() => {
    if (!showCodeEditor) return ''
    const ext = getFileExtension(activeFilePath)
    if (!ext || PLAIN_TEXT_EXTENSIONS.has(ext)) return ''
    const mapped = EXT_TO_LANG_KEY[ext]
    if (!mapped) return ''
    const text = contentRef.current
    if (text.length > LARGE_FILE_HIGHLIGHT_BYTES || hasVeryLongLine(text, LONG_LINE_HIGHLIGHT_LIMIT)) {
      return ''
    }
    return mapped
  }, [activeFilePath, showCodeEditor])

  // 挂载 CodeMirror 6 实例（仅在文件路径或视图进入代码态时重建）
  useEffect(() => {
    if (!showCodeEditor || !cmHostRef.current) return

    if (pendingSyncTimerRef.current) {
      clearTimeout(pendingSyncTimerRef.current)
      pendingSyncTimerRef.current = null
    }
    hasPendingSyncRef.current = false
    lastEmittedValueRef.current = contentRef.current

    const initialLangExt =
      langKey && langKey !== 'markdown'
        ? getStreamLanguageExtension(langKey) ?? []
        : []

    const initialGutter = buildCodeGitGutter(
      gitDiff.active ? gitDiff.lineMarks : [],
      gitDiff.active ? gitDiff.deletedAfter : new Map()
    )

    const view = new EditorView({
      parent: cmHostRef.current,
      state: EditorState.create({
        doc: contentRef.current,
        extensions: [
          // formatNumber 固定补齐 5 位宽（不换行空格），行号 gutter 宽度恒定，
          // 避免滚动/编辑时因 spacer 重测导致的宽度抖动；超过 99999 行才会扩一次
          lineNumbers({
            formatNumber: (n) => String(n).padStart(5, ' ')
          }),
          gitGutterCompartment.of(initialGutter),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          languageCompartment.of(initialLangExt),
          syntaxHighlighting(darkCodeHighlight),
          readOnlyCompartment.of([
            EditorState.readOnly.of(!isEditableRef.current),
            buildCodeEditorTheme(isEditableRef.current)
          ]),
          keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap]),
          EditorState.tabSize.of(4),
          placeholder('输入或粘贴代码...'),
          EditorView.contentAttributes.of({
            'aria-label': '代码编辑器',
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off'
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            if (update.transactions.some((tr) => tr.annotation(externalChange))) return
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
            }, CODE_SYNC_DEBOUNCE_MS)
          }),
          EditorView.domEventHandlers({
            scroll: (_event, cmView) => {
              if (activeFilePath) {
                rememberEditorScroll(workspacePath, activeFilePath, 'source', cmView.scrollDOM.scrollTop)
              }
            }
          })
        ]
      })
    })
    cmViewRef.current = view

    let disposed = false
    if (langKey === 'markdown') {
      void import('@codemirror/lang-markdown').then(({ markdown, markdownLanguage }) => {
        if (disposed || cmViewRef.current !== view) return
        view.dispatch({
          effects: languageCompartment.reconfigure(
            markdown({ base: markdownLanguage, completeHTMLTags: false, pasteURLAsLink: false })
          )
        })
      })
    }

    return () => {
      disposed = true
      if (pendingSyncTimerRef.current) {
        clearTimeout(pendingSyncTimerRef.current)
        pendingSyncTimerRef.current = null
      }
      hasPendingSyncRef.current = false
      cmViewRef.current = null
      view.destroy()
    }
  }, [activeFilePath, showCodeEditor, langKey, workspacePath])

  // 切换查看 / 编辑态时原位更新 readOnly 与光标显示，保留撤销历史与滚动位置
  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    if (!isEditable) {
      flushSyncRef.current()
    }
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(!isEditable),
        buildCodeEditorTheme(isEditable)
      ])
    })
  }, [isEditable])

  // Git Diff 变化时通过 Compartment 原位刷新 Gutter
  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    const ext = buildCodeGitGutter(
      gitDiff.active ? gitDiff.lineMarks : [],
      gitDiff.active ? gitDiff.deletedAfter : new Map()
    )
    view.dispatch({
      effects: gitGutterCompartment.reconfigure(ext)
    })
  }, [gitDiff])

  // 外部内容变化（重读磁盘、查找替换、Git 撤回等）同步进 CM6，跳过自身防抖回写
  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    if (!hasPendingSyncRef.current && activeFileContent === lastEmittedValueRef.current) {
      return
    }
    if (view.state.doc.toString() === activeFileContent) {
      lastEmittedValueRef.current = activeFileContent
      return
    }
    if (pendingSyncTimerRef.current) {
      clearTimeout(pendingSyncTimerRef.current)
      pendingSyncTimerRef.current = null
    }
    hasPendingSyncRef.current = false
    lastEmittedValueRef.current = activeFileContent
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: activeFileContent },
      annotations: [externalChange.of(true), isolateHistory.of('full')]
    })
  }, [activeFileContent])

  // 进入或切回代码视图时恢复滚动位置
  useLayoutEffect(() => {
    const view = cmViewRef.current
    if (!view || !activeFilePath || !showCodeEditor) return
    const saved = readEditorScroll(workspacePath, activeFilePath, 'source')
    view.scrollDOM.scrollTop = saved
    const rafId = requestAnimationFrame(() => {
      if (cmViewRef.current === view) {
        view.scrollDOM.scrollTop = saved
      }
    })
    return () => cancelAnimationFrame(rafId)
  }, [activeFilePath, workspacePath, showCodeEditor])

  const revealRangeInCodeMirror = useCallback((start: number, end: number): boolean => {
    const view = cmViewRef.current
    if (!view) return false
    const docLen = view.state.doc.length
    const anchor = Math.min(Math.max(0, start), docLen)
    const head = Math.min(Math.max(0, end), docLen)
    view.dispatch({
      selection: { anchor, head },
      effects: EditorView.scrollIntoView(head, { y: 'center' })
    })
    view.focus()
    return true
  }, [])

  const finishLeaveRequest = useCallback((decision: HtmlEditLeaveDecision) => {
    const request = leaveRequestRef.current
    leaveRequestRef.current = null
    setLeaveDialogOpen(false)
    request?.resolve(decision)
  }, [])

  const requestLeaveVisualEdit = useCallback((): Promise<HtmlEditLeaveDecision> => {
    if (!visualDirtyRef.current && !visualEditorRef.current?.hasChanges()) {
      return Promise.resolve('saved')
    }
    if (leaveRequestRef.current) return leaveRequestRef.current.promise

    let resolve!: (decision: HtmlEditLeaveDecision) => void
    const promise = new Promise<HtmlEditLeaveDecision>((next) => {
      resolve = next
    })
    leaveRequestRef.current = { promise, resolve }
    setLeaveDialogOpen(true)
    return promise
  }, [])

  const handleVisualSave = useCallback(async (): Promise<boolean> => {
    if (saveStatus === 'saving') return false
    const result = await saveActiveFile()
    if (!result.saved) return false
    visualEditorRef.current?.markSaved()
    setVisualDirty(false)
    visualDirtyRef.current = false
    visualBaselineRef.current = useWorkbenchStore.getState().activeFileContent
    return true
  }, [saveActiveFile, saveStatus])

  const handleModeClick = useCallback(
    async (nextMode: 'render' | 'edit' | 'source') => {
      if (nextMode === viewMode || saveStatus === 'saving' || leaveDialogOpen) return

      useWorkbenchStore.getState().flushActiveEditorSync()

      // 进入可视化编辑前先落盘源码改动，避免编辑的是旧磁盘版本。
      if (nextMode === 'edit') {
        if (!isHtmlFile || !activeFileUrl || activeFileOversized) return
        if (useWorkbenchStore.getState().isDirty) {
          const saved = await saveActiveFile()
          if (!saved.saved) return
        }
        visualBaselineRef.current = useWorkbenchStore.getState().activeFileContent
        setVisualDirty(false)
        visualDirtyRef.current = false
        setViewMode('edit')
        return
      }

      // 退出可视化编辑时保留未保存结果，由用户决定写回还是放弃。
      if (isVisualEditing) {
        const decision = await requestLeaveVisualEdit()
        if (decision === 'cancelled') return
      }
      setViewMode(nextMode)
    },
    [
      viewMode,
      saveStatus,
      isHtmlFile,
      activeFileUrl,
      activeFileOversized,
      isDirty,
      saveActiveFile,
      isVisualEditing,
      leaveDialogOpen,
      requestLeaveVisualEdit
    ]
  )

  const handleConfirmSaveAndLeave = useCallback(async () => {
    if (leaveBusy) return
    setLeaveBusy(true)
    const saved = await handleVisualSave()
    setLeaveBusy(false)
    // 保存失败/冲突时关闭确认框并留在编辑态，让用户看到状态栏里的处理入口。
    finishLeaveRequest(saved ? 'saved' : 'cancelled')
  }, [finishLeaveRequest, handleVisualSave, leaveBusy])

  const handleDiscardAndLeave = useCallback(() => {
    discardActiveFileChanges(visualBaselineRef.current ?? undefined)
    setVisualDirty(false)
    visualDirtyRef.current = false
    // 目标文件/工作区切换若失败，仍留在编辑态时必须重建 iframe，避免画布继续显示已放弃的改动。
    setEditSession((value) => value + 1)
    finishLeaveRequest('discarded')
  }, [discardActiveFileChanges, finishLeaveRequest])

  const handleCancelLeave = useCallback(() => {
    if (leaveBusy) return
    finishLeaveRequest('cancelled')
  }, [finishLeaveRequest, leaveBusy])

  const handleVisualDirtyChange = useCallback((dirty: boolean) => {
    visualDirtyRef.current = dirty
    setVisualDirty(dirty)
  }, [])

  // 文件树、搜索、链接与工作区切换都在 store 内统一走这个确认入口。
  useEffect(() => {
    if (!isVisualEditing) return
    setHtmlEditLeaveGuard(requestLeaveVisualEdit)
    return () => setHtmlEditLeaveGuard(null)
  }, [isVisualEditing, requestLeaveVisualEdit, setHtmlEditLeaveGuard])

  useEffect(() => {
    return () => {
      const request = leaveRequestRef.current
      leaveRequestRef.current = null
      request?.resolve('cancelled')
    }
  }, [])

  const handlePreviewZoomStep = useCallback((direction: -1 | 1) => {
    setPreviewZoom((current) => stepHtmlZoom(current, direction))
  }, [])

  const handlePreviewZoomReset = useCallback(() => {
    setPreviewZoom(1)
  }, [])

  // Ctrl+S 保存；Ctrl+F/H 在可视化编辑态不打开代码查找条；HTML 渲染态支持 Ctrl+加减/0 缩放
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive || leaveDialogOpen) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        if (isVisualEditing) {
          if (visualDirty || visualEditorRef.current?.hasChanges()) void handleVisualSave()
        } else {
          useWorkbenchStore.getState().flushActiveEditorSync()
          void saveActiveFile()
        }
      } else if ((k === 'f' || k === 'h') && !isVisualEditing) {
        e.preventDefault()
        useWorkbenchStore.getState().flushActiveEditorSync()
        setFindReplaceFocus(k === 'h')
        setFindOpen(true)
      } else if (isHtmlFile && viewMode === 'render') {
        const target = e.target as HTMLElement | null
        const inEditable =
          !!target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        if (inEditable) return
        if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
          e.preventDefault()
          handlePreviewZoomStep(1)
        } else if (e.key === '-' || e.key === '–' || e.code === 'NumpadSubtract') {
          e.preventDefault()
          handlePreviewZoomStep(-1)
        } else if (e.key === '0' || e.code === 'Numpad0') {
          e.preventDefault()
          handlePreviewZoomReset()
        }
      }
    },
    [
      handlePreviewZoomReset,
      handlePreviewZoomStep,
      handleVisualSave,
      isActive,
      isHtmlFile,
      isVisualEditing,
      leaveDialogOpen,
      saveActiveFile,
      viewMode,
      visualDirty
    ]
  )

  // 切换文件时关闭查找条
  useEffect(() => {
    setFindOpen(false)
  }, [activeFilePath])

  useEffect(() => {
    if (!isActive) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown, isActive])

  // 复制全文
  const handleCopy = async () => {
    try {
      let text = activeFileContent
      if (isVisualEditing) {
        text = (await visualEditorRef.current?.serializeCurrent()) ?? activeFileContent
      } else if (showCodeEditor && cmViewRef.current) {
        text = cmViewRef.current.state.doc.toString()
      }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-[#1E1E1E] text-[#E4E4E7] select-text">
      {/* 顶部工具栏 */}
      <PreviewHeader
        theme="dark"
        compact
        left={
          <>
            <AppIcon name="code" size={19} className="text-amber-400" />
            <span className="font-mono text-body text-[#E4E4E7] truncate" title={activeFilePath || ''}>
              {activeFilePath}
            </span>
            {/* HTML 渲染/可视化编辑态保留顶栏状态提示，不做行级 DOM 映射 */}
            {isHtmlFile && viewMode !== 'source' && fileGitChange && !fileGitChange.untracked && (
              <span
                className="ml-1 px-1.5 py-0.5 rounded-full text-tiny font-semibold bg-white/10 text-sky-300 border border-white/15 select-none shrink-0"
                title="切换至源码模式查看具体修改行"
              >
                {fileGitChange.staged === 'added' ? 'A' : fileGitChange.conflicted ? '!' : 'M'}
              </span>
            )}
          </>
        }
        right={
          <>
            {/* 缩放控件位于模式分组之前，使模式分组与右侧文件操作保持固定位置 */}
            {isHtmlFile && viewMode === 'render' && (
              <>
                <PreviewZoomControls
                  theme="dark"
                  zoom={previewZoom}
                  minZoom={HTML_ZOOM_MIN}
                  maxZoom={HTML_ZOOM_MAX}
                  onZoomOut={() => handlePreviewZoomStep(-1)}
                  onZoomIn={() => handlePreviewZoomStep(1)}
                  onReset={handlePreviewZoomReset}
                  zoomOutTitle="缩小 (Ctrl+滚轮 / Ctrl+-)"
                  zoomInTitle="放大 (Ctrl+滚轮 / Ctrl+=)"
                  resetTitle="恢复到 100% (Ctrl+0)"
                />
                {/* HTML 渲染预览：重新加载 iframe，获取外部修改后的磁盘版本 */}
                <button
                  type="button"
                  onClick={() => setPreviewReloadKey((k) => k + 1)}
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#D4D4D4] hover:text-white transition-colors"
                  title="刷新渲染预览"
                >
                  <AppIcon name="refresh" size={19} />
                </button>
                <div className="h-4 w-px bg-white/10" />
              </>
            )}
            {isVisualEditing && (
              <>
                {/* 撤销/重做：与 Markdown 编辑一致放在编辑操作组前导位置，
                    实际执行在 iframe 编辑运行时内，状态经 postMessage 同步。 */}
                <button
                  type="button"
                  disabled={!visualHistory.canUndo || saveStatus === 'saving'}
                  onClick={() => visualEditorRef.current?.requestHistory('undo')}
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#D4D4D4] hover:text-white transition-colors disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
                  title="撤销 (Ctrl+Z)"
                  aria-label="撤销"
                >
                  <AppIcon name="undo" size={19} />
                </button>
                <button
                  type="button"
                  disabled={!visualHistory.canRedo || saveStatus === 'saving'}
                  onClick={() => visualEditorRef.current?.requestHistory('redo')}
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#D4D4D4] hover:text-white transition-colors disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
                  title="重做 (Ctrl+Y)"
                  aria-label="重做"
                >
                  <AppIcon name="redo" size={19} />
                </button>
                <div className="h-4 w-px bg-white/10" />
              </>
            )}
            {isVisualEditing && (
              <button
                type="button"
                disabled={!visualDirty || saveStatus === 'saving'}
                onClick={() => void handleVisualSave()}
                className="h-7 px-2.5 flex items-center gap-1 rounded-md bg-primary text-white text-label font-medium transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-40"
                title="保存到原文件 (Ctrl+S)"
              >
                <AppIcon
                  name={saveStatus === 'saving' ? 'progress_activity' : 'save'}
                  size={16}
                  className={saveStatus === 'saving' ? 'animate-spin' : ''}
                />
                <span>保存</span>
              </button>
            )}

            {/* 模式切换：HTML 为 渲染/编辑/源码；其他代码为 查看/编辑 */}
            <div className="flex items-center p-0.5 bg-[#181818] rounded-lg border border-white/10">
              {isHtmlFile ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleModeClick('render')}
                    className={`px-2 py-0.5 rounded text-body transition-colors ${
                      viewMode === 'render'
                        ? 'bg-[#323236] text-white font-medium'
                        : 'text-[#A1A1AA] hover:text-[#E4E4E7]'
                    }`}
                    title="浏览器渲染预览（磁盘已保存版本）"
                  >
                    渲染
                  </button>
                  <button
                    type="button"
                    disabled={!activeFileUrl || activeFileOversized || saveStatus === 'saving'}
                    onClick={() => void handleModeClick('edit')}
                    className={`px-2 py-0.5 rounded text-body transition-colors disabled:cursor-default disabled:opacity-40 ${
                      viewMode === 'edit'
                        ? 'bg-primary text-white font-medium'
                        : 'text-[#A1A1AA] hover:text-[#E4E4E7]'
                    }`}
                    title={
                      activeFileOversized
                        ? '文件过大，无法启用可视化编辑'
                        : '直接在渲染结果上修改文字与结构'
                    }
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleModeClick('source')}
                    className={`px-2 py-0.5 rounded text-body transition-colors ${
                      viewMode === 'source'
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-[#A1A1AA] hover:text-[#E4E4E7]'
                    }`}
                    title="源码编辑模式（Ctrl+S 保存）"
                  >
                    源码
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className={`px-2 py-0.5 rounded text-body transition-colors ${
                      !isEditing
                        ? 'bg-[#323236] text-white font-medium'
                        : 'text-[#A1A1AA] hover:text-[#E4E4E7]'
                    }`}
                    title="只读代码高亮视图"
                  >
                    查看
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className={`px-2 py-0.5 rounded text-body transition-colors ${
                      isEditing
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-[#A1A1AA] hover:text-[#E4E4E7]'
                    }`}
                    title="代码编辑模式 (可保存)"
                  >
                    编辑
                  </button>
                </>
              )}
            </div>

            {/* 复制按钮 */}
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#D4D4D4] hover:text-white transition-colors"
              title="复制代码全文"
            >
              <AppIcon name={copied ? 'check' : 'content_copy'} size={19} />
            </button>

            {/* 系统默认编辑器打开 */}
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#D4D4D4] hover:text-white transition-colors"
              title="在系统默认编辑器中打开 (如 VSCode)"
            >
              <AppIcon name="open_in_new" size={19} />
            </button>

            {/* 在资源管理器定位 */}
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void revealFile(activeFilePath)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#D4D4D4] hover:text-white transition-colors"
              title="在资源管理器中显示"
            >
              <AppIcon name="folder_open" size={19} />
            </button>
          </>
        }
      />

      {/* 代码内容区域 */}
      <div className="flex-1 flex overflow-hidden relative">
        {isHtmlFile && viewMode === 'render' ? (
          /* HTML 浏览器渲染预览：走 workbench-file:// 白名单协议，
             sandbox 允许脚本执行但禁止弹窗/顶层导航/同源特权访问；
             标注高亮与评论卡在宿主层叠加，不占用正文宽度。 */
          <div className="flex-1 h-full relative bg-white">
            {activeFileUrl ? (
              <WorkbenchHtmlAnnotationPreview
                key={`${activeFilePath}-${activeFileUrl}-${previewReloadKey}`}
                filePath={activeFilePath || ''}
                fileUrl={activeFileUrl}
                zoom={previewZoom}
                onZoomStep={handlePreviewZoomStep}
                onZoomReset={handlePreviewZoomReset}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-[#1E1E1E] text-[#A1A1AA]">
                <AppIcon name="error" size={24} className="mb-3" />
                <p className="text-body">未能生成预览地址</p>
              </div>
            )}
            {isDirty && (
              <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-lg bg-[#252526]/90 text-label text-amber-300 border border-amber-400/30 backdrop-blur-sm select-none">
                预览为磁盘已保存版本，有未保存修改
              </div>
            )}
          </div>
        ) : isVisualEditing && activeFileUrl ? (
          <WorkbenchHtmlVisualEditor
            key={`${activeFilePath || 'html-visual-editor'}-${activeFileUrl}-${editSession}`}
            ref={visualEditorRef}
            filePath={activeFilePath || ''}
            fileUrl={activeFileUrl}
            onDirtyChange={handleVisualDirtyChange}
            onHistoryStateChange={setVisualHistory}
            onRequestSave={() => {
              if (visualEditorRef.current?.hasChanges()) void handleVisualSave()
            }}
          />
        ) : activeFileOversized ? (
          <PreviewFallbackState
            theme="dark"
            icon={
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-4">
                <AppIcon name="code" size={24} />
              </div>
            }
            title="代码文件超出直接加载上限"
            description={
              <>
                当前文件大小为 <span className="font-semibold text-slate-200">{formattedSize}</span>，超出工作台 5MB 文本直接加载与渲染保护上限。建议在本地系统默认关联的代码编辑器（如 VSCode）中全速打开查看。
              </>
            }
            actionLabel="在系统编辑器中打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : (
          <div
            ref={cmHostRef}
            className="flex-1 h-full overflow-hidden"
          />
        )}

        {/* 编辑器内查找替换（Ctrl+F / Ctrl+H）；只读/渲染预览下禁用替换 */}
        <WorkbenchFindReplaceBar
          open={findOpen && !activeFileOversized && !isVisualEditing}
          replaceFocus={findReplaceFocus}
          onClose={() => setFindOpen(false)}
          canReplace={isEditable && !(isHtmlFile && viewMode === 'render')}
          onRevealMatch={
            showCodeEditor
              ? (start, end) => revealRangeInCodeMirror(start, end)
              : undefined
          }
        />
      </div>

      {leaveDialogOpen && (
        <WorkbenchHtmlEditLeaveDialog
          busy={leaveBusy}
          onSave={() => void handleConfirmSaveAndLeave()}
          onDiscard={handleDiscardAndLeave}
          onCancel={handleCancelLeave}
        />
      )}
    </div>
  )
}
