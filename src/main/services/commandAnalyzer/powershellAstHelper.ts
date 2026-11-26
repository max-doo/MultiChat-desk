/**
 * PowerShell AST helper — resident child process that parses command text
 * via the official [System.Management.Automation.Language.Parser] API and
 * returns a flattened node list over a JSON-Lines stdin/stdout protocol.
 *
 * The script is delivered inline as a single `-Command` argument (no .ps1
 * file, no extraResources packaging). The Node side escapes `$` as
 * `\u0024` inside the template literal so JS doesn't interpolate it.
 *
 * Fail-closed contract: any spawn failure, malformed line, request timeout
 * or helper crash resolves the pending request with `null`; callers treat
 * `null` as "cannot analyze → ask". The helper is restarted lazily once
 * on the next request, not eagerly.
 */

import { spawn, type ChildProcess } from 'child_process'
import * as readline from 'readline'

export interface AstCommandElem {
  kind: 'param' | 'arg'
  name?: string
  val?: string | null
  argType?: string | null
}

export interface AstNodeInfo {
  /** AST node class name, e.g. `CommandAst`, `SubExpressionAst`. */
  type: string
  /** `Extent.Text` truncated to 200 chars for diagnostics/debug. */
  text: string
  /** CommandAst: resolved command name from `GetCommandName()`. */
  cmd?: string | null
  /** CommandAst: invocation operator (`Unknown`, `Ampersand`, `Dot`). */
  op?: string
  /** CommandAst: true when this command receives pipeline input (`... | cmd`). */
  piped?: boolean
  /** CommandAst: structured elements (flags & args without truncation). */
  elems?: AstCommandElem[]
  /** FileRedirectionAst: unquoted target if constant, else raw extent. */
  target?: string | null
  /** FileRedirectionAst: AST type of `Location`. */
  locType?: string | null
  /** MergingRedirectionAst: destination stream (`Output`, `Error`, ...). */
  toStream?: string
  /** InvokeMemberExpressionAst: whether static `::` call. */
  static?: boolean
  /** InvokeMemberExpressionAst: literal method name, or null if dynamic. */
  member?: string | null
  /** InvokeMemberExpressionAst: static type `FullName` if `TypeExpressionAst`. */
  targetType?: string | null
  /** TypeExpressionAst / TypeConstraintAst: `TypeName.FullName`. */
  typeName?: string | null
  /** AssignmentStatementAst: operator (`Equals`, `PlusEquals`, ...). */
  assignOp?: string
  /** AssignmentStatementAst: LHS variable `UserPath`. */
  lhsVar?: string | null
  /** AssignmentStatementAst: true only for plain unqualified `$name`. */
  lhsUnqualified?: boolean
  /** PipelineChainAst: `AndAnd` or `OrOr`. */
  chainOp?: string
}

export interface AstParseResult {
  status: 'ok' | 'parse-error' | 'truncated'
  nodes: AstNodeInfo[]
  errors?: string[]
}

const REQUEST_TIMEOUT_MS = 3000
const COLD_START_TIMEOUT_MS = 6000
const MAX_NODES = 5000
const MAX_ELEM_VAL_CHARS = 1024
const MAX_AST_JSON_BYTES = 2 * 1024 * 1024
const SENTINEL = '__PSAST__'

