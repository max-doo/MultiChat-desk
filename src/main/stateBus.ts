import { BrowserWindow } from 'electron'

export function broadcastStateChange(senderWebContentsId: number, partialState: Record<string, unknown>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.webContents.id === senderWebContentsId) continue
    win.webContents.send('state-changed-remote', partialState)
  }
}
