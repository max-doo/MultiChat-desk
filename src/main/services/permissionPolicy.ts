/**
 * Permission decision kernel — ported from mu-agent's permissions.ts and
 * modes.ts (pi 0.85.0) and adapted to this app's pi 1.6.0 `beforeToolCall`
 * wiring and electron-store persistence.
 *
 * Pure policy calculation: decides allow / ask / deny from a tool call's
 * name, args, cwd and the active mode. It never opens UI and never executes
 * a command — the caller (PermissionEngine) turns an `ask` into the
 * renderer's approval card.
 */
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, relative, resolve } from 'node:path'
import { gateExternalCommand, looksLikeInspectablePath } from './commandAnalyzer/externalCommandGate'

// ─── modes ───────────────────────────────────────────────────────────────────

export const MODE_IDS = ['default', 'auto', 'bypass'] as const
export type ModeId = (typeof MODE_IDS)[number]

/**
 * Modes the policy understands beyond the canonical three. `readonly` is a
 * legacy alias that must NOT collapse into `default`: it disables every
 * mutating tool and shell command outright, which `default` does not.
 */
export type ExtendedModeId = ModeId | 'readonly'

export interface ModeDefinition {
  id: ModeId
  aliases: readonly string[]
  description: string
}

export const MODE_DEFINITIONS: readonly ModeDefinition[] = [
  {
    id: 'default',
    aliases: ['ask', 'restricted'],
    description: '只读命令与工作区内 write/edit 直接执行；命令、网络和外部影响需要确认。'
  },
  {
    id: 'auto',
    aliases: ['acceptEdits', 'build', 'full'],
    description: '自动执行工作区内编辑和一般命令；工作区外修改及高风险操作需要确认。'
  },
  {
    id: 'bypass',
    aliases: ['yolo'],
    description: '跳过操作确认，仅拦截系统破坏与受保护凭据目录（无 OS 级沙箱隔离）。'
  }
]

const MODE_LOOKUP = new Map<string, ModeId>(
  MODE_DEFINITIONS.flatMap((mode) => [
    [mode.id.toLowerCase(), mode.id] as const,
    ...mode.aliases.map((alias) => [alias.toLowerCase(), mode.id] as const)
  ])
)

/** Parse a mode or its alias; unknown values fall back to `default`. `readonly` is preserved. */
export function parseMode(value: string | undefined | null): ExtendedModeId {
  const normalized = (value ?? 'default').trim().toLowerCase()
  if (!normalized) return 'default'
  if (normalized === 'readonly') return 'readonly'
  const mode = MODE_LOOKUP.get(normalized)
  if (mode) return mode
  return 'default'
}

// ─── effect types ────────────────────────────────────────────────────────────

export type ToolEffectKind =
  | 'read'
  | 'write'
  | 'delete'
  | 'execute'
  | 'network-read'
  | 'network-write'
  | 'credential'
  | 'control'
  | 'unknown'

export type ToolPathScope = 'workspace' | 'arbitrary' | 'declared' | 'none'

export interface ToolEffect {
  kind: ToolEffectKind
  kinds?: ToolEffectKind[]
  paths?: ToolPathScope
  reversible?: boolean
  description: string
}

export const EFFECT_RANK: Readonly<Record<ToolEffectKind, number>> = {
  control: 0,
  read: 1,
  'network-read': 2,
  write: 3,
  execute: 4,
  'network-write': 5,
  delete: 6,
  credential: 7,
  unknown: 8
}

const UNKNOWN_EFFECT: ToolEffect = {
  kind: 'unknown',
  paths: 'arbitrary',
  reversible: false,
  description: '未登记副作用，无法确认工具安全边界。'
}

/** Built-in Pi tools known to the policy engine. */
const BUILTIN_TOOL_EFFECTS: Readonly<Record<string, ToolEffect>> = {
  read: { kind: 'read', paths: 'declared', reversible: true, description: '读取文件内容。' },
  grep: { kind: 'read', paths: 'declared', reversible: true, description: '搜索文件内容。' },
  find: { kind: 'read', paths: 'declared', reversible: true, description: '查找文件路径。' },
  ls: { kind: 'read', paths: 'declared', reversible: true, description: '列出目录内容。' },
  write: { kind: 'write', paths: 'declared', reversible: false, description: '创建或覆盖文件。' },
  edit: { kind: 'write', paths: 'declared', reversible: true, description: '精确修改文件。' },
  bash: { kind: 'execute', paths: 'arbitrary', reversible: false, description: '执行 Bash 命令或进程。' },
  powershell: { kind: 'execute', paths: 'arbitrary', reversible: false, description: '执行 PowerShell 命令或进程。' }
  ,
  web_search: { kind: 'read', paths: 'none', reversible: true, description: '通过已登录平台联网搜索，无本地副作用。' }
  ,
  image_gen: { kind: 'read', paths: 'none', reversible: true, description: '通过已登录平台调用 AI 生图，产物落盘到会话工作区的 .multichat/image/。' }
}

function effectKinds(effect: ToolEffect): ToolEffectKind[] {
  return [...new Set([effect.kind, ...(effect.kinds ?? [])])]
}

function highestRiskEffect(effect: ToolEffect): ToolEffectKind {
  return effectKinds(effect).sort((a, b) => EFFECT_RANK[b] - EFFECT_RANK[a])[0] ?? 'unknown'
}

function getToolEffect(toolName: string): ToolEffect {
  return BUILTIN_TOOL_EFFECTS[toolName] ?? UNKNOWN_EFFECT
}

// ─── context & result types ─────────────────────────────────────────────────

export interface PermissionContext {
  modeId: ExtendedModeId
  toolName: string
  args: unknown
  sessionId: string
  cwd: string
  workspaceRoot: string
  interactive: boolean
  /** Extra trusted read-only roots (profile resources, skill dirs). */
  allowedReadRoots?: readonly string[]
  /** Extra protected roots beyond the defaults. */
  protectedRoots?: readonly string[]
}

