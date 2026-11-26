import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSkillInstallCommand } from '../utils/cliGuide'
import { useAppStore } from '../store/appStore'
import type { CliIntegrationStatus } from '../../../shared/types/cli'
import { AppIcon } from './icons/AppIcon'

type HintSlideId = 'workbench' | 'skill'

const CAROUSEL_INTERVAL_MS = 5500

const SLIDE_META: Record<
  HintSlideId,
  { icon: 'view_column_2' | 'terminal'; title: string; description: string; dotLabel: string }
> = {
  workbench: {
    icon: 'view_column_2',
    title: '全新「工作台」模式已上线',
    description: '本地 Markdown 知识库与 AI 侧栏深度协同，支持双模编辑、划词直问与拖拽传文件。',
    dotLabel: '工作台引导'
  },
  skill: {
    icon: 'terminal',
    title: '命令行工具 multichat 已就绪',
    description: '让 AI Agent 通过 multichat 调用本应用：把安装命令交给 Agent 执行，或手动复制 Skill 目录。',
    dotLabel: 'Skill 安装引导'
  }
}

/**
 * 安装引导卡片：复用原 Skill 引导浮层（右下角 340px 固定高度），
 * 在安装或版本更新后首次打开首页时展示，支持工作台引导与 Agent Skill 安装引导自动轮播；
 * 鼠标悬停或焦点进入时冻结进度并暂停轮播。
 */
