import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useWorkbenchStore, type WorkbenchAiAction } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchSelectionMenu, { WORKBENCH_AI_SELECTION_ACTIONS } from './WorkbenchSelectionMenu'

/**
 * 工作台文档预览的划词链路公共实现（docx 预览同构逻辑的抽取版）：
 * - 容器内选区校验：选区公共祖先必须落在预览容器内，防止误捕文件树/编辑器选区；
 * - 捕获时即完成 AI 文本转换（如表格选区转 Markdown），而不是发送时——
 *   选区折叠后 live Range 已不可用，转换必须在捕获点完成；
 * - 右下角"已选 N 字"气泡 + 右键 WorkbenchSelectionMenu；
 * - 发送动作统一走 workbenchStore.askAi（CustomEvent 注入侧边栏），
 *   侧边栏未就绪的兜底提示由 WorkbenchAiSidebar 自身负责（平台未就绪 toast）。
 */

export interface SelectionCaptureContext {
  /** 捕获瞬间 clone 的选区 Range（脱离 live selection，可安全读 DOM）。无选区时为 null */
  range: Range | null
  plainText: string
}

interface Capture {
  plain: string
  aiText: string
}

interface MenuState {
  x: number
  y: number
  capture: Capture
}

export interface UseWorkbenchSelectionAiOptions {
  /** 预览内容容器：选区合法性校验与鼠标事件都绑定在这棵子树上 */
  containerRef: RefObject<HTMLElement | null>
  /**
   * 程序化选区捕获（Excel 式单元格范围选区）：返回 null 表示当前无选区，
   * 走此通道时完全绕过浏览器 DOM 选区；copy 使用返回的 plain（TSV）写剪贴板。
   */
  captureOverride?: () => { plain: string; aiText: string } | null
  /**
   * 捕获选区时把选中内容转成发给 AI 的文本（xlsx 表格选区转 Markdown）。
   * 缺省直接用纯文本。转换结果只在捕获点计算一次。
   */
  transformForAi?: (ctx: SelectionCaptureContext) => string
  /**
   * copy 行为：'plain' 写纯文本进剪贴板（docx 语义）；
   * 'native' 执行系统原生拷贝（Chromium 对 table 选区自带 TSV/HTML 富格式，
   * 粘贴到 Excel/Sheets 能保住行列结构），失败回退纯文本。
   */
  copyMode?: 'plain' | 'native'
}

export interface WorkbenchSelectionAi {
  /** 当前选中文本（纯文本，用于气泡计数展示） */
  selectedText: string
  onMouseUp: () => void
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
  /** 气泡 + 右键菜单的渲染节点，直接挂进预览根布局即可 */
  overlay: ReactNode
  /**
   * 清空残留选区状态：预览内容整体替换（如 xlsx 切 sheet）时浏览器只静默折叠
   * DOM 选区、不发 mouseup，气泡/菜单会带陈旧文本挂在新内容上，必须主动清。
   */
  clear: () => void
}

const selectionActions = WORKBENCH_AI_SELECTION_ACTIONS.filter((item) => item.action !== 'mindmap')

