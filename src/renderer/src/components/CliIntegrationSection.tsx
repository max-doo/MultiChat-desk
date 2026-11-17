import { useEffect, useState } from 'react'
import type { CliIntegrationStatus } from '../../../shared/types/cli'
import { buildSkillInstallCommand } from '../utils/cliGuide'

/**
 * 设置抽屉 - 命令行与 Agent 集成区块
 * 展示 multichat CLI 的 PATH 状态与 Agent Skill 安装入口
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

  const handleCopyCommand = async (): Promise<void> => {
    if (!status.skillDir) return
    await navigator.clipboard.writeText(buildSkillInstallCommand(status.skillDir))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusText = status.onPath
    ? '已加入 PATH'
    : status.supported
      ? '未加入 PATH'
      : status.isPackaged
        ? '当前平台不支持自动加入 PATH'
        : '开发模式'

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

      {status.cliCmdPath && !status.onPath && (
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

      {status.skillDir && (
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-primary font-medium">Agent Skill</div>
            <div className="text-xs text-text-secondary mt-1">让 AI Agent 通过 multichat 调用本应用</div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-4">
            <button
              type="button"
              onClick={() => { void handleCopyCommand() }}
              className="text-sm text-primary hover:opacity-80 transition-colors font-medium"
            >
              {copied ? '已复制' : '复制安装命令'}
            </button>
            <button
              type="button"
              onClick={() => { void window.api.cliOpenLocation('skill') }}
              className="text-sm text-primary hover:opacity-80 transition-colors font-medium"
            >
              打开目录
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
