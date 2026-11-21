/**
 * 标注旁路存储。
 * - source：固定默认工作区 `.multichat/annotations/sources/<hash>.json`
 * - document：文档所在工作区 `.multichat/annotations/documents/<hash>.json`
 * 标注不进正文；所有写入按 scope + root + key 串行，按 id 合并。
 */

import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import path from 'path'
import type {
  Annotation,
  AnnotationSource,
  DocumentAnnotationFile,
  DocumentAnnotationRef,
  SourceAnnotationFile
} from '../../shared/types/annotations'
import {
  ANNOTATION_MAX_FILE_BYTES,
  ANNOTATION_MAX_PER_FILE,
  normalizeAnnotation
} from '../../shared/utils/annotationAnchors'

const ANNOTATION_DIR = '.multichat/annotations'
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

export class AnnotationLimitError extends Error {}
export class AnnotationCorruptError extends Error {}

const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 32)
const rootKey = (root: string): string => {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
const posix = (value: string): string => value.split(path.sep).join('/')

const locks = new Map<string, Promise<unknown>>()
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.then(operation, operation)
  locks.set(key, next.then(() => undefined, () => undefined))
  return next
}

async function atomicWrite(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const text = JSON.stringify(value, null, 2)
  if (Buffer.byteLength(text, 'utf8') > ANNOTATION_MAX_FILE_BYTES) {
    throw new AnnotationLimitError('标注文件超过 2MB 上限，请导出或拆分')
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new AnnotationCorruptError(`标注文件损坏：${filePath}`)
  }
}

const sourceFile = (root: string, sourceKey: string): string =>
  path.join(root, ANNOTATION_DIR, 'sources', `${sha1(sourceKey)}.json`)
/** 会话快照 sidecar：补文档时复用原始 XML 快照，避免把已转换的 Markdown 二次包装。 */
const sourceSnapshotFile = (root: string, sourceKey: string): string =>
  path.join(root, ANNOTATION_DIR, 'sources', `${sha1(sourceKey)}.snapshot.md`)
const documentFile = (root: string, relativePath: string): string =>
  path.join(root, ANNOTATION_DIR, 'documents', `${sha1(relativePath)}.json`)

function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new Error('标注 ID 必须是 UUID')
}

function assertSourceKey(sourceKey: string): void {
  if (!sourceKey || typeof sourceKey !== 'string' || sourceKey.length > 4096) {
    throw new Error('会话来源无效')
  }
}

function mergeAnnotations(
  existing: Annotation[],
  incoming: Annotation[],
  now: number
): Annotation[] {
  const byId = new Map(existing.map(item => [item.id, item]))
  for (const item of incoming) {
    assertUuid(item.id)
    const previous = byId.get(item.id)
    if (!previous || item.updatedAt >= previous.updatedAt) byId.set(item.id, item)
  }
  const values = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  if (values.length > ANNOTATION_MAX_PER_FILE) {
    throw new AnnotationLimitError(`单篇文档最多 ${ANNOTATION_MAX_PER_FILE} 条标注`)
  }
  void now
  return values
}

export async function listDocumentAnnotations(
  ref: DocumentAnnotationRef
): Promise<{ annotations: Annotation[]; file: DocumentAnnotationFile | null }> {
  const relativePath = posix(ref.relativePath)
  const file = await readJson<DocumentAnnotationFile>(documentFile(ref.workspaceRoot, relativePath))
  if (!file) return { annotations: [], file: null }
  if (!Array.isArray(file.annotations)) throw new AnnotationCorruptError('文档标注文件结构无效')
  return { annotations: file.annotations.filter(item => item.scope === 'document'), file }
}

/**
 * 读取文档标注并处理外部改名：新路径 hash → relativePath 扫描 → contentHash+size+mtime 唯一候选。
 * 文档不存在或无法唯一认领时返回原路径的空结果，标注文件保留。
 */
export async function listDocumentAnnotationsWithRecovery(
  ref: DocumentAnnotationRef
): Promise<{ annotations: Annotation[]; file: DocumentAnnotationFile | null }> {
  const relativePath = posix(ref.relativePath)
  const fingerprint = await fingerprintOf(ref.workspaceRoot, relativePath)
  const found = await findDocumentAnnotationFile(ref.workspaceRoot, relativePath, fingerprint)
  if (!found) return { annotations: [], file: null }
  if (!Array.isArray(found.annotations)) throw new AnnotationCorruptError('文档标注文件结构无效')
  return { annotations: found.annotations.filter(item => item.scope === 'document'), file: found }
}

