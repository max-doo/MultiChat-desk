import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type {
  DefaultResourceLoader as DefaultResourceLoaderType,
  ResourceLoader,
  Skill,
  ResourceDiagnostic
} from '@earendil-works/pi-coding-agent'

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

export interface AgentResourceLoaderOptions {
  cwd: string
  agentDir?: string
}

export class AgentResourceLoader {
  private loader: DefaultResourceLoaderType | null = null
  readonly cwd: string
  readonly agentDir: string

  constructor(options: AgentResourceLoaderOptions) {
    this.cwd = options.cwd
    this.agentDir = options.agentDir ?? join(homedir(), '.pi', 'agent')
  }

  private async ensureLoader(): Promise<DefaultResourceLoaderType> {
    if (this.loader) return this.loader

    const { DefaultResourceLoader } = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
      '@earendil-works/pi-coding-agent'
    )

    const additionalSkillPaths: string[] = []
    const claudeSkillsDir = join(this.cwd, '.claude', 'skills')
    if (existsSync(claudeSkillsDir)) {
      additionalSkillPaths.push(claudeSkillsDir)
    }

    this.loader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      additionalSkillPaths: additionalSkillPaths.length > 0 ? additionalSkillPaths : undefined
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
