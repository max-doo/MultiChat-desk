/**
 * UI Automation 选区读取助手（Windows）。
 *
 * 用一个常驻 PowerShell 子进程，通过 UIA 的 TextPattern 非侵入地读取
 * 前台焦点元素当前选中的文本——不发任何按键，避免 Ctrl+C 在终端里杀进程、
 * 在 Word 里抢迷你工具条等副作用。
 *
 * 行 JSON 协议：Node 向 stdin 写一行 `{"cmd":"readSelection"}`，
 * helper 在 stdout 回一行 `__UIA__{...}`（前缀用于过滤杂散输出）。
 *
 * 设计要点（来自 Plan 审查）：
 * - PS 5.1 下 `ConvertTo-Json -Compress` 不转义换行会断行 → 手工 JSON 转义。
 * - 中文 Windows 默认 GBK 输出 → 显式设 UTF-8。
 * - 用 `[Console]::Out.WriteLine` + Flush（`Write-Host` 在 PS 5.1 不进 stdout 管道）。
 * - stdin 关闭即 exit，避免僵尸；helper 死亡则下次读取懒重启。
 */

import { spawn, type ChildProcess } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as readline from 'readline'

export interface SelectionResult {
  text: string
  proc: string
  cls: string
  hasText: boolean
}

const SELECTION_CMD = '{"cmd":"readSelection"}'
const SENTINEL = '__UIA__'
const READ_TIMEOUT_MS = 1200 // Word 首次 TextPattern 可能较慢

// PowerShell 脚本本体。复用 diag-uia-selection.ps1 的读逻辑，包成请求循环。
// 关键：文本走 base64（UTF-8）传输，规避 PS 5.1 手工 JSON 转义换行的坑，
// 也避免在 JS 模板字符串里写 PS 反引号转义（`` `r `` 会与 JS 模板定界符冲突）。
const HELPER_PS1 = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$textPat = [System.Windows.Automation.TextPattern]::Pattern

