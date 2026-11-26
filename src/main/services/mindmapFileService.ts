
import path from 'path'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { assertSafePath } from './workbenchService'
import { validateMindmapMarkdown } from '../../shared/utils/mindmapEdits'
import {
  MINDMAPS_DIR,
  MINDMAP_FILE_LIMIT,
  MINDMAP_FILE_SIZE_LIMIT,
  MINDMAP_FILE_SUFFIX,
  MINDMAP_NODE_TEXT_LIMIT,
  hasIllegalContentCharacters,
  isMindmapId,
  type MindmapFileFields,
  parseMindmapFile,
  serializeMindmapFile,
  sanitizeMindmapFileName
} from '../../shared/utils/mindmapFile'
import { normalizeMindmapNewlines } from '../../shared/utils/mindmapEdits'

export interface ScannedMindmapFile {
  relativePath: string
  id: string
  source?: string
  title?: string
  updatedAt?: number
  mtimeMs?: number
  body: string
}

export interface MindmapScanResult {
  files: ScannedMindmapFile[]
  overflow: boolean
  unreadable: string[]
}

const decoder = new TextDecoder('utf-8', { fatal: true })

function mindmapsDir(root: string): string {
  return path.join(root, MINDMAPS_DIR)
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

export function mindmapFileNameOf(relativePath: string): string | null {
  const normalized = relativePath.split('\\').join('/')
  if (!normalized.startsWith(`${MINDMAPS_DIR}/`)) return null
  const rest = normalized.slice(MINDMAPS_DIR.length + 1)
  if (!rest || rest.includes('/')) return null
  if (!rest.endsWith(MINDMAP_FILE_SUFFIX)) return null
  return rest
}

export async function readMindmapFile(root: string, relativePath: string): Promise<ScannedMindmapFile> {
  const name = mindmapFileNameOf(relativePath)
  if (!name) throw new Error('导图文件必须位于 .multichat/mindmaps 根层')
  const abs = await assertSafePath(root, relativePath)
  const info = await lstat(abs)
  if (!info.isFile()) throw new Error('目标不是普通文件')
  if (info.size > MINDMAP_FILE_SIZE_LIMIT) throw new Error(`导图文件超过 ${MINDMAP_FILE_SIZE_LIMIT / 1024 / 1024}MB 上限`)
  const buffer = await readFile(abs)
  // UTF-16 文件用 fatal UTF-8 解码会直接抛错，先给出明确提示。
  if (buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) {
    throw new Error('不支持 UTF-16 编码的导图文件')
  }
  let text: string
  try {
    text = decoder.decode(buffer)
  } catch {
    throw new Error('导图文件必须是 UTF-8 编码')
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (hasIllegalContentCharacters(text)) throw new Error('导图文件含非法控制字符')
  const parsed = parseMindmapFile(text)
  const id = parsed.frontmatter.id
  if (!isMindmapId(id)) throw new Error('导图文件缺少合法的 id')
  const source = parsed.frontmatter.source
  const title = parsed.frontmatter.title ?? ''
  const updatedAt = parsed.frontmatter.updatedAt
  const body = normalizeMindmapNewlines(parsed.body)
  return { relativePath: toPosix(path.relative(root, abs)), id, source, title, updatedAt, mtimeMs: info.mtimeMs, body }
}

export function validateImportedBody(body: string): void {
  validateMindmapMarkdown(body)
  for (const line of normalizeMindmapNewlines(body).split('\n')) {
    const text = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()
    if (text.length > MINDMAP_NODE_TEXT_LIMIT) {
      throw new Error(`导图含超过 ${MINDMAP_NODE_TEXT_LIMIT} 字符的节点`)
    }
  }
}

export async function scanMindmapFiles(root: string): Promise<MindmapScanResult> {
  const dir = mindmapsDir(root)
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return { files: [], overflow: false, unreadable: [] }
  }
  // 只扫一层。子目录里的导图不属于当前索引：单独列进 unreadable，
  // 否则面板会显示成“这篇文档没有导图”，用户以为文件丢了。
  const nested: string[] = []
  const candidates: string[] = []
  const findNested = async (relativeDir: string, depth: number): Promise<void> => {
    if (depth > 3) return
    let inner: import('fs').Dirent[]
    try {
      inner = await readdir(path.join(root, relativeDir), { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    if (inner.some(item => item.isFile() && item.name.endsWith(MINDMAP_FILE_SUFFIX))) {
      nested.push(relativeDir)
      return
    }
    for (const item of inner) {
      if (item.isDirectory()) await findNested(`${relativeDir}/${item.name}`, depth + 1)
    }
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(MINDMAP_FILE_SUFFIX)) { candidates.push(entry.name); continue }
    if (!entry.isDirectory()) continue
    await findNested(`${MINDMAPS_DIR}/${entry.name}`, 0)
  }
  if (candidates.length > MINDMAP_FILE_LIMIT) {
    return { files: [], overflow: true, unreadable: [] }
  }
  const files: ScannedMindmapFile[] = []
  const unreadable: string[] = []
  for (const name of candidates) {
    try {
      const abs = await assertSafePath(root, `${MINDMAPS_DIR}/${name}`)
      const info = await lstat(abs)
      if (!info.isFile()) continue
      if (info.size > MINDMAP_FILE_SIZE_LIMIT) {
        unreadable.push(`${MINDMAPS_DIR}/${name}`)
        continue
      }
      const buffer = await readFile(abs)
      const text = decoder.decode(buffer)
      // 与 readMindmapFile 保持同一套可读性判断：含控制字符的文件若进索引，
      // 保存时会表现为“文件已不存在”，用户无从判断原因。
      if (hasIllegalContentCharacters(text)) {
        unreadable.push(`${MINDMAPS_DIR}/${name}`)
        continue
      }
      const parsed = parseMindmapFile(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
      if (!isMindmapId(parsed.frontmatter.id)) {
        unreadable.push(`${MINDMAPS_DIR}/${name}`)
        continue
      }
      files.push({
        relativePath: `${MINDMAPS_DIR}/${name}`,
        id: parsed.frontmatter.id,
        source: parsed.frontmatter.source,
        title: parsed.frontmatter.title ?? '',
        updatedAt: parsed.frontmatter.updatedAt,
        mtimeMs: info.mtimeMs,
        body: normalizeMindmapNewlines(parsed.body)
      })
    } catch {
      unreadable.push(`${MINDMAPS_DIR}/${name}`)
    }
  }
  return { files, overflow: false, unreadable: [...nested, ...unreadable] }
}

export async function allocateMindmapFileName(root: string, docBaseName: string, selfId: string): Promise<string> {
  const stem = sanitizeMindmapFileName(docBaseName)
  let candidate = `${stem}${MINDMAP_FILE_SUFFIX}`
  let counter = 2
  for (;;) {
    const abs = path.join(mindmapsDir(root), candidate)
    try {
      const info = await lstat(abs)
      if (!info.isFile()) return candidate
      try {
        const existing = await readMindmapFile(root, `${MINDMAPS_DIR}/${candidate}`)
        if (existing.id === selfId) return candidate
      } catch {
        // 无法解析的占用名同样跳过
      }
      candidate = `${stem} (${counter})${MINDMAP_FILE_SUFFIX}`
      counter++
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw err
    }
  }
}

export async function writeMindmapFile(
  root: string,
  fileName: string,
  fields: MindmapFileFields,
  body: string
): Promise<string> {
  if (!mindmapFileNameOf(`${MINDMAPS_DIR}/${fileName}`)) throw new Error('导图文件名非法')
  const dir = mindmapsDir(root)
  await mkdir(dir, { recursive: true })
  const abs = await assertSafePath(root, `${MINDMAPS_DIR}/${fileName}`)
  const tmp = `${abs}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, serializeMindmapFile(fields, body), 'utf8')
    await rename(tmp, abs)
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
  return `${MINDMAPS_DIR}/${fileName}`
}

export async function rewriteMindmapFileSource(root: string, relativePath: string, next: { source: string; title?: string }): Promise<string> {
  const file = await readMindmapFile(root, relativePath)
  const fields: MindmapFileFields = {
    id: file.id,
    source: next.source,
    title: next.title ?? file.title ?? '',
    updatedAt: file.updatedAt
  }
  const abs = await assertSafePath(root, relativePath)
  const tmp = `${abs}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, serializeMindmapFile(fields, file.body), 'utf8')
    await rename(tmp, abs)
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
  return relativePath
}

export async function renameMindmapFile(root: string, fromRelativePath: string, toFileName: string): Promise<string> {
  const from = await assertSafePath(root, fromRelativePath)
  const to = await assertSafePath(root, `${MINDMAPS_DIR}/${toFileName}`)
  try {
    await lstat(to)
    throw new Error(`目标路径已存在: ${toFileName}`)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await rename(from, to)
  return `${MINDMAPS_DIR}/${toFileName}`
}

export async function removeMindmapFile(root: string, relativePath: string): Promise<void> {
  const abs = await assertSafePath(root, relativePath)
  await rm(abs, { force: true })
}

export async function tryReadMindmapFile(root: string, relativePath: string): Promise<ScannedMindmapFile | null> {
  try {
    return await readMindmapFile(root, relativePath)
  } catch {
    return null
  }
}
