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

export interface AgentProviderModel {
  providerId: string
  id: string
  name: string
  available: boolean
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
  maxTokens: number
}

export interface AgentProvider {
  id: string
  name: string
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
  context: AgentContextUsage | null
  stats: AgentSessionStats | null
}

export interface AgentSessionStatus {
  active: AgentActiveModel
  context: AgentContextUsage | null
  stats: AgentSessionStats | null
}
