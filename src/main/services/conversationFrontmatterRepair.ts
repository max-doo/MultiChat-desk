/**
 * 已迁移会话文档的一次性字段收敛。
 *
 * 只处理带 `source_kind: conversation` 的 Markdown，且必须由旧迁移记录指向；
 * 正文逐字保留。写前在同目录 `.multichat/frontmatter-backup/` 留一份原文，
 * 不触碰旧笔记 JSON 和 `.migration-backup`。
 */

import { constants } from 'fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import type { NoteConversation } from '../../shared/types/notes'
import {
  adoptLegacyConversationFrontmatter,
  normalizeConversationFrontmatter
} from '../../shared/utils/conversationFrontmatter'

export interface FrontmatterRepairResult {
  scanned: number
  rewritten: number
  unchanged: number
  failed: number
  backups: string[]
  errors: Array<{ relativePath: string; error: string }>
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * 修复旧迁移产生的会话文档。
 *
 * 两类目标：
 * - 带 workbench 路径的记录：精确指向该文档；
 * - 普通会话记录：只扫描迁移目标目录，要求 source URL 精确匹配，
 *   且同一 URL 只能有一个标题相同的候选，否则跳过。
 * 正文逐字保留，普通 Markdown 不参与。
 */
export async function repairMigratedConversationFrontmatter(
  records: NoteConversation[],
  root: string,
  conversationDir = 'conversations'
): Promise<FrontmatterRepairResult> {
  const result: FrontmatterRepairResult = {
    scanned: 0,
    rewritten: 0,
    unchanged: 0,
    failed: 0,
    backups: [],
    errors: []
  }
  const seen = new Set<string>()
  const workbenchRecords = records.filter(
    record => !!record.workbench?.relativePath && !!record.migratedAt && !record.migrationBlocked
  )

  for (const conversation of workbenchRecords) {
    const workbench = conversation.workbench
    if (!workbench?.relativePath) continue
    if (!/\.md$/i.test(workbench.relativePath)) continue
    const documentRoot = conversation.migratedTo || workbench.workspaceRoot
    if (!documentRoot) continue
    const relativePath = workbench.relativePath
    await repairFile(documentRoot, relativePath, result, seen)
  }

  // 普通会话迁移记录没有 relativePath。按迁移目标目录 + 来源 URL + 标题
  // 唯一定位，避免把同一会话的其它副本或用户手写文档一起改写。
  const wanted = new Map<string, { title: string; migratedAt?: number }>()
  for (const record of records) {
    if (record.workbench?.relativePath || !record.migratedAt || record.migrationBlocked) continue
    const url = (record.url || '').trim()
    if (!url) continue
    wanted.set(url, { title: record.title.trim(), migratedAt: record.migratedAt })
  }
  if (wanted.size) {
    const dir = path.join(root, conversationDir)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      entries = []
    }
    const byUrl = new Map<string, string[]>()
    for (const entry of entries) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue
      const relativePath = path.posix.join(conversationDir, entry.name)
      try {
        const content = await readFile(path.join(root, relativePath), 'utf8')
        const frontmatter = content.match(FRONTMATTER_RE)?.[1] ?? ''
        if (!/^source_kind\s*:\s*["']?conversation["']?\s*$/im.test(frontmatter)) continue
        // 旧迁移文档可能只有 source_key/source_url，没有 source。
        const values = [
          /^source\s*:\s*(.+)$/im.exec(frontmatter)?.[1],
          /^source_url\s*:\s*(.+)$/im.exec(frontmatter)?.[1],
          /^source_key\s*:\s*(.+)$/im.exec(frontmatter)?.[1]
        ]
          .filter((value): value is string => !!value)
          .map(value => value.trim().replace(/^["']|["']$/g, ''))
        const source = values.find(value => wanted.has(value))
        if (!source) continue
        byUrl.set(source, [...(byUrl.get(source) ?? []), relativePath])
      } catch {
        // 单文件读取失败不阻断其它候选
      }
    }
    for (const [url, paths] of byUrl) {
      if (paths.length !== 1) continue
      const record = wanted.get(url)
      if (!record) continue
      // 标题匹配只是最后一道保护；不匹配说明该目录里可能有用户另建的文档。
      const content = await readFile(path.join(root, paths[0]), 'utf8').catch(() => '')
      const heading = content.split(/\r?\n/).find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim() ?? ''
      const normalizedHeading = heading.replace(/^[^-·:]+[-·:]\s*/, '').trim()
      if (record.title && normalizedHeading !== record.title && heading !== record.title) continue
      await repairFile(root, paths[0], result, seen)
    }
  }
  return result
}

async function repairFile(
  root: string,
  relativePath: string,
  result: FrontmatterRepairResult,
  seen: Set<string>
): Promise<void> {
    const key = `${path.resolve(root).toLowerCase()}\n${relativePath.replace(/\\/g, '/').toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    result.scanned += 1
    const absolutePath = path.resolve(root, relativePath)
    try {
      const content = await readFile(absolutePath, 'utf8')
      // 普通 Markdown 和用户自己的文档不碰。
      const frontmatter = content.match(FRONTMATTER_RE)?.[1] ?? ''
      const declared = /^source_kind\s*:\s*["']?conversation["']?\s*$/im.test(frontmatter)
      // 旧迁移文档可能漏写 source_kind；只有迁移记录明确指向它时才补类型。
      const next = declared
        ? normalizeConversationFrontmatter(content)
        : adoptLegacyConversationFrontmatter(content)
      if (next === content) {
        result.unchanged += 1
        return
      }
      const backupRelativePath = path.posix.join(
        '.multichat',
        'frontmatter-backup',
        `${relativePath.replace(/\\/g, '/')}.bak`
      )
      const backupPath = path.join(root, backupRelativePath)
      await mkdir(path.dirname(backupPath), { recursive: true })
      // 已有备份说明这是第二次改写：保留最初那份原文，不能用“已修复内容”覆盖它。
      await copyFile(absolutePath, backupPath, constants.COPYFILE_EXCL).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      const temporary = `${absolutePath}.${Date.now()}.tmp`
      try {
        await writeFile(temporary, next, 'utf8')
        await rename(temporary, absolutePath)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
      result.rewritten += 1
      result.backups.push(backupRelativePath)
    } catch (error) {
      result.failed += 1
      result.errors.push({
        relativePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
}

