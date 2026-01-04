/**
 * Webview 和窗口管理模块
 * 负责主窗口创建、Webview 注入脚本、上下文菜单以及新窗口管理
 */

import { app, BrowserWindow, shell, nativeImage, type WebFrameMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { startAgentPromptsWatcher } from './agentPrompts'

// ============ 状态管理 ============

// 主窗口引用
let mainWindow: BrowserWindow | null = null
const browserWindows = new Set<BrowserWindow>()

export function getMainWindow(): BrowserWindow | null {
    return mainWindow
}

// ============ 图标工具 ============

// 获取应用图标路径
function getIconPngPath(): string {
    return join(app.getAppPath(), 'assets', 'logo.png')
}

// Windows 图标优化
function createWin32IconFromPng(pngPath: string): Electron.NativeImage {
    const src = nativeImage.createFromPath(pngPath)
    if (src.isEmpty()) return src

    const { width: srcW, height: srcH } = src.getSize()
    const scanMaxSide = 512
    const scanScale = Math.min(1, scanMaxSide / Math.max(srcW, srcH))
    const scanW = Math.max(1, Math.round(srcW * scanScale))
    const scanH = Math.max(1, Math.round(srcH * scanScale))
    const scanImg = scanScale < 1 ? src.resize({ width: scanW, height: scanH, quality: 'best' }) : src
    const { width: w, height: h } = scanImg.getSize()
    const bitmap = scanImg.toBitmap()

    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    const alphaThreshold = 8

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const alpha = bitmap[(y * w + x) * 4 + 3]
            if (alpha > alphaThreshold) {
                if (x < minX) minX = x
                if (y < minY) minY = y
                if (x > maxX) maxX = x
                if (y > maxY) maxY = y
            }
        }
    }

    let content = scanImg
    if (maxX >= minX && maxY >= minY) {
        const cropW = maxX - minX + 1
        const cropH = maxY - minY + 1
        const cropped = Buffer.alloc(cropW * cropH * 4)
        for (let y = 0; y < cropH; y++) {
            const srcStart = ((minY + y) * w + minX) * 4
            const srcEnd = srcStart + cropW * 4
            const dstStart = y * cropW * 4
            bitmap.copy(cropped, dstStart, srcStart, srcEnd)
        }
        content = nativeImage.createFromBitmap(cropped, { width: cropW, height: cropH })
    }

    const outSide = 256
    const paddingPx = 2
    const innerSide = Math.max(1, outSide - paddingPx * 2)
    const { width: cW, height: cH } = content.getSize()
    const fitScale = innerSide / Math.max(cW, cH)
    const drawW = Math.max(1, Math.round(cW * fitScale))
    const drawH = Math.max(1, Math.round(cH * fitScale))
    const drawImg = content.resize({ width: drawW, height: drawH, quality: 'best' })
    const drawBitmap = drawImg.toBitmap()

    const out = Buffer.alloc(outSide * outSide * 4, 0)
    const offsetX = Math.floor((outSide - drawW) / 2)
    const offsetY = Math.floor((outSide - drawH) / 2)

    for (let y = 0; y < drawH; y++) {
        const srcStart = y * drawW * 4
        const srcEnd = srcStart + drawW * 4
        const dstStart = ((offsetY + y) * outSide + offsetX) * 4
        drawBitmap.copy(out, dstStart, srcStart, srcEnd)
    }

    return nativeImage.createFromBitmap(out, { width: outSide, height: outSide })
}

function getWindowIcon(): string | Electron.NativeImage {
    const pngPath = getIconPngPath()
    if (process.platform === 'win32') {
        return createWin32IconFromPng(pngPath)
    }
    return pngPath
}

// ============ Browser Window 管理 ============

export function openBrowserWindowInternal(url: string): void {
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return
    console.log('[Main] openBrowserWindowInternal:', url)
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: true,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        icon: getWindowIcon(),
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webviewTag: true,
            partition: 'persist:shared'
        }
    })
    browserWindows.add(win)
    win.on('closed', () => {
        browserWindows.delete(win)
    })
    win.show()
    win.focus()

    const hash = `browser?url=${encodeURIComponent(url)}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#${hash}`).catch((err) => {
            console.error('[Main] Failed to load URL:', err)
        })
    } else {
        win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash }).catch((err) => {
            console.error('[Main] Failed to load file:', err)
        })
    }

    win.setMenuBarVisibility(false)
    win.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })
}

// ============ 注入脚本 ============

