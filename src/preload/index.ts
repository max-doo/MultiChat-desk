import type { HistoryListItem, SummaryHistoryListItem, HistoryKind, HistoryRecord, DataImportResult } from '../shared/types/history'
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { NoteConversation, NoteDraft, NoteHighlight, NoteSelectionRect, ConversationMindmap, MindmapTask, MindmapModifyRequest, MindmapCandidate, MindmapSelection, MindmapMaterial, MindmapFileState, MindmapFileReason } from '../shared/types/notes'
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationCaptureRequest,
  AnnotationChangedEvent,
  AnnotationSource,
  CaptureExcerptInput,
  CaptureExcerptResult,
  CaptureSourceInput,
  CaptureSourceResult,
  DocumentResolution,
  EnsureDocumentInput,
  EnsureDocumentResult,
  DefaultWorkspaceInfo,
  WorkbenchWorkspaceSession,
  LegacyMigrationPendingSummary,
  LegacyMigrationProgress,
  LegacyMigrationResult
} from '../shared/types/annotations'
import type {
  WebviewContextMenuData,
  WebviewContextMenuActionRequest,
  WorkbenchHtmlContextMenuData
} from '../shared/types/contextMenu'
import type { CliIntegrationStatus } from '../shared/types/cli'
import type { TaskSplitTask } from '../shared/types/taskSplit'
import type {
  AgentActiveModel,
  AgentAuthOperation,
  AgentAuthType,
  AgentRuntimeSnapshot,
  AgentSessionStatus,
  AgentThinkingLevel
} from '../shared/types/agentRuntime'
import type {
  WorkbenchFileNode,
  WorkbenchSearchResult,
  WorkbenchFileInfo,
  WorkbenchWriteResult,
  WorkbenchSelectFolderResult,
  WorkbenchNodeType,
  WorkspaceTagInfo,
  GitStatus,
  GitActionResult,
  GitignoreSnapshot,
  GitignoreCategory,
  GitRemoteInfo,
  FrontmatterBackupSummary,
  FrontmatterBackupClearResult
} from '../shared/types/workbench'

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