/** 文档指纹：contentHash 判断“正文是否变过”，size/mtime 只用于外部改名预筛。 */
async function fingerprintOf(
  workspaceRoot: string,
  relativePath: string
): Promise<{ contentHash?: string; size?: number; mtime?: number } | undefined> {
  try {
    const absolute = path.join(workspaceRoot, relativePath)
    const info = await stat(absolute)
    if (!info.isFile()) return undefined
    const content = await readFile(absolute, 'utf8')
    return {
      contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      size: info.size,
      mtime: Math.round(info.mtimeMs)
    }
  } catch {
    // 文档暂时不可读时不认领，保留旁路文件
    return undefined
  }
}

export async function upsertDocumentAnnotation(
  ref: DocumentAnnotationRef,
  annotation: Annotation,
  fingerprint?: { contentHash?: string; size?: number; mtime?: number }
): Promise<Annotation> {
  const relativePath = posix(ref.relativePath)
  assertUuid(annotation.id)
  const normalized = normalizeAnnotation(annotation, 'document')
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  return serial(key, async () => {
    const filePath = documentFile(ref.workspaceRoot, relativePath)
    const current = await readJson<DocumentAnnotationFile>(filePath)
    const now = Date.now()
    // 调用方没给指纹时按磁盘现状补一次，保证外部改名后仍能按内容哈希找回。
    const nextFingerprint = fingerprint ?? (await fingerprintOf(ref.workspaceRoot, relativePath))
    const next: DocumentAnnotationFile = {
      version: 1,
      document: {
        relativePath,
        contentHash: nextFingerprint?.contentHash ?? current?.document.contentHash,
        size: nextFingerprint?.size ?? current?.document.size,
        mtime: nextFingerprint?.mtime ?? current?.document.mtime,
        updatedAt: now
      },
      annotations: mergeAnnotations(current?.annotations ?? [], [normalized], now)
    }
    await atomicWrite(filePath, next)
    return normalized
  })
}

export async function deleteDocumentAnnotation(ref: DocumentAnnotationRef, id: string): Promise<void> {
  assertUuid(id)
  const relativePath = posix(ref.relativePath)
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  await serial(key, async () => {
    const filePath = documentFile(ref.workspaceRoot, relativePath)
    const current = await readJson<DocumentAnnotationFile>(filePath)
    if (!current) return
    const next = { ...current, annotations: current.annotations.filter(item => item.id !== id) }
    await atomicWrite(filePath, next)
  })
}

/** 文档重命名/移动时搬旁路文件；目标已存在时按 id 合并，不覆盖。 */
export async function rekeyDocumentAnnotations(
  workspaceRoot: string,
  oldRelativePath: string,
  newRelativePath: string
): Promise<void> {
  const from = posix(oldRelativePath)
  const to = posix(newRelativePath)
  if (from === to) return
  await serial(`document\n${rootKey(workspaceRoot)}\n${to}`, async () => {
    const sourcePath = documentFile(workspaceRoot, from)
    const targetPath = documentFile(workspaceRoot, to)
    const source = await readJson<DocumentAnnotationFile>(sourcePath)
    if (!source) return
    const target = await readJson<DocumentAnnotationFile>(targetPath)
    const now = Date.now()
    await atomicWrite(targetPath, {
      version: 1,
      document: { ...source.document, relativePath: to, updatedAt: now },
      annotations: mergeAnnotations(target?.annotations ?? [], source.annotations, now)
    })
    await rm(sourcePath, { force: true })
  })
}

/** 删除文档时删除 document 旁路；source 不受影响。 */
export async function removeDocumentAnnotations(
  workspaceRoot: string,
  relativePath: string
): Promise<void> {
  await rm(documentFile(workspaceRoot, posix(relativePath)), { force: true })
}

/**
 * 外部改名找回：新路径 hash → relativePath 扫描 → contentHash+size+mtime 唯一候选。
 * 返回命中的文件内容；不唯一时返回 null，绝不猜测。
 */
