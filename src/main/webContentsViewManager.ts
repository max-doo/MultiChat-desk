/**
 * WebContentsView 管理器模块
 * 
 * 替代 Electron <webview> 标签的核心基础设施。
 * 使用 WebContentsView API（Electron 30+）在主进程统一管理视图生命周期、
 * bounds、z-order，通过 IPC 为渲染层提供布局同步、脚本执行、事件转发能力。
 */

import { WebContentsView, BrowserWindow, session } from 'electron'
import type { WebPreferences } from 'electron'
import { registerWebviewHandlers } from './webviewManager'

// ============ 类型定义 ============

/** 视图创建选项 */
export interface CreateViewOptions {
  slotKey: string          // 'slot-0' 或 modelId，与渲染层 webviewRefs 键对齐
  partition?: string       // 默认 'persist:shared'
  webPreferences?: Partial<WebPreferences>
}

/** 视图创建结果 */
export interface CreateViewResult {
  viewId: string
  webContentsId: number
}

/** 矩形区域 */
export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 视图元数据 */
interface ViewEntry {
  view: WebContentsView
  slotKey: string
  webContentsId: number
  windowId: number
  visible: boolean
}

// ============ 管理器状态 ============

// windowId -> Map<viewId, ViewEntry>
const windowViews = new Map<number, Map<string, ViewEntry>>()

// 全局双向查询索引
const viewIdToEntry = new Map<string, ViewEntry>()
const webContentsIdToViewId = new Map<number, string>()
const slotKeyIndex = new Map<string, string>() // `${windowId}:${slotKey}` -> viewId

// 视图 ID 计数器
let viewIdCounter = 0

function generateViewId(): string {
  return `wcv-${++viewIdCounter}`
}

/** 构造 slotKey 索引键 */
function slotIndexKey(windowId: number, slotKey: string): string {
  return `${windowId}:${slotKey}`
}

// ============ 公开 API ============

/**
 * 在指定窗口上创建并挂载一个 WebContentsView
 */
export function createView(windowId: number, opts: CreateViewOptions): CreateViewResult {
  const win = BrowserWindow.fromId(windowId)
  if (!win || win.isDestroyed()) {
    throw new Error(`Window ${windowId} not found or destroyed`)
  }

  const partition = opts.partition || 'persist:shared'
  const viewId = generateViewId()

  const view = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      ...opts.webPreferences
    }
  })

  // 使用官方 API 设置圆角
  view.setBorderRadius(16)
  
  const webContentsId = view.webContents.id

  // 复用现有的 UA/权限/注入/弹窗拦截逻辑
  registerWebviewHandlers(view.webContents)

  // ============ 事件转发（Task 2.6） ============
  // 将 webContents 事件转发到宿主窗口的渲染进程
  setupEventForwarding(win, viewId, view)

  // 初始 bounds 设为 0x0（不可见），等渲染层通过 IPC 设置实际 bounds
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

  // 挂载到窗口
  win.contentView.addChildView(view)

  // 注册到映射表
  const entry: ViewEntry = {
    view,
    slotKey: opts.slotKey,
    webContentsId,
    windowId,
    visible: true
  }

  if (!windowViews.has(windowId)) {
    windowViews.set(windowId, new Map())
  }
  windowViews.get(windowId)!.set(viewId, entry)
  viewIdToEntry.set(viewId, entry)
  webContentsIdToViewId.set(webContentsId, viewId)
  slotKeyIndex.set(slotIndexKey(windowId, opts.slotKey), viewId)

  console.log(`[WebContentsViewManager] Created view ${viewId} (wc:${webContentsId}) for slot ${opts.slotKey} in window ${windowId}`)

  return { viewId, webContentsId }
}

/**
 * 设置视图 bounds（位置和大小）
 * 带有 0 宽高防御，避免渲染异常
 */
export function setViewBounds(windowId: number, viewId: string, bounds: ViewBounds): void {
  const entry = viewIdToEntry.get(viewId)
  if (!entry) return

  // 0 宽高防御
  if (bounds.width <= 0 || bounds.height <= 0) return

  // 取整避免亚像素渲染问题
  entry.view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  })
}

/**
 * 显示视图（addChildView 挂载，置顶）
 */
export function showView(windowId: number, viewId: string): void {
  const win = BrowserWindow.fromId(windowId)
  const entry = viewIdToEntry.get(viewId)
  if (!win || win.isDestroyed() || !entry) return
  if (entry.visible) {
    // 已经挂载，重新 addChildView 置顶
    win.contentView.addChildView(entry.view)
    return
  }

  win.contentView.addChildView(entry.view)
  entry.visible = true
}

/**
 * 隐藏视图（removeChildView 卸载，释放渲染资源）
 */
