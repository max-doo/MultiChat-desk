import { randomUUID } from 'crypto'
import type Store from 'electron-store'
import { parse as parseShellQuote } from 'shell-quote'
import { decidePermission, parseMode, type ModeId } from './permissionPolicy'

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
}

const ALLOWLIST_STORE_KEY = 'agent_permission_allowlist'

// Hard-deny regex patterns that are ALWAYS blocked across ALL modes (including full mode)
const HARD_DENY_PATTERNS: RegExp[] = [
  /\brm\s+-(?:r|rf|fr)\s+(?:\/|\/\*|~\/|[A-Za-z]:[\\/])/i,
  /\brmdir\s+\/s\s+\/q\s+[A-Za-z]:[\\/]/i,
  /\bdel\s+\/s\s+\/q\s+[A-Za-z]:[\\/]/i,
  /\b(?:format|format-volume|mkfs)\b/i,
  /\bdd\s+.*of=\/dev\//i,
  /\breg\s+delete\s+hklm/i,
  /\b(?:shutdown|restart-computer|stop-process\s+-name\s+system)\b/i,
  /\b(?:init\s+0|reboot|halt|poweroff)\b/i,
  /\|\s*(?:iex|invoke-expression|sh|bash)\b/i,
  /(?:curl|wget)\s+.*\|\s*(?:sh|bash|iex|invoke-expression)\b/i,
  /(?:\$env:WINDIR|System32|[\\/]Windows[\\/]System32|[\\/]etc[\\/]shadow|[\\/]etc[\\/]passwd|\.ssh[\\/])/i
]

// Known safe/read-only command heads (can run without approval in restricted mode and in readonly mode)
const SAFE_COMMAND_HEADS = new Set([
  'dir', 'ls', 'cat', 'head', 'tail', 'more', 'less', 'wc',
  'grep', 'find', 'findstr', 'pwd', 'type', 'echo', 'printf',
  'which', 'where', 'whoami', 'hostname', 'uname', 'date', 'test',
  'get-childitem', 'get-content', 'get-item', 'get-location',
  'get-process', 'get-service', 'get-date', 'get-command',
  // PowerShell read-only pipeline members — kept in sync with
  // READ_ONLY_POWERSHELL_COMMANDS in permissionPolicy.ts so the structural
  // second-opinion sees the same safe surface as the regex analyzer.
  'compare-object', 'convertto-csv', 'convertto-html', 'convertto-json',
  'format-list', 'format-table', 'foreach-object', 'group-object',
  'measure-object', 'out-string', 'resolve-path', 'select-object',
  'select-string', 'sort-object', 'split-path', 'test-path',
  'where-object', 'write-output'
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
    private onApprovalRequest?: (request: ApprovalRequest) => void
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

  public checkToolPermission(
    mode: PermissionMode,
    toolName: string,
    args: Record<string, unknown>,
    cwd: string
  ): ToolCheckResult {
    const normTool = toolName.toLowerCase()
    const modeId = parseMode(mode)

    // Preserve the old engine's user allowlist escape hatch before delegating
    // to the ported policy kernel: an explicit allowlist match allows the call
    // in any mode without surfacing an approval prompt.
    if (this.matchesUserAllowlist(normTool, args)) {
      return { allowed: true }
    }

    let result = decidePermission({
      modeId,
      toolName: normTool,
      args,
      sessionId: '',
      cwd,
      workspaceRoot: cwd,
      interactive: true
    })

    // Structural second opinion: when the policy wants to ASK on a shell
    // command purely because the regex flagged the string, re-segment it
    // and allow only if EVERY segment is on the safe whitelist. This runs
    // AFTER decidePermission so hard denies (protected paths, sensitive
    // files, command hard-deny patterns) are never overridden — and it is
    // skipped entirely when the ask was caused by a sensitive or protected
    // path, since a whitelist clean command reading `.env` must still
    // surface for confirmation.
    if (
      modeId === 'auto' &&
      result.decision === 'ask' &&
      (normTool === 'powershell' || normTool === 'bash') &&
      !result.paths.some((path) => path.sensitive || path.boundary === 'protected')
    ) {
      const cmdString = String(args.command ?? args.cmd ?? args.script ?? '')
      if (cmdString && this.isSafeShellCommand(cmdString)) {
        result = { ...result, decision: 'allow', reason: '复合命令逐段通过白名单检查。' }
      }
    }

    if (result.decision === 'allow') {
      return { allowed: true }
    }
    if (result.decision === 'deny') {
      return { allowed: false, reason: result.reason }
    }
    return {
      allowed: false,
      needsApproval: true,
      reason: result.reason
    }
  }

  public async checkOrRequestApproval(params: {
    sessionId: string
    mode: PermissionMode
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
    cwd: string
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { sessionId, mode, toolCallId, toolName, args, cwd } = params
    const check = this.checkToolPermission(mode, toolName, args, cwd)

    if (check.allowed) {
      return { allowed: true }
    }

    if (!check.needsApproval) {
      return { allowed: false, reason: check.reason }
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

    return new Promise<{ allowed: boolean; reason?: string }>((resolve, reject) => {
      // 10 minutes timeout
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(requestId)
        this.requestToolNames.delete(requestId)
        resolve({ allowed: false, reason: 'Approval request timed out after 10 minutes' })
      }, 10 * 60 * 1000)

      this.requestToolNames.set(requestId, toolName.toLowerCase())
      this.pendingApprovals.set(requestId, {
        sessionId,
        resolve: (allowed: boolean) => {
          clearTimeout(timer)
          this.requestToolNames.delete(requestId)
          resolve(allowed ? { allowed: true } : { allowed: false, reason: 'Action denied by user' })
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
}