export async function findDocumentAnnotationFile(
  workspaceRoot: string,
  relativePath: string,
  fingerprint?: { contentHash?: string; size?: number; mtime?: number }
): Promise<DocumentAnnotationFile | null> {
  const target = posix(relativePath)
  const direct = await readJson<DocumentAnnotationFile>(documentFile(workspaceRoot, target))
  if (direct) {
    if (!fingerprint?.contentHash || !direct.document.contentHash || direct.document.contentHash === fingerprint.contentHash) {
      if (direct.document.relativePath !== target) {
        direct.document.relativePath = target
        await atomicWrite(documentFile(workspaceRoot, target), direct)
      }
      return direct
    }
  }

  const dir = path.join(workspaceRoot, ANNOTATION_DIR, 'documents')
  let names: string[]
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json'))
  } catch {
    return null
  }
  const directPath = documentFile(workspaceRoot, target)
  const candidates: Array<{ file: DocumentAnnotationFile; filePath: string }> = []
  for (const name of names) {
    const filePath = path.join(dir, name)
    try {
      const file = await readJson<DocumentAnnotationFile>(filePath)
      if (!file) continue
      // 路径被另一篇文档复用时，内容不一致不能直接套用旧标注。
      if (filePath === directPath && fingerprint?.contentHash && file.document.contentHash !== fingerprint.contentHash) continue
      if (file.document.relativePath === target) candidates.push({ file, filePath })
    } catch {
      // 单个损坏文件不影响其他文档
    }
  }
  if (!candidates.length && fingerprint?.contentHash) {
    for (const name of names) {
      const filePath = path.join(dir, name)
      try {
        const file = await readJson<DocumentAnnotationFile>(filePath)
        if (!file) continue
        if (file.document.contentHash !== fingerprint.contentHash) continue
        if (fingerprint.size !== undefined && file.document.size !== undefined && file.document.size !== fingerprint.size) continue
        if (fingerprint.mtime !== undefined && file.document.mtime !== undefined && file.document.mtime !== fingerprint.mtime) continue
        candidates.push({ file, filePath })
      } catch {
        // ignore corrupt
      }
    }
  }
  if (candidates.length !== 1) return null
  const hit = candidates[0]
  const next: DocumentAnnotationFile = {
    ...hit.file,
    document: {
      ...hit.file.document,
      relativePath: target,
      contentHash: fingerprint?.contentHash ?? hit.file.document.contentHash,
      size: fingerprint?.size ?? hit.file.document.size,
      mtime: fingerprint?.mtime ?? hit.file.document.mtime,
      updatedAt: Date.now()
    }
  }
  await atomicWrite(documentFile(workspaceRoot, target), next)
  if (hit.filePath !== documentFile(workspaceRoot, target)) {
    await rm(hit.filePath, { force: true }).catch(() => undefined)
  }
  return next
}

/** 重新对账：只更新 document 标注的 quote/anchor，不碰 source。 */
export async function reconcileDocumentAnnotations(
  ref: DocumentAnnotationRef,
  anchors: Array<Pick<Annotation, 'id' | 'quote' | 'anchor'>>
): Promise<{ updated: number }> {
  const relativePath = posix(ref.relativePath)
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  return serial(key, async () => {
    const filePath = documentFile(ref.workspaceRoot, relativePath)
    const current = await readJson<DocumentAnnotationFile>(filePath)
    if (!current) return { updated: 0 }
    const incoming = new Map(anchors.map(item => [item.id, item]))
    let updated = 0
    const now = Date.now()
    const annotations = current.annotations.map(item => {
      if (item.scope !== 'document') return item
      const next = incoming.get(item.id)
      if (!next) return item
      updated += 1
      return {
        ...item,
        quote: String(next.quote || item.quote).slice(0, 20_000),
        anchor: normalizeAnnotation({ ...item, quote: next.quote, anchor: next.anchor }, 'document', now).anchor,
        updatedAt: now
      }
    })
    await atomicWrite(filePath, {
      ...current,
      document: { ...current.document, updatedAt: now },
      annotations
    })
    return { updated }
  })
}

export async function listSourceAnnotations(
  defaultWorkspaceRoot: string,
  sourceKey: string
): Promise<{ source: AnnotationSource | null; annotations: Annotation[] }> {
  assertSourceKey(sourceKey)
  const file = await readJson<SourceAnnotationFile>(sourceFile(defaultWorkspaceRoot, sourceKey))
  if (!file) return { source: null, annotations: [] }
  if (!Array.isArray(file.annotations)) throw new AnnotationCorruptError('原文标注文件结构无效')
  return {
    source: file.source ?? null,
    annotations: file.annotations.filter(item => item.scope === 'source')
  }
}

