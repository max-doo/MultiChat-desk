import { useEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'
import { useWorkbenchStore, type WorkbenchAiAction } from '../../store/workbenchStore'
import WorkbenchSelectionMenu, { WORKBENCH_AI_SELECTION_ACTIONS } from './WorkbenchSelectionMenu'

interface MenuPosition {
  x: number
  y: number
  selectedText: string
}

/** 编辑器内选中文本的专属右键/快捷菜单插件。 */
export default function WorkbenchSelectionMenuPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const askAi = useWorkbenchStore((s) => s.askAi)
  const openRightPane = useWorkbenchStore((s) => s.openRightPane)
  const setPendingMindmapSelection = useWorkbenchStore((s) => s.setPendingMindmapSelection)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const handleAction = useCallback(
    (action: WorkbenchAiAction) => {
      if (menuPosition?.selectedText) {
        askAi(menuPosition.selectedText, action)
      }
      setMenuPosition(null)
    },
    [askAi, menuPosition]
  )

  const handleCopy = useCallback(async () => {
    if (menuPosition?.selectedText) {
      await navigator.clipboard.writeText(menuPosition.selectedText)
    }
    setMenuPosition(null)
  }, [menuPosition])

  // 只记录选区并切到导图面板，不自动发送；生成动作仍由用户确认。
  const handleMindmap = useCallback(() => {
    const text = menuPosition?.selectedText
    if (!text) return
    const root = editor.getRootElement()
    const headingPath: string[] = []
    if (root) {
      let node: Element | null = root
      while (node && node !== root.parentElement) {
        const previous = node.previousElementSibling
        if (!previous) { node = node.parentElement; continue }
        const heading = previous.matches('h1,h2,h3,h4,h5,h6') ? previous.textContent : null
        if (heading) { headingPath.unshift(heading.trim()); break }
        node = previous
      }
    }
    setPendingMindmapSelection({ text, headingPath })
    openRightPane('mindmap')
    setMenuPosition(null)
  }, [editor, menuPosition, openRightPane, setPendingMindmapSelection])

  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    const handleContextMenu = (e: MouseEvent) => {
      // 检查当前选中文本
      let selectedText = ''
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selectedText = selection.getTextContent().trim()
        }
      })

      // 如果没有通过 Lexical selection 获取到，降级使用 window.getSelection()
      if (!selectedText) {
        selectedText = window.getSelection()?.toString().trim() || ''
      }

      if (!selectedText) {
        setMenuPosition(null)
        return
      }

      // 阻止默认上下文菜单并弹出专属 AI 划词菜单
      e.preventDefault()
      e.stopPropagation()

      // 约束边界避免溢出视口
      const x = Math.min(e.clientX, window.innerWidth - 220)
      const y = Math.min(e.clientY, window.innerHeight - 260)

      setMenuPosition({
        x,
        y,
        selectedText
      })
    }

    rootElement.addEventListener('contextmenu', handleContextMenu)
    return () => {
      rootElement.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [editor])

  // 点击外部或按 Esc 关闭菜单
  useEffect(() => {
    if (!menuPosition) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPosition(null)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuPosition(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuPosition])

  if (!menuPosition) return null

  const isCodeFile = useWorkbenchStore.getState().activeFileCategory === 'code'
  const items = isCodeFile
    ? WORKBENCH_AI_SELECTION_ACTIONS.filter((item) => item.action === 'mindmap')
    : WORKBENCH_AI_SELECTION_ACTIONS

  return (
    <WorkbenchSelectionMenu
      ref={menuRef}
      x={menuPosition.x}
      y={menuPosition.y}
      items={items}
      onSelectAction={(action) => (action === 'mindmap' ? handleMindmap() : handleAction(action))}
      onCopy={() => void handleCopy()}
    />
  )
}
