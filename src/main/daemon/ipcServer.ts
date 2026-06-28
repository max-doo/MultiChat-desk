import net from 'net'
import fs from 'fs'
import { automationService } from '../services/AutomationService'

const PIPE_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\multichat-daemon'
    : '/tmp/multichat-daemon.sock'

interface DaemonRequest {
  action?: string
  model?: string
  prompt?: string
  session?: string
  [key: string]: unknown
}

interface DaemonResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

let server: net.Server | null = null
const activeSockets = new Set<net.Socket>()

/**
 * 向 Socket 发送响应，添加统一的分行符 (\n)
 */
function sendResponse(socket: net.Socket, response: DaemonResponse): void {
  if (!socket.writable || socket.destroyed) {
    console.warn('[Daemon] Socket 已断开，响应未发送:', response)
    return
  }
  try {
    socket.write(JSON.stringify(response) + '\n')
  } catch (err) {
    console.error('[Daemon] 发送响应失败:', err)
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
  } else {
    sendResponse(socket, { success: false, error: `不支持的请求动作: ${String(action)}` })
  }
}

/**
 * 启动守护进程服务端
 */
export function startDaemonServer(): void {
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
