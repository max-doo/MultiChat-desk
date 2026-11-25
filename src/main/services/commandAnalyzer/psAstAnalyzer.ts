/**
 * PowerShell AST allowlist analyzer — walks the structured flattened node list
 * emitted by powershellAstHelper and decides `readOnly` / `writeOps`.
 *
 * Read-only = every node type is in the allowlist AND every command name is
 * in the read-only wordlist (or passes the shared external-command gate) AND
 * no dangerous construct appears. Anything unrecognized (parse error,
 * truncated AST, unknown node, non-whitelisted static/instance method,
 * function definition, dynamic call operator) fails closed to `readOnly: false`.
 *
 * This is a semantic judgment on the *command text*; path-boundary and
 * sensitive-file checks still run downstream in permissionPolicy via the
 * returned `pathArguments` — the caller MUST NOT treat `readOnly` as
 * sufficient to allow on its own.
 */

import type { AstNodeInfo, AstParseResult } from './powershellAstHelper'
import { gateExternalCommand, looksLikeInspectablePath, validateStaticCdTarget } from './externalCommandGate'
import { isSensitiveFilePath } from '../permissionPolicy'

export interface PsAstVerdict {
  /** Whole tree is read-only by the allowlist. */
  readOnly: boolean
  /** Command writes to file paths — caller must boundary-check them. */
  writeOps?: boolean
  /** Path-shaped arguments pulled from CommandAst / FileRedirectionAst nodes. */
  pathArguments: string[]
  /** Static `cd` / `Set-Location` directory targets — caller verifies workspace boundary. */
  cdTargets?: string[]
  /** Executables invoked by CommandAst nodes (e.g. `powershell`, `git`). */
  commands: string[]
  /** First reason read-only was rejected (for logging/debug). */
  rejectReason?: string
}

// Sentinel whose leading `$` makes `inspectPath` mark dynamic targets `invalid`
// (fail-closed to `ask`) rather than resolving `(...)` relative to `cwd`.
const UNRESOLVED_TARGET = '$__UNRESOLVED_TARGET__'

// ─── node type allowlist ────────────────────────────────────────────────────
const ALLOWED_NODE_TYPES = new Set([
  'ScriptBlockAst',
  'NamedBlockAst',
  'PipelineAst',
  'PipelineChainAst', // gated on AndAnd / OrOr
  'CommandAst', // gated separately: command name & op must be whitelisted
  'CommandExpressionAst',
  'CommandParameterAst',
  'StringConstantExpressionAst',
  'ExpandableStringExpressionAst', // inner SubExpressionAst walked recursively
  'VariableExpressionAst',
  'ConstantExpressionAst',
  'BinaryExpressionAst',
  'UnaryExpressionAst',
  'ArrayExpressionAst',
  'ArrayLiteralAst',
  'HashtableAst',
  'ParenExpressionAst',
  'SubExpressionAst', // walked recursively — NOT a blanket pass
  'ScriptBlockExpressionAst', // { ... } argument — walked recursively
  'MemberExpressionAst', // property read (.Length, .Count)
  'IndexExpressionAst', // $arr[0], $m.Groups[1]
  'InvokeMemberExpressionAst', // gated separately: [type]::method / safe instance method
  'ConvertExpressionAst', // [type]$x casts — child TypeConstraintAst checked separately
  'TypeExpressionAst', // type literal — must be whitelisted
  'AssignmentStatementAst', // left side checked to be a plain unqualified local variable
  'IfStatementAst',
  'ElseClauseAst',
  'ElseIfClauseAst',
  'ForEachStatementAst',
  'ForStatementAst',
  'WhileStatementAst',
  'DoWhileStatementAst',
  'DoUntilStatementAst',
  'SwitchStatementAst',
  'ReturnStatementAst',
  'StatementBlockAst',
  'ParamBlockAst',
  'ParameterAst',
  'TypeConstraintAst', // type checked via `typeName`
  'AttributeAst',
  'MergingRedirectionAst' // 2>&1 / *>&1 — merges output streams, does not write disk
])

// File redirection `> out.txt` / `*> out.txt` — write-content semantics.
const WRITE_REDIRECT_NODE_TYPES = new Set(['FileRedirectionAst'])