function Read-Selection {
  $text = ''
  $proc = ''
  $cls = ''
  $hasText = $false
  try {
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($el) {
      try { $cls = $el.Current.ClassName } catch {}
      try { $proc = (Get-Process -Id $el.Current.ProcessId).ProcessName } catch {}
      try {
        $sup = $el.GetSupportedPatterns() | Where-Object { $_.Id -eq $textPat.Id }
        if ($sup) {
          $hasText = $true
          $tp = $el.GetCurrentPattern($textPat) -as [System.Windows.Automation.TextPattern]
          if ($tp) {
            foreach ($r in $tp.GetSelection()) { $text += $r.GetText(-1) }
          }
        }
      } catch {}
    }
  } catch {}
  $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))
  $obj = @{ text = $b64; proc = $proc; cls = $cls; hasText = $hasText }
  $json = $obj | ConvertTo-Json -Compress
  [Console]::Out.WriteLine('${SENTINEL}' + $json)
  [Console]::Out.Flush()
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { exit 0 }
  if ($line.Trim() -eq '${SELECTION_CMD}') { Read-Selection }
}
`

let child: ChildProcess | null = null
let scriptPath: string | null = null
let rl: readline.Interface | null = null
let pending: ((res: SelectionResult | null) => void) | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
const queuedResolvers: Array<(res: SelectionResult | null) => void> = []

function clearPending(resolveWith: SelectionResult | null): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  const p = pending
  pending = null
  if (p) p(resolveWith)
}

function closeHelper(): void {
  const currentChild = child
  child = null

  if (rl) { try { rl.close() } catch { /* ignore */ } rl = null }
  if (currentChild) {
    try { currentChild.stdin?.end() } catch { /* ignore */ }
    try { currentChild.kill() } catch { /* ignore */ }
  }
  if (scriptPath) {
    try { unlinkSync(scriptPath) } catch { /* ignore */ }
    scriptPath = null
  }
}

function scheduleQueuePump(): void {
  setTimeout(() => pumpReadQueue(), 0)
}

function handleHelperFailure(failedChild: ChildProcess): void {
  // 重启旧 helper 时，旧进程稍后触发的 exit 不能清掉新 helper 的全局状态。
  if (child !== failedChild) return
  child = null
  if (rl) { try { rl.close() } catch { /* ignore */ } rl = null }
  if (scriptPath) {
    try { unlinkSync(scriptPath) } catch { /* ignore */ }
    scriptPath = null
  }
  clearPending(null)
  scheduleQueuePump()
}

export function startUiaHelper(): void {
  if (child) return
  try {
    scriptPath = join(tmpdir(), `multichat-uia-${process.pid}.ps1`)
    writeFileSync(scriptPath, HELPER_PS1, 'utf8')
    const spawnedChild = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    child = spawnedChild
    spawnedChild.on('exit', () => {
      // helper 意外退出：清状态，自动继续处理排队的读取请求
      handleHelperFailure(spawnedChild)
    })
    spawnedChild.on('error', (err) => {
      console.error('[UIA] helper spawn error:', err.message)
      handleHelperFailure(spawnedChild)
    })
    if (spawnedChild.stdout) {
      spawnedChild.stdout.setEncoding('utf8')
      rl = readline.createInterface({ input: spawnedChild.stdout })
      rl.on('line', (line: string) => {
        if (!line.startsWith(SENTINEL)) return
        try {
          // text 字段为 base64(UTF-8)，解码回原文
          const raw = JSON.parse(line.slice(SENTINEL.length)) as {
            text: string
            proc: string
            cls: string
            hasText: boolean
          }
          const res: SelectionResult = {
            text: Buffer.from(raw.text, 'base64').toString('utf8'),
            proc: raw.proc,
            cls: raw.cls,
            hasText: raw.hasText
          }
          clearPending(res)
        } catch {
          // 解析失败视为本条无结果
          clearPending(null)
        }
      })
    }
    console.log('[UIA] helper started')
  } catch (err) {
    console.error('[UIA] helper start failed:', err)
    child = null
    if (scriptPath) {
      try { unlinkSync(scriptPath) } catch { /* ignore */ }
      scriptPath = null
    }
  }
}

function pumpReadQueue(): void {
  if (pending || queuedResolvers.length === 0) return

  if (!child) startUiaHelper()
  const stdin = child?.stdin
  if (!child || !stdin || stdin.destroyed || stdin.writableEnded) {
    if (child) closeHelper()
    const resolve = queuedResolvers.shift()
    resolve?.(null)
    if (queuedResolvers.length > 0) scheduleQueuePump()
    return
  }

  const resolve = queuedResolvers.shift()
  if (!resolve) return

  pending = resolve
  pendingTimer = setTimeout(() => {
    // 超时不能只清 pending：helper 可能卡在 UIA 调用中，继续复用会让
    // 后续响应错位，表现为应用长时间运行后永远读不到选区。
    clearPending(null)
    console.warn('[UIA] selection read timed out; restarting helper')
    closeHelper()
    pumpReadQueue()
  }, READ_TIMEOUT_MS)

  try {
    stdin.write(SELECTION_CMD + '\n')
  } catch (err) {
    console.error('[UIA] helper write failed:', err)
    clearPending(null)
    closeHelper()
    pumpReadQueue()
  }
}

export function stopUiaHelper(): void {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  clearPending(null)
  while (queuedResolvers.length > 0) queuedResolvers.shift()?.(null)
  closeHelper()
}

/**
 * 读取前台焦点元素当前选中文本。helper 协议仍是单槽，但 JS 侧会排队请求，
 * 避免按下/松手或滚轮触发时因已有请求而直接误判为无选区；helper 未运行时懒启动。
 */
export function readSelection(): Promise<SelectionResult | null> {
  return new Promise<SelectionResult | null>((resolve) => {
    queuedResolvers.push(resolve)
    pumpReadQueue()
  })
}
