/**
 * Webview 和窗口管理模块
 * 负责主窗口创建、Webview 注入脚本、上下文菜单以及新窗口管理
 */

import { app, screen, session, BrowserWindow, shell, nativeImage, Tray, Menu } from 'electron'
import { join } from 'path'
import { accessSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { startAgentPromptsWatcher } from './agentPrompts'

// ============ 状态管理 ============

// 已注册 handler 的 webContents 集合，用于幂等守卫
// （re-attach / guest 重 parent / OAuth 重定向循环时避免监听线性累积）
const registeredWebContentsSet = new WeakSet<Electron.WebContents>()

// 主窗口引用
let mainWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null
export function getQuickWindow(): BrowserWindow | null { return quickWindow }

export function showAndFocusWindow(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) {
        win.restore()
    }
    win.show()
    win.moveTop()
    const wasAlwaysOnTop = win.isAlwaysOnTop()
    if (!wasAlwaysOnTop) {
        win.setAlwaysOnTop(true)
    }
    win.focus()
    if (!wasAlwaysOnTop) {
        setTimeout(() => {
            if (!win || win.isDestroyed()) return
            win.setAlwaysOnTop(false)
        }, 50)
    }
}

const browserWindows = new Set<BrowserWindow>()

let tray: Tray | null = null
export function getTray(): Tray | null { return tray }

let isQuitting = false
export function setQuitting(v: boolean): void { isQuitting = v }
export function getIsQuitting(): boolean { return isQuitting }

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

function getTrayIconPath(): string {
    const file = process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon.png'
    const candidate = join(app.getAppPath(), 'assets', file)
    try { accessSync(candidate); return candidate } catch { return getIconPngPath() }
}

export function createTray(): void {
    if (tray) return
    const iconPath = getTrayIconPath()
    const image = nativeImage.createFromPath(iconPath)
    tray = new Tray(image)
    if (process.platform === 'darwin') tray.setTemplateImage(true)
    tray.setToolTip('MultiChat')

    const contextMenu = Menu.buildFromTemplate([
        { label: '显示主界面', click: () => { showAndFocusWindow(mainWindow); getQuickWindow()?.hide() } },
        { label: '召唤快捷弹窗', click: () => {
            const qw = getQuickWindow()
            if (!qw) return
            showAndFocusWindow(qw)
        } },
        { type: 'separator' },
        { label: '退出', click: () => { setQuitting(true); app.quit() } }
    ])
    tray.setContextMenu(contextMenu)

    tray.on('click', () => {
        if (!mainWindow) return
        if (mainWindow.isVisible()) mainWindow.hide()
        else { showAndFocusWindow(mainWindow); getQuickWindow()?.hide() }
    })
}

export function destroyTray(): void {
    tray?.destroy()
    tray = null
}

// ============ Browser Window 管理 ============

export function openBrowserWindowInternal(url: string): void {
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return
    console.log('[Main] openBrowserWindowInternal -> shell.openExternal:', url)
    shell.openExternal(url)
}


// ============ 注入脚本 ============

