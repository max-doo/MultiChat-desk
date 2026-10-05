import type { MindmapSelection } from '../../../shared/types/notes'

export interface PendingMindmapSelection extends MindmapSelection { chooseTarget: boolean }
let pending: PendingMindmapSelection | null = null
const listeners = new Set<() => void>()
export function queueMindmapSelection(selection: MindmapSelection, chooseTarget: boolean): void {
  pending = { ...selection, chooseTarget }
  listeners.forEach(listener => listener())
}
export function consumeMindmapSelection(webContentsId: number): PendingMindmapSelection | null {
  if (pending?.webContentsId !== webContentsId) return null
  const value = pending; pending = null; return value
}
export function subscribeMindmapSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
