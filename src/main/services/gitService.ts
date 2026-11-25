/**
 * 工作区 Git 服务
 * - 直接调用系统 Git（不引入 Git 库）：知识库本身是普通仓库，交给用户已安装的 Git 处理最可靠
 * - 仅作用于工作区范围：状态、暂存与提交都以工作区为 pathspec，避免带上同仓库的其他目录
 * - 拉取默认只允许快进；分叉需要显式合并，冲突可整体撤销回操作前状态
 */

import { spawn } from 'child_process'
import path from 'path'
import { rename, stat } from 'fs/promises'
import { shell } from 'electron'
import { appendGitignorePatterns, DEFAULT_GITIGNORE_PATTERNS } from './gitignoreService'
import type {
  GitActionResult,
  GitBaselineResult,
  GitFileChange,
  GitHistoryItem,
  GitRemoteInfo,
  GitStatus
} from '../../shared/types/workbench'

const GIT_TIMEOUT_MS = 120_000
/** 文件树扫描只读取忽略状态，超时远短于网络类操作，避免 Git 异常时卡住界面 */
const IGNORED_PATHS_TIMEOUT_MS = 10_000
const MAX_CHANGED_FILES = 500
/** 超过此体积的未跟踪文件在提交前提示；GitHub 对单文件 50 MiB 开始警告 */
const LARGE_FILE_WARN_BYTES = 50 * 1024 * 1024
/** 大文件体积扫描的未跟踪文件上限，避免异常仓库拖慢状态刷新 */
const MAX_UNTRACKED_SCAN = 2000
/** 编辑器行内标记的基准内容上限：超过即熔断，不读入内存 */
const GIT_BASELINE_MAX_BYTES = 1024 * 1024

interface GitRunResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  spawnError: NodeJS.ErrnoException | null
}

interface GitRunBufferResult {
  ok: boolean
  code: number
  stdout: Buffer
  stderr: string
  spawnError: NodeJS.ErrnoException | null
}

/** 同一工作区的 Git 写操作串行执行，避免索引锁冲突 */
const queues = new Map<string, Promise<unknown>>()

function queueKey(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function serialize<T>(workspaceRoot: string, task: () => Promise<T>): Promise<T> {
  const key = queueKey(workspaceRoot)
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  const stored = next.catch(() => undefined)
  queues.set(key, stored)
  void stored.finally(() => {
    if (queues.get(key) === stored) queues.delete(key)
  })
  return next
}

function runGit(
  workspaceRoot: string,
  args: string[],
  input?: string,
  timeoutMs: number = GIT_TIMEOUT_MS
): Promise<GitRunResult> {
  return new Promise(resolve => {
    const child = spawn(
      'git',
      args,
      {
        cwd: workspaceRoot,
        windowsHide: true,
        env: {
          ...process.env,
          // 禁止 Git 弹出凭据输入对话框：没有凭据时立即失败，交由界面提示
          GIT_TERMINAL_PROMPT: '0',
          // 提交与拉取不进入交互式编辑器
          GIT_EDITOR: 'true',
          GIT_MERGE_AUTOEDIT: 'no'
        }
      }
    )

    let stdout = ''
    let stderr = ''
    let settled = false
    let spawnError: NodeJS.ErrnoException | null = null
    const timer = setTimeout(() => {
      // 超时（常见于网络阻塞）主动结束进程，避免界面一直停在“处理中”
      child.kill()
    }, timeoutMs)

    const finish = (code: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !spawnError,
        code,
        stdout,
        stderr,
        spawnError
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      // 状态输出可能很大，保留上限防止异常仓库拖垮内存
      if (stdout.length < 16 * 1024 * 1024) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4 * 1024 * 1024) stderr += chunk.toString('utf8')
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') spawnError = error
      finish(1)
    })
    child.on('close', (code: number | null) => {
      finish(code ?? 1)
    })

    if (input !== undefined) {
      child.stdin?.end(input, 'utf8')
    } else {
      child.stdin?.end()
    }
  })
}

/**
 * 与 runGit 相同的安全与超时约束，但以原始 Buffer 收集 stdout。
 * 二进制/大对象读取必须先聚合 Buffer 再统一解码，
 * 避免多字节 UTF-8 字符跨 chunk 被 toString 截断。
 */
function runGitBuffer(
  workspaceRoot: string,
  args: string[],
  timeoutMs: number = GIT_TIMEOUT_MS
): Promise<GitRunBufferResult> {
  return new Promise(resolve => {
    const child = spawn(
      'git',
      args,
      {
        cwd: workspaceRoot,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          GIT_MERGE_AUTOEDIT: 'no'
        }
      }
    )

    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false
    let spawnError: NodeJS.ErrnoException | null = null
    const timer = setTimeout(() => {
      child.kill()
    }, timeoutMs)

    const finish = (code: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !spawnError,
        code,
        stdout: Buffer.concat(chunks),
        stderr,
        spawnError
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 1024 * 1024) stderr += chunk.toString('utf8')
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') spawnError = error
      finish(1)
    })
    child.on('close', (code: number | null) => {
      finish(code ?? 1)
    })
    child.stdin?.end()
  })
}

/**
 * 读取工作区当前被 .gitignore 等规则忽略的路径，返回相对工作区的 POSIX 路径集合。
 * - 整个目录被忽略时折叠为 `dir/`；目录内仍有已跟踪文件时返回其中被忽略的具体文件
 * - 非 Git 仓库或 Git 不可用时返回 null，由调用方退回内置规则
 */
export async function listIgnoredPaths(workspaceRoot: string): Promise<Set<string> | null> {
  const result = await runGit(
    workspaceRoot,
    [
      '--no-optional-locks',
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
      '--',
      '.'
    ],
    undefined,
    IGNORED_PATHS_TIMEOUT_MS
  )
  // 非 Git 仓库时 git 直接报错，调用方退回内置规则
  if (!result.ok) return null

  const paths = new Set<string>()
  for (const record of result.stdout.split('\0')) {
    if (record) paths.add(normalizeGitPath(record))
  }
  return paths
}

function firstMeaningfulLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('hint:') && !line.startsWith('warning:'))
  return lines[0] ?? ''
}

/** Git 输出里可能带远程地址中的凭据，回显前统一去掉 */
function redactCredentials(text: string): string {
  return text.replace(/\/\/[^/@\s]+@/g, '//***@')
}

/** 远程地址回显前去掉 user:token@ 一类凭据 */
function redactRemoteUrl(url: string): string {
  // 只隐藏密码/令牌，保留用户名：ssh://git@host 的 git 不是秘密，
  // 全量脱敏会让常见 SSH 地址无法回填；而 ssh://user:pass@host 仍要隐藏密码。
  return url.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)([^/@]+)@/i,
    (match, scheme: string, userInfo: string) => {
      const colon = userInfo.indexOf(':')
      if (colon >= 0) return `${scheme}${userInfo.slice(0, colon)}:***@`
      return /^https?:\/\//i.test(scheme) ? `${scheme}***@` : match
    }
  )
}

