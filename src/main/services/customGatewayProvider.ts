import type {
  Api,
  Model,
  ModelCost,
  ModelInputModality,
  ThinkingLevelMap
} from '@earendil-works/pi-ai'
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import type { AgentGatewayApiType } from '../../shared/types/agentRuntime'
import { redactCredential, safeError } from './redact'

/**
 * Generic adapter for any OpenAI- or Anthropic-compatible gateway that exposes
 * a `/v1/models` listing (LiteLLM, one-api, new-api, sub2api, local magpie, ...).
 */

export interface GatewayModelEntry {
  id?: unknown
  name?: unknown
  display_name?: unknown
  owned_by?: unknown
  context_window?: unknown
  context_length?: unknown
  max_input_tokens?: unknown
  max_output_tokens?: unknown
  max_tokens?: unknown
  modalities?: { input?: unknown }
  native_endpoints?: unknown
  pricing?: Record<string, unknown>
  reasoning?: unknown
  reasoning_levels?: unknown
}

export interface GatewayProviderOptions {
  providerId: string
  /** Display name shown in the provider list. */
  name: string
  /** Base URL including the version segment when applicable, e.g. `http://host:port/v1`. */
  baseUrl: string
  /** Preferred protocol for models without explicit native_endpoints. */
  api?: AgentGatewayApiType
  /**
   * Base URL for models routed to the Anthropic messages API. The Anthropic
   * SDK appends `/v1/messages` itself, so this must be the gateway root
   * without the `/v1` segment. Defaults to `baseUrl` with a trailing `/v1`
   * stripped.
   */
  messagesBaseUrl?: string
  /** Static API key the provider is registered with; defaults to a no-op. */
  apiKey?: string
  /** Static models used before the first successful fetch. */
  seedModels?: ProviderModelConfig[]
  fetchTimeoutMs?: number
  /**
   * Optional hook that upgrades a generic model config when the gateway
   * reports richer fields.
   */
  enrichModel?: (
    model: ProviderModelConfig,
    entry: GatewayModelEntry,
    ctx: { messagesBaseUrl: string }
  ) => ProviderModelConfig | undefined
}

interface GatewayStoreFile {
  [providerId: string]: { models?: unknown; checkedAt?: unknown }
}

const PI_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const DEFAULT_TIMEOUT_MS = 8000

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeGatewayBaseUrl(raw: string, api?: AgentGatewayApiType): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (api === 'anthropic-messages') {
    return trimmed
  }
  return trimmed
}

function buildModelsEndpointCandidates(baseUrl: string, api?: AgentGatewayApiType): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, '')
  if (!clean) return []
  const candidates: string[] = []
  const push = (url: string): void => {
    if (!candidates.includes(url)) candidates.push(url)
  }

  if (api === 'anthropic-messages') {
    const root = clean.replace(/\/v1$/i, '')
    push(`${root}/v1/models`)
    if (clean !== root) push(`${clean}/models`)
    return candidates
  }

  // Respect versioned baseUrls (e.g., /v1, /v4, /compatible-mode/v1), and fall back to /v1/models
  // if the user entered only an origin/root without a version segment.
  push(`${clean}/models`)
  try {
    const parsed = new URL(clean)
    if (!parsed.pathname || parsed.pathname === '/') {
      push(`${clean}/v1/models`)
    }
  } catch {
    // ignore invalid URL; fetch will raise a clear error
  }
  return candidates
}

function gatewayApiForEntry(entry: GatewayModelEntry, preferredApi?: AgentGatewayApiType): Api {
  const endpoints = Array.isArray(entry.native_endpoints) ? entry.native_endpoints : []
  const paths = endpoints.filter((value): value is string => typeof value === 'string')
  if (paths.some((endpoint) => endpoint.endsWith('/v1/messages'))) return 'anthropic-messages'
  if (paths.some((endpoint) => endpoint.endsWith('/v1/responses'))) return 'openai-responses'
  if (preferredApi) return preferredApi
  return 'openai-completions'
}

function gatewayThinkingLevelMap(entry: GatewayModelEntry): ThinkingLevelMap | undefined {
  if (entry.reasoning !== true) return undefined
  const levels = new Set(
    Array.isArray(entry.reasoning_levels)
      ? entry.reasoning_levels.filter((value): value is string => typeof value === 'string')
      : []
  )
  if (levels.size === 0) return undefined
  const map: ThinkingLevelMap = {}
  for (const level of PI_LEVELS) {
    map[level] = levels.has(level) ? level : null
  }
  if (levels.has('none')) {
    map.off = 'none'
  }
  return map
}

