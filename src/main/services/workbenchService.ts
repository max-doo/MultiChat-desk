
import { app, dialog, shell, BrowserWindow, nativeImage, clipboard } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type Store from 'electron-store'
import path from 'path'
import fs from 'fs'
import {
  realpath,
  stat,
  readdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdtemp,
  mkdir,
  cp,
  rm,
  rename,
  open
} from 'fs/promises'
import { randomUUID } from 'crypto'
import { isUtf8 } from 'buffer'
import { tmpdir } from 'os'
import iconv from 'iconv-lite'
import {
  type WorkbenchFileNode,
  type WorkbenchSearchResult,
  type WorkbenchFileInfo,
  type WorkbenchWriteResult,
  type WorkbenchSelectFolderResult,
  type WorkbenchNodeType,
  type WorkspaceTagInfo,
  type WorkspaceLinkEntry,
  type UnreferencedImageGroup,
  type WorkspaceUnreferencedImagesSummary,
  OFFICE_PREVIEW_MAX_BYTES,
  getFileCategory,
  MARKDOWN_EXTENSIONS,
  TEXT_EXTENSIONS,
  CODE_EXTENSIONS
} from '../../shared/types/workbench'
import {
  parseTagSearchQuery,
  matchTag,
  extractFrontmatterTags,
  extractInlineTags
} from '../../shared/utils/workbenchTags'
import { extractWikiLinkTargets } from '../../shared/utils/workbenchWikiLinks'
import { listIgnoredPaths, recordWorkspaceMove, invalidateRepoCache } from './gitService'
import {
  appendGitignorePatterns,
  createGitignoreMatcher,
  DEFAULT_GITIGNORE
} from './gitignoreService'
import type {
  DefaultWorkspaceInfo,
  WorkbenchWorkspaceSession
} from '../../shared/types/annotations'

// 应用与版本库内部目录：无论是否被 Git 忽略，都不参与文件树展示
const INTERNAL_DIR_NAMES = new Set(['.git', '.trash'])

const BLOCKED_IMPORT_NAMES = new Set(['.git', '.multichat', '.trash'])

const GIT_META_FILE_NAMES = new Set(['.gitignore', '.gitattributes', '.gitmodules'])

// 依赖与缓存目录：无论 .gitignore 是否覆盖，都不参与文件树与搜索
const ALWAYS_HIDDEN_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.DS_Store',
  'Thumbs.db',
  '$RECYCLE.BIN'
])

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function createScanLimiter(concurrency: number) {
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = (): Promise<void> => {
    if (active < concurrency) {
      active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => waiters.push(resolve))
  }
  const release = (): void => {
    const next = waiters.shift()
    if (next) next()
    else active--
  }
  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await task()
    } finally {
      release()
    }
  }
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff'
}

const ASSETS_DIR_NAME = 'assets'
const WINDOWS_RENAME_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000]

function isRetryableWindowsRenameError(error: unknown): boolean {
  if (process.platform !== 'win32') return false
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
}

/**
 * Windows 上目录重命名可能被编辑器、资源管理器预览或云盘同步短暂占用。
 * 对可恢复的占用错误做短重试；持续占用时交给调用方给出明确提示。
 */
async function renameWithRetry(oldPath: string, newPath: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt <= WINDOWS_RENAME_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await rename(oldPath, newPath)
      return
    } catch (error) {
      if (!isRetryableWindowsRenameError(error)) throw error
      lastError = error
      if (attempt === WINDOWS_RENAME_RETRY_DELAYS_MS.length) break
      await new Promise((resolve) => setTimeout(resolve, WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]))
    }
  }

  if ((lastError as NodeJS.ErrnoException | undefined)?.code === 'EBUSY') {
    throw new Error(
      `重命名失败：“${path.basename(newPath)}” 正被其他程序占用，请关闭正在使用该目录的程序后重试`
    )
  }
  throw lastError
}

/**
 * 为新工作区补一份常规 .gitignore。
 * 已存在则完全不动：用户可能已按自己的仓库结构维护过规则。
 */
async function ensureDefaultGitignore(workspaceRoot: string): Promise<void> {
  const target = path.join(workspaceRoot, '.gitignore')
  try {
    await stat(target)
    return
  } catch {
    // 不存在才创建
  }
  await fsWriteFile(target, DEFAULT_GITIGNORE, 'utf-8')
}

async function isDirectoryEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir)
    return entries.every(name => name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini')
  } catch {
    return false
  }
}

function formatPastedImageName(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `Pasted image ${date}-${time}`
}

const OFFICE_MIME_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  '.dot': 'application/msword',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  '.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  '.xlt': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  '.potx': 'application/vnd.openxmlformats-officedocument.presentationml.template',
  '.pot': 'application/vnd.ms-powerpoint',
  '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  '.pps': 'application/vnd.ms-powerpoint',
  '.odp': 'application/vnd.oasis.opendocument.presentation'
}

/**
 * 允许内嵌预览读取字节的 Office zip 容器格式（OOXML 家族）。
 * 老 OLE 二进制（.doc/.xls/.ppt 等）不是 zip，jszip/xlsx 解析链不开放，继续落卡片。
 */
const OFFICE_PREVIEW_EXTENSIONS = new Set(['.docx', '.xlsx', '.xlsm', '.xltx', '.pptx', '.pptm', '.ppsx'])

const SEARCHABLE_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...CODE_EXTENSIONS
])
const MAX_SEARCH_FILE_SIZE = 2 * 1024 * 1024
const MAX_SEARCH_RESULTS = 100
const MAX_SEARCH_TIME_MS = 1500

function toPosixRelativePath(rootPath: string, targetPath: string): string {
  const rel = path.relative(rootPath, targetPath)
  return rel.split(path.sep).join('/')
}

function hasControlCharacters(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code >= 0 && code <= 31) {
      return true
    }
  }
  return false
}

function isInternalPath(relativePosix: string): boolean {
  return INTERNAL_DIR_NAMES.has(relativePosix.split('/')[0])
}

function createEntryFilter(
  ignoredPaths: Set<string> | null,
  gitignoreMatcher?: (relativePosix: string, isDirectory: boolean) => boolean
) {
  return (relativePosix: string, name: string, isDirectory: boolean = false): boolean => {
    if (isInternalPath(relativePosix)) return true
    if (GIT_META_FILE_NAMES.has(name)) return true
    if (ALWAYS_HIDDEN_NAMES.has(name) || name.endsWith('.egg-info')) return true
    if (ignoredPaths) {
      return ignoredPaths.has(relativePosix) || ignoredPaths.has(`${relativePosix}/`)
    }
    if (gitignoreMatcher) {
      return gitignoreMatcher(relativePosix, isDirectory)
    }
    return false
  }
}

async function createWorkspaceFilter(safeRoot: string) {
  const ignoredPaths = await listIgnoredPaths(safeRoot)
  if (ignoredPaths) {
    return createEntryFilter(ignoredPaths)
  }
  const gitignoreMatcher = await createGitignoreMatcher(safeRoot)
  return createEntryFilter(null, gitignoreMatcher)
}

function isBlockedImportName(name: string): boolean {
  return (
    BLOCKED_IMPORT_NAMES.has(name) ||
    GIT_META_FILE_NAMES.has(name) ||
    ALWAYS_HIDDEN_NAMES.has(name) ||
    name.endsWith('.egg-info')
  )
}

export async function assertSafePath(workspaceRoot: string, relativePath: string = ''): Promise<string> {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') {
    throw new Error('非法的工作区根路径')
  }
  if (relativePath === undefined || relativePath === null || typeof relativePath !== 'string') {
    throw new Error('非法的相对路径')
  }

  const normalizedRoot = path.resolve(workspaceRoot)
  const targetPath = path.resolve(normalizedRoot, relativePath)

  const isWin = process.platform === 'win32'
  const rootCmp = isWin ? normalizedRoot.toLowerCase() : normalizedRoot
  const targetCmp = isWin ? targetPath.toLowerCase() : targetPath
  const sep = path.sep
  const rootPrefix = rootCmp.endsWith(sep) ? rootCmp : rootCmp + sep

  if (targetCmp !== rootCmp && !targetCmp.startsWith(rootPrefix)) {
    throw new Error('访问被拒绝：检测到逻辑路径越权 (Path Traversal Attempt)')
  }

  if (hasControlCharacters(targetPath)) {
    throw new Error('路径包含非法字符')
  }

  const realRoot = await realpath(normalizedRoot)
  const cmpRealRoot = isWin ? realRoot.toLowerCase() : realRoot
  const realRootPrefix = cmpRealRoot.endsWith(sep) ? cmpRealRoot : cmpRealRoot + sep

  try {
    const realTarget = await realpath(targetPath)
    const cmpRealTarget = isWin ? realTarget.toLowerCase() : realTarget
    if (cmpRealTarget !== cmpRealRoot && !cmpRealTarget.startsWith(realRootPrefix)) {
      throw new Error('访问被拒绝：检测到符号链接逃逸 (Symlink Escape Attempt)')
    }
    return realTarget
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      let currentDir = path.dirname(targetPath)
      while ((isWin ? currentDir.toLowerCase() : currentDir).startsWith(rootCmp)) {
        try {
          const realParent = await realpath(currentDir)
          const cmpRealParent = isWin ? realParent.toLowerCase() : realParent
          if (cmpRealParent !== cmpRealRoot && !cmpRealParent.startsWith(realRootPrefix)) {
            throw new Error('访问被拒绝：上级目录符号链接逃逸')
          }
          break
        } catch {
          const parent = path.dirname(currentDir)
          if (parent === currentDir) break
          currentDir = parent
        }
      }
      return targetPath
    }
    throw err
  }
}

// 目的：图片与 HTML 资源不再走 base64 dataUrl（4-5× 内存放大），
// 改为自定义协议流式回文件；PDF 另外通过受信 IPC Range 供 PDF.js 按需读取。
// 安全：只允许读取曾被 readFile/selectFolder 授权过的 workspace 根目录内的文件。

const authorizedWorkspaceRoots = new Set<string>()

export function authorizeWorkspaceRoot(workspaceRoot: string): void {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') return
  authorizedWorkspaceRoots.add(path.resolve(workspaceRoot))
}

export function isAuthorizedWorkspaceRoot(workspaceRoot: string): boolean {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') return false
  return authorizedWorkspaceRoots.has(path.resolve(workspaceRoot))
}

export const WORKBENCH_FILE_SCHEME = 'workbench-file'

/**
 * 把 workspace 内的绝对路径转成可加载的 workbench-file:// URL。
 * 约定：workbench-file://local/<encodeURIComponent 的各路径段，正斜杠分隔>
 * 路径放进 pathname 而非 query：HTML 预览中的相对路径资源（./style.css、<script src>）
 * 由 Chromium 按目录层级自然解析到同 workspace 内文件，仍然走白名单校验。
 */
export function toWorkbenchFileUrl(absolutePath: string): string {
  const normalized = path.resolve(absolutePath)
  const encoded = normalized
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${WORKBENCH_FILE_SCHEME}://local/${encoded}`
}

/**
 * 解析 workbench-file:// 请求并校验落在已授权工作区根目录内。
 * 命中返回真实绝对路径，否则返回 null。
 * 兼容旧格式 ?path=（早期 PDF 预览用 query 承载路径）。
 */