export type PathBoundary = 'workspace' | 'allowed-read-root' | 'outside' | 'protected' | 'invalid'

/**
 * File/directory names and suffixes whose contents are treated as credentials.
 * A read hitting any of these is upgraded to the `credential` risk tier and
 * requires user confirmation in every mode — the file itself may be anywhere,
 * what matters is that its contents would be sent to a remote model platform.
 * Aligned with Claude Code's sensitive-file gating (.env, private keys, etc).
 */
const SENSITIVE_FILE_BASENAMES = new Set([
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'known_hosts', 'authorized_keys',
  'credentials', 'config.json.credentials', 'netrc', '.netrc', 'htpasswd', '.htpasswd',
  'shadow', 'passwd', 'pgpass', '.pgpass', 'my.cnf', 'kubeconfig'
])

const SENSITIVE_FILE_SUFFIXES = [
  '.pem', '.key', '.pfx', '.p12', '.keystore', '.jks', '.kdbx', '.asc', '.gpg',
  '.ppk', '.ovpn', '.mobileconfig'
]

const SENSITIVE_DIR_NAMES = new Set([
  '.ssh', '.aws', '.gnupg', '.gpg', '.azure', '.kube', '.docker', '.config\\gcloud'
])

export function isSensitiveFilePath(normalizedPath: string, input: string): boolean {
  // Windows silently strips trailing dots/spaces, and NTFS ADS hides the
  // real file behind a colon (`x.txt:.env`). Normalize both before matching.
  const names = new Set<string>()
  for (const rawCandidate of [normalizedPath, input]) {
    if (!rawCandidate) continue
    const candidate = rawCandidate.replace(/^["']|["']$/g, '')
    if (!candidate) continue
    const rawName = basename(candidate).toLowerCase()
    names.add(rawName.split(':')[0].replace(/[\s.]+$/, ''))
    // `$env:X\.env`/`%X%\.env` won't resolve — basename of the literal tail.
    const tail = candidate.replace(/[\\/]+/g, '\\').split('\\').pop()?.toLowerCase()
    if (tail) names.add(tail.split(':')[0].replace(/[\s.]+$/, ''))
  }
  for (const name of names) {
    if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) return true
    if (SENSITIVE_FILE_BASENAMES.has(name) || SENSITIVE_FILE_BASENAMES.has(name.replace(/^\./, ''))) {
      return true
    }
    if (SENSITIVE_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true
  }
  const normalized = normalizedPath.replace(/[\\/]+/g, '\\').toLowerCase()
  for (const dir of SENSITIVE_DIR_NAMES) {
    const sep = dir.includes('/') ? '/' : '\\'
    const needle = `${sep}${dir.replace(/[\\/]+/g, sep)}${sep}`
    if (normalized.includes(needle.replace(/\//g, '\\'))) {
      return true
    }
  }
  return false
}

/**
 * PowerShell drive names that are NOT the filesystem — env vars, registry
 * hives, functions, aliases, cert store, variables. `Get-ChildItem Env:`
 * enumerates environment variables, not paths, so boundary-checking it as a
 * file path misclassifies the read and leaks a misleading "outside
 * workspace" verdict. Drive-qualified tokens matching these are filtered out
 * of path inspection before `inspectPath` runs.
 */
const NON_FILE_PS_DRIVES = new Set([
  'alias', 'cert', 'env', 'function', 'hkcu', 'hklm', 'hkcr', 'hkcc', 'hku',
  'hk_users', 'variable', 'wsman'
])

function isNonFilePsDrive(token: string): boolean {
  const match = token.match(/^([A-Za-z_][A-Za-z0-9_]*):/)
  return !!match && NON_FILE_PS_DRIVES.has(match[1].toLowerCase())
}

export interface PathInspection {
  input: string
  absolute?: string
  normalized?: string
  relative?: string
  boundary: PathBoundary
  /** File content is credential-shaped (.env, private key, cloud creds). */
  sensitive?: boolean
}

export interface CommandInspection {
  command: string
  normalized: string
  executable?: string
  pathArguments?: string[]
  /** Static `cd` / `Set-Location` directory targets verified downstream. */
  cdTargets?: string[]
  parseable: boolean
  /** Recognized as a read-only PowerShell pipeline. */
  readOnly: boolean
  /** Which analyzer produced the verdict (for debugging/telemetry). */
  analyzer?: 'powershell-ast' | 'bash-segments' | 'unavailable'
  /** AST/segment analysis proved the whole command is read-only. */
  astReadOnly?: boolean
  /** AST/segment analysis found write ops — caller boundary-checks paths. */
  astWriteOps?: boolean
  /** Touches the network but only fetches data (git fetch/pull/clone). */
  networkRead?: boolean
  /** Pushes/publishes to a remote (git push, npm publish, ...). */
  networkWrite?: boolean
  /** Contains destructive/opaque shell syntax that auto mode must confirm. */
  requiresApproval: boolean
  highRisk: boolean
  reason?: string
}

/** Per-shell AST/segment verdict plugged in by the caller. */
export interface CommandAnalyzerVerdict {
  readOnly: boolean
  /** Command writes file content to path args — caller boundary-checks them. */
  writeOps?: boolean
  pathArguments?: string[]
  /** Static `cd` / `Set-Location` directory targets — caller verifies workspace boundary. */
  cdTargets?: string[]
  /** Executables/wrapper heads observed during analysis. */
  commands?: string[]
  /** Why read-only was rejected (debug). */
  rejectReason?: string
}

export type PolicyDecision = 'allow' | 'ask' | 'deny'

export interface PermissionDecisionResult {
  decision: PolicyDecision
  reason: string
  effect: ToolEffect
  risk: ToolEffectKind
  paths: PathInspection[]
  command?: CommandInspection
  target: string
}

// ─── command / path analysis ────────────────────────────────────────────────

export const MAX_ANALYZABLE_COMMAND_LENGTH = 16_000

const TOOL_PATH_ARGUMENTS = new Set(['read', 'grep', 'find', 'ls', 'write', 'edit'])
const KNOWN_COMMANDS = new Set([
  'bash', 'cat', 'cd', 'cp', 'dir', 'echo', 'find', 'git', 'grep', 'head', 'ls', 'node', 'npm',
  'npx', 'pwd', 'pnpm', 'powershell', 'pwsh', 'python', 'py', 'rg', 'sed', 'tail', 'type',
  'where', 'whoami', 'get-childitem', 'get-content', 'get-location', 'select-string',
  'test-path', 'write-output'
])
const READ_COMMANDS = new Set([
  'cat', 'dir', 'find', 'grep', 'head', 'ls', 'rg', 'tail', 'type',
  'get-childitem', 'get-content', 'select-string', 'test-path'
])
// Read-only but network-touching: still gated by `requiresApproval`, but
// distinguished so policy can treat them differently from opaque commands.
const NETWORK_READ_GIT = new Set(['fetch', 'ls-remote'])
// Anything that mutates a remote, publishes artifacts, or writes the
// worktree from remote data (pull merges; clone materializes a new tree).
const NETWORK_WRITE_SUBCOMMANDS = new Set(['push', 'pull', 'clone', 'publish', 'deploy', 'release', 'unpublish'])
const READ_ONLY_POWERSHELL_COMMANDS = new Set([
  'compare-object', 'convertto-csv', 'convertto-html', 'convertto-json', 'convertto-xml',
  'format-custom', 'format-hex', 'format-list', 'format-table', 'format-wide',
  'foreach-object', 'get-alias', 'get-childitem', 'get-command', 'get-content',
  'get-culture', 'get-date', 'get-executionpolicy', 'get-filehash', 'get-help',
  'get-history', 'get-host', 'get-item', 'get-job', 'get-location', 'get-member',
  'get-module', 'get-process', 'get-psdrive', 'get-pssnapin', 'get-random',
  'get-service', 'get-uiculture', 'get-unique', 'get-variable', 'get-verb',
  'group-object', 'join-string', 'measure-object', 'out-default', 'out-host',
  'out-null', 'out-string', 'resolve-path', 'select-object', 'select-string',
  'sort-object', 'split-path', 'test-path', 'where-object', 'write-debug',
  'write-host', 'write-output', 'write-verbose', 'write-warning'
])

function comparePath(value: string): string {
  return value.replace(/[\\/]+/g, '\\').replace(/[\\/]$/, '').toLowerCase()
}

function isWithin(root: string, target: string): boolean {
  const normalizedRoot = comparePath(root)
  const normalizedTarget = comparePath(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}\\`)
}

function canonicalExistingPath(candidate: string): string | undefined {
  try {
    if (lstatSync(candidate).isSymbolicLink()) return undefined
  } catch {
    // Target may not exist yet; the nearest existing parent is checked below.
  }
  if (existsSync(candidate)) {
    try {
      return realpathSync.native(candidate)
    } catch {
      return undefined
    }
  }
  const missing: string[] = []
  let cursor = candidate
  while (!existsSync(cursor)) {
    const parent = resolve(cursor, '..')
    if (parent === cursor) return undefined
    missing.unshift(basename(cursor))
    cursor = parent
  }
  try {
    return resolve(realpathSync.native(cursor), ...missing)
  } catch {
    return undefined
  }
}

function defaultProtectedRoots(): string[] {
  const roots = [
    resolve(homedir(), '.pi', 'agent'),
    resolve(homedir(), '.ssh'),
    process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)']
  ]
  return roots.filter((root): root is string => !!root).map((root) => resolve(root))
}

function lookupEnvVar(name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase() === lower && v) return v
  }
  return undefined
}

function expandPathInput(input: string): string | undefined {
  const value = input.trim()
  if (/^~(?:[\\/]|$)/.test(value)) {
    const suffix = value.slice(1).replace(/^[\\/]+/, '')
    return suffix ? resolve(homedir(), suffix) : resolve(homedir())
  }
  if (/^%USERPROFILE%(?:[\\/]|$)/i.test(value)) {
    const suffix = value.slice('%USERPROFILE%'.length).replace(/^[\\/]+/, '')
    return suffix ? resolve(homedir(), suffix) : resolve(homedir())
  }
  if (/^(?:\$(?:env:)?(?:HOME|USERPROFILE)|\$\{(?:env:)?(?:HOME|USERPROFILE)\})(?:[\\/]|$)/i.test(value)) {
    const suffix = value
      .replace(/^(?:\$(?:env:)?(?:HOME|USERPROFILE)|\$\{(?:env:)?(?:HOME|USERPROFILE)\})/i, '')
      .replace(/^[\\/]+/, '')
    return suffix ? resolve(homedir(), suffix) : resolve(homedir())
  }
  const winEnvMatch = value.match(
    /^(?:%(WINDIR|SystemRoot|ProgramFiles|ProgramFiles\(x86\))%|\$(?:env:)?(WINDIR|SystemRoot|ProgramFiles)|\$\{(?:env:)?(WINDIR|SystemRoot|ProgramFiles|ProgramFiles\(x86\))\})([\\/].*)?$/i
  )
  if (winEnvMatch) {
    const varName = winEnvMatch[1] || winEnvMatch[2] || winEnvMatch[3]
    const resolvedRoot = varName ? lookupEnvVar(varName) : undefined
    if (resolvedRoot) {
      const suffix = winEnvMatch[4] ? winEnvMatch[4].replace(/^[\\/]+/, '') : ''
      return suffix ? resolve(resolvedRoot, suffix) : resolve(resolvedRoot)
    }
    return undefined
  }
  if (/^(?:%[^%]+%|\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_:]*)/.test(value)) return undefined
  return value
}

/**
 * Known diagnostic/config files inside protected roots that are safe to read
 * (not write) without triggering an unconditional hard-deny:
 *  - Windows `drivers\etc\hosts`: non-secret DNS mapping file (allowed read)
 *  - `~/.ssh/config`: still flagged `sensitive: true` so reading requires explicit
 *    user approval (`ask`) in every mode, while private keys & writes stay denied.
 */
function isReadOnlyDiagnosticProtectedPath(normalizedPath: string): boolean {
  const cmp = comparePath(normalizedPath)
  const winRoot = lookupEnvVar('SystemRoot') || lookupEnvVar('WINDIR') || 'C:\\Windows'
  const hostsPath = comparePath(resolve(winRoot, 'System32', 'drivers', 'etc', 'hosts'))
  if (cmp === hostsPath) return true
  const sshConfigPath = comparePath(resolve(homedir(), '.ssh', 'config'))
  return cmp === sshConfigPath
}

export function inspectPath(
  input: string,
  cwd: string,
  workspaceRoot: string,
  allowedReadRoots: readonly string[] = [],
  protectedRoots: readonly string[] = defaultProtectedRoots()
): PathInspection {
  const result: PathInspection = { input, boundary: 'invalid' }
  if (!input.trim()) return result
  // Run the sensitive-file check on the raw input FIRST — it must fire even
  // when the path cannot be expanded/resolved (`$env:`/`%VAR%` forms that
  // `expandPathInput` returns undefined for), because the basename of the
  // literal string is still where `.env`/`id_rsa` show up.
  result.sensitive = isSensitiveFilePath(input, input)
  // `Name:` alone is a PowerShell drive qualifier (Env:, HKCU:, Cert:, …),
  // not a filesystem path. Boundary-checking it as a file would either
  // misclassify it as workspace-relative (false allow on non-file stores) or
  // leak a misleading "outside workspace" verdict. Mark it invalid so the
  // caller falls back to command analysis or a denial.
  if (/^[A-Za-z_][A-Za-z0-9_]*:$/.test(input.trim())) return result
  try {
    const expanded = expandPathInput(input)
    if (!expanded) return result
    const absolute = resolve(cwd, expanded)
    const normalized = canonicalExistingPath(absolute)
    result.absolute = absolute
    result.normalized = normalized
    // Re-run on the resolved form too — env expansion may surface a
    // sensitive basename the raw string did not show (e.g. `%X%\.env`).
    result.sensitive = result.sensitive || isSensitiveFilePath(normalized ?? absolute, input)
    if (!normalized) return result
    const realWorkspace = canonicalExistingPath(resolve(workspaceRoot))
    if (!realWorkspace) return result
    const realProtected = protectedRoots
      .map((root) => canonicalExistingPath(resolve(root)))
      .filter((root): root is string => !!root)
    if (realProtected.some((root) => isWithin(root, normalized))) {
      result.boundary = 'protected'
    } else if (isWithin(realWorkspace, normalized)) {
      result.boundary = 'workspace'
      result.relative = relative(realWorkspace, normalized).replace(/\\/g, '/') || '.'
    } else {
      const realAllowed = allowedReadRoots
        .map((root) => canonicalExistingPath(resolve(root)))
        .filter((root): root is string => !!root)
      const readRoot = realAllowed.find((root) => isWithin(root, normalized))
      if (readRoot) {
        result.boundary = 'allowed-read-root'
        result.relative = relative(readRoot, normalized).replace(/\\/g, '/') || '.'
      } else {
        result.boundary = 'outside'
      }
    }
    return result
  } catch {
    return result
  }
}

function pathArguments(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== 'object') return []
  const record = args as Record<string, unknown>
  if (typeof record.path === 'string') return [record.path]
  if (Array.isArray(record.paths)) {
    return record.paths.filter((path): path is string => typeof path === 'string')
  }
  // Unknown / MCP tools may carry file targets under differently-named fields
  // (file, filePath, target, destination, source, dir, ...). Scan every string
  // arg whose key *looks* path-like instead of trusting a fixed field list —
  // a tool schema widening must not silently skip the boundary check.
  if (!TOOL_PATH_ARGUMENTS.has(toolName)) {
    const candidates: string[] = []
    for (const [key, value] of Object.entries(record)) {
      if (!/path|file|dir|folder|target|dest|source/i.test(key)) continue
      if (typeof value === 'string' && value.trim()) candidates.push(value)
      else if (Array.isArray(value)) {
        candidates.push(...value.filter((item): item is string => typeof item === 'string' && !!item.trim()))
      }
    }
    return candidates
  }
  return []
}

function commandArgument(args: unknown): string | undefined {
  if (typeof args === 'string') return args
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  const value = record.command ?? record.cmd ?? record.script
  return typeof value === 'string' ? value : undefined
}

function commandExecutable(command: string): string | undefined {
  const first = command.trim().match(/^(?:["']([^"']+)["']|([^\s]+))/)
  const token = first?.[1] || first?.[2]
  if (!token) return undefined
  return basename(token).replace(/\.(?:exe|cmd|bat|ps1|sh)$/i, '').toLowerCase()
}

function commandTokens(command: string): string[] {
  return (command.match(/["'][^"']*["']|[^\s]+/g) ?? []).map((token) =>
    token.length >= 2 && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))
      ? token.slice(1, -1)
      : token
  )
}

function gitSubcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const raw = args[index]
    const value = raw.toLowerCase()
    // `-C` is case-sensitive (capital C) — do NOT lowercase-compare it.
    if (raw === '-C' || value === '-c' || value === '--git-dir' || value === '--work-tree') {
      index++
      continue
    }
    if (value.startsWith('--git-dir=') || value.startsWith('--work-tree=') || value.startsWith('-c')) continue
    if (value.startsWith('-')) continue
    return value
  }
  return undefined
}

function simpleCommand(executable: string | undefined, args: readonly string[]): boolean {
  if (!executable) return false
  if (['find', 'rg', 'git', 'npm', 'pnpm', 'node', 'python', 'py', 'tsc'].includes(executable)) {
    const gated = gateExternalCommand(executable, args, isSensitiveFilePath)
    return gated?.allowed === true
  }
  if (READ_COMMANDS.has(executable) || ['cd', 'echo', 'get-location', 'pwd', 'where', 'whoami', 'write-output'].includes(executable)) {
    return true
  }
  return false
}

function commandPathArguments(executable: string | undefined, args: readonly string[]): string[] {
  if (!executable) return []
  if (executable === 'git') {
    const gated = gateExternalCommand('git', args, isSensitiveFilePath)
    return gated?.pathArgs ?? []
  }
  // Only tokens that are actually file-shaped or credential-shaped reach the
  // boundary check.
  const positional = args.filter(
    (arg) =>
      arg !== '--' &&
      !arg.startsWith('-') &&
      !/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) &&
      !isNonFilePsDrive(arg) &&
      !/^[A-Za-z_][A-Za-z0-9_]*:$/.test(arg) &&
      !/^[{}|;]/.test(arg) &&
      looksLikeInspectablePath(arg, isSensitiveFilePath)
  )
  return positional
}

function readOnlyPowerShell(command: string): boolean {
  const cmdlets = [...command.matchAll(/\b([A-Za-z]+-[A-Za-z][A-Za-z0-9-]*)\b/g)].map((match) =>
    match[1].toLowerCase()
  )
  if (!cmdlets.length || cmdlets.some((cmdlet) => !READ_ONLY_POWERSHELL_COMMANDS.has(cmdlet))) {
    return false
  }

  // Do not treat external programs, script invocation, redirection or dynamic
  // evaluation as a read-only PowerShell expression. `.` is also the ordinary
  // current-directory argument (Get-ChildItem . | Select-Object Name) — only
  // treat `.` / `&` as invocation operators where a new statement can begin.
  if (
    /(?:^|[;|{}\r\n(=])\s*[.&]\s|(?:^|\s)[^\s"']+\.(?:exe|cmd|bat|ps1)\b|(?:>|>>|2>|2>>)|\$\(|`|-encodedcommand\b|\b(?:invoke-expression|iex|start-process)\b/i.test(
      command
    )
  ) {
    return false
  }

  const staticCalls = [...command.matchAll(/\[([^\]]+)\]\s*::\s*([A-Za-z][A-Za-z0-9_]*)/g)].map(
    (match) => `${match[1].replace(/^system\./i, '').toLowerCase()}::${match[2].toLowerCase()}`
  )
  if (staticCalls.some((call) => call !== 'regex::matches')) return false

  const functions = new Set(
    [...command.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_-]*)/gi)].map((match) =>
      match[1].toLowerCase()
    )
  )
  const statementHeads = [...command.matchAll(/(?:^|[;|{}\r\n]|=\s*)(?:\s|\(+)*([A-Za-z_][A-Za-z0-9_-]*)/g)]
    .filter((match) => !command.slice((match.index ?? 0) + match[0].length).trimStart().startsWith('='))
    .map((match) => match[1].toLowerCase())
  const languageWords = new Set([
    'begin', 'else', 'end', 'filter', 'finally', 'for', 'foreach', 'function', 'if',
    'process', 'return', 'switch', 'trap', 'try', 'until', 'while'
  ])
  return statementHeads.every(
    (head) => languageWords.has(head) || functions.has(head) || READ_ONLY_POWERSHELL_COMMANDS.has(head)
  )
}

