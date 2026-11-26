import { createHash } from 'crypto'
import { readFile, readdir, stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import type { AgentFileSnapshot } from '../../shared/types/agentRuntime'

export const FILE_MUTATION_TOOLS = new Set([
  'edit',
  'write',
  'edit_file',
  'str_replace',
  'multi_edit',
  'apply_patch'
])

export const SHELL_TOOLS = new Set(['powershell', 'bash'])

export const MAX_BASELINE_BLOB_BYTES = 10 * 1024 * 1024

const MAX_DIFF_BYTES = 512 * 1024

const MAX_WORKSPACE_SCAN_FILES = 10_000
const MAX_WORKSPACE_SCAN_MS = 300
/**
 * Total bytes of file content the pre-shell scan may hold in memory for revert
 * baselines. Per-file reads still obey `MAX_BASELINE_BLOB_BYTES`; files beyond
 * the total budget fall back to metadata-only entries (unrevertible, never
 * silently wrong).
 */
const MAX_WORKSPACE_SCAN_CONTENT_BYTES = 32 * 1024 * 1024

export const UNKNOWN_SHELL_BASELINE_SHA1 = '__shell_unknown_baseline__'

const SKIP_SCAN_DIRS = new Set([
  '.git',
  'node_modules',
  '.multichat',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  '.idea',
  '.vscode'
])

export interface NormalizedTrackedPath {
  key: string
  displayPath: string
  absPath: string
  name: string
}

export interface WorkspaceFileMeta {
  mtimeMs: number
  size: number
  /**
   * Pre-scan file bytes, captured only when the file fits the per-file and
   * total scan budgets. `undefined` means "content unknown" — callers must
   * never treat it as an empty file.
   */
  content?: Buffer
}

export interface SnapshotWithContent {
  snapshot: AgentFileSnapshot
  content: Buffer | null | undefined
  tooLarge: boolean
}

export function resolveTrackedAbsolutePath(cwd: string, filePath: string): string {
  const trimmed = filePath.trim()
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/')) {
    return resolve(trimmed)
  }
  if (
    trimmed.startsWith('\\\\') ||
    trimmed === '~' ||
    trimmed.startsWith('~/') ||
    trimmed.startsWith('~\\')
  ) {
    return trimmed
  }
  return resolve(cwd, trimmed)
}

export function normalizeTrackedFilePath(cwd: string, rawPath: string): NormalizedTrackedPath {
  const resolvedCwd = resolve(cwd)
  const absPath = resolveTrackedAbsolutePath(resolvedCwd, rawPath)

  let displayPath = absPath
  const isSpecial =
    absPath.startsWith('\\\\') ||
    absPath === '~' ||
    absPath.startsWith('~/') ||
    absPath.startsWith('~\\')

  if (!isSpecial) {
    const rel = relative(resolvedCwd, absPath)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      displayPath = rel.replace(/\\/g, '/')
    }
  }

  const posix = displayPath.replace(/\\/g, '/')
  const key = process.platform === 'win32' ? posix.toLowerCase() : posix
  const name = basename(absPath) || displayPath
  return { key, displayPath, absPath, name }
}

export async function captureBaselineWithContent(absolutePath: string): Promise<SnapshotWithContent> {
  try {
    const info = await stat(absolutePath)
    if (!info.isFile()) {
      return {
        snapshot: { path: absolutePath, mtimeMs: null, size: null, sha1: null },
        content: null,
        tooLarge: false
      }
    }
    if (info.size > MAX_BASELINE_BLOB_BYTES) {
      return {
        snapshot: {
          path: absolutePath,
          mtimeMs: info.mtimeMs,
          size: info.size,
          sha1: `size:${info.size}:mtime:${Math.trunc(info.mtimeMs)}`
        },
        content: undefined,
        tooLarge: true
      }
    }
    const content = await readFile(absolutePath)
    const sha1 = createHash('sha1').update(content).digest('hex')
    return {
      snapshot: { path: absolutePath, mtimeMs: info.mtimeMs, size: info.size, sha1 },
      content,
      tooLarge: false
    }
  } catch {
    return {
      snapshot: { path: absolutePath, mtimeMs: null, size: null, sha1: null },
      content: null,
      tooLarge: false
    }
  }
}

