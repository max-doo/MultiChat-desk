import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'

/**
 * 编辑器内查找替换浮动条（Ctrl+F / Ctrl+H）。
 * 查找/替换统一作用于 store 中的 activeFileContent（Markdown/文本全文），
 * 因此对富文本（Lexical）与源码（textarea）两种编辑态一致生效：
 * - Lexical 侧通过 MarkdownSyncPlugin 的外部内容同步重灌 AST；
 * - textarea 侧直接改字符串并恢复选区。
 * 关闭时自动清除高亮选区。
 */

export interface FindMatch {
  index: number
  length: number
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findMatches(
  content: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean
): FindMatch[] {
  if (!query) return []
  const flags = caseSensitive ? 'g' : 'gi'
  const pattern = wholeWord ? `\\b${escapeRegExp(query)}\\b` : escapeRegExp(query)
  const re = new RegExp(pattern, flags)
  const out: FindMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    out.push({ index: m.index, length: m[0].length })
    // 防御零宽匹配死循环
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

/** 在 content 中把第 matchIdx 个匹配替换为 replacement，返回新内容与替换后区间 */
function replaceMatch(
  content: string,
  match: FindMatch,
  replacement: string
): { next: string; selStart: number; selEnd: number } {
  const next = content.slice(0, match.index) + replacement + content.slice(match.index + match.length)
  return { next, selStart: match.index, selEnd: match.index + replacement.length }
}

interface Props {
  /** 是否展示（父组件控制快捷键开/关） */
  open: boolean
  /** 初始聚焦查找输入框（true）还是替换输入框（false） */
  replaceFocus: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 当前文本是否可直接编辑（只读视图下替换禁用） */
  canReplace: boolean
  /**
   * 让"下一个/上一个"在宿主编辑器中定位选区并滚动：
   * 传入一个函数，接收匹配区间 [start, end) 与内容版本。
   * 返回 true 表示宿主已处理滚动/选区；false 则组件内部兜底（仅高亮计数）。
   */
  onRevealMatch?: (start: number, end: number) => boolean
}

export default function WorkbenchFindReplaceBar({
  open,
  replaceFocus,
  onClose,
  canReplace,
  onRevealMatch
}: Props): JSX.Element | null {
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)

  const findInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const prevContentRef = useRef(activeFileContent)

  const matches = useMemo(
    () => findMatches(activeFileContent, query, caseSensitive, wholeWord),
    [activeFileContent, query, caseSensitive, wholeWord]
  )

  // 打开时聚焦并预选查找词；读取当前编辑器选区作为初始查找词
  useEffect(() => {
    if (!open) return
    const sel = window.getSelection()?.toString() ?? ''
    if (sel && sel.length <= 200 && !sel.includes('\n')) {
      setQuery(sel)
    }
    setCurrentIdx(-1)
    requestAnimationFrame(() => {
      const target = replaceFocus ? replaceInputRef.current : findInputRef.current
      target?.focus()
      target?.select()
    })
  }, [open])

  // 文件切换时重置定位
  useEffect(() => {
    setCurrentIdx(-1)
  }, [activeFilePath])

  // 内容变化（自动保存/外部同步）后校正当前索引：尽量定位到"下一个"匹配
  useEffect(() => {
    if (prevContentRef.current === activeFileContent) return
    const prev = prevContentRef.current
    prevContentRef.current = activeFileContent
    setCurrentIdx((idx) => {
      if (idx < 0 || matches.length === 0) return idx
      const clamped = Math.min(idx, matches.length - 1)
      // 若替换导致前一个匹配消失，定位到同一位置起的下一个匹配
      const anchor = Math.min(matches[clamped]?.index ?? 0, prev.length)
      const next = matches.findIndex((m) => m.index >= anchor)
      return next === -1 ? matches.length - 1 : next
    })
  }, [activeFileContent])

  const reveal = useCallback(
    (idx: number) => {
      const m = matches[idx]
      if (!m) return
      setCurrentIdx(idx)
      onRevealMatch?.(m.index, m.index + m.length)
    },
    [matches, onRevealMatch]
  )

  const goNext = useCallback(() => {
    if (matches.length === 0) return
    const next = currentIdx < 0 ? 0 : (currentIdx + 1) % matches.length
    reveal(next)
  }, [matches.length, currentIdx, reveal])

  const goPrev = useCallback(() => {
    if (matches.length === 0) return
    const prev = currentIdx < 0 ? matches.length - 1 : (currentIdx - 1 + matches.length) % matches.length
    reveal(prev)
  }, [matches.length, currentIdx, reveal])

  const doReplace = useCallback(() => {
    if (!canReplace || matches.length === 0) return
    const idx = currentIdx >= 0 ? currentIdx : 0
    const m = matches[idx]
    if (!m) return
    const { next } = replaceMatch(activeFileContent, m, replacement)
    updateActiveContent(next)
    // 替换后不主动 reveal：content-effect 会把 currentIdx 校正到下一匹配位置
  }, [activeFileContent, canReplace, currentIdx, matches, replacement, updateActiveContent])

  const doReplaceAll = useCallback(() => {
    if (!canReplace || matches.length === 0) return
    const re = new RegExp(
      wholeWord ? `\\b${escapeRegExp(query)}\\b` : escapeRegExp(query),
      caseSensitive ? 'g' : 'gi'
    )
    const next = activeFileContent.replace(re, replacement)
    updateActiveContent(next)
  }, [activeFileContent, canReplace, caseSensitive, matches.length, query, replacement, updateActiveContent, wholeWord])

  const handleFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goPrev()
      else goNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doReplace()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open) return null