// PowerShell script delivered inline. Reads one JSON line {"id":n,"cmd":"..."}
// per loop, emits `${SENTINEL}{"id":n,"status":...,"nodes":[...]}` on stdout.
// Nodes are pre-flattened via Ast.FindAll and carry structured metadata for
// CommandAst / FileRedirectionAst / InvokeMemberExpressionAst / Type* /
// AssignmentStatementAst so Node never relies on truncated regex heuristics.
const HELPER_PS = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
function _clip($s, $max) { if ($null -eq $s) { return $null }; if ($s.Length -gt $max) { return $s.Substring(0, $max) }; return $s }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { exit 0 }
  $req = $null
  try { $req = $line | ConvertFrom-Json } catch {}
  if ($null -eq $req -or $null -eq $req.cmd) { continue }
  $errs = $null; $toks = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($req.cmd, [ref]$toks, [ref]$errs)
  $nodes = @()
  $truncated = $false
  foreach ($n in $ast.FindAll({ param($a) $true }, $true)) {
    if ($nodes.Count -ge ${MAX_NODES}) { $truncated = $true; break }
    $tn = $n.GetType().Name
    $info = [ordered]@{ type = $tn; text = (_clip $n.Extent.Text 200) }
    if ($tn -eq 'CommandAst') {
      $info.cmd = $n.GetCommandName()
      $info.op = $n.InvocationOperator.ToString()
      if ($n.Parent -is [System.Management.Automation.Language.PipelineAst] -and $n.Parent.PipelineElements.Count -gt 1 -and $n.Parent.PipelineElements[0] -ne $n) { $info.piped = $true }
      $elems = @()
      foreach ($e in $n.CommandElements) {
        if ($e -is [System.Management.Automation.Language.CommandParameterAst]) {
          $av = $null; $at = $null
          if ($e.Argument) {
            $at = $e.Argument.GetType().Name
            $av = if ($e.Argument -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $e.Argument.Value } else { $e.Argument.Extent.Text }
            $av = _clip $av ${MAX_ELEM_VAL_CHARS}
          }
          $elems += [ordered]@{ kind = 'param'; name = $e.ParameterName; val = $av; argType = $at }
        } else {
          $v = if ($e -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $e.Value } else { $e.Extent.Text }
          $elems += [ordered]@{ kind = 'arg'; val = (_clip $v ${MAX_ELEM_VAL_CHARS}); argType = $e.GetType().Name }
        }
      }
      $info.elems = $elems
    } elseif ($tn -eq 'FileRedirectionAst') {
      $loc = $n.Location
      $info.target = if ($loc -is [System.Management.Automation.Language.StringConstantExpressionAst]) { _clip $loc.Value ${MAX_ELEM_VAL_CHARS} } elseif ($loc) { _clip $loc.Extent.Text ${MAX_ELEM_VAL_CHARS} } else { $null }
      $info.locType = if ($loc) { $loc.GetType().Name } else { $null }
    } elseif ($tn -eq 'MergingRedirectionAst') {
      $info.toStream = $n.ToStream.ToString()
    } elseif ($tn -eq 'InvokeMemberExpressionAst') {
      $info.static = [bool]$n.Static
      $info.member = if ($n.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $n.Member.Value } else { $null }
      $info.targetType = if ($n.Expression -is [System.Management.Automation.Language.TypeExpressionAst]) { $n.Expression.TypeName.FullName } else { $null }
    } elseif ($tn -eq 'TypeExpressionAst' -or $tn -eq 'TypeConstraintAst') {
      $info.typeName = $n.TypeName.FullName
    } elseif ($tn -eq 'AssignmentStatementAst') {
      $info.assignOp = $n.Operator.ToString()
      $lhsNode = if ($n.Left -is [System.Management.Automation.Language.ConvertExpressionAst]) { $n.Left.Child } else { $n.Left }
      if ($lhsNode -is [System.Management.Automation.Language.VariableExpressionAst]) {
        $info.lhsVar = $lhsNode.VariablePath.UserPath
        $info.lhsUnqualified = [bool]$lhsNode.VariablePath.IsUnqualified
      }
    } elseif ($tn -eq 'PipelineChainAst') {
      $info.chainOp = $n.Operator.ToString()
    }
    $nodes += $info
  }
  $errMsgs = @()
  if ($errs) { foreach ($e in $errs) { $errMsgs += $e.Message } }
  $status = if ($errs -and $errs.Count -gt 0) { 'parse-error' } elseif ($truncated) { 'truncated' } else { 'ok' }
  $payload = [ordered]@{ id = $req.id; status = $status; nodes = $nodes; errors = $errMsgs }
  [Console]::Out.WriteLine('${SENTINEL}' + ($payload | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
`

type PendingResolve = (result: AstParseResult | null) => void

export class PowerShellAstHelper {
  private child: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private nextId = 1
  private epoch = 0
  private queue: Array<{ id: number; cmd: string; resolve: PendingResolve; timer: NodeJS.Timeout }> = []
  private busy = false
  private disposing = false

  constructor(private resolveShell: () => Promise<{ exe: string; args: string[] }>) {}

  private async ensureChild(expectedEpoch: number): Promise<boolean> {
    if (this.child && !this.child.killed) return true
    this.disposing = false
    try {
      const { exe, args } = await this.resolveShell()
      if (this.epoch !== expectedEpoch) return false
      // The helper script replaces the trailing `-Command` placeholder: pi's
      // config already ends with `-Command`, so we append our script as the
      // final arg.
      const spawnArgs = [...args, HELPER_PS]
      const child = spawn(exe, spawnArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
      if (this.epoch !== expectedEpoch) {
        try {
          child.kill()
        } catch {
          // ignore
        }
        return false
      }
      this.child = child
      this.rl = readline.createInterface({ input: child.stdout! })
      this.rl.on('line', (line) => this.onLine(line))
      child.stdin?.on('error', (err) => {
        console.warn('[PowerShellAstHelper] stdin error, failing closed:', err.message)
        this.onChildExit(child)
      })
      child.on('exit', (code, signal) => {
        if (!this.disposing && (code !== 0 || signal || this.queue.length > 0)) {
          console.warn(`[PowerShellAstHelper] Helper exited unexpectedly (code=${code}, signal=${signal}, pending=${this.queue.length})`)
        }
        this.onChildExit(child)
      })
      child.on('error', (err) => {
        console.warn('[PowerShellAstHelper] Child process error, failing closed:', err.message)
        this.onChildExit(child)
      })
      return true
    } catch (err) {
      console.warn('[PowerShellAstHelper] Failed to start AST helper, failing closed:', err instanceof Error ? err.message : String(err))
      this.child = null
      return false
    }
  }

  private onChildExit(exitedChild: ChildProcess): void {
    if (this.child !== exitedChild) return
    this.epoch++
    this.child = null
    this.rl = null
    // Fail every queued request — fail-closed, never hang.
    const pending = this.queue.splice(0)
    for (const item of pending) {
      clearTimeout(item.timer)
      item.resolve(null)
    }
    this.busy = false
  }

  private onLine(line: string): void {
    const idx = line.indexOf(SENTINEL)
    if (idx === -1) return
    const json = line.slice(idx + SENTINEL.length)
    if (json.length > MAX_AST_JSON_BYTES) {
      console.warn(`[PowerShellAstHelper] AST response exceeded ${MAX_AST_JSON_BYTES} bytes, failing closed`)
      this.finishCurrent(null)
      return
    }
    let payload: AstParseResult & { id?: number }
    try {
      payload = JSON.parse(json)
    } catch (err) {
      console.warn('[PowerShellAstHelper] Malformed AST JSON line, failing closed:', err instanceof Error ? err.message : String(err))
      this.finishCurrent(null)
      return
    }
    const current = this.queue[0]
    if (!current || payload.id !== current.id) {
      // Stale/foreign line — ignore, don't advance the queue.
      return
    }
    const status: AstParseResult['status'] =
      payload.status === 'parse-error'
        ? 'parse-error'
        : payload.status === 'truncated'
          ? 'truncated'
          : 'ok'
    this.finishCurrent({
      status,
      nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
      errors: payload.errors
    })
  }

  private finishCurrent(result: AstParseResult | null): void {
    const current = this.queue.shift()
    if (!current) return
    clearTimeout(current.timer)
    current.resolve(result)
    this.busy = false
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.busy || this.queue.length === 0) return
    this.busy = true
    const myEpoch = this.epoch
    const ok = await this.ensureChild(myEpoch)
    if (!ok || this.epoch !== myEpoch || !this.child?.stdin?.writable) {
      this.busy = false
      const pending = this.queue.splice(0)
      for (const item of pending) {
        clearTimeout(item.timer)
        item.resolve(null)
      }
      return
    }
    const item = this.queue[0]
    if (!item) {
      this.busy = false
      return
    }
    try {
      this.child.stdin.write(JSON.stringify({ id: item.id, cmd: item.cmd }) + '\n')
    } catch {
      this.finishCurrent(null)
    }
  }

  /**
   * Parse one command into a flattened AST node list. Serial queue — head
   * timeout resolves `null` and releases the next request.
   */
  public async analyze(command: string): Promise<AstParseResult | null> {
    const timeoutMs = this.child && !this.child.killed ? REQUEST_TIMEOUT_MS : COLD_START_TIMEOUT_MS
    return new Promise((resolve) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((q) => q.id === id)
        if (idx === -1) return
        const isHead = idx === 0
        this.queue.splice(idx, 1)
        console.warn(`[PowerShellAstHelper] AST parse timed out after ${timeoutMs}ms (len=${command.length})`)
        resolve(null)
        if (isHead) {
          this.busy = false
          void this.pump()
        }
      }, timeoutMs)
      this.queue.push({ id, cmd: command, resolve, timer })
      void this.pump()
    })
  }

  public dispose(): void {
    this.disposing = true
    this.epoch++
    const pending = this.queue.splice(0)
    for (const item of pending) {
      clearTimeout(item.timer)
      item.resolve(null)
    }
    try {
      this.child?.kill()
    } catch {
      // Helper already exited — nothing to clean up.
    }
    this.child = null
    this.rl = null
    this.busy = false
  }
}

let cachedHelper: PowerShellAstHelper | null = null

/** Lazily shared helper so every analyzer call reuses one child process. */
export function getPowerShellAstHelper(resolveShell: () => Promise<{ exe: string; args: string[] }>): PowerShellAstHelper {
  if (!cachedHelper) cachedHelper = new PowerShellAstHelper(resolveShell)
  return cachedHelper
}

/** Dispose the cached helper only if one has already been created. */
export function disposePowerShellAstHelper(): void {
  cachedHelper?.dispose()
}
