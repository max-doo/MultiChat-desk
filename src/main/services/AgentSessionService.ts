import { mkdir, readFile, readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'
import type { WebContents } from 'electron'
import type Store from 'electron-store'
import type {
  createAgentSession as createAgentSessionFn,
  ModelRegistry as ModelRegistryType,
  ModelRuntime as ModelRuntimeType,
  SessionManager as SessionManagerType,
  AgentSession,
  AgentSessionEvent,
  ProviderModelConfig
} from '@earendil-works/pi-coding-agent'
import type { AnyModel, Model, Api, ThinkingLevel } from '@earendil-works/pi-ai'
import { PermissionEngine, type PermissionMode, type ApprovalRequest } from './PermissionEngine'
import { AgentResourceLoader } from './AgentResourceLoader'
import { excludedShellTools, shellEnvironmentPrompt, shellToolForPlatform, shellToolModifiers } from './shell'
import { MAGPIE_PROVIDER } from './customGatewayProvider'
import { ProviderAuthController } from './ProviderAuthController'
import { safeError } from './redact'
import type {
  AgentActiveModel,
  AgentAuthOperation,
  AgentAuthType,
  AgentContextUsage,
  AgentProvider,
  AgentProviderModel,
  AgentRuntimeSnapshot,
  AgentSessionStats,
  AgentSessionStatus,
  AgentThinkingLevel
} from '../../shared/types/agentRuntime'

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

interface PiModule {
  createAgentSession: typeof createAgentSessionFn
  ModelRegistry: typeof ModelRegistryType
  ModelRuntime: typeof ModelRuntimeType
  SessionManager: typeof SessionManagerType
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
  unsubscribe: () => void
}

export interface SessionListItem {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  cwd?: string
  model?: string
}

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
  'compaction_end',
  'thinking_level_changed',
  'model_select'
])

export class AgentSessionService {
  private sessionsDir: string
  private agentDir: string
  private skillDirCandidates: string[]
  private permissionEngine: PermissionEngine
  private authController: ProviderAuthController
  private pi: PiModule | null = null
  private modelRuntime: ModelRuntimeType | null = null
  private modelRegistry: ModelRegistryType | null = null
  private activeSessions = new Map<string, ActiveSessionEntry>()

  // Default fallback provider & model for local SWE-2 / Devin
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

