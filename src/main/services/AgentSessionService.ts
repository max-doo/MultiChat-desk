import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile, unlink } from 'fs/promises'
import { createReadStream, existsSync } from 'fs'
import { createInterface } from 'readline'
import { join, dirname, basename, resolve } from 'path'
import { homedir } from 'os'
import type { WebContents } from 'electron'
import type Store from 'electron-store'
import type {
  createAgentSession as createAgentSessionFn,
  ModelRegistry as ModelRegistryType,
  ModelRuntime as ModelRuntimeType,
  SessionManager as SessionManagerType,
  SettingsManager as SettingsManagerType,
  AgentSession,
  AgentSessionEvent,
  ProviderModelConfig
} from '@earendil-works/pi-coding-agent'
import type { AnyModel, Model, Api, ThinkingLevel } from '@earendil-works/pi-ai'
import { PermissionEngine, type PermissionMode, type ApprovalRequest } from './PermissionEngine'
import { parseMode } from './permissionPolicy'
import { AgentResourceLoader } from './AgentResourceLoader'
import { excludedShellTools, shellEnvironmentPrompt, shellToolForPlatform, shellToolModifiers } from './shell'
import { createWebSearchTool } from './webSearchTool'
import { createImageGenTool } from './imageGenTool'
import { ShellTool } from './ShellTool'
import { CustomGatewayProvider, MAGPIE_PROVIDER, classifyGatewayFetchError } from './customGatewayProvider'
import { ModelCatalogEnricher } from './modelCatalogEnricher'
import { ProviderQuotaService, type QuotaTargetProvider } from './ProviderQuotaService'
import { ProviderAuthController } from './ProviderAuthController'
import { safeError, redactCredential } from './redact'
import { createContextCompressionExtension, DEFAULT_COMPRESSION_CONFIG, type CompressionConfig } from '../extensions/contextCompression'
import { createSystemPromptTrimExtension } from '../extensions/systemPromptTrim'
import type {
  AgentActiveModel,
  AgentAuthOperation,
  AgentAuthType,
  AgentContextUsage,
  AgentCustomGatewaySpec,
  AgentForkOrigin,
  AgentGatewayTestResult,
  AgentProvider,
  AgentProviderModel,
  AgentProviderQuota,
  AgentRuntimeSnapshot,
  AgentSessionStats,
  AgentSessionStatus,
  AgentThinkingLevel
} from '../../shared/types/agentRuntime'
import type {
  AgentFileSnapshot,
  AgentTurnFileChanges
} from '../../shared/types/agentRuntime'
import type { AgentFavoriteModel } from '../../shared/types/agentRuntime'
import { createHash } from 'crypto'
import {
  FILE_MUTATION_TOOLS,
  SHELL_TOOLS,
  UNKNOWN_SHELL_BASELINE_SHA1,
  captureBaselineWithContent,
  computeLineDiffCounts,
  diffWorkspaceMetadata,
  normalizeTrackedFilePath,
  resolveTrackedAbsolutePath,
  scanWorkspaceMetadata,
  type WorkspaceFileMeta
} from './agentFileChangeTracker'

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

interface PiModule {
  createAgentSession: typeof createAgentSessionFn
  ModelRegistry: typeof ModelRegistryType
  ModelRuntime: typeof ModelRuntimeType
  SessionManager: typeof SessionManagerType
  SettingsManager: typeof SettingsManagerType
}

export interface ActiveSessionEntry {
  session: AgentSession
  cwd: string
  permissionMode: PermissionMode
  modelId: string
  providerId: string
  createdAt: number
  updatedAt: number
  title?: string
  isRunning?: boolean
  pendingApprovalCount?: number
  unsubscribe: () => void
  turnFileChanges?: AgentTurnFileChanges
  fileChangeKeyMap?: Map<string, string>
  baselineContents?: Map<string, Buffer | null | undefined>
  /** Canonical displayPath → capture timestamp (ms) of the corresponding baseline,
   * used to order it against the pre-shell workspace scan. */
  baselineCapturedAt?: Map<string, number>
  /** toolCallId → canonical displayPath, populated in beforeToolCall so
   * tool_execution_end (which lacks `args`) can resolve the touched path. */
  pendingToolFiles?: Map<string, string>
  pendingCaptures?: Promise<unknown>[]
  /** Lightweight workspace metadata snapshot taken before the first non-read-only shell command in this user turn.
   * `undefined` = no non-read-only shell command yet; `null` = scan hit circuit breaker and was skipped. */
  preShellWorkspaceSnapshot?: Map<string, WorkspaceFileMeta> | null
  preShellScanStartedAt?: number
  shellWriteExecuted?: boolean
  /** Persist is async (blob writes); the renderer may query before it lands.
   * Track the in-flight write so getFileChanges can wait instead of returning null. */
  pendingFileChangePersist?: Promise<void>
  /** 1-based user-turn index (count of user messages in live transcript); persisted with the
   * file-change record so the renderer can pin the card to the right turn. */
  turnCounter?: number
}

export interface SessionListItem {
  id: string
  title: string
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

type LocalAgentEvent = { type: 'queue_cleared'; texts: string[] }

export interface ProviderListItem {
  providerId: string
  displayName: string
  configured: boolean
  authStatus?: { ok: boolean; error?: string }
  models: string[]
}

const STATUS_EVENTS = new Set([
  'message_end',
  'agent_end',
  'agent_settled',
  'compaction_start',
  'compaction_end',
  'thinking_level_changed',
  'model_select'
])

const COMPRESSION_STORE_KEY = 'agent_compression'

const CUSTOM_GATEWAYS_STORE_KEY = 'agent_custom_gateways'

const DISABLED_PROVIDERS_STORE_KEY = 'agent_disabled_providers'

const FAVORITE_MODELS_STORE_KEY = 'agent_favorite_models'

const RECENT_MODELS_STORE_KEY = 'agent_recent_models'

const RECENT_MODELS_LIMIT = 8
const MAX_IDLE_ACTIVE_SESSIONS = 4
const MESSAGE_UPDATE_THROTTLE_MS = 36
const SESSION_HEADER_PEEK_BYTES = 8192
const FORK_ORIGIN_CUSTOM_TYPE = 'multichat:fork_origin'

interface ForkOriginCustomData {
  parentSessionId?: string
  parentSessionTitle?: string
  forkAfterEntryId?: string
  forkedAt?: number
}

interface DiskSessionMeta {
  id: string
  filePath: string
  cwd: string
  name?: string
  firstMessage: string
  parentSessionPath?: string
  forkParentId?: string
  forkParentTitle?: string
  firstBranchMessage?: string
  messageCount: number
  createdAt: number
  updatedAt: number
  model?: string
}

interface SessionMetaCacheEntry {
  size: number
  mtimeMs: number
  meta: DiskSessionMeta | null
}

export type CustomGatewaySpec = AgentCustomGatewaySpec

export class AgentSessionService {
  private sessionsDir: string
  private agentDir: string
  private skillDirCandidates: string[]
  private permissionEngine: PermissionEngine
  private authController: ProviderAuthController
  private catalogEnricher: ModelCatalogEnricher
  private quotaService: ProviderQuotaService
  private defaultBaseUrls = new Map<string, string>()
  private pi: PiModule | null = null
  private modelRuntime: ModelRuntimeType | null = null
  private modelRegistry: ModelRegistryType | null = null
  private activeSessions = new Map<string, ActiveSessionEntry>()
  private sessionMetaCache = new Map<string, SessionMetaCacheEntry>()
  private sessionFilePathCache = new Map<string, string>()
  private pendingMessageUpdates = new Map<
    string,
    { event: AgentSessionEvent | LocalAgentEvent; timer: ReturnType<typeof setTimeout> }
  >()

  private defaultProvider = MAGPIE_PROVIDER.providerId
  private defaultModel = 'devin/swe-2'

  constructor(
    private store: Store<Record<string, unknown>>,
    private getWebContents: () => WebContents | null
  ) {
    const isDev = basename(store.path).includes('-dev')
    const baseDir = join(dirname(store.path), 'history', ...(isDev ? ['dev'] : []))
    this.sessionsDir = join(baseDir, 'agent-sessions')
    // Agent config lives in the app's own data directory (multichat/agent/),
    // not pi's default ~/.pi/agent — keeps credentials, models, settings and
    // global skills self-contained and portable-mode aware. `agentDir/skills`
    // is the global-skills root pi's loader scans automatically.
    this.agentDir = join(dirname(store.path), 'agent')
    // Optional extra global-skill roots the user can opt into. Presets follow
    // common agent-skill conventions; any custom absolute path is allowed.
    this.skillDirCandidates = [
      join(this.agentDir, 'skills'),
      join(homedir(), '.agents', 'skills'),
      join(homedir(), '.claude', 'skills'),
      join(homedir(), '.pi', 'agent', 'skills'),
      join(homedir(), '.mu', 'skills')
    ]

    this.permissionEngine = new PermissionEngine(
      store,
      (req: ApprovalRequest) => {
        this.sendApprovalRequest(req)
      },
      async () => {
        // Adapter for the AST helper: reuse pi's own shell detector and
        // translate {shell,args} → {exe,args}.
        await this.resolveShellConfigForPrompt()
        const cfg = this.piShellConfig
        // Fall back to the Windows-bundled powershell.exe when pi's detector
        // fails (no pwsh on PATH, dev env quirk) — AST helper must not die
        // just because the optional shell was undetected.
        const shell =
          cfg?.shell ||
          (process.platform === 'win32'
            ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
            : '/bin/sh')
        const args =
          cfg?.args ??
          (process.platform === 'win32'
            ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
            : ['-c'])
        if (!shell) throw new Error('shell unavailable')
        return { exe: shell, args }
      },
      [
        join(this.agentDir, 'auth.json'),
        join(this.agentDir, 'models.json'),
        this.store.path,
        join(dirname(this.store.path), 'Partitions')
      ]
    )
    this.authController = new ProviderAuthController(
      () => this.modelRuntime,
      (operation: AgentAuthOperation) => this.sendAuthOperation(operation)
    )
    this.catalogEnricher = new ModelCatalogEnricher(this.agentDir)
    this.quotaService = new ProviderQuotaService(
      this.agentDir,
      () => this.modelRuntime,
      (quota) => this.sendProviderQuotaUpdated(quota)
    )
  }

  private async getPi(): Promise<PiModule> {
    if (!this.pi) {
      const mod = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
        '@earendil-works/pi-coding-agent'
      )
      this.pi = {
        createAgentSession: mod.createAgentSession,
        ModelRegistry: mod.ModelRegistry,
        ModelRuntime: mod.ModelRuntime,
        SessionManager: mod.SessionManager,
        SettingsManager: mod.SettingsManager
      }
    }
    return this.pi
  }

  private compressionDir(): string {
    return join(this.agentDir, 'compression')
  }

  private buildCompressionExtensions() {
    const cfg = this.getCompressionConfig()
    return [createContextCompressionExtension(cfg, this.compressionDir()), createSystemPromptTrimExtension()]
  }

  private piShellConfig: { shell: string; args?: string[] } | null = null

