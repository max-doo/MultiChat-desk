import { randomUUID } from 'crypto'
import type Store from 'electron-store'
import { parse as parseShellQuote } from 'shell-quote'
import {
  decidePermission,
  MAX_ANALYZABLE_COMMAND_LENGTH,
  parseMode,
  type CommandAnalyzerVerdict,
  type ModeId
} from './permissionPolicy'
import {
  disposePowerShellAstHelper,
  getPowerShellAstHelper,
  type AstParseResult
} from './commandAnalyzer/powershellAstHelper'
import { analyzePowerShellAst } from './commandAnalyzer/psAstAnalyzer'
import {
  analyzeBashCommand,
  parseBashCommandSegments,
  type BashParsedSegment
} from './commandAnalyzer/bashAnalyzer'

/**
 * Permission modes as accepted at the boundary. Canonical modes are
 * `default`/`auto`/`bypass`; legacy values are still accepted everywhere a
 * mode string flows in and mapped to the closest canonical mode by
 * `parseMode` (`restricted`/`readonly` → `default`, `full` → `auto`).
 */
export type PermissionMode = ModeId | 'full' | 'restricted' | 'readonly'

export interface AllowlistEntry {
  id: string
  tool: string
  pattern: string
  createdAt: number
}

export interface ApprovalRequest {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  reason: string
}

export interface ToolCheckResult {
  allowed: boolean
  needsApproval?: boolean
  reason?: string
  /** True when a shell command was structurally verified as read-only. */
  readOnlyCommand?: boolean
}

const ALLOWLIST_STORE_KEY = 'agent_permission_allowlist'

