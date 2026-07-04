import { useEffect, useRef, useState } from 'react'
import { defaultSelectors } from '../config/selectors'
import type { CandidateReport, DomProbeReport, NodeFingerprint, ProbeReport, ResearchProbeReport, StepReport, TreeNode } from '../utils/selectorDiagnostics'

// ─────────────────────────────────────────────────────────────
// 辅助着色组件与复制格式化函数
// ─────────────────────────────────────────────────────────────

function ColorizedFingerprint({ node, className = '' }: {
  node: {
    tag: string
    className: string | null
    id: string | null
    dataTestid: string | null
    attrs?: Record<string, string | null> | null
  }
  className?: string
}): JSX.Element {
  const cls = node.className ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
  const id = node.id ? '#' + node.id : ''
  
  return (
    <span className={`font-mono text-xs select-all break-all ${className}`}>
      <span className="text-blue-600 font-semibold dark:text-blue-400">{node.tag}</span>
      {id && <span className="text-amber-600 dark:text-amber-400">{id}</span>}
      {cls && <span className="text-purple-600 dark:text-purple-400">{cls}</span>}
      {node.dataTestid && (
        <span className="text-gray-400 dark:text-gray-500">
          {' '}[<span className="text-teal-600 dark:text-teal-400">data-testid</span>=<span className="text-orange-600 dark:text-orange-400">"{node.dataTestid}"</span>]
        </span>
      )}
      {node.attrs && Object.entries(node.attrs).map(([key, val]) => {
        if (key === 'data-testid' || !val) return null
        return (
          <span key={key} className="text-gray-400 dark:text-gray-500">
            {' '}[<span className="text-teal-600 dark:text-teal-400">{key}</span>=<span className="text-orange-600 dark:text-orange-400">"{val}"</span>]
          </span>
        )
      })}
    </span>
  )
}

function formatNodeForCopy(n: NodeFingerprint): string {
  const cls = n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
  const id = n.id ? '#' + n.id : ''
  const testid = n.dataTestid ? ` [data-testid=${n.dataTestid}]` : ''
  const attrsStr = n.attrs 
    ? Object.entries(n.attrs)
        .filter(([k, v]) => k !== 'data-testid' && v !== null && v !== undefined && v !== '')
        .map(([k, v]) => ` [${k}="${v}"]`)
        .join('')
    : ''
  return `${n.tag}${id}${cls}${testid}${attrsStr}`
}

