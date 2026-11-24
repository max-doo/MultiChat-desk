import { randomUUID } from 'crypto'
import type Store from 'electron-store'
import { parse as parseShellQuote } from 'shell-quote'

export type PermissionMode = 'full' | 'restricted' | 'readonly'

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
  'get-process', 'get-service', 'get-date', 'get-command'
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

  public isHardDenied(commandOrPath: string): boolean {
    for (const rx of HARD_DENY_PATTERNS) {
      if (rx.test(commandOrPath)) {
        return true
      }
    }
    return false
  }

  public isSafeShellCommand(command: string): boolean {
    if (this.isHardDenied(command)) return false

    // Parse command with shell-quote to inspect ops and tokens
    const tokens = parseShellQuote(command)
    const segments: string[][] = []
    let currentSegment: string[] = []

    for (const token of tokens) {
      if (typeof token === 'string') {
        currentSegment.push(token)
      } else if (typeof token === 'object' && token !== null && 'op' in token) {
        const op = (token as { op: string }).op
        // Redirection to a file is a mutation, not safe/read-only
        if (op === '>' || op === '>>' || op === '&>' || op === '2>' || op === '2>>') {
          return false
        }
        if (op === '&&' || op === '||' || op === ';' || op === '|' || op === '&') {
          if (currentSegment.length > 0) {
            segments.push(currentSegment)
            currentSegment = []
          }
        }
      }
    }
    if (currentSegment.length > 0) {
      segments.push(currentSegment)
    }

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
    args: Record<string, unknown>
  ): ToolCheckResult {
    const normTool = toolName.toLowerCase()

    // 1. Full mode: allow everything unless blocked by hard-deny
    if (mode === 'full') {
      if (normTool === 'bash' || normTool === 'powershell') {
        const cmd = String(args.command ?? '')
        if (this.isHardDenied(cmd)) {
          return { allowed: false, reason: 'Command blocked by hard-deny security policy' }
        }
      }
      return { allowed: true }
    }

    // 2. Readonly mode: only read-only operations allowed, all mutations blocked
    if (mode === 'readonly') {
      if (normTool === 'read' || normTool === 'grep' || normTool === 'find' || normTool === 'ls') {
        return { allowed: true }
      }
      if (normTool === 'bash' || normTool === 'powershell') {
        const cmd = String(args.command ?? '')
        if (this.isSafeShellCommand(cmd)) {
          return { allowed: true }
        }
        return { allowed: false, reason: 'Shell command blocked: not a read-only command in readonly mode' }
      }
      return { allowed: false, reason: `Tool "${toolName}" is not permitted in read-only mode` }
    }

    // 3. Restricted mode (default)
    // Always check hard-deny first
    if (normTool === 'bash' || normTool === 'powershell') {
      const cmd = String(args.command ?? '')
      if (this.isHardDenied(cmd)) {
        return { allowed: false, reason: 'Command blocked by hard-deny security policy' }
      }
      if (this.isSafeShellCommand(cmd)) {
        return { allowed: true }
      }
      if (this.matchesAllowlist(normTool, cmd)) {
        return { allowed: true }
      }
      return {
        allowed: false,
        needsApproval: true,
        reason: `Command requires approval: ${cmd}`
      }
    }

    if (normTool === 'read' || normTool === 'grep' || normTool === 'find' || normTool === 'ls') {
      return { allowed: true }
    }

    if (normTool === 'edit' || normTool === 'write') {
      const filePath = String(args.path ?? args.file_path ?? '')
      if (this.isHardDenied(filePath)) {
        return { allowed: false, reason: 'File path blocked by hard-deny policy' }
      }
      if (this.matchesAllowlist(normTool, filePath)) {
        return { allowed: true }
      }
      return {
        allowed: false,
        needsApproval: true,
        reason: `${normTool === 'edit' ? 'Editing' : 'Writing'} file requires approval: ${filePath}`
      }
    }

    // Other tools in restricted mode: require approval
    return {
      allowed: false,
      needsApproval: true,
      reason: `Tool "${toolName}" requires approval`
    }
  }

  public async checkOrRequestApproval(params: {
    sessionId: string
    mode: PermissionMode
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { sessionId, mode, toolCallId, toolName, args } = params
    const check = this.checkToolPermission(mode, toolName, args)

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
        resolve({ allowed: false, reason: 'Approval request timed out after 10 minutes' })
      }, 10 * 60 * 1000)

      this.pendingApprovals.set(requestId, {
        sessionId,
        resolve: (allowed: boolean) => {
          clearTimeout(timer)
          resolve(allowed ? { allowed: true } : { allowed: false, reason: 'Action denied by user' })
        },
        reject: (err: Error) => {
          clearTimeout(timer)
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
        this.addAllowlistEntry('*', pattern.trim())
      }
      pending.resolve(true)
      return true
    }

    if (decision === 'allow') {
      pending.resolve(true)
      return true
    }

    pending.resolve(false)
    return true
  }

  public cancelPendingApprovalsForSession(sessionId: string): void {
    for (const [id, item] of this.pendingApprovals.entries()) {
      if (item.sessionId === sessionId) {
        clearTimeout(item.timer)
        item.resolve(false)
        this.pendingApprovals.delete(id)
      }
    }
  }
}