export async function resolveWorkbenchFileRequest(requestUrl: string): Promise<string | null> {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${WORKBENCH_FILE_SCHEME}:`) return null
    const encoded = url.searchParams.get('path')
    // 旧格式：query 承载完整绝对路径；新格式：pathname 各段 encodeURIComponent + 正斜杠。
    // Windows 盘符路径段首字符为 '/'（/D:/...），resolve 前需剥掉；POSIX 保留前导 '/'
    const pathname = decodeURIComponent(url.pathname)
    const normalizedPath =
      process.platform === 'win32' ? pathname.replace(/^\/+(?=[a-zA-Z]:)/, '') : pathname
    const targetPath = encoded ? path.resolve(encoded) : path.resolve(normalizedPath)

    const isWin = process.platform === 'win32'
    const targetCmp = isWin ? targetPath.toLowerCase() : targetPath

    for (const root of authorizedWorkspaceRoots) {
      const rootCmp = isWin ? root.toLowerCase() : root
      const sep = path.sep
      const rootPrefix = rootCmp.endsWith(sep) ? rootCmp : rootCmp + sep
      if (targetCmp === rootCmp || targetCmp.startsWith(rootPrefix)) {
        const rel = path.relative(root, targetPath)
        try {
          return await assertSafePath(root, rel)
        } catch {
          return null
        }
      }
    }
    return null
  } catch {
    return null
  }
}

// 行业通行做法（VS Code / chokidar）：单递归 watcher + 事件聚合去抖后整树重扫，
// 不做增量 patch —— rename 成对事件、目录递归事件顺序、ReadDirectoryChanges
// 缓冲溢出丢事件都会让增量模型漂移，去抖后重扫保证最终一致。

const WATCH_DEBOUNCE_MS = 350
// 应用自身写操作（create/rename/delete/write/import/saveImage）的抑制窗口：
// 自写事件先被标记，去抖期内的广播视为回声丢弃，避免保存时每 1.2s 触发整树重扫
const SELF_WRITE_WINDOW_MS = 800

interface WorkbenchWatcherState {
  watcher: fs.FSWatcher
  debounceTimer: NodeJS.Timeout | null
  selfWriteUntil: number
  changedPaths: Set<string>
  /** ReadDirectoryChanges 缓冲溢出（fileName 为 null）时置位：双链快照整表作废 */
  linksFullInvalidate: boolean
}

const workbenchWatchers = new Map<string, WorkbenchWatcherState>()

/**
 * 复制目标目录的串行锁：连续粘贴/创建副本是两个独立 IPC 调用，若并发执行，
 * 两次都会在对方 cp 落盘前查同一个 `-1` 空名，互相覆盖。按 `workspaceRoot+targetDir`
 * 串行化"查空名→落盘"临界区，保证每次都基于上一副本已存在的事实重新取名。
 */
const copyTargetLocks = new Map<string, Promise<unknown>>()

function lockCopyTarget(key: string): Promise<() => void> {
  const prev = copyTargetLocks.get(key) ?? Promise.resolve()
  let release: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  const tail = prev.catch(() => undefined).then(() => next)
  copyTargetLocks.set(key, tail)
  return prev.catch(() => undefined).then(() => () => {
    release()
    if (copyTargetLocks.get(key) === tail) copyTargetLocks.delete(key)
  })
}

function normalizeWatchKey(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * 判断 fs.watch 事件路径是否属于工作区高噪/隐藏目录：
 * 与 readTree 无条件隐藏规则对齐（.git、.trash、.multichat、依赖与虚拟环境目录等），
 * 保留 .gitignore 等配置文件变化以便及时刷新过滤结果。
 */
function isWatchIgnoredPath(relativeOrName: string): boolean {
  const normalized = relativeOrName.split('\\').join('/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return false
  const segments = normalized.split('/')
  const first = segments[0]
  if (INTERNAL_DIR_NAMES.has(first) || first === '.multichat') return true
  for (const segment of segments) {
    if (ALWAYS_HIDDEN_NAMES.has(segment) || segment.endsWith('.egg-info')) {
      return true
    }
  }
  return false
}

function broadcastFsChanged(resolvedRoot: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('workbench:fs-changed', { workspaceRoot: resolvedRoot })
    }
  }
}

export function watchWorkspace(workspaceRoot: string): void {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') return
  const key = normalizeWatchKey(workspaceRoot)
  if (workbenchWatchers.has(key)) return

  const resolvedRoot = path.resolve(workspaceRoot)
  // 打开工作区即授权导图类 IPC；watch 与 readTree 是渲染层打开工作区的必经动作。
  authorizeWorkspaceRoot(resolvedRoot)
  let watcher: fs.FSWatcher
  try {
    // recursive: Windows/macOS 原生递归；Linux (Electron ≥30, inotify) 亦支持。
    // 目录不存在或被删时 fs.watch 直接抛错，交给外层兜底
    watcher = fs.watch(resolvedRoot, { recursive: true, persistent: false }, (_eventType, fileName) => {
      // .git / .multichat / node_modules / .venv / __pycache__ 等内部或高噪目录不触发整树重扫与 Git 刷新
      if (fileName && isWatchIgnoredPath(String(fileName))) return
      const state = workbenchWatchers.get(key)
      if (!state) return
      if (fileName) {
        state.changedPaths.add(String(fileName).split('\\').join('/'))
      } else {
        // ReadDirectoryChanges 缓冲溢出时 fileName 为 null：事件细节丢失，
        // 双链快照无法按路径索引，保守整表作废退化为全量重扫
        state.linksFullInvalidate = true
      }
      if (state.debounceTimer) clearTimeout(state.debounceTimer)
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null
        // 双链快照与广播解耦：自写与外部改动都要落到索引，
        // 覆盖导图后台生成等不经过渲染层保存链路的写盘路径。
        const pendingPaths = [...state.changedPaths]
        state.changedPaths.clear()
        // 自写抑制判定在去抖回调触发时捕捉：索引耗时不应把自写回声放大成外部变更广播，
        // 否则每次保存都会触发一次整树重扫
        const suppressFsBroadcast = Date.now() < state.selfWriteUntil
        if (state.linksFullInvalidate) {
          state.linksFullInvalidate = false
          // 进队列删，避免在途扫描完成后把过期快照写回缓存
          void enqueueWorkspaceLinkScan(resolvedRoot, async () => {
            workspaceLinkCache.delete(normalizeWatchKey(resolvedRoot))
          })
        }
        if (pendingPaths.length > 0) {
          void enqueueWorkspaceLinkScan(resolvedRoot, () => updateWorkspaceLinkCachePaths(resolvedRoot, pendingPaths)).finally(() => {
            // 索引落盘后无条件通知一次双链快照：重命名/删除这类自写操作
            // 不会广播 fs-changed，渲染层靠这条消息消除过期快照，
            // 否则会残留重命名前的 path 键（幽灵反链/自引用误列）。
            const cache = workspaceLinkCache.get(normalizeWatchKey(resolvedRoot))
            if (cache) {
              const links = sortWorkspaceLinkEntries(cache)
              for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                  win.webContents.send('workbench:links-changed', { workspaceRoot: resolvedRoot, links })
                }
              }
            }
            // fs-changed 广播必须在索引落盘之后：渲染层收到后会立刻拉取快照，
            // 否则缓存更新还在途，拿到的是改动前的过期数据。
            if (!suppressFsBroadcast) broadcastFsChanged(resolvedRoot)
          })
          return
        }
        if (!suppressFsBroadcast) broadcastFsChanged(resolvedRoot)
      }, WATCH_DEBOUNCE_MS)
    })
  } catch {
    return
  }

  watcher.on('error', () => {
    unwatchWorkspace(resolvedRoot)
  })

  workbenchWatchers.set(key, { watcher, debounceTimer: null, selfWriteUntil: 0, changedPaths: new Set(), linksFullInvalidate: false })
}

export function unwatchWorkspace(workspaceRoot: string): void {
  const key = normalizeWatchKey(workspaceRoot)
  const state = workbenchWatchers.get(key)
  if (!state) return
  workbenchWatchers.delete(key)
  if (state.debounceTimer) clearTimeout(state.debounceTimer)
  try {
    state.watcher.close()
  } catch {
    // watcher 已关闭时忽略
  }
}

export function unwatchAllWorkspaces(): void {
  for (const state of workbenchWatchers.values()) {
    if (state.debounceTimer) clearTimeout(state.debounceTimer)
    try {
      state.watcher.close()
    } catch {
      // noop
    }
  }
  workbenchWatchers.clear()
}

/**
 * 标记工作区即将发生一次应用内写操作；窗口期内的 fs 事件视为自身回声，不广播。
 * 窗口取写操作开始的时刻，写操作随后立即落盘（原子 rename 或 rm），
 * 800ms 覆盖正常事件延迟；外部恰在同窗口的改动随下一次事件到达，仅延迟不显式刷新。
 */
export function markWorkspaceSelfWrite(workspaceRoot: string): void {
  const state = workbenchWatchers.get(normalizeWatchKey(workspaceRoot))
  if (state) {
    state.selfWriteUntil = Date.now() + SELF_WRITE_WINDOW_MS
  }
}

export async function selectFolder(browserWindow?: BrowserWindow | null): Promise<WorkbenchSelectFolderResult | null> {
  const win = browserWindow || BrowserWindow.getFocusedWindow() || null
  const options: Electron.OpenDialogOptions = {
    title: '选择工作区目录',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null
  }

  const selectedPath = path.resolve(result.filePaths[0])
  // 只给空目录补默认 .gitignore；已有内容的目录可能属于其他项目，不擅自新增文件
  if (await isDirectoryEmpty(selectedPath)) {
    await ensureDefaultGitignore(selectedPath).catch(() => undefined)
  }
  return {
    path: selectedPath,
    name: path.basename(selectedPath)
  }
}

const DEFAULT_WORKSPACE_STORE_KEY = 'workbench_defaultWorkspacePath'
const DEFAULT_WORKSPACE_DIR_NAME = 'MultiChat Vault'
const RECENT_WORKSPACES_STORE_KEY = 'workbench_recentWorkspaces'
const WELCOME_NOTE_NAME = '欢迎使用.md'
const WORKBENCH_LAST_WORKSPACE_KEY = 'workbench_lastWorkspacePath'
const WORKSPACE_SETTINGS_DIR = '.multichat'
const WORKSPACE_SETTINGS_FILE = 'settings.json'
const DEFAULT_CONVERSATION_DIR = 'conversations'

let activeWorkspaceRoot: string | null = null
let activeGeneration = 0
/** 工作区切换串行化：activate/close 都要跨 await 校验再落盘，不能并发交错。 */
let workspaceSwitchChain: Promise<unknown> = Promise.resolve()

function workspaceSwitchQueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = workspaceSwitchChain.then(operation, operation)
  workspaceSwitchChain = next.then(() => undefined, () => undefined)
  return next
}

const rootKey = (workspaceRoot: string): string => {
  const resolved = path.resolve(workspaceRoot)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function samePhysicalPath(a: string, b: string): Promise<boolean> {
  const [realA, realB] = await Promise.all([
    realpath(a).catch(() => path.resolve(a)),
    realpath(b).catch(() => path.resolve(b))
  ])
  return rootKey(realA) === rootKey(realB)
}

async function directoryWritable(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.multichat-write-probe-${randomUUID()}`)
  try {
    await fsWriteFile(probe, 'probe', 'utf-8')
    await rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

function canonicalDefaultWorkspacePath(): string {
  return path.resolve(app.getPath('documents'), DEFAULT_WORKSPACE_DIR_NAME)
}

export function getActiveWorkspaceRoot(): string | null {
  return activeWorkspaceRoot
}

export function getActiveGeneration(): number {
  return activeGeneration
}

export function assertActiveWorkspace(workspaceRoot: string): void {
  if (!activeWorkspaceRoot) throw new Error('工作台尚未激活工作区')
  if (rootKey(workspaceRoot) !== rootKey(activeWorkspaceRoot)) {
    throw new Error('只能操作当前活动工作区')
  }
}

async function ensureAnnotationGitignore(workspaceRoot: string): Promise<void> {
  await appendGitignorePatterns(
    workspaceRoot,
    ['.multichat/annotations/', '.multichat/frontmatter-backup/'],
    '# 应用生成物'
  )
    .catch(() => undefined)
}

export interface WorkspaceSettings {
  conversationDir: string
  warning?: string
}

function normalizeConversationDir(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!trimmed) return DEFAULT_CONVERSATION_DIR
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || path.isAbsolute(trimmed)) return null
  const segments = trimmed.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  // 任何层级的 .multichat/.git 都会把会话文档写进应用内部或版本库元数据，直接拒绝。
  if (segments.some(segment => segment === '.multichat' || segment === '.git')) return null
  return segments.join('/')
}

async function assertConversationDirSafe(workspaceRoot: string, relativeDir: string): Promise<void> {
  const safeRoot = path.resolve(workspaceRoot)
  const target = path.resolve(safeRoot, relativeDir)
  const rootPrefix = rootKey(safeRoot) + path.sep
  if (rootKey(target) !== rootKey(safeRoot) && !rootKey(target).startsWith(rootPrefix)) {
    throw new Error('会话目录必须位于工作区内')
  }
  try {
    const info = await stat(target)
    if (!info.isDirectory()) throw new Error('会话目录必须是文件夹')
    const real = await realpath(target)
    if (rootKey(real) !== rootKey(safeRoot) && !rootKey(real).startsWith(rootPrefix)) {
      throw new Error('会话目录不能通过符号链接逃逸工作区')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function getWorkspaceSettings(workspaceRoot: string): Promise<WorkspaceSettings> {
  const filePath = path.join(workspaceRoot, WORKSPACE_SETTINGS_DIR, WORKSPACE_SETTINGS_FILE)
  let raw: unknown
  try {
    raw = JSON.parse(await fsReadFile(filePath, 'utf-8'))
  } catch {
    return { conversationDir: DEFAULT_CONVERSATION_DIR }
  }
  const value = (raw as { conversationDir?: unknown } | null)?.conversationDir
  const normalized = normalizeConversationDir(value)
  if (!normalized) {
    return {
      conversationDir: DEFAULT_CONVERSATION_DIR,
      warning: '会话目录配置无效，已回落到 conversations/'
    }
  }
  try {
    await assertConversationDirSafe(workspaceRoot, normalized)
    return { conversationDir: normalized }
  } catch {
    return {
      conversationDir: DEFAULT_CONVERSATION_DIR,
      warning: '会话目录不可用，已回落到 conversations/'
    }
  }
}

export async function setWorkspaceSettings(
  workspaceRoot: string,
  settings: { conversationDir?: unknown }
): Promise<WorkspaceSettings> {
  const normalized = normalizeConversationDir(settings.conversationDir)
  if (!normalized) throw new Error('会话目录必须是工作区内相对路径')
  await assertConversationDirSafe(workspaceRoot, normalized)
  const dir = path.join(workspaceRoot, WORKSPACE_SETTINGS_DIR)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, WORKSPACE_SETTINGS_FILE)
  let existing: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await fsReadFile(filePath, 'utf-8'))
    if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>
  } catch {
    existing = {}
  }
  const next = { ...existing, conversationDir: normalized }
  const temporary = `${filePath}.${randomUUID()}.tmp`
  await fsWriteFile(temporary, JSON.stringify(next, null, 2), 'utf-8')
  await rename(temporary, filePath)
  await ensureAnnotationGitignore(workspaceRoot)
  return { conversationDir: normalized }
}

function buildWelcomeNoteContent(): string {
  return `---
title: 欢迎使用
---

# 欢迎使用 MultiChat 工作台

这是你的默认工作区，位于系统「文档」目录下的 \`${DEFAULT_WORKSPACE_DIR_NAME}\` 文件夹。

- **纯本地存储**：所有笔记都是普通 Markdown 文件，可以直接用其他编辑器（包括 Obsidian）打开。
- **零格式入侵**：不会在文件中写入隐藏字段或私有语法，随时可以把整个文件夹迁走。
- **兼容 Obsidian**：把这个文件夹作为 Obsidian Vault 打开即可无缝衔接。

你可以在这里记录 AI 对话、整理素材、维护长期知识库。
`
}

