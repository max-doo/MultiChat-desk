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
    description: '跳过可确认项；硬性禁止和未知风险仍然拒绝。'
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

export interface PathInspection {
  input: string
  absolute?: string
  normalized?: string
  relative?: string
  boundary: PathBoundary
}

export interface CommandInspection {
  command: string
  normalized: string
  executable?: string
  pathArguments?: string[]
  parseable: boolean
  /** Recognized as a read-only PowerShell pipeline. */
  readOnly: boolean
  /** Contains destructive/opaque shell syntax that auto mode must confirm. */
  requiresApproval: boolean
  highRisk: boolean
  reason?: string
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

const TOOL_PATH_ARGUMENTS = new Set(['read', 'grep', 'find', 'ls', 'write', 'edit'])
const KNOWN_COMMANDS = new Set([
  'bash', 'cat', 'cd', 'cp', 'dir', 'echo', 'find', 'git', 'grep', 'head', 'ls', 'node', 'npm',
  'npx', 'pwd', 'pnpm', 'powershell', 'pwsh', 'python', 'py', 'rg', 'sed', 'tail', 'type',
  'where', 'whoami', 'get-childitem', 'get-content', 'get-location', 'select-string',
  'test-path', 'write-output'
])
const READ_COMMANDS = new Set([
  'cat', 'dir', 'find', 'grep', 'head', 'ls', 'rg', 'sed', 'tail', 'type',
  'get-childitem', 'get-content', 'select-string', 'test-path'
])
const SAFE_GIT_SUBCOMMANDS = new Set(['branch', 'diff', 'log', 'ls-files', 'rev-parse', 'show', 'status'])
const SAFE_NPM_SUBCOMMANDS = new Set(['list', 'ls', 'outdated', 'version'])
const SAFE_PNPM_SUBCOMMANDS = new Set(['list', 'ls', 'why', 'version'])
const READ_ONLY_POWERSHELL_COMMANDS = new Set([
  'compare-object', 'convertto-csv', 'convertto-html', 'convertto-json', 'format-list',
  'format-table', 'foreach-object', 'get-childitem', 'get-content', 'get-item',
  'get-location', 'group-object', 'measure-object', 'out-string', 'resolve-path',
  'select-object', 'select-string', 'sort-object', 'split-path', 'test-path',
  'where-object', 'write-output'
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

function expandPathInput(input: string): string | undefined {
  const value = input.trim()
  if (/^~(?:[\\/]|$)/.test(value)) return resolve(homedir(), value.slice(1))
  if (/^%USERPROFILE%(?:[\\/]|$)/i.test(value)) {
    return resolve(homedir(), value.slice('%USERPROFILE%'.length))
  }
  if (/^\$(?:HOME|USERPROFILE)(?:[\\/]|$)/i.test(value)) {
    return resolve(homedir(), value.replace(/^\$(?:HOME|USERPROFILE)/i, ''))
  }
  if (/^(?:%[^%]+%|\$[A-Za-z_][A-Za-z0-9_:]*)/.test(value)) return undefined
  return value
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
  try {
    const expanded = expandPathInput(input)
    if (!expanded) return result
    const absolute = resolve(cwd, expanded)
    const normalized = canonicalExistingPath(absolute)
    result.absolute = absolute
    result.normalized = normalized
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
  if (TOOL_PATH_ARGUMENTS.has(toolName)) return []
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
    const value = args[index].toLowerCase()
    if (value === '-c' || value === '--git-dir' || value === '--work-tree') {
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
  if (READ_COMMANDS.has(executable) || ['cd', 'echo', 'get-location', 'pwd', 'where', 'whoami', 'write-output'].includes(executable)) {
    return true
  }
  if (executable === 'git') {
    return (
      SAFE_GIT_SUBCOMMANDS.has(gitSubcommand(args) ?? '') &&
      !args.some((arg) => /^(?:--output(?:=|$)|-o(?:$|=))/.test(arg.toLowerCase()))
    )
  }
  if (executable === 'npm') {
    return args.length === 1 && (args[0] === '-v' || args[0] === '--version' || SAFE_NPM_SUBCOMMANDS.has(args[0].toLowerCase()))
  }
  if (executable === 'pnpm') {
    return args.length === 1 && (args[0] === '-v' || args[0] === '--version' || SAFE_PNPM_SUBCOMMANDS.has(args[0].toLowerCase()))
  }
  return ['node', 'python', 'py'].includes(executable) && args.length === 1 && ['-v', '--version'].includes(args[0])
}

function commandPathArguments(executable: string | undefined, args: readonly string[]): string[] {
  if (!executable) return []
  if (executable === 'git') {
    const paths: string[] = []
    for (let index = 0; index < args.length; index++) {
      const value = args[index]
      const lower = value.toLowerCase()
      if (lower === '-c' || lower === '--git-dir' || lower === '--work-tree') {
        if (args[index + 1]) paths.push(args[++index])
      } else if (lower.startsWith('--git-dir=') || lower.startsWith('--work-tree=')) {
        paths.push(value.slice(value.indexOf('=') + 1))
      }
    }
    return paths
  }
  const positional = args.filter(
    (arg) => arg !== '--' && !arg.startsWith('-') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)
  )
  if (READ_COMMANDS.has(executable)) return positional
  // For general commands, inspect only values that are syntactically paths.
  // Treating PowerShell variables and expressions as paths makes safe scripts
  // look invalid, while absolute/relative paths and common script files still
  // provide the boundary information needed by auto mode.
  return positional.filter(
    (arg) =>
      /^(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|~[\\/])/.test(arg) ||
      /\.(?:bat|cmd|cjs|js|jsx|mjs|ps1|py|sh|ts|tsx)$/i.test(arg)
  )
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

export function analyzeCommand(command: string): CommandInspection {
  const normalized = command.trim().replace(/\s+/g, ' ')
  const tokens = commandTokens(normalized)
  const executable = commandExecutable(normalized)
  const args = tokens.slice(1)
  const pathArguments = commandPathArguments(executable, args)
  if (!normalized) {
    return { command, normalized, parseable: false, readOnly: false, requiresApproval: true, highRisk: true, reason: '命令为空。' }
  }
  if (normalized.length > 4000) {
    return { command, normalized, executable, pathArguments, parseable: false, readOnly: false, requiresApproval: true, highRisk: true, reason: '命令过长，无法安全审查。' }
  }
  const highRiskPattern =
    /(?:^|[\s;&|])(?:rm|rmdir|rd|del|erase|remove-item|clear-content|set-content|out-file|format-volume|stop-computer|restart-computer|shutdown|sudo|runas|start-process|invoke-expression|iex)\b|(?:>|>>|2>|2>>)|[;&|]|\$\(|`|-encodedcommand\b|frombase64string|(?:curl|wget|invoke-webrequest|invoke-restmethod)\b[^\r\n]*(?:-x\s*(?:post|put|patch|delete)|--data(?:-raw)?|--upload-file|-body)\b|(?:python|py|node|powershell|pwsh)\b[^\r\n]*(?:\s-c\s|\s-e\s|\s--eval(?:uate)?\b)/i
  const destructiveGit = /^git(?:\.exe)?\s+(?:[^\r\n]*\s)?(?:clean\b|reset\s+--hard\b|checkout\s+--\s|restore\b)/i.test(normalized)
  const syntaxRisk = highRiskPattern.test(normalized) || destructiveGit
  const readOnly = readOnlyPowerShell(normalized)
  const simple = simpleCommand(executable, args)
  const highRisk = syntaxRisk || !simple || !executable || !KNOWN_COMMANDS.has(executable)
  return {
    command,
    normalized,
    executable,
    pathArguments,
    parseable: !!executable && KNOWN_COMMANDS.has(executable) && !highRisk,
    readOnly,
    requiresApproval: !readOnly && (syntaxRisk || !executable || !KNOWN_COMMANDS.has(executable)),
    highRisk,
    reason: highRisk
      ? syntaxRisk
        ? '命令包含重定向、管道、复合执行、脚本求值或高风险操作。'
        : '命令未通过 bypass 的简单命令 allowlist。'
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
  context: PermissionContext,
  risk: ToolEffectKind,
  paths: readonly PathInspection[],
  command?: CommandInspection
): string | undefined {
  if (paths.some((path) => path.boundary === 'protected')) {
    return '目标路径属于受保护目录，任何 Mode 都不能放行。'
  }
  if (context.modeId !== 'auto' && paths.some((path) => path.boundary === 'outside' || path.boundary === 'invalid')) {
    return '文件工具只能访问工作区或已登记的资源目录；目标路径无法通过边界检查。'
  }
  if (context.modeId === 'bypass' && risk === 'unknown') {
    return '工具副作用未登记，bypass 也不会放行未知工具。'
  }
  if (risk === 'execute' && !command && context.modeId === 'bypass') {
    return 'bypass 不会放行缺少命令参数的执行调用。'
  }
  if (command?.highRisk && context.modeId === 'bypass') {
    return command.reason || 'bypass 不会放行无法安全审查的命令。'
  }
  if (
    context.modeId === 'bypass' &&
    risk === 'execute' &&
    (!command?.parseable || !command.executable || !KNOWN_COMMANDS.has(command.executable))
  ) {
    return 'bypass 只放行可识别且未命中高风险模式的命令。'
  }
  return undefined
}

function defaultDecision(
  context: PermissionContext,
  risk: ToolEffectKind,
  paths: readonly PathInspection[],
  command?: CommandInspection
): PolicyDecision {
  if (context.modeId === 'bypass') return 'allow'
  // readonly mode: only read-only tools and read-only shell commands run;
  // every mutation is denied rather than deferred to approval.
  if (context.modeId === 'readonly') {
    if (risk === 'execute' && command && (command.readOnly || (command.parseable && !command.requiresApproval))) {
      return 'allow'
    }
    if (risk === 'read' && paths.every((p) => p.boundary === 'workspace' || p.boundary === 'allowed-read-root')) {
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
  if (
    ['default', 'auto'].includes(context.modeId) &&
    risk === 'write' &&
    ['write', 'edit'].includes(context.toolName) &&
    paths.length > 0 &&
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
  if (
    risk === 'control' ||
    (risk === 'read' &&
      effectKinds(getToolEffect(context.toolName)).every((kind) => kind === 'read' || kind === 'control') &&
      paths.every(
        (path) =>
          path.boundary === 'workspace' ||
          path.boundary === 'allowed-read-root' ||
          (context.modeId === 'auto' && path.boundary === 'outside')
      ))
  ) {
    return 'allow'
  }
  return context.interactive ? 'ask' : 'deny'
}

/** Pure policy calculation. Never opens UI and never executes a command. */
export function decidePermission(context: PermissionContext): PermissionDecisionResult {
  const effect = getToolEffect(context.toolName)
  const risk = highestRiskEffect(effect)
  const commandValue = commandArgument(context.args)
  const command = commandValue === undefined ? undefined : analyzeCommand(commandValue)
  const requestedPaths = [...pathArguments(context.toolName, context.args), ...(command?.pathArguments ?? [])]
  const paths = requestedPaths.map((path) =>
    inspectPath(path, context.cwd, context.workspaceRoot, context.allowedReadRoots, [
      ...defaultProtectedRoots(),
      ...(context.protectedRoots ?? [])
    ])
  )
  const base = {
    effect,
    risk,
    paths,
    command,
    target: resultTarget(context, paths, command)
  }
  const hardReason = hardDenyReason(context, risk, paths, command)
  if (hardReason) {
    return { ...base, decision: 'deny', reason: hardReason }
  }
  if (risk === 'unknown' && context.modeId !== 'bypass') {
    const decision = context.interactive ? 'ask' : 'deny'
    return {
      ...base,
      decision,
      reason: `工具 ${context.toolName} 未登记副作用；${context.interactive ? '需要用户确认。' : '当前无交互界面，按 fail-closed 处理。'}`
    }
  }
  const decision = defaultDecision(context, risk, paths, command)
  const reason =
    decision === 'allow'
      ? context.modeId === 'bypass'
        ? 'bypass 放行已登记且通过边界检查的调用。'
        : `Mode ${context.modeId} 默认允许该调用。`
      : context.interactive
        ? `Mode ${context.modeId} 对 ${risk} 副作用要求用户确认。`
        : `Mode ${context.modeId} 对 ${risk} 副作用要求确认，但当前无交互界面，按 fail-closed 拒绝。`
  return { ...base, decision, reason }
}

