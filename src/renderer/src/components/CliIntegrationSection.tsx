import { useEffect, useState } from 'react'
import type { CliIntegrationStatus } from '../../../shared/types/cli'
import { buildSkillInstallCommand } from '../utils/cliGuide'
import { AppIcon } from './icons/AppIcon'

const secondaryActionClass =
  'flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-sidebar px-3 text-label font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5'

const iconActionClass =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/10'

/**
 * 设置抽屉 - 命令行与 Agent 集成区块
 * 展示 multichat CLI 的 PATH 状态与 Agent Skill 安装入口
 */
export default function CliIntegrationSection(): JSX.Element | null {
  const [status, setStatus] = useState<CliIntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [cliCopied, setCliCopied] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)

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
    setPathError(null)
    try {
      const res = await window.api.cliAddToPath()
      if (!res.success) {
        setPathError(res.error || '加入 PATH 失败')
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

  const handleCopyCliCommand = async (): Promise<void> => {
    if (!status.cliCmdPath) return
    await navigator.clipboard.writeText(`sh "${status.cliCmdPath}"`)
    setCliCopied(true)
    setTimeout(() => setCliCopied(false), 2000)
  }

  const statusText = status.onPath
    ? '已加入 PATH'
    : status.supported
      ? '未加入 PATH'
      : status.isPackaged
        ? status.platform === 'darwin' && status.cliCmdPath
          ? '未加入 PATH，可在终端通过下方入口调用'
          : '当前平台不支持自动加入 PATH'
        : '开发模式'

  return (
    <div className="p-4 rounded-xl glass-panel space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-body font-medium text-text-primary">multichat 命令行工具</div>
          <div className="mt-0.5 text-caption text-text-secondary">{statusText}</div>
        </div>
        {status.supported && !status.onPath && (
          <button
            type="button"
            onClick={() => { void handleAddToPath() }}
            disabled={busy}
            className="ml-4 h-9 shrink-0 rounded-lg bg-primary px-4 text-body font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '处理中…' : '加入 PATH'}
          </button>
        )}
      </div>

      {pathError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-label text-rose-600">
          {pathError}
        </div>
      )}

      {status.cliCmdPath && !status.onPath && (
        <div className="flex items-center gap-2 text-label text-text-secondary">
          <AppIcon name="terminal" size={16} className="text-text-secondary" />
          <code className="flex-1 truncate text-caption" title={status.cliCmdPath}>{status.cliCmdPath}</code>
          <button
            type="button"
            onClick={() => { void window.api.cliOpenLocation('cli') }}
            className={iconActionClass}
            title="打开命令行目录"
            aria-label="打开命令行目录"
          >
            <AppIcon name="open_in_new" size={16} />
          </button>
          {status.platform === 'darwin' && (
            <button
              type="button"
              onClick={() => { void handleCopyCliCommand() }}
              className={secondaryActionClass}
            >
              <AppIcon name="content_copy" size={14} />
              <span>{cliCopied ? '已复制' : '复制调用命令'}</span>
            </button>
          )}
        </div>
      )}

      {status.skillDir && (
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-body font-medium text-text-primary">Agent Skill</div>
            <div className="mt-0.5 text-caption text-text-secondary">让 AI Agent 通过 multichat 调用本应用</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { void handleCopyCommand() }}
              className={secondaryActionClass}
            >
              <AppIcon name="content_copy" size={14} />
              <span>{copied ? '已复制' : '复制安装命令'}</span>
            </button>
            <button
              type="button"
              onClick={() => { void window.api.cliOpenLocation('skill') }}
              className={secondaryActionClass}
              title="打开 Skill 目录"
            >
              <AppIcon name="open_in_new" size={14} />
              <span>打开目录</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
