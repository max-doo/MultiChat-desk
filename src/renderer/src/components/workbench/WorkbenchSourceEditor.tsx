import { useMemo, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-markdown'
import { useWorkbenchStore } from '../../store/workbenchStore'

/**
 * 源码模式编辑器：透明 textarea 叠在 Prism 高亮渲染层之上，左侧行号槽。
 * - 行号随滚动同步（行号列与代码行同字号同 line-height）
 * - 高亮用 prismjs 的 markdown grammar（标题/加粗/斜体/代码/链接/列表/引用分色）
 * - textarea 负责输入与光标，背景层只负责渲染，两者字号字体必须一致
 *
 * 通过 ref 暴露 applyAction：供源码模式工具栏在光标/选区处执行
 * 行内包裹（**…**）、行前缀（#、-、>）、字面量插入（表格、分割线）三类操作。
 */

const FONT_STYLE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace",
  fontSize: 13,
  lineHeight: '1.7',
  tabSize: 2
}

export type SourceToolbarAction =
  | { kind: 'wrap'; before: string; after?: string; placeholder?: string }
  | { kind: 'linePrefix'; prefix: string }
  | { kind: 'insert'; text: string; ensureBlankLine?: boolean }

export interface WorkbenchSourceEditorHandle {
  applyAction: (action: SourceToolbarAction) => void
  /** 选中并滚动到 [start, end) 文本区间 */
  setSelection: (start: number, end: number) => void
}

const WorkbenchSourceEditor = forwardRef<
  WorkbenchSourceEditorHandle,
  { value: string; onChange: (v: string) => void }
