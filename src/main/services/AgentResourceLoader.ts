import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type {
  DefaultResourceLoader as DefaultResourceLoaderType,
  ResourceLoader,
  Skill,
  ResourceDiagnostic,
  InlineExtension
} from '@earendil-works/pi-coding-agent'

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

export interface AgentResourceLoaderOptions {
  cwd: string
  agentDir?: string
  appendSystemPrompt?: string[]
  /** Extra skill roots beyond `<agentDir>/skills` and the cwd's own skills dir. */
  extraSkillDirs?: string[]
  /** Inline extensions (e.g. context compression) loaded without a file path. */
  extensionFactories?: InlineExtension[]
}

export class AgentResourceLoader {
  private loader: DefaultResourceLoaderType | null = null
  readonly cwd: string
  readonly agentDir: string

  constructor(options: AgentResourceLoaderOptions) {
    this.cwd = options.cwd
    this.agentDir = options.agentDir ?? join(homedir(), '.pi', 'agent')
    this.appendSystemPromptExtra = options.appendSystemPrompt ?? []
    this.extraSkillDirs = options.extraSkillDirs ?? []
    this.extensionFactories = options.extensionFactories ?? []
  }

  private appendSystemPromptExtra: string[]
  private extraSkillDirs: string[]
  private extensionFactories: InlineExtension[]

  private async ensureLoader(): Promise<DefaultResourceLoaderType> {
    if (this.loader) return this.loader

    const { DefaultResourceLoader } = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
      '@earendil-works/pi-coding-agent'
    )

    const additionalSkillPaths: string[] = this.extraSkillDirs.filter((dir) => existsSync(dir))

    this.loader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      additionalSkillPaths: additionalSkillPaths.length > 0 ? additionalSkillPaths : undefined,
      extensionFactories: this.extensionFactories.length > 0 ? this.extensionFactories : undefined,
      appendSystemPromptOverride: this.appendSystemPromptExtra.length
        ? (base: string[]) => [...base, ...this.appendSystemPromptExtra]
        : undefined
    })

    return this.loader
  }

  public async reload(): Promise<void> {
    const loader = await this.ensureLoader()
    await loader.reload()
  }

  public getRawLoader(): ResourceLoader {
    if (!this.loader) {
      throw new Error('AgentResourceLoader not initialized. Call reload() first.')
    }
    return this.loader
  }

  public getAgentsFiles(): Array<{ path: string; content: string }> {
    if (!this.loader) return []
    const res = this.loader.getAgentsFiles()
    return res.agentsFiles ?? []
  }

  public getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
    if (!this.loader) return { skills: [], diagnostics: [] }
    return this.loader.getSkills()
  }

  public getSystemPrompt(): string | undefined {
    return this.loader?.getSystemPrompt()
  }

  public getAppendSystemPrompt(): string[] {
    return this.loader?.getAppendSystemPrompt() ?? []
  }
}
