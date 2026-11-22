export function notePositionInWindow(webview: Electron.WebviewTag, x: number, y: number): { x: number; y: number } {
  const rect = webview.getBoundingClientRect()
  return { x: rect.left + x, y: rect.top + y }
}
