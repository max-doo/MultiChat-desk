import { create } from 'zustand'

interface AgentSettingsDialogState {
  isOpen: boolean
  open: () => void
  close: () => void
}

export const useAgentSettingsDialogStore = create<AgentSettingsDialogState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false })
}))
