import { spawn } from 'child_process'
import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

export interface ShellExecuteOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeout?: number
  signal?: AbortSignal
  onData?: (chunk: string) => void
  auditLogPath?: string
}

export interface ShellExecutionResult {
  output: string
  exitCode: number | null
  durationMs: number
  timedOut?: boolean
  aborted?: boolean
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 200 * 1024 // 200KB limit for inline display

export class ShellTool {
  /**
   * Execute a shell command using child_process.spawn.
   * On Windows, uses PowerShell with -NoProfile -NonInteractive -ExecutionPolicy Bypass.
   * On Unix, uses /bin/sh -c.
   */
  public static async execute(
    command: string,
    options: ShellExecuteOptions
  ): Promise<ShellExecutionResult> {
    const isWindows = process.platform === 'win32'
    const cwd = options.cwd
    const env = { ...process.env, ...options.env }
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
    const startTime = Date.now()

    let exe: string
    let args: string[]

    if (isWindows) {
      exe = 'powershell.exe'
      args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
    } else {
      exe = '/bin/sh'
      args = ['-c', command]
    }

    return new Promise<ShellExecutionResult>((resolve) => {
      let outputBuffer = ''
      let timedOut = false
      let aborted = false
      let timeoutTimer: NodeJS.Timeout | null = null

      const child = spawn(exe, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false
      })

      if (timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL')
          }, 1000)
        }, timeout)
      }

      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          aborted = true
          child.kill('SIGTERM')
        })
      }

      const handleChunk = (data: Buffer): void => {
        const text = data.toString('utf-8')
        if (outputBuffer.length < MAX_OUTPUT_BYTES) {
          outputBuffer += text
        }
        if (options.onData) {
          options.onData(text)
        }
      }

      child.stdout?.on('data', handleChunk)
      child.stderr?.on('data', handleChunk)

      child.on('close', async (exitCode) => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        const durationMs = Date.now() - startTime

        // Audit log
        if (options.auditLogPath) {
          try {
            await mkdir(dirname(options.auditLogPath), { recursive: true })
            const logLine = `[${new Date().toISOString()}] cwd="${cwd}" code=${exitCode} dur=${durationMs}ms cmd="${command.replace(/"/g, '\\"')}"\n`
            await appendFile(options.auditLogPath, logLine, 'utf-8')
          } catch {
            // Ignore audit log write failure
          }
        }

        resolve({
          output: outputBuffer,
          exitCode: timedOut ? -1 : (exitCode ?? (aborted ? 130 : null)),
          durationMs,
          timedOut,
          aborted
        })
      })

      child.on('error', (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        const durationMs = Date.now() - startTime
        resolve({
          output: `Spawn error: ${err.message}`,
          exitCode: -1,
          durationMs,
          timedOut,
          aborted
        })
      })
    })
  }

  /**
   * Creates a BashOperations instance compatible with Pi's createBashTool
   */
  public static createBashOperations(auditLogPath?: string): BashOperations {
    return {
      exec: async (command, cwd, opts) => {
        const res = await ShellTool.execute(command, {
          cwd,
          env: opts.env,
          timeout: opts.timeout,
          signal: opts.signal,
          onData: (chunk) => {
            opts.onData(Buffer.from(chunk, 'utf-8'))
          },
          auditLogPath
        })
        return { exitCode: res.exitCode }
      }
    }
  }
}
