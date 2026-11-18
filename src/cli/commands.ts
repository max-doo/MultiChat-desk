import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { sendDaemonRequest, type DaemonResponse } from './client'

const QUERY_MAX_CHARS = 100_000
const TIMEOUT_MAX_SEC = 7200
const IMAGE_MAX_COUNT = 10

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

/** 仅在未提供 --query/--query-file 时读取管道 stdin；调用方保证此处不阻塞。 */
async function readStdinIfPiped(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

/** commander 收集器：--image 可重复出现，聚合为数组。 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value])
}

interface TaskSubmitOptions {
  platform: string
  model?: string
  research?: boolean
  genImage?: boolean
  query?: string
  queryFile?: string
  image?: string[]
  conversation?: string
  timeout?: string
  queueTimeout?: string
  wait?: string
  idempotencyKey?: string
  artifactDir?: string
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
  replyFile?: string
  imageFiles?: string[]
  imageError?: string
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

/** done 态产物路径行写 stderr，避免污染 stdout 的 reply 正文管道。 */
function printArtifactPaths(view: TaskViewShape): void {
  if (view.replyFile) process.stderr.write(`saved: ${view.replyFile}\n`)
  for (const p of view.imageFiles ?? []) process.stderr.write(`image: ${p}\n`)
  if (view.imageError) process.stderr.write(`imageError: ${view.imageError}\n`)
}

function handleTaskViewResponse(res: DaemonResponse, jsonMode: boolean): void {
  if (!jsonMode && res.success && res.data && typeof res.data === 'object') {
    const data = res.data as Record<string, unknown>
    if (typeof data.taskId === 'string') {
      if (typeof data.platform === 'string') {
        console.log(formatTaskView(data as unknown as TaskViewShape))
        printArtifactPaths(data as unknown as TaskViewShape)
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
    .option('--gen-image', 'Enable platform AI image-generation mode and save the produced image')
    .option('--query <text>', 'Query text')
    .option('--query-file <path>', 'Read query text from file')
    .option('--image <path>', `Attach a local image file (repeatable, max ${IMAGE_MAX_COUNT}); query optional when given`, collect, [] as string[])
    .option('--conversation <url>', 'Follow up inside an existing conversation page URL')
    .option('--timeout <sec>', `Task hard timeout in seconds (default 600, research 1800, max ${TIMEOUT_MAX_SEC})`)
    .option('--queue-timeout <sec>', 'Queue wait timeout in seconds (default = timeout)')
    .option('--wait <sec>', 'Block server-side up to N seconds waiting for terminal state')
    .option('--idempotency-key <key>', 'Reuse the live/finished task for the same key+platform instead of duplicating')
    .option('--artifact-dir <path>', 'Artifact root directory for reply TXT and generated image (default: <cwd>/.multichat)')
    .action(async (options: TaskSubmitOptions, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      if (!options.platform) paramError('缺少必填参数 --platform', jsonMode)
      if (options.research && options.genImage) paramError('--research 与 --gen-image 互斥', jsonMode)
      // 显式 --query/--query-file 存在时跳过 stdin：stdin 优先级只服务纯管道输入；
      // 宿主 shell 若把 stdin 挂成不关闭的管道，无条件读取会让 submit 永久阻塞。
      let query = ''
      if (!options.query && !options.queryFile) {
        query = await readStdinIfPiped()
      }
      if (!query && options.queryFile) {
        try {
          query = fs.readFileSync(options.queryFile, 'utf8').trim()
        } catch (err) {
          paramError(`无法读取 query 文件: ${err instanceof Error ? err.message : String(err)}`, jsonMode)
        }
      }
      if (!query && options.query) query = options.query

      // 图片路径在 CLI 侧即解析为绝对路径：daemon（Electron 主进程）cwd 与调用方不同，
      // 相对路径传过去会解析失败；存在性校验也给调用方更快的参数错误反馈（exit 2）。
      const images: string[] = []
      for (const raw of options.image ?? []) {
        const abs = path.resolve(raw)
        let isFile = false
        try { isFile = fs.statSync(abs).isFile() } catch { /* 不存在或不可读 */ }
        if (!isFile) paramError(`图片文件不存在或不是文件: ${raw}`, jsonMode)
        images.push(abs)
      }
      if (images.length > IMAGE_MAX_COUNT) paramError(`--image 数量超过 ${IMAGE_MAX_COUNT} 张上限`, jsonMode)

      if ((!query || !query.trim()) && images.length === 0) paramError('缺少 query 与 --image（stdin / --query-file / --query / --image 至少一项）', jsonMode)
      if (query.length > QUERY_MAX_CHARS) paramError(`query 超过 ${QUERY_MAX_CHARS} 字符上限`, jsonMode)

      const artifactDir = path.resolve(options.artifactDir || path.join(process.cwd(), '.multichat'))

      const timeoutSec = parseSeconds(options.timeout, '--timeout', jsonMode)
      const queueTimeoutSec = parseSeconds(options.queueTimeout, '--queue-timeout', jsonMode)
      const waitSec = parseSeconds(options.wait, '--wait', jsonMode, true)
      const waitMs = waitSec ? Math.round(waitSec * 1000) : 0

      const res = await sendDaemonRequest(
        {
          action: 'task.submit',
          platform: options.platform,
          query,
          ...(images.length ? { images } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.research ? { mode: 'deep_research' } : {}),
          ...(options.genImage ? { genImage: true } : {}),
          ...(options.conversation ? { conversationUrl: options.conversation } : {}),
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
          artifactDir,
          ...(timeoutSec !== undefined ? { timeoutMs: Math.round(timeoutSec * 1000) } : {}),
          ...(queueTimeoutSec !== undefined ? { queueTimeoutMs: Math.round(queueTimeoutSec * 1000) } : {})
        },
        jsonMode
      )
      // --wait 客户端两段化：submit 响应已带 taskId，先吐到 stderr（harness 杀死本进程
      // 前 taskId 已可观测），再发 task.status 长轮询；daemon 协议与 stdout 契约不变。
      if (waitMs > 0 && res.success && res.data && typeof res.data === 'object') {
        const taskId = (res.data as { taskId?: unknown }).taskId
        if (typeof taskId === 'string' && taskId) {
          process.stderr.write(JSON.stringify(res.data) + '\n')
          const view = await sendDaemonRequest(
            { action: 'task.status', taskId, waitMs },
            jsonMode,
            { waitMs }
          )
          handleTaskViewResponse(view, jsonMode)
          return
        }
      }
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
        const data = res.data as { phase: string; reply?: string; replyFile?: string; imageFiles?: string[]; imageError?: string; error?: { code: string; message: string } }
        if (data.phase === 'done' && data.reply !== undefined) {
          console.log(data.reply)
          printArtifactPaths(data as unknown as TaskViewShape)
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
        const caps = res.data as Array<{ id: string; deepResearch: boolean; imageGeneration: boolean; imageDownload: boolean; busySignal: string; followUp: boolean; signedIn?: boolean; loginRequired: boolean }>
        for (const cap of caps) {
          const auth = cap.signedIn === true ? 'signed-in' : cap.signedIn === false ? 'guest' : 'unknown'
          const gate = cap.loginRequired ? 'login-required' : 'guest-ok'
          console.log(`${cap.id.padEnd(12)} auth=${auth.padEnd(9)} ${gate.padEnd(14)} deepResearch=${cap.deepResearch}  imageGen=${cap.imageGeneration}  imageDl=${cap.imageDownload}  busySignal=${cap.busySignal}`)
        }
        return
      }
      handleCommandResponse(res, jsonMode)
    })

  program
    .command('auth')
    .description('Inspect platform login state')
    .argument('[platform]', 'Platform ID; omit to check all')
    .action(async (platform: string | undefined, _options: Record<string, unknown>, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest({ action: 'auth.status', ...(platform ? { platform } : {}) }, jsonMode)
      if (!jsonMode && res.success && res.data) {
        const rows = Array.isArray(res.data) ? res.data : [res.data]
        for (const row of rows as Array<{ platform: string; signedIn?: boolean; matchedCookie?: string; loginRequired?: boolean }>) {
          const auth = row.signedIn === true ? 'signed-in' : row.signedIn === false ? 'guest' : 'unknown'
          const detail = row.matchedCookie ? `  cookie=${row.matchedCookie}` : ''
          console.log(`${row.platform.padEnd(12)} auth=${auth}${detail}`)
        }
        return
      }
      handleCommandResponse(res, jsonMode)
    })
}