// Node types that always poison read-only regardless of position.
const DENIED_NODE_TYPES = new Set([
  'FunctionDefinitionAst',
  'TrapStatementAst',
  'ThrowStatementAst',
  'BreakStatementAst',
  'ContinueStatementAst',
  'UsingStatementAst',
  'DataStatementAst',
  'DynamicKeywordStatementAst',
  'TernaryExpressionAst'
])

// ─── .NET static type/method whitelist ──────────────────────────────────────
const STATIC_WHITELIST: Readonly<Record<string, readonly string[] | '*'>> = {
  regex: ['matches', 'match', 'ismatch', 'split', 'escape', 'unescape'],
  math: '*',
  string: ['concat', 'join', 'format', 'isnullorempty', 'isnullorwhitespace', 'compare', 'equals'],
  datetime: ['now', 'today', 'utcnow', 'parse', 'tryparse', 'parseexact', 'tryparseexact', 'minvalue', 'maxvalue'],
  datetimeoffset: '*',
  timespan: '*',
  guid: ['newguid', 'parse', 'tryparse', 'empty'],
  version: '*',
  enum: '*',
  convert: ['tohexstring', 'fromhexstring'],
  'io.path': [
    'combine', 'getfilename', 'getfilenamewithoutextension', 'getextension',
    'getdirectoryname', 'getpathroot', 'hasextension', 'ispathrooted',
    'changeextension', 'gettemppath', 'getrandomfilename', 'join',
    'getrelativepath', 'getfullpath'
  ],
  environment: [
    'newline', 'version', 'machinename', 'username', 'userdomainname',
    'osversion', 'currentdirectory', 'tickcount'
  ],
  bitconverter: '*',
  'text.encoding': ['utf8', 'unicode', 'ascii', 'utf32', 'bigendianunicode', 'default'],
  array: '*',
  'collections.generic.list`1': '*',
  'collections.generic.dictionary`2': '*',
  'globalization.cultureinfo': '*',
  uri: '*',
  // Safe primitive / value types for `[int]$x` casts and basic parsing
  int: ['parse', 'tryparse'],
  int32: ['parse', 'tryparse'],
  int64: ['parse', 'tryparse'],
  uint32: ['parse', 'tryparse'],
  uint64: ['parse', 'tryparse'],
  long: ['parse', 'tryparse'],
  short: ['parse', 'tryparse'],
  byte: ['parse', 'tryparse'],
  sbyte: ['parse', 'tryparse'],
  double: ['parse', 'tryparse'],
  float: ['parse', 'tryparse'],
  single: ['parse', 'tryparse'],
  decimal: ['parse', 'tryparse'],
  bool: ['parse', 'tryparse'],
  boolean: ['parse', 'tryparse'],
  char: ['iswhitespace', 'isdigit', 'isletter', 'isletterordigit', 'tolower', 'toupper'],
  hashtable: [],
  object: [],
  psobject: [],
  pscustomobject: [],
  void: []
}

const STATIC_DENY_TYPES = new Set([
  'io.file',
  'io.directory',
  'io.filestream',
  'io.streamwriter',
  'io.streamreader',
  'io.fileinfo',
  'io.directoryinfo',
  'diagnostics.process',
  'management.automation.powershell',
  'net.webclient',
  'net.httpwebrequest',
  'net.sockets.tcpclient',
  'reflection.assembly',
  'runtime.interopservices.marshal',
  'security.cryptography.aes',
  'security.cryptography.rsacryptoserviceprovider',
  'threading.thread',
  'activator',
  'appdomain',
  'scriptblock'
])

// Instance methods that are pure reads on any object. Note `copyto` is
// intentionally excluded because `FileInfo.CopyTo()` writes files on disk.
const SAFE_INSTANCE_METHODS = new Set([
  // string
  'substring', 'tolower', 'tolowerinvariant', 'toupper', 'toupperinvariant',
  'trim', 'trimstart', 'trimend', 'replace', 'split', 'startswith',
  'endswith', 'contains', 'indexof', 'lastindexof', 'padleft', 'padright',
  'normalize', 'gethashcode', 'tostring', 'clone', 'concat',
  'join', 'format', 'compareto', 'equals', 'getenumerator',
  // array / collection — pure read accessors only
  'get', 'getvalue', 'getlength', 'getlonglength',
  'getlowerbound', 'getupperbound', 'binarysearch',
  'count', 'getrange', 'capacity',
  // reflection-free generic helpers
  'gettype', 'memberwiseclone'
])

