# MultiChat CLI + Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable local daemon and CLI for agent use without dropping the current Electron/Webview automation model.

**Architecture:** Keep Electron as the browser execution engine, move automation orchestration into main-process services, expose a local Named Pipe daemon, and make the CLI a thin client over that daemon. Renderer stays responsible for presentation while both UI IPC and CLI requests converge on the same automation service.

**Tech Stack:** Electron 28, electron-vite, TypeScript, Node `net` Named Pipe IPC, existing WebContents/Webview automation, Vitest for TypeScript tests, `tsx` for local CLI/dev execution.

---

## File Structure

### New files

- `src/shared/automation/protocol.ts`
  Shared request/response types, task states, result envelopes, and daemon message parsing helpers.
- `src/shared/automation/errors.ts`
  Stable error codes and serialization helpers for CLI/daemon/UI.
- `src/main/services/automation/webviewRegistry.ts`
  Registry mapping `modelId -> webContentsId` and tracking lifecycle of automation-backed webviews.
- `src/main/services/automation/webviewCommandRunner.ts`
  Executes existing DOM automation scripts against `Electron.WebContents`.
- `src/main/services/automation/automationService.ts`
  Main service for `exec`, `collect`, `session list`, `session reset`, and future task queueing.
- `src/main/services/automation/daemonServer.ts`
  Named Pipe server and request dispatcher.
- `src/cli/index.ts`
  CLI entrypoint for `daemon status`, `exec`, `collect`, `session *`.
- `vitest.config.ts`
  Test runner configuration.
- `src/shared/automation/__tests__/protocol.test.ts`
  Tests for protocol parsing/serialization.
- `src/main/services/automation/__tests__/automationService.test.ts`
  Tests for command routing and error mapping with mocked registry/runner.

### Modified files

- `package.json`
  Add scripts for tests, CLI dev/build entrypoints, and new dev dependencies.
- `src/main/index.ts`
  Start daemon server, instantiate automation services, and shut them down on app exit.
- `src/main/ipcHandlers.ts`
  Route UI-triggered automation through the new service instead of bespoke logic where applicable.
- `src/main/webviewManager.ts`
  Register and unregister automation-backed webviews with the new registry.
- `src/preload/index.ts`
  Add small bridge methods for daemon status/session helpers only if UI needs them.
- `src/preload/index.d.ts`
  Update typings for new preload bridge methods.
- `electron.vite.config.ts`
  Ensure CLI/shared code path aliases still build cleanly; keep renderer untouched.

---

### Task 1: Establish shared protocol and test harness

**Files:**
- Create: `src/shared/automation/protocol.ts`
- Create: `src/shared/automation/errors.ts`
- Create: `src/shared/automation/__tests__/protocol.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Add test and CLI dev dependencies**

Update `package.json` dev dependencies and scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "cli:dev": "tsx src/cli/index.ts"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write the failing protocol test**

Create `src/shared/automation/__tests__/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  deserializeDaemonMessage,
  serializeDaemonMessage,
  type DaemonRequest
} from '../protocol'

