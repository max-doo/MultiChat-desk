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

// History 分页 IPC 用到的只读结构（与 appStore.ts 的 HistoryItem/SummaryHistoryItem 对齐）
interface HistoryPageItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: Array<{
    turnId: string
    userMessage: string
    timestamp: number
    responses: Record<string, string>
  }>
  urls?: Record<string, string>
  productMode?: string
  displayMode?: string
}

interface SummaryHistoryPageItem {
  id: string
  title: string
  timestamp: number
  messages: Array<{ role: string; content: string }>
  selectedModels: string[]
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
      historyGetPage: (offset: number, limit: number) => Promise<{ success: boolean; data?: HistoryPageItem[]; error?: string }>
      historyGetTotalCount: () => Promise<{ success: boolean; data?: number; error?: string }>
      summaryHistoryGetPage: (offset: number, limit: number) => Promise<{ success: boolean; data?: SummaryHistoryPageItem[]; error?: string }>
      summaryHistoryGetTotalCount: () => Promise<{ success: boolean; data?: number; error?: string }>
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
      splitTask: (params: {
        apiKey: string
        baseUrl?: string
        model: string
        goal: string
        temperature?: number
        maxTokens?: number
      }) => Promise<{ success: boolean; data?: Array<{ text: string; suggestedModelId?: string }>; error?: string; aborted?: boolean }>
      abortSplitTask: () => Promise<{ success: boolean; error?: string }>
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
    }
  }
}