/** 把 Git 的英文错误收敛成一句可执行的中文说明 */
function explainGitError(text: string): string {
  const raw = redactCredentials(firstMeaningfulLine(text))
  if (!raw) return 'Git 操作失败'
  if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)/i.test(text)) {
    return '远程仓库认证失败，请先在系统的 Git 凭据中登录该仓库'
  }
  if (/Could not resolve host|unable to access|Failed to connect|timed out/i.test(text)) {
    return '无法连接远程仓库，请检查网络或远程地址'
  }
  if (/no upstream branch|has no upstream branch|no tracking information/i.test(text)) {
    return '当前分支还没有关联远程分支'
  }
  if (/non-fast-forward|fetch first|Updates were rejected/i.test(text)) {
    return '远程已有新的提交，需要先拉取再推送'
  }
  if (/CONFLICT|Automatic merge failed/i.test(text)) {
    return '合并时出现冲突，已保留操作前状态，可撤销本次拉取'
  }
  if (/untracked working tree files would be overwritten|would be overwritten by merge/i.test(text)) {
    return '本地有未跟踪文件与远程改动同名，请先移动或提交这些文件'
  }
  if (/file size limit|exceeds.*(?:size|limit)|GH001|GH002/i.test(text)) {
    return '有文件超过托管平台的单文件上限，请移出仓库或改用 Git LFS'
  }
  if (/Please tell me who you are|unable to auto-detect email address/i.test(text)) {
    return '尚未配置 Git 用户名和邮箱，请先在系统 Git 中配置'
  }
  return raw
}

function normalizeGitPath(raw: string): string {
  return raw.split('\\').join('/')
}

interface RepoContext {
  repoRoot: string
  /** 工作区相对仓库根的路径，末尾带 /；工作区即仓库根时为空串 */
  prefix: string
}

async function resolveRepo(workspaceRoot: string): Promise<RepoContext | null> {
  const inside = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.stdout.trim() !== 'true') return null
  const [top, prefix] = await Promise.all([
    runGit(workspaceRoot, ['rev-parse', '--show-toplevel']),
    runGit(workspaceRoot, ['rev-parse', '--show-prefix'])
  ])
  if (!top.ok) return null
  return {
    repoRoot: normalizeGitPath(top.stdout.trim()),
    prefix: normalizeGitPath(prefix.stdout.trim())
  }
}

/** 读取远程地址；优先 origin，没有时按名称排序 */
export async function listRemotes(workspaceRoot: string): Promise<GitRemoteInfo[]> {
  return serialize(workspaceRoot, async () => {
    const repo = await resolveRepo(workspaceRoot)
    if (!repo) return []
    const names = await runGit(workspaceRoot, ['remote'])
    if (!names.ok) return []
    const remotes: GitRemoteInfo[] = []
    for (const name of names.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      const url = await runGit(workspaceRoot, ['remote', 'get-url', name])
      const rawUrl = url.ok ? url.stdout.trim() : ''
      const safeUrl = redactRemoteUrl(rawUrl)
      remotes.push({ name, url: safeUrl, redacted: rawUrl !== safeUrl })
    }
    return remotes.sort((a, b) =>
      a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : a.name.localeCompare(b.name)
    )
  })
}

/**
 * 配置远程地址。使用 set-url 而不是删除重加，保留已有 fetch refspec。
 * 地址只写入仓库的 .git/config；凭据交给系统 Git 凭据管理器。
 */
export async function setRemoteUrl(
  workspaceRoot: string,
  url: string,
  name = 'origin'
): Promise<GitActionResult> {
  return serialize(workspaceRoot, async () => {
    const repo = await resolveRepo(workspaceRoot)
    if (!repo) {
      return { success: false, failure: 'not-repository', error: '当前工作区还不是 Git 仓库' }
    }
    const remoteName = name.trim() || 'origin'
    if (!/^[A-Za-z0-9._-]+$/.test(remoteName)) {
      return { success: false, failure: 'failed', error: '远程名称只能包含字母、数字、点、下划线和短横线' }
    }
    const target = url.trim()
    if (!target) {
      return { success: false, failure: 'failed', error: '请填写远程地址' }
    }
    // 只接受常见协议与本地路径，避免把任意字符串当成 Git 可执行的传输方式
    const valid =
      /^https?:\/\/\S+$/i.test(target) ||
      /^(ssh|git|file):\/\/\S+$/i.test(target) ||
      /^[\w.-]+@[\w.-]+:\S+$/.test(target) ||
      path.isAbsolute(target)
    if (!valid) {
      return { success: false, failure: 'failed', error: '远程地址格式不受支持' }
    }

    const existing = await runGit(workspaceRoot, ['remote', 'get-url', remoteName])
    const args = existing.ok
      ? ['remote', 'set-url', remoteName, target]
      : ['remote', 'add', remoteName, target]
    const result = await runGit(workspaceRoot, args)
    if (!result.ok) {
      return { success: false, failure: 'failed', error: explainGitError(result.stderr || result.stdout) }
    }
    return { success: true }
  })
}

/** 工作区相对路径 → 仓库根相对路径（Git 索引与 ls-files 都以此为准） */
function toRepoPath(prefix: string, relativePath: string): string {
  const normalized = normalizeGitPath(relativePath).replace(/^\/+/, '')
  return prefix ? `${prefix}${normalized}` : normalized
}

/** 仓库根相对路径 → 工作区相对路径；不属于工作区时返回 null */
function toWorkspacePath(prefix: string, repoPath: string): string | null {
  const normalized = normalizeGitPath(repoPath)
  if (!prefix) return normalized
  if (!normalized.startsWith(prefix)) return null
  return normalized.slice(prefix.length)
}

interface IndexEntry {
  mode: string
  sha: string
  stage: string
  repoPath: string
}

async function readIndexEntries(repoRoot: string, repoPaths: string[]): Promise<IndexEntry[]> {
  if (!repoPaths.length) return []
  // 在仓库根执行：pathspec 天然是仓库相对路径，不受工作区子目录影响。
  // --literal-pathspecs 关闭通配符，避免 `[draft].md` 这类文件名匹配不到或误匹配；
  // 目录 pathspec 会匹配目录下全部条目，且目录已从磁盘移走时仍然有效。
  const result = await runGit(repoRoot, [
    '--literal-pathspecs',
    'ls-files',
    '-s',
    '-z',
    '--full-name',
    '--',
    ...repoPaths
  ])
  if (!result.ok || !result.stdout) return []
  const entries: IndexEntry[] = []
  for (const record of result.stdout.split('\0')) {
    if (!record) continue
    const tabIndex = record.indexOf('\t')
    if (tabIndex < 0) continue
    const [mode, sha, stage] = record.slice(0, tabIndex).split(' ')
    const repoPath = record.slice(tabIndex + 1)
    if (!mode || !sha || stage === undefined) continue
    entries.push({ mode, sha, stage, repoPath })
  }
  return entries
}