// ─── cmdlet / command wordlists ─────────────────────────────────────────────
const READ_ONLY_COMMANDS = new Set([
  'get-childitem', 'get-content', 'get-item', 'get-location', 'get-process',
  'get-service', 'get-date', 'get-command', 'get-variable', 'get-psdrive',
  'get-member', 'get-host', 'get-history', 'get-job', 'get-module',
  'get-verb', 'get-help', 'get-alias', 'get-culture', 'get-uiculture',
  'get-executionpolicy', 'get-pssnapin', 'get-filehash',
  'measure-object', 'compare-object', 'group-object', 'sort-object',
  'select-object', 'select-string', 'where-object', 'foreach-object',
  'format-list', 'format-table', 'format-wide', 'format-custom',
  'format-hex',
  'out-string', 'out-null', 'out-default', 'out-host',
  'convertto-json', 'convertto-csv', 'convertto-html', 'convertto-xml',
  'join-string', 'get-random', 'get-unique',
  'write-output', 'write-host', 'write-warning', 'write-verbose', 'write-debug',
  'echo', 'resolve-path', 'split-path', 'test-path',
  'dir', 'ls', 'cat', 'type', 'gc', 'gci', 'gi', 'gcm', 'pwd', 'gl', 'sls',
  'select', 'where', 'foreach', '?', '%', 'group', 'compare', 'fl', 'ft', 'fw'
])

const WRITE_COMMANDS = new Set([
  'out-file', 'set-content', 'add-content', 'export-csv',
  'export-clixml', 'tee-object'
])

const DENIED_COMMANDS = new Set([
  'invoke-expression', 'iex', 'start-process', 'new-object', 'add-member',
  'remove-item', 'remove-variable', 'clear-content', 'clear-variable',
  'clear-history', 'set-item', 'set-variable',
  'stop-process', 'stop-computer', 'restart-computer', 'restart-service',
  'stop-service', 'start-service', 'suspend-service', 'resume-service',
  'new-item', 'new-itemproperty', 'set-itemproperty', 'remove-itemproperty',
  'rename-item', 'copy-item', 'move-item', 'mkdir', 'md', 'del', 'rm',
  'rmdir', 'erase', 'kill', 'spps', 'sasv', 'start-sleep',
  'write-error', 'write-progress', 'read-host',
  'invoke-command', 'icm', 'invoke-webrequest',
  'iwr', 'invoke-restmethod', 'irm', 'curl', 'wget', 'powershell', 'pwsh',
  'cmd', 'cmdkey', 'reg', 'netsh', 'schtasks', 'format-volume',
  'clear-disk', 'enable-psremoting', 'disable-psremoting',
  'convertfrom-json', 'convertfrom-csv', 'convertfrom-xml', 'import-clixml',
  'add-type', 'new-module', 'import-module', 'set-executionpolicy',
  'enable-psbreakpoint', 'test-connection', 'test-netconnection',
  'send-mailmessage', 'set-acl', 'new-localuser', 'new-netfirewallrule'
])

// External programs that are genuinely read-only regardless of arguments.
// Programs with mutating flags (`git`, `npm`, `pnpm`, `node`, `python`, `py`,
// `tsc`, `find`, `fd`, `rg`, `sort`, `yq`) go through `gateExternalCommand`.
const READ_ONLY_EXTERNAL_PROGRAMS = new Set([
  'ag', 'ack', 'findstr', 'where', 'whoami', 'hostname', 'jq', 'fc'
])

const WRITE_PATH_FLAGS = new Set(['filepath', 'path', 'literalpath', 'pspath'])
const WRITE_VALUE_FLAGS = new Set([
  'encoding', 'value', 'inputobject', 'width', 'delimiter', 'credential',
  'filter', 'include', 'exclude', 'variable', 'stream'
])

function normalizeTypeName(name: string): string {
  return name.replace(/^system\./i, '').replace(/\[\]$/, '').toLowerCase()
}