function getWebviewClickInterceptorScript(): string {
    return `
    (function() {
      try {
        if (window.__mmClickInterceptorInjected) return 'skip';
        window.__mmClickInterceptorInjected = true;

        function mmLog(msg) {
          try { console.log('__MM_LOG__:' + msg); } catch {}
        }

        function openUrl(url) {
          try { console.log('__OPEN_LINK__:' + url); } catch {}
        }

        const addAccountKeywords = ['Add account', '添加账号', '添加帐号'];
        function textHit(s) {
          if (!s || typeof s !== 'string') return false;
          return addAccountKeywords.some(k => s.includes(k));
        }

        function tryHandleGeminiAddAccount(e) {
          // 点击事件拦截已移至 window.open 拦截
          return false;
        }

        // 拦截 window.open 调用
        // 配合 setWindowOpenHandler，提供双重保障拦截弹窗
        // 对于 Google 账号相关 URL，直接在 webview 中导航
        (function() {
          const originalOpen = window.open;
          window.open = function(url, target, features) {
            mmLog('window.open intercepted: ' + url);
            
            // 检查是否是 Google 账号相关 URL
            const isGoogleAuth = url && (
              url.includes('accounts.google.com') ||
              url === 'about:blank' ||
              (url.includes('.google.com') && url.includes('/accounts'))
            );
            
            if (isGoogleAuth || url === 'about:blank') {
              // 对于 about:blank 或 Google 账号页面，直接在当前页面导航
              // 构造一个账号选择器 URL
              const currentUrl = location.href;
              const continueUrl = encodeURIComponent(currentUrl);
              const accountUrl = 'https://accounts.google.com/AccountChooser?continue=' + continueUrl;
              mmLog('Redirecting to AccountChooser: ' + accountUrl);
              location.href = accountUrl;
              return null;
            }
            
            // 对于其他 URL，通过 IPC 打开（由主进程处理）
            if (url && url.startsWith('http')) {
              openUrl(url);
              return null;
            }
            
            // 回退到原始行为（虽然会被阻止）
            return originalOpen.call(this, url, target, features);
          };
          mmLog('window.open interceptor installed');
        })();

        (function() {
          const proto = Event && Event.prototype;
          if (!proto) return;
          const orig = proto.stopImmediatePropagation;
          if (typeof orig !== 'function') return;
          proto.stopImmediatePropagation = function() {
            try {
              if (location.hostname === 'gemini.google.com') mmLog('stopImmediatePropagation called for ' + (this && this.type));
            } catch {}
            return orig.apply(this, arguments);
          };
        })();

        function onUserGesture(e) {
          if (tryHandleGeminiAddAccount(e)) return;
          const link = e.target && e.target.closest ? e.target.closest('a') : null;
          if (link && link.href) {
            // 检查是否是 Google 账号相关链接
            const isGoogleAuth = link.href.includes('accounts.google.com') || 
                                (link.href.includes('.google.com') && link.href.includes('/accounts'));
            
            if (isGoogleAuth) {
              // 对于 Google 账号链接，直接在当前页面导航
              e.preventDefault();
              e.stopPropagation();
              mmLog('Google Auth link clicked, navigating in webview: ' + link.href);
              location.href = link.href;
              return;
            }
            
            const isExternal = link.href.startsWith('http') && !link.href.includes(window.location.host);
            const isBlank = link.target === '_blank';
            if (isBlank || isExternal) {
              e.preventDefault();
              e.stopPropagation();
              openUrl(link.href);
            }
          }
        }
        // 只监听 click 事件，避免 pointerdown + click 导致重复触发
        window.addEventListener('click', onUserGesture, true);

        mmLog('click interceptor injected');
        return 'injected';
      } catch (err) {
        try { console.log('__MM_LOG__:inject failed: ' + String(err)); } catch {}
        return 'error';
      }
    })();
  `
}

// ============ 主窗口创建 ============

