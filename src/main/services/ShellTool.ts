import { spawn } from 'child_process'
import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import { decodeCommandOutput, getFallbackDecoder } from './encoding'
import { redactShellOutput } from './redact'

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

/**
 * Match pi's powershell tool: switch the .NET console output encoding to UTF-8
 * so the whole command chain — including nested `cmd`/`Write-Output` and most
 * native executables inheriting the console — emits UTF-8 instead of the OEM
 * code page (GBK on zh-CN). Verified on this repo's dev machine.
 */
const UTF8_OUTPUT_PREFIX =
  'try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n'

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

let cachedShellConfig: { exe: string; args: string[] } | null = null

/**
 * Resolve the platform shell through pi's own detector so we inherit its
 * probing (Git Bash locations → PATH → WSL stdin transport on Windows;
 * /bin/bash → PATH bash → sh on Unix; pwsh preferred over powershell.exe).
 * Falls back to hardcoded defaults if the pi module cannot be loaded.
 */
async function resolveShell(): Promise<{ exe: string; args: string[] }> {
  if (cachedShellConfig) return cachedShellConfig
  try {
    const mod = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
      '@earendil-works/pi-coding-agent'
    )
    const isWindows = process.platform === 'win32'
    const config = isWindows ? mod.getPowerShellConfig() : mod.getShellConfig()
    const args = [...(config.args ?? [])]
    if (isWindows) {
      // pi's powershell tool prepends the UTF-8 prefix to every command — do
      // the same here so our own spawn channel matches its behavior.
      cachedShellConfig = { exe: config.shell, args }
    } else {
      cachedShellConfig = { exe: config.shell, args }
    }
    return cachedShellConfig
  } catch {
    const isWindows = process.platform === 'win32'
    cachedShellConfig = isWindows
      ? {
          exe: 'powershell.exe',
          args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
        }
      : { exe: '/bin/sh', args: ['-c'] }
    return cachedShellConfig
  }
}

export class ShellTool {
  /**
   * Execute a shell command using child_process.spawn.
   * On Windows, uses the detected PowerShell (pwsh preferred) with
   * -NoProfile -NonInteractive -ExecutionPolicy Bypass and a UTF-8 output
   * prefix. On Unix, uses the detected bash/sh.
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

    // Pre-fire the ANSI code-page probe so it overlaps the child process.
    const fallbackDecoderPromise = isWindows ? getFallbackDecoder() : Promise.resolve(null)

    const { exe, args: baseArgs } = await resolveShell()
    const finalCommand = isWindows ? `${UTF8_OUTPUT_PREFIX}${command}` : command
    const args = [...baseArgs, finalCommand]

    return new Promise<ShellExecutionResult>((resolve) => {
      let outputBuffer = ''
      let pendingPreview = ''
      const rawChunks: Buffer[] = []
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

      const flushDecoded = async (): Promise<void> => {
        const fallback = await fallbackDecoderPromise
        const text = decodeCommandOutput(Buffer.concat(rawChunks), fallback)
        const redacted = redactShellOutput(text)
        outputBuffer = redacted.length > MAX_OUTPUT_BYTES ? redacted.slice(0, MAX_OUTPUT_BYTES) : redacted
      }

      const handleChunk = (data: Buffer): void => {
        rawChunks.push(data)
        if (options.onData) {
          // Incremental preview of just this chunk. A GBK or split multi-byte
          // tail renders as replacement chars here but never as mojibake; the
          // close handler re-decodes the full buffer with the ANSI code-page
          // fallback for the authoritative result. We hold back the last
          // incomplete line so a secret split across two chunks doesn't leak
          // one fragment in the preview before the redactor can see the
          // whole `NAME=value` pair.
          const text = decodeCommandOutput(data, null)
          pendingPreview = (pendingPreview + text).replace(/\r\n/g, '\n')
          const lastNewline = pendingPreview.lastIndexOf('\n')
          if (lastNewline !== -1) {
            const safe = pendingPreview.slice(0, lastNewline + 1)
            pendingPreview = pendingPreview.slice(lastNewline + 1)
            options.onData(redactShellOutput(safe))
          }
        }
      }

      child.stdout?.on('data', handleChunk)
      child.stderr?.on('data', handleChunk)

      child.on('close', async (exitCode) => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        const durationMs = Date.now() - startTime

        if (pendingPreview && options.onData) {
          options.onData(redactShellOutput(pendingPreview))
          pendingPreview = ''
        }

        await flushDecoded()

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
        if (options.onData) {
          options.onData(`Spawn error: ${err.message}\n`)
        }
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
          // pi's tool contract passes timeout in seconds ("Timeout in seconds");
          // ShellTool works in milliseconds. Without this conversion a model
          // asking for 30 seconds got killed after 30 milliseconds.
          timeout: opts.timeout === undefined ? undefined : opts.timeout * 1000,
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
