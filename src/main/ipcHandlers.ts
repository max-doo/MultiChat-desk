/**
 * IPC 处理器模块
 * 负责处理主进程与渲染进程之间的 IPC 通信
 */

import { app, ipcMain, dialog, clipboard, BrowserWindow, shell, screen, webContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { basename, extname, join, dirname, resolve } from 'path'
import { stat, writeFile, mkdtemp, rm, rename } from 'fs/promises'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type Store from 'electron-store'
import { setQuitting, getQuickWindow, showAndFocusWindow, hideToolbarWindow, getCachedSelectionText, openDiagnosticsWindow, registerQuickPrimaryWebview, setQuickSidebarExpanded, handleWebviewContextMenuAction, setNoteManager } from './webviewManager'
import type { WebviewContextMenuActionRequest } from '../shared/types/contextMenu'
import { broadcastStateChange } from './stateBus'
import { HistoryManager, normalizeHistory } from './api/historyManager'
import { isDeepStrictEqual } from 'util'
import { NoteManager } from './noteManager'
import type { NoteConversation, NoteDraft, NoteNavigation, MindmapModifyRequest } from '../shared/types/notes'
import { noteConversationKey } from '../shared/utils/noteIdentity'
import { generateNoteCaptureScript, generateMindmapPageStateScript, generateAppendMindmapQuestionScript } from '../shared/utils/webviewScripts'
import { MindmapService } from './services/MindmapService'
import { TaskSplitService } from './services/TaskSplitService'
import { normalizeNoteTranscriptMarkdown } from '../shared/utils/noteTranscript'
import { getShortcuts, updateShortcuts, type ShortcutConfig } from './shortcutManager'
import { readPlatformSelection, getAccessibilityPermissionStatus, requestAccessibilityPermission } from './platform/selectionReader'
import {
    listSummaryPrompts,
    bootstrapSummaryPrompts,
    writeSummaryPrompt,
    deleteSummaryPrompt,
    ensureSummaryPromptsDir,
    getSummaryPromptsDir,
    type SummaryPromptFileItem
} from './summaryPrompts'
import { automationService, dispatchFileDrop } from './services/AutomationService'
import { checkForUpdate, getUpdateState } from './updater/checker'
import { getSelectionToolbarEnabled, setSelectionToolbarEnabled } from './selectionToolbarManager'
import { getCliStatus, dismissCliHint, addCliDirToPath, openCliLocation } from './cliIntegration'
import { registerBatchDownload, awaitImageDownloadResult } from './services/ImageDownloadService'
import {
    selectFolder as workbenchSelectFolder,
    readTree as workbenchReadTree,
    readFile as workbenchReadFile,
    readPdfBytes as workbenchReadPdfBytes,
    writeFile as workbenchWriteFile,
    createNode as workbenchCreateNode,
    renameNode as workbenchRenameNode,
    deleteNode as workbenchDeleteNode,
    search as workbenchSearch,
    getWorkspaceTags as workbenchGetWorkspaceTags,
    revealFile as workbenchRevealFile,
  openFileInSystem as workbenchOpenFileInSystem,
  saveImage as workbenchSaveImage,
  importImageFile as workbenchImportImageFile,
  findUnreferencedImages as workbenchFindUnreferencedImages,
  deleteNodes as workbenchDeleteNodes,
  importExternalPaths as workbenchImportExternalPaths,
  watchWorkspace as workbenchWatchWorkspace,
  unwatchWorkspace as workbenchUnwatchWorkspace,
  ensureDefaultWorkspace as workbenchEnsureDefaultWorkspace,
  statFile as workbenchStatFile
} from './services/workbenchService'
import type { WorkbenchNodeType } from '../shared/types/workbench'
import {
    getStatus as gitGetStatus,
    commit as gitCommit,
    pullFastForward as gitPullFastForward,
    mergeUpstream as gitMergeUpstream,
    abortMerge as gitAbortMerge,
    push as gitPush,
    initRepository as gitInitRepository,
    listRemotes as gitListRemotes,
    setRemoteUrl as gitSetRemoteUrl
} from './services/gitService'
import {
    readGitignore as readWorkspaceGitignore,
    writeGitignore as writeWorkspaceGitignore,
    GITIGNORE_CATEGORIES
} from './services/gitignoreService'
import type { GitignoreEntry } from '../shared/types/workbench'

// 诊断窗口 probe/run-research 透传请求挂起表
const pendingProbeRequests = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
const pendingRunResearchRequests = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>()

/**
 * 注册所有 IPC 处理器
 * @param store Electron Store 实例
 * @param getMainWindow 获取主窗口的函数
 * @param openBrowserWindowInternal 打开内部浏览器窗口的函数
 */
export async function registerIpcHandlers(
    store: Store<Record<string, unknown>>,
    getMainWindow: () => BrowserWindow | null,
    openBrowserWindowInternal: (url: string) => void
): Promise<void> {
    const historyManager = new HistoryManager(store)
    await historyManager.ready
    let customMaximizeState: {
        windowId: number
        restoreBounds: Electron.Rectangle
    } | null = null

    const restoreCustomMaximizedWindowForDrag = (win: BrowserWindow, cursorPoint: Electron.Point): void => {
        if (process.platform !== 'win32' || customMaximizeState?.windowId !== win.id) return

        const maximizedBounds = win.getBounds()
        const restoreBounds = customMaximizeState.restoreBounds
        const workArea = screen.getDisplayNearestPoint(cursorPoint).workArea
        const cursorRatioX = Math.min(1, Math.max(0, (cursorPoint.x - maximizedBounds.x) / maximizedBounds.width))
        const unclampedX = Math.round(cursorPoint.x - restoreBounds.width * cursorRatioX)
        const maxX = Math.max(workArea.x, workArea.x + workArea.width - restoreBounds.width)

        win.setBounds({
            ...restoreBounds,
            x: Math.min(maxX, Math.max(workArea.x, unclampedX)),
            y: workArea.y
        }, false)
        customMaximizeState = null
    }

    const toggleWindowsCustomMaximize = (win: BrowserWindow): void => {
        if (customMaximizeState?.windowId === win.id) {
            const restoreBounds = customMaximizeState.restoreBounds
            customMaximizeState = null
            win.setBounds(restoreBounds, false)
            return
        }

        // 绕过 Windows 原生 maximize() 的 DWM / Chromium swap-chain 重建。
        // 多 WebView 主窗口在该原生过渡中会短暂显示黑帧。
        const workArea = screen.getDisplayMatching(win.getBounds()).workArea
        customMaximizeState = {
            windowId: win.id,
            restoreBounds: win.getBounds()
        }
        win.setBounds(workArea, false)
    }

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
    ipcMain.handle('quick:register-primary-webview', (event, id: number) => {
        if (event.sender !== getQuickWindow()?.webContents || !Number.isInteger(id)) return { success: false }
        return { success: registerQuickPrimaryWebview(id) }
    })
    ipcMain.handle('quick:set-sidebar-expanded', (event, expanded: boolean, panelWidth: number) => {
        if (event.sender !== getQuickWindow()?.webContents || typeof expanded !== 'boolean' || !Number.isFinite(panelWidth) || panelWidth < 0 || panelWidth > 1400) return { success: false }
        return { success: true, data: setQuickSidebarExpanded(expanded, panelWidth) }
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

    // macOS 使用原生 traffic lights 与 app-region 拖动，不注册 Windows 风格的手动拖动 IPC。
    if (process.platform !== 'darwin') {
      let dragState: {
        windowId: number
        startMousePoint: Electron.Point
        startContentBounds: Electron.Rectangle
        restoredAfterStart: boolean
      } | null = null

      ipcMain.on('window-drag-start', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return
        const cursorPoint = screen.getCursorScreenPoint()
        dragState = {
          windowId: win.id,
          startMousePoint: cursorPoint,
          startContentBounds: win.getContentBounds(),
          restoredAfterStart: false
        }
      })

      ipcMain.on('window-drag-move', (event) => {
        if (!dragState) return
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win || win.id !== dragState.windowId) return
        
        // 仅在实际发生拖动时（首个 move 事件）才还原最大化窗口，
        // 避免最大化状态下单纯点击标题栏误触发还原。
        if (!dragState.restoredAfterStart) {
          restoreCustomMaximizedWindowForDrag(win, dragState.startMousePoint)
          // 还原后窗口位置已切换为"跟随光标"语义，基准需重置为当前实际位置
          dragState.startContentBounds = win.getContentBounds()
          dragState.startMousePoint = screen.getCursorScreenPoint()
          dragState.restoredAfterStart = true
        }

        const currentMousePoint = screen.getCursorScreenPoint()
        const deltaX = currentMousePoint.x - dragState.startMousePoint.x
        const deltaY = currentMousePoint.y - dragState.startMousePoint.y

        // 固定内容尺寸，避免 Windows 隐形边框在 setPosition 中被递归累加。
        win.setContentBounds({
          x: dragState.startContentBounds.x + deltaX,
          y: dragState.startContentBounds.y + deltaY,
          width: dragState.startContentBounds.width,
          height: dragState.startContentBounds.height
        })
      })

      ipcMain.on('window-drag-end', () => {
        dragState = null
      })
    }

    // IPC 处理器：WebView 右键菜单操作
    ipcMain.handle('webview:execute-contextmenu-action', async (_event, args: WebviewContextMenuActionRequest) => {
        return await handleWebviewContextMenuAction(args.wcId, args.actionKey, args.data)
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
                // 自绘菜单点击后，宿主 BrowserWindow 可能失去 WebView 的输入焦点。
                // Electron 要求 sendInputEvent 的宿主窗口处于焦点状态，因此先恢复宿主窗口，
                // 再向目标 WebView 发送平台对应的原生粘贴快捷键，避免直接改 DOM value。
                const focusedWindow = BrowserWindow.getFocusedWindow()
                if (focusedWindow && !focusedWindow.isDestroyed()) {
                    focusedWindow.focus()
                }
                target.focus()
                const modifier = process.platform === 'darwin' ? 'command' : 'control'
                target.sendInputEvent({
                    type: 'keyDown',
                    keyCode: 'V',
                    modifiers: [modifier]
                })
                target.sendInputEvent({
                    type: 'keyUp',
                    keyCode: 'V',
                    modifiers: [modifier]
                })
                console.log('[ContextMenu] 执行 paste 完成 (原生快捷键):', modifier === 'command' ? 'Command+V' : 'Ctrl+V')
                return { success: true, method: 'native-keyboard-paste' }
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
        if (!win) return
        if (process.platform === 'win32') {
            toggleWindowsCustomMaximize(win)
        } else if (win.isMaximized()) {
            win.unmaximize()
        } else {
            win.maximize()
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

    // IPC 处理器：将渲染层拖入的文件内容写入本地临时文件。
    // 不直接信任 renderer 中 File.path，避免虚拟文件/浏览器拖拽产生不可用路径。
    ipcMain.handle('create-temp-upload-file', async (_event, params: {
        fileName: string
        mimeType?: string
        data: ArrayBuffer | Uint8Array
    }) => {
        try {
            if (!params || typeof params.fileName !== 'string' || !params.fileName.trim()) {
                return { success: false, error: '缺少文件名' }
            }

            const safeFileName = basename(params.fileName)
            if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
                return { success: false, error: '文件名无效' }
            }

            const data = params.data
            let bytes: Uint8Array
            if (data instanceof ArrayBuffer) {
                bytes = new Uint8Array(data)
            } else if (ArrayBuffer.isView(data)) {
                bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            } else {
                return { success: false, error: '文件内容无效' }
            }

            const tempDir = await mkdtemp(join(tmpdir(), 'multichat-uploads-'))
            const filePath = join(tempDir, safeFileName)
            await writeFile(filePath, bytes)

            return {
                success: true,
                data: {
                    filePath,
                    fileName: safeFileName,
                    mimeType: params.mimeType || 'application/octet-stream',
                    size: bytes.byteLength
                }
            }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    // IPC 处理器：清理拖拽上传创建的临时目录。
    ipcMain.handle('cleanup-upload-temp', async (_event, filePath: string) => {
        if (!filePath || typeof filePath !== 'string') {
            return { success: false, error: 'invalid filePath' }
        }

        const tempRoot = resolve(tmpdir())
        const targetDir = resolve(dirname(filePath))
        const dirName = basename(targetDir)
        const isAllowed = dirname(targetDir) === tempRoot && dirName.startsWith('multichat-uploads-')
        if (!isAllowed) {
            return { success: false, error: 'path not under multichat upload temp root' }
        }

        try {
            await rm(targetDir, { recursive: true, force: true })
            return { success: true }
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

    // IPC 处理器：向 webview 发送鼠标移动事件（用于悬停触发 Hover 菜单）
    ipcMain.handle('send-mouse-move', async (_event, params: {
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

            wc.sendInputEvent({
                type: 'mouseMove',
                x: Math.round(params.x),
                y: Math.round(params.y)
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
        try {
            const { webContents } = require('electron')
            const wc = webContents.fromId(params.webContentsId)

            if (!wc) {
                return { success: false, error: '未找到 webContents' }
            }

            return await dispatchFileDrop(wc, params.filePath, params.x, params.y)
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    // IPC 处理器：存储操作
    const noteManager = new NoteManager(store)
    setNoteManager(noteManager)
    // 每个窗口仅保留最近一次采集，启动/创建时取走；窗口释放后可随之回收。
    const capturedSources = new WeakMap<Electron.WebContents, NoteConversation>()
    const takeMindmapSource = async (sender: Electron.WebContents, conversationId: string): Promise<NoteConversation> => {
        const captured = capturedSources.get(sender)
        capturedSources.delete(sender)
        const source = captured?.id === conversationId ? captured : await noteManager.get(conversationId)
        if (!source) throw new Error('来源会话不存在')
        return source
    }
    const broadcastNotes = (channel: 'notes:changed' | 'mindmaps:task-changed', data?: unknown): void => {
        BrowserWindow.getAllWindows().forEach(window => {
            try {
                if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, data)
            } catch {
                // 某个窗口关闭或通知失败不能阻断任务，也不能影响其他窗口接收状态。
                console.warn('[Notes] 窗口通知失败:', channel)
            }
        })
    }
    const notesChanged = (): void => broadcastNotes('notes:changed')
    const mindmapService = new MindmapService(noteManager, task => broadcastNotes('mindmaps:task-changed', task), notesChanged)
    app.once('before-quit', () => mindmapService.shutdown())
    const mindmapOwners = new WeakSet<Electron.WebContents>()
    const trackMindmapOwner = (sender: Electron.WebContents): void => {
        if (mindmapOwners.has(sender)) return
        mindmapOwners.add(sender)
        sender.once('destroyed', () => mindmapService.forgetOwner(sender.id))
    }
    ipcMain.handle('mindmaps:modify', async (event, request: MindmapModifyRequest) => {
        try {
            trackMindmapOwner(event.sender)
            return { success: true, data: await mindmapService.modify(request, event.sender.id, async source => {
                // 工作台文档没有对话页面，始终使用保存的正文，不尝试采集 webview。
                if (source.workbench) return { snapshot: source.snapshot, origin: 'snapshot' }
                if (!request.source) {
                    const saved = await noteManager.get(source.id)
                    return { snapshot: saved.snapshot, origin: 'snapshot' }
                }
                if (!request.source.webContentsId) throw new Error('来源主会话未就绪，请加载完成后重试')
                const current = await captureMindmapSource(event.sender, request.source.webContentsId, request.source.platformId, request.source.name, source.sourceKey)
                return { snapshot: current.snapshot, origin: 'live' }
            }) }
        }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '调整失败' } }
    })
    ipcMain.handle('mindmaps:candidate', (event, mapId: string) => ({ success: true, data: mindmapService.getCandidate(event.sender.id, mapId) }))
    ipcMain.handle('mindmaps:apply', async (event, mapId: string, candidateId: string) => {
        try { return { success: true, data: await mindmapService.apply(event.sender.id, mapId, candidateId) } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '保存失败，候选已保留' } }
    })
    ipcMain.handle('mindmaps:discard', (event, mapId: string, candidateId: string) => {
        try { mindmapService.discard(event.sender.id, mapId, candidateId); return { success: true } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '放弃失败' } }
    })
    ipcMain.handle('mindmaps:ask', async (event, id: number, platformId: string, conversationId: string, question: string) => {
        try {
            if (typeof question !== 'string' || !question.trim() || question.length > 60000) throw new Error('问题草稿无效或过大')
            const wc = webContents.fromId(id)
            if (!wc || wc.isDestroyed() || wc.hostWebContents?.id !== event.sender.id) throw new Error('请先打开来源主会话')
            const source = await noteManager.get(conversationId)
            const identity = await wc.executeJavaScript('({url:location.href,title:document.title})') as { url: string; title: string }
            if (noteConversationKey(identity.url, identity.title) !== source.sourceKey) throw new Error('来源页面身份不匹配，请先回到来源对话')
            const selectors = await automationService.getPlatformSelectors(platformId)
            const result = await wc.executeJavaScript(generateAppendMindmapQuestionScript(question, identity.url, selectors)) as { success: boolean; error?: string }
            if (result.success) wc.focus()
            return result
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '追问注入失败，草稿已保留' } }
    })
    ipcMain.handle('mindmaps:blank-source', async (event, id: number, expectedUrl: string, platformName: string) => {
        try {
            const wc = webContents.fromId(id)
            if (!wc || wc.isDestroyed() || wc.hostWebContents?.id !== event.sender.id || typeof expectedUrl !== 'string' || !expectedUrl.startsWith('https://') || wc.getURL() !== expectedUrl || typeof platformName !== 'string' || platformName.length > 200) throw new Error('来源页面已切换或未就绪')
            const identity = await wc.executeJavaScript('({url:location.href,title:document.title})') as { url: string; title: string }
            if (wc.getURL() !== expectedUrl || identity.url !== expectedUrl) throw new Error('来源页面已切换')
            const source = await noteManager.prepareSource({ platform: platformName, title: identity.title, url: identity.url, snapshot: '' })
            const saved = await noteManager.addMindmap(source, '# 我的知识导图\n', '本地')
            notesChanged()
            return { success: true, data: { conversation: await noteManager.get(saved.conversationId), mindmap: saved.mindmap } }
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '创建空白图失败' } }
    })
    async function captureMindmapSource(sender: Electron.WebContents, id: number, platform: string, name: string, expectedSourceKey?: string): Promise<NoteConversation> {
            const source = webContents.fromId(id)
            if (!source || source.isDestroyed() || source.hostWebContents?.id !== sender.id) throw new Error('来源主会话未就绪，请打开来源对话后重试')
            const originalUrl = source.getURL()
            if (expectedSourceKey && noteConversationKey(originalUrl, source.getTitle()) !== expectedSourceKey) throw new Error('来源主会话已切换，未发送上下文')
            const selectors = await automationService.getPlatformSelectors(platform)
            const state = await source.executeJavaScript(generateMindmapPageStateScript(selectors, platform)) as { busy: boolean }
            if (state.busy) throw new Error('当前回复尚未完成，请完成后再生成')
            const capture = await source.executeJavaScript(generateNoteCaptureScript()) as { snapshot?: string; title?: string; url?: string }
            if (capture.url !== originalUrl || source.getURL() !== originalUrl) throw new Error('采集时对话已切换，请在目标对话重新生成')
            const data = await noteManager.prepareSource({ platform: name, title: capture.title || name, url: capture.url || '', snapshot: capture.snapshot || '' })
            if (expectedSourceKey && data.sourceKey !== expectedSourceKey) throw new Error('来源主会话身份不匹配，未发送上下文')
            if (data.snapshot !== normalizeNoteTranscriptMarkdown(capture.snapshot || '')) throw new Error('本次采集较短或缺少已有批注原文，已保留原快照。请确认完整对话已加载后重试')
            return data
    }
    ipcMain.handle('notes:capture-source', async (event, id: number, platform: string, name: string) => {
        capturedSources.delete(event.sender)
        try {
            const data = await captureMindmapSource(event.sender, id, platform, name)
            capturedSources.set(event.sender, data)
            return { success: true, data }
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '读取对话失败' } }
    })
    ipcMain.handle('mindmaps:start', async (event, conversationId: string, platform: string, additionalRequirements?: string, material?: { text: string; fileName: string; kind: 'document' | 'selection'; scope?: { scope: 'document' | 'selection'; contentHash: string; selectionText?: string; headingPath?: string[] } }) => {
        try {
            if (additionalRequirements !== undefined && typeof additionalRequirements !== 'string') throw new Error('额外要求必须是文本')
            if (material !== undefined && (!material || typeof material.text !== 'string' || typeof material.fileName !== 'string' || (material.kind !== 'document' && material.kind !== 'selection'))) throw new Error('生成材料无效')
            const source = await takeMindmapSource(event.sender, conversationId)
            trackMindmapOwner(event.sender)
            return { success: true, data: await mindmapService.start(source, platform, additionalRequirements?.trim(), event.sender.id, material) }
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '启动失败' } }
    })
    ipcMain.handle('mindmaps:task', () => ({ success: true, data: mindmapService.getTask() }))
    ipcMain.handle('mindmaps:cancel', (event, id: string) => {
        try { mindmapService.cancel(id, event.sender.id); return { success: true } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('mindmaps:show', async (event, id: string) => {
        try { await mindmapService.show(id, BrowserWindow.fromWebContents(event.sender)); return { success: true } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('mindmaps:add', async (event, conversationId: string, markdown: string) => {
        try {
            const source = await takeMindmapSource(event.sender, conversationId)
            const saved = await noteManager.addMindmap(source, markdown, '本地')
            notesChanged(); return { success: true, data: saved.mindmap }
        } catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('mindmaps:update', async (_event, conversationId: string, id: string, markdown: string, title: string, updatedAt: number) => {
        try { const data = await noteManager.updateMindmap(conversationId, id, markdown, title, updatedAt); notesChanged(); return { success: true, data } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('mindmaps:delete', async (_event, conversationId: string, id: string) => {
        try { await noteManager.deleteMindmap(conversationId, id); mindmapService.forgetMap(id); notesChanged(); return { success: true } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('mindmaps:import-legacy', async (_event, markdown: string) => {
        try { const data = await noteManager.importLegacyMindmap(markdown); notesChanged(); return { success: true, data } }
        catch (error) { return { success: false, error: String(error) } }
    })
    let pendingNoteNavigation: NoteNavigation | null = null
    ipcMain.handle('notes:open', (_event, navigation: NoteNavigation) => {
        if (!navigation || typeof navigation.conversationId !== 'string') return { success: false, error: '无效的笔记定位' }
        pendingNoteNavigation = navigation
        const mainWindow = getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: '主窗口未就绪' }
        mainWindow.webContents.send('notes:navigate', navigation)
        showAndFocusWindow(mainWindow)
        return { success: true }
    })
    ipcMain.handle('notes:consume-navigation', event => {
        if (event.sender.id !== getMainWindow()?.webContents.id) return { success: false, error: '仅主窗口可读取定位' }
        const data = pendingNoteNavigation
        pendingNoteNavigation = null
        return { success: true, data }
    })

    ipcMain.handle('notes:source', async (_event, key: string) => {
        try { return { success: true, data: await noteManager.findSource(key) } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '读取来源失败' } }
    })
    ipcMain.handle('notes:get', async (_event, id: string) => {
        try { return { success: true, data: await noteManager.get(id) } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '读取笔记失败' } }
    })
    ipcMain.handle('notes:summaries', async (_event, query?: string) => {
        try { return { success: true, data: await noteManager.summaries(query) } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '读取笔记失败' } }
    })
    ipcMain.handle('notes:standalone', async (_event, markdown?: string) => {
        try { if (markdown !== undefined && (typeof markdown !== 'string' || markdown.length > 200_000)) throw new Error('导图内容无效'); const data = await noteManager.standalone(markdown); notesChanged(); return { success: true, data } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '保存本地导图失败' } }
    })
    ipcMain.handle('notes:import', async (_event, values: unknown, overwrite = false) => {
        try { const data = await noteManager.import(values, overwrite); notesChanged(); return { success: true, data } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : '恢复笔记失败' } }
    })
    ipcMain.handle('notes:list', async () => {
        try { return { success: true, data: await noteManager.list() } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('notes:anchors-for-url', async (_event, url: string) => {
        try { return { success: true, data: await noteManager.anchorsForUrl(url) } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('notes:save', async (_event, draft: NoteDraft, comment: string) => {
        try { const data = await noteManager.save(draft, comment); BrowserWindow.getAllWindows().forEach(window => window.webContents.send('notes:changed')); return { success: true, data } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('notes:update', async (_event, conversationId: string, noteId: string, comment: string) => {
        try { const data = await noteManager.updateNote(conversationId, noteId, comment); BrowserWindow.getAllWindows().forEach(window => window.webContents.send('notes:changed')); return { success: true, data } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('notes:delete', async (_event, conversationId: string, noteId: string) => {
        try {
            const task = mindmapService.getTask()
            if (task?.conversationId === conversationId && !['done', 'error', 'cancelled'].includes(task.phase)) {
                const source = (await noteManager.list()).find(item => item.id === conversationId)
                if (source?.notes.length === 1 && !source.mindmaps.length) throw new Error('正在为该会话生成导图，请完成或取消后再删除最后一条批注')
            }
            await noteManager.deleteNote(conversationId, noteId); notesChanged(); return { success: true }
        }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('notes:export', async (event) => {
        try {
            const owner = BrowserWindow.fromWebContents(event.sender)
            if (!owner) return { success: false, error: '找不到当前窗口' }
            const result = await dialog.showSaveDialog(owner, {
                title: '导出笔记',
                defaultPath: 'multichat-notes.md',
                filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'JSON', extensions: ['json'] }]
            })
            if (result.canceled || !result.filePath) return { success: true, data: false }
            const conversations = await noteManager.list()
            if (result.filePath.toLowerCase().endsWith('.json')) {
                // 备份保留工作台导图（含来源绑定），否则换机后无法恢复。
                await writeFile(result.filePath, JSON.stringify(conversations, null, 2), 'utf8')
            } else {
                // Markdown 导出面向阅读：工作台文档正文已在工作区文件里，跳过避免重复。
                const markdown = conversations.filter(item => !item.workbench).map(item => {
                    const snapshot = normalizeNoteTranscriptMarkdown(item.snapshot)
                    const annotations = item.notes.map((note, index) => `### 笔记 ${index + 1}\n\n> ${note.quote.replace(/\n/g, '\n> ')}\n\n${note.comment || ''}`).join('\n\n')
                    const mindmaps = item.mindmaps.map(map => `### ${map.title}\n\n${map.markdown}`).join('\n\n')
                    return `# ${item.title}\n\n来源：${item.platform} · ${item.url}\n\n${snapshot}\n\n---\n\n## 我的笔记\n\n${annotations}\n\n## 思维导图\n\n${mindmaps}`
                }).join('\n\n---\n\n')
                await writeFile(result.filePath, markdown, 'utf8')
            }
            return { success: true, data: true }
        } catch (error) { return { success: false, error: String(error) } }
    })

    ipcMain.handle('store-get', (_event, key: string) => {
        return store.get(key)
    })

    ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
        if (key === 'history' || key === 'summaryHistory' || key === 'historyStorageVersion') throw new Error('历史数据请通过专用接口保存')
        store.set(key, value)
    })
    ipcMain.handle('store-delete', (_event, key: string) => {
        if (key === 'history' || key === 'summaryHistory' || key === 'historyStorageVersion') throw new Error('历史数据请通过专用接口删除')
        store.delete(key)
    })
    const historyResult = async (operation: () => Promise<unknown>, changed = false): Promise<{ success: boolean; data?: unknown; error?: string }> => {
        try {
            const data = await operation()
            if (changed) BrowserWindow.getAllWindows().forEach(window => window.webContents.send('history:changed'))
            return { success: true, data }
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '历史操作失败' } }
    }
    for (const [prefix, kind] of [['history', 'conversation'], ['summary-history', 'summary']] as const) {
        ipcMain.handle(`${prefix}:get-page`, (_event, offset: number, limit: number) => historyResult(() => historyManager.page(kind, offset, limit)))
        ipcMain.handle(`${prefix}:get-total-count`, () => historyResult(() => historyManager.count(kind)))
    }
    ipcMain.handle('history:search', (_event, kind: 'conversation' | 'summary', query: string) => historyResult(() => historyManager.search(kind, query)))
    ipcMain.handle('history:status', () => historyResult(() => historyManager.status()))
    ipcMain.handle('history:get', (_event, kind: 'conversation' | 'summary', id: string) => historyResult(() => historyManager.get(kind, id)))
    ipcMain.handle('history:create', (_event, kind: 'conversation' | 'summary', item: unknown) => historyResult(() => historyManager.create(kind, item), true))
    ipcMain.handle('history:update', (_event, kind: 'conversation' | 'summary', id: string, patch: unknown) => historyResult(() => historyManager.update(kind, id, patch), true))
    ipcMain.handle('history:remove', (_event, kind: 'conversation' | 'summary', ids: string[]) => historyResult(() => historyManager.remove(kind, ids), true))
    ipcMain.handle('history:import', (_event, kind: 'conversation' | 'summary', values: unknown, overwrite = false) => historyResult(() => historyManager.import(kind, values, overwrite), true))

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
                'history', 'summaryHistory', 'notes', 'geminiAccountUrl'
            ]
            const keys = knownKeys.filter(k => parsed[k] !== undefined)
            for (const [key, kind] of [['history', 'conversation'], ['summaryHistory', 'summary']] as const) {
                if (parsed[key] !== undefined) {
                    if (!Array.isArray(parsed[key])) throw new Error('备份历史必须为数组')
                    const items = (parsed[key] as unknown[]).map((value, index) => normalizeHistory(value, kind, index))
                    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('备份存在重复历史 ID')
                    parsed[key] = items
                }
            }
            if (parsed.notes !== undefined) parsed.notes = noteManager.validateImport(parsed.notes)
            const businessCounts: Record<string, { added: number; unchanged: number; conflicts: number }> = {}
            for (const [key, kind] of [['history', 'conversation'], ['summaryHistory', 'summary']] as const) {
                if (!Array.isArray(parsed[key])) continue
                const local = await historyManager.all(kind)
                const counts = { added: 0, unchanged: 0, conflicts: 0 }
                for (const incoming of parsed[key] as { id: string }[]) {
                    const saved = local.find(item => item.id === incoming.id)
                    if (!saved) counts.added++
                    else if (isDeepStrictEqual(saved, incoming)) counts.unchanged++
                    else counts.conflicts++
                }
                businessCounts[key] = counts
            }
            if (Array.isArray(parsed.notes)) {
                const local = await noteManager.exportAll()
                const counts = { added: 0, unchanged: 0, conflicts: 0 }
                for (const incoming of parsed.notes as NoteConversation[]) {
                    const saved = local.find(item => item.id === incoming.id || item.sourceKey === incoming.sourceKey)
                    if (!saved) counts.added++
                    else if (isDeepStrictEqual(saved, incoming)) counts.unchanged++
                    else counts.conflicts++
                }
                businessCounts.notes = counts
            }

            // 冲突 = 文件中存在且本地也非空的键（即会覆盖的键）
            const conflicts = keys.filter(k => {
                if (businessCounts[k]) return businessCounts[k].conflicts > 0
                const local = store.get(k)
                if (local === undefined) return false
                if (typeof local === 'string') return local.length > 0
                if (Array.isArray(local)) return local.length > 0
                return true
            })

            // 返回校验后的预览数据；业务记录经专用接口按 ID 合并。
            const data: Record<string, unknown> = {}
            for (const k of keys) {
                data[k] = parsed[k]
            }

            return {
                success: true,
                data: { keys, conflicts, file: result.filePaths[0], values: data, businessCounts }
            }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    // IPC 处理器：任务拆解（后台 Web AI，复用导图后台会话方式）
    const broadcastTaskSplit = (task: unknown): void => {
        BrowserWindow.getAllWindows().forEach(window => {
            try {
                if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('tasksplit:task-changed', task)
            } catch {
                console.warn('[TaskSplit] 窗口通知失败')
            }
        })
    }
    const taskSplitService = new TaskSplitService(task => broadcastTaskSplit(task))
    app.once('before-quit', () => taskSplitService.shutdown())
    const taskSplitOwners = new WeakSet<Electron.WebContents>()
    const trackTaskSplitOwner = (sender: Electron.WebContents): void => {
        if (taskSplitOwners.has(sender)) return
        taskSplitOwners.add(sender)
        sender.once('destroyed', () => taskSplitService.forgetOwner(sender.id))
    }
    ipcMain.handle('tasksplit:start', async (event, goal: string, platform: string, windowCount: number) => {
        try {
            trackTaskSplitOwner(event.sender)
            return { success: true, data: await taskSplitService.start(goal, platform, windowCount, event.sender.id) }
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '启动拆解失败' } }
    })
    ipcMain.handle('tasksplit:task', () => ({ success: true, data: taskSplitService.getTask() }))
    ipcMain.handle('tasksplit:cancel', (event, id: string) => {
        try { taskSplitService.cancel(id, event.sender.id); return { success: true } }
        catch (error) { return { success: false, error: String(error) } }
    })
    ipcMain.handle('tasksplit:show', async (event, id: string) => {
        try { await taskSplitService.show(id, BrowserWindow.fromWebContents(event.sender)); return { success: true } }
        catch (error) { return { success: false, error: String(error) } }
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
                'notes',
                'geminiAccountUrl'
            ]

            const exportData: Record<string, unknown> = {
                _meta: {
                    app: 'MultiChat',
                    exportedAt: new Date().toISOString(),
                    version: '2.0'
                }
            }

            for (const key of keys) {
                const value = key === 'history' ? await historyManager.all('conversation') : key === 'summaryHistory' ? await historyManager.all('summary') : key === 'notes' ? await noteManager.exportAll() : store.get(key)
                if (value !== undefined) {
                    exportData[key] = value
                }
            }

            // 安全处理：将 apiConfig 中的 API Key 替换为 REDACTED
            if (exportData.apiConfig && typeof exportData.apiConfig === 'object') {
                const apiConfig = structuredClone(exportData.apiConfig) as Record<string, unknown>
                exportData.apiConfig = apiConfig
                if (typeof apiConfig.apiKey === 'string' && apiConfig.apiKey) apiConfig.apiKey = '<REDACTED>'
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

            const temporary = `${result.filePath}.${randomUUID()}.tmp`
            try {
                await writeFile(temporary, JSON.stringify(exportData, null, 2), 'utf-8')
                await rename(temporary, result.filePath)
            } finally { await rm(temporary, { force: true }).catch(() => undefined) }

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

        // 为每个 wcId 建上下文（ctx 已建 → 后续 will-download 命中标记位 → setSavePath 跳弹窗）
        for (const it of valid) {
          registerBatchDownload(it.wcId!, { modelId: it.modelId, dir, ts, expectedFromClick: it.clicked })
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
        const perModel = await Promise.all(wcIds.map(wcId => awaitImageDownloadResult(wcId)))
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
        return { success: true, data: getSelectionToolbarEnabled(store) }
    })

    ipcMain.handle('selection-permission:get', () => ({
        success: true,
        data: getAccessibilityPermissionStatus()
    }))

    ipcMain.handle('selection-permission:request', () => ({
        success: true,
        data: requestAccessibilityPermission()
    }))

    ipcMain.handle('selection-toolbar:set', (_event, enabled: boolean) => {
        return setSelectionToolbarEnabled(store, enabled)
    })

    ipcMain.on('toolbar:hide', () => {
        hideToolbarWindow()
    })

    ipcMain.on('toolbar:trigger-action', async (_event, payload: { action: 'quick' | 'summarize' | 'translate' | 'copy' | 'search' }) => {
        // 1. 先读缓存再隐藏（hideToolbarWindow 会清空缓存）。
        // 缓存即本次触发工具条的选区；外部新拖选会先经"点外部即隐藏"收起旧工具条再写入新缓存，故按钮点击时缓存总是新鲜。
        let text = getCachedSelectionText()
        hideToolbarWindow()

        // 兜底：缓存为空时现读一次（工具条通过 showInactive 弹出，此时外部选区仍保持焦点）
        if (!text || text.trim().length === 0) {
            const fresh = (await readPlatformSelection())?.text ?? ''
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

    // ============ 更新检查 IPC（后台提醒版） ============
    ipcMain.handle('update:get-state', () => {
        return { success: true, data: getUpdateState() }
    })

    ipcMain.handle('update:check', async () => {
        try {
            return await checkForUpdate(true)
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    // 返回应用当前版本号（package.json version），供「关于」区块静态展示
    ipcMain.handle('app:get-version', () => {
        return { success: true, data: app.getVersion() }
    })

    // ============ 命令行工具（multichat）集成 ============

    ipcMain.handle('cli:get-status', async () => {
        try {
            return { success: true, data: await getCliStatus(store) }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('cli:add-to-path', async () => {
        try {
            await addCliDirToPath()
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('cli:dismiss-hint', async () => {
        await dismissCliHint(store)
        return { success: true }
    })

    ipcMain.handle('cli:open-location', async (_event, target: 'cli' | 'skill') => {
        try {
            await openCliLocation(target)
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    // ============ 工作台 (Workbench) 文件系统与检索 IPC ============

    ipcMain.handle('workbench:select-folder', async () => {
        try {
            const data = await workbenchSelectFolder(getMainWindow())
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:ensure-default', async () => {
        try {
            const data = await workbenchEnsureDefaultWorkspace(store)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:read-tree', async (_event, payload: string | { workspaceRoot: string }) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const data = await workbenchReadTree(workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:read-file', async (_event, payload: string | { workspaceRoot: string; relativePath: string }, relPath?: string) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const relativePath = typeof payload === 'string' ? relPath! : payload?.relativePath
            const data = await workbenchReadFile(workspaceRoot, relativePath)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    // PDF 原始字节：内置 PDFium 不向宿主暴露选区文字，预览层改用 PDF.js 渲染并自建文本层。
    ipcMain.handle('workbench:read-pdf-bytes', async (_event, payload: { workspaceRoot: string; relativePath: string }) => {
        try {
            const data = await workbenchReadPdfBytes(payload.workspaceRoot, payload.relativePath)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:write-file', async (_event, payload: string | { workspaceRoot: string; relativePath: string; content: string }, relPath?: string, text?: string) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const relativePath = typeof payload === 'string' ? relPath! : payload?.relativePath
            const content = typeof payload === 'string' ? text! : payload?.content
            const data = await workbenchWriteFile(workspaceRoot, relativePath, content ?? '')
            // 保存后同步绑定指纹：外部改名判定要用最新的 size/mtime 与哈希。
            // 不广播 notes:changed：快照没变，没必要让导图面板跟着每次自动保存重载。
            await noteManager.refreshWorkbenchSource(workspaceRoot, relativePath, content ?? '', data)
                .catch(error => console.warn('[Workbench] 导图指纹更新失败:', error))
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:create-node', async (_event, payload: string | { workspaceRoot: string; relativePath: string; type: WorkbenchNodeType }, relPath?: string, nodeType?: WorkbenchNodeType) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const relativePath = typeof payload === 'string' ? relPath! : payload?.relativePath
            const type = (typeof payload === 'string' ? nodeType : payload?.type) ?? 'file'
            const data = await workbenchCreateNode(workspaceRoot, relativePath, type)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:rename-node', async (_event, payload: string | { workspaceRoot: string; oldRelativePath: string; newRelativePath: string }, oldPath?: string, newPath?: string) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const oldRelativePath = typeof payload === 'string' ? oldPath! : payload?.oldRelativePath
            const newRelativePath = typeof payload === 'string' ? newPath! : payload?.newRelativePath
            await workbenchRenameNode(workspaceRoot, oldRelativePath, newRelativePath)
            // 文件已落盘再改绑定；失败只影响导图跟随，不回滚用户的重命名。
            await noteManager.rekeyWorkbenchSource(workspaceRoot, oldRelativePath, newRelativePath)
                .then(moved => { if (moved) notesChanged() })
                .catch(error => console.warn('[Workbench] 导图绑定迁移失败:', error))
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:delete-node', async (_event, payload: string | { workspaceRoot: string; relativePath: string }, relPath?: string) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const relativePath = typeof payload === 'string' ? relPath! : payload?.relativePath
            await workbenchDeleteNode(workspaceRoot, relativePath)
            // 文件移入回收站后才删导图；删除失败时记录保持原样。
            await noteManager.purgeWorkbenchSource(workspaceRoot, [relativePath]).then(count => { if (count) notesChanged() })
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:search', async (_event, payload: string | { workspaceRoot: string; query: string }, q?: string) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const query = typeof payload === 'string' ? q! : payload?.query
            const data = await workbenchSearch(workspaceRoot, query ?? '')
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:get-workspace-tags', async (_event, payload: string | { workspaceRoot: string }) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const data = await workbenchGetWorkspaceTags(workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:reveal-file', async (_event, payload: string | { workspaceRoot: string; relativePath: string }, relPath?: string) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const relativePath = typeof payload === 'string' ? relPath! : payload?.relativePath
            await workbenchRevealFile(workspaceRoot, relativePath)
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:open-in-system', async (_event, payload: string | { workspaceRoot: string; relativePath: string }, relPath?: string) => {
        try {
            const workspaceRoot = typeof payload === 'string' ? payload : payload?.workspaceRoot
            const relativePath = typeof payload === 'string' ? relPath! : payload?.relativePath
            await workbenchOpenFileInSystem(workspaceRoot, relativePath)
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:save-image', async (_event, payload: { workspaceRoot: string; documentRelativePath: string; dataUrl?: string; base64?: string; fileName?: string }) => {
        try {
            const data = await workbenchSaveImage(payload.workspaceRoot, payload.documentRelativePath, {
                dataUrl: payload.dataUrl,
                base64: payload.base64,
                fileName: payload.fileName
            })
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:import-image-file', async (_event, payload: { workspaceRoot: string; documentRelativePath: string; sourceAbsolutePath: string }) => {
        try {
            const data = await workbenchImportImageFile(payload.workspaceRoot, payload.documentRelativePath, payload.sourceAbsolutePath)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:find-unreferenced-images', async (_event, payload: { workspaceRoot: string; documentRelativePath: string }) => {
        try {
            const data = await workbenchFindUnreferencedImages(payload.workspaceRoot, payload.documentRelativePath)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:delete-nodes', async (_event, payload: { workspaceRoot: string; relativePaths: string[] }) => {
        try {
            const data = await workbenchDeleteNodes(payload.workspaceRoot, payload.relativePaths)
            // 只清理真正删除成功的节点，失败项保留绑定，等下次重试。
            if (data.deleted.length) {
                await noteManager.purgeWorkbenchSource(payload.workspaceRoot, data.deleted)
                    .then(count => { if (count) notesChanged() })
            }
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:import-external-paths', async (_event, payload: { workspaceRoot: string; targetDirRelative: string; sourceAbsolutePaths: string[] }) => {
        try {
            const data = await workbenchImportExternalPaths(payload.workspaceRoot, payload.targetDirRelative, payload.sourceAbsolutePaths)
            // 副本是独立记录：源文档的导图整组克隆到新路径，两边之后互不影响。
            if (data.pairs.length) {
                let cloned = 0
                for (const pair of data.pairs) {
                    try {
                        cloned += await noteManager.duplicateWorkbenchSource(payload.workspaceRoot, pair.source, pair.target)
                    } catch (error) {
                        console.warn('[Workbench] 复制导图绑定失败:', pair.target, error)
                    }
                }
                if (cloned) notesChanged()
            }
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    // 工作区文件系统监听：渲染层在打开/切换工作区时调用，外部变更经主进程
    // 单 watcher 聚合去抖后以 workbench:fs-changed 事件广播，驱动文件树重扫
    ipcMain.handle('workbench:watch', (_event, payload: { workspaceRoot: string }) => {
        try {
            workbenchWatchWorkspace(payload.workspaceRoot)
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:unwatch', (_event, payload: { workspaceRoot: string }) => {
        try {
            workbenchUnwatchWorkspace(payload.workspaceRoot)
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    // 轻量 stat：保存前的乐观并发校验（mtime 比对）用，避免带全文的 readFile
    ipcMain.handle('workbench:stat-file', async (_event, payload: { workspaceRoot: string; relativePath: string }) => {
        try {
            const data = await workbenchStatFile(payload.workspaceRoot, payload.relativePath)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    // ============ 工作台版本管理 (Git) ============
    // 只操作工作区范围；提交、拉取、推送的状态判断都在主进程完成，渲染层只负责展示与确认。

    ipcMain.handle('workbench:git-status', async (_event, payload: { workspaceRoot: string }) => {
        try {
            const data = await gitGetStatus(payload.workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-commit', async (_event, payload: { workspaceRoot: string; title: string; body?: string; allowLargeFiles?: boolean }) => {
        try {
            const data = await gitCommit(payload.workspaceRoot, {
                title: payload.title,
                body: payload.body,
                allowLargeFiles: payload.allowLargeFiles
            })
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-pull', async (_event, payload: { workspaceRoot: string }) => {
        try {
            const data = await gitPullFastForward(payload.workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-merge-upstream', async (_event, payload: { workspaceRoot: string }) => {
        try {
            const data = await gitMergeUpstream(payload.workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-abort-merge', async (_event, payload: { workspaceRoot: string }) => {
        try {
            const data = await gitAbortMerge(payload.workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-push', async (_event, payload: { workspaceRoot: string; setUpstream?: boolean }) => {
        try {
            const data = await gitPush(payload.workspaceRoot, Boolean(payload.setUpstream))
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-init', async (_event, payload: { workspaceRoot: string }) => {
        try {
            const data = await gitInitRepository(payload.workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-remotes', async (_event, payload: { workspaceRoot: string }) => {
        try {
            const data = await gitListRemotes(payload.workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:git-set-remote', async (_event, payload: { workspaceRoot: string; url: string; name?: string }) => {
        try {
            const data = await gitSetRemoteUrl(payload.workspaceRoot, payload.url, payload.name)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:gitignore-read', async (_event, payload: { workspaceRoot: string }) => {
        try {
            const data = await readWorkspaceGitignore(payload.workspaceRoot)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:gitignore-write', async (_event, payload: { workspaceRoot: string; entries: GitignoreEntry[] }) => {
        try {
            await writeWorkspaceGitignore(payload.workspaceRoot, payload.entries)
            return { success: true }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:gitignore-categories', async () => {
        return { success: true, data: GITIGNORE_CATEGORIES }
    })

    // 工作台导图：按文档路径取或建来源记录，并同步当前正文。
    // 记录里的 size/mtime 用于外部改名判定，生成时顺手补上，避免下次对账多读一次盘。
    ipcMain.handle('workbench:mindmap-source', async (_event, payload: { workspaceRoot: string; relativePath: string; title?: string; create?: boolean; content?: string }) => {
        try {
            const title = payload.title || payload.relativePath.split('/').pop() || payload.relativePath
            // 只是打开文档时不建记录，避免给每篇看过的文档留一条空笔记。
            if (payload.create === false) {
                const existing = await noteManager.findWorkbenchSource(payload.workspaceRoot, payload.relativePath)
                return { success: true, data: existing ?? null }
            }
            // 优先用编辑器内存内容：生成时的正文可能尚未落盘，用磁盘版本会让“基于旧版本”判断失真。
            let content = payload.content
            let stat: { size: number; mtime: number } | undefined
            if (content === undefined) {
                const info = await workbenchReadFile(payload.workspaceRoot, payload.relativePath)
                if (info.isBinary) throw new Error('该格式暂不支持生成思维导图')
                content = info.content
                stat = { size: info.size, mtime: info.mtime }
            } else {
                // 内存内容没有现成的 size/mtime，读一次 stat 即可（不会附带全文）。
                const info = await workbenchStatFile(payload.workspaceRoot, payload.relativePath).catch(() => null)
                if (info) stat = info
            }
            const data = await noteManager.prepareWorkbenchSource(payload.workspaceRoot, payload.relativePath, title, content, stat)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    // 外部删除/改名无法拦截，由文件树刷新后对账：路径消失且找不到同一文件 → 删导图。
    // index 由渲染层随文件树一起传入，正常路径下对账零额外 IO。
    ipcMain.handle('workbench:reconcile-mindmaps', async (_event, payload: { workspaceRoot: string; index?: Array<{ path: string; size?: number; mtime?: number }> }) => {
        try {
            if (!Array.isArray(payload.index)) return { success: false, error: '缺少文件树索引' }
            const index = new Map(payload.index.map(item => [item.path, { size: item.size, mtime: item.mtime }]))
            const data = await noteManager.reconcileWorkbenchSources(payload.workspaceRoot, index)
            if (data.deleted || data.relinked) notesChanged()
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

    ipcMain.handle('workbench:mindmap-impact', async (_event, payload: { workspaceRoot: string; relativePaths: string[] }) => {
        try {
            const data = await noteManager.workbenchTrashImpact(payload.workspaceRoot, payload.relativePaths)
            return { success: true, data }
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })

}
