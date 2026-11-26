import { create } from 'zustand'
import { useWorkbenchStore } from './workbenchStore'
import { useAgentSettingsDialogStore } from './agentSettingsDialogStore'
import {
  dedupePathsByAbsolute,
  extractMentionTokens,
  isFileMentioned,
  mentionTokenMatchesPath,
  normalizePath,
  removeFileMention,
  toMentionToken
} from '../components/workbench/agent/filePathUtils'
import type {
  AgentFileChangeStatus,
  AgentForkOrigin,
  AgentTurnFileChanges
} from '../../../shared/types/agentRuntime'
import type {
  AgentMessage,
  AgentSessionSummary,
  AgentApprovalRequest,
  AgentProviderInfo,
  AgentPermissionMode,
  AgentSkill,
  AgentConfig,
  AgentIpcApi,
  PiContentPart,
  AgentActiveModel,
  AgentAuthOperation,
  AgentAuthType,
  AgentFavoriteModel,
  AgentProviderQuota,
  AgentRuntimeSnapshot,
  AgentSessionStatus,
  AgentThinkingLevel
} from '../types/agent'

interface PiRawPart {
  type: string
  text?: string
  thinking?: string
  data?: string
  mimeType?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown> | string
  args?: Record<string, unknown> | string
  result?: unknown
  isError?: boolean
}

interface PiRawMessage {
  id?: string
  role?: string
  content?: string | PiRawPart[]
  timestamp?: number
  durationMs?: number
}

interface PiEventPayload {
  type: string
  message?: PiRawMessage
  messages?: PiRawMessage[]
  toolCallId?: string
  toolName?: string
  args?: Record<string, unknown> | string
  partialResult?: unknown
  result?: unknown
  isError?: boolean
  durationMs?: number
  willRetry?: boolean
  success?: boolean
  finalError?: string
  steering?: readonly string[]
  followUp?: readonly string[]
  texts?: string[]
  /** session_info_changed：会话显示名（pi session_info.name） */
  name?: string
}

function getAgentApi(): AgentIpcApi {
  return window.api as unknown as AgentIpcApi
}

/**
 * Shared IPC-subscription bookkeeping for `initListeners`.
 * The subscriptions are global to the renderer, but every mount point
 * (AgentCard, AgentProviderSettings, ...) calls initListeners/cleanup on its
 * own lifecycle. A reference count keeps the real subscription alive until
 * the last mount point unmounts, so one dialog closing can never tear down
 * channels that other consumers still rely on.
 */
let ipcListenerRefs = 0
let ipcListenerTeardown: (() => void) | null = null
let lastSkillsKey: string | undefined
let skillsFetchInFlight: { key: string; promise: Promise<void> } | null = null
let resumeAfterSwitchCwd: string | null = null

function normalizeWorkspaceKey(p?: string | null): string {
  return p ? normalizePath(p) : ''
}

function clearSnapshotUsage(snapshot: AgentRuntimeSnapshot | null): AgentRuntimeSnapshot | null {
  return snapshot ? { ...snapshot, context: null, stats: null } : null
}

function sanitizeSnapshotForSession(
  snapshot: AgentRuntimeSnapshot,
  currentSessionId: string | null
): AgentRuntimeSnapshot {
  return currentSessionId === null ? { ...snapshot, context: null, stats: null } : snapshot
}

function convertPiContentParts(rawContent?: string | PiRawPart[]): PiContentPart[] {
  if (!rawContent) return []
  if (typeof rawContent === 'string') {
    return [{ type: 'text', text: rawContent }]
  }
  const parts: PiContentPart[] = []
  for (const p of rawContent) {
    if (p.type === 'text' && typeof p.text === 'string') {
      parts.push({ type: 'text', text: p.text })
    } else if (p.type === 'thinking' && typeof p.thinking === 'string') {
      parts.push({ type: 'reasoning', reasoning: p.thinking })
    } else if (p.type === 'toolCall' || p.type === 'tool-call') {
      parts.push({
        type: 'tool-call',
        toolCallId: p.id || '',
        toolName: p.name || '',
        args: p.arguments || p.args || {}
      })
    } else if (p.type === 'image' && typeof p.data === 'string') {
      // 会话恢复时 pi 存的 data 是纯 base64；本地新发送的是 dataUrl。
      // 统一为 dataUrl 供 <img src> 使用。
      const mime = p.mimeType || 'image/png'
      const data = p.data.startsWith('data:') ? p.data : `data:${mime};base64,${p.data}`
      parts.push({ type: 'image', data, mimeType: mime })
    }
  }
  return parts
}

/**
 * 用 incoming（pi 推送的消息内容快照）替换当前消息 parts，
 * 但保留本地已有的 tool-call 运行信息（result/isError/durationMs）。
 * 关键约束：本地存在而 incoming 缺失的 tool-call 也必须保留——
 * 运行时 pi 的 message_end/message_update 快照在个别事件形态下不含 toolCall
 * （此时整个数组为空、或 toolCall 尚未组装进去），而 tool_execution_start
 * 已经先行在本地插入了对应 part。若直接整体覆盖，会把 tool-call part 抹掉，
 * 后续 allToolsDone 判空为 true，正在执行的长任务（如 image_gen）被提前
 * 标记 complete，UI 出现"仍在生成却显示成功、标题停止闪烁"。
 */
function mergeMessageParts(incoming: PiContentPart[], existing: PiContentPart[]): PiContentPart[] {
  const existingTools = new Map<string, PiContentPart>()
  for (const p of existing) {
    if (p.type === 'tool-call' && p.toolCallId) {
      existingTools.set(p.toolCallId, p)
    }
  }
  const merged = incoming.map((p) => {
    if (p.type === 'tool-call' && p.toolCallId && existingTools.has(p.toolCallId)) {
      const prev = existingTools.get(p.toolCallId)!
      existingTools.delete(p.toolCallId)
      return {
        ...p,
        result: prev.result ?? p.result,
        isError: prev.isError ?? p.isError,
        durationMs: prev.durationMs ?? p.durationMs
      }
    }
    return p
  })
  // incoming 里完全缺失的 tool-call：pi 的事件级 tool_execution_start 是权威来源，
  // 不能丢。追加在末尾（内容顺序此时已不再重要，运行信息准确性优先）。
  for (const orphan of existingTools.values()) {
    merged.push(orphan)
  }
  return merged
}

/** 消息内是否还有未出结果（也未报错）的 tool-call。 */
function hasUnresolvedToolCalls(content: PiContentPart[]): boolean {
  return content.some((p) => p.type === 'tool-call' && p.result === undefined && !p.isError)
}

/** 待发送图片附件：dataUrl 用于缩略图渲染与上传，name 仅为展示兜底。 */
export interface AgentImageAttachment {
  /** data URL（data:image/png;base64,...）或纯 base64，统一按 dataUrl 使用。 */
  dataUrl: string
  mimeType: string
  name?: string
}

interface AgentSessionState {
  /** 是否已有组件注册过 IPC 监听；防止重复订阅同一事件流 */
  listenersReady: boolean
  currentSessionId: string | null
  currentCwd: string | null
  sessions: AgentSessionSummary[]
  messages: AgentMessage[]
  isRunning: boolean
  runningSessionIds: Set<string>
  permissionMode: AgentPermissionMode
  pendingApprovals: AgentApprovalRequest[]
  /** 运行中已排队待投递的消息，按 sessionId 隔离（steering = 立即打断, followUp = 本轮结束后继续） */
  queuedSteering: Record<string, string[]>
  queuedFollowUp: Record<string, string[]>
  activeModel: string
  activeProvider: string
  providers: AgentProviderInfo[]
  snapshot: AgentRuntimeSnapshot | null
  providerQuotas: Record<string, AgentProviderQuota>
  quotasLoading: boolean
  authOperations: Record<string, AgentAuthOperation>
  sessionStatus: AgentSessionStatus | null
  isCompacting: boolean
  snapshotLoading: boolean
  skills: AgentSkill[]
  agentConfig: AgentConfig | null
  composerInput: string
  attachments: string[]
  imageAttachments: AgentImageAttachment[]
  settingsOpen: boolean
  branchUserEntries: Array<{ entryId: string; text: string }>
  fileChangesRecord: AgentTurnFileChanges | null
  forkOrigin: AgentForkOrigin | null
  /**
   * 失效工作区回看态：resume 一条 cwd 已失效（目录删除/改名/脱机）的会话后置位。
   * 置位期间 AgentCard 的工作区同步 effect 不得因 cwd !== workspacePath 清空消息；
   * 两个 AI 侧栏实例共享此标志，避免一侧回看被另一侧的同步逻辑清空。
   */
  foreignReview: boolean

