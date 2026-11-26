import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Api, ModelInputModality, ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent'

type ProviderChatModelConfig = Extract<ProviderModelConfig, { type?: 'chat' }>

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

const VARIANT_SUFFIX_RE = /-(minimal|low|medium|high|xhigh|max|thinking|fast)$/i
const RELAY_PREFIX_RE = /^(?:claude|openai|anthropic|google|deepseek|qwen|zai|doubao|nyro|cursor)-/i
const SNAPSHOT_DATE_RE = /[-@](?:20\d{6}|2[3-9](?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))$/

export interface EnrichedModelMeta {
  name?: string
  api?: Api
  reasoning?: boolean
  thinkingLevelMap?: ThinkingLevelMap
  input?: ModelInputModality[]
  contextWindow?: number
  maxTokens?: number
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

interface ModelsDevModel {
  id?: string
  name?: string
  reasoning?: boolean
  modalities?: { input?: unknown }
  limit?: { context?: unknown; input?: unknown; output?: unknown }
  cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown }
  interleaved?: unknown
}

interface ModelsDevCatalog {
  [providerId: string]: {
    models?: Record<string, ModelsDevModel>
  }
}

const MODELS_DEV_URL = 'https://models.dev/api.json'
const MODELS_DEV_TTL_MS = 24 * 60 * 60 * 1000
const MODELS_DEV_CACHE_FILE = 'models-dev-cache.json'

