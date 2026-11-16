import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { buildCliGuideText } from '../utils/cliGuide'
import type { CliIntegrationStatus } from '../../../shared/types/cli'

/**
 * 首启一次性引导卡片：检测到 multichat 已加入 PATH 且用户未关闭过提示时，
 * 在主界面右下角提示接入配套 Agent Skill；关闭后不再显示。
 */
export default function CliAgentHint(): JSX.Element | null {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const [status, setStatus] = useState<CliIntegrationStatus | null>(null)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api.cliGetStatus().then(res => {
      if (res.success && res.data) {
        setStatus(res.data)
        if (res.data.isPackaged && res.data.onPath && !res.data.hintDismissed) {
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
    await navigator.clipboard.writeText(buildCliGuideText(status))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenSettings = (): void => {
    dismiss()
    setSettingsOpen(true)
  }

  return (
    <div className="fixed right-4 bottom-4 z-[90] w-[340px] glass-panel-heavy rounded-2xl shadow-float p-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-xl shrink-0 mt-0.5">terminal</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary">命令行工具 multichat 已就绪</div>
          <div className="text-xs text-text-secondary mt-1 leading-relaxed">
            可在任意终端调用 multichat 驱动本应用。若想让 AI Agent（Devin、Claude Code 等）也能使用，请复制配套 Skill 到 Agent 的 skills 目录。
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => { void handleCopy() }}
              className="px-3 py-1.5 text-xs rounded-full bg-primary text-white hover:opacity-90 transition-all font-medium"
            >
              {copied ? '已复制指引' : '复制接入指引'}
            </button>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="px-3 py-1.5 text-xs rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium"
            >
              查看详情
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
          aria-label="关闭"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>
    </div>
  )
}
