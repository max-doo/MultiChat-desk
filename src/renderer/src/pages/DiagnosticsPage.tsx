import { useEffect, useRef, useState } from 'react'
import { defaultSelectors } from '../config/selectors'
import type { CandidateReport, DomProbeReport, NodeFingerprint, ProbeReport, ResearchProbeReport, StepReport, TreeNode } from '../utils/selectorDiagnostics'

function DiagnosticsPage(): JSX.Element {
  const [tab, setTab] = useState<'message' | 'research' | 'dom'>('message')
  const platformIds = Object.keys(defaultSelectors.models)
  const [selectedId, setSelectedId] = useState<string>(platformIds[0] ?? '')
  const [pinned, setPinned] = useState(true) // 窗口默认 alwaysOnTop:true 打开
  const isDraggingRef = useRef(false)

  // 复用主窗口的无边框拖拽范式：pointer capture + windowDrag* IPC
  useEffect(() => {
    const onMove = (): void => {
      if (isDraggingRef.current) window.api.windowDragMove()
    }
    const onUp = (): void => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        window.api.windowDragEnd()
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const togglePin = async (): Promise<void> => {
    const next = !pinned
    const res = await window.api.setWindowAlwaysOnTop(next)
    setPinned(res.success && res.data === true)
  }

  return (
    <div className="w-full h-full flex flex-col bg-bg-secondary">
      {/* 自定义标题栏：拖拽 + 置顶 + 关闭 */}
      <div
        className="relative h-9 w-full shrink-0 grid items-center px-2 drag-region select-none border-b border-border"
        style={{ gridTemplateColumns: '1fr auto' }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('.no-drag')) return
          if (target.closest('.drag-region') || target === e.currentTarget) {
            isDraggingRef.current = true
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            window.api.windowDragStart()
          }
        }}
      >
        <div className="flex items-center gap-2 drag-region h-full min-w-0">
          <span className="material-symbols-outlined text-base text-text-secondary">science</span>
          <span className="text-xs text-text-secondary truncate">选择器诊断</span>
        </div>
        <div className="flex items-center gap-1 no-drag">
          <button
            type="button"
            onClick={() => { void togglePin() }}
            className={`w-6 h-6 flex items-center justify-center rounded-full transition-all ${pinned ? 'text-primary bg-blue-50/80' : 'text-text-secondary hover:text-text-primary hover:bg-white/60'}`}
            title={pinned ? '取消置顶' : '置顶于主窗口之上'}
          >
            <span className="material-symbols-outlined text-base">{pinned ? 'push_pin' : 'pin_drop'}</span>
          </button>
          <button
            type="button"
            onClick={() => window.api.closeWindow()}
            className="w-6 h-6 flex items-center justify-center rounded-full text-text-secondary hover:text-red-600 hover:bg-red-50 transition-all"
            title="关闭"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </div>
      <div className="flex border-b border-border">
        <TabButton active={tab === 'message'} onClick={() => setTab('message')} label="消息容器 (messageContainer)" />
        <TabButton active={tab === 'research'} onClick={() => setTab('research')} label="深度研究 (researchMode)" />
        <TabButton active={tab === 'dom'} onClick={() => setTab('dom')} label="DOM 探测 (检拾)" />
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-48 border-r border-border overflow-auto">
          {platformIds.map((id) => (
            <button key={id} type="button" onClick={() => setSelectedId(id)}
              className={`w-full text-left px-3 py-2 text-sm ${selectedId === id ? 'bg-white/60 text-primary' : 'text-text-primary hover:bg-white/40'}`}>
              {id}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto p-4">
          {tab === 'message'
            ? <MessageTab modelId={selectedId} />
            : tab === 'research'
              ? <ResearchTab modelId={selectedId} />
              : <DomTab modelId={selectedId} />}
        </div>
      </div>
      <div className="px-4 py-2 border-t border-border text-xs text-text-secondary">
        dev-only 诊断。先在主窗口对应平台触发一次回复再诊断。报告仅含元素指纹+正文长度，不含正文。
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 ${active ? 'border-primary text-primary' : 'border-transparent text-text-secondary'}`}>
      {label}
    </button>
  )
}

function MessageTab({ modelId }: { modelId: string }): JSX.Element {
  const [report, setReport] = useState<ProbeReport | null>(null)
  const [running, setRunning] = useState(false)
  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      const res = await window.api.diagnosticsProbe(modelId, 'message')
      setReport(res.success && res.data ? res.data as ProbeReport : { ok: false, candidates: [], error: res.error })
    } finally { setRunning(false) }
  }
  return (
    <div>
      <button type="button" onClick={run} disabled={running || !modelId}
        className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white disabled:opacity-40 mb-3">
        {running ? '诊断中...' : '诊断 messageContainer'}
      </button>
      {report && <MessageReportView report={report} />}
    </div>
  )
}

function MessageReportView({ report }: { report: ProbeReport }): JSX.Element {
  if (!report.ok) return <div className="text-red-600 text-sm">{report.error ?? '探针失败'}</div>
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-text-secondary text-left">
        <th className="py-1 pr-2">选择器</th><th className="py-1 pr-2">命中</th>
        <th className="py-1 pr-2">可见</th><th className="py-1 pr-2">正文长</th><th className="py-1">元素指纹</th>
      </tr></thead>
      <tbody>
        {report.candidates.map((c: CandidateReport, i: number) => (
          <tr key={i} className="border-t border-border/50">
            <td className="py-1 pr-2 font-mono break-all max-w-[200px]">{c.selector}</td>
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
  )
}

function ResearchTab({ modelId }: { modelId: string }): JSX.Element {
  const [report, setReport] = useState<ResearchProbeReport | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)
  const probe = async (): Promise<void> => {
    setRunning(true); setRunResult(null)
    try {
      const res = await window.api.diagnosticsProbe(modelId, 'research')
      setReport(res.success && res.data ? res.data as ResearchProbeReport : { ok: false, steps: [], error: res.error })
    } finally { setRunning(false) }
  }
  const runReal = async (): Promise<void> => {
    setRunResult('执行中...')
    const res = await window.api.diagnosticsRunResearch(modelId)
    setRunResult(res.success && res.data ? (res.data.success ? '✅ 开启成功' : `❌ ${res.data.error}`) : `❌ ${res.error}`)
  }
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button type="button" onClick={probe} disabled={running || !modelId}
          className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white disabled:opacity-40">
          {running ? '探测中...' : '只读探测 steps'}
        </button>
        <button type="button" onClick={runReal} disabled={!modelId}
          className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white disabled:opacity-40"
          title="将真实点击页面触发 Deep Research">
          实跑 enableDeepResearch
        </button>
      </div>
      {runResult && <div className="text-sm mb-2">{runResult}</div>}
      {report && <ResearchReportView report={report} />}
    </div>
  )
}

function ResearchReportView({ report }: { report: ResearchProbeReport }): JSX.Element {
  if (!report.ok) return <div className="text-red-600 text-sm">{report.error ?? '探针失败'}</div>
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-text-secondary text-left">
        <th className="py-1 pr-2">步</th><th className="py-1 pr-2">选择器</th>
        <th className="py-1 pr-2">命中</th><th className="py-1 pr-2">来源</th><th className="py-1">元素指纹</th>
      </tr></thead>
      <tbody>
        {report.steps.map((s: StepReport) => (
          <tr key={s.index} className="border-t border-border/50">
            <td className="py-1 pr-2">{s.index}</td>
            <td className="py-1 pr-2 font-mono break-all max-w-[200px]">{s.selector}</td>
            <td className="py-1 pr-2">{s.found ? '✅' : '❌'}</td>
            <td className="py-1 pr-2">{s.matchedVia ?? '—'}</td>
            <td className="py-1 font-mono text-text-secondary break-all max-w-[200px]">
              {s.firstHit ? `${s.firstHit.tag}.${s.firstHit.className ?? ''}${s.firstHit.id ? '#' + s.firstHit.id : ''}${s.firstHit.dataTestid ? ' [data-testid=' + s.firstHit.dataTestid + ']' : ''}` : (s.error ?? '—')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DomTab({ modelId }: { modelId: string }): JSX.Element {
  const [report, setReport] = useState<DomProbeReport | null>(null)
  const [running, setRunning] = useState(false)
  const [ancestorDepth, setAncestorDepth] = useState(8)
  const [childDepth, setChildDepth] = useState(3)

  const pick = async (): Promise<void> => {
    setRunning(true); setReport(null)
    try {
      const res = await window.api.diagnosticsProbe(modelId, 'pick', { ancestorDepth, childDepth })
      setReport(res.success && res.data ? res.data as DomProbeReport : { ok: false, error: res.error })
    } finally { setRunning(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-text-secondary">祖先层数
          <input type="number" min={1} max={20} value={ancestorDepth}
            onChange={(e) => setAncestorDepth(Math.max(1, Math.min(20, Number(e.target.value) || 8)))}
            className="ml-1 w-14 px-2 py-0.5 text-sm border border-border rounded bg-bg-primary" />
        </label>
        <label className="text-xs text-text-secondary">子树层数
          <input type="number" min={1} max={6} value={childDepth}
            onChange={(e) => setChildDepth(Math.max(1, Math.min(6, Number(e.target.value) || 3)))}
            className="ml-1 w-14 px-2 py-0.5 text-sm border border-border rounded bg-bg-primary" />
        </label>
        <button type="button" onClick={pick} disabled={running || !modelId}
          className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white disabled:opacity-40">
          {running ? '检拾中…（点平台页元素 / Esc 取消）' : '进入检拾'}
        </button>
      </div>
      {report && <DomReportView report={report} />}
    </div>
  )
}

function DomReportView({ report }: { report: DomProbeReport }): JSX.Element {
  if (!report.ok) {
    if (report.cancelled) return <div className="text-text-secondary text-sm">已取消（Esc）</div>
    return <div className="text-red-600 text-sm">{report.error ?? '检拾失败'}</div>
  }
  return (
    <div className="space-y-3">
      {report.target && <TargetCard target={report.target} selector={report.selector} />}
      {report.ancestors && report.ancestors.length > 0 && (
        <div>
          <div className="text-xs text-text-secondary mb-1">祖先链（根 → 目标）</div>
          <div className="space-y-0.5">
            {report.ancestors.map((n, i) => <FingerprintRow key={i} node={n} depth={0} />)}
          </div>
        </div>
      )}
      {report.subtree && (
        <div>
          <div className="text-xs text-text-secondary mb-1">子树</div>
          <SubtreeView node={report.subtree} depth={0} defaultOpenDepth={2} />
        </div>
      )}
    </div>
  )
}

function TargetCard({ target, selector }: { target: NodeFingerprint; selector?: string }): JSX.Element {
  const copy = (text: string): void => { navigator.clipboard?.writeText(text).catch(() => {}) }
  return (
    <div className="border-2 border-primary rounded-lg p-3 bg-blue-50/40">
      <div className="text-xs text-text-secondary mb-1">选中元素</div>
      <div className="font-mono text-sm break-all">{formatFingerprint(target)}</div>
      {selector && (
        <div className="mt-2 flex items-center gap-2">
          <code className="text-xs bg-bg-primary px-2 py-0.5 rounded border border-border break-all">{selector}</code>
          <button type="button" onClick={() => copy(selector)}
            className="px-2 py-0.5 text-xs rounded bg-white/60 hover:bg-white/80 text-text-primary border border-border">
            复制选择器
          </button>
        </div>
      )}
    </div>
  )
}

function FingerprintRow({ node, depth }: { node: NodeFingerprint; depth: number }): JSX.Element {
  return (
    <div className="font-mono text-xs text-text-secondary break-all" style={{ paddingLeft: depth * 12 }}>
      {formatFingerprint(node)} {!node.isVisible && <span className="text-red-500">(不可见)</span>}
    </div>
  )
}

function SubtreeView({ node, depth, defaultOpenDepth }: { node: TreeNode; depth: number; defaultOpenDepth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < defaultOpenDepth)
  const hasChildren = node.children.length > 0
  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      <div className="font-mono text-xs break-all flex items-center gap-1">
        {hasChildren ? (
          <button type="button" onClick={() => setOpen(!open)} className="text-text-secondary hover:text-primary w-4">
            {open ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 inline-block" />
        )}
        <span className={depth === 0 ? 'text-primary font-semibold' : 'text-text-primary'}>
          {formatFingerprint(node)}
        </span>
        {!node.isVisible && <span className="text-red-500">(不可见)</span>}
      </div>
      {open && hasChildren && (
        <div className="mt-0.5">
          {node.children.map((c, i) => <SubtreeView key={i} node={c} depth={depth + 1} defaultOpenDepth={defaultOpenDepth} />)}
        </div>
      )}
    </div>
  )
}

function formatFingerprint(n: NodeFingerprint): string {
  const cls = n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
  const id = n.id ? '#' + n.id : ''
  const testid = n.dataTestid ? ` [data-testid=${n.dataTestid}]` : ''
  const role = n.attrs?.role ? ` [role=${n.attrs.role}]` : ''
  return `${n.tag}${id}${cls}${testid}${role}`
}

export default DiagnosticsPage
