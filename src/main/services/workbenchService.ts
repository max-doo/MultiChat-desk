/**
 * 工作台文件系统服务 (Workbench Service)
 * 提供安全路径校验、工作区文件树扫描、文件读写、节点增删改查、全文搜索与系统集成
 */

import { dialog, shell, BrowserWindow, nativeImage } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  realpath,
  stat,
  readdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir,
  rm,
  rename
} from 'fs/promises'
import { randomUUID } from 'crypto'
import {
  type WorkbenchFileNode,
  type WorkbenchSearchResult,
  type WorkbenchFileInfo,
  type WorkbenchWriteResult,
  type WorkbenchSelectFolderResult,
  type WorkbenchNodeType,
  getFileCategory,
  MARKDOWN_EXTENSIONS,
  TEXT_EXTENSIONS,
  CODE_EXTENSIONS
} from '../../shared/types/workbench'

// 默认忽略的系统文件和特定目录
const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.obsidian',
  '.trash',
  '.vscode',
  '.idea',
  '.DS_Store',
  'Thumbs.db',
  '$RECYCLE.BIN'
])

// 图片 MIME 类型映射
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

/**
 * 生成 Obsidian 风格的粘贴图片名：`Pasted image YYYYMMDD-HHmmss`
 */
function formatPastedImageName(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `Pasted image ${date}-${time}`
}

// Office 办公文档 MIME 类型映射
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

// 允许检索的文本与代码文件后缀与文件大小上限 (2MB)
const SEARCHABLE_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...CODE_EXTENSIONS
])
const MAX_SEARCH_FILE_SIZE = 2 * 1024 * 1024
const MAX_SEARCH_RESULTS = 100
const MAX_SEARCH_TIME_MS = 1500

/**
 * 将任意路径转换为 POSIX 风格相对路径 (使用 / 分隔)
 */
function toPosixRelativePath(rootPath: string, targetPath: string): string {
  const rel = path.relative(rootPath, targetPath)
  return rel.split(path.sep).join('/')
}

/**
 * 检测字符串中是否包含 ASCII 控制字符 (0x00 - 0x1F)
 */
function hasControlCharacters(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code >= 0 && code <= 31) {
      return true
    }
  }
  return false
}

/**
 * 判断是否应忽略该目录或文件节点
 */
function isIgnoredName(name: string): boolean {
  if (name.startsWith('.') || IGNORED_NAMES.has(name)) {
    return true
  }
  return false
}

/**
 * 校验并返回安全的物理绝对路径
 * 1. 规范化路径分隔符与 resolve
 * 2. 检查解析后的 targetPath 是否以 workspaceRoot 为前缀，防范逻辑路径越权 (Path Traversal)
 * 3. 校验控制字符与空字符
 * 4. 必须通过 realpath 校验真实物理路径，防止符号链接 (Symlink) 逃逸出工作区
 */
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

  // 1. 基础逻辑路径前缀比对
  if (targetCmp !== rootCmp && !targetCmp.startsWith(rootPrefix)) {
    throw new Error('访问被拒绝：检测到逻辑路径越权 (Path Traversal Attempt)')
  }

  // 2. 校验控制字符与空字符
  if (hasControlCharacters(targetPath)) {
    throw new Error('路径包含非法字符')
  }

  // 3. 真实文件系统路径 (Realpath) 严格比对
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
    // 如果目标是尚未创建的新文件或新目录，校验其现存父目录的真实路径
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

// ============ workbench-file:// 自定义流式协议 ============
// 目的：PDF / Office 大文件预览不再走 base64 dataUrl（4-5× 内存放大），
// 改为自定义协议流式回文件，renderer 零拷贝、PDFium 支持 range 按需加载。
// 安全：只允许读取曾被 readFile/selectFolder 授权过的 workspace 根目录内的文件。

const authorizedWorkspaceRoots = new Set<string>()

/** 登记一个已授权的工作区根目录（readFile / selectFolder 时调用）。 */
export function authorizeWorkspaceRoot(workspaceRoot: string): void {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') return
  authorizedWorkspaceRoots.add(path.resolve(workspaceRoot))
}

export const WORKBENCH_FILE_SCHEME = 'workbench-file'

/**
 * 把 workspace 内的绝对路径转成可加载的 workbench-file:// URL。
 * 约定：workbench-file:///<encodeURIComponent(absolutePath)>
 */
export function toWorkbenchFileUrl(absolutePath: string): string {
  const normalized = path.resolve(absolutePath)
  return `${WORKBENCH_FILE_SCHEME}:///${encodeURIComponent(normalized)}`
}

