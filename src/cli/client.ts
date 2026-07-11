import net from 'net'
import os from 'os'
import path from 'path'
import fs from 'fs'

export const PIPE_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\multichat-daemon'
    : path.join(os.tmpdir(), `multichat-daemon-${process.getuid?.() ?? 'user'}.sock`)
const TOKEN_PATH = `${PIPE_PATH}.token`

export interface DaemonResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export function sendDaemonRequest<T = unknown>(
  request: Record<string, unknown>,
  jsonMode: boolean
): Promise<DaemonResponse<T>> {
  return new Promise((resolve) => {
    const requestWithToken: Record<string, unknown> = { ...request }
    if (process.platform !== 'win32') {
      try {
        requestWithToken.token = fs.readFileSync(TOKEN_PATH, 'utf8').trim()
      } catch {
        const message = '无法读取本地 CLI 授权信息，请确认 MultiChat 正在运行'
        if (jsonMode) process.stderr.write(JSON.stringify({ success: false, error: message }, null, 2) + '\n')
        else console.error(message)
        process.exit(1)
      }
    }
    const socket = net.connect(PIPE_PATH)
    let buffer = ''
    let resolved = false

    const cleanup = (): void => {
      if (!socket.destroyed) {
        socket.destroy()
      }
    }

    const handleErrorExit = (errorMsg: string): void => {
      if (resolved) return
      resolved = true
      cleanup()
      if (jsonMode) {
        process.stderr.write(JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n')
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    socket.setTimeout(10_000)
    socket.on('timeout', () => {
      handleErrorExit('连接超时，请确认 MultiChat 正在运行')
    })

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED' || err.code === 'EPIPE') {
        handleErrorExit('MultiChat 应用未运行，请先启动 MultiChat')
      } else {
        handleErrorExit(`连接 Daemon 失败: ${err.message}`)
      }
    })

    socket.on('connect', () => {
      try {
        socket.write(JSON.stringify(requestWithToken) + '\n')
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        handleErrorExit(`发送请求失败: ${errMsg}`)
      }
    })

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex !== -1) {
        if (resolved) return
        resolved = true
        const line = buffer.slice(0, newlineIndex).trim()
        cleanup()
        try {
          const res = JSON.parse(line) as DaemonResponse<T>
          resolve(res)
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err)
          handleErrorExit(`响应解析失败: ${errMsg}`)
        }
      }
    })

    socket.on('close', () => {
      if (!resolved) {
        handleErrorExit('与 Daemon 的连接已过早断开')
      }
    })
  })
}
