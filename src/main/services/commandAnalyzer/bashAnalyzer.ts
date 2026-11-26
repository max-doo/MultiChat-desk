/**
 * Bash command analyzer — recursive shell-quote segmentation with
 * quote-aware `$( )` / backtick subexpression extraction, unquoted newline
 * splitting, and wrapper unwrapping.
 *
 * Fail-closed: any op shell-quote cannot map to a known statement
 * separator, any unbalanced `$(` extraction, any nesting depth >3, or any
 * segment whose head is not whitelisted → `readOnly: false`.
 */

import { parse as parseShellQuote } from 'shell-quote'
import { gateExternalCommand, looksLikeInspectablePath, validateStaticCdTarget } from './externalCommandGate'
import { isSensitiveFilePath } from '../permissionPolicy'

export interface BashVerdict {
  readOnly: boolean
  /** Path-shaped bare args extracted from whitelisted command segments. */
  pathArguments: string[]
  /** Static `cd` directory targets — caller verifies workspace boundary. */
  cdTargets?: string[]
  commands: string[]
  rejectReason?: string
}

const SEPARATOR_OPS = new Set(['&&', '||', ';', '|', '&'])
const MAX_DEPTH = 3
const MAX_SEGMENTS = 200

// Strictly read-only commands without arbitrary command execution (`awk`, `sed`)
// or mutating flags (`fd`, `rg`, `sort`, `yq` are gated in externalCommandGate).
const READ_ONLY_HEADS = new Set([
  'cat', 'head', 'tail', 'more', 'less', 'wc', 'grep', 'ls', 'dir',
  'pwd', 'echo', 'printf', 'which', 'where', 'whoami', 'hostname', 'uname',
  'date', 'test', 'true', 'false', 'type', 'file', 'stat', 'du', 'df',
  'ag', 'ack', 'uniq', 'tr', 'cut', 'diff', 'comm', 'join',
  'basename', 'dirname', 'realpath', 'readlink',
  'jq', 'xmllint', 'column', 'expand', 'unexpand', 'fold', 'fmt',
  'nl', 'od', 'xxd', 'hexdump', 'strings', 'md5sum', 'shasum', 'sha256sum',
  'seq', 'sleep'
])

const DENIED_HEADS = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'dd', 'mkfs', 'fdisk', 'mount', 'umount',
  'chmod', 'chown', 'chgrp', 'sudo', 'su', 'doas', 'runuser',
  'kill', 'pkill', 'killall', 'shutdown', 'reboot', 'halt', 'poweroff',
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'rsync', 'ftp',
  'telnet', 'socat', 'nmap',
  'yarn', 'apt', 'apt-get', 'brew', 'pip', 'pip3', 'gem', 'cargo',
  'touch', 'mkdir', 'ln', 'install', 'patch', 'tar',
  'awk', 'sed', 'perl', 'ruby', 'deno', 'bun', 'php',
  'eval', 'exec', 'source', '.', 'export', 'tee',
  'crontab', 'at', 'systemctl', 'service', 'launchctl', 'defaults'
])

const GATED_HEADS = new Set([
  'git', 'npm', 'pnpm', 'tsc', 'find', 'fd', 'rg', 'sort', 'yq',
  'node', 'python', 'python3', 'py',
  // Wrappers — unwrapped and re-walked, never judged on outer args alone.
  'bash', 'sh', 'zsh', 'dash', 'fish', 'powershell', 'pwsh', 'cmd', 'env', 'xargs'
])

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const a = token[0]
    const b = token[token.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return token.slice(1, -1)
  }
  return token
}

// ─── quote-aware $( ) / ` ` extractor & newline splitter ───────────────────
// Returns subexpression texts plus the same command with subexpressions
// replaced by a placeholder token and unquoted newlines turned into `;` (since
// shell-quote treats `\n` as whitespace rather than a command separator).
function extractSubexpressions(cmd: string): { outer: string; subs: string[] } | null {
  const subs: string[] = []
  let out = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  while (i < cmd.length) {
    const ch = cmd[i]
    if (ch === '\\' && !inSingle) {
      out += ch + (cmd[i + 1] ?? '')
      i += 2
      continue
    }
    if (inSingle) {
      if (ch === "'") inSingle = false
      out += ch
      i++
      continue
    }
    if (!inDouble && ch === "'") {
      inSingle = true
      out += ch
      i++
      continue
    }
    if (ch === '"') {
      inDouble = !inDouble
      out += ch
      i++
      continue
    }
    if (!inDouble && (ch === '\n' || ch === '\r')) {
      out += ' ; '
      i++
      continue
    }
    if (ch === '$' && cmd[i + 1] === '(') {
      const inner = readBalanced(cmd, i + 2, '(', ')')
      if (inner === null) return null
      subs.push(cmd.slice(i + 2, i + 2 + inner))
      out += ' __SUB' + (subs.length - 1) + '__ '
      i += 2 + inner + 1
      continue
    }
    if (ch === '`' && !inSingle) {
      const end = cmd.indexOf('`', i + 1)
      if (end === -1) return null
      subs.push(cmd.slice(i + 1, end))
      out += ' __SUB' + (subs.length - 1) + '__ '
      i = end + 1
      continue
    }
    out += ch
    i++
  }
  if (inSingle || inDouble) return null
  return { outer: out, subs }
}

