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
import { gateExternalCommand, looksLikeInspectablePath } from './externalCommandGate'
import { isSensitiveFilePath } from '../permissionPolicy'

export interface BashVerdict {
  readOnly: boolean
  /** Path-shaped bare args extracted from whitelisted command segments. */
  pathArguments: string[]
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
    if (ch === "'") {
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
    if (ch === "'") {
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
  for (const t of tokens) {
    if (typeof t === 'string') {
      current.push(t)
    } else if (t && typeof t === 'object' && 'op' in t) {
      const op = (t as { op: string }).op
      if (!SEPARATOR_OPS.has(op)) return null
      if (current.length) {
        segs.push({ tokens: current })
        current = []
      }
    } else {
      return null
    }
  }
  if (current.length) segs.push({ tokens: current })
  return segs
}

function judgeSegment(seg: Segment, verdict: BashVerdict): 'ok' | 'deny' {
  const tokens = seg.tokens
  if (!tokens.length) return 'ok'
  const head = tokens[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
  verdict.commands.push(head)

  if (DENIED_HEADS.has(head)) return 'deny'
  if (!READ_ONLY_HEADS.has(head) && !GATED_HEADS.has(head)) return 'deny'

  const args = tokens.slice(1).map(stripQuotes)
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
        if (v === '/c' || v === '/k') return args.slice(i + 1).join(' ')
      }
      return null
    }
    case 'env': {
      let i = 0
      while (i < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[i])) i++
      return i < args.length ? args.slice(i).join(' ') : null
    }
    case 'xargs': {
      const rest = args.filter((a) => !a.startsWith('-'))
      return rest.length ? rest.join(' ') : null
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

export function analyzeBashCommand(command: string): BashVerdict {
  const verdict: BashVerdict = { readOnly: false, pathArguments: [], commands: [] }
  const r = walk(command.trim(), 0, verdict)
  verdict.readOnly = r === 'ok'
  if (r === null) verdict.rejectReason = 'unparseable'
  if (r === 'deny') verdict.rejectReason = 'denied segment'
  return verdict
}