export async function upsertSourceAnnotation(
  defaultWorkspaceRoot: string,
  sourceKey: string,
  source: AnnotationSource,
  annotation: Annotation,
  snapshot?: string
): Promise<Annotation> {
  assertSourceKey(sourceKey)
  assertUuid(annotation.id)
  if (source.key !== sourceKey) throw new Error('来源身份不一致')
  const normalized = normalizeAnnotation({ ...annotation, source }, 'source')
  const key = `source\n${rootKey(defaultWorkspaceRoot)}\n${sourceKey}`
  return serial(key, async () => {
    const filePath = sourceFile(defaultWorkspaceRoot, sourceKey)
    const current = await readJson<SourceAnnotationFile>(filePath)
    // 同一 annotationId 不允许跨会话复用：重试必须落在同一个 sourceKey 上。
    if (!current?.annotations.some(item => item.id === annotation.id)) {
      const owner = await findSourceKeyForAnnotationId(defaultWorkspaceRoot, annotation.id, sourceKey)
      if (owner) throw new Error('该标注 ID 已属于另一个会话')
    }
    const now = Date.now()
    const next: SourceAnnotationFile = {
      version: 1,
      source: source,
      annotations: mergeAnnotations(current?.annotations ?? [], [normalized], now)
    }
    await atomicWrite(filePath, next)
    if (typeof snapshot === 'string' && snapshot.trim()) {
      await writeFile(sourceSnapshotFile(defaultWorkspaceRoot, sourceKey), snapshot, 'utf8').catch(() => undefined)
    }
    return normalized
  })
}

/** 扫描其他 source 文件是否已占用该标注 id；先做字符串预筛，命中后再解析。 */
async function findSourceKeyForAnnotationId(
  defaultWorkspaceRoot: string,
  annotationId: string,
  currentSourceKey: string
): Promise<string | null> {
  const dir = path.join(defaultWorkspaceRoot, ANNOTATION_DIR, 'sources')
  let names: string[]
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json'))
  } catch {
    return null
  }
  const currentFile = `${sha1(currentSourceKey)}.json`
  for (const name of names) {
    if (name === currentFile) continue
    try {
      const raw = await readFile(path.join(dir, name), 'utf8')
      if (!raw.includes(annotationId)) continue
      const file = JSON.parse(raw) as SourceAnnotationFile
      if (file.annotations?.some(item => item.id === annotationId)) return file.source?.key ?? name
    } catch {
      // 单个损坏文件不阻断写入
    }
  }
  return null
}

/** capture 时保存原始 XML 快照，供 ensureDocument 补文档时复用。 */
export async function saveSourceSnapshot(
  defaultWorkspaceRoot: string,
  sourceKey: string,
  snapshot: string
): Promise<void> {
  if (!snapshot.trim()) return
  const filePath = sourceSnapshotFile(defaultWorkspaceRoot, sourceKey)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, snapshot, 'utf8')
}

/** 读取 capture 时保存的原始快照；没有 sidecar 返回空串。 */
export async function readSourceSnapshot(defaultWorkspaceRoot: string, sourceKey: string): Promise<string> {
  try {
    return await readFile(sourceSnapshotFile(defaultWorkspaceRoot, sourceKey), 'utf8')
  } catch {
    return ''
  }
}

export async function deleteSourceAnnotation(
  defaultWorkspaceRoot: string,
  sourceKey: string,
  id: string
): Promise<void> {
  assertSourceKey(sourceKey)
  assertUuid(id)
  const key = `source\n${rootKey(defaultWorkspaceRoot)}\n${sourceKey}`
  await serial(key, async () => {
    const filePath = sourceFile(defaultWorkspaceRoot, sourceKey)
    const current = await readJson<SourceAnnotationFile>(filePath)
    if (!current) return
    await atomicWrite(filePath, {
      ...current,
      annotations: current.annotations.filter(item => item.id !== id)
    })
  })
}

/** 给 conversationDocumentService 用：source 文件是否存在，决定 ensureDocument 能否建文档。 */
export async function hasSourceAnnotations(defaultWorkspaceRoot: string, sourceKey: string): Promise<boolean> {
  return stat(sourceFile(defaultWorkspaceRoot, sourceKey)).then(() => true, () => false)
}