function readBalanced(s: string, start: number, open: string, close: string): number | null {
  let depth = 1
  let inSingle = false
  let inDouble = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && !inSingle) {
      i++
      continue
    }
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (!inDouble && ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = !inDouble
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i - start
    }
  }
  return null
}

// ─── segment walking ────────────────────────────────────────────────────────
interface Segment {
  tokens: string[]
  piped: boolean
}

function segment(command: string): Segment[] | null {
  let tokens: ReturnType<typeof parseShellQuote>
  try {
    tokens = parseShellQuote(command)
  } catch {
    return null
  }
  const segs: Segment[] = []
  let current: string[] = []
  let nextPiped = false
  for (const t of tokens) {
    if (typeof t === 'string') {
      current.push(t)
    } else if (t && typeof t === 'object' && 'op' in t) {
      const op = (t as { op: string }).op
      if (!SEPARATOR_OPS.has(op)) return null
      if (current.length) {
        segs.push({ tokens: current, piped: nextPiped })
        current = []
      }
      nextPiped = op === '|'
    } else {
      return null
    }
  }
  if (current.length) segs.push({ tokens: current, piped: nextPiped })
  return segs
}

function judgeSegment(seg: Segment, verdict: BashVerdict): 'ok' | 'deny' {
  const tokens = seg.tokens
  if (!tokens.length) return 'ok'
  const head = tokens[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
  verdict.commands.push(head)

  if (DENIED_HEADS.has(head)) return 'deny'

  const args = tokens.slice(1).map(stripQuotes)
  if (head === 'cd') {
    const target =
      args.length === 1 && !args[0].startsWith('-')
        ? validateStaticCdTarget(args[0])
        : args.length === 2 && args[0] === '--'
          ? validateStaticCdTarget(args[1])
          : null
    if (!target) {
      verdict.rejectReason = 'unsafe cd target'
      return 'deny'
    }
    verdict.cdTargets ??= []
    verdict.cdTargets.push(target)
    return 'ok'
  }

  if (!READ_ONLY_HEADS.has(head) && !GATED_HEADS.has(head)) return 'deny'

  const gated = gateExternalCommand(head, args, isSensitiveFilePath)
  if (gated) {
    if (!gated.allowed) return 'deny'
    verdict.pathArguments.push(...gated.pathArgs)
    return 'ok'
  }

  // Wrapper heads that failed unwrapInner (e.g., unknown flags) must fail closed.
  if (GATED_HEADS.has(head)) return 'deny'

  // Generic read-only head — extract path-shaped and credential-shaped args.
  for (const s of args) {
    if (!s.startsWith('-') && looksLikeInspectablePath(s, isSensitiveFilePath)) {
      verdict.pathArguments.push(s)
    }
  }
  return 'ok'
}

// ─── wrapper unwrapping ─────────────────────────────────────────────────────
const WRAPPER_HEADS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'fish', 'powershell', 'pwsh', 'cmd', 'env', 'xargs'
])

const ENV_ZERO_ARG_FLAGS = new Set(['-i', '--ignore-environment', '-0', '--null'])
const ENV_VALUE_FLAGS = new Set(['-u', '-C', '--unset', '--chdir'])
const XARGS_ZERO_ARG_FLAGS = new Set([
  '-0', '--null', '-r', '--no-run-if-empty', '-t', '--verbose', '-p', '--interactive', '-x', '--exit', '-i'
])
const XARGS_VALUE_FLAGS = new Set([
  '-n', '-P', '-L', '-I', '-d', '-E', '-s',
  '--max-args', '--max-procs', '--max-lines', '--replace', '--delimiter', '--eof', '--max-chars'
])

