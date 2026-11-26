import { createHash } from 'crypto'
import { readFile, readdir, stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import type { AgentFileSnapshot } from '../../shared/types/agentRuntime'

/** Tools whose arguments directly name a mutated file path. */
export const FILE_MUTATION_TOOLS = new Set([
  'edit',
  'write',
  'edit_file',
  'str_replace',
  'multi_edit',
  'apply_patch'
])

/** Shell tools that may mutate arbitrary workspace files when non-read-only. */
export const SHELL_TOOLS = new Set(['powershell', 'bash'])

/** Max file size cached in memory / written to baseline blobs for undo (10 MiB). */
export const MAX_BASELINE_BLOB_BYTES = 10 * 1024 * 1024

/** Max single-file size for line-level diff calculation (512 KiB). */
const MAX_DIFF_BYTES = 512 * 1024

/** Hard circuit breakers for lightweight workspace metadata scans (non-read-only shell only). */
const MAX_WORKSPACE_SCAN_FILES = 10_000
const MAX_WORKSPACE_SCAN_MS = 300

/** Sentinel sha1 for pre-existing files modified/deleted by shell without a pre-edit content blob. */
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
  /** Case-folded (on Windows) POSIX key for deduplicating paths in one turn. */
  key: string
  /** Workspace-relative POSIX path when inside `cwd`, otherwise resolved absolute path. */
  displayPath: string
  /** Absolute filesystem path for I/O. */
  absPath: string
  /** File basename for compact display. */
  name: string
}

export interface WorkspaceFileMeta {
  mtimeMs: number
  size: number
}

export interface SnapshotWithContent {
  snapshot: AgentFileSnapshot
  /** Raw bytes captured before mutation, `null` if file did not exist, `undefined` if too large to cache. */
  content: Buffer | null | undefined
  /** True when the file existed but exceeded `MAX_BASELINE_BLOB_BYTES`. */
  tooLarge: boolean
}

/**
 * Resolve a tool-reported file path against `cwd`.
 * Keeps UNC and `~` paths untouched (same convention as renderer `filePathUtils`).
 */
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

/**
 * Normalize a tool-reported path so `./foo.md`, `foo.md`, and `C:\ws\foo.md`
 * all collapse to the exact same tracking key and display path.
 */
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

/**
 * Capture both metadata/sha1 and (when within size budget) raw bytes of a file
 * BEFORE a mutating tool writes to disk.
 */
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

/**
 * Compute net added / deleted line counts between baseline and target buffers.
 * Returns `{ added: 0, deleted: 0 }` for binary or oversized files.
 */
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
 * Aborts and returns `null` if file count or elapsed time hits the circuit breaker.
 */
export async function scanWorkspaceMetadata(
  cwd: string
): Promise<Map<string, WorkspaceFileMeta> | null> {
  const root = resolve(cwd)
  const startedAt = Date.now()
  const files = new Map<string, WorkspaceFileMeta>()
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
            const info = await stat(f.full)
            if (files.size >= MAX_WORKSPACE_SCAN_FILES) {
              aborted = true
              return
            }
            files.set(f.rel, { mtimeMs: info.mtimeMs, size: info.size })
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

/** Compare pre-shell and post-shell workspace metadata maps. */
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