/**
 * 把一次移动的删除与新增作为一个整体写入暂存区。
 * 使用 update-index 直接搬用原 blob：只记录路径变化，不会把文件内容改动一起暂存。
 * 未跟踪 / 被忽略 / 位于未跟踪目录内的文件不会出现在 ls-files 结果里，自动跳过。
 */
async function stageMoves(
  workspaceRoot: string,
  moves: Array<{ oldRelativePath: string; newRelativePath: string }>
): Promise<{ staged: number; error?: string }> {
  const repo = await resolveRepo(workspaceRoot)
  if (!repo) return { staged: 0 }
  // 变基/合并进行中时索引属于中间状态，此时改索引会破坏可恢复性
  const gitDir = await runGit(workspaceRoot, ['rev-parse', '--absolute-git-dir'])
  if (gitDir.ok) {
    const dir = gitDir.stdout.trim()
    const inProgress =
      (await pathExists(path.join(dir, 'rebase-merge'))) ||
      (await pathExists(path.join(dir, 'rebase-apply'))) ||
      (await pathExists(path.join(dir, 'MERGE_HEAD')))
    if (inProgress) return { staged: 0 }
  }

  // 只处理无冲突的普通条目，冲突态交给用户先解决
  const cleanEntries: IndexEntry[] = []
  for (const move of moves) {
    const oldRepoPath = toRepoPath(repo.prefix, move.oldRelativePath)
    const entries = await readIndexEntries(repo.repoRoot, [oldRepoPath])
    for (const entry of entries) {
      if (entry.stage === '0' && !cleanEntries.some(item => item.repoPath === entry.repoPath)) {
        cleanEntries.push(entry)
      }
    }
  }
  if (!cleanEntries.length) return { staged: 0 }

  let payload = ''
  let staged = 0
  const zeroSha = '0'.repeat(40)
  for (const move of moves) {
    const oldRepoPath = toRepoPath(repo.prefix, move.oldRelativePath)
    const newRepoPath = toRepoPath(repo.prefix, move.newRelativePath)
    if (oldRepoPath === newRepoPath) continue

    // 文件移动只命中自身；目录移动需要把目录下所有已跟踪文件逐个映射到新前缀，
    // 否则 Git 仍会把目录内的文件看成删除 + 新增。
    const affected = cleanEntries.filter(entry =>
      entry.repoPath === oldRepoPath || entry.repoPath.startsWith(`${oldRepoPath}/`)
    )
    if (!affected.length) continue

    const planned = affected.map(entry => ({
      entry,
      nextPath: `${newRepoPath}${entry.repoPath.slice(oldRepoPath.length)}`
    }))
    // 目标位置已有索引条目时跳过，避免覆盖用户尚未提交的同名文件。
    // 目录 pathspec 同时覆盖目录下已有条目，一次查询即可，避免逐文件拼参数。
    const occupied = new Set(
      (await readIndexEntries(repo.repoRoot, [newRepoPath]))
        .map(entry => entry.repoPath)
    )

    for (const item of planned) {
      if (occupied.has(item.nextPath)) continue
      payload += `0 ${zeroSha}\t${item.entry.repoPath}\0`
      payload += `${item.entry.mode} ${item.entry.sha} ${item.entry.stage}\t${item.nextPath}\0`
      staged += 1
    }
  }
  if (!payload) return { staged: 0 }

  const applied = await runGit(workspaceRoot, ['update-index', '-z', '--index-info'], payload)
  if (!applied.ok) {
    return { staged: 0, error: explainGitError(applied.stderr || applied.stdout) }
  }
  return { staged }
}

/**
 * 文件树内移动/重命名后调用：把路径变化同步进 Git 暂存区。
 * 失败只记录日志，不影响用户已经完成的磁盘操作。
 */
export async function recordWorkspaceMove(
  workspaceRoot: string,
  moves: Array<{ oldRelativePath: string; newRelativePath: string }>
): Promise<void> {
  if (!moves.length) return
  try {
    await serialize(workspaceRoot, async () => {
      const result = await stageMoves(workspaceRoot, moves)
      if (result.error) {
        console.warn('[Git] 移动未写入暂存区:', result.error)
      }
    })
  } catch (error) {
    console.warn('[Git] 移动写入暂存区失败:', error)
  }
}

const CHANGE_CODE_MAP: Record<string, GitFileChange['staged']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange'
}

function mapChangeCode(code: string): GitFileChange['staged'] {
  return CHANGE_CODE_MAP[code] ?? null
}

function parsePorcelainV2(stdout: string, prefix: string): {
  changes: GitFileChange[]
  truncated: boolean
  untrackedPaths: string[]
  changeCount: number
  blockingChangeCount: number
  stagedCount: number
  unstagedCount: number
  conflictCount: number
} {
  const changes: GitFileChange[] = []
  const untrackedPaths: string[] = []
  let truncated = false
  let changeCount = 0
  let blockingChangeCount = 0
  let stagedCount = 0
  let unstagedCount = 0
  let conflictCount = 0
  const tokens = stdout.split('\0')

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) continue
    const kind = token[0]
    if (kind !== '1' && kind !== '2' && kind !== 'u' && kind !== '?') continue

    if (kind === '?') {
      const filePath = toWorkspacePath(prefix, token.slice(2))
      if (filePath) {
        // 大文件检查不能依赖展示列表：列表超过 500 项时仍要覆盖全部未跟踪文件
        if (untrackedPaths.length < MAX_UNTRACKED_SCAN) untrackedPaths.push(filePath)
        changeCount += 1
        unstagedCount += 1
        if (changes.length < MAX_CHANGED_FILES) {
          changes.push({ path: filePath, staged: null, unstaged: null, untracked: true, conflicted: false })
        } else {
          truncated = true
        }
      }
      continue
    }

    const fields = token.split(' ')
    if (kind === 'u') {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const filePath = toWorkspacePath(prefix, fields.slice(10).join(' '))
      if (filePath) {
        changeCount += 1
        blockingChangeCount += 1
        conflictCount += 1
        if (changes.length < MAX_CHANGED_FILES) {
          changes.push({
            path: filePath,
            staged: mapChangeCode(fields[1][0]),
            unstaged: fields[1][1] === 'M' ? 'modified' : fields[1][1] === 'D' ? 'deleted' : null,
            untracked: false,
            conflicted: true
          })
        } else {
          truncated = true
        }
      }
      continue
    }

    const xy = fields[1] ?? '..'
    const staged = mapChangeCode(xy[0])
    const unstagedCode = xy[1]
    const unstaged = unstagedCode === 'M' ? 'modified' : unstagedCode === 'D' ? 'deleted' : unstagedCode === 'T' ? 'typechange' : null

    if (kind === '2') {
      // 重命名条目后紧跟一个 NUL 分隔的原路径
      const newRepoPath = fields.slice(9).join(' ')
      const oldRepoPath = tokens[i + 1] ?? ''
      i += 1
      const newPath = toWorkspacePath(prefix, newRepoPath)
      if (!newPath) continue
      changeCount += 1
      blockingChangeCount += 1
      if (staged) stagedCount += 1
      if (unstaged) unstagedCount += 1
      if (changes.length < MAX_CHANGED_FILES) {
        changes.push({
          path: newPath,
          oldPath: toWorkspacePath(prefix, oldRepoPath) ?? undefined,
          staged,
          unstaged,
          untracked: false,
          conflicted: false
        })
      } else {
        truncated = true
      }
      continue
    }

    const filePath = toWorkspacePath(prefix, fields.slice(8).join(' '))
    if (!filePath) continue
    changeCount += 1
    blockingChangeCount += 1
    if (staged) stagedCount += 1
    if (unstaged) unstagedCount += 1
    if (changes.length < MAX_CHANGED_FILES) {
      changes.push({
        path: filePath,
        staged,
        unstaged,
        untracked: false,
        conflicted: false
      })
    } else {
      truncated = true
    }
  }

  return {
    changes,
    truncated,
    untrackedPaths,
    changeCount,
    blockingChangeCount,
    stagedCount,
    unstagedCount,
    conflictCount
  }
}

