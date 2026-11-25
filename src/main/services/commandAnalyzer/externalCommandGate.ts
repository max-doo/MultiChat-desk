/**
 * Shared subcommand & flag gate for external executables invoked from either
 * Bash or PowerShell pipelines (`git`, `npm`, `pnpm`, `node`, `python`, `tsc`,
 * `find`, `fd`, `rg`, `sort`, `yq`).
 *
 * Centralizing this avoids drift between the two analyzers: a `git push` or
 * `python -c` must be gated identically whether invoked from bash or pwsh.
 */

const PATH_LIKE = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|~[\\/])/
const ENV_ANCHORED = /^(?:\$\{?env:|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)/i
const SCRIPT_EXT = /\.(?:bat|cmd|cjs|js|jsx|mjs|ps1|py|sh|ts|tsx)$/i

/**
 * Return true when a bare argument looks like a filesystem path, script file,
 * or credential-shaped file (`.env`, `id_rsa`, `*.pem`, ...) that MUST be
 * inspected by `inspectPath` downstream.
 */
export function looksLikeInspectablePath(
  token: string,
  isSensitive: (normalized: string, input: string) => boolean
): boolean {
  if (!token) return false
  if (PATH_LIKE.test(token) || ENV_ANCHORED.test(token) || SCRIPT_EXT.test(token)) return true
  return isSensitive(token, token)
}

const SAFE_GIT_SIMPLE_SUBS = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'describe', 'ls-files', 'blame', 'shortlog'
])

const SAFE_GIT_CONFIG_KEYS = new Set([
  'core.quotepath', 'color.ui', 'i18n.logoutputencoding', 'i18n.commitencoding'
])

const SAFE_NPM_SUBS = new Set([
  'ls', 'list', 'view', 'outdated', 'explain', 'doctor', 'help', 'prefix',
  'root', 'version', 'whoami', 'ping', 'why'
])

export interface ExternalGateResult {
  allowed: boolean
  pathArgs: string[]
}

const DENY: ExternalGateResult = { allowed: false, pathArgs: [] }

function gitSubcommandAndPaths(args: readonly string[]): {
  sub?: string
  subIdx: number
  pathArgs: string[]
  unsafeGlobalFlag: boolean
} {
  const pathArgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    const raw = args[i]
    const v = raw.toLowerCase()
    if (v === '--exec-path' || v.startsWith('--exec-path=')) {
      return { subIdx: -1, pathArgs, unsafeGlobalFlag: true }
    }
    if (raw === '-C') {
      if (!args[i + 1]) return { subIdx: -1, pathArgs, unsafeGlobalFlag: true }
      pathArgs.push(args[i + 1])
      i++
      continue
    }
    if (raw.startsWith('-C') && raw.length > 2) {
      pathArgs.push(raw.slice(2))
      continue
    }
    if (v === '--git-dir' || v === '--work-tree') {
      if (!args[i + 1]) return { subIdx: -1, pathArgs, unsafeGlobalFlag: true }
      pathArgs.push(args[i + 1])
      i++
      continue
    }
    if (v.startsWith('--git-dir=') || v.startsWith('--work-tree=')) {
      pathArgs.push(raw.slice(raw.indexOf('=') + 1))
      continue
    }
    if (v === '-c' || v === '--config-env') {
      const cfg = args[i + 1]
      if (!cfg) return { subIdx: -1, pathArgs, unsafeGlobalFlag: true }
      const key = cfg.split('=')[0].trim().toLowerCase()
      if (!SAFE_GIT_CONFIG_KEYS.has(key)) return { subIdx: -1, pathArgs, unsafeGlobalFlag: true }
      i++
      continue
    }
    if (v.startsWith('-c') && v.length > 2) {
      const key = v.slice(2).split('=')[0].trim()
      if (!SAFE_GIT_CONFIG_KEYS.has(key)) return { subIdx: -1, pathArgs, unsafeGlobalFlag: true }
      continue
    }
    if (v.startsWith('-')) continue
    return { sub: v, subIdx: i, pathArgs, unsafeGlobalFlag: false }
  }
  return { subIdx: -1, pathArgs, unsafeGlobalFlag: false }
}

