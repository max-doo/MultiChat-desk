/**
 * 命令行工具（multichat）集成管理
 * - 查询 multichat shim 是否已加入用户 PATH（读注册表，进程 env 可能是旧值）
 * - 支持应用内一键补挂 PATH（保持 REG_EXPAND_SZ 并广播 WM_SETTINGCHANGE）
 * - 定位随包分发的 Agent Skill 目录
 * PATH 注册由安装包 build/installer.nsh 的复选框负责首装，卸载时自动移除；
 * 本模块只覆盖"未勾选/便携版手动补挂"与状态展示。
 */
import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import type Store from 'electron-store'
import type { CliIntegrationStatus } from '../shared/types/cli'

const execFileAsync = promisify(execFile)

const HINT_DISMISSED_KEY = 'cliAgentHintDismissed'

/** multichat shim 目录：仅打包版有实体文件（$INSTDIR\cli） */
function getCliDir(): string | null {
  if (process.platform !== 'win32' || !app.isPackaged) return null
  const dir = join(dirname(process.execPath), 'cli')
  return existsSync(dir) ? dir : null
}

function getCliCmdPath(cliDir: string | null): string | null {
  if (process.platform === 'win32') {
    if (cliDir) {
      const cmd = join(cliDir, 'multichat.cmd')
      if (existsSync(cmd)) return cmd
    }
    // dev 环境回退到仓库内的 CLI bundle
    const devBundle = join(app.getAppPath(), 'out', 'cli', 'index.js')
    return existsSync(devBundle) ? devBundle : null
  }
  if (process.platform === 'darwin' && app.isPackaged) {
    // multichat.sh 位于 MultiChat.app/Contents/，与 MacOS/ 同级
    const sh = join(dirname(process.execPath), '..', 'multichat.sh')
    return existsSync(sh) ? sh : null
  }
  return null
}

/** 随包分发的 Agent Skill 目录（extraResources → resources/skill/multichat-cli） */
function getSkillDir(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'skill', 'multichat-cli')]
    : [join(app.getAppPath(), '.agents', 'skills', 'multichat-cli')]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

/** 读取 HKCU\Environment 的 Path 原始值（REG_EXPAND_SZ 不展开） */
async function readUserPathValue(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { windowsHide: true })
    const match = stdout.match(/^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.*)$/m)
    return match ? match[1].trimEnd() : ''
  } catch {
    // Path 值不存在或 reg 查询失败
    return ''
  }
}

function pathContainsDir(pathValue: string, dir: string): boolean {
  return pathValue
    .split(';')
    .map(token => token.trim())
    .some(token => token.toLowerCase() === dir.toLowerCase())
}

export async function getCliStatus(store: Store<Record<string, unknown>>): Promise<CliIntegrationStatus> {
  const cliDir = getCliDir()
  const cliCmdPath = getCliCmdPath(cliDir)
  const supported = process.platform === 'win32' && app.isPackaged && cliDir !== null
  const onPath = supported && cliDir ? pathContainsDir(await readUserPathValue(), cliDir) : false
  return {
    supported,
    isPackaged: app.isPackaged,
    onPath,
    hintDismissed: store.get(HINT_DISMISSED_KEY, false) === true,
    cliDir,
    cliCmdPath,
    skillDir: getSkillDir()
  }
}

export function dismissCliHint(store: Store<Record<string, unknown>>): void {
  store.set(HINT_DISMISSED_KEY, true)
}

/**
 * 在数据目录（daemon.token 同目录）写 cli.json 入口指示文件。
 * Agent/脚本进程无需 PATH 或注册表即可一步定位 CLI 与 Skill 目录；覆盖安装版、便携版与 dev。
 */
export async function writeCliManifest(dataPath: string): Promise<void> {
  try {
    const manifest = {
      appVersion: app.getVersion(),
      cliCmdPath: getCliCmdPath(getCliDir()),
      cliDir: getCliDir(),
      skillDir: getSkillDir()
    }
    await writeFile(join(dataPath, 'cli.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  } catch (err) {
    console.warn('[CLI] 写入 cli.json 失败:', err)
  }
}

/**
 * 把 cliDir 追加到用户 PATH（HKCU\Environment）。
 * 通过 PowerShell 写入 RegistryValueKind.ExpandString 保住 REG_EXPAND_SZ，
 * 并用 SendMessageTimeout 广播 WM_SETTINGCHANGE 让后续新开的终端立即生效。
 */
export async function addCliDirToPath(): Promise<void> {
  const cliDir = getCliDir()
  if (!cliDir) throw new Error('仅 Windows 安装版/便携版支持自动加入 PATH')

  const script = [
    'param([Parameter(Mandatory=$true)][string]$Dir)',
    "$ErrorActionPreference = 'Stop'",
    "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    'if ($null -eq $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(\'Environment\') }',
    '$current = $key.GetValue(\'Path\', \'\', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)',
    '$tokens = @($current -split \';\' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne \'\' })',
    'if ($tokens -contains $Dir) { exit 0 }',
    '$new = ($tokens + $Dir) -join \';\'',
    '$key.SetValue(\'Path\', $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)',
    '$key.Close()',
    '$sig = \'[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd,uint Msg,System.UIntPtr wParam,string lParam,uint fuFlags,uint uTimeout,out System.UIntPtr lpdwResult);\'',
    '$t = Add-Type -Namespace CliPathBroadcast -Name Native -MemberDefinition $sig -PassThru',
    '$r = [System.UIntPtr]::Zero',
    '$t::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, \'Environment\', 2, 5000, [ref]$r) | Out-Null',
    'exit 0'
  ].join('\r\n')

  const tmpDir = await mkdtemp(join(tmpdir(), 'multichat-cli-path-'))
  const scriptPath = join(tmpDir, 'add-path.ps1')
  try {
    await writeFile(scriptPath, script, 'utf8')
    await execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Dir', cliDir],
      { windowsHide: true, timeout: 15000 }
    )
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 在文件管理器中定位 CLI 入口或 Skill 目录 */
export async function openCliLocation(target: 'cli' | 'skill'): Promise<void> {
  if (target === 'cli') {
    const cliDir = getCliDir()
    const cmdPath = getCliCmdPath(cliDir)
    if (cmdPath) {
      shell.showItemInFolder(cmdPath)
      return
    }
    throw new Error('未找到 multichat 入口文件')
  }
  const skillDir = getSkillDir()
  if (!skillDir) throw new Error('未找到 Agent Skill 目录')
  const err = await shell.openPath(skillDir)
  if (err) throw new Error(err)
}
