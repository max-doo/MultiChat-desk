import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

interface LinkTip {
  url: string
  left: number
  top: number
  width: number
  placement: 'above' | 'below'
}

const VIEWPORT_MARGIN = 8
const MAX_TIP_WIDTH = 420

function readLinkUrl(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href')
  if (!href || href === 'about:blank') return null
  if (isBareLinkDisplay(anchor)) return null
  return href
}

function isBareLinkDisplay(anchor: HTMLAnchorElement): boolean {
  const href = anchor.getAttribute('href')
  const displayText = anchor.textContent?.trim() ?? ''
  if (!href || !displayText || href === 'about:blank') return false
  return normalizeLinkText(displayText) === normalizeLinkText(href)
}

function normalizeLinkText(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * 链接悬停提示：显示锚点的实际地址，避免依赖浏览器原生 title 的延迟反馈。
 */
export default function WorkbenchLinkHoverPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [tip, setTip] = useState<LinkTip | null>(null)
  const activeAnchorRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    let cleanup = (): void => {}

    const syncLinkKinds = (): void => {
      const root = editor.getRootElement()
      if (!root) return
      root.querySelectorAll('a').forEach((anchor) => {
        if (isBareLinkDisplay(anchor)) {
          anchor.dataset.workbenchLink = 'bare'
        } else {
          delete anchor.dataset.workbenchLink
        }
      })
    }

    const hide = (): void => {
      activeAnchorRef.current = null
      setTip(null)
    }

    const attach = (root: HTMLElement): (() => void) => {
      const handlePointerOver = (event: PointerEvent): void => {
        const target = event.target
        if (!(target instanceof Element)) return
        const anchor = target.closest('a')
        if (!(anchor instanceof HTMLAnchorElement) || !root.contains(anchor)) {
          hide()
          return
        }

        const url = readLinkUrl(anchor)
        if (!url) {
          hide()
          return
        }

        const rect = anchor.getBoundingClientRect()
        const width = Math.min(MAX_TIP_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
        const left = Math.min(
          Math.max(rect.left + rect.width / 2, width / 2 + VIEWPORT_MARGIN),
          window.innerWidth - width / 2 - VIEWPORT_MARGIN
        )
        const placement = rect.top > 56 ? 'above' : 'below'

        activeAnchorRef.current = anchor
        setTip({
          url,
          left,
          top: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
          width,
          placement
        })
      }

      const handlePointerOut = (event: PointerEvent): void => {
        const anchor = activeAnchorRef.current
        const related = event.relatedTarget
        if (anchor && related instanceof Node && anchor.contains(related)) return
        hide()
      }

      root.addEventListener('pointerover', handlePointerOver)
      root.addEventListener('pointerout', handlePointerOut)
      return () => {
        root.removeEventListener('pointerover', handlePointerOver)
        root.removeEventListener('pointerout', handlePointerOut)
      }
    }

    const attachRoot = (root: HTMLElement | null): void => {
      cleanup()
      cleanup = () => {}
      hide()
      if (!root) {
        return
      }
      cleanup = attach(root)
      syncLinkKinds()
    }

    attachRoot(editor.getRootElement())
    const unregisterRoot = editor.registerRootListener((root) => {
      attachRoot(root)
    })
    const unregisterUpdate = editor.registerUpdateListener(() => {
      syncLinkKinds()
    })

    window.addEventListener('scroll', hide, true)
    document.addEventListener('pointerdown', hide, true)

    return () => {
      unregisterUpdate()
      unregisterRoot()
      cleanup()
      window.removeEventListener('scroll', hide, true)
      document.removeEventListener('pointerdown', hide, true)
    }
  }, [editor])

  if (!tip) return null

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[130] rounded-md bg-gray-900/95 px-2 py-1 text-[11px] leading-relaxed text-white shadow-lg ring-1 ring-black/10 dark:bg-gray-950/95"
      style={{
        left: tip.left,
        top: tip.top,
        maxWidth: tip.width,
        transform:
          tip.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
      }}
    >
      <span className="break-all">{tip.url}</span>
    </div>,
    document.body
  )
}
