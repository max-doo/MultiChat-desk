import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppIcon } from '../../icons/AppIcon'

interface WorkPhaseBlockProps {
  isRunning: boolean
  /** 工作段总耗时（毫秒）；仅完成态展示 */
  durationMs?: number
  /** 进行中的当前动作描述（如"正在读取 xxx.md"）；为空时回落到"思考中" */
  activity?: string
  /** 折叠区内的 reasoning / tool-group 内容 */
  children: ReactNode
}

function formatSeconds(ms: number): string {
  const totalSecs = Math.round(ms / 1000)
  if (totalSecs < 60) {
    return `${totalSecs}s`
  }
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`
}

/**
 * 工作过程折叠块：
 * - 进行中：标题"思考中"（text-shimmer 高光扫过），默认展开看过程
 * - 完成后：标题"已完成 Xs"，自动收起
 * 覆盖一轮内 final answer 之前的所有 reasoning 与工具调用。
 */
export function WorkPhaseBlock({
  isRunning,
  durationMs,
  activity,
  children
}: WorkPhaseBlockProps): JSX.Element {
  // running 默认收起：进度由标题 shimmer + 动态动作表达，不打扰阅读；
  // 完成后也保持收起。用户手动展开后记住选择，状态变化不再抢。
  const [expanded, setExpanded] = useState(false)
  const userToggled = useRef(false)

  useEffect(() => {
    // 用户没手动点过时，状态切换保持收起；手动展开过就尊重用户选择。
    if (!userToggled.current) setExpanded(false)
  }, [isRunning])

  const handleToggle = (): void => {
    userToggled.current = true
    setExpanded((v) => !v)
  }

  return (
    <div className="my-1 select-none">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-1.5 py-1 px-1 rounded-md hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors text-left cursor-pointer group"
      >
        <span
          className={`min-w-0 flex-1 truncate text-body font-medium ${
            isRunning ? 'text-shimmer' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {isRunning
            ? activity || '思考中'
            : `已完成${durationMs !== undefined ? ` ${formatSeconds(durationMs)}` : ''}`}
        </span>
        <AppIcon
          name="expand_more"
          size={14}
          className={`text-slate-400 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="mt-0.5 pl-2 border-l-2 border-slate-200/70 dark:border-white/10 space-y-0.5 py-0.5">
          {children}
        </div>
      )}
    </div>
  )
}