  /**
   * Build a shell ToolDefinition whose exec goes through ShellTool so output
   * gets redacted before it reaches the model. `customTools` overrides the
   * built-in definition of the same name, so registering `powershell` here
   * replaces pi's default implementation while `tools`/`excludeTools` keep
   * the activation/exclusion shape unchanged.
   */
  private async shellCustomTool(cwd: string) {
    const mod = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
      '@earendil-works/pi-coding-agent'
    )
    const operations = ShellTool.createBashOperations(
      join(this.sessionsDir, 'shell-audit.log')
    )
    // createPowerShellToolDefinition returns a ToolDefinition specialized to the
    // shell schema; customTools expects the wider ToolDefinition<TSchema>, so
    // widen via `unknown`. Runtime behavior is unaffected.
    const definition = shellToolForPlatform() === 'powershell'
      ? mod.createPowerShellToolDefinition(cwd, { operations })
      : mod.createBashToolDefinition(cwd, { operations })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return definition as any
  }

  private async resolveShellConfigForPrompt(): Promise<void> {
    if (this.piShellConfig !== null) return
    try {
      const mod = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
        '@earendil-works/pi-coding-agent'
      )
      this.piShellConfig =
        shellToolForPlatform() === 'powershell' ? mod.getPowerShellConfig() : mod.getShellConfig()
    } catch {
      this.piShellConfig = { shell: '' }
    }
  }

  private resolveShellExecutable(): string | undefined {
    const shell = this.piShellConfig?.shell
    return shell ? shell : undefined
  }

  public async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true })

    const { ModelRuntime, ModelRegistry } = await this.getPi()

    this.modelRuntime = await ModelRuntime.create({
      authPath: join(this.agentDir, 'auth.json'),
      modelsPath: join(this.agentDir, 'models.json')
    })
    this.modelRegistry = new ModelRegistry(this.modelRuntime)

    this.defaultBaseUrls.clear()
    for (const provider of this.modelRuntime.getProviders()) {
      if (provider.baseUrl) {
        this.defaultBaseUrls.set(provider.id, provider.baseUrl)
      }
    }
    this.defaultBaseUrls.set(MAGPIE_PROVIDER.providerId, MAGPIE_PROVIDER.baseUrl)

    await this.ensureMagpieProvider()

    for (const spec of this.listCustomGateways()) {
      await this.registerCustomGateway(spec).catch(() => undefined)
    }
  }

  public listCustomGateways(): CustomGatewaySpec[] {
    const raw = this.store.get(CUSTOM_GATEWAYS_STORE_KEY)
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (item): item is CustomGatewaySpec =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as CustomGatewaySpec).providerId === 'string' &&
          typeof (item as CustomGatewaySpec).baseUrl === 'string'
      )
      .map((item) => {
        if (item.apiKey) redactCredential(item.apiKey)
        return item
      })
  }

  private createCustomGateway(spec: CustomGatewaySpec): CustomGatewayProvider {
    return new CustomGatewayProvider({
      providerId: spec.providerId,
      name: spec.name || spec.providerId,
      baseUrl: spec.baseUrl,
      api: spec.api ?? 'openai-completions',
      apiKey: spec.apiKey
    })
  }

  /**
   * Register or update a user-supplied gateway. Persists the spec so
   * the provider comes back on next launch. If `apiKey` is omitted (`undefined`)
   * when updating an existing custom gateway, the existing stored key is preserved.
   */
  public async addCustomGateway(spec: CustomGatewaySpec): Promise<void> {
    const id = spec.providerId.trim()
    if (!id) throw new Error('providerId 不能为空')
    if (id === MAGPIE_PROVIDER.providerId) throw new Error('该 providerId 已被内置占用')
    const existingList = this.listCustomGateways()
    const previous = existingList.find((item) => item.providerId === id)
    if (!previous && this.modelRuntime?.getProvider(id)) {
      throw new Error(`供应商 ID "${id}" 与内置供应商冲突，请换一个 ID`)
    }
    const resolvedKey = spec.apiKey === undefined ? previous?.apiKey : spec.apiKey.trim() || undefined
    if (resolvedKey) redactCredential(resolvedKey)
    const nextSpec: CustomGatewaySpec = {
      providerId: id,
      name: spec.name.trim() || id,
      baseUrl: spec.baseUrl.trim(),
      apiKey: resolvedKey,
      api: spec.api ?? previous?.api ?? 'openai-completions',
      presetId: spec.presetId ?? previous?.presetId,
      balanceUrl: spec.balanceUrl === undefined ? previous?.balanceUrl : spec.balanceUrl.trim() || undefined,
      balancePath: spec.balancePath === undefined ? previous?.balancePath : spec.balancePath.trim() || undefined
    }
    const list = existingList.filter((item) => item.providerId !== id)
    list.push(nextSpec)
    this.store.set(CUSTOM_GATEWAYS_STORE_KEY, list)
    this.quotaService.invalidate(id)
    await this.registerCustomGateway(nextSpec, { syncRemoteCatalog: true })
    this.sendRuntimeChanged('refresh')
  }

  public async removeCustomGateway(providerId: string): Promise<void> {
    const list = this.listCustomGateways().filter((item) => item.providerId !== providerId)
    this.store.set(CUSTOM_GATEWAYS_STORE_KEY, list)
    this.quotaService.invalidate(providerId)
    try {
      this.modelRegistry?.unregisterProvider(providerId)
    } catch {
      // ignore if already removed
    }
    const disabled = this.getDisabledProviderIds()
    if (disabled.delete(providerId)) {
      this.store.set(DISABLED_PROVIDERS_STORE_KEY, [...disabled])
    }
    this.store.set(
      FAVORITE_MODELS_STORE_KEY,
      [...this.getFavoriteModelKeys()].filter((k) => !k.startsWith(`${providerId}:`))
    )
    this.store.set(
      RECENT_MODELS_STORE_KEY,
      this.getRecentModelKeys().filter((k) => !k.startsWith(`${providerId}:`))
    )
    this.sendRuntimeChanged('refresh')
  }

  public async testGatewayConnection(spec: {
    providerId?: string
    name?: string
    baseUrl: string
    apiKey?: string
    api?: CustomGatewaySpec['api']
    balanceUrl?: string
    balancePath?: string
  }): Promise<AgentGatewayTestResult> {
    const baseUrl = spec.baseUrl.trim()
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return {
        ok: false,
        modelCount: 0,
        enrichedCount: 0,
        sampleModels: [],
        error: 'Base URL 需要以 http:// 或 https:// 开头'
      }
    }
    const providerId = spec.providerId?.trim() || 'preview-gateway'
    const previous = this.listCustomGateways().find((item) => item.providerId === providerId)
    const effectiveKey = spec.apiKey === undefined ? previous?.apiKey : spec.apiKey.trim() || undefined
    if (effectiveKey) redactCredential(effectiveKey)

    const gateway = new CustomGatewayProvider({
      providerId,
      name: spec.name?.trim() || providerId,
      baseUrl,
      api: spec.api ?? 'openai-completions',
      apiKey: effectiveKey
    })

    try {
      const rawModels = await gateway.fetchModels()
      const { models, enrichedCount } = await this.catalogEnricher.enrichModels(rawModels, {
        syncRemote: true
      })

      let quota: AgentProviderQuota | undefined
      if (effectiveKey || spec.balanceUrl) {
        quota = await this.quotaService
          .fetchForProvider(
            {
              id: providerId,
              name: spec.name?.trim() || providerId,
              baseUrl,
              configured: true,
              isCustom: true,
              customSpec: {
                providerId,
                name: spec.name?.trim() || providerId,
                baseUrl,
                apiKey: effectiveKey,
                api: spec.api,
                balanceUrl: spec.balanceUrl,
                balancePath: spec.balancePath
              }
            },
            { force: true }
          )
          .catch(() => undefined)
      }

      return {
        ok: true,
        modelCount: models.length,
        enrichedCount,
        sampleModels: models.slice(0, 6).map((m) => m.id),
        quota
      }
    } catch (err) {
      const classified = classifyGatewayFetchError(err, baseUrl)
      return {
        ok: false,
        modelCount: 0,
        enrichedCount: 0,
        sampleModels: [],
        error: classified.message,
        hint: classified.hint
      }
    }
  }

  private async registerCustomGateway(
    spec: CustomGatewaySpec,
    options?: { syncRemoteCatalog?: boolean }
  ): Promise<void> {
    if (!this.modelRegistry || !this.modelRuntime) return
    const gateway = this.createCustomGateway(spec)
    const stored = await gateway.loadStoredModels(this.agentDir)
    const { models: enrichedStored } = await this.catalogEnricher.enrichModels(stored)
    this.modelRegistry.registerProvider(spec.providerId, {
      name: spec.name || spec.providerId,
      baseUrl: gateway.registrationBaseUrl,
      apiKey: spec.apiKey ?? 'custom-gateway',
      api: gateway.api,
      models: enrichedStored
    })
    await this.modelRuntime.refresh({ allowNetwork: false, providers: [spec.providerId] })
    void gateway
      .fetchModels()
      .then((models) => this.applyGatewayCatalog(gateway, models, options?.syncRemoteCatalog))
      .catch(() => undefined)
  }

  private async ensureMagpieProvider(): Promise<void> {
    if (!this.modelRegistry || !this.modelRuntime) return
    const provider = MAGPIE_PROVIDER
    const registered = this.modelRuntime.getRegisteredProviderConfig(provider.providerId)
    if (!registered) {
      // Seed the catalog from the last persisted fetch so a cold start with
      // the gateway offline still exposes the full model list.
      const stored = await provider.loadStoredModels(this.agentDir)
      const initial = stored.length > 0 ? stored : provider.seedModels
      const { models: enrichedInitial } = await this.catalogEnricher.enrichModels(initial)
      this.modelRegistry.registerProvider(provider.providerId, {
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        models: enrichedInitial
      })
    }
    // registerProvider kicks off an async availability refresh; wait for it so
    // the first snapshot already reports the local models as usable.
    await this.modelRuntime.refresh({ allowNetwork: false, providers: [provider.providerId] })
    // Pull the live catalog in the background; failures keep the static
    // fallback above, so the gateway being down never blocks startup.
    void provider
      .fetchModels()
      .then((models) => this.applyGatewayCatalog(provider, models))
      .catch(() => undefined)
  }

  private async applyGatewayCatalog(
    provider: CustomGatewayProvider,
    models: ProviderModelConfig[],
    syncRemote = false
  ): Promise<void> {
    if (!this.modelRegistry || !this.modelRuntime || models.length === 0) return
    const { models: enriched } = await this.catalogEnricher.enrichModels(models, {
      syncRemote
    })
    // 本次 fetch 拿到的目录是权威的：刷新前先修剪收藏/最近中已消失的模型，
    // 防止目录被覆盖后死键永久残留。
    this.pruneCatalogedKeys(provider.providerId, new Set(enriched.map((m) => m.id)))
    this.modelRegistry.registerProvider(provider.providerId, {
      name: provider.name,
      baseUrl: provider.registrationBaseUrl,
      apiKey: provider.apiKey,
      api: provider.api,
      models: enriched
    })
    await this.modelRuntime.refresh({ allowNetwork: false, providers: [provider.providerId] })
    await provider.persistModels(this.agentDir, enriched).catch(() => undefined)
    this.sendRuntimeChanged('refresh')
  }

  private sendApprovalRequest(request: ApprovalRequest): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:approval-request', request)
    }
  }

  private emitEventImmediate(sessionId: string, event: AgentSessionEvent | LocalAgentEvent): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:event', { sessionId, event })
      if (typeof event.type === 'string' && STATUS_EVENTS.has(event.type)) {
        const status = this.getSessionStatus(sessionId)
        if (status) {
          wc.send('agent:session-status', { sessionId, status })
        }
      }
    }
  }

  private flushPendingMessageUpdate(sessionId: string): void {
    const pending = this.pendingMessageUpdates.get(sessionId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingMessageUpdates.delete(sessionId)
    this.emitEventImmediate(sessionId, pending.event)
  }

  private clearPendingMessageUpdate(sessionId: string): void {
    const pending = this.pendingMessageUpdates.get(sessionId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingMessageUpdates.delete(sessionId)
  }

  private forwardEvent(sessionId: string, event: AgentSessionEvent | LocalAgentEvent): void {
    this.writeEventTimeline(sessionId, event)
    if (event.type === 'message_update') {
      const existing = this.pendingMessageUpdates.get(sessionId)
      if (existing) {
        existing.event = event
        return
      }
      const buffered = {
        event,
        timer: setTimeout(() => {
          const current = this.pendingMessageUpdates.get(sessionId)
          if (current !== buffered) return
          this.pendingMessageUpdates.delete(sessionId)
          this.emitEventImmediate(sessionId, buffered.event)
        }, MESSAGE_UPDATE_THROTTLE_MS)
      }
      this.pendingMessageUpdates.set(sessionId, buffered)
      return
    }

    this.flushPendingMessageUpdate(sessionId)
    this.emitEventImmediate(sessionId, event)
  }

  /**
   * 事件时间线诊断日志：仅在 MM_AGENT_EVENTLOG=1 时启用，追加写入
   * sessionsDir/<sessionId>/event-timeline.jsonl。用于排查"工具运行中 UI
   * 却显示成功/停止闪烁"这类 message_end 时序与内容形态问题——重点记录
   * assistant message_end 是否携带 toolCall、以及 tool 事件的相对顺序。
   */
  private writeEventTimeline(sessionId: string, event: AgentSessionEvent | LocalAgentEvent): void {
    if (process.env.MM_AGENT_EVENTLOG !== '1') return
    if (event.type === 'message_update') return
    const entry: Record<string, unknown> = {
      t: Date.now(),
      type: event.type
    }
    const msg = (event as { message?: { role?: string; content?: unknown } }).message
    if (msg?.role) {
      entry.role = msg.role
      if (Array.isArray(msg.content)) {
        entry.parts = (msg.content as Array<{ type?: string; id?: string; name?: string }>).map((p) =>
          p?.type === 'toolCall' ? `toolCall:${p.name}:${p.id ? 'id' : 'noid'}` : String(p?.type)
        )
      }
    }
    const toolName = (event as { toolName?: string }).toolName
    if (toolName) entry.tool = toolName
    if ((event as { isError?: boolean }).isError !== undefined) entry.isError = Boolean((event as { isError?: boolean }).isError)
    const line = JSON.stringify(entry) + '\n'
    const filePath = join(this.sessionsDir, sessionId, 'event-timeline.jsonl')
    void mkdir(dirname(filePath), { recursive: true })
      .then(() => writeFile(filePath, line, { flag: 'a' }))
      .catch(() => undefined)
  }

  private sendAuthOperation(operation: AgentAuthOperation): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:provider-auth-changed', { operation })
    }
  }

  private sendRuntimeChanged(reason: 'login' | 'logout' | 'refresh' | 'model'): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:runtime-changed', { reason })
    }
  }

  private extractUserText(content: unknown): string {
    if (typeof content === 'string') return content.trim()
    if (!Array.isArray(content)) return ''
    const text = content
      .filter((part): part is { type: 'text'; text: string } =>
        !!part && typeof part === 'object' && (part as { type?: string }).type === 'text')
      .map((part) => part.text)
      .join('')
      .trim()
    return text
  }

  private async captureFileSnapshot(absolutePath: string): Promise<AgentFileSnapshot> {
    try {
      const info = await stat(absolutePath)
      const content = await readFile(absolutePath)
      const sha1 = createHash('sha1').update(content).digest('hex')
      return { path: absolutePath, mtimeMs: info.mtimeMs, size: info.size, sha1 }
    } catch {
      return { path: absolutePath, mtimeMs: null, size: null, sha1: null }
    }
  }

  private fileChangesDir(sessionId: string): string {
    return join(this.sessionsDir, sessionId, 'file-changes')
  }

  private getLiveUserTurnCount(active: ActiveSessionEntry): number {
    const msgs = active.session.agent.state.messages as Array<{ role?: string }>
    return msgs.filter((m) => m.role === 'user').length
  }

  private resetTurnFileChangeState(active: ActiveSessionEntry, turnCounter?: number): void {
    active.turnCounter = turnCounter ?? this.getLiveUserTurnCount(active)
    active.turnFileChanges = { files: [], baseline: {}, target: {}, status: 'applied' }
    active.fileChangeKeyMap = new Map()
    active.baselineContents = new Map()
    active.baselineCapturedAt = new Map()
    active.pendingToolFiles = new Map()
    active.pendingCaptures = []
    active.preShellWorkspaceSnapshot = undefined
    active.preShellScanStartedAt = undefined
    active.shellWriteExecuted = false
  }

  private ensureTurnFileChangeState(active: ActiveSessionEntry): AgentTurnFileChanges {
    if (!active.turnFileChanges) {
      this.resetTurnFileChangeState(active)
    } else if (!active.turnCounter) {
      const count = this.getLiveUserTurnCount(active)
      if (count > 0) active.turnCounter = count
    }
    return active.turnFileChanges!
  }

  /**
   * Drain the active user-turn accumulator, merge any workspace changes from
   * non-read-only shell commands, filter out no-op / failed edits, compute
   * net line diffs, and persist the latest turn's record + blobs.
   */
  private scheduleFinalizeTurnFileChanges(sessionId: string, active: ActiveSessionEntry): void {
    const tfc = active.turnFileChanges
    const pending = active.pendingCaptures ?? []
    const keyMap = active.fileChangeKeyMap ?? new Map<string, string>()
    const baselineContents = active.baselineContents ?? new Map<string, Buffer | null | undefined>()
    const baselineCapturedAt = active.baselineCapturedAt ?? new Map<string, number>()
    const preShell = active.preShellWorkspaceSnapshot
    const preShellScanStartedAt = active.preShellScanStartedAt
    const shellWriteExecuted = Boolean(active.shellWriteExecuted)
    const turnIdx = active.turnCounter || this.getLiveUserTurnCount(active)
    const cwd = active.cwd

    active.turnFileChanges = undefined
    active.fileChangeKeyMap = undefined
    active.baselineContents = undefined
    active.baselineCapturedAt = undefined
    active.pendingToolFiles = undefined
    active.pendingCaptures = undefined
    active.preShellWorkspaceSnapshot = undefined
    active.preShellScanStartedAt = undefined
    active.shellWriteExecuted = false

    const hasTrackedWork =
      Boolean(tfc && (tfc.files.length > 0 || pending.length > 0)) ||
      (shellWriteExecuted && preShell instanceof Map)
    if (!hasTrackedWork) return

    const finalTfc: AgentTurnFileChanges = tfc ?? {
      files: [],
      baseline: {},
      target: {},
      status: 'applied'
    }

    const prevPersist = active.pendingFileChangePersist ?? Promise.resolve()
    active.pendingFileChangePersist = prevPersist
      .catch(() => undefined)
      .then(async () => {
        if (pending.length > 0) {
          await Promise.race([
            Promise.all(pending),
            new Promise<unknown[]>((r) => setTimeout(() => r([]), 1500))
          ])
        }
        await this.finalizeAndPersistFileChanges(
          sessionId,
          cwd,
          finalTfc,
          keyMap,
          baselineContents,
          baselineCapturedAt,
          shellWriteExecuted ? preShell ?? null : null,
          preShellScanStartedAt,
          turnIdx > 0 ? turnIdx : undefined
        )
      })
      .then(() => undefined)
      .catch(() => undefined)
  }

  private async finalizeAndPersistFileChanges(
    sessionId: string,
    cwd: string,
    tfc: AgentTurnFileChanges,
    keyMap: Map<string, string>,
    baselineContents: Map<string, Buffer | null | undefined>,
    baselineCapturedAt: Map<string, number>,
    preShell: Map<string, WorkspaceFileMeta> | null,
    preShellScanStartedAt: number | undefined,
    turnIndex?: number
  ): Promise<void> {
    const resolvedCwd = resolve(cwd)

    if (preShell) {
      const postShell = await scanWorkspaceMetadata(resolvedCwd, { captureContent: false })
      if (postShell) {
        const diff = diffWorkspaceMetadata(preShell, postShell)

        // Derive the pre-turn baseline for a scan-relative path from the
        // pre-shell scan. Returns revertible content when the scan captured
        // the file bytes; otherwise marks the baseline unknown (never guesses).
        const scanBaseline = (
          relPath: string,
          absPath: string
        ): { snapshot: AgentFileSnapshot; content: Buffer | null | undefined; revertible: boolean } => {
          const preMeta = preShell.get(relPath)
          if (!preMeta) {
            return {
              snapshot: { path: absPath, mtimeMs: null, size: null, sha1: null },
              content: null,
              revertible: true
            }
          }
          if (preMeta.content instanceof Buffer) {
            return {
              snapshot: {
                path: absPath,
                mtimeMs: preMeta.mtimeMs,
                size: preMeta.size,
                sha1: createHash('sha1').update(preMeta.content).digest('hex')
              },
              content: preMeta.content,
              revertible: true
            }
          }
          return {
            snapshot: {
              path: absPath,
              mtimeMs: preMeta.mtimeMs,
              size: preMeta.size,
              sha1: UNKNOWN_SHELL_BASELINE_SHA1
            },
            content: undefined,
            revertible: false
          }
        }

        const handleShellPath = async (
          relPath: string,
          kind: 'added' | 'modified' | 'deleted'
        ): Promise<void> => {
          const norm = normalizeTrackedFilePath(resolvedCwd, relPath)
          const existingDisplay = keyMap.get(norm.key)
          if (existingDisplay) {
            // Already tracked by an explicit file tool in this turn — refresh target snapshot
            // in case a subsequent shell command modified or deleted the same file.
            tfc.target[existingDisplay] = await this.captureFileSnapshot(norm.absPath)

            // Decide whether the captured edit baseline predates the shell scan.
            // Baselines captured before the scan started are by definition the
            // pre-turn state. Baselines captured after the scan may have read
            // content already rewritten by a shell command — trusting them
            // would silently keep shell modifications across a revert, so
            // fall back to scan content when available, or block the revert.
            const capturedAt = baselineCapturedAt.get(existingDisplay)
            const predatesScan =
              capturedAt !== undefined &&
              preShellScanStartedAt !== undefined &&
              capturedAt < preShellScanStartedAt
            if (!predatesScan && kind !== 'added') {
              const fromScan = scanBaseline(relPath, norm.absPath)
              const filesEntry = tfc.files.find((f) => f.path === existingDisplay)
              if (fromScan.revertible && fromScan.content !== undefined) {
                tfc.baseline[existingDisplay] = fromScan.snapshot
                baselineContents.set(existingDisplay, fromScan.content)
              } else if (filesEntry) {
                filesEntry.noBaselineBlob = true
              }
            }
            return
          }

          keyMap.set(norm.key, norm.displayPath)
          if (kind === 'added') {
            tfc.baseline[norm.displayPath] = {
              path: norm.absPath,
              mtimeMs: null,
              size: null,
              sha1: null
            }
            baselineContents.set(norm.displayPath, null)
            tfc.target[norm.displayPath] = await this.captureFileSnapshot(norm.absPath)
            tfc.files.push({
              path: norm.displayPath,
              name: norm.name,
              isNew: true,
              added: 0,
              deleted: 0
            })
          } else if (kind === 'deleted') {
            const fromScan = scanBaseline(relPath, norm.absPath)
            tfc.baseline[norm.displayPath] = fromScan.snapshot
            baselineContents.set(norm.displayPath, fromScan.content)
            tfc.target[norm.displayPath] = {
              path: norm.absPath,
              mtimeMs: null,
              size: null,
              sha1: null
            }
            tfc.files.push({
              path: norm.displayPath,
              name: norm.name,
              isNew: false,
              isDeleted: true,
              ...(fromScan.revertible ? {} : { noBaselineBlob: true }),
              added: 0,
              deleted: 0
            })
          } else {
            const snap = await this.captureFileSnapshot(norm.absPath)
            if (snap.sha1 === null) return
            const fromScan = scanBaseline(relPath, norm.absPath)
            tfc.baseline[norm.displayPath] = fromScan.snapshot
            baselineContents.set(norm.displayPath, fromScan.content)
            tfc.target[norm.displayPath] = snap
            tfc.files.push({
              path: norm.displayPath,
              name: norm.name,
              isNew: false,
              ...(fromScan.revertible ? {} : { noBaselineBlob: true }),
              added: 0,
              deleted: 0
            })
          }
        }

        for (const p of diff.added) await handleShellPath(p, 'added')
        for (const p of diff.modified) await handleShellPath(p, 'modified')
        for (const p of diff.deleted) await handleShellPath(p, 'deleted')
      }
    }

    const finalFiles: AgentTurnFileChanges['files'] = []
    const finalBaseline: Record<string, AgentFileSnapshot> = {}
    const finalTarget: Record<string, AgentFileSnapshot> = {}
    const targetContents = new Map<string, Buffer | null>()

    for (const entry of tfc.files) {
      const baseSnap = tfc.baseline[entry.path]
      if (!baseSnap) continue
      const abs = resolveTrackedAbsolutePath(resolvedCwd, entry.path)
      const targetSnap = tfc.target[entry.path] ?? (await this.captureFileSnapshot(abs))

      if (baseSnap.sha1 === targetSnap.sha1) continue

      const isNew = baseSnap.sha1 === null && targetSnap.sha1 !== null
      const isDeleted = baseSnap.sha1 !== null && targetSnap.sha1 === null

      let afterBuf: Buffer | null = null
      if (!isDeleted) {
        try {
          afterBuf = await readFile(abs)
        } catch {
          afterBuf = null
        }
      }
      targetContents.set(entry.path, afterBuf)

      const beforeBuf = baselineContents.get(entry.path)
      const counts =
        beforeBuf !== undefined
          ? computeLineDiffCounts(beforeBuf, afterBuf)
          : { added: entry.added, deleted: entry.deleted }

      finalBaseline[entry.path] = baseSnap
      finalTarget[entry.path] = targetSnap
      finalFiles.push({
        path: entry.path,
        name: entry.name,
        isNew,
        ...(isDeleted ? { isDeleted: true } : {}),
        ...(entry.noBaselineBlob ? { noBaselineBlob: true } : {}),
        added: counts.added,
        deleted: counts.deleted
      })
    }

    if (finalFiles.length === 0) return

    const finalRecord: AgentTurnFileChanges = {
      turnIndex: turnIndex ?? tfc.turnIndex,
      files: finalFiles,
      baseline: finalBaseline,
      target: finalTarget,
      status: 'applied'
    }

    await this.persistFileChanges(sessionId, resolvedCwd, finalRecord, baselineContents, targetContents)
  }

  private async persistFileChanges(
    sessionId: string,
    cwd: string,
    tfc: AgentTurnFileChanges,
    baselineContents: Map<string, Buffer | null | undefined>,
    targetContents: Map<string, Buffer | null>
  ): Promise<void> {
    const resolvedCwd = resolve(cwd)
    const dir = this.fileChangesDir(sessionId)
    // Only keep the latest turn's blobs — clear stale blobs from earlier turns
    // so an old `.before` file can never be reused for a newer edit.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(dir, { recursive: true })

    const blobName = (path: string, kind: 'before' | 'after'): string =>
      `${createHash('sha1').update(path).digest('hex').slice(0, 16)}.${kind}`

    const blobs: Record<string, string> = {}
    await Promise.all(
      tfc.files.map(async (file) => {
        const beforeBuf = baselineContents.get(file.path)
        if (beforeBuf instanceof Buffer) {
          const name = blobName(file.path, 'before')
          await writeFile(join(dir, name), beforeBuf)
          blobs[`baseline:${file.path}`] = name
        }

        const afterBuf = targetContents.get(file.path)
        if (afterBuf instanceof Buffer) {
          const name = blobName(file.path, 'after')
          await writeFile(join(dir, name), afterBuf)
          blobs[`target:${file.path}`] = name
        }
      })
    )

    const metaPath = join(dir, 'index.json')
    const meta = {
      cwd: resolvedCwd,
      turnIndex: tfc.turnIndex,
      files: tfc.files,
      baseline: tfc.baseline,
      target: tfc.target,
      status: tfc.status,
      blobs,
      updatedAt: Date.now()
    }
    await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  }

  private async loadFileChanges(
    sessionId: string
  ): Promise<
    | (AgentTurnFileChanges & { cwd?: string; blobs?: Record<string, string> })
    | null
  > {
    try {
      const raw = await readFile(join(this.fileChangesDir(sessionId), 'index.json'), 'utf8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  private async readBlob(sessionId: string, name: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.fileChangesDir(sessionId), name))
    } catch {
      return null
    }
  }

  private async snapshotMatches(snapshot: AgentFileSnapshot, absolutePath: string): Promise<boolean> {
    const current = await this.captureFileSnapshot(absolutePath)
    if (snapshot.sha1 === null) return current.sha1 === null
    if (current.sha1 === null) return false
    return current.sha1 === snapshot.sha1
  }

  /**
   * Crash-atomic file write: the content first lands in a sibling temp file,
   * then a same-directory rename atomically replaces the target. On Windows,
   * renaming over an existing file is atomic, so a crash mid-operation can
   * never leave the user's file half-written — it is either fully old or
   * fully new.
   */
  private async atomicWriteFile(absolutePath: string, content: Buffer): Promise<void> {
    await mkdir(dirname(absolutePath), { recursive: true })
    const tmp = `${absolutePath}.multichat-revert-${process.pid}-${Date.now()}.tmp`
    try {
      await writeFile(tmp, content)
      await rename(tmp, absolutePath)
    } catch (err) {
      await unlink(tmp).catch(() => undefined)
      throw err
    }
  }

  private async waitForFileChangePersist(sessionId: string): Promise<void> {
    const pending = this.activeSessions.get(sessionId)?.pendingFileChangePersist
    if (pending) {
      await Promise.race([pending, new Promise<void>((r) => setTimeout(r, 3000))])
    }
  }


  public async getFileChanges(sessionId: string): Promise<AgentTurnFileChanges | null> {
    // Persist happens asynchronously after turn_end/agent_end; wait for the
    // in-flight write before reading, otherwise the renderer's mount-time query
    // races ahead of the disk write and the card never shows.
    await this.waitForFileChangePersist(sessionId)
    const meta = await this.loadFileChanges(sessionId)
    if (!meta) return null
    const { blobs: _blobs, ...rest } = meta
    return rest
  }

  public async checkFilesStale(
    sessionId: string,
    paths: string[],
    kind: 'baseline' | 'target'
  ): Promise<Record<string, boolean>> {
    const meta = await this.loadFileChanges(sessionId)
    const cwd = meta?.cwd ?? this.activeSessions.get(sessionId)?.cwd ?? ''
    const snapshots =
      kind === 'baseline' ? meta?.baseline ?? {} : meta?.target ?? {}
    const result: Record<string, boolean> = {}
    for (const p of paths) {
      const snap = snapshots[p]
      if (!snap) {
        result[p] = false
        continue
      }
      const abs = resolveTrackedAbsolutePath(cwd, p)
      result[p] = !(await this.snapshotMatches(snap, abs))
    }
    return result
  }

  public async revertFileChanges(sessionId: string): Promise<string | null> {
    const active = this.activeSessions.get(sessionId)
    if (active?.isRunning) {
      return '任务正在运行，无法安全撤销，请先停止'
    }
    await this.waitForFileChangePersist(sessionId)
    const meta = await this.loadFileChanges(sessionId)
    if (!meta || meta.files.length === 0) return '没有可撤销的文件修改'
    if (meta.status === 'undone') return '本次修改已被撤销'
    if (meta.files.some((f) => f.noBaselineBlob)) {
      return '包含通过命令修改或超大文件，缺少修改前基线快照，无法安全撤销'
    }
    const rawCwd = meta.cwd ?? active?.cwd ?? ''
    const cwd = rawCwd ? resolve(rawCwd) : ''
    if (!cwd) return '无法确定工作目录'

    // Validate every file first, then apply. Files may legitimately already
    // match their baseline (user reverted one manually, or a previous attempt
    // failed partway) — treating that as satisfied instead of a conflict keeps
    // retries idempotent and prevents a partial failure from deadlocking the
    // user out of ever completing the revert.
    interface PlannedWrite {
      file: (typeof meta.files)[number]
      abs: string
      kind: 'write' | 'delete' | 'noop'
      content?: Buffer
    }
    const plan: PlannedWrite[] = []
    const blockers: string[] = []
    for (const file of meta.files) {
      const target = meta.target[file.path]
      const abs = resolveTrackedAbsolutePath(cwd, file.path)
      if (!target) {
        // A file without its post-turn snapshot cannot be validated against
        // the "unchanged since the turn" invariant — fail closed.
        blockers.push(`"${file.name}" 缺少修改后快照`)
        continue
      }
      const current = await this.captureFileSnapshot(abs)
      const baseline = meta.baseline[file.path]
      const baselineSha = baseline?.sha1 ?? null
      if (current.sha1 === target.sha1) {
        if (baselineSha === null) {
          plan.push({ file, abs, kind: 'delete' })
        } else {
          const blobName = meta.blobs?.[`baseline:${file.path}`]
          const content = blobName ? await this.readBlob(sessionId, blobName) : null
          if (content === null) {
            blockers.push(`缺少 "${file.name}" 的基线快照`)
            continue
          }
          plan.push({ file, abs, kind: 'write', content })
        }
        continue
      }
      if (current.sha1 === baselineSha) {
        plan.push({ file, abs, kind: 'noop' })
        continue
      }
      blockers.push(`文件 "${file.name}" 在此期间被外部修改`)
    }
    if (blockers.length > 0) {
      return `${blockers[0]}${blockers.length > 1 ? ` 等 ${blockers.length} 处问题` : ''}，无法安全撤销`
    }

    // Each write is crash-atomic (temp + rename); failures are collected per
    // file so the user sees exactly what failed and can retry — idempotent
    // validation above guarantees a retry is never deadlocked by files that
    // already reverted.
    const failures: string[] = []
    for (const item of plan) {
      try {
        if (item.kind === 'noop') continue
        if (item.kind === 'delete') {
          await unlink(item.abs).catch(() => undefined)
          continue
        }
        await this.atomicWriteFile(item.abs, item.content!)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(`"${item.file.name}": ${msg}`)
      }
    }
    if (failures.length > 0) {
      return `部分文件撤销失败（${failures[0]}${failures.length > 1 ? ` 等 ${failures.length} 处` : ''}）。已成功的文件保持撤销状态，修复后可重试`
    }

    meta.status = 'undone'
    await writeFile(
      join(this.fileChangesDir(sessionId), 'index.json'),
      JSON.stringify(meta, null, 2),
      'utf8'
    )
    return null
  }

  public async reapplyFileChanges(sessionId: string): Promise<string | null> {
    const active = this.activeSessions.get(sessionId)
    if (active?.isRunning) {
      return '任务正在运行，无法安全恢复，请先停止'
    }
    await this.waitForFileChangePersist(sessionId)
    const meta = await this.loadFileChanges(sessionId)
    if (!meta || meta.files.length === 0) return '没有可恢复的文件修改'
    if (meta.status !== 'undone') return '本次修改尚未撤销'
    const rawCwd = meta.cwd ?? active?.cwd ?? ''
    const cwd = rawCwd ? resolve(rawCwd) : ''
    if (!cwd) return '无法确定工作目录'

    // Validate first, then apply — same idempotent semantics as revert:
    // files already at target count as satisfied so partial retries complete.
    interface PlannedWrite {
      file: (typeof meta.files)[number]
      abs: string
      kind: 'write' | 'delete' | 'noop'
      content?: Buffer
    }
    const plan: PlannedWrite[] = []
    const blockers: string[] = []
    for (const file of meta.files) {
      const baseline = meta.baseline[file.path]
      const abs = resolveTrackedAbsolutePath(cwd, file.path)
      const current = await this.captureFileSnapshot(abs)
      const baselineSha = baseline?.sha1 ?? null
      if (current.sha1 === baselineSha) {
        const target = meta.target[file.path]
        if (!target || target.sha1 === null) {
          plan.push({ file, abs, kind: 'delete' })
        } else {
          const blobName = meta.blobs?.[`target:${file.path}`]
          const content = blobName ? await this.readBlob(sessionId, blobName) : null
          if (content === null) {
            blockers.push(`缺少 "${file.name}" 的目标快照`)
            continue
          }
          plan.push({ file, abs, kind: 'write', content })
        }
        continue
      }
      const target = meta.target[file.path]
      const targetSha = target?.sha1 ?? null
      if (target && current.sha1 === targetSha) {
        plan.push({ file, abs, kind: 'noop' })
        continue
      }
      blockers.push(`文件 "${file.name}" 在撤销后被外部修改`)
    }
    if (blockers.length > 0) {
      return `${blockers[0]}${blockers.length > 1 ? ` 等 ${blockers.length} 处问题` : ''}，无法安全恢复`
    }

    const failures: string[] = []
    for (const item of plan) {
      try {
        if (item.kind === 'noop') continue
        if (item.kind === 'delete') {
          await unlink(item.abs).catch(() => undefined)
          continue
        }
        await this.atomicWriteFile(item.abs, item.content!)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(`"${item.file.name}": ${msg}`)
      }
    }
    if (failures.length > 0) {
      return `部分文件恢复失败（${failures[0]}${failures.length > 1 ? ` 等 ${failures.length} 处` : ''}）。已成功的文件保持恢复状态，修复后可重试`
    }

    meta.status = 'applied'
    await writeFile(
      join(this.fileChangesDir(sessionId), 'index.json'),
      JSON.stringify(meta, null, 2),
      'utf8'
    )
    return null
  }

  private getActiveModelObject(providerId?: string, modelId?: string): Model<Api> | undefined {
    if (!this.modelRegistry) return undefined
    let prov = providerId || (this.store.get('agent_active_provider') as string) || this.defaultProvider
    let mod = modelId || (this.store.get('agent_active_model') as string) || this.defaultModel
    if (this.isProviderDisabled(prov)) {
      const fallback = this.firstEnabledModel()
      if (!fallback) return undefined
      prov = fallback.providerId
      mod = fallback.modelId
      this.store.set('agent_active_provider', prov)
      this.store.set('agent_active_model', mod)
    }
    return this.modelRegistry.find(prov, mod)
  }

  private getStoredThinkingLevel(): ThinkingLevel {
    const stored = this.store.get('agent_thinking_level')
    const levels: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    return typeof stored === 'string' && levels.includes(stored as AgentThinkingLevel)
      ? (stored as ThinkingLevel)
      : 'medium'
  }

  private getStoredPermissionMode(): PermissionMode {
    const stored = this.store.get('agent_permission_mode')
    if (typeof stored !== 'string') return 'default'
    const parsed = parseMode(stored)
    // parseMode returns ExtendedModeId ('readonly' allowed); ActiveSessionEntry
    // holds the legacy-tolerant PermissionMode so 'readonly' is also fine.
    return parsed
  }

  private wireSession(
    sessionId: string,
    session: AgentSession,
    cwd: string,
    permissionMode: PermissionMode = 'default'
  ): ActiveSessionEntry {
    session.agent.beforeToolCall = async (context) => {
      const active = this.activeSessions.get(sessionId)
      const currentMode = active?.permissionMode ?? 'default'

      const toolName = (context.toolCall.name || '').toLowerCase()
      const args = (context.args as Record<string, unknown>) ?? {}


      const activeBefore = this.activeSessions.get(sessionId)
      if (activeBefore) {
        activeBefore.pendingApprovalCount = (activeBefore.pendingApprovalCount ?? 0) + 1
      }
      let check: Awaited<ReturnType<PermissionEngine['checkOrRequestApproval']>>
      try {
        check = await this.permissionEngine.checkOrRequestApproval({
          sessionId,
          mode: currentMode,
          toolCallId: context.toolCall.id,
          toolName: context.toolCall.name,
          args: (context.args as Record<string, unknown>) ?? {},
          cwd
        })
      } finally {
        const activeAfter = this.activeSessions.get(sessionId)
        if (activeAfter && activeAfter.pendingApprovalCount) {
          activeAfter.pendingApprovalCount = Math.max(0, activeAfter.pendingApprovalCount - 1)
        }
      }


      if (!check.allowed) {
        return {
          block: true,
          reason: check.reason || 'Action denied by security policy or user'
        }
      }

      // Capture baseline snapshots *after* the permission check passes and
      // *before* the tool mutates the file. The hook is awaited by pi-agent,
      // so the write cannot start until the baseline bytes/metadata are captured.
      if (active) {
        if (FILE_MUTATION_TOOLS.has(toolName)) {
          const rawFilePath =
            (args.path as string | undefined) ??
            (args.filePath as string | undefined) ??
            (args.file_path as string | undefined)
          if (rawFilePath) {
            const tfc = this.ensureTurnFileChangeState(active)
            active.fileChangeKeyMap ??= new Map()
            active.baselineContents ??= new Map()
            const norm = normalizeTrackedFilePath(active.cwd, rawFilePath)
            let displayPath = active.fileChangeKeyMap.get(norm.key)
            if (!displayPath) {
              displayPath = norm.displayPath
              active.fileChangeKeyMap.set(norm.key, displayPath)
              const captured = await captureBaselineWithContent(norm.absPath)
              tfc.baseline[displayPath] = captured.snapshot
              active.baselineContents.set(displayPath, captured.content)
              active.baselineCapturedAt ??= new Map()
              active.baselineCapturedAt.set(displayPath, Date.now())
              tfc.files.push({
                path: displayPath,
                name: norm.name,
                isNew: captured.snapshot.sha1 === null,
                ...(captured.tooLarge ? { noBaselineBlob: true } : {}),
                added: 0,
                deleted: 0
              })
            }
            if (context.toolCall.id) {
              active.pendingToolFiles ??= new Map()
              active.pendingToolFiles.set(context.toolCall.id, displayPath)
            }
          }
        } else if (SHELL_TOOLS.has(toolName) && !check.readOnlyCommand) {
          this.ensureTurnFileChangeState(active)
          // Take at most one lightweight workspace metadata snapshot per user turn,
          // right before the first non-read-only shell command executes.
          if (active.preShellWorkspaceSnapshot === undefined) {
            active.preShellScanStartedAt = Date.now()
            active.preShellWorkspaceSnapshot = await scanWorkspaceMetadata(active.cwd)
          }
          active.shellWriteExecuted = true
        }
      }

      return undefined
    }

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      const active = this.activeSessions.get(sessionId)
      if (active) {
        active.updatedAt = Date.now()
        if (event.type === 'agent_start') {
          active.isRunning = true
          // Flush any leftover accumulator from a previous abnormal run, then start fresh
          // for this user prompt run. Individual LLM tool loops (`turn_start`/`turn_end`)
          // accumulate into this same record instead of overwriting it.
          this.scheduleFinalizeTurnFileChanges(sessionId, active)
          this.resetTurnFileChangeState(active)
        } else if (event.type === 'agent_end' || event.type === 'agent_settled') {
          active.isRunning = false
          if (event.type === 'agent_end' && active.providerId) {
            this.quotaService.invalidate(active.providerId)
            void this.refreshProviderQuota(active.providerId, false).catch(() => undefined)
          }
          this.scheduleFinalizeTurnFileChanges(sessionId, active)
        }
        if (event.type === 'message_end' && event.message.role === 'user') {
          if (!active.title) {
            const text = this.extractUserText(event.message.content)
            if (text) {
              active.title = text
            }
          }
          // Keep turnCounter aligned with live user messages. If a steering/follow-up
          // user message arrives mid-run after files were already mutated, finalize the
          // previous user turn first so each user prompt owns its own change set.
          const userCount = this.getLiveUserTurnCount(active)
          const hasWork =
            Boolean(active.turnFileChanges && active.turnFileChanges.files.length > 0) ||
            Boolean(active.shellWriteExecuted)
          if (hasWork && active.turnCounter && userCount > active.turnCounter) {
            this.scheduleFinalizeTurnFileChanges(sessionId, active)
            this.resetTurnFileChangeState(active, userCount)
          } else if (userCount > 0) {
            active.turnCounter = userCount
          }
        }

        if (event.type === 'turn_start') {
          // Do NOT reset `turnFileChanges` on `turn_start`: a single user prompt often
          // spans many LLM tool-call turns (`turn_start` → `turn_end`), and all edits
          // across those sub-turns belong to the same user-visible reply.
          this.ensureTurnFileChangeState(active)
        } else if (event.type === 'tool_execution_end' && active.turnFileChanges) {
          const toolName = (event.toolName || '').toLowerCase()
          if (FILE_MUTATION_TOOLS.has(toolName)) {
            const displayPath = event.toolCallId
              ? active.pendingToolFiles?.get(event.toolCallId)
              : undefined
            if (event.toolCallId) active.pendingToolFiles?.delete(event.toolCallId)
            if (!event.isError && displayPath && active.turnFileChanges.baseline[displayPath]) {
              // Capture the tfc reference *now* — the async .then must not re-read
              // active.turnFileChanges, which may be detached on agent_end/abort.
              const tfc = active.turnFileChanges
              const abs = resolveTrackedAbsolutePath(active.cwd, displayPath)
              const capture = this.captureFileSnapshot(abs)
                .then((snap) => {
                  tfc.target[displayPath] = snap
                })
                .catch(() => undefined)
              active.pendingCaptures = active.pendingCaptures ?? []
              active.pendingCaptures.push(capture)
            }
          }
        }
      }
      this.forwardEvent(sessionId, event)
    })

    const entry: ActiveSessionEntry = {
      session,
      cwd,
      permissionMode,
      modelId: session.model?.id ?? this.defaultModel,
      providerId: (session.model as { provider?: string } | undefined)?.provider ?? this.defaultProvider,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      unsubscribe
    }

    this.activeSessions.delete(sessionId)
    this.activeSessions.set(sessionId, entry)
    this.evictIdleSessions(sessionId)
    return entry
  }

  private touchActiveSession(sessionId: string): ActiveSessionEntry | undefined {
    const entry = this.activeSessions.get(sessionId)
    if (entry) {
      this.activeSessions.delete(sessionId)
      this.activeSessions.set(sessionId, entry)
    }
    return entry
  }

  private evictIdleSessions(protectSessionId?: string): void {
    let idleCount = 0
    for (const entry of this.activeSessions.values()) {
      const busy = !!entry.isRunning || (entry.pendingApprovalCount ?? 0) > 0
      if (!busy) idleCount++
    }
    if (idleCount <= MAX_IDLE_ACTIVE_SESSIONS) return

    for (const [id, entry] of this.activeSessions.entries()) {
      if (idleCount <= MAX_IDLE_ACTIVE_SESSIONS) break
      if (id === protectSessionId) continue
      const busy = !!entry.isRunning || (entry.pendingApprovalCount ?? 0) > 0
      if (busy) continue
      this.clearPendingMessageUpdate(id)
      try {
        entry.unsubscribe()
      } catch {
        // intentionally ignored
      }
      try {
        entry.session.dispose()
      } catch {
        // intentionally ignored
      }
      this.activeSessions.delete(id)
      idleCount--
    }
  }

  public async newSession(cwd?: string): Promise<{ sessionId: string }> {
    if (!this.modelRegistry || !this.modelRuntime) {
      await this.init()
    }
    await mkdir(this.sessionsDir, { recursive: true })

    const { SessionManager, createAgentSession } = await this.getPi()

    const resolvedCwd = cwd && cwd.trim() ? cwd.trim() : process.cwd()
    const sessionManager = SessionManager.create(resolvedCwd, this.sessionsDir)
    const sessionId = sessionManager.getSessionId()

    await this.resolveShellConfigForPrompt()
    const shellTool = shellToolForPlatform()
    const envPrompt = shellEnvironmentPrompt(resolvedCwd, [shellTool], () => this.resolveShellExecutable() ?? '')

    const resourceLoader = new AgentResourceLoader({
      cwd: resolvedCwd,
      agentDir: this.agentDir,
      appendSystemPrompt: [envPrompt],
      extraSkillDirs: this.getExtraSkillDirs(),
      extensionFactories: this.buildCompressionExtensions()
    })
    await resourceLoader.reload()

    const modelObj = this.getActiveModelObject()

    const { session } = await createAgentSession({
      cwd: resolvedCwd,
      agentDir: this.agentDir,
      modelRuntime: this.modelRuntime ?? undefined,
      model: modelObj,
      thinkingLevel: this.getStoredThinkingLevel(),
      sessionManager,
      resourceLoader: resourceLoader.getRawLoader(),
      settingsManager: (await this.getPi()).SettingsManager.create(resolvedCwd, this.agentDir),
      excludeTools: excludedShellTools(),
      tools: shellToolModifiers(),
      customTools: [await createWebSearchTool(), await createImageGenTool(resolvedCwd), await this.shellCustomTool(cwd && cwd.trim() ? cwd : process.cwd())]
    })

    this.wireSession(sessionId, session, resolvedCwd, this.getStoredPermissionMode())
    this.store.set('agent_current_session', sessionId)

    return { sessionId }
  }

  public async resumeSession(sessionId: string): Promise<Record<string, unknown>> {
    if (!this.modelRegistry || !this.modelRuntime) {
      await this.init()
    }

    const existing = this.touchActiveSession(sessionId)
    if (existing) {
      const forkOrigin = await this.resolveForkOrigin(existing.session.sessionManager)
      return {
        sessionId,
        messages: existing.session.agent.state.messages,
        permissionMode: existing.permissionMode,
        model: existing.modelId,
        provider: existing.providerId,
        cwd: existing.cwd,
        // 会话是否仍在主进程内存中运行（如恢复发生在长任务 mid-flight）。
        // 渲染层恢复消息时需要它来决定 assistant 条目该标 running 还是 complete，
        // 否则运行中的 image_gen/web_search 工具会被恢复成"已完成但无结果"的假成功。
        isRunning: existing.isRunning === true,
        forkOrigin
      }
    }

    const { SessionManager, createAgentSession } = await this.getPi()

    const sessionFile = await this.findSessionFile(sessionId)

    if (!sessionFile) {
      throw new Error(`Session ${sessionId} not found on disk`)
    }

    const sessionManager = SessionManager.open(sessionFile, this.sessionsDir)
    const cwd = sessionManager.getCwd() || process.cwd()

    await this.resolveShellConfigForPrompt()
    const shellTool = shellToolForPlatform()
    const envPrompt = shellEnvironmentPrompt(cwd, [shellTool], () => this.resolveShellExecutable() ?? '')

    const resourceLoader = new AgentResourceLoader({
      cwd,
      agentDir: this.agentDir,
      appendSystemPrompt: [envPrompt],
      extraSkillDirs: this.getExtraSkillDirs(),
      extensionFactories: this.buildCompressionExtensions()
    })
    await resourceLoader.reload()

    const modelObj = this.getActiveModelObject()

    const { session } = await createAgentSession({
      cwd,
      agentDir: this.agentDir,
      modelRuntime: this.modelRuntime ?? undefined,
      model: modelObj,
      thinkingLevel: this.getStoredThinkingLevel(),
      sessionManager,
      resourceLoader: resourceLoader.getRawLoader(),
      settingsManager: (await this.getPi()).SettingsManager.create(cwd, this.agentDir),
      excludeTools: excludedShellTools(),
      tools: shellToolModifiers(),
      customTools: [await createWebSearchTool(), await createImageGenTool(cwd), await this.shellCustomTool(cwd && cwd.trim() ? cwd : process.cwd())]
    })

    const entry = this.wireSession(sessionId, session, cwd, this.getStoredPermissionMode())
    this.store.set('agent_current_session', sessionId)
    const forkOrigin = await this.resolveForkOrigin(session.sessionManager)

    return {
      sessionId,
      messages: session.agent.state.messages,
      permissionMode: entry.permissionMode,
      model: entry.modelId,
      provider: entry.providerId,
      cwd: entry.cwd,
      isRunning: false,
      forkOrigin
    }
  }

  public async prompt(
    sessionId: string,
    promptText: string,
    attachments?: string[],
    streamingBehavior?: 'steer' | 'followUp',
    images?: Array<{ data: string; mimeType: string }>
  ): Promise<void> {
    let active = this.touchActiveSession(sessionId)
    if (!active) {
      await this.resumeSession(sessionId)
      active = this.touchActiveSession(sessionId)
    }

    if (!active) {
      throw new Error(`Cannot prompt inactive session: ${sessionId}`)
    }

    let finalPrompt = promptText
    if (attachments && attachments.length > 0) {
      const unreferenced = attachments.filter((filePath) => !promptText.includes(filePath))
      if (unreferenced.length > 0) {
        finalPrompt = `${finalPrompt}\n\n${unreferenced.map((f) => `@${f}`).join(' ')}`
      }
    }

    // If the agent is already streaming and the caller didn't specify how to
    // queue, default to steer (inject at next turn boundary) — covers the
    // resume-a-running-session window where the renderer's optimistic
    // runningSessionIds hasn't caught up yet.
    const behavior =
      streamingBehavior ?? (active.session.isStreaming ? 'steer' : undefined)

    const imageParts =
      images && images.length > 0
        ? images.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }))
        : undefined
    active.session.prompt(finalPrompt, { streamingBehavior: behavior, images: imageParts }).catch((err: Error) => {
      console.error(`[AgentSessionService] Error during prompt for session ${sessionId}:`, err)
      this.forwardEvent(sessionId, {
        type: 'agent_end',
        messages: active!.session.agent.state.messages,
        willRetry: false
      } as AgentSessionEvent)
    })
  }

  public async abort(sessionId: string): Promise<void> {
    this.permissionEngine.cancelPendingApprovalsForSession(sessionId)
    const active = this.activeSessions.get(sessionId)
    if (active) {
      // Flush any in-flight file-change record so the card still reflects
      // the edits that already happened before the abort.
      this.scheduleFinalizeTurnFileChanges(sessionId, active)
      await active.session.abort()

      // Recover queued (not yet delivered) follow-up/steering texts back to
      // the composer AFTER abort succeeded, so a failed abort doesn't lose them.
      try {
        const queued = active.session.clearQueue()
        const texts = [...queued.steering, ...queued.followUp].filter(Boolean)
        if (texts.length > 0) {
          this.forwardEvent(sessionId, {
            type: 'queue_cleared',
            texts
          })
        }
      } catch {
        // clearQueue is best-effort; never let it mask the abort result.
      }
    }
  }

  /**
   * Rewind the conversation to just before the given user-message entry and
   * hand its text back to the composer. Pi stores the session as an append-only
   * tree, so this only moves the leaf pointer — unless the caller explicitly
   * opts in via `revertFiles`, file edits already applied to the workspace
   * stay as they are. The abandoned branch stays in the session file and is
   * still reachable via the tree.
   *
   * Only the most recent user message on the current branch is accepted, which
   * limits the operation to a single step back and keeps the behaviour
   * predictable while this feature settles.
   *
   * When the abandoned turn produced file changes, the caller chooses via
   * `revertFiles` whether those changes are rolled back first (reusing the
   * same validated revert path as the changed-files card). The rewind is
   * aborted when a requested revert fails, so the conversation state never
   * claims files were rolled back when they were not.
   */
  public async rewindToUserMessage(
    sessionId: string,
    options?: { entryId?: string; revertFiles?: boolean }
  ): Promise<{ editorText: string }> {
    const active = this.activeSessions.get(sessionId)
    if (!active) {
      throw new Error(`Session ${sessionId} is not active`)
    }
    if (active.isRunning) {
      throw new Error('任务正在运行，无法撤回')
    }
    const session = active.session
    const sessionManager = session.sessionManager

    // Resolve the target entry: explicit id, else the last user message on the
    // active branch. Restricting to the last user message enforces the
    // "one-step rewind only" contract.
    let targetId = options?.entryId
    let targetEntry = targetId ? sessionManager.getEntry(targetId) : undefined
    if (!targetEntry) {
      const branch = sessionManager.getBranch()
      for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i]
        if (entry.type === 'message' && entry.message.role === 'user') {
          targetId = entry.id
          targetEntry = entry
          break
        }
      }
    }
    if (!targetId || !targetEntry || targetEntry.type !== 'message' || targetEntry.message.role !== 'user') {
      throw new Error('没有可撤回的用户消息')
    }

    // Guard: never rewind past an earlier user turn — only the latest user
    // message on the branch may be rewound.
    const branch = sessionManager.getBranch()
    const lastUserEntry = [...branch]
      .reverse()
      .find((e) => e.type === 'message' && e.message.role === 'user')
    if (!lastUserEntry || lastUserEntry.id !== targetId) {
      throw new Error('当前版本仅支持撤回最近一条用户消息')
    }

    // The abandoned turn is the latest user turn: the count of user messages
    // on the branch up to and including the target equals the turn index that
    // the file-change tracker assigns to it. A new turn sent after the rewind
    // reuses the same index, so the abandoned turn's record must be retired
    // here — otherwise its card would resurface attached to the wrong turn.
    const abandonedTurnIndex = branch
      .slice(0, branch.indexOf(lastUserEntry) + 1)
      .filter((e) => e.type === 'message' && e.message.role === 'user').length

    // The record of the just-finished turn persists asynchronously; wait so
    // the revert decision sees the final state instead of a stale record.
    await this.waitForFileChangePersist(sessionId)

    const record = await this.loadFileChanges(sessionId)
    const recordMatchesAbandonedTurn =
      record !== null &&
      record.files.length > 0 &&
      (record.turnIndex === undefined ? true : record.turnIndex === abandonedTurnIndex)

    if (options?.revertFiles && !recordMatchesAbandonedTurn) {
      // The caller explicitly asked for a file rollback — silently skipping it
      // would leave the workspace in a state the user did not choose. Fail the
      // rewind instead so they can pick conversation-only deliberately.
      throw new Error('本轮没有可回滚的文件修改记录，已取消撤回')
    }

    if (options?.revertFiles && recordMatchesAbandonedTurn) {
      if (record.status === 'undone') {
        // Files were already reverted (e.g. an earlier rewind attempt reverted
        // successfully but the tree navigation failed afterwards). The desired
        // end state is "files at baseline" — validate it still holds instead
        // of erroring out, so the retry is not deadlocked.
        const rawCwd = record.cwd ?? active.cwd ?? ''
        const cwd = rawCwd ? resolve(rawCwd) : ''
        let mismatch: string | null = null
        for (const file of record.files) {
          const baseline = record.baseline[file.path]
          const abs = resolveTrackedAbsolutePath(cwd, file.path)
          const current = await this.captureFileSnapshot(abs)
          if (current.sha1 !== (baseline?.sha1 ?? null)) {
            mismatch = file.name
            break
          }
        }
        if (mismatch) {
          throw new Error(`文件回滚失败，已取消撤回：文件 "${mismatch}" 在撤销后被外部修改`)
        }
      } else {
        const revertError = await this.revertFileChanges(sessionId)
        if (revertError) {
          throw new Error(`文件回滚失败，已取消撤回：${revertError}`)
        }
      }
    }

    const result = await session.navigateTree(targetId, {})
    if (result.cancelled) {
      throw new Error('撤回被取消')
    }

    if (recordMatchesAbandonedTurn) {
      // The abandoned turn is no longer part of the visible timeline, and a
      // resent prompt would reuse its turn index — retire the record whether
      // or not files were reverted, so its card can never attach itself to an
      // unrelated future turn. Revert already restored the files when the
      // user asked for it; when files were kept, the user accepted losing the
      // undo record as part of abandoning the turn.
      await rm(this.fileChangesDir(sessionId), { recursive: true, force: true }).catch(() => undefined)
    }

    const editorText =
      result.editorText ??
      this.extractUserText((targetEntry as { message: { content: unknown } }).message.content)
    return { editorText }
  }

  /**
   * Fork the current session at a specific leaf entry (or at the current leaf
   * when leafId is omitted). The new session contains the full history up to
   * that point — the selected turn's assistant reply stays inside the branch,
   * unlike rewind which rewinds to *before* a user prompt.
   *
   * createBranchedSession() mutates the manager it is called on (it rewrites
   * fileEntries / sessionFile / sessionId in place), so it must never run on
   * the live session manager. We open a throwaway manager on the current
   * session file first, mirroring pi's own /fork flow
   * (agent-session-runtime.js does SessionManager.open(...).createBranchedSession).
   */
  public async forkSessionAtLeaf(
    sessionId: string,
    leafId?: string
  ): Promise<{ sessionId: string; forkOrigin: AgentForkOrigin }> {
    const active = this.activeSessions.get(sessionId)
    if (!active) {
      throw new Error(`Session ${sessionId} is not active`)
    }

    const { SessionManager, createAgentSession } = await this.getPi()
    const cwd = active.cwd

    const liveManager = active.session.sessionManager
    const sourceFile = liveManager.getSessionFile()
    let scratchManager = liveManager
    if (liveManager.isPersisted()) {
      if (!sourceFile || !existsSync(sourceFile)) {
        throw new Error('原会话尚未保存到磁盘，无法创建分支')
      }
      scratchManager = SessionManager.open(sourceFile, this.sessionsDir)
    }

    let forkedManager: SessionManagerType
    const targetLeafId = leafId ?? scratchManager.getLeafId()
    if (targetLeafId) {
      const forkedPath = scratchManager.createBranchedSession(targetLeafId)
      if (!forkedPath) {
        throw new Error('创建分支会话失败')
      }
      forkedManager = SessionManager.open(forkedPath, this.sessionsDir)
    } else {
      // Empty branch point: create a fresh session that still records its
      // lineage via parentSession.
      forkedManager = SessionManager.create(cwd, this.sessionsDir)
      forkedManager.newSession(sourceFile ? { parentSession: sourceFile } : undefined)
    }

    await this.resolveShellConfigForPrompt()
    const shellTool = shellToolForPlatform()
    const envPrompt = shellEnvironmentPrompt(cwd, [shellTool], () => this.resolveShellExecutable() ?? '')
    const resourceLoader = new AgentResourceLoader({
      cwd,
      agentDir: this.agentDir,
      appendSystemPrompt: [envPrompt],
      extraSkillDirs: this.getExtraSkillDirs(),
      extensionFactories: this.buildCompressionExtensions()
    })
    await resourceLoader.reload()

    const modelObj = this.getActiveModelObject()
    const { session: forkedSession } = await createAgentSession({
      cwd,
      agentDir: this.agentDir,
      modelRuntime: this.modelRuntime ?? undefined,
      model: modelObj,
      thinkingLevel: this.getStoredThinkingLevel(),
      sessionManager: forkedManager,
      resourceLoader: resourceLoader.getRawLoader(),
      settingsManager: (await this.getPi()).SettingsManager.create(cwd, this.agentDir),
      excludeTools: excludedShellTools(),
      tools: shellToolModifiers(),
      customTools: [await createWebSearchTool(), await createImageGenTool(cwd), await this.shellCustomTool(cwd && cwd.trim() ? cwd : process.cwd())]
    })

    const newSessionId = forkedManager.getSessionId()
    const forkedEntry = this.wireSession(newSessionId, forkedSession, cwd, active.permissionMode)
    this.store.set('agent_current_session', newSessionId)

    // Carry over the parent's file-change record so the fork can undo/redo
    // work that happened before the fork point.
    try {
      const parentDir = this.fileChangesDir(sessionId)
      const childDir = this.fileChangesDir(newSessionId)
      if (existsSync(parentDir)) {
        await mkdir(childDir, { recursive: true })
        const { cp } = await import('fs/promises')
        await cp(parentDir, childDir, { recursive: true })
      }
    } catch {
      // Best-effort; fork still succeeds without file-change history.
    }

    // Keep the forked session title clean (do not append a "分支" suffix that
    // gets clipped by narrow headers/48-char truncation); lineage is tracked via
    // pi's header.parentSession + a non-context custom entry.
    const sourceTitle = this.resolveLiveSessionTitle(sessionId, active)
    forkedEntry.title = sourceTitle

    try {
      forkedSession.sessionManager.appendCustomEntry(FORK_ORIGIN_CUSTOM_TYPE, {
        parentSessionId: sessionId,
        parentSessionTitle: sourceTitle,
        forkAfterEntryId: targetLeafId ?? undefined,
        forkedAt: Date.now()
      } satisfies ForkOriginCustomData)
    } catch {
      // Best-effort; header.parentSession still preserves lineage.
    }

    const inheritedMessageCount = this.countRenderableContextMessages(forkedSession.sessionManager)
    const forkOrigin: AgentForkOrigin = {
      parentSessionId: sessionId,
      parentSessionTitle: sourceTitle,
      inheritedMessageCount,
      parentExists: true
    }

    return { sessionId: newSessionId, forkOrigin }
  }

  /**
   * List the user messages on the current branch of an active session, mapped
   * to their session-entry ids. The renderer needs these ids to bind
   * rewind/fork actions to concrete bubbles. Only entries on the active
   * branch are returned, so ids always resolve after navigation.
   */
  public listBranchUserEntries(sessionId: string): Array<{ entryId: string; text: string }> {
    const active = this.activeSessions.get(sessionId)
    if (!active) return []
    const branch = active.session.sessionManager.getBranch()
    const result: Array<{ entryId: string; text: string }> = []
    for (const entry of branch) {
      if (entry.type === 'message' && entry.message.role === 'user') {
        const text = this.extractUserText(entry.message.content)
        if (text) result.push({ entryId: entry.id, text })
      }
    }
    return result
  }

  public async deleteSession(sessionId: string): Promise<void> {
    this.clearPendingMessageUpdate(sessionId)
    const active = this.activeSessions.get(sessionId)
    if (active) {
      try {
        await active.session.abort()
      } catch {
        // intentionally ignored
      }
      active.unsubscribe()
      try {
        active.session.dispose()
      } catch {
        // intentionally ignored
      }
      this.activeSessions.delete(sessionId)
    }

    const sessionFile = await this.findSessionFile(sessionId)
    if (sessionFile) {
      this.sessionMetaCache.delete(sessionFile)
      await rm(sessionFile, { force: true }).catch(() => undefined)
    }
    this.sessionFilePathCache.delete(sessionId)

    const current = this.store.get('agent_current_session')
    if (current === sessionId) {
      this.store.delete('agent_current_session')
    }
  }

  /**
   * 从分支消息序列中生成"复制对话"用的精简文本：每个用户回合只保留
   * 用户 query 与该回合内最后一个带非空文本的 assistant 消息（即 UI 中的
   * final answer——中间过渡文本、思考与工具调用全部剔除）。
   */
  private buildExportTranscript(
    title: string,
    entries: Array<{ type?: string; message?: { role?: string; content?: unknown } }>
  ): string {
    const extractText = (content: unknown): string => {
      if (typeof content === 'string') return content.trim()
      if (!Array.isArray(content)) return ''
      return content
        .filter(
          (part): part is { type: 'text'; text: string } =>
            !!part && typeof part === 'object' && (part as { type?: string }).type === 'text'
        )
        .map((part) => part.text)
        .join('')
        .trim()
    }

    interface Turn {
      query: string
      answer: string
    }
    const turns: Turn[] = []
    let current: Turn | null = null
    for (const entry of entries) {
      if (entry.type !== 'message') continue
      const role = entry.message?.role
      if (role === 'user') {
        const query = extractText(entry.message?.content)
        if (!query) continue
        current = { query, answer: '' }
        turns.push(current)
      } else if (role === 'assistant' && current) {
        const text = extractText(entry.message?.content)
        // 同一回合内后面的非空文本覆盖前面的：最后一段才是 final answer，
        // 之前的只是"我先看一下…"这类过渡叙述。
        if (text) current.answer = text
      }
    }

    const parts: string[] = [`<conversation title="${title || '新对话'}">`]
    for (const turn of turns) {
      parts.push(`<user_query>\n${turn.query}\n</user_query>`)
      if (turn.answer) {
        // final answer 保留原始 Markdown 结构，不做转义或改写。
        parts.push(`<assistant_final_answer>\n${turn.answer}\n</assistant_final_answer>`)
      }
    }
    parts.push('</conversation>')
    return parts.join('\n\n')
  }

  /**
   * 导出会话的精简对话文本（复制用）与原始 .jsonl 文件路径。
   * 优先读取内存中的活动会话（含未落盘的最新状态），否则从磁盘打开。
   * 新创建但尚未提问的会话可能没有落盘文件，此时 filePath 为 null。
   */
  public async getSessionExport(
    sessionId: string
  ): Promise<{ filePath: string | null; transcript: string }> {
    const filePath = (await this.findSessionFile(sessionId)) ?? null

    const active = this.activeSessions.get(sessionId)
    let branch: Array<{ type?: string; message?: { role?: string; content?: unknown } }> = []
    let title = '新对话'
    if (active) {
      title = this.resolveLiveSessionTitle(sessionId, active)
      try {
        branch = active.session.sessionManager.getBranch()
      } catch {
        branch = []
      }
    } else {
      if (!filePath) {
        return { filePath: null, transcript: '' }
      }
      const { SessionManager } = await this.getPi()
      const manager = SessionManager.open(filePath, this.sessionsDir)
      title = (manager.getSessionName() || '').trim() || title
      if (title === '新对话') {
        const cached = this.sessionMetaCache.get(filePath)?.meta
        const metaTitle = cached?.name || cached?.firstMessage
        if (metaTitle) title = metaTitle.slice(0, 48)
      }
      try {
        branch = manager.getBranch()
      } catch {
        branch = []
      }
    }

    return { filePath, transcript: this.buildExportTranscript(title, branch) }
  }

  /**
   * Read only the first 8KB of a .jsonl file to extract the session header `id`
   * (falling back to full read only if the first line exceeds 8KB).
   */
  private async readSessionHeaderId(fullPath: string): Promise<string | undefined> {
    const handle = await open(fullPath, 'r')
    try {
      const buf = Buffer.allocUnsafe(SESSION_HEADER_PEEK_BYTES)
      const { bytesRead } = await handle.read(buf, 0, SESSION_HEADER_PEEK_BYTES, 0)
      if (bytesRead <= 0) return undefined
      const slice = buf.toString('utf8', 0, bytesRead)
      const newlineIdx = slice.indexOf('\n')
      let firstLine: string
      if (newlineIdx >= 0) {
        firstLine = slice.slice(0, newlineIdx)
      } else if (bytesRead === SESSION_HEADER_PEEK_BYTES) {
        const full = await readFile(fullPath, 'utf8')
        const fullNl = full.indexOf('\n')
        firstLine = fullNl >= 0 ? full.slice(0, fullNl) : full
      } else {
        firstLine = slice
      }
      if (!firstLine.trim()) return undefined
      const header = JSON.parse(firstLine) as { type?: string; id?: string }
      return header.type === 'session' && typeof header.id === 'string' ? header.id : undefined
    } finally {
      await handle.close()
    }
  }

  /**
   * Locate the on-disk .jsonl file for a session id by matching the header's
   * `id` field. Shared by resumeSession (read path) and renameSession
   * (append path).
   */
  private async findSessionFile(sessionId: string): Promise<string | undefined> {
    const cachedPath = this.sessionFilePathCache.get(sessionId)
    if (cachedPath) {
      try {
        const headerId = await this.readSessionHeaderId(cachedPath)
        if (headerId === sessionId) return cachedPath
      } catch {
        // cache stale; fall through to dir scan
      }
      this.sessionFilePathCache.delete(sessionId)
    }

    for (const [filePath, entry] of this.sessionMetaCache.entries()) {
      if (entry.meta?.id === sessionId) {
        try {
          await stat(filePath)
          this.sessionFilePathCache.set(sessionId, filePath)
          return filePath
        } catch {
          this.sessionMetaCache.delete(filePath)
        }
      }
    }

    try {
      const files = (await readdir(this.sessionsDir)).filter((f) => f.endsWith('.jsonl'))
      files.sort((a, b) => {
        const aHit = a.includes(sessionId) ? 0 : 1
        const bHit = b.includes(sessionId) ? 0 : 1
        return aHit - bHit
      })
      for (const file of files) {
        const fullPath = join(this.sessionsDir, file)
        try {
          const headerId = await this.readSessionHeaderId(fullPath)
          if (headerId) {
            this.sessionFilePathCache.set(headerId, fullPath)
            if (headerId === sessionId) {
              return fullPath
            }
          }
        } catch {
          // ignore unreadable entries
        }
      }
    } catch {
      // intentionally ignored
    }
    return undefined
  }

  /**
   * Rename a session's display title. pi persists the name as a `session_info`
   * entry in the session file, so renaming works for both live sessions
   * (setSessionName, emits session_info_changed) and disk-only sessions
   * (open a throwaway manager just to append the entry).
   */
  public async renameSession(sessionId: string, name: string): Promise<void> {
    const sanitized = name.replace(/[\r\n]+/g, ' ').trim()
    if (!sanitized) {
      throw new Error('会话标题不能为空')
    }

    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.session.setSessionName(sanitized)
      active.title = sanitized
      return
    }

    const sessionFile = await this.findSessionFile(sessionId)
    if (!sessionFile) {
      throw new Error(`Session ${sessionId} not found on disk`)
    }
    const { SessionManager } = await this.getPi()
    // The entry becomes a child of the current leaf; harmless for the
    // conversation tree since session_info is metadata, not a message.
    const manager = SessionManager.open(sessionFile, this.sessionsDir)
    manager.appendSessionInfo(sanitized)
  }

  private normalizeSessionPath(p: string): string {
    return resolve(p).replace(/\\/g, '/').toLowerCase()
  }

  private resolveLiveSessionTitle(sessionId: string, active: ActiveSessionEntry): string {
    try {
      const liveName = active.session.sessionManager.getSessionName()
      if (liveName && liveName.trim()) return liveName.trim().slice(0, 48)
    } catch {
      // intentionally ignored
    }
    if (active.title && active.title.trim()) {
      return active.title.trim().slice(0, 48)
    }
    try {
      const branch = active.session.sessionManager.getBranch()
      for (const entry of branch) {
        if (entry.type === 'message' && entry.message.role === 'user') {
          const text = this.extractUserText(entry.message.content)
          if (text) return text.slice(0, 48)
        }
      }
    } catch {
      // intentionally ignored
    }
    const cachedFile = this.sessionFilePathCache.get(sessionId)
    if (cachedFile) {
      const meta = this.sessionMetaCache.get(cachedFile)?.meta
      const metaTitle = meta?.name || meta?.firstMessage
      if (metaTitle) return metaTitle.slice(0, 48)
    }
    return '新会话'
  }

  private countRenderableContextMessages(sessionManager: SessionManagerType): number {
    try {
      const entries = sessionManager.buildContextEntries()
      let count = 0
      for (const entry of entries) {
        if (entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
          count++
        }
      }
      return count
    } catch {
      return 0
    }
  }

  private inspectBranchForkState(sessionManager: SessionManagerType): {
    forkOriginEntryId?: string
    forkData?: ForkOriginCustomData
    firstBranchMessage?: string
  } {
    const branch = sessionManager.getBranch()
    let forkOriginEntryId: string | undefined
    let forkData: ForkOriginCustomData | undefined
    let firstBranchMessage: string | undefined

    for (const entry of branch) {
      if (entry.type === 'custom' && entry.customType === FORK_ORIGIN_CUSTOM_TYPE) {
        forkOriginEntryId = entry.id
        forkData = (entry.data as ForkOriginCustomData | undefined) ?? undefined
        firstBranchMessage = undefined
        continue
      }
      if (forkOriginEntryId && !firstBranchMessage && entry.type === 'message' && entry.message.role === 'user') {
        const text = this.extractUserText(entry.message.content)
        if (text) firstBranchMessage = text
      }
    }

    return { forkOriginEntryId, forkData, firstBranchMessage }
  }

  private async resolveForkOrigin(sessionManager: SessionManagerType): Promise<AgentForkOrigin | undefined> {
    const header = sessionManager.getHeader()
    const parentSessionPath = header?.parentSession
    const { forkOriginEntryId, forkData, firstBranchMessage: _unused } = this.inspectBranchForkState(sessionManager)

    if (!parentSessionPath && !forkData) {
      return undefined
    }

    let inheritedMessageCount: number | undefined
    if (forkOriginEntryId) {
      const contextEntries = sessionManager.buildContextEntries()
      const idx = contextEntries.findIndex((entry) => entry.id === forkOriginEntryId)
      if (idx >= 0) {
        let count = 0
        for (let i = 0; i < idx; i++) {
          const entry = contextEntries[i]
          if (entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
            count++
          }
        }
        inheritedMessageCount = count
      } else {
        // Compaction occurred after the fork marker; anchor at top of retained context.
        inheritedMessageCount = 0
      }
    }

    let parentSessionId = forkData?.parentSessionId
    let parentSessionTitle = forkData?.parentSessionTitle
    let parentExists = false

    if (parentSessionId && this.activeSessions.has(parentSessionId)) {
      const parentActive = this.activeSessions.get(parentSessionId)!
      parentExists = true
      parentSessionTitle = this.resolveLiveSessionTitle(parentSessionId, parentActive)
    } else {
      let resolvedParentPath: string | undefined
      if (parentSessionId) {
        resolvedParentPath = await this.findSessionFile(parentSessionId)
      }
      if (!resolvedParentPath && parentSessionPath && existsSync(parentSessionPath)) {
        resolvedParentPath = parentSessionPath
      }
      if (resolvedParentPath) {
        try {
          const info = await stat(resolvedParentPath)
          if (info.isFile()) {
            const cached = this.sessionMetaCache.get(resolvedParentPath)
            const meta =
              cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs
                ? cached.meta
                : await this.parseDiskSessionFile(resolvedParentPath, info.mtimeMs)
            if (meta) {
              this.sessionMetaCache.set(resolvedParentPath, { size: info.size, mtimeMs: info.mtimeMs, meta })
              this.sessionFilePathCache.set(meta.id, resolvedParentPath)
              parentSessionId = meta.id
              const activeParent = this.activeSessions.get(meta.id)
              parentSessionTitle = activeParent
                ? this.resolveLiveSessionTitle(meta.id, activeParent)
                : (meta.name || meta.firstMessage || '新会话').slice(0, 48)
              parentExists = true
            }
          }
        } catch {
          // ignore unreadable parent
        }
      }
    }

    return {
      parentSessionId,
      parentSessionTitle: parentSessionTitle || '原对话',
      inheritedMessageCount,
      parentExists
    }
  }

  /**
   * Stream-parse a single .jsonl session file once to build both list metadata and model.
   * Cached by { filePath, size, mtimeMs } so unchanged files are never re-read.
   */
  private async parseDiskSessionFile(filePath: string, fallbackMtimeMs: number): Promise<DiskSessionMeta | null> {
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let header: { id?: string; cwd?: string; timestamp?: string; parentSession?: string } | null = null
    let name: string | undefined
    let model: string | undefined
    let messageCount = 0
    let firstMessage = ''
    let sawForkOrigin = false
    let forkParentId: string | undefined
    let forkParentTitle: string | undefined
    let firstBranchMessage = ''
    let lastActivityTime = 0

    try {
      for await (const line of rl) {
        if (!line) continue
        let entry: Record<string, unknown>
        try {
          entry = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
        if (!header) {
          if (entry.type !== 'session' || typeof entry.id !== 'string') {
            return null
          }
          header = {
            id: entry.id,
            cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
            timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
            parentSession: typeof entry.parentSession === 'string' ? entry.parentSession : undefined
          }
          continue
        }
        if (entry.type === 'session_info') {
          const rawName = typeof entry.name === 'string' ? entry.name.trim() : ''
          name = rawName || undefined
          continue
        }
        if (entry.type === 'custom' && entry.customType === FORK_ORIGIN_CUSTOM_TYPE) {
          const data = entry.data as ForkOriginCustomData | undefined
          sawForkOrigin = true
          forkParentId = typeof data?.parentSessionId === 'string' ? data.parentSessionId : forkParentId
          forkParentTitle = typeof data?.parentSessionTitle === 'string' ? data.parentSessionTitle : forkParentTitle
          // Nested forks inherit ancestor fork markers; reset so we capture the
          // first prompt after the latest fork boundary.
          firstBranchMessage = ''
          continue
        }
        if (entry.type === 'model_change') {
          const modelId = typeof entry.modelId === 'string' ? entry.modelId : ''
          const provider = typeof entry.provider === 'string' ? entry.provider : ''
          if (modelId) {
            model = provider ? `${provider}/${modelId}` : modelId
          }
          continue
        }
        if (entry.type !== 'message') continue

        messageCount++
        const msg = entry.message as { role?: string; content?: unknown; timestamp?: unknown } | undefined
        if (msg && typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp)) {
          lastActivityTime = Math.max(lastActivityTime, msg.timestamp)
        } else if (typeof entry.timestamp === 'string') {
          const parsed = Date.parse(entry.timestamp)
          if (!Number.isNaN(parsed)) {
            lastActivityTime = Math.max(lastActivityTime, parsed)
          }
        }
        if (msg?.role === 'user') {
          const text = this.extractUserText(msg.content)
          if (text) {
            if (!firstMessage) firstMessage = text
            if (sawForkOrigin && !firstBranchMessage) firstBranchMessage = text
          }
        }
      }
    } catch {
      return null
    } finally {
      rl.close()
      stream.destroy()
    }

    if (!header?.id) return null
    const headerTime = header.timestamp ? Date.parse(header.timestamp) : NaN
    const createdAt = !Number.isNaN(headerTime) ? headerTime : fallbackMtimeMs
    const updatedAt =
      lastActivityTime > 0
        ? lastActivityTime
        : !Number.isNaN(headerTime)
          ? headerTime
          : fallbackMtimeMs

    return {
      id: header.id,
      filePath,
      cwd: header.cwd ?? '',
      name,
      firstMessage: firstMessage || '(no messages)',
      parentSessionPath: header.parentSession,
      forkParentId,
      forkParentTitle,
      firstBranchMessage: firstBranchMessage || undefined,
      messageCount,
      createdAt,
      updatedAt,
      model
    }
  }

  public async listSessions(): Promise<SessionListItem[]> {
    await mkdir(this.sessionsDir, { recursive: true })
    let files: string[] = []
    try {
      files = (await readdir(this.sessionsDir)).filter((f) => f.endsWith('.jsonl'))
    } catch {
      files = []
    }

    const currentPaths = new Set(files.map((f) => join(this.sessionsDir, f)))
    for (const cachedPath of this.sessionMetaCache.keys()) {
      if (!currentPaths.has(cachedPath)) {
        const prev = this.sessionMetaCache.get(cachedPath)
        if (prev?.meta?.id) this.sessionFilePathCache.delete(prev.meta.id)
        this.sessionMetaCache.delete(cachedPath)
      }
    }

    const diskSessions: DiskSessionMeta[] = []
    const STAT_CONCURRENCY = 16
    let idx = 0
    const workers = Array.from({ length: Math.min(STAT_CONCURRENCY, files.length) }, async () => {
      while (idx < files.length) {
        const file = files[idx++]
        const fullPath = join(this.sessionsDir, file)
        try {
          const info = await stat(fullPath)
          if (!info.isFile()) continue
          const cached = this.sessionMetaCache.get(fullPath)
          if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
            if (cached.meta) diskSessions.push(cached.meta)
            continue
          }
          const meta = await this.parseDiskSessionFile(fullPath, info.mtimeMs)
          this.sessionMetaCache.set(fullPath, { size: info.size, mtimeMs: info.mtimeMs, meta })
          if (meta) {
            this.sessionFilePathCache.set(meta.id, fullPath)
            diskSessions.push(meta)
          }
        } catch {
          // ignore unreadable entry
        }
      }
    })
    await Promise.all(workers)

    const result: SessionListItem[] = []
    const seen = new Set<string>()
    const diskTitleById = new Map<string, string>()
    const diskNameById = new Map<string, string>()
    const pathToId = new Map<string, string>()
    const diskMetaById = new Map<string, DiskSessionMeta>()

    for (const item of diskSessions) {
      diskMetaById.set(item.id, item)
      pathToId.set(this.normalizeSessionPath(item.filePath), item.id)
      if (item.firstMessage) {
        diskTitleById.set(item.id, item.firstMessage)
      }
      if (item.name) {
        diskNameById.set(item.id, item.name)
      }
    }

    const titleById = new Map<string, string>()
    for (const item of diskSessions) {
      titleById.set(item.id, (item.name || item.firstMessage || '新会话').slice(0, 48))
    }
    for (const [id, active] of this.activeSessions.entries()) {
      const liveTitle = this.resolveLiveSessionTitle(id, active)
      titleById.set(id, liveTitle)
      const sessionFile = active.session.sessionManager.getSessionFile()
      if (sessionFile) {
        pathToId.set(this.normalizeSessionPath(sessionFile), id)
      }
    }

    for (const [id, active] of this.activeSessions.entries()) {
      const messageCount = active.session.agent.state.messages?.length ?? 0
      if (messageCount === 0) continue
      const liveName = (() => {
        try {
          return active.session.sessionManager.getSessionName()
        } catch {
          return undefined
        }
      })()
      const headerParentPath = active.session.sessionManager.getHeader()?.parentSession
      const branchState = this.inspectBranchForkState(active.session.sessionManager)
      const diskMeta = diskMetaById.get(id)
      const resolvedParentId =
        branchState.forkData?.parentSessionId ??
        (headerParentPath ? pathToId.get(this.normalizeSessionPath(headerParentPath)) : undefined) ??
        diskMeta?.forkParentId
      const isFork = Boolean(resolvedParentId || headerParentPath || branchState.forkData || diskMeta?.parentSessionPath)
      const resolvedParentTitle = resolvedParentId
        ? (titleById.get(resolvedParentId) ?? branchState.forkData?.parentSessionTitle ?? diskMeta?.forkParentTitle)
        : (branchState.forkData?.parentSessionTitle ?? diskMeta?.forkParentTitle)
      const rawBranchMsg = branchState.firstBranchMessage ?? diskMeta?.firstBranchMessage

      result.push({
        id,
        title: (liveName || active.title || diskTitleById.get(id) || '新会话').slice(0, 48),
        name: liveName ?? diskNameById.get(id),
        createdAt: active.createdAt,
        updatedAt: active.updatedAt,
        cwd: active.cwd,
        model: active.modelId,
        isRunning: active.isRunning ?? false,
        ...(isFork
          ? {
              parentSessionId: resolvedParentId,
              parentSessionTitle: resolvedParentTitle,
              firstBranchMessage: rawBranchMsg ? rawBranchMsg.slice(0, 64) : undefined
            }
          : {})
      })
      seen.add(id)
    }

    for (const item of diskSessions) {
      if (!seen.has(item.id)) {
        if (item.messageCount === 0) continue
        const resolvedParentId =
          item.forkParentId ??
          (item.parentSessionPath ? pathToId.get(this.normalizeSessionPath(item.parentSessionPath)) : undefined)
        const isFork = Boolean(resolvedParentId || item.parentSessionPath || item.forkParentTitle)
        const resolvedParentTitle = resolvedParentId
          ? (titleById.get(resolvedParentId) ?? item.forkParentTitle)
          : item.forkParentTitle

        result.push({
          id: item.id,
          title: (item.name || item.firstMessage || '新会话').slice(0, 48),
          name: item.name,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          cwd: item.cwd,
          model: item.model,
          ...(isFork
            ? {
                parentSessionId: resolvedParentId,
                parentSessionTitle: resolvedParentTitle,
                firstBranchMessage: item.firstBranchMessage ? item.firstBranchMessage.slice(0, 64) : undefined
              }
            : {})
        })
        seen.add(item.id)
      }
    }

    return result.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  public resolveApproval(
    requestId: string,
    decision: 'allow' | 'always' | 'deny',
    pattern?: string
  ): boolean {
    return this.permissionEngine.resolveApproval(requestId, decision, pattern)
  }

  public setPermissionMode(sessionId: string, mode: PermissionMode): void {
    // Normalize legacy aliases ('full'→'auto', 'restricted'→'default',
    // 'readonly' preserved) so the persisted value round-trips cleanly.
    const normalized = parseMode(mode)
    this.store.set('agent_permission_mode', normalized)
    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.permissionMode = normalized
    }
  }

  public getPermissionMode(sessionId?: string): PermissionMode {
    if (sessionId) {
      const active = this.activeSessions.get(sessionId)
      if (active) return active.permissionMode
    }
    return this.getStoredPermissionMode()
  }

  public async setModel(sessionId: string, modelId: string, providerId?: string): Promise<void> {
    if (!this.modelRuntime) {
      await this.init()
    }
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    const prov = providerId || (this.store.get('agent_active_provider') as string) || this.defaultProvider
    if (this.isProviderDisabled(prov)) {
      throw new Error(`供应商 ${prov} 已停用`)
    }
    const modelObj = runtime.getModel(prov, modelId)
    if (!modelObj) {
      throw new Error(`找不到模型 ${prov}:${modelId}`)
    }

    this.store.set('agent_active_provider', prov)
    this.store.set('agent_active_model', modelId)
    this.pushRecentModel(prov, modelId)

    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.modelId = modelId
      active.providerId = prov
      await active.session.setModel(modelObj, { persist: true })
    }
    this.sendRuntimeChanged('model')
  }

  public getRuntimeSnapshot(sessionId?: string): AgentRuntimeSnapshot {
    const providers = this.buildProviders()
    const active = this.getActiveModelInfo(sessionId)
    const status = this.getSessionStatus(sessionId)
    return {
      providers,
      active,
      favorites: this.getFavoriteModels(),
      recent: this.getRecentModels(),
      context: status?.context ?? null,
      stats: status?.stats ?? null
    }
  }

  public getSessionStatus(sessionId?: string): AgentSessionStatus | null {
    const active = this.getActiveModelInfo(sessionId)
    const session = this.resolveSession(sessionId)
    if (!session) {
      return { active, context: null, stats: null, compaction: null }
    }
    let context: AgentContextUsage | null = null
    try {
      const usage = session.getContextUsage()
      context = usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : null
    } catch {
      context = null
    }
    let stats: AgentSessionStats | null = null
    try {
      const raw = session.getSessionStats()
      stats = {
        input: raw.tokens.input,
        output: raw.tokens.output,
        cacheRead: raw.tokens.cacheRead,
        cacheWrite: raw.tokens.cacheWrite,
        total: raw.tokens.total,
        cost: raw.cost
      }
    } catch {
      stats = null
    }
    let compaction: AgentSessionStatus['compaction'] = null
    try {
      const cs = session.settingsManager?.getCompactionSettings(session.model ?? undefined)
      compaction = {
        enabled: session.autoCompactionEnabled,
        isCompacting: session.isCompacting,
        reserveTokens: cs?.reserveTokens ?? 0,
        keepRecentTokens: cs?.keepRecentTokens ?? 0
      }
    } catch {
      compaction = null
    }
    return { active, context, stats, compaction }
  }

  public async compactSession(sessionId: string, instructions?: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active) throw new Error(`Cannot compact inactive session: ${sessionId}`)
    await active.session.compact(instructions)
  }

  public setAutoCompaction(sessionId: string, enabled: boolean): AgentSessionStatus | null {
    const active = this.activeSessions.get(sessionId)
    if (!active) return null
    active.session.setAutoCompactionEnabled(enabled)
    return this.getSessionStatus(sessionId)
  }

  public getCompressionConfig(): CompressionConfig {
    const stored = this.store.get(COMPRESSION_STORE_KEY) as Partial<CompressionConfig> | undefined
    return { ...DEFAULT_COMPRESSION_CONFIG, ...(stored && typeof stored === 'object' ? stored : {}) }
  }

  public setCompressionConfig(patch: Partial<CompressionConfig>): CompressionConfig {
    const next = { ...this.getCompressionConfig(), ...patch }
    this.store.set(COMPRESSION_STORE_KEY, next)
    return next
  }

  public setThinkingLevel(sessionId: string, level: AgentThinkingLevel): AgentActiveModel {
    const session = this.resolveSession(sessionId)
    if (!session) {
      // No live session yet: remember the choice so the next session starts with it.
      // The SDK clamps it to the model's supported levels when the session is created.
      this.store.set('agent_thinking_level', level)
      return this.getActiveModelInfo(sessionId)
    }
    session.setThinkingLevel(level as ThinkingLevel, { persist: true })
    this.store.set('agent_thinking_level', session.thinkingLevel)
    return this.getActiveModelInfo(sessionId)
  }

  public startProviderLogin(providerId: string, type: AgentAuthType): AgentAuthOperation {
    const operation = this.authController.start(providerId, type)
    this.sendRuntimeChanged('login')
    return operation
  }

  public respondProviderAuth(operationId: string, value: string): AgentAuthOperation {
    const operation = this.authController.respond(operationId, value)
    this.sendRuntimeChanged('login')
    return operation
  }

  public cancelProviderAuth(operationId: string): AgentAuthOperation {
    return this.authController.cancel(operationId)
  }

  public listAuthOperations(): AgentAuthOperation[] {
    return this.authController.list()
  }

  public async logoutProvider(providerId: string): Promise<AgentRuntimeSnapshot> {
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    await runtime.logout(providerId)
    await runtime.refresh({ allowNetwork: false, providers: [providerId] })
    this.sendRuntimeChanged('logout')
    return this.getRuntimeSnapshot()
  }

  public async refreshProviderModels(providerId: string): Promise<AgentRuntimeSnapshot> {
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    if (providerId === MAGPIE_PROVIDER.providerId) {
      const models = await MAGPIE_PROVIDER.fetchModels()
      await this.applyGatewayCatalog(MAGPIE_PROVIDER, models, true)
      return this.getRuntimeSnapshot()
    }
    // User-defined gateways go through the same catalog flow as the built-in
    // magpie provider so /models results get enriched and persisted.
    const custom = this.listCustomGateways().find((item) => item.providerId === providerId)
    if (custom) {
      const gateway = this.createCustomGateway(custom)
      const models = await gateway.fetchModels()
      if (models.length === 0) {
        throw new Error(`刷新 ${providerId} 模型失败：未获取到任何模型`)
      }
      await this.applyGatewayCatalog(gateway, models, true)
      return this.getRuntimeSnapshot()
    }
    const result = await runtime.refresh({ allowNetwork: true, force: true, providers: [providerId] })
    const error = result.errors.get(providerId)
    if (error) throw new Error(`刷新 ${providerId} 模型失败：${safeError(error)}`)
    // 内置供应商手动刷新成功后，目录同样视为权威，修剪已消失模型的收藏/最近。
    this.pruneCatalogedKeys(providerId, new Set(runtime.getModels(providerId).map((m) => m.id)))
    this.sendRuntimeChanged('refresh')
    return this.getRuntimeSnapshot()
  }

  public async getProviderQuotas(
    providerIds?: string[],
    force = false
  ): Promise<Record<string, AgentProviderQuota>> {
    const targets = this.buildQuotaTargets(providerIds)
    return this.quotaService.fetchAll(targets, { force })
  }

  public async refreshProviderQuota(
    providerId: string,
    force = true
  ): Promise<AgentProviderQuota | null> {
    const [target] = this.buildQuotaTargets([providerId])
    if (!target) return null
    return this.quotaService.fetchForProvider(target, { force })
  }

  private buildQuotaTargets(filterIds?: string[]): QuotaTargetProvider[] {
    const runtime = this.modelRuntime
    if (!runtime) return []
    const filter = filterIds ? new Set(filterIds) : null
    const customMap = new Map(this.listCustomGateways().map((c) => [c.providerId, c]))
    const disabledSet = this.getDisabledProviderIds()
    const targets: QuotaTargetProvider[] = []

    for (const provider of runtime.getProviders()) {
      // Magpie is a local pass-through gateway: upstream account quotas are
      // managed inside the gateway itself, so there is nothing meaningful to query here.
      if (provider.id === MAGPIE_PROVIDER.providerId) continue
      if (filter && !filter.has(provider.id)) continue
      if (disabledSet.has(provider.id)) continue
      const status = runtime.getProviderAuthStatus(provider.id)
      const isCustom = customMap.has(provider.id)
      const configured =
        status.configured ||
        isCustom ||
        runtime.getModels(provider.id).length > 0
      const authType = status.configured
        ? runtime.isUsingOAuth(provider.id)
          ? 'oauth'
          : 'api_key'
        : undefined
      targets.push({
        id: provider.id,
        name: provider.name || provider.id,
        baseUrl: provider.baseUrl,
        configured,
        isCustom,
        isSubscription: Boolean(provider.auth.oauth?.isSubscription),
        authType,
        customSpec: customMap.get(provider.id)
      })
    }
    return targets
  }

  private sendProviderQuotaUpdated(quota: AgentProviderQuota): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:provider-quota-updated', { quota })
    }
  }

  public async setProviderBaseUrl(providerId: string, baseUrl: string | null): Promise<AgentRuntimeSnapshot> {
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    const provider = runtime.getProvider(providerId)
    if (!provider) throw new Error(`供应商不存在：${providerId}`)

    const customList = this.listCustomGateways()
    const isCustom = customList.some((item) => item.providerId === providerId)
    const isMagpie = providerId === MAGPIE_PROVIDER.providerId
    const canEdit = isCustom || isMagpie || Boolean(provider.auth.apiKey)
    if (!canEdit) {
      throw new Error('该供应商不支持修改端点')
    }

    const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '')
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      throw new Error('baseUrl 需要以 http:// 或 https:// 开头')
    }

    if (isCustom) {
      const list = customList.map((item) =>
        item.providerId === providerId ? { ...item, baseUrl: trimmed || item.baseUrl } : item
      )
      this.store.set(CUSTOM_GATEWAYS_STORE_KEY, list)
      const updated = list.find((item) => item.providerId === providerId)
      if (updated) {
        await this.registerCustomGateway(updated, { syncRemoteCatalog: false })
      }
    }

    await this.writeProviderBaseUrlOverride(providerId, trimmed || null)
    this.quotaService.invalidate(providerId)
    await runtime.refresh({ allowNetwork: false, force: true, providers: [providerId] })
    this.sendRuntimeChanged('refresh')
    return this.getRuntimeSnapshot()
  }

  /**
   * Merge `{ providers: { [id]: { baseUrl } } }` into models.json. A null
   * baseUrl removes the override (and the provider block if it becomes
   * empty). Preserves every other provider/model entry untouched.
   */
  private async writeProviderBaseUrlOverride(providerId: string, baseUrl: string | null): Promise<void> {
    const path = join(this.agentDir, 'models.json')
    let doc: { providers?: Record<string, Record<string, unknown>> } & Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as typeof doc
      if (parsed && typeof parsed === 'object') doc = parsed
    } catch {
      doc = {}
    }
    const providers = { ...(doc.providers ?? {}) }
    const entry = { ...(providers[providerId] ?? {}) }
    if (baseUrl) entry.baseUrl = baseUrl
    else delete entry.baseUrl
    if (Object.keys(entry).length > 0) providers[providerId] = entry
    else delete providers[providerId]
    doc.providers = providers
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(doc, null, 2), 'utf8')
  }

  public dispose(): void {
    for (const timer of this.pendingMessageUpdates.values()) {
      clearTimeout(timer.timer)
    }
    this.pendingMessageUpdates.clear()
    for (const entry of this.activeSessions.values()) {
      try {
        entry.unsubscribe()
      } catch {
        // intentionally ignored
      }
      try {
        entry.session.dispose()
      } catch {
        // intentionally ignored
      }
    }
    this.activeSessions.clear()
    this.sessionMetaCache.clear()
    this.sessionFilePathCache.clear()
    this.authController.dispose()
    this.permissionEngine.dispose()
    void this.modelRuntime?.settleCredentialWrites().catch(() => undefined)
  }

  private resolveSession(sessionId?: string): AgentSession | null {
    if (sessionId !== undefined) {
      return sessionId ? (this.activeSessions.get(sessionId)?.session ?? null) : null
    }
    const current = this.store.get('agent_current_session')
    if (typeof current === 'string') {
      const entry = this.activeSessions.get(current)
      if (entry) return entry.session
    }
    return this.activeSessions.values().next().value?.session ?? null
  }

  private getActiveModelInfo(sessionId?: string): AgentActiveModel {
    const session = this.resolveSession(sessionId)
    let storedProvider = (this.store.get('agent_active_provider') as string) || this.defaultProvider
    let storedModel = (this.store.get('agent_active_model') as string) || this.defaultModel
    if (this.isProviderDisabled(storedProvider)) {
      const fallback = this.firstEnabledModel()
      if (fallback) {
        storedProvider = fallback.providerId
        storedModel = fallback.modelId
        this.store.set('agent_active_provider', storedProvider)
        this.store.set('agent_active_model', storedModel)
      }
    }
    const providerId = session?.model?.provider ?? storedProvider
    const modelId = session?.model?.id ?? storedModel
    const modelName =
      session?.model?.name || this.modelRuntime?.getModel(providerId, modelId)?.name || modelId

    let availableThinkingLevels: AgentThinkingLevel[] = []
    let supportsThinking = false
    let thinkingLevel: AgentThinkingLevel = this.getStoredThinkingLevel() as AgentThinkingLevel
    if (session) {
      try {
        availableThinkingLevels = session.getAvailableThinkingLevels() as AgentThinkingLevel[]
        supportsThinking = session.supportsThinking()
        thinkingLevel = session.thinkingLevel as AgentThinkingLevel
      } catch {
        availableThinkingLevels = []
      }
    }
    if (!availableThinkingLevels.length) {
      const model = this.modelRuntime?.getModel(providerId, modelId)
      availableThinkingLevels = this.levelsForModel(model)
      supportsThinking = availableThinkingLevels.length > 1 || Boolean(model?.reasoning)
      thinkingLevel = availableThinkingLevels.includes(thinkingLevel) ? thinkingLevel : availableThinkingLevels[0]
    }

    return {
      providerId,
      modelId,
      modelName,
      thinkingLevel,
      availableThinkingLevels,
      supportsThinking
    }
  }

  private buildProviders(): AgentProvider[] {
    const runtime = this.modelRuntime
    if (!runtime) return []
    const disabledSet = this.getDisabledProviderIds()
    const availableKeys = new Set(runtime.getAvailableSnapshot().map((model) => `${model.provider}:${model.id}`))
    const customMap = new Map(this.listCustomGateways().map((c) => [c.providerId, c]))

    return runtime.getProviders().map((provider) => {
      const disabled = disabledSet.has(provider.id)
      const status = runtime.getProviderAuthStatus(provider.id)
      const custom = customMap.get(provider.id)
      const isCustom = Boolean(custom)
      const models: AgentProviderModel[] = runtime.getModels(provider.id).map((model) => ({
        providerId: model.provider,
        id: model.id,
        name: model.name || model.id,
        available: !disabled && availableKeys.has(`${model.provider}:${model.id}`),
        reasoning: model.reasoning,
        input: model.input.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image'),
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        thinkingLevels: this.levelsForModel(model)
      }))
      const configured = status.configured || models.some((model) => model.available)
      const authType: AgentAuthType | undefined = configured
        ? runtime.isUsingOAuth(provider.id)
          ? 'oauth'
          : 'api_key'
        : undefined
      const defaultBaseUrl = this.defaultBaseUrls.get(provider.id)
      const effectiveBaseUrl = custom?.baseUrl ?? provider.baseUrl
      const endpointEditable =
        isCustom || provider.id === MAGPIE_PROVIDER.providerId || Boolean(provider.auth.apiKey)
      return {
        id: provider.id,
        name: provider.name || provider.id,
        ...(effectiveBaseUrl ? { baseUrl: effectiveBaseUrl } : {}),
        ...(defaultBaseUrl ? { defaultBaseUrl } : {}),
        ...(custom?.api ? { api: custom.api } : {}),
        ...(isCustom ? { isCustom: true } : {}),
        ...(custom?.presetId ? { presetId: custom.presetId } : {}),
        ...(endpointEditable ? { endpointEditable: true } : {}),
        ...(custom?.balanceUrl ? { balanceUrl: custom.balanceUrl } : {}),
        ...(custom?.balancePath ? { balancePath: custom.balancePath } : {}),
        ...(custom?.apiKey && custom.apiKey !== 'custom-gateway' ? { hasStoredApiKey: true } : {}),
        configured,
        ...(authType ? { authType } : {}),
        ...(status.source ? { authSource: status.source } : {}),
        ...(status.label ? { authLabel: status.label } : {}),
        apiKeyAvailable: Boolean(provider.auth.apiKey?.login),
        oauthAvailable: Boolean(provider.auth.oauth),
        ...(provider.auth.oauth?.name ? { oauthName: provider.auth.oauth.name } : {}),
        ...(provider.auth.oauth?.loginLabel ? { oauthLoginLabel: provider.auth.oauth.loginLabel } : {}),
        ...(provider.auth.oauth?.isSubscription ? { isSubscription: true } : {}),
        modelCount: models.length,
        availableModelCount: models.filter((model) => model.available).length,
        models,
        disabled
      }
    })
  }

  /** Compute the thinking levels a model actually accepts, mirroring pi's
   * getSupportedThinkingLevels: reasoning models get all levels through high
   * unless thinkingLevelMap marks a level null; xhigh/max are opt-in. */
  private levelsForModel(model: Model<Api> | undefined): AgentThinkingLevel[] {
    if (!model?.reasoning) return ['off']
    const order: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    const map = model.thinkingLevelMap as Partial<Record<AgentThinkingLevel, string | null>> | undefined
    return order.filter((level) => {
      const mapped = map?.[level]
      if (mapped === null) return false
      if (level === 'xhigh' || level === 'max') return mapped !== undefined
      return true
    })
  }

  private getDisabledProviderIds(): Set<string> {
    const raw = this.store.get(DISABLED_PROVIDERS_STORE_KEY)
    if (!Array.isArray(raw)) return new Set()
    return new Set(raw.filter((value): value is string => typeof value === 'string'))
  }

  private isProviderDisabled(providerId: string): boolean {
    return this.getDisabledProviderIds().has(providerId)
  }

  private firstEnabledModel(): { providerId: string; modelId: string } | null {
    const runtime = this.modelRuntime
    if (!runtime) return null
    const disabled = this.getDisabledProviderIds()
    for (const model of runtime.getAvailableSnapshot()) {
      if (!disabled.has(model.provider)) return { providerId: model.provider, modelId: model.id }
    }
    return null
  }

  private getFavoriteModelKeys(): Set<string> {
    const raw = this.store.get(FAVORITE_MODELS_STORE_KEY)
    if (!Array.isArray(raw)) return new Set()
    return new Set(
      raw.filter((value): value is string => typeof value === 'string' && value.includes(':'))
    )
  }

  private getRecentModelKeys(): string[] {
    const raw = this.store.get(RECENT_MODELS_STORE_KEY)
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const result: string[] = []
    for (const value of raw) {
      if (typeof value !== 'string' || !value.includes(':')) continue
      if (seen.has(value)) continue
      seen.add(value)
      result.push(value)
    }
    return result
  }

  private getRecentModels(): AgentFavoriteModel[] {
    const runtime = this.modelRuntime
    if (!runtime) return []
    const disabled = this.getDisabledProviderIds()
    const result: AgentFavoriteModel[] = []
    for (const key of this.getRecentModelKeys()) {
      const sep = key.indexOf(':')
      const providerId = key.slice(0, sep)
      const modelId = key.slice(sep + 1)
      if (!providerId || !modelId || disabled.has(providerId)) continue
      if (!runtime.getModel(providerId, modelId)) continue
      result.push({ providerId, modelId })
    }
    return result
  }

  private pushRecentModel(providerId: string, modelId: string): void {
    const key = `${providerId}:${modelId}`
    const next = [key, ...this.getRecentModelKeys().filter((entry) => entry !== key)]
    this.store.set(RECENT_MODELS_STORE_KEY, next.slice(0, RECENT_MODELS_LIMIT))
  }

  public getFavoriteModels(): AgentFavoriteModel[] {
    const runtime = this.modelRuntime
    if (!runtime) return []
    const disabled = this.getDisabledProviderIds()
    const result: AgentFavoriteModel[] = []
    for (const key of this.getFavoriteModelKeys()) {
      const sep = key.indexOf(':')
      const providerId = key.slice(0, sep)
      const modelId = key.slice(sep + 1)
      if (!providerId || !modelId || disabled.has(providerId)) continue
      if (!runtime.getModel(providerId, modelId)) continue
      result.push({ providerId, modelId })
    }
    return result
  }

  public setProviderDisabled(providerId: string, disabled: boolean): AgentRuntimeSnapshot {
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    if (!runtime.getProvider(providerId)) throw new Error(`供应商不存在：${providerId}`)
    const set = this.getDisabledProviderIds()
    if (disabled) set.add(providerId)
    else set.delete(providerId)
    this.store.set(DISABLED_PROVIDERS_STORE_KEY, [...set])
    if (disabled) {
      // 停用只是视图开关，不触碰收藏/最近数据：它们是用户意图，重新启用后应原样恢复。
      // 模型确实消失的清理由目录刷新成功后的 pruneCatalogedKeys 负责。
      const activeProvider = (this.store.get('agent_active_provider') as string) || this.defaultProvider
      if (activeProvider === providerId) {
        const fallback = this.firstEnabledModel()
        if (fallback) {
          this.store.set('agent_active_provider', fallback.providerId)
          this.store.set('agent_active_model', fallback.modelId)
        }
      }
    }
    this.sendRuntimeChanged('refresh')
    return this.getRuntimeSnapshot()
  }

  /**
   * 单键增量收藏开关。刻意的宽松写入：不按停用状态、也不按当前目录存在性过滤——
   * 收藏是用户意图数据，只有「实时目录刷新成功」后的 pruneCatalogedKeys 才有权删除。
   * 全量覆盖式写入会把停用供应商期间看不到的 key 静默冲掉，故不提供该语义。
   */
  public setModelFavorite(providerId: string, modelId: string, favored: boolean): AgentRuntimeSnapshot {
    if (!providerId || !modelId) return this.getRuntimeSnapshot()
    const key = `${providerId}:${modelId}`
    const keys = this.getFavoriteModelKeys()
    if (favored) keys.add(key)
    else keys.delete(key)
    this.store.set(FAVORITE_MODELS_STORE_KEY, [...keys])
    this.sendRuntimeChanged('refresh')
    return this.getRuntimeSnapshot()
  }

  /**
   * 目录刷新权威成功后修剪死键：把该供应商已不在新目录中的收藏/最近删除。
   * 仅在拿到真实成功目录的前提下调用——启动加载本地缓存、刷新失败、
   * 空目录兜底都不允许触发，避免把"暂时拿不到"误判成"模型已消失"。
   */
  private pruneCatalogedKeys(providerId: string, validModelIds: Set<string>): void {
    const prefix = `${providerId}:`
    const keep = (key: string): boolean =>
      !key.startsWith(prefix) || validModelIds.has(key.slice(prefix.length))
    const favorites = [...this.getFavoriteModelKeys()].filter(keep)
    if (favorites.length !== this.getFavoriteModelKeys().size) {
      this.store.set(FAVORITE_MODELS_STORE_KEY, favorites)
    }
    const recents = this.getRecentModelKeys().filter(keep)
    if (recents.length !== this.getRecentModelKeys().length) {
      this.store.set(RECENT_MODELS_STORE_KEY, recents)
    }
  }

  public removeRecentModels(items: AgentFavoriteModel[]): AgentRuntimeSnapshot {
    if (!Array.isArray(items)) return this.getRuntimeSnapshot()
    const removals = new Set(
      items
        .filter((item) => item && typeof item.providerId === 'string' && typeof item.modelId === 'string')
        .map((item) => `${item.providerId}:${item.modelId}`)
    )
    const next = this.getRecentModelKeys().filter((key) => !removals.has(key))
    this.store.set(RECENT_MODELS_STORE_KEY, next)
    this.sendRuntimeChanged('refresh')
    return this.getRuntimeSnapshot()
  }

  public listProviders(): ProviderListItem[] {
    if (!this.modelRegistry) return []

    return this.modelRegistry.getAll().length > 0 ? this.listProviderItems() : []
  }

  private listProviderItems(): ProviderListItem[] {
    if (!this.modelRuntime) return []
    return this.modelRuntime.getProviders().map((provider) => {
      const status = this.modelRuntime!.getProviderAuthStatus(provider.id)
      return {
        providerId: provider.id,
        displayName: provider.name || provider.id,
        configured: status.configured,
        authStatus: {
          ok: status.configured,
          error: status.configured ? undefined : status.label
        },
        models: this.modelRuntime!.getModels(provider.id).map((model) => model.id)
      }
    })
  }

  /**
   * List Agent Skills discoverable from a workspace — SKILL.md packages in
   * `skills/`, `.agents/skills`, `.claude/skills` and the agent dir's global
   * skills. Loads a throwaway resource loader per call so it always reflects
   * the on-disk state, not a stale session snapshot.
   */
  public async listSkills(cwd?: string): Promise<Array<{ name: string; description: string; filePath: string; disableModelInvocation: boolean }>> {
    const resolvedCwd = cwd && cwd.trim() ? cwd.trim() : this.activeSessions.values().next().value?.cwd ?? process.cwd()
    const loader = new AgentResourceLoader({ cwd: resolvedCwd, agentDir: this.agentDir, extraSkillDirs: this.getExtraSkillDirs() })
    try {
      await loader.reload()
    } catch {
      return []
    }
    return loader.getSkills().skills.map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
      disableModelInvocation: s.disableModelInvocation
    }))
  }

  public async setCredential(
    providerId: string,
    cred: { type: 'api_key'; key: string; env?: string }
  ): Promise<void> {
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    const provider = runtime.getProvider(providerId)
    if (!provider) throw new Error(`供应商不存在：${providerId}`)
    if (!provider.auth.apiKey?.login) throw new Error(`${provider.name || providerId} 不支持 API Key 登录`)
    const key = cred.key.trim()
    if (!key) throw new Error('API Key 不能为空')

    // Direct key entry replaces the legacy interactive key dialog; clear any
    // abandoned auth flow for this provider so it stops showing as 认证中.
    this.authController.cancelActive(providerId)

    redactCredential(key)
    await runtime.login(providerId, 'api_key', {
      prompt: async () => key,
      notify: () => undefined
    })
    await runtime.refresh({ allowNetwork: false, providers: [providerId] })
    this.sendRuntimeChanged('login')
  }

  public async deleteCredential(providerId: string): Promise<void> {
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    await runtime.logout(providerId)
    await runtime.refresh({ allowNetwork: false, providers: [providerId] })
    this.sendRuntimeChanged('logout')
  }

  public getActiveModel(): { providerId: string; modelId: string; baseUrl?: string } {
    let prov = (this.store.get('agent_active_provider') as string) || this.defaultProvider
    let mod = (this.store.get('agent_active_model') as string) || this.defaultModel
    if (this.isProviderDisabled(prov)) {
      const fallback = this.firstEnabledModel()
      if (fallback) {
        prov = fallback.providerId
        mod = fallback.modelId
      }
    }
    const modelObj = this.modelRegistry?.find(prov, mod) as (AnyModel & { baseUrl?: string }) | undefined

    return {
      providerId: prov,
      modelId: mod,
      baseUrl:
        modelObj?.baseUrl ?? (prov === MAGPIE_PROVIDER.providerId ? MAGPIE_PROVIDER.baseUrl : undefined)
    }
  }


  public getAgentDir(): string {
    return this.agentDir
  }

  public getSkillDirCandidates(): Array<{ path: string; exists: boolean; isDefault: boolean }> {
    return this.skillDirCandidates.map((path, i) => ({
      path,
      exists: existsSync(path),
      isDefault: i === 0
    }))
  }

  public getExtraSkillDirs(): string[] {
    const list = this.store.get('agent_extra_skill_dirs')
    return Array.isArray(list) ? (list as string[]) : []
  }

  public setExtraSkillDirs(dirs: string[]): void {
    const clean = dirs.map((d) => d.trim()).filter(Boolean)
    this.store.set('agent_extra_skill_dirs', clean)
  }

  public getAllowlist(): ReturnType<PermissionEngine['getAllowlist']> {
    return this.permissionEngine.getAllowlist()
  }

  public addAllowlistEntry(tool: string, pattern: string): ReturnType<PermissionEngine['addAllowlistEntry']> {
    return this.permissionEngine.addAllowlistEntry(tool, pattern)
  }

  public removeAllowlistEntry(id: string): void {
    this.permissionEngine.removeAllowlistEntry(id)
  }
}
