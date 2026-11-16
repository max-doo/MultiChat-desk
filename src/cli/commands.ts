import { Command } from 'commander'
import fs from 'fs'
import { sendDaemonRequest, type DaemonResponse } from './client'

const QUERY_MAX_CHARS = 100_000
const TIMEOUT_MAX_SEC = 7200

function isJsonMode(cmd: Command): boolean {
  // JSON 为默认输出（Agent/脚本契约）；--text 切回人类可读
  return !cmd.optsWithGlobals().text
}

function handleCommandResponse(res: DaemonResponse, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(res, null, 2))
    if (!res.success) {
      process.exit(1)
    }
  } else {
    if (!res.success) {
      console.error(res.error || '执行失败')
      process.exit(1)
    } else {
      if (typeof res.data === 'string') {
        console.log(res.data)
      } else if (typeof res.data === 'object' && res.data !== null) {
        console.log(JSON.stringify(res.data, null, 2))
      } else if (res.data !== undefined) {
        console.log(String(res.data))
      }
    }
  }
}

function paramError(message: string, jsonMode: boolean): never {
  if (jsonMode) {
    process.stderr.write(JSON.stringify({ success: false, error: message, code: 'INVALID_PARAMS' }, null, 2) + '\n')
  } else {
    console.error(message)
  }
  process.exit(2)
}

/** 非 TTY stdin 优先于 --query-file/--query（管道输入场景）。 */
async function readStdinIfPiped(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

interface TaskSubmitOptions {
  platform: string
  model?: string
  research?: boolean
  query?: string
  queryFile?: string
  conversation?: string
  timeout?: string
  queueTimeout?: string
  wait?: string
}

function parseSeconds(raw: string | undefined, flag: string, jsonMode: boolean, allowZero = false, max = TIMEOUT_MAX_SEC): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0) || value > max) {
    paramError(`参数 ${flag} 须为 ${allowZero ? '0' : '1'}-${max} 之间的秒数`, jsonMode)
  }
  return value
}

interface TaskViewShape {
  taskId: string
  platform: string
  mode: string
  phase: string
  queuedPosition?: number
  replyChars: number
  busy: boolean
  elapsedMs: number
  conversationUrl?: string
  error?: { code: string; message: string }
}

function formatTaskView(view: TaskViewShape): string {
  const parts = [
    `${view.taskId}`,
    `platform=${view.platform}`,
    `mode=${view.mode}`,
    `phase=${view.phase}`
  ]
  if (view.queuedPosition !== undefined) parts.push(`queuedPosition=${view.queuedPosition}`)
  parts.push(`replyChars=${view.replyChars}`, `busy=${view.busy}`, `elapsed=${Math.round(view.elapsedMs / 1000)}s`)
  if (view.conversationUrl) parts.push(`url=${view.conversationUrl}`)
  if (view.error) parts.push(`error=${view.error.code}:${view.error.message}`)
  return parts.join('  ')
}

function handleTaskViewResponse(res: DaemonResponse, jsonMode: boolean): void {
  if (!jsonMode && res.success && res.data && typeof res.data === 'object') {
    const data = res.data as Record<string, unknown>
    if (typeof data.taskId === 'string') {
      if (typeof data.platform === 'string') {
        console.log(formatTaskView(data as unknown as TaskViewShape))
      } else {
        // submit 无 --wait 的确认短形态：{taskId, phase, queuedPosition?}
        console.log(`${data.taskId}  phase=${String(data.phase)}${data.queuedPosition !== undefined ? `  queuedPosition=${String(data.queuedPosition)}` : ''}`)
      }
      return
    }
  }
  handleCommandResponse(res, jsonMode)
}