export function useWorkbenchSelectionAi(options: UseWorkbenchSelectionAiOptions): WorkbenchSelectionAi {
  const { containerRef, copyMode = 'plain' } = options
  const askAi = useWorkbenchStore((s) => s.askAi)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  // 选区折叠后 handleContextMenu 要回退到最近一次容器内捕获
  const lastCaptureRef = useRef<Capture | null>(null)
  const transformRef = useRef(options.transformForAi)
  transformRef.current = options.transformForAi
  const captureOverrideRef = useRef(options.captureOverride)
  captureOverrideRef.current = options.captureOverride

  const [selectedText, setSelectedText] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)

  const captureSelectionInside = useCallback((): Capture | null => {
    const override = captureOverrideRef.current
    if (override) {
      try {
        const result = override()
        if (!result || !result.plain.trim()) return null
        return { plain: result.plain, aiText: result.aiText.trim() || result.plain }
      } catch {
        return null
      }
    }
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return null
    // 选区跨到文档外时，getSelection 仍会返回整段文本；
    // 以整段 Range 的公共祖先是否在容器内判定，避免把文件树等选区误当作文档内容。
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return null
    const plain = selection.toString().trim()
    if (!plain) return null
    // cloneRange 不复制 DOM，只固定端点，转换器内部自行 cloneContents。
    const cloned = range.cloneRange()
    const transform = transformRef.current
    let aiText = plain
    try {
      aiText = transform ? transform({ range: cloned, plainText: plain }).trim() || plain : plain
    } catch {
      aiText = plain
    }
    return { plain, aiText }
  }, [containerRef])

  const handleMouseUp = useCallback(() => {
    const capture = captureSelectionInside()
    lastCaptureRef.current = capture
    setSelectedText(capture?.plain ?? '')
  }, [captureSelectionInside])

  // 点到文档外收起快捷气泡；点击气泡自身不算
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (bubbleRef.current?.contains(target)) return
      const container = containerRef.current
      if (container?.contains(target)) {
        // 左键开始新的点选，旧选区不再代表用户意图
        if (event.button === 0) lastCaptureRef.current = null
        setMenu(null)
        return
      }
      setSelectedText('')
      lastCaptureRef.current = null
      setMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelectedText('')
        lastCaptureRef.current = null
        setMenu(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [containerRef])

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      // 只接管本文档内的选区；选区已被折叠时退回最近一次文档内选区。
      const capture = captureSelectionInside() ?? lastCaptureRef.current
      if (!capture || !capture.plain) return
      event.preventDefault()
      event.stopPropagation()
      setSelectedText(capture.plain)
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 220),
        y: Math.min(event.clientY, window.innerHeight - 260),
        capture
      })
    },
    [captureSelectionInside]
  )

  useEffect(() => {
    if (!menu) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menu])

  const clear = useCallback(() => {
    lastCaptureRef.current = null
    setSelectedText('')
    setMenu(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const runAction = (capture: Capture, action: WorkbenchAiAction): void => {
    if (!capture.aiText) return
    askAi(capture.aiText, action)
    window.getSelection()?.removeAllRanges()
    lastCaptureRef.current = null
    setSelectedText('')
    setMenu(null)
  }

  const copyCapture = async (capture: Capture): Promise<void> => {
    if (!capture.plain) return
    if (copyMode === 'native') {
      // 原生拷贝保留系统剪贴板的富格式（table 选区 → TSV/HTML），
      // 前提是选区尚未被动作链路清除；失效时回退纯文本。
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        try {
          if (document.execCommand('copy')) {
            setMenu(null)
            return
          }
        } catch {
          // 继续走纯文本兜底
        }
      }
    }
    await navigator.clipboard.writeText(capture.plain)
    setMenu(null)
  }

  const currentCapture: Capture | null = menu?.capture ?? lastCaptureRef.current

  const overlay: ReactNode = (
    <>
      {selectedText && !menu && (
        <div
          ref={bubbleRef}
          // 点击气泡不能抢走文档选区，否则选区折叠后动作拿不到文本
          onMouseDown={(event) => event.preventDefault()}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-dropdown flex items-center gap-1 rounded-full border border-black/5 bg-white/95 px-3 py-1.5 text-label text-text-secondary shadow-float backdrop-blur-md dark:border-white/10 dark:bg-gray-900/90"
        >
          <span className="whitespace-nowrap pr-1 tabular-nums">已选 {selectedText.length} 字</span>
          <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
          <button
            type="button"
            onClick={() => currentCapture && runAction(currentCapture, 'ask')}
            className="w-7 h-7 flex items-center justify-center rounded-full text-blue-500 hover:bg-blue-500/10 transition-colors"
            title="发送到 AI 侧边栏"
          >
            <AppIcon name="send" size={16} />
          </button>
          <button
            type="button"
            onClick={() => currentCapture && runAction(currentCapture, 'explain')}
            className="w-7 h-7 flex items-center justify-center rounded-full text-purple-500 hover:bg-purple-500/10 transition-colors"
            title="解释此内容"
          >
            <AppIcon name="psychology" size={16} />
          </button>
          <button
            type="button"
            onClick={() => currentCapture && runAction(currentCapture, 'summarize')}
            className="w-7 h-7 flex items-center justify-center rounded-full text-cyan-500 hover:bg-cyan-500/10 transition-colors"
            title="提取关键要点"
          >
            <AppIcon name="format_list_bulleted" size={16} />
          </button>
          <button
            type="button"
            onClick={() => currentCapture && void copyCapture(currentCapture)}
            className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="复制选中文本"
          >
            <AppIcon name="content_copy" size={16} />
          </button>
        </div>
      )}

      {menu && (
        <WorkbenchSelectionMenu
          ref={menuRef}
          x={menu.x}
          y={menu.y}
          items={selectionActions}
          onSelectAction={(action) => {
            if (action !== 'mindmap') runAction(menu.capture, action)
          }}
          onCopy={() => void copyCapture(menu.capture)}
        />
      )}
    </>
  )

  return {
    selectedText,
    onMouseUp: handleMouseUp,
    onContextMenu: handleContextMenu,
    overlay,
    clear
  }
}