function parseBranchHeader(line: string, status: GitStatus): void {
  const value = line.slice('# '.length)
  const [key, ...rest] = value.split(' ')
  const payload = rest.join(' ')
  switch (key) {
    case 'branch.oid':
      status.unborn = payload === '(initial)'
      break
    case 'branch.head':
      if (payload === '(detached)') {
        status.detached = true
        status.branch = null
      } else {
        status.branch = payload
      }
      break
    case 'branch.upstream':
      status.upstream = payload
      break
    case 'branch.ab': {
      const match = payload.match(/\+(\d+)\s+-(\d+)/)
      if (match) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
      break
    }
  }
}

function emptyStatus(error: string | null, available: boolean, isRepository: boolean): GitStatus {
  return {
    error,
    available,
    isRepository,
    repoRoot: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    unborn: false,
    changeCount: 0,
    stagedCount: 0,
    unstagedCount: 0,
    conflictCount: 0,
    merging: false,
    rebasing: false,
    changes: [],
    changesTruncated: false,
    blockingChangeCount: 0,
    hasRemote: false,
    remoteName: null,
    largeUntracked: []
  }
}

/** 实际读取状态；调用方负责串行化，避免与写操作抢索引锁 */
async function readStatus(workspaceRoot: string): Promise<GitStatus> {
  if (!workspaceRoot) return emptyStatus('未打开工作区', false, false)

  const version = await runGit(workspaceRoot, ['--version'])
  if (version.spawnError) {
    return emptyStatus('未检测到 Git，可安装后使用版本管理', false, false)
  }

  const repo = await resolveRepo(workspaceRoot)
  if (!repo) return emptyStatus(null, true, false)

  const status = emptyStatus(null, true, true)
  status.repoRoot = repo.repoRoot

  const [raw, gitDir, remotes] = await Promise.all([
    // status 默认会顺手刷新并写回 .git/index；在递归监听工作区时会形成刷新循环。
    // 禁用可选锁后 status 只读，不会因为“看一眼状态”而改动索引。
    runGit(workspaceRoot, ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--', '.']),
    runGit(workspaceRoot, ['rev-parse', '--absolute-git-dir']),
    runGit(workspaceRoot, ['remote'])
  ])

  if (!raw.ok) {
    status.error = explainGitError(raw.stderr || raw.stdout)
    return status
  }

  for (const token of raw.stdout.split('\0')) {
    if (token.startsWith('# ')) parseBranchHeader(token, status)
  }
  const parsed = parsePorcelainV2(raw.stdout, repo.prefix)
  status.changes = parsed.changes
  status.changesTruncated = parsed.truncated
  status.changeCount = parsed.changeCount
  status.blockingChangeCount = parsed.blockingChangeCount
  status.stagedCount = parsed.stagedCount
  status.unstagedCount = parsed.unstagedCount
  status.conflictCount = parsed.conflictCount
  const remoteNames = remotes.ok
    ? remotes.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : []
  status.hasRemote = remoteNames.length > 0
  status.remoteName = remoteNames.includes('origin') ? 'origin' : remoteNames[0] ?? null

  if (gitDir.ok) {
    const dir = gitDir.stdout.trim()
    status.merging = await pathExists(path.join(dir, 'MERGE_HEAD'))
    status.rebasing =
      (await pathExists(path.join(dir, 'rebase-merge'))) ||
      (await pathExists(path.join(dir, 'rebase-apply')))
  }

  // 只检查未跟踪文件：已跟踪的大文件是历史遗留，提示也无法改变既成事实。
  // 使用独立收集的未跟踪路径，避免展示列表被截断时漏掉大文件。
  if (parsed.untrackedPaths.length) {
    const sizes = await Promise.all(
      parsed.untrackedPaths.map(async (relativePath) => {
        try {
          const info = await stat(path.join(repo.repoRoot, toRepoPath(repo.prefix, relativePath)))
          return { path: relativePath, size: info.size }
        } catch {
          return null
        }
      })
    )
    status.largeUntracked = sizes.filter(
      (item): item is { path: string; size: number } =>
        item !== null && item.size >= LARGE_FILE_WARN_BYTES
    )
  }

  return status
}

/**
 * 读取工作区 Git 状态；未安装 Git 或不是仓库时返回可展示的说明而不是抛错。
 * 走同一队列：Windows 上 Git 读索引时也会加锁，和提交/推送并发会互相失败。
 */
export async function getStatus(workspaceRoot: string): Promise<GitStatus> {
  return serialize(workspaceRoot, () => readStatus(workspaceRoot))
}

/**
 * 读取文件在 Git Index（`:0:<repoPath>`）中的基准内容。
 * 与 VSCode QuickDiffProvider 一致：未暂存时等价于 HEAD；
 * 工作台内移动文件后 recordWorkspaceMove 已把原 blob 写入新路径索引，
 * 因此查询新路径可自动延续历史。
 *
 * 熔断顺序：先 `ls-files -s` 拿 blobSha → `cat-file -s` 探大小（≤1MiB）→
 * `cat-file -p` 读原始字节 → 前 1024 字节 NUL 检测 → UTF-8 解码。
 * 冲突态（stage !== '0'）、未跟踪、unborn、非仓库均返回 none，不进入编辑器标记。
 */
/**
 * 校验工作区内相对路径，防范 .. 逃逸、NUL 字符与 .git 内部路径。
 * 返回归一化后的 POSIX 相对路径；非法时返回 null。
 */
function normalizeSafeWorkspaceRelativePath(relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null
  const normalized = normalizeGitPath(relativePath).replace(/^\/+/, '').replace(/\/+$/, '')
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..') ||
    normalized.split('/').includes('.git')
  ) {
    return null
  }
  return normalized
}