function gatewayCost(pricing: GatewayModelEntry['pricing']): ModelCost {
  const perToken = (value: unknown): number => {
    const parsed = Number.parseFloat(String(value ?? ''))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : 0
  }
  return {
    input: perToken(pricing?.prompt),
    output: perToken(pricing?.completion),
    cacheRead: perToken(pricing?.input_cache_read),
    cacheWrite: perToken(pricing?.input_cache_write)
  }
}

function gatewayDisplayName(entry: GatewayModelEntry): string {
  const name =
    (typeof entry.name === 'string' && entry.name.trim()) ||
    (typeof entry.display_name === 'string' && entry.display_name.trim())
  if (name) return name
  const id = typeof entry.id === 'string' ? entry.id : ''
  return id.split('/').pop() || id
}

function gatewayModelName(entry: GatewayModelEntry): string {
  const owner = typeof entry.owned_by === 'string' ? entry.owned_by.trim().toUpperCase() : ''
  const display = gatewayDisplayName(entry)
  return owner && owner !== 'SYSTEM' && owner !== 'CUSTOM' ? `${display} · ${owner}` : display
}

export function classifyGatewayFetchError(error: unknown, baseUrl: string): {
  message: string
  hint: string
} {
  const msg = safeError(error)
  if (/\b401\b|\b403\b|unauthorized|invalid.*key/i.test(msg)) {
    return {
      message: msg,
      hint: 'API Key 无效或权限不足，请检查 Key 是否粘贴完整或包含多余空格'
    }
  }
  if (/\b404\b|not found/i.test(msg)) {
    const hasVersion = /\/v\d+\b/i.test(baseUrl)
    return {
      message: msg,
      hint: hasVersion
        ? '该地址未提供 /models 接口，请确认平台地址及 API 协议类型是否正确'
        : 'Base URL 可能需要补全 /v1 后缀（例如 https://host/v1）'
    }
  }
  if (/timeout|aborted|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(msg)) {
    return {
      message: msg,
      hint: '无法连接到服务器，请检查地址拼写、本地服务是否启动或网络/代理设置'
    }
  }
  return {
    message: msg,
    hint: '请检查 Base URL、API 协议与 Key 配置'
  }
}

export class CustomGatewayProvider {
  readonly providerId: string
  readonly name: string
  readonly baseUrl: string
  readonly api: AgentGatewayApiType
  readonly messagesBaseUrl: string
  readonly apiKey: string
  readonly seedModels: ProviderModelConfig[]
  private readonly timeoutMs: number
  private readonly enrichModel: GatewayProviderOptions['enrichModel']

  constructor(options: GatewayProviderOptions) {
    this.providerId = options.providerId
    this.name = options.name
    this.api = options.api ?? 'openai-completions'
    this.baseUrl = normalizeGatewayBaseUrl(options.baseUrl, this.api)
    this.messagesBaseUrl =
      options.messagesBaseUrl ?? this.baseUrl.replace(/\/v1\/?$/i, '')
    this.apiKey = options.apiKey ?? 'custom-gateway'
    if (options.apiKey && options.apiKey !== 'custom-gateway') {
      redactCredential(options.apiKey)
    }
    this.seedModels = options.seedModels ?? []
    this.timeoutMs = options.fetchTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.enrichModel = options.enrichModel
  }

  /** Effective baseUrl passed to ModelRegistry.registerProvider(). */
  get registrationBaseUrl(): string {
    return this.api === 'anthropic-messages' ? this.messagesBaseUrl : this.baseUrl
  }

