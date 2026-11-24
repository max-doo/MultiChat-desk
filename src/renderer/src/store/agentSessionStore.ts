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
}

function getAgentApi(): AgentIpcApi {
  return window.api as unknown as AgentIpcApi
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
  /**
   * 失效工作区回看态：resume 一条 cwd 已失效（目录删除/改名/脱机）的会话后置位。
   * 置位期间 AgentCard 的工作区同步 effect 不得因 cwd !== workspacePath 清空消息；
   * 两个 AI 侧栏实例共享此标志，避免一侧回看被另一侧的同步逻辑清空。
   */
  foreignReview: boolean

  // Actions
  setSessionId: (id: string | null) => void
  setForeignReview: (value: boolean) => void
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
  prompt: (text: string, attachments?: string[]) => Promise<void>
  abort: () => Promise<void>
  rewindLastUserMessage: () => Promise<boolean>
  forkSession: () => Promise<boolean>
  copyText: (text: string) => Promise<boolean>
  resolveApproval: (
    requestId: string,
    decision: 'allow' | 'always' | 'deny',
    pattern?: string
  ) => Promise<void>
  fetchProviders: () => Promise<void>
  fetchSkills: (cwd?: string) => Promise<void>
  setCredential: (
    providerId: string,
    cred: { type: 'api_key'; key: string; env?: string; baseUrl?: string }
  ) => Promise<boolean>
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
  foreignReview: false,

  setSessionId: (id) =>
    set((s) => ({
      currentSessionId: id,
      isRunning: id ? s.runningSessionIds.has(id) : false
    })),
  setForeignReview: (value) => set({ foreignReview: value }),

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
    // 已注册过监听（例如另一个 AgentCard 实例仍挂着）：仅补拉数据，不重复订阅，
    // 否则每条事件会被 handleAgentEvent 处理多次。
    if (get().listenersReady) {
      void get().fetchProviders()
      void get().fetchSessions()
      void get().fetchSkills()
      void get().fetchSnapshot()
      void get().fetchPermissionMode()
      return () => undefined
    }
    set({ listenersReady: true })
    const api = getAgentApi()
    let cleanupEvent: (() => void) | undefined
    let cleanupApproval: (() => void) | undefined
    let cleanupAuth: (() => void) | undefined
    let cleanupRuntime: (() => void) | undefined
    let cleanupStatus: (() => void) | undefined

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
        if (current && sessionId !== current) return
        set({ sessionStatus: status })
      })
    }

    // Load active model / providers / sessions initially
    void get().fetchProviders()
    void get().fetchSessions()
    void get().fetchSkills()
    void get().fetchSnapshot()
    void get().fetchPermissionMode()
    void api.agentListAuthOperations?.().then((res) => {
      if (res.success && res.data) {
        const map: Record<string, AgentAuthOperation> = {}
        for (const operation of res.data) map[operation.id] = operation
        set({ authOperations: map })
      }
    }).catch(() => undefined)

    return () => {
      cleanupEvent?.()
      cleanupApproval?.()
      cleanupAuth?.()
      cleanupRuntime?.()
      cleanupStatus?.()
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
    set({
      currentSessionId: null,
      currentCwd: targetCwd,
      messages: [],
      isRunning: false,
      pendingApprovals: [],
      composerInput: '',
      attachments: [],
      branchUserEntries: [],
      foreignReview: false
    })
    return null
  },

  createSession: async (cwd) => {
    try {
      const activeWorkspace = useWorkbenchStore.getState().workspacePath
      const targetCwd = cwd || activeWorkspace || undefined
      const res = await getAgentApi().agentNewSession(targetCwd)
      if (res.success && res.data?.sessionId) {
        const sessionId = res.data.sessionId
        set({
          currentSessionId: sessionId,
          currentCwd: targetCwd || null,
          messages: [],
          isRunning: false,
          pendingApprovals: [],
          composerInput: '',
          attachments: [],
          branchUserEntries: [],
          foreignReview: false
        })
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
        } | null
        const restoredMessages: AgentMessage[] = []

        if (rawData?.messages && Array.isArray(rawData.messages)) {
          // 1. 建立 toolCallId -> result 映射表
          const toolResultsMap = new Map<string, unknown>()
          for (const m of rawData.messages) {
            const mRole = String(m.role || '').toLowerCase()
            if (mRole === 'toolresult' || mRole === 'tool') {
              const tcId = (m as { toolCallId?: string }).toolCallId
              if (tcId) {
                toolResultsMap.set(tcId, m.content)
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
              status: 'complete',
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

        set({
          currentSessionId: sessionId,
          currentCwd: rawData?.cwd || null,
          messages: restoredMessages,
          pendingApprovals: [],
          activeModel: rawData?.model || get().activeModel,
          activeProvider: rawData?.provider || get().activeProvider,
          permissionMode: rawData?.permissionMode === 'auto' || rawData?.permissionMode === 'bypass'
            ? rawData.permissionMode
            : 'default',
          isRunning: get().runningSessionIds.has(sessionId)
        })
        // isRunning is derived from runningSessionIds — populated by live events.
        void get().fetchSnapshot(sessionId)
        void get().fetchSessionStatus(sessionId)
        void get().refreshBranchEntries()
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
      set({ sessions: get().sessions.filter((s) => s.id !== sessionId) })

      if (wasCurrent) {
        // Back to a draft state; a fresh session is created lazily on next prompt.
        set({ currentSessionId: null, messages: [], isRunning: false, pendingApprovals: [] })
      }
      return true
    } catch (err) {
      console.error('[agentSessionStore] deleteSession error:', err)
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
   * shown. File edits already applied by the agent are intentionally left
   * alone — Pi does not snapshot the workspace, and silently reverting code
   * would be destructive.
   */
  rewindLastUserMessage: async () => {
    const sessionId = get().currentSessionId
    if (!sessionId || get().runningSessionIds.has(sessionId)) return false
    try {
      const res = await getAgentApi().agentRewind(sessionId)
      if (!res.success || !res.data) {
        console.warn('[agentSessionStore] rewind failed:', res.error)
        return false
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
        return {
          messages: cut >= 0 ? msgs.slice(0, cut) : msgs,
          composerInput: editorText,
          pendingApprovals: []
        }
      })
      void get().refreshBranchEntries()
      void get().fetchSessionStatus(sessionId)
      return true
    } catch (err) {
      console.warn('[agentSessionStore] rewind error:', err)
      return false
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

  fetchSkills: async (cwd) => {
    try {
      const res = await getAgentApi().agentListSkills(cwd)
      if (res.success && res.data) {
        set({ skills: res.data })
      }
    } catch (err) {
      console.warn('[agentSessionStore] fetchSkills error:', err)
    }
  },

  setCredential: async (providerId, cred) => {
    try {
      const res = await getAgentApi().agentSetCredential(providerId, cred)
      if (res.success) {
        await get().fetchProviders()
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setCredential error:', err)
    }
    return false
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
    try {
      const res = await getAgentApi().agentGetRuntimeSnapshot(sessionId ?? get().currentSessionId ?? undefined)
      if (res.success && res.data) {
        set({
          snapshot: res.data,
          activeModel: res.data.active.modelId,
          activeProvider: res.data.active.providerId,
          snapshotLoading: false
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
    try {
      const res = await getAgentApi().agentGetSessionStatus(sessionId ?? get().currentSessionId ?? undefined)
      if (res.success) {
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
          sessionStatus: s.sessionStatus ? { ...s.sessionStatus, active: res.data as AgentActiveModel } : s.sessionStatus
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
        void get().fetchSessionStatus(sessionId)
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
        set({ snapshot: res.data })
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
        set({ snapshot: res.data })
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
        set({ snapshot: res.data })
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setProviderBaseUrl error:', err)
    }
    return false
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
        await get().fetchConfig()
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
        await get().fetchConfig()
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
        await get().fetchConfig()
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
          void get().fetchSessionStatus()
          void get().fetchSnapshot()
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
              // Retain any tool execution details already merged in
              const existingTools = new Map<string, PiContentPart>()
              for (const p of msgs[lastIdx].content) {
                if (p.type === 'tool-call' && p.toolCallId) {
                  existingTools.set(p.toolCallId, p)
                }
              }
              const mergedParts = parts.map((p) => {
                if (p.type === 'tool-call' && p.toolCallId && existingTools.has(p.toolCallId)) {
                  const prev = existingTools.get(p.toolCallId)!
                  return {
                    ...p,
                    result: prev.result ?? p.result,
                    isError: prev.isError ?? p.isError,
                    durationMs: prev.durationMs ?? p.durationMs
                  }
                }
                return p
              })
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
          msgs[msgs.length - 1] = { ...last, content }
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
                const allToolsDone = content.every(
                  (p) => p.type !== 'tool-call' || p.result !== undefined || p.isError
                )
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
              const prevToolMap = new Map<string, PiContentPart>()
              for (const p of msgs[lastIdx].content) {
                if (p.type === 'tool-call' && p.toolCallId) {
                  prevToolMap.set(p.toolCallId, p)
                }
              }
              const merged = incoming.map((p) => {
                if (p.type === 'tool-call' && p.toolCallId && prevToolMap.has(p.toolCallId)) {
                  const prev = prevToolMap.get(p.toolCallId)!
                  return {
                    ...p,
                    result: prev.result ?? p.result,
                    isError: prev.isError ?? p.isError,
                    durationMs: prev.durationMs ?? p.durationMs
                  }
                }
                return p
              })
              msgs[lastIdx] = { ...msgs[lastIdx], content: merged }
            }
            // pi 在 tool_execution_start 之前就发 message_end——若消息里还有
            // 未完成 tool-call，保持 running，等 tool_execution_end 补齐。
            const allToolsDone = msgs[lastIdx].content.every(
              (p) => p.type !== 'tool-call' || p.result !== undefined || p.isError
            )
            msgs[lastIdx] = {
              ...msgs[lastIdx],
              timestamp: msgs[lastIdx].timestamp ?? msgTimestamp,
              ...(allToolsDone ? { status: 'complete' as const } : {})
            }
            return { messages: msgs }
          }
          return s
        })
        void get().fetchSessionStatus()
        void get().refreshBranchEntries()
        break
      }
      case 'turn_end': {
        // 一个 turn 包含 assistant 消息 + 其所有 toolResult；turn_end 到达
        // 时该 turn 的工具调用必然都已结束（个别丢失的 end 事件也在此兜底）。
        set((s) => {
          const msgs = [...s.messages]
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i]
            if (m.role !== 'assistant') break
            if (m.status === 'running') {
              msgs[i] = { ...m, status: 'complete' }
            }
          }
          return { messages: msgs }
        })
        break
      }
      case 'compaction_end':
        set({ isCompacting: false })
        void get().fetchSessionStatus()
        void get().fetchSnapshot()
        break
      case 'compaction_start':
        set({ isCompacting: true })
        void get().fetchSessionStatus()
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
        void get().fetchSessionStatus()
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