    this.permissionEngine = new PermissionEngine(store, (req: ApprovalRequest) => {
      this.sendApprovalRequest(req)
    })
    this.authController = new ProviderAuthController(
      () => this.modelRuntime,
      (operation: AgentAuthOperation) => this.sendAuthOperation(operation)
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
        SessionManager: mod.SessionManager
      }
    }
    return this.pi
  }

  private piShellConfig: { shell: string; args?: string[] } | null = null

  /** Resolve the real shell executable once via pi's own detector; caches the result. */
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

    // Initialize ModelRuntime & ModelRegistry
    this.modelRuntime = await ModelRuntime.create({
      authPath: join(this.agentDir, 'auth.json'),
      modelsPath: join(this.agentDir, 'models.json')
    })
    this.modelRegistry = new ModelRegistry(this.modelRuntime)

    // Ensure the local magpie gateway provider is registered
    await this.ensureMagpieProvider()
  }

  private async ensureMagpieProvider(): Promise<void> {
    if (!this.modelRegistry || !this.modelRuntime) return
    const provider = MAGPIE_PROVIDER
    const registered = this.modelRuntime.getRegisteredProviderConfig(provider.providerId)
    if (!registered) {
      // Seed the catalog from the last persisted fetch so a cold start with
      // the gateway offline still exposes the full model list.
      const stored = await provider.loadStoredModels(this.agentDir)
      this.modelRegistry.registerProvider(provider.providerId, {
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        models: stored.length > 0 ? stored : provider.seedModels
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

  /**
   * Re-register a custom gateway provider with the freshly fetched catalog.
   * registerProvider merges into extensionProviders and recomposes, so the
   * provider's getModels projection picks the new list up immediately —
   * no reliance on pi's refreshModels/publish extension pipeline.
   */
  private async applyGatewayCatalog(
    provider: typeof MAGPIE_PROVIDER,
    models: ProviderModelConfig[]
  ): Promise<void> {
    if (!this.modelRegistry || !this.modelRuntime || models.length === 0) return
    // registerProvider validates the incoming config on its own (not the
    // merged result), so baseUrl must be passed again or the custom-model
    // definitions fail the "baseUrl is required" check.
    this.modelRegistry.registerProvider(provider.providerId, {
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      models
    })
    await this.modelRuntime.refresh({ allowNetwork: false, providers: [provider.providerId] })
    await provider.persistModels(this.agentDir, models).catch(() => undefined)
    this.sendRuntimeChanged('refresh')
  }

  private sendApprovalRequest(request: ApprovalRequest): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:approval-request', request)
    }
  }

  private forwardEvent(sessionId: string, event: AgentSessionEvent): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('agent:event', { sessionId, event })
      if (STATUS_EVENTS.has(event.type)) {
        const status = this.getSessionStatus(sessionId)
        if (status) {
          wc.send('agent:session-status', { sessionId, status })
        }
      }
    }
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

  private getActiveModelObject(providerId?: string, modelId?: string): Model<Api> | undefined {
    if (!this.modelRegistry) return undefined
    const prov = providerId || (this.store.get('agent_active_provider') as string) || this.defaultProvider
    const mod = modelId || (this.store.get('agent_active_model') as string) || this.defaultModel
    return this.modelRegistry.find(prov, mod)
  }

  private getStoredThinkingLevel(): ThinkingLevel {
    const stored = this.store.get('agent_thinking_level')
    const levels: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    return typeof stored === 'string' && levels.includes(stored as AgentThinkingLevel)
      ? (stored as ThinkingLevel)
      : 'medium'
  }

  private wireSession(
    sessionId: string,
    session: AgentSession,
    cwd: string,
    permissionMode: PermissionMode = 'default'
  ): ActiveSessionEntry {
    // Intercept tool calls for permission validation & approvals
    session.agent.beforeToolCall = async (context) => {
      const active = this.activeSessions.get(sessionId)
      const currentMode = active?.permissionMode ?? 'default'

      const check = await this.permissionEngine.checkOrRequestApproval({
        sessionId,
        mode: currentMode,
        toolCallId: context.toolCall.id,
        toolName: context.toolCall.name,
        args: (context.args as Record<string, unknown>) ?? {},
        cwd
      })

      if (!check.allowed) {
        return {
          block: true,
          reason: check.reason || 'Action denied by security policy or user'
        }
      }

      return undefined
    }

    // Subscribe to session events and forward to renderer
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      const active = this.activeSessions.get(sessionId)
      if (active) {
        active.updatedAt = Date.now()
        if (!active.title && event.type === 'message_end' && event.message.role === 'user') {
          const text = this.extractUserText(event.message.content)
          if (text) {
            active.title = text
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

    this.activeSessions.set(sessionId, entry)
    return entry
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
      extraSkillDirs: this.getExtraSkillDirs()
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
      excludeTools: excludedShellTools(),
      tools: shellToolModifiers()
    })

    this.wireSession(sessionId, session, resolvedCwd, 'default')
    this.store.set('agent_current_session', sessionId)

    return { sessionId }
  }

  public async resumeSession(sessionId: string): Promise<Record<string, unknown>> {
    if (!this.modelRegistry || !this.modelRuntime) {
      await this.init()
    }

    // Check if session is already active in memory
    const existing = this.activeSessions.get(sessionId)
    if (existing) {
      return {
        sessionId,
        messages: existing.session.agent.state.messages,
        permissionMode: existing.permissionMode,
        model: existing.modelId,
        provider: existing.providerId,
        cwd: existing.cwd
      }
    }

    const { SessionManager, createAgentSession } = await this.getPi()

    // Otherwise find session file on disk
    let sessionFile: string | undefined
    try {
      const files = await readdir(this.sessionsDir)
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const fullPath = join(this.sessionsDir, file)
        try {
          const content = await readFile(fullPath, 'utf8')
          const firstLine = content.slice(0, content.indexOf('\n'))
          if (firstLine) {
            const header = JSON.parse(firstLine)
            if (header.id === sessionId) {
              sessionFile = fullPath
              break
            }
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

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
      extraSkillDirs: this.getExtraSkillDirs()
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
      excludeTools: excludedShellTools(),
      tools: shellToolModifiers()
    })

    const entry = this.wireSession(sessionId, session, cwd, 'default')
    this.store.set('agent_current_session', sessionId)

    return {
      sessionId,
      messages: session.agent.state.messages,
      permissionMode: entry.permissionMode,
      model: entry.modelId,
      provider: entry.providerId,
      cwd: entry.cwd
    }
  }

  public async prompt(sessionId: string, promptText: string, attachments?: string[]): Promise<void> {
    let active = this.activeSessions.get(sessionId)
    if (!active) {
      await this.resumeSession(sessionId)
      active = this.activeSessions.get(sessionId)
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

    // Execute session prompt asynchronously
    active.session.prompt(finalPrompt).catch((err: Error) => {
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
      await active.session.abort()
    }
  }

  public async deleteSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      try {
        await active.session.abort()
      } catch {
        // ignore
      }
      active.unsubscribe()
      try {
        active.session.dispose()
      } catch {
        // ignore
      }
      this.activeSessions.delete(sessionId)
    }

    try {
      const files = await readdir(this.sessionsDir)
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const fullPath = join(this.sessionsDir, file)
        try {
          const content = await readFile(fullPath, 'utf8')
          const firstLine = content.slice(0, content.indexOf('\n'))
          if (firstLine) {
            const header = JSON.parse(firstLine)
            if (header.id === sessionId) {
              await rm(fullPath, { force: true })
              break
            }
          }
        } catch {
          // ignore unreadable entries
        }
      }
    } catch {
      // ignore
    }

    const current = this.store.get('agent_current_session')
    if (current === sessionId) {
      this.store.delete('agent_current_session')
    }
  }

  public async listSessions(): Promise<SessionListItem[]> {
    await mkdir(this.sessionsDir, { recursive: true })
    const { SessionManager } = await this.getPi()
    const diskSessions = await SessionManager.listAll(this.sessionsDir)

    const result: SessionListItem[] = []
    const seen = new Set<string>()
    const diskTitleById = new Map<string, string>()
    for (const item of diskSessions) {
      if (item.firstMessage) {
        diskTitleById.set(item.id, item.firstMessage)
      }
    }

    // First include active sessions
    for (const [id, active] of this.activeSessions.entries()) {
      const messageCount = active.session.agent.state.messages?.length ?? 0
      if (messageCount === 0) continue
      result.push({
        id,
        title: active.title || diskTitleById.get(id) || '新会话',
        createdAt: active.createdAt,
        updatedAt: active.updatedAt,
        cwd: active.cwd,
        model: active.modelId
      })
      seen.add(id)
    }

    // Then merge with disk sessions
    for (const item of diskSessions) {
      if (!seen.has(item.id)) {
        if (item.messageCount === 0) continue
        result.push({
          id: item.id,
          title: item.firstMessage || '新会话',
          createdAt: new Date(item.created).getTime(),
          updatedAt: new Date(item.modified).getTime(),
          cwd: item.cwd
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
    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.permissionMode = mode
    }
  }

  public async setModel(sessionId: string, modelId: string, providerId?: string): Promise<void> {
    if (!this.modelRuntime) {
      await this.init()
    }
    const runtime = this.modelRuntime
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    const prov = providerId || (this.store.get('agent_active_provider') as string) || this.defaultProvider
    const modelObj = runtime.getModel(prov, modelId)
    if (!modelObj) {
      throw new Error(`找不到模型 ${prov}:${modelId}`)
    }

    this.store.set('agent_active_provider', prov)
    this.store.set('agent_active_model', modelId)

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
      context: status?.context ?? null,
      stats: status?.stats ?? null
    }
  }

  public getSessionStatus(sessionId?: string): AgentSessionStatus | null {
    const active = this.getActiveModelInfo(sessionId)
    const session = this.resolveSession(sessionId)
    if (!session) {
      return { active, context: null, stats: null }
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
    return { active, context, stats }
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
      await this.applyGatewayCatalog(MAGPIE_PROVIDER, models)
      return this.getRuntimeSnapshot()
    }
    const result = await runtime.refresh({ allowNetwork: true, force: true, providers: [providerId] })
    const error = result.errors.get(providerId)
    if (error) throw new Error(`刷新 ${providerId} 模型失败：${safeError(error)}`)
    this.sendRuntimeChanged('refresh')
    return this.getRuntimeSnapshot()
  }

  public dispose(): void {
    this.authController.dispose()
    void this.modelRuntime?.settleCredentialWrites().catch(() => undefined)
  }

  private resolveSession(sessionId?: string): AgentSession | null {
    if (sessionId) {
      const entry = this.activeSessions.get(sessionId)
      if (entry) return entry.session
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
    const storedProvider = (this.store.get('agent_active_provider') as string) || this.defaultProvider
    const storedModel = (this.store.get('agent_active_model') as string) || this.defaultModel
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
      supportsThinking = Boolean(model?.reasoning)
      availableThinkingLevels = supportsThinking ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : ['off']
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
    const availableKeys = new Set(runtime.getAvailableSnapshot().map((model) => `${model.provider}:${model.id}`))
    return runtime.getProviders().map((provider) => {
      const status = runtime.getProviderAuthStatus(provider.id)
      const models: AgentProviderModel[] = runtime.getModels(provider.id).map((model) => ({
        providerId: model.provider,
        id: model.id,
        name: model.name || model.id,
        available: availableKeys.has(`${model.provider}:${model.id}`),
        reasoning: model.reasoning,
        input: model.input.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image'),
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens
      }))
      const configured = status.configured || models.some((model) => model.available)
      const authType: AgentAuthType | undefined = configured
        ? runtime.isUsingOAuth(provider.id)
          ? 'oauth'
          : 'api_key'
        : undefined
      return {
        id: provider.id,
        name: provider.name || provider.id,
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
        models
      }
    })
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
    const prov = (this.store.get('agent_active_provider') as string) || this.defaultProvider
    const mod = (this.store.get('agent_active_model') as string) || this.defaultModel
    const modelObj = this.modelRegistry?.find(prov, mod) as (AnyModel & { baseUrl?: string }) | undefined

    return {
      providerId: prov,
      modelId: mod,
      baseUrl:
        modelObj?.baseUrl ?? (prov === MAGPIE_PROVIDER.providerId ? MAGPIE_PROVIDER.baseUrl : undefined)
    }
  }

  // ── Agent 配置读写（供设置弹窗）────────────────────────────────────────────

  /** The app's own agent dir; `<dir>/skills` is the always-on global skills root. */
  public getAgentDir(): string {
    return this.agentDir
  }

  /** Skill-dir candidates discovered on disk (app dir + common agent-skill dirs). */
  public getSkillDirCandidates(): Array<{ path: string; exists: boolean; isDefault: boolean }> {
    return this.skillDirCandidates.map((path, i) => ({
      path,
      exists: existsSync(path),
      isDefault: i === 0
    }))
  }

  /** Extra skill dirs the user has opted into (persisted). */
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
