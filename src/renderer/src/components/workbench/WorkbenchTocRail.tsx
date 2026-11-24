import { useCallback, useEffect, useRef, useState, type JSX } from 'react'

export interface TocItem {
  /** 唯一标识，由调用方负责保证稳定（Lexical nodeKey 或 docx 段落索引）。 */
  key: string
  /** 1-9，与 Word outlineLevel + 1 / Markdown H1-H6 对齐。 */
  level: number
  /** 标题纯文本，悬停药丸里展示。 */
  title: string
}

interface Props {
  items: TocItem[]
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  /** 根据 item.key 反查渲染层 DOM，scrollspy 与点击定位都依赖。 */
  resolveElement: (key: string) => HTMLElement | null
}

/**
 * Workbench 极简原位变形大纲轨道（纯 UI 层）
 *
 * 特性：
 * 1. 100% 透明无边框容器，贴在编辑/预览区左边缘，零排版侵占；
 * 2. 静止态为左对齐精细横线，线长映射标题深度 (H1: 26px, H2: 18px, H3: 12px, H4+: 8px)；
 * 3. 鼠标 Hover 具体横线时，横线原位展开成胶囊呈现标题（无 portal、无多余蓝点）；
 * 4. 悬停只改变目录自身状态，正文与滚动位置保持不动；
 * 5. 滚动时 ScrollSpy 实时点亮当前阅读小节；
 * 6. 点击标题平滑滚动至对应锚点，并触发柔和聚焦高亮脉冲。
 *
 * 数据源由上层注入：Markdown 走 Lexical nodeKey，Word 走 docx-preview 段落索引。
 */
export default function WorkbenchTocRail({
  items,
  scrollContainerRef,
  resolveElement
}: Props): JSX.Element | null {
  const [activeKey, setActiveKey] = useState<string>('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const isHoveringContainerRef = useRef(false)

  // 卸载时清理脉冲计时器，避免泄漏
  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current)
      }
    }
  }, [])

  // ScrollSpy 滚动监听与当前阅读进度判定
  useEffect(() => {
    const container = scrollContainerRef?.current
    if (!container || items.length === 0) return

    let ticking = false
    const onScroll = (): void => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const scrollTop = container.scrollTop
        const containerRect = container.getBoundingClientRect()
        let currentKey = items[0]?.key || ''

        for (const item of items) {
          const dom = resolveElement(item.key)
          if (!dom) continue
          const domRect = dom.getBoundingClientRect()
          const relativeTop = container.scrollTop + (domRect.top - containerRect.top)
          // 视口上部 100px 黄金阅读感知线
          if (relativeTop - 100 <= scrollTop) {
            currentKey = item.key
          } else {
            break
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
  }, [items, scrollContainerRef, resolveElement])

  // 点击平滑定位到小节，并附加脉冲高亮
  const handleHeadingClick = useCallback(
    (key: string) => {
      const dom = resolveElement(key)
      const container = scrollContainerRef?.current
      if (!dom || !container) return

      const containerRect = container.getBoundingClientRect()
      const domRect = dom.getBoundingClientRect()
      const targetScrollTop = container.scrollTop + (domRect.top - containerRect.top) - 24
      container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' })

      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current)
      }
      dom.classList.add('workbench-heading-pulse')
      pulseTimerRef.current = window.setTimeout(() => {
        dom.classList.remove('workbench-heading-pulse')
        pulseTimerRef.current = null
      }, 1400)
    },
    [scrollContainerRef, resolveElement]
  )

  // 标题少于 2 个时不渲染，保持简洁不扰民
  if (items.length < 2) {
    return null
  }

  return (
    <aside
      className="absolute left-3.5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-start pointer-events-auto select-none bg-transparent border-0 shadow-none outline-none max-h-[75vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-2"
      aria-label="极简大纲导航"
      onMouseEnter={() => {
        isHoveringContainerRef.current = true
      }}
      onMouseLeave={() => {
        isHoveringContainerRef.current = false
        setHoveredIndex(null)
      }}
    >
      <div className="flex flex-col items-start w-auto">
        {items.map((item, idx) => {
          const isHovered = hoveredIndex === idx
          const isActive = activeKey === item.key
          const isAdjacentAbove = hoveredIndex !== null && idx === hoveredIndex - 1
          const isAdjacentBelow = hoveredIndex !== null && idx === hoveredIndex + 1
          const isOther = hoveredIndex !== null && !isHovered

          // 根据层级决定静止线宽 (H1: 26px, H2: 18px, H3: 12px, H4+: 8px)
          const lineWidth =
            item.level === 1 ? '26px' : item.level === 2 ? '18px' : item.level === 3 ? '12px' : '8px'

          return (
            <div
              key={item.key}
              onClick={() => handleHeadingClick(item.key)}
              onMouseEnter={() => setHoveredIndex(idx)}
              className={`relative flex items-center justify-start cursor-pointer transition-all duration-200 ease-out ${
                isHovered ? 'h-[26px] my-[3px]' : 'h-[20px] my-[1px]'
              } ${isAdjacentAbove ? '-translate-y-[2px] scale-[0.96]' : ''} ${
                isAdjacentBelow ? 'translate-y-[2px] scale-[0.96]' : ''
              } ${isOther ? 'opacity-35 scale-x-[0.92]' : 'opacity-100'}`}
              title={item.title}
            >
              <div
                className={`inline-flex items-center justify-start rounded-full transition-all duration-200 ease-out origin-left whitespace-nowrap ${
                  isHovered
                    ? 'bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05),0_1px_4px_rgba(0,0,0,0.02)] dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.4),0_2px_6px_-1px_rgba(0,0,0,0.2)] border border-black/[0.06] dark:border-white/10 py-1 px-2.5 scale-[1.02]'
                    : 'bg-transparent py-0 px-1'
                }`}
              >
                {/* 静止态：左对齐横线；Hover 展开态：线段自然隐退，原位呈现标题 */}
                {!isHovered && (
                  <span
                    className={`transition-all duration-200 ease-out shrink-0 rounded-full ${
                      isActive
                        ? 'bg-primary h-[3.5px] shadow-[0_0_6px_rgba(59,130,246,0.35)] dark:shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                        : 'bg-slate-300 dark:bg-slate-600 h-[2.5px]'
                    }`}
                    style={{ width: lineWidth }}
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
                  <span className="text-tiny font-mono px-1.5 py-0.2 rounded bg-blue-50 text-primary font-bold shrink-0 dark:bg-blue-950/60 dark:text-blue-300">
                    H{item.level}
                  </span>
                  <span className="text-xs font-medium text-text-primary dark:text-gray-100 truncate">
                    {item.title}
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
