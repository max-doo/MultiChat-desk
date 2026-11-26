/**
 * Bash command analyzer — recursive shell-quote segmentation with
 * quote-aware `$( )` / backtick subexpression extraction, unquoted newline
 * splitting, redirection/write-command tracking, and wrapper unwrapping.
 *
 * Fail-closed: any op shell-quote cannot map to a known statement separator
 * or file redirection, any unbalanced `$(` extraction, any nesting depth >3,
 * or any segment whose head is not whitelisted → `readOnly: false`.
 */

import { parse as parseShellQuote } from 'shell-quote'
import { gateExternalCommand, looksLikeInspectablePath, validateStaticCdTarget } from './externalCommandGate'
import { isSensitiveFilePath } from '../permissionPolicy'

export interface BashVerdict {
  readOnly: boolean
  /** 命令会向路径参数写入内容；边界校验由调用方完成。 */
  writeOps?: boolean
  pathArguments: string[]
  /** 从重定向与文件写入命令中提取的明确写入/删除目标。 */
  writeTargets?: string[]
  /** 静态 `cd` 目录目标；工作区边界由调用方验证。 */
  cdTargets?: string[]
  commands: string[]
  rejectReason?: string
  /** 高风险构造，即使在 bypass 模式也必须确认。 */
  bypassRequiresApproval?: boolean
  bypassReason?: string
}

const SEPARATOR_OPS = new Set(['&&', '||', ';', '|', '|&', '&'])
const WRITE_REDIRECT_OPS = new Set(['>', '>>', '>|', '&>', '&>>'])
const MAX_DEPTH = 3
const MAX_SEGMENTS = 200
const UNRESOLVED_TARGET = '$__UNRESOLVED_TARGET__'

function preserveShellVar(key: string): string {
  return key ? `\${${key}}` : '$'
}

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

const WRITE_HEADS = new Set(['mkdir', 'touch', 'cp', 'mv', 'tee'])

const PRIVILEGE_ESCALATION_HEADS = new Set(['sudo', 'doas', 'su'])

const DENIED_HEADS = new Set([
  'rm', 'rmdir', 'dd', 'mkfs', 'fdisk', 'parted', 'wipefs', 'blkdiscard', 'mount', 'umount',
  'chmod', 'chown', 'chgrp', 'sudo', 'su', 'doas', 'runuser',
  'kill', 'pkill', 'killall', 'shutdown', 'reboot', 'halt', 'poweroff',
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'rsync', 'ftp',
  'telnet', 'socat', 'nmap',
  'yarn', 'apt', 'apt-get', 'brew', 'pip', 'pip3', 'gem', 'cargo',
  'ln', 'install', 'patch', 'tar',
  'awk', 'sed', 'perl', 'ruby', 'deno', 'bun', 'php',
  'eval', 'exec', 'source', '.', 'export',
  'crontab', 'at', 'systemctl', 'service', 'launchctl', 'defaults', 'diskutil'
])

const GATED_HEADS = new Set([
  'git', 'npm', 'pnpm', 'tsc', 'find', 'fd', 'rg', 'sort', 'yq',
  'node', 'python', 'python3', 'py',
  // Wrappers — unwrapped and re-walked, never judged on outer args alone.
  'bash', 'sh', 'zsh', 'dash', 'fish', 'powershell', 'pwsh', 'cmd', 'env', 'xargs'
])

const SHELL_OR_EVAL_HEADS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'eval', 'source', '.'])

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const a = token[0]
    const b = token[token.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return token.slice(1, -1)
  }
  return token
}

function normalizeHead(raw: string): string {
  return raw.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
}