  // Actions
  setSessionId: (id: string | null) => void
  setForeignReview: (value: boolean) => void
  setResumeAfterSwitchCwd: (cwd: string | null) => void
  consumeResumeAfterSwitchCwd: (cwd: string | null | undefined) => boolean
  fetchFileChanges: (sessionId?: string) => Promise<void>
  setFileChangesStatus: (status: AgentFileChangeStatus) => void
  setPermissionMode: (mode: AgentPermissionMode) => Promise<void>
  fetchPermissionMode: () => Promise<void>
  setComposerInput: (val: string) => void
  appendPromptText: (text: string) => void
  addAttachment: (path: string) => void
  mentionFile: (absPath: string) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  addImageAttachment: (img: AgentImageAttachment) => void
  removeImageAttachment: (index: number) => void
  setSettingsOpen: (open: boolean) => void
  refreshBranchEntries: () => Promise<void>

  initListeners: () => () => void
  fetchSessions: () => Promise<void>
  newSession: (cwd?: string) => Promise<string | null>
  createSession: (cwd?: string) => Promise<string | null>
  resumeSession: (sessionId: string) => Promise<boolean>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, name: string) => Promise<boolean>
  prompt: (text: string, attachments?: string[]) => Promise<void>
  abort: () => Promise<void>
  rewindLastUserMessage: (options?: { revertFiles?: boolean }) => Promise<{ ok: boolean; error?: string }>
  forkSession: () => Promise<boolean>
  copyText: (text: string) => Promise<boolean>
  resolveApproval: (
    requestId: string,
    decision: 'allow' | 'always' | 'deny',
    pattern?: string
  ) => Promise<void>
  fetchProviders: () => Promise<void>
  fetchSkills: (cwd?: string, force?: boolean) => Promise<void>
  setCredential: (
    providerId: string,
    cred: { type: 'api_key'; key: string; env?: string; baseUrl?: string }
  ) => Promise<{ ok: boolean; error?: string }>
  deleteCredential: (providerId: string) => Promise<boolean>
  setModel: (model: string, provider?: string) => Promise<boolean>
  fetchSnapshot: (sessionId?: string) => Promise<void>
  fetchSessionStatus: (sessionId?: string) => Promise<void>
  setThinkingLevel: (level: AgentThinkingLevel) => Promise<boolean>
  compact: (instructions?: string) => Promise<boolean>
  setAutoCompaction: (enabled: boolean) => Promise<boolean>
  loginProvider: (providerId: string, type: AgentAuthType) => Promise<AgentAuthOperation | null>
  respondProviderAuth: (operationId: string, value: string) => Promise<boolean>
  cancelProviderAuth: (operationId: string) => Promise<boolean>
  logoutProvider: (providerId: string) => Promise<boolean>
  refreshProviderModels: (providerId: string) => Promise<boolean>
  setProviderBaseUrl: (providerId: string, baseUrl: string | null) => Promise<boolean>
  setProviderDisabled: (providerId: string, disabled: boolean) => Promise<boolean>
  setModelFavorite: (providerId: string, modelId: string, favored: boolean) => Promise<boolean>
  removeRecentModels: (items: AgentFavoriteModel[]) => Promise<boolean>
  fetchProviderQuotas: (force?: boolean) => Promise<void>
  refreshProviderQuota: (providerId: string) => Promise<void>
  openAgentSettings: () => void
  fetchConfig: () => Promise<void>
  setSkillDirs: (dirs: string[]) => Promise<boolean>
  addAllowlist: (tool: string, pattern: string) => Promise<boolean>
  removeAllowlist: (id: string) => Promise<boolean>

  handleAgentEvent: (sessionId: string, event: PiEventPayload) => void
  handleApprovalRequest: (request: AgentApprovalRequest) => void
}