export default function CliAgentHint(): JSX.Element | null {
  const [status, setStatus] = useState<CliIntegrationStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [copied, setCopied] = useState(false)

  const currentPage = useAppStore((s) => s.currentPage)
  const productMode = useAppStore((s) => s.productMode)
  const setProductMode = useAppStore((s) => s.setProductMode)
  const hiddenModes = useAppStore((s) => s.productModeConfig.hidden)

  const cardRef = useRef<HTMLDivElement | null>(null)
  const fillRefs = useRef<Record<string, HTMLSpanElement | null>>({})
  const isHoveringRef = useRef(false)
  const manualLockedRef = useRef(false)
  const elapsedRef = useRef(0)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.api.cliGetStatus().then((res) => {
      if (res.success && res.data) {
        setStatus(res.data)
      }
    })
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const slides = useMemo<HintSlideId[]>(() => {
    if (!status || !status.isPackaged || status.hintDismissed || dismissed) return []
    const list: HintSlideId[] = []
    if (!hiddenModes.includes('workbench') && productMode !== 'workbench') {
      list.push('workbench')
    }
    const skillUsable = status.platform === 'darwin' ? Boolean(status.cliCmdPath) : status.onPath
    if (skillUsable && status.skillDir) {
      list.push('skill')
    }
    return list
  }, [status, dismissed, hiddenModes, productMode])

  const safeIndex = slides.length > 0 ? Math.min(activeIndex, slides.length - 1) : 0
  const currentSlide = slides[safeIndex] ?? null
  const isMainPage = currentPage === 'main'
  const shouldRender = isMainPage && currentSlide !== null

  useEffect(() => {
    if (activeIndex !== safeIndex) {
      setActiveIndex(safeIndex)
      elapsedRef.current = 0
    }
  }, [activeIndex, safeIndex])

  // 自动轮播主循环：直接更新进度胶囊宽度，避免 60fps 触发 React 重渲染；Hover/Focus 时冻结在当前进度
  useEffect(() => {
    if (!shouldRender || slides.length <= 1) return

    let rafId = 0
    let lastTick = performance.now()

    const tick = (now: number): void => {
      const dt = Math.min(now - lastTick, 100)
      lastTick = now

      if (!isHoveringRef.current && !manualLockedRef.current) {
        elapsedRef.current += dt
        if (elapsedRef.current >= CAROUSEL_INTERVAL_MS) {
          elapsedRef.current = 0
          setActiveIndex((prev) => (prev + 1) % slides.length)
        }
      }

      const activeId = slides[safeIndex]
      const activeFill = activeId ? fillRefs.current[activeId] : null
      if (activeFill) {
        const pct = Math.min(100, (elapsedRef.current / CAROUSEL_INTERVAL_MS) * 100)
        activeFill.style.width = `${pct}%`
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [shouldRender, slides, safeIndex])

  const dismiss = useCallback((): void => {
    setDismissed(true)
    void window.api.cliDismissHint()
  }, [])

  const handleTryWorkbench = (): void => {
    setProductMode('workbench')
    dismiss()
  }

  const handleCopy = async (): Promise<void> => {
    if (!status?.skillDir) return
    manualLockedRef.current = true
    await navigator.clipboard.writeText(buildSkillInstallCommand(status.skillDir))
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenSkillDir = (): void => {
    manualLockedRef.current = true
    void window.api.cliOpenLocation('skill')
  }

  const handleSelectSlide = (index: number): void => {
    elapsedRef.current = 0
    setActiveIndex(index)
  }

  if (!shouldRender || !currentSlide || !status) return null

  const currentMeta = SLIDE_META[currentSlide]

  return (
    <div
      ref={cardRef}
      role="region"
      aria-label="版本功能引导"
      onMouseEnter={() => { isHoveringRef.current = true }}
      onMouseLeave={() => { isHoveringRef.current = false }}
      onFocusCapture={() => { isHoveringRef.current = true }}
      onBlurCapture={(e) => {
        if (!cardRef.current?.contains(e.relatedTarget as Node | null)) {
          isHoveringRef.current = false
        }
      }}
      className="fixed right-4 bottom-4 z-[90] w-[340px] glass-panel-heavy rounded-2xl shadow-float p-4"
    >
      <div className="flex items-start gap-3">
        <AppIcon name={currentMeta.icon} size={20} className="text-primary shrink-0 mt-0.5 transition-opacity duration-200" />

        <div className="flex-1 min-w-0">
          {/* 等高叠放：容器高度取所有幻灯片最大值，轮播切换不跳动且不增加弹窗高度 */}
          <div className="grid">
            {slides.map((slideId, idx) => {
              const active = slideId === currentSlide
              const meta = SLIDE_META[slideId]
              return (
                <div
                  key={slideId}
                  aria-hidden={!active}
                  className={`col-start-1 row-start-1 flex flex-col justify-between transition-all duration-200 ease-out ${
                    active ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-1.5 pointer-events-none'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-body font-semibold text-text-primary truncate">{meta.title}</div>
                      {idx === safeIndex && (
                        <button
                          type="button"
                          onClick={dismiss}
                          className="-mt-0.5 -mr-1 shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          aria-label="关闭"
                        >
                          <AppIcon name="close" size={16} />
                        </button>
                      )}
                    </div>
                    <div className="text-label text-text-secondary mt-1 leading-relaxed">
                      {meta.description}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {slideId === 'workbench' ? (
                        <button
                          type="button"
                          tabIndex={active ? 0 : -1}
                          onClick={handleTryWorkbench}
                          className="whitespace-nowrap px-3 py-1.5 text-label rounded-full bg-primary text-white hover:opacity-90 transition-all font-medium"
                        >
                          立即体验
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            tabIndex={active ? 0 : -1}
                            onClick={() => { void handleCopy() }}
                            className="whitespace-nowrap px-3 py-1.5 text-label rounded-full bg-primary text-white hover:opacity-90 transition-all font-medium"
                          >
                            {copied ? '已复制' : '复制安装命令'}
                          </button>
                          <button
                            type="button"
                            tabIndex={active ? 0 : -1}
                            onClick={handleOpenSkillDir}
                            className="whitespace-nowrap px-3 py-1.5 text-label rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 dark:hover:bg-white/10 transition-all font-medium"
                          >
                            打开 Skill 目录
                          </button>
                        </>
                      )}
                    </div>

                    {slides.length > 1 && idx === safeIndex && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {slides.map((dotId, dotIdx) => {
                          const isDotActive = dotIdx === safeIndex
                          return (
                            <button
                              key={dotId}
                              type="button"
                              aria-label={SLIDE_META[dotId].dotLabel}
                              title={SLIDE_META[dotId].dotLabel}
                              onClick={() => handleSelectSlide(dotIdx)}
                              className="py-1 focus:outline-none group"
                            >
                              <span
                                className={`block relative h-1 rounded-full overflow-hidden transition-all duration-300 bg-slate-300/80 dark:bg-white/20 ${
                                  isDotActive ? 'w-5' : 'w-1.5 group-hover:bg-slate-400/80'
                                }`}
                              >
                                <span
                                  ref={(el) => {
                                    fillRefs.current[dotId] = el
                                    if (el && !isDotActive) el.style.width = '0%'
                                  }}
                                  className="block absolute inset-y-0 left-0 rounded-full bg-primary"
                                  style={{ width: '0%' }}
                                />
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
