import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '../icons/AppIcon'
import { isValidFootnoteId } from './workbenchFootnotes'

const POPOVER_WIDTH = 380
const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 6
const ESTIMATED_HEIGHT = 220

export type FootnoteInsertMode = 'create' | 'reuse-ref' | 'fill-missing-def'

interface WorkbenchFootnotePopoverProps {
  anchorRect: DOMRect
  /** 基于已有编号自动递增后的下一可用编号 */
  defaultId: string
  /** 当前文档中已有定义的脚注（id -> 定义正文） */
  existingDefinitions: Map<string, string>
  /** 当前文档中所有已占用编号（含引用与定义） */
  usedIds: Set<string>
  onApply: (payload: { id: string; content: string; mode: FootnoteInsertMode }) => void
  onClose: () => void
}

function sortFootnoteIds(ids: Iterable<string>): string[] {
  return Array.from(ids).sort((a, b) => {
    const na = /^\d+$/.test(a) ? Number.parseInt(a, 10) : Number.NaN
    const nb = /^\d+$/.test(b) ? Number.parseInt(b, 10) : Number.NaN
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    if (!Number.isNaN(na)) return -1
    if (!Number.isNaN(nb)) return 1
    return a.localeCompare(b)
  })
}

/**
 * "插入脚注"输入弹层：
 * - 默认填入基于文档全量引用与定义自动递增的不冲突编号；
 * - 支持 Markdown 1 对多复用：输入已有编号且内容留空时仅插入引用，绝不覆盖原定义；
 * - 输入已有编号同时填写新内容时拦截并引导改用新编号或清空仅引用；
 * - 新增脚注时内容允许留空，便于先占位后在文末定义块直接补写。
 */