/**
 * 定位（必要时创建）默认工作区。
 * - 已存在时直接返回原路径，不重建、不覆盖用户文件。
 * - 首次创建时写入一份欢迎笔记。
 * - 已经初始化过、但目录被删除时不静默重建：会话库不可用必须让调用方明确报错，
 *   否则捕捉和迁移会把数据写进一个用户以为已经删除的新目录。
 */
let confirmedDefaultWorkspacePath: string | null = null

export async function ensureDefaultWorkspace(
  store: Store<Record<string, unknown>>
): Promise<WorkbenchSelectFolderResult> {
  const defaultPath = canonicalDefaultWorkspacePath()
  const stored = store.get(DEFAULT_WORKSPACE_STORE_KEY)
  if (confirmedDefaultWorkspacePath === defaultPath && stored === defaultPath) {
    const alive = await stat(defaultPath).then(
      info => info.isDirectory(),
      () => false
    )
    if (alive) {
      authorizeWorkspaceRoot(defaultPath)
      return { path: defaultPath, name: path.basename(defaultPath) }
    }
    confirmedDefaultWorkspacePath = null
    throw new Error('CONVERSATION_LIBRARY_UNAVAILABLE')
  }

  let initialized = typeof stored === 'string' && stored.length > 0
  if (typeof stored === 'string' && stored.length > 0 && !(await samePhysicalPath(stored, defaultPath))) {
    // 旧缓存只清理键，绝不删除旧目录内容。
    store.delete(DEFAULT_WORKSPACE_STORE_KEY)
    initialized = false
  }

  const existed = await stat(defaultPath).then(
    info => info.isDirectory(),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    }
  )
  if (!existed) {
    if (initialized) throw new Error('CONVERSATION_LIBRARY_UNAVAILABLE')
    await mkdir(defaultPath, { recursive: true })
  }

  const welcomePath = path.join(defaultPath, WELCOME_NOTE_NAME)
  try {
    await stat(welcomePath)
  } catch {
    await fsWriteFile(welcomePath, buildWelcomeNoteContent(), 'utf-8')
  }
  await ensureDefaultGitignore(defaultPath).catch(() => undefined)
  await ensureAnnotationGitignore(defaultPath)

  if (stored !== defaultPath) {
    store.set(DEFAULT_WORKSPACE_STORE_KEY, defaultPath)
  }
  confirmedDefaultWorkspacePath = defaultPath
  authorizeWorkspaceRoot(defaultPath)
  return { path: defaultPath, name: path.basename(defaultPath) }
}

export async function getDefaultWorkspaceInfo(
  store: Store<Record<string, unknown>>
): Promise<DefaultWorkspaceInfo> {
  const stored = store.get(DEFAULT_WORKSPACE_STORE_KEY)
  const legacyPath = typeof stored === 'string' && stored.length > 0 && !(await samePhysicalPath(stored, canonicalDefaultWorkspacePath()))
    ? stored
    : undefined
  const workspace = await ensureDefaultWorkspace(store)
  return {
    path: workspace.path,
    writable: await directoryWritable(workspace.path),
    legacyPath
  }
}

export async function activateWorkspace(
  store: Store<Record<string, unknown>>,
  workspaceRoot: string
): Promise<WorkbenchWorkspaceSession> {
  return workspaceSwitchQueue(async () => {
    const resolved = path.resolve(workspaceRoot)
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new Error('工作区路径不是文件夹')
    if (!(await directoryWritable(resolved))) throw new Error('工作区不可写')
    authorizeWorkspaceRoot(resolved)
    if (activeWorkspaceRoot) {
      unwatchWorkspace(activeWorkspaceRoot)
      invalidateRepoCache(activeWorkspaceRoot)
      clearWorkspaceTagCache(activeWorkspaceRoot)
      clearWorkspaceLinkCache(activeWorkspaceRoot)
    }
    invalidateRepoCache(resolved)
    activeWorkspaceRoot = resolved
    activeGeneration += 1
    store.set(WORKBENCH_LAST_WORKSPACE_KEY, resolved)
    watchWorkspace(resolved)
    await ensureAnnotationGitignore(resolved)
    return { activeWorkspaceRoot: resolved, generation: activeGeneration }
  })
}

export async function closeWorkspace(
  store: Store<Record<string, unknown>>,
  workspaceRoot: string,
  generation: number
): Promise<WorkbenchWorkspaceSession> {
  return workspaceSwitchQueue(async () => {
    if (!activeWorkspaceRoot) throw new Error('当前没有活动工作区')
    if (rootKey(workspaceRoot) !== rootKey(activeWorkspaceRoot)) throw new Error('只能关闭当前活动工作区')
    if (generation !== activeGeneration) throw new Error('工作区已切换，请刷新后重试')
    const defaultWorkspace = await ensureDefaultWorkspace(store)
    // await 期间可能已经有别的切换完成；落盘前再确认一次目标仍是同一个 root。
    if (!activeWorkspaceRoot || rootKey(workspaceRoot) !== rootKey(activeWorkspaceRoot) || generation !== activeGeneration) {
      throw new Error('工作区已切换，请刷新后重试')
    }
    if (rootKey(activeWorkspaceRoot) === rootKey(defaultWorkspace.path)) throw new Error('默认工作区不可关闭')
    if (!(await directoryWritable(defaultWorkspace.path))) throw new Error('默认工作区不可写，暂时无法关闭')
    const closingRoot = activeWorkspaceRoot
    unwatchWorkspace(closingRoot)
    invalidateRepoCache(closingRoot)
    clearWorkspaceTagCache(closingRoot)
    clearWorkspaceLinkCache(closingRoot)
    activeWorkspaceRoot = defaultWorkspace.path
    activeGeneration += 1
    store.set(WORKBENCH_LAST_WORKSPACE_KEY, defaultWorkspace.path)
    watchWorkspace(defaultWorkspace.path)
    await ensureAnnotationGitignore(defaultWorkspace.path)
    return { activeWorkspaceRoot: defaultWorkspace.path, generation: activeGeneration }
  })
}

export function readLastWorkspacePath(store: Store<Record<string, unknown>>): string | null {
  const value = store.get(WORKBENCH_LAST_WORKSPACE_KEY)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 用户已知的全部工作区根：默认库 + 最近工作区 + 当前打开的工作区。
 * 只读枚举，不创建目录、不触发 ensureDefaultWorkspace。
 */
export function listKnownWorkspaceRoots(store: Store<Record<string, unknown>>): string[] {
  const roots: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string' || !value.length) return
    const resolved = path.resolve(value)
    if (!roots.some(root => rootKey(root) === rootKey(resolved))) roots.push(resolved)
  }
  const storedDefault = store.get(DEFAULT_WORKSPACE_STORE_KEY)
  push(typeof storedDefault === 'string' && storedDefault.length ? storedDefault : canonicalDefaultWorkspacePath())
  const recents = store.get(RECENT_WORKSPACES_STORE_KEY)
  if (Array.isArray(recents)) recents.forEach(push)
  push(activeWorkspaceRoot)
  return roots
}

/**
 * 判断目标根是否属于用户已知工作区：默认库或历史工作区列表。
 * 跨工作区写入只面向用户主动选择/使用过的目录，避免任意路径被当作移动目标。
 */
export async function isKnownWorkspaceRoot(
  store: Store<Record<string, unknown>>,
  targetRoot: string
): Promise<boolean> {
  if (!targetRoot || typeof targetRoot !== 'string') return false
  const resolved = path.resolve(targetRoot)
  const key = normalizeWatchKey(resolved)
  // 只做路径比对：这里不能触发 ensureDefaultWorkspace，否则一次移动会创建默认库与欢迎笔记。
  const storedDefault = store.get(DEFAULT_WORKSPACE_STORE_KEY)
  if (typeof storedDefault === 'string' && storedDefault.length > 0 &&
    normalizeWatchKey(path.resolve(storedDefault)) === key) return true
  if (normalizeWatchKey(canonicalDefaultWorkspacePath()) === key) return true
  const recents = store.get(RECENT_WORKSPACES_STORE_KEY)
  if (!Array.isArray(recents)) return false
  return recents.some(item =>
    typeof item === 'string' && item.length > 0 && normalizeWatchKey(path.resolve(item)) === key)
}

/**
 * 递归扫描工作区文件树
 * - 只隐藏 Git/.gitignore 忽略的路径与 .git/.trash 内部目录；未被忽略的点号目录（如 .multichat/.agents/.claude）正常显示
 * - 文件夹在前，同级按自然语言顺序排序
 * - 安全跳过符号链接越界节点
 */
export async function readTree(workspaceRoot: string): Promise<WorkbenchFileNode[]> {
  const safeRoot = await assertSafePath(workspaceRoot, '')
  authorizeWorkspaceRoot(safeRoot)
  const isFiltered = await createWorkspaceFilter(safeRoot)
  const rootCmp = process.platform === 'win32' ? safeRoot.toLowerCase() : safeRoot
  const rootPrefix = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep

  // 目录扫描是纯 IO 等待，串行会让万级文件的工作区耗时到秒级；
  // 限流并发后既能把等待重叠起来，又不会一次打开过多句柄。
  const withScanSlot = createScanLimiter(24)

  async function resolveSymlink(fullPath: string): Promise<string | null> {
    const real = await realpath(fullPath).catch(() => null)
    if (!real) return null
    const cmp = process.platform === 'win32' ? real.toLowerCase() : real
    if (cmp !== rootCmp && !cmp.startsWith(rootPrefix)) return null
    return real
  }

  async function scanDirectory(
    currentDir: string,
    ancestors: ReadonlySet<string>
  ): Promise<WorkbenchFileNode[]> {
    const entries = await withScanSlot(
      () => readdir(currentDir, { withFileTypes: true })
    ).catch(() => {
      if (currentDir === safeRoot) throw new Error('工作区根目录不可读')
      return null
    })
    if (!entries) return []

    const scanned = await Promise.all(entries.map(async (entry): Promise<WorkbenchFileNode | null> => {
      const fullEntryPath = path.join(currentDir, entry.name)
      if (isFiltered(toPosixRelativePath(safeRoot, fullEntryPath), entry.name, entry.isDirectory())) return null

      try {
        // 只有符号链接可能指向工作区外，普通条目的路径必然落在根目录内，
        // 逐条 realpath 会放大成两次磁盘往返，是扫描慢的主因。
        const entryPath = entry.isSymbolicLink()
          ? await resolveSymlink(fullEntryPath)
          : fullEntryPath
        if (!entryPath) return null
        const relPosix = toPosixRelativePath(safeRoot, entryPath)
        // 链接指向被忽略的目标时同样隐藏，与按真实路径过滤的旧行为一致
        const entryStat = await withScanSlot(() => stat(entryPath))
        const isDirectory = entryStat.isDirectory()
        if (entry.isSymbolicLink() && isFiltered(relPosix, entry.name, isDirectory)) return null

        if (isDirectory) {
          // 软链接目录可能指回祖先，用祖先链检测环；普通目录路径唯一，无需去重
          const dirKey = process.platform === 'win32' ? entryPath.toLowerCase() : entryPath
          if (entry.isSymbolicLink() && ancestors.has(dirKey)) return null
          const nextAncestors = new Set(ancestors)
          nextAncestors.add(dirKey)
          const children = await scanDirectory(entryPath, nextAncestors)
          return {
            id: relPosix,
            name: entry.name,
            path: relPosix,
            fullPath: entryPath,
            isDirectory: true,
            mtime: entryStat.mtimeMs,
            children
          }
        }
        const ext = path.extname(entry.name).toLowerCase()
        const category = getFileCategory(entry.name)
        return {
          id: relPosix,
          name: entry.name,
          path: relPosix,
          fullPath: entryPath,
          isDirectory: false,
          extension: ext,
          category,
          size: entryStat.size,
          mtime: entryStat.mtimeMs
        }
      } catch {
        return null
      }
    }))

    const nodes = scanned.filter((node): node is WorkbenchFileNode => node !== null)

    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return NAME_COLLATOR.compare(a.name, b.name)
    })

    return nodes
  }

  return scanDirectory(safeRoot, new Set([rootCmp]))
}

export async function readFile(workspaceRoot: string, relativePath: string): Promise<WorkbenchFileInfo> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const fileStat = await stat(safePath)
  if (fileStat.isDirectory()) {
    throw new Error('目标是目录，无法作为文件读取')
  }

  const baseName = path.basename(safePath)
  const ext = path.extname(baseName).toLowerCase()
  const category = getFileCategory(baseName)

  authorizeWorkspaceRoot(workspaceRoot)

  if (category === 'image') {
    const mime = IMAGE_MIME_TYPES[ext] || 'image/png'
    if (fileStat.size > 20 * 1024 * 1024) {
      return {
        content: '',
        mimeType: mime,
        mtime: fileStat.mtimeMs,
        size: fileStat.size,
        category: 'image',
        isBinary: true,
        isOversized: true
      }
    }
    const buffer = ext === '.svg' ? await fsReadFile(safePath) : null
    return {
      content: buffer ? buffer.toString('utf-8') : '',
      fileUrl: toWorkbenchFileUrl(safePath),
      mimeType: mime,
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category: 'image',
      isBinary: true
    }
  }

  if (category === 'pdf') {
    if (fileStat.size > 200 * 1024 * 1024) {
      return {
        content: '',
        mimeType: 'application/pdf',
        mtime: fileStat.mtimeMs,
        size: fileStat.size,
        category: 'pdf',
        isBinary: true,
        isOversized: true
      }
    }
    return {
      content: '',
      mimeType: 'application/pdf',
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category: 'pdf',
      isBinary: true
    }
  }

  if (category === 'document') {
    return {
      content: '',
      mimeType: OFFICE_MIME_TYPES[ext] || 'application/octet-stream',
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category: 'document',
      isBinary: true,
      // 可内嵌预览的 Office zip 格式超过上限时提前标记，
      // 渲染层直接走卡片兜底，不再发起字节读取。
      isOversized: OFFICE_PREVIEW_EXTENSIONS.has(ext) && fileStat.size > OFFICE_PREVIEW_MAX_BYTES
    }
  }

  if (fileStat.size > 5 * 1024 * 1024) {
    return {
      content: '',
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category,
      isBinary: category === 'other',
      isOversized: true
    }
  }

  const buffer = await fsReadFile(safePath)
  const isBinary = buffer.subarray(0, Math.min(1024, buffer.length)).includes(0)

  if (isBinary && category === 'other') {
    return {
      content: '',
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category: 'other',
      isBinary: true
    }
  }

  const content = decodeTextBuffer(buffer, ext)
  return {
    content,
    fileUrl: ext === '.html' || ext === '.htm' ? toWorkbenchFileUrl(safePath) : undefined,
    mtime: fileStat.mtimeMs,
    size: fileStat.size,
    category,
    isBinary: false
  }
}

