import { create } from 'zustand'
import { useWorkbenchStore } from './workbenchStore'
import type {
  AgentMessage,
  AgentSessionSummary,
  AgentApprovalRequest,
  AgentProviderInfo,
  AgentPermissionMode,
  AgentSkill,
  AgentConfig,
  AgentIpcApi,
  PiContentPart
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
  permissionMode: AgentPermissionMode
  pendingApprovals: AgentApprovalRequest[]
  activeModel: string
  activeProvider: string
  providers: AgentProviderInfo[]
  skills: AgentSkill[]
  agentConfig: AgentConfig | null
  composerInput: string
  attachments: string[]
  settingsOpen: boolean

  // Actions
  setSessionId: (id: string | null) => void
  setPermissionMode: (mode: AgentPermissionMode) => Promise<void>
  setComposerInput: (val: string) => void
  appendPromptText: (text: string) => void
  addAttachment: (path: string) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  setSettingsOpen: (open: boolean) => void

  initListeners: () => () => void
  fetchSessions: () => Promise<void>
  newSession: (cwd?: string) => Promise<string | null>
  resumeSession: (sessionId: string) => Promise<boolean>
  prompt: (text: string, attachments?: string[]) => Promise<void>
  abort: () => Promise<void>
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
  permissionMode: 'default',
  pendingApprovals: [],
  activeModel: 'devin/swe-2',
  activeProvider: 'magpie',
  providers: [],
  skills: [],
  agentConfig: null,
  composerInput: '',
  attachments: [],
  settingsOpen: false,

  setSessionId: (id) => set({ currentSessionId: id }),

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

    // Load active model / providers / sessions initially
    void get().fetchProviders()
    void get().fetchSessions()
    void get().fetchSkills()

    return () => {
      cleanupEvent?.()
      cleanupApproval?.()
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

  newSession: async (cwd) => {
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
          attachments: []
        })
        void get().fetchSessions()
        return sessionId
      }
    } catch (err) {
      console.error('[agentSessionStore] newSession error:', err)
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
          for (let i = 0; i < rawData.messages.length; i++) {
            const m = rawData.messages[i]
            const role = (m.role || 'assistant') as AgentMessage['role']
            restoredMessages.push({
              id: m.id || `msg_restored_${i}`,
              role,
              content: convertPiContentParts(m.content),
              status: 'complete',
              createdAt: Date.now()
            })
          }
        }

        set({
          currentSessionId: sessionId,
          currentCwd: rawData?.cwd || null,
          messages: restoredMessages,
          isRunning: false,
          pendingApprovals: [],
          activeModel: rawData?.model || get().activeModel,
          activeProvider: rawData?.provider || get().activeProvider
        })
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] resumeSession error:', err)
    }
    return false
  },

  prompt: async (text: string, attachments?: string[]) => {
    const trimmed = text.trim()
    if (!trimmed) return
    let sessionId = get().currentSessionId
    const activeWorkspace = useWorkbenchStore.getState().workspacePath
    const currentCwd = get().currentCwd

    // If workspace changed or no session exists, initiate session for active workspace
    if (!sessionId || (activeWorkspace && currentCwd && currentCwd !== activeWorkspace)) {
      sessionId = await get().newSession(activeWorkspace || undefined)
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
      createdAt: Date.now()
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
      isRunning: true,
      composerInput: '',
      attachments: []
    }))

    try {
      const res = await getAgentApi().agentPrompt(sessionId, fullPrompt, attachList)
      if (!res.success) {
        set((s) => ({
          isRunning: false,
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
        isRunning: false,
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
        isRunning: false,
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
        return true
      }
    } catch (err) {
      console.error('[agentSessionStore] setModel error:', err)
    }
    return false
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
    if (currentSessionId && sessionId && sessionId !== currentSessionId) {
      return
    }

    switch (event.type) {
      case 'agent_start': {
        set({ isRunning: true })
        break
      }
      case 'agent_end': {
        set((s) => ({
          isRunning: false,
          messages: s.messages.map((m, idx) =>
            idx === s.messages.length - 1 && m.role === 'assistant'
              ? { ...m, status: 'complete' }
              : m
          )
        }))
        void get().fetchSessions()
        break
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
        if (event.message?.role === 'assistant') {
          const newId = event.message.id || `msg_a_${Date.now()}`
          set((s) => {
            const last = s.messages[s.messages.length - 1]
            if (last && last.role === 'assistant' && last.content.length === 0) {
              return {
                messages: s.messages.map((m, idx) =>
                  idx === s.messages.length - 1 ? { ...m, id: newId } : m
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
                  createdAt: Date.now()
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
                content: mergedParts
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
          const last = msgs[msgs.length - 1]
          if (!last || last.role !== 'assistant') return s
          const content = last.content.map((p) => {
            if (p.type === 'tool-call' && p.toolCallId === toolCallId) {
              return {
                ...p,
                result,
                isError: Boolean(isError),
                durationMs
              }
            }
            return p
          })
          msgs[msgs.length - 1] = { ...last, content }
          return { messages: msgs }
        })
        break
      }
      case 'message_end': {
        set((s) => {
          const msgs = [...s.messages]
          const lastIdx = msgs.length - 1
          if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
            msgs[lastIdx] = { ...msgs[lastIdx], status: 'complete' }
            return { messages: msgs }
          }
          return s
        })
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