// Returns subexpression texts plus the same command with subexpressions
// replaced by a placeholder token, unquoted newlines turned into `;`, and
// unquoted IO_NUMBER prefixes (e.g. `2>/dev/null`, `2>&1`) stripped so
// redirection operators parse cleanly without leaking fd digits into args.
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
    if (!inDouble && ch >= '0' && ch <= '9' && (out.length === 0 || /[\s;|&(]$/.test(out))) {
      const rest = cmd.slice(i)
      const ioMatch = rest.match(/^(\d+)(?=(?:>>?|>\||>&|<))/)
      if (ioMatch) {
        i += ioMatch[1].length
        continue
      }
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

interface Segment {
  tokens: string[]
  piped: boolean
  writeRedirects: string[]
  readRedirects: string[]
  unresolvedRedirect: boolean
}

function segment(command: string): Segment[] | null {
  let tokens: ReturnType<typeof parseShellQuote>
  try {
    tokens = parseShellQuote(command, preserveShellVar)
  } catch {
    return null
  }
  const segs: Segment[] = []
  let current: string[] = []
  let writeRedirects: string[] = []
  let readRedirects: string[] = []
  let unresolvedRedirect = false
  let nextPiped = false

  const flush = () => {
    if (current.length || writeRedirects.length || readRedirects.length || unresolvedRedirect) {
      segs.push({ tokens: current, piped: nextPiped, writeRedirects, readRedirects, unresolvedRedirect })
      current = []
      writeRedirects = []
      readRedirects = []
      unresolvedRedirect = false
    }
  }

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]
    if (typeof t === 'string') {
      current.push(t)
    } else if (t && typeof t === 'object' && 'op' in t) {
      const op = (t as { op: string }).op
      if (SEPARATOR_OPS.has(op)) {
        flush()
        nextPiped = op === '|' || op === '|&'
      } else if (WRITE_REDIRECT_OPS.has(op) || op === '>&' || op === '<') {
        const next = tokens[idx + 1]
        if (typeof next !== 'string') return null
        idx++
        const target = stripQuotes(next)
        if (op === '>&' && /^(?:\d+|-)$/.test(target)) {
          continue
        }
        if (target === '/dev/null') {
          continue
        }
        if (/__SUB\d+__/.test(target)) {
          unresolvedRedirect = true
          if (op !== '<') writeRedirects.push(UNRESOLVED_TARGET)
          else readRedirects.push(UNRESOLVED_TARGET)
        } else if (op === '<') {
          readRedirects.push(target)
        } else {
          writeRedirects.push(target)
        }
      } else {
        return null
      }
    } else {
      return null
    }
  }
  flush()
  return segs
}

function evaluateBashWriteCommand(head: string, args: readonly string[], verdict: BashVerdict): 'ok' | 'deny' {
  const pushWriteTarget = (target: string) => {
    verdict.pathArguments.push(target)
    verdict.writeTargets ??= []
    verdict.writeTargets.push(target)
  }

  const pushPathOnly = (target: string) => {
    verdict.pathArguments.push(target)
  }

  if (head === 'mkdir') {
    const paths: string[] = []
    let afterEndOfFlags = false
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (!afterEndOfFlags && a === '--') {
        afterEndOfFlags = true
        continue
      }
      if (!afterEndOfFlags && a.startsWith('-')) {
        if (a === '-m' || a === '--mode') {
          if (i + 1 >= args.length) return 'deny'
          i++
          continue
        }
        if (a.startsWith('--mode=') || a === '--parents' || a === '--verbose' || /^-[pvZ]+$/.test(a)) {
          continue
        }
        return 'deny'
      }
      paths.push(a)
    }
    if (paths.length === 0) return 'deny'
    verdict.writeOps = true
    for (const p of paths) pushWriteTarget(p)
    return 'ok'
  }

  if (head === 'touch') {
    const paths: string[] = []
    const refPaths: string[] = []
    let afterEndOfFlags = false
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (!afterEndOfFlags && a === '--') {
        afterEndOfFlags = true
        continue
      }
      if (!afterEndOfFlags && a.startsWith('-')) {
        if (a === '-d' || a === '--date' || a === '-t') {
          if (i + 1 >= args.length) return 'deny'
          i++
          continue
        }
        if (a === '-r' || a === '--reference') {
          if (i + 1 >= args.length) return 'deny'
          refPaths.push(args[++i])
          continue
        }
        if (a.startsWith('--date=')) continue
        if (a.startsWith('--reference=')) {
          refPaths.push(a.slice('--reference='.length))
          continue
        }
        if (a === '--no-create' || a === '--no-dereference' || /^-[acmch]+$/.test(a)) {
          continue
        }
        return 'deny'
      }
      paths.push(a)
    }
    if (paths.length === 0) return 'deny'
    verdict.writeOps = true
    for (const r of refPaths) pushPathOnly(r)
    for (const p of paths) pushWriteTarget(p)
    return 'ok'
  }

  if (head === 'cp' || head === 'mv') {
    const paths: string[] = []
    let targetDir: string | null = null
    let afterEndOfFlags = false
    const isCp = head === 'cp'
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (!afterEndOfFlags && a === '--') {
        afterEndOfFlags = true
        continue
      }
      if (!afterEndOfFlags && a.startsWith('-')) {
        if (a === '-t' || a === '--target-directory') {
          if (i + 1 >= args.length || targetDir !== null) return 'deny'
          targetDir = args[++i]
          continue
        }
        if (a.startsWith('--target-directory=')) {
          if (targetDir !== null) return 'deny'
          targetDir = a.slice('--target-directory='.length)
          continue
        }
        if (
          isCp &&
          (a === '--recursive' || a === '--force' || a === '--interactive' || a === '--no-clobber' ||
            a === '--archive' || a === '--update' || a === '--verbose' || a === '--no-target-directory' ||
            /^-[rRfinaLpuvPHT]+$/.test(a))
        ) {
          continue
        }
        if (
          !isCp &&
          (a === '--force' || a === '--interactive' || a === '--no-clobber' || a === '--update' ||
            a === '--verbose' || a === '--no-target-directory' || /^-[finuvT]+$/.test(a))
        ) {
          continue
        }
        return 'deny'
      }
      paths.push(a)
    }
    if (targetDir !== null) {
      if (paths.length < 1) return 'deny'
      verdict.writeOps = true
      for (const p of paths) {
        if (isCp) pushPathOnly(p)
        else pushWriteTarget(p)
      }
      pushWriteTarget(targetDir)
      return 'ok'
    }
    if (paths.length < 2) return 'deny'
    verdict.writeOps = true
    for (let i = 0; i < paths.length; i++) {
      if (!isCp || i === paths.length - 1) {
        pushWriteTarget(paths[i])
      } else {
        pushPathOnly(paths[i])
      }
    }
    return 'ok'
  }

  if (head === 'tee') {
    const paths: string[] = []
    let afterEndOfFlags = false
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (!afterEndOfFlags && a === '--') {
        afterEndOfFlags = true
        continue
      }
      if (!afterEndOfFlags && a.startsWith('-')) {
        if (a === '--append' || a === '--ignore-interrupts' || a.startsWith('--output-error=') || /^-[aip]+$/.test(a)) {
          continue
        }
        return 'deny'
      }
      if (a !== '/dev/null') paths.push(a)
    }
    if (paths.length === 0) return 'deny'
    verdict.writeOps = true
    for (const p of paths) pushWriteTarget(p)
    return 'ok'
  }

  return 'deny'
}