function isSafeGitReadSub(sub: string, restArgs: readonly string[]): boolean {
  if (SAFE_GIT_SIMPLE_SUBS.has(sub)) {
    return !restArgs.some((arg) => {
      const l = arg.toLowerCase()
      return (
        l === '--output' ||
        l.startsWith('--output=') ||
        l === '-o' ||
        (l.startsWith('-o') && l.length > 2 && !l.startsWith('--')) ||
        l === '--ext-diff'
      )
    })
  }
  if (sub === 'branch') {
    const mutating = new Set([
      '-d', '-m', '-c', '-f', '--delete', '--move', '--copy', '--force',
      '--edit-description', '--set-upstream-to', '--unset-upstream'
    ])
    for (const a of restArgs) {
      const l = a.toLowerCase()
      if (mutating.has(l) || l.startsWith('--set-upstream-to=')) return false
    }
    const readFlags = new Set(['-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '-l', '--list', '--show-current', '--no-color', '--color'])
    return restArgs.every((a) => readFlags.has(a.toLowerCase()))
  }
  if (sub === 'tag') {
    if (restArgs.length === 0) return true
    const hasList = restArgs.some((a) => a === '-l' || a === '--list')
    const hasMutating = restArgs.some((a) => ['-d', '--delete', '-a', '-s', '-u', '-f', '--force', '--sign', '--annotate'].includes(a.toLowerCase()))
    return hasList && !hasMutating
  }
  if (sub === 'remote') {
    if (restArgs.length === 0) return true
    const first = restArgs[0].toLowerCase()
    return first === '-v' || first === '--verbose' || first === 'show' || first === 'get-url'
  }
  if (sub === 'reflog') {
    const first = restArgs[0]?.toLowerCase()
    return !first || first === 'show' || first.startsWith('-')
  }
  return false
}

/**
 * Evaluate a known external command (`git`, `npm`, `pnpm`, `node`, `python`,
 * `python3`, `py`, `tsc`, `find`, `fd`, `rg`, `sort`, `yq`). Returns `null`
 * if `head` is not one of the gated executables.
 */
export function gateExternalCommand(
  head: string,
  args: readonly string[],
  isSensitive: (normalized: string, input: string) => boolean
): ExternalGateResult | null {
  switch (head) {
    case 'git': {
      const { sub, subIdx, pathArgs, unsafeGlobalFlag } = gitSubcommandAndPaths(args)
      if (unsafeGlobalFlag || !sub) return DENY
      if (!isSafeGitReadSub(sub, args.slice(subIdx + 1))) return DENY
      return { allowed: true, pathArgs }
    }
    case 'npm':
    case 'pnpm': {
      const sub = args[0]?.toLowerCase()
      if (args.length === 0 || sub === '-v' || sub === '--version' || (sub && SAFE_NPM_SUBS.has(sub))) {
        if (args.some((a) => a.toLowerCase().startsWith('--script-shell'))) return DENY
        const pathArgs: string[] = []
        for (let i = 0; i < args.length; i++) {
          const l = args[i].toLowerCase()
          if ((l === '--prefix' || l === '-c' || l === '--dir') && args[i + 1]) {
            pathArgs.push(args[++i])
          } else if (l.startsWith('--prefix=') || l.startsWith('--dir=')) {
            pathArgs.push(args[i].slice(args[i].indexOf('=') + 1))
          }
        }
        return { allowed: true, pathArgs }
      }
      return DENY
    }
    case 'tsc': {
      let hasNoEmit = false
      for (const a of args) {
        const l = a.toLowerCase()
        if (l === '--noemit') hasNoEmit = true
        if (
          l === '--tsbuildinfofile' || l.startsWith('--tsbuildinfofile=') ||
          l === '--generatecpuprofile' || l.startsWith('--generatecpuprofile=') ||
          l === '--generatetrace' || l.startsWith('--generatetrace=')
        ) {
          return DENY
        }
      }
      return hasNoEmit ? { allowed: true, pathArgs: [] } : DENY
    }
    case 'node':
    case 'python':
    case 'python3':
    case 'py': {
      const flag = args[0]?.toLowerCase()
      const ok = args.length === 1 && (flag === '-v' || flag === '--version' || flag === '-h' || flag === '--help')
      return ok ? { allowed: true, pathArgs: [] } : DENY
    }
    case 'find': {
      const pathArgs: string[] = []
      for (const a of args) {
        const l = a.toLowerCase()
        if (
          l === '-delete' || l === '-exec' || l === '-execdir' ||
          l === '-ok' || l === '-okdir' || l.startsWith('-fprint') || l === '-fls'
        ) {
          return DENY
        }
        if (!a.startsWith('-') && looksLikeInspectablePath(a, isSensitive)) {
          pathArgs.push(a)
        }
      }
      return { allowed: true, pathArgs }
    }
    case 'fd': {
      const pathArgs: string[] = []
      for (const a of args) {
        const l = a.toLowerCase()
        if (a === '-x' || a === '-X' || l === '--exec' || l.startsWith('--exec=') || l === '--exec-batch' || l.startsWith('--exec-batch=')) {
          return DENY
        }
        if (!a.startsWith('-') && looksLikeInspectablePath(a, isSensitive)) pathArgs.push(a)
      }
      return { allowed: true, pathArgs }
    }
    case 'rg': {
      const pathArgs: string[] = []
      for (const a of args) {
        const l = a.toLowerCase()
        if (l === '--pre' || l.startsWith('--pre=')) return DENY
        if (!a.startsWith('-') && looksLikeInspectablePath(a, isSensitive)) pathArgs.push(a)
      }
      return { allowed: true, pathArgs }
    }
    case 'sort': {
      const pathArgs: string[] = []
      for (const a of args) {
        const l = a.toLowerCase()
        if (l === '-o' || (l.startsWith('-o') && l.length > 2 && !l.startsWith('--')) || l === '--output' || l.startsWith('--output=')) {
          return DENY
        }
        if (!a.startsWith('-') && looksLikeInspectablePath(a, isSensitive)) pathArgs.push(a)
      }
      return { allowed: true, pathArgs }
    }
    case 'yq': {
      const pathArgs: string[] = []
      for (const a of args) {
        const l = a.toLowerCase()
        if (l === '-i' || l === '--inplace') return DENY
        if (!a.startsWith('-') && looksLikeInspectablePath(a, isSensitive)) pathArgs.push(a)
      }
      return { allowed: true, pathArgs }
    }
    default:
      return null
  }
}