const PDF_RANGE_MAX_BYTES = 4 * 1024 * 1024

// GBK 回退只对 CSV/TSV 启用：这类文件在中文 Windows 上大量来自 Excel 导出的 ANSI(GBK) 编码，
// 不做检测就是大面积乱码。其余文本类型维持原 UTF-8 直读行为，避免误转码的风险面扩大。
const GBK_FALLBACK_EXTENSIONS = new Set(['.csv', '.tsv'])

/**
 * 文本解码：UTF-8/UTF-16 BOM 优先；无 BOM 的 csv/tsv 做 UTF-8 严格性检测，
 * 含非法 UTF-8 序列时按 GBK 解码（Excel 中文导出默认编码）。
 * 已知取舍：写回统一 UTF-8——读 GBK 编辑保存后文件编码转换，优于乱码下保存造成的内容损坏。
 */
function decodeTextBuffer(buffer: Buffer, ext: string): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf-8')
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer.subarray(2), 'utf16be')
  }
  if (GBK_FALLBACK_EXTENSIONS.has(ext) && buffer.length > 0) {
    if (!isUtf8(buffer)) {
      return iconv.decode(buffer, 'gbk')
    }
  }
  return buffer.toString('utf-8')
}

/**
 * 读取 Office（docx/xlsx/pptx 家族）原始字节供 renderer 内嵌渲染。
 * 走 IPC 二进制而不是 base64 dataUrl：避免字符串膨胀与多次拷贝，
 * 渲染完成后 renderer 即可释放这段 ArrayBuffer，不进入全局 store。
 */
export async function readOfficeBytes(
  workspaceRoot: string,
  relativePath: string
): Promise<{ bytes: Uint8Array; size: number; mtime: number }> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const fileStat = await stat(safePath)
  if (fileStat.isDirectory()) {
    throw new Error('目标是目录，无法作为文件读取')
  }
  if (!OFFICE_PREVIEW_EXTENSIONS.has(path.extname(safePath).toLowerCase())) {
    throw new Error('仅支持读取 OOXML 格式（.docx/.xlsx/.pptx 家族）文件')
  }
  if (fileStat.size > OFFICE_PREVIEW_MAX_BYTES) {
    throw new Error('文件超过 10MB 内嵌预览上限')
  }
  const buffer = await fsReadFile(safePath)
  return {
    bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length),
    size: fileStat.size,
    mtime: fileStat.mtimeMs
  }
}

/**
 * 按需读取 PDF 的一段字节，供 PDF.js 的 PDFDataRangeTransport 使用。
 * 只通过受信 IPC 返回小段数据，避免为了正常加载而把自定义协议暴露给 CORS/fetch。
 */
export async function readPdfRange(
  workspaceRoot: string,
  relativePath: string,
  start: number,
  end: number
): Promise<{ bytes: Uint8Array; size: number; mtime: number }> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const fileStat = await stat(safePath)
  if (fileStat.isDirectory()) {
    throw new Error('目标是目录，无法作为文件读取')
  }
  if (path.extname(safePath).toLowerCase() !== '.pdf') {
    throw new Error('仅支持读取 PDF 文件')
  }
  if (fileStat.size > 200 * 1024 * 1024) {
    throw new Error('PDF 文件超过 200MB 读取上限')
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new Error('PDF 读取范围无效')
  }
  const from = Math.max(0, start)
  const to = Math.min(fileStat.size - 1, end)
  if (from > to) {
    throw new Error('PDF 读取范围无效')
  }
  if (to - from + 1 > PDF_RANGE_MAX_BYTES) {
    throw new Error('PDF 单次读取范围超过 4MB')
  }

  const handle = await open(safePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(to - from + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, from + offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return {
      bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, offset),
      size: fileStat.size,
      mtime: fileStat.mtimeMs
    }
  } finally {
    await handle.close()
  }
}

/**
 * 轻量 stat：返回文件 mtime/size，不存在返回 null。
 * 供渲染层在保存前做乐观并发校验（磁盘 mtime 与 lastSavedAt 比对），
 * 比 readFile 便宜——不会为图片/PDF 附带 dataUrl 或读全文。
 */
export async function statFile(
  workspaceRoot: string,
  relativePath: string
): Promise<{ mtime: number; size: number } | null> {
  try {
    const safePath = await assertSafePath(workspaceRoot, relativePath)
    const fileStat = await stat(safePath)
    return { mtime: fileStat.mtimeMs, size: fileStat.size }
  } catch {
    return null
  }
}

export async function writeFile(
  workspaceRoot: string,
  relativePath: string,
  content: string
): Promise<WorkbenchWriteResult> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const category = getFileCategory(path.basename(safePath))
  if (category === 'image' || category === 'pdf' || category === 'document') {
    throw new Error(`安全保护：禁止将纯文本内容写入 ${category} 格式文件，防止损坏二进制文件`)
  }
  markWorkspaceSelfWrite(workspaceRoot)
  const parentDir = path.dirname(safePath)
  await mkdir(parentDir, { recursive: true })

  const tempFile = path.join(parentDir, `.${path.basename(safePath)}.${randomUUID()}.tmp`)
  try {
    await fsWriteFile(tempFile, content, 'utf-8')
    await rename(tempFile, safePath)
  } catch (err) {
    // Windows 平台可能在目标被短暂占用时失败，尝试直接写入兜底
    try {
      await fsWriteFile(safePath, content, 'utf-8')
    } catch {
      throw err
    }
  } finally {
    await rm(tempFile, { force: true }).catch(() => undefined)
  }

  const fileStat = await stat(safePath)
  return {
    mtime: fileStat.mtimeMs,
    size: fileStat.size
  }
}

export async function createNode(
  workspaceRoot: string,
  relativePath: string,
  type: WorkbenchNodeType
): Promise<WorkbenchFileNode> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)

  try {
    await stat(safePath)
    throw new Error(`目标已存在: ${relativePath}`)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  markWorkspaceSelfWrite(workspaceRoot)
  const relPosix = toPosixRelativePath(path.resolve(workspaceRoot), safePath)
  const baseName = path.basename(safePath)

  if (type === 'folder') {
    await mkdir(safePath, { recursive: true })
    const dirStat = await stat(safePath)
    return {
      id: relPosix,
      name: baseName,
      path: relPosix,
      fullPath: safePath,
      isDirectory: true,
      mtime: dirStat.mtimeMs,
      children: []
    }
  } else {
    const parentDir = path.dirname(safePath)
    await mkdir(parentDir, { recursive: true })
    await fsWriteFile(safePath, '', 'utf-8')
    const fileStat = await stat(safePath)
    return {
      id: relPosix,
      name: baseName,
      path: relPosix,
      fullPath: safePath,
      isDirectory: false,
      extension: path.extname(baseName).toLowerCase(),
      size: fileStat.size,
      mtime: fileStat.mtimeMs
    }
  }
}

/**
 * 重命名文件或目录
 * 联动：重命名/移动 .md 文档时，同步迁移其 assets/<文件名>/ 附件目录
 * 守卫：禁止直接对 assets/ 目录做单节点操作（防止误操作导致文档图片失效）
 */
