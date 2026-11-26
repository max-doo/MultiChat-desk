import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ModelRuntime as ModelRuntimeType } from '@earendil-works/pi-coding-agent'
import type {
  AgentCustomGatewaySpec,
  AgentProviderQuota,
  AgentQuotaWindow
} from '../../shared/types/agentRuntime'
import { redactCredential, safeError } from './redact'

interface StoredOAuthRecord {
  type?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string
  enterpriseUrl?: string
  key?: string
}

interface QuotaCacheEntry {
  quota: AgentProviderQuota
  fetchedAt: number
}

interface RelayProbeCacheEntry {
  endpointPath: string | null
  checkedAt: number
}

export interface QuotaTargetProvider {
  id: string
  name: string
  baseUrl?: string
  configured: boolean
  isCustom?: boolean
  isSubscription?: boolean
  authType?: 'api_key' | 'oauth'
  customSpec?: AgentCustomGatewaySpec
}

const DEFAULT_CACHE_TTL_MS = 60_000
const ANTHROPIC_CACHE_TTL_MS = 180_000
const PROBE_HIT_TTL_MS = 24 * 60 * 60 * 1000
const PROBE_MISS_TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000
const CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth'

const COPILOT_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat'
}

function toEpochMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw < 1e12 ? raw * 1000 : raw
  }
  if (typeof raw === 'string' && raw.trim()) {
    const num = Number(raw.trim())
    if (Number.isFinite(num) && num > 0) {
      return num < 1e12 ? num * 1000 : num
    }
    const parsed = Date.parse(raw.trim())
    if (!Number.isNaN(parsed)) return parsed
  }
  return undefined
}

function numVal(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const parsed = Number.parseFloat(v.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10))
}

function formatMoney(sign: string, amount: number): string {
  return `${sign}${amount.toFixed(2)}`
}

