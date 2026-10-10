export interface ContextMenuItem {
  key: string
  label: string
  icon: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
}

export type ContextMenuEntry = ContextMenuItem | { type: 'separator' }

export interface WebviewContextMenuData {
  x: number
  y: number
  wcId: number
  items: ContextMenuEntry[]
}

export interface WebviewContextMenuActionRequest {
  wcId: number
  actionKey: string
  data?: unknown
}
