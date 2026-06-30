import { ElectronAPI } from '@electron-toolkit/preload'

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

interface AgentPromptFileItem {
  id: string
  name: string
  description?: string
  prompt: string
  isDefault?: boolean
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      trayShowMain: () => Promise<{ success: boolean; error?: string }>
      trayHideMain: () => Promise<{ success: boolean; error?: string }>
      trayQuitApp: () => Promise<{ success: boolean; error?: string }>
      quickShow: (opts?: { focus?: boolean }) => Promise<{ success: boolean; error?: string }>
      quickHide: () => Promise<{ success: boolean; error?: string }>
      quickGetAlwaysOnTop: () => Promise<boolean>
      quickSetAlwaysOnTop: (flag: boolean) => Promise<void>
      quickInjectPrompt: (payload: { text: string; action: 'quick'|'summarize'|'polish'|'translate'|'raw'|'search' }) => void
      onQuickInject: (cb: (payload: { text: string; action: 'quick'|'summarize'|'polish'|'translate'|'raw'|'search' }) => void) => () => void
      stateSync: (partialState: Record<string, unknown>) => void
      onStateChangedRemote: (cb: (state: Record<string, unknown>) => void) => () => void
      shortcutGet: () => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>
      shortcutSet: (config: Record<string, string>) => Promise<{ success: boolean; error?: string }>
      selectFile: () => Promise<string | null>
      selectDirectory: () => Promise<string | null>
      getFileInfo: (filePath: string) => Promise<GetFileInfoResult>
      readClipboardText: () => Promise<string>
      readClipboardHTML: () => Promise<string>
      readClipboardImage: () => Promise<GetFileInfoResult>
      sendMouseClick: (webContentsId: number, x: number, y: number) => Promise<{ success: boolean; error?: string }>
      dispatchFileDrop: (webContentsId: number, filePath: string, x: number, y: number) => Promise<{ success: boolean; error?: string }>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<void>
      storeDelete: (key: string) => Promise<void>
      agentPromptsBootstrap: (prompts: AgentPromptFileItem[]) => Promise<void>
      agentPromptsList: () => Promise<AgentPromptFileItem[]>
      agentPromptsWrite: (prompt: AgentPromptFileItem) => Promise<void>
      agentPromptsDelete: (id: string) => Promise<void>
      agentPromptsOpenFolder: () => Promise<void>
      onAgentPromptsChanged: (callback: () => void) => () => void
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
      }, onChunk?: (chunk: string, isReasoning?: boolean) => void) => Promise<{ success: boolean; data?: string; reasoningContent?: string; error?: string; aborted?: boolean }>
      abortSummary: () => Promise<{ success: boolean; error?: string }>
      fetchModels: (params: {
        apiKey: string
        baseUrl: string
      }) => Promise<{ success: boolean; data?: Array<{ id: string; object?: string;[key: string]: unknown }>; error?: string }>
      validateApi: (params: {
        apiKey: string
        baseUrl: string
      }) => Promise<{ success: boolean; error?: string }>
      exportCache: () => Promise<{ success: boolean; filePath?: string; error?: string }>
      exportReport: (params: {
        content: string
        fileName: string
        directory?: string
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      openBrowserWindow: (url: string) => Promise<void>
      saveImageFromURL: (url: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
      writeTempMarkdown: (params: {
        content: string
        fileName?: string
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      onGeminiAccountSwitched: (callback: (url: string) => void) => () => void
      windowDragStart: () => void
      windowDragMove: () => void
      windowDragEnd: () => void
      toolbarAction: (action: 'quick' | 'summarize' | 'translate' | 'copy' | 'search') => void
      toolbarHide: () => void
      selectionToolbarGet: () => Promise<{ success: boolean; data?: boolean; error?: string }>
      selectionToolbarSet: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
      automationExecute: (platformId: string, prompt: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
      automationCollectResult: (platformId: string) => Promise<{ success: boolean; data?: string; error?: string }>
      automationDevTestExec: (platformId: string, prompt: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
      /** 发送 prompt 并延迟收集结果（collectDelayMs 默认 5000ms） */
      automationSendPrompt: (platformId: string, prompt: string, collectDelayMs?: number) => Promise<{ success: boolean; data?: string; error?: string }>
      /** 仅收集指定平台的最新回复 */
      automationCollect: (platformId: string) => Promise<{ success: boolean; data?: string; error?: string }>

      // ============ WebContentsView 管理 ============
      createWebviewView: (params: { slotKey: string; partition?: string }) => Promise<{ success: boolean; data?: { viewId: string; webContentsId: number }; error?: string }>
      removeWebviewView: (params: { viewId: string }) => Promise<{ success: boolean; error?: string }>
      showWebviewView: (params: { viewId: string }) => Promise<{ success: boolean; error?: string }>
      hideWebviewView: (params: { viewId: string }) => Promise<{ success: boolean; error?: string }>
      focusWebviewView: (params: { viewId: string }) => Promise<{ success: boolean; error?: string }>
      setWebviewBounds: (params: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }) => void
      executeWebviewScript: (viewId: string, code: string, options?: { userGesture?: boolean }) => Promise<{ success: boolean; data?: unknown; error?: string }>
      loadWebviewURL: (viewId: string, url: string) => Promise<{ success: boolean; error?: string }>
      reloadWebview: (viewId: string) => Promise<{ success: boolean; error?: string }>
      webviewGoBack: (viewId: string) => Promise<{ success: boolean; data?: { canGoBack: boolean }; error?: string }>
      webviewGoForward: (viewId: string) => Promise<{ success: boolean; data?: { canGoForward: boolean }; error?: string }>
      webviewStop: (viewId: string) => Promise<{ success: boolean; error?: string }>
      getWebviewURL: (viewId: string) => Promise<{ success: boolean; data?: { url: string }; error?: string }>
      getWebviewNavState: (viewId: string) => Promise<{ success: boolean; data?: { canGoBack: boolean; canGoForward: boolean }; error?: string }>
      clearWebviewHistory: (viewId: string) => Promise<{ success: boolean; error?: string }>
      getWebviewWebContentsId: (viewId: string) => Promise<{ success: boolean; data?: { webContentsId: number }; error?: string }>
      captureWebviewPage: (viewId: string) => Promise<{ success: boolean; data?: { dataUrl: string }; error?: string }>
      showModelMenu: (params: { options: Array<{id: string, label: string, icon?: string}>, currentId?: string, x: number, y: number }) => Promise<{ success: boolean; data?: { selectedId: string }; error?: string }>
      onWebviewEvent: (cb: (payload: { viewId: string; type: string; data?: Record<string, unknown> }) => void) => () => void
    }
  }
}