function currencySign(code: unknown): string {
  const upper = String(code ?? '').trim().toUpperCase()
  if (upper === 'CNY' || upper === 'RMB') return '¥'
  if (upper === 'USD' || !upper) return '$'
  return `${upper} `
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(base64, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function originOf(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null
  try {
    const u = new URL(rawUrl.trim())
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

function hostOf(rawUrl: string | undefined): string {
  if (!rawUrl) return ''
  try {
    return new URL(rawUrl.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function formatDurationWindowName(seconds: number): string {
  if (seconds > 0 && seconds % (24 * 3600) === 0) {
    const days = seconds / (24 * 3600)
    return days === 7 ? '7 天额度' : `${days} 天额度`
  }
  if (seconds > 0 && seconds % 3600 === 0) {
    return `${seconds / 3600} 小时额度`
  }
  return '周期额度'
}

/** Evaluate Magpie-style balance path expression like `$data.balance` or `$data.quota / 500000`. */
function readBalanceByPath(payload: unknown, expr: string): number | undefined {
  const trimmed = expr.trim()
  if (!trimmed) return undefined
  const [rawPath, rawDiv] = trimmed.split('/').map((s) => s.trim())
  const path = rawPath.replace(/^\$/, '')
  let cur: unknown = payload
  for (const seg of path.split('.').filter(Boolean)) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  const value = numVal(cur)
  if (value === undefined) return undefined
  if (rawDiv) {
    const divisor = Number.parseFloat(rawDiv)
    if (Number.isFinite(divisor) && divisor > 0) return value / divisor
  }
  return value
}

export class ProviderQuotaService {
  private cache = new Map<string, QuotaCacheEntry>()
  private inflight = new Map<string, Promise<AgentProviderQuota>>()
  private probeCache = new Map<string, RelayProbeCacheEntry>()

  constructor(
    private readonly agentDir: string,
    private readonly getRuntime: () => ModelRuntimeType | null,
    private readonly onQuotaUpdate?: (quota: AgentProviderQuota) => void
  ) {}

  public getCachedAll(): Record<string, AgentProviderQuota> {
    const out: Record<string, AgentProviderQuota> = {}
    for (const [id, entry] of this.cache) {
      out[id] = entry.quota
    }
    return out
  }

  public invalidate(providerId?: string): void {
    if (providerId) {
      this.cache.delete(providerId)
    } else {
      this.cache.clear()
    }
  }

  public async fetchForProvider(
    target: QuotaTargetProvider,
    options?: { force?: boolean }
  ): Promise<AgentProviderQuota> {
    const ttl = target.id === 'anthropic' ? ANTHROPIC_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS
    const cached = this.cache.get(target.id)
    if (!options?.force && cached && Date.now() - cached.fetchedAt < ttl) {
      return cached.quota
    }

    const existing = this.inflight.get(target.id)
    if (existing) return existing

    const task = this.doFetch(target, cached?.quota)
      .then((quota) => {
        this.cache.set(target.id, { quota, fetchedAt: Date.now() })
        this.onQuotaUpdate?.(quota)
        return quota
      })
      .finally(() => {
        if (this.inflight.get(target.id) === task) {
          this.inflight.delete(target.id)
        }
      })

    this.inflight.set(target.id, task)
    return task
  }

  public async fetchAll(
    targets: QuotaTargetProvider[],
    options?: { force?: boolean }
  ): Promise<Record<string, AgentProviderQuota>> {
    const eligible = targets.filter((t) => t.configured)
    const results = await Promise.all(
      eligible.map((target) =>
        this.fetchForProvider(target, options).catch(
          (err): AgentProviderQuota => ({
            providerId: target.id,
            kind: target.isSubscription ? 'subscription' : 'balance',
            windows: [],
            fetchedAt: Date.now(),
            error: safeError(err)
          })
        )
      )
    )
    const map: Record<string, AgentProviderQuota> = {}
    for (const item of results) {
      map[item.providerId] = item
    }
    return map
  }

  private async readStoredAuthRecord(providerId: string): Promise<StoredOAuthRecord | undefined> {
    const authPath = join(this.agentDir, 'auth.json')
    if (!existsSync(authPath)) return undefined
    try {
      const raw = JSON.parse(await readFile(authPath, 'utf8')) as Record<string, StoredOAuthRecord>
      const rec = raw?.[providerId]
      if (!rec || typeof rec !== 'object') return undefined
      if (rec.access) redactCredential(rec.access)
      if (rec.refresh) redactCredential(rec.refresh)
      if (rec.key) redactCredential(rec.key)
      return rec
    } catch {
      return undefined
    }
  }

  private async resolveToken(providerId: string, fallbackApiKey?: string): Promise<string | undefined> {
    const runtime = this.getRuntime()
    if (runtime) {
      try {
        const auth = await runtime.getAuth(providerId)
        const key = auth?.auth.apiKey
        if (key && key !== 'custom-gateway') {
          redactCredential(key)
          return key
        }
        const bearer = auth?.auth.headers?.authorization ?? auth?.auth.headers?.Authorization
        if (typeof bearer === 'string' && bearer.trim()) {
          const stripped = bearer.replace(/^Bearer\s+/i, '').trim()
          redactCredential(stripped)
          return stripped
        }
      } catch {
        // Fall through to stored record / fallback key
      }
    }
    if (fallbackApiKey && fallbackApiKey !== 'custom-gateway') {
      redactCredential(fallbackApiKey)
      return fallbackApiKey
    }
    return undefined
  }

  private preserveStaleOnError(
    target: QuotaTargetProvider,
    error: unknown,
    previous?: AgentProviderQuota
  ): AgentProviderQuota {
    const message = safeError(error)
    if (previous && !previous.error && (previous.windows.length > 0 || previous.balanceText)) {
      return {
        ...previous,
        stale: true,
        error: message
      }
    }
    return {
      providerId: target.id,
      kind: target.isSubscription ? 'subscription' : 'balance',
      windows: [],
      fetchedAt: Date.now(),
      error: message
    }
  }

  private async doFetch(
    target: QuotaTargetProvider,
    previous?: AgentProviderQuota
  ): Promise<AgentProviderQuota> {
    try {
      if (target.authType === 'oauth') {
        if (target.id === 'openai-codex' || target.id === 'openai') {
          return await this.fetchCodexQuota(target)
        }
        if (target.id === 'github-copilot') {
          return await this.fetchCopilotQuota(target)
        }
        if (target.id === 'kimi-coding') {
          return await this.fetchKimiCodingQuota(target)
        }
        if (target.id === 'anthropic') {
          return await this.fetchAnthropicOAuthQuota(target, previous)
        }
        if (target.id === 'xai') {
          return {
            providerId: target.id,
            kind: 'subscription',
            plan: 'SuperGrok / X',
            windows: [],
            fetchedAt: Date.now(),
            sourceLabel: '已连接 OAuth 订阅（xAI 暂未提供公开额度查询接口）'
          }
        }
      }

      const apiKey = await this.resolveToken(target.id, target.customSpec?.apiKey)
      if (!apiKey) {
        return {
          providerId: target.id,
          kind: 'balance',
          windows: [],
          fetchedAt: Date.now(),
          sourceLabel: '未配置 API Key'
        }
      }

      // 1. User-configured explicit balance endpoint on a custom gateway
      if (target.customSpec?.balanceUrl) {
        return await this.fetchCustomBalanceUrl(
          target,
          target.customSpec.balanceUrl,
          target.customSpec.balancePath,
          apiKey
        )
      }

      // 2. Known vendor / coding-plan endpoints matched by baseUrl host or provider id
      const known = await this.fetchKnownVendorQuota(target, apiKey)
      if (known) return known

      // 3. Automatic relay probing (Sub2API / New-API / One-API / legacy credit_grants)
      if (target.isCustom || target.baseUrl) {
        return await this.probeRelayQuota(target, apiKey)
      }

      return {
        providerId: target.id,
        kind: 'balance',
        windows: [],
        fetchedAt: Date.now()
      }
    } catch (error) {
      return this.preserveStaleOnError(target, error, previous)
    }
  }

  private async fetchCodexQuota(target: QuotaTargetProvider): Promise<AgentProviderQuota> {
    const token = await this.resolveToken(target.id)
    const stored = await this.readStoredAuthRecord(target.id)
    const accessToken = token || stored?.access
    if (!accessToken) {
      throw new Error('未找到有效的 OpenAI OAuth 凭据')
    }
    const jwt = decodeJwtPayload(accessToken)
    const claim = jwt?.[CODEX_JWT_CLAIM_PATH] as Record<string, unknown> | undefined
    const accountId =
      (typeof stored?.accountId === 'string' && stored.accountId) ||
      (typeof claim?.chatgpt_account_id === 'string' ? claim.chatgpt_account_id : undefined)

    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`
    }
    if (accountId) {
      headers['ChatGPT-Account-Id'] = accountId
    }

    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      throw new Error(`ChatGPT 额度接口返回 ${res.status}`)
    }
    const data = (await res.json()) as {
      plan_type?: string
      credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string }
      rate_limit?: {
        allowed?: boolean
        primary_window?: {
          used_percent?: number
          limit_window_seconds?: number
          reset_at?: number
          reset_after_seconds?: number
        }
        secondary_window?: {
          used_percent?: number
          limit_window_seconds?: number
          reset_at?: number
          reset_after_seconds?: number
        }
      }
    }

    const windows: AgentQuotaWindow[] = []
    const pushCodexWindow = (
      id: string,
      w?: {
        used_percent?: number
        limit_window_seconds?: number
        reset_at?: number
        reset_after_seconds?: number
      }
    ): void => {
      if (!w || typeof w.used_percent !== 'number') return
      const used = clampPct(w.used_percent)
      const resetsAt =
        toEpochMs(w.reset_at) ??
        (typeof w.reset_after_seconds === 'number' && w.reset_after_seconds > 0
          ? Date.now() + w.reset_after_seconds * 1000
          : undefined)
      windows.push({
        id,
        name: formatDurationWindowName(w.limit_window_seconds ?? 0),
        usedPercent: used,
        remainingPercent: clampPct(100 - used),
        resetsAt
      })
    }

    pushCodexWindow('primary', data.rate_limit?.primary_window)
    pushCodexWindow('secondary', data.rate_limit?.secondary_window)

    let balanceText: string | undefined
    if (data.credits?.unlimited) {
      balanceText = 'Credits 无限'
    } else if (data.credits?.has_credits && data.credits.balance) {
      const bal = numVal(data.credits.balance)
      if (bal !== undefined && bal > 0) {
        balanceText = `${bal.toFixed(2).replace(/\.00$/, '')} credits`
      }
    }

    const email = typeof jwt?.email === 'string' ? jwt.email : undefined
    return {
      providerId: target.id,
      kind: 'subscription',
      plan: data.plan_type ? data.plan_type.toUpperCase() : 'ChatGPT',
      account: email || accountId,
      balanceText,
      windows,
      fetchedAt: Date.now(),
      sourceLabel: data.rate_limit?.allowed === false && !balanceText ? '已达当前窗口上限' : 'ChatGPT 订阅'
    }
  }

  private async fetchCopilotQuota(target: QuotaTargetProvider): Promise<AgentProviderQuota> {
    const stored = await this.readStoredAuthRecord(target.id)
    const githubToken = stored?.refresh
    if (!githubToken) {
      throw new Error('未找到 GitHub Copilot 登录凭据，请重新登录后查看额度')
    }
    const enterpriseDomain =
      typeof stored.enterpriseUrl === 'string' && stored.enterpriseUrl.trim()
        ? stored.enterpriseUrl.trim()
        : undefined
    const url = enterpriseDomain
      ? `https://api.${enterpriseDomain}/copilot_internal/user`
      : 'https://api.github.com/copilot_internal/user'

    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `token ${githubToken}`,
        ...COPILOT_HEADERS
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      throw new Error(`Copilot 额度接口返回 ${res.status}`)
    }
    const data = (await res.json()) as {
      copilot_plan?: string
      login?: string
      quota_reset_date_utc?: string
      quota_reset_date?: string
      quota_snapshots?: Record<
        string,
        {
          unlimited?: boolean
          has_quota?: boolean
          entitlement?: number | string
          quota_remaining?: number | string
          percent_remaining?: number
          quota_reset_at?: number | string
        }
      >
    }

    const defaultReset = toEpochMs(data.quota_reset_date_utc) ?? toEpochMs(data.quota_reset_date)
    const windows: AgentQuotaWindow[] = []
    const labels: Array<[string, string]> = [
      ['premium_interactions', '高级请求'],
      ['chat', 'Chat 对话'],
      ['completions', '代码补全']
    ]
    for (const [key, label] of labels) {
      const snap = data.quota_snapshots?.[key]
      if (!snap) continue
      const resetsAt = toEpochMs(snap.quota_reset_at) ?? defaultReset
      if (snap.unlimited) {
        if (key === 'premium_interactions' && snap.has_quota === false) {
          windows.push({
            id: key,
            name: label,
            usedPercent: 100,
            remainingPercent: 0,
            resetsAt
          })
        } else {
          windows.push({
            id: key,
            name: label,
            unlimited: true,
            text: '无限',
            resetsAt
          })
        }
        continue
      }
      const entitlement = numVal(snap.entitlement)
      const remaining = numVal(snap.quota_remaining)
      if (entitlement !== undefined && entitlement <= 0) continue
      if (entitlement !== undefined && remaining !== undefined && entitlement > 0) {
        const usedAmount = Math.max(0, entitlement - remaining)
        const usedPct = clampPct((usedAmount / entitlement) * 100)
        windows.push({
          id: key,
          name: label,
          usedPercent: usedPct,
          remainingPercent: clampPct(100 - usedPct),
          amount: usedAmount,
          limit: entitlement,
          resetsAt
        })
      } else if (typeof snap.percent_remaining === 'number') {
        const rem = clampPct(snap.percent_remaining)
        windows.push({
          id: key,
          name: label,
          usedPercent: clampPct(100 - rem),
          remainingPercent: rem,
          resetsAt
        })
      }
    }

    return {
      providerId: target.id,
      kind: 'subscription',
      plan: data.copilot_plan ? `Copilot ${data.copilot_plan}` : 'GitHub Copilot',
      account: data.login,
      windows,
      fetchedAt: Date.now(),
      sourceLabel: 'GitHub Copilot'
    }
  }

  private async fetchKimiCodingQuota(target: QuotaTargetProvider): Promise<AgentProviderQuota> {
    const token = await this.resolveToken(target.id)
    if (!token) throw new Error('未找到 Kimi Code 凭据')
    const base = (target.baseUrl || 'https://api.kimi.com/coding/v1').replace(/\/+$/, '')
    const url = `${base}/usages`
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      throw new Error(`Kimi Code 额度接口返回 ${res.status}`)
    }
    const data = (await res.json()) as {
      usage?: Record<string, unknown>
      limits?: Array<{ window?: Record<string, unknown>; detail?: Record<string, unknown> }>
    }

    const windows: AgentQuotaWindow[] = []
    const parseEntry = (id: string, name: string, d?: Record<string, unknown>): void => {
      if (!d) return
      const limit = numVal(d.limit)
      if (!limit || limit <= 0) return
      const used = numVal(d.used) ?? (numVal(d.remaining) !== undefined ? limit - numVal(d.remaining)! : undefined)
      if (used === undefined) return
      const usedPct = clampPct((Math.max(0, used) / limit) * 100)
      const resetsAt =
        toEpochMs(d.resetTime) ??
        toEpochMs(d.resetAt) ??
        toEpochMs(d.reset_at) ??
        toEpochMs(d.reset_time)
      windows.push({
        id,
        name,
        usedPercent: usedPct,
        remainingPercent: clampPct(100 - usedPct),
        amount: Math.max(0, used),
        limit,
        resetsAt
      })
    }

    if (data.usage) {
      parseEntry('weekly', '周期额度', data.usage)
    }
    if (Array.isArray(data.limits)) {
      data.limits.forEach((entry, idx) => {
        const win = entry.window ?? {}
        const detail = entry.detail ?? {}
        const duration = numVal(win.duration) ?? 0
        const unit = String(win.timeUnit ?? '')
        const name =
          unit.includes('HOUR') || duration === 5
            ? `${duration || 5} 小时额度`
            : unit.includes('MINUTE')
              ? `${duration} 分钟额度`
              : `窗口 ${idx + 1}`
        parseEntry(`limit:${idx}`, name, detail)
      })
    }

    return {
      providerId: target.id,
      kind: 'subscription',
      plan: 'Kimi Code',
      windows,
      fetchedAt: Date.now(),
      sourceLabel: 'Kimi Code 订阅'
    }
  }

  private async fetchAnthropicOAuthQuota(
    target: QuotaTargetProvider,
    previous?: AgentProviderQuota
  ): Promise<AgentProviderQuota> {
    const token = await this.resolveToken(target.id)
    if (!token) throw new Error('未找到 Claude OAuth 凭据')
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'user-agent': 'claude-code/2.1.0'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      if (res.status === 429) {
        return this.preserveStaleOnError(
          target,
          new Error('Anthropic 额度接口触发限流（429），请稍后再刷新'),
          previous
        )
      }
      throw new Error(`Claude 额度接口返回 ${res.status}`)
    }
    const data = (await res.json()) as Record<
      string,
      { utilization?: number; resets_at?: string } | null | undefined
    >
    const windows: AgentQuotaWindow[] = []
    const buckets: Array<[string, string]> = [
      ['five_hour', '5 小时额度'],
      ['seven_day', '7 天额度'],
      ['seven_day_opus', 'Opus 7 天'],
      ['seven_day_sonnet', 'Sonnet 7 天']
    ]
    for (const [key, label] of buckets) {
      const bucket = data[key]
      if (!bucket || typeof bucket.utilization !== 'number') continue
      const used = clampPct(bucket.utilization)
      windows.push({
        id: key,
        name: label,
        usedPercent: used,
        remainingPercent: clampPct(100 - used),
        resetsAt: toEpochMs(bucket.resets_at)
      })
    }
    return {
      providerId: target.id,
      kind: 'subscription',
      plan: 'Claude Pro/Max',
      windows,
      fetchedAt: Date.now(),
      sourceLabel: 'Claude OAuth 订阅'
    }
  }

  private async fetchKnownVendorQuota(
    target: QuotaTargetProvider,
    apiKey: string
  ): Promise<AgentProviderQuota | null> {
    const host = hostOf(target.baseUrl)

    // DeepSeek
    if (host === 'api.deepseek.com' || target.id === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`DeepSeek 余额接口返回 ${res.status}`)
      const data = (await res.json()) as {
        balance_infos?: Array<{ currency?: string; total_balance?: string | number }>
      }
      const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
      const parts = infos
        .map((i) => {
          const val = numVal(i.total_balance)
          return val !== undefined ? formatMoney(currencySign(i.currency), val) : null
        })
        .filter((x): x is string => Boolean(x))
      return {
        providerId: target.id,
        kind: 'balance',
        balanceText: parts.join(' · ') || '¥0.00',
        windows: [],
        fetchedAt: Date.now(),
        sourceLabel: 'DeepSeek 余额'
      }
    }

    // Moonshot
    if (host === 'api.moonshot.cn' || host === 'api.moonshot.ai' || target.id.startsWith('moonshotai')) {
      const endpointHost = host === 'api.moonshot.ai' ? 'api.moonshot.ai' : 'api.moonshot.cn'
      const sign = endpointHost.endsWith('.ai') ? '$' : '¥'
      const res = await fetch(`https://${endpointHost}/v1/users/me/balance`, {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`Moonshot 余额接口返回 ${res.status}`)
      const data = (await res.json()) as { data?: { available_balance?: unknown } }
      const val = numVal(data.data?.available_balance)
      if (val === undefined) throw new Error('Moonshot 未返回可用余额')
      return {
        providerId: target.id,
        kind: 'balance',
        balanceText: formatMoney(sign, val),
        windows: [],
        fetchedAt: Date.now(),
        sourceLabel: 'Moonshot 余额'
      }
    }

    // OpenRouter
    if (host === 'openrouter.ai' || target.id === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`OpenRouter 余额接口返回 ${res.status}`)
      const data = (await res.json()) as { data?: { total_credits?: unknown; total_usage?: unknown } }
      const credits = numVal(data.data?.total_credits)
      if (credits === undefined) throw new Error('OpenRouter 未返回额度数据')
      const used = numVal(data.data?.total_usage) ?? 0
      return {
        providerId: target.id,
        kind: 'balance',
        balanceText: formatMoney('$', credits - used),
        windows: [],
        fetchedAt: Date.now(),
        sourceLabel: 'OpenRouter 余额'
      }
    }

    // Zhipu / Z.ai (Coding Plan or Pay-as-you-go)
    if (host === 'open.bigmodel.cn' || host === 'api.z.ai' || target.id === 'zai' || target.id === 'zai-coding-cn') {
      const apiHost = host === 'api.z.ai' || target.id === 'zai' ? 'api.z.ai' : 'open.bigmodel.cn'
      const isCoding = Boolean(target.baseUrl?.includes('/api/coding/')) || target.id === 'zai-coding-cn'
      if (isCoding) {
        const res = await fetch(`https://${apiHost}/api/monitor/usage/quota/limit`, {
          headers: { accept: 'application/json', authorization: apiKey },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        if (!res.ok) throw new Error(`智谱套餐额度接口返回 ${res.status}`)
        const data = (await res.json()) as {
          success?: boolean
          msg?: string
          data?: {
            level?: string
            limits?: Array<{
              type?: string
              unit?: number
              number?: number
              percentage?: number
              nextResetTime?: number
            }>
          }
        }
        if (data.success === false || !data.data) {
          throw new Error(data.msg || '未获取到智谱套餐额度')
        }
        const windows: AgentQuotaWindow[] = (data.data.limits ?? []).map((l, idx) => {
          const used = typeof l.percentage === 'number' ? clampPct(l.percentage) : 0
          let name = '周期额度'
          if (l.type?.toUpperCase() === 'TIME_LIMIT') name = 'MCP · 月度'
          else if (l.unit === 3) name = `${l.number && l.number > 0 ? l.number : 5} 小时额度`
          else if (l.unit === 6) name = '7 天额度'
          return {
            id: `zhipu:${idx}`,
            name,
            usedPercent: used,
            remainingPercent: clampPct(100 - used),
            resetsAt: toEpochMs(l.nextResetTime)
          }
        })
        return {
          providerId: target.id,
          kind: 'plan',
          plan: data.data.level ? `GLM ${data.data.level.toUpperCase()}` : 'GLM Coding Plan',
          windows,
          fetchedAt: Date.now(),
          sourceLabel: '智谱 Coding Plan'
        }
      }

      const res = await fetch(`https://${apiHost}/api/biz/account/query-customer-account-report`, {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`智谱余额接口返回 ${res.status}`)
      const data = (await res.json()) as { data?: { availableBalance?: unknown } }
      const bal = numVal(data.data?.availableBalance)
      if (bal === undefined) throw new Error('未获取到智谱余额')
      return {
        providerId: target.id,
        kind: 'balance',
        balanceText: formatMoney(apiHost === 'api.z.ai' ? '$' : '¥', bal),
        windows: [],
        fetchedAt: Date.now(),
        sourceLabel: '智谱账户余额'
      }
    }

    // MiniMax Coding Plan
    if (
      host === 'api.minimaxi.com' ||
      host === 'api.minimax.cn' ||
      host === 'api.minimax.io' ||
      target.id === 'minimax' ||
      target.id === 'minimax-cn'
    ) {
      const apiHost = host || (target.id === 'minimax-cn' ? 'api.minimaxi.com' : 'api.minimax.io')
      const res = await fetch(`https://${apiHost}/v1/token_plan/remains`, {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!res.ok) return null
      const data = (await res.json()) as {
        base_resp?: { status_code?: number }
        model_remains?: Array<{
          model_name?: string
          end_time?: number
          current_interval_remaining_percent?: number
          weekly_end_time?: number
          current_weekly_remaining_percent?: number
        }>
      }
      if (data.base_resp?.status_code !== 0 || !Array.isArray(data.model_remains) || data.model_remains.length === 0) {
        return null
      }
      const first = data.model_remains[0]
      const windows: AgentQuotaWindow[] = []
      if (typeof first.current_interval_remaining_percent === 'number') {
        const rem = clampPct(first.current_interval_remaining_percent)
        windows.push({
          id: 'minimax:5h',
          name: '5 小时额度',
          usedPercent: clampPct(100 - rem),
          remainingPercent: rem,
          resetsAt: toEpochMs(first.end_time)
        })
      }
      if (typeof first.current_weekly_remaining_percent === 'number') {
        const rem = clampPct(first.current_weekly_remaining_percent)
        windows.push({
          id: 'minimax:7d',
          name: '7 天额度',
          usedPercent: clampPct(100 - rem),
          remainingPercent: rem,
          resetsAt: toEpochMs(first.weekly_end_time)
        })
      }
      if (windows.length === 0) return null
      return {
        providerId: target.id,
        kind: 'plan',
        plan: 'MiniMax Token Plan',
        windows,
        fetchedAt: Date.now(),
        sourceLabel: 'MiniMax 套餐'
      }
    }

    // AiHubMix
    if (host === 'aihubmix.com') {
      const res = await fetch('https://aihubmix.com/dashboard/billing/remain', {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`AiHubMix 余额接口返回 ${res.status}`)
      const data = (await res.json()) as { total_available?: unknown; remain?: unknown }
      const val = numVal(data.total_available) ?? numVal(data.remain)
      if (val === undefined) throw new Error('AiHubMix 未返回可用余额')
      return {
        providerId: target.id,
        kind: 'balance',
        balanceText: formatMoney('$', val),
        windows: [],
        fetchedAt: Date.now(),
        sourceLabel: 'AiHubMix 余额'
      }
    }

    // Kimi Coding (API key fallback)
    if (host === 'api.kimi.com' && target.baseUrl?.includes('/coding')) {
      return await this.fetchKimiCodingQuota(target)
    }

    return null
  }

  private async fetchCustomBalanceUrl(
    target: QuotaTargetProvider,
    rawUrl: string,
    balancePath: string | undefined,
    apiKey: string
  ): Promise<AgentProviderQuota> {
    const resolvedUrl = rawUrl.replace(/\{key\}/g, encodeURIComponent(apiKey))
    const res = await fetch(resolvedUrl, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      throw new Error(`自定义额度接口返回 ${res.status}`)
    }
    const payload = (await res.json()) as unknown

    const sub2 = this.tryParseSub2ApiUsage(target.id, payload)
    if (sub2) return sub2

    const expr =
      balancePath?.trim() ||
      (resolvedUrl.endsWith('/api/usage/token')
        ? '$data.total_available / 500000'
        : resolvedUrl.endsWith('/v1/usage')
          ? '$remaining'
          : resolvedUrl.endsWith('/dashboard/billing/credit_grants')
            ? '$total_available'
            : '$data.balance')

    const amount = readBalanceByPath(payload, expr)
    if (amount === undefined) {
      throw new Error(`无法按路径 ${expr} 解析额度数值`)
    }
    return {
      providerId: target.id,
      kind: 'balance',
      balanceText: formatMoney('$', amount),
      windows: [],
      fetchedAt: Date.now(),
      sourceLabel: '自定义额度接口'
    }
  }

  private tryParseSub2ApiUsage(providerId: string, payload: unknown): AgentProviderQuota | null {
    if (!payload || typeof payload !== 'object') return null
    const rec = payload as {
      remaining?: unknown
      balance?: unknown
      unit?: string
      rate_limits?: Array<{ window?: string; limit?: unknown; used?: unknown; reset_at?: unknown }>
    }
    const windows: AgentQuotaWindow[] = []
    if (Array.isArray(rec.rate_limits)) {
      const windowNames: Record<string, string> = {
        '5h': '5 小时限额',
        '1d': '每日限额',
        '7d': '7 天限额'
      }
      for (const item of rec.rate_limits) {
        const limit = numVal(item.limit)
        const used = numVal(item.used)
        if (!limit || limit <= 0 || used === undefined) continue
        const pct = clampPct((Math.max(0, used) / limit) * 100)
        windows.push({
          id: `sub2:${item.window ?? windows.length}`,
          name: windowNames[item.window ?? ''] ?? (item.window || '周期限额'),
          usedPercent: pct,
          remainingPercent: clampPct(100 - pct),
          amount: Math.max(0, used),
          limit,
          unit: 'USD',
          resetsAt: toEpochMs(item.reset_at)
        })
      }
    }
    const rem = numVal(rec.remaining) ?? numVal(rec.balance)
    if (rem === undefined && windows.length === 0) return null
    return {
      providerId,
      kind: windows.length > 0 ? 'plan' : 'balance',
      balanceText: rem !== undefined ? formatMoney('$', rem) : undefined,
      windows,
      fetchedAt: Date.now(),
      sourceLabel: 'Sub2API 额度'
    }
  }

  private async probeRelayQuota(
    target: QuotaTargetProvider,
    apiKey: string
  ): Promise<AgentProviderQuota> {
    const origin = originOf(target.baseUrl)
    if (!origin) {
      return { providerId: target.id, kind: 'balance', windows: [], fetchedAt: Date.now() }
    }
    // Skip probing local loopback servers (Ollama / LM Studio / etc.)
    if (/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?$/i.test(origin)) {
      return { providerId: target.id, kind: 'balance', windows: [], fetchedAt: Date.now() }
    }

    const probeKey = `${origin}::${target.id}`
    const cachedProbe = this.probeCache.get(probeKey)
    if (cachedProbe) {
      const ttl = cachedProbe.endpointPath ? PROBE_HIT_TTL_MS : PROBE_MISS_TTL_MS
      if (Date.now() - cachedProbe.checkedAt < ttl) {
        if (!cachedProbe.endpointPath) {
          return {
            providerId: target.id,
            kind: 'balance',
            windows: [],
            fetchedAt: Date.now(),
            sourceLabel: '该网关未公开余额查询接口'
          }
        }
        return await this.fetchProbedEndpoint(target.id, origin + cachedProbe.endpointPath, apiKey)
      }
    }

    const candidates = ['/v1/usage', '/api/usage/token', '/dashboard/billing/credit_grants']
    for (const path of candidates) {
      try {
        const quota = await this.fetchProbedEndpoint(target.id, origin + path, apiKey)
        this.probeCache.set(probeKey, { endpointPath: path, checkedAt: Date.now() })
        return quota
      } catch {
        // try next standard relay endpoint
      }
    }

    this.probeCache.set(probeKey, { endpointPath: null, checkedAt: Date.now() })
    return {
      providerId: target.id,
      kind: 'balance',
      windows: [],
      fetchedAt: Date.now(),
      sourceLabel: '未探测到公开额度接口（可在编辑中自定义）'
    }
  }

  private async fetchProbedEndpoint(
    providerId: string,
    url: string,
    apiKey: string
  ): Promise<AgentProviderQuota> {
    const res = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const payload = (await res.json()) as unknown

    if (url.endsWith('/v1/usage')) {
      const parsed = this.tryParseSub2ApiUsage(providerId, payload)
      if (!parsed) throw new Error('非 Sub2API 额度格式')
      return parsed
    }

    if (url.endsWith('/api/usage/token')) {
      const rec = payload as { success?: boolean; data?: { total_available?: unknown; unlimited_quota?: boolean } }
      if (rec?.success === false || !rec?.data) throw new Error('非 New-API 额度格式')
      if (rec.data.unlimited_quota) {
        return {
          providerId,
          kind: 'balance',
          balanceText: '无限额度',
          windows: [{ id: 'newapi:unlimited', name: 'Token 额度', unlimited: true, text: '无限' }],
          fetchedAt: Date.now(),
          sourceLabel: 'New-API / One-API'
        }
      }
      const rawAvail = numVal(rec.data.total_available)
      if (rawAvail === undefined) throw new Error('缺少 total_available')
      return {
        providerId,
        kind: 'balance',
        balanceText: formatMoney('$', rawAvail / 500000),
        windows: [],
        fetchedAt: Date.now(),
        sourceLabel: 'New-API / One-API'
      }
    }

    // /dashboard/billing/credit_grants
    const avail = readBalanceByPath(payload, '$total_available')
    if (avail === undefined) throw new Error('缺少 total_available')
    return {
      providerId,
      kind: 'balance',
      balanceText: formatMoney('$', avail),
      windows: [],
      fetchedAt: Date.now(),
      sourceLabel: 'Billing Credits'
    }
  }
}
