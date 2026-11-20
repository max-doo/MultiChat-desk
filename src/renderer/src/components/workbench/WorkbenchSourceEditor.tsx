import { useMemo, useRef, useEffect } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-markdown'

/**
 * 源码模式编辑器：透明 textarea 叠在 Prism 高亮渲染层之上，左侧行号槽。
 * - 行号随滚动同步（行号列与代码行同字号同 line-height）
 * - 高亮用 prismjs 的 markdown grammar（标题/加粗/斜体/代码/链接/列表/引用分色）
 * - textarea 负责输入与光标，背景层只负责渲染，两者字号字体必须一致
 */

const FONT_STYLE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace",
  fontSize: 13,
  lineHeight: '1.7',
  tabSize: 2
}

export default function WorkbenchSourceEditor({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const preRef = useRef<HTMLPreElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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
          onScroll={handleScroll}
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
}