function formatDomProbeReportToText(report: DomProbeReport): string {
  const lines: string[] = []
  
  if (report.target) {
    lines.push(`Selected Element: ${formatNodeForCopy(report.target)}${report.target.isVisible ? '' : ' (invisible)'}`)
  }
  if (report.selector) {
    lines.push(`Selector: ${report.selector}`)
  }
  
  if (report.ancestors && report.ancestors.length > 0) {
    lines.push('\nAncestor Chain:')
    report.ancestors.forEach((n, i) => {
      lines.push(`${'  '.repeat(i)}- ${formatNodeForCopy(n)}${n.isVisible ? '' : ' (invisible)'}`)
    })
  }
  
  if (report.subtree) {
    lines.push('\nSubtree:')
    const formatSubtree = (node: TreeNode, depth: number) => {
      let suffix = ''
      if (!node.isVisible) suffix += ' (invisible)'
      if (node.visibleTextLen > 0) suffix += ` (text len: ${node.visibleTextLen})`
      
      lines.push(`${'  '.repeat(depth)}${formatNodeForCopy(node)}${suffix}`)
      
      if (node.children && node.children.length > 0) {
        node.children.forEach(c => formatSubtree(c, depth + 1))
      }
    }
    formatSubtree(report.subtree, 0)
  }
  
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────
// 主诊断页面组件
// ─────────────────────────────────────────────────────────────

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
    <div className="w-screen h-screen flex flex-col bg-gray-50 overflow-hidden select-none">
      {/* 自定义标题栏：拖拽 + 置顶 + 关闭 */}
      <div
        className="relative h-10 w-full shrink-0 flex items-center justify-between px-3 bg-white border-b border-gray-200/60 drag-region"
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
          <span className="material-symbols-outlined text-base text-gray-500">science</span>
          <span className="text-xs font-semibold text-gray-700 truncate">选择器诊断</span>
        </div>
        <div className="flex items-center gap-1.5 no-drag">
          <button
            type="button"
            onClick={() => { void togglePin() }}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 ${pinned ? 'text-blue-600 bg-blue-50/80 shadow-xs' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
            title={pinned ? '取消置顶' : '置顶于主窗口之上'}
          >
            <span className="material-symbols-outlined text-base" style={pinned ? { fontVariationSettings: "'FILL' 1" } : undefined}>{pinned ? 'push_pin' : 'pin_drop'}</span>
          </button>
          <button
            type="button"
            onClick={() => window.api.closeWindow()}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
            title="关闭"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </div>

      {/* 现代胶囊 Tab 分段栏 */}
      <div className="px-4 pt-3 pb-2 bg-white flex shrink-0 border-b border-gray-100">
        <div className="bg-gray-100 p-0.5 rounded-lg flex gap-0.5">
          <TabButton active={tab === 'message'} onClick={() => setTab('message')} label="消息容器 (messageContainer)" />
          <TabButton active={tab === 'research'} onClick={() => setTab('research')} label="深度研究 (researchMode)" />
          <TabButton active={tab === 'dom'} onClick={() => setTab('dom')} label="DOM 探测 (检拾)" />
        </div>
      </div>

      {/* 主工作区 */}
      <div className="flex flex-1 min-h-0 bg-white">
        {/* 左侧 platform 列表 */}
        <div className="w-48 border-r border-gray-100 overflow-auto bg-gray-50/50 p-2 space-y-1 flex flex-col shrink-0">
          <div className="px-2.5 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AI 平台</div>
          {platformIds.map((id) => {
            const isSelected = selectedId === id
            return (
              <button key={id} type="button" onClick={() => setSelectedId(id)}
                className={`w-full text-left px-2.5 py-2 text-xs rounded-lg transition-all duration-200 ${isSelected ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                {id}
              </button>
            )
          })}
        </div>

        {/* 右侧内容面板 */}
        <div className="flex-1 overflow-auto p-6 bg-white">
          {tab === 'message'
            ? <MessageTab modelId={selectedId} />
            : tab === 'research'
              ? <ResearchTab modelId={selectedId} />
              : <DomTab modelId={selectedId} />}
        </div>
      </div>

      {/* 底部状态提示栏 */}
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center gap-1.5 shrink-0">
        <span className="material-symbols-outlined text-[14px]">info</span>
        <span>dev-only 诊断。先在主窗口对应平台触发一次回复再诊断。报告仅含元素指纹+正文长度，不含正文。</span>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 no-drag ${active ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-500 hover:text-gray-900 hover:bg-white/40'}`}>
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// 消息容器 Tab 面板
// ─────────────────────────────────────────────────────────────

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
        className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 mb-4 transition-colors flex items-center gap-1.5 shadow-xs no-drag">
        {running && <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>}
        <span>{running ? '诊断中...' : '开始诊断 messageContainer'}</span>
      </button>
      {report && <MessageReportView report={report} />}
    </div>
  )
}

function MessageReportView({ report }: { report: ProbeReport }): JSX.Element {
  if (!report.ok) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700 text-sm">
        <span className="material-symbols-outlined text-base">error</span>
        <span>{report.error ?? '探针失败'}</span>
      </div>
    )
  }
  return (
    <div className="border border-gray-200/80 rounded-xl shadow-xs overflow-hidden bg-white">
      <table className="w-full text-xs text-left border-collapse">
        <thead>
          <tr className="bg-gray-50/75 border-b border-gray-200 text-gray-500 font-semibold select-none">
            <th className="px-4 py-3">选择器</th>
            <th className="px-4 py-3 text-center">命中数</th>
            <th className="px-4 py-3 text-center">可见数</th>
            <th className="px-4 py-3 text-center">首个正文长度</th>
            <th className="px-4 py-3">首个元素指纹</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {report.candidates.map((c: CandidateReport, i: number) => {
            const hasHits = c.hitCount > 0
            const hasVisibleHits = c.visibleHitCount > 0
            return (
              <tr key={i} className="hover:bg-gray-50/30 transition-colors">
                <td className="px-4 py-3 font-mono break-all max-w-[220px] text-gray-700 select-all">{c.selector}</td>
                <td className="px-4 py-3 text-center select-none">
                  <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full font-medium ${hasHits ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                    {c.hitCount}
                  </span>
                </td>
                <td className="px-4 py-3 text-center select-none">
                  <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full font-medium ${hasVisibleHits ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                    {c.visibleHitCount}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-gray-600 select-none">
                  {c.firstHit ? `${c.firstHit.visibleTextLen} 字` : '—'}
                </td>
                <td className="px-4 py-3 max-w-[240px]">
                  {c.firstHit ? (
                    <ColorizedFingerprint node={{
                      tag: c.firstHit.tag,
                      className: c.firstHit.className,
                      id: c.firstHit.id,
                      dataTestid: c.firstHit.dataTestid,
                      attrs: null
                    }} />
                  ) : (
                    <span className="text-gray-400 select-none">{c.error ?? '—'}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 深度研究 Tab 面板
// ─────────────────────────────────────────────────────────────

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
      <div className="flex gap-3 mb-4 select-none">
        <button type="button" onClick={probe} disabled={running || !modelId}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-xs no-drag">
          {running && <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>}
          <span>{running ? '探测中...' : '只读探测 steps'}</span>
        </button>
        <button type="button" onClick={runReal} disabled={!modelId}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-xs no-drag"
          title="将真实点击页面触发 Deep Research">
          <span className="material-symbols-outlined text-base">play_arrow</span>
          <span>实跑 enableDeepResearch</span>
        </button>
      </div>
      {runResult && (
        <div className={`p-3 rounded-lg text-xs mb-3 flex items-center gap-2 border select-none ${
          runResult.includes('✅') 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
            : runResult.includes('执行中') 
              ? 'bg-blue-50 border-blue-200 text-blue-700' 
              : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <span>{runResult}</span>
        </div>
      )}
      {report && <ResearchReportView report={report} />}
    </div>
  )
}

function ResearchReportView({ report }: { report: ResearchProbeReport }): JSX.Element {
  if (!report.ok) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700 text-sm">
        <span className="material-symbols-outlined text-base">error</span>
        <span>{report.error ?? '探针失败'}</span>
      </div>
    )
  }
  return (
    <div className="border border-gray-200/80 rounded-xl shadow-xs overflow-hidden bg-white">
      <table className="w-full text-xs text-left border-collapse">
        <thead>
          <tr className="bg-gray-50/75 border-b border-gray-200 text-gray-500 font-semibold select-none">
            <th className="px-4 py-3 text-center w-12">步</th>
            <th className="px-4 py-3">选择器</th>
            <th className="px-4 py-3 text-center">状态</th>
            <th className="px-4 py-3">匹配策略</th>
            <th className="px-4 py-3">首个元素指纹</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {report.steps.map((s: StepReport) => (
            <tr key={s.index} className="hover:bg-gray-50/30 transition-colors">
              <td className="px-4 py-3 text-center font-medium text-gray-400 select-none">{s.index}</td>
              <td className="px-4 py-3 font-mono break-all max-w-[220px] text-gray-700 select-all">{s.selector}</td>
              <td className="px-4 py-3 text-center select-none">
                <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full font-medium ${s.found ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  {s.found ? '已命中' : '未命中'}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600 select-none">
                {s.matchedVia ? (
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600 text-[10px] font-sans">
                    {s.matchedVia}
                  </span>
                ) : '—'}
              </td>
              <td className="px-4 py-3 max-w-[240px]">
                {s.firstHit ? (
                  <ColorizedFingerprint node={{
                    tag: s.firstHit.tag,
                    className: s.firstHit.className,
                    id: s.firstHit.id,
                    dataTestid: s.firstHit.dataTestid,
                    attrs: null
                  }} />
                ) : (
                  <span className="text-gray-400 select-none">{s.error ?? '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// DOM 探测 (检拾) Tab 面板
// ─────────────────────────────────────────────────────────────

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
      <div className="flex flex-wrap items-center gap-4 mb-5 p-4 bg-gray-50 border border-gray-200/80 rounded-xl select-none">
        <label className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
          <span>祖先层数</span>
          <input type="number" min={1} max={20} value={ancestorDepth}
            onChange={(e) => setAncestorDepth(Math.max(1, Math.min(20, Number(e.target.value) || 8)))}
            className="w-16 px-2.5 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:border-blue-500 transition-colors no-drag" />
        </label>
        <label className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
          <span>子树层数</span>
          <input type="number" min={1} max={6} value={childDepth}
            onChange={(e) => setChildDepth(Math.max(1, Math.min(6, Number(e.target.value) || 3)))}
            className="w-16 px-2.5 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:border-blue-500 transition-colors no-drag" />
        </label>
        <button type="button" onClick={pick} disabled={running || !modelId}
          className={`px-4 py-2 text-xs font-medium rounded-lg shadow-xs flex items-center gap-1.5 transition-all duration-200 no-drag ${
            running 
              ? 'bg-amber-500 hover:bg-amber-600 text-white animate-pulse' 
              : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40'
          }`}>
          <span className="material-symbols-outlined text-base">
            {running ? 'track_changes' : 'ads_click'}
          </span>
          <span>{running ? '检拾中…（点平台页元素 / Esc 取消）' : '进入检拾探测'}</span>
        </button>
      </div>
      {report && <DomReportView report={report} />}
    </div>
  )
}

function DomReportView({ report }: { report: DomProbeReport }): JSX.Element {
  const [copiedText, setCopiedText] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)

  if (!report.ok) {
    if (report.cancelled) {
      return (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-2 text-gray-500 text-sm select-none">
          <span className="material-symbols-outlined text-base">info</span>
          <span>已取消（Esc）</span>
        </div>
      )
    }
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700 text-sm select-none">
        <span className="material-symbols-outlined text-base">error</span>
        <span>{report.error ?? '检拾失败'}</span>
      </div>
    )
  }

  const handleCopyText = async () => {
    const text = formatDomProbeReportToText(report)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 2000)
    } catch (e) {
      console.error(e)
    }
  }

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      setCopiedJson(true)
      setTimeout(() => setCopiedJson(false), 2000)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="space-y-4">
      {/* 顶部一键复制操作栏 */}
      <div className="flex gap-2 justify-end select-none">
        <button
          type="button"
          onClick={handleCopyText}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-xs flex items-center gap-1.5 transition-all duration-200 no-drag"
        >
          <span className="material-symbols-outlined text-sm">{copiedText ? 'done' : 'content_copy'}</span>
          <span>{copiedText ? '已复制格式化树' : '复制格式化树'}</span>
        </button>
        <button
          type="button"
          onClick={handleCopyJson}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-xs flex items-center gap-1.5 transition-all duration-200 no-drag"
        >
          <span className="material-symbols-outlined text-sm">{copiedJson ? 'done' : 'code'}</span>
          <span>{copiedJson ? '已复制 JSON' : '复制 JSON'}</span>
        </button>
      </div>

      {report.target && <TargetCard target={report.target} selector={report.selector} />}
      
      {report.ancestors && report.ancestors.length > 0 && (
        <div className="border border-gray-200/80 rounded-xl p-4 bg-white shadow-xs">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 select-none">祖先链（根 → 目标）</div>
          <div className="relative pl-4 border-l border-dashed border-gray-200 space-y-3">
            {report.ancestors.map((n, i) => (
              <div key={i} className="relative flex items-center gap-2">
                {/* 节点点号连接指示线标记 */}
                <div className="absolute -left-[21px] w-2.5 h-2.5 rounded-full bg-white border-2 border-blue-400" />
                <ColorizedFingerprint node={n} />
                {!n.isVisible && <span className="text-[10px] px-1 bg-red-50 text-red-500 border border-red-200 rounded font-sans select-none">不可见</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.subtree && (
        <div className="border border-gray-200/80 rounded-xl p-4 bg-white shadow-xs">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 select-none">子树</div>
          <div className="overflow-auto max-h-[360px] pr-2">
            <SubtreeView node={report.subtree} depth={0} defaultOpenDepth={3} />
          </div>
        </div>
      )}
    </div>
  )
}

function TargetCard({ target, selector }: { target: NodeFingerprint; selector?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = () => {
    if (selector) {
      navigator.clipboard?.writeText(selector).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => {})
    }
  }
  
  return (
    <div className="border border-blue-200 rounded-xl p-4 bg-gradient-to-r from-blue-50/40 to-indigo-50/10 shadow-xs">
      <div className="text-[11px] font-semibold text-blue-500 uppercase tracking-wider mb-2 select-none">当前选中元素</div>
      <div className="py-1"><ColorizedFingerprint node={target} className="text-sm" /></div>
      {selector && (
        <div className="mt-3 flex items-center gap-2">
          <code className="text-xs font-mono bg-white px-2.5 py-1 rounded-md border border-gray-200 text-gray-700 break-all select-all">{selector}</code>
          <button type="button" onClick={handleCopy}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-xs flex items-center gap-1.5 transition-all duration-200 no-drag select-none">
            <span className="material-symbols-outlined text-[14px]">{copied ? 'done' : 'content_copy'}</span>
            <span>{copied ? '已复制' : '复制选择器'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function SubtreeView({ node, depth, defaultOpenDepth }: { node: TreeNode; depth: number; defaultOpenDepth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < defaultOpenDepth)
  const hasChildren = node.children && node.children.length > 0
  return (
    <div className={depth > 0 ? 'ml-4' : ''}>
      <div className={`font-mono text-xs break-all flex items-center gap-1.5 py-1 px-2 rounded hover:bg-gray-50 transition-colors ${depth === 0 ? 'bg-blue-50/30 border-l-2 border-blue-500' : ''}`}>
        {hasChildren ? (
          <button type="button" onClick={() => setOpen(!open)} className="text-gray-400 hover:text-blue-600 w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200/50 transition-colors no-drag">
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'wght' 500" }}>{open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}</span>
          </button>
        ) : (
          <span className="w-4 inline-block shrink-0" />
        )}
        <ColorizedFingerprint node={node} />
        {!node.isVisible && <span className="text-[10px] px-1 bg-red-50 text-red-500 border border-red-200 rounded font-sans shrink-0 select-none">不可见</span>}
        {node.visibleTextLen > 0 && <span className="text-[10px] text-gray-400 font-sans shrink-0 select-none">({node.visibleTextLen} 字)</span>}
      </div>
      {open && hasChildren && (
        <div className="mt-0.5 border-l border-gray-100 ml-4 pl-1">
          {node.children.map((c, i) => <SubtreeView key={i} node={c} depth={depth + 1} defaultOpenDepth={defaultOpenDepth} />)}
        </div>
      )}
    </div>
  )
}

export default DiagnosticsPage
