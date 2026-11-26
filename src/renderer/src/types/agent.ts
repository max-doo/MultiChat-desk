import type {
  AgentActiveModel,
  AgentAuthOperation,
  AgentAuthType,
  AgentContextUsage,
  AgentCustomGatewaySpec,
  AgentFavoriteModel,
  AgentForkOrigin,
  AgentGatewayApiType,
  AgentGatewayTestResult,
  AgentProvider,
  AgentProviderModel,
  AgentProviderQuota,
  AgentQuotaWindow,
  AgentRuntimeSnapshot,
  AgentSessionStats,
  AgentSessionStatus,
  AgentThinkingLevel
} from '../../../shared/types/agentRuntime'
import type { CompressionConfig } from '../../../shared/types/agentCompression'

export type {
  AgentActiveModel,
  AgentAuthOperation,
  AgentAuthType,
  AgentContextUsage,
  AgentCustomGatewaySpec,
  AgentFavoriteModel,
  AgentForkOrigin,
  AgentGatewayApiType,
  AgentGatewayTestResult,
  AgentProvider,
  AgentProviderModel,
  AgentProviderQuota,
  AgentQuotaWindow,
  AgentRuntimeSnapshot,
  AgentSessionStats,
  AgentSessionStatus,
  AgentThinkingLevel
}

export type AgentPermissionMode = 'default' | 'auto' | 'bypass'

export const THINKING_LABELS: Record<AgentThinkingLevel, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大'
}

export interface PiContentPart {
  type: 'text' | 'reasoning' | 'tool-call' | 'image'
  text?: string
  reasoning?: string
  /** image part：dataUrl/base64 用于气泡内渲染，filePath 仅本地预览兜底。 */
  data?: string
  mimeType?: string
  filePath?: string
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
  /** Unix ms；assistant 消息为 pi 的 timestamp（请求开始），其余为本地 Date.now()。 */
  timestamp?: number
  /** 本轮请求耗时（毫秒），来自 pi AssistantMessage.durationMs。 */
  durationMs?: number
  /** 用户 query → 整轮 agent run 结束的总耗时（毫秒），挂在该轮最后一条 assistant 消息上。 */
  turnDurationMs?: number
}

