import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '../../icons/AppIcon'
import type { AgentAuthOperation } from '../../../types/agent'

interface AgentAuthDialogProps {
  operation: AgentAuthOperation | null
  onClose: () => void
  onSubmit: (operationId: string, value: string) => Promise<boolean>
  onCancel: (operationId: string) => Promise<boolean>
  inline?: boolean
}

const STATUS_LABELS: Record<AgentAuthOperation['status'], string> = {
  running: '处理中',
  waiting: '等待输入',
  success: '已完成',
  error: '失败',
  cancelled: '已取消'
}

export function AgentAuthDialog({
  operation,
  onClose,
  onSubmit,
  onCancel,
  inline = false
}: AgentAuthDialogProps): JSX.Element | null {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setValue('')
    setCopied(false)
  }, [operation?.id, operation?.prompt?.id])

  if (!operation) return null

  const isActive = operation.status === 'running' || operation.status === 'waiting'
  const canSubmit = Boolean(operation.prompt) && value.trim().length > 0 && !submitting

  const handleSubmit = async (): Promise<void> => {
    if (!operation.prompt || !canSubmit) return
    setSubmitting(true)
    await onSubmit(operation.id, value)
    setSubmitting(false)
  }

  const handleCopyCode = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const statusColor =
    operation.status === 'error'
      ? 'text-rose-600'
      : operation.status === 'success'
        ? 'text-emerald-600'
        : 'text-primary'

  const panel = (
    <div
      className={
        inline
          ? 'mt-2 flex flex-col overflow-hidden rounded-lg border border-primary/25 bg-white/80 text-text-primary dark:border-white/15 dark:bg-white/5'
          : 'flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-text-primary shadow-2xl dark:border-white/15 dark:bg-slate-900'
      }
    >
      <div className="flex items-start justify-between gap-3 border-b border-black/[0.05] px-4 py-3 dark:border-white/10">
        <div className="min-w-0">
          <div className="text-caption text-text-secondary">供应商认证</div>
          <h3 className="truncate text-body font-semibold text-text-primary">{operation.providerName}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
          title="关闭"
        >
          <AppIcon name="close" size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 text-label">
        <span className={`font-medium ${statusColor}`}>{STATUS_LABELS[operation.status]}</span>
        <span className="text-text-secondary">{operation.type === 'oauth' ? 'OAuth' : 'API Key'}</span>
        {isActive && <AppIcon name="progress_activity" size={15} className="ml-auto animate-spin text-primary" />}
        {operation.status === 'success' && <AppIcon name="check" size={15} className="ml-auto text-emerald-600" />}
      </div>

      <div className="max-h-56 space-y-2 overflow-y-auto px-4 pb-3">
        {operation.events.length === 0 && operation.status === 'running' && (
          <div className="text-caption text-text-secondary">等待供应商响应…</div>
        )}
        {operation.events.map((event, index) => (
          <div
            key={`${event.type}:${index}`}
            className="space-y-1 rounded-lg border border-white/70 bg-white/60 px-3 py-2 text-label text-text-primary dark:border-white/10 dark:bg-white/5"
          >
            {event.message && <p className="break-words leading-relaxed">{event.message}</p>}
            {event.instructions && <p className="leading-relaxed text-text-secondary">{event.instructions}</p>}
            {event.type === 'auth_url' && event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noreferrer"
                className="break-all text-primary hover:underline"
              >
                打开授权页面
              </a>
            )}
            {event.type === 'device_code' && (
              <div className="flex items-center gap-2">
                <a
                  href={event.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  打开验证页面
                </a>
                <code className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-caption dark:border-slate-700/80 dark:bg-slate-800/70">
                  {event.userCode}
                </code>
                <button
                  type="button"
                  onClick={() => event.userCode && void handleCopyCode(event.userCode)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/10"
                  title="复制验证码"
                >
                  {copied ? <AppIcon name="check" size={14} className="text-emerald-600" /> : <AppIcon name="content_copy" size={14} />}
                </button>
              </div>
            )}
            {event.links?.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-primary hover:underline"
              >
                {link.label || link.url}
              </a>
            ))}
          </div>
        ))}
        {operation.error && (
          <div className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-label text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <AppIcon name="error" size={15} className="mt-0.5 shrink-0" />
            <span className="break-words">{operation.error}</span>
          </div>
        )}
      </div>

      {operation.prompt && (
        <div className="space-y-2 px-4 pb-3">
          <label className="block text-label font-medium text-text-primary">{operation.prompt.message}</label>
          {operation.prompt.type === 'select' ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-body text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus:bg-slate-800"
            >
              <option value="">请选择</option>
              {operation.prompt.options?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={operation.prompt.type === 'secret' ? 'password' : 'text'}
              value={value}
              autoComplete="off"
              placeholder={operation.prompt.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit()
              }}
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3 font-mono text-body text-text-primary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus:bg-slate-800"
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-black/[0.05] px-4 py-2.5 dark:border-white/10">
        {isActive && (
          <button
            type="button"
            onClick={() => void onCancel(operation.id)}
            className="h-8 rounded-lg border border-gray-200 bg-sidebar px-3.5 text-label font-medium text-text-secondary transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            取消
          </button>
        )}
        {operation.prompt && (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="h-8 rounded-lg bg-primary px-4 text-label font-medium text-white shadow-soft transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交'}
          </button>
        )}
        {!isActive && !operation.prompt && (
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg bg-primary px-4 text-label font-medium text-white shadow-soft transition-opacity hover:opacity-90"
          >
            完成
          </button>
        )}
      </div>
    </div>
  )

  if (inline) {
    return panel
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      {panel}
    </div>,
    document.body
  )
}
