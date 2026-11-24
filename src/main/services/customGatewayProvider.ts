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

/**
 * Generic adapter for any OpenAI-compatible gateway that exposes a
 * `/v1/models` listing (LiteLLM, one-api, new-api, the local magpie gateway,
 * …). The standard payload only guarantees `id`, so every model defaults to
 * `openai-completions`; gateways that report extra fields (native endpoints,
 * reasoning levels, pricing, context window) plug in an `enrichModel` hook to
 * upgrade the mapping instead of a forked provider.
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
  /** Base URL including the version segment, e.g. `http://host:port/v1`. */
  baseUrl: string
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
   * reports richer fields. Receives the default config plus the raw entry;
   * returns the final config (may be the input unchanged).
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
const DEFAULT_TIMEOUT_MS = 5000

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function gatewayApiForEntry(entry: GatewayModelEntry): Api {
  const endpoints = Array.isArray(entry.native_endpoints) ? entry.native_endpoints : []
  const paths = endpoints.filter((value): value is string => typeof value === 'string')
  if (paths.some((endpoint) => endpoint.endsWith('/v1/messages'))) return 'anthropic-messages'
  if (paths.some((endpoint) => endpoint.endsWith('/v1/responses'))) return 'openai-responses'
  return 'openai-completions'
}

function gatewayThinkingLevelMap(entry: GatewayModelEntry): ThinkingLevelMap | undefined {
  if (entry.reasoning !== true) return undefined
  const levels = new Set(
    Array.isArray(entry.reasoning_levels)
      ? entry.reasoning_levels.filter((value): value is string => typeof value === 'string')
      : []
  )
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
  return owner ? `${display} · ${owner}` : display
}

export class CustomGatewayProvider {
  readonly providerId: string
  readonly name: string
  readonly baseUrl: string
  readonly messagesBaseUrl: string
  readonly apiKey: string
  readonly seedModels: ProviderModelConfig[]
  private readonly timeoutMs: number
  private readonly enrichModel: GatewayProviderOptions['enrichModel']

  constructor(options: GatewayProviderOptions) {
    this.providerId = options.providerId
    this.name = options.name
    this.baseUrl = options.baseUrl
    this.messagesBaseUrl =
      options.messagesBaseUrl ?? options.baseUrl.replace(/\/v1\/?$/i, '')
    this.apiKey = options.apiKey ?? 'custom-gateway'
    this.seedModels = options.seedModels ?? []
    this.timeoutMs = options.fetchTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.enrichModel = options.enrichModel
  }

  private defaultModelForEntry(entry: GatewayModelEntry): ProviderModelConfig | undefined {
    if (typeof entry.id !== 'string' || !entry.id.trim()) return undefined
    const rawInput = Array.isArray(entry.modalities?.input) ? (entry.modalities?.input ?? []) : []
    const input = rawInput.filter(
      (value): value is ModelInputModality => value === 'text' || value === 'image'
    )
    const api = gatewayApiForEntry(entry)
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
      maxTokens: positiveNumber(entry.max_output_tokens) ?? 16384,
      // A generic gateway is neither OpenAI nor Anthropic proper: system-role
      // prompts and the widely-supported max_tokens field keep routed models working.
      compat: {
        supportsDeveloperRole: false,
        maxTokensField: 'max_tokens'
      } as Model<Api>['compat']
    }
  }

  /** Fetch `/v1/models` and map each entry to a pi model config. */
  async fetchModels(signal?: AbortSignal): Promise<ProviderModelConfig[]> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { accept: 'application/json' },
      signal: combined
    })
    if (!response.ok) {
      throw new Error(`${this.providerId} /v1/models responded ${response.status}`)
    }
    const payload = (await response.json()) as { data?: unknown }
    const rawList = Array.isArray(payload.data) ? payload.data : []
    const models: ProviderModelConfig[] = []
    for (const raw of rawList) {
      const entry = raw as GatewayModelEntry
      const base = this.defaultModelForEntry(entry)
      if (!base) continue
      const enriched = this.enrichModel?.(base, entry, { messagesBaseUrl: this.messagesBaseUrl }) ?? base
      if (enriched) models.push(enriched)
    }
    return models
  }

  private storePath(agentDir: string): string {
    return join(agentDir, 'models-store.json')
  }

  /**
   * Read the last catalog persisted under the FileModelsStore layout
   * (`{ providerId: { models, checkedAt } }`). Entries are already-mapped
   * ProviderModelConfig records, so validation is a shallow shape check.
   */
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

  /**
   * Persist the fetched catalog so a restart with the gateway offline still
   * exposes the full model list. Mirrors the FileModelsStore JSON shape so
   * pi's own store reader stays compatible if it ever reads the same file.
   */
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