/**
 * 解析 workbench-file:// 请求并校验落在已授权工作区根目录内。
 * 命中返回真实绝对路径，否则返回 null。
 */
export async function resolveWorkbenchFileRequest(requestUrl: string): Promise<string | null> {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${WORKBENCH_FILE_SCHEME}:`) return null
    const encoded = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    if (!encoded) return null
    const targetPath = path.resolve(encoded)

    const isWin = process.platform === 'win32'
    const targetCmp = isWin ? targetPath.toLowerCase() : targetPath

    for (const root of authorizedWorkspaceRoots) {
      const rootCmp = isWin ? root.toLowerCase() : root
      const sep = path.sep
      const rootPrefix = rootCmp.endsWith(sep) ? rootCmp : rootCmp + sep
      if (targetCmp === rootCmp || targetCmp.startsWith(rootPrefix)) {
        // 复用 assertSafePath 的 realpath 校验，防符号链接逃逸
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

/**
 * 唤起系统原生目录选择器对话框选择工作区
 */
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
  return {
    path: selectedPath,
    name: path.basename(selectedPath)
  }
}

/**
 * 递归扫描工作区文件树
 * - 过滤隐藏文件与系统目录 (.git, node_modules, etc.)
 * - 文件夹在前，同级按自然语言顺序排序
 * - 安全跳过符号链接越界节点
 */
export async function readTree(workspaceRoot: string): Promise<WorkbenchFileNode[]> {
  const safeRoot = await assertSafePath(workspaceRoot, '')

  async function scanDirectory(currentDir: string): Promise<WorkbenchFileNode[]> {
    let entries
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return []
    }

    const nodes: WorkbenchFileNode[] = []

    for (const entry of entries) {
      if (isIgnoredName(entry.name)) {
        continue
      }

      const fullEntryPath = path.join(currentDir, entry.name)

      try {
        // 校验路径安全性，防止 symlink 指向工作区外部
        const safeEntryPath = await assertSafePath(safeRoot, path.relative(safeRoot, fullEntryPath))
        const entryStat = await stat(safeEntryPath)
        const isDirectory = entryStat.isDirectory()
        const relPosix = toPosixRelativePath(safeRoot, safeEntryPath)

        if (isDirectory) {
          const children = await scanDirectory(safeEntryPath)
          nodes.push({
            id: relPosix,
            name: entry.name,
            path: relPosix,
            fullPath: safeEntryPath,
            isDirectory: true,
            mtime: entryStat.mtimeMs,
            children
          })
        } else {
          const ext = path.extname(entry.name).toLowerCase()
          const category = getFileCategory(entry.name)
          nodes.push({
            id: relPosix,
            name: entry.name,
            path: relPosix,
            fullPath: safeEntryPath,
            isDirectory: false,
            extension: ext,
            category,
            size: entryStat.size,
            mtime: entryStat.mtimeMs
          })
        }
      } catch {
        // 忽略无法访问、已失效或越权的节点
        continue
      }
    }

    // 目录优先，自然排序
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    return nodes
  }

  return scanDirectory(safeRoot)
}

/**
 * 安全读取指定文件内容
 * - 支持 Markdown、纯文本、代码、图片、PDF 与 Word 文档元信息
 * - 针对图片与 PDF 文件自动转换为安全的 Base64 Data URL
 */
export async function readFile(workspaceRoot: string, relativePath: string): Promise<WorkbenchFileInfo> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const fileStat = await stat(safePath)
  if (fileStat.isDirectory()) {
    throw new Error('目标是目录，无法作为文件读取')
  }

  const baseName = path.basename(safePath)
  const ext = path.extname(baseName).toLowerCase()
  const category = getFileCategory(baseName)

  // 登记当前 workspace 为已授权根，供 workbench-file:// 协议做白名单校验
  const workspaceRoot = path.dirname(safePath) === safePath ? safePath : path.resolve(workspaceRoot)
  authorizeWorkspaceRoot(workspaceRoot)

  // 图片文件处理 (最大 20MB)
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
    const buffer = await fsReadFile(safePath)
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
    return {
      content: ext === '.svg' ? buffer.toString('utf-8') : '',
      dataUrl,
      mimeType: mime,
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category: 'image',
      isBinary: true
    }
  }

  // PDF 文件处理 (最大 50MB)
  if (category === 'pdf') {
    if (fileStat.size > 50 * 1024 * 1024) {
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
    const buffer = await fsReadFile(safePath)
    const dataUrl = `data:application/pdf;base64,${buffer.toString('base64')}`
    return {
      content: '',
      dataUrl,
      mimeType: 'application/pdf',
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category: 'pdf',
      isBinary: true
    }
  }

  // Office 办公文档元信息（Word / Excel / PPT / ODF / RTF 等）
  if (category === 'document') {
    return {
      content: '',
      mimeType: OFFICE_MIME_TYPES[ext] || 'application/octet-stream',
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      category: 'document',
      isBinary: true
    }
  }

  // 纯文本、Markdown、代码文件与常规文本 (最大 5MB 文本保护)
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

  // 检查是否为未知二进制文件（扫描前 1024 字节是否存在空字节）
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

  const content = buffer.toString('utf-8')
  return {
    content,
    mtime: fileStat.mtimeMs,
    size: fileStat.size,
    category,
    isBinary: false
  }
}

/**
 * 安全原子写入文件内容
 */
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

/**
 * 在工作区内创建新文件或目录
 */
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

  // 守卫：禁止直接重命名/移动 assets 目录（只能由文档操作联动触发）
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

  await mkdir(path.dirname(safeNewPath), { recursive: true })
  await rename(safeOldPath, safeNewPath)

  // 文档级联动：.md 重命名/移动时，同步迁移 assets/<文件名>/ 附件目录
  if (
    MARKDOWN_EXTENSIONS.has(path.extname(safeOldPath).toLowerCase()) &&
    MARKDOWN_EXTENSIONS.has(path.extname(safeNewPath).toLowerCase())
  ) {
    await syncAssetsOnRename(safeOldPath, safeNewPath)
  }
}

/**
 * 文档重命名/移动时，迁移 assets/<文档名>/ 附件目录并重写文档内相对路径
 * - 附件目录无条件迁移（跨目录移动时目录名不变也要搬）
 * - 文档名变化且同目录时，重写 markdown 内 `assets/旧名/` → `assets/新名/`
 */
async function syncAssetsOnRename(safeOldPath: string, safeNewPath: string): Promise<void> {
  const oldName = path.basename(safeOldPath)
  const newName = path.basename(safeNewPath)
  const oldAssetsDir = path.join(path.dirname(safeOldPath), ASSETS_DIR_NAME, oldName)
  const newAssetsDir = path.join(path.dirname(safeNewPath), ASSETS_DIR_NAME, newName)

  // 1. 迁移附件目录（若存在且目标不冲突）
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
        } catch {
          console.warn('[Workbench] 附件目录迁移失败:', oldAssetsDir, '->', newAssetsDir)
        }
      }
    }
  }

  // 2. 同目录下文档名变化：重写 markdown 内的 assets 相对路径
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
}

/**
 * 列出文档 assets/<文档名>/ 目录中未被 markdown 内容引用的文件
 * 返回相对工作区根的 POSIX 路径列表，供渲染层确认后批量 trash
 */
export async function findUnreferencedImages(
  workspaceRoot: string,
  documentRelativePath: string
): Promise<{ unreferenced: string[]; total: number }> {
  const safeDocPath = await assertSafePath(workspaceRoot, documentRelativePath)
  const docDir = path.dirname(safeDocPath)
  const docBaseName = path.basename(safeDocPath)
  const assetsDir = path.join(docDir, ASSETS_DIR_NAME, docBaseName)

  let assetFiles: string[] = []
  try {
    const entries = await readdir(assetsDir, { withFileTypes: true })
    assetFiles = entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return { unreferenced: [], total: 0 } // 无 assets 目录
  }
  if (!assetFiles.length) return { unreferenced: [], total: 0 }

  let content = ''
  try {
    content = await fsReadFile(safeDocPath, 'utf-8')
  } catch {
    return { unreferenced: [], total: assetFiles.length } // 文档读不出，保守认为全未引用
  }

  const prefix = `assets/${docBaseName}/`
  const unreferenced: string[] = []
  for (const name of assetFiles) {
    // 宽松匹配：文件名可能带 URL 编码或转义
    const needle = prefix + name
    const needleEncoded = prefix + encodeURIComponent(name)
    if (!content.includes(needle) && !content.includes(needleEncoded)) {
      unreferenced.push(toPosixRelativePath(path.resolve(workspaceRoot), path.join(assetsDir, name)))
    }
  }
  return { unreferenced, total: assetFiles.length }
}

/**
 * 批量将工作区内文件移入回收站
 * 返回成功与失败列表（失败项附原因）
 */
export async function deleteNodes(
  workspaceRoot: string,
  relativePaths: string[]
): Promise<{ deleted: string[]; failed: { path: string; error: string }[] }> {
  const deleted: string[] = []
  const failed: { path: string; error: string }[] = []
  for (const relPath of relativePaths) {
    try {
      await deleteNode(workspaceRoot, relPath)
      deleted.push(relPath)
    } catch (err) {
      failed.push({ path: relPath, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { deleted, failed }
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

  await shell.trashItem(safePath)

  // 删除 .md 时连带回收附件目录（走 trash，可恢复）
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
  await mkdir(assetsDir, { recursive: true })

  // 解析 base64 输入
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

  // 确定文件名：
  // - 粘贴/未提供有效名 → `Pasted image YYYYMMDD-HHmmss`（Obsidian 风格，可读可排序）
  // - 提供了文件名（拖入/工具栏插入）→ 保留原名（清洗非法字符）
  const rawName = payload.fileName?.trim()
  const isGenericPasteName = !rawName || /^(image|pasted|clipboard|unnamed)(\.|$)/i.test(rawName)
  const baseName = isGenericPasteName
    ? formatPastedImageName()
    : path.basename(rawName, path.extname(rawName)).replace(/[<>:"/\\|?*]/g, '') || 'image'
  let fileName = `${baseName}${ext}`
  let targetPath = path.join(assetsDir, fileName)
  // 同名冲突自动加后缀
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

  // 生成编辑器内预览用缩略图（800px 宽 PNG）
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

  // 返回相对文档目录的 POSIX 路径，保证文档移动后 markdown 内相对路径仍有效
  const relPosix = toPosixRelativePath(docDir, targetPath)
  return { relativePath: relPosix, thumbnailDataUrl }
}

/**
 * 把图片文件复制进 assets 目录（拖拽本地文件时使用，避免 IPC 传 bytes）
 */
export async function importImageFile(
  workspaceRoot: string,
  documentRelativePath: string,
  sourceAbsolutePath: string
): Promise<{ relativePath: string; thumbnailDataUrl: string }> {
  // source 路径必须在工作区内，否则按普通文件处理
  const safeDocPath = await assertSafePath(workspaceRoot, documentRelativePath)
  const docDir = path.dirname(safeDocPath)
  const docBaseName = path.basename(safeDocPath)
  const assetsDir = path.join(docDir, ASSETS_DIR_NAME, docBaseName)
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

/**
 * 在系统文件管理器中高亮展示
 */
export async function revealFile(workspaceRoot: string, relativePath: string): Promise<void> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  shell.showItemInFolder(safePath)
}

/**
 * 使用操作系统默认关联程序打开文件
 */
export async function openFileInSystem(workspaceRoot: string, relativePath: string): Promise<void> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const err = await shell.openPath(safePath)
  if (err) {
    throw new Error(err)
  }
}

/**
 * 工作区全文搜索
 * - 检索 .md, .markdown, .txt 且大小 < 2MB 的文件
 * - 逐行匹配，截取前后各 30 个字符作为上下文预览
 * - 最多返回 100 条匹配结果
 * - 超过 1500ms 主动截断让渡
 */
export async function search(workspaceRoot: string, query: string): Promise<WorkbenchSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const safeRoot = await assertSafePath(workspaceRoot, '')
  const startTime = Date.now()
  const lowerQuery = trimmed.toLowerCase()
  const results: WorkbenchSearchResult[] = []

  async function searchDir(dir: string): Promise<void> {
    if (results.length >= MAX_SEARCH_RESULTS || Date.now() - startTime > MAX_SEARCH_TIME_MS) {
      return
    }

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= MAX_SEARCH_RESULTS || Date.now() - startTime > MAX_SEARCH_TIME_MS) {
        break
      }

      if (isIgnoredName(entry.name)) {
        continue
      }

      const fullEntryPath = path.join(dir, entry.name)

      try {
        const safeEntryPath = await assertSafePath(safeRoot, path.relative(safeRoot, fullEntryPath))
        const entryStat = await stat(safeEntryPath)

        if (entryStat.isDirectory()) {
          await searchDir(safeEntryPath)
        } else {
          const ext = path.extname(entry.name).toLowerCase()
          if (!SEARCHABLE_EXTENSIONS.has(ext) || entryStat.size > MAX_SEARCH_FILE_SIZE) {
            continue
          }

          const fileContent = await fsReadFile(safeEntryPath, 'utf-8')
          const lines = fileContent.split(/\r?\n/)
          const relPosix = toPosixRelativePath(safeRoot, safeEntryPath)

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_SEARCH_RESULTS || Date.now() - startTime > MAX_SEARCH_TIME_MS) {
              break
            }

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
        continue
      }
    }
  }

  await searchDir(safeRoot)
  return results
}
