import { create } from 'zustand'
import { useWorkbenchStore } from './workbenchStore'
import { useAgentSettingsDialogStore } from './agentSettingsDialogStore'
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
    }
  }
  return parts
}

interface AgentSessionState {
  currentSessionId: string | null
  currentCwd: string | null
  sessions: AgentSessionSummary[]
  messages: AgentMessage[]
  isRunning: boolean
  runningSessionIds: Set<string>
  permissionMode: AgentPermissionMode
  pendingApprovals: AgentApprovalRequest[]
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
  setComposerInput: (val: string) => void
  appendPromptText: (text: string) => void
  addAttachment: (path: string) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
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
  openAgentSettings: () => void
  fetchConfig: () => Promise<void>
  setSkillDirs: (dirs: string[]) => Promise<boolean>
  addAllowlist: (tool: string, pattern: string) => Promise<boolean>
  removeAllowlist: (id: string) => Promise<boolean>

  handleAgentEvent: (sessionId: string, event: PiEventPayload) => void
  handleApprovalRequest: (request: AgentApprovalRequest) => void
}

export const useAgentSessionStore = create<AgentSessionState>((set, get) => ({
  currentSessionId: null,
  currentCwd: null,
  sessions: [],
  messages: [],
  isRunning: false,
  runningSessionIds: new Set<string>(),
  permissionMode: 'default',
  pendingApprovals: [],
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
    if (sessionId) {
      try {
        await getAgentApi().agentSetPermissionMode(sessionId, mode)
      } catch (err) {
        console.warn('[agentSessionStore] Failed to sync permission mode:', err)
      }
    }
  },

  setComposerInput: (val) => set({ composerInput: val }),

  appendPromptText: (text) =>
    set((s) => ({
      composerInput: s.composerInput ? `${s.composerInput} ${text}` : text
    })),

  addAttachment: (path) =>
    set((s) => {
      if (s.attachments.includes(path)) return s
      return { attachments: [...s.attachments, path] }
    }),

  removeAttachment: (index) =>
    set((s) => ({
      attachments: s.attachments.filter((_, i) => i !== index)
    })),

  clearAttachments: () => set({ attachments: [] }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  initListeners: () => {
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
        set({ sessions: res.data })
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
    if (!trimmed) return
    let sessionId = get().currentSessionId
    const activeWorkspace = useWorkbenchStore.getState().workspacePath
    const currentCwd = get().currentCwd

    // If workspace changed or no session exists, initiate session for active workspace
    if (!sessionId || (activeWorkspace && currentCwd && currentCwd !== activeWorkspace)) {
      sessionId = await get().createSession(activeWorkspace || undefined)
      if (!sessionId) return
    }

    const attachList = attachments || get().attachments
    let fullPrompt = trimmed
    if (attachList.length > 0) {
      const paths = attachList.map((p) => `@${p}`).join(' ')
      if (!fullPrompt.includes(paths)) {
        fullPrompt = `${fullPrompt} ${paths}`
      }
    }

    const userMsg: AgentMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: fullPrompt }],
      status: 'complete',
      createdAt: Date.now(),
      timestamp: Date.now()
    }

    const assistantMsg: AgentMessage = {
      id: `msg_a_${Date.now()}`,
      role: 'assistant',
      content: [],
      status: 'running',
      createdAt: Date.now()
    }

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      runningSessionIds: new Set(s.runningSessionIds).add(sessionId),
      composerInput: '',
      attachments: []
    }))

    try {
      const res = await getAgentApi().agentPrompt(sessionId, fullPrompt, attachList)
      if (!res.success) {
        set((s) => ({
          runningSessionIds: (() => {
            const next = new Set(s.runningSessionIds)
            next.delete(sessionId)
            return next
          })(),
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  status: 'error',
                  error: res.error || '执行出错',
                  content: [{ type: 'text', text: `错误: ${res.error || '执行失败'}` }]
                }
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
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                status: 'error',
                error: errorMsg,
                content: [{ type: 'text', text: `异常: ${errorMsg}` }]
              }
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
            isRunning: sessionId === currentSessionId ? true : s.isRunning
          }
        })
        return
      }
      case 'agent_end': {
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
            // only touch the visible transcript when the event is for the
            // session currently on screen
            messages:
              sessionId === currentSessionId
                ? s.messages.map((m, idx) =>
                    idx === s.messages.length - 1 &&
                    m.role === 'assistant' &&
                    m.status === 'running'
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
    }

    // Events below only render into the visible transcript; drop them for
    // sessions that aren't currently on screen.
    if (sessionId !== currentSessionId) {
      return
    }

    switch (event.type) {
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
        if (event.message?.role === 'assistant') {
          const newId = event.message.id || `msg_a_${Date.now()}`
          const msgTimestamp = event.message.timestamp ?? Date.now()
          set((s) => {
            const last = s.messages[s.messages.length - 1]
            if (last && last.role === 'assistant' && last.content.length === 0) {
              return {
                messages: s.messages.map((m, idx) =>
                  idx === s.messages.length - 1
                    ? { ...m, id: newId, timestamp: m.timestamp ?? msgTimestamp }
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
