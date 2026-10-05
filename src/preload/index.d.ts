import type { ElectronAPI } from '@electron-toolkit/preload'
import type { API } from './index'
// Mindmap modify/candidate/apply/discard/ask and selection events derive from the preload API contract.
// Source context options and task context provenance also derive from that shared contract.

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
