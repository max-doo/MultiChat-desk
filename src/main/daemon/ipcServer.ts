import net from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomBytes } from 'crypto'
import { automationService } from '../services/AutomationService'
import { agentTaskService } from '../services/AgentTaskService'
import { sessionManager } from '../services/SessionManager'
import {
  isAgentTaskTerminal,
  AGENT_TASK_MAX_TIMEOUT_MS,
  type AgentTaskSubmitRequest,
  type AgentTaskView
} from '../../shared/types/agentTask'

const PIPE_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\multichat-daemon'
    : path.join(os.tmpdir(), `multichat-daemon-${process.getuid?.() ?? 'user'}.sock`)

interface DaemonRequest {
  action?: string
  model?: string
  prompt?: string
  session?: string
  token?: string
  taskId?: string
  platform?: string
  query?: string
  images?: string[]
  mode?: string
  conversationUrl?: string
  timeoutMs?: number
  queueTimeoutMs?: number
  waitMs?: number
  includeFinished?: boolean
  genImage?: boolean
  artifactDir?: string
  /** exec-script 动作：要执行的 JS 字符串 */
  script?: string
  /** exec-script 动作：会话 key（默认与 platform 相同） */
  sessionKey?: string
  [key: string]: unknown
}

interface DaemonResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

let server: net.Server | null = null
const activeSockets = new Set<net.Socket>()
let daemonToken = ''
let tokenPath = ''

function loadOrCreateDaemonToken(): string {
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim()
    if (existing) return existing
  } catch {
    // Token does not exist yet.
  }
  const token = randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
  return token
}

/**
 * 向 Socket 发送响应，添加统一的分行符 (\n)
 */
