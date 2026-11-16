import net from 'net'
import os from 'os'
import path from 'path'
import fs from 'fs'

export const PIPE_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\multichat-daemon'
    : path.join(os.tmpdir(), `multichat-daemon-${process.getuid?.() ?? 'user'}.sock`)

/**
 * daemon.token 由主进程写入 getDataPath()/daemon.token。
 * CLI 无法访问 Electron app API，按平台数据目录候选逐一探测；
 * 便携版经 ELECTRON_RUN_AS_NODE 运行时 process.execPath 落在应用目录。
 */
function daemonTokenCandidates(): string[] {
  // 开发版 app 名取 package.json name（multichat），打包版取 electron-builder productName（MultiChat）；
  // 大小写敏感文件系统下两个目录可能并存，逐一探测。
  const appNames = ['multichat', 'MultiChat']
  const bases: string[] = []
  if (process.platform === 'win32') {
    bases.push(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
  } else if (process.platform === 'darwin') {
    bases.push(path.join(os.homedir(), 'Library', 'Application Support'))
  } else {
    bases.push(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'))
  }
  const dirs: string[] = []
  for (const base of bases) {
    for (const name of appNames) {
      dirs.push(path.join(base, name), path.join(base, `${name}-dev`))
    }
  }
  const exeDir = path.dirname(process.execPath)
  dirs.push(path.join(exeDir, 'resources', 'data'), path.join(exeDir, 'data'))
  return dirs.map(dir => path.join(dir, 'daemon.token'))
}

function readDaemonToken(): string {
  for (const candidate of daemonTokenCandidates()) {
    try {
      const token = fs.readFileSync(candidate, 'utf8').trim()
      if (token) return token
    } catch {
      // 候选路径不存在时尝试下一个
    }
  }
  return ''
}

export interface DaemonResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

export function sendDaemonRequest<T = unknown>(
  request: Record<string, unknown>,
  jsonMode: boolean,
  options?: { waitMs?: number }
): Promise<DaemonResponse<T>> {
  return new Promise((resolve) => {
    const requestWithToken: Record<string, unknown> = { ...request }
    const token = readDaemonToken()
    if (token) {
      requestWithToken.token = token
    }
    const socket = net.connect(PIPE_PATH)
    let buffer = ''
    let resolved = false

    const cleanup = (): void => {
      if (!socket.destroyed) {
        socket.destroy()
      }
    }

    const handleErrorExit = (errorMsg: string, code = 'DAEMON_UNAVAILABLE'): void => {
      if (resolved) return
      resolved = true
      cleanup()
      if (jsonMode) {
        process.stderr.write(JSON.stringify({ success: false, error: errorMsg, code }, null, 2) + '\n')
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    // 含 waitMs 的请求由 daemon 长轮询，客户端 socket 超时放宽到 waitMs + 5s
    const waitMs = options?.waitMs && options.waitMs > 0 ? options.waitMs : 0
    socket.setTimeout(waitMs > 0 ? waitMs + 5000 : 10_000)
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