  const total = matches.length
  const pos = total === 0 ? 0 : currentIdx >= 0 ? currentIdx + 1 : 1

  const btnBase =
    'h-6 px-1.5 flex items-center justify-center rounded text-[12px] transition-colors'
  const iconBtn =
    'w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10'
  const toggleBtn = (on: boolean) =>
    `${iconBtn} ${on ? 'bg-primary/15 text-primary dark:bg-primary/25' : ''}`

  return (
    <div className="absolute top-2 right-3 z-40 flex flex-col gap-1 rounded-lg border border-black/10 dark:border-white/10 bg-white/95 dark:bg-gray-800/95 shadow-lg backdrop-blur px-1.5 py-1.5 select-none">
      {/* 查找行 */}
      <div className="flex items-center gap-0.5">
        <input
          ref={findInputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCurrentIdx(-1)
          }}
          onKeyDown={handleFindKeyDown}
          placeholder="查找"
          spellCheck={false}
          className="w-44 h-6 px-1.5 rounded bg-black/5 dark:bg-white/5 text-[12px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <span className={`w-12 text-center text-[11px] tabular-nums ${total === 0 && query ? 'text-rose-500' : 'text-text-secondary'}`}>
          {total === 0 ? (query ? '无结果' : '') : `${pos}/${total}`}
        </span>
        <button type="button" onClick={goPrev} disabled={total === 0} className={iconBtn} title="上一个 (Shift+Enter)">
          <AppIcon name="keyboard_arrow_up" size={16} />
        </button>
        <button type="button" onClick={goNext} disabled={total === 0} className={iconBtn} title="下一个 (Enter)">
          <AppIcon name="keyboard_arrow_down" size={16} />
        </button>
        <button
          type="button"
          onClick={() => setCaseSensitive((v) => !v)}
          className={toggleBtn(caseSensitive)}
          title="区分大小写"
        >
          <AppIcon name="match_case" size={15} />
        </button>
        <button
          type="button"
          onClick={() => setWholeWord((v) => !v)}
          className={toggleBtn(wholeWord)}
          title="全字匹配"
        >
          <AppIcon name="match_word" size={15} />
        </button>
        <button type="button" onClick={onClose} className={iconBtn} title="关闭 (Esc)">
          <AppIcon name="close" size={15} />
        </button>
      </div>

      {/* 替换行 */}
      <div className="flex items-center gap-0.5">
        <input
          ref={replaceInputRef}
          type="text"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={handleReplaceKeyDown}
          placeholder="替换为"
          spellCheck={false}
          className="w-44 h-6 px-1.5 rounded bg-black/5 dark:bg-white/5 text-[12px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={doReplace}
          disabled={!canReplace || total === 0}
          className={`${btnBase} text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40`}
          title={canReplace ? '替换当前匹配' : '当前为只读预览，请先切换到编辑态'}
        >
          替换
        </button>
        <button
          type="button"
          onClick={doReplaceAll}
          disabled={!canReplace || total === 0}
          className={`${btnBase} text-text-secondary hover:text-text-primary hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40`}
          title={canReplace ? '替换全部匹配' : '当前为只读预览，请先切换到编辑态'}
        >
          全部
        </button>
      </div>
    </div>
  )
}