function sendResponse(socket: net.Socket, response: DaemonResponse): void {
  if (!socket.writable || socket.destroyed) {
    // 响应体可能含 AI 回复正文，日志只记元信息
    const dataChars = response.data === undefined ? 0 : JSON.stringify(response.data)?.length ?? 0
    console.warn(`[Daemon] Socket 已断开，响应未发送: success=${response.success} code=${response.code ?? '-'} error=${response.error ?? '-'} dataChars=${dataChars}`)
    return
  }
  try {
    socket.write(JSON.stringify(response) + '\n')
  } catch (err) {
    console.error('[Daemon] 发送响应失败:', err)
  }
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeWaitMs(value: unknown): number {
  const waitMs = asFiniteNumber(value)
  if (waitMs === undefined || waitMs <= 0) return 0
  return Math.min(waitMs, AGENT_TASK_MAX_TIMEOUT_MS)
}

/** waitMs 长轮询：任务进入终态立即返回；超时或 socket 断开返回当前视图/ null。 */
async function waitForTaskView(socket: net.Socket, taskId: string, waitMs: number): Promise<AgentTaskView | null> {
  const deadline = Date.now() + waitMs
  const socketClosed = new Promise<void>(resolve => socket.once('close', resolve))
  while (Date.now() < deadline) {
    if (socket.destroyed) return null
    const view = await agentTaskService.getView(taskId)
    if (!view) return null
    if (isAgentTaskTerminal(view.phase)) return view
    const remaining = deadline - Date.now()
    await Promise.race([agentTaskService.waitForChange(Math.min(500, remaining)), socketClosed])
  }
  if (socket.destroyed) return null
  return agentTaskService.getView(taskId)
}

async function respondTaskView(socket: net.Socket, taskId: string, waitMs: number): Promise<void> {
  const view = waitMs > 0 ? await waitForTaskView(socket, taskId, waitMs) : await agentTaskService.getView(taskId)
  if (!view) {
    sendResponse(socket, { success: false, error: `任务不存在: ${taskId}`, code: 'TASK_NOT_FOUND' })
    return
  }
  // done 终态在单任务响应中内嵌 reply，省去一次 task.result 往返；task.list 批量视图不内嵌
  if (view.phase === 'done') {
    const result = await agentTaskService.getResult(taskId)
    if (result?.reply !== undefined) {
      sendResponse(socket, { success: true, data: { ...view, reply: result.reply } })
      return
    }
  }
  sendResponse(socket, { success: true, data: view })
}

function buildSubmitRequest(req: DaemonRequest): AgentTaskSubmitRequest {
  return {
    platform: typeof req.platform === 'string' ? req.platform : '',
    query: typeof req.query === 'string' ? req.query : '',
    ...(Array.isArray(req.images) ? { images: req.images } : {}),
    ...(typeof req.model === 'string' && req.model ? { model: req.model } : {}),
    ...(req.mode === 'deep_research' ? { mode: 'deep_research' as const } : {}),
    ...(typeof req.conversationUrl === 'string' && req.conversationUrl ? { conversationUrl: req.conversationUrl } : {}),
    ...(asFiniteNumber(req.timeoutMs) !== undefined ? { timeoutMs: asFiniteNumber(req.timeoutMs) } : {}),
    ...(asFiniteNumber(req.queueTimeoutMs) !== undefined ? { queueTimeoutMs: asFiniteNumber(req.queueTimeoutMs) } : {}),
    ...(req.genImage === true ? { genImage: true } : {}),
    ...(typeof req.artifactDir === 'string' && req.artifactDir ? { artifactDir: req.artifactDir } : {}),
    ...(typeof req.idempotencyKey === 'string' && req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {})
  }
}

/**
 * 处理单行命令请求
 */
async function handleRequest(socket: net.Socket, line: string): Promise<void> {
  let req: DaemonRequest
  try {
    req = JSON.parse(line) as DaemonRequest
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    sendResponse(socket, { success: false, error: `请求 JSON 解析失败: ${errMsg}` })
    return
  }

  // 全平台强制鉴权：token 文件位于数据目录，CLI 读取附带
  if (!daemonToken || req.token !== daemonToken) {
    sendResponse(socket, { success: false, error: '未授权的本地 CLI 请求', code: 'DAEMON_UNAVAILABLE' })
    return
  }

  const action = req.action
  if (action === 'status') {
    sendResponse(socket, { success: true, data: 'Daemon is running' })
  } else if (action === 'exec') {
    const model =
      (typeof req.model === 'string' && req.model) ||
      (typeof req.session === 'string' && req.session) ||
      ''
    const prompt = typeof req.prompt === 'string' ? req.prompt : ''
    try {
      const result = await automationService.executeCommand(model, prompt)
      sendResponse(socket, result)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      sendResponse(socket, { success: false, error: errMsg })
    }
  } else if (action === 'collect') {
    const target =
      (typeof req.session === 'string' && req.session) ||
      (typeof req.model === 'string' && req.model) ||
      ''
    try {
      const result = await automationService.collectResult(target)
      sendResponse(socket, result)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      sendResponse(socket, { success: false, error: errMsg })
    }
  } else if (action === 'task.submit') {
    const waitMs = normalizeWaitMs(req.waitMs)
    const result = await agentTaskService.submit(buildSubmitRequest(req))
    if (!result.success) {
      sendResponse(socket, { success: false, error: result.error, code: result.code })
      return
    }
    if (waitMs > 0 && result.data) {
      await respondTaskView(socket, result.data.taskId, waitMs)
      return
    }
    sendResponse(socket, { success: true, data: result.data })
  } else if (action === 'task.status') {
    const taskId = typeof req.taskId === 'string' ? req.taskId : ''
    if (!taskId) {
      sendResponse(socket, { success: false, error: '缺少必填参数 taskId', code: 'INVALID_PARAMS' })
      return
    }
    await respondTaskView(socket, taskId, normalizeWaitMs(req.waitMs))
  } else if (action === 'task.result') {
    const taskId = typeof req.taskId === 'string' ? req.taskId : ''
    if (!taskId) {
      sendResponse(socket, { success: false, error: '缺少必填参数 taskId', code: 'INVALID_PARAMS' })
      return
    }
    const result = await agentTaskService.getResult(taskId)
    if (!result) {
      sendResponse(socket, { success: false, error: `任务不存在: ${taskId}`, code: 'TASK_NOT_FOUND' })
      return
    }
    sendResponse(socket, { success: true, data: result })
  } else if (action === 'task.cancel') {
    const taskId = typeof req.taskId === 'string' ? req.taskId : ''
    if (!taskId) {
      sendResponse(socket, { success: false, error: '缺少必填参数 taskId', code: 'INVALID_PARAMS' })
      return
    }
    const view = await agentTaskService.cancel(taskId)
    if (!view) {
      sendResponse(socket, { success: false, error: `任务不存在: ${taskId}`, code: 'TASK_NOT_FOUND' })
      return
    }
    sendResponse(socket, { success: true, data: { taskId: view.taskId, phase: view.phase } })
  } else if (action === 'task.list') {
    const platform = typeof req.platform === 'string' && req.platform ? req.platform : undefined
    const views = await agentTaskService.list(req.includeFinished === true, platform)
    sendResponse(socket, { success: true, data: views })
  } else if (action === 'platforms') {
    const capabilities = await agentTaskService.capabilities()
    sendResponse(socket, { success: true, data: capabilities })
  } else if (action === 'auth.status') {
    const platform = typeof req.platform === 'string' && req.platform ? req.platform : ''
    const result = await agentTaskService.authStates(platform)
    if (!result.success) {
      sendResponse(socket, { success: false, error: result.error, code: result.code })
      return
    }
    sendResponse(socket, { success: true, data: result.data })
  } else if (action === 'exec-script') {
    // dev/diagnostic：在指定平台的后台会话里执行一段 JS（executeJavaScript），返回其结果。
    // script 由 CLI 侧完全构造，daemon 只做透传；主要用于 DOM 结构探针等一次性脚本。
    const platform = typeof req.platform === 'string' && req.platform ? req.platform : ''
    const sessionKey = typeof req.sessionKey === 'string' && req.sessionKey ? req.sessionKey : platform
    const script = typeof req.script === 'string' ? req.script : ''
    if (!platform) {
      sendResponse(socket, { success: false, error: '缺少必填参数 platform', code: 'INVALID_PARAMS' })
      return
    }
    const win = sessionManager.getSession(sessionKey)
    if (!win || win.isDestroyed()) {
      sendResponse(socket, { success: false, error: `后台会话不存在或已关闭: ${platform}` })
      return
    }
    try {
      const result = await win.webContents.executeJavaScript(script)
      sendResponse(socket, { success: true, data: result })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      sendResponse(socket, { success: false, error: errMsg })
    }
  } else {
    sendResponse(socket, { success: false, error: `不支持的请求动作: ${String(action)}` })
  }
}

/**
 * 启动守护进程服务端
 * @param dataPath 应用数据根目录（getDataPath()），token 文件落在其下以覆盖便携版重定向
 */
export function startDaemonServer(dataPath?: string): void {
  if (server) {
    console.warn('[Daemon] 服务端正在运行，请勿重复启动')
    return
  }

  if (process.platform !== 'win32') {
    try {
      if (fs.existsSync(PIPE_PATH)) {
        fs.unlinkSync(PIPE_PATH)
      }
    } catch (err) {
      console.warn('[Daemon] 清理旧 Socket 文件失败:', err)
    }
  }
  tokenPath = path.join(dataPath || os.tmpdir(), 'daemon.token')
  try {
    daemonToken = loadOrCreateDaemonToken()
  } catch (err) {
    console.error('[Daemon] Token 初始化失败，所有请求将被拒绝:', err)
    daemonToken = ''
  }

  server = net.createServer((socket) => {
    activeSockets.add(socket)
    let buffer = ''
    const requestQueue: string[] = []
    let processing = false

    const processQueue = async () => {
      if (processing) return
      processing = true
      while (requestQueue.length > 0) {
        const line = requestQueue.shift()
        if (line) {
          await handleRequest(socket, line)
        }
      }
      processing = false
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) {
          requestQueue.push(line)
        }
      }
      if (requestQueue.length > 0) {
        void processQueue()
      }
    })

    socket.on('close', () => {
      activeSockets.delete(socket)
    })

    socket.on('error', (err) => {
      console.error('[Daemon] Socket 连接错误:', err.message)
      activeSockets.delete(socket)
    })
  })

  server.on('error', (err) => {
    console.error('[Daemon] 服务端监听发生错误:', err.message)
  })

  server.listen(PIPE_PATH, () => {
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(PIPE_PATH, 0o600)
        fs.chmodSync(tokenPath, 0o600)
      } catch (err) {
        console.warn('[Daemon] 无法收紧 Socket/Token 权限:', err)
      }
    }
    console.log(`[Daemon] 守护进程已启动，正在监听: ${PIPE_PATH}`)
  })
}

/**
 * 停止守护进程服务端
 */
export function stopDaemonServer(): void {
  if (!server) return

  console.log('[Daemon] 正在停止守护进程...')
  for (const socket of activeSockets) {
    if (!socket.destroyed) {
      socket.destroy()
    }
  }
  activeSockets.clear()

  server.close(() => {
    console.log('[Daemon] 守护进程已停止')
    if (process.platform !== 'win32') {
      try {
        if (fs.existsSync(PIPE_PATH)) {
          fs.unlinkSync(PIPE_PATH)
        }
      } catch (err) {
        console.warn('[Daemon] 停止时清理 Socket 文件失败:', err)
      }
    }
  })

  server = null
}
