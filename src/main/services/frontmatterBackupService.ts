/**
 * 迁移前 frontmatter 备份的扫描与清理。
 *
 * 备份由 conversationFrontmatterRepair 写在
 * `<工作区>/.multichat/frontmatter-backup/<原相对路径>.bak`，只在迁移真正改写
 * 文档时产生。这里只处理这一个目录，且仅当原文档仍存在时才删除备份：
 * 原文档消失后，备份就是唯一副本，不能一起清掉。
 */

import { readdir, realpath, rm, stat } from 'fs/promises'
import path from 'path'
import type {
  FrontmatterBackupClearResult,
  FrontmatterBackupGroup,
  FrontmatterBackupSummary
} from '../../shared/types/workbench'

const BACKUP_DIR = path.join('.multichat', 'frontmatter-backup')
const BACKUP_DIR_POSIX = '.multichat/frontmatter-backup'
const BACKUP_SUFFIX = '.bak'

const rootKey = (root: string): string => {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

interface BackupFile {
  workspaceRoot: string
  relativePath: string
  documentPath: string
  size: number
}

async function collectWorkspaceBackups(workspaceRoot: string): Promise<BackupFile[]> {
  const backupRoot = path.join(workspaceRoot, BACKUP_DIR)
  const files: BackupFile[] = []

  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith(BACKUP_SUFFIX)) continue
      const info = await stat(absolute).catch(() => null)
      if (!info?.isFile()) continue
      const relativeBackup = path.relative(backupRoot, absolute).split(path.sep).join('/')
      files.push({
        workspaceRoot,
        relativePath: `${BACKUP_DIR_POSIX}/${relativeBackup}`,
        documentPath: relativeBackup.slice(0, -BACKUP_SUFFIX.length),
        size: info.size
      })
    }
  }

  await walk(backupRoot)
  return files
}

async function documentExists(workspaceRoot: string, documentPath: string): Promise<boolean> {
  const target = path.resolve(workspaceRoot, documentPath)
  const prefix = rootKey(workspaceRoot) + path.sep
  // 备份文件名来自磁盘，仍需防越界：只允许工作区内部路径。
  if (rootKey(target) !== rootKey(workspaceRoot) && !rootKey(target).startsWith(prefix)) return false
  return stat(target).then(info => info.isFile(), () => false)
}

/**
 * 统计已知工作区里的 frontmatter 备份。
 * 迁移把普通会话写到默认库、工作台记录留在原工作区，因此必须跨工作区统计，
 * 只看当前打开的工作区经常会是 0。
 */
export async function summarizeFrontmatterBackups(
  workspaceRoots: string[]
): Promise<FrontmatterBackupSummary> {
  const groups: FrontmatterBackupGroup[] = []
  const seen = new Set<string>()
  for (const root of workspaceRoots) {
    if (!root) continue
    const key = rootKey(root)
    if (seen.has(key)) continue
    seen.add(key)
    const files = await collectWorkspaceBackups(root)
    if (!files.length) continue
    let orphans = 0
    for (const file of files) {
      if (!(await documentExists(root, file.documentPath))) orphans += 1
    }
    groups.push({
      workspaceRoot: root,
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      orphans
    })
  }
  groups.sort((a, b) => b.files - a.files || a.workspaceRoot.localeCompare(b.workspaceRoot))
  return {
    files: groups.reduce((sum, group) => sum + group.files, 0),
    bytes: groups.reduce((sum, group) => sum + group.bytes, 0),
    orphans: groups.reduce((sum, group) => sum + group.orphans, 0),
    groups
  }
}

/**
 * 清理原文档仍存在的备份；原文档已消失的备份保留。
 * 返回逐条失败原因，不做整体回滚——部分清理成功比全部失败更有用。
 */
export async function clearFrontmatterBackups(
  workspaceRoots: string[]
): Promise<FrontmatterBackupClearResult> {
  const result: FrontmatterBackupClearResult = { removed: 0, kept: 0, errors: [] }
  const seen = new Set<string>()
  for (const root of workspaceRoots) {
    if (!root) continue
    const key = rootKey(root)
    if (seen.has(key)) continue
    seen.add(key)
    // 真实路径校验：备份目录必须是该工作区自己的 .multichat 目录。
    const backupRoot = path.join(root, BACKUP_DIR)
    const realRoot = await realpath(root).catch(() => path.resolve(root))
    const realBackup = await realpath(backupRoot).catch(() => null)
    if (!realBackup) continue
    if (rootKey(realBackup) !== rootKey(path.join(realRoot, BACKUP_DIR))) continue

    const files = await collectWorkspaceBackups(root)
    for (const file of files) {
      if (!(await documentExists(root, file.documentPath))) {
        result.kept += 1
        continue
      }
      try {
        await rm(path.join(root, file.relativePath), { force: true })
        result.removed += 1
      } catch (error) {
        result.errors.push({
          workspaceRoot: root,
          relativePath: file.relativePath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    await removeEmptyDirs(backupRoot).catch(() => undefined)
  }
  return result
}

async function removeEmptyDirs(dir: string): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirs(path.join(dir, entry.name))
  }
  const remaining = await readdir(dir).catch(() => ['keep'])
  if (!remaining.length) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

