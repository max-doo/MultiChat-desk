/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { API } from '../../preload/index'

declare global {
  type UpdateState = NonNullable<Awaited<ReturnType<API['updateGetState']>>['data']>
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
