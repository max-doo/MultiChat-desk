import { useEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'
import { useWorkbenchStore, type WorkbenchAiAction } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'

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
  const items: Array<{
    action: WorkbenchAiAction | 'mindmap'
    label: string
    icon: string
    color: string
  }> = isCodeFile
    ? [{ action: 'mindmap', label: '生成思维导图', icon: 'diagram_flow_horizontal', color: 'text-indigo-500' }]
    : [
        { action: 'ask', label: '向 AI 提问', icon: 'chat', color: 'text-blue-500' },
        { action: 'explain', label: '解释此内容', icon: 'psychology', color: 'text-purple-500' },
        { action: 'polish', label: '语言润色', icon: 'auto_fix_high', color: 'text-emerald-500' },
        { action: 'summarize', label: '提取关键要点', icon: 'format_list_bulleted', color: 'text-cyan-500' },
        { action: 'mindmap', label: '生成思维导图', icon: 'diagram_flow_horizontal', color: 'text-indigo-500' }
      ]

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[190px] py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-xl border border-black/10 dark:border-white/10 text-sm animate-in fade-in zoom-in-95 duration-100"
      style={{
        left: menuPosition.x,
        top: menuPosition.y
      }}
    >
      <div className="px-3 py-1 font-semibold text-sm text-text-secondary/70 uppercase tracking-wider border-b border-black/5 dark:border-white/5 mb-1">
        {isCodeFile ? '划词操作' : 'AI 划词协同'}
      </div>
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          onClick={() => item.action === 'mindmap' ? handleMindmap() : handleAction(item.action)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <AppIcon name={item.icon} size={19} className={`text-[19px] ${item.color}`} />
          <span className="font-medium">{item.label}</span>
        </button>
      ))}
      <div className="my-1 border-t border-black/5 dark:border-white/5" />
      <button
        type="button"
        onClick={handleCopy}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <AppIcon name="content_copy" size={19} />
        <span>复制选中文本</span>
      </button>
    </div>
  )
}
