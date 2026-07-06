/**
 * IPC 处理器模块
 * 负责处理主进程与渲染进程之间的 IPC 通信
 */

import { app, ipcMain, dialog, clipboard, BrowserWindow, shell, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { basename, extname, join, dirname, resolve } from 'path'
import { stat, writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import type Store from 'electron-store'
import { generateSummary, fetchModels } from './api/summaryApi'
import { splitTask } from './api/taskSplitApi'
import { setQuitting, getQuickWindow, showAndFocusWindow, hideToolbarWindow, getCachedSelectionText, openDiagnosticsWindow } from './webviewManager'
import { startInputHook, stopInputHook } from './inputHookManager'
import { broadcastStateChange } from './stateBus'
import { HistoryManager } from './api/historyManager'
import { getShortcuts, updateShortcuts, type ShortcutConfig } from './shortcutManager'
import { readSelection } from './uiaSelectionHelper'
import {
    listSummaryPrompts,
    bootstrapSummaryPrompts,
    writeSummaryPrompt,
    deleteSummaryPrompt,
    ensureSummaryPromptsDir,
    getSummaryPromptsDir,
    type SummaryPromptFileItem
} from './summaryPrompts'
import { automationService } from './services/AutomationService'

// 存储当前的 AbortController，用于终止请求
let currentSummaryAbortController: AbortController | null = null

// 诊断窗口 probe/run-research 透传请求挂起表
const pendingProbeRequests = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
const pendingRunResearchRequests = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>()

interface NativeDownloadResult {
  modelId: string
  saved: number
  failed: number
  errors: string[]
}
interface NativeDownloadCtx {
  dir: string
  modelId: string
  ts: string
  seq: number
  saved: number
  failed: number
  errors: string[]
  timer: NodeJS.Timeout
  expectedFromClick: number
  arrived: number
}
// 活动上下文：will-download 命中这里即拦截 + setSavePath
const nativeCtxByWcId = new Map<number, NativeDownloadCtx>()
// 已完成结果暂存：finalize 后移到这里，wait 来取。消除"will-download 早于 wait 完成"的时序竞态。
const nativeDoneByWcId = new Map<number, NativeDownloadResult>()

function finalizeIfDone(wcId: number): void {
  const ctx = nativeCtxByWcId.get(wcId)
  if (!ctx) return
  if (ctx.arrived >= ctx.expectedFromClick) {
    clearTimeout(ctx.timer)
    nativeDoneByWcId.set(wcId, {
      modelId: ctx.modelId,
      saved: ctx.saved,
      failed: ctx.failed,
      errors: ctx.errors
    })
    nativeCtxByWcId.delete(wcId)
  }
}

function finalizeForce(wcId: number): void {
  const ctx = nativeCtxByWcId.get(wcId)
  if (!ctx) return
  clearTimeout(ctx.timer)
  nativeDoneByWcId.set(wcId, {
    modelId: ctx.modelId,
    saved: ctx.saved,
    failed: ctx.failed,
    errors: ctx.errors
  })
  nativeCtxByWcId.delete(wcId)
}

let willDownloadRegistered = false
function ensureWillDownloadListener(): void {
  if (willDownloadRegistered) return
  willDownloadRegistered = true
  const shared = session.fromPartition('persist:shared')
  shared.on('will-download', (event, item, webContents) => {
    const wcId = webContents?.id
    const ctx = wcId ? nativeCtxByWcId.get(wcId) : undefined
    if (!ctx) return

    event.preventDefault()
    const seq = ++ctx.seq

    const url = item.getURL() || ''
    const fn = item.getFilename() || ''
    const ext = /\.(png|jpe?g|webp|gif|bmp)$/i.test(fn) ? fn.match(/\.(png|jpe?g|webp|gif|bmp)$/i)![1].toLowerCase()
             : /\.(png|jpe?g|webp|gif|bmp)$/i.test(url) ? (url.match(/\.(png|jpe?g|webp|gif|bmp)$/i)![1].toLowerCase())
             : 'png'

    const fileName = `${ctx.modelId}-${ctx.ts}-${seq}.${ext === 'jpg' ? 'jpg' : ext}`
    item.setSavePath(join(ctx.dir, fileName))

    item.on('done', (_e, state) => {
      ctx.arrived++
      if (state === 'completed') {
        ctx.saved++
      } else {
        ctx.failed++
        ctx.errors.push(`图 ${seq}: ${state}`)
      }
      finalizeIfDone(wcId!)
    })
  })
}

/**
 * 中止并清理当前的 AbortController。
 * 在发起新的 summary / split-task 之前调用，确保上一个请求的流被真正取消，
 * 避免 fetch + reader 挂起（旧 controller 被覆盖而不 abort 会泄漏连接）。
 */
function abortCurrentSummaryRequest(): void {
    if (currentSummaryAbortController) {
        currentSummaryAbortController.abort()
        currentSummaryAbortController = null
    }
}

/**
 * 注册所有 IPC 处理器
 * @param store Electron Store 实例
 * @param getMainWindow 获取主窗口的函数
 * @param openBrowserWindowInternal 打开内部浏览器窗口的函数
 */
export function registerIpcHandlers(
    store: Store<Record<string, unknown>>,
    getMainWindow: () => BrowserWindow | null,
    openBrowserWindowInternal: (url: string) => void
): void {

    ipcMain.handle('tray:show-main', () => {
        const w = getMainWindow()
        if (w) showAndFocusWindow(w)
        getQuickWindow()?.hide()
        return { success: true }
    })
    ipcMain.handle('tray:hide-main', () => {
        getMainWindow()?.hide()
        return { success: true }
    })
    ipcMain.handle('tray:quit-app', () => {
        setQuitting(true)
        app.quit()
        return { success: true }
    })
    ipcMain.handle('quick:show', (_e, opts?: { focus?: boolean }) => {
        const qw = getQuickWindow()
        if (!qw) return { success: false, error: 'Quick Window not initialized' }
        if (opts?.focus === false) {
            qw.show()
        } else {
            showAndFocusWindow(qw)
        }
        return { success: true }
    })
    ipcMain.handle('quick:hide', () => {
        getQuickWindow()?.hide()
        return { success: true }
    })
    ipcMain.handle('quick:get-always-on-top', () => {
        const qw = getQuickWindow()
        return qw ? qw.isAlwaysOnTop() : false
    })
    ipcMain.handle('quick:set-always-on-top', (_e, flag: boolean) => {
        const qw = getQuickWindow()
        if (qw) {
            qw.setAlwaysOnTop(flag)
        }
        return { success: true }
    })

    ipcMain.handle('diagnostics:open-window', () => {
        if (!is.dev) return { success: false, error: 'dev-only' }
        openDiagnosticsWindow()
        return { success: true }
    })

    ipcMain.handle('diagnostics:probe', async (_e, payload: { modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }) => {
        if (!is.dev) return { success: false, error: 'dev-only' }
        const mainWin = getMainWindow()
        if (!mainWin || mainWin.isDestroyed()) {
            return { success: false, error: '主窗口未就绪' }
        }
        const reqId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        // pick 模式需用户手动点选平台页元素，超时放宽到 60s（其余维持 5s）
        const timeoutMs = payload.type === 'pick' ? 60000 : 5000
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingProbeRequests.delete(reqId)
                resolve({ success: false, error: '主窗口响应超时' })
            }, timeoutMs)
            pendingProbeRequests.set(reqId, { resolve, timer })
            mainWin.webContents.send('diagnostics:probe-request', { reqId, ...payload })
        })
    })

    ipcMain.on('diagnostics:probe-response', (_e, payload: { reqId: string; result: unknown }) => {
        const pending = pendingProbeRequests.get(payload.reqId)
        if (!pending) return
        clearTimeout(pending.timer)
        pendingProbeRequests.delete(payload.reqId)
        pending.resolve({ success: true, data: payload.result })
    })

    ipcMain.handle('diagnostics:run-research', async (_e, payload: { modelId: string }) => {
        if (!is.dev) return { success: false, error: 'dev-only' }
        const mainWin = getMainWindow()
        if (!mainWin || mainWin.isDestroyed()) {
            return { success: false, error: '主窗口未就绪' }
        }
        const reqId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingRunResearchRequests.delete(reqId)
                resolve({ success: false, error: '主窗口响应超时' })
            }, 15000)
            pendingRunResearchRequests.set(reqId, { resolve, timer })
            mainWin.webContents.send('diagnostics:run-research-request', { reqId, ...payload })
        })
    })

    ipcMain.on('diagnostics:run-research-response', (_e, payload: { reqId: string; result: { success: boolean; error?: string } }) => {
        const pending = pendingRunResearchRequests.get(payload.reqId)
        if (!pending) return
        clearTimeout(pending.timer)
        pendingRunResearchRequests.delete(payload.reqId)
        pending.resolve({ success: true, data: payload.result })
    })

    ipcMain.on('state:sync', (event, partialState: Record<string, unknown>) => {
        broadcastStateChange(event.sender.id, partialState)
    })
    ipcMain.handle('shortcut:get', () => {
        return { success: true, data: getShortcuts() }
    })
    ipcMain.handle('shortcut:set', (_event, config: Partial<ShortcutConfig>) => {
        return updateShortcuts(config)
    })

    // 窗口拖拽状态
    let dragStartMousePoint: { x: number, y: number } | null = null
    let dragStartContentBounds: Electron.Rectangle | null = null

    ipcMain.on('window-drag-start', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return
        const { screen } = require('electron')
        dragStartMousePoint = screen.getCursorScreenPoint()
        dragStartContentBounds = win.getContentBounds()
    })

    ipcMain.on('window-drag-move', (event) => {
        if (!dragStartMousePoint || !dragStartContentBounds) return
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return
        
        const { screen } = require('electron')
        const currentMousePoint = screen.getCursorScreenPoint()
        const deltaX = currentMousePoint.x - dragStartMousePoint.x
        const deltaY = currentMousePoint.y - dragStartMousePoint.y
        
        win.setContentBounds({
            x: dragStartContentBounds.x + deltaX,
            y: dragStartContentBounds.y + deltaY,
            width: dragStartContentBounds.width,
            height: dragStartContentBounds.height
        })
    })

    ipcMain.on('window-drag-end', () => {
        dragStartMousePoint = null
        dragStartContentBounds = null
    })

    // IPC 处理器：右键菜单操作
    ipcMain.handle('perform-contextmenu-action', async (_event, args: { wcId: number, action: 'copy' | 'paste' | 'save-image', data?: { url?: string } }) => {
        try {
            // 使用 webContents.getAllWebContents() 获取所有 webContents，包括 webview 标签的
            const { webContents } = require('electron')
            const allWc = webContents.getAllWebContents()
            console.log('[ContextMenu] 查找 wcId:', args.wcId, '所有 webContents IDs:', allWc.map((w: Electron.WebContents) => w.id))

            const target = allWc.find((w: Electron.WebContents) => w.id === args.wcId)

            if (!target) {
                console.error('[ContextMenu] 未找到目标 webContents, wcId:', args.wcId)
                return { success: false, error: '未找到目标内容窗口' }
            }

            console.log('[ContextMenu] 找到目标 webContents, action:', args.action)

            if (args.action === 'copy') {
                // 先尝试让 webContents 获得焦点
                target.focus()
                // 使用 Electron 内置的 copy 命令
                target.copy()
                console.log('[ContextMenu] 执行 copy 完成')
                return { success: true }
            }
            if (args.action === 'paste') {
                // 先让 webContents 获得焦点
                target.focus()

                // 读取剪贴板内容
                const clipboardText = clipboard.readText()
                console.log('[ContextMenu] 剪贴板内容:', clipboardText?.substring(0, 50))

                if (clipboardText) {
                    // 在 webview 中执行 JavaScript 来插入文本
                    // 这种方式更可靠，不依赖于 DOM 焦点状态
                    try {
                        await target.executeJavaScript(`
              (function() {
                const activeEl = document.activeElement;
                const clipText = ${JSON.stringify(clipboardText)};
                
                // 如果是输入框或文本域
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                  const start = activeEl.selectionStart || 0;
                  const end = activeEl.selectionEnd || 0;
                  const value = activeEl.value;
                  activeEl.value = value.slice(0, start) + clipText + value.slice(end);
                  activeEl.selectionStart = activeEl.selectionEnd = start + clipText.length;
                  activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                  return { success: true, method: 'input' };
                }
                
                // 如果是 contenteditable 元素
                if (activeEl && activeEl.isContentEditable) {
                  document.execCommand('insertText', false, clipText);
                  return { success: true, method: 'contenteditable' };
                }
                
                // 尝试找到页面中的可编辑元素
                const editables = document.querySelectorAll('input, textarea, [contenteditable="true"]');
                for (const el of editables) {
                  if (el.matches(':focus') || el.closest(':focus')) {
                    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                      el.value += clipText;
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      return { success: true, method: 'found-input' };
                    } else {
                      el.focus();
                      document.execCommand('insertText', false, clipText);
                      return { success: true, method: 'found-contenteditable' };
                    }
                  }
                }
                
                // 最后尝试使用系统粘贴
                document.execCommand('paste');
                return { success: true, method: 'execCommand' };
              })();
            `)
                        console.log('[ContextMenu] 执行 paste 完成 (通过 JS 注入)')
                        return { success: true }
                    } catch (jsError) {
                        console.error('[ContextMenu] JS 注入粘贴失败:', jsError)
                        // 回退到原生粘贴
                        target.paste()
                        return { success: true }
                    }
                } else {
                    // 剪贴板为空时使用原生粘贴
                    target.paste()
                    console.log('[ContextMenu] 执行 paste 完成 (原生)')
                    return { success: true }
                }
            }
            if (args.action === 'save-image') {
                const url = args.data?.url || ''
                let ext = 'png'
                let name = 'image.png'
                try {
                    const u = new URL(url)
                    const pathname = u.pathname
                    const base = basename(pathname) || ''
                    const idx = base.lastIndexOf('.')
                    ext = idx !== -1 ? base.slice(idx + 1) : ext
                    name = base || `image.${ext}`
                } catch {
                    // URL 解析失败时使用默认文件名
                }

                const result = await dialog.showSaveDialog({
                    title: '图片另存为',
                    defaultPath: name,
                    filters: [{ name: '图片', extensions: [ext, 'png', 'jpg', 'jpeg', 'gif', 'webp'] }]
                })
                if (result.canceled || !result.filePath) {
                    return { success: false, error: '用户取消' }
                }
                const savePath = result.filePath

                if (url.startsWith('data:')) {
                    const match = url.match(/^data:(.*?);base64,(.*)$/)
                    if (!match) return { success: false, error: '无效图片数据' }
                    const content = Buffer.from(match[2], 'base64')
                    const { writeFile } = await import('fs/promises')
                    await writeFile(savePath, content)
                    return { success: true, filePath: savePath }
                }

                const session = target.session
                const once = (_ev: Electron.Event, item: Electron.DownloadItem): void => {
                    if (item.getURL() === url) {
                        item.setSavePath(savePath)
                        session.removeListener('will-download', once)
                    }
                }
                session.on('will-download', once)
                target.downloadURL(url)
                return { success: true, filePath: savePath }
            }

            return { success: false, error: '未知操作' }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    // IPC 处理器：窗口控制
    ipcMain.on('window-minimize', () => {
        getMainWindow()?.minimize()
    })

    ipcMain.on('window-maximize', () => {
        const win = getMainWindow()
        if (win?.isMaximized()) {
            win.unmaximize()
        } else {
            win?.maximize()
        }
    })

    ipcMain.on('window-close', (event) => {
        // 作用于 sender 窗口：主窗口与诊断窗口等所有无边框窗口共用此 IPC
        BrowserWindow.fromWebContents(event.sender)?.close()
    })

    // 作用于 sender 窗口的置顶切换（诊断窗口等独立窗口用）
    ipcMain.handle('window-set-always-on-top', (event, pinned: boolean) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win || win.isDestroyed()) return { success: false, error: '窗口已销毁' }
        win.setAlwaysOnTop(pinned)
        return { success: true, data: win.isAlwaysOnTop() }
    })

    // IPC 处理器：文件选择
    ipcMain.handle('select-file', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile']
        })

        if (result.canceled) return null
        return result.filePaths[0]
    })

    ipcMain.handle('get-file-info', async (_event, filePath: string) => {
        try {
            const info = await stat(filePath)
            const fileName = basename(filePath)
            const ext = extname(filePath).toLowerCase()

            const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.pdf': 'application/pdf',
                '.txt': 'text/plain',
                '.md': 'text/markdown',
                '.markdown': 'text/markdown',
                '.json': 'application/json',
                '.jsonl': 'application/json',
                '.yml': 'text/yaml',
                '.yaml': 'text/yaml',
                '.toml': 'application/toml',
                '.ini': 'text/plain',
                '.conf': 'text/plain',
                '.cfg': 'text/plain',
                '.log': 'text/plain',
                '.xml': 'application/xml',
                '.html': 'text/html',
                '.htm': 'text/html',
                '.css': 'text/css',
                '.scss': 'text/x-scss',
                '.less': 'text/x-less',
                '.js': 'text/javascript',
                '.mjs': 'text/javascript',
                '.cjs': 'text/javascript',
                '.ts': 'text/typescript',
                '.tsx': 'text/typescript',
                '.jsx': 'text/javascript',
                '.vue': 'text/plain',
                '.svelte': 'text/plain',
                '.py': 'text/x-python',
                '.java': 'text/x-java-source',
                '.kt': 'text/x-kotlin',
                '.kts': 'text/x-kotlin',
                '.go': 'text/x-go',
                '.rs': 'text/x-rust',
                '.c': 'text/x-c',
                '.h': 'text/x-c',
                '.cpp': 'text/x-c++',
                '.cc': 'text/x-c++',
                '.cxx': 'text/x-c++',
                '.hpp': 'text/x-c++',
                '.cs': 'text/plain',
                '.php': 'text/x-php',
                '.rb': 'text/x-ruby',
                '.swift': 'text/x-swift',
                '.scala': 'text/x-scala',
                '.sh': 'text/x-shellscript',
                '.bash': 'text/x-shellscript',
                '.zsh': 'text/x-shellscript',
                '.ps1': 'text/plain',
                '.bat': 'text/plain',
                '.cmd': 'text/plain',
                '.sql': 'application/sql',
                '.csv': 'text/csv',
                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            }

            const mimeType = mimeTypes[ext] || 'application/octet-stream'

            return {
                success: true,
                data: {
                    filePath,
                    fileName,
                    mimeType,
                    size: info.size
                }
            }
        } catch (error) {
            return {
                success: false,
                error: String(error)
            }
        }
    })

    // IPC 处理器：选择导出目录
    ipcMain.handle('select-directory', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        })

        if (result.canceled) return null
        return result.filePaths[0]
    })

    // IPC 处理器：读取剪贴板文本
    ipcMain.handle('read-clipboard-text', () => {
        return clipboard.readText()
    })

    // IPC 处理器：读取剪贴板 HTML（用于获取富文本格式）
    ipcMain.handle('read-clipboard-html', () => {
        return clipboard.readHTML()
    })

    // IPC 处理器：读取剪贴板图片并保存为临时文件
    ipcMain.handle('read-clipboard-image', async () => {
        try {
            const image = clipboard.readImage()
            if (image.isEmpty()) {
                return { success: false, error: '剪贴板中没有图片' }
            }

            const buffer = image.toPNG()
            const tempDir = await mkdtemp(join(tmpdir(), 'multichat-paste-'))
            const filePath = join(tempDir, 'pasted-image.png')
            await writeFile(filePath, buffer)

            return {
                success: true,
                data: {
                    filePath,
                    fileName: 'pasted-image.png',
                    mimeType: 'image/png',
                    size: buffer.length
                }
            }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    // IPC 处理器：清理粘贴图片产生的临时目录（multichat-paste-*）
    // 渲染层传入 readClipboardImage 返回的 filePath，main 层自行 dirname 取目录
    ipcMain.handle('cleanup-paste-temp', async (_event, filePath: string) => {
        if (!filePath || typeof filePath !== 'string') {
            return { success: false, error: 'invalid filePath' }
        }
        const targetDir = dirname(filePath)
        // 仅允许清理本应用 tmpdir 下的 multichat-paste-* 目录，防止任意路径删除
        const tempRoot = tmpdir()
        const resolved = resolve(targetDir)
        const base = resolve(join(tempRoot, 'multichat-paste-'))
        if (!resolved.startsWith(base)) {
            return { success: false, error: 'path not under multichat-paste temp root' }
        }
        try {
            await rm(resolved, { recursive: true, force: true })
            return { success: true }
        } catch (e) {
            return { success: false, error: String(e) }
        }
    })

    // IPC 处理器：向 webview 发送鼠标点击事件（用于触发 Gemini 复制按钮）
    ipcMain.handle('send-mouse-click', async (_event, params: {
        webContentsId: number,
        x: number,
        y: number
    }) => {
        try {
            const { webContents } = require('electron')
            const wc = webContents.fromId(params.webContentsId)

            if (!wc) {
                return { success: false, error: '未找到 webContents' }
            }

            // 发送鼠标按下事件
            wc.sendInputEvent({
                type: 'mouseDown',
                x: Math.round(params.x),
                y: Math.round(params.y),
                button: 'left',
                clickCount: 1
            })

            // 短暂延迟后发送鼠标释放事件
            await new Promise(r => setTimeout(r, 50))

            wc.sendInputEvent({
                type: 'mouseUp',
                x: Math.round(params.x),
                y: Math.round(params.y),
                button: 'left',
                clickCount: 1
            })

            return { success: true }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('dispatch-file-drop', async (_event, params: {
        webContentsId: number
        filePath: string
        x: number
        y: number
    }) => {
        let attachedByUs = false
        try {
            const { webContents } = require('electron')
            const wc = webContents.fromId(params.webContentsId)

            if (!wc) {
                return { success: false, error: '未找到 webContents' }
            }

            const x = Math.max(0, Math.round(params.x))
            const y = Math.max(0, Math.round(params.y))

            try {
                if (!wc.debugger.isAttached()) {
                    wc.debugger.attach('1.3')
                    attachedByUs = true
                }
            } catch (error) {
                return { success: false, error: `无法附加调试器: ${String(error)}` }
            }

            const dragData = {
                items: [],
                files: [params.filePath],
                dragOperationsMask: 1
            }

            await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data: dragData })
            await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', x, y, data: dragData })
            await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'drop', x, y, data: dragData })

            return { success: true }
        } catch (error) {
            return { success: false, error: String(error) }
        } finally {
            try {
                const { webContents } = require('electron')
                const wc = webContents.fromId(params.webContentsId)
                if (wc && attachedByUs && wc.debugger.isAttached()) {
                    wc.debugger.detach()
                }
            } catch {
                // 调试器可能已经自动分离，忽略错误
            }
        }
    })

    // IPC 处理器：存储操作
    // History 分页与磁盘上限管理（只读分页 + store-set 后 enforce）
    const historyManager = new HistoryManager(store)

    ipcMain.handle('store-get', (_event, key: string) => {
        return store.get(key)
    })

    ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
        store.set(key, value)
        // 写 history/summaryHistory 后 enforce 磁盘上限 1000
        if (key === 'history' || key === 'summaryHistory') {
            try {
                historyManager.enforceDiskLimit()
            } catch (err) {
                console.error('[historyManager] enforceDiskLimit failed:', err)
            }
        }
    })

    ipcMain.handle('store-delete', (_event, key: string) => {
        store.delete(key)
    })

    // History 分页（只读）
    ipcMain.handle('history:get-page', (_event, offset: number, limit: number) => {
        return { success: true, data: historyManager.getHistoryPage(offset, limit) }
    })

    ipcMain.handle('history:get-total-count', () => {
        return { success: true, data: historyManager.getHistoryTotalCount() }
    })

    ipcMain.handle('summary-history:get-page', (_event, offset: number, limit: number) => {
        return { success: true, data: historyManager.getSummaryHistoryPage(offset, limit) }
    })

    ipcMain.handle('summary-history:get-total-count', () => {
        return { success: true, data: historyManager.getSummaryHistoryTotalCount() }
    })

    // Summary Prompts 相关
    ipcMain.handle('summary-prompts-bootstrap', async (_event, prompts: SummaryPromptFileItem[]) => {
        await bootstrapSummaryPrompts(Array.isArray(prompts) ? prompts : [])
    })

    ipcMain.handle('summary-prompts-list', async () => {
        return await listSummaryPrompts()
    })

    ipcMain.handle('summary-prompts-write', async (_event, prompt: SummaryPromptFileItem) => {
        await writeSummaryPrompt(prompt)
    })

    ipcMain.handle('summary-prompts-delete', async (_event, id: string) => {
        await deleteSummaryPrompt(id)
    })

    ipcMain.handle('summary-prompts-open-folder', async () => {
        await ensureSummaryPromptsDir()
        await shell.openPath(getSummaryPromptsDir())
    })

    // 用系统资源管理器打开指定路径（如导出文件夹）
    // shell.openPath 成功返回空串，失败返回错误描述字符串
    ipcMain.handle('open-path', async (_event, path: string) => {
        if (!path || typeof path !== 'string') {
            return { success: false, error: '路径为空' }
        }
        const err = await shell.openPath(path)
        return err ? { success: false, error: err } : { success: true }
    })

    // 导入缓存数据：读取用户选择的 JSON → 校验 _meta.app → 返回预览数据（不直接写入）
    ipcMain.handle('import-cache', async () => {
        try {
            const { readFile } = await import('fs/promises')

            const result = await dialog.showOpenDialog({
                title: '导入缓存数据',
                properties: ['openFile'],
                filters: [{ name: 'JSON 文件', extensions: ['json'] }]
            })
            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, error: '用户取消' }
            }

            const raw = await readFile(result.filePaths[0], 'utf-8')
            let parsed: Record<string, unknown>
            try {
                parsed = JSON.parse(raw)
            } catch {
                return { success: false, error: '文件不是合法的 JSON' }
            }

            const meta = parsed._meta as { app?: string } | undefined
            if (!meta || meta.app !== 'MultiChat') {
                return { success: false, error: '非本应用缓存文件' }
            }

            // 复用导出键列表，找出文件中存在哪些键
            const knownKeys = [
                'displayMode', 'models', 'apiConfig', 'summaryModels',
                'history', 'summaryHistory', 'geminiAccountUrl'
            ]
            const keys = knownKeys.filter(k => parsed[k] !== undefined)
            // 冲突 = 文件中存在且本地也非空的键（即会覆盖的键）
            const conflicts = keys.filter(k => {
                const local = store.get(k)
                if (local === undefined) return false
                if (typeof local === 'string') return local.length > 0
                if (Array.isArray(local)) return local.length > 0
                return true
            })

            // 返回完整解析数据，供渲染层预览确认后逐键 storeSet 写入
            const data: Record<string, unknown> = {}
            for (const k of keys) {
                data[k] = parsed[k]
            }

            return {
                success: true,
                data: { keys, conflicts, file: result.filePaths[0], values: data }
            }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    // IPC 处理器：终止当前的总结生成
    ipcMain.handle('abort-summary', async () => {
        if (currentSummaryAbortController) {
            console.log('[Summary API] ⏹️ 收到终止请求，正在中断...')
            abortCurrentSummaryRequest()
            return { success: true }
        }
        return { success: false, error: '没有正在进行的请求' }
    })

    // IPC 处理器：调用 OpenAI 兼容 API 生成总结（支持流式输出）
    ipcMain.handle('generate-summary', async (event, params: {
        apiKey: string
        baseUrl?: string  // 可选，默认 OpenAI
        model: string
        systemPrompt: string
        userContent: string
        modelOutputs?: Array<{ name: string; content: string }>
        userRequirement?: string
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>  // 对话历史
        temperature?: number
        topP?: number
        maxTokens?: number
        includeReasoning?: boolean
    }) => {
        // 先中止上一个进行中的请求（覆盖而不 abort 会泄漏 fetch + reader），再创建新的
        abortCurrentSummaryRequest()
        // 创建 AbortController 用于支持终止请求
        currentSummaryAbortController = new AbortController()
        const { signal } = currentSummaryAbortController
        // 取本地引用：onChunk 闭包中止的应是“自己这次”的 controller，
        // 即使后续模块变量被其他请求覆盖也不会错位（配合 T4 的覆盖前 abort）
        const controller = currentSummaryAbortController

        try {
            const result = await generateSummary(
                params,
                signal,
                (chunk) => {
                    // 渲染进程已销毁（窗口关闭等）：中止请求，避免对死 sender 持续 send + 空转 reader
                    if (event.sender.isDestroyed()) {
                        controller.abort()
                        return
                    }
                    // 通过 IPC 发送流式数据块到渲染进程
                    event.sender.send('summary-stream-chunk', chunk)
                }
            )

            // 清理 AbortController
            currentSummaryAbortController = null
            return result
        } catch (error) {
            // 清理 AbortController
            currentSummaryAbortController = null
            throw error
        }
    })

    // IPC 处理器：任务拆解（复用总结的 AbortController 以支持中止）
    ipcMain.handle('split-task', async (_event, params: {
        apiKey: string
        baseUrl?: string
        model: string
        goal: string
        temperature?: number
        maxTokens?: number
        windowCount?: number
    }) => {
        // 与 generate-summary 共用同一 controller：先 abort 上一个（可能是正在进行的 summary），
        // 避免旧流挂起；这也是 split-task 能正确获得中止能力的前提
        abortCurrentSummaryRequest()
        currentSummaryAbortController = new AbortController()
        const { signal } = currentSummaryAbortController
        try {
            const result = await splitTask(params, signal)
            currentSummaryAbortController = null
            return result
        } catch (error) {
            currentSummaryAbortController = null
            throw error
        }
    })

    // IPC 处理器：中止任务拆解
    ipcMain.handle('abort-split-task', async () => {
        if (currentSummaryAbortController) {
            abortCurrentSummaryRequest()
            return { success: true }
        }
        return { success: false, error: '没有正在进行的拆解请求' }
    })

    // IPC 处理器：获取模型列表
    ipcMain.handle('fetch-models', async (_event, params: {
        apiKey: string
        baseUrl: string
    }) => {
        return await fetchModels(params)
    })

    // IPC 处理器：导出缓存数据到 JSON 文件
    ipcMain.handle('export-cache', async () => {
        try {
            const { writeFile } = await import('fs/promises')

            // 读取所有相关 store 键
            const keys = [
                'displayMode',
                'models',
                'apiConfig',
                'summaryModels',
                'history',
                'summaryHistory',
                'geminiAccountUrl'
            ]

            const exportData: Record<string, unknown> = {
                _meta: {
                    app: 'MultiChat',
                    exportedAt: new Date().toISOString(),
                    version: '1.0'
                }
            }

            for (const key of keys) {
                const value = store.get(key)
                if (value !== undefined) {
                    exportData[key] = value
                }
            }

            // 安全处理：将 apiConfig 中的 API Key 替换为 REDACTED
            if (exportData.apiConfig && typeof exportData.apiConfig === 'object') {
                const apiConfig = exportData.apiConfig as Record<string, unknown>
                if (Array.isArray(apiConfig.providers)) {
                    apiConfig.providers = apiConfig.providers.map((provider: unknown) => {
                        if (provider && typeof provider === 'object') {
                            const p = { ...provider as Record<string, unknown> }
                            if (p.apiKey && typeof p.apiKey === 'string' && p.apiKey.length > 0) {
                                p.apiKey = '<REDACTED>'
                            }
                            return p
                        }
                        return provider
                    })
                }
            }

            const result = await dialog.showSaveDialog({
                title: '导出缓存数据',
                defaultPath: `multichat-cache-${new Date().toISOString().slice(0, 10)}.json`,
                filters: [
                    { name: 'JSON 文件', extensions: ['json'] }
                ]
            })

            if (result.canceled || !result.filePath) {
                return { success: false, error: '用户取消' }
            }

            await writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')

            return {
                success: true,
                filePath: result.filePath
            }
        } catch (error) {
            return {
                success: false,
                error: String(error)
            }
        }
    })

    // IPC 处理器：导出报告到文件
    ipcMain.handle('export-report', async (_event, params: {
        content: string
        fileName: string
        directory?: string
    }) => {
        try {
            const { writeFile } = await import('fs/promises')

            let filePath: string

            if (params.directory) {
                filePath = join(params.directory, params.fileName)
            } else {
                const result = await dialog.showSaveDialog({
                    title: '保存报告',
                    defaultPath: params.fileName,
                    filters: [
                        { name: 'Markdown', extensions: ['md'] },
                        { name: '文本文件', extensions: ['txt'] }
                    ]
                })

                if (result.canceled || !result.filePath) {
                    return { success: false, error: '用户取消' }
                }

                filePath = result.filePath
                // 如果用户在对话框中删除了后缀名，自动补回 .md
                if (!extname(filePath)) {
                    filePath = filePath + '.md'
                }
            }

            await writeFile(filePath, params.content, 'utf-8')

            return {
                success: true,
                filePath
            }
        } catch (error) {
            return {
                success: false,
                error: String(error)
            }
        }
    })

    ipcMain.handle('save-image-from-url', async (_event, imageUrl: string) => {
        try {
            let defaultName = 'image'
            try {
                const u = new URL(imageUrl)
                const base = basename(u.pathname) || ''
                defaultName = base || defaultName
            } catch {
                // URL 解析失败时使用默认文件名
            }

            const result = await dialog.showSaveDialog({
                title: '图片另存为',
                defaultPath: defaultName,
                filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
            })
            if (result.canceled || !result.filePath) {
                return { success: false, error: '用户取消' }
            }
            const filePath = result.filePath

            if (imageUrl.startsWith('data:')) {
                const match = imageUrl.match(/^data:(.*?);base64,(.*)$/)
                if (!match) return { success: false, error: '无效图片数据' }
                const content = Buffer.from(match[2], 'base64')
                const { writeFile } = await import('fs/promises')
                await writeFile(filePath, content)
                return { success: true, filePath }
            }

            const response = await fetch(imageUrl)
            if (!response.ok) {
                return { success: false, error: `下载失败: ${response.status} ${response.statusText}` }
            }
            const arrayBuffer = await response.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            const { writeFile } = await import('fs/promises')
            await writeFile(filePath, buffer)
            return { success: true, filePath }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('image:download-all', async (_event, payload: {
      items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
    }) => {
      try {
        if (!payload?.items?.length) {
          return { success: false, error: '无可下载的图片' }
        }
        const dirResult = await dialog.showOpenDialog({
          title: '选择图片保存目录',
          properties: ['openDirectory']
        })
        if (dirResult.canceled || !dirResult.filePaths?.length) {
          return { success: false, error: '用户取消' }
        }
        const dir = dirResult.filePaths[0]
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
        const { writeFile } = await import('fs/promises')
        const extByMime: Record<string, string> = {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/webp': 'webp',
          'image/gif': 'gif',
          'image/bmp': 'bmp'
        }
        const perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> = []
        for (const item of payload.items) {
          let saved = 0
          let failed = 0
          const errors: string[] = []
          for (let idx = 0; idx < item.images.length; idx++) {
            const img = item.images[idx]
            const mime = img.mime || 'image/png'
            const ext = extByMime[mime] || 'png'
            const fileName = `${item.modelId}-${ts}-${idx + 1}.${ext}`
            const filePath = join(dir, fileName)
            try {
              if (img.src.startsWith('data:')) {
                const match = img.src.match(/^data:.*?;base64,(.*)$/)
                if (!match) throw new Error('无效 data URL')
                await writeFile(filePath, Buffer.from(match[1], 'base64'))
              } else {
                const resp = await fetch(img.src)
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
                const buf = Buffer.from(await resp.arrayBuffer())
                await writeFile(filePath, buf)
              }
              saved++
            } catch (e) {
              failed++
              errors.push(`图 ${idx + 1}: ${String(e)}`)
            }
          }
          perModel.push({ modelId: item.modelId, saved, failed, errors })
        }
        return { success: true, data: { perModel } }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    // 生图原生下载：拆成 prepare → wait 两步。
    // 必须先 prepare（建 ctx + 弹目录）→ 渲染层再注入点击 → 最后 wait 等回执。
    // 若合并成一步，ctx 尚未建立时点击已触发 will-download，会被当"非批量下载"放行弹系统框。
    ipcMain.handle('image:download-via-native:prepare', async (_event, payload: {
      items: Array<{ modelId: string; wcId: number | null; clicked: number }>
    }) => {
      try {
        if (!payload?.items?.length) {
          return { success: false, error: '无可下载的图片' }
        }
        // 过滤无效 wcId（getWebContentsId 失败或 0）
        const valid = payload.items.filter(it => it.wcId && it.clicked)
        if (!valid.length) {
          return { success: false, error: '无效的 WebContents ID 或未成功触发点击' }
        }
        const dirResult = await dialog.showOpenDialog({
          title: '选择图片保存目录',
          properties: ['openDirectory']
        })
        if (dirResult.canceled || !dirResult.filePaths?.length) {
          return { success: false, error: '用户取消' }
        }
        const dir = dirResult.filePaths[0]
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

        ensureWillDownloadListener()

        // 为每个 wcId 建上下文（ctx 已建 → 后续 will-download 命中标记位 → setSavePath 跳弹窗）
        for (const it of valid) {
          const wcId = it.wcId!
          // 清理同 wcId 残留（防御性，避免上次未 finalize 的 ctx/done 残留）
          const stale = nativeCtxByWcId.get(wcId)
          if (stale) {
            clearTimeout(stale.timer)
            nativeCtxByWcId.delete(wcId)
          }
          nativeDoneByWcId.delete(wcId)
          const timer = setTimeout(() => {
            const ctx = nativeCtxByWcId.get(wcId)
            if (ctx) {
              ctx.failed += (it.clicked - ctx.arrived)
              ctx.errors.push('超时未触发下载')
              finalizeForce(wcId)
            }
          }, 30000)
          nativeCtxByWcId.set(wcId, {
            dir,
            modelId: it.modelId,
            ts,
            seq: 0,
            saved: 0,
            failed: 0,
            errors: [],
            timer,
            expectedFromClick: it.clicked,
            arrived: 0
          })
        }
        return { success: true, data: { dir, ts, wcIds: valid.map(it => it.wcId!) } }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    ipcMain.handle('image:download-via-native:wait', async (_event, payload: {
      wcIds: number[]
    }) => {
      try {
        const wcIds = payload?.wcIds?.filter(id => typeof id === 'number') ?? []
        if (!wcIds.length) {
          return { success: true, data: { perModel: [] } }
        }
        const perModel = await Promise.all(wcIds.map(async (wcId) => {
          // 若已完成（暂存区有），立即返回
          const done = nativeDoneByWcId.get(wcId)
          if (done) {
            nativeDoneByWcId.delete(wcId)
            return done
          }
          // 否则等 will-download 的 finalize 把结果推进暂存区
          return await new Promise<NativeDownloadResult>(resolve => {
            const check = () => {
              const d = nativeDoneByWcId.get(wcId)
              if (d) {
                nativeDoneByWcId.delete(wcId)
                resolve(d)
                return
              }
              const ctx = nativeCtxByWcId.get(wcId)
              if (!ctx) {
                // ctx 已被超时清掉但暂存区也没（理论上 finalizeForce 会推暂存区，这里是兜底）
                resolve({ modelId: String(wcId), saved: 0, failed: 1, errors: ['上下文已失效'] })
                return
              }
              setTimeout(check, 200)
            }
            check()
          })
        }))
        return { success: true, data: { perModel } }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    // IPC 处理器：打开新浏览器窗口
    ipcMain.handle('open-browser-window', (_event, url: string) => {
        console.log('[Main] Request to open new window:', url)
        openBrowserWindowInternal(url)
    })

    // IPC 处理器：将内容写入临时 markdown 文件
    ipcMain.handle('write-temp-markdown', async (_event, params: {
        content: string
        fileName?: string
    }) => {
        try {
            const tempDir = await mkdtemp(join(tmpdir(), 'multichat-uploads-'))
            const fileName = params.fileName || `multichat-summary-${Date.now()}.md`
            const filePath = join(tempDir, fileName)
            await writeFile(filePath, params.content, 'utf-8')
            return { success: true, filePath }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    // ============ 悬浮工具条 IPC 处理器 ============

    ipcMain.handle('selection-toolbar:get', () => {
        return { success: true, data: store.get('selectionToolbarEnabled', true) as boolean }
    })

    ipcMain.handle('selection-toolbar:set', (_event, enabled: boolean) => {
        store.set('selectionToolbarEnabled', enabled)
        if (enabled) {
            startInputHook()
        } else {
            stopInputHook()
            hideToolbarWindow()
        }
        return { success: true }
    })

    ipcMain.on('toolbar:hide', () => {
        hideToolbarWindow()
    })

    ipcMain.on('toolbar:trigger-action', async (_event, payload: { action: 'quick' | 'summarize' | 'translate' | 'copy' | 'search' }) => {
        // 1. 先读缓存再隐藏（hideToolbarWindow 会清空缓存）。
        // 缓存即本次触发工具条的选区；外部新拖选会先经"点外部即隐藏"收起旧工具条再写入新缓存，故按钮点击时缓存总是新鲜。
        let text = getCachedSelectionText()
        hideToolbarWindow()

        // 兜底：缓存为空时现读一次（选区仍高亮，工具条 focusable:false 不夺焦）
        if (!text || text.trim().length === 0) {
            const fresh = (await readSelection())?.text ?? ''
            if (fresh && fresh.trim().length > 0) {
                text = fresh
            }
        }
        if (!text || text.trim().length === 0) {
            console.warn('[Toolbar] No selected text on action click')
            return
        }

        // 2. copy/quick：把文本写入剪贴板（替代旧 Ctrl+C 的 keepClipboard=true）。
        //    summarize/translate/search：不触碰剪贴板（旧 keepClipboard=false 还原，新行为压根没动剪贴板，等价且更干净）。
        if (payload.action === 'copy' || payload.action === 'quick') {
            clipboard.writeText(text)
        }
        if (payload.action === 'copy') {
            return
        }

        // 3. 召唤并聚焦快捷窗口
        const qw = getQuickWindow()
        if (!qw) return

        showAndFocusWindow(qw)

        // 4. 延迟 300ms 注入 Prompt
        setTimeout(() => {
            if (!qw.isDestroyed()) {
                qw.webContents.send('quick:inject-prompt', {
                    text,
                    action: payload.action
                })
            }
        }, 300)
    })

    // 自动化执行内核接口
    ipcMain.handle('automation:execute', async (_event, platformId: string, prompt: string) => {
        return await automationService.executeCommand(platformId, prompt)
    })
    ipcMain.handle('automation:collect-result', async (_event, platformId: string) => {
        return await automationService.collectResult(platformId)
    })
    ipcMain.handle('automation:dev-test-exec', async (_event, platformId: string, prompt: string) => {
        return await automationService.executeCommand(platformId, prompt)
    })

    /**
     * automation:send-prompt
     * 高层接口：发送 prompt 并等待一段时间后自动收集结果
     * 适合 UI 层（如 appStore）在不关心底层会话创建细节时调用
     * 参数：platformId, prompt, collectDelayMs（可选，默认 5000ms）
     * 返回：{ success, data?: string, error? }
     */
    /** Default delay (ms) before collecting result after sending a prompt. */
    const AUTOMATION_COLLECT_DELAY_MS = 5000

    ipcMain.handle('automation:send-prompt', async (_event, platformId: string, prompt: string, collectDelayMs?: number) => {
        try {
            const execResult = await automationService.executeCommand(platformId, prompt)
            if (!execResult.success) {
                return { success: false, error: execResult.error }
            }
            // 等待模型响应生成（固定延迟，后续可改为轮询感知完成）
            const delay = typeof collectDelayMs === 'number' && collectDelayMs >= 0 ? collectDelayMs : AUTOMATION_COLLECT_DELAY_MS
            await new Promise<void>((resolve) => setTimeout(resolve, delay))
            const collectResult = await automationService.collectResult(platformId)
            return collectResult
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    /**
     * automation:collect
     * 高层接口：仅收集指定平台的最新回复（automation:collect-result 的语义别名）
     * 适合 appStore 在分步轮询场景中调用
     */
    // TODO: Consider merging automation:collect and automation:collect-result in a future refactor.
    ipcMain.handle('automation:collect', async (_event, platformId: string) => {
        try {
            return await automationService.collectResult(platformId)
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })


    // 返回应用当前版本号（package.json version），供「关于」区块静态展示
    ipcMain.handle('app:get-version', () => {
        return { success: true, data: app.getVersion() }
    })

}
