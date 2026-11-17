# Submit a MultiChat agent task and poll until a terminal phase.
# Prints the final task view JSON (contains `reply` when phase=done) to stdout.
# The taskId is echoed to stderr as JSON immediately after submit, so a killed
# wait still leaves the task recoverable via `multichat task list --all`.
#
# Usage:
#   run_task.ps1 -Platform <id> [-Research] [-Timeout SEC] [-Poll SEC] [-Conversation URL]
#                [-IdempotencyKey KEY] [-Image FILE...] [-Query TEXT | -QueryFile FILE | stdin]
#
# Env:
#   MULTICHAT_CLI   CLI entrypoint override: either a single executable path
#                   ("C:\Program Files\MultiChat\cli\multichat.cmd") or a
#                   composite command ("node out\cli\index.js").
#                   Default: `multichat` on PATH, else resolved from the
#                   uninstall registry (DisplayIcon/UninstallString).
#                   Note: portable (zip) installs have no uninstall entry —
#                   set MULTICHAT_CLI explicitly there.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Platform,
  [switch]$Research,
  [ValidateRange(1, 7200)][int]$Timeout,
  [ValidateRange(1, 7200)][int]$Poll = 120,
  [string]$Conversation,
  [string]$IdempotencyKey,
  [string]$Query,
  [string]$QueryFile,
  [string[]]$Image
)
$ErrorActionPreference = 'Stop'

function Resolve-MultichatCli {
  if ($env:MULTICHAT_CLI) {
    if (Test-Path $env:MULTICHAT_CLI) { return @($env:MULTICHAT_CLI) }
    return @($env:MULTICHAT_CLI -split '\s+')
  }
  if (Get-Command multichat -ErrorAction SilentlyContinue) { return @('multichat') }
  # 已运行进程的 PATH 是父进程快照，装后新挂的 PATH 这里看不到 → 回退注册表定位安装目录
  $keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
          'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
          'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  # electron-builder 不写 InstallLocation，改用 DisplayIcon/UninstallString 反推安装目录
  $loc = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'MultiChat*' } |
    ForEach-Object {
      if ($_.DisplayIcon) { Split-Path (($_.DisplayIcon -split ',')[0].Trim('"')) }
      elseif ($_.UninstallString -match '^"([^"]+)"') { Split-Path $Matches[1] }
    } | Select-Object -First 1
  if ($loc) {
    $cmd = Join-Path $loc 'cli\multichat.cmd'
    if (Test-Path $cmd) { return @($cmd) }
  }
  # 便携版无 Uninstall 键，兜底用正在运行的 MultiChat.exe 路径反推
  $proc = Get-Process MultiChat -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc -and $proc.Path) {
    $cmd = Join-Path (Split-Path $proc.Path) 'cli\multichat.cmd'
    if (Test-Path $cmd) { return @($cmd) }
  }
  throw 'multichat CLI not found: not on PATH, no MultiChat uninstall entry, no running app; set MULTICHAT_CLI.'
}

# 必须 @(...) 保住数组形态：单元素返回值会被 PS 解包成标量，$x[0] 会取到首字符
$cliParts = @(Resolve-MultichatCli)
$cliCmd = $cliParts[0]
$cliPrefix = if ($cliParts.Count -gt 1) { $cliParts[1..($cliParts.Count - 1)] } else { @() }

function Invoke-Cli {
  # 所有调用都走 --query-file → 给子进程一个立刻 EOF 的空 stdin：
  # 否则宿主挂成不关闭管道的 stdin 会被 CLI 的 readStdinIfPiped 无条件读死。
  param([string[]]$CliArgs)
  return ('' | & $cliCmd @CliArgs 2>&1 | Out-String).Trim()
}

# -QueryFile/-Query/stdin 统一落临时文件走 --query-file，绕开 .cmd shim 的 %* 引号损耗。
# 显式参数优先于 stdin：显式给了 query 就不碰 stdin（ReadToEnd 对开放管道会永久阻塞）。
$tmpQuery = $null
try {
  if (-not $QueryFile) {
    $queryText = $Query
    if (-not $queryText -and [Console]::IsInputRedirected) {
      $stdinText = [Console]::In.ReadToEnd()
      if ($stdinText.Trim()) { $queryText = $stdinText }
    }
    if ($queryText) {
      $tmpQuery = Join-Path ([IO.Path]::GetTempPath()) ("multichat-query-{0}.txt" -f [guid]::NewGuid().ToString('N'))
      [IO.File]::WriteAllText($tmpQuery, $queryText, [Text.UTF8Encoding]::new($false))
      $QueryFile = $tmpQuery
    }
  }
  if (-not $QueryFile -and -not $Image) { throw 'missing query: pipe stdin, -QueryFile, -Query, or -Image' }

  # Phase 1: submit WITHOUT --wait — taskId 一次往返即回，先拿到手再阻塞；
  # 提交即被 harness 杀掉也能凭 stderr 里的 taskId 恢复任务。
  $submitArgs = @('task', 'submit', '--platform', $Platform)
  if ($QueryFile) { $submitArgs += @('--query-file', $QueryFile) }
  foreach ($img in $Image) { $submitArgs += @('--image', $img) }
  if ($Research) { $submitArgs += '--research' }
  if ($Timeout) { $submitArgs += @('--timeout', [string]$Timeout) }
  if ($Conversation) { $submitArgs += @('--conversation', $Conversation) }
  if ($IdempotencyKey) { $submitArgs += @('--idempotency-key', $IdempotencyKey) }

  $out = Invoke-Cli (@($cliPrefix) + $submitArgs)
  $res = $null
  try { $res = $out | ConvertFrom-Json } catch { }
  # 已安装的旧 .cmd shim 会吞掉退出码（endlocal 复位 ERRORLEVEL）——必须看 JSON 的 success
  if ($LASTEXITCODE -ne 0 -or ($res -and $res.success -eq $false) -or -not $res) {
    if ($out) { Write-Output $out } else { Write-Error 'multichat submit produced no output' }
    exit 1
  }
  $taskId = $res.data.taskId; $phase = $res.data.phase
  if ($taskId) { [Console]::Error.WriteLine(("{`"taskId`":`"{0}`",`"phase`":`"{1}`"}" -f $taskId, $phase)) }

  # Phase 2: status 长轮询直到终态；done/failed/cancelled 结束循环。
  while ($taskId -and $phase -notmatch '^(done|failed|cancelled)$') {
    $out = Invoke-Cli (@($cliPrefix) + @('task', 'status', $taskId, '--wait', [string]$Poll))
    try { $res = $out | ConvertFrom-Json } catch { $res = $null }
    if ($LASTEXITCODE -ne 0 -or ($res -and $res.success -eq $false) -or -not $res) {
      Write-Error "task status failed: $out"
      exit 1
    }
    $phase = $res.data.phase
  }

  Write-Output $out
} finally {
  if ($tmpQuery) { Remove-Item -LiteralPath $tmpQuery -Force -ErrorAction SilentlyContinue }
}