export async function renameNode(
  workspaceRoot: string,
  oldRelativePath: string,
  newRelativePath: string
): Promise<void> {
  const safeOldPath = await assertSafePath(workspaceRoot, oldRelativePath)
  const safeNewPath = await assertSafePath(workspaceRoot, newRelativePath)

  if (safeOldPath === safeNewPath) {
    return
  }

  const oldRelPosix = oldRelativePath.split(path.sep).join('/')
  const oldPathSegments = oldRelPosix.split('/').filter(Boolean)
  if (oldPathSegments.includes(ASSETS_DIR_NAME)) {
    throw new Error(`附件目录 ${ASSETS_DIR_NAME}/ 受管，请通过文档操作联动`)
  }

  try {
    await stat(safeOldPath)
  } catch {
    throw new Error(`源文件或目录不存在: ${oldRelativePath}`)
  }

  try {
    await stat(safeNewPath)
    throw new Error(`目标路径已存在: ${newRelativePath}`)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  markWorkspaceSelfWrite(workspaceRoot)
  await mkdir(path.dirname(safeNewPath), { recursive: true })
  await renameWithRetry(safeOldPath, safeNewPath)

  const moves = [{
    oldRelativePath: toPosixRelativePath(path.resolve(workspaceRoot), safeOldPath),
    newRelativePath: toPosixRelativePath(path.resolve(workspaceRoot), safeNewPath)
  }]

  if (
    MARKDOWN_EXTENSIONS.has(path.extname(safeOldPath).toLowerCase()) &&
    MARKDOWN_EXTENSIONS.has(path.extname(safeNewPath).toLowerCase())
  ) {
    const movedAssets = await syncAssetsOnRename(safeOldPath, safeNewPath)
    if (movedAssets) {
      moves.push({
        oldRelativePath: toPosixRelativePath(path.resolve(workspaceRoot), movedAssets.oldPath),
        newRelativePath: toPosixRelativePath(path.resolve(workspaceRoot), movedAssets.newPath)
      })
    }
  }

  // 已跟踪文件的移动写入暂存区，避免在 Git 里呈现为删除 + 新增；
  // 未跟踪文件、未安装 Git 或不是仓库时静默跳过，不影响磁盘结果。
  await recordWorkspaceMove(workspaceRoot, moves)
}

/**
 * 文档重命名/移动时，迁移 assets/<文档名>/ 附件目录并重写文档内相对路径
 * - 附件目录无条件迁移（跨目录移动时目录名不变也要搬）
 * - 文档名变化且同目录时，重写 markdown 内 `assets/旧名/` → `assets/新名/`
 */
async function syncAssetsOnRename(
  safeOldPath: string,
  safeNewPath: string
): Promise<{ oldPath: string; newPath: string } | null> {
  const oldName = path.basename(safeOldPath)
  const newName = path.basename(safeNewPath)
  const oldAssetsDir = path.join(path.dirname(safeOldPath), ASSETS_DIR_NAME, oldName)
  const newAssetsDir = path.join(path.dirname(safeNewPath), ASSETS_DIR_NAME, newName)

  let movedAssets: { oldPath: string; newPath: string } | null = null
  if (oldAssetsDir !== newAssetsDir) {
    let oldExists = false
    try {
      await stat(oldAssetsDir)
      oldExists = true
    } catch { /* noop */ }

    if (oldExists) {
      let newExists = false
      try {
        await stat(newAssetsDir)
        newExists = true
      } catch { /* noop */ }

      if (!newExists) {
        try {
          await mkdir(path.dirname(newAssetsDir), { recursive: true })
          await rename(oldAssetsDir, newAssetsDir)
          movedAssets = { oldPath: oldAssetsDir, newPath: newAssetsDir }
        } catch {
          console.warn('[Workbench] 附件目录迁移失败:', oldAssetsDir, '->', newAssetsDir)
        }
      }
    }
  }

  if (oldName !== newName && path.dirname(safeOldPath) === path.dirname(safeNewPath)) {
    try {
      const content = await fsReadFile(safeNewPath, 'utf-8')
      const nextContent = content.split(`assets/${oldName}/`).join(`assets/${newName}/`)
      if (nextContent !== content) {
        await fsWriteFile(safeNewPath, nextContent, 'utf-8')
      }
    } catch {
      console.warn('[Workbench] 文档内容路径替换失败:', safeNewPath)
    }
  }

  return movedAssets
}

async function scanDocumentUnreferencedImages(
  normalizedRoot: string,
  safeDocPath: string,
  includeBytes: boolean,
  withScanSlot?: <T>(task: () => Promise<T>) => Promise<T>
): Promise<{ unreferenced: string[]; total: number; totalBytes: number }> {
  const runIO = withScanSlot ?? (<T>(task: () => Promise<T>): Promise<T> => task())
  const docDir = path.dirname(safeDocPath)
  const docBaseName = path.basename(safeDocPath)
  const assetsDir = path.join(docDir, ASSETS_DIR_NAME, docBaseName)

  let assetFiles: string[] = []
  try {
    const entries = await runIO(() => readdir(assetsDir, { withFileTypes: true }))
    assetFiles = entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return { unreferenced: [], total: 0, totalBytes: 0 } // 无 assets 目录
  }
  if (!assetFiles.length) return { unreferenced: [], total: 0, totalBytes: 0 }

  let content = ''
  try {
    content = await runIO(() => fsReadFile(safeDocPath, 'utf-8'))
  } catch {
    return { unreferenced: [], total: assetFiles.length, totalBytes: 0 } // 文档读不出，保守认为全未引用
  }

  const prefix = `assets/${docBaseName}/`
  const prefixEncoded = `assets/${encodeURIComponent(docBaseName)}/`
  const unreferenced: string[] = []
  let totalBytes = 0

  for (const name of assetFiles) {
    const encodedName = encodeURIComponent(name)
    const referenced =
      content.includes(prefix + name) ||
      content.includes(prefix + encodedName) ||
      content.includes(prefixEncoded + name) ||
      content.includes(prefixEncoded + encodedName)
    if (!referenced) {
      const fullAssetPath = path.join(assetsDir, name)
      unreferenced.push(toPosixRelativePath(normalizedRoot, fullAssetPath))
      if (includeBytes) {
        const assetStat = await runIO(() => stat(fullAssetPath)).catch(() => null)
        if (assetStat?.isFile()) totalBytes += assetStat.size
      }
    }
  }
  return { unreferenced, total: assetFiles.length, totalBytes }
}

export async function findUnreferencedImages(
  workspaceRoot: string,
  documentRelativePath: string
): Promise<{ unreferenced: string[]; total: number }> {
  const safeDocPath = await assertSafePath(workspaceRoot, documentRelativePath)
  const result = await scanDocumentUnreferencedImages(path.resolve(workspaceRoot), safeDocPath, false)
  return { unreferenced: result.unreferenced, total: result.total }
}

export async function findWorkspaceUnreferencedImages(
  workspaceRoot: string
): Promise<WorkspaceUnreferencedImagesSummary> {
  const safeRoot = await assertSafePath(workspaceRoot, '')
  const isFiltered = await createWorkspaceFilter(safeRoot)
  const rootCmp = process.platform === 'win32' ? safeRoot.toLowerCase() : safeRoot
  const rootPrefix = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep
  const withScanSlot = createScanLimiter(24)

  async function resolveSymlink(fullPath: string): Promise<string | null> {
    const real = await realpath(fullPath).catch(() => null)
    if (!real) return null
    const cmp = process.platform === 'win32' ? real.toLowerCase() : real
    if (cmp !== rootCmp && !cmp.startsWith(rootPrefix)) return null
    return real
  }

  let scannedDocuments = 0
  let totalAssets = 0
  let totalUnreferenced = 0
  let totalBytes = 0
  const groups: UnreferencedImageGroup[] = []

  async function walkDirectory(
    currentDir: string,
    ancestors: ReadonlySet<string>
  ): Promise<void> {
    const entries = await withScanSlot(() => readdir(currentDir, { withFileTypes: true })).catch(() => null)
    if (!entries) return

    const assetsEntry = entries.find((e) => e.name === ASSETS_DIR_NAME)
    if (assetsEntry) {
      const rawAssetsPath = path.join(currentDir, ASSETS_DIR_NAME)
      const resolvedAssetsPath = assetsEntry.isSymbolicLink()
        ? await resolveSymlink(rawAssetsPath)
        : rawAssetsPath
      if (resolvedAssetsPath) {
        const assetsStat = await withScanSlot(() => stat(resolvedAssetsPath)).catch(() => null)
        if (assetsStat?.isDirectory()) {
          const assetsSubEntries = await withScanSlot(() =>
            readdir(resolvedAssetsPath, { withFileTypes: true })
          ).catch(() => null)
          if (assetsSubEntries?.length) {
            const assetDocDirNames = new Set(
              assetsSubEntries.filter((e) => e.isDirectory()).map((e) => e.name)
            )
            const mdCandidates = entries.filter(
              (e) =>
                !e.isDirectory() &&
                MARKDOWN_EXTENSIONS.has(path.extname(e.name).toLowerCase()) &&
                assetDocDirNames.has(e.name)
            )
            await Promise.all(
              mdCandidates.map(async (mdEntry) => {
                const fullDocPath = path.join(currentDir, mdEntry.name)
                const relDocPosix = toPosixRelativePath(safeRoot, fullDocPath)
                if (isFiltered(relDocPosix, mdEntry.name, false)) return
                const resolvedDocPath = mdEntry.isSymbolicLink()
                  ? await resolveSymlink(fullDocPath)
                  : fullDocPath
                if (!resolvedDocPath) return
                const docStat = await withScanSlot(() => stat(resolvedDocPath)).catch(() => null)
                if (!docStat?.isFile()) return

                const res = await scanDocumentUnreferencedImages(
                  safeRoot,
                  resolvedDocPath,
                  true,
                  withScanSlot
                )
                if (res.total > 0) {
                  scannedDocuments += 1
                  totalAssets += res.total
                }
                if (res.unreferenced.length > 0) {
                  totalUnreferenced += res.unreferenced.length
                  totalBytes += res.totalBytes
                  groups.push({
                    documentPath: toPosixRelativePath(safeRoot, resolvedDocPath),
                    documentName: mdEntry.name,
                    unreferenced: res.unreferenced,
                    totalAssets: res.total,
                    totalBytes: res.totalBytes
                  })
                }
              })
            )
          }
        }
      }
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name === ASSETS_DIR_NAME) return
        if (!entry.isDirectory() && !entry.isSymbolicLink()) return
        const fullEntryPath = path.join(currentDir, entry.name)
        const relPosix = toPosixRelativePath(safeRoot, fullEntryPath)
        if (isFiltered(relPosix, entry.name, entry.isDirectory())) return

        const entryPath = entry.isSymbolicLink()
          ? await resolveSymlink(fullEntryPath)
          : fullEntryPath
        if (!entryPath) return
        const entryStat = await withScanSlot(() => stat(entryPath)).catch(() => null)
        if (!entryStat?.isDirectory()) return

        const resolvedRelPosix = toPosixRelativePath(safeRoot, entryPath)
        if (entry.isSymbolicLink() && isFiltered(resolvedRelPosix, entry.name, true)) return

        const dirKey = process.platform === 'win32' ? entryPath.toLowerCase() : entryPath
        if (entry.isSymbolicLink() && ancestors.has(dirKey)) return
        const nextAncestors = new Set(ancestors)
        nextAncestors.add(dirKey)
        await walkDirectory(entryPath, nextAncestors)
      })
    )
  }

  const rootKey = process.platform === 'win32' ? safeRoot.toLowerCase() : safeRoot
  await walkDirectory(safeRoot, new Set([rootKey]))

  groups.sort(
    (a, b) =>
      b.unreferenced.length - a.unreferenced.length ||
      b.totalBytes - a.totalBytes ||
      NAME_COLLATOR.compare(a.documentPath, b.documentPath)
  )

  return {
    scannedDocuments,
    totalAssets,
    totalUnreferenced,
    totalBytes,
    groups
  }
}

export async function deleteNodes(
  workspaceRoot: string,
  relativePaths: string[]
): Promise<{ deleted: string[]; failed: { path: string; error: string }[] }> {
  const deleted: string[] = []
  const failed: { path: string; error: string }[] = []
  if (!relativePaths.length) return { deleted, failed }
  // 父目录已选中时子项必然一并回收，去掉冗余目标避免重复调用 Shell
  const targets = relativePaths.filter(
    (relPath, index) => !relativePaths.some(
      (other, otherIndex) => otherIndex !== index && relPath.startsWith(`${other}/`)
    )
  )

  // 每个条目都要走一次 Shell 回收站调用，串行时几十项会明显拖长；
  // 并发上限取 6，避免同时打开过多 Shell 句柄拖慢整机。
  const DELETE_CONCURRENCY = 6
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const relPath = targets[cursor++]
      try {
        // 逐个续期，避免长批量删除期间 watcher 把自写事件当成外部改动广播
        markWorkspaceSelfWrite(workspaceRoot)
        await deleteNode(workspaceRoot, relPath)
        deleted.push(relPath)
      } catch (err) {
        failed.push({ path: relPath, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DELETE_CONCURRENCY, targets.length) }, () => worker())
  )
  return { deleted, failed }
}

/**
 * 将外部文件/文件夹复制进工作区（VSCode 风格的拖入 / 粘贴导入）
 * - 递归复制目录；重名自动追加 `-1`/`-2` 后缀，不覆盖既有节点
 * - 跳过应用内部目录与常见依赖/缓存目录；目标侧沿用 assertSafePath 校验
 * - 源路径在工作区内部时视为整目录复制（等价复制粘贴），不执行移动语义
 * 返回导入后的相对路径列表与逐项失败原因
 */
export async function importExternalPaths(
  workspaceRoot: string,
  targetDirRelative: string,
  sourceAbsolutePaths: string[]
): Promise<{ imported: string[]; failed: { path: string; error: string }[]; pairs: Array<{ source: string; target: string }> }> {
  const safeTargetDir = await assertSafePath(workspaceRoot, targetDirRelative)
  const normalizedRoot = path.resolve(workspaceRoot)
  // 复制是逐文件展开的批量写入，整段窗口抑制回声；
  // 复制过程可能较长，在每次 cp 前续期，保证覆盖到最后一笔
  markWorkspaceSelfWrite(workspaceRoot)
  const imported: string[] = []
  const failed: { path: string; error: string }[] = []
  // 工作区内源文件的「源相对路径 → 目标相对路径」配对，供导图绑定克隆使用。
  const pairs: Array<{ source: string; target: string }> = []

  const resolveFreeName = (baseName: string): Promise<string> => allocateFreeName(safeTargetDir, baseName)

  const copyFilter = (src: string): boolean => !isBlockedImportName(path.basename(src))

  // 临界区锁：按目标目录串行化"查空名→cp 落盘"，防止并发粘贴互相覆盖同名副本
  const release = await lockCopyTarget(safeTargetDir)
  try {
    for (const sourcePath of sourceAbsolutePaths) {
      try {
        if (!sourcePath || typeof sourcePath !== 'string' || hasControlCharacters(sourcePath)) {
          failed.push({ path: String(sourcePath), error: '非法的源路径' })
          continue
        }
        const resolvedSrc = path.resolve(sourcePath)
        const srcStat = await stat(resolvedSrc)
        const srcBase = path.basename(resolvedSrc)
        if (isBlockedImportName(srcBase)) {
          failed.push({ path: sourcePath, error: '已忽略的系统目录/文件' })
          continue
        }
        // 源在工作区内部且目标即其当前父目录 → 等价"原地粘贴"，允许复制为 -1 副本
        // 若源是目录且目标位于其内部 → 禁止（防自我包含）
        if (
          srcStat.isDirectory() &&
          (safeTargetDir === resolvedSrc || safeTargetDir.startsWith(resolvedSrc + path.sep))
        ) {
          failed.push({ path: sourcePath, error: '不能将文件夹复制到其自身内部' })
          continue
        }

        const freeName = await resolveFreeName(srcBase)
        const destPath = path.join(safeTargetDir, freeName)
        markWorkspaceSelfWrite(workspaceRoot)
        await cp(resolvedSrc, destPath, { recursive: true, filter: copyFilter })
        const targetRelative = toPosixRelativePath(normalizedRoot, destPath)
        imported.push(targetRelative)
        const sourceRelative = path.relative(normalizedRoot, resolvedSrc)
        if (!sourceRelative.startsWith('..') && !path.isAbsolute(sourceRelative)) {
          pairs.push({ source: toPosixRelativePath(normalizedRoot, resolvedSrc), target: targetRelative })
        }
      } catch (err) {
        failed.push({ path: sourcePath, error: err instanceof Error ? err.message : String(err) })
      }
    }
  } finally {
    release()
  }

  return { imported, failed, pairs }
}

/**
 * 把一个节点从源工作区移动到另一个工作区根目录（跨工作区移动）。
 * - 目标根不存在或不可写时直接失败，不产生半成品
 * - 同盘优先 rename，跨盘/rename 不可用时退回 cp + rm
 * - 重名自动追加 `-1`/`-2` 后缀，不覆盖目标工作区既有节点
 * - 附带 `assets/<文档名>/` 附件目录一起搬走，避免图片失效
 * 返回落盘后的目标相对路径与是否真正移动成功
 */
export async function moveNodeAcrossWorkspaces(
  sourceWorkspaceRoot: string,
  targetWorkspaceRoot: string,
  relativePath: string
): Promise<{ targetRelativePath: string }> {
  const sourceRoot = path.resolve(sourceWorkspaceRoot)
  const targetRoot = path.resolve(targetWorkspaceRoot)
  if (!sourceWorkspaceRoot || !targetWorkspaceRoot || !relativePath) {
    throw new Error('跨工作区移动参数无效')
  }
  if (normalizeWatchKey(sourceRoot) === normalizeWatchKey(targetRoot)) {
    throw new Error('目标工作区与当前工作区相同')
  }
  // 两个工作区互为父子目录时，移动会落进源工作区内部或反之，直接拒绝。
  const isInside = (child: string, parent: string): boolean => {
    const sep = path.sep
    const parentKey = normalizeWatchKey(parent.endsWith(sep) ? parent : parent + sep)
    return normalizeWatchKey(child.endsWith(sep) ? child : child + sep).startsWith(parentKey)
  }
  if (isInside(sourceRoot, targetRoot) || isInside(targetRoot, sourceRoot)) {
    throw new Error('两个工作区目录互相包含，无法跨工作区移动')
  }
  const targetInfo = await stat(targetRoot).catch(() => null)
  if (!targetInfo?.isDirectory()) throw new Error('目标工作区不存在')
  if (!(await directoryWritable(targetRoot))) throw new Error('目标工作区不可写')

  const safeSource = await assertSafePath(sourceRoot, relativePath)
  const sourceInfo = await stat(safeSource)
  if (sourceInfo.isDirectory()) {
    throw new Error('暂不支持跨工作区移动文件夹')
  }
  const sourceName = path.basename(safeSource)
  if (isBlockedImportName(sourceName)) {
    throw new Error('已忽略的系统目录/文件')
  }

  markWorkspaceSelfWrite(sourceRoot)
  markWorkspaceSelfWrite(targetRoot)

  const release = await lockCopyTarget(targetRoot)
  let destPath: string
  let destName: string
  try {
    destName = await allocateFreeName(targetRoot, sourceName)
    destPath = path.join(targetRoot, destName)
    await movePath(safeSource, destPath)
  } finally {
    release()
  }

  // 文档附件目录：与 renameNode 的联动一致，搬 assets/<文档名>/。
  if (MARKDOWN_EXTENSIONS.has(path.extname(safeSource).toLowerCase())) {
    const assetsName = path.basename(safeSource)
    const sourceAssets = path.join(path.dirname(safeSource), ASSETS_DIR_NAME, assetsName)
    const targetAssets = path.join(targetRoot, ASSETS_DIR_NAME, destName)
    const assetsInfo = await stat(sourceAssets).catch(() => null)
    if (assetsInfo?.isDirectory() && !(await stat(targetAssets).catch(() => null))) {
      try {
        await mkdir(path.dirname(targetAssets), { recursive: true })
        await movePath(sourceAssets, targetAssets)
      } catch (error) {
        console.warn('[Workbench] 跨工作区附件目录迁移失败:', sourceAssets, '->', targetAssets, error)
      }
    }
  }

  // 目标已有同名文件时名字会加 `-n` 后缀，正文里的 assets 引用要跟着改，否则图片失效。
  // HTML 等文本格式同样引用同目录 assets/，不限于 Markdown。
  if (destName !== sourceName && isTextAssetReference(destPath)) {
    try {
      const content = await fsReadFile(destPath, 'utf-8')
      const nextContent = content
        .split(`assets/${sourceName}/`).join(`assets/${destName}/`)
        .split(encodeURI(`assets/${sourceName}/`)).join(encodeURI(`assets/${destName}/`))
      if (nextContent !== content) await fsWriteFile(destPath, nextContent, 'utf-8')
    } catch (error) {
      console.warn('[Workbench] 跨工作区文档附件引用改写失败:', destPath, error)
    }
  }

  return { targetRelativePath: destName }
}