function isLikelyBinary(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8192)
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

function splitTextLines(buf: Buffer | null): string[] {
  if (!buf || buf.length === 0) return []
  const text = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

export function computeLineDiffCounts(
  before: Buffer | null | undefined,
  after: Buffer | null | undefined
): { added: number; deleted: number } {
  if (before === undefined || after === undefined) return { added: 0, deleted: 0 }
  if (before === null && after === null) return { added: 0, deleted: 0 }
  if ((before && before.length > MAX_DIFF_BYTES) || (after && after.length > MAX_DIFF_BYTES)) {
    return { added: 0, deleted: 0 }
  }
  if ((before && isLikelyBinary(before)) || (after && isLikelyBinary(after))) {
    return { added: 0, deleted: 0 }
  }

  const a = splitTextLines(before)
  const b = splitTextLines(after)
  if (a.length === 0) return { added: b.length, deleted: 0 }
  if (b.length === 0) return { added: 0, deleted: a.length }

  // Strip common prefix and suffix first — typical edits only touch a small middle window.
  let start = 0
  const minLen = Math.min(a.length, b.length)
  while (start < minLen && a[start] === b[start]) start++

  let aEnd = a.length - 1
  let bEnd = b.length - 1
  while (aEnd >= start && bEnd >= start && a[aEnd] === b[bEnd]) {
    aEnd--
    bEnd--
  }

  const aMidLen = aEnd - start + 1
  const bMidLen = bEnd - start + 1
  if (aMidLen <= 0 && bMidLen <= 0) return { added: 0, deleted: 0 }
  if (aMidLen <= 0) return { added: bMidLen, deleted: 0 }
  if (bMidLen <= 0) return { added: 0, deleted: aMidLen }

  // Exact LCS for reasonable windows; linear multiset approximation for huge rewrites.
  if (aMidLen * bMidLen <= 2_000_000) {
    let prev = new Uint32Array(bMidLen + 1)
    let curr = new Uint32Array(bMidLen + 1)
    for (let i = 0; i < aMidLen; i++) {
      const aLine = a[start + i]
      for (let j = 0; j < bMidLen; j++) {
        if (aLine === b[start + j]) {
          curr[j + 1] = prev[j] + 1
        } else {
          const up = prev[j + 1]
          const left = curr[j]
          curr[j + 1] = up >= left ? up : left
        }
      }
      const tmp = prev
      prev = curr
      curr = tmp
      curr.fill(0)
    }
    const lcs = prev[bMidLen]
    return {
      added: bMidLen - lcs,
      deleted: aMidLen - lcs
    }
  }

  const freq = new Map<string, number>()
  for (let i = 0; i < aMidLen; i++) {
    const line = a[start + i]
    freq.set(line, (freq.get(line) ?? 0) + 1)
  }
  let matched = 0
  for (let j = 0; j < bMidLen; j++) {
    const line = b[start + j]
    const count = freq.get(line) ?? 0
    if (count > 0) {
      matched++
      freq.set(line, count - 1)
    }
  }
  return {
    added: bMidLen - matched,
    deleted: aMidLen - matched
  }
}

/**
 * Lightweight recursive metadata scan (`relPath -> { mtimeMs, size }`) for `cwd`.
 * Only invoked when a turn runs at least one non-read-only shell command.
 * With `captureContent` (used for the pre-scan), files within the size budgets
 * also get their bytes captured, so mutations caused by shell commands can
 * still be reverted from these pre-scan contents. The post-scan diff pass
 * skips content capture — only metadata matters for detecting changes.
 * Aborts and returns `null` if file count or elapsed time hits the circuit breaker.
 */
export async function scanWorkspaceMetadata(
  cwd: string,
  options?: { captureContent?: boolean }
): Promise<Map<string, WorkspaceFileMeta> | null> {
  const root = resolve(cwd)
  const startedAt = Date.now()
  const files = new Map<string, WorkspaceFileMeta>()
  const captureContent = options?.captureContent !== false
  let contentBytes = 0
  let aborted = false

  const walk = async (dir: string, relPrefix: string): Promise<void> => {
    if (aborted) return
    if (files.size >= MAX_WORKSPACE_SCAN_FILES || Date.now() - startedAt > MAX_WORKSPACE_SCAN_MS) {
      aborted = true
      return
    }

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    const subdirs: Array<{ full: string; rel: string }> = []
    const regularFiles: Array<{ full: string; rel: string }> = []

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const name = entry.name
      if (entry.isDirectory()) {
        if (SKIP_SCAN_DIRS.has(name)) continue
        subdirs.push({
          full: join(dir, name),
          rel: relPrefix ? `${relPrefix}/${name}` : name
        })
      } else if (entry.isFile()) {
        regularFiles.push({
          full: join(dir, name),
          rel: relPrefix ? `${relPrefix}/${name}` : name
        })
      }
    }

    if (regularFiles.length > 0) {
      await Promise.all(
        regularFiles.map(async (f) => {
          if (aborted) return
          try {
            // Read content BEFORE stat when within the per-file budget window:
            // the sha1 that proves identity at revert time is derived from the
            // content, so content must be the authoritative snapshot. Reading
            // first, then statting, guarantees both describe the same state —
            // the reverse order could pair a pre-write stat with post-write
            // bytes when an external process writes in between.
            const info = await stat(f.full)
            if (files.size >= MAX_WORKSPACE_SCAN_FILES) {
              aborted = true
              return
            }
            const meta: WorkspaceFileMeta = { mtimeMs: info.mtimeMs, size: info.size }
            if (captureContent && info.size <= MAX_BASELINE_BLOB_BYTES) {
              try {
                const buf = await readFile(f.full)
                const afterInfo = await stat(f.full).catch(() => null)
                if (!afterInfo || afterInfo.size !== buf.length) {
                  // File mutated mid-read — neither content nor metadata is a
                  // trustworthy snapshot; leave content undefined (fail closed).
                  files.set(f.rel, meta)
                  return
                }
                // Cap retained bytes, not in-flight reads: concurrent reads in
                // one directory batch may transiently overshoot, but only
                // content within the total budget is kept for baselines.
                if (contentBytes + buf.length <= MAX_WORKSPACE_SCAN_CONTENT_BYTES) {
                  contentBytes += buf.length
                  meta.content = buf
                  meta.mtimeMs = afterInfo.mtimeMs
                  meta.size = afterInfo.size
                }
              } catch {
                // Unreadable content stays undefined — metadata-only entry.
              }
            }
            files.set(f.rel, meta)
          } catch {
            // File vanished mid-scan; ignore.
          }
        })
      )
    }

    if (aborted || Date.now() - startedAt > MAX_WORKSPACE_SCAN_MS) {
      aborted = true
      return
    }

    for (const sub of subdirs) {
      await walk(sub.full, sub.rel)
      if (aborted) return
    }
  }

  await walk(root, '')
  return aborted ? null : files
}

export interface WorkspaceMetadataDiff {
  added: string[]
  modified: string[]
  deleted: string[]
}

export function diffWorkspaceMetadata(
  before: Map<string, WorkspaceFileMeta>,
  after: Map<string, WorkspaceFileMeta>
): WorkspaceMetadataDiff {
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  for (const [relPath, afterMeta] of after.entries()) {
    const prev = before.get(relPath)
    if (!prev) {
      added.push(relPath)
    } else if (prev.mtimeMs !== afterMeta.mtimeMs || prev.size !== afterMeta.size) {
      modified.push(relPath)
    }
  }

  for (const relPath of before.keys()) {
    if (!after.has(relPath)) {
      deleted.push(relPath)
    }
  }

  return { added, modified, deleted }
}
