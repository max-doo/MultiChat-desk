import { useState } from 'react'
import { AppIcon } from '../../icons/AppIcon'
import type { AgentApprovalRequest } from '../../../types/agent'
import { useAgentSessionStore } from '../../../store/agentSessionStore'

interface ApprovalCardProps {
  request: AgentApprovalRequest
}

export function ApprovalCard({ request }: ApprovalCardProps): JSX.Element {
  const resolveApproval = useAgentSessionStore((s) => s.resolveApproval)
  const [showPatternInput, setShowPatternInput] = useState(false)
  const [pattern, setPattern] = useState(() => {
    if (typeof request.args === 'string') {
      const firstWord = request.args.trim().split(/\s+/)[0]
      return firstWord ? `${firstWord} *` : '*'
    }
    if (request.args && typeof request.args === 'object') {
      const obj = request.args as Record<string, unknown>
      if (typeof obj.command === 'string') {
        const firstWord = obj.command.trim().split(/\s+/)[0]
        return firstWord ? `${firstWord} *` : '*'
      }
      if (typeof obj.path === 'string') {
        return '**'
      }
    }
    return '*'
  })

  const commandOrDetail = (() => {
    if (typeof request.args === 'string') return request.args
    if (request.args && typeof request.args === 'object') {
      const obj = request.args as Record<string, unknown>
      if (typeof obj.command === 'string') return obj.command
      if (typeof obj.path === 'string') return `文件: ${obj.path}`
      return JSON.stringify(request.args)
    }
    return ''
  })()

  return (
    <div className="my-2 p-3 rounded-xl border border-amber-300/80 bg-amber-50/70 text-text-primary shadow-sm text-label select-none dark:border-amber-500/30 dark:bg-amber-950/30">
      <div className="flex items-start gap-2.5">
        <div className="p-1 rounded-md bg-amber-200/80 text-amber-800 shrink-0 mt-0.5 dark:bg-amber-500/20 dark:text-amber-300">
          <AppIcon name="shield_alert" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-text-primary">
              权限确认
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-normal text-tiny dark:bg-amber-500/20 dark:text-amber-300">
                {request.toolName}
              </span>
            </span>
          </div>

          <div className="text-caption text-text-secondary mt-1 leading-relaxed">
            {request.reason || '受限模式下需要确认方可执行该操作'}
          </div>

          {commandOrDetail && (
            <div className="mt-2 p-2 rounded bg-white/90 border border-amber-200/60 font-mono text-caption text-text-primary break-all select-text dark:bg-gray-900/70 dark:border-amber-500/20">
              {commandOrDetail}
            </div>
          )}

          <div className="mt-3 flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolveApproval(request.requestId, 'allow')}
              className="px-3 py-1.5 rounded-lg bg-primary hover:opacity-90 text-white font-medium flex items-center gap-1.5 shadow-sm transition-colors text-label"
            >
              <AppIcon name="check" size={14} />
              <span>允许</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPatternInput(!showPatternInput)}
              className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-text-primary border border-slate-200 font-medium flex items-center gap-1 transition-colors text-label dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10"
              title="配置并总是允许该模式"
            >
              <AppIcon name="verified_user" size={14} className="text-primary" />
              <span>总是允许</span>
              <AppIcon
                name="expand_more"
                size={12}
                className={`text-text-secondary transition-transform ${showPatternInput ? 'rotate-180' : ''}`}
              />
            </button>

            <button
              type="button"
              onClick={() => resolveApproval(request.requestId, 'deny')}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-red-50 text-red-600 border border-red-200 font-medium flex items-center gap-1.5 transition-colors text-label ml-auto dark:bg-white/5 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/15"
            >
              <AppIcon name="close" size={14} />
              <span>拒绝</span>
            </button>
          </div>

          {showPatternInput && (
            <div className="mt-2.5 pt-2 border-t border-amber-200/80 dark:border-amber-500/20 flex items-center gap-2">
              <span className="text-text-secondary text-caption shrink-0">模式匹配:</span>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="flex-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-label font-mono text-text-primary outline-none focus:border-primary dark:border-white/15 dark:bg-gray-900"
                placeholder="例如: npm * 或 **"
              />
              <button
                type="button"
                onClick={() => resolveApproval(request.requestId, 'always', pattern)}
                className="px-3 py-1 rounded-lg bg-primary hover:opacity-90 text-white text-label font-medium shrink-0 shadow-sm"
              >
                确认放行
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