function isTextAssetReference(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return MARKDOWN_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(ext) || ['.html', '.htm'].includes(ext)
}

async function allocateFreeName(targetDir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName)
  const stem = ext ? baseName.slice(0, -ext.length) : baseName
  let candidate = baseName
  let counter = 1
  for (;;) {
    const exists = await stat(path.join(targetDir, candidate)).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      }
    )
    if (!exists) return candidate
    candidate = `${stem}-${counter}${ext}`
    counter++
  }
}

/**
 * 移动单个路径：同盘 rename 最快；跨盘 rename 会抛 EXDEV，退回复制后删除。
 * 复制先落临时名再改名，避免中途失败在目标侧留下半个文件。
 */
async function movePath(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
  }
  const temporary = `${targetPath}.${randomUUID()}.moving`
  try {
    // 移动语义必须内容完整：不带 isBlockedImportName 排除过滤（那是导入/复制的规则），
    // 否则 .git/node_modules 等被跳过而源被整体删除，数据直接丢失
    await cp(sourcePath, temporary, { recursive: true })
    await rename(temporary, targetPath)
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
  // 跨盘复制成功后源文件仍可能被占用；删不掉就回滚目标副本，避免同一文件在两处各留一份。
  try {
    await rm(sourcePath, { recursive: true, force: true })
  } catch (error) {
    await rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(
      `源文件无法删除（可能被其他程序占用），已取消移动：${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * 将文件或目录安全移入系统回收站 (Trash)
 * 联动：删除 .md 文档时，连带回收其 assets/<文件名>/ 附件目录，避免孤儿目录
 */
export async function deleteNode(workspaceRoot: string, relativePath: string): Promise<void> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)

  try {
    await stat(safePath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw err
  }

  markWorkspaceSelfWrite(workspaceRoot)
  await shell.trashItem(safePath)

  if (MARKDOWN_EXTENSIONS.has(path.extname(safePath).toLowerCase())) {
    const assetsDir = path.join(
      path.dirname(safePath),
      ASSETS_DIR_NAME,
      path.basename(safePath)
    )
    try {
      await stat(assetsDir)
      await shell.trashItem(assetsDir)
    } catch {
      // 附件目录不存在或已被回收，静默忽略
    }
  }
}

/**
 * 将图片数据（base64 PNG/JPEG 等）写入工作区 assets 目录
 * - 渲染层传入 dataUrl 或 base64 字符串
 * - 自动按文档相对路径归档到 文档同级/assets/<文档名>/ 下
 * - 返回可插入 Markdown 的相对路径与缩略图 dataUrl（用于编辑器内预览）
 */
export async function saveImage(
  workspaceRoot: string,
  documentRelativePath: string,
  payload: { dataUrl?: string; base64?: string; fileName?: string }
): Promise<{ relativePath: string; thumbnailDataUrl: string }> {
  const safeDocPath = await assertSafePath(workspaceRoot, documentRelativePath)
  const docDir = path.dirname(safeDocPath)
  const docBaseName = path.basename(safeDocPath)
  const assetsDir = path.join(docDir, ASSETS_DIR_NAME, docBaseName)
  markWorkspaceSelfWrite(workspaceRoot)
  await mkdir(assetsDir, { recursive: true })

  let buffer: Buffer
  let ext = '.png'
  if (payload.dataUrl) {
    const m = payload.dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/)
    if (!m) throw new Error('非法的图片 dataUrl')
    const mime = m[1].toLowerCase()
    buffer = Buffer.from(m[2], 'base64')
    const mimeToExt: Record<string, string> = {
      'png': '.png', 'jpeg': '.jpg', 'jpg': '.jpg', 'gif': '.gif',
      'webp': '.webp', 'svg+xml': '.svg', 'x-icon': '.ico', 'bmp': '.bmp',
      'avif': '.avif', 'tiff': '.tiff', 'tif': '.tif'
    }
    ext = mimeToExt[mime] || '.png'
  } else if (payload.base64) {
    buffer = Buffer.from(payload.base64, 'base64')
  } else {
    throw new Error('缺少图片数据')
  }
  if (!buffer.length) throw new Error('图片数据为空')
  if (buffer.length > 50 * 1024 * 1024) throw new Error('图片超过 50MB 上限')

  const rawName = payload.fileName?.trim()
  const isGenericPasteName = !rawName || /^(image|pasted|clipboard|unnamed)(\.|$)/i.test(rawName)
  const baseName = isGenericPasteName
    ? formatPastedImageName()
    : path.basename(rawName, path.extname(rawName)).replace(/[<>:"/\\|?*]/g, '') || 'image'
  let fileName = `${baseName}${ext}`
  let targetPath = path.join(assetsDir, fileName)
  let counter = 1
  for (;;) {
    try {
      await stat(targetPath)
      fileName = `${baseName}-${counter}${ext}`
      targetPath = path.join(assetsDir, fileName)
      counter++
    } catch {
      break
    }
  }

  await fsWriteFile(targetPath, buffer)

  let thumbnailDataUrl = ''
  try {
    const img = nativeImage.createFromBuffer(buffer)
    if (!img.isEmpty()) {
      const size = img.getSize()
      const maxW = 800
      if (size.width > maxW) {
        const resized = img.resize({ width: maxW, quality: 'good' })
        thumbnailDataUrl = `data:image/png;base64,${resized.toPNG().toString('base64')}`
      } else {
        thumbnailDataUrl = `data:image/png;base64,${img.toPNG().toString('base64')}`
      }
    }
  } catch {
    // 缩略图失败不阻断，编辑器可退化为按路径占位
  }

  const relPosix = toPosixRelativePath(docDir, targetPath)
  return { relativePath: relPosix, thumbnailDataUrl }
}

export async function importImageFile(
  workspaceRoot: string,
  documentRelativePath: string,
  sourceAbsolutePath: string
): Promise<{ relativePath: string; thumbnailDataUrl: string }> {
  const safeDocPath = await assertSafePath(workspaceRoot, documentRelativePath)
  const docDir = path.dirname(safeDocPath)
  const docBaseName = path.basename(safeDocPath)
  const assetsDir = path.join(docDir, ASSETS_DIR_NAME, docBaseName)
  markWorkspaceSelfWrite(workspaceRoot)
  await mkdir(assetsDir, { recursive: true })

  const srcStat = await stat(sourceAbsolutePath)
  if (!srcStat.isFile()) throw new Error('源目标不是文件')
  if (srcStat.size > 50 * 1024 * 1024) throw new Error('图片超过 50MB 上限')

  const srcExt = path.extname(sourceAbsolutePath).toLowerCase()
  const baseName = path.basename(sourceAbsolutePath, srcExt).replace(/[<>:"/\\|?*]/g, '') || 'image'
  let fileName = `${baseName}${srcExt || '.png'}`
  let targetPath = path.join(assetsDir, fileName)
  let counter = 1
  for (;;) {
    try {
      await stat(targetPath)
      fileName = `${baseName}-${counter}${srcExt || '.png'}`
      targetPath = path.join(assetsDir, fileName)
      counter++
    } catch {
      break
    }
  }

  const buffer = await fsReadFile(sourceAbsolutePath)
  await fsWriteFile(targetPath, buffer)

  let thumbnailDataUrl = ''
  try {
    const img = nativeImage.createFromBuffer(buffer)
    if (!img.isEmpty()) {
      const size = img.getSize()
      const maxW = 800
      if (size.width > maxW) {
        const resized = img.resize({ width: maxW, quality: 'good' })
        thumbnailDataUrl = `data:image/png;base64,${resized.toPNG().toString('base64')}`
      } else {
        thumbnailDataUrl = `data:image/png;base64,${img.toPNG().toString('base64')}`
      }
    }
  } catch {
    // 静默失败
  }

  const relPosix = toPosixRelativePath(docDir, targetPath)
  return { relativePath: relPosix, thumbnailDataUrl }
}

export async function revealFile(workspaceRoot: string, relativePath: string): Promise<void> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  shell.showItemInFolder(safePath)
}

export async function openFileInSystem(workspaceRoot: string, relativePath: string): Promise<void> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const err = await shell.openPath(safePath)
  if (err) {
    throw new Error(err)
  }
}

interface WorkspaceTagCacheEntry {
  fileTagsByPath: Map<string, Set<string>>
  tagCounts: Map<string, number>
}

const workspaceTagCache = new Map<string, WorkspaceTagCacheEntry>()
const searchGenerations = new Map<string, number>()

function clearWorkspaceTagCache(workspaceRoot: string): void {
  if (!workspaceRoot) return
  workspaceTagCache.delete(normalizeWatchKey(workspaceRoot))
}

function extractMarkdownTagSet(fileContent: string): Set<string> {
  const fileTags = new Set<string>()
  const fm = extractFrontmatterTags(fileContent)
  for (const t of fm.tags) {
    fileTags.add(t)
  }
  const inlines = extractInlineTags(fileContent)
  for (const item of inlines) {
    fileTags.add(item.tag)
  }
  return fileTags
}

function sortWorkspaceTags(tagCounts: Map<string, number>): WorkspaceTagInfo[] {
  const result: WorkspaceTagInfo[] = []
  for (const [tag, count] of tagCounts.entries()) {
    if (count > 0) result.push({ tag, count })
  }
  result.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  return result
}

export async function getWorkspaceTags(workspaceRoot: string): Promise<WorkspaceTagInfo[]> {
  const safeRoot = await assertSafePath(workspaceRoot, '')
  const isFiltered = await createWorkspaceFilter(safeRoot)
  const rootCmp = process.platform === 'win32' ? safeRoot.toLowerCase() : safeRoot
  const rootPrefix = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep
  const withScanSlot = createScanLimiter(16)
  const fileTagsByPath = new Map<string, Set<string>>()
  const tagCounts = new Map<string, number>()
  const startTime = Date.now()
  const MAX_SCAN_TIME_MS = 3000

  async function resolveSymlink(fullPath: string): Promise<string | null> {
    const real = await realpath(fullPath).catch(() => null)
    if (!real) return null
    const cmp = process.platform === 'win32' ? real.toLowerCase() : real
    if (cmp !== rootCmp && !cmp.startsWith(rootPrefix)) return null
    return real
  }

  async function scanDir(currentDir: string, ancestors: ReadonlySet<string>): Promise<void> {
    if (Date.now() - startTime > MAX_SCAN_TIME_MS) return
    const entries = await withScanSlot(
      () => readdir(currentDir, { withFileTypes: true })
    ).catch(() => null)
    if (!entries) return

    await Promise.all(entries.map(async (entry) => {
      if (Date.now() - startTime > MAX_SCAN_TIME_MS) return
      const fullEntryPath = path.join(currentDir, entry.name)
      if (isFiltered(toPosixRelativePath(safeRoot, fullEntryPath), entry.name, entry.isDirectory())) return

      try {
        const entryPath = entry.isSymbolicLink()
          ? await resolveSymlink(fullEntryPath)
          : fullEntryPath
        if (!entryPath) return
        const relPosix = toPosixRelativePath(safeRoot, entryPath)
        const entryStat = await withScanSlot(() => stat(entryPath))
        const isDirectory = entryStat.isDirectory()
        if (entry.isSymbolicLink() && isFiltered(relPosix, entry.name, isDirectory)) return

        if (isDirectory) {
          const dirKey = process.platform === 'win32' ? entryPath.toLowerCase() : entryPath
          if (entry.isSymbolicLink() && ancestors.has(dirKey)) return
          const nextAncestors = new Set(ancestors)
          nextAncestors.add(dirKey)
          await scanDir(entryPath, nextAncestors)
        } else {
          const ext = path.extname(entry.name).toLowerCase()
          if (!MARKDOWN_EXTENSIONS.has(ext) || entryStat.size > MAX_SEARCH_FILE_SIZE) {
            return
          }
          if (Date.now() - startTime > MAX_SCAN_TIME_MS) return

          const fileContent = await withScanSlot(() => fsReadFile(entryPath, 'utf-8'))
          const fileTags = extractMarkdownTagSet(fileContent)
          if (fileTags.size > 0) {
            fileTagsByPath.set(relPosix, fileTags)
            for (const tag of fileTags) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
            }
          }
        }
      } catch {
        // 忽略无法访问或失效条目
      }
    }))
  }

  await scanDir(safeRoot, new Set([rootCmp]))
  workspaceTagCache.set(normalizeWatchKey(workspaceRoot), { fileTagsByPath, tagCounts })
  return sortWorkspaceTags(tagCounts)
}

export async function extractFileTags(
  workspaceRoot: string,
  relativePath: string,
  content?: string
): Promise<WorkspaceTagInfo[]> {
  const wsKey = normalizeWatchKey(workspaceRoot)
  const cache = workspaceTagCache.get(wsKey)
  if (!cache) {
    return getWorkspaceTags(workspaceRoot)
  }

  const normalizedRel = relativePath.split('\\').join('/').replace(/^\/+/, '')
  let fileContent: string
  if (typeof content === 'string') {
    fileContent = content
  } else {
    const safePath = await assertSafePath(workspaceRoot, normalizedRel)
    const info = await stat(safePath)
    if (!info.isFile() || info.size > MAX_SEARCH_FILE_SIZE) {
      return sortWorkspaceTags(cache.tagCounts)
    }
    fileContent = await fsReadFile(safePath, 'utf-8')
  }

  const nextTags = extractMarkdownTagSet(fileContent)
  const prevTags = cache.fileTagsByPath.get(normalizedRel)
  if (prevTags) {
    for (const tag of prevTags) {
      if (!nextTags.has(tag)) {
        const nextCount = (cache.tagCounts.get(tag) || 0) - 1
        if (nextCount > 0) cache.tagCounts.set(tag, nextCount)
        else cache.tagCounts.delete(tag)
      }
    }
  }
  for (const tag of nextTags) {
    if (!prevTags || !prevTags.has(tag)) {
      cache.tagCounts.set(tag, (cache.tagCounts.get(tag) || 0) + 1)
    }
  }
  if (nextTags.size > 0) {
    cache.fileTagsByPath.set(normalizedRel, nextTags)
  } else {
    cache.fileTagsByPath.delete(normalizedRel)
  }

  return sortWorkspaceTags(cache.tagCounts)
}

/**
 * 工作区双链快照缓存：每个 Markdown 文件抽取出的 [[target]] 原始目标串。
 * 解析成具体路径由渲染层用文件树按统一的最短路径语义完成，主进程只存原始串。
 * 自身写盘走 extractFileLinks 增量更新；其余写盘路径（导图后台生成、外部编辑器、
 * 重命名/删除）由 watcher 事件驱动的逐路径索引覆盖。
 * 扫描与逐路径索引经按工作区的串行队列执行，否则首扫进行中到达的事件会被丢弃，
 * 被改文件会以旧内容进缓存且之后无事件修复。
 */
const workspaceLinkCache = new Map<string, Map<string, string[]>>()
const workspaceLinkScanChains = new Map<string, Promise<void>>()

function enqueueWorkspaceLinkScan<T>(workspaceRoot: string, job: () => Promise<T>): Promise<T> {
  const key = normalizeWatchKey(workspaceRoot)
  const previous = workspaceLinkScanChains.get(key) ?? Promise.resolve()
  const run = previous.then(job, job)
  workspaceLinkScanChains.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}

function clearWorkspaceLinkCache(workspaceRoot: string): void {
  if (!workspaceRoot) return
  workspaceLinkCache.delete(normalizeWatchKey(workspaceRoot))
}

/**
 * watcher 事件驱动的双链快照增量索引：
 * - Markdown 文件事件：按路径重读重抽（已删除/不可读则移除条目）；
 * - 其他文件事件：确实是文件的跳过；不存在或是目录时视为目录级改动
 *   （Windows 上目录重命名不保证子文件事件逐个到达），整表作废退化为全量重扫。
 * - gitignore 过滤目录内的 Markdown 不入索引，否则会产生文件树无法解析的幻影反链；
 *   目录级整表作废无此问题（全量重扫自带过滤口径）。
 * 缓存尚未建立时不动：首次读取本来就是全量扫描。
 */
async function updateWorkspaceLinkCachePaths(workspaceRoot: string, changedPaths: string[]): Promise<void> {
  const wsKey = normalizeWatchKey(workspaceRoot)
  const cache = workspaceLinkCache.get(wsKey)
  if (!cache) return
  const safeRoot = await assertSafePath(workspaceRoot, '')
  const isFiltered = await createWorkspaceFilter(safeRoot)
  for (const changed of changedPaths) {
    const relPosix = changed.split('\\').join('/').replace(/^\/+/, '')
    if (!relPosix) continue
    const ext = path.extname(relPosix).toLowerCase()
    const isMarkdown = MARKDOWN_EXTENSIONS.has(ext)
    if (isFiltered(relPosix, relPosix.split('/').pop() || relPosix, false)) {
      // 过滤目录内的 md 变化可能命中缓存残留键；清掉比留着幻影数据强
      if (isMarkdown) cache.delete(relPosix)
      continue
    }
    // 非 Markdown 事件：确认是现存文件才与双链无关可跳过；
    // 不存在或是目录时视为目录级改动（目录重命名/删除不保证子文件事件逐个到达，
    // 且目录名可能带点导致 extname 非空），整表作废退化为全量重扫。
    if (!isMarkdown) {
      let isRegularFile = false
      try {
        const safePath = await assertSafePath(workspaceRoot, relPosix)
        isRegularFile = (await stat(safePath)).isFile()
      } catch {
        // 路径已不存在：已删除的文件同样走到这里，代价是一次保守的重扫
      }
      if (isRegularFile) continue
      workspaceLinkCache.delete(wsKey)
      return
    }
    let isFile = false
    try {
      const safePath = await assertSafePath(workspaceRoot, relPosix)
      const info = await stat(safePath)
      isFile = info.isFile()
      if (!isFile || info.size > MAX_SEARCH_FILE_SIZE) {
        cache.delete(relPosix)
        continue
      }
      const fileContent = await fsReadFile(safePath, 'utf-8')
      cache.set(relPosix, extractWikiLinkTargets(fileContent))
    } catch {
      cache.delete(relPosix)
    }
  }
}

function sortWorkspaceLinkEntries(entries: Map<string, string[]>): WorkspaceLinkEntry[] {
  return [...entries.entries()]
    .map(([entryPath, targets]) => ({ path: entryPath, targets }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export async function getWorkspaceLinks(workspaceRoot: string): Promise<WorkspaceLinkEntry[]> {
  const wsKey = normalizeWatchKey(workspaceRoot)
  const cached = workspaceLinkCache.get(wsKey)
  if (cached) {
    return sortWorkspaceLinkEntries(cached)
  }
  // 扫描进串行队列：进行中到达的 watcher 事件排在扫描之后执行，不会丢失。
  // 并发调用在入队后重查缓存，避免同一路径并发多次全扫。
  return enqueueWorkspaceLinkScan(workspaceRoot, async () => {
    const recheck = workspaceLinkCache.get(wsKey)
    if (recheck) {
      return sortWorkspaceLinkEntries(recheck)
    }
    return scanWorkspaceLinks(workspaceRoot, wsKey)
  })
}

async function scanWorkspaceLinks(workspaceRoot: string, wsKey: string): Promise<WorkspaceLinkEntry[]> {
  const safeRoot = await assertSafePath(workspaceRoot, '')
  const isFiltered = await createWorkspaceFilter(safeRoot)
  const rootCmp = process.platform === 'win32' ? safeRoot.toLowerCase() : safeRoot
  const rootPrefix = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep
  const withScanSlot = createScanLimiter(16)
  const fileTargetsByPath = new Map<string, string[]>()
  const startTime = Date.now()
  const MAX_SCAN_TIME_MS = 8000
  let scanTruncated = false

  async function resolveSymlink(fullPath: string): Promise<string | null> {
    const real = await realpath(fullPath).catch(() => null)
    if (!real) return null
    const cmp = process.platform === 'win32' ? real.toLowerCase() : real
    if (cmp !== rootCmp && !cmp.startsWith(rootPrefix)) return null
    return real
  }

  async function scanDir(currentDir: string, ancestors: ReadonlySet<string>): Promise<void> {
    if (Date.now() - startTime > MAX_SCAN_TIME_MS) {
      scanTruncated = true
      return
    }
    const entries = await withScanSlot(
      () => readdir(currentDir, { withFileTypes: true })
    ).catch(() => null)
    if (!entries) return

    await Promise.all(entries.map(async (entry) => {
      if (Date.now() - startTime > MAX_SCAN_TIME_MS) {
        scanTruncated = true
        return
      }
      const fullEntryPath = path.join(currentDir, entry.name)
      if (isFiltered(toPosixRelativePath(safeRoot, fullEntryPath), entry.name, entry.isDirectory())) return

      try {
        const entryPath = entry.isSymbolicLink()
          ? await resolveSymlink(fullEntryPath)
          : fullEntryPath
        if (!entryPath) return
        const relPosix = toPosixRelativePath(safeRoot, entryPath)
        const entryStat = await withScanSlot(() => stat(entryPath))
        const isDirectory = entryStat.isDirectory()
        if (entry.isSymbolicLink() && isFiltered(relPosix, entry.name, isDirectory)) return

        if (isDirectory) {
          const dirKey = process.platform === 'win32' ? entryPath.toLowerCase() : entryPath
          if (entry.isSymbolicLink() && ancestors.has(dirKey)) return
          const nextAncestors = new Set(ancestors)
          nextAncestors.add(dirKey)
          await scanDir(entryPath, nextAncestors)
        } else {
          const ext = path.extname(entry.name).toLowerCase()
          if (!MARKDOWN_EXTENSIONS.has(ext) || entryStat.size > MAX_SEARCH_FILE_SIZE) {
            return
          }
          if (Date.now() - startTime > MAX_SCAN_TIME_MS) {
            scanTruncated = true
            return
          }
          const fileContent = await withScanSlot(() => fsReadFile(entryPath, 'utf-8'))
          fileTargetsByPath.set(relPosix, extractWikiLinkTargets(fileContent))
        }
      } catch {
        // 忽略无法访问或失效条目
      }
    }))
  }

  await scanDir(safeRoot, new Set([rootCmp]))
  // 截断扫描的结果不完整：反链缺失是用户可见的错误，不能当权威缓存。
  // 返回本次部分结果供界面先渲染，但缓存只在完整扫描时建立，
  // 下次读取重扫直至收敛；watcher 的逐路径索引也不依赖它存在。
  if (!scanTruncated) {
    workspaceLinkCache.set(wsKey, fileTargetsByPath)
  }
  return sortWorkspaceLinkEntries(fileTargetsByPath)
}

/**
 * 保存后增量更新单个文件的双链快照，避免自动保存触发全量扫盘。
 * 无缓存时回退为全量扫描建立缓存。
 */
export async function extractFileLinks(
  workspaceRoot: string,
  relativePath: string,
  content?: string
): Promise<WorkspaceLinkEntry[]> {
  const wsKey = normalizeWatchKey(workspaceRoot)
  const cache = workspaceLinkCache.get(wsKey)
  if (!cache) {
    return getWorkspaceLinks(workspaceRoot)
  }

  const normalizedRel = relativePath.split('\\').join('/').replace(/^\/+/, '')
  return enqueueWorkspaceLinkScan(workspaceRoot, async () => {
    const current = workspaceLinkCache.get(wsKey)
    if (!current) {
      return scanWorkspaceLinks(workspaceRoot, wsKey)
    }
    let fileContent: string
    if (typeof content === 'string') {
      fileContent = content
    } else {
      const safePath = await assertSafePath(workspaceRoot, normalizedRel)
      const info = await stat(safePath)
      if (!info.isFile() || info.size > MAX_SEARCH_FILE_SIZE) {
        return sortWorkspaceLinkEntries(current)
      }
      fileContent = await fsReadFile(safePath, 'utf-8')
    }

    current.set(normalizedRel, extractWikiLinkTargets(fileContent))
    return sortWorkspaceLinkEntries(current)
  })
}

/**
 * 工作区全文与标签搜索
 * - 支持标签语法检索：`tag:#xxx`、`tag:xxx`、`#xxx`，自动支持父子层级嵌套继承匹配（如 parent 命中 parent/child）
 * - 检索 .md, .markdown, .txt 且大小 < 2MB 的文件
 * - 逐行匹配，截取前后各 30 个字符作为上下文预览
 * - 最多返回 100 条匹配结果
 * - 超过 1500ms 主动截断让渡；同工作区新搜索到达时取消前序扫描
 */
export async function search(workspaceRoot: string, query: string): Promise<WorkbenchSearchResult[]> {
  const wsKey = normalizeWatchKey(workspaceRoot)
  const gen = (searchGenerations.get(wsKey) ?? 0) + 1
  searchGenerations.set(wsKey, gen)

  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const safeRoot = await assertSafePath(workspaceRoot, '')
  if (searchGenerations.get(wsKey) !== gen) return []
  const isFiltered = await createWorkspaceFilter(safeRoot)
  if (searchGenerations.get(wsKey) !== gen) return []

  const rootCmp = process.platform === 'win32' ? safeRoot.toLowerCase() : safeRoot
  const rootPrefix = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep
  const withScanSlot = createScanLimiter(16)
  const startTime = Date.now()
  const lowerQuery = trimmed.toLowerCase()
  const tagQueryInfo = parseTagSearchQuery(trimmed)
  const results: WorkbenchSearchResult[] = []

  const isStopped = (): boolean =>
    searchGenerations.get(wsKey) !== gen ||
    results.length >= MAX_SEARCH_RESULTS ||
    Date.now() - startTime > MAX_SEARCH_TIME_MS

  async function resolveSymlink(fullPath: string): Promise<string | null> {
    const real = await realpath(fullPath).catch(() => null)
    if (!real) return null
    const cmp = process.platform === 'win32' ? real.toLowerCase() : real
    if (cmp !== rootCmp && !cmp.startsWith(rootPrefix)) return null
    return real
  }

  async function searchDir(currentDir: string, ancestors: ReadonlySet<string>): Promise<void> {
    if (isStopped()) return

    const entries = await withScanSlot(
      () => readdir(currentDir, { withFileTypes: true })
    ).catch(() => null)
    if (!entries || isStopped()) return

    await Promise.all(entries.map(async (entry) => {
      if (isStopped()) return

      const fullEntryPath = path.join(currentDir, entry.name)
      if (isFiltered(toPosixRelativePath(safeRoot, fullEntryPath), entry.name, entry.isDirectory())) {
        return
      }

      try {
        const entryPath = entry.isSymbolicLink()
          ? await resolveSymlink(fullEntryPath)
          : fullEntryPath
        if (!entryPath || isStopped()) return

        const relPosix = toPosixRelativePath(safeRoot, entryPath)
        const entryStat = await withScanSlot(() => stat(entryPath))
        const isDirectory = entryStat.isDirectory()
        if (entry.isSymbolicLink() && isFiltered(relPosix, entry.name, isDirectory)) {
          return
        }

        if (isDirectory) {
          const dirKey = process.platform === 'win32' ? entryPath.toLowerCase() : entryPath
          if (entry.isSymbolicLink() && ancestors.has(dirKey)) return
          const nextAncestors = new Set(ancestors)
          nextAncestors.add(dirKey)
          await searchDir(entryPath, nextAncestors)
        } else {
          const ext = path.extname(entry.name).toLowerCase()
          if (!SEARCHABLE_EXTENSIONS.has(ext) || entryStat.size > MAX_SEARCH_FILE_SIZE) {
            return
          }
          if (isStopped()) return

          const fileContent = await withScanSlot(() => fsReadFile(entryPath, 'utf-8'))
          if (isStopped()) return

          const lines = fileContent.split(/\r?\n/)
          const isMarkdown = MARKDOWN_EXTENSIONS.has(ext)

          if (tagQueryInfo.isTagQuery && isMarkdown) {
            const fm = extractFrontmatterTags(fileContent)
            for (const ft of fm.tags) {
              if (results.length >= MAX_SEARCH_RESULTS) break
              if (matchTag(ft, tagQueryInfo.tagTerm)) {
                const lineNum = fm.lineMap.get(ft.toLowerCase()) || 1
                const lineContent = (lines[lineNum - 1] || `tags: ${ft}`).trim()
                results.push({
                  filePath: relPosix,
                  fileName: entry.name,
                  line: lineNum,
                  content: lineContent,
                  preview: `标签: ${ft}`
                })
              }
            }

            const inlines = extractInlineTags(fileContent)
            for (const it of inlines) {
              if (results.length >= MAX_SEARCH_RESULTS) break
              if (matchTag(it.tag, tagQueryInfo.tagTerm)) {
                const rawLine = lines[it.line - 1] || ''
                const tagIdx = rawLine.indexOf(it.rawMatch)
                const start = Math.max(0, tagIdx - 25)
                const end = Math.min(rawLine.length, (tagIdx >= 0 ? tagIdx + it.rawMatch.length : 0) + 25)
                const snippet = rawLine.slice(start, end).trim()
                const preview = (start > 0 ? '...' : '') + snippet + (end < rawLine.length ? '...' : '')
                results.push({
                  filePath: relPosix,
                  fileName: entry.name,
                  line: it.line,
                  content: rawLine.trim(),
                  preview: preview || `标签: #${it.tag}`
                })
              }
            }
            return
          }

          for (let i = 0; i < lines.length; i++) {
            if (isStopped()) break

            const lineText = lines[i]
            const matchIndex = lineText.toLowerCase().indexOf(lowerQuery)
            if (matchIndex !== -1) {
              const start = Math.max(0, matchIndex - 30)
              const end = Math.min(lineText.length, matchIndex + trimmed.length + 30)
              const snippet = lineText.slice(start, end).trim()
              const preview = (start > 0 ? '...' : '') + snippet + (end < lineText.length ? '...' : '')

              results.push({
                filePath: relPosix,
                fileName: entry.name,
                line: i + 1,
                content: lineText.trim(),
                preview
              })
            }
          }
        }
      } catch {
        // 忽略无法访问或失效条目
      }
    }))
  }

  await searchDir(safeRoot, new Set([rootCmp]))
  return results
}

const execFileAsync = promisify(execFile)

const WINDOWS_CLIPBOARD_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PathsJson,
  [string]$ImagePath = '',
  [switch]$Move
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# PowerShell 5.1 的 ConvertFrom-Json 会把 JSON 数组作为单个 Object[] 元素返回，
# 直接 @() 包一层会得到 space-join 的整串，必须显式转 [string[]] 逐元素展开
$paths = [string[]]($PathsJson | ConvertFrom-Json)
if ($paths.Count -eq 0) { exit 0 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$data = New-Object System.Windows.Forms.DataObject
$data.SetFileDropList([string[]]$paths)
if ($Move) {
  # Preferred DropEffect = DROPEFFECT_MOVE(2)：资源管理器/目标应用按"剪切"处理这批文件
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([int]2)
  $bw.Flush()
  $data.SetData('Preferred DropEffect', $false, $ms)
}
if ($ImagePath -ne '' -and (Test-Path -LiteralPath $ImagePath -PathType Leaf)) {
  try {
    $bmp = New-Object System.Drawing.Bitmap($ImagePath)
    $data.SetImage($bmp)
  } catch {}
}
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
`

const WINDOWS_READ_CLIPBOARD_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$move = $false
$paths = @()
try {
  if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
    $drop = [System.Windows.Forms.Clipboard]::GetFileDropList()
    foreach ($p in $drop) { $paths += $p }
    $data = [System.Windows.Forms.Clipboard]::GetDataObject()
    if ($data -ne $null -and $data.GetDataPresent('Preferred DropEffect')) {
      $stream = $data.GetData('Preferred DropEffect')
      if ($stream -ne $null) {
        $br = New-Object System.IO.BinaryReader($stream)
        try { $move = ($br.ReadInt32() -band 2) -eq 2 } catch {}
      }
    }
  }
} catch {}
@{ paths = @($paths); move = $move } | ConvertTo-Json -Compress
`

const WINDOWS_CLEAR_CLIPBOARD_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::Clear()
`

/**
 * 把工作台文件写入系统剪贴板：
 * - Windows 走 PowerShell `SetFileDropList`（资源管理器语义：Ctrl+V 粘贴文件本体）
 * - 单张图片额外写 `SetImage`，让聊天输入框/画图等直接得到图片内容
 * - 其他平台退回 `clipboard.write`（写入文本路径 + 图片位图）
 */
export async function copyNodesToClipboard(
  workspaceRoot: string,
  relativePaths: string[],
  options?: { move?: boolean }
): Promise<{ copied: number; imageCopied: boolean }> {
  const safeRoot = await assertSafePath(workspaceRoot, '')
  const absPaths: string[] = []
  for (const rel of relativePaths) {
    const safe = await assertSafePath(safeRoot, rel)
    absPaths.push(safe)
  }
  if (!absPaths.length) return { copied: 0, imageCopied: false }

  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico'])
  const single = absPaths.length === 1 ? absPaths[0] : ''
  const isImage = single !== '' && imageExts.has(path.extname(single).toLowerCase())

  if (process.platform === 'win32') {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'multichat-clip-'))
    const scriptPath = path.join(tmpDir, 'copy-files.ps1')
    try {
      await fsWriteFile(scriptPath, WINDOWS_CLIPBOARD_SCRIPT, 'utf8')
      const args = ['-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
        '-PathsJson', JSON.stringify(absPaths),
        '-ImagePath', isImage && !options?.move ? single : '']
      if (options?.move) args.push('-Move')
      await execFileAsync(
        'powershell',
        args,
        { windowsHide: true, timeout: 15000 }
      )
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
    return { copied: absPaths.length, imageCopied: isImage }
  }

  const text = absPaths.join('\n')
  const image = isImage ? nativeImage.createFromPath(single) : null
  clipboard.write({
    text,
    image: image && !image.isEmpty() ? image : undefined
  })
  return { copied: absPaths.length, imageCopied: isImage && image !== null && !image.isEmpty() }
}

/**
 * 读取系统剪贴板中的文件列表与"剪切"标记（Windows）。
 * 粘贴语义与资源管理器一致：Preferred DropEffect 带 DROPEFFECT_MOVE 时按移动处理。
 * 非 Windows 平台返回空列表，由渲染层按复制兜底。
 */
export async function readClipboardFileDrop(): Promise<{ paths: string[]; move: boolean }> {
  if (process.platform !== 'win32') return { paths: [], move: false }
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'multichat-clip-'))
  const scriptPath = path.join(tmpDir, 'read-clipboard.ps1')
  try {
    await fsWriteFile(scriptPath, WINDOWS_READ_CLIPBOARD_SCRIPT, 'utf8')
    const { stdout } = await execFileAsync(
      'powershell',
      ['-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, timeout: 10000 }
    )
    const parsed = JSON.parse(stdout.trim() || '{}') as { paths?: unknown; move?: unknown }
    const paths = Array.isArray(parsed.paths)
      ? parsed.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : typeof parsed.paths === 'string' && parsed.paths.length > 0
      ? [parsed.paths]
      : []
    return { paths, move: parsed.move === true }
  } catch {
    return { paths: [], move: false }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * 清空系统剪贴板中的文件列表（剪切粘贴完成后调用，防止对失效路径重复执行移动）。
 * 仅当当前文件列表与期望路径完全一致时才清，避免误清用户之后复制的内容。
 */
export async function clearClipboardFileDropIfMatches(expectedAbsPaths: string[]): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const { paths } = await readClipboardFileDrop()
    if (!paths.length || paths.length !== expectedAbsPaths.length) return
    const normalize = (p: string) => path.resolve(p).toLowerCase()
    const current = new Set(paths.map(normalize))
    if (!expectedAbsPaths.every((p) => current.has(normalize(p)))) return
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'multichat-clip-'))
    const scriptPath = path.join(tmpDir, 'clear-clipboard.ps1')
    try {
      await fsWriteFile(scriptPath, WINDOWS_CLEAR_CLIPBOARD_SCRIPT, 'utf8')
      await execFileAsync(
        'powershell',
        ['-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true, timeout: 10000 }
      )
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch {
    // 清空失败不影响移动结果
  }
}

/**
 * 把外部绝对路径列表"移动"进工作区目标目录（剪切粘贴语义）：
 * - 同盘 rename，跨盘退回 cp + rm（movePath 已处理 EXDEV 与回滚）
 * - 重名自动追加 `-n` 后缀，不覆盖目标侧既有节点
 * - 源已在目标目录（原地剪切粘贴）时静默跳过
 * - 返回工作区内发生的移动配对，供导图绑定/标注迁移
 */
export async function moveExternalPaths(
  workspaceRoot: string,
  targetDirRelative: string,
  sourceAbsolutePaths: string[]
): Promise<{ moved: string[]; failed: { path: string; error: string }[]; movePairs: Array<{ source: string; target: string }> }> {
  const safeTargetDir = await assertSafePath(workspaceRoot, targetDirRelative)
  const normalizedRoot = path.resolve(workspaceRoot)
  markWorkspaceSelfWrite(workspaceRoot)
  const moved: string[] = []
  const failed: { path: string; error: string }[] = []
  const movePairs: Array<{ source: string; target: string }> = []

  const release = await lockCopyTarget(safeTargetDir)
  try {
    for (const sourcePath of sourceAbsolutePaths) {
      try {
        if (!sourcePath || typeof sourcePath !== 'string' || hasControlCharacters(sourcePath)) {
          failed.push({ path: String(sourcePath), error: '非法的源路径' })
          continue
        }
        const resolvedSrc = path.resolve(sourcePath)
        const srcStat = await stat(resolvedSrc)
        const srcBase = path.basename(resolvedSrc)
        if (isBlockedImportName(srcBase)) {
          failed.push({ path: sourcePath, error: '已忽略的系统目录/文件' })
          continue
        }
        // 目标位于源目录内部 → 禁止（防自我包含；Windows 比较统一小写）
        if (
          srcStat.isDirectory() &&
          (
            safeTargetDir.toLowerCase() === resolvedSrc.toLowerCase() ||
            safeTargetDir.toLowerCase().startsWith(resolvedSrc.toLowerCase() + path.sep)
          )
        ) {
          failed.push({ path: sourcePath, error: '不能将文件夹移动到其自身内部' })
          continue
        }
        // Windows 大小写不敏感：比较前统一小写，避免剪贴板路径与工作区大小写错配导致原地改名
        if (path.dirname(resolvedSrc).toLowerCase() === safeTargetDir.toLowerCase()) {
          continue
        }

        const freeName = await allocateFreeName(safeTargetDir, srcBase)
        const destPath = path.join(safeTargetDir, freeName)
        markWorkspaceSelfWrite(workspaceRoot)
        await movePath(resolvedSrc, destPath)
        const targetRelative = toPosixRelativePath(normalizedRoot, destPath)
        moved.push(targetRelative)
        const sourceRelative = path.relative(normalizedRoot, resolvedSrc)
        if (!sourceRelative.startsWith('..') && !path.isAbsolute(sourceRelative)) {
          movePairs.push({ source: toPosixRelativePath(normalizedRoot, resolvedSrc), target: targetRelative })
        }
      } catch (err) {
        failed.push({ path: sourcePath, error: err instanceof Error ? err.message : String(err) })
      }
    }
  } finally {
    release()
  }

  return { moved, failed, movePairs }
}
