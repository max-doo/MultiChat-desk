import { mkdir, readFile, writeFile, readdir } from 'fs/promises'
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
  AgentSessionEvent
} from '@earendil-works/pi-coding-agent'
import type { AnyModel, Model, Api } from '@earendil-works/pi-ai'
import { PermissionEngine, type PermissionMode, type ApprovalRequest } from './PermissionEngine'
import { AgentResourceLoader } from './AgentResourceLoader'
import { excludedShellTools, shellEnvironmentPrompt, shellToolForPlatform } from './shell'

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

export class AgentSessionService {
  private sessionsDir: string
  private agentDir: string
  private skillDirCandidates: string[]
  private permissionEngine: PermissionEngine
  private pi: PiModule | null = null
  private modelRuntime: ModelRuntimeType | null = null
  private modelRegistry: ModelRegistryType | null = null
  private activeSessions = new Map<string, ActiveSessionEntry>()

  // Default fallback provider & model for local SWE-2 / Devin
  private defaultProvider = 'magpie'
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

    // Ensure local Devin / Magpie provider is registered
    this.ensureLocalDevinProvider()
  }

  private ensureLocalDevinProvider(): void {
    if (!this.modelRegistry) return
    const existing = this.modelRegistry.find('magpie', 'devin/swe-2')
    if (!existing) {
      this.modelRegistry.registerProvider('magpie', {
        name: 'Magpie (Local Devin)',
        baseUrl: 'http://127.0.0.1:3425/v1',
        apiKey: 'magpie',
        api: 'openai-completions',
        models: [
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
    }
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
    }
  }

  private getActiveModelObject(providerId?: string, modelId?: string): Model<Api> | undefined {
    if (!this.modelRegistry) return undefined
    const prov = providerId || (this.store.get('agent_active_provider') as string) || this.defaultProvider
    const mod = modelId || (this.store.get('agent_active_model') as string) || this.defaultModel
    return this.modelRegistry.find(prov, mod)
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
      sessionManager,
      resourceLoader: resourceLoader.getRawLoader(),
      excludeTools: excludedShellTools()
    })

    this.wireSession(sessionId, session, resolvedCwd, 'default')

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
      sessionManager,
      resourceLoader: resourceLoader.getRawLoader(),
      excludeTools: excludedShellTools()
    })

    const entry = this.wireSession(sessionId, session, cwd, 'default')

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

  public async listSessions(): Promise<SessionListItem[]> {
    await mkdir(this.sessionsDir, { recursive: true })
    const { SessionManager } = await this.getPi()
    const diskSessions = await SessionManager.listAll(this.sessionsDir)

    const result: SessionListItem[] = []
    const seen = new Set<string>()

    // First include active sessions
    for (const [id, active] of this.activeSessions.entries()) {
      result.push({
        id,
        title: active.title || '新会话',
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
    if (!this.modelRegistry) return
    const prov = providerId || this.defaultProvider
    const modelObj = this.modelRegistry.find(prov, modelId)
    if (!modelObj) {
      throw new Error(`Model ${prov}:${modelId} not found in ModelRegistry`)
    }

    this.store.set('agent_active_provider', prov)
    this.store.set('agent_active_model', modelId)

    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.modelId = modelId
      active.providerId = prov
      await active.session.setModel(modelObj)
    }
  }

  public listProviders(): ProviderListItem[] {
    if (!this.modelRegistry) return []

    const popularProviders = [
      { id: 'magpie', name: 'Magpie (Local Devin)' },
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'openai', name: 'OpenAI' },
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'google', name: 'Google Gemini' },
      { id: 'openrouter', name: 'OpenRouter' },
      { id: 'groq', name: 'Groq' },
      { id: 'xai', name: 'xAI' },
      { id: 'mistral', name: 'Mistral' }
    ]

    const result: ProviderListItem[] = []

    for (const p of popularProviders) {
      const status = this.modelRegistry.getProviderAuthStatus(p.id)
      const models = this.modelRegistry.getModelsOfType('chat', p.id).map((m) => m.id)
      result.push({
        providerId: p.id,
        displayName: p.name,
        configured: status.configured,
        authStatus: {
          ok: status.configured,
          error: status.configured ? undefined : 'Unconfigured'
        },
        models: models.length > 0 ? models : (p.id === 'magpie' ? ['devin/swe-2'] : [])
      })
    }

    return result
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
    if (this.modelRuntime) {
      await this.modelRuntime.setRuntimeApiKey(providerId, cred.key)
    }

    // Persist to ~/.pi/agent/auth.json
    try {
      const authPath = join(this.agentDir, 'auth.json')
      await mkdir(this.agentDir, { recursive: true })
      let authData: Record<string, unknown> = {}
      if (existsSync(authPath)) {
        try {
          authData = JSON.parse(await readFile(authPath, 'utf-8'))
        } catch {
          authData = {}
        }
      }
      authData[providerId] = {
        type: cred.type,
        key: cred.key
      }
      await writeFile(authPath, JSON.stringify(authData, null, 2), 'utf-8')
    } catch (err) {
      console.error('[AgentSessionService] Failed to persist auth.json:', err)
    }
  }

  public async deleteCredential(providerId: string): Promise<void> {
    if (this.modelRuntime) {
      await this.modelRuntime.removeRuntimeApiKey(providerId)
    }

    try {
      const authPath = join(this.agentDir, 'auth.json')
      if (existsSync(authPath)) {
        const authData = JSON.parse(await readFile(authPath, 'utf-8'))
        delete authData[providerId]
        await writeFile(authPath, JSON.stringify(authData, null, 2), 'utf-8')
      }
    } catch (err) {
      console.error('[AgentSessionService] Failed to delete from auth.json:', err)
    }
  }

  public getActiveModel(): { providerId: string; modelId: string; baseUrl?: string } {
    const prov = (this.store.get('agent_active_provider') as string) || this.defaultProvider
    const mod = (this.store.get('agent_active_model') as string) || this.defaultModel
    const modelObj = this.modelRegistry?.find(prov, mod) as (AnyModel & { baseUrl?: string }) | undefined

    return {
      providerId: prov,
      modelId: mod,
      baseUrl: modelObj?.baseUrl ?? (prov === 'magpie' ? 'http://127.0.0.1:3425/v1' : undefined)
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