export function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        icon: getWindowIcon(),
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
            partition: 'persist:shared'
        }
    })

    // 监听 Agent Prompts 文件变更
    startAgentPromptsWatcher(mainWindow)

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        console.log('[Main] mainWindow setWindowOpenHandler:', details.url)
        // 阻止所有弹窗，对于 Google 相关 URL 使用外部浏览器
        if (details.url.includes('accounts.google.com') || details.url === 'about:blank') {
            console.log('[Main] Blocking popup for:', details.url)
            // 对于 about:blank 直接阻止，对于 google 使用外部浏览器
            if (details.url !== 'about:blank') {
                shell.openExternal(details.url)
            }
            return { action: 'deny' }
        }
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // 监听 webview 创建子窗口
    mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
        console.log('[Main] did-attach-webview 触发, wcId:', webContents.id)
        setupContextMenu(webContents)

        // ============ Google 账号切换检测 ============
        // 追踪是否正在进行 Google 认证流程
        // 当用户完成账号切换后，自动刷新页面以应用新的 session cookie
        let isInGoogleAuthFlow = false
        let authFlowStartTime = 0 // 进入认证流程的时间戳
        const AUTH_MIN_DURATION = 800 // 最少停留 800ms 才认为是真正的账号切换（立即重定向约 500ms）

        // 监听导航开始，检测是否进入 Google 认证流程
        webContents.on('will-navigate', (_e, url) => {
            console.log('[Main][DEBUG] will-navigate:', url, '| isInAuthFlow:', isInGoogleAuthFlow)
            if (url.includes('accounts.google.com')) {
                isInGoogleAuthFlow = true
                authFlowStartTime = Date.now()
                console.log('[Main] ✅ Entered Google Auth flow, wcId:', webContents.id)
            }
        })

        // 监听导航完成，检测认证流程结束
        webContents.on('did-navigate', (_e, url) => {
            console.log('[Main][DEBUG] did-navigate:', url, '| isInAuthFlow:', isInGoogleAuthFlow)
            // 检测从 Google 认证回到 Gemini
            if (isInGoogleAuthFlow && url.includes('gemini.google.com')) {
                const duration = Date.now() - authFlowStartTime
                console.log('[Main][DEBUG] Auth flow duration:', duration, 'ms')

                // 只有在认证页面停留足够时间，才认为是真正完成了账号切换
                if (duration >= AUTH_MIN_DURATION) {
                    console.log('[Main] ✅ Auth flow completed! Duration:', duration, 'ms, reloading...')
                    isInGoogleAuthFlow = false

                    // 保存当前 URL（切换后的账号 URL），用于持久化
                    const switchedUrl = url
                    console.log('[Main] ✅ Switched account URL:', switchedUrl)

                    // 延迟刷新，确保 cookie 完全写入
                    setTimeout(() => {
                        try {
                            console.log('[Main] ✅ Reloading now, wcId:', webContents.id)
                            webContents.reload()

                            // 刷新后，通知渲染进程保存切换后的账号 URL
                            // 延迟发送，确保页面刷新完成
                            setTimeout(() => {
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    console.log('[Main] ✅ Notifying renderer to save Gemini account URL:', switchedUrl)
                                    mainWindow.webContents.send('gemini-account-switched', switchedUrl)
                                }
                            }, 2000)
                        } catch (err) {
                            console.error('[Main] Failed to reload after auth:', err)
                        }
                    }, 500)
                } else {
                    console.log('[Main][DEBUG] Auth flow too short (', duration, 'ms), ignoring - likely a redirect')
                    isInGoogleAuthFlow = false
                }
            }
        })

        // 同时监听 did-navigate-in-page（单页应用内部导航）
        webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
            if (isMainFrame) {
                console.log('[Main][DEBUG] did-navigate-in-page:', url, '| isInAuthFlow:', isInGoogleAuthFlow)
                // 对于 SPA 内部导航，也检测是否从认证回到 Gemini
                if (isInGoogleAuthFlow && url.includes('gemini.google.com')) {
                    const duration = Date.now() - authFlowStartTime
                    if (duration >= AUTH_MIN_DURATION) {
                        console.log('[Main] ✅ Auth flow completed (in-page)! Duration:', duration, 'ms, reloading...')
                        isInGoogleAuthFlow = false
                        setTimeout(() => {
                            try {
                                webContents.reload()
                            } catch (err) {
                                console.error('[Main] Failed to reload after auth (in-page):', err)
                            }
                        }, 500)
                    } else {
                        console.log('[Main][DEBUG] Auth flow too short (in-page), ignoring')
                        isInGoogleAuthFlow = false
                    }
                }
            }
        })

        // 注入脚本
        const tryInject = async (source: string): Promise<void> => {
            const script = getWebviewClickInterceptorScript()

            const getAllFrames = (root: WebFrameMain): WebFrameMain[] => {
                const result: WebFrameMain[] = []
                const stack: WebFrameMain[] = [root]
                while (stack.length) {
                    const frame = stack.pop()
                    if (!frame) continue
                    result.push(frame)
                    const children = (frame as WebFrameMain & { frames?: WebFrameMain[] }).frames
                    if (Array.isArray(children) && children.length) {
                        for (const child of children) stack.push(child)
                    }
                }
                return result
            }

            const frames = getAllFrames(webContents.mainFrame)
            const _settled = await Promise.allSettled(
                frames.map((frame) => frame.executeJavaScript(script, true))
            )

            // 日志记录...
            console.log(`[Main] webview inject: ${webContents.id} source=${source} frames=${frames.length}`)
        }

        webContents.on('dom-ready', () => {
            void tryInject('dom-ready')
        })
        webContents.on('did-finish-load', () => {
            void tryInject('did-finish-load')
        })
        webContents.on('did-frame-finish-load', (_e, isMainFrame: boolean) => {
            void tryInject(`did-frame-finish-load:${isMainFrame ? 'main' : 'sub'}`)
        })
        setTimeout(() => {
            void tryInject('attach-timeout')
        }, 3000)

        webContents.on('console-message', (_e, _level, message) => {
            if (typeof message !== 'string') return
            if (message.startsWith('__MM_LOG__:')) {
                console.log('[Webview]', webContents.id, message.substring(9))
                return
            }
            if (message.startsWith('__OPEN_LINK__:')) {
                const url = message.substring(14)
                console.log('[Webview]', webContents.id, 'open link:', url)
                openBrowserWindowInternal(url)
            }
        })

        // 处理 Webview 内部的窗口创建
        webContents.on('did-create-window', (childWindow, details) => {
            console.log('[Main] webview did-create-window:', details?.url)
            browserWindows.add(childWindow)
            childWindow.on('closed', () => {
                browserWindows.delete(childWindow)
            })
            childWindow.setMenuBarVisibility(false)
            childWindow.show()
            childWindow.focus()

            const handleNavigation = (e: Electron.Event, url: string): void => {
                const isGoogleAuthUrl = url.includes('accounts.google.com') ||
                    (url.includes('.google.com') && url.includes('/accounts'))
                if (isGoogleAuthUrl) {
                    console.log('[Main] Intercepting Google Auth navigation in child window:', url)
                    e.preventDefault()
                    // 在原 webview 中导航
                    webContents.loadURL(url)
                    // 关闭弹窗
                    childWindow.close()
                }
            }

            childWindow.webContents.on('will-navigate', handleNavigation)
            childWindow.webContents.on('will-redirect', handleNavigation)

            // 对于其他弹窗的链接请求
            childWindow.webContents.setWindowOpenHandler((d) => {
                shell.openExternal(d.url)
                return { action: 'deny' }
            })
        })

        webContents.setWindowOpenHandler((details) => {
            console.log('[Main] webview setWindowOpenHandler:', details.url)
            const isGoogleAuthUrl = (() => {
                if (!details.url) return false
                if (details.url.includes('accounts.google.com')) return true
                try {
                    const u = new URL(details.url)
                    if (u.hostname === 'accounts.google.com') return true
                    if (u.hostname.endsWith('.google.com') && u.pathname.startsWith('/accounts')) return true
                } catch {
                    // URL 解析失败时返回 false
                }
                return false
            })()

            if (details.url === 'about:blank') {
                console.log('[Main] Blocking about:blank popup, will navigate to Google account page in webview')
                const currentUrl = webContents.getURL()
                const continueUrl = encodeURIComponent(currentUrl || 'https://gemini.google.com/app')
                const accountUrl = `https://accounts.google.com/AccountChooser?continue=${continueUrl}`
                setImmediate(() => {
                    webContents.loadURL(accountUrl)
                })
                return { action: 'deny' }
            }

            if (isGoogleAuthUrl) {
                console.log('[Main] Intercepting Google Auth URL, navigating in webview:', details.url)
                setImmediate(() => {
                    webContents.loadURL(details.url)
                })
                return { action: 'deny' }
            }

            // 对于其他 URL，只阻止弹窗
            console.log('[Main] Blocking popup for non-auth URL:', details.url)
            return { action: 'deny' }
        })
    })
}

// ============ 上下文菜单 ============

function setupContextMenu(wc: Electron.WebContents): void {
    wc.on('context-menu', (_e, params) => {
        // 忽略拼写检查建议菜单
        if (params.misspelledWord || params.dictionarySuggestions?.length > 0) return

        const owner = BrowserWindow.fromWebContents(wc) || mainWindow
        if (!owner) return

        const payload = {
            x: params.x,
            y: params.y,
            selectionText: params.selectionText,
            linkText: params.linkText,
            editFlags: params.editFlags,
            isEditable: params.isEditable,
            linkURL: params.linkURL,
            srcURL: params.srcURL,
            hasImageContents: params.hasImageContents,
            mediaType: params.mediaType,
            wcId: wc.id,
            source: 'webview'
        }
        console.log('[Main] 发送 themed-contextmenu 事件')
        owner.webContents.send('themed-contextmenu', payload)
    })
}