function formatRejectReason(rejectReason: string): string {
  if (rejectReason === 'ast-truncated') return '命令语法树过长，需要人工确认。'
  if (rejectReason === 'parse-error') return '命令存在语法解析错误，需要人工确认。'
  if (rejectReason === 'unparseable') return '命令包含无法安全解析的语法结构（如重定向、复杂展开或注释），需要确认。'
  if (rejectReason === 'unsafe cd target') return '目录切换（cd）仅支持工作区内的静态文件系统路径，需要确认。'
  if (rejectReason === 'denied segment') return '命令包含非只读或未在白名单内的子命令，需要确认。'
  if (rejectReason.startsWith('denied command: ')) {
    return `命令包含非只读命令（${rejectReason.slice('denied command: '.length)}），需要确认。`
  }
  if (rejectReason.startsWith('unwhitelisted command: ')) {
    return `命令未列入只读白名单（${rejectReason.slice('unwhitelisted command: '.length)}），需要确认。`
  }
  if (rejectReason.startsWith('denied external command: ')) {
    return `外部命令包含写入或执行参数（${rejectReason.slice('denied external command: '.length)}），需要确认。`
  }
  if (rejectReason.startsWith('denied invocation operator: ')) {
    return `命令包含动态调用操作符（${rejectReason.slice('denied invocation operator: '.length)}），需要确认。`
  }
  if (rejectReason.startsWith('non-local assignment lhs')) {
    return '命令包含环境变量、作用域或属性赋值操作，需要确认。'
  }
  if (rejectReason.startsWith('denied node type: ') || rejectReason.startsWith('unknown node type: ')) {
    return `命令包含受限或未支持的语法节点（${rejectReason.split(': ').slice(1).join(': ')}），需要确认。`
  }
  return `命令包含非只读操作（${rejectReason}），需要确认。`
}

