import { useEffect, useState } from 'react'
import type { CliIntegrationStatus } from '../../../shared/types/cli'
import { buildCliGuideText } from '../utils/cliGuide'

/**
 * 设置抽屉 - 命令行与 Agent 集成区块
 * 展示 multichat CLI 的 PATH 状态、入口路径与 Agent Skill 集成指引
 */
export default function CliIntegrationSection(): JSX.Element | null {
  const [status, setStatus] = useState<CliIntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api.cliGetStatus().then(res => {
      if (res.success && res.data) setStatus(res.data)
    })
  }, [])

  if (!status) return null

  const refresh = async (): Promise<void> => {
    const res = await window.api.cliGetStatus()
    if (res.success && res.data) setStatus(res.data)
  }

  const handleAddToPath = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.api.cliAddToPath()
      if (!res.success) {
        alert(res.error || '加入 PATH 失败')
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleCopyGuide = async (): Promise<void> => {
    await navigator.clipboard.writeText(buildCliGuideText(status))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusText = status.onPath
    ? '已加入 PATH，可在任意终端调用 multichat'
    : status.supported
      ? '已安装但未加入 PATH'
      : status.isPackaged
        ? '当前平台暂不支持自动加入 PATH，可手动调用下方入口'
        : '开发模式：使用下方 CLI 入口路径'

  return (
    <div className="p-4 rounded-xl glass-panel space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-text-primary font-medium">multichat 命令行工具</div>
          <div className="text-xs text-text-secondary mt-1">{statusText}</div>
        </div>
        {status.supported && !status.onPath && (
          <button
            type="button"
            onClick={() => { void handleAddToPath() }}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-full bg-primary text-white hover:opacity-90 transition-all font-medium shrink-0 ml-4 disabled:opacity-50"
          >
            {busy ? '处理中…' : '加入 PATH'}
          </button>
        )}
      </div>

      {status.cliCmdPath && (
        <div className="flex items-center gap-2 text-xs">
          <span className="material-symbols-outlined text-text-secondary text-base">terminal</span>
          <code className="flex-1 truncate text-text-secondary" title={status.cliCmdPath}>{status.cliCmdPath}</code>
          <button
            type="button"
            onClick={() => { void window.api.cliOpenLocation('cli') }}
            className="text-primary hover:opacity-80 font-medium shrink-0"
          >
            打开目录
          </button>
        </div>
      )}

      <div className="pt-2 border-t border-white/60 space-y-2">
        <div className="text-xs text-text-secondary">
          配套 Agent Skill：复制下方目录到 Agent 的 skills 目录（项目内 <code>.devin/skills/</code> 或全局 <code>~/.devin/skills/</code>），即可让 Agent 通过 multichat 调用本应用。
        </div>
        {status.skillDir && (
          <div className="flex items-center gap-2 text-xs">
            <span className="material-symbols-outlined text-text-secondary text-base">smart_toy</span>
            <code className="flex-1 truncate text-text-secondary" title={status.skillDir}>{status.skillDir}</code>
            <button
              type="button"
              onClick={() => { void window.api.cliOpenLocation('skill') }}
              className="text-primary hover:opacity-80 font-medium shrink-0"
            >
              打开目录
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => { void handleCopyGuide() }}
          className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all text-sm font-medium"
        >
          <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
          {copied ? '已复制' : '复制 Agent 接入指引'}
        </button>
      </div>
    </div>
  )
}
