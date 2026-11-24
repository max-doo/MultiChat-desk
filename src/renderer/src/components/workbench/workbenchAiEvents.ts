import type { WorkbenchFileNode } from '../../../../shared/types/workbench'

export const WORKBENCH_SEND_FILE_EVENT = 'workbench:send-file-to-ai'
export const WORKBENCH_UPLOAD_NODES_EVENT = 'workbench:upload-nodes-to-ai'
/** 图片右键"发送到 AI 侧边栏"事件：srcURL 可能是 workbench-file:// / blob: / data: / http(s): */
export const WORKBENCH_SEND_IMAGE_EVENT = 'workbench:send-image-to-ai'

export const WORKBENCH_ASK_SIDEBAR_EVENT = 'workbench:ask-sidebar'

export interface WorkbenchSendFileDetail {
  filePath: string
  fileName: string
  size?: number
  target?: 'ai' | 'ai2'
}

export interface WorkbenchUploadNodesDetail {
  nodes: WorkbenchFileNode[]
  target?: 'ai' | 'ai2'
}

export function requestSendFileToAi(detail: WorkbenchSendFileDetail): void {
  window.dispatchEvent(new CustomEvent(WORKBENCH_SEND_FILE_EVENT, { detail }))
}

export function requestUploadNodesToAi(detail: WorkbenchUploadNodesDetail): void {
  window.dispatchEvent(new CustomEvent(WORKBENCH_UPLOAD_NODES_EVENT, { detail }))
}

export interface WorkbenchSendImageDetail {
  srcURL: string
  fileName?: string
  target?: 'ai' | 'ai2'
}

export interface WorkbenchAskSidebarDetail {
  text: string
  /** 发起提问的来源 wcId；用于决定目标 sidebar（主栏或第二栏） */
  wcId: number
}

export function requestAskSidebar(detail: WorkbenchAskSidebarDetail): void {
  window.dispatchEvent(new CustomEvent(WORKBENCH_ASK_SIDEBAR_EVENT, { detail }))
}

export function requestSendImageToAi(detail: WorkbenchSendImageDetail): void {
  window.dispatchEvent(new CustomEvent(WORKBENCH_SEND_IMAGE_EVENT, { detail }))
}

/** AI 侧边栏 webview wcId -> 所属实例，用于「在侧边栏中提问」识别来源并投到另一个实例 */
const sidebarWcIdRegistry = new Map<number, 'ai' | 'ai2'>()

export function registerSidebarWcId(wcId: number, target: 'ai' | 'ai2'): void {
  sidebarWcIdRegistry.set(wcId, target)
}

export function unregisterSidebarWcId(wcId: number): void {
  sidebarWcIdRegistry.delete(wcId)
}

export function getSidebarTargetByWcId(wcId: number): 'ai' | 'ai2' | undefined {
  return sidebarWcIdRegistry.get(wcId)
}
