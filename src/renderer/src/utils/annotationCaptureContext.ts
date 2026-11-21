import type { CaptureContext } from '../../../shared/types/annotations'

/**
 * Webview 的采集上下文登记表。
 * 主进程只负责把选区读出来；具体是工作台内还是工作台外，由承载该 Webview 的渲染层声明。
 */
const contexts = new Map<number, CaptureContext>()

export function registerCaptureContext(webContentsId: number, context: CaptureContext): void {
  contexts.set(webContentsId, context)
}

export function unregisterCaptureContext(webContentsId: number): void {
  contexts.delete(webContentsId)
}

export function captureContextOf(webContentsId: number): CaptureContext {
  return contexts.get(webContentsId) ?? 'global'
}
