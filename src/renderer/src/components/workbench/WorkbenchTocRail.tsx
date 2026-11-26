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
 * 原位变形大纲轨道：透明贴左缘、静止为深度横线、hover 原位展开标题；
 * scrollspy 与点击定位依赖上层注入的 key → DOM 映射。
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

  // ScrollSpy 滚动监听与当前阅读进度判定（有序标题二分查找 O(log H)）
  useEffect(() => {
    const container = scrollContainerRef?.current
    if (!container || items.length === 0) return

    let rafId = 0
    const updateActive = (): void => {
      rafId = 0
      const scrollTop = container.scrollTop
      const containerRect = container.getBoundingClientRect()
      // 视口上部 100px 黄金阅读感知线
      const threshold = scrollTop + 100

      let lo = 0
      let hi = items.length - 1
      let bestIdx = 0

      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        let probe = mid
        let dom = resolveElement(items[probe].key)
        if (!dom) {
          // 偶发缺失 DOM 时向两侧邻近位置探测，确保仍严格收敛
          let offset = 1
          while (mid + offset <= hi || mid - offset >= lo) {
            if (mid + offset <= hi) {
              const rightDom = resolveElement(items[mid + offset].key)
              if (rightDom) {
                probe = mid + offset
                dom = rightDom
                break
              }
            }
            if (mid - offset >= lo) {
              const leftDom = resolveElement(items[mid - offset].key)
              if (leftDom) {
                probe = mid - offset
                dom = leftDom
                break
              }
            }
            offset += 1
          }
          if (!dom) break
        }

        const domRect = dom.getBoundingClientRect()
        const relativeTop = scrollTop + (domRect.top - containerRect.top)
        if (relativeTop <= threshold) {
          bestIdx = probe
          lo = probe + 1
        } else {
          hi = probe - 1
        }
      }

      const currentKey = items[bestIdx]?.key || ''
      setActiveKey(currentKey)
    }

    const onScroll = (): void => {
      if (rafId) return
      rafId = requestAnimationFrame(updateActive)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    updateActive()

    return () => {
      container.removeEventListener('scroll', onScroll)
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
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
                  <span className="text-tiny font-mono px-1.5 py-0.5 rounded bg-blue-50 text-primary font-bold shrink-0 dark:bg-blue-950/60 dark:text-blue-300">
                    H{item.level}
                  </span>
                  <span className="text-label font-medium text-text-primary dark:text-gray-100 truncate">
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
