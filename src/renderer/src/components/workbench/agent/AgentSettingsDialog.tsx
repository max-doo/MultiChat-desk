import { useState } from 'react'
import { AppIcon } from '../../icons/AppIcon'
import Modal, { ModalHeader } from '../../ui/Modal'
import { AgentProviderSettings } from './AgentProviderSettings'
import { AgentSkillsSettings } from './AgentSkillsSettings'

interface AgentSettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function AgentSettingsDialog({ isOpen, onClose }: AgentSettingsDialogProps): JSX.Element | null {
  const [tab, setTab] = useState<'providers' | 'skills'>('providers')

  return (
    <Modal open={isOpen} onClose={onClose} size="lg" variant="glass" className="max-w-xl h-[85vh]">
      <ModalHeader title="Agent 配置" icon="smart_toy" onClose={onClose} />

      <div className="px-4 pt-2 flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setTab('providers')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label transition-colors ${
            tab === 'providers'
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
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
              : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
          }`}
        >
          <AppIcon name="tune" size={14} />
          技能与权限
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'providers' ? <AgentProviderSettings /> : <AgentSkillsSettings compact />}
      </div>
    </Modal>
  )
}