>(function WorkbenchSourceEditor({ value, onChange }, ref): JSX.Element {
  const preRef = useRef<HTMLPreElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)

  const lineCount = useMemo(() => value.split('\n').length, [value])

  const highlighted = useMemo(() => {
    try {
      return Prism.highlight(value, Prism.languages.markdown, 'markdown')
    } catch {
      // 兜底：纯文本 HTML 转义
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }
  }, [value])

  // 滚动同步：textarea 滚动时同步背景层与行号列
  const handleScroll = () => {
    const ta = textareaRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop
    }
  }

  useEffect(() => {
    handleScroll()
  }, [value])

  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount]
  )

  // 在光标处插入 markdown 图片语法，并同步调整光标位置
  const insertMarkdownAtCursor = (text: string): void => {
    const ta = textareaRef.current
    if (!ta) {
      onChange(value + text)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + text.length, start + text.length)
    })
  }

  // 提交 textarea 编辑：替换 [start, end) 区间内容并恢复光标
  const commitEdit = (start: number, end: number, text: string, selStart: number, selEnd: number): void => {
    const ta = textareaRef.current
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(selStart, selEnd)
    })
  }

  // 行内包裹：给选中文本加/去 before..after 标记（如 **、*、`、==、<u>…</u>）
  const applyWrap = (before: string, after: string, placeholder?: string): void => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = value.slice(start, end)

    // 已包裹则视为取消：去掉外层标记
    if (
      start >= before.length &&
      value.slice(start - before.length, start) === before &&
      value.slice(end, end + after.length) === after
    ) {
      commitEdit(start - before.length, end + after.length, selected, start - before.length, end - before.length)
      return
    }

    const content = selected || placeholder || ''
    const wrapped = before + content + after
    if (selected) {
      commitEdit(start, end, wrapped, start + before.length, start + before.length + content.length)
    } else {
      commitEdit(start, end, wrapped, start + before.length, start + before.length + content.length)
    }
  }

  // 行前缀：对选区覆盖到的每一行加/去前缀（# 、- 、1. 、[ ]、> 、```）
  const applyLinePrefix = (prefix: string): void => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    let lineEnd = value.indexOf('\n', end)
    if (lineEnd === -1) lineEnd = value.length

    const block = value.slice(lineStart, lineEnd)
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
    const ta = textareaRef.current
    if (!ta) {
      onChange(value + text)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    let prefix = ''
    if (ensureBlankLine) {
      const before = value.slice(0, start)
      if (before.length > 0 && !before.endsWith('\n\n')) {
        prefix = before.endsWith('\n') ? '\n' : '\n\n'
      }
    }
    commitEdit(start, end, prefix + text, start + prefix.length + text.length, start + prefix.length + text.length)
  }

  // Tab/Shift+Tab 缩进：选区覆盖的每一行加/去两个空格；无选区时在光标处插入两个空格
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const INDENT = '  '

    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    // 选区末尾恰好落在换行符后（即下一行行首）时，不把下一行算作被覆盖行
    const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
    const lastLineEnd = (() => {
      const idx = value.indexOf('\n', effectiveEnd)
      return idx === -1 ? value.length : idx
    })()

    if (e.shiftKey) {
      // 反缩进：每行移除行首的两个空格或一个 Tab
      const block = value.slice(lineStart, lastLineEnd)
      const lines = block.split('\n')
      let totalRemoved = 0
      let firstLineRemoved = 0
      const nextLines = lines.map((l, i) => {
        const cut = l.startsWith(INDENT) ? INDENT.length : l.startsWith('\t') ? 1 : 0
        if (i === 0) firstLineRemoved = cut
        totalRemoved += cut
        return l.slice(cut)
      })
      if (totalRemoved === 0) return
      const nextBlock = nextLines.join('\n')
      const newStart = Math.max(lineStart, start - firstLineRemoved)
      const newEnd = Math.max(newStart, end - totalRemoved)
      commitEdit(lineStart, lastLineEnd, nextBlock, newStart, newEnd)
      return
    }

    if (start === end) {
      // 无选区：光标处直接插入缩进
      commitEdit(start, end, INDENT, start + INDENT.length, start + INDENT.length)
      return
    }

    // 有选区：每行行首加缩进（空行跳过），光标保持在原行行首
    const block = value.slice(lineStart, lastLineEnd)
    const lines = block.split('\n')
    const indented = lines.map((l) => (l.trim() === '' ? l : INDENT + l)).join('\n')
    const newStart = start === lineStart ? start : start + INDENT.length
    commitEdit(
      lineStart,
      lastLineEnd,
      indented,
      newStart,
      end + INDENT.length * lines.filter((l) => l.trim() !== '').length
    )
  }

  useImperativeHandle(
    ref,
    () => ({
      setSelection: (start: number, end: number) => {
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()
        ta.setSelectionRange(start, end)
        // 滚动到选区：用临时 mirror 计算 offset 太复杂，这里用粗略行高估算
        const lineHeight = 13 * 1.7
        const linesBefore = value.slice(0, start).split('\n').length - 1
        const gutterH = ta.clientHeight
        const target = linesBefore * lineHeight - gutterH / 2
        ta.scrollTop = Math.max(0, target)
        handleScroll()
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
        }
      }
    }),
    // applyAction 内部只用 ref 与最新 value/onChange（每次渲染重新闭包即可）
    [value, onChange]
  )

  // 粘贴图片：clipboard 中的图片 File → 存 assets → 插入 ![](path)
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
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
  const handleDrop = async (e: React.DragEvent<HTMLTextAreaElement>): Promise<void> => {
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
    <div className="workbench-source-editor flex-1 flex overflow-hidden bg-white dark:bg-gray-900 font-mono text-[13px]">
      {/* 行号槽 */}
      <div
        ref={gutterRef}
        className="shrink-0 overflow-hidden text-right select-none border-r border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] text-text-secondary/50"
        style={{ width: '3.5rem' }}
        aria-hidden="true"
      >
        <div style={{ ...FONT_STYLE, padding: '24px 10px 24px 0' }}>
          {lineNumbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      </div>

      {/* 编辑区：背景高亮层 + 前景透明 textarea */}
      <div className="relative flex-1 overflow-hidden">
        <pre
          ref={preRef}
          aria-hidden="true"
          className="absolute inset-0 overflow-auto whitespace-pre-wrap break-all text-text-primary"
          style={{
            ...FONT_STYLE,
            margin: 0,
            padding: '24px 16px',
            pointerEvents: 'none'
          }}
        >
          <code
            dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
            style={FONT_STYLE}
          />
        </pre>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onPaste={(e) => void handlePaste(e)}
          onDrop={(e) => void handleDrop(e)}
          placeholder="编写 Markdown 内容..."
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="absolute inset-0 w-full h-full resize-none bg-transparent text-transparent caret-primary focus:outline-none whitespace-pre-wrap break-all"
          style={{
            ...FONT_STYLE,
            padding: '24px 16px',
            caretColor: 'var(--color-primary, #3b82f6)'
          }}
        />
      </div>
    </div>
  )
})

export default WorkbenchSourceEditor
