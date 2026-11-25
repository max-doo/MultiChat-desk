import { useState } from 'react'
import { AppIcon } from '../../icons/AppIcon'
import { AgentProviderSettings } from './AgentProviderSettings'
import { AgentSkillsSettings } from './AgentSkillsSettings'

interface AgentSettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function AgentSettingsDialog({ isOpen, onClose }: AgentSettingsDialogProps): JSX.Element | null {
  const [tab, setTab] = useState<'providers' | 'skills'>('providers')

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />

      <div className="relative w-full max-w-xl h-[85vh] glass-panel-heavy rounded-2xl shadow-float flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-4 border-b border-white/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <AppIcon name="smart_toy" size={24} className="text-primary" />
            <h3 className="text-title font-semibold text-text-primary">Agent 配置</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
            title="关闭"
          >
            <AppIcon name="close" size={20} />
          </button>
        </div>

        <div className="px-4 pt-2 flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setTab('providers')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label transition-colors ${
              tab === 'providers'
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-text-secondary hover:text-text-primary hover:bg-black/5'
            }`}
          >
            <AppIcon name="key" size={14} />
            供应商
          </button>
          <button
            type="button"
            onClick={() => setTab('skills')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label transition-colors ${
              tab === 'skills'
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-text-secondary hover:text-text-primary hover:bg-black/5'
            }`}
          >
            <AppIcon name="tune" size={14} />
            技能与权限
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === 'providers' ? <AgentProviderSettings /> : <AgentSkillsSettings compact />}
        </div>
      </div>
    </div>
  )
}
