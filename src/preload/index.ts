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
  setWindowAlwaysOnTop: (pinned: boolean): Promise<{ success: boolean; data?: boolean; error?: string }> => ipcRenderer.invoke('window-set-always-on-top', pinned),

  // 系统托盘控制
  trayShowMain: () => ipcRenderer.invoke('tray:show-main'),
  trayHideMain: () => ipcRenderer.invoke('tray:hide-main'),
  trayQuitApp: () => ipcRenderer.invoke('tray:quit-app'),

  // 快捷弹窗控制
  quickShow: (opts?: { focus?: boolean }) => ipcRenderer.invoke('quick:show', opts),
  quickHide: () => ipcRenderer.invoke('quick:hide'),

  // 诊断窗口 IPC
  diagnosticsOpenWindow: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('diagnostics:open-window'),
  diagnosticsProbe: (modelId: string, type: 'message' | 'research' | 'pick', options?: { ancestorDepth?: number; childDepth?: number }): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('diagnostics:probe', { modelId, type, options }),
  diagnosticsRunResearch: (modelId: string): Promise<{ success: boolean; data?: { success: boolean; error?: string }; error?: string }> =>
    ipcRenderer.invoke('diagnostics:run-research', { modelId }),
  onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }): void => cb(payload)
    ipcRenderer.on('diagnostics:probe-request', handler)
    return () => { ipcRenderer.removeListener('diagnostics:probe-request', handler) }
  },
  diagnosticsProbeResponse: (reqId: string, result: unknown): void =>
    ipcRenderer.send('diagnostics:probe-response', { reqId, result }),
  onDiagnosticsRunResearchRequest: (cb: (payload: { reqId: string; modelId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; modelId: string }): void => cb(payload)
    ipcRenderer.on('diagnostics:run-research-request', handler)
    return () => { ipcRenderer.removeListener('diagnostics:run-research-request', handler) }
  },
  diagnosticsRunResearchResponse: (reqId: string, result: { success: boolean; error?: string }): void =>
    ipcRenderer.send('diagnostics:run-research-response', { reqId, result }),
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
  cleanupPasteTemp: (filePath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('cleanup-paste-temp', filePath),

  // 发送鼠标点击事件到 webview（用于触发 Gemini 复制按钮等）
  sendMouseClick: (webContentsId: number, x: number, y: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('send-mouse-click', { webContentsId, x, y }),

  dispatchFileDrop: (webContentsId: number, filePath: string, x: number, y: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('dispatch-file-drop', { webContentsId, filePath, x, y }),

  // 存储操作
  storeGet: (key: string): Promise<unknown> => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string): Promise<void> => ipcRenderer.invoke('store-delete', key),

  // History 分页（只读，磁盘 1000 / 内存 100 分层）
  historyGetPage: (offset: number, limit: number): Promise<{ success: boolean; data?: Array<{ id: string; createdAt: number; updatedAt: number; models: string[]; title?: string; turns: Array<{ turnId: string; userMessage: string; timestamp: number; responses: Record<string, string> }>; urls?: Record<string, string>; productMode?: string; displayMode?: string }>; error?: string }> =>
    ipcRenderer.invoke('history:get-page', offset, limit),
  historyGetTotalCount: (): Promise<{ success: boolean; data?: number; error?: string }> =>
    ipcRenderer.invoke('history:get-total-count'),
  summaryHistoryGetPage: (offset: number, limit: number): Promise<{ success: boolean; data?: Array<{ id: string; title: string; timestamp: number; messages: Array<{ role: string; content: string }>; selectedModels: string[] }>; error?: string }> =>
    ipcRenderer.invoke('summary-history:get-page', offset, limit),
  summaryHistoryGetTotalCount: (): Promise<{ success: boolean; data?: number; error?: string }> =>
    ipcRenderer.invoke('summary-history:get-total-count'),

  summaryPromptsBootstrap: (prompts: Array<{ id: string; name: string; description?: string; prompt: string; isDefault?: boolean; schemaVersion?: number }>): Promise<void> =>
    ipcRenderer.invoke('summary-prompts-bootstrap', prompts),
  summaryPromptsList: (): Promise<Array<{ id: string; name: string; description?: string; prompt: string; isDefault?: boolean; schemaVersion?: number }>> =>
    ipcRenderer.invoke('summary-prompts-list'),
  summaryPromptsWrite: (prompt: { id: string; name: string; description?: string; prompt: string; isDefault?: boolean; schemaVersion?: number }): Promise<void> =>
    ipcRenderer.invoke('summary-prompts-write', prompt),
  summaryPromptsDelete: (id: string): Promise<void> =>
    ipcRenderer.invoke('summary-prompts-delete', id),
  summaryPromptsOpenFolder: (): Promise<void> =>
    ipcRenderer.invoke('summary-prompts-open-folder'),
  onSummaryPromptsChanged: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on('summary-prompts-changed', listener)
    return () => {
      ipcRenderer.removeListener('summary-prompts-changed', listener)
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

  // 任务拆解（非流式）
  splitTask: (params: {
    apiKey: string
    baseUrl?: string
    model: string
    goal: string
    temperature?: number
    maxTokens?: number
    windowCount?: number
  }): Promise<{ success: boolean; data?: Array<{ text: string; suggestedModelId?: string }>; error?: string; aborted?: boolean }> =>
    ipcRenderer.invoke('split-task', params),
  abortSplitTask: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('abort-split-task'),

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

  // 用系统资源管理器打开指定路径
  openPath: (path: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-path', path),

  // 导入缓存数据（返回预览，不直接写入）
  importCache: (): Promise<{
    success: boolean
    data?: {
      keys: string[]
      conflicts: string[]
      file: string
      values: Record<string, unknown>
    }
    error?: string
  }> => ipcRenderer.invoke('import-cache'),

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

  // 更新检查（纯提醒版）
  updateCheck: (): Promise<{ success: boolean; data?: UpdateCheckResult; error?: string }> =>
    ipcRenderer.invoke('update:check'),

  // 应用当前版本号（package.json version）
  getAppVersion: (): Promise<{ success: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('app:get-version'),

  saveImageFromURL: (url: string): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('save-image-from-url', url),
  downloadAllImages: (payload: {
    items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
  }): Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }> =>
    ipcRenderer.invoke('image:download-all', payload),

  // 监听 Gemini 账号切换事件
  onGeminiAccountSwitched: (callback: (url: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('gemini-account-switched', listener)
    return () => {
      ipcRenderer.removeListener('gemini-account-switched', listener)
    }
  },

  // 监听主窗口 hide/show 事件（片段 B'，决策 R4）：visible=true 表示窗口已显示
  onWindowVisibility: (callback: (visible: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, visible: boolean): void => callback(visible)
    ipcRenderer.on('window-visibility', listener)
    return () => {
      ipcRenderer.removeListener('window-visibility', listener)
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
  automationCollect: (platformId: string): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('automation:collect', platformId)
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
