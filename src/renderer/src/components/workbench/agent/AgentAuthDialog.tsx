import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Check, AlertCircle, Copy } from 'lucide-react'
import type { AgentAuthOperation } from '../../../types/agent'

interface AgentAuthDialogProps {
  operation: AgentAuthOperation | null
  onClose: () => void
  onSubmit: (operationId: string, value: string) => Promise<boolean>
  onCancel: (operationId: string) => Promise<boolean>
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
  onCancel
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

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden flex flex-col text-gray-800">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-caption text-text-secondary">供应商认证</div>
            <h3 className="font-semibold text-body text-gray-900 truncate">{operation.providerName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors shrink-0"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 flex items-center gap-2 text-label">
          <span className={`font-medium ${statusColor}`}>{STATUS_LABELS[operation.status]}</span>
          <span className="text-text-secondary">{operation.type === 'oauth' ? 'OAuth' : 'API Key'}</span>
          {isActive && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin ml-auto" />}
          {operation.status === 'success' && <Check className="w-3.5 h-3.5 text-emerald-600 ml-auto" />}
        </div>

        <div className="px-5 pb-3 max-h-56 overflow-y-auto space-y-2">
          {operation.events.length === 0 && operation.status === 'running' && (
            <div className="text-caption text-text-secondary">等待供应商响应…</div>
          )}
          {operation.events.map((event, index) => (
            <div
              key={`${event.type}:${index}`}
              className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2 text-label text-gray-700 space-y-1"
            >
              {event.message && <p className="leading-relaxed break-words">{event.message}</p>}
              {event.instructions && <p className="leading-relaxed text-text-secondary">{event.instructions}</p>}
              {event.type === 'auth_url' && event.url && (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline break-all"
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
                  <code className="px-1.5 py-0.5 rounded bg-white border border-gray-200 font-mono text-caption">
                    {event.userCode}
                  </code>
                  <button
                    type="button"
                    onClick={() => event.userCode && void handleCopyCode(event.userCode)}
                    className="text-text-secondary hover:text-primary"
                    title="复制验证码"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
              {event.links?.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-primary hover:underline break-all"
                >
                  {link.label || link.url}
                </a>
              ))}
            </div>
          ))}
          {operation.error && (
            <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-label text-rose-600">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{operation.error}</span>
            </div>
          )}
        </div>

        {operation.prompt && (
          <div className="px-5 pb-4 space-y-2">
            <label className="block text-label text-gray-700">{operation.prompt.message}</label>
            {operation.prompt.type === 'select' ? (
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-label text-gray-800 focus:outline-none focus:border-primary"
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
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white font-mono text-label text-gray-800 focus:outline-none focus:border-primary"
              />
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center justify-end gap-2">
          {isActive && (
            <button
              type="button"
              onClick={() => void onCancel(operation.id)}
              className="px-3.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-label font-medium transition-colors"
            >
              取消
            </button>
          )}
          {operation.prompt && (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded-lg bg-primary hover:opacity-90 disabled:opacity-50 text-white text-label font-medium transition-colors"
            >
              {submitting ? '提交中…' : '提交'}
            </button>
          )}
          {!isActive && !operation.prompt && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-primary hover:opacity-90 text-white text-label font-medium transition-colors"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