export function getWebviewClickInterceptorScript(): string {
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
            
            const isCurrentGoogle = location.hostname.includes('google.com') || location.hostname.includes('gemini');
            
            // 检查是否是 Google 账号相关 URL
            const isGoogleAuth = url && (
              url.includes('accounts.google.com') ||
              (url.includes('.google.com') && url.includes('/accounts'))
            );
            
            if (isCurrentGoogle && (isGoogleAuth || url === 'about:blank')) {
              // 对于 Google 页面下的 about:blank 或 Google 账号页面，直接在当前页面导航
              const currentUrl = location.href;
              const continueUrl = encodeURIComponent(currentUrl);
              const accountUrl = isGoogleAuth ? url : ('https://accounts.google.com/AccountChooser?continue=' + continueUrl);
              mmLog('Redirecting Google Auth: ' + accountUrl);
              location.href = accountUrl;
              return null;
            }
            
            // 对于其他 URL，通过 IPC 打开（由主进程处理）
            if (url && url.startsWith('http') && !url.includes(location.host)) {
              openUrl(url);
              return null;
            }
            
            // 回退到原始行为
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
                                (link.href.includes('.google.com') && link.href.includes('/accounts')) ||
                                (link.href.includes('.google.com') && link.href.includes('/signin'));
            
            if (isGoogleAuth) {
              e.preventDefault();
              e.stopPropagation();
              mmLog('Google Auth link clicked, navigating in webview: ' + link.href);
              location.href = link.href;
              return;
            }
            
            const isExternal = link.href.startsWith('http') && !link.href.includes(window.location.host);
            if (isExternal) {
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

// ============ 共享 Session User-Agent 伪装 ============

/**
 * 为共享 Session 设置伪装 User-Agent，移除 Electron 特征标识，
 * 避免部分平台（如 Google）因检测到非标准浏览器环境而拦截登录
 */
export function setupSharedSessionUserAgent(): void {
    const sharedSession = session.fromPartition('persist:shared')
    const currentUA = sharedSession.getUserAgent()
    const cleanUA = currentUA.replace(/\s*Electron\/[0-9.]+/g, '')
    sharedSession.setUserAgent(cleanUA)
}

// ============ 主窗口创建 ============

export function createWindow(): void {
    // 在窗口创建前伪装共享 Session 的 User-Agent，使所有 webview 自动继承
    setupSharedSessionUserAgent()

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 700,
        show: true,
        autoHideMenuBar: true,
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#EBF4FF',
            symbolColor: '#333333',
            height: 38
        },
        backgroundColor: 'rgba(0,0,0,0)',
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
        console.log('[Main] ready-to-show fired')
        mainWindow?.show()
    })

    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault()
            mainWindow?.hide()
        }
    })

    // 主窗口 hide/show 事件广播给渲染层（片段 B'，决策 R4）：
    // 渲染层在窗口隐藏后对显示中的模型启动 15min 休眠倒计时，重新显示时立即唤醒。
    // 监听 BrowserWindow 的 hide/show 事件可覆盖所有路径（close 按钮→hide、tray:hide-main、
    // tray:show-main、托盘切换、ready-to-show），无需在每个 IPC handler 内分别广播。
    mainWindow.on('hide', () => {
        mainWindow?.webContents.send('window-visibility', false)
    })
    mainWindow.on('show', () => {
        mainWindow?.webContents.send('window-visibility', true)
    })

    // 捕获 Renderer 的控制台日志，以便在终端中排查黑屏报错
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        // 丢弃网络嗅探器全量响应体日志，避免主进程 stdout 缓冲膨胀
        if (typeof message === 'string' && message.startsWith('NETWORK_RESPONSE:')) return
        const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR']
        console.log(`[Renderer ${levels[level] || 'LOG'}] ${message} (${sourceId}:${line})`)
    })


    // ... 省略了 setWindowOpenHandler 等 ...
    mainWindow.webContents.setWindowOpenHandler((details) => {
        console.log('[Main] mainWindow setWindowOpenHandler:', details.url)
        if (details.url.includes('accounts.google.com') || details.url === 'about:blank') {
            if (details.url !== 'about:blank') shell.openExternal(details.url)
            return { action: 'deny' }
        }
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        console.log('[Main] Loading Dev URL:', process.env['ELECTRON_RENDERER_URL'])
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']).catch(err => {
            console.error('[Main] Failed to load DEV URL:', err)
        })
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html')).catch(err => {
            console.error('[Main] Failed to load index.html:', err)
        })
    }

    // 监听 webview 创建子窗口
    mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
        console.log('[Main] did-attach-webview 触发, wcId:', webContents.id)
        registerWebviewHandlers(webContents)
    })
}

// ============ Webview 通用事件处理器 ============