function judgeSegment(seg: Segment, verdict: BashVerdict): 'ok' | 'deny' {
  if (seg.unresolvedRedirect) {
    verdict.rejectReason = 'unresolved redirect target'
    return 'deny'
  }
  for (const r of seg.readRedirects) {
    verdict.pathArguments.push(r)
  }
  if (seg.writeRedirects.length > 0) {
    verdict.writeOps = true
    verdict.writeTargets ??= []
    for (const w of seg.writeRedirects) {
      verdict.pathArguments.push(w)
      verdict.writeTargets.push(w)
    }
  }

  const tokens = seg.tokens
  if (!tokens.length) {
    // Pure redirection like `> out.txt`
    return seg.writeRedirects.length > 0 ? 'ok' : 'deny'
  }

  const rawHead = tokens[0]
  if (/^\$\{?[A-Za-z_]/.test(rawHead)) {
    verdict.bypassRequiresApproval = true
    verdict.bypassReason ??= '命令包含未解析的动态变量命令头，需要确认。'
    return 'deny'
  }

  const head = normalizeHead(rawHead)
  verdict.commands.push(head)

  if (PRIVILEGE_ESCALATION_HEADS.has(head)) {
    verdict.bypassRequiresApproval = true
    verdict.bypassReason ??= '提权命令（sudo/doas/su）在 bypass 模式下也需要确认。'
    return 'deny'
  }

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

  if (WRITE_HEADS.has(head)) {
    return evaluateBashWriteCommand(head, args, verdict)
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

const TRANSPARENT_WRAPPER_HEADS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'fish', 'powershell', 'pwsh', 'cmd', 'env', 'xargs'
])

const HARD_DENY_WRAPPER_HEADS = new Set([
  ...TRANSPARENT_WRAPPER_HEADS,
  'sudo', 'doas', 'su', 'nohup', 'nice', 'timeout', 'setsid', 'command', 'exec', 'time', 'stdbuf'
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
const SUDO_ZERO_ARG_FLAGS = new Set(['-A', '-b', '-E', '-H', '-k', '-K', '-n', '-P', '-S', '-v'])
const SUDO_VALUE_FLAGS = new Set(['-C', '-g', '-h', '-p', '-r', '-t', '-U', '-u'])
const DOAS_ZERO_ARG_FLAGS = new Set(['-n', '-s', '-L'])
const DOAS_VALUE_FLAGS = new Set(['-C', '-u'])
const TIMEOUT_ZERO_ARG_FLAGS = new Set(['--foreground', '--preserve-status', '-v', '--verbose'])
const TIMEOUT_VALUE_FLAGS = new Set(['-k', '-s', '--kill-after', '--signal'])
const SETSID_ZERO_ARG_FLAGS = new Set(['-c', '-f', '-w', '--ctty', '--fork', '--wait'])
const STDBUF_VALUE_FLAGS = new Set(['-i', '-o', '-e', '--input', '--output', '--error'])

function quoteBashToken(token: string): string {
  if (token === '' || /[\s"'\\$`|;&<>()!*?~{}[\]]/.test(token)) {
    return `'${token.replace(/'/g, "'\\''")}'`
  }
  return token
}

function joinBashTokens(tokens: readonly string[]): string {
  return tokens.map(quoteBashToken).join(' ')
}

function unwrapInner(tokens: string[], allowPrivilegeWrappers = false): string | null {
  const head = tokens[0] ? normalizeHead(tokens[0]) : undefined
  if (!head) return null
  if (!allowPrivilegeWrappers && !TRANSPARENT_WRAPPER_HEADS.has(head)) return null
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
    case 'sudo': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (SUDO_ZERO_ARG_FLAGS.has(v) || /^-[AEHkKnPSv]+$/.test(v)) {
          i++
          continue
        }
        if (SUDO_VALUE_FLAGS.has(v)) {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (/^-[CghprtUu].+/.test(v)) {
          i++
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'doas': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (DOAS_ZERO_ARG_FLAGS.has(v)) {
          i++
          continue
        }
        if (DOAS_VALUE_FLAGS.has(v)) {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'su': {
      for (let i = 0; i < args.length; i++) {
        const v = args[i]
        if (v === '-c' || v === '--command') return args[i + 1] ?? null
        if (v.startsWith('--command=')) return v.slice('--command='.length)
        if (/^-[^-]*c[^-]*$/.test(v)) return args[i + 1] ?? null
      }
      return null
    }
    case 'nohup':
    case 'time': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (head === 'time' && v === '-p') {
          i++
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'command': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (v === '-v' || v === '-V') return null // lookup only, does not execute inner command
        if (v === '-p') {
          i++
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'exec': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (v === '-c' || v === '-l') {
          i++
          continue
        }
        if (v === '-a') {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'nice': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (v === '-n' || v === '--adjustment') {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (v.startsWith('--adjustment=') || /^-\d+$/.test(v) || /^-n\d+$/.test(v)) {
          i++
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'timeout': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (TIMEOUT_ZERO_ARG_FLAGS.has(v)) {
          i++
          continue
        }
        if (TIMEOUT_VALUE_FLAGS.has(v)) {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (v.startsWith('--kill-after=') || v.startsWith('--signal=') || /^-[ks].+/.test(v)) {
          i++
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      // Skip the required <duration> operand
      if (i + 1 >= args.length) return null
      return joinBashTokens(args.slice(i + 1))
    }
    case 'setsid': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (SETSID_ZERO_ARG_FLAGS.has(v)) {
          i++
          continue
        }
        if (v.startsWith('-')) return null
        break
      }
      return i < args.length ? joinBashTokens(args.slice(i)) : null
    }
    case 'stdbuf': {
      let i = 0
      while (i < args.length) {
        const v = args[i]
        if (v === '--') {
          i++
          break
        }
        if (STDBUF_VALUE_FLAGS.has(v)) {
          if (i + 1 >= args.length) return null
          i += 2
          continue
        }
        if (v.startsWith('--input=') || v.startsWith('--output=') || v.startsWith('--error=') || /^-[ioe].+/.test(v)) {
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
    const inner = unwrapInner(seg.tokens, false)
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
  writeRedirects: string[]
  readRedirects: string[]
  rceSub?: boolean
}

function subContainsFetchHead(sub: string): boolean {
  const segs = segment(sub)
  if (!segs) return /\b(?:curl|wget)\b/i.test(sub)
  return segs.some((s) => {
    const h = s.tokens[0] ? normalizeHead(s.tokens[0]) : ''
    return h === 'curl' || h === 'wget'
  })
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
    const normTokens = seg.tokens.map(stripQuotes)
    const head = normTokens[0] ? normalizeHead(normTokens[0]) : undefined
    let rceSub = false
    if (head && SHELL_OR_EVAL_HEADS.has(head)) {
      for (const tok of normTokens.slice(1)) {
        for (const m of tok.matchAll(/__SUB(\d+)__/g)) {
          const subText = subs[Number(m[1])]
          if (subText && subContainsFetchHead(subText)) {
            rceSub = true
            break
          }
        }
        if (rceSub) break
      }
    }
    out.push({
      tokens: normTokens,
      piped: effectivePiped,
      writeRedirects: seg.writeRedirects,
      readRedirects: seg.readRedirects,
      ...(rceSub ? { rceSub: true } : {})
    })
    const inner = unwrapInner(seg.tokens, true)
    if (inner !== null) {
      if (!collectSegments(inner, depth + 1, out, effectivePiped)) return false
    } else if (seg.tokens.length > 1) {
      if (head && HARD_DENY_WRAPPER_HEADS.has(head)) {
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
  if (r !== 'ok') {
    verdict.writeOps = false
    verdict.writeTargets = undefined
  }
  verdict.readOnly = r === 'ok' && !verdict.writeOps
  if (r === null) verdict.rejectReason = 'unparseable'
  if (r === 'deny' && !verdict.rejectReason) verdict.rejectReason = 'denied segment'
  return verdict
}
