import { session } from 'electron'
import { existsSync } from 'fs'
import { extname, join } from 'path'
import { hasActiveNativeDownloadContext } from './ImageDownloadService'

type WorkspaceProvider = () => string | null

let workspaceProvider: WorkspaceProvider | null = null
let registered = false
// 并发下载可能拿到同名建议文件名，先占位，避免多个保存框默认到同一路径。
const reservedPaths = new Set<string>()

const MAX_BASE_NAME = 160
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const reserveKey = (filePath: string): string =>
  process.platform === 'win32' ? filePath.toLowerCase() : filePath

function safeFileName(rawName: string, url: string): string {
  let fromUrl = ''
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
    fromUrl = decodeURIComponent(last)
  } catch {
    // blob:/data: 等无路径 URL 直接忽略
  }

  const leaf = (rawName || fromUrl).split(/[/\\]/).pop()?.trim() || ''
  // eslint-disable-next-line no-control-regex
  const cleaned = leaf.replace(/[<>:"/\\|?*]|[\u0000-\u001F]/g, '_').replace(/[. ]+$/g, '')
  if (!cleaned) return `download-${Date.now()}`

  const ext = extname(cleaned).slice(0, 16)
  const stem = (ext ? cleaned.slice(0, -ext.length) : cleaned).slice(0, MAX_BASE_NAME) || 'download'
  const safeStem = RESERVED_NAME.test(stem) ? `_${stem}` : stem
  return `${safeStem}${ext}`
}

function uniquePath(dir: string, fileName: string): string {
  const available = (candidate: string): boolean =>
    !existsSync(candidate) && !reservedPaths.has(reserveKey(candidate))

  const first = join(dir, fileName)
  if (available(first)) return first

  const ext = extname(fileName)
  const stem = ext ? fileName.slice(0, -ext.length) : fileName
  for (let index = 1; index < 1000; index++) {
    const candidate = join(dir, `${stem} (${index})${ext}`)
    if (available(candidate)) return candidate
  }
  return join(dir, `${stem} (${Date.now()})${ext}`)
}

export function initWorkbenchDownloadService(provider: WorkspaceProvider): void {
  workspaceProvider = provider
  if (registered) return
  registered = true

  session.fromPartition('persist:shared').on('will-download', (_event, item, webContents) => {
    try {
      // 只接管 AI 侧 Webview 的下载；主界面自身导出等仍走默认保存框。
      if (!webContents) return
      if (webContents.getType() !== 'webview' && !webContents.hostWebContents) return
      // 生图批量下载由 ImageDownloadService 指定目录，避免两边重复 setSavePath。
      if (hasActiveNativeDownloadContext(webContents.id)) return

      const workspaceRoot = workspaceProvider?.()
      if (!workspaceRoot || !existsSync(workspaceRoot)) return

      const suggestedPath = uniquePath(workspaceRoot, safeFileName(item.getFilename(), item.getURL()))
      // 不调用 setSavePath：保留 Electron 默认保存框，仅把默认目录指向当前工作区。
      item.setSaveDialogOptions({ defaultPath: suggestedPath })
      reservedPaths.add(reserveKey(suggestedPath))
      item.once('done', (_e, state) => {
        reservedPaths.delete(reserveKey(suggestedPath))
        console.log('[workbench-dl] done file=%s state=%s', item.getSavePath(), state)
      })
      console.log(
        '[workbench-dl] save dialog default file=%s url=%s',
        suggestedPath,
        (item.getURL() || '').slice(0, 120)
      )
    } catch (err) {
      console.warn('[workbench-dl] intercept failed:', err)
    }
  })
}
