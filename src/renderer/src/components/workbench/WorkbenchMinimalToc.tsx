import { useCallback, useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { $getRoot } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

export interface HeadingItem {
  key: string
  level: number
  title: string
}

interface Props {
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

const RAIL_WIDTH = 28
const RAIL_GAP = 8
const PILL_MAX_WIDTH = 260

/**
 * Workbench 极简原位变形 Markdown 大纲导航
 *
 * 特性：
 * 1. 100% 透明无边框容器，贴在居中正文左缘外侧，零排版侵占；
 * 2. 静止态为左对齐精细横线，线长映射标题深度 (H1: 26px, H2: 18px, H3: 12px, H4+: 8px)；
 * 3. 鼠标 Hover 具体横线时，标题药丸向右展开（无多余蓝点，阴影轻盈通透）；
 * 4. 悬停只改变目录自身状态，正文与滚动位置保持不动；
 * 5. 滚动时 ScrollSpy 实时点亮当前阅读小节；
 * 6. 点击标题平滑滚动至对应锚点，并触发柔和聚焦高亮脉冲。
 */
export default function WorkbenchMinimalToc({ scrollContainerRef }: Props): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeKey, setActiveKey] = useState<string>('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [railLeft, setRailLeft] = useState<number | null>(null)
  const [pill, setPill] = useState<{ top: number; left: number; maxWidth: number } | null>(null)

  // 大纲贴在居中正文左缘外侧，而不是窗口左缘；窗口缩放后始终跟随正文。
  useEffect(() => {
    const scroller = scrollContainerRef?.current
    const editorRoot = scroller?.closest<HTMLElement>('[data-workbench-editor="true"]')
    if (!scroller || !editorRoot) return

    const measure = (): void => {
      const article = editorRoot.querySelector<HTMLElement>('[data-workbench-article]')
      const content = article?.querySelector<HTMLElement>('[contenteditable="true"]')
      if (!article || !content) return
      const editorRect = editorRoot.getBoundingClientRect()
      // 以正文文本左缘为锚，让大纲跟着居中的阅读列走；过窄时收进视口。
      const textLeft = Math.round(content.getBoundingClientRect().left - editorRect.left)
      setRailLeft(
        Math.min(
          Math.max(textLeft - RAIL_GAP - RAIL_WIDTH, 8),
          Math.max(8, Math.round(editorRect.width) - RAIL_WIDTH - 8)
        )
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(editorRoot)
    const article = editorRoot.querySelector<HTMLElement>('[data-workbench-article]')
    if (article) observer.observe(article)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [scrollContainerRef])

  // 1. 扫描与监听 Lexical 编辑器中的所有标题节点
  useEffect(() => {
    const updateHeadings = (): void => {
      editor.getEditorState().read(() => {
        const root = $getRoot()
        const items: HeadingItem[] = []
        for (const child of root.getChildren()) {
          if ($isHeadingNode(child)) {
            const tag = child.getTag()
            const level = parseInt(tag.slice(1), 10) || 2
            const title = child.getTextContent().trim()
            if (title) {
              items.push({
                key: child.getKey(),
                level,
                title
              })
            }
          }
        }
        setHeadings(items)
      })
    }

    // 初始化提取
    updateHeadings()

    // 订阅编辑器状态变更
    return editor.registerUpdateListener(() => {
      updateHeadings()
    })
  }, [editor])

  // 2. ScrollSpy 滚动监听与当前阅读进度判定
  useEffect(() => {
    const container = scrollContainerRef?.current
    if (!container || headings.length === 0) return

    let ticking = false
    const onScroll = (): void => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const scrollTop = container.scrollTop
        const containerRect = container.getBoundingClientRect()
        let currentKey = headings[0]?.key || ''

        for (const h of headings) {
          const dom = editor.getElementByKey(h.key)
          if (dom) {
            const domRect = dom.getBoundingClientRect()
            const relativeTop = container.scrollTop + (domRect.top - containerRect.top)
            // 视口上部 100px 黄金阅读感知线
            if (relativeTop - 100 <= scrollTop) {
              currentKey = h.key
            } else {
              break
            }
          }
        }
        setActiveKey(currentKey)
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      container.removeEventListener('scroll', onScroll)
    }
  }, [editor, headings, scrollContainerRef])

  // 3. 点击平滑定位到小节，并附加脉冲高亮
  const handleHeadingClick = useCallback(
    (key: string) => {
      const dom = editor.getElementByKey(key)
      const container = scrollContainerRef?.current
      if (dom && container) {
        const containerRect = container.getBoundingClientRect()
        const domRect = dom.getBoundingClientRect()
        const targetScrollTop = container.scrollTop + (domRect.top - containerRect.top) - 24
        container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' })

        dom.classList.add('workbench-heading-pulse')
        setTimeout(() => {
          dom.classList.remove('workbench-heading-pulse')
        }, 1400)
      }
    },
    [editor, scrollContainerRef]
  )

  // 标题少于 2 个时不渲染，保持简洁不扰民
  if (headings.length < 2) {
    return null
  }

  if (railLeft === null) return null

  return (
    <aside
      className="absolute top-1/2 -translate-y-1/2 z-20 flex flex-col items-start pointer-events-auto select-none bg-transparent border-0 shadow-none outline-none py-2"
      style={{ left: `${railLeft}px`, width: `${RAIL_WIDTH}px` }}
      aria-label="Markdown 极简大纲导航"
      onMouseLeave={() => {
        setHoveredIndex(null)
        setPill(null)
      }}
    >
      <div className="flex max-h-[75vh] w-full flex-col items-start overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {headings.map((h, idx) => {
          const isHovered = hoveredIndex === idx
          const isActive = activeKey === h.key
          const isOther = hoveredIndex !== null && !isHovered

          // 根据层级决定静止线宽 (H1: 26px, H2: 18px, H3: 12px, H4+: 8px)
          const lineWidth =
            h.level === 1 ? '26px' : h.level === 2 ? '18px' : h.level === 3 ? '12px' : '8px'

          return (
            <div
              key={h.key}
              onClick={() => handleHeadingClick(h.key)}
              onMouseEnter={(event) => {
                setHoveredIndex(idx)
                const rowRect = event.currentTarget.getBoundingClientRect()
                setPill({
                  top: rowRect.top + rowRect.height / 2,
                  left: rowRect.right + 8,
                  // 气泡向右展开，靠近窗口右缘时收窄，避免溢出视口。
                  maxWidth: Math.max(120, window.innerWidth - rowRect.right - 24)
                })
              }}
              className={`relative flex w-7 items-center justify-start cursor-pointer transition-all duration-200 ease-out ${
                isHovered ? 'h-[26px] my-[3px]' : 'h-[20px] my-[1px]'
              } ${isOther ? 'opacity-35 scale-x-[0.92]' : 'opacity-100'}`}
              title={h.title}
            >
              <div
                className="inline-flex items-center justify-start rounded-full bg-transparent whitespace-nowrap"
              >
                <span
                  className={`transition-all duration-200 ease-out shrink-0 rounded-full ${
                    isActive
                      ? 'bg-primary h-[3.5px] shadow-[0_0_8px_rgba(59,130,246,0.45)]'
                      : 'bg-slate-300 h-[2.5px]'
                  } ${isHovered ? 'bg-primary' : ''}`}
                  style={{
                    width: lineWidth
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {/* 悬停标题挂到 body：目录自身滚动或祖先 transform 都不会裁切它。 */}
      {hoveredIndex !== null &&
        pill &&
        createPortal(
          <div
            className="pointer-events-none fixed z-30 -translate-y-1/2 flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white py-1 px-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] whitespace-nowrap"
            style={{
              top: `${pill.top}px`,
              left: `${pill.left}px`,
              maxWidth: `${Math.min(PILL_MAX_WIDTH, pill.maxWidth)}px`
            }}
          >
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 text-primary font-bold shrink-0">
              H{headings[hoveredIndex]?.level}
            </span>
            <span className="min-w-0 text-xs font-medium text-text-primary truncate">
              {headings[hoveredIndex]?.title}
            </span>
          </div>,
          document.body
        )}
    </aside>
  )
}