export async function getFileBaseline(
  workspaceRoot: string,
  relativePath: string
): Promise<GitBaselineResult> {
  if (!workspaceRoot || !relativePath) return { status: 'none' }
  return serialize(workspaceRoot, async () => {
    const version = await runGit(workspaceRoot, ['--version'])
    if (version.spawnError) return { status: 'none' }

    const repo = await resolveRepo(workspaceRoot)
    if (!repo) return { status: 'none' }

    const normalized = normalizeSafeWorkspaceRelativePath(relativePath)
    if (!normalized) return { status: 'none' }
    const repoPath = toRepoPath(repo.prefix, normalized)

    const entries = await readIndexEntries(repo.repoRoot, [repoPath])
    if (!entries.length) return { status: 'none' }
    // 存在 stage 1/2/3 条目说明处于合并冲突中间态，不画标记以免干扰解决
    if (entries.some(entry => entry.stage !== '0')) return { status: 'none' }
    const entry = entries.find(item => item.repoPath === repoPath) ?? entries[0]

    const sizeResult = await runGit(
      workspaceRoot,
      ['cat-file', '-s', entry.sha],
      undefined,
      IGNORED_PATHS_TIMEOUT_MS
    )
    if (!sizeResult.ok) {
      return { status: 'error', error: firstMeaningfulLine(sizeResult.stderr) || '读取基准对象大小失败' }
    }
    const byteLength = Number.parseInt(sizeResult.stdout.trim(), 10)
    if (!Number.isFinite(byteLength)) {
      return { status: 'error', error: '基准对象大小解析失败' }
    }
    if (byteLength > GIT_BASELINE_MAX_BYTES) {
      return { status: 'too-large', blobSha: entry.sha, byteLength }
    }

    const contentResult = await runGitBuffer(
      workspaceRoot,
      ['cat-file', '-p', entry.sha],
      GIT_TIMEOUT_MS
    )
    if (!contentResult.ok) {
      return { status: 'error', error: firstMeaningfulLine(contentResult.stderr) || '读取基准内容失败' }
    }
    const buffer = contentResult.stdout
    // 与 readFile 一致的二进制判定：前 1024 字节含 NUL 即视为非文本
    if (buffer.subarray(0, Math.min(1024, buffer.length)).includes(0)) {
      return { status: 'binary', blobSha: entry.sha, byteLength }
    }
    return {
      status: 'ok',
      blobSha: entry.sha,
      content: buffer.toString('utf8'),
      byteLength
    }
  })
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function blockedByState(status: GitStatus): GitActionResult | null {
  if (!status.available) {
    return { success: false, failure: 'not-installed', error: status.error ?? '未检测到 Git' }
  }
  if (!status.isRepository) {
    return { success: false, failure: 'not-repository', error: '当前工作区还不是 Git 仓库' }
  }
  if (status.rebasing) {
    return { success: false, failure: 'failed', error: '仓库正在进行变基，请先在终端完成或撤销' }
  }
  return null
}

/**
 * 只有已跟踪文件的改动会阻止拉取/合并。
 * 未跟踪文件通常不影响同步；若远程同名文件会覆盖它，Git 会自行拒绝并给出明确错误。
 */
function hasBlockingLocalChanges(status: GitStatus): boolean {
  return status.blockingChangeCount > 0
}

export interface CommitOptions {
  title: string
  /** 提交信息正文，可选 */
  body?: string
  /** 用户已确认要把超过建议体积的未跟踪文件一起提交 */
  allowLargeFiles?: boolean
}

/** 提交工作区内的全部改动；工作区是仓库子目录时不会带上仓库其他部分 */
export async function commit(workspaceRoot: string, options: CommitOptions): Promise<GitActionResult> {
  return serialize(workspaceRoot, async () => {
    const status = await readStatus(workspaceRoot)
    const blocked = blockedByState(status)
    if (blocked) return blocked
    if (!status.stagedCount && !status.unstagedCount && !status.conflictCount) {
      return { success: false, failure: 'failed', error: '没有需要提交的改动' }
    }
    // 合并冲突后用户可能已经手动解决并暂存，此时应当允许提交来结束合并；
    // 仍有未解决冲突时 Git 自己会拒绝，这里提前给出可读提示。
    if (status.conflictCount > 0) {
      return {
        success: false,
        failure: 'conflict',
        error: '还有未解决的冲突',
        hint: '解决冲突后再提交，或撤销本次合并'
      }
    }
    if (status.largeUntracked.length && !options.allowLargeFiles) {
      return {
        success: false,
        failure: 'large-files',
        error: `有 ${status.largeUntracked.length} 个未跟踪文件超过 50 MB`,
        hint: '先在工作区设置中忽略，或确认后一起提交'
      }
    }

    const title = options.title.trim()
    if (!title) return { success: false, failure: 'failed', error: '请填写提交标题' }

    const add = await runGit(workspaceRoot, ['add', '-A', '--', '.'])
    if (!add.ok) {
      return { success: false, failure: 'failed', error: explainGitError(add.stderr || add.stdout) }
    }

    const args = ['commit', '-m', title]
    const body = options.body?.trim()
    if (body) args.push('-m', body)
    args.push('--', '.')
    const result = await runGit(workspaceRoot, args)
    if (!result.ok) {
      return { success: false, failure: 'failed', error: explainGitError(result.stderr || result.stdout) }
    }
    return { success: true }
  })
}

/** 只允许快进：远程有新提交且本地无分叉时直接更新 */
export async function pullFastForward(workspaceRoot: string): Promise<GitActionResult> {
  return serialize(workspaceRoot, async () => {
    let status = await readStatus(workspaceRoot)
    let blocked = blockedByState(status)
    if (blocked) return blocked
    if (status.detached) {
      return { success: false, failure: 'detached', error: '当前不在任何分支上，无法拉取' }
    }
    if (status.merging) {
      return {
        success: false,
        failure: 'conflict',
        error: '还有未完成的合并',
        hint: '先撤销本次合并，或解决冲突后再拉取'
      }
    }
    if (!status.upstream) {
      return {
        success: false,
        failure: 'no-upstream',
        error: '当前分支还没有关联远程分支',
        hint: '先推送一次以关联远程分支'
      }
    }
    if (hasBlockingLocalChanges(status)) {
      return {
        success: false,
        failure: 'dirty',
        error: '还有未提交的改动',
        hint: '先提交这些改动，再拉取'
      }
    }

    // 先取回远程引用：本地缓存的 origin/<branch> 可能已过期，
    // 不 fetch 就判断 ahead/behind 会把“远程有新提交”误判成“已是最新”。
    const fetch = await runGit(workspaceRoot, ['fetch', '--prune'])
    if (!fetch.ok) {
      return { success: false, failure: 'failed', error: explainGitError(fetch.stderr || fetch.stdout) }
    }
    status = await readStatus(workspaceRoot)
    blocked = blockedByState(status)
    if (blocked) return blocked

    if (status.ahead > 0 && status.behind > 0) {
      return {
        success: false,
        failure: 'diverged',
        error: `本地领先 ${status.ahead} 个提交，远程领先 ${status.behind} 个提交`,
        hint: '两边都有新提交，需要合并后才能同步'
      }
    }
    if (status.behind === 0) {
      return {
        success: true,
        hint: status.ahead > 0 ? `远程没有新提交，本地有 ${status.ahead} 个提交待推送` : '已是最新'
      }
    }

    const result = await runGit(workspaceRoot, ['pull', '--ff-only', '--no-rebase'])
    if (!result.ok) {
      const text = result.stderr || result.stdout
      if (/Not possible to fast-forward|non-fast-forward/i.test(text)) {
        return {
          success: false,
          failure: 'diverged',
          error: '本地和远程都有新的提交',
          hint: '需要合并后才能同步'
        }
      }
      return { success: false, failure: 'failed', error: explainGitError(text) }
    }
    return { success: true }
  })
}

/** 分叉时显式合并远程改动；失败会中止合并，回到操作前状态 */
export async function mergeUpstream(workspaceRoot: string): Promise<GitActionResult> {
  return serialize(workspaceRoot, async () => {
    let status = await readStatus(workspaceRoot)
    let blocked = blockedByState(status)
    if (blocked) return blocked
    if (status.detached) {
      return { success: false, failure: 'detached', error: '当前不在任何分支上，无法合并' }
    }
    if (status.merging) {
      return {
        success: false,
        failure: 'conflict',
        error: '还有未完成的合并',
        hint: '先撤销本次合并，或解决冲突后再合并'
      }
    }
    if (!status.upstream) {
      return { success: false, failure: 'no-upstream', error: '当前分支还没有关联远程分支' }
    }
    if (hasBlockingLocalChanges(status)) {
      return {
        success: false,
        failure: 'dirty',
        error: '还有未提交的改动',
        hint: '先提交这些改动，再合并'
      }
    }

    // 与拉取一致：先取回远程引用，合并的才是远程最新提交
    const fetch = await runGit(workspaceRoot, ['fetch', '--prune'])
    if (!fetch.ok) {
      return { success: false, failure: 'failed', error: explainGitError(fetch.stderr || fetch.stdout) }
    }
    status = await readStatus(workspaceRoot)
    blocked = blockedByState(status)
    if (blocked) return blocked

    if (!status.upstream) {
      return { success: false, failure: 'no-upstream', error: '当前分支还没有关联远程分支' }
    }
    // 使用 --no-edit 且不加 --no-ff：能快进就快进，分叉时生成合并提交
    const result = await runGit(workspaceRoot, ['merge', '--no-edit', status.upstream])
    if (result.ok) return { success: true }

    const text = result.stderr || result.stdout
    // 合并可能根本没开始（例如未跟踪文件会被覆盖），这时没有可撤销的中间状态，
    // 不能笼统提示“已撤销”，否则用户会误以为文件已经回到原样。
    const after = await readStatus(workspaceRoot)
    if (!after.merging) {
      return {
        success: false,
        failure: 'failed',
        error: explainGitError(text),
        hint: '本地文件未被修改，请先处理提示中的文件后重试'
      }
    }
    const abort = await runGit(workspaceRoot, ['merge', '--abort'])
    if (!abort.ok) {
      console.warn('[Git] 合并中止失败:', abort.stderr || abort.stdout)
      return {
        success: false,
        failure: 'conflict',
        error: explainGitError(text),
        hint: '自动撤销未完成，请在终端检查仓库状态'
      }
    }
    return {
      success: false,
      failure: 'conflict',
      error: '合并时出现冲突',
      hint: '已撤销本次合并，工作区保持原样'
    }
  })
}

/** 撤销进行中的合并（pull/merge 冲突后），恢复操作前状态 */
export async function abortMerge(workspaceRoot: string): Promise<GitActionResult> {
  return serialize(workspaceRoot, async () => {
    const status = await readStatus(workspaceRoot)
    if (!status.isRepository) {
      return { success: false, failure: 'not-repository', error: '当前工作区还不是 Git 仓库' }
    }
    if (!status.merging) {
      return { success: false, failure: 'failed', error: '没有进行中的合并' }
    }
    const result = await runGit(workspaceRoot, ['merge', '--abort'])
    if (!result.ok) {
      return { success: false, failure: 'failed', error: explainGitError(result.stderr || result.stdout) }
    }
    return { success: true }
  })
}

/** 推送当前分支；首次推送需要界面先确认，再传入 setUpstream */
export async function push(workspaceRoot: string, setUpstream: boolean): Promise<GitActionResult> {
  return serialize(workspaceRoot, async () => {
    let status = await readStatus(workspaceRoot)
    let blocked = blockedByState(status)
    if (blocked) return blocked
    if (status.detached) {
      return { success: false, failure: 'detached', error: '当前不在任何分支上，无法推送' }
    }
    if (status.unborn) {
      return {
        success: false,
        failure: 'failed',
        error: '仓库还没有提交',
        hint: '先提交一次，再推送'
      }
    }
    if (status.merging) {
      return {
        success: false,
        failure: 'conflict',
        error: '还有未完成的合并',
        hint: '先完成或撤销合并，再推送'
      }
    }
    if (!status.hasRemote) {
      return { success: false, failure: 'no-upstream', error: '仓库还没有配置远程地址' }
    }
    // ahead 只反映本地缓存的远程引用；先 fetch 才能判断是否真的没有待推送内容，
    // 否则远程更新后这里会误报“已是最新”而实际 push 失败。
    const fetch = await runGit(workspaceRoot, ['fetch', '--prune'])
    if (!fetch.ok) {
      return { success: false, failure: 'failed', error: explainGitError(fetch.stderr || fetch.stdout) }
    }
    status = await readStatus(workspaceRoot)
    blocked = blockedByState(status)
    if (blocked) return blocked
    if (status.behind > 0) {
      return {
        success: false,
        failure: 'rejected',
        error: '远程已有新的提交',
        hint: '先拉取远程改动再推送'
      }
    }
    if (status.ahead === 0 && status.upstream) {
      return { success: true, hint: '没有需要推送的提交' }
    }
    // 没有上游时必须由界面确认后再推：直接 `git push` 在不同 push.default 下
    // 可能报错或推到意外分支，统一用 -u origin HEAD 建立跟踪关系。
    if (!status.upstream && !setUpstream) {
      return {
        success: false,
        failure: 'no-upstream',
        error: '当前分支还没有关联远程分支',
        hint: '首次推送会把当前分支发布到远程'
      }
    }

    const remoteName = status.remoteName ?? 'origin'
    const args = status.upstream ? ['push'] : ['push', '-u', remoteName, 'HEAD']
    const result = await runGit(workspaceRoot, args)
    if (result.ok) return { success: true }

    const text = result.stderr || result.stdout
    if (/non-fast-forward|fetch first|Updates were rejected/i.test(text)) {
      return {
        success: false,
        failure: 'rejected',
        error: '远程已有新的提交',
        hint: '先拉取远程改动再推送'
      }
    }
    return { success: false, failure: 'failed', error: explainGitError(text) }
  })
}

// ─── Git 历史记录 ───

const LOG_FIELD_SEPARATOR = '\x1f'
const LOG_RECORD_SEPARATOR = '\x1e'

function parseLogOutput(stdout: string, unpushedIds: Set<string>): GitHistoryItem[] {
  const commits: GitHistoryItem[] = []
  for (const record of stdout.split(LOG_RECORD_SEPARATOR)) {
    const raw = record.trim()
    if (!raw) continue
    const parts = raw.split(LOG_FIELD_SEPARATOR)
    if (parts.length < 7) continue
    const [id, shortId, parentsRaw, message, author, dateRaw, refsRaw] = parts
    const parentIds = parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : []
    const refs = refsRaw ? refsRaw.split(', ').map(ref => ref.trim()).filter(Boolean) : []
    commits.push({
      id,
      shortId,
      parentIds,
      message,
      author,
      date: parseInt(dateRaw || '0', 10),
      refs,
      pushed: !unpushedIds.has(id)
    })
  }
  return commits
}

/**
 * 读取 Git 提交历史；返回提交 DAG，泳道布局由渲染层计算。
 * 只读操作，不写索引，不走 serialize 队列。
 */
export async function getLog(workspaceRoot: string, limit = 50): Promise<GitHistoryItem[]> {
  if (!workspaceRoot) return []
  const version = await runGit(workspaceRoot, ['--version'])
  if (version.spawnError) return []
  const repo = await resolveRepo(workspaceRoot)
  if (!repo) return []
  const cappedLimit = String(Math.min(limit, 200))

  // 显示上限内的提交与“未进入远程跟踪分支”的提交用同一遍历顺序读取，
  // 只多执行一次本地 rev-list，避免为每个节点单独做可达性判断。
  const [result, unpushedResult] = await Promise.all([
    runGit(
      workspaceRoot,
      [
        '--no-optional-locks',
        '-c',
        'i18n.logOutputEncoding=UTF-8',
        'log',
        `--format=%H${LOG_FIELD_SEPARATOR}%h${LOG_FIELD_SEPARATOR}%P${LOG_FIELD_SEPARATOR}%s${LOG_FIELD_SEPARATOR}%an${LOG_FIELD_SEPARATOR}%at${LOG_FIELD_SEPARATOR}%D${LOG_RECORD_SEPARATOR}`,
        '--all',
        '--topo-order',
        '--decorate=short',
        '--color=never',
        '-n', cappedLimit
      ]
    ),
    runGit(workspaceRoot, [
      '--no-optional-locks',
      'rev-list',
      '--all',
      '--not',
      '--remotes',
      '--topo-order',
      '-n', cappedLimit
    ])
  ])
  if (!result.ok) return []
  const unpushedIds = new Set(
    unpushedResult.ok
      ? unpushedResult.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      : []
  )
  return parseLogOutput(result.stdout, unpushedIds)
}

/**
 * 仅用于首次把现有目录初始化为仓库；不自动提交、不自动配置远程。
 * 首次初始化时补一份常规忽略项，避免把压缩包、依赖目录直接纳入版本控制；
 * 只追加缺失规则，已有 .gitignore 不被覆盖。
 */
export async function initRepository(workspaceRoot: string): Promise<GitActionResult> {
  return serialize(workspaceRoot, async () => {
    const repo = await resolveRepo(workspaceRoot)
    if (repo) return { success: true }
    const result = await runGit(workspaceRoot, ['init'])
    if (!result.ok) {
      return { success: false, failure: 'failed', error: explainGitError(result.stderr || result.stdout) }
    }
    // 只在没有 .gitignore 时补默认规则；已有规则属于用户配置，不在初始化时擅自追加
    let hasGitignore = false
    try {
      await stat(path.join(workspaceRoot, '.gitignore'))
      hasGitignore = true
    } catch {
      hasGitignore = false
    }
    if (!hasGitignore) {
      await appendGitignorePatterns(
        workspaceRoot,
        DEFAULT_GITIGNORE_PATTERNS,
        '# 本地缓存与开发依赖'
      ).catch(error => {
        console.warn('[Git] 初始化忽略规则失败:', error)
      })
    }
    return { success: true }
  })
}

async function hasHeadEntry(repoRoot: string, repoPath: string): Promise<boolean> {
  const res = await runGit(repoRoot, [
    '--literal-pathspecs',
    'ls-tree',
    '-z',
    '--full-name',
    'HEAD',
    '--',
    repoPath
  ])
  return res.ok && res.stdout.length > 0
}

/**
 * 撤回单个已跟踪文件的改动（M / D / T / R / C / A）：
 * - 对已在 HEAD 中的文件（M / D / T）：同时还原暂存区与工作区到 HEAD
 * - 对首次提交前或尚未进 HEAD 的新增暂存文件（A / unborn）：仅移出待提交列表，保留本地文件
 * - 对重命名（R）：在原位置未被占用时恢复原路径与 HEAD 内容，新路径若非 HEAD 文件则移入回收站
 * - 对复制（C）：仅取消新增路径的暂存，保留原路径
 */
export async function discardChange(
  workspaceRoot: string,
  payload: { path: string; oldPath?: string }
): Promise<GitActionResult> {
  const safePath = normalizeSafeWorkspaceRelativePath(payload.path)
  const safeOldPath = payload.oldPath ? normalizeSafeWorkspaceRelativePath(payload.oldPath) : null
  if (!safePath || (payload.oldPath !== undefined && !safeOldPath)) {
    return { success: false, failure: 'failed', error: '非法的相对路径' }
  }

  return serialize(workspaceRoot, async () => {
    const status = await readStatus(workspaceRoot)
    const blocked = blockedByState(status)
    if (blocked) return blocked
    if (status.merging) {
      return {
        success: false,
        failure: 'conflict',
        error: '当前有未完成的合并',
        hint: '请先撤销本次合并或解决冲突'
      }
    }

    const repo = await resolveRepo(workspaceRoot)
    if (!repo) {
      return { success: false, failure: 'not-repository', error: '当前工作区还不是 Git 仓库' }
    }

    const repoPath = toRepoPath(repo.prefix, safePath)
    const oldRepoPath = safeOldPath ? toRepoPath(repo.prefix, safeOldPath) : null

    // 仓库尚未有过任何提交：不存在 HEAD，只能把已暂存文件移出待提交列表，保留本地文件
    if (status.unborn) {
      const rmRes = await runGit(repo.repoRoot, [
        '--literal-pathspecs',
        'rm',
        '--cached',
        '--ignore-unmatch',
        '-f',
        '--quiet',
        '--',
        repoPath
      ])
      if (!rmRes.ok) {
        return { success: false, failure: 'failed', error: explainGitError(rmRes.stderr || rmRes.stdout) }
      }
      return { success: true, hint: '已移出待提交列表，本地文件已保留' }
    }

    // 处理重命名 / 复制条目
    if (oldRepoPath && oldRepoPath !== repoPath) {
      const oldIndexEntries = await readIndexEntries(repo.repoRoot, [oldRepoPath])
      const isCopy = oldIndexEntries.length > 0

      if (isCopy) {
        const newInHead = await hasHeadEntry(repo.repoRoot, repoPath)
        const res = newInHead
          ? await runGit(repo.repoRoot, ['--literal-pathspecs', 'checkout', 'HEAD', '--', repoPath])
          : await runGit(repo.repoRoot, ['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', repoPath])
        if (!res.ok) {
          return { success: false, failure: 'failed', error: explainGitError(res.stderr || res.stdout) }
        }
        return { success: true, hint: '已移出待提交列表，本地文件已保留' }
      }

      const isCaseOnlyWinRename =
        process.platform === 'win32' && oldRepoPath.toLowerCase() === repoPath.toLowerCase()
      const absOld = path.join(repo.repoRoot, oldRepoPath)
      const absNew = path.join(repo.repoRoot, repoPath)

      if (isCaseOnlyWinRename) {
        const resetRes = await runGit(repo.repoRoot, [
          '--literal-pathspecs',
          'reset',
          '-q',
          'HEAD',
          '--',
          oldRepoPath,
          repoPath
        ])
        if (!resetRes.ok) {
          return { success: false, failure: 'failed', error: explainGitError(resetRes.stderr || resetRes.stdout) }
        }
        if (await pathExists(absNew)) {
          await rename(absNew, absOld)
        }
        const checkoutRes = await runGit(repo.repoRoot, [
          '--literal-pathspecs',
          'checkout',
          'HEAD',
          '--',
          oldRepoPath
        ])
        if (!checkoutRes.ok) {
          return { success: false, failure: 'failed', error: explainGitError(checkoutRes.stderr || checkoutRes.stdout) }
        }
        return { success: true, hint: '已恢复原文件名与原内容' }
      }

      if (await pathExists(absOld)) {
        return {
          success: false,
          failure: 'failed',
          error: '原位置已有同名文件，无法直接恢复原位置'
        }
      }

      const newInHead = await hasHeadEntry(repo.repoRoot, repoPath)
      const resetRes = await runGit(repo.repoRoot, [
        '--literal-pathspecs',
        'reset',
        '-q',
        'HEAD',
        '--',
        oldRepoPath,
        repoPath
      ])
      if (!resetRes.ok) {
        return { success: false, failure: 'failed', error: explainGitError(resetRes.stderr || resetRes.stdout) }
      }

      if (newInHead) {
        const restoreNew = await runGit(repo.repoRoot, [
          '--literal-pathspecs',
          'checkout',
          'HEAD',
          '--',
          repoPath
        ])
        if (!restoreNew.ok) {
          return { success: false, failure: 'failed', error: explainGitError(restoreNew.stderr || restoreNew.stdout) }
        }
      } else if (await pathExists(absNew)) {
        await shell.trashItem(absNew)
      }

      const checkoutOld = await runGit(repo.repoRoot, [
        '--literal-pathspecs',
        'checkout',
        'HEAD',
        '--',
        oldRepoPath
      ])
      if (!checkoutOld.ok) {
        return { success: false, failure: 'failed', error: explainGitError(checkoutOld.stderr || checkoutOld.stdout) }
      }
      return { success: true, hint: '已恢复原位置与原内容' }
    }

    // 普通文件：检查是否存在于 HEAD 中
    const inHead = await hasHeadEntry(repo.repoRoot, repoPath)
    if (!inHead) {
      const resetRes = await runGit(repo.repoRoot, [
        '--literal-pathspecs',
        'reset',
        '-q',
        'HEAD',
        '--',
        repoPath
      ])
      if (!resetRes.ok) {
        return { success: false, failure: 'failed', error: explainGitError(resetRes.stderr || resetRes.stdout) }
      }
      return { success: true, hint: '已移出待提交列表，本地文件已保留' }
    }

    const existedBefore = await pathExists(path.join(repo.repoRoot, repoPath))
    const checkoutRes = await runGit(repo.repoRoot, [
      '--literal-pathspecs',
      'checkout',
      'HEAD',
      '--',
      repoPath
    ])
    if (!checkoutRes.ok) {
      return { success: false, failure: 'failed', error: explainGitError(checkoutRes.stderr || checkoutRes.stdout) }
    }
    return {
      success: true,
      hint: existedBefore ? '已还原到上次提交的版本' : '已恢复删除的文件'
    }
  })
}

/**
 * 回收站删除未跟踪或新增暂存文件后，清理未进入 HEAD 的暂存区条目，避免残留 AD 状态。
 */
export async function cleanupIndexAfterTrash(
  workspaceRoot: string,
  relativePath: string
): Promise<GitActionResult> {
  const safePath = normalizeSafeWorkspaceRelativePath(relativePath)
  if (!safePath) {
    return { success: false, failure: 'failed', error: '非法的相对路径' }
  }

  return serialize(workspaceRoot, async () => {
    const status = await readStatus(workspaceRoot)
    const blocked = blockedByState(status)
    if (blocked) return blocked

    const repo = await resolveRepo(workspaceRoot)
    if (!repo) {
      return { success: false, failure: 'not-repository', error: '当前工作区还不是 Git 仓库' }
    }

    const repoPath = toRepoPath(repo.prefix, safePath)
    if (status.unborn || !(await hasHeadEntry(repo.repoRoot, repoPath))) {
      const rmRes = await runGit(repo.repoRoot, [
        '--literal-pathspecs',
        'rm',
        '--cached',
        '--ignore-unmatch',
        '-f',
        '--quiet',
        '--',
        repoPath
      ])
      if (!rmRes.ok) {
        return { success: false, failure: 'failed', error: explainGitError(rmRes.stderr || rmRes.stdout) }
      }
    }
    return { success: true }
  })
}

/**
 * 将未跟踪文件或同扩展名规则追加到工作区 .gitignore。
 */
export async function ignorePath(
  workspaceRoot: string,
  target: { relativePath: string; mode: 'file' | 'extension' }
): Promise<GitActionResult> {
  const safePath = normalizeSafeWorkspaceRelativePath(target.relativePath)
  if (!safePath) {
    return { success: false, failure: 'failed', error: '非法的相对路径' }
  }
  if (safePath === '.gitignore') {
    return { success: false, failure: 'failed', error: '不能忽略 .gitignore 文件本身' }
  }

  return serialize(workspaceRoot, async () => {
    const status = await readStatus(workspaceRoot)
    const blocked = blockedByState(status)
    if (blocked) return blocked

    let pattern: string
    if (target.mode === 'extension') {
      const baseName = safePath.split('/').pop() ?? ''
      const dotIndex = baseName.lastIndexOf('.')
      if (dotIndex <= 0) {
        return { success: false, failure: 'failed', error: '该文件没有可用于批量忽略的扩展名' }
      }
      const ext = baseName.slice(dotIndex).replace(/([\\*?[\]])/g, '\\$1')
      pattern = `*${ext}`
    } else {
      const escaped = safePath.replace(/([\\*?[\]])/g, '\\$1')
      pattern = `/${escaped}`
    }

    const { added } = await appendGitignorePatterns(workspaceRoot, [pattern])
    return {
      success: true,
      hint: added.length ? `已将 ${pattern} 加入忽略规则` : `${pattern} 已在忽略规则中`
    }
  })
}