function normalizeCommandName(raw: string): string {
  return raw.replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

function checkTypeName(rawTypeName: string | null | undefined): string | null {
  if (!rawTypeName) return 'missing type name'
  if (rawTypeName.includes('[') && !rawTypeName.endsWith('[]')) {
    return `unsupported generic type: ${rawTypeName}`
  }
  const tn = normalizeTypeName(rawTypeName)
  if (STATIC_DENY_TYPES.has(tn)) return `denied type: ${tn}`
  if (!(tn in STATIC_WHITELIST)) return `unwhitelisted type: ${tn}`
  return null
}

function extractWriteTargets(node: AstNodeInfo): string[] {
  const elems = node.elems ?? []
  const targets: string[] = []
  let expectPathNext = false
  let skipValueNext = false

  // Element 0 is the command name itself.
  for (let i = 1; i < elems.length; i++) {
    const elem = elems[i]
    if (elem.kind === 'param') {
      expectPathNext = false
      skipValueNext = false
      const pname = (elem.name || '').toLowerCase()
      const isPathFlag =
        WRITE_PATH_FLAGS.has(pname) ||
        (pname.length >= 2 && [...WRITE_PATH_FLAGS].some((f) => f.startsWith(pname)))
      if (isPathFlag) {
        if (elem.val != null) {
          targets.push(elem.argType === 'StringConstantExpressionAst' && elem.val ? elem.val : UNRESOLVED_TARGET)
        } else {
          expectPathNext = true
        }
      } else if (WRITE_VALUE_FLAGS.has(pname)) {
        if (elem.val == null) skipValueNext = true
      } else if (elem.val != null) {
        targets.push(elem.argType === 'StringConstantExpressionAst' && elem.val ? elem.val : UNRESOLVED_TARGET)
      }
      continue
    }

    if (expectPathNext) {
      expectPathNext = false
      targets.push(elem.argType === 'StringConstantExpressionAst' && elem.val ? elem.val : UNRESOLVED_TARGET)
      continue
    }
    if (skipValueNext) {
      skipValueNext = false
      continue
    }

    if (elem.argType === 'StringConstantExpressionAst' && elem.val) {
      targets.push(elem.val)
    } else {
      targets.push(UNRESOLVED_TARGET)
    }
  }
  return targets
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2) {
    const a = value[0]
    const b = value[value.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return value.slice(1, -1)
  }
  return value
}

function extractCommandArgs(node: AstNodeInfo): string[] {
  const elems = node.elems ?? []
  const args: string[] = []
  for (let i = 1; i < elems.length; i++) {
    const elem = elems[i]
    if (elem.kind === 'param') {
      const flag = `-${elem.name ?? ''}`
      args.push(elem.val != null ? `${flag}:${stripOuterQuotes(elem.val)}` : flag)
    } else if (elem.val != null) {
      args.push(stripOuterQuotes(elem.val))
    }
  }
  return args
}

function extractStaticCdTarget(node: AstNodeInfo): string | null {
  const elems = node.elems ?? []
  let target: string | null = null
  let expectPath = false
  for (let i = 1; i < elems.length; i++) {
    const elem = elems[i]
    if (elem.kind === 'param') {
      if (expectPath) return null
      const pname = (elem.name || '').toLowerCase()
      if (pname !== 'path' && pname !== 'literalpath') return null
      if (elem.val != null) {
        if (target !== null || elem.argType !== 'StringConstantExpressionAst') return null
        target = elem.val
      } else {
        expectPath = true
      }
      continue
    }
    if (target !== null || elem.argType !== 'StringConstantExpressionAst' || !elem.val) {
      return null
    }
    target = elem.val
    expectPath = false
  }
  if (expectPath || !target) return null
  return validateStaticCdTarget(target)
}

// ─── main walk ─────────────────────────────────────────────────────────────

export function analyzePowerShellAst(result: AstParseResult): PsAstVerdict {
  const verdict: PsAstVerdict = { readOnly: false, pathArguments: [], commands: [] }
  if (result.status !== 'ok') {
    verdict.rejectReason = result.status === 'truncated' ? 'ast-truncated' : 'parse-error'
    return verdict
  }
  const nodes = result.nodes

  for (const node of nodes) {
    if (DENIED_NODE_TYPES.has(node.type)) {
      verdict.rejectReason = `denied node type: ${node.type}`
      return verdict
    }
    if (WRITE_REDIRECT_NODE_TYPES.has(node.type)) {
      verdict.writeOps = true
      if (node.locType === 'StringConstantExpressionAst' && node.target) {
        verdict.pathArguments.push(node.target)
      } else {
        verdict.pathArguments.push(UNRESOLVED_TARGET)
      }
      continue
    }
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      verdict.rejectReason = `unknown node type: ${node.type}`
      return verdict
    }
  }

  for (const node of nodes) {
    switch (node.type) {
      case 'PipelineChainAst': {
        if (node.chainOp !== 'AndAnd' && node.chainOp !== 'OrOr') {
          verdict.rejectReason = `unsupported pipeline chain: ${node.chainOp ?? 'unknown'}`
          return verdict
        }
        break
      }
      case 'InvokeMemberExpressionAst': {
        if (!node.member) {
          verdict.rejectReason = `dynamic member invocation: ${node.text.slice(0, 60)}`
          return verdict
        }
        const method = node.member.toLowerCase()
        if (node.static) {
          if (!node.targetType) {
            verdict.rejectReason = `dynamic static target: ${node.text.slice(0, 60)}`
            return verdict
          }
          const typeName = normalizeTypeName(node.targetType)
          if (STATIC_DENY_TYPES.has(typeName)) {
            verdict.rejectReason = `denied static type: ${typeName}`
            return verdict
          }
          const allowed = STATIC_WHITELIST[typeName]
          if (!allowed) {
            verdict.rejectReason = `unwhitelisted static type: ${typeName}`
            return verdict
          }
          if (allowed !== '*' && !allowed.includes(method)) {
            verdict.rejectReason = `unwhitelisted method: ${typeName}::${method}`
            return verdict
          }
        } else {
          if (!SAFE_INSTANCE_METHODS.has(method)) {
            verdict.rejectReason = `unwhitelisted instance method: ${method}`
            return verdict
          }
        }
        break
      }
      case 'TypeExpressionAst':
      case 'TypeConstraintAst': {
        const err = checkTypeName(node.typeName)
        if (err) {
          verdict.rejectReason = err
          return verdict
        }
        break
      }
      case 'AssignmentStatementAst': {
        if (node.assignOp !== 'Equals' || node.lhsUnqualified !== true) {
          verdict.rejectReason = `non-local assignment lhs: ${node.text.slice(0, 40)}`
          return verdict
        }
        break
      }
      case 'CommandAst': {
        if (node.op && node.op !== 'Unknown') {
          verdict.rejectReason = `denied invocation operator: ${node.op}`
          return verdict
        }
        if (!node.cmd) {
          verdict.rejectReason = `dynamic command: ${node.text.slice(0, 40)}`
          return verdict
        }
        const name = normalizeCommandName(node.cmd)
        verdict.commands.push(name)
        const args = extractCommandArgs(node)
        const collectInspectableArgs = () => {
          for (const t of args) {
            if (/^\/[A-Za-z]/.test(t) && !/^\/\//.test(t)) continue
            if (t && !t.startsWith('-') && looksLikeInspectablePath(t, isSensitiveFilePath)) {
              verdict.pathArguments.push(t)
            }
          }
        }
        if (name === 'cd' || name === 'set-location') {
          const cdTarget = extractStaticCdTarget(node)
          if (!cdTarget) {
            collectInspectableArgs()
            verdict.rejectReason = 'unsafe cd target'
            return verdict
          }
          verdict.cdTargets ??= []
          verdict.cdTargets.push(cdTarget)
          break
        }
        if (DENIED_COMMANDS.has(name)) {
          collectInspectableArgs()
          verdict.rejectReason = `denied command: ${name}`
          return verdict
        }
        if (WRITE_COMMANDS.has(name)) {
          verdict.writeOps = true
          verdict.pathArguments.push(...extractWriteTargets(node))
          break
        }
        const gated = gateExternalCommand(name, args, isSensitiveFilePath)
        if (gated) {
          if (!gated.allowed) {
            collectInspectableArgs()
            verdict.pathArguments.push(...gated.pathArgs)
            verdict.rejectReason = `denied external command: ${name}`
            return verdict
          }
          verdict.pathArguments.push(...gated.pathArgs)
          break
        }
        if (!READ_ONLY_COMMANDS.has(name) && !READ_ONLY_EXTERNAL_PROGRAMS.has(name)) {
          collectInspectableArgs()
          verdict.rejectReason = `unwhitelisted command: ${name}`
          return verdict
        }
        collectInspectableArgs()
        break
      }
      default:
        break
    }
  }

  verdict.readOnly = !verdict.writeOps
  return verdict
}
