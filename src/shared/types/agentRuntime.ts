export type AgentThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type AgentAuthType = 'api_key' | 'oauth'

export type AgentAuthPromptType = 'text' | 'secret' | 'manual_code' | 'select'

export type AgentAuthOperationStatus = 'running' | 'waiting' | 'success' | 'error' | 'cancelled'

export interface AgentAuthPromptOption {
  id: string
  label: string
  description?: string
}

export interface AgentAuthPrompt {
  id: string
  type: AgentAuthPromptType
  message: string
  placeholder?: string
  options?: AgentAuthPromptOption[]
}

export interface AgentAuthEvent {
  type: 'info' | 'auth_url' | 'device_code' | 'progress'
  message?: string
  url?: string
  instructions?: string
  userCode?: string
  verificationUri?: string
  intervalSeconds?: number
  expiresInSeconds?: number
  links?: Array<{ url: string; label?: string }>
}

export interface AgentAuthOperation {
  id: string
  providerId: string
  providerName: string
  type: AgentAuthType
  status: AgentAuthOperationStatus
  prompt?: AgentAuthPrompt
  events: AgentAuthEvent[]
  error?: string
}

export type AgentGatewayApiType =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'

export interface AgentQuotaWindow {
  id: string
  name: string
  usedPercent?: number
  remainingPercent?: number
  unlimited?: boolean
  amount?: number
  limit?: number
  unit?: string
  resetsAt?: number
  text?: string
}

export interface AgentProviderQuota {
  providerId: string
  kind: 'subscription' | 'plan' | 'balance'
  plan?: string
  account?: string
  balanceText?: string
  windows: AgentQuotaWindow[]
  fetchedAt: number
  error?: string
  stale?: boolean
  sourceLabel?: string
}

export interface AgentCustomGatewaySpec {
  providerId: string
  name: string
  baseUrl: string
  apiKey?: string
  api?: AgentGatewayApiType
  presetId?: string
  balanceUrl?: string
  balancePath?: string
}

export interface AgentGatewayTestResult {
  ok: boolean
  modelCount: number
  enrichedCount: number
  sampleModels: string[]
  quota?: AgentProviderQuota
  error?: string
  hint?: string
}

export interface AgentProviderModel {
  providerId: string
  id: string
  name: string
  available: boolean
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
  maxTokens: number
  thinkingLevels?: AgentThinkingLevel[]
}

export interface AgentProvider {
  id: string
  name: string
  /** Effective request baseUrl after any user override; gateway or overridden providers. */
  baseUrl?: string
  /** Default baseUrl before override, when known. */
  defaultBaseUrl?: string
  /** Configured protocol for custom gateways. */
  api?: AgentGatewayApiType
  isCustom?: boolean
  presetId?: string
  endpointEditable?: boolean
  balanceUrl?: string
  balancePath?: string
  hasStoredApiKey?: boolean
  configured: boolean
  authType?: AgentAuthType
  authSource?: 'stored' | 'runtime' | 'environment' | 'fallback' | 'models_json_key' | 'models_json_command'
  authLabel?: string
  apiKeyAvailable: boolean
  oauthAvailable: boolean
  oauthName?: string
  oauthLoginLabel?: string
  isSubscription?: boolean
  modelCount: number
  availableModelCount: number
  models: AgentProviderModel[]
  error?: string
  disabled?: boolean
}

export interface AgentFavoriteModel {
  providerId: string
  modelId: string
}

export interface AgentContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export interface AgentSessionStats {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  cost: number
}

export interface AgentActiveModel {
  providerId: string
  modelId: string
  modelName: string
  thinkingLevel: AgentThinkingLevel
  availableThinkingLevels: AgentThinkingLevel[]
  supportsThinking: boolean
}

export interface AgentRuntimeSnapshot {
  providers: AgentProvider[]
  active: AgentActiveModel
  favorites: AgentFavoriteModel[]
  recent: AgentFavoriteModel[]
  context: AgentContextUsage | null
  stats: AgentSessionStats | null
}

export interface AgentSessionStatus {
  active: AgentActiveModel
  context: AgentContextUsage | null
  stats: AgentSessionStats | null
  compaction: {
    enabled: boolean
    isCompacting: boolean
    reserveTokens: number
    keepRecentTokens: number
  } | null
}

/** A single file touched by an edit/write tool call or shell command within one agent turn. */
export interface AgentFileChange {
  path: string
  name: string
  isNew: boolean
  /** True when the file existed before the turn and was deleted during the turn. */
  isDeleted?: boolean
  /** True when the file cannot be safely reverted (e.g. modified/deleted by shell without pre-edit blob, or >10MB). */
  noBaselineBlob?: boolean
  added: number
  deleted: number
}

/** Persisted snapshot of one file at a specific point in the turn lifecycle. */
export interface AgentFileSnapshot {
  path: string
  /** File modification time in ms, or null when the file does not exist yet. */
  mtimeMs: number | null
  /** File size in bytes, or null when the file does not exist yet. */
  size: number | null
  /** SHA-1 of file contents, or null when the file does not exist yet. */
  sha1: string | null
}

/** Revert/redo lifecycle for one file within a turn. */
export type AgentFileChangeStatus = 'applied' | 'undone'

/** Turn-scoped record stored by the main process for undo/redo. */
export interface AgentTurnFileChanges {
  /** 1-based turn number (matches the Nth user message) that produced these
   * changes. Lets the renderer pin the card to the correct turn's closing
   * assistant message rather than showing it after every turn. */
  turnIndex?: number
  /** Files touched during this turn, in the order they were first edited. */
  files: AgentFileChange[]
  /** Path → baseline snapshot taken before the first write in this turn. */
  baseline: Record<string, AgentFileSnapshot>
  /** Path → snapshot taken after the last write in this turn. */
  target: Record<string, AgentFileSnapshot>
  status: AgentFileChangeStatus
}

/** Provenance metadata for a forked Agent session. */
export interface AgentForkOrigin {
  parentSessionId?: string
  parentSessionTitle?: string
  /** Number of inherited user/assistant messages preceding the fork boundary. */
  inheritedMessageCount?: number
  /** Whether the source session still exists in memory or on disk. */
  parentExists?: boolean
}

