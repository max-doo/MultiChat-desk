import type { AgentProviderQuota, AgentQuotaWindow } from '../../../types/agent'
import { AppIcon } from '../../icons/AppIcon'

function formatResetTime(ts?: number): string | null {
  if (!ts || !Number.isFinite(ts)) return null
  const diffMs = ts - Date.now()
  if (diffMs <= 0) return '即将重置'
  const totalMins = Math.ceil(diffMs / 60_000)
  if (totalMins < 60) return `${totalMins} 分钟后重置`
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours < 24) return mins > 0 ? `${hours} 小时 ${mins} 分后重置` : `${hours} 小时后重置`
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hh}:${mm} 重置`
}

function progressToneClass(usedPercent: number): string {
  if (usedPercent >= 90) return 'bg-rose-500'
  if (usedPercent >= 70) return 'bg-amber-500'
  return 'bg-primary'
}

function QuotaWindowRow({ win }: { win: AgentQuotaWindow }): JSX.Element {
  const used = typeof win.usedPercent === 'number' ? Math.max(0, Math.min(100, win.usedPercent)) : null
  const remaining =
    typeof win.remainingPercent === 'number'
      ? Math.max(0, Math.min(100, win.remainingPercent))
      : used !== null
        ? Math.max(0, Math.min(100, 100 - used))
        : null
  const resetText = formatResetTime(win.resetsAt)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-caption">
        <span className="truncate font-medium text-text-primary">{win.name}</span>
        <div className="flex shrink-0 items-center gap-2 text-text-secondary">
          {win.unlimited ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">无限</span>
          ) : win.text ? (
            <span>{win.text}</span>
          ) : (
            <>
              {win.limit !== undefined && win.amount !== undefined && (
                <span className="font-mono">
                  {win.amount.toFixed(win.unit === 'USD' ? 2 : 0)}/{win.limit.toFixed(win.unit === 'USD' ? 2 : 0)}
                  {win.unit ? ` ${win.unit}` : ''}
                </span>
              )}
              {remaining !== null && (
                <span className="font-mono font-medium text-text-primary">
                  余 {Math.round(remaining)}%
                </span>
              )}
            </>
          )}
          {resetText && <span className="text-text-secondary/80">{resetText}</span>}
        </div>
      </div>
      {used !== null && !win.unlimited && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-300 ${progressToneClass(used)}`}
            style={{ width: `${used}%` }}
          />
        </div>
      )}
    </div>
  )
}

interface AgentProviderQuotaBarProps {
  quota?: AgentProviderQuota
  loading?: boolean
  onRefresh?: () => void
  compact?: boolean
}

export function AgentProviderQuotaBar({
  quota,
  loading = false,
  onRefresh,
  compact = false
}: AgentProviderQuotaBarProps): JSX.Element | null {
  if (!quota && !loading) return null
  if (
    quota &&
    !quota.error &&
    !quota.balanceText &&
    quota.windows.length === 0 &&
    !quota.plan
  ) {
    return null
  }

  const hasDetails =
    Boolean(quota?.windows.length) ||
    Boolean(quota?.error)

  return (
    <div className="mt-2 rounded-lg border border-black/[0.05] bg-white/55 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption">
          {quota?.plan && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-tiny font-medium text-primary">
              {quota.plan}
            </span>
          )}
          {quota?.account && (
            <span className="max-w-[180px] truncate text-text-secondary" title={quota.account}>
              {quota.account}
            </span>
          )}
          {quota?.balanceText && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-caption font-medium text-emerald-700 dark:text-emerald-300">
              余额 {quota.balanceText}
            </span>
          )}
          {quota?.stale && (
            <span className="text-tiny text-amber-600 dark:text-amber-400">缓存数据</span>
          )}
          {!quota && loading && (
            <span className="text-text-secondary">正在查询额度…</span>
          )}
          {quota?.sourceLabel && !quota.balanceText && quota.windows.length === 0 && !quota.error && (
            <span className="text-text-secondary">{quota.sourceLabel}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="刷新额度"
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-primary disabled:opacity-40 dark:hover:bg-white/10"
            >
              <AppIcon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>

      {hasDetails && quota && !compact && (
        <div className="mt-2 space-y-2">
          {quota.windows.map((win) => (
            <QuotaWindowRow key={win.id} win={win} />
          ))}

          {quota.error && (
            <div className="text-caption text-amber-700 dark:text-amber-300">
              {quota.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