export function analyzeCommand(
  command: string,
  toolName?: 'powershell' | 'bash',
  analyzerVerdict?: CommandAnalyzerVerdict | null
): CommandInspection {
  const normalized = command.trim().replace(/\s+/g, ' ')
  const tokens = commandTokens(normalized)
  const executable = commandExecutable(normalized)
  const args = tokens.slice(1)
  const pathArguments = commandPathArguments(executable, args)
  if (!normalized) {
    return { command, normalized, parseable: false, readOnly: false, requiresApproval: true, highRisk: true, reason: '命令为空。' }
  }
  if (normalized.length > MAX_ANALYZABLE_COMMAND_LENGTH) {
    return { command, normalized, executable, pathArguments, parseable: false, readOnly: false, requiresApproval: true, highRisk: true, reason: '命令过长，无法安全审查。' }
  }
  const highRiskPattern =
    /(?:^|[\s;&|])(?:rm|rmdir|rd|del|erase|remove-item|clear-content|set-content|out-file|format-volume|stop-computer|restart-computer|shutdown|sudo|runas|start-process|invoke-expression|iex)\b|(?:>|>>|2>|2>>)|[;&|]|\$\(|`|-encodedcommand\b|frombase64string|(?:curl|wget|invoke-webrequest|invoke-restmethod)\b[^\r\n]*(?:-x\s*(?:post|put|patch|delete)|--data(?:-raw)?|--upload-file|-body)\b|(?:python|py|node|powershell|pwsh)\b[^\r\n]*(?:\s-c\s|\s-e\s|\s--eval(?:uate)?\b)/i
  const destructiveGit = /^git(?:\.exe)?\s+(?:[^\r\n]*\s)?(?:clean\b|reset\s+--hard\b|checkout\s+--\s|restore\b)/i.test(normalized)
  const syntaxRisk = highRiskPattern.test(normalized) || destructiveGit
  const hasAnalyzerVerdict = analyzerVerdict !== undefined && analyzerVerdict !== null
  const astReadOnly = analyzerVerdict?.readOnly === true
  const astRejected = hasAnalyzerVerdict && !astReadOnly
  // When the AST/segment analyzer returned a definitive `readOnly: false`,
  // never let legacy regex/simpleCommand heuristics overturn it.
  const readOnly = astReadOnly || (!hasAnalyzerVerdict && readOnlyPowerShell(normalized))
  const simple = !hasAnalyzerVerdict && simpleCommand(executable, args)
  const highRisk = astReadOnly ? false : astRejected || syntaxRisk || !simple || !executable || !KNOWN_COMMANDS.has(executable)
  // Classify git/npm-style network effects so policy can distinguish "fetch
  // from remote" from "mutate remote".
  let networkRead = false
  let networkWrite = false
  if (executable === 'git') {
    const sub = gitSubcommand(args)
    if (sub && NETWORK_READ_GIT.has(sub)) networkRead = true
    if (sub && NETWORK_WRITE_SUBCOMMANDS.has(sub)) networkWrite = true
  } else if (executable === 'npm' || executable === 'pnpm') {
    const sub = args[0]?.toLowerCase()
    if (sub && NETWORK_WRITE_SUBCOMMANDS.has(sub)) networkWrite = true
  }
  return {
    command,
    normalized,
    executable,
    pathArguments: [...pathArguments, ...(analyzerVerdict?.pathArguments ?? [])],
    cdTargets: analyzerVerdict?.cdTargets,
    analyzer: analyzerVerdict == null ? 'unavailable' : toolName === 'powershell' ? 'powershell-ast' : 'bash-segments',
    astReadOnly: astReadOnly || undefined,
    astWriteOps: analyzerVerdict?.writeOps || undefined,
    parseable: astReadOnly || (!hasAnalyzerVerdict && !!executable && KNOWN_COMMANDS.has(executable) && !highRisk),
    readOnly,
    networkRead,
    networkWrite,
    requiresApproval:
      !astReadOnly &&
      (astRejected || (!readOnly && (syntaxRisk || !executable || !KNOWN_COMMANDS.has(executable)))),
    highRisk,
    reason: astReadOnly
      ? undefined
      : analyzerVerdict?.rejectReason
        ? formatRejectReason(analyzerVerdict.rejectReason)
        : analyzerVerdict?.writeOps
          ? '命令包含文件写入操作，需要确认。'
          : highRisk
            ? syntaxRisk
              ? '命令包含重定向、管道、复合执行、脚本求值或高风险操作。'
              : '命令未通过简单命令白名单检查。'
            : undefined
  }
}

// ─── decision ───────────────────────────────────────────────────────────────

function resultTarget(
  context: PermissionContext,
  paths: readonly PathInspection[],
  command?: CommandInspection
): string {
  const pathText = paths.map((path) => {
    if (path.boundary === 'workspace') return `<workspace>/${path.relative || basename(path.absolute || path.input)}`
    if (path.boundary === 'allowed-read-root') return `<resource>/${path.relative || basename(path.absolute || path.input)}`
    if (path.boundary === 'protected') return '<protected path>'
    return '<outside workspace>'
  })
  const commandText = command ? redactSensitive(command.normalized).slice(0, 240) : ''
  return [...pathText, commandText && `command: ${commandText}`].filter(Boolean).join('; ') || 'no explicit target'
}

function redactSensitive(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/([A-Za-z0-9+/]{32,}={0,2})/g, '[redacted]')
}

function hardDenyReason(
  _context: PermissionContext,
  _risk: ToolEffectKind,
  paths: readonly PathInspection[],
  _command?: CommandInspection
): string | undefined {
  if (paths.some((path) => path.boundary === 'protected')) {
    return '目标路径属于受保护目录，任何 Mode 都不能放行。'
  }
  return undefined
}

function defaultDecision(
  context: PermissionContext,
  risk: ToolEffectKind,
  paths: readonly PathInspection[],
  command?: CommandInspection
): PolicyDecision {
  // Sensitive files are credential-shaped regardless of where they live —
  // a read would ship the secret to the remote model platform, so they
  // require explicit confirmation in every mode — bypass included. This
  // check must run BEFORE the bypass early-return.
  if (paths.some((path) => path.sensitive)) {
    return context.interactive ? 'ask' : 'deny'
  }
  if (risk === 'execute' && !command) {
    return context.interactive ? 'ask' : 'deny'
  }
  if (context.modeId === 'bypass') return 'allow'
  // readonly mode: only read-only tools and read-only shell commands run;
  // every mutation is denied rather than deferred to approval.
  if (context.modeId === 'readonly') {
    if (risk === 'execute' && command && (command.readOnly || (command.parseable && !command.requiresApproval))) {
      return 'allow'
    }
    if (risk === 'read' && paths.every((p) => p.boundary !== 'invalid' && !p.sensitive)) {
      return 'allow'
    }
    return 'deny'
  }
  // Read-only shell commands run without prompting in every mode — matching
  // the previous engine's safe-command allowlist, but driven by the richer
  // command analyzer (read-only PowerShell pipelines + simple read commands).
  if (risk === 'execute' && command && (command.readOnly || (command.parseable && !command.requiresApproval))) {
    return 'allow'
  }
  // Network mutations (push/publish/...) always need a human — they have an
  // external blast radius that a local rule cannot contain.
  if (command?.networkWrite) {
    return context.interactive ? 'ask' : 'deny'
  }
  if (
    ['default', 'auto'].includes(context.modeId) &&
    risk === 'write' &&
    ['write', 'edit'].includes(context.toolName) &&
    paths.length > 0 &&
    paths.every((path) => path.boundary === 'workspace')
  ) {
    return 'allow'
  }
  // Workspace-scoped file writes via shell — `... | Out-File tmp.txt` is the
  // shell equivalent of the `write` tool hitting a workspace path. AST proved
  // the command's only effect is writing to extracted path args; when every
  // path is inside the workspace, auto allows it just like `write`/`edit`.
  if (
    context.modeId === 'auto' &&
    risk === 'execute' &&
    command?.astWriteOps &&
    command.pathArguments !== undefined &&
    command.pathArguments.length > 0 &&
    paths.every((path) => path.boundary === 'workspace')
  ) {
    return 'allow'
  }
  if (
    context.modeId === 'auto' &&
    risk === 'execute' &&
    command &&
    !command.requiresApproval &&
    paths.every((path) => path.boundary === 'workspace' || (command.readOnly && path.boundary === 'outside'))
  ) {
    return 'allow'
  }
  // Network-read commands (git fetch/ls-remote) may auto-run in `auto` —
  // they touch the network but do not modify local files. `pull`/`clone`
  // write the worktree and stay on the approval path.
  if (context.modeId === 'auto' && risk === 'execute' && command?.networkRead && !command.highRisk) {
    return 'allow'
  }
  if (
    risk === 'control' ||
    (risk === 'read' &&
      effectKinds(getToolEffect(context.toolName)).every((kind) => kind === 'read' || kind === 'control') &&
      // Any boundary is readable: the workspace boundary governs writes and
      // command execution, not reads. Sensitive files are handled above.
      paths.every((path) => path.boundary !== 'invalid'))
  ) {
    return 'allow'
  }
  return context.interactive ? 'ask' : 'deny'
}

/** Pure policy calculation. Never opens UI and never executes a command. */
export function decidePermission(
  context: PermissionContext,
  analyzerVerdict?: CommandAnalyzerVerdict | null
): PermissionDecisionResult {
  const effect = getToolEffect(context.toolName)
  const toolPaths = [...pathArguments(context.toolName, context.args)]
  const commandValue = commandArgument(context.args)
  const command =
    commandValue === undefined
      ? undefined
      : analyzeCommand(
          commandValue,
          context.toolName === 'powershell' || context.toolName === 'bash' ? context.toolName : undefined,
          analyzerVerdict
        )
  const requestedPaths = [...toolPaths, ...(command?.pathArguments ?? [])]
  const protectedList = [...defaultProtectedRoots(), ...(context.protectedRoots ?? [])]
  const cdTargets = command?.cdTargets ?? []
  const cdInspections: PathInspection[] = []
  const cdDirsForPaths: string[] = []
  let simCwd = context.cwd
  let allCdInWorkspace = true
  for (const cdTarget of cdTargets) {
    const inspection = inspectPath(
      cdTarget,
      simCwd,
      context.workspaceRoot,
      context.allowedReadRoots,
      protectedList
    )
    cdInspections.push(inspection)
    if (inspection.boundary === 'workspace' && !inspection.sensitive && inspection.normalized) {
      simCwd = inspection.normalized
      if (comparePath(simCwd) !== comparePath(context.cwd)) {
        cdDirsForPaths.push(simCwd)
      }
    } else {
      allCdInWorkspace = false
    }
  }
  const basePathInspections = requestedPaths.map((path) =>
    inspectPath(path, context.cwd, context.workspaceRoot, context.allowedReadRoots, protectedList)
  )
  const extraPathInspections: PathInspection[] = []
  if (cdDirsForPaths.length > 0 && requestedPaths.length > 0) {
    const uniqueDirs = [...new Set(cdDirsForPaths.map((d) => comparePath(d)))].map(
      (norm) => cdDirsForPaths.find((d) => comparePath(d) === norm)!
    )
    for (const dir of uniqueDirs) {
      for (const path of requestedPaths) {
        extraPathInspections.push(
          inspectPath(path, dir, context.workspaceRoot, context.allowedReadRoots, protectedList)
        )
      }
    }
  }
  const rawPaths = [...basePathInspections, ...cdInspections, ...extraPathInspections]
  const effectiveCommand: CommandInspection | undefined =
    command && cdTargets.length > 0 && !allCdInWorkspace
      ? {
          ...command,
          readOnly: false,
          astReadOnly: undefined,
          requiresApproval: true,
          highRisk: true,
          reason: command.reason ?? '目录切换（cd）目标位于工作区之外或无法静态解析，需要确认。'
        }
      : command
  const isReadOnlyAccess =
    effectKinds(effect).every((kind) => kind === 'read' || kind === 'control') ||
    (highestRiskEffect(effect) === 'execute' && effectiveCommand?.readOnly === true)
  const paths = rawPaths.map((p) =>
    isReadOnlyAccess &&
    p.boundary === 'protected' &&
    p.normalized &&
    isReadOnlyDiagnosticProtectedPath(p.normalized)
      ? { ...p, boundary: 'outside' as const }
      : p
  )
  // A read/write targeting a credential-shaped file is escalated to the
  // `credential` tier so it can never slip through on a generic read rule.
  const risk: ToolEffectKind =
    paths.some((path) => path.sensitive) &&
    effectKinds(effect).every((kind) => kind === 'read' || kind === 'write' || kind === 'control')
      ? 'credential'
      : highestRiskEffect(effect)
  const base = {
    effect,
    risk,
    paths,
    command: effectiveCommand,
    target: resultTarget(context, paths, effectiveCommand)
  }
  const hardReason = hardDenyReason(context, risk, paths, effectiveCommand)
  if (hardReason) {
    return { ...base, decision: 'deny', reason: hardReason }
  }
  // `unknown` splits into two bands: declared-read-only-shaped tools (the
  // arg signature contains only path-like read fields and no command string)
  // may still fall through to the standard rules; fully opaque tools stay
  // ask/deny so an MCP or future tool cannot bypass review by being
  // unregistered. Guarantees bypass >= auto >= default in permissiveness.
  if (risk === 'unknown') {
    if (looksReadOnlyCall(context.args)) {
      const decision = defaultDecision(context, 'read', paths, effectiveCommand)
      return {
        ...base,
        decision,
        reason:
          decision === 'allow'
            ? `Mode ${context.modeId} 将未登记但仅含只读参数的工具按 read 处理。`
            : `工具 ${context.toolName} 未登记副作用；${context.interactive ? '需要用户确认。' : '当前无交互界面，按 fail-closed 处理。'}`
      }
    }
    const decision = context.interactive ? 'ask' : 'deny'
    return {
      ...base,
      decision,
      reason: `工具 ${context.toolName} 未登记副作用；${context.interactive ? '需要用户确认。' : '当前无交互界面，按 fail-closed 处理。'}`
    }
  }
  const decision = defaultDecision(context, risk, paths, effectiveCommand)
  const askReason = (() => {
    if (paths.some((p) => p.sensitive)) {
      return '目标涉及凭据或敏感文件，需要用户确认。'
    }
    if (risk === 'execute' && !effectiveCommand) {
      return '执行类调用缺少命令参数，需要用户确认。'
    }
    if (effectiveCommand?.networkWrite) {
      return '命令涉及远端仓库或包发布等外部写入操作，需要用户确认。'
    }
    if (
      paths.some((p) => p.boundary === 'outside' || p.boundary === 'invalid') &&
      (effectiveCommand?.astWriteOps || risk === 'write')
    ) {
      return '写入目标位于工作区之外或路径无法静态解析，需要用户确认。'
    }
    if (effectiveCommand?.reason) {
      return effectiveCommand.reason
    }
    return `Mode ${context.modeId} 对 ${risk} 副作用要求用户确认。`
  })()
  const reason =
    decision === 'allow'
      ? context.modeId === 'bypass'
        ? 'bypass 放行通过底层边界检查的调用。'
        : `Mode ${context.modeId} 默认允许该调用。`
      : context.interactive
        ? askReason
        : `Mode ${context.modeId} 对 ${risk} 副作用要求确认，但当前无交互界面，按 fail-closed 拒绝。`
  return { ...base, decision, reason }
}

/**
 * Heuristic: an unregistered tool whose args contain no command string and
 * only read-shaped fields (path/paths/query/pattern/…) is treated as a read
 * for policy purposes. This keeps genuinely opaque calls ask/deny while
 * letting benign file/search helpers flow through the normal read path.
 */
function looksReadOnlyCall(args: unknown): boolean {
  if (args === undefined || args === null) return true
  if (typeof args === 'string') return false
  if (typeof args !== 'object') return true
  const record = args as Record<string, unknown>
  // Positive whitelist. Two tiers:
  //  - `readSemanticKeys` are unambiguous read fields (query/pattern/limit…);
  //  - `pathLikeKeys` are read/WRITE-ambiguous (`path`/`file`/`dir`/`target` —
  //    an unknown write tool often uses the same names for its target).
  // A call is only treated as read-only when every key is whitelisted AND
  // at least one unambiguous read field is present, so a bare `{file: ...}`
  // cannot sneak a write past this heuristic.
  const READ_SEMANTIC_KEYS = new Set([
    'query', 'pattern', 'glob', 'regex', 'search', 'keyword', 'filter',
    'limit', 'offset', 'max_results', 'maxresults',
    'recursive', 'include', 'exclude', 'extensions', 'encoding'
  ])
  const PATH_LIKE_KEYS = new Set([
    'path', 'paths', 'file', 'filepath', 'file_path', 'dir', 'directory',
    'folder', 'cwd', 'root'
  ])
  // Almost-always-write field names — an unknown tool carrying these is
  // not a read, no matter what other fields it also supplies.
  const WRITE_HINT_KEYS = new Set(['target', 'destination', 'output', 'outfile', 'out'])
  let hasReadSemantic = false
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase()
    if (WRITE_HINT_KEYS.has(lower)) return false
    if (READ_SEMANTIC_KEYS.has(lower)) {
      hasReadSemantic = true
      continue
    }
    if (PATH_LIKE_KEYS.has(lower)) continue
    return false
  }
  // An args object with no keys at all is most likely a control/status call
  // (`{}`, `ping`) — treat as read-only; anything with only path-like keys
  // still requires a read-semantic key to qualify.
  return Object.keys(record).length === 0 || hasReadSemantic
}

