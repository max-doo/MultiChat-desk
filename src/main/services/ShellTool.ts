import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import { decodeCommandOutput, getFallbackDecoder } from './encoding'
import { redactShellOutput } from './redact'

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

const MAX_LINE_BUFFER_BYTES = 64 * 1024

let cachedLocalOperations: BashOperations | null = null

async function getLocalShellOperations(): Promise<BashOperations> {
  if (cachedLocalOperations) return cachedLocalOperations
  const mod = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
    '@earendil-works/pi-coding-agent'
  )
  cachedLocalOperations =
    process.platform === 'win32'
      ? mod.createLocalPowerShellOperations()
      : mod.createLocalBashOperations()
  return cachedLocalOperations
}

/**
 * Find the largest byte prefix length <= buf.length that does not split a
 * trailing multi-byte UTF-8 sequence, GBK double-byte sequence, or odd
 * UTF-16LE code unit.
 */
function safeFlushPrefixLength(buf: Buffer, hasNullBytes: boolean): number {
  if (buf.length === 0) return 0
  if (hasNullBytes) {
    return buf.length % 2 === 0 ? buf.length : buf.length - 1
  }
  // Check trailing incomplete UTF-8 sequence first
  let utf8Cut = buf.length
  const minCheck = Math.max(0, buf.length - 3)
  for (let i = buf.length - 1; i >= minCheck; i--) {
    const b = buf[i]
    if (b < 0x80) break
    if ((b & 0xc0) === 0xc0) {
      const expectedLen = (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : 4
      if (buf.length - i < expectedLen) utf8Cut = i
      break
    }
  }
  // If the candidate prefix isn't valid strict UTF-8, walk ANSI/GBK 2-byte pairs
  // from index 0 so we don't cleave a trailing GBK lead byte (`0x81..0xFE`).
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, utf8Cut))
    return utf8Cut
  } catch {
    let i = 0
    while (i < buf.length) {
      if (buf[i] < 0x80) {
        i += 1
      } else if (i + 1 < buf.length) {
        i += 2
      } else {
        return i
      }
    }
    return buf.length
  }
}

/** Find the byte offset right after the last UTF-16LE `\n` (`0x0a 0x00` at an even index). */
function lastUtf16LeLineEnd(buf: Buffer): number {
  const evenEnd = (buf.length & ~1) - 2
  for (let i = evenEnd; i >= 0; i -= 2) {
    if (buf[i] === 0x0a && buf[i + 1] === 0x00) {
      return i + 2
    }
  }
  return -1
}

export class ShellTool {
  /**
   * Wrap pi's built-in local shell operations (`createLocalPowerShellOperations`
   * on Windows, `createLocalBashOperations` on Unix) so we inherit process-tree
   * termination, pipe/descendant handling (`waitForChildProcess`), timeout
   * validation/errors (`timeout:<seconds>`), and no forced default timeout,
   * while adding line-buffered GBK/UTF-8 decoding, secret redaction, and audit logging.
   */
  public static createBashOperations(auditLogPath?: string): BashOperations {
    return {
      exec: async (command, cwd, opts) => {
        const isWindows = process.platform === 'win32'
        const fallbackPromise = isWindows ? getFallbackDecoder() : Promise.resolve(null)
        const baseOps = await getLocalShellOperations()

        let fallback: Awaited<ReturnType<typeof getFallbackDecoder>> = null
        let fallbackReady = !isWindows
        let pendingBytes: Buffer = Buffer.alloc(0)
        let settled = false

        const emitDecoded = (buf: Buffer): void => {
          if (buf.length === 0) return
          const decoded = decodeCommandOutput(buf, fallback).replace(/\r\n/g, '\n')
          const redacted = redactShellOutput(decoded)
          if (redacted) {
            opts.onData(Buffer.from(redacted, 'utf-8'))
          }
        }

        const flushBuffer = (forceAll: boolean): void => {
          if (pendingBytes.length === 0) return
          if (forceAll) {
            const rest = pendingBytes
            pendingBytes = Buffer.alloc(0)
            emitDecoded(rest)
            return
          }

          const hasNull = pendingBytes.includes(0)
          const splitAt = hasNull
            ? lastUtf16LeLineEnd(pendingBytes)
            : (() => {
                const lastLf = pendingBytes.lastIndexOf(0x0a)
                return lastLf !== -1 ? lastLf + 1 : -1
              })()
          if (splitAt > 0) {
            const complete = pendingBytes.subarray(0, splitAt)
            pendingBytes = pendingBytes.subarray(splitAt)
            emitDecoded(complete)
          }

          if (pendingBytes.length >= MAX_LINE_BUFFER_BYTES) {
            const safeLen = safeFlushPrefixLength(pendingBytes, pendingBytes.includes(0))
            if (safeLen > 0) {
              const chunk = pendingBytes.subarray(0, safeLen)
              pendingBytes = pendingBytes.subarray(safeLen)
              emitDecoded(chunk)
            }
          }
        }

        if (isWindows) {
          void fallbackPromise.then((decoder) => {
            fallback = decoder
            fallbackReady = true
            if (!settled && pendingBytes.length > 0) {
              flushBuffer(false)
            }
          })
        }

        const startTime = Date.now()
        let auditStatus = 'null'
        try {
          const res = await baseOps.exec(command, cwd, {
            ...opts,
            onData: (chunk) => {
              pendingBytes = pendingBytes.length === 0 ? chunk : Buffer.concat([pendingBytes, chunk])
              if (fallbackReady) {
                flushBuffer(false)
              }
            }
          })
          auditStatus = String(res.exitCode)
          return res
        } catch (err) {
          auditStatus = err instanceof Error ? err.message : String(err)
          throw err
        } finally {
          settled = true
          if (pendingBytes.length > 0) {
            if (!fallbackReady) {
              fallback = await fallbackPromise
              fallbackReady = true
            }
            flushBuffer(true)
          }
          if (auditLogPath) {
            const durationMs = Date.now() - startTime
            try {
              await mkdir(dirname(auditLogPath), { recursive: true })
              const safeStatus = auditStatus.replace(/[\r\n]+/g, ' ')
              const redactedCmd = redactShellOutput(command)
              const logLine = `[${new Date().toISOString()}] cwd=${JSON.stringify(cwd)} code=${safeStatus} dur=${durationMs}ms cmd=${JSON.stringify(redactedCmd)}\n`
              await appendFile(auditLogPath, logLine, 'utf-8')
            } catch {
              // Ignore audit log write failure
            }
          }
        }
      }
    }
  }
}
