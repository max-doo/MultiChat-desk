/**
 * 工作区 .gitignore 读写
 * - 以仓库内的 .gitignore 为唯一事实来源：应用内设置只是它的可视化编辑，
 *   用户在终端或其他编辑器里改动后依然生效，不会出现两套规则互相矛盾
 * - 读取时保留用户手写的注释与空行，只把「规则行」解析为可编辑条目
 */

import { readFile, writeFile, stat, rename, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import path from 'path'
import type {
  GitignoreEntry,
  GitignoreCategory,
  GitignoreSnapshot
} from '../../shared/types/workbench'
export type { GitignoreEntry, GitignoreCategory, GitignoreSnapshot }

/** 同目录临时文件 + rename，避免写入中途失败留下半个 .gitignore */
async function writeTextFileSafely(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, content, 'utf-8')
    await rename(tempPath, filePath)
  } catch (error) {
    // 仅当 rename 失败且临时文件已写完时退回直接写入；写临时文件失败不应再碰目标文件
    const tempExists = await stat(tempPath).then(() => true).catch(() => false)
    if (tempExists) {
      await writeFile(filePath, content, 'utf-8')
      // 兜底写成功后再清理临时文件；清理失败不改变保存结果
      await rm(tempPath, { force: true }).catch(() => undefined)
      return
    }
    throw error
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

const SYSTEM_PATTERNS = ['.DS_Store', 'Thumbs.db', 'desktop.ini']
const ARCHIVE_PATTERNS = ['*.zip', '*.7z', '*.rar', '*.tar', '*.gz']
const INSTALLER_PATTERNS = ['*.exe', '*.msi', '*.dmg', '*.pkg', '*.AppImage']
const OFFICE_PATTERNS = [
  '*.pdf',
  '*.doc',
  '*.docx',
  '*.xls',
  '*.xlsx',
  '*.ppt',
  '*.pptx'
]
const VIDEO_PATTERNS = ['*.mp4', '*.mov', '*.mkv', '*.avi']
const DESIGN_PATTERNS = ['*.psd', '*.ai', '*.sketch', '*.fig']
const NODE_PATTERNS = ['node_modules/']
const PYTHON_PATTERNS = [
  '__pycache__/',
  '*.py[cod]',
  '.venv/',
  'venv/',
  '.pytest_cache/',
  '.mypy_cache/',
  '.ruff_cache/',
  '.tox/',
  '.nox/',
  '*.egg-info/',
  '.eggs/'
]
const BUILD_PATTERNS = [
  'dist/',
  'build/',
  '.next/',
  '.nuxt/',
  'coverage/',
  'htmlcov/',
  '.coverage'
]
const EDITOR_PATTERNS = ['*.swp', '*.swo', '.history/']
const IDE_PATTERNS = ['.idea/', '.vscode/']
// 应用生成物：保留 .multichat 下的配置与导图，只忽略可再生成的产物
const APP_STATE_PATTERNS = [
  '.multichat/image/',
  '.multichat/results/',
  '.multichat/cache/',
  '.multichat/logs/'
]
// Obsidian 的设备本地状态：窗口布局、缓存会随设备变化，不适合进版本控制
const OBSIDIAN_STATE_PATTERNS = [
  '.obsidian/workspace.json',
  '.obsidian/workspace-mobile.json',
  '.obsidian/cache/'
]

/**
 * 按文件类型归类的忽略项。
 * recommended 为 true 的组会写进新建工作区的默认 .gitignore；
 * 其余组只在用户勾选后填入，避免替用户决定哪些正文文件该被排除。
 */
export const GITIGNORE_CATEGORIES: GitignoreCategory[] = [
  {
    id: 'system',
    label: '系统临时文件',
    description: '.DS_Store、Thumbs.db 等',
    recommended: true,
    patterns: SYSTEM_PATTERNS
  },
  {
    id: 'archive',
    label: '压缩包',
    description: 'zip、7z、rar、tar、gz',
    // 知识库常把压缩资料当正文附件，默认不勾选，避免新建时静默漏管
    recommended: false,
    patterns: ARCHIVE_PATTERNS
  },
  {
    id: 'installer',
    label: '安装包',
    description: 'exe、msi、dmg、AppImage',
    recommended: false,
    patterns: INSTALLER_PATTERNS
  },
  {
    id: 'office',
    label: 'PDF 与办公文档',
    description: 'PDF、Word、Excel、PowerPoint',
    recommended: false,
    patterns: OFFICE_PATTERNS
  },
  {
    id: 'video',
    label: '视频',
    description: 'mp4、mov、mkv、avi',
    recommended: false,
    patterns: VIDEO_PATTERNS
  },
  {
    id: 'design',
    label: '设计源文件',
    description: 'PSD、AI、Sketch、Figma',
    recommended: false,
    patterns: DESIGN_PATTERNS
  },
  {
    id: 'node',
    label: 'Node 依赖',
    description: 'node_modules',
    recommended: true,
    patterns: NODE_PATTERNS
  },
  {
    id: 'python',
    label: 'Python 依赖与缓存',
    description: '虚拟环境、字节码、测试缓存',
    recommended: true,
    patterns: PYTHON_PATTERNS
  },
  {
    id: 'build',
    label: '构建与测试产物',
    description: 'dist、build、coverage 等',
    recommended: false,
    patterns: BUILD_PATTERNS
  },
  {
    id: 'editor',
    label: '编辑器临时文件',
    description: '交换文件、本地历史',
    recommended: true,
    patterns: EDITOR_PATTERNS
  },
  {
    id: 'ide',
    label: 'IDE 配置',
    description: '.idea、.vscode',
    recommended: false,
    patterns: IDE_PATTERNS
  },
  {
    id: 'app-state',
    label: '应用生成物',
    description: '保留 .multichat 配置与导图，只忽略产物',
    recommended: true,
    patterns: APP_STATE_PATTERNS
  },
  {
    id: 'obsidian-state',
    label: 'Obsidian 本地状态',
    description: '保留设置与插件，只忽略窗口布局和缓存',
    recommended: true,
    patterns: OBSIDIAN_STATE_PATTERNS
  }
]

/** 新建工作区时写入的常规忽略项：只包含默认勾选的组 */
export const DEFAULT_GITIGNORE_PATTERNS = GITIGNORE_CATEGORIES
  .filter(category => category.recommended)
  .flatMap(category => category.patterns)

const DEFAULT_GITIGNORE_LINES = GITIGNORE_CATEGORIES
  .filter(category => category.recommended)
  .flatMap(category => [`# ${category.label}`, ...category.patterns, ''])

export const DEFAULT_GITIGNORE = `${DEFAULT_GITIGNORE_LINES.join('\n').trimEnd()}\n`

export async function readGitignore(workspaceRoot: string): Promise<GitignoreSnapshot> {
  const filePath = path.join(workspaceRoot, '.gitignore')
  let content: string
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return { exists: false, entries: [] }
    content = await readFile(filePath, 'utf-8')
  } catch {
    return { exists: false, entries: [] }
  }

  const entries: GitignoreEntry[] = []
  let pendingComment: string | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      // 条目之间的空行不再保留，写回时按统一格式重排
      pendingComment = null
      continue
    }
    if (line.startsWith('#')) {
      pendingComment = line
      continue
    }
    // 允许 `!` 取反、`/` 锚定等所有合法写法，只做空白归一
    entries.push({ pattern: line, comment: pendingComment })
    pendingComment = null
  }

  return { exists: true, entries }
}

