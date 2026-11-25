import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'
import { AppIcon } from '../icons/AppIcon'

const POPOVER_WIDTH = 420
const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 6
const ESTIMATED_HEIGHT = 220

export interface WorkbenchEquationEditorProps {
  /** 锚点矩形：工具栏按钮或公式节点 DOM 的 getBoundingClientRect() */
  anchorRect: DOMRect
  initialEquation: string
  /** 块级 = $$..$$；行内 = $..$（仅影响预览与提示文案） */
  inline: boolean
  /** 非空公式提交；trim 后为空时不会回调（走 onClear） */
  onApply: (equation: string) => void
  /** 已有公式的清空动作（删除节点）；插入场景不传则不显示 */
  onClear?: () => void
  onClose: () => void
}

/**
 * 通用 LaTeX 公式编辑弹层：KaTeX 实时预览 + 源码输入。
 * 工具栏"插入公式"与公式节点"编辑公式"共用，portal 到 body 避免被编辑器裁切。
 * - Enter 保存 / Esc 取消 / 点击外部关闭
 * - 传入 onClear 时显示"清除公式"按钮，用于把已有公式整体删除
 */
export default function WorkbenchEquationEditor({
  anchorRect,
  initialEquation,
  inline,
  onApply,
  onClear,
  onClose
}: WorkbenchEquationEditorProps): JSX.Element {
  const [draft, setDraft] = useState(initialEquation)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  const trimmed = draft.trim()

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
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.select()
  }, [])

  // KaTeX 实时预览：语法错误时回显源码 + 提示，不中断输入
  useEffect(() => {
    const element = previewRef.current
    if (!element) return
    if (!trimmed) {
      element.textContent = ''
      setRenderError(null)
      return
    }
    try {
      katex.render(trimmed, element, {
        displayMode: !inline,
        throwOnError: true,
        errorColor: '#cc0000'
      })
      setRenderError(null)
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error))
      element.textContent = trimmed
    }
  }, [trimmed, inline])

  // 外部点击 / Esc 关闭（capture 阶段，避免编辑器侧先消费）
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

  const applyEquation = useCallback((): void => {
    const next = draft.trim()
    if (!next) {
      if (onClear) {
        onClear()
        onClose()
      }
      return
    }
    onApply(next)
    onClose()
  }, [draft, onApply, onClear, onClose])

  const clearEquation = useCallback((): void => {
    if (!onClear) return
    onClear()
    onClose()
  }, [onClear, onClose])

  return createPortal(
      // 特例 z-[120]：编辑器弹层需压在 Modal/浮动工具条之上
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="公式"
        className="fixed z-[120] rounded-xl border border-black/10 bg-white p-2.5 shadow-lg dark:border-white/10 dark:bg-gray-800"
        style={{ width: position.width, left: position.left, top: position.top }}
      >
        {/* KaTeX 实时预览区 */}
        <div
          className={`min-h-[44px] rounded-md border border-black/5 bg-black/[0.02] px-3 py-2 dark:border-white/5 dark:bg-white/[0.03] ${
            inline ? 'text-left' : 'text-center'
          }`}
        >
          {trimmed ? (
            <div
              ref={previewRef}
              className={renderError ? 'font-mono text-label text-red-500' : 'text-text-primary'}
            />
          ) : (
            <span className="text-label text-text-secondary/70">输入 LaTeX，下方实时预览</span>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              applyEquation()
            }
          }}
          placeholder={inline ? '例如：E = mc^2' : '例如：\\frac{a}{b}'}
          aria-label="LaTeX 公式"
          spellCheck={false}
          className="mt-2 h-20 w-full resize-y rounded-md border border-black/10 bg-transparent px-2 py-1.5 font-mono text-label text-text-primary outline-none placeholder:text-text-secondary/70 focus:ring-1 focus:ring-primary/40 dark:border-white/10"
        />

        <div className="mt-1.5 flex items-center justify-between gap-2 text-caption text-text-secondary">
          <span className="flex min-w-0 items-center gap-1">
            <AppIcon name="function" size={12} className="shrink-0 text-primary" />
            <span className="truncate">
              {renderError
                ? `语法错误：${renderError}`
                : inline
                  ? '行内公式 · Enter 保存 / Esc 取消'
                  : '块级公式 · Enter 保存 / Esc 取消'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {onClear && (
              <button
                type="button"
                onClick={clearEquation}
                title="清除公式"
                className="flex h-6 items-center gap-1 rounded px-1.5 text-red-500 transition-colors hover:bg-red-500/10"
              >
                <AppIcon name="delete" size={12} />
                清除
              </button>
            )}
          <button
            type="button"
            onClick={applyEquation}
            disabled={!trimmed && !onClear}
            className="h-6 rounded bg-primary px-2 text-white transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-35"
          >
            保存
          </button>
        </span>
      </div>
    </div>,
    document.body
  )
}