export function hideView(windowId: number, viewId: string): void {
  const win = BrowserWindow.fromId(windowId)
  const entry = viewIdToEntry.get(viewId)
  if (!win || win.isDestroyed() || !entry) return
  if (!entry.visible) return

  try {
    win.contentView.removeChildView(entry.view)
  } catch {
    // view 可能已被移除
  }
  entry.visible = false
}

/**
 * 聚焦视图
 */
export function focusView(_windowId: number, viewId: string): void {
  const entry = viewIdToEntry.get(viewId)
  if (!entry) return
  entry.view.webContents.focus()
}

/**
 * 移除并销毁视图
 */
export function removeView(windowId: number, viewId: string): void {
  const win = BrowserWindow.fromId(windowId)
  const entry = viewIdToEntry.get(viewId)
  if (!entry) return

  // 从窗口卸载
  if (win && !win.isDestroyed() && entry.visible) {
    try {
      win.contentView.removeChildView(entry.view)
    } catch {
      // 忽略
    }
  }

  // 清理映射
  const views = windowViews.get(windowId)
  if (views) {
    views.delete(viewId)
    if (views.size === 0) windowViews.delete(windowId)
  }
  viewIdToEntry.delete(viewId)
  webContentsIdToViewId.delete(entry.webContentsId)
  slotKeyIndex.delete(slotIndexKey(windowId, entry.slotKey))

  // 销毁 webContents（关闭渲染进程）
  try {
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close()
    }
  } catch {
    // 忽略销毁异常
  }

  console.log(`[WebContentsViewManager] Removed view ${viewId} (wc:${entry.webContentsId}) from window ${windowId}`)
}

// ============ 查询 API（Task 2.2 映射注册表） ============

/**
 * 通过 viewId 获取 WebContentsView 实例
 */
export function getViewById(viewId: string): WebContentsView | undefined {
  return viewIdToEntry.get(viewId)?.view
}

/**
 * 通过 viewId 获取 webContentsId
 */
export function getWebContentsIdByViewId(viewId: string): number | undefined {
  return viewIdToEntry.get(viewId)?.webContentsId
}

/**
 * 通过 viewId 获取 slotKey
 */
export function resolveSlotKey(viewId: string): string | undefined {
  return viewIdToEntry.get(viewId)?.slotKey
}

/**
 * 通过 webContentsId 反查 viewId
 */
export function resolveViewIdByWebContentsId(webContentsId: number): string | undefined {
  return webContentsIdToViewId.get(webContentsId)
}

/**
 * 通过窗口 ID + slotKey 查找 viewId
 */
export function resolveViewIdBySlotKey(windowId: number, slotKey: string): string | undefined {
  return slotKeyIndex.get(slotIndexKey(windowId, slotKey))
}

/**
 * 获取指定窗口的所有视图 ID
 */
export function getViewIdsForWindow(windowId: number): string[] {
  const views = windowViews.get(windowId)
  return views ? Array.from(views.keys()) : []
}

/**
 * 移除指定窗口的所有视图
 */
export function removeAllViewsForWindow(windowId: number): void {
  const views = windowViews.get(windowId)
  if (!views) return
  
  for (const viewId of Array.from(views.keys())) {
    removeView(windowId, viewId)
  }
}

// ============ 事件转发系统（Task 2.6） ============

/**
 * 事件负载类型
 */
export interface WebviewEventPayload {
  viewId: string
  type: string
  data?: Record<string, unknown>
}

/**
 * 为指定 WebContentsView 设置事件转发
 * 将 webContents 事件转发到宿主窗口的渲染进程
 */
function setupEventForwarding(
  hostWindow: BrowserWindow,
  viewId: string,
  view: WebContentsView
): void {
  const wc = view.webContents
  const send = (type: string, data?: Record<string, unknown>): void => {
    if (hostWindow.isDestroyed()) return
    try {
      hostWindow.webContents.send('webview:event', { viewId, type, data } as WebviewEventPayload)
    } catch {
      // 窗口可能已销毁
    }
  }

  wc.on('did-start-loading', () => {
    send('did-start-loading')
  })

  wc.on('did-stop-loading', () => {
    send('did-stop-loading')
  })

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    send('did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame })
  })

  wc.on('did-navigate', (_event, url, httpResponseCode, httpStatusText) => {
    send('did-navigate', { url, httpResponseCode, httpStatusText })
  })

  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    send('did-navigate-in-page', { url, isMainFrame })
  })

  wc.on('dom-ready', () => {
    send('dom-ready')
  })

  wc.on('did-finish-load', () => {
    send('did-finish-load')
  })

  wc.on('did-frame-finish-load', (_event, isMainFrame) => {
    send('did-frame-finish-load', { isMainFrame })
  })

  wc.on('console-message', (_event, level, message, line, sourceId) => {
    send('console-message', { level, message, line, sourceId })
  })

  wc.on('page-title-updated', (_event, title, explicitSet) => {
    send('page-title-updated', { title, explicitSet })
  })

  wc.on('render-process-gone', (_event, details) => {
    send('render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
}
