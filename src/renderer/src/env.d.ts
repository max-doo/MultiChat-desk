/// <reference types="vite/client" />

import { ElectronAPI } from '@electron-toolkit/preload'
import type { NoteConversation, NoteDraft, NoteHighlight, NoteSelectionRect, ConversationMindmap, MindmapTask, NoteNavigation } from '../../shared/types/notes'

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

interface SummaryPromptFileItem {
  id: string
  name: string
  description?: string
  prompt: string
  isDefault?: boolean
  schemaVersion?: number
}

type UpdateStatus = 'idle' | 'checking' | 'ready' | 'error'

interface UpdateResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
}

interface UpdateState {
  status: UpdateStatus
  result?: UpdateResult
  lastAttemptAt?: number
  lastSuccessAt?: number
  error?: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      platform: NodeJS.Platform
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      setWindowAlwaysOnTop: (pinned: boolean) => Promise<{ success: boolean; data?: boolean; error?: string }>
      startWindowDrag: (point: { screenX: number; screenY: number }) => Promise<{ success: boolean; error?: string }>
      moveWindowDrag: (point: { screenX: number; screenY: number }) => void
      endWindowDrag: () => void
      windowDragStart: () => void
      windowDragMove: () => void
      windowDragEnd: () => void
      selectFile: () => Promise<string | null>
      getFileInfo: (filePath: string) => Promise<GetFileInfoResult>
      readClipboardText: () => Promise<string>
      readClipboardHTML: () => Promise<string>
      createTempUploadFile: (params: { fileName: string; mimeType?: string; data: ArrayBuffer }) => Promise<GetFileInfoResult>
      cleanupUploadTemp: (filePath: string) => Promise<{ success: boolean; error?: string }>
      sendMouseClick: (webContentsId: number, x: number, y: number) => Promise<{ success: boolean; error?: string }>
      sendMouseMove: (webContentsId: number, x: number, y: number) => Promise<{ success: boolean; error?: string }>
      dispatchFileDrop: (webContentsId: number, filePath: string, x: number, y: number) => Promise<{ success: boolean; error?: string }>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<void>
      storeDelete: (key: string) => Promise<void>
      notesList: () => Promise<{ success: boolean; data?: NoteConversation[]; error?: string }>
      /** 准备快照而不保存；返回的会话 ID 可供当前窗口的 mindmapsStart / mindmapsAdd 使用。 */
      notesCaptureSource: (id: number, platform: string, name: string) => Promise<{ success: boolean; data?: NoteConversation; error?: string }>
      mindmapsStart: (conversationId: string, platform: string, additionalRequirements?: string) => Promise<{ success: boolean; data?: MindmapTask; error?: string }>
      mindmapsTask: () => Promise<{ success: boolean; data?: MindmapTask | null; error?: string }>
      mindmapsCancel: (id: string) => Promise<{ success: boolean; error?: string }>
      mindmapsShow: (id: string) => Promise<{ success: boolean; error?: string }>
      mindmapsAdd: (conversationId: string, markdown: string) => Promise<{ success: boolean; data?: ConversationMindmap; error?: string }>
      mindmapsUpdate: (conversationId: string, id: string, markdown: string, title: string, updatedAt: number) => Promise<{ success: boolean; data?: ConversationMindmap; error?: string }>
      mindmapsDelete: (conversationId: string, id: string) => Promise<{ success: boolean; error?: string }>
      mindmapsImportLegacy: (markdown: string) => Promise<{ success: boolean; data?: NoteConversation; error?: string }>
      notesOpen: (navigation: NoteNavigation) => Promise<{ success: boolean; error?: string }>
      notesConsumeNavigation: () => Promise<{ success: boolean; data?: NoteNavigation | null; error?: string }>
      onNotesNavigate: (cb: (navigation: NoteNavigation) => void) => () => void
      onMindmapTaskChanged: (cb: (task: MindmapTask) => void) => () => void
      notesAnchorsForUrl: (url: string) => Promise<{ success: boolean; data?: NoteHighlight[]; error?: string }>
      onNotesChanged: (cb: () => void) => () => void
      notesSave: (draft: NoteDraft, comment: string) => Promise<{ success: boolean; data?: NoteConversation; error?: string }>
      notesUpdate: (conversationId: string, noteId: string, comment: string) => Promise<{ success: boolean; data?: NoteConversation; error?: string }>
      notesDelete: (conversationId: string, noteId: string) => Promise<{ success: boolean; error?: string }>
      notesExport: () => Promise<{ success: boolean; data?: boolean; error?: string }>
      onNoteCapture: (cb: (payload: { draft?: NoteDraft; webContentsId?: number; rect?: NoteSelectionRect; error?: string }) => void) => () => void
      summaryPromptsBootstrap: (prompts: SummaryPromptFileItem[]) => Promise<void>
      summaryPromptsList: () => Promise<SummaryPromptFileItem[]>
      summaryPromptsWrite: (prompt: SummaryPromptFileItem) => Promise<void>
      summaryPromptsDelete: (id: string) => Promise<void>
      summaryPromptsOpenFolder: () => Promise<void>
      onSummaryPromptsChanged: (callback: () => void) => () => void
      splitTask: (params: {
        apiKey: string
        baseUrl?: string
        model: string
        goal: string
        temperature?: number
        maxTokens?: number
        windowCount?: number
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
      openBrowserWindow: (url: string) => Promise<void>
      updateGetState: () => Promise<{ success: boolean; data?: UpdateState; error?: string }>
      updateCheck: () => Promise<{ success: boolean; data?: UpdateState; error?: string }>
      onUpdateStateChange: (callback: (state: UpdateState) => void) => () => void
      onWindowVisibility: (callback: (visible: boolean) => void) => () => void
      saveImageFromURL: (url: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
      downloadAllImages: (payload: {
        items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
      }) => Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }>
      diagnosticsOpenWindow: () => Promise<{ success: boolean; error?: string }>
      diagnosticsProbe: (modelId: string, type: 'message' | 'research' | 'pick', options?: { ancestorDepth?: number; childDepth?: number }) => Promise<{ success: boolean; data?: unknown; error?: string }>
      diagnosticsRunResearch: (modelId: string) => Promise<{ success: boolean; data?: { success: boolean; error?: string }; error?: string }>
      onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }) => void) => () => void
      diagnosticsProbeResponse: (reqId: string, result: unknown) => void
      onDiagnosticsRunResearchRequest: (cb: (payload: { reqId: string; modelId: string }) => void) => () => void
      diagnosticsRunResearchResponse: (reqId: string, result: { success: boolean; error?: string }) => void
    }
  }
}

export { }
