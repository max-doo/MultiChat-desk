import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 文件数据类型
interface FileData {
  filePath: string
  fileName: string
  mimeType: string
  size: number
}

interface GetFileInfoResult {
  success: boolean
  data?: FileData
  error?: string
}

// 自定义 API
const api = {
  // 窗口控制
  minimizeWindow: (): void => ipcRenderer.send('window-minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window-maximize'),
  closeWindow: (): void => ipcRenderer.send('window-close'),

  // 系统托盘控制
  trayShowMain: () => ipcRenderer.invoke('tray:show-main'),
  trayHideMain: () => ipcRenderer.invoke('tray:hide-main'),
  trayQuitApp: () => ipcRenderer.invoke('tray:quit-app'),

  // 快捷弹窗控制
  quickShow: (opts?: { focus?: boolean }) => ipcRenderer.invoke('quick:show', opts),
  quickHide: () => ipcRenderer.invoke('quick:hide'),
  quickGetAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('quick:get-always-on-top'),
  quickSetAlwaysOnTop: (flag: boolean): Promise<void> => ipcRenderer.invoke('quick:set-always-on-top', flag),
  quickInjectPrompt: (payload: { text: string; action: 'quick'|'summarize'|'polish'|'translate'|'raw'|'search' }) => ipcRenderer.send('quick:inject-prompt', payload),
  onQuickInject: (cb: (payload: { text: string; action: 'quick'|'summarize'|'polish'|'translate'|'raw'|'search' }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { text: string; action: 'quick'|'summarize'|'polish'|'translate'|'raw'|'search' }): void => cb(payload)
    ipcRenderer.on('quick:inject-prompt', handler)
    return () => { ipcRenderer.removeListener('quick:inject-prompt', handler) }
  },

  // 跨窗口同步
  stateSync: (partialState: Record<string, unknown>): void => ipcRenderer.send('state:sync', partialState),
  onStateChangedRemote: (cb: (state: Record<string, unknown>) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, s: Record<string, unknown>): void => cb(s)
    ipcRenderer.on('state-changed-remote', handler)
    return () => { ipcRenderer.removeListener('state-changed-remote', handler) }
  },

  // 快捷键管理
  shortcutGet: (): Promise<{ success: boolean; data?: Record<string, string>; error?: string }> => ipcRenderer.invoke('shortcut:get'),
  shortcutSet: (config: Record<string, string>): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('shortcut:set', config),

  // 文件操作
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('select-file'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('select-directory'),
  getFileInfo: (filePath: string): Promise<GetFileInfoResult> =>
    ipcRenderer.invoke('get-file-info', filePath),

  // 剪贴板操作
  readClipboardText: (): Promise<string> => ipcRenderer.invoke('read-clipboard-text'),
  readClipboardHTML: (): Promise<string> => ipcRenderer.invoke('read-clipboard-html'),
  readClipboardImage: (): Promise<GetFileInfoResult> => ipcRenderer.invoke('read-clipboard-image'),

  // 发送鼠标点击事件到 webview（用于触发 Gemini 复制按钮等）
  sendMouseClick: (webContentsId: number, x: number, y: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('send-mouse-click', { webContentsId, x, y }),

  dispatchFileDrop: (webContentsId: number, filePath: string, x: number, y: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('dispatch-file-drop', { webContentsId, filePath, x, y }),

  // 存储操作
  storeGet: (key: string): Promise<unknown> => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string): Promise<void> => ipcRenderer.invoke('store-delete', key),

  agentPromptsBootstrap: (prompts: Array<{ id: string; name: string; description?: string; prompt: string; isDefault?: boolean }>): Promise<void> =>
    ipcRenderer.invoke('agent-prompts-bootstrap', prompts),
  agentPromptsList: (): Promise<Array<{ id: string; name: string; description?: string; prompt: string; isDefault?: boolean }>> =>
    ipcRenderer.invoke('agent-prompts-list'),
  agentPromptsWrite: (prompt: { id: string; name: string; description?: string; prompt: string; isDefault?: boolean }): Promise<void> =>
    ipcRenderer.invoke('agent-prompts-write', prompt),
  agentPromptsDelete: (id: string): Promise<void> =>
    ipcRenderer.invoke('agent-prompts-delete', id),
  agentPromptsOpenFolder: (): Promise<void> =>
    ipcRenderer.invoke('agent-prompts-open-folder'),
  onAgentPromptsChanged: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on('agent-prompts-changed', listener)
    return () => {
      ipcRenderer.removeListener('agent-prompts-changed', listener)
    }
  },

  // AI 总结（支持自定义 API 端点，支持流式输出，支持多轮对话）
  generateSummary: (params: {
    apiKey: string
    baseUrl?: string
    model: string
    systemPrompt: string
    userContent: string
    modelOutputs?: Array<{ name: string; content: string }>
    userRequirement?: string
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
    temperature?: number
    topP?: number
    maxTokens?: number
    includeReasoning?: boolean
  }, onChunk?: (chunk: string, isReasoning?: boolean) => void): Promise<{ success: boolean; data?: string; reasoningContent?: string; error?: string; aborted?: boolean }> => {
    // 设置流式数据监听器
    const listener = (_event: Electron.IpcRendererEvent, data: { done: boolean; content: string; isReasoning?: boolean }) => {
      if (onChunk && data.content) {
        onChunk(data.content, data.isReasoning)
      }
    }
    ipcRenderer.on('summary-stream-chunk', listener)

    return ipcRenderer.invoke('generate-summary', params).finally(() => {
      // 清理监听器
      ipcRenderer.removeListener('summary-stream-chunk', listener)
    })
  },

  // 终止当前的 AI 总结生成
  abortSummary: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('abort-summary'),

  // 获取模型列表
  fetchModels: (params: {
    apiKey: string
    baseUrl: string
  }): Promise<{ success: boolean; data?: Array<{ id: string; object?: string;[key: string]: unknown }>; error?: string }> =>
    ipcRenderer.invoke('fetch-models', params),

  // 校验 API
  validateApi: (params: {
    apiKey: string
    baseUrl: string
  }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fetch-models', params),

  // 导出缓存数据
  exportCache: (): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('export-cache'),

  // 导出报告
  exportReport: (params: {
    content: string
    fileName: string
    directory?: string
  }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('export-report', params),

  // 写入临时 markdown 文件
  writeTempMarkdown: (params: {
    content: string
    fileName?: string
  }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('write-temp-markdown', params),

  // 打开新浏览器窗口
  openBrowserWindow: (url: string): Promise<void> => ipcRenderer.invoke('open-browser-window', url),

  saveImageFromURL: (url: string): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('save-image-from-url', url),

  // 监听 Gemini 账号切换事件
  onGeminiAccountSwitched: (callback: (url: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('gemini-account-switched', listener)
    return () => {
      ipcRenderer.removeListener('gemini-account-switched', listener)
    }
  },

  // 窗口拖拽
  windowDragStart: (): void => ipcRenderer.send('window-drag-start'),
  windowDragMove: (): void => ipcRenderer.send('window-drag-move'),
  windowDragEnd: (): void => ipcRenderer.send('window-drag-end'),

  // 悬浮工具条
  toolbarAction: (action: 'quick' | 'summarize' | 'translate' | 'copy' | 'search'): void => {
    ipcRenderer.send('toolbar:trigger-action', { action })
  },
  toolbarHide: (): void => {
    ipcRenderer.send('toolbar:hide')
  },
  selectionToolbarGet: (): Promise<{ success: boolean; data?: boolean; error?: string }> => ipcRenderer.invoke('selection-toolbar:get'),
  selectionToolbarSet: (enabled: boolean): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('selection-toolbar:set', enabled),

  // 自动化服务
  automationExecute: (platformId: string, prompt: string): Promise<{ success: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('automation:execute', platformId, prompt),
  automationCollectResult: (platformId: string): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('automation:collect-result', platformId),
  automationDevTestExec: (platformId: string, prompt: string): Promise<{ success: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('automation:dev-test-exec', platformId, prompt),
  /** 发送 prompt 并延迟收集结果（collectDelayMs 默认 5000ms） */
  automationSendPrompt: (platformId: string, prompt: string, collectDelayMs?: number): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('automation:send-prompt', platformId, prompt, collectDelayMs),
  /** 仅收集指定平台的最新回复 */
  automationCollect: (platformId: string): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('automation:collect', platformId),

  // ============ WebContentsView 管理（Task 2.8） ============

  /** 创建并挂载 WebContentsView */
  createWebviewView: (params: { slotKey: string; partition?: string }): Promise<{ success: boolean; data?: { viewId: string; webContentsId: number }; error?: string }> =>
    ipcRenderer.invoke('webview:create-view', params),

  /** 移除并销毁 WebContentsView */
  removeWebviewView: (params: { viewId: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:remove-view', params),

  /** 显示 WebContentsView（挂载到窗口） */
  showWebviewView: (params: { viewId: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:show-view', params),

  /** 隐藏 WebContentsView（从窗口卸载） */
  hideWebviewView: (params: { viewId: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:hide-view', params),

  /** 聚焦 WebContentsView */
  focusWebviewView: (params: { viewId: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:focus-view', params),

  /** 设置 WebContentsView 的位置和大小 */
  setWebviewBounds: (params: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:set-bounds', params),

  /** 在 WebContentsView 中执行 JavaScript 脚本 */
  executeWebviewScript: (viewId: string, code: string, options?: { userGesture?: boolean }): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('webview:execute-script', { viewId, code, userGesture: options?.userGesture }),

  /** 加载 URL */
  loadWebviewURL: (viewId: string, url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:load-url', { viewId, url }),

  /** 重新加载 */
  reloadWebview: (viewId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:reload', { viewId }),

  /** 后退 */
  webviewGoBack: (viewId: string): Promise<{ success: boolean; data?: { canGoBack: boolean }; error?: string }> =>
    ipcRenderer.invoke('webview:go-back', { viewId }),

  /** 前进 */
  webviewGoForward: (viewId: string): Promise<{ success: boolean; data?: { canGoForward: boolean }; error?: string }> =>
    ipcRenderer.invoke('webview:go-forward', { viewId }),

  /** 停止加载 */
  webviewStop: (viewId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:stop', { viewId }),

  /** 获取当前 URL */
  getWebviewURL: (viewId: string): Promise<{ success: boolean; data?: { url: string }; error?: string }> =>
    ipcRenderer.invoke('webview:get-url', { viewId }),

  /** 获取导航状态 */
  getWebviewNavState: (viewId: string): Promise<{ success: boolean; data?: { canGoBack: boolean; canGoForward: boolean }; error?: string }> =>
    ipcRenderer.invoke('webview:get-nav-state', { viewId }),

  /** 清空导航历史 */
  clearWebviewHistory: (viewId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:clear-history', { viewId }),

  /** 获取 webContentsId（供 sendMouseClick/dispatchFileDrop 使用） */
  getWebviewWebContentsId: (viewId: string): Promise<{ success: boolean; data?: { webContentsId: number }; error?: string }> =>
    ipcRenderer.invoke('webview:get-webcontents-id', { viewId }),

  /** 订阅 WebContentsView 事件（主进程 → 渲染进程推送） */
  onWebviewEvent: (cb: (payload: { viewId: string; type: string; data?: Record<string, unknown> }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { viewId: string; type: string; data?: Record<string, unknown> }): void => cb(payload)
    ipcRenderer.on('webview:event', handler)
    return () => { ipcRenderer.removeListener('webview:event', handler) }
  }
}

// 暴露 API 到渲染进程
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore - 在非隔离上下文中直接挂载到 window，类型定义在 env.d.ts
  window.electron = electronAPI
  // @ts-ignore - 在非隔离上下文中直接挂载到 window，类型定义在 env.d.ts
  window.api = api
}