function positiveInt(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

function nonNegativeNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Normalize a model id across vendor naming conventions (inspired by Magpie's SameModel):
 * - strip vendor/namespace prefix (`anthropic/claude-sonnet-4-5`, `accounts/fireworks/models/...`)
 * - collapse whitespace/underscore runs to `-`
 * - normalize version dots and Fireworks `p` (`4.5` / `4p5` -> `4-5`)
 * - strip trailing snapshot dates (`-20250929`, `@20250929`, `-260910`)
 */
export function normalizeModelId(rawId: string): string {
  let k = rawId.toLowerCase().trim()
  const slash = k.lastIndexOf('/')
  if (slash >= 0) k = k.slice(slash + 1)
  const colon = k.indexOf(':')
  if (colon > 0) k = k.slice(0, colon)
  k = k.replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  k = k.replace(/(\d)[.p](\d)/g, '$1-$2')
  k = k.replace(SNAPSHOT_DATE_RE, '')
  return k
}

function stripVariantSuffix(id: string): { base: string; suffix?: string } {
  const m = VARIANT_SUFFIX_RE.exec(id)
  if (!m || m.index <= 0) return { base: id }
  return { base: id.slice(0, m.index), suffix: m[1].toLowerCase() }
}

function versionlessKey(normId: string): string | null {
  // Replace version segments like 4-5, 3-7, 5-1, 2-5 with X so newer minor releases inherit family specs.
  const stripped = normId.replace(/(?<=-)\d+(?:-\d+)?(?=-|$)/g, 'x')
  return stripped !== normId ? stripped : null
}

function isChatModelRecord(entry: unknown): entry is {
  id: string
  name?: string
  api?: Api
  reasoning?: boolean
  thinkingLevelMap?: ThinkingLevelMap
  input?: unknown
  contextWindow?: number
  maxTokens?: number
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  type?: string
} {
  if (!entry || typeof entry !== 'object') return false
  const rec = entry as Record<string, unknown>
  if (typeof rec.id !== 'string' || !rec.id) return false
  if (rec.type && rec.type !== 'chat') return false
  return typeof rec.contextWindow === 'number'
}

export class ModelCatalogEnricher {
  private piIndexExact = new Map<string, EnrichedModelMeta>()
  private piIndexNorm = new Map<string, EnrichedModelMeta>()
  private piIndexKin = new Map<string, EnrichedModelMeta>()
  private piLoaded = false

  private devIndexExact = new Map<string, EnrichedModelMeta>()
  private devIndexNorm = new Map<string, EnrichedModelMeta>()
  private devLoadedFromDisk = false
  private devFetchedAt = 0
  private devSyncPromise: Promise<void> | null = null

  constructor(private readonly agentDir: string) {}

  private cacheFilePath(): string {
    return join(this.agentDir, MODELS_DEV_CACHE_FILE)
  }

  private async ensurePiCatalog(): Promise<void> {
    if (this.piLoaded) return
    this.piLoaded = true
    try {
      const piAi = await importEsm<{ MODELS?: Record<string, Record<string, unknown>> }>('@earendil-works/pi-ai')
      const modelsByProvider = piAi.MODELS ?? {}
      // Prefer canonical first-party providers before aggregators so direct specs win ties.
      const preferredOrder = [
        'openai',
        'openai-codex',
        'anthropic',
        'google',
        'deepseek',
        'xai',
        'moonshotai',
        'moonshotai-cn',
        'kimi-coding',
        'minimax',
        'minimax-cn',
        'zai',
        'zai-coding-cn',
        'mistral',
        'groq'
      ]
      const providerKeys = [
        ...preferredOrder.filter((k) => k in modelsByProvider),
        ...Object.keys(modelsByProvider).filter((k) => !preferredOrder.includes(k))
      ]

      for (const provKey of providerKeys) {
        const group = modelsByProvider[provKey]
        if (!group || typeof group !== 'object') continue
        for (const rawEntry of Object.values(group)) {
          if (!isChatModelRecord(rawEntry)) continue
          const input = Array.isArray(rawEntry.input)
            ? rawEntry.input.filter((v): v is ModelInputModality => v === 'text' || v === 'image')
            : undefined
          const meta: EnrichedModelMeta = {
            name: rawEntry.name,
            api: rawEntry.api,
            reasoning: rawEntry.reasoning,
            thinkingLevelMap: rawEntry.thinkingLevelMap,
            input: input && input.length > 0 ? input : ['text'],
            contextWindow: rawEntry.contextWindow,
            maxTokens: rawEntry.maxTokens,
            cost: rawEntry.cost
              ? {
                  input: rawEntry.cost.input,
                  output: rawEntry.cost.output,
                  cacheRead: rawEntry.cost.cacheRead,
                  cacheWrite: rawEntry.cost.cacheWrite
                }
              : undefined
          }
          const exactKey = rawEntry.id.toLowerCase()
          if (!this.piIndexExact.has(exactKey)) {
            this.piIndexExact.set(exactKey, meta)
          }
          const normKey = normalizeModelId(rawEntry.id)
          if (normKey && !this.piIndexNorm.has(normKey)) {
            this.piIndexNorm.set(normKey, meta)
          }
          const kin = versionlessKey(normKey)
          if (kin && !this.piIndexKin.has(kin)) {
            this.piIndexKin.set(kin, meta)
          }
        }
      }
    } catch {
      // Keep running even if pi-ai MODELS fails to load.
    }
  }

  private indexModelsDev(raw: ModelsDevCatalog): void {
    this.devIndexExact.clear()
    this.devIndexNorm.clear()
    for (const prov of Object.values(raw)) {
      if (!prov || typeof prov !== 'object' || !prov.models) continue
      for (const [key, item] of Object.entries(prov.models)) {
        if (!item || typeof item !== 'object') continue
        const id = typeof item.id === 'string' && item.id ? item.id : key
        const rawModalities = Array.isArray(item.modalities?.input) ? item.modalities.input : []
        const input = rawModalities.filter(
          (v): v is ModelInputModality => v === 'text' || v === 'image'
        )
        const contextWindow =
          positiveInt(item.limit?.input) ?? positiveInt(item.limit?.context)
        const maxTokens = positiveInt(item.limit?.output)
        const reasoning = typeof item.reasoning === 'boolean' ? item.reasoning : undefined
        const meta: EnrichedModelMeta = {
          name: typeof item.name === 'string' ? item.name : undefined,
          reasoning,
          input: input.length > 0 ? input : undefined,
          contextWindow,
          maxTokens,
          cost: item.cost
            ? {
                input: nonNegativeNum(item.cost.input),
                output: nonNegativeNum(item.cost.output),
                cacheRead: nonNegativeNum(item.cost.cache_read),
                cacheWrite: nonNegativeNum(item.cost.cache_write)
              }
            : undefined
        }
        const exactKey = id.toLowerCase()
        if (!this.devIndexExact.has(exactKey)) {
          this.devIndexExact.set(exactKey, meta)
        }
        const normKey = normalizeModelId(id)
        if (normKey && !this.devIndexNorm.has(normKey)) {
          this.devIndexNorm.set(normKey, meta)
        }
      }
    }
  }

  private async ensureModelsDevFromDisk(): Promise<void> {
    if (this.devLoadedFromDisk) return
    this.devLoadedFromDisk = true
    const path = this.cacheFilePath()
    if (!existsSync(path)) return
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as {
        fetchedAt?: number
        catalog?: ModelsDevCatalog
      }
      if (parsed && typeof parsed.catalog === 'object' && parsed.catalog) {
        this.devFetchedAt = typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0
        this.indexModelsDev(parsed.catalog)
      }
    } catch {
      // Ignore corrupt cache; next sync will overwrite.
    }
  }

  public async syncModelsDev(force = false): Promise<boolean> {
    await this.ensureModelsDevFromDisk()
    if (!force && this.devFetchedAt > 0 && Date.now() - this.devFetchedAt < MODELS_DEV_TTL_MS) {
      return false
    }
    if (this.devSyncPromise) {
      await this.devSyncPromise
      return true
    }
    this.devSyncPromise = (async () => {
      try {
        const res = await fetch(MODELS_DEV_URL, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(8000)
        })
        if (!res.ok) return
        const catalog = (await res.json()) as ModelsDevCatalog
        if (!catalog || typeof catalog !== 'object') return
        const fetchedAt = Date.now()
        this.devFetchedAt = fetchedAt
        this.indexModelsDev(catalog)
        await mkdir(this.agentDir, { recursive: true })
        await writeFile(
          this.cacheFilePath(),
          JSON.stringify({ fetchedAt, catalog }),
          'utf8'
        )
      } catch {
        // Optional remote catalog sync should never break local model refresh.
      } finally {
        this.devSyncPromise = null
      }
    })()
    await this.devSyncPromise
    return true
  }

  private lookupCandidate(rawId: string): EnrichedModelMeta | undefined {
    const exact = rawId.toLowerCase().trim()
    const exactBare = (exact.includes('/') ? exact.slice(exact.lastIndexOf('/') + 1) : exact)
    const norm = normalizeModelId(rawId)
    const unprefixed = norm.replace(RELAY_PREFIX_RE, '')
    const unsuffixed = stripVariantSuffix(norm).base
    const unprefixedUnsuffixed = stripVariantSuffix(unprefixed).base

    const keys = [exact, exactBare, norm, unprefixed, unsuffixed, unprefixedUnsuffixed]
    for (const k of keys) {
      if (!k) continue
      const piHit = this.piIndexExact.get(k) ?? this.piIndexNorm.get(k)
      if (piHit) return piHit
    }
    for (const k of keys) {
      if (!k) continue
      const devHit = this.devIndexExact.get(k) ?? this.devIndexNorm.get(k)
      if (devHit) return devHit
    }
    for (const k of [norm, unprefixed, unsuffixed]) {
      const kin = versionlessKey(k)
      if (!kin) continue
      const kinHit = this.piIndexKin.get(kin)
      if (kinHit) return kinHit
    }
    return undefined
  }

  /**
   * Enrich a gateway model entry using pi-ai's built-in model registry and
   * optional models.dev metadata, preserving explicit upstream metadata when present.
   */
  public async enrichModels(
    models: ProviderModelConfig[],
    options?: {
      syncRemote?: boolean
    }
  ): Promise<{ models: ProviderModelConfig[]; enrichedCount: number }> {
    await this.ensurePiCatalog()
    await this.ensureModelsDevFromDisk()
    if (options?.syncRemote) {
      await this.syncModelsDev(false)
    }

    let enrichedCount = 0
    const out = models.map((raw) => {
      if (raw.type && raw.type !== 'chat') return raw
      const chat = raw as ProviderChatModelConfig
      const meta = this.lookupCandidate(chat.id)
      const { suffix } = stripVariantSuffix(normalizeModelId(chat.id))
      const hasExplicitContext = chat.contextWindow !== 128000 && chat.contextWindow > 0
      const hasExplicitMaxTokens = chat.maxTokens !== 16384 && chat.maxTokens > 0

      let next: ProviderChatModelConfig = { ...chat }
      if (meta) {
        enrichedCount++
        next = {
          ...next,
          reasoning: chat.reasoning || Boolean(meta.reasoning),
          thinkingLevelMap:
            chat.thinkingLevelMap ??
            meta.thinkingLevelMap ??
            (suffix === 'thinking' && (chat.reasoning || meta.reasoning)
              ? { off: 'none', minimal: 'low', low: 'low', medium: 'medium', high: 'high' }
              : undefined),
          input:
            chat.input.includes('image') || !meta.input
              ? chat.input
              : meta.input,
          contextWindow: hasExplicitContext
            ? chat.contextWindow
            : (meta.contextWindow ?? chat.contextWindow),
          maxTokens: hasExplicitMaxTokens
            ? chat.maxTokens
            : (meta.maxTokens ?? chat.maxTokens),
          cost:
            chat.cost.input === 0 && chat.cost.output === 0 && meta.cost
              ? meta.cost
              : chat.cost
        }
      } else if (suffix === 'thinking' || /^o[134](?:-|$)|deepseek-r1|qwq/i.test(chat.id)) {
        enrichedCount++
        next.reasoning = true
      }

      return next
    })

    return { models: out, enrichedCount }
  }
}
