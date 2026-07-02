import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { defaultSelectors } from '../config/selectors'
import type { WebviewCardRef } from './WebviewCard'
import type { CandidateReport, ProbeReport } from '../utils/selectorDiagnostics'

interface SelectorDiagnosticsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type RowStatus = 'idle' | 'running' | 'ok' | 'partial' | 'failed' | 'unloaded' | 'error'

interface PlatformRow {
  status: RowStatus
  report?: ProbeReport
  error?: string
}

function statusBadge(status: RowStatus): { icon: string; text: string; cls: string } {
  switch (status) {
    case 'ok': return { icon: '✅', text: '全部命中', cls: 'text-green-600' }
    case 'partial': return { icon: '⚠️', text: '命中空元素', cls: 'text-yellow-600' }
    case 'failed': return { icon: '❌', text: '全失效', cls: 'text-red-600' }
    case 'unloaded': return { icon: '⚫', text: '未加载', cls: 'text-text-secondary' }
    case 'running': return { icon: '⏳', text: '诊断中', cls: 'text-blue-600' }
    case 'error': return { icon: '⚠️', text: '错误', cls: 'text-red-600' }
    default: return { icon: '⚪', text: '未诊断', cls: 'text-text-secondary' }
  }
}

function deriveStatus(report: ProbeReport): RowStatus {
  if (!report.ok) return 'error'
  const cands = report.candidates
  if (cands.length === 0) return 'failed'
  const anyVisible = cands.some(c => c.visibleHitCount > 0)
  const firstHasText = cands.some(c => c.firstHit && c.firstHit.visibleTextLen > 0)
  if (firstHasText) return 'ok'
  if (anyVisible) return 'partial'
  return 'failed'
}

function SelectorDiagnosticsPanel({ isOpen, onClose }: SelectorDiagnosticsPanelProps): JSX.Element | null {
  const webviewRefs = useAppStore((s) => s.webviewRefs)
  const [rows, setRows] = useState<Record<string, PlatformRow>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!isOpen) return null

  const platformIds = Object.keys(defaultSelectors.models)

  const diagnose = async (id: string): Promise<void> => {
    const ref: WebviewCardRef | undefined = webviewRefs.get(id)
    if (!ref) {
      setRows((prev) => ({ ...prev, [id]: { status: 'unloaded' } }))
      return
    }
    setRows((prev) => ({ ...prev, [id]: { status: 'running' } }))
    try {
      const report = await ref.probeMessageContainer()
      setRows((prev) => ({ ...prev, [id]: { status: deriveStatus(report), report } }))
    } catch (error) {
      setRows((prev) => ({ ...prev, [id]: { status: 'error', error: String(error) } }))
    }
  }

  const diagnoseAll = async (): Promise<void> => {
    await Promise.all(platformIds.map((id) => diagnose(id)))
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative ml-auto h-full w-[640px] max-w-[90vw] bg-bg-secondary shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">🔬 选择器诊断 (dev)</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={diagnoseAll}
              className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:opacity-90"
            >全部诊断</button>
            <button type="button" onClick={onClose} className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-5 py-3 space-y-1">
          {platformIds.map((id) => {
            const row = rows[id] ?? { status: 'idle' as RowStatus }
            const badge = statusBadge(row.status)
            const isExpanded = expanded === id
            return (
              <div key={id} className="border border-border rounded-lg">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="w-5 text-center">{badge.icon}</span>
                  <span className="flex-1 text-sm text-text-primary">{id}</span>
                  <span className={`text-xs ${badge.cls}`}>{badge.text}</span>
                  <button
                    type="button"
                    disabled={row.status === 'running'}
                    onClick={() => diagnose(id)}
                    className="px-2 py-1 text-xs rounded bg-white/60 hover:bg-white/80 text-text-primary disabled:opacity-40"
                  >诊断</button>
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : id)}
                    className="text-xs text-text-secondary hover:text-text-primary"
                  >{isExpanded ? '收起' : '展开'}</button>
                </div>
                {isExpanded && row.report && (
                  <CandidateTable report={row.report} />
                )}
                {isExpanded && row.error && (
                  <div className="px-3 py-2 text-xs text-red-600">{row.error}</div>
                )}
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-text-secondary">
          先在该平台窗口触发一次 AI 回复并等流式结束，再点诊断。报告仅含元素元数据与正文长度，不含正文内容。
        </div>
      </div>
    </div>
  )
}

function CandidateTable({ report }: { report: ProbeReport }): JSX.Element {
  const copy = (text: string): void => {
    navigator.clipboard?.writeText(text).catch(() => {})
  }
  return (
    <div className="px-3 pb-2 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-text-secondary text-left">
            <th className="py-1 pr-2">选择器</th>
            <th className="py-1 pr-2">命中</th>
            <th className="py-1 pr-2">可见</th>
            <th className="py-1 pr-2">正文长</th>
            <th className="py-1">元素指纹</th>
          </tr>
        </thead>
        <tbody>
          {report.candidates.map((c: CandidateReport, i: number) => (
            <tr key={i} className="border-t border-border/50">
              <td className="py-1 pr-2 font-mono break-all max-w-[200px]">
                <button type="button" onClick={() => copy(c.selector)} className="hover:text-primary text-left" title="点击复制">
                  {c.selector}
                </button>
              </td>
              <td className="py-1 pr-2">{c.hitCount}</td>
              <td className="py-1 pr-2">{c.visibleHitCount}</td>
              <td className="py-1 pr-2">{c.firstHit?.visibleTextLen ?? 0}</td>
              <td className="py-1 font-mono text-text-secondary break-all max-w-[200px]">
                {c.firstHit ? `${c.firstHit.tag}.${c.firstHit.className ?? ''}${c.firstHit.id ? '#' + c.firstHit.id : ''}${c.firstHit.dataTestid ? ' [data-testid=' + c.firstHit.dataTestid + ']' : ''}` : (c.error ?? '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default SelectorDiagnosticsPanel
