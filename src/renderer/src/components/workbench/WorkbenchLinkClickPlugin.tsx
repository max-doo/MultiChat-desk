import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'

/**
 * 工作台链接点击规则：
 * - 可编辑状态：普通点击只定位光标，Ctrl/Cmd + 点击或中键打开链接；
 * - 只读状态：普通点击直接打开链接。
 */
export default function WorkbenchLinkClickPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    let cleanup = (): void => {}
    let modifierHeld = false

    const syncCursor = (): void => {
      const root = editor.getRootElement()
      if (!root) return
      if (!editor.isEditable() || modifierHeld) {
        root.dataset.workbenchLinkCursor = 'pointer'
      } else {
        delete root.dataset.workbenchLinkCursor
      }
    }

    const handleModifierPointer = (event: PointerEvent): void => {
      const next = event.ctrlKey || event.metaKey
      if (next === modifierHeld) return
      modifierHeld = next
      syncCursor()
    }

    const handleModifierKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Control' && event.key !== 'Meta') return
      modifierHeld = true
      syncCursor()
    }

    const handleModifierKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== 'Control' && event.key !== 'Meta') return
      modifierHeld = false
      syncCursor()
    }

    const handleWindowBlur = (): void => {
      modifierHeld = false
      syncCursor()
    }

    const handleClick = (event: MouseEvent): void => {
      if (event.type === 'auxclick' && event.button !== 1) return
      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a')
      if (!(anchor instanceof HTMLAnchorElement)) return
      const href = anchor.getAttribute('href')
      if (!href || href === 'about:blank') return

      const selection = editor.getEditorState().read(() => $getSelection())
      if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        event.preventDefault()
        return
      }

      const modifierOpen = event.metaKey || event.ctrlKey
      const middleOpen = event.type === 'auxclick' && event.button === 1
      const shouldOpen = !editor.isEditable() || modifierOpen || middleOpen
      event.preventDefault()
      if (!shouldOpen) return

      try {
        const url = new URL(href, window.location.href)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return
        window.open(url.href, '_blank', 'noopener')
      } catch {
        // 无效链接不打开，也不回退到页面内导航
      }
    }

    const attach = (root: HTMLElement | null): void => {
      cleanup()
      cleanup = () => {}
      if (!root) return
      root.addEventListener('click', handleClick)
      root.addEventListener('auxclick', handleClick)
      root.addEventListener('pointermove', handleModifierPointer)
      root.addEventListener('pointerover', handleModifierPointer)
      syncCursor()
      cleanup = () => {
        root.removeEventListener('click', handleClick)
        root.removeEventListener('auxclick', handleClick)
        root.removeEventListener('pointermove', handleModifierPointer)
        root.removeEventListener('pointerover', handleModifierPointer)
      }
    }

    attach(editor.getRootElement())
    const unregisterRoot = editor.registerRootListener((root) => {
      attach(root)
    })
    const unregisterEditable = editor.registerEditableListener(() => {
      syncCursor()
    })
    window.addEventListener('keydown', handleModifierKeyDown, true)
    window.addEventListener('keyup', handleModifierKeyUp, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleModifierKeyDown, true)
      window.removeEventListener('keyup', handleModifierKeyUp, true)
      window.removeEventListener('blur', handleWindowBlur)
      unregisterEditable()
      unregisterRoot()
      cleanup()
    }
  }, [editor])

  return null
}