export default function WorkbenchFootnotePopover({
  anchorRect,
  defaultId,
  existingDefinitions,
  usedIds,
  onApply,
  onClose
}: WorkbenchFootnotePopoverProps): JSX.Element {
  const [id, setId] = useState(defaultId)
  const [content, setContent] = useState('')
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const idInputRef = useRef<HTMLInputElement | null>(null)
  const contentRef = useRef<HTMLTextAreaElement | null>(null)

  const trimmedId = id.trim()
  const trimmedContent = content.trim()
  const isIdFormatValid = trimmedId.length > 0 && isValidFootnoteId(trimmedId)
  const hasExistingDef = isIdFormatValid && existingDefinitions.has(trimmedId)
  const existingDefText = hasExistingDef ? (existingDefinitions.get(trimmedId) ?? '') : ''
  const isDanglingRef = isIdFormatValid && !hasExistingDef && usedIds.has(trimmedId)

  // 编号已有定义且用户又输入了新内容 → 禁止覆盖
  const hasOverwriteConflict = hasExistingDef && trimmedContent.length > 0
  const hasInvalidChars = trimmedId.length > 0 && !isIdFormatValid
  const canApply = isIdFormatValid && !hasOverwriteConflict

  const mode: FootnoteInsertMode = hasExistingDef
    ? 'reuse-ref'
    : isDanglingRef
      ? 'fill-missing-def'
      : 'create'

  const existingIdList = useMemo(
    () => sortFootnoteIds(existingDefinitions.keys()),
    [existingDefinitions]
  )

  const position = useMemo(() => {
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
    const left = Math.min(
      Math.max(anchorRect.left, VIEWPORT_MARGIN),
      window.innerWidth - width - VIEWPORT_MARGIN
    )
    const below = anchorRect.bottom + ANCHOR_GAP
    const top =
      below + ESTIMATED_HEIGHT <= window.innerHeight - VIEWPORT_MARGIN
        ? below
        : Math.max(anchorRect.top - ESTIMATED_HEIGHT - ANCHOR_GAP, VIEWPORT_MARGIN)
    return { width, left, top }
  }, [anchorRect])

  useLayoutEffect(() => {
    contentRef.current?.focus()
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (popoverRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  const apply = (): void => {
    if (!canApply) return
    onApply({ id: trimmedId, content: trimmedContent, mode })
    onClose()
  }

  const submitLabel =
    mode === 'reuse-ref'
      ? '插入引用'
      : mode === 'fill-missing-def'
        ? '补全脚注'
        : '插入脚注'

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="插入脚注"
      /* z-[120] 压在编辑器工具栏与普通 popover 之上，确保不透明遮挡 */
      className="fixed z-[120] liquid-glass-menu rounded-xl p-3"
      style={{ width: position.width, left: position.left, top: position.top }}
    >
      <div className="flex items-center gap-2">
        <AppIcon name="footnote" size={15} className="shrink-0 text-text-secondary" />
        <input
          ref={idInputRef}
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            contentRef.current?.focus()
          }}
          placeholder="编号"
          aria-label="脚注编号"
          spellCheck={false}
          className={`h-8 w-24 shrink-0 rounded-lg border bg-white px-2 text-body text-text-primary outline-none transition-colors ${
            hasInvalidChars || hasOverwriteConflict
              ? 'border-red-500/70 focus:border-red-500'
              : 'border-black/10 focus:border-primary/50 dark:border-white/10'
          }`}
        />
        <span className="text-caption text-text-secondary">
          {hasExistingDef ? '复用已有编号' : '脚注编号（已自动递增）'}
        </span>
      </div>

      {existingIdList.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="shrink-0 text-caption text-text-secondary">复用已有:</span>
          {existingIdList.map((existingId) => {
            const active = trimmedId === existingId
            const preview = existingDefinitions.get(existingId) || '（空内容）'
            return (
              <button
                key={existingId}
                type="button"
                title={`[^${existingId}]: ${preview}`}
                onClick={() => {
                  setId(existingId)
                  setContent('')
                }}
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-caption transition-colors ${
                  active
                    ? 'bg-primary text-white font-medium'
                    : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
              >
                {existingId}
              </button>
            )
          })}
          {trimmedId !== defaultId && (
            <button
              type="button"
              onClick={() => {
                setId(defaultId)
                contentRef.current?.focus()
              }}
              className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-caption text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
            >
              新建 {defaultId}
            </button>
          )}
        </div>
      )}

      <textarea
        ref={contentRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey) return
          e.preventDefault()
          apply()
        }}
        placeholder={
          hasExistingDef
            ? '复用已有脚注时请留空（仅插入引用，不覆盖原定义）'
            : '脚注内容（可留空占位，之后在文末直接编辑）'
        }
        aria-label="脚注内容"
        spellCheck={false}
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border border-black/10 bg-white px-2.5 py-2 text-body text-text-primary outline-none focus:border-primary/50 dark:border-white/10"
      />

      {hasInvalidChars && (
        <div className="mt-1.5 text-caption text-red-600 dark:text-red-400">
          编号不能包含空格、冒号或右方括号 ]。
        </div>
      )}

      {hasExistingDef && !hasOverwriteConflict && (
        <div className="mt-1.5 rounded-lg bg-primary/5 px-2.5 py-1.5 text-caption text-text-secondary">
          <div className="truncate text-text-primary">
            已有定义 [^{trimmedId}]：{existingDefText || '（空内容）'}
          </div>
          <div className="mt-0.5">将在光标处插入复用引用，保留原有定义不变。</div>
        </div>
      )}

      {hasOverwriteConflict && (
        <div className="mt-1.5 rounded-lg border border-red-500/25 bg-red-500/5 px-2.5 py-1.5 text-caption text-red-600 dark:text-red-400">
          <div>编号 &ldquo;{trimmedId}&rdquo; 已有定义，不能直接覆盖原内容。</div>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setId(defaultId)}
              className="rounded bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary hover:bg-primary/20"
            >
              改用新编号 {defaultId}
            </button>
            <button
              type="button"
              onClick={() => setContent('')}
              className="rounded bg-black/5 px-2 py-0.5 text-caption text-text-secondary hover:bg-black/10 hover:text-text-primary dark:bg-white/10 dark:hover:bg-white/15"
            >
              清空内容仅引用
            </button>
          </div>
        </div>
      )}

      {isDanglingRef && (
        <div className="mt-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-caption text-amber-700 dark:text-amber-300">
          <span>正文中已有引用 [^{trimmedId}]（暂无定义），本次将在文末补充定义。</span>
          {trimmedId !== defaultId && (
            <button
              type="button"
              onClick={() => setId(defaultId)}
              className="ml-1.5 font-medium text-primary hover:underline"
            >
              改用新编号 {defaultId}
            </button>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-label text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
        >
          取消
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          className="rounded-lg bg-primary px-3 py-1.5 text-label font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-35"
        >
          {submitLabel}
        </button>
      </div>
    </div>,
    document.body
  )
}
