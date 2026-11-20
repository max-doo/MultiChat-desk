import { useEffect, useState } from 'react'
import { buildSkillInstallCommand } from '../utils/cliGuide'
import type { CliIntegrationStatus } from '../../../shared/types/cli'
import { AppIcon } from './icons/AppIcon'

/**
 * 安装引导卡片：检测到 multichat 可用且本次安装后用户未关闭过提示时，
 * 在主界面右下角引导用户把配套 Agent Skill 接入自己的 AI Agent；
 * 关闭后不再显示，下次安装/覆盖安装（Windows .install-stamp 标记）时重新弹出。
 * Windows 要求 CLI 已加入 PATH；macOS 无 PATH 注册，打包版存在 multichat.sh 入口即视为可用。
 */
export default function CliAgentHint(): JSX.Element | null {
  const [status, setStatus] = useState<CliIntegrationStatus | null>(null)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api.cliGetStatus().then(res => {
      if (res.success && res.data) {
        setStatus(res.data)
        const usable = res.data.platform === 'darwin' ? !!res.data.cliCmdPath : res.data.onPath
        if (res.data.isPackaged && usable && !res.data.hintDismissed) {
          setVisible(true)
        }
      }
    })
  }, [])

  if (!visible || !status) return null

  const dismiss = (): void => {
    setVisible(false)
    void window.api.cliDismissHint()
  }

  const handleCopy = async (): Promise<void> => {
    if (!status.skillDir) return
    await navigator.clipboard.writeText(buildSkillInstallCommand(status.skillDir))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed right-4 bottom-4 z-[90] w-[340px] glass-panel-heavy rounded-2xl shadow-float p-4">
      <div className="flex items-start gap-3">
        <AppIcon name="terminal" size={20} className="text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary">命令行工具 multichat 已就绪</div>
          <div className="text-xs text-text-secondary mt-1 leading-relaxed">
            让 AI Agent 通过 multichat 调用本应用：把安装命令交给 Agent 执行，或手动复制 Skill 目录。
          </div>
          {status.skillDir && (
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => { void handleCopy() }}
                className="px-3 py-1.5 text-xs rounded-full bg-primary text-white hover:opacity-90 transition-all font-medium"
              >
                {copied ? '已复制' : '复制安装命令'}
              </button>
              <button
                type="button"
                onClick={() => { void window.api.cliOpenLocation('skill') }}
                className="px-3 py-1.5 text-xs rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium"
              >
                打开 Skill 目录
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
          aria-label="关闭"
        >
          <AppIcon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