/**
 * 写回 .gitignore。
 * 采用行级差异：只删除被移除的规则行、在末尾追加新规则，
 * 不重排用户已有内容，也不丢弃注释与空行，降低误改用户文件的风险。
 * 列表顺序可能与文件顺序不同，但 Git 规则本身与顺序无关（取反规则也按原行位置保留）。
 */
export async function writeGitignore(
  workspaceRoot: string,
  entries: GitignoreEntry[]
): Promise<void> {
  const filePath = path.join(workspaceRoot, '.gitignore')
  let original = ''
  try {
    original = await readFile(filePath, 'utf-8')
  } catch {
    original = ''
  }
  const hadTrailingNewline = !original || original.endsWith('\n')
  const originalLines = original.split(/\r?\n/)
  if (originalLines.length && originalLines[originalLines.length - 1] === '') originalLines.pop()

  const desiredCounts = new Map<string, number>()
  for (const entry of entries) {
    const pattern = entry.pattern.trim()
    if (pattern) desiredCounts.set(pattern, (desiredCounts.get(pattern) ?? 0) + 1)
  }

  // 按“行”保留：同一模式在文件中出现多次时，只有目标列表里也重复才全部保留；
  // 已保留的规则不参与“追加”，否则删除后重加同一条会被误判为已存在。
  const allowedCounts = new Map(desiredCounts)
  const kept = new Set<string>()
  const nextLines = originalLines.filter((raw) => {
    const pattern = raw.trim()
    if (!pattern || pattern.startsWith('#')) return true
    const allowed = allowedCounts.get(pattern) ?? 0
    if (allowed <= 0) return false
    allowedCounts.set(pattern, allowed - 1)
    kept.add(pattern)
    return true
  })

  const additions: string[] = []
  for (const entry of entries) {
    const pattern = entry.pattern.trim()
    if (!pattern) continue
    if (kept.has(pattern)) continue
    const added = additions.filter(item => item === pattern).length
    if (added >= (desiredCounts.get(pattern) ?? 0)) continue
    if (entry.comment && !nextLines.includes(entry.comment)) additions.push(entry.comment)
    additions.push(pattern)
  }

  let appended = false
  let content = nextLines.join('\n')
  if (additions.length) {
    if (content) content += '\n\n'
    content += additions.join('\n')
    appended = true
  }
  if (content && (hadTrailingNewline || appended)) content += '\n'
  await writeTextFileSafely(filePath, content)
}

/**
 * 追加缺失的规则，保留用户已有内容与顺序。
 * 已存在的模式不会重复写入，因此可以安全地在初始化仓库时补齐常规忽略项。
 */
export async function appendGitignorePatterns(
  workspaceRoot: string,
  patterns: string[],
  comment?: string
): Promise<{ added: string[] }> {
  const filePath = path.join(workspaceRoot, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(filePath, 'utf-8')
  } catch {
    existing = ''
  }

  const current = new Set(
    existing
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  )
  const added = patterns.filter(pattern => !current.has(pattern))
  if (!added.length) return { added }

  const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
  const separator = existing ? '\n' : ''
  const block = `${comment ? `${comment}\n` : ''}${added.join('\n')}\n`
  await writeTextFileSafely(filePath, `${existing}${prefix}${separator}${block}`)
  return { added }
}