export function registerCommands(program: Command): void {
  program
    .option('--json', 'Output results in JSON format (default)')
    .option('--text', 'Output human-readable text instead of JSON')

  const daemonCmd = program
    .command('daemon')
    .description('Manage MultiChat daemon')

  daemonCmd
    .command('status')
    .description('Check if Daemon is running')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest({ action: 'status' }, jsonMode)
      handleCommandResponse(res, jsonMode)
    })

  program
    .command('exec')
    .description('Execute a prompt on a specified AI model')
    .requiredOption('-m, --model <model>', 'AI model or platform ID')
    .requiredOption('-p, --prompt <prompt>', 'Prompt text to execute')
    .action(async (options: { model: string; prompt: string }, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest(
        { action: 'exec', model: options.model, prompt: options.prompt },
        jsonMode
      )
      handleCommandResponse(res, jsonMode)
    })

  program
    .command('collect')
    .description('Collect the latest response from a session or model')
    .option('-s, --session <session>', 'Session ID')
    .option('-m, --model <model>', 'AI model or platform ID')
    .action(async (options: { session?: string; model?: string }, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest(
        { action: 'collect', session: options.session || '', model: options.model || '' },
        jsonMode
      )
      handleCommandResponse(res, jsonMode)
    })

  // ==================== Agent 任务命令组 ====================

  const taskCmd = program
    .command('task')
    .description('Submit and manage agent AI tasks')

  taskCmd
    .command('submit')
    .description('Submit a query to a platform; returns taskId immediately unless --wait is given')
    .option('--platform <id>', 'Platform ID (chatgpt/gemini/claude/...)')
    .option('--model <name>', 'Declarative model metadata (no page-side switching yet)')
    .option('--research', 'Enable platform Deep Research mode before sending')
    .option('--query <text>', 'Query text')
    .option('--query-file <path>', 'Read query text from file')
    .option('--conversation <url>', 'Follow up inside an existing conversation page URL')
    .option('--timeout <sec>', `Task hard timeout in seconds (default 600, research 1800, max ${TIMEOUT_MAX_SEC})`)
    .option('--queue-timeout <sec>', 'Queue wait timeout in seconds (default = timeout)')
    .option('--wait <sec>', 'Block server-side up to N seconds waiting for terminal state')
    .action(async (options: TaskSubmitOptions, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      if (!options.platform) paramError('缺少必填参数 --platform', jsonMode)
      const stdinQuery = await readStdinIfPiped()
      let query = stdinQuery
      if (!query && options.queryFile) {
        try {
          query = fs.readFileSync(options.queryFile, 'utf8').trim()
        } catch (err) {
          paramError(`无法读取 query 文件: ${err instanceof Error ? err.message : String(err)}`, jsonMode)
        }
      }
      if (!query && options.query) query = options.query
      if (!query || !query.trim()) paramError('缺少 query（stdin / --query-file / --query 三选一）', jsonMode)
      if (query.length > QUERY_MAX_CHARS) paramError(`query 超过 ${QUERY_MAX_CHARS} 字符上限`, jsonMode)

      const timeoutSec = parseSeconds(options.timeout, '--timeout', jsonMode)
      const queueTimeoutSec = parseSeconds(options.queueTimeout, '--queue-timeout', jsonMode)
      const waitSec = parseSeconds(options.wait, '--wait', jsonMode, true)
      const waitMs = waitSec ? Math.round(waitSec * 1000) : 0

      const res = await sendDaemonRequest(
        {
          action: 'task.submit',
          platform: options.platform,
          query,
          ...(options.model ? { model: options.model } : {}),
          ...(options.research ? { mode: 'deep_research' } : {}),
          ...(options.conversation ? { conversationUrl: options.conversation } : {}),
          ...(timeoutSec !== undefined ? { timeoutMs: Math.round(timeoutSec * 1000) } : {}),
          ...(queueTimeoutSec !== undefined ? { queueTimeoutMs: Math.round(queueTimeoutSec * 1000) } : {}),
          ...(waitMs > 0 ? { waitMs } : {})
        },
        jsonMode,
        { waitMs }
      )
      handleTaskViewResponse(res, jsonMode)
    })

  taskCmd
    .command('status <taskId>')
    .description('Query task status; --wait blocks server-side until terminal or timeout')
    .option('--wait <sec>', 'Block server-side up to N seconds waiting for terminal state')
    .action(async (taskId: string, options: { wait?: string }, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const waitSec = parseSeconds(options.wait, '--wait', jsonMode, true)
      const waitMs = waitSec ? Math.round(waitSec * 1000) : 0
      const res = await sendDaemonRequest(
        { action: 'task.status', taskId, ...(waitMs > 0 ? { waitMs } : {}) },
        jsonMode,
        { waitMs }
      )
      handleTaskViewResponse(res, jsonMode)
    })

  taskCmd
    .command('result <taskId>')
    .description('Get task result (full Markdown reply when done)')
    .action(async (taskId: string, _options: Record<string, unknown>, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest({ action: 'task.result', taskId }, jsonMode)
      if (!jsonMode && res.success && res.data && typeof res.data === 'object') {
        const data = res.data as { phase: string; reply?: string; error?: { code: string; message: string } }
        if (data.phase === 'done' && data.reply !== undefined) {
          console.log(data.reply)
          return
        }
        console.log(`phase=${data.phase}${data.error ? `  error=${data.error.code}:${data.error.message}` : ''}`)
        return
      }
      handleCommandResponse(res, jsonMode)
    })

  taskCmd
    .command('cancel <taskId>')
    .description('Cancel a task (idempotent)')
    .action(async (taskId: string, _options: Record<string, unknown>, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest({ action: 'task.cancel', taskId }, jsonMode)
      if (!jsonMode && res.success && res.data && typeof res.data === 'object') {
        const data = res.data as { taskId: string; phase: string }
        console.log(`${data.taskId}  phase=${data.phase}`)
        return
      }
      handleCommandResponse(res, jsonMode)
    })

  taskCmd
    .command('list')
    .description('List active tasks; --all merges finished in-memory and persisted records')
    .option('--all', 'Include finished tasks (memory + disk)')
    .option('--platform <id>', 'Filter by platform ID')
    .action(async (options: { all?: boolean; platform?: string }, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest(
        { action: 'task.list', includeFinished: options.all === true, ...(options.platform ? { platform: options.platform } : {}) },
        jsonMode
      )
      if (!jsonMode && res.success && Array.isArray(res.data)) {
        const views = res.data as TaskViewShape[]
        if (views.length === 0) {
          console.log('（无任务）')
          return
        }
        for (const view of views) console.log(formatTaskView(view))
        return
      }
      handleCommandResponse(res, jsonMode)
    })

  program
    .command('platforms')
    .description('List adapted platforms and their capabilities')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest({ action: 'platforms' }, jsonMode)
      if (!jsonMode && res.success && Array.isArray(res.data)) {
        const caps = res.data as Array<{ id: string; deepResearch: boolean; busySignal: string; followUp: boolean }>
        for (const cap of caps) {
          console.log(`${cap.id.padEnd(12)} deepResearch=${cap.deepResearch}  busySignal=${cap.busySignal}  followUp=${cap.followUp}`)
        }
        return
      }
      handleCommandResponse(res, jsonMode)
    })
}
