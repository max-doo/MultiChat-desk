import net from 'net'

export const PIPE_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\multichat-daemon'
    : '/tmp/multichat-daemon.sock'

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
        console.log(JSON.stringify({ success: false, error: errorMsg }, null, 2))
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED' || err.code === 'EPIPE') {
        handleErrorExit('MultiChat 应用未运行，请先启动 MultiChat')
      } else {
        handleErrorExit(`连接 Daemon 失败: ${err.message}`)
      }
    })

    socket.on('connect', () => {
      try {
        socket.write(JSON.stringify(request) + '\n')
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