function quoteBashToken(token: string): string {
  if (token === '' || /[\s"'\\$`|;&<>()!*?~{}[\]]/.test(token)) {
    return `'${token.replace(/'/g, "'\\''")}'`
  }
  return token
}

function joinBashTokens(tokens: readonly string[]): string {
  return tokens.map(quoteBashToken).join(' ')
}

function unwrapInner(tokens: string[]): string | null {
  const head = tokens[0]?.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
  const args = tokens.slice(1).map(stripQuotes)
  switch (head) {
    case 'bash':
    case 'sh':
    case 'zsh':
    case 'dash':
    case 'fish': {
      for (let i = 0; i < args.length; i++) {
        const v = args[i]
        if (v === '-c' || /^-[a-z]*c[a-z]*$/i.test(v)) return args[i + 1] ?? null
        if (v.startsWith('-')) return null
      }
      return null
    }
    case 'powershell':
    case 'pwsh': {
      for (let i = 0; i < args.length; i++) {
        const v = args[i].toLowerCase()
        if (v === '-command' || v === '-c') return args[i + 1] ?? null
        if (v === '-noprofile' || v === '-noninteractive' || v === '-executionpolicy' || v === '-ep') {
          if (v === '-executionpolicy' || v === '-ep') i++
          continue
        }
        if (v.startsWith('-')) return null
      }
      return null
    }
    case 'cmd': {
      for (let i = 0; i < args.length; i++) {
        const v = args[i].toLowerCase()
        if (v === '/c' || v === '/k') return joinBashTokens(args.slice(i + 1))
      }
      return null
    }
    case 'env': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        const lower = v.toLowerCase()
        if (v === '--') {
          i++
          break
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(v) || ENV_ZERO_ARG_FLAGS.has(v.startsWith('--') ? lower : v)) {
          i++
          continue
        }
        if (lower.startsWith('--unset=') || lower.startsWith('--chdir=')) {
          i++
          continue
        }
        if (ENV_VALUE_FLAGS.has(v.startsWith('--') ? lower : v)) {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'xargs': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        const lower = v.toLowerCase()
        if (v === '--') {
          i++
          break
        }
        if (XARGS_ZERO_ARG_FLAGS.has(v.startsWith('--') ? lower : v) || /^-i.+$/.test(v)) {
          i++
          continue
        }
        if (
          lower.startsWith('--max-args=') ||
          lower.startsWith('--max-procs=') ||
          lower.startsWith('--max-lines=') ||
          lower.startsWith('--replace=') ||
          lower.startsWith('--delimiter=') ||
          lower.startsWith('--eof=') ||
          lower.startsWith('--max-chars=')
        ) {
          i++
          continue
        }
        if (XARGS_VALUE_FLAGS.has(v.startsWith('--') ? lower : v)) {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (/^-[nPLIdsE].+/.test(v)) {
          i++
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    default:
      return null
  }
}

function walk(command: string, depth: number, verdict: BashVerdict): 'ok' | 'deny' | null {
  if (depth > MAX_DEPTH) return 'deny'
  const extracted = extractSubexpressions(command)
  if (!extracted) return null
  const { outer, subs } = extracted

  for (const sub of subs) {
    const r = walk(sub, depth + 1, verdict)
    if (r !== 'ok') return r ?? 'deny'
  }

  const segs = segment(outer)
  if (!segs) return null
  if (segs.length > MAX_SEGMENTS) return 'deny'

  for (const seg of segs) {
    const inner = unwrapInner(seg.tokens)
    if (inner !== null) {
      const r = walk(inner, depth + 1, verdict)
      if (r !== 'ok') return r ?? 'deny'
      continue
    }
    if (judgeSegment(seg, verdict) === 'deny') return 'deny'
  }
  return 'ok'
}

export interface BashParsedSegment {
  tokens: string[]
  piped: boolean
}

function collectSegments(
  command: string,
  depth: number,
  out: BashParsedSegment[],
  inheritedPiped = false
): boolean {
  if (depth > MAX_DEPTH) return false
  const extracted = extractSubexpressions(command)
  if (!extracted) return false
  const { outer, subs } = extracted

  for (const sub of subs) {
    if (!collectSegments(sub, depth + 1, out)) return false
  }

  const segs = segment(outer)
  if (!segs || segs.length > MAX_SEGMENTS) return false

  let isFirst = true
  for (const seg of segs) {
    const effectivePiped = seg.piped || (isFirst && inheritedPiped)
    isFirst = false
    out.push({ tokens: seg.tokens.map(stripQuotes), piped: effectivePiped })
    const inner = unwrapInner(seg.tokens)
    if (inner !== null) {
      if (!collectSegments(inner, depth + 1, out, effectivePiped)) return false
    } else if (seg.tokens.length > 1) {
      const head = seg.tokens[0]?.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
      if (head && WRAPPER_HEADS.has(head)) {
        // Fail closed when a wrapper carries unrecognized flags so callers fall back to regex checks
        return false
      }
    }
  }
  return true
}

/**
 * Parse a bash command into normalized token segments (including unwrapped
 * wrapper subcommands and `$(...)` / backtick subexpressions). Returns `null`
 * when the command cannot be safely segmented.
 */
export function parseBashCommandSegments(command: string): BashParsedSegment[] | null {
  const out: BashParsedSegment[] = []
  return collectSegments(command.trim(), 0, out) ? out : null
}

export function analyzeBashCommand(command: string): BashVerdict {
  const verdict: BashVerdict = { readOnly: false, pathArguments: [], commands: [] }
  const r = walk(command.trim(), 0, verdict)
  verdict.readOnly = r === 'ok'
  if (r === null) verdict.rejectReason = 'unparseable'
  if (r === 'deny' && !verdict.rejectReason) verdict.rejectReason = 'denied segment'
  return verdict
}
