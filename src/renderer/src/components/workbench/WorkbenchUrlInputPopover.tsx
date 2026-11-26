import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatUrl } from '@lexical/link'
import { AppIcon } from '../icons/AppIcon'
import { normalizeWorkbenchLocalFileLink } from './workbenchLinks'

const POPOVER_WIDTH = 340
const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 6
const ESTIMATED_HEIGHT = 52
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function normalizeLinkUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  const compact = value.replace(/\p{Cc}/gu, '')
  const explicitScheme = compact.match(/^([a-z][a-z0-9+.-]*):/i)
  if (explicitScheme) {
    const scheme = `${explicitScheme[1].toLowerCase()}:`
    if (!ALLOWED_URL_SCHEMES.has(scheme)) return null
    if (scheme === 'http:' || scheme === 'https:') {
      try {
        if (!new URL(compact).hostname) return null
      } catch {
        return null
      }
    }
    return compact
  }

  const localFile = normalizeWorkbenchLocalFileLink(compact)
  if (localFile) return localFile
  if (/^[/#.]/.test(compact)) return compact
  const formatted = formatUrl(compact)
  try {
    return new URL(formatted).hostname ? formatted : null
  } catch {
    return null
  }
}

interface WorkbenchUrlInputPopoverProps {
  anchorRect: DOMRect
  initialUrl: string | null
  onApply: (url: string) => void
  onRemove?: () => void
  onClose: () => void
}

export default function WorkbenchUrlInputPopover({
  anchorRect,
  initialUrl,
  onApply,
  onRemove,
  onClose
}: WorkbenchUrlInputPopoverProps): JSX.Element {
  const [url, setUrl] = useState(initialUrl ?? '')
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const normalizedUrl = normalizeLinkUrl(url)

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
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
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

  const applyUrl = (): void => {
    if (!normalizedUrl) return
    onApply(normalizedUrl)
    onClose()
  }

  const removeUrl = (): void => {
    if (!onRemove) return
    onRemove()
    onClose()
  }

  return createPortal(
    <>
      {/* 特例 z-[120]：链接弹层需压在 Modal/浮动工具条之上 */}
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="链接"
        className="fixed z-[120] flex items-center gap-1 liquid-glass-menu rounded-xl p-1.5"
        style={{ width: position.width, left: position.left, top: position.top }}
      >
        <AppIcon name="link" size={16} className="ml-1 shrink-0 text-text-secondary" />
        <input
          ref={inputRef}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            applyUrl()
          }}
          placeholder="粘贴或输入链接"
          aria-label="链接地址"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 bg-transparent px-1 text-body text-text-primary outline-none placeholder:text-text-secondary/70"
        />
        {onRemove && (
          <button
            type="button"
            onClick={removeUrl}
            title="移除链接"
            aria-label="移除链接"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
          >
            <AppIcon name="delete" size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={applyUrl}
          disabled={!normalizedUrl}
          title="应用链接"
          aria-label="应用链接"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-white transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-35"
        >
          <AppIcon name="check" size={19} />
        </button>
      </div>
    </>,
    document.body
  )
}
