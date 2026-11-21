import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
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

/**
 * Workbench 极简原位变形 Markdown 大纲导航
 *
 * 特性：
 * 1. 100% 透明无边框容器，置于编辑器左侧，零排版侵占；
 * 2. 静止态为左对齐精细横线，线长映射标题深度 (H1: 26px, H2: 18px, H3: 12px, H4+: 8px)；
 * 3. 鼠标 Hover 具体横线时，横线直接向右展开为标题药丸（无多余蓝点，阴影轻盈通透）；
 * 4. 周围横线自动弹性避让；
 * 5. 滚动时 ScrollSpy 实时点亮当前阅读小节；
 * 6. 点击标题平滑滚动至对应锚点，并触发柔和聚焦高亮脉冲。
 */
export default function WorkbenchMinimalToc({ scrollContainerRef }: Props): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeKey, setActiveKey] = useState<string>('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const isHoveringContainerRef = useRef(false)

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

  return (
    <aside
      className="absolute left-3.5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-start pointer-events-auto select-none bg-transparent border-0 shadow-none outline-none max-h-[75vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-2"
      aria-label="Markdown 极简大纲导航"
      onMouseEnter={() => {
        isHoveringContainerRef.current = true
      }}
      onMouseLeave={() => {
        isHoveringContainerRef.current = false
        setHoveredIndex(null)
      }}
    >
      <div className="flex flex-col items-start w-auto">
        {headings.map((h, idx) => {
          const isHovered = hoveredIndex === idx
          const isActive = activeKey === h.key
          const isAdjacentAbove = hoveredIndex !== null && idx === hoveredIndex - 1
          const isAdjacentBelow = hoveredIndex !== null && idx === hoveredIndex + 1
          const isOther = hoveredIndex !== null && !isHovered

          // 根据层级决定静止线宽 (H1: 26px, H2: 18px, H3: 12px, H4+: 8px)
          const lineWidth =
            h.level === 1 ? '26px' : h.level === 2 ? '18px' : h.level === 3 ? '12px' : '8px'

          return (
            <div
              key={h.key}
              onClick={() => handleHeadingClick(h.key)}
              onMouseEnter={() => setHoveredIndex(idx)}
              className={`relative flex items-center justify-start cursor-pointer transition-all duration-200 ease-out ${
                isHovered ? 'h-[26px] my-[3px]' : 'h-[20px] my-[1px]'
              } ${isAdjacentAbove ? '-translate-y-[2px] scale-[0.96]' : ''} ${
                isAdjacentBelow ? 'translate-y-[2px] scale-[0.96]' : ''
              } ${isOther ? 'opacity-35 scale-x-[0.92]' : 'opacity-100'}`}
              title={h.title}
            >
              <div
                className={`inline-flex items-center justify-start rounded-full transition-all duration-200 ease-out origin-left whitespace-nowrap ${
                  isHovered
                    ? 'bg-white shadow-[0_2px_10px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] border border-gray-200/80 py-1 px-2.5 scale-[1.02]'
                    : 'bg-transparent py-0 px-1'
                }`}
              >
                {/* 静止态：左对齐横线；Hover 展开态：线段自然隐退，直接呈现标签与文字 */}
                {!isHovered && (
                  <span
                    className={`transition-all duration-200 ease-out shrink-0 rounded-full ${
                      isActive
                        ? 'bg-primary h-[3.5px] shadow-[0_0_8px_rgba(59,130,246,0.45)]'
                        : 'bg-slate-300 h-[2.5px]'
                    }`}
                    style={{
                      width: lineWidth
                    }}
                  />
                )}

                {/* 原位展开的标题内容：不带多余蓝点，以纯净的 Hx 徽标开头 */}
                <div
                  className={`flex items-center gap-1.5 overflow-hidden transition-all duration-250 ease-out ${
                    isHovered
                      ? 'max-w-[260px] opacity-100 translate-x-0'
                      : 'max-w-0 opacity-0 -translate-x-2 pointer-events-none'
                  }`}
                >
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 text-primary font-bold shrink-0">
                    H{h.level}
                  </span>
                  <span className="text-xs font-medium text-text-primary truncate">
                    {h.title}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
