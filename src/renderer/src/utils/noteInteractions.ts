export const ANNOTATION_CARD_WIDTH = 360
export const ANNOTATION_CARD_ESTIMATED_HEIGHT = 320

export function notePositionInWindow(webview: Electron.WebviewTag, x: number, y: number): { x: number; y: number } {
  const rect = webview.getBoundingClientRect()
  return { x: rect.left + x, y: rect.top + y }
}

/** 将标注弹窗坐标限制在给定边界内，避免右侧或底部溢出。 */
export function clampPopoverPosition(
  x: number,
  y: number,
  bounds: { width: number; height: number },
  cardSize: { width?: number; height?: number } = {},
  margin = 8,
  minTop = margin
): { left: number; top: number } {
  const cardWidth = cardSize.width ?? ANNOTATION_CARD_WIDTH
  const cardHeight = cardSize.height ?? ANNOTATION_CARD_ESTIMATED_HEIGHT
  const maxLeft = Math.max(margin, bounds.width - cardWidth - margin)
  const maxTop = Math.max(minTop, bounds.height - cardHeight - margin)
  return {
    left: Math.max(margin, Math.min(x, maxLeft)),
    top: Math.max(minTop, Math.min(y, maxTop))
  }
}
