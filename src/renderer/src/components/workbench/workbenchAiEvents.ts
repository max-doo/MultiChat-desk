import type { WorkbenchFileNode } from '../../../../shared/types/workbench'

export const WORKBENCH_SEND_FILE_EVENT = 'workbench:send-file-to-ai'
export const WORKBENCH_UPLOAD_NODES_EVENT = 'workbench:upload-nodes-to-ai'
/** 图片右键"发送到 AI 侧边栏"事件：srcURL 可能是 workbench-file:// / blob: / data: / http(s): */
export const WORKBENCH_SEND_IMAGE_EVENT = 'workbench:send-image-to-ai'

export interface WorkbenchSendFileDetail {
  filePath: string
  fileName: string
  size?: number
}

export interface WorkbenchUploadNodesDetail {
  nodes: WorkbenchFileNode[]
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
}

export function requestSendImageToAi(detail: WorkbenchSendImageDetail): void {
  window.dispatchEvent(new CustomEvent(WORKBENCH_SEND_IMAGE_EVENT, { detail }))
}