export interface AgentSessionSummary {
  id: string
  title: string
  /** 用户自定义的会话名称（pi session_info）；存在时 title 与其一致 */
  name?: string
  createdAt: number
  updatedAt: number
  cwd?: string
  model?: string
  isRunning?: boolean
  parentSessionId?: string
  parentSessionTitle?: string
  firstBranchMessage?: string
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

export interface AgentSkill {
  name: string
  description: string
  filePath: string
  disableModelInvocation: boolean
}

export interface AgentSkillDirCandidate {
  path: string
  exists: boolean
  isDefault: boolean
}

export interface AgentAllowlistEntry {
  id: string
  tool: string
  pattern: string
  createdAt: number
}

export interface AgentConfig {
  agentDir: string
  skillDirCandidates: AgentSkillDirCandidate[]
  extraSkillDirs: string[]
  allowlist: AgentAllowlistEntry[]
  activeModel: { providerId: string; modelId: string; baseUrl?: string }
}

export interface AgentIpcApi {
  agentPrompt: (
    sessionId: string,
    prompt: string,
    attachments?: string[],
    streamingBehavior?: 'steer' | 'followUp',
    images?: Array<{ data: string; mimeType: string }>
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
  agentDeleteSession: (
    sessionId: string
  ) => Promise<{ success: boolean; error?: string }>
  agentRenameSession: (
    sessionId: string,
    name: string
  ) => Promise<{ success: boolean; error?: string }>
  agentRewind: (
    sessionId: string,
    entryId?: string,
    revertFiles?: boolean
  ) => Promise<{ success: boolean; data?: { editorText: string }; error?: string }>
  agentForkSession: (
    sessionId: string,
    leafId?: string
  ) => Promise<{ success: boolean; data?: { sessionId: string; forkOrigin?: AgentForkOrigin }; error?: string }>
  agentListBranchUserEntries: (
    sessionId: string
  ) => Promise<{ success: boolean; data?: Array<{ entryId: string; text: string }>; error?: string }>
  agentResolveApproval: (
    requestId: string,
    decision: 'allow' | 'always' | 'deny',
    pattern?: string
  ) => Promise<{ success: boolean; error?: string }>
  agentSetPermissionMode: (
    sessionId: string,
    mode: AgentPermissionMode | 'full' | 'restricted' | 'readonly'
  ) => Promise<{ success: boolean; error?: string }>
  agentGetPermissionMode: (
    sessionId?: string
  ) => Promise<{ success: boolean; data?: 'default' | 'auto' | 'bypass' | 'readonly'; error?: string }>
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
  agentListSkills: (cwd?: string) => Promise<{
    success: boolean
    data?: AgentSkill[]
    error?: string
  }>
  agentGetConfig: () => Promise<{ success: boolean; data?: AgentConfig; error?: string }>
  agentSetSkillDirs: (dirs: string[]) => Promise<{ success: boolean; error?: string }>
  agentAllowlistAdd: (
    tool: string,
    pattern: string
  ) => Promise<{ success: boolean; data?: AgentAllowlistEntry; error?: string }>
  agentAllowlistRemove: (id: string) => Promise<{ success: boolean; error?: string }>
  agentGetRuntimeSnapshot: (sessionId?: string) => Promise<{
    success: boolean
    data?: AgentRuntimeSnapshot
    error?: string
  }>
  agentGetSessionStatus: (sessionId?: string) => Promise<{
    success: boolean
    data?: AgentSessionStatus | null
    error?: string
  }>
  agentSetThinkingLevel: (
    sessionId: string,
    level: AgentThinkingLevel
  ) => Promise<{ success: boolean; data?: AgentActiveModel; error?: string }>
  agentCompact: (
    sessionId: string,
    instructions?: string
  ) => Promise<{ success: boolean; error?: string }>
  agentSetAutoCompaction: (
    sessionId: string,
    enabled: boolean
  ) => Promise<{ success: boolean; data?: AgentSessionStatus | null; error?: string }>
  agentGetCompactionConfig: () => Promise<{ success: boolean; data?: CompressionConfig; error?: string }>
  agentSetCompactionConfig: (
    config: Partial<CompressionConfig>
  ) => Promise<{ success: boolean; data?: CompressionConfig; error?: string }>
  agentLoginProvider: (
    providerId: string,
    type: AgentAuthType
  ) => Promise<{ success: boolean; data?: AgentAuthOperation; error?: string }>
  agentRespondProviderAuth: (
    operationId: string,
    value: string
  ) => Promise<{ success: boolean; data?: AgentAuthOperation; error?: string }>
  agentCancelProviderAuth: (
    operationId: string
  ) => Promise<{ success: boolean; data?: AgentAuthOperation; error?: string }>
  agentListAuthOperations: () => Promise<{
    success: boolean
    data?: AgentAuthOperation[]
    error?: string
  }>
  agentLogoutProvider: (
    providerId: string
  ) => Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }>
  agentRefreshProviderModels: (
    providerId: string
  ) => Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }>
  agentListCustomGateways?: () => Promise<{
    success: boolean
    data?: Array<Omit<AgentCustomGatewaySpec, 'apiKey'>>
    error?: string
  }>
  agentAddCustomGateway?: (spec: AgentCustomGatewaySpec) => Promise<{
    success: boolean
    data?: AgentRuntimeSnapshot
    error?: string
  }>
  agentRemoveCustomGateway?: (
    providerId: string
  ) => Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }>
  agentTestGatewayConnection?: (
    spec: Omit<AgentCustomGatewaySpec, 'providerId' | 'name'> & { providerId?: string; name?: string }
  ) => Promise<{ success: boolean; data?: AgentGatewayTestResult; error?: string }>
  agentGetProviderQuotas?: (options?: {
    providerIds?: string[]
    force?: boolean
  }) => Promise<{ success: boolean; data?: Record<string, AgentProviderQuota>; error?: string }>
  agentRefreshProviderQuota?: (
    providerId: string
  ) => Promise<{ success: boolean; data?: AgentProviderQuota | null; error?: string }>
  onAgentProviderQuotaUpdated?: (cb: (payload: { quota: AgentProviderQuota }) => void) => () => void
  agentSetProviderBaseUrl?: (
    providerId: string,
    baseUrl: string | null
  ) => Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }>
  agentSetProviderDisabled?: (
    providerId: string,
    disabled: boolean
  ) => Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }>
  agentSetModelFavorite?: (
    providerId: string,
    modelId: string,
    favored: boolean
  ) => Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }>
  agentRemoveRecentModels?: (
    items: AgentFavoriteModel[]
  ) => Promise<{ success: boolean; data?: AgentRuntimeSnapshot; error?: string }>
  onAgentProviderAuthChanged?: (cb: (payload: { operation: AgentAuthOperation }) => void) => () => void
  onAgentRuntimeChanged?: (cb: (payload: { reason: string }) => void) => () => void
  onAgentSessionStatus?: (
    cb: (payload: { sessionId: string; status: AgentSessionStatus }) => void
  ) => () => void
  onAgentEvent?: (cb: (payload: { sessionId: string; event: unknown }) => void) => () => void
  onAgentApprovalRequest?: (cb: (payload: AgentApprovalRequest) => void) => () => void
}