export const useAgentSessionStore = create<AgentSessionState>((set, get) => ({
  listenersReady: false,
  currentSessionId: null,
  currentCwd: null,
  sessions: [],
  messages: [],
  isRunning: false,
  runningSessionIds: new Set<string>(),
  permissionMode: 'default',
  pendingApprovals: [],
  queuedSteering: {},
  queuedFollowUp: {},
  activeModel: 'devin/swe-2',
  activeProvider: 'magpie',
  providers: [],
  snapshot: null,
  providerQuotas: {},
  quotasLoading: false,
  authOperations: {},
  sessionStatus: null,
  isCompacting: false,
  snapshotLoading: false,
  skills: [],
  agentConfig: null,
  composerInput: '',
  attachments: [],
  imageAttachments: [],
  settingsOpen: false,
  branchUserEntries: [],
  fileChangesRecord: null,
  forkOrigin: null,
  foreignReview: false,

  setSessionId: (id) => {
    const prevId = get().currentSessionId
    set((s) => ({
      currentSessionId: id,
      isRunning: id ? s.runningSessionIds.has(id) : false,
      ...(id !== prevId ? { fileChangesRecord: null, forkOrigin: null } : {})
    }))
    if (id && id !== prevId) {
      void get().fetchFileChanges(id)
    }
  },
  setForeignReview: (value) => set({ foreignReview: value }),
  setResumeAfterSwitchCwd: (cwd) => {
    resumeAfterSwitchCwd = cwd
  },
  consumeResumeAfterSwitchCwd: (cwd) => {
    if (!resumeAfterSwitchCwd || !cwd) return false
    if (normalizePath(resumeAfterSwitchCwd) === normalizePath(cwd)) {
      resumeAfterSwitchCwd = null
      return true
    }
    return false
  },
  fetchFileChanges: async (sessionId) => {
    const targetId = sessionId ?? get().currentSessionId
    if (!targetId) {
      set({ fileChangesRecord: null })
      return
    }
    try {
      const res = await window.api.agentGetFileChanges(targetId)
      if (get().currentSessionId !== targetId) return
      if (res.success && res.data && res.data.files.length > 0) {
        set({ fileChangesRecord: res.data })
      } else {
        set({ fileChangesRecord: null })
      }
    } catch {
      if (get().currentSessionId === targetId) {
        set({ fileChangesRecord: null })
      }
    }
  },
  setFileChangesStatus: (status) =>
    set((s) => ({
      fileChangesRecord: s.fileChangesRecord ? { ...s.fileChangesRecord, status } : null
    })),

  refreshBranchEntries: async () => {
    const sessionId = get().currentSessionId
    if (!sessionId) {
      set({ branchUserEntries: [] })
      return
    }
    try {
      const res = await getAgentApi().agentListBranchUserEntries(sessionId)
      set({ branchUserEntries: res.success && res.data ? res.data : [] })
    } catch {
      set({ branchUserEntries: [] })
    }
  },

  setPermissionMode: async (mode) => {
    set({ permissionMode: mode })
    const sessionId = get().currentSessionId
    try {
      // Always persist on main side — even before a session exists, so the
      // mode is picked up by the next newSession / resumeSession.
      await getAgentApi().agentSetPermissionMode(sessionId ?? '', mode)
    } catch (err) {
      console.warn('[agentSessionStore] Failed to sync permission mode:', err)
    }
  },
  fetchPermissionMode: async () => {
    try {
      const res = await getAgentApi().agentGetPermissionMode(get().currentSessionId ?? undefined)
      if (res.success && res.data) {
        const normalized: AgentPermissionMode =
          res.data === 'auto' || res.data === 'bypass' ? res.data : 'default'
        set({ permissionMode: normalized })
      }
    } catch (err) {
      console.warn('[agentSessionStore] fetchPermissionMode error:', err)
    }
  },

  /**
   * 输入框文本更新入口。除了保存文本外，还按当前文本中的 @token
   * 与 attachments 做反向对账：用户删掉某个 @file 时，对应附件 chip
   * 一并移除；用户手动补 @file 时，对应路径重新登记为附件。
   * 这样 chip 与文本互为单一事实来源，不会出现两边脱节。
   */
  setComposerInput: (val) =>
    set((s) => {
      const workspacePath = useWorkbenchStore.getState().workspacePath
      const tokens = extractMentionTokens(val)
      const attachments = s.attachments.filter((path) =>
        tokens.some((token) => mentionTokenMatchesPath(token, path, workspacePath))
      )
      return { composerInput: val, attachments }
    }),

  appendPromptText: (text) =>
    set((s) => ({
      composerInput: s.composerInput ? `${s.composerInput} ${text}` : text
    })),

  addAttachment: (path) =>
    set((s) => {
      const key = normalizePath(path)
      if (s.attachments.some((p) => normalizePath(p) === key)) return s
      return { attachments: [...s.attachments, path] }
    }),

  /**
   * 文件拖入 / @ 引用统一入口：登记附件并把 `@<path>` token 追加到输入框。
   * 工作区内文件用相对路径 token（与 @-mention 一致），外部文件用绝对路径，
   * 保证 token 文本在消息气泡与 pi 端 prompt 中都能还原出同一引用。
   * 同一文件（附件或输入框已有 @token）重复触发时保持现状，不再重复插入。
   */
  mentionFile: (absPath) =>
    set((s) => {
      if (!absPath) return s
      const workspacePath = useWorkbenchStore.getState().workspacePath
      const token = toMentionToken(absPath, workspacePath)
      const key = normalizePath(absPath)
      const alreadyAttached = s.attachments.some((p) => normalizePath(p) === key)
      const alreadyMentioned = isFileMentioned(s.composerInput, absPath, workspacePath)
      if (alreadyAttached && alreadyMentioned) return s
      const needsSpace = s.composerInput.length > 0 && !/[\s@]$/.test(s.composerInput)
      const composerInput = alreadyMentioned
        ? s.composerInput
        : `${s.composerInput}${needsSpace ? ' ' : ''}@${token} `
      return {
        attachments: alreadyAttached ? s.attachments : [...s.attachments, absPath],
        composerInput
      }
    }),

  removeAttachment: (index) =>
    set((s) => {
      const target = s.attachments[index]
      const workspacePath = useWorkbenchStore.getState().workspacePath
      const composerInput = target
        ? removeFileMention(s.composerInput, target, workspacePath)
        : s.composerInput
      return {
        attachments: s.attachments.filter((_, i) => i !== index),
        composerInput
      }
    }),

  clearAttachments: () =>
    set((s) => {
      const workspacePath = useWorkbenchStore.getState().workspacePath
      let composerInput = s.composerInput
      for (const path of s.attachments) {
        composerInput = removeFileMention(composerInput, path, workspacePath)
      }
      return { attachments: [], composerInput }
    }),

  addImageAttachment: (img) =>
    set((s) => {
      if (!img?.dataUrl) return s
      // 同一 base64 去重，避免重复粘贴/拖入同一张图。
      if (s.imageAttachments.some((x) => x.dataUrl === img.dataUrl)) return s
      return { imageAttachments: [...s.imageAttachments, img] }
    }),

  removeImageAttachment: (index) =>
    set((s) => ({
      imageAttachments: s.imageAttachments.filter((_, i) => i !== index)
    })),

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  initListeners: () => {
    ipcListenerRefs += 1
    // 已有活动订阅（例如另一个 AgentCard 实例仍挂着）：仅补拉数据，不重复订阅，
    // 否则每条事件会被 handleAgentEvent 处理多次。cleanup 按引用计数在
    // 最后一个挂载点卸载时才真正拆掉 IPC 通道。
    if (ipcListenerTeardown) {
      return () => {
        ipcListenerRefs -= 1
        if (ipcListenerRefs <= 0) {
          ipcListenerRefs = 0
          ipcListenerTeardown?.()
          ipcListenerTeardown = null
          set({ listenersReady: false })
        }
      }
    }
    set({ listenersReady: true })
    const api = getAgentApi()
    let cleanupEvent: (() => void) | undefined
    let cleanupApproval: (() => void) | undefined
    let cleanupAuth: (() => void) | undefined
    let cleanupRuntime: (() => void) | undefined
    let cleanupStatus: (() => void) | undefined
    let cleanupQuota: (() => void) | undefined

    if (typeof api.onAgentEvent === 'function') {
      cleanupEvent = api.onAgentEvent(({ sessionId, event }) => {
        get().handleAgentEvent(sessionId, event as PiEventPayload)
      })
    }

    if (typeof api.onAgentApprovalRequest === 'function') {
      cleanupApproval = api.onAgentApprovalRequest((request) => {
        get().handleApprovalRequest(request)
      })
    }

    if (typeof api.onAgentProviderAuthChanged === 'function') {
      cleanupAuth = api.onAgentProviderAuthChanged(({ operation }) => {
        set((s) => ({ authOperations: { ...s.authOperations, [operation.id]: operation } }))
        if (operation.status === 'success') {
          void get().fetchSnapshot()
        }
      })
    }

    if (typeof api.onAgentRuntimeChanged === 'function') {
      cleanupRuntime = api.onAgentRuntimeChanged(() => {
        void get().fetchSnapshot()
      })
    }

    if (typeof api.onAgentSessionStatus === 'function') {
      cleanupStatus = api.onAgentSessionStatus(({ sessionId, status }) => {
        const current = get().currentSessionId
        if (!current || sessionId !== current) return
        set({ sessionStatus: status })
      })
    }

    if (typeof api.onAgentProviderQuotaUpdated === 'function') {
      cleanupQuota = api.onAgentProviderQuotaUpdated(({ quota }) => {
        set((s) => ({
          providerQuotas: { ...s.providerQuotas, [quota.providerId]: quota }
        }))
      })
    }

    // Load active model / providers / sessions initially
    void get().fetchProviders()
    void get().fetchSessions()
    void get().fetchSkills(useWorkbenchStore.getState().workspacePath ?? undefined)
    void get().fetchSnapshot()
    void get().fetchPermissionMode()
    void api.agentListAuthOperations?.().then((res) => {
      if (res.success && res.data) {
        const map: Record<string, AgentAuthOperation> = {}
        for (const operation of res.data) map[operation.id] = operation
        set({ authOperations: map })
      }
    }).catch(() => undefined)

    const teardown = (): void => {
      cleanupEvent?.()
      cleanupApproval?.()
      cleanupAuth?.()
      cleanupRuntime?.()
      cleanupStatus?.()
      cleanupQuota?.()
    }
    ipcListenerTeardown = teardown

    return () => {
      ipcListenerRefs -= 1
      if (ipcListenerRefs <= 0) {
        ipcListenerRefs = 0
        if (ipcListenerTeardown === teardown) ipcListenerTeardown = null
        teardown()
        set({ listenersReady: false })
      }
    }
  },

  fetchSessions: async () => {
    try {
      const res = await getAgentApi().agentListSessions()
      if (res.success && res.data) {
        // isRunning 取后端快照与本地 runningSessionIds 的并集：
        // - 后端快照覆盖"侧栏挂载前已在跑"的会话；
        // - 本地 set 覆盖"agent_start 已到达但后端 listSessions 时序滞后"的会话。
        const running = get().runningSessionIds
        const sessions = res.data.map((item) => ({
          ...item,
          isRunning: item.isRunning === true || running.has(item.id)
        }))
        // 后端报告在跑但本地 set 缺失的会话，补进 set，
        // 保持 setSessionId/resumeSession 派生的顶层 isRunning 正确。
        let runningNext: Set<string> | null = null
        for (const item of sessions) {
          if (item.isRunning && !running.has(item.id)) {
            runningNext ??= new Set(running)
            runningNext.add(item.id)
          }
        }
        set(runningNext ? { sessions, runningSessionIds: runningNext } : { sessions })
      }
    } catch (err) {
      console.warn('[agentSessionStore] fetchSessions error:', err)
    }
  },

  // Reset to a draft state without touching the backend: the real session is
  // created lazily on the first `prompt`. This avoids accumulating empty
  // sessions in the history list.
  newSession: async (cwd) => {
    const activeWorkspace = useWorkbenchStore.getState().workspacePath
    const targetCwd = cwd || activeWorkspace || null
    const state = get()
    if (
      state.currentSessionId === null &&
      state.currentCwd === targetCwd &&
      state.messages.length === 0 &&
      state.pendingApprovals.length === 0 &&
      state.fileChangesRecord === null &&
      state.sessionStatus === null &&
      !state.isCompacting &&
      (state.snapshot?.context ?? null) === null &&
      (state.snapshot?.stats ?? null) === null &&
      !state.foreignReview
    ) {
      return null
    }
    set((s) => ({
      currentSessionId: null,
      currentCwd: targetCwd,
      messages: [],
      isRunning: false,
      pendingApprovals: [],
      composerInput: '',
      attachments: [],
      branchUserEntries: [],
      fileChangesRecord: null,
      forkOrigin: null,
      foreignReview: false,
      sessionStatus: null,
      isCompacting: false,
      snapshot: clearSnapshotUsage(s.snapshot)
    }))
    return null
  },

  createSession: async (cwd) => {
    try {
      const activeWorkspace = useWorkbenchStore.getState().workspacePath
      const targetCwd = cwd || activeWorkspace || undefined
      const res = await getAgentApi().agentNewSession(targetCwd)
      if (res.success && res.data?.sessionId) {
        const sessionId = res.data.sessionId
        set((s) => ({
          currentSessionId: sessionId,
          currentCwd: targetCwd || null,
          messages: [],
          isRunning: false,
          pendingApprovals: [],
          composerInput: '',
          attachments: [],
          branchUserEntries: [],
          fileChangesRecord: null,
          forkOrigin: null,
          foreignReview: false,
          sessionStatus: null,
          isCompacting: false,
          snapshot: clearSnapshotUsage(s.snapshot)
        }))
        void get().fetchSessions()
        void get().fetchSnapshot(sessionId)
        void get().fetchSessionStatus(sessionId)
        return sessionId
      }
    } catch (err) {
      console.error('[agentSessionStore] createSession error:', err)
    }
    return null
  },

  resumeSession: async (sessionId: string) => {
    try {
      const res = await getAgentApi().agentResumeSession(sessionId)
      if (res.success) {
        const rawData = res.data as {
          messages?: PiRawMessage[]
          model?: string
          provider?: string
          cwd?: string
          permissionMode?: string
          forkOrigin?: AgentForkOrigin
          /** 主进程报告该会话是否仍在运行（恢复发生在长任务 mid-flight 时为 true） */
          isRunning?: boolean
        } | null
        // 后端权威运行态：resume 命中仍 active 的会话时为 true。
        // 典型场景：渲染层 HMR/重载或切换会话时，image_gen 这类 60-90s 长任务
        // 还在主进程里跑；此时恢复的 assistant 消息若有未出结果的 tool-call，
        // 必须还原为 running，而不是 complete，否则 UI 出现假成功/停止闪烁。
        const backendRunning = rawData?.isRunning === true
        const restoredMessages: AgentMessage[] = []

        if (rawData?.messages && Array.isArray(rawData.messages)) {
          // 1. 建立 toolCallId -> result 映射表
          const toolResultsMap = new Map<string, unknown>()
          for (const m of rawData.messages) {
            const mRole = String(m.role || '').toLowerCase()
            if (mRole === 'toolresult' || mRole === 'tool') {
              const tcId = (m as { toolCallId?: string }).toolCallId
              if (tcId) {
                // 归一为 tool_execution_end 事件里 result 的形状（{content, details, isError}），
                // 否则恢复出来的会话里 extractToolResultText 无法区分空结果与结构缺失。
                const details = (m as { details?: unknown }).details
                toolResultsMap.set(tcId, {
                  content: m.content,
                  ...(details !== undefined ? { details } : {}),
                  isError: Boolean((m as { isError?: boolean }).isError)
                })
              }
            }
          }

          // 2. 仅恢复 user 和 assistant 消息，并将 toolResult 注入对应 tool-call
          for (let i = 0; i < rawData.messages.length; i++) {
            const m = rawData.messages[i]
            const mRole = String(m.role || '').toLowerCase()
            // 阻断 toolResult 独立流出到消息列表，避免在正文中裸露渲染
            if (mRole === 'toolresult' || mRole === 'tool') {
              continue
            }

            const role = (m.role || 'assistant') as AgentMessage['role']
            const parts = convertPiContentParts(m.content)

            // 注入匹配的 toolResult
            const enrichedParts = parts.map((p) => {
              if (p.type === 'tool-call' && p.toolCallId && toolResultsMap.has(p.toolCallId)) {
                return {
                  ...p,
                  result: p.result ?? toolResultsMap.get(p.toolCallId)
                }
              }
              return p
            })

            restoredMessages.push({
              id: m.id || `msg_restored_${i}`,
              role,
              content: enrichedParts,
              status:
                backendRunning && role === 'assistant' && hasUnresolvedToolCalls(enrichedParts)
                  ? 'running'
                  : 'complete',
              createdAt: m.timestamp ?? Date.now(),
              timestamp: m.timestamp,
              durationMs: m.durationMs
            })
          }

          // 给每轮最后一条 assistant 消息补上「query → 该轮结束」的耗时：
          // 最近一条 user.timestamp → 该 assistant.timestamp + durationMs
          for (let i = restoredMessages.length - 1; i >= 0; i--) {
            const msg = restoredMessages[i]
            if (msg.role !== 'assistant') continue
            const next = restoredMessages[i + 1]
            if (next && next.role === 'assistant') continue
            if (msg.timestamp === undefined || msg.durationMs === undefined) continue
            let userTs: number | undefined
            for (let j = i - 1; j >= 0; j--) {
              if (restoredMessages[j].role === 'user' && restoredMessages[j].timestamp) {
                userTs = restoredMessages[j].timestamp
                break
              }
            }
            if (userTs !== undefined) {
              msg.turnDurationMs = msg.timestamp + msg.durationMs - userTs
            }
          }
        }

        set((s) => ({
          currentSessionId: sessionId,
          currentCwd: rawData?.cwd || null,
          messages: restoredMessages,
          pendingApprovals: [],
          fileChangesRecord: null,
          forkOrigin: rawData?.forkOrigin ?? null,
          sessionStatus: null,
          isCompacting: false,
          snapshot: clearSnapshotUsage(s.snapshot),
          activeModel: rawData?.model || s.activeModel,
          activeProvider: rawData?.provider || s.activeProvider,
          permissionMode: rawData?.permissionMode === 'auto' || rawData?.permissionMode === 'bypass'
            ? rawData.permissionMode
            : 'default',
          isRunning: backendRunning || s.runningSessionIds.has(sessionId),
          runningSessionIds: backendRunning
            ? new Set(s.runningSessionIds).add(sessionId)
            : s.runningSessionIds
        }))
        // isRunning is derived from runningSessionIds — populated by live events.
        void get().fetchSnapshot(sessionId)
        void get().fetchSessionStatus(sessionId)
        void get().fetchFileChanges(sessionId)
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] resumeSession error:', err)
    }
    return false
  },

  deleteSession: async (sessionId: string) => {
    try {
      const res = await getAgentApi().agentDeleteSession(sessionId)
      if (!res.success) {
        console.error('[agentSessionStore] deleteSession error:', res.error)
        return false
      }

      const wasCurrent = get().currentSessionId === sessionId
      const currentForkOrigin = get().forkOrigin
      set({
        sessions: get().sessions.filter((s) => s.id !== sessionId),
        ...(currentForkOrigin?.parentSessionId === sessionId
          ? { forkOrigin: { ...currentForkOrigin, parentExists: false } }
          : {})
      })

      if (wasCurrent) {
        // Back to a draft state; a fresh session is created lazily on next prompt.
        set((s) => ({
          currentSessionId: null,
          messages: [],
          isRunning: false,
          pendingApprovals: [],
          fileChangesRecord: null,
          forkOrigin: null,
          sessionStatus: null,
          isCompacting: false,
          snapshot: clearSnapshotUsage(s.snapshot)
        }))
      }
      return true
    } catch (err) {
      console.error('[agentSessionStore] deleteSession error:', err)
      return false
    }
  },

  renameSession: async (sessionId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    try {
      const res = await getAgentApi().agentRenameSession(sessionId, trimmed)
      if (!res.success) {
        console.error('[agentSessionStore] renameSession error:', res.error)
        return false
      }
      const title = trimmed.slice(0, 48)
      set((s) => ({
        sessions: s.sessions.map((item) => {
          if (item.id === sessionId) return { ...item, title, name: trimmed }
          if (item.parentSessionId === sessionId) return { ...item, parentSessionTitle: title }
          return item
        }),
        forkOrigin:
          s.forkOrigin?.parentSessionId === sessionId
            ? { ...s.forkOrigin, parentSessionTitle: title }
            : s.forkOrigin
      }))
      return true
    } catch (err) {
      console.error('[agentSessionStore] renameSession error:', err)
      return false
    }
  },

  prompt: async (text: string, attachments?: string[]) => {
    const trimmed = text.trim()
    const imageAttachments = get().imageAttachments
    if (!trimmed && imageAttachments.length === 0) return
    let sessionId = get().currentSessionId
    const activeWorkspace = useWorkbenchStore.getState().workspacePath
    const currentCwd = get().currentCwd

    // If workspace changed or no session exists, initiate session for active workspace
    if (!sessionId || (activeWorkspace && currentCwd && currentCwd !== activeWorkspace)) {
      sessionId = await get().createSession(activeWorkspace || undefined)
      if (!sessionId) return
    }

    // 附件按绝对路径去重（cwd 兜底工作区），避免同一文件经绝对/相对两种
    // 形态同时到达 agent。
    const cwd = get().currentCwd || useWorkbenchStore.getState().workspacePath
    const attachList = dedupePathsByAbsolute(attachments || get().attachments, cwd)
    let fullPrompt = trimmed
    if (attachList.length > 0) {
      const pending = attachList.filter((p) => !isFileMentioned(fullPrompt, p, cwd))
      if (pending.length > 0) {
        const paths = pending.map((p) => `@${p}`).join(' ')
        fullPrompt = `${fullPrompt} ${paths}`
      }
    }

    // If this session is already running, steer the new instruction in: pi's
    // agent loop polls steering after each turn_end and injects it before the
    // next LLM request — this is "insert at next turn", NOT abort mid-stream.
    const wasRunning = get().runningSessionIds.has(sessionId)

    const imageParts: PiContentPart[] = imageAttachments.map((img) => ({
      type: 'image',
      data: img.dataUrl,
      mimeType: img.mimeType
    }))
    const userMsg: AgentMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: [...imageParts, { type: 'text', text: fullPrompt }],
      status: wasRunning ? 'running' : 'complete',
      createdAt: Date.now(),
      timestamp: Date.now()
    }

    // Only append a placeholder assistant message when we expect a fresh turn
    // to start immediately; queued inputs reuse the in-flight assistant entry.
    const assistantMsg: AgentMessage | null = wasRunning
      ? null
      : {
          id: `msg_a_${Date.now()}`,
          role: 'assistant',
          content: [],
          status: 'running',
          createdAt: Date.now()
        }

    set((s) => ({
      messages: assistantMsg ? [...s.messages, userMsg, assistantMsg] : [...s.messages, userMsg],
      runningSessionIds: new Set(s.runningSessionIds).add(sessionId),
      isRunning: s.currentSessionId === sessionId ? true : s.isRunning,
      composerInput: '',
      attachments: [],
      imageAttachments: []
    }))

    try {
      const images = imageAttachments.map((img) => ({
        data: img.dataUrl.includes(',') ? img.dataUrl.split(',', 2)[1] : img.dataUrl,
        mimeType: img.mimeType
      }))
      const res = await getAgentApi().agentPrompt(
        sessionId,
        fullPrompt || ' ',
        attachList,
        wasRunning ? 'steer' : undefined,
        images.length > 0 ? images : undefined
      )
      if (!res.success) {
        set((s) => ({
          runningSessionIds: (() => {
            const next = new Set(s.runningSessionIds)
            next.delete(sessionId)
            return next
          })(),
          isRunning: s.currentSessionId === sessionId ? false : s.isRunning,
          messages: s.messages.map((m) =>
            assistantMsg && m.id === assistantMsg.id
              ? {
                  ...m,
                  status: 'error',
                  error: res.error || '执行出错',
                  content: [{ type: 'text', text: `错误: ${res.error || '执行失败'}` }]
                }
              : m.id === userMsg.id
                ? { ...m, status: 'error', error: res.error || '发送失败' }
                : m
          )
        }))
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      set((s) => ({
        runningSessionIds: (() => {
          const next = new Set(s.runningSessionIds)
          next.delete(sessionId)
          return next
        })(),
        isRunning: s.currentSessionId === sessionId ? false : s.isRunning,
        messages: s.messages.map((m) =>
          assistantMsg && m.id === assistantMsg.id
            ? {
                ...m,
                status: 'error',
                error: errorMsg,
                content: [{ type: 'text', text: `异常: ${errorMsg}` }]
              }
            : m.id === userMsg.id
              ? { ...m, status: 'error', error: errorMsg }
              : m
        )
      }))
    }
  },

  abort: async () => {
    const sessionId = get().currentSessionId
    if (!sessionId) return
    try {
      await getAgentApi().agentAbort(sessionId)
      set((s) => ({
        runningSessionIds: (() => {
          const next = new Set(s.runningSessionIds)
          next.delete(sessionId)
          return next
        })(),
        isRunning: s.currentSessionId === sessionId ? false : s.isRunning,
        pendingApprovals: [],
        messages: s.messages.map((m, idx) =>
          idx === s.messages.length - 1 && m.role === 'assistant'
            ? { ...m, status: 'aborted' }
            : m
        )
      }))
    } catch (err) {
      console.warn('[agentSessionStore] abort error:', err)
    }
  },

  /**
   * Rewind the conversation by one step: the leaf moves to the parent of the
   * most recent user message, that prompt text goes back into the composer,
   * and the local timeline is trimmed so the abandoned branch is no longer
   * shown. When the abandoned turn produced file changes, the caller passes
   * `revertFiles: true` to roll them back through the same validated revert
   * path as the changed-files card; a failed revert aborts the whole rewind
   * so conversation and file state never disagree about what happened.
   */
  rewindLastUserMessage: async (options?: { revertFiles?: boolean }) => {
    const sessionId = get().currentSessionId
    if (!sessionId || get().runningSessionIds.has(sessionId)) {
      return { ok: false, error: '任务正在运行，无法撤回' }
    }
    try {
      const res = await getAgentApi().agentRewind(sessionId, undefined, options?.revertFiles)
      if (!res.success || !res.data) {
        console.warn('[agentSessionStore] rewind failed:', res.error)
        return { ok: false, error: res.error || '撤回失败' }
      }
      const editorText = res.data.editorText ?? ''
      // Trim the local timeline back to just before the last user message so
      // the abandoned branch (user prompt + assistant reply + tool calls) is
      // no longer rendered. The entries stay in the session file.
      set((s) => {
        const msgs = [...s.messages]
        let cut = -1
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            cut = i
            break
          }
        }
        const nextMessages = cut >= 0 ? msgs.slice(0, cut) : msgs
        const remainingRenderable = nextMessages.filter(
          (m) => m.role === 'user' || m.role === 'assistant'
        ).length
        const nextForkOrigin =
          s.forkOrigin && s.forkOrigin.inheritedMessageCount !== undefined
            ? {
                ...s.forkOrigin,
                inheritedMessageCount: Math.min(s.forkOrigin.inheritedMessageCount, remainingRenderable)
              }
            : s.forkOrigin
        return {
          messages: nextMessages,
          forkOrigin: nextForkOrigin,
          composerInput: editorText,
          pendingApprovals: []
        }
      })
      void get().fetchSessionStatus(sessionId)
      void get().fetchFileChanges(sessionId)
      return { ok: true }
    } catch (err) {
      console.warn('[agentSessionStore] rewind error:', err)
      return { ok: false, error: err instanceof Error ? err.message : '撤回失败' }
    }
  },

  /**
   * Fork the current session at its latest position: the full conversation
   * (including the selected turn's assistant reply) is copied into a new
   * session file, the UI switches to it, and the original stays in history.
   */
  forkSession: async () => {
    const sessionId = get().currentSessionId
    if (!sessionId || get().runningSessionIds.has(sessionId)) return false
    try {
      const res = await getAgentApi().agentForkSession(sessionId)
      if (!res.success || !res.data) {
        console.warn('[agentSessionStore] fork failed:', res.error)
        return false
      }
      const ok = await get().resumeSession(res.data.sessionId)
      if (!ok) return false
      if (res.data.forkOrigin) {
        set({ forkOrigin: res.data.forkOrigin })
      }
      void get().fetchSessions()
      return true
    } catch (err) {
      console.warn('[agentSessionStore] fork error:', err)
      return false
    }
  },

  copyText: async (text: string) => {
    if (!text) return false
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.warn('[agentSessionStore] copy failed:', err)
      return false
    }
  },

  resolveApproval: async (requestId, decision, pattern) => {
    try {
      await getAgentApi().agentResolveApproval(requestId, decision, pattern)
      set((s) => ({
        pendingApprovals: s.pendingApprovals.filter((r) => r.requestId !== requestId)
      }))
    } catch (err) {
      console.error('[agentSessionStore] resolveApproval error:', err)
    }
  },

  fetchProviders: async () => {
    try {
      const api = getAgentApi()
      const [provRes, activeRes] = await Promise.all([
        api.agentListProviders(),
        api.agentGetActiveModel()
      ])
      if (provRes.success && provRes.data) {
        set({ providers: provRes.data })
      }
      if (activeRes.success && activeRes.data) {
        set({
          activeModel: activeRes.data.modelId,
          activeProvider: activeRes.data.providerId
        })
      }
    } catch (err) {
      console.warn('[agentSessionStore] fetchProviders error:', err)
    }
  },

  fetchSkills: async (cwd, force = false) => {
    const key = normalizeWorkspaceKey(cwd)
    if (!force) {
      if (skillsFetchInFlight?.key === key) {
        return skillsFetchInFlight.promise
      }
      if (lastSkillsKey === key) {
        return
      }
    }
    const promise = (async () => {
      try {
        const res = await getAgentApi().agentListSkills(cwd)
        if (res.success && res.data) {
          lastSkillsKey = key
          set({ skills: res.data })
        }
      } catch (err) {
        console.warn('[agentSessionStore] fetchSkills error:', err)
      } finally {
        if (skillsFetchInFlight?.key === key) {
          skillsFetchInFlight = null
        }
      }
    })()
    skillsFetchInFlight = { key, promise }
    return promise
  },

  setCredential: async (providerId, cred) => {
    try {
      const res = await getAgentApi().agentSetCredential(providerId, cred)
      if (res.success) {
        await get().fetchProviders()
        return { ok: true }
      }
      return { ok: false, error: res.error || '保存 API Key 失败' }
    } catch (err) {
      console.error('[agentSessionStore] setCredential error:', err)
      return { ok: false, error: err instanceof Error ? err.message : '保存 API Key 失败' }
    }
  },

  deleteCredential: async (providerId) => {
    try {
      const res = await getAgentApi().agentDeleteCredential(providerId)
      if (res.success) {
        await get().fetchProviders()
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] deleteCredential error:', err)
    }
    return false
  },

  setModel: async (model, provider) => {
    const sessionId = get().currentSessionId || ''
    try {
      const res = await getAgentApi().agentSetModel(sessionId, model, provider)
      if (res.success) {
        set({
          activeModel: model,
          activeProvider: provider || get().activeProvider
        })
        void get().fetchSnapshot()
        void get().fetchSessionStatus()
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setModel error:', err)
    }
    return false
  },

  fetchSnapshot: async (sessionId) => {
    set({ snapshotLoading: true })
    const requestedSessionId = sessionId ?? get().currentSessionId ?? ''
    try {
      const res = await getAgentApi().agentGetRuntimeSnapshot(requestedSessionId)
      if (res.success && res.data) {
        const snapshotData = res.data
        set((s) => {
          const activeSessionId = s.currentSessionId ?? ''
          const sameSession = activeSessionId === requestedSessionId
          return {
            snapshot: sameSession
              ? sanitizeSnapshotForSession(snapshotData, s.currentSessionId)
              : { ...snapshotData, context: null, stats: null },
            ...(sameSession
              ? {
                  activeModel: snapshotData.active.modelId,
                  activeProvider: snapshotData.active.providerId
                }
              : {}),
            snapshotLoading: false
          }
        })
      } else {
        set({ snapshotLoading: false })
      }
    } catch (err) {
      console.warn('[agentSessionStore] fetchSnapshot error:', err)
      set({ snapshotLoading: false })
    }
  },

  fetchSessionStatus: async (sessionId) => {
    const requestedSessionId = sessionId ?? get().currentSessionId
    if (!requestedSessionId) {
      set({ sessionStatus: null })
      return
    }
    try {
      const res = await getAgentApi().agentGetSessionStatus(requestedSessionId)
      if (res.success && get().currentSessionId === requestedSessionId) {
        set({ sessionStatus: res.data ?? null })
      }
    } catch (err) {
      console.warn('[agentSessionStore] fetchSessionStatus error:', err)
    }
  },

  setThinkingLevel: async (level) => {
    const sessionId = get().currentSessionId ?? ''
    try {
      const res = await getAgentApi().agentSetThinkingLevel(sessionId, level)
      if (res.success && res.data) {
        set((s) => ({
          sessionStatus:
            s.currentSessionId === (sessionId || null) && s.sessionStatus
              ? { ...s.sessionStatus, active: res.data as AgentActiveModel }
              : s.sessionStatus
        }))
        void get().fetchSnapshot()
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setThinkingLevel error:', err)
    }
    return false
  },

  compact: async (instructions) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return false
    try {
      const res = await getAgentApi().agentCompact(sessionId, instructions)
      if (res.success) {
        void get().fetchSessionStatus(sessionId)
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] compact error:', err)
    }
    return false
  },

  setAutoCompaction: async (enabled) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return false
    try {
      const res = await getAgentApi().agentSetAutoCompaction(sessionId, enabled)
      if (res.success) {
        if (res.data) set({ sessionStatus: res.data })
        else void get().fetchSessionStatus(sessionId)
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setAutoCompaction error:', err)
    }
    return false
  },

  loginProvider: async (providerId, type) => {
    try {
      const res = await getAgentApi().agentLoginProvider(providerId, type)
      if (res.success && res.data) {
        set((s) => ({ authOperations: { ...s.authOperations, [res.data!.id]: res.data! } }))
        return res.data
      }
      if (res.error) {
        const failed: AgentAuthOperation = {
          id: `error:${providerId}`,
          providerId,
          providerName: providerId,
          type,
          status: 'error',
          events: [],
          error: res.error
        }
        set((s) => ({ authOperations: { ...s.authOperations, [failed.id]: failed } }))
        return failed
      }
    } catch (err) {
      console.error('[agentSessionStore] loginProvider error:', err)
    }
    return null
  },

  respondProviderAuth: async (operationId, value) => {
    try {
      const res = await getAgentApi().agentRespondProviderAuth(operationId, value)
      if (res.success && res.data) {
        set((s) => ({ authOperations: { ...s.authOperations, [res.data!.id]: res.data! } }))
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] respondProviderAuth error:', err)
    }
    return false
  },

  cancelProviderAuth: async (operationId) => {
    try {
      const res = await getAgentApi().agentCancelProviderAuth(operationId)
      if (res.success && res.data) {
        set((s) => ({ authOperations: { ...s.authOperations, [res.data!.id]: res.data! } }))
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] cancelProviderAuth error:', err)
    }
    return false
  },

  logoutProvider: async (providerId) => {
    try {
      const res = await getAgentApi().agentLogoutProvider(providerId)
      if (res.success && res.data) {
        const snapshot = res.data
        set((s) => ({ snapshot: sanitizeSnapshotForSession(snapshot, s.currentSessionId) }))
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] logoutProvider error:', err)
    }
    return false
  },

  refreshProviderModels: async (providerId) => {
    try {
      const res = await getAgentApi().agentRefreshProviderModels(providerId)
      if (res.success && res.data) {
        const snapshot = res.data
        set((s) => ({ snapshot: sanitizeSnapshotForSession(snapshot, s.currentSessionId) }))
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] refreshProviderModels error:', err)
    }
    return false
  },

  setProviderBaseUrl: async (providerId, baseUrl) => {
    try {
      const res = await getAgentApi().agentSetProviderBaseUrl?.(providerId, baseUrl)
      if (res?.success && res.data) {
        const snapshot = res.data
        set((s) => ({ snapshot: sanitizeSnapshotForSession(snapshot, s.currentSessionId) }))
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setProviderBaseUrl error:', err)
    }
    return false
  },

  setProviderDisabled: async (providerId, disabled) => {
    try {
      const res = await getAgentApi().agentSetProviderDisabled?.(providerId, disabled)
      if (res?.success && res.data) {
        const snapshot = res.data
        set((s) => ({ snapshot: sanitizeSnapshotForSession(snapshot, s.currentSessionId) }))
        void get().fetchSessionStatus()
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setProviderDisabled error:', err)
    }
    return false
  },

  setModelFavorite: async (providerId, modelId, favored) => {
    try {
      const res = await getAgentApi().agentSetModelFavorite?.(providerId, modelId, favored)
      if (res?.success && res.data) {
        const snapshot = res.data
        set((s) => ({ snapshot: sanitizeSnapshotForSession(snapshot, s.currentSessionId) }))
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setModelFavorite error:', err)
    }
    return false
  },

  removeRecentModels: async (items) => {
    try {
      const res = await getAgentApi().agentRemoveRecentModels?.(items)
      if (res?.success && res.data) {
        const snapshot = res.data
        set((s) => ({ snapshot: sanitizeSnapshotForSession(snapshot, s.currentSessionId) }))
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] removeRecentModels error:', err)
    }
    return false
  },

  fetchProviderQuotas: async (force = false) => {
    set({ quotasLoading: true })
    try {
      const res = await getAgentApi().agentGetProviderQuotas?.({ force })
      if (res?.success && res.data) {
        set({ providerQuotas: res.data })
      }
    } catch (err) {
      console.error('[agentSessionStore] fetchProviderQuotas error:', err)
    } finally {
      set({ quotasLoading: false })
    }
  },

  refreshProviderQuota: async (providerId) => {
    try {
      const res = await getAgentApi().agentRefreshProviderQuota?.(providerId)
      if (res?.success && res.data) {
        set((s) => ({
          providerQuotas: { ...s.providerQuotas, [providerId]: res.data! }
        }))
      }
    } catch (err) {
      console.error('[agentSessionStore] refreshProviderQuota error:', err)
    }
  },

  openAgentSettings: () => {
    useAgentSettingsDialogStore.getState().open()
  },

  fetchConfig: async () => {
    try {
      const res = await getAgentApi().agentGetConfig()
      if (res.success && res.data) {
        set({ agentConfig: res.data })
      }
    } catch (err) {
      console.warn('[agentSessionStore] fetchConfig error:', err)
    }
  },

  setSkillDirs: async (dirs) => {
    try {
      const res = await getAgentApi().agentSetSkillDirs(dirs)
      if (res.success) {
        lastSkillsKey = undefined
        await get().fetchConfig()
        const ws = useWorkbenchStore.getState().workspacePath
        if (ws) void get().fetchSkills(ws, true)
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setSkillDirs error:', err)
    }
    return false
  },

  addAllowlist: async (tool, pattern) => {
    try {
      const res = await getAgentApi().agentAllowlistAdd(tool, pattern)
      if (res.success) {
        lastSkillsKey = undefined
        await get().fetchConfig()
        const ws = useWorkbenchStore.getState().workspacePath
        if (ws) void get().fetchSkills(ws, true)
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] addAllowlist error:', err)
    }
    return false
  },

  removeAllowlist: async (id) => {
    try {
      const res = await getAgentApi().agentAllowlistRemove(id)
      if (res.success) {
        lastSkillsKey = undefined
        await get().fetchConfig()
        const ws = useWorkbenchStore.getState().workspacePath
        if (ws) void get().fetchSkills(ws, true)
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] removeAllowlist error:', err)
    }
    return false
  },

  handleAgentEvent: (sessionId, event) => {
    const currentSessionId = get().currentSessionId

    switch (event.type) {
      case 'session_info_changed': {
        // pi 在 setSessionName 后广播；保持历史列表标题与会话名一致。
        const name = typeof event.name === 'string' ? event.name.trim() : ''
        if (!name) return
        const title = name.slice(0, 48)
        set((s) => ({
          sessions: s.sessions.map((item) =>
            item.id === sessionId ? { ...item, title, name } : item
          )
        }))
        return
      }
      case 'agent_start': {
        set((s) => {
          const next = new Set(s.runningSessionIds)
          next.add(sessionId)
          return {
            runningSessionIds: next,
            isRunning: sessionId === currentSessionId ? true : s.isRunning,
            // 历史菜单的 isRunning 标注随事件即时更新，不依赖下一次 fetchSessions。
            sessions: s.sessions.some((item) => item.id === sessionId)
              ? s.sessions.map((item) =>
                  item.id === sessionId ? { ...item, isRunning: true } : item
                )
              : s.sessions
          }
        })
        return
      }
      case 'agent_end': {
        if (event.willRetry) {
          void get().fetchSessions()
          return
        }
        set((s) => {
          const next = new Set(s.runningSessionIds)
          next.delete(sessionId)
          // 用户 query → 整轮 run 结束的耗时，记到最后一条 assistant 消息上
          let turnDurationMs: number | undefined
          if (sessionId === currentSessionId) {
            for (let i = s.messages.length - 1; i >= 0; i--) {
              const m = s.messages[i]
              if (m.role === 'user' && m.timestamp) {
                turnDurationMs = Date.now() - m.timestamp
                break
              }
            }
          }
          return {
            runningSessionIds: next,
            isRunning: sessionId === currentSessionId ? false : s.isRunning,
            // Belt-and-suspenders: pi should have emitted queue_update([]) when
            // draining, but clear any stale chips in case it didn't (abort /
            // clearQueue paths don't always emit one).
            queuedSteering: (() => {
              const q = { ...s.queuedSteering }
              delete q[sessionId]
              return q
            })(),
            queuedFollowUp: (() => {
              const q = { ...s.queuedFollowUp }
              delete q[sessionId]
              return q
            })(),
            sessions: s.sessions.map((item) =>
              item.id === sessionId ? { ...item, isRunning: false } : item
            ),
            // only touch the visible transcript when the event is for the
            // session currently on screen
            messages:
              sessionId === currentSessionId
                ? s.messages.map((m, idx) =>
                    idx === s.messages.length - 1 &&
                    m.role === 'assistant' &&
                    m.status !== 'aborted' &&
                    m.status !== 'error'
                      ? { ...m, status: 'complete', turnDurationMs }
                      : m
                  )
                : s.messages
          }
        })
        void get().fetchSessions()
        if (sessionId === currentSessionId) {
          void get().fetchSnapshot()
          void get().fetchFileChanges(sessionId)
        }
        return
      }
      case 'auto_retry_end': {
        if (event.success === false) {
          set((s) => {
            const next = new Set(s.runningSessionIds)
            next.delete(sessionId)
            return {
              runningSessionIds: next,
              isRunning: sessionId === currentSessionId ? false : s.isRunning,
              sessions: s.sessions.map((item) =>
                item.id === sessionId ? { ...item, isRunning: false } : item
              ),
              messages:
                sessionId === currentSessionId
                  ? s.messages.map((m, idx) =>
                      idx === s.messages.length - 1 &&
                      m.role === 'assistant' &&
                      m.status === 'running'
                        ? {
                            ...m,
                            status: event.finalError ? 'error' : 'complete',
                            ...(event.finalError ? { error: event.finalError } : {})
                          }
                        : m
                    )
                  : s.messages
            }
          })
        }
        return
      }
      case 'queue_update': {
        // Pending steering/followUp arrays — surfaced in the composer so the
        // user can see what's waiting to be delivered.
        set((s) => ({
          queuedSteering: { ...s.queuedSteering, [sessionId]: [...(event.steering ?? [])] },
          queuedFollowUp: { ...s.queuedFollowUp, [sessionId]: [...(event.followUp ?? [])] }
        }))
        return
      }
    }

    // Events below only render into the visible transcript; drop them for
    // sessions that aren't currently on screen.
    if (sessionId !== currentSessionId) {
      return
    }

    switch (event.type) {
      case 'queue_cleared': {
        // Abort-time: undelivered queued messages come back so the user can
        // edit or resend. Put them into the composer (append, don't clobber).
        const texts = event.texts ?? []
        set((s) => {
          const steering = { ...s.queuedSteering }
          const followUp = { ...s.queuedFollowUp }
          delete steering[sessionId]
          delete followUp[sessionId]
          return {
            queuedSteering: steering,
            queuedFollowUp: followUp,
            ...(texts.length > 0
              ? {
                  composerInput: s.composerInput
                    ? `${s.composerInput}\n\n${texts.join('\n\n')}`
                    : texts.join('\n\n')
                }
              : {})
          }
        })
        return
      }
      case 'turn_start': {
        set((s) => {
          const last = s.messages[s.messages.length - 1]
          if (!last || last.role !== 'assistant') {
            return {
              messages: [
                ...s.messages,
                {
                  id: `msg_a_${Date.now()}`,
                  role: 'assistant',
                  content: [],
                  status: 'running',
                  createdAt: Date.now()
                }
              ]
            }
          }
          return s
        })
        break
      }
      case 'message_start': {
        // A queued follow-up user message gets its own message_start when pi
        // actually delivers it into a turn. Flip our local "queued" user row
        // (status 'running') to complete. Match by position (earliest running
        // user), not text — pi may rewrite the prompt text (skill/template
        // expansion, image hints) so exact content comparison is unreliable,
        // and duplicate texts would otherwise flip the wrong row.
        if (event.message?.role === 'user') {
          set((s) => {
            const idx = s.messages.findIndex((m) => m.role === 'user' && m.status === 'running')
            if (idx === -1) return s
            const next = [...s.messages]
            next[idx] = { ...next[idx], status: 'complete' }
            return { messages: next }
          })
        }
        if (event.message?.role === 'assistant') {
          const newId = event.message.id || `msg_a_${Date.now()}`
          const msgTimestamp = event.message.timestamp ?? Date.now()
          set((s) => {
            const last = s.messages[s.messages.length - 1]
            if (last && last.role === 'assistant' && last.content.length === 0) {
              return {
                messages: s.messages.map((m, idx) =>
                  idx === s.messages.length - 1
                    ? { ...m, id: newId, status: 'running', timestamp: m.timestamp ?? msgTimestamp }
                    : m
                )
              }
            }
            return {
              messages: [
                ...s.messages,
                {
                  id: newId,
                  role: 'assistant',
                  content: [],
                  status: 'running',
                  createdAt: Date.now(),
                  timestamp: msgTimestamp
                }
              ]
            }
          })
        }
        break
      }
      case 'message_update': {
        if (event.message && event.message.content) {
          const parts = convertPiContentParts(event.message.content)
          const msgTimestamp = event.message.timestamp
          set((s) => {
            const msgs = [...s.messages]
            const lastIdx = msgs.length - 1
            if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
              const mergedParts = mergeMessageParts(parts, msgs[lastIdx].content)
              msgs[lastIdx] = {
                ...msgs[lastIdx],
                content: mergedParts,
                timestamp: msgs[lastIdx].timestamp ?? msgTimestamp
              }
              return { messages: msgs }
            }
            return s
          })
        }
        break
      }
      case 'tool_execution_start': {
        const { toolCallId, toolName, args } = event
        if (!toolCallId) break
        set((s) => {
          const msgs = [...s.messages]
          let last = msgs[msgs.length - 1]
          if (!last || last.role !== 'assistant') {
            last = {
              id: `msg_a_${Date.now()}`,
              role: 'assistant',
              content: [],
              status: 'running',
              createdAt: Date.now()
            }
            msgs.push(last)
          }
          const content = [...last.content]
          const existingIdx = content.findIndex(
            (p) => p.type === 'tool-call' && p.toolCallId === toolCallId
          )
          const toolPart: PiContentPart = {
            type: 'tool-call',
            toolCallId,
            toolName: toolName || '',
            args: args || {}
          }
          if (existingIdx >= 0) {
            content[existingIdx] = { ...content[existingIdx], ...toolPart }
          } else {
            content.push(toolPart)
          }
          // 收到 tool_execution_start 说明该消息的工具正在执行——无论此前
          // message_end 的形态如何，状态必须回到 running，防止"长任务（如
          // image_gen）运行中 UI 已显示完成"的假成功。
          msgs[msgs.length - 1] = { ...last, content, status: 'running' }
          return { messages: msgs }
        })
        break
      }
      case 'tool_execution_update': {
        const { toolCallId, partialResult } = event
        if (!toolCallId) break
        set((s) => {
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (!last || last.role !== 'assistant') return s
          const content = last.content.map((p) => {
            if (p.type === 'tool-call' && p.toolCallId === toolCallId) {
              return { ...p, result: partialResult }
            }
            return p
          })
          msgs[msgs.length - 1] = { ...last, content }
          return { messages: msgs }
        })
        break
      }
      case 'tool_execution_end': {
        const { toolCallId, result, isError, durationMs } = event
        if (!toolCallId) break
        set((s) => {
          const msgs = [...s.messages]
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i]
            if (m.role === 'assistant') {
              let found = false
              const content = m.content.map((p) => {
                if (p.type === 'tool-call' && p.toolCallId === toolCallId) {
                  found = true
                  return {
                    ...p,
                    result,
                    isError: Boolean(isError),
                    durationMs
                  }
                }
                return p
              })
              if (found) {
                // 该消息内所有 tool-call 都拿到 result 后，才把消息标 complete。
                // message_end 在工具执行开始前就会到达，不能作为完成信号。
                const allToolsDone = !hasUnresolvedToolCalls(content)
                msgs[i] = {
                  ...m,
                  content,
                  status: allToolsDone ? 'complete' : m.status
                }
                return { messages: msgs }
              }
            }
          }
          return s
        })
        break
      }
      case 'message_end': {
        set((s) => {
          const msgs = [...s.messages]
          const lastIdx = msgs.length - 1
           // 仅当事件本身是 assistant 消息且落在末尾 assistant 上才处理。
           // message_end 对 user/toolResult 也会触发：user 的 query 会污染上一条
           // assistant 首行，toolResult 的正文会覆盖 assistant 的 tool-call parts。
           if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant' && event.message?.role === 'assistant') {
            const msgTimestamp = event.message?.timestamp
            // pi 的 message_end 在 tool_execution_start 之前到达，其 message.content
            // 已含完整 toolCall blocks，但 message_update 的最后一次推送可能还没
            // 把它们 merge 进来。先补齐 tool-call parts，否则 content 里没有
            // tool-call 时 allToolsDone 会 vacuous true，消息被误标 complete。
            if (event.message?.content) {
              const incoming = convertPiContentParts(event.message.content)
              const merged = mergeMessageParts(incoming, msgs[lastIdx].content)
              msgs[lastIdx] = { ...msgs[lastIdx], content: merged }
            }
            // pi 在 tool_execution_start 之前就发 message_end——若消息里还有
            // 未完成 tool-call，保持 running，等 tool_execution_end 补齐。
            const allToolsDone = !hasUnresolvedToolCalls(msgs[lastIdx].content)
            msgs[lastIdx] = {
              ...msgs[lastIdx],
              timestamp: msgs[lastIdx].timestamp ?? msgTimestamp,
              ...(allToolsDone ? { status: 'complete' as const } : {})
            }
            return { messages: msgs }
          }
          return s
        })
        break
      }
      case 'turn_end': {
        // 一个 turn 包含 assistant 消息 + 其所有 toolResult；turn_end 到达
        // 时该 turn 的工具调用必然都已结束（个别丢失的 end 事件也在此兜底）。
        // 但兜底不能越过"还在等结果"的 tool-call：若 turn_end 因任何时序异常
        // 提前到达，未完成 tool-call 的消息必须保持 running，否则长任务
        // （image_gen/web_search）在运行中被误判完成。
        set((s) => {
          const msgs = [...s.messages]
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i]
            if (m.role !== 'assistant') break
            if (m.status === 'running' && !hasUnresolvedToolCalls(m.content)) {
              msgs[i] = { ...m, status: 'complete' }
            }
          }
          return { messages: msgs }
        })
        break
      }
      case 'compaction_end':
        set({ isCompacting: false })
        void get().fetchSnapshot()
        break
      case 'compaction_start':
        set({ isCompacting: true })
        break
      case 'thinking_level_changed':
      case 'agent_settled': {
        set((s) => {
          const steering = { ...s.queuedSteering }
          const followUp = { ...s.queuedFollowUp }
          delete steering[sessionId]
          delete followUp[sessionId]
          return { queuedSteering: steering, queuedFollowUp: followUp }
        })
        void get().fetchSnapshot()
        break
      }
      default:
        break
    }
  },

  handleApprovalRequest: (request) => {
    set((s) => {
      if (s.pendingApprovals.some((r) => r.requestId === request.requestId)) {
        return s
      }
      return { pendingApprovals: [...s.pendingApprovals, request] }
    })
  }
}))
