import { useState, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type CheckStatus = 'idle' | 'checking' | 'has-update' | 'no-update' | 'error'

interface CheckState {
  status: CheckStatus
  latestVersion?: string
  currentVersion?: string
  releaseUrl?: string
  releaseNotes?: string
  error?: string
}

const INITIAL_STATE: CheckState = { status: 'idle' }

export default function AboutSection(): JSX.Element {
  const [state, setState] = useState<CheckState>(INITIAL_STATE)
  const [showNotes, setShowNotes] = useState(false)

  // 挂载时取应用版本号，使 idle 态也能显示真实版本（不依赖检查更新结果）
  useEffect(() => {
    void window.api.getAppVersion().then((result) => {
      if (result.success && result.data) {
        setState((prev) => ({ ...prev, currentVersion: result.data }))
      }
    })
  }, [])

  const handleCheck = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'checking' }))
    setShowNotes(false)
    const result = await window.api.updateCheck()
    if (result.success && result.data) {
      const d = result.data
      setState({
        status: d.hasUpdate ? 'has-update' : 'no-update',
        latestVersion: d.latestVersion,
        currentVersion: d.currentVersion,
        releaseUrl: d.releaseUrl,
        releaseNotes: d.releaseNotes
      })
    } else {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: result.error ?? '检查失败，请稍后重试'
      }))
    }
  }, [])

  const handleDownload = useCallback(() => {
    if (state.releaseUrl) {
      void window.api.openBrowserWindow(state.releaseUrl)
    }
  }, [state.releaseUrl])

  const isChecking = state.status === 'checking'

  return (
    <div className="mt-3 p-3 rounded-xl glass-panel space-y-3">
      {/* 当前版本 */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">当前版本</span>
        <span className="text-text-primary font-mono">
          v{state.currentVersion ?? '—'}
        </span>
      </div>

      {/* 检查按钮 + 结果文案 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm flex-1">
          {state.status === 'checking' && (
            <span className="text-text-secondary">正在检查…</span>
          )}
          {state.status === 'has-update' && state.latestVersion && (
            <span className="text-text-primary">
              发现新版本 <span className="text-primary font-medium">v{state.latestVersion}</span>
            </span>
          )}
          {state.status === 'no-update' && (
            <span className="text-text-secondary">当前已是最新版本</span>
          )}
          {state.status === 'error' && state.error && (
            <span className="text-red-400">{state.error}</span>
          )}
          {state.status === 'idle' && (
            <span className="text-text-secondary">检查是否有新版本</span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          {state.status === 'has-update' && (
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium"
            >
              前往下载
            </button>
          )}
          <button
            type="button"
            onClick={handleCheck}
            disabled={isChecking}
            className="px-3 py-1.5 text-xs rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium disabled:opacity-50"
          >
            {isChecking ? '检查中…' : state.status === 'error' ? '重试' : '检查更新'}
          </button>
        </div>
      </div>

      {/* Release Notes 折叠 */}
      {state.releaseNotes && state.status === 'has-update' && (
        <div className="border-t border-black/10 dark:border-white/10 pt-2">
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">
              {showNotes ? 'expand_less' : 'expand_more'}
            </span>
            {showNotes ? '收起更新说明' : '查看更新说明'}
          </button>
          {showNotes && (
            <div className="mt-2 text-sm text-text-primary prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.releaseNotes}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
