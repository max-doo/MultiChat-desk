/**
 * IPC 处理器模块
 * 负责处理主进程与渲染进程之间的 IPC 通信
 */

import { app, ipcMain, dialog, clipboard, BrowserWindow, shell } from 'electron'
import { basename, extname, join } from 'path'
import { stat, writeFile, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import type Store from 'electron-store'
import { generateSummary, fetchModels } from './api/summaryApi'
import { setQuitting, getQuickWindow } from './webviewManager'
import {
    listAgentPrompts,
    bootstrapAgentPrompts,
    writeAgentPrompt,
    deleteAgentPrompt,
    ensureAgentPromptsDir,
    getAgentPromptsDir,
    type AgentPromptFileItem
} from './agentPrompts'

// 存储当前的 AbortController，用于终止请求
let currentSummaryAbortController: AbortController | null = null

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
        if (w) { w.show(); w.focus() }
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
        qw.show()
        if (opts?.focus !== false) qw.focus()
        return { success: true }
    })
    ipcMain.handle('quick:hide', () => {
        getQuickWindow()?.hide()
        return { success: true }
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

    ipcMain.on('window-close', () => {
        getMainWindow()?.close()
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
    ipcMain.handle('store-get', (_event, key: string) => {
        return store.get(key)
    })

    ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
        store.set(key, value)
    })

    ipcMain.handle('store-delete', (_event, key: string) => {
        store.delete(key)
    })

    // Agent Prompts 相关
    ipcMain.handle('agent-prompts-bootstrap', async (_event, prompts: AgentPromptFileItem[]) => {
        await bootstrapAgentPrompts(Array.isArray(prompts) ? prompts : [])
    })

    ipcMain.handle('agent-prompts-list', async () => {
        return await listAgentPrompts()
    })

    ipcMain.handle('agent-prompts-write', async (_event, prompt: AgentPromptFileItem) => {
        await writeAgentPrompt(prompt)
    })

    ipcMain.handle('agent-prompts-delete', async (_event, id: string) => {
        await deleteAgentPrompt(id)
    })

    ipcMain.handle('agent-prompts-open-folder', async () => {
        await ensureAgentPromptsDir()
        await shell.openPath(getAgentPromptsDir())
    })

    // IPC 处理器：终止当前的总结生成
    ipcMain.handle('abort-summary', async () => {
        if (currentSummaryAbortController) {
            console.log('[Summary API] ⏹️ 收到终止请求，正在中断...')
            currentSummaryAbortController.abort()
            currentSummaryAbortController = null
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
        // 创建 AbortController 用于支持终止请求
        currentSummaryAbortController = new AbortController()
        const { signal } = currentSummaryAbortController

        try {
            const result = await generateSummary(
                params,
                signal,
                (chunk) => {
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
}