/**
 * 为挂载到任意宿主窗口的 Webview 注册通用事件处理器：
 * - 右键上下文菜单
 * - Google 账号认证流程检测与自动刷新
 * - 链接拦截脚本注入（外部链接通过 shell.openExternal 在系统浏览器打开）
 * - Webview 内部弹窗拦截
 *
 * 同时适用于主窗口和快捷弹窗，避免重复逻辑。
 */
export function registerWebviewHandlers(webContents: Electron.WebContents): void {
    // 幂等守卫：同一 webContents 只注册一次，避免 re-attach（OAuth 重定向/guest 重 parent）时
    // 监听线性累积导致内存与 CPU 增长
    if (registeredWebContentsSet.has(webContents)) {
        if (process.env.NODE_ENV === 'development') {
            console.log('[Main][WebviewHandlers] 已注册，跳过重复注册 wcId:', webContents.id)
        }
        return
    }
    registeredWebContentsSet.add(webContents)

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

    // 注入脚本（仅向主框架 mainFrame 注入，避免第三方防爬或安全检测 iframe 动态销毁导致 0xC0000005 崩溃）
    const tryInject = async (source: string): Promise<void> => {
        const script = getWebviewClickInterceptorScript()

        if (!webContents.mainFrame) return
        try {
            await webContents.mainFrame.executeJavaScript(script, true)
            console.log(`[Main] webview inject: ${webContents.id} source=${source}`)
        } catch (err) {
            // 忽略主框架加载过程中的轻微错位
        }
    }

    webContents.on('dom-ready', () => {
        void tryInject('dom-ready')
    })
    webContents.on('did-finish-load', () => {
        void tryInject('did-finish-load')
    })
    webContents.on('did-frame-finish-load', (_e, isMainFrame: boolean) => {
        if (isMainFrame) {
            void tryInject('did-frame-finish-load:main')
        }
    })
    setTimeout(() => {
        void tryInject('attach-timeout')
    }, 3000)

    webContents.on('console-message', (_e, _level, message) => {
        if (typeof message !== 'string') return
        // 丢弃网络嗅探器的全量响应体日志，避免主进程控制台缓冲区与内存膨胀
        // （嗅探器本身已在生产环境禁用，此处为兜底，防止 dev 误注入后泄漏到生产）
        if (message.startsWith('NETWORK_RESPONSE:')) return
        if (message.startsWith('__MM_LOG__:')) {
            console.log('[Webview]', webContents.id, message.substring(9))
            return
        }
        if (message.startsWith('__OPEN_LINK__:')) {
            const url = message.substring(14)
            console.log('[Webview]', webContents.id, 'open link:', url)

            // 登录/认证 URL 应留在 webview 内，确保 persist:shared session 共享
            const isAuthUrl = url.includes('accounts.google.com') ||
                (url.includes('.google.com') && url.includes('/signin')) ||
                (url.includes('.google.com') && url.includes('/accounts'))

            if (isAuthUrl) {
                console.log('[Main] Auth URL detected, navigating webview internally:', url)
                webContents.loadURL(url)
            } else {
                openBrowserWindowInternal(url)
            }
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
        showAndFocusWindow(childWindow)

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
}

// ============ 快捷弹窗创建 ============

export function createQuickWindow(): void {
    if (quickWindow) return
    quickWindow = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 320,
        minHeight: 550,
        show: false,
        frame: false,
        alwaysOnTop: false,
        skipTaskbar: false,
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

    // 失焦隐藏已被禁用（用户要求不要自动隐藏，只能手动关闭）
    // let blurHideTimeout: ReturnType<typeof setTimeout> | null = null

    // quickWindow.on('blur', () => {
    //     blurHideTimeout = setTimeout(() => {
    //         // 检查焦点是否仍在本 app 的任意 webContents（含 webview 子进程）
    //         const allWindows = BrowserWindow.getAllWindows()
    //         const anyFocused = allWindows.some(w => w.isFocused() || w.webContents.isFocused())
    //         if (!anyFocused && quickWindow && !quickWindow.isDestroyed()) {
    //             quickWindow.hide()
    //         }
    //     }, 150)
    // })

    // quickWindow.on('focus', () => {
    //     if (blurHideTimeout) { clearTimeout(blurHideTimeout); blurHideTimeout = null }
    // })

    quickWindow.on('close', (e) => {
        if (!isQuitting) { e.preventDefault(); quickWindow?.hide() }
    })

    quickWindow.on('closed', () => { quickWindow = null })

    // 为快捷窗口内的 Webview 注册相同的链接拦截与脚本注入处理器
    quickWindow.webContents.on('did-attach-webview', (_event, webContents) => {
        console.log('[Main] quickWindow did-attach-webview 触发, wcId:', webContents.id)
        registerWebviewHandlers(webContents)
    })

    const hash = 'quick'
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        void quickWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#${hash}`)
    } else {
        void quickWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
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

// ============ 悬浮工具条窗口 ============

let toolbarWindow: BrowserWindow | null = null
export function getToolbarWindow(): BrowserWindow | null { return toolbarWindow }

// 最近一次触发工具条的选中文本缓存。按钮点击时由 toolbar:trigger-action 读取，
// 全程不发 Ctrl+C。hideToolbarWindow 时清空（避免残留旧选区被后续动作误用）。
let cachedSelectionText = ''
export function setCachedSelectionText(text: string): void { cachedSelectionText = text }
export function getCachedSelectionText(): string { return cachedSelectionText }

export function createToolbarWindow(): void {
    if (toolbarWindow) return
    toolbarWindow = new BrowserWindow({
        width: 360,
        height: 40,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        focusable: false, // 核心：不夺取焦点，保持外部软件选区高亮
        show: false,
        backgroundColor: '#00000000',
        icon: getWindowIcon(),
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false
        }
    })

    toolbarWindow.on('closed', () => { toolbarWindow = null })

    const hash = 'toolbar'
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        void toolbarWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#${hash}`)
    } else {
        void toolbarWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
}

export function showToolbarAt(physX: number, physY: number): void {
    if (!toolbarWindow) {
        createToolbarWindow()
    }
    if (!toolbarWindow) return

    // 定位与边界适配统一使用 Electron screen 逻辑坐标系，消除高DPI错位风险
    const display = screen.getDisplayNearestPoint({ x: physX, y: physY })
    const scale = display.scaleFactor || 1

    const logicalX = physX / scale
    const logicalY = physY / scale

    const width = 360
    const height = 40

    let targetX = logicalX - width / 2
    let targetY = logicalY - height - 12 // 在鼠标上方 12 逻辑像素弹出

    const { x, y, width: dispW } = display.bounds
    if (targetY < y) {
        targetY = logicalY + 20 // 顶部溢出时翻转到下方
    }
    targetX = Math.max(x, Math.min(targetX, x + dispW - width))

    toolbarWindow.setBounds({
        x: Math.round(targetX),
        y: Math.round(targetY),
        width,
        height
    })

    toolbarWindow.showInactive() // ⚠️ 必须 showInactive()，不夺焦
}

export function hideToolbarWindow(): void {
    if (toolbarWindow && toolbarWindow.isVisible()) {
        toolbarWindow.hide()
    }
    cachedSelectionText = ''
}

export function isPointInToolbar(physX: number, physY: number): boolean {
    if (!toolbarWindow || !toolbarWindow.isVisible()) return false
    const bounds = toolbarWindow.getBounds()
    const display = screen.getDisplayNearestPoint({ x: physX, y: physY })
    const scale = display.scaleFactor || 1

    const left = bounds.x * scale - 10
    const right = (bounds.x + bounds.width) * scale + 10
    const top = bounds.y * scale - 10
    const bottom = (bounds.y + bounds.height) * scale + 10

    return physX >= left && physX <= right && physY >= top && physY <= bottom
}
