import { randomUUID } from 'crypto'
import type { AuthEvent, AuthInteraction, AuthPrompt, AuthType } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type {
  AgentAuthEvent,
  AgentAuthOperation,
  AgentAuthPrompt,
  AgentAuthPromptOption,
  AgentAuthType
} from '../../shared/types/agentRuntime'
import { redactCredential, safeError } from './redact'

interface PendingPrompt {
  id: string
  resolve: (value: string) => void
  reject: (error: Error) => void
  cleanup: () => void
}

interface InternalAuthOperation {
  id: string
  providerId: string
  providerName: string
  type: AgentAuthType
  status: AgentAuthOperation['status']
  prompt?: AgentAuthPrompt
  events: AgentAuthEvent[]
  error?: string
  controller: AbortController
  pending?: PendingPrompt
  cleanupTimer?: NodeJS.Timeout
}

const AUTH_OPERATION_TTL_MS = 10 * 60 * 1000
const MAX_EVENTS = 30
const MAX_MESSAGE_LENGTH = 4000
const MAX_INPUT_LENGTH = 100_000

function truncate(value: string, limit = MAX_MESSAGE_LENGTH): string {
  return value.length > limit ? value.slice(0, limit) : value
}

function safeUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

export class ProviderAuthController {
  private operations = new Map<string, InternalAuthOperation>()

  constructor(
    private getRuntime: () => ModelRuntime | null,
    private onChange: (operation: AgentAuthOperation) => void
  ) {}

  public list(): AgentAuthOperation[] {
    return [...this.operations.values()].map((operation) => this.toView(operation))
  }

  public get(operationId: string): AgentAuthOperation {
    const operation = this.operations.get(operationId)
    if (!operation) throw new Error('授权操作不存在或已过期')
    return this.toView(operation)
  }

  public start(providerId: string, type: AgentAuthType): AgentAuthOperation {
    const runtime = this.getRuntime()
    if (!runtime) throw new Error('Agent 运行时尚未初始化')
    const provider = runtime.getProvider(providerId)
    if (!provider) throw new Error(`供应商不存在：${providerId}`)
    const auth = type === 'api_key' ? provider.auth.apiKey : provider.auth.oauth
    if (!auth?.login) throw new Error(`${provider.name || providerId} 不支持该认证方式`)

    const previous = [...this.operations.values()].find(
      (operation) => operation.providerId === providerId && (operation.status === 'running' || operation.status === 'waiting')
    )
    if (previous) throw new Error('该供应商已有授权操作正在进行')

    const operation: InternalAuthOperation = {
      id: randomUUID(),
      providerId,
      providerName: provider.name || providerId,
      type,
      status: 'running',
      events: [],
      controller: new AbortController()
    }
    this.operations.set(operation.id, operation)
    void this.run(operation)
    this.emit(operation)
    return this.toView(operation)
  }

  public respond(operationId: string, value: string): AgentAuthOperation {
    const operation = this.operations.get(operationId)
    if (!operation) throw new Error('授权操作不存在或已过期')
    if (!operation.pending || !operation.prompt) throw new Error('当前没有等待输入的授权步骤')
    if (value.length > MAX_INPUT_LENGTH) throw new Error('授权输入过长')
    if (operation.prompt.type === 'select') {
      const valid = operation.prompt.options?.some((option) => option.id === value)
      if (!valid) throw new Error('无效的授权选项')
    }
    if (operation.prompt.type === 'secret') redactCredential(value)
    operation.pending.resolve(value)
    return this.toView(operation)
  }

  public cancel(operationId: string): AgentAuthOperation {
    const operation = this.operations.get(operationId)
    if (!operation) throw new Error('授权操作不存在或已过期')
    if (operation.status === 'running' || operation.status === 'waiting') {
      operation.status = 'cancelled'
      operation.prompt = undefined
      operation.controller.abort()
      operation.pending?.reject(new Error('授权已取消'))
      operation.pending?.cleanup()
      operation.pending = undefined
      this.scheduleCleanup(operation)
      this.emit(operation)
    }
    return this.toView(operation)
  }

  public dispose(): void {
    for (const operation of this.operations.values()) {
      operation.controller.abort()
      operation.pending?.reject(new Error('应用正在退出'))
      operation.pending?.cleanup()
      operation.pending = undefined
      if (operation.cleanupTimer) clearTimeout(operation.cleanupTimer)
    }
    this.operations.clear()
  }

  private async run(operation: InternalAuthOperation): Promise<void> {
    const runtime = this.getRuntime()
    if (!runtime) {
      operation.status = 'error'
      operation.error = 'Agent 运行时尚未初始化'
      this.emit(operation)
      return
    }

    try {
      const interaction: AuthInteraction = {
        signal: operation.controller.signal,
        prompt: (prompt) => this.requestPrompt(operation, prompt),
        notify: (event) => this.notify(operation, event)
      }
      const credential = await runtime.login(operation.providerId, operation.type as AuthType, interaction)
      this.rememberCredential(credential)
      operation.controller.signal.throwIfAborted()
      operation.status = 'success'
      await runtime.refresh({ allowNetwork: false, providers: [operation.providerId] })
    } catch (error) {
      this.rememberCredential((error as { credential?: unknown } | null)?.credential)
      if (operation.controller.signal.aborted) {
        operation.status = 'cancelled'
        operation.error = undefined
      } else {
        operation.status = 'error'
        operation.error = truncate(safeError(error))
      }
    } finally {
      operation.pending?.reject(new Error('授权操作已结束'))
      operation.pending?.cleanup()
      operation.pending = undefined
      operation.prompt = undefined
      this.scheduleCleanup(operation)
      this.emit(operation)
    }
  }