// 自定义 API
const api = {
  platform: process.platform,

  // 窗口控制
  minimizeWindow: (): void => ipcRenderer.send('window-minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window-maximize'),
  closeWindow: (): void => ipcRenderer.send('window-close'),
  setWindowAlwaysOnTop: (pinned: boolean): Promise<{ success: boolean; data?: boolean; error?: string }> => ipcRenderer.invoke('window-set-always-on-top', pinned),

  // 系统托盘控制
  trayShowMain: () => ipcRenderer.invoke('tray:show-main'),
  trayHideMain: () => ipcRenderer.invoke('tray:hide-main'),
  trayQuitApp: () => ipcRenderer.invoke('tray:quit-app'),
  notifyQuitGuardReady: (): void => ipcRenderer.send('app:quit-guard-ready'),
  onAppQuitRequested: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('app:quit-requested', handler)
    return () => { ipcRenderer.removeListener('app:quit-requested', handler) }
  },
  respondAppQuit: (allow: boolean): void => ipcRenderer.send('app:quit-response', allow),
  onWindowCloseRequested: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('app:window-close-requested', handler)
    return () => { ipcRenderer.removeListener('app:window-close-requested', handler) }
  },
  respondWindowClose: (allow: boolean): void =>
    ipcRenderer.send('app:window-close-response', allow),

  // 快捷弹窗控制
  quickShow: (opts?: { focus?: boolean }) => ipcRenderer.invoke('quick:show', opts),
  quickHide: () => ipcRenderer.invoke('quick:hide'),
  quickRegisterPrimaryWebview: (id: number): Promise<{ success: boolean }> => ipcRenderer.invoke('quick:register-primary-webview', id),
  quickSetSidebarExpanded: (expanded: boolean, panelWidth: number): Promise<{ success: boolean; data?: number }> => ipcRenderer.invoke('quick:set-sidebar-expanded', expanded, panelWidth),
  onQuickAskSidebar: (cb: (payload: { text: string; wcId: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { text: string; wcId: number }): void => cb(payload)
    ipcRenderer.on('quick:ask-sidebar', handler)
    return () => { ipcRenderer.removeListener('quick:ask-sidebar', handler) }
  },
  onMainAskSidebar: (cb: (payload: { text: string; wcId: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { text: string; wcId: number }): void => cb(payload)
    ipcRenderer.on('main:ask-sidebar', handler)
    return () => { ipcRenderer.removeListener('main:ask-sidebar', handler) }
  },
  onQuickHidden: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('quick:hidden', handler)
    return () => { ipcRenderer.removeListener('quick:hidden', handler) }
  },
  onQuickShown: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('quick:shown', handler)
    return () => { ipcRenderer.removeListener('quick:shown', handler) }
  },

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
  getFileInfo: (filePath: string): Promise<GetFileInfoResult> =>
    ipcRenderer.invoke('get-file-info', filePath),

  // 剪贴板操作
  readClipboardText: (): Promise<string> => ipcRenderer.invoke('read-clipboard-text'),
  readClipboardHTML: (): Promise<string> => ipcRenderer.invoke('read-clipboard-html'),
  readClipboardImage: (): Promise<GetFileInfoResult> => ipcRenderer.invoke('read-clipboard-image'),
  cleanupPasteTemp: (filePath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('cleanup-paste-temp', filePath),
  createTempUploadFile: (params: { fileName: string; mimeType?: string; data: ArrayBuffer }): Promise<GetFileInfoResult> =>
    ipcRenderer.invoke('create-temp-upload-file', params),
  cleanupUploadTemp: (filePath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('cleanup-upload-temp', filePath),

  // 发送鼠标点击事件到 webview（用于触发 Gemini 复制按钮等）
  sendMouseClick: (webContentsId: number, x: number, y: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('send-mouse-click', { webContentsId, x, y }),
  sendMouseMove: (webContentsId: number, x: number, y: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('send-mouse-move', { webContentsId, x, y }),

  dispatchFileDrop: (webContentsId: number, filePath: string, x: number, y: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('dispatch-file-drop', { webContentsId, filePath, x, y }),

  // 存储操作
  storeGet: (key: string): Promise<unknown> => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string): Promise<void> => ipcRenderer.invoke('store-delete', key),
  notesForSource: (key: string): Promise<{ success: boolean; data?: NoteConversation; error?: string }> => ipcRenderer.invoke('notes:source', key),
  notesGet: (id: string): Promise<{ success: boolean; data?: NoteConversation; error?: string }> => ipcRenderer.invoke('notes:get', id),
  notesSummaries: (query?: string): Promise<{ success: boolean; data?: NoteConversation[]; error?: string }> => ipcRenderer.invoke('notes:summaries', query),
  notesStandalone: (markdown?: string): Promise<{ success: boolean; data?: NoteConversation; error?: string }> => ipcRenderer.invoke('notes:standalone', markdown),
  notesImport: (values: unknown, overwrite = false): Promise<{ success: boolean; data?: DataImportResult; error?: string }> => ipcRenderer.invoke('notes:import', values, overwrite),
  notesList: (): Promise<{ success: boolean; data?: NoteConversation[]; error?: string }> => ipcRenderer.invoke('notes:list'),
  // 采集结果仅暂存于当前窗口；导图成功生成/创建后才与快照一起持久化。
  notesCaptureSource: (id: number, platform: string, name: string): Promise<{ success: boolean; data?: NoteConversation; error?: string }> => ipcRenderer.invoke('notes:capture-source', id, platform, name),
  mindmapsStart: (conversationId: string, platform: string, additionalRequirements?: string, material?: MindmapMaterial): Promise<{ success: boolean; data?: MindmapTask; error?: string }> => ipcRenderer.invoke('mindmaps:start', conversationId, platform, additionalRequirements, material),
  mindmapsTask: (): Promise<{ success: boolean; data?: MindmapTask | null; error?: string }> => ipcRenderer.invoke('mindmaps:task'),
  // Context flags and owned source webview identity are part of the shared request; main performs capture.
  mindmapsModify: (request: MindmapModifyRequest): Promise<{ success: boolean; data?: MindmapTask; error?: string }> => ipcRenderer.invoke('mindmaps:modify', request),
  mindmapsCandidate: (mapId: string): Promise<{ success: boolean; data?: MindmapCandidate | null; error?: string }> => ipcRenderer.invoke('mindmaps:candidate', mapId),
  mindmapsApply: (mapId: string, candidateId: string): Promise<{ success: boolean; data?: ConversationMindmap; error?: string; conflict?: 'file-changed' }> => ipcRenderer.invoke('mindmaps:apply', mapId, candidateId),
  mindmapsDiscard: (mapId: string, candidateId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('mindmaps:discard', mapId, candidateId),
  mindmapsAsk: (id: number, platformId: string, conversationId: string, question: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('mindmaps:ask', id, platformId, conversationId, question),
  mindmapsBlankSource: (id: number, expectedUrl: string, platformName: string): Promise<{ success: boolean; data?: { conversation: NoteConversation; mindmap: ConversationMindmap }; error?: string }> => ipcRenderer.invoke('mindmaps:blank-source', id, expectedUrl, platformName),
  onMindmapSelection: (cb: (selection: MindmapSelection) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, selection: MindmapSelection): void => cb(selection)
    ipcRenderer.on('mindmaps:selection', handler)
    return () => ipcRenderer.removeListener('mindmaps:selection', handler)
  },
  mindmapsCancel: (id: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('mindmaps:cancel', id),
  mindmapsShow: (id: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('mindmaps:show', id),
  mindmapsAdd: (conversationId: string, markdown: string): Promise<{ success: boolean; data?: ConversationMindmap; error?: string }> => ipcRenderer.invoke('mindmaps:add', conversationId, markdown),
  mindmapsUpdate: (conversationId: string, id: string, markdown: string, title: string, updatedAt: number, expectedMarkdown?: string, force?: boolean): Promise<{ success: boolean; data?: ConversationMindmap; error?: string; conflict?: 'file-changed' }> => ipcRenderer.invoke('mindmaps:update', conversationId, id, markdown, title, updatedAt, expectedMarkdown, force),
  mindmapsDelete: (conversationId: string, id: string): Promise<{ success: boolean; data?: { conflict?: 'duplicate' | 'source-mismatch' }; error?: string }> => ipcRenderer.invoke('mindmaps:delete', conversationId, id),
  mindmapsImportLegacy: (markdown: string): Promise<{ success: boolean; data?: NoteConversation; error?: string }> => ipcRenderer.invoke('mindmaps:import-legacy', markdown),
  onMindmapTaskChanged: (cb: (task: MindmapTask) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, task: MindmapTask): void => cb(task)
    ipcRenderer.on('mindmaps:task-changed', handler)
    return () => { ipcRenderer.removeListener('mindmaps:task-changed', handler) }
  },
  notesAnchorsForUrl: (url: string): Promise<{ success: boolean; data?: NoteHighlight[]; error?: string }> => ipcRenderer.invoke('notes:anchors-for-url', url),
  onNotesChanged: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('notes:changed', handler)
    return () => { ipcRenderer.removeListener('notes:changed', handler) }
  },
  notesSave: (draft: NoteDraft, comment: string): Promise<{ success: boolean; data?: NoteConversation; error?: string }> => ipcRenderer.invoke('notes:save', draft, comment),
  notesUpdate: (conversationId: string, noteId: string, comment: string): Promise<{ success: boolean; data?: NoteConversation; error?: string }> => ipcRenderer.invoke('notes:update', conversationId, noteId, comment),
  notesDelete: (conversationId: string, noteId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('notes:delete', conversationId, noteId),
  notesExport: (): Promise<{ success: boolean; data?: boolean; error?: string }> => ipcRenderer.invoke('notes:export'),
  notesMigrationPending: (): Promise<{ success: boolean; data?: LegacyMigrationPendingSummary; error?: string }> => ipcRenderer.invoke('notes:migration-pending'),
  notesRetryMigrationRecord: (id: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('notes:retry-migration-record', id),
  notesMigrateLegacy: (jobId?: string): Promise<{ success: boolean; data?: LegacyMigrationResult; error?: string }> => ipcRenderer.invoke('notes:migrate-legacy', jobId),
  notesCancelMigration: (jobId: string): Promise<{ success: boolean; data?: { status: 'paused' }; error?: string }> => ipcRenderer.invoke('notes:cancel-migration', jobId),
  notesResumeMigration: (jobId: string): Promise<{ success: boolean; data?: { jobId: string; targetWorkspaceRoot: string; targetConversationDir: string }; error?: string }> => ipcRenderer.invoke('notes:resume-migration', jobId),
  notesAbandonMigration: (jobId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('notes:abandon-migration', jobId),
  notesFrontmatterBackups: (): Promise<{ success: boolean; data?: FrontmatterBackupSummary; error?: string }> =>
    ipcRenderer.invoke('notes:frontmatter-backups'),
  notesClearFrontmatterBackups: (): Promise<{ success: boolean; data?: FrontmatterBackupClearResult; error?: string }> =>
    ipcRenderer.invoke('notes:clear-frontmatter-backups'),
  onNotesMigrationProgress: (cb: (progress: LegacyMigrationProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: LegacyMigrationProgress): void => cb(progress)
    ipcRenderer.on('notes:migration-progress', handler)
    return () => { ipcRenderer.removeListener('notes:migration-progress', handler) }
  },
  onNoteCapture: (cb: (payload: { draft?: NoteDraft; webContentsId?: number; rect?: NoteSelectionRect; error?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { draft?: NoteDraft; webContentsId?: number; rect?: NoteSelectionRect; error?: string }): void => cb(payload)
    ipcRenderer.on('notes:capture', handler)
    return () => { ipcRenderer.removeListener('notes:capture', handler) }
  },
  onAnnotationCapture: (cb: (payload: AnnotationCaptureRequest) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AnnotationCaptureRequest): void => cb(payload)
    ipcRenderer.on('annotations:capture', handler)
    return () => { ipcRenderer.removeListener('annotations:capture', handler) }
  },
  onAnnotationCaptureError: (cb: (payload: { error: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { error: string }): void => cb(payload)
    ipcRenderer.on('annotations:capture-error', handler)
    return () => { ipcRenderer.removeListener('annotations:capture-error', handler) }
  },

  // History 分页（只读，磁盘 1000 / 内存 100 分层）
  historyGetPage: (offset: number, limit: number): Promise<{ success: boolean; data?: HistoryListItem[]; error?: string }> => ipcRenderer.invoke('history:get-page', offset, limit),
  historyGetTotalCount: (): Promise<{ success: boolean; data?: number; error?: string }> => ipcRenderer.invoke('history:get-total-count'),
  summaryHistoryGetPage: (offset: number, limit: number): Promise<{ success: boolean; data?: SummaryHistoryListItem[]; error?: string }> => ipcRenderer.invoke('summary-history:get-page', offset, limit),
  summaryHistoryGetTotalCount: (): Promise<{ success: boolean; data?: number; error?: string }> => ipcRenderer.invoke('summary-history:get-total-count'),
  historySearch: (kind: HistoryKind, query: string): Promise<{ success: boolean; data?: (HistoryListItem | SummaryHistoryListItem)[]; error?: string }> => ipcRenderer.invoke('history:search', kind, query),
  historyStatus: (): Promise<{ success: boolean; data?: { error: string; warnings: string[] }; error?: string }> => ipcRenderer.invoke('history:status'),
  historyGet: (kind: HistoryKind, id: string): Promise<{ success: boolean; data?: HistoryRecord; error?: string }> => ipcRenderer.invoke('history:get', kind, id),
  historyCreate: (kind: HistoryKind, item: HistoryRecord): Promise<{ success: boolean; data?: HistoryRecord; error?: string }> => ipcRenderer.invoke('history:create', kind, item),
  historyUpdate: (kind: HistoryKind, id: string, patch: Partial<HistoryRecord>): Promise<{ success: boolean; data?: HistoryRecord; error?: string }> => ipcRenderer.invoke('history:update', kind, id, patch),
  historyRemove: (kind: HistoryKind, ids: string[]): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('history:remove', kind, ids),
  historyImport: (kind: HistoryKind, values: unknown, overwrite = false): Promise<{ success: boolean; data?: DataImportResult; error?: string }> => ipcRenderer.invoke('history:import', kind, values, overwrite),
  onHistoryChanged: (callback: () => void): (() => void) => {
    ipcRenderer.on('history:changed', callback)
    return () => { ipcRenderer.removeListener('history:changed', callback) }
  },

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

  // 任务拆解（后台 Web AI）
  taskSplitStart: (goal: string, platform: string, windowCount: number): Promise<{ success: boolean; data?: TaskSplitTask; error?: string }> =>
    ipcRenderer.invoke('tasksplit:start', goal, platform, windowCount),
  taskSplitTask: (): Promise<{ success: boolean; data?: TaskSplitTask | null; error?: string }> =>
    ipcRenderer.invoke('tasksplit:task'),
  taskSplitCancel: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('tasksplit:cancel', id),
  taskSplitShow: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('tasksplit:show', id),
  onTaskSplitChanged: (cb: (task: TaskSplitTask) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, task: TaskSplitTask): void => cb(task)
    ipcRenderer.on('tasksplit:task-changed', handler)
    return () => ipcRenderer.removeListener('tasksplit:task-changed', handler)
  },

  // 导出缓存数据
  exportCache: (): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('export-cache'),

  // 用系统资源管理器打开指定路径
  // 导入缓存数据（返回预览，不直接写入）
  importCache: (): Promise<{
    success: boolean
    data?: {
      keys: string[]
      conflicts: string[]
      file: string
      values: Record<string, unknown>
      businessCounts?: Record<string, DataImportResult>
    }
    error?: string
  }> => ipcRenderer.invoke('import-cache'),

  // 写入临时 markdown 文件
  writeTempMarkdown: (params: {
    content: string
    fileName?: string
  }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('write-temp-markdown', params),

  // 打开新浏览器窗口
  openBrowserWindow: (url: string): Promise<void> => ipcRenderer.invoke('open-browser-window', url),

  // 更新检查（后台提醒版）
  updateGetState: (): Promise<{ success: boolean; data?: UpdateState; error?: string }> =>
    ipcRenderer.invoke('update:get-state'),
  updateCheck: (): Promise<{ success: boolean; data?: UpdateState; error?: string }> =>
    ipcRenderer.invoke('update:check'),
  onUpdateStateChange: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, updateState: UpdateState): void => callback(updateState)
    ipcRenderer.on('update:state', listener)
    return () => {
      ipcRenderer.removeListener('update:state', listener)
    }
  },

  // 应用当前版本号（package.json version）
  getAppVersion: (): Promise<{ success: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('app:get-version'),

  saveImageFromURL: (url: string): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('save-image-from-url', url),
  downloadAllImages: (payload: {
    items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
  }): Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }> =>
    ipcRenderer.invoke('image:download-all', payload),
  triggerNativeDownloads: (payload: {
    items: Array<{ modelId: string; wcId: number | null; clicked: number }>
  }): Promise<{ success: boolean; data?: { dir: string; ts: string; wcIds: number[] }; error?: string }> =>
    ipcRenderer.invoke('image:download-via-native:prepare', payload),
  waitNativeDownloads: (payload: {
    wcIds: number[]
  }): Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }> =>
    ipcRenderer.invoke('image:download-via-native:wait', payload),

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
  windowDragStart: (): void => {
    if (process.platform !== 'darwin') ipcRenderer.send('window-drag-start')
  },
  windowDragMove: (): void => {
    if (process.platform !== 'darwin') ipcRenderer.send('window-drag-move')
  },
  windowDragEnd: (): void => {
    if (process.platform !== 'darwin') ipcRenderer.send('window-drag-end')
  },

  // 命令行工具（multichat）集成
  cliGetStatus: (): Promise<{ success: boolean; data?: CliIntegrationStatus; error?: string }> => ipcRenderer.invoke('cli:get-status'),
  cliAddToPath: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('cli:add-to-path'),
  cliDismissHint: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('cli:dismiss-hint'),
  cliOpenLocation: (target: 'cli' | 'skill'): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('cli:open-location', target),

  // 悬浮工具条
  toolbarAction: (action: 'quick' | 'summarize' | 'translate' | 'copy' | 'search'): void => {
    ipcRenderer.send('toolbar:trigger-action', { action })
  },
  toolbarHide: (): void => {
    ipcRenderer.send('toolbar:hide')
  },
  selectionToolbarGet: (): Promise<{ success: boolean; data?: boolean; error?: string }> => ipcRenderer.invoke('selection-toolbar:get'),
  selectionToolbarSet: (enabled: boolean): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('selection-toolbar:set', enabled),
  selectionPermissionGet: (): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('selection-permission:get'),
  selectionPermissionRequest: (): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('selection-permission:request'),

  // 自动化服务
  automationExecute: (platformId: string, prompt: string): Promise<{ success: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('automation:execute', platformId, prompt),
  automationCollectResult: (platformId: string): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('automation:collect-result', platformId),
  automationDevTestExec: (platformId: string, prompt: string): Promise<{ success: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('automation:dev-test-exec', platformId, prompt),
  /** 发送 prompt 并延迟收集结果（collectDelayMs 默认 5000ms） */
  automationSendPrompt: (platformId: string, prompt: string, collectDelayMs?: number): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('automation:send-prompt', platformId, prompt, collectDelayMs),
  /** 仅收集指定平台的最新回复 */
  automationCollect: (platformId: string): Promise<{ success: boolean; data?: string; error?: string }> => ipcRenderer.invoke('automation:collect', platformId),

  // WebView 右键上下文菜单
  onWebviewContextMenu: (cb: (data: WebviewContextMenuData) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: WebviewContextMenuData): void => cb(data)
    ipcRenderer.on('webview:show-contextmenu', handler)
    return () => { ipcRenderer.removeListener('webview:show-contextmenu', handler) }
  },
  executeWebviewContextMenuAction: (params: WebviewContextMenuActionRequest): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('webview:execute-contextmenu-action', params),

  // WebView 页面内查找快捷键通知
  onWebviewFindShortcut: (cb: (data: { wcId: number; action: 'open' | 'close' }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { wcId: number; action: 'open' | 'close' }): void => cb(data)
    ipcRenderer.on('webview:find-shortcut', handler)
    return () => { ipcRenderer.removeListener('webview:find-shortcut', handler) }
  },

  // 工作台 (Workbench)
  workbench: {
    selectFolder: (): Promise<{ success: boolean; data?: WorkbenchSelectFolderResult | null; error?: string }> =>
      ipcRenderer.invoke('workbench:select-folder'),
    ensureDefaultWorkspace: (): Promise<{ success: boolean; data?: WorkbenchSelectFolderResult; error?: string }> =>
      ipcRenderer.invoke('workbench:ensure-default'),
    getDefaultWorkspace: (): Promise<{ success: boolean; data?: DefaultWorkspaceInfo; error?: string }> =>
      ipcRenderer.invoke('workbench:get-default-workspace'),
    getSettings: (workspaceRoot: string): Promise<{ success: boolean; data?: { conversationDir: string; warning?: string }; error?: string }> =>
      ipcRenderer.invoke('workbench:get-settings', { workspaceRoot }),
    setSettings: (workspaceRoot: string, settings: { conversationDir: string }): Promise<{ success: boolean; data?: { conversationDir: string }; error?: string }> =>
      ipcRenderer.invoke('workbench:set-settings', { workspaceRoot, settings }),
    activateWorkspace: (workspaceRoot: string): Promise<{ success: boolean; data?: WorkbenchWorkspaceSession; error?: string }> =>
      ipcRenderer.invoke('workbench:activate-workspace', { workspaceRoot }),
    closeWorkspace: (workspaceRoot: string, generation: number): Promise<{ success: boolean; data?: WorkbenchWorkspaceSession; error?: string }> =>
      ipcRenderer.invoke('workbench:close-workspace', { workspaceRoot, generation }),
    readTree: (workspaceRoot: string): Promise<{ success: boolean; data?: WorkbenchFileNode[]; error?: string }> =>
      ipcRenderer.invoke('workbench:read-tree', { workspaceRoot }),
    readFile: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; data?: WorkbenchFileInfo; error?: string }> =>
      ipcRenderer.invoke('workbench:read-file', { workspaceRoot, relativePath }),
    readPdfRange: (workspaceRoot: string, relativePath: string, start: number, end: number): Promise<{ success: boolean; data?: { bytes: Uint8Array; size: number; mtime: number }; error?: string }> =>
      ipcRenderer.invoke('workbench:read-pdf-range', { workspaceRoot, relativePath, start, end }),
    readDocxBytes: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; data?: { bytes: Uint8Array; size: number; mtime: number }; error?: string }> =>
      ipcRenderer.invoke('workbench:read-docx-bytes', { workspaceRoot, relativePath }),
    writeFile: (workspaceRoot: string, relativePath: string, content: string): Promise<{ success: boolean; data?: WorkbenchWriteResult; error?: string }> =>
      ipcRenderer.invoke('workbench:write-file', { workspaceRoot, relativePath, content }),
    createNode: (workspaceRoot: string, relativePath: string, type: WorkbenchNodeType): Promise<{ success: boolean; data?: WorkbenchFileNode; error?: string }> =>
      ipcRenderer.invoke('workbench:create-node', { workspaceRoot, relativePath, type }),
    renameNode: (workspaceRoot: string, oldRelativePath: string, newRelativePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:rename-node', { workspaceRoot, oldRelativePath, newRelativePath }),
    deleteNode: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:delete-node', { workspaceRoot, relativePath }),
    search: (workspaceRoot: string, query: string): Promise<{ success: boolean; data?: WorkbenchSearchResult[]; error?: string }> =>
      ipcRenderer.invoke('workbench:search', { workspaceRoot, query }),
    getWorkspaceTags: (workspaceRoot: string): Promise<{ success: boolean; data?: WorkspaceTagInfo[]; error?: string }> =>
      ipcRenderer.invoke('workbench:get-workspace-tags', { workspaceRoot }),
    revealFile: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:reveal-file', { workspaceRoot, relativePath }),
    openInSystem: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:open-in-system', { workspaceRoot, relativePath }),
    saveImage: (workspaceRoot: string, documentRelativePath: string, payload: { dataUrl?: string; base64?: string; fileName?: string }): Promise<{ success: boolean; data?: { relativePath: string; thumbnailDataUrl: string }; error?: string }> =>
      ipcRenderer.invoke('workbench:save-image', { workspaceRoot, documentRelativePath, ...payload }),
    importImageFile: (workspaceRoot: string, documentRelativePath: string, sourceAbsolutePath: string): Promise<{ success: boolean; data?: { relativePath: string; thumbnailDataUrl: string }; error?: string }> =>
      ipcRenderer.invoke('workbench:import-image-file', { workspaceRoot, documentRelativePath, sourceAbsolutePath }),
    copyToClipboard: (workspaceRoot: string, relativePaths: string[]): Promise<{ success: boolean; data?: { copied: number; imageCopied: boolean }; error?: string }> =>
      ipcRenderer.invoke('workbench:copy-to-clipboard', { workspaceRoot, relativePaths }),
    findUnreferencedImages: (workspaceRoot: string, documentRelativePath: string): Promise<{ success: boolean; data?: { unreferenced: string[]; total: number }; error?: string }> =>
      ipcRenderer.invoke('workbench:find-unreferenced-images', { workspaceRoot, documentRelativePath }),
    deleteNodes: (workspaceRoot: string, relativePaths: string[]): Promise<{ success: boolean; data?: { deleted: string[]; failed: { path: string; error: string }[] }; error?: string }> =>
      ipcRenderer.invoke('workbench:delete-nodes', { workspaceRoot, relativePaths }),
    importExternalPaths: (workspaceRoot: string, targetDirRelative: string, sourceAbsolutePaths: string[]): Promise<{ success: boolean; data?: { imported: string[]; failed: { path: string; error: string }[]; pairs: Array<{ source: string; target: string }> }; error?: string }> =>
      ipcRenderer.invoke('workbench:import-external-paths', { workspaceRoot, targetDirRelative, sourceAbsolutePaths }),
    moveToWorkspace: (workspaceRoot: string, targetWorkspaceRoot: string, relativePaths: string[]): Promise<{ success: boolean; data?: { moved: Array<{ source: string; target: string }>; failed: Array<{ path: string; error: string }> }; error?: string }> =>
      ipcRenderer.invoke('workbench:move-to-workspace', { workspaceRoot, targetWorkspaceRoot, relativePaths }),
    watch: (workspaceRoot: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:watch', { workspaceRoot }),
    unwatch: (workspaceRoot: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:unwatch', { workspaceRoot }),
    statFile: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; data?: { mtime: number; size: number } | null; error?: string }> =>
      ipcRenderer.invoke('workbench:stat-file', { workspaceRoot, relativePath }),
    gitStatus: (workspaceRoot: string): Promise<{ success: boolean; data?: GitStatus; error?: string }> =>
      ipcRenderer.invoke('workbench:git-status', { workspaceRoot }),
    gitCommit: (workspaceRoot: string, title: string, body?: string, allowLargeFiles?: boolean): Promise<{ success: boolean; data?: GitActionResult; error?: string }> =>
      ipcRenderer.invoke('workbench:git-commit', { workspaceRoot, title, body, allowLargeFiles }),
    gitPull: (workspaceRoot: string): Promise<{ success: boolean; data?: GitActionResult; error?: string }> =>
      ipcRenderer.invoke('workbench:git-pull', { workspaceRoot }),
    gitMergeUpstream: (workspaceRoot: string): Promise<{ success: boolean; data?: GitActionResult; error?: string }> =>
      ipcRenderer.invoke('workbench:git-merge-upstream', { workspaceRoot }),
    gitAbortMerge: (workspaceRoot: string): Promise<{ success: boolean; data?: GitActionResult; error?: string }> =>
      ipcRenderer.invoke('workbench:git-abort-merge', { workspaceRoot }),
    gitPush: (workspaceRoot: string, setUpstream?: boolean): Promise<{ success: boolean; data?: GitActionResult; error?: string }> =>
      ipcRenderer.invoke('workbench:git-push', { workspaceRoot, setUpstream }),
    gitInit: (workspaceRoot: string): Promise<{ success: boolean; data?: GitActionResult; error?: string }> =>
      ipcRenderer.invoke('workbench:git-init', { workspaceRoot }),
    gitRemotes: (workspaceRoot: string): Promise<{ success: boolean; data?: GitRemoteInfo[]; error?: string }> =>
      ipcRenderer.invoke('workbench:git-remotes', { workspaceRoot }),
    gitSetRemote: (workspaceRoot: string, url: string, name?: string): Promise<{ success: boolean; data?: GitActionResult; error?: string }> =>
      ipcRenderer.invoke('workbench:git-set-remote', { workspaceRoot, url, name }),
    readGitignore: (workspaceRoot: string): Promise<{ success: boolean; data?: GitignoreSnapshot; error?: string }> =>
      ipcRenderer.invoke('workbench:gitignore-read', { workspaceRoot }),
    writeGitignore: (workspaceRoot: string, content: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:gitignore-write', { workspaceRoot, content }),
    gitignoreCategories: (): Promise<{ success: boolean; data?: GitignoreCategory[]; error?: string }> =>
      ipcRenderer.invoke('workbench:gitignore-categories'),
    mindmapSource: (workspaceRoot: string, relativePath: string, title?: string, create?: boolean, content?: string): Promise<{ success: boolean; data?: NoteConversation | null; error?: string }> =>
      ipcRenderer.invoke('workbench:mindmap-source', { workspaceRoot, relativePath, title, create, content }),
    reconcileMindmaps: (workspaceRoot: string, index: Array<{ path: string; size?: number; mtime?: number }>, options?: { force?: boolean; targets?: Array<{ conversationId: string }> }): Promise<{ success: boolean; data?: { deleted: number; relinked: number; relinks: Array<{ from: string; to: string }>; pendingDeletions: Array<{ conversationId: string; relativePath: string }> }; error?: string }> =>
      ipcRenderer.invoke('workbench:reconcile-mindmaps', { workspaceRoot, index, force: options?.force, targets: options?.targets }),
    mindmapImpact: (workspaceRoot: string, relativePaths: string[]): Promise<{ success: boolean; data?: { documents: number; mindmaps: number }; error?: string }> =>
      ipcRenderer.invoke('workbench:mindmap-impact', { workspaceRoot, relativePaths }),
    mindmapMigrate: (workspaceRoot: string): Promise<{ success: boolean; data?: { migrated: number }; error?: string }> =>
      ipcRenderer.invoke('workbench:mindmap-migrate', { workspaceRoot }),
    mindmapFileStatus: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; data?: { files: Record<string, { state: MindmapFileState; reason?: MindmapFileReason; relativePath?: string }>; unreadable: string[]; overflow: boolean }; error?: string }> =>
      ipcRenderer.invoke('workbench:mindmap-file-status', { workspaceRoot, relativePath }),
    mindmapFileReveal: (workspaceRoot: string, relativePath: string, mindmapId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:mindmap-file-reveal', { workspaceRoot, relativePath, mindmapId }),
    onFsChanged: (cb: (payload: { workspaceRoot: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { workspaceRoot: string }): void => cb(payload)
      ipcRenderer.on('workbench:fs-changed', handler)
      return () => { ipcRenderer.removeListener('workbench:fs-changed', handler) }
    },
    onHtmlContextMenu: (cb: (data: WorkbenchHtmlContextMenuData) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: WorkbenchHtmlContextMenuData): void => cb(data)
      ipcRenderer.on('workbench:html-contextmenu', handler)
      return () => { ipcRenderer.removeListener('workbench:html-contextmenu', handler) }
    },
    copyHtmlImageAt: (x: number, y: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workbench:copy-image-at', x, y),
    // 图片右键"发送到 AI 侧边栏"：解析 workbench-file:// 拿到真实磁盘路径直接上传
    resolveFileUrl: (imageUrl: string): Promise<{ success: boolean; data?: { filePath: string }; error?: string }> =>
      ipcRenderer.invoke('workbench:resolve-file-url', imageUrl)
  },
  workbenchSelectFolder: (): Promise<{ success: boolean; data?: WorkbenchSelectFolderResult | null; error?: string }> =>
    ipcRenderer.invoke('workbench:select-folder'),
  workbenchReadTree: (workspaceRoot: string): Promise<{ success: boolean; data?: WorkbenchFileNode[]; error?: string }> =>
    ipcRenderer.invoke('workbench:read-tree', { workspaceRoot }),
  workbenchReadFile: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; data?: WorkbenchFileInfo; error?: string }> =>
    ipcRenderer.invoke('workbench:read-file', { workspaceRoot, relativePath }),
  workbenchWriteFile: (workspaceRoot: string, relativePath: string, content: string): Promise<{ success: boolean; data?: WorkbenchWriteResult; error?: string }> =>
    ipcRenderer.invoke('workbench:write-file', { workspaceRoot, relativePath, content }),
  workbenchCreateNode: (workspaceRoot: string, relativePath: string, type: WorkbenchNodeType): Promise<{ success: boolean; data?: WorkbenchFileNode; error?: string }> =>
    ipcRenderer.invoke('workbench:create-node', { workspaceRoot, relativePath, type }),
  workbenchRenameNode: (workspaceRoot: string, oldRelativePath: string, newRelativePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('workbench:rename-node', { workspaceRoot, oldRelativePath, newRelativePath }),
  workbenchDeleteNode: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('workbench:delete-node', { workspaceRoot, relativePath }),
  workbenchSearch: (workspaceRoot: string, query: string): Promise<{ success: boolean; data?: WorkbenchSearchResult[]; error?: string }> =>
    ipcRenderer.invoke('workbench:search', { workspaceRoot, query }),
  workbenchGetWorkspaceTags: (workspaceRoot: string): Promise<{ success: boolean; data?: WorkspaceTagInfo[]; error?: string }> =>
    ipcRenderer.invoke('workbench:get-workspace-tags', { workspaceRoot }),
  workbenchRevealFile: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('workbench:reveal-file', { workspaceRoot, relativePath }),
  workbenchOpenInSystem: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('workbench:open-in-system', { workspaceRoot, relativePath }),
  workbenchSaveImage: (workspaceRoot: string, documentRelativePath: string, payload: { dataUrl?: string; base64?: string; fileName?: string }): Promise<{ success: boolean; data?: { relativePath: string; thumbnailDataUrl: string }; error?: string }> =>
    ipcRenderer.invoke('workbench:save-image', { workspaceRoot, documentRelativePath, ...payload }),
  workbenchImportImageFile: (workspaceRoot: string, documentRelativePath: string, sourceAbsolutePath: string): Promise<{ success: boolean; data?: { relativePath: string; thumbnailDataUrl: string }; error?: string }> =>
    ipcRenderer.invoke('workbench:import-image-file', { workspaceRoot, documentRelativePath, sourceAbsolutePath }),
  workbenchFindUnreferencedImages: (workspaceRoot: string, documentRelativePath: string): Promise<{ success: boolean; data?: { unreferenced: string[]; total: number }; error?: string }> =>
    ipcRenderer.invoke('workbench:find-unreferenced-images', { workspaceRoot, documentRelativePath }),
  workbenchDeleteNodes: (workspaceRoot: string, relativePaths: string[]): Promise<{ success: boolean; data?: { deleted: string[]; failed: { path: string; error: string }[] }; error?: string }> =>
    ipcRenderer.invoke('workbench:delete-nodes', { workspaceRoot, relativePaths }),

  annotations: {
    listDocument: (workspaceRoot: string, relativePath: string): Promise<{ success: boolean; data?: Annotation[]; error?: string }> =>
      ipcRenderer.invoke('annotations:list-document', { workspaceRoot, relativePath }),
    listSource: (sourceKey: string): Promise<{ success: boolean; data?: { source: AnnotationSource | null; annotations: Annotation[] }; error?: string }> =>
      ipcRenderer.invoke('annotations:list-source', { sourceKey }),
    upsertDocument: (workspaceRoot: string, relativePath: string, annotation: Annotation): Promise<{ success: boolean; data?: Annotation; error?: string }> =>
      ipcRenderer.invoke('annotations:upsert-document', { workspaceRoot, relativePath, annotation }),
    createDocument: (workspaceRoot: string, relativePath: string, annotation: Annotation): Promise<{ success: boolean; data?: Annotation; error?: string }> =>
      ipcRenderer.invoke('annotations:create-document', { workspaceRoot, relativePath, annotation }),
    updateDocumentComment: (
      workspaceRoot: string,
      relativePath: string,
      id: string,
      comment: string,
      baseUpdatedAt: number
    ): Promise<{ success: boolean; data?: Annotation; error?: string }> =>
      ipcRenderer.invoke('annotations:update-document-comment', {
        workspaceRoot,
        relativePath,
        id,
        comment,
        baseUpdatedAt
      }),
    reanchorDocument: (
      workspaceRoot: string,
      relativePath: string,
      id: string,
      quote: string,
      anchor: AnnotationAnchor,
      baseAnchorRevision: number
    ): Promise<{ success: boolean; data?: Annotation; error?: string }> =>
      ipcRenderer.invoke('annotations:reanchor-document', {
        workspaceRoot,
        relativePath,
        id,
        quote,
        anchor,
        baseAnchorRevision
      }),
    upsertSource: (sourceKey: string, source: AnnotationSource, annotation: Annotation): Promise<{ success: boolean; data?: Annotation; error?: string }> =>
      ipcRenderer.invoke('annotations:upsert-source', { sourceKey, source, annotation }),
    updateSourceComment: (
      sourceKey: string,
      id: string,
      comment: string,
      baseUpdatedAt: number
    ): Promise<{ success: boolean; data?: Annotation; error?: string }> =>
      ipcRenderer.invoke('annotations:update-source-comment', {
        sourceKey,
        id,
        comment,
        baseUpdatedAt
      }),
    deleteDocument: (workspaceRoot: string, relativePath: string, id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('annotations:delete-document', { workspaceRoot, relativePath, id }),
    reconcileDocument: (
      workspaceRoot: string,
      relativePath: string,
      resolutions: DocumentResolution[]
    ): Promise<{
      success: boolean
      data?: {
        applied: string[]
        stale: string[]
        skipped: string[]
        annotations: Annotation[]
      }
      error?: string
    }> =>
      ipcRenderer.invoke('annotations:reconcile-document', {
        workspaceRoot,
        relativePath,
        resolutions
      }),
    deleteSource: (sourceKey: string, id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('annotations:delete-source', { sourceKey, id }),
    captureSource: (input: CaptureSourceInput): Promise<{ success: boolean; data?: CaptureSourceResult; error?: string }> =>
      ipcRenderer.invoke('annotations:capture-source', input),
    ensureDocument: (input: EnsureDocumentInput): Promise<{ success: boolean; data?: EnsureDocumentResult; error?: string }> =>
      ipcRenderer.invoke('annotations:ensure-document', input),
    captureExcerpt: (input: CaptureExcerptInput): Promise<{ success: boolean; data?: CaptureExcerptResult; error?: string }> =>
      ipcRenderer.invoke('annotations:capture-excerpt', input),
    onChanged: (cb: (event: AnnotationChangedEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AnnotationChangedEvent): void => cb(payload)
      ipcRenderer.on('annotations:changed', handler)
      return () => { ipcRenderer.removeListener('annotations:changed', handler) }
    }
  },

  // Agent 会话控制
  agentPrompt: (sessionId: string, prompt: string, attachments?: string[]): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('agent:prompt', { sessionId, prompt, attachments }),
  agentAbort: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:abort', { sessionId }),
  agentNewSession: (cwd?: string): Promise<{ success: boolean; data?: { sessionId: string }; error?: string }> =>
    ipcRenderer.invoke('agent:new-session', { cwd }),
  agentListSessions: (): Promise<{ success: boolean; data?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; cwd?: string; model?: string }>; error?: string }> =>
    ipcRenderer.invoke('agent:list-sessions'),
  agentResumeSession: (sessionId: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('agent:resume-session', { sessionId }),
  agentDeleteSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:delete-session', { sessionId }),
  agentRewind: (sessionId: string, entryId?: string): Promise<{ success: boolean; data?: { editorText: string }; error?: string }> =>
    ipcRenderer.invoke('agent:rewind', { sessionId, entryId }),
  agentForkSession: (sessionId: string, leafId?: string): Promise<{ success: boolean; data?: { sessionId: string }; error?: string }> =>
    ipcRenderer.invoke('agent:fork-session', { sessionId, leafId }),
  agentListBranchUserEntries: (sessionId: string): Promise<{ success: boolean; data?: Array<{ entryId: string; text: string }>; error?: string }> =>
    ipcRenderer.invoke('agent:list-branch-user-entries', { sessionId }),
  agentResolveApproval: (requestId: string, decision: 'allow' | 'always' | 'deny', pattern?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:resolve-approval', { requestId, decision, pattern }),
  agentSetPermissionMode: (sessionId: string, mode: 'default' | 'auto' | 'bypass' | 'full' | 'restricted' | 'readonly'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:set-permission-mode', { sessionId, mode }),
  agentSetModel: (sessionId: string, model: string, provider?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:set-model', { sessionId, model, provider }),
  agentListProviders: (): Promise<{ success: boolean; data?: Array<{ providerId: string; displayName: string; configured: boolean; authStatus?: { ok: boolean; error?: string }; models: string[] }>; error?: string }> =>
    ipcRenderer.invoke('agent:list-providers'),
  agentSetCredential: (providerId: string, cred: { type: 'api_key'; key: string; env?: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:set-credential', { providerId, cred }),
  agentDeleteCredential: (providerId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:delete-credential', { providerId }),
  agentGetActiveModel: (): Promise<{ success: boolean; data?: { providerId: string; modelId: string; baseUrl?: string }; error?: string }> =>
    ipcRenderer.invoke('agent:get-active-model'),
  agentListSkills: (cwd?: string): Promise<{ success: boolean; data?: Array<{ name: string; description: string; filePath: string; disableModelInvocation: boolean }>; error?: string }> =>
    ipcRenderer.invoke('agent:list-skills', { cwd }),
  agentGetConfig: (): Promise<{
    success: boolean
    data?: {
      agentDir: string
      skillDirCandidates: Array<{ path: string; exists: boolean; isDefault: boolean }>
      extraSkillDirs: string[]
      allowlist: Array<{ id: string; tool: string; pattern: string; createdAt: number }>
      activeModel: { providerId: string; modelId: string; baseUrl?: string }
    }
    error?: string
  }> => ipcRenderer.invoke('agent:get-config'),
  agentSetSkillDirs: (dirs: string[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:set-skill-dirs', { dirs }),
  agentAllowlistAdd: (tool: string, pattern: string): Promise<{ success: boolean; data?: { id: string; tool: string; pattern: string; createdAt: number }; error?: string }> =>
    ipcRenderer.invoke('agent:allowlist-add', { tool, pattern }),
  agentAllowlistRemove: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:allowlist-remove', { id }),
  agentGetRuntimeSnapshot: (sessionId?: string): Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }> =>
    ipcRenderer.invoke('agent:get-runtime-snapshot', { sessionId }),
  agentGetSessionStatus: (sessionId?: string): Promise<{ success: boolean; data?: AgentSessionStatus | null; error?: string }> =>
    ipcRenderer.invoke('agent:get-session-status', { sessionId }),
  agentSetThinkingLevel: (sessionId: string, level: AgentThinkingLevel): Promise<{ success: boolean; data?: AgentActiveModel; error?: string }> =>
    ipcRenderer.invoke('agent:set-thinking-level', { sessionId, level }),
  agentLoginProvider: (providerId: string, type: AgentAuthType): Promise<{ success: boolean; data?: AgentAuthOperation; error?: string }> =>
    ipcRenderer.invoke('agent:login-provider', { providerId, type }),
  agentRespondProviderAuth: (operationId: string, value: string): Promise<{ success: boolean; data?: AgentAuthOperation; error?: string }> =>
    ipcRenderer.invoke('agent:respond-provider-auth', { operationId, value }),
  agentCancelProviderAuth: (operationId: string): Promise<{ success: boolean; data?: AgentAuthOperation; error?: string }> =>
    ipcRenderer.invoke('agent:cancel-provider-auth', { operationId }),
  agentListAuthOperations: (): Promise<{ success: boolean; data?: AgentAuthOperation[]; error?: string }> =>
    ipcRenderer.invoke('agent:list-auth-operations'),
  agentLogoutProvider: (providerId: string): Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }> =>
    ipcRenderer.invoke('agent:logout-provider', { providerId }),
  agentRefreshProviderModels: (providerId: string): Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }> =>
    ipcRenderer.invoke('agent:refresh-provider-models', { providerId }),
  onAgentProviderAuthChanged: (cb: (payload: { operation: AgentAuthOperation }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { operation: AgentAuthOperation }): void => cb(payload)
    ipcRenderer.on('agent:provider-auth-changed', handler)
    return () => { ipcRenderer.removeListener('agent:provider-auth-changed', handler) }
  },
  onAgentRuntimeChanged: (cb: (payload: { reason: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { reason: string }): void => cb(payload)
    ipcRenderer.on('agent:runtime-changed', handler)
    return () => { ipcRenderer.removeListener('agent:runtime-changed', handler) }
  },
  onAgentSessionStatus: (cb: (payload: { sessionId: string; status: AgentSessionStatus }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; status: AgentSessionStatus }): void => cb(payload)
    ipcRenderer.on('agent:session-status', handler)
    return () => { ipcRenderer.removeListener('agent:session-status', handler) }
  },
  onAgentEvent: (cb: (payload: { sessionId: string; event: unknown }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; event: unknown }): void => cb(payload)
    ipcRenderer.on('agent:event', handler)
    return () => { ipcRenderer.removeListener('agent:event', handler) }
  },
  onAgentApprovalRequest: (cb: (payload: { requestId: string; sessionId: string; toolCallId: string; toolName: string; args: Record<string, unknown>; reason: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { requestId: string; sessionId: string; toolCallId: string; toolName: string; args: Record<string, unknown>; reason: string }): void => cb(payload)
    ipcRenderer.on('agent:approval-request', handler)
    return () => { ipcRenderer.removeListener('agent:approval-request', handler) }
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

export type API = typeof api
export type * from '../shared/types/workbench'
export type * from '../shared/types/annotations'
