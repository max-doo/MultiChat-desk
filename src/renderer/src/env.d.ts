/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { API } from '../../preload/index'
// Mindmap modify/candidate/apply/discard/ask and selection events derive from the preload API contract.
// Source context options and task context provenance also derive from that shared contract.

declare global {
  type UpdateState = NonNullable<Awaited<ReturnType<API['updateGetState']>>['data']>
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