  private requestPrompt(operation: InternalAuthOperation, prompt: AuthPrompt): Promise<string> {
    if (operation.controller.signal.aborted) return Promise.reject(new Error('授权已取消'))
    const id = randomUUID()
    const view: AgentAuthPrompt = {
      id,
      type: prompt.type,
      message: truncate(prompt.message),
      ...('placeholder' in prompt && prompt.placeholder ? { placeholder: truncate(prompt.placeholder, 300) } : {}),
      ...('options' in prompt
        ? {
            options: prompt.options.slice(0, 50).map((option): AgentAuthPromptOption => ({
              id: option.id,
              label: truncate(option.label, 300),
              ...(option.description ? { description: truncate(option.description, 1000) } : {})
            }))
          }
        : {})
    }
    operation.prompt = view
    operation.status = 'waiting'
    this.emit(operation)

    return new Promise<string>((resolve, reject) => {
      const abort = (): void => {
        if (operation.pending?.id !== id) return
        operation.pending = undefined
        operation.prompt = undefined
        operation.status = 'cancelled'
        reject(new Error('授权已取消'))
        this.emit(operation)
      }
      const cleanup = (): void => {
        operation.controller.signal.removeEventListener('abort', abort)
      }
      operation.pending = {
        id,
        resolve: (value) => {
          if (operation.pending?.id !== id) return
          operation.pending = undefined
          operation.prompt = undefined
          operation.status = 'running'
          cleanup()
          resolve(value)
          this.emit(operation)
        },
        reject: (error) => {
          if (operation.pending?.id !== id) return
          operation.pending = undefined
          operation.prompt = undefined
          cleanup()
          reject(error)
          this.emit(operation)
        },
        cleanup
      }
      operation.controller.signal.addEventListener('abort', abort, { once: true })
      if (operation.controller.signal.aborted) abort()
    })
  }

  private notify(operation: InternalAuthOperation, event: AuthEvent): void {
    let next: AgentAuthEvent | undefined
    if (event.type === 'info') {
      next = {
        type: 'info',
        message: truncate(safeError(event.message)),
        ...(event.links
          ? {
              links: event.links
                .map((link) => {
                  const url = safeUrl(link.url)
                  return url ? { url, ...(link.label ? { label: truncate(safeError(link.label), 200) } : {}) } : undefined
                })
                .filter((link): link is { url: string; label?: string } => Boolean(link))
                .slice(0, 8)
            }
          : {})
      }
    } else if (event.type === 'auth_url') {
      const url = safeUrl(event.url)
      if (url) {
        next = {
          type: 'auth_url',
          url,
          ...(event.instructions ? { instructions: truncate(safeError(event.instructions)) } : {})
        }
      }
    } else if (event.type === 'device_code') {
      const url = safeUrl(event.verificationUri)
      if (url) {
        next = {
          type: 'device_code',
          userCode: truncate(event.userCode, 200),
          verificationUri: url,
          ...(event.intervalSeconds !== undefined ? { intervalSeconds: event.intervalSeconds } : {}),
          ...(event.expiresInSeconds !== undefined ? { expiresInSeconds: event.expiresInSeconds } : {})
        }
      }
    } else {
      next = { type: 'progress', message: truncate(safeError(event.message)) }
    }
    if (next) operation.events = [...operation.events, next].slice(-MAX_EVENTS)
    this.emit(operation)
  }

  private rememberCredential(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    for (const key of ['key', 'access', 'refresh', 'apiKey']) {
      const secret = record[key]
      if (typeof secret === 'string') redactCredential(secret)
    }
  }

  private scheduleCleanup(operation: InternalAuthOperation): void {
    if (operation.cleanupTimer) clearTimeout(operation.cleanupTimer)
    operation.cleanupTimer = setTimeout(() => {
      if (this.operations.get(operation.id) === operation) this.operations.delete(operation.id)
    }, AUTH_OPERATION_TTL_MS)
    operation.cleanupTimer.unref?.()
  }

  private emit(operation: InternalAuthOperation): void {
    this.onChange(this.toView(operation))
  }

  private toView(operation: InternalAuthOperation): AgentAuthOperation {
    return {
      id: operation.id,
      providerId: operation.providerId,
      providerName: operation.providerName,
      type: operation.type,
      status: operation.status,
      ...(operation.prompt ? { prompt: operation.prompt } : {}),
      events: [...operation.events],
      ...(operation.error ? { error: operation.error } : {})
    }
  }
}