describe('automation protocol', () => {
  it('round-trips an exec request', () => {
    const request: DaemonRequest = {
      id: 'req-1',
      command: 'exec',
      payload: {
        modelId: 'gemini',
        prompt: 'Summarize this page',
        timeoutMs: 30_000
      }
    }

    const wire = serializeDaemonMessage(request)
    const parsed = deserializeDaemonMessage(wire)

    expect(parsed).toEqual(request)
  })

  it('throws on malformed JSON', () => {
    expect(() => deserializeDaemonMessage('{bad json}')).toThrow(/Invalid daemon message/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
cmd /c npm run test -- src/shared/automation/__tests__/protocol.test.ts
```

Expected:

```text
FAIL  Cannot find module '../protocol'
```

- [ ] **Step 4: Implement the shared protocol**

Create `src/shared/automation/protocol.ts`:

```ts
export type DaemonCommand =
  | 'daemon.status'
  | 'exec'
  | 'collect'
  | 'session.list'
  | 'session.reset'

export type DaemonRequest =
  | {
      id: string
      command: 'daemon.status'
      payload: Record<string, never>
    }
  | {
      id: string
      command: 'exec'
      payload: {
        modelId: string
        prompt: string
        timeoutMs?: number
      }
    }
  | {
      id: string
      command: 'collect'
      payload: {
        modelId: string
      }
    }
  | {
      id: string
      command: 'session.list'
      payload: Record<string, never>
    }
  | {
      id: string
      command: 'session.reset'
      payload: {
        modelId: string
      }
    }

export type DaemonSuccessResponse<T> = {
  id: string
  ok: true
  data: T
}

export type DaemonErrorResponse = {
  id: string
  ok: false
  error: {
    code: string
    message: string
  }
}

export type DaemonResponse<T = unknown> = DaemonSuccessResponse<T> | DaemonErrorResponse

export function serializeDaemonMessage(message: DaemonRequest | DaemonResponse): string {
  return JSON.stringify(message)
}

export function deserializeDaemonMessage(raw: string): DaemonRequest | DaemonResponse {
  try {
    return JSON.parse(raw) as DaemonRequest | DaemonResponse
  } catch (error) {
    throw new Error(`Invalid daemon message: ${String(error)}`)
  }
}
```

Create `src/shared/automation/errors.ts`:

```ts
export const AUTOMATION_ERROR_CODES = {
  DAEMON_UNAVAILABLE: 'DAEMON_UNAVAILABLE',
  MODEL_NOT_READY: 'MODEL_NOT_READY',
  COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
  COMMAND_FAILED: 'COMMAND_FAILED',
  BAD_REQUEST: 'BAD_REQUEST'
} as const

export type AutomationErrorCode =
  (typeof AUTOMATION_ERROR_CODES)[keyof typeof AUTOMATION_ERROR_CODES]

export function toErrorPayload(code: AutomationErrorCode, message: string): {
  code: AutomationErrorCode
  message: string
} {
  return { code, message }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```powershell
cmd /c npm run test -- src/shared/automation/__tests__/protocol.test.ts
```

Expected:

```text
PASS  2 tests passed
```

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.ts src/shared/automation/protocol.ts src/shared/automation/errors.ts src/shared/automation/__tests__/protocol.test.ts
git commit -m "feat: add shared automation protocol"
```

---

### Task 2: Add main-process automation registry and command service

**Files:**
- Create: `src/main/services/automation/webviewRegistry.ts`
- Create: `src/main/services/automation/webviewCommandRunner.ts`
- Create: `src/main/services/automation/automationService.ts`
- Create: `src/main/services/automation/__tests__/automationService.test.ts`
- Modify: `src/main/webviewManager.ts`

- [ ] **Step 1: Write the failing service test**

Create `src/main/services/automation/__tests__/automationService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { AutomationService } from '../automationService'

describe('AutomationService', () => {
  it('returns a model-not-ready error when no webview is registered', async () => {
    const service = new AutomationService({
      registry: {
        getByModelId: vi.fn().mockReturnValue(null),
        listSessions: vi.fn().mockReturnValue([])
      } as any,
      runner: {} as any
    })

    const result = await service.exec({
      modelId: 'gemini',
      prompt: 'hello'
    })

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('MODEL_NOT_READY')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cmd /c npm run test -- src/main/services/automation/__tests__/automationService.test.ts
```

Expected:

```text
FAIL  Cannot find module '../automationService'
```

- [ ] **Step 3: Implement the registry**

Create `src/main/services/automation/webviewRegistry.ts`:

```ts
export type RegisteredAutomationWebview = {
  modelId: string
  webContentsId: number
  attachedAt: number
}

export class WebviewRegistry {
  private readonly byModelId = new Map<string, RegisteredAutomationWebview>()

  register(modelId: string, webContentsId: number): void {
    this.byModelId.set(modelId, {
      modelId,
      webContentsId,
      attachedAt: Date.now()
    })
  }

  unregisterByWebContentsId(webContentsId: number): void {
    for (const [modelId, value] of this.byModelId.entries()) {
      if (value.webContentsId === webContentsId) {
        this.byModelId.delete(modelId)
      }
    }
  }

  getByModelId(modelId: string): RegisteredAutomationWebview | null {
    return this.byModelId.get(modelId) ?? null
  }

  listSessions(): RegisteredAutomationWebview[] {
    return [...this.byModelId.values()]
  }
}
```

- [ ] **Step 4: Implement the command runner**

Create `src/main/services/automation/webviewCommandRunner.ts`:

```ts
import { webContents } from 'electron'
import { defaultSelectors } from '../../../renderer/src/config/selectors'
import {
  generateGetLatestResponseScript,
  generateSendMessageScript
} from '../../../renderer/src/utils/webviewScripts'

export class WebviewCommandRunner {
  async exec(modelId: string, webContentsId: number, prompt: string): Promise<void> {
    const wc = webContents.fromId(webContentsId)
    const selectors = defaultSelectors.models[modelId]

    if (!wc || !selectors) {
      throw new Error(`Missing automation target for model: ${modelId}`)
    }

    const result = await wc.executeJavaScript(generateSendMessageScript(prompt, modelId, selectors), true)
    if (!result?.success) {
      throw new Error(result?.error || 'Send message failed')
    }
  }

  async collect(modelId: string, webContentsId: number): Promise<string> {
    const wc = webContents.fromId(webContentsId)
    const selectors = defaultSelectors.models[modelId]

    if (!wc || !selectors) {
      throw new Error(`Missing automation target for model: ${modelId}`)
    }

    return await wc.executeJavaScript(generateGetLatestResponseScript(modelId, selectors), true)
  }
}
```

- [ ] **Step 5: Implement the automation service**

Create `src/main/services/automation/automationService.ts`:

```ts
import { AUTOMATION_ERROR_CODES, toErrorPayload } from '../../../shared/automation/errors'
import type { DaemonResponse } from '../../../shared/automation/protocol'
import type { WebviewRegistry } from './webviewRegistry'
import type { WebviewCommandRunner } from './webviewCommandRunner'

type AutomationServiceDeps = {
  registry: WebviewRegistry
  runner: WebviewCommandRunner
}

export class AutomationService {
  constructor(private readonly deps: AutomationServiceDeps) {}

  async exec(input: {
    modelId: string
    prompt: string
  }): Promise<DaemonResponse<{ accepted: true }>> {
    const target = this.deps.registry.getByModelId(input.modelId)
    if (!target) {
      return {
        id: 'inline',
        ok: false,
        error: toErrorPayload(AUTOMATION_ERROR_CODES.MODEL_NOT_READY, `Model ${input.modelId} is not ready`)
      }
    }

    try {
      await this.deps.runner.exec(input.modelId, target.webContentsId, input.prompt)
      return { id: 'inline', ok: true, data: { accepted: true } }
    } catch (error) {
      return {
        id: 'inline',
        ok: false,
        error: toErrorPayload(AUTOMATION_ERROR_CODES.COMMAND_FAILED, String(error))
      }
    }
  }

  async collect(input: {
    modelId: string
  }): Promise<DaemonResponse<{ content: string }>> {
    const target = this.deps.registry.getByModelId(input.modelId)
    if (!target) {
      return {
        id: 'inline',
        ok: false,
        error: toErrorPayload(AUTOMATION_ERROR_CODES.MODEL_NOT_READY, `Model ${input.modelId} is not ready`)
      }
    }

    try {
      const content = await this.deps.runner.collect(input.modelId, target.webContentsId)
      return { id: 'inline', ok: true, data: { content } }
    } catch (error) {
      return {
        id: 'inline',
        ok: false,
        error: toErrorPayload(AUTOMATION_ERROR_CODES.COMMAND_FAILED, String(error))
      }
    }
  }

  listSessions(): DaemonResponse<{ sessions: Array<{ modelId: string; webContentsId: number }> }> {
    const sessions = this.deps.registry.listSessions().map((item) => ({
      modelId: item.modelId,
      webContentsId: item.webContentsId
    }))

    return { id: 'inline', ok: true, data: { sessions } }
  }
}
```

- [ ] **Step 6: Register webviews in the main process**

Modify `src/main/webviewManager.ts` to accept a registry and register `webContents.id` when each model-backed webview attaches. Add a small IPC path from renderer so the model ID is known:

```ts
type AttachAutomationHooksArgs = {
  registerModelWebview: (modelId: string, webContentsId: number) => void
  unregisterModelWebview: (webContentsId: number) => void
}
```

And when the webview is destroyed:

```ts
webContents.on('destroyed', () => {
  unregisterModelWebview(webContents.id)
})
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```powershell
cmd /c npm run test -- src/main/services/automation/__tests__/automationService.test.ts
```

Expected:

```text
PASS  1 test passed
```

- [ ] **Step 8: Commit**

```bash
git add src/main/services/automation/webviewRegistry.ts src/main/services/automation/webviewCommandRunner.ts src/main/services/automation/automationService.ts src/main/services/automation/__tests__/automationService.test.ts src/main/webviewManager.ts
git commit -m "feat: add main automation service"
```

---

### Task 3: Add Named Pipe daemon server in Electron main

**Files:**
- Create: `src/main/services/automation/daemonServer.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the daemon server skeleton**

Create `src/main/services/automation/daemonServer.ts`:

```ts
import net from 'node:net'
import type { AutomationService } from './automationService'
import {
  deserializeDaemonMessage,
  serializeDaemonMessage,
  type DaemonRequest,
  type DaemonResponse
} from '../../../shared/automation/protocol'
import { AUTOMATION_ERROR_CODES, toErrorPayload } from '../../../shared/automation/errors'

const PIPE_NAME = '\\\\.\\pipe\\multichat-daemon'

export class DaemonServer {
  private server: net.Server | null = null

  constructor(private readonly automationService: AutomationService) {}

  start(): Promise<void> {
    if (this.server) return Promise.resolve()

    this.server = net.createServer((socket) => {
      socket.setEncoding('utf8')
      let buffer = ''

      socket.on('data', async (chunk) => {
        buffer += chunk
        if (!buffer.endsWith('\n')) return

        const raw = buffer.trim()
        buffer = ''

        let request: DaemonRequest
        try {
          request = deserializeDaemonMessage(raw) as DaemonRequest
        } catch (error) {
          const response: DaemonResponse = {
            id: 'unknown',
            ok: false,
            error: toErrorPayload(AUTOMATION_ERROR_CODES.BAD_REQUEST, String(error))
          }
          socket.write(`${serializeDaemonMessage(response)}\n`)
          return
        }

        const response = await this.handleRequest(request)
        socket.write(`${serializeDaemonMessage(response)}\n`)
      })
    })

    return new Promise((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(PIPE_NAME, () => resolve())
    })
  }

  stop(): Promise<void> {
    if (!this.server) return Promise.resolve()

    return new Promise((resolve, reject) => {
      this.server?.close((error) => {
        if (error) reject(error)
        else resolve()
      })
      this.server = null
    })
  }

  private async handleRequest(request: DaemonRequest): Promise<DaemonResponse> {
    switch (request.command) {
      case 'daemon.status':
        return { id: request.id, ok: true, data: { running: true } }
      case 'exec': {
        const result = await this.automationService.exec(request.payload)
        return { ...result, id: request.id }
      }
      case 'collect': {
        const result = await this.automationService.collect(request.payload)
        return { ...result, id: request.id }
      }
      case 'session.list': {
        const result = this.automationService.listSessions()
        return { ...result, id: request.id }
      }
      default:
        return {
          id: request.id,
          ok: false,
          error: toErrorPayload(AUTOMATION_ERROR_CODES.BAD_REQUEST, `Unsupported command: ${request.command}`)
        }
    }
  }
}

export function getDaemonPipeName(): string {
  return PIPE_NAME
}
```

- [ ] **Step 2: Wire daemon startup in the main process**

Modify `src/main/index.ts`:

```ts
import { AutomationService } from './services/automation/automationService'
import { DaemonServer } from './services/automation/daemonServer'
import { WebviewRegistry } from './services/automation/webviewRegistry'
import { WebviewCommandRunner } from './services/automation/webviewCommandRunner'

const webviewRegistry = new WebviewRegistry()
const webviewCommandRunner = new WebviewCommandRunner()
const automationService = new AutomationService({
  registry: webviewRegistry,
  runner: webviewCommandRunner
})
const daemonServer = new DaemonServer(automationService)
```

And inside `app.whenReady()`:

```ts
await daemonServer.start()
```

And on shutdown:

```ts
app.on('before-quit', () => {
  void daemonServer.stop()
})
```

- [ ] **Step 3: Run lint and tests**

Run:

```powershell
cmd /c npm run lint
cmd /c npm run test
```

Expected:

```text
lint passes with 0 errors
vitest passes
```

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/services/automation/daemonServer.ts
git commit -m "feat: add local automation daemon"
```

---

### Task 4: Add the CLI thin client

**Files:**
- Create: `src/cli/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the CLI entrypoint**

Create `src/cli/index.ts`:

```ts
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  serializeDaemonMessage,
  deserializeDaemonMessage,
  type DaemonRequest,
  type DaemonResponse
} from '../shared/automation/protocol'

const PIPE_NAME = '\\\\.\\pipe\\multichat-daemon'

async function send(request: DaemonRequest): Promise<DaemonResponse> {
  return await new Promise((resolve, reject) => {
    const client = net.createConnection(PIPE_NAME, () => {
      client.write(`${serializeDaemonMessage(request)}\n`)
    })

    let buffer = ''
    client.setEncoding('utf8')

    client.on('data', (chunk) => {
      buffer += chunk
      if (!buffer.endsWith('\n')) return
      resolve(deserializeDaemonMessage(buffer.trim()) as DaemonResponse)
      client.end()
    })

    client.on('error', reject)
  })
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv

  if (command === 'daemon' && args[0] === 'status') {
    const response = await send({
      id: randomUUID(),
      command: 'daemon.status',
      payload: {}
    })
    console.log(JSON.stringify(response, null, 2))
    process.exit(response.ok ? 0 : 1)
  }

  if (command === 'exec') {
    const modelId = args[args.indexOf('--model') + 1]
    const prompt = args[args.indexOf('--prompt') + 1]

    const response = await send({
      id: randomUUID(),
      command: 'exec',
      payload: { modelId, prompt }
    })

    console.log(JSON.stringify(response, null, 2))
    process.exit(response.ok ? 0 : 1)
  }

  if (command === 'collect') {
    const modelId = args[args.indexOf('--model') + 1]

    const response = await send({
      id: randomUUID(),
      command: 'collect',
      payload: { modelId }
    })

    console.log(JSON.stringify(response, null, 2))
    process.exit(response.ok ? 0 : 1)
  }

  console.error('Usage: multichat <daemon status|exec|collect> [options]')
  process.exit(1)
}

void main()
```

- [ ] **Step 2: Add CLI scripts**

Modify `package.json`:

```json
{
  "scripts": {
    "cli:dev": "tsx src/cli/index.ts",
    "cli:status": "tsx src/cli/index.ts daemon status"
  }
}
```

- [ ] **Step 3: Verify daemon round-trip manually**

Run:

```powershell
cmd /c npm run cli:status
```

Expected:

```json
{
  "id": "...",
  "ok": true,
  "data": {
    "running": true
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json src/cli/index.ts
git commit -m "feat: add automation cli client"
```

---

### Task 5: Route UI actions through the shared automation service and document usage

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `docs/CLI_FEASIBILITY_ASSESSMENT.md`
- Create: `docs/CLI_USAGE_GUIDE.md`

- [ ] **Step 1: Replace direct one-off automation paths with service-backed calls where sensible**

In `src/main/ipcHandlers.ts`, use the shared service for new commands:

```ts
ipcMain.handle('automation-session-list', () => {
  return automationService.listSessions()
})

ipcMain.handle('automation-exec', async (_event, payload: { modelId: string; prompt: string }) => {
  return await automationService.exec(payload)
})

ipcMain.handle('automation-collect', async (_event, payload: { modelId: string }) => {
  return await automationService.collect(payload)
})
```

- [ ] **Step 2: Add preload bridge typings**

In `src/preload/index.ts`:

```ts
automationSessionList: (): Promise<unknown> => ipcRenderer.invoke('automation-session-list'),
automationExec: (payload: { modelId: string; prompt: string }): Promise<unknown> =>
  ipcRenderer.invoke('automation-exec', payload),
automationCollect: (payload: { modelId: string }): Promise<unknown> =>
  ipcRenderer.invoke('automation-collect', payload),
```

In `src/preload/index.d.ts`:

```ts
automationSessionList: () => Promise<unknown>
automationExec: (payload: { modelId: string; prompt: string }) => Promise<unknown>
automationCollect: (payload: { modelId: string }) => Promise<unknown>
```

- [ ] **Step 3: Add CLI usage guide**

Create `docs/CLI_USAGE_GUIDE.md`:

```md
# MultiChat CLI Usage Guide

## Start the desktop app

The daemon runs inside the Electron main process. Start MultiChat first:

```powershell
cmd /c npm run dev
```

## Check daemon health

```powershell
cmd /c npm run cli:status
```

## Send a prompt

```powershell
cmd /c npm run cli:dev -- exec --model gemini --prompt "Summarize the current page"
```

## Collect the latest response

```powershell
cmd /c npm run cli:dev -- collect --model gemini
```
```

- [ ] **Step 4: Run final verification**

Run:

```powershell
cmd /c npm run lint
cmd /c npm run test
cmd /c npm run cli:status
```

Expected:

```text
lint passes
tests pass
daemon status returns ok: true
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts docs/CLI_USAGE_GUIDE.md docs/CLI_FEASIBILITY_ASSESSMENT.md
git commit -m "feat: unify ui and cli automation entrypoints"
```

---

## Self-Review

### Spec coverage

- CLI entrypoint covered by Task 4.
- Daemon transport covered by Task 3.
- Shared execution layer covered by Task 2.
- Shared schemas and stable responses covered by Task 1.
- UI/CLI convergence and documentation covered by Task 5.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Each task contains exact files and concrete commands.

### Type consistency

- `DaemonRequest` and `DaemonResponse` are introduced in Task 1 and reused unchanged later.
- `AutomationService` returns daemon-style envelopes consistently.
- `modelId` remains the lookup key across registry, CLI, and daemon handling.

---

Plan complete and saved to `docs/superpowers/plans/2026-03-29-cli-daemon-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