  private defaultModelForEntry(entry: GatewayModelEntry): ProviderModelConfig | undefined {
    if (typeof entry.id !== 'string' || !entry.id.trim()) return undefined
    const rawInput = Array.isArray(entry.modalities?.input) ? (entry.modalities?.input ?? []) : []
    const input = rawInput.filter(
      (value): value is ModelInputModality => value === 'text' || value === 'image'
    )
    const api = gatewayApiForEntry(entry, this.api)
    return {
      id: entry.id,
      name: gatewayModelName(entry),
      api,
      reasoning: entry.reasoning === true,
      thinkingLevelMap: gatewayThinkingLevelMap(entry),
      // The Anthropic SDK builds `/v1/messages` on top of baseUrl.
      ...(api === 'anthropic-messages' ? { baseUrl: this.messagesBaseUrl } : {}),
      input: input.length > 0 ? input : ['text'],
      cost: gatewayCost(entry.pricing),
      contextWindow:
        positiveNumber(entry.context_window) ??
        positiveNumber(entry.max_input_tokens) ??
        positiveNumber(entry.context_length) ??
        128000,
      maxTokens:
        positiveNumber(entry.max_output_tokens) ??
        positiveNumber(entry.max_tokens) ??
        16384,
      ...(api === 'openai-completions'
        ? {
            compat: {
              supportsDeveloperRole: false,
              maxTokensField: 'max_tokens'
            } as Model<Api>['compat']
          }
        : {})
    }
  }

  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' }
    const key = this.apiKey?.trim()
    if (key && key !== 'custom-gateway') {
      headers.authorization = `Bearer ${key}`
      if (this.api === 'anthropic-messages') {
        headers['x-api-key'] = key
        headers['anthropic-version'] = '2023-06-01'
      }
    }
    return headers
  }

  /** Fetch `/models` (authenticated when apiKey is set) and map each entry to a pi model config. */
  async fetchModels(signal?: AbortSignal): Promise<ProviderModelConfig[]> {
    const candidates = buildModelsEndpointCandidates(this.baseUrl, this.api)
    if (candidates.length === 0) {
      throw new Error(`${this.providerId} baseUrl 不能为空`)
    }

    let lastError: Error | null = null
    for (const url of candidates) {
      const timeout = AbortSignal.timeout(this.timeoutMs)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        const response = await fetch(url, {
          headers: this.buildRequestHeaders(),
          signal: combined
        })
        if (!response.ok) {
          lastError = new Error(`${this.providerId} ${url} responded ${response.status}`)
          // Retry next candidate on 404 (e.g. missing /v1), otherwise surface immediately.
          if (response.status === 404) continue
          throw lastError
        }
        const payload = (await response.json()) as { data?: unknown } | unknown[]
        const rawList = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : []
        const models: ProviderModelConfig[] = []
        const seen = new Set<string>()
        for (const raw of rawList) {
          const entry = raw as GatewayModelEntry
          const base = this.defaultModelForEntry(entry)
          if (!base || seen.has(base.id)) continue
          seen.add(base.id)
          const enriched =
            this.enrichModel?.(base, entry, { messagesBaseUrl: this.messagesBaseUrl }) ?? base
          if (enriched) models.push(enriched)
        }
        return models
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (signal?.aborted) throw lastError
      }
    }

    throw lastError ?? new Error(`${this.providerId} 获取模型列表失败`)
  }

  private storePath(agentDir: string): string {
    return join(agentDir, 'models-store.json')
  }

  async loadStoredModels(agentDir: string): Promise<ProviderModelConfig[]> {
    try {
      const raw = await readFile(this.storePath(agentDir), 'utf8')
      const parsed = JSON.parse(raw) as GatewayStoreFile
      const entry = parsed[this.providerId]
      const list = Array.isArray(entry?.models) ? entry.models : []
      return list.filter(
        (model): model is ProviderModelConfig =>
          typeof model === 'object' &&
          model !== null &&
          typeof (model as { id?: unknown }).id === 'string' &&
          typeof (model as { api?: unknown }).api === 'string'
      )
    } catch {
      return []
    }
  }

  async persistModels(agentDir: string, models: ProviderModelConfig[]): Promise<void> {
    const path = this.storePath(agentDir)
    let existing: GatewayStoreFile = {}
    try {
      existing = JSON.parse(await readFile(path, 'utf8')) as GatewayStoreFile
    } catch {
      existing = {}
    }
    existing[this.providerId] = { models, checkedAt: Date.now() }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(existing), 'utf8')
  }
}

/** The local magpie gateway: the richest `/v1/models` we know about. */
export const MAGPIE_PROVIDER = new CustomGatewayProvider({
  providerId: 'magpie',
  name: 'Magpie',
  baseUrl: 'http://127.0.0.1:3425/v1',
  apiKey: 'magpie',
  seedModels: [
    {
      id: 'devin/swe-2',
      name: 'SWE-2 · Devin',
      api: 'openai-completions',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262000,
      maxTokens: 128000
    }
  ]
})