// Fallback hard-deny regex patterns used only when AST/segment analysis is
// unavailable (parse failure, truncated AST, >MAX_ANALYZABLE_COMMAND_LENGTH, or non-shell tool)
const HARD_DENY_PATTERNS: RegExp[] = [
  /\brm\s+(?:-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*|-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*|--recursive(?:\s+(?:-f|--force))?|(?:-f|--force)\s+--recursive|-(?:r|rf|fr))\s+(?:--no-preserve-root\s+)?(?:\/|\/\*|~[\\/]\*?|[A-Za-z]:[\\/]\*?)/i,
  /\b(?:rd|rmdir)\s+(?:\/s\s+\/q|\/s\/q|\/q\/s)\s+[A-Za-z]:[\\/]\*?/i,
  /\bdel\s+(?:\/s\s+\/q|\/s\/q|\/q\/s)\s+[A-Za-z]:[\\/]\*?/i,
  /\b(?:remove-item|ri)\b[^\r\n]*(?:(?:-rec(?:u(?:r(?:s(?:e)?)?)?)?|-r\b)[^\r\n]*(?:[A-Za-z]:[\\/]\*?(?=[\s;&|]|$)|\/\*|~[\\/]\*?)|(?:[A-Za-z]:[\\/]\*?(?=[\s;&|]|$)|\/\*|~[\\/]\*?)[^\r\n]*(?:-rec(?:u(?:r(?:s(?:e)?)?)?)?|-r\b))/i,
  /(?:^|[;&|(\r\n]\s*)format(?:\.(?:com|exe))?(?:\s+(?:\/|-)\S+)*\s+[A-Za-z]:|\b(?:format-volume|mkfs(?:\.[a-z0-9]+)?)\b/i,
  /\bdd\s+.*of=\/dev\//i,
  /\breg\s+delete\s+(?:hklm|hkey_local_machine)\b/i,
  /\b(?:shutdown|restart-computer|stop-computer|stop-process\s+-name\s+system)\b/i,
  /\b(?:init\s+0|reboot|halt|poweroff)\b/i,
  /\|\s*(?:(?:env|xargs)\s+(?:[^\r\n|;&]*\s+)?)?(?:iex|invoke-expression|sh|bash)\b/i,
  /\b(?:iex|invoke-expression)\s*(?:\(|["'$])/i,
  /\b(?:powershell|pwsh)\b[^\r\n]*\s-(?:e|en|enc|encodedcommand)(?:\b|:)/i,
  /(?:curl|wget)\s+.*\|\s*(?:(?:env|xargs)\s+(?:[^\r\n|;&]*\s+)?)?(?:sh|bash|iex|invoke-expression)\b/i,
  /(?:\$\{?(?:env:)?(?:WINDIR|SystemRoot)\}?|System32|[\\/]Windows[\\/]System32|[\\/]etc[\\/]shadow|[\\/]etc[\\/]passwd|\.ssh[\\/])/i
]

const DISPLAY_OR_META_COMMANDS = new Set([
  'write-host', 'write-output', 'echo', 'printf',
  'write-warning', 'write-verbose', 'write-debug',
  'get-help', 'get-command', 'gcm'
])
const ALWAYS_HARD_DENIED_COMMANDS = new Set([
  'format-volume', 'shutdown', 'restart-computer', 'stop-computer',
  'reboot', 'halt', 'poweroff', 'iex', 'invoke-expression'
])
const ENCODED_COMMAND_PARAM_RX = /^(?:e|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)$/i
const PS_RECURSE_PARAM_RX = /^(?:r|re|rec|recu|recur|recurs|recurse)$/i
const PS_COMMAND_PARAM_RX = /^(?:c|co|com|comm|comma|comman|command)$/i
const PS_VALUE_FLAGS = new Set([
  'executionpolicy', 'ep', 'workingdirectory', 'wd', 'windowstyle', 'w',
  'outputformat', 'of', 'inputformat', 'if', 'version', 'v',
  'configurationname', 'settingsfile', 'custompipename', 'file', 'f'
])
const PS_FILE_PARAM_RX = /^(?:f|fi|fil|file)$/i
const DRIVE_ROOT_TARGET_RX = /^(?:\/|\/\*|~(?:[\\/]\*?)?|[A-Za-z]:(?:[\\/]\*?)?)$/
const WIN_DRIVE_TARGET_RX = /^[A-Za-z]:(?:[\\/].*)?$/
const HARD_DENY_PATH_TOKEN_RX = /[\\/]etc[\\/](?:shadow|passwd)(?:$|[\\/])/i
const ENV_WINDIR_RX = /(?:\$\{?(?:env:)?(?:WINDIR|SystemRoot)\}?|%(?:WINDIR|SystemRoot)%)/i
const DRIVERS_HOSTS_TAIL_RX = /[\\/]System32[\\/]drivers[\\/]etc[\\/]hosts$/i

function normalizeHardDenyCommandName(raw: string): string {
  return raw.replace(/^.*[\\/]/, '').replace(/\.(?:exe|com|cmd|bat|ps1)$/i, '').toLowerCase()
}

function stripHardDenyQuotes(value: string): string {
  if (value.length >= 2) {
    const a = value[0]
    const b = value[value.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return value.slice(1, -1)
  }
  return value
}

// Known safe/read-only command heads (fallback only — scriptblock cmdlets
// like ForEach-Object/Where-Object are excluded because shell-quote cannot
// inspect `{ ... }` bodies).
const SAFE_COMMAND_HEADS = new Set([
  'dir', 'ls', 'cat', 'head', 'tail', 'more', 'less', 'wc',
  'grep', 'find', 'findstr', 'pwd', 'type', 'echo', 'printf',
  'which', 'where', 'whoami', 'hostname', 'uname', 'date', 'test',
  'get-childitem', 'get-content', 'get-item', 'get-location',
  'get-process', 'get-service', 'get-date', 'get-command',
  'compare-object', 'convertto-csv', 'convertto-html', 'convertto-json',
  'format-list', 'format-table', 'group-object',
  'measure-object', 'out-string', 'resolve-path', 'select-object',
  'select-string', 'sort-object', 'split-path', 'test-path',
  'write-output'
])

// Safe git subcommands
const SAFE_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'branch', 'show', 'tag', 'rev-parse', 'remote', 'describe'
])

// Safe npm subcommands
const SAFE_NPM_SUBCOMMANDS = new Set([
  'ls', 'list', 'view', 'outdated', 'explain', 'doctor', 'help', 'prefix', 'root'
])

function matchesWildcard(text: string, pattern: string): boolean {
  if (pattern === '*' || pattern === text) return true
  // Normalize windows backslashes to forward slashes for path matching
  const normText = text.replace(/\\/g, '/')
  const normPattern = pattern.replace(/\\/g, '/')
  if (normPattern === normText) return true
  const regexStr = '^' + normPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  return new RegExp(regexStr, 'i').test(normText)
}

export class PermissionEngine {
  private pendingApprovals = new Map<
    string,
    {
      sessionId: string
      resolve: (allowed: boolean) => void
      reject: (err: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  /** requestId → normalized tool name, used to scope "always allow" entries. */
  private requestToolNames = new Map<string, string>()

  constructor(
    private store: Store<Record<string, unknown>>,
    private onApprovalRequest?: (request: ApprovalRequest) => void,
    private resolveShell: () => Promise<{ exe: string; args: string[] }> = async () => {
      throw new Error('resolveShell not injected')
    },
    private extraProtectedRoots: readonly string[] = []
  ) {}

  public getAllowlist(): AllowlistEntry[] {
    const list = this.store.get(ALLOWLIST_STORE_KEY)
    if (Array.isArray(list)) {
      return list as AllowlistEntry[]
    }
    return []
  }

  public addAllowlistEntry(tool: string, pattern: string): AllowlistEntry {
    const list = this.getAllowlist()
    const entry: AllowlistEntry = {
      id: randomUUID(),
      tool,
      pattern: pattern.trim(),
      createdAt: Date.now()
    }
    list.push(entry)
    this.store.set(ALLOWLIST_STORE_KEY, list)
    return entry
  }

  public removeAllowlistEntry(id: string): void {
    const list = this.getAllowlist().filter((e) => e.id !== id)
    this.store.set(ALLOWLIST_STORE_KEY, list)
  }

  public matchesAllowlist(tool: string, target: string): boolean {
    const list = this.getAllowlist()
    for (const entry of list) {
      if (entry.tool === '*' || entry.tool.toLowerCase() === tool.toLowerCase()) {
        if (matchesWildcard(target, entry.pattern)) {
          return true
        }
      }
    }
    return false
  }

  /** Allowlist match for a tool call — checks the command or file-path target. */
  private matchesUserAllowlist(normTool: string, args: Record<string, unknown>): boolean {
    if (normTool === 'bash' || normTool === 'powershell') {
      const cmd = String(args.command ?? args.cmd ?? args.script ?? '')
      if (!cmd) return false
      return this.matchesAllowlist(normTool, cmd) || this.matchesAllowlist('*', cmd)
    }
    const filePath = String(args.path ?? args.file_path ?? '')
    if (!filePath) return false
    return this.matchesAllowlist(normTool, filePath) || this.matchesAllowlist('*', filePath)
  }

  /**
   * Shell-quote–based segmentation of a command into per-statement token
   * lists. Used to verify that EVERY segment of a compound command stays
   * inside the safe whitelist. Returns `undefined` when the command cannot
   * be safely segmented — unknown ops, PowerShell/bash subexpression
   * syntax (`@(...)`, `$(...)`, backticks) or redirection all fail closed,
   * because a segment we cannot explain is not a segment we can trust.
   */
  public segmentedShellCommands(command: string): string[][] | undefined {
    if (this.isHardDenied(command)) return undefined
    // PowerShell/bash subexpression and command-substitution syntax that
    // shell-quote does NOT surface as an op — a whitelist that cannot see
    // these tokens cannot claim the command is safe. Environment-variable
    // expansions (`$env:`, `${env:}`, `%VAR%`) also fail closed — the
    // resolved path may be sensitive and the segmenter cannot evaluate it.
    if (/@\(|\$\(|`|;\s*\(|=\s*\(|\bInvoke-Expression\b|\biex\b|\$\{?env:|%[A-Za-z_][A-Za-z0-9_]*%/i.test(command)) {
      return undefined
    }
    const tokens = parseShellQuote(command)
    const segments: string[][] = []
    let current: string[] = []
    for (const token of tokens) {
      if (typeof token === 'string') {
        current.push(token)
      } else if (typeof token === 'object' && token !== null && 'op' in token) {
        const op = (token as { op: string }).op
        // Redirection, globs, env assignments and any other op we do not
        // explicitly handle all fail closed — only statement separators
        // are understood.
        if (!['&&', '||', ';', '|', '&'].includes(op)) {
          return undefined
        }
        if (current.length > 0) {
          segments.push(current)
          current = []
        }
      }
    }
    if (current.length > 0) segments.push(current)
    return segments
  }

  public isHardDenied(commandOrPath: string): boolean {
    for (const rx of HARD_DENY_PATTERNS) {
      if (rx.test(commandOrPath)) {
        return true
      }
    }
    return false
  }

  private isHardDeniedPathToken(token: string): boolean {
    if (HARD_DENY_PATH_TOKEN_RX.test(token)) return true
    if (ENV_WINDIR_RX.test(token) && !DRIVERS_HOSTS_TAIL_RX.test(token)) return true
    return false
  }

  private extractPwshInnerCommand(
    args: readonly string[],
    params: readonly { name: string; val?: string | null }[],
    quotedArgs?: readonly string[]
  ): string | null {
    // 1. `-File` launches a script file, never an inline `-Command`.
    if (
      params.some((p) => PS_FILE_PARAM_RX.test(p.name)) ||
      args.some((a) => a.startsWith('-') && PS_FILE_PARAM_RX.test(a.slice(1).split(':')[0]))
    ) {
      return null
    }
    const joinTokens = (startIdx: number, prefixToken?: string): string | null => {
      const rest = (quotedArgs ?? args).slice(startIdx)
      const all = prefixToken ? [prefixToken, ...rest] : rest
      if (all.length === 0) return null
      // A single unquoted string arg like `"Remove-Item C:\ -Recurse"` is already complete script text;
      // multiple tokens (`Write-Host "a; rm -rf /"`) use `quotedArgs` so string args stay quoted.
      if (all.length === 1) return args[startIdx] ?? prefixToken ?? null
      return all.join(' ')
    }
    // 2. Explicit `-Command` (or prefix `-c`, `-co`, ...): take colon value or join trailing tokens
    const cmdFlagIdx = args.findIndex(
      (a) => a.startsWith('-') && PS_COMMAND_PARAM_RX.test(a.slice(1).split(':')[0])
    )
    if (cmdFlagIdx !== -1) {
      const flag = args[cmdFlagIdx]
      const colonIdx = flag.indexOf(':')
      const inlineVal = colonIdx !== -1 ? flag.slice(colonIdx + 1) || undefined : undefined
      return joinTokens(cmdFlagIdx + 1, inlineVal)
    }
    const cmdParam = params.find((p) => PS_COMMAND_PARAM_RX.test(p.name))
    if (cmdParam?.val) return cmdParam.val

    // 3. Positional command (`pwsh "rm -rf /"` or `pwsh -NoProfile rm -rf /`)
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a.startsWith('-')) {
        const pname = a.slice(1).split(':')[0].toLowerCase()
        if (!a.includes(':') && PS_VALUE_FLAGS.has(pname)) {
          i++
        }
        continue
      }
      return joinTokens(i)
    }
    return null
  }

  private async isHardDeniedCommandSegment(
    cmdName: string,
    args: readonly string[],
    params: readonly { name: string; val?: string | null }[],
    piped: boolean,
    depth: number,
    resolveShell: () => Promise<{ exe: string; args: string[] }>,
    quotedArgs?: readonly string[]
  ): Promise<boolean> {
    if (ALWAYS_HARD_DENIED_COMMANDS.has(cmdName)) return true
    if (/^mkfs(?:\.[a-z0-9]+)?$/i.test(cmdName)) return true
    if ((cmdName === 'sh' || cmdName === 'bash') && piped) return true
    if (cmdName === 'init' && args.some((a) => a === '0')) return true

    if (cmdName === 'stop-process' || cmdName === 'kill' || cmdName === 'spps') {
      const hasNameParam = params.some(
        (p) => (p.name === 'name' || p.name === 'n') && p.val?.toLowerCase() === 'system'
      )
      if (hasNameParam) return true
      for (let i = 0; i < args.length; i++) {
        const lower = args[i].toLowerCase()
        if ((lower === '-name' || lower === '-n') && args[i + 1]?.toLowerCase() === 'system') {
          return true
        }
      }
    }

    if (
      cmdName === 'reg' &&
      args.some((a) => a.toLowerCase() === 'delete') &&
      args.some((a) => /^(?:hklm|hkey_local_machine)(?:[\\/]|$)/i.test(a))
    ) {
      return true
    }

    if (cmdName === 'dd' && args.some((a) => /^of=\/dev\//i.test(a))) return true
    if (cmdName === 'format' && args.some((a) => WIN_DRIVE_TARGET_RX.test(a))) return true

    const hasPsRecurse =
      params.some((p) => PS_RECURSE_PARAM_RX.test(p.name)) ||
      args.some((a) => a.startsWith('-') && PS_RECURSE_PARAM_RX.test(a.slice(1).split(':')[0]))

    if (cmdName === 'rm') {
      const hasRecursive =
        hasPsRecurse || args.some((a) => /^-(?:[a-z]*r[a-z]*|-recursive)$/i.test(a))
      if (hasRecursive && args.some((a) => DRIVE_ROOT_TARGET_RX.test(a))) return true
    }

    if (cmdName === 'rd' || cmdName === 'rmdir' || cmdName === 'del' || cmdName === 'erase') {
      const lowerArgs = args.map((a) => a.toLowerCase())
      const hasSlashS = lowerArgs.some((a) => /^\/(?:s|s\/q|q\/s)$/.test(a))
      const hasSlashQ = lowerArgs.some((a) => /^\/(?:q|s\/q|q\/s)$/.test(a))
      if (
        ((hasSlashS && hasSlashQ) || hasPsRecurse) &&
        args.some((a) => DRIVE_ROOT_TARGET_RX.test(a))
      ) {
        return true
      }
    }

    if (cmdName === 'remove-item' || cmdName === 'ri') {
      if (hasPsRecurse && args.some((a) => DRIVE_ROOT_TARGET_RX.test(a))) return true
    }

    if (cmdName === 'powershell' || cmdName === 'pwsh') {
      if (
        params.some((p) => ENCODED_COMMAND_PARAM_RX.test(p.name)) ||
        args.some((a) => a.startsWith('-') && ENCODED_COMMAND_PARAM_RX.test(a.slice(1).split(':')[0]))
      ) {
        return true
      }
      if (depth < 2) {
        const inner = this.extractPwshInnerCommand(args, params, quotedArgs)
        if (inner && (await this.isHardDeniedInnerCommand(inner, 'powershell', depth + 1, resolveShell))) {
          return true
        }
      }
    }

    if ((cmdName === 'bash' || cmdName === 'sh') && depth < 2) {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-c' || /^-[a-z]*c[a-z]*$/i.test(args[i])) {
          const inner = args[i + 1]
          if (inner && (await this.isHardDeniedInnerCommand(inner, 'bash', depth + 1, resolveShell))) {
            return true
          }
          break
        }
      }
    }

    if (cmdName === 'cmd' && depth < 2) {
      for (let i = 0; i < args.length; i++) {
        const lower = args[i].toLowerCase()
        if (lower === '/c' || lower === '/k') {
          const inner = args.slice(i + 1).join(' ')
          if (inner && this.isHardDenied(inner)) return true
          break
        }
      }
    }

    if (!DISPLAY_OR_META_COMMANDS.has(cmdName)) {
      for (const a of args) {
        if (this.isHardDeniedPathToken(a)) return true
      }
      for (const p of params) {
        if (p.val && this.isHardDeniedPathToken(p.val)) return true
      }
    }

    return false
  }

  private async isHardDeniedInnerCommand(
    inner: string,
    toolHint: 'powershell' | 'bash',
    depth: number,
    resolveShell: () => Promise<{ exe: string; args: string[] }>
  ): Promise<boolean> {
    if (toolHint === 'bash') {
      const segs = parseBashCommandSegments(inner)
      return segs ? this.isHardDeniedBashSegments(segs, depth, resolveShell) : this.isHardDenied(inner)
    }
    if (inner.trim() && inner.length <= MAX_ANALYZABLE_COMMAND_LENGTH) {
      try {
        const parsed = await getPowerShellAstHelper(resolveShell).analyze(inner)
        if (parsed && parsed.status === 'ok') {
          return this.isHardDeniedPowerShellAst(parsed, depth, resolveShell)
        }
      } catch {
        // fall through to regex fallback
      }
    }
    return this.isHardDenied(inner)
  }

  private async isHardDeniedBashSegments(
    segments: readonly BashParsedSegment[],
    depth: number,
    resolveShell: () => Promise<{ exe: string; args: string[] }>
  ): Promise<boolean> {
    for (const seg of segments) {
      if (seg.tokens.length === 0) continue
      const cmdName = normalizeHardDenyCommandName(seg.tokens[0])
      const args = seg.tokens.slice(1)
      if (await this.isHardDeniedCommandSegment(cmdName, args, [], seg.piped, depth, resolveShell)) {
        return true
      }
    }
    return false
  }

  private async isHardDeniedPowerShellAst(
    parsed: AstParseResult,
    depth: number,
    resolveShell: () => Promise<{ exe: string; args: string[] }>
  ): Promise<boolean> {
    for (const node of parsed.nodes) {
      if (node.type === 'FileRedirectionAst' && node.target) {
        if (this.isHardDeniedPathToken(node.target)) return true
      }
      if (node.type !== 'CommandAst' || !node.cmd) continue
      const cmdName = normalizeHardDenyCommandName(node.cmd)
      const elems = node.elems ?? []
      const params: { name: string; val?: string | null }[] = []
      const args: string[] = []
      const quotedArgs: string[] = []
      const requoteStringArg = (val: string, argType?: string | null): string => {
        if (argType === 'ExpandableStringExpressionAst') return val
        const clean = stripHardDenyQuotes(val)
        if (argType === 'StringConstantExpressionAst' && /[\s;|&'"]/.test(clean)) {
          return `'${clean.replace(/'/g, "''")}'`
        }
        return clean
      }
      for (let i = 1; i < elems.length; i++) {
        const elem = elems[i]
        if (elem.kind === 'param') {
          const pname = (elem.name ?? '').toLowerCase()
          const nextElem = elem.val == null ? elems[i + 1] : undefined
          const resolvedVal =
            elem.val != null
              ? stripHardDenyQuotes(elem.val)
              : nextElem?.kind === 'arg' && nextElem.val != null
                ? stripHardDenyQuotes(nextElem.val)
                : null
          params.push({ name: pname, val: resolvedVal })
          args.push(`-${pname}`)
          quotedArgs.push(`-${pname}`)
          if (elem.val != null) {
            args.push(stripHardDenyQuotes(elem.val))
            quotedArgs.push(requoteStringArg(elem.val, elem.argType))
          }
        } else if (elem.val != null) {
          args.push(stripHardDenyQuotes(elem.val))
          quotedArgs.push(requoteStringArg(elem.val, elem.argType))
        }
      }
      if (
        await this.isHardDeniedCommandSegment(
          cmdName,
          args,
          params,
          node.piped === true,
          depth,
          resolveShell,
          quotedArgs
        )
      ) {
        return true
      }
    }
    return false
  }

  public isSafeShellCommand(command: string): boolean {
    const segments = this.segmentedShellCommands(command)
    if (!segments) return false
    if (segments.length === 0) return true

    for (const seg of segments) {
      if (seg.length === 0) continue
      const rawHead = seg[0].toLowerCase().replace(/^.*[\\/]/, '')
      const head = rawHead.replace(/\.(?:exe|cmd|bat|ps1)$/i, '')

      if (head === 'git') {
        const sub = seg[1]?.toLowerCase()
        if (!sub || !SAFE_GIT_SUBCOMMANDS.has(sub)) return false
      } else if (head === 'npm' || head === 'pnpm' || head === 'yarn') {
        const sub = seg[1]?.toLowerCase()
        if (!sub || !SAFE_NPM_SUBCOMMANDS.has(sub)) return false
      } else if (head === 'node' || head === 'python' || head === 'python3') {
        // Only allow flag inquiries like node -v, node --version
        const flag = seg[1]?.toLowerCase()
        if (flag !== '-v' && flag !== '--version' && flag !== '-h' && flag !== '--help') {
          return false
        }
      } else if (head === 'tsc') {
        // tsc --noEmit is read-only
        const hasNoEmit = seg.some((arg) => arg.toLowerCase() === '--noemit')
        if (!hasNoEmit) return false
      } else if (SAFE_COMMAND_HEADS.has(head)) {
        // known safe head
        continue
      } else {
        return false
      }
    }

    return true
  }

  /**
   * Ask the shell-specific analyzer for an AST/segment verdict. Returns
   * `null` when analysis is unavailable (helper down, unparseable, depth
   * exceeded) — the caller fails closed to the regex/whitelist path.
   */
  private async analyzeCommandVerdict(
    normTool: string,
    cmd: string,
    resolveShell: () => Promise<{ exe: string; args: string[] }> = this.resolveShell
  ): Promise<CommandAnalyzerVerdict | null> {
    if (!cmd.trim() || cmd.length > MAX_ANALYZABLE_COMMAND_LENGTH) return null
    try {
      if (normTool === 'powershell') {
        const helper = getPowerShellAstHelper(resolveShell)
        const parsed = await helper.analyze(cmd)
        if (!parsed) return null
        const v = analyzePowerShellAst(parsed)
        return { readOnly: v.readOnly, writeOps: v.writeOps, pathArguments: v.pathArguments, cdTargets: v.cdTargets, commands: v.commands, rejectReason: v.rejectReason }
      }
      if (normTool === 'bash') {
        const v = analyzeBashCommand(cmd)
        return { readOnly: v.readOnly, pathArguments: v.pathArguments, cdTargets: v.cdTargets, commands: v.commands, rejectReason: v.rejectReason }
      }
    } catch {
      return null
    }
    return null
  }

  /**
   * Async policy check — shell commands go through the AST/segment analyzer first;
   * hard-deny inspects parsed commands/redirections when available (so string
   * literals like `Write-Host "format"` or `Write-Host "rm -rf /"` are not
   * falsely blocked) and falls back to regex when analysis is unavailable.
   */
  public async checkToolPermissionAsync(
    mode: PermissionMode,
    toolName: string,
    args: Record<string, unknown>,
    cwd: string,
    resolveShell: () => Promise<{ exe: string; args: string[] }> = this.resolveShell
  ): Promise<ToolCheckResult> {
    const normTool = toolName.toLowerCase()
    const modeId = parseMode(mode)

    const cmd = String(args.command ?? args.cmd ?? args.script ?? '')

    let analyzerVerdict: CommandAnalyzerVerdict | null = null
    if (cmd.trim() && cmd.length <= MAX_ANALYZABLE_COMMAND_LENGTH && normTool === 'powershell') {
      let parsed: AstParseResult | null = null
      try {
        parsed = await getPowerShellAstHelper(resolveShell).analyze(cmd)
      } catch {
        parsed = null
      }
      if (parsed && parsed.status === 'ok') {
        if (await this.isHardDeniedPowerShellAst(parsed, 0, resolveShell)) {
          return { allowed: false, reason: '命令命中硬性拒绝规则，任何模式都不能放行。' }
        }
      } else if (this.isHardDenied(cmd)) {
        return { allowed: false, reason: '命令命中硬性拒绝规则，任何模式都不能放行。' }
      }
      if (parsed) {
        const v = analyzePowerShellAst(parsed)
        analyzerVerdict = {
          readOnly: v.readOnly,
          writeOps: v.writeOps,
          pathArguments: v.pathArguments,
          cdTargets: v.cdTargets,
          commands: v.commands,
          rejectReason: v.rejectReason
        }
      }
    } else if (cmd.trim() && cmd.length <= MAX_ANALYZABLE_COMMAND_LENGTH && normTool === 'bash') {
      const segments = parseBashCommandSegments(cmd)
      if (segments !== null) {
        if (await this.isHardDeniedBashSegments(segments, 0, resolveShell)) {
          return { allowed: false, reason: '命令命中硬性拒绝规则，任何模式都不能放行。' }
        }
      } else if (this.isHardDenied(cmd)) {
        return { allowed: false, reason: '命令命中硬性拒绝规则，任何模式都不能放行。' }
      }
      analyzerVerdict = await this.analyzeCommandVerdict(normTool, cmd, resolveShell)
    } else {
      // Hard-deny gate runs in EVERY mode including bypass — `rm -rf /`,
      // `format-volume`, `reg delete hklm` are system-level damage that no
      // permission mode should execute. This precedes the user allowlist so
      // an "always allow" entry cannot bless a hard-denied string.
      if (cmd && this.isHardDenied(cmd)) {
        return { allowed: false, reason: '命令命中硬性拒绝规则，任何模式都不能放行。' }
      }
      analyzerVerdict =
        normTool === 'powershell' || normTool === 'bash'
          ? await this.analyzeCommandVerdict(normTool, cmd, resolveShell)
          : null
    }

    let result = decidePermission({
      modeId,
      toolName: normTool,
      args,
      sessionId: '',
      cwd,
      workspaceRoot: cwd,
      interactive: true,
      protectedRoots: this.extraProtectedRoots
    }, analyzerVerdict)

    const readOnlyCommand = analyzerVerdict?.readOnly === true

    // User allowlist may promote an `ask` (except protected or sensitive targets),
    // never override a hard/readonly `deny`.
    if (
      result.decision === 'ask' &&
      !result.paths.some((path) => path.boundary === 'protected' || path.sensitive) &&
      this.matchesUserAllowlist(normTool, args)
    ) {
      return { allowed: true, readOnlyCommand }
    }

    // Structural second opinion: bash-only fallback when the analyzer was
    // unavailable (`null`). PowerShell never falls back to `shell-quote`
    // because POSIX tokenization cannot inspect PowerShell scriptblocks.
    if (
      modeId === 'auto' &&
      result.decision === 'ask' &&
      normTool === 'bash' &&
      !result.paths.some((path) => path.sensitive || path.boundary === 'protected') &&
      analyzerVerdict === null
    ) {
      if (cmd && this.isSafeShellCommand(cmd)) {
        result = { ...result, decision: 'allow', reason: '复合命令逐段通过白名单检查。' }
      }
    }

    if (result.decision === 'allow') {
      return { allowed: true, readOnlyCommand }
    }
    if (result.decision === 'deny') {
      return { allowed: false, reason: result.reason, readOnlyCommand }
    }
    return {
      allowed: false,
      needsApproval: true,
      reason: result.reason,
      readOnlyCommand
    }
  }

  public async checkOrRequestApproval(params: {
    sessionId: string
    mode: PermissionMode
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
    cwd: string
  }): Promise<{ allowed: boolean; reason?: string; readOnlyCommand?: boolean }> {
    const { sessionId, mode, toolCallId, toolName, args, cwd } = params
    const check = await this.checkToolPermissionAsync(mode, toolName, args, cwd, this.resolveShell)

    if (check.allowed) {
      return { allowed: true, readOnlyCommand: check.readOnlyCommand }
    }

    if (!check.needsApproval) {
      return { allowed: false, reason: check.reason, readOnlyCommand: check.readOnlyCommand }
    }

    // Suspend for user approval
    const requestId = randomUUID()
    const request: ApprovalRequest = {
      requestId,
      sessionId,
      toolCallId,
      toolName,
      args,
      reason: check.reason || `Tool execution requires confirmation: ${toolName}`
    }

    return new Promise<{ allowed: boolean; reason?: string; readOnlyCommand?: boolean }>((resolve, reject) => {
      // 10 minutes timeout
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(requestId)
        this.requestToolNames.delete(requestId)
        resolve({ allowed: false, reason: 'Approval request timed out after 10 minutes', readOnlyCommand: check.readOnlyCommand })
      }, 10 * 60 * 1000)

      this.requestToolNames.set(requestId, toolName.toLowerCase())
      this.pendingApprovals.set(requestId, {
        sessionId,
        resolve: (allowed: boolean) => {
          clearTimeout(timer)
          this.requestToolNames.delete(requestId)
          resolve(
            allowed
              ? { allowed: true, readOnlyCommand: check.readOnlyCommand }
              : { allowed: false, reason: 'Action denied by user', readOnlyCommand: check.readOnlyCommand }
          )
        },
        reject: (err: Error) => {
          clearTimeout(timer)
          this.requestToolNames.delete(requestId)
          reject(err)
        },
        timer
      })

      if (this.onApprovalRequest) {
        this.onApprovalRequest(request)
      }
    })
  }

  public resolveApproval(
    requestId: string,
    decision: 'allow' | 'always' | 'deny',
    pattern?: string
  ): boolean {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending) {
      return false
    }

    this.pendingApprovals.delete(requestId)
    clearTimeout(pending.timer)

    if (decision === 'always') {
      if (pattern && pattern.trim()) {
        // Scope the remembered permission to the tool that was approved —
        // a wildcard-tool entry would let one approval on `powershell`
        // silently bless the same target under `bash` or any future tool.
        this.addAllowlistEntry(this.requestToolNames.get(requestId) ?? '*', pattern.trim())
      }
      pending.resolve(true)
      this.requestToolNames.delete(requestId)
      return true
    }

    if (decision === 'allow') {
      pending.resolve(true)
      this.requestToolNames.delete(requestId)
      return true
    }

    pending.resolve(false)
    this.requestToolNames.delete(requestId)
    return true
  }

  public cancelPendingApprovalsForSession(sessionId: string): void {
    for (const [id, item] of this.pendingApprovals.entries()) {
      if (item.sessionId === sessionId) {
        clearTimeout(item.timer)
        item.resolve(false)
        this.pendingApprovals.delete(id)
        this.requestToolNames.delete(id)
      }
    }
  }

  /** Kill the resident PowerShell AST helper if one was spawned. */
  public dispose(): void {
    disposePowerShellAstHelper()
  }
}
