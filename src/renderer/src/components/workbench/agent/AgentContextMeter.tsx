import { useState } from 'react'
import { Gauge, ChevronsToAxisHorizontal } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import { AgentPopover } from './AgentPopover'

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`
  }
  if (value >= 1000) {
    const thousands = value / 1000
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`
  }
  return String(Math.max(0, Math.round(value)))
}

export function AgentContextMeter(): JSX.Element | null {
  const status = useAgentSessionStore((s) => s.sessionStatus)
  const snapshot = useAgentSessionStore((s) => s.snapshot)
  const isCompacting = useAgentSessionStore((s) => s.isCompacting)
  const compact = useAgentSessionStore((s) => s.compact)
  const currentSessionId = useAgentSessionStore((s) => s.currentSessionId)
  const [open, setOpen] = useState(false)

  const stats = status ? status.stats : snapshot?.stats ?? null
  const cost = stats?.cost ?? 0
  const context = status ? status.context : snapshot?.context ?? null
  const compaction = status?.compaction ?? null
  const tokens = context?.tokens ?? null
  const percent = context?.percent ?? null
  const known = tokens !== null && percent !== null
  const percentRounded = known ? Math.round(percent) : null

  // 新会话未开始时不渲染
  if (known && tokens === 0 && (stats?.total ?? 0) === 0) return null
  if (!context || !context.contextWindow) return null

  const level =
    percentRounded !== null && percentRounded > 90
      ? 'high'
      : percentRounded !== null && percentRounded > 70
        ? 'medium'
        : 'low'

  const strokeColor =
    level === 'high'
      ? 'text-rose-500'
      : level === 'medium'
        ? 'text-amber-500'
        : 'text-primary'

  // 圆环周长计算 (半径 r = 7, 周长 C = 2 * PI * 7 ≈ 43.98)
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const clampedPercent = percentRounded !== null ? Math.min(100, Math.max(percentRounded > 0 ? 3 : 0, percentRounded)) : 0
  const dashOffset = circumference * (1 - clampedPercent / 100)

  const titleText = known
    ? `上下文占用 ${percentRounded}% (${formatTokens(tokens)} / ${formatTokens(context.contextWindow)})，点击查看详情`
    : '上下文占用将在下次模型响应后更新'

  return (
    <div className="relative inline-flex items-center">
      {/* 极简圆圈触发器：仅通过圆圈占比展示上下文占用，点击打开详情菜单 */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-200/60 transition-colors cursor-pointer group ${isCompacting ? 'animate-pulse' : ''}`}
        title={titleText}
      >
        <svg
          className={`w-4 h-4 transform -rotate-90 ${isCompacting ? 'animate-spin' : ''}`}
          viewBox="0 0 20 20"
        >
          {/* 背景底环 */}
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-slate-200"
          />
          {/* 进度环（占比代表上下文） */}
          {known && clampedPercent > 0 && (
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={`transition-all duration-300 ${strokeColor}`}
            />
          )}
        </svg>
      </button>

      {/* 点击后直接在圆圈上方弹出的详情菜单 */}
      <AgentPopover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-72 max-w-[calc(100vw-48px)]"
      >
        <div className="flex flex-col text-label w-full select-none bg-white">
          {/* 统一 Header */}
          <div className="px-3.5 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 text-caption">
              <Gauge className="w-3.5 h-3.5 text-primary" />
              <span>上下文与用量</span>
            </div>
            {known && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-tiny font-semibold ${
                  isCompacting
                    ? 'bg-violet-50 text-violet-600'
                    : percentRounded! > 90
                    ? 'bg-rose-50 text-rose-600'
                    : percentRounded! > 70
                    ? 'bg-amber-50 text-amber-600'
                    : 'bg-primary/10 text-primary'
                }`}
              >
                {isCompacting ? '压缩中…' : `${percentRounded}% 已用`}
              </span>
            )}
          </div>

          {/* Body 内容 */}
          <div className="p-3 space-y-3">
            {known ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-caption">
                  <span className="text-text-secondary">窗口占用</span>
                  <span className="font-mono text-slate-800 font-medium">
                    {formatTokens(tokens)} / {formatTokens(context.contextWindow)}
                  </span>
                </div>
                {/* 细进度条 */}
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      percentRounded! > 90 ? 'bg-rose-500' : percentRounded! > 70 ? 'bg-amber-500' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(1, percentRounded!))}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-text-secondary leading-relaxed text-caption py-1">
                上下文占用将在下次模型响应后更新
              </div>
            )}

            {compaction && (
              <div className="flex items-center justify-between text-caption text-slate-600">
                <span>上下文压缩</span>
                <button
                  type="button"
                  disabled={isCompacting || !currentSessionId}
                  onClick={() => void compact()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-tiny font-medium text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={isCompacting ? '压缩进行中' : '立即压缩上下文'}
                >
                  <ChevronsToAxisHorizontal className="w-3 h-3" />
                  {isCompacting ? '压缩中…' : '立即压缩'}
                </button>
              </div>
            )}

            {/* 累计数据与成本卡片 */}
            {stats && (
              <div className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-100/80 space-y-1.5 text-caption">
                <div className="flex items-center justify-between text-slate-600">
                  <span>累计输入</span>
                  <span className="font-mono text-slate-800">{formatTokens(stats.input)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>累计输出</span>
                  <span className="font-mono text-slate-800">{formatTokens(stats.output)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>缓存读 / 写</span>
                  <span className="font-mono text-slate-800">
                    {formatTokens(stats.cacheRead)} / {formatTokens(stats.cacheWrite)}
                  </span>
                </div>
                <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-slate-700 font-medium">
                  <span>预估成本</span>
                  <span className="font-mono text-slate-900 font-semibold">
                    {cost > 0 ? `$${cost.toFixed(4)}` : '未计费'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </AgentPopover>
    </div>
  )
}
