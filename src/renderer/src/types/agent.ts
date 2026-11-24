export type AgentPermissionMode = 'full' | 'restricted' | 'readonly'

export interface PiContentPart {
  type: 'text' | 'reasoning' | 'tool-call'
  text?: string
  reasoning?: string
  toolCallId?: string
  toolName?: string
  args?: Record<string, unknown> | string
  result?: unknown
  isError?: boolean
  durationMs?: number
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: PiContentPart[]
  status: 'running' | 'complete' | 'aborted' | 'error'
  error?: string
  createdAt?: number
}

export interface AgentSessionSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  cwd?: string
  model?: string
}

export interface AgentApprovalRequest {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  args: unknown
  reason: string
}

export interface AgentProviderInfo {
  providerId: string
  displayName: string
  configured: boolean
  authStatus?: { ok: boolean; error?: string }
  models: string[]
}

export interface AgentIpcApi {
  agentPrompt: (
    sessionId: string,
    prompt: string,
    attachments?: string[]
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>
  agentAbort: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  agentNewSession: (
    cwd?: string
  ) => Promise<{ success: boolean; data?: { sessionId: string }; error?: string }>
  agentListSessions: () => Promise<{
    success: boolean
    data?: AgentSessionSummary[]
    error?: string
  }>
  agentResumeSession: (
    sessionId: string
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>
  agentResolveApproval: (
    requestId: string,
    decision: 'allow' | 'always' | 'deny',
    pattern?: string
  ) => Promise<{ success: boolean; error?: string }>
  agentSetPermissionMode: (
    sessionId: string,
    mode: AgentPermissionMode
  ) => Promise<{ success: boolean; error?: string }>
  agentSetModel: (
    sessionId: string,
    model: string,
    provider?: string
  ) => Promise<{ success: boolean; error?: string }>
  agentListProviders: () => Promise<{
    success: boolean
    data?: AgentProviderInfo[]
    error?: string
  }>
  agentSetCredential: (
    providerId: string,
    cred: { type: 'api_key'; key: string; env?: string; baseUrl?: string }
  ) => Promise<{ success: boolean; error?: string }>
  agentDeleteCredential: (providerId: string) => Promise<{ success: boolean; error?: string }>
  agentGetActiveModel: () => Promise<{
    success: boolean
    data?: { providerId: string; modelId: string; baseUrl?: string }
    error?: string
  }>
  onAgentEvent?: (cb: (payload: { sessionId: string; event: unknown }) => void) => () => void
  onAgentApprovalRequest?: (cb: (payload: AgentApprovalRequest) => void) => () => void
}
