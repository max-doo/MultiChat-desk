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
  AnnotationAnchor,
  AnnotationAnchorState,
  AnnotationSource,
  DocumentReconcileResult,
  DocumentResolution,
  DocumentAnnotationFile,
  DocumentAnnotationRef,
  SourceAnnotationFile
} from '../../shared/types/annotations'
import {
  ANNOTATION_MAX_FILE_BYTES,
  ANNOTATION_MAX_PER_FILE,
  ANNOTATION_MAX_TEXT,
  normalizeAnnotation
} from '../../shared/utils/annotationAnchors'
import { getFileCategory } from '../../shared/types/workbench'

const ANNOTATION_DIR = '.multichat/annotations'
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
/** 标注内容指纹读取上限（5MB）：避免大文本或二进制文件引发主进程 OOM/卡顿 */
const MAX_ANNOTATION_TEXT_BYTES = 5 * 1024 * 1024

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
  const stored = next.then(() => undefined, () => undefined)
  locks.set(key, stored)
  void stored.finally(() => {
    if (locks.get(key) === stored) locks.delete(key)
  })
  return next
}

/** 轻量级内存索引：工作区 rootKey → (文档 relativePath → 标注文件名 .json) */
const docPathIndex = new Map<string, Map<string, string>>()

function setDocPathIndex(workspaceRoot: string, relativePath: string, fileName: string): void {
  const rKey = rootKey(workspaceRoot)
  let map = docPathIndex.get(rKey)
  if (!map) {
    map = new Map<string, string>()
    docPathIndex.set(rKey, map)
  }
  map.set(posix(relativePath), fileName)
}

function deleteDocPathIndex(workspaceRoot: string, relativePath: string): void {
  docPathIndex.get(rootKey(workspaceRoot))?.delete(posix(relativePath))
}

const annotationRevision = (annotation: Annotation): number =>
  typeof annotation.anchorRevision === 'number' && Number.isFinite(annotation.anchorRevision)
    ? Math.max(1, Math.floor(annotation.anchorRevision))
    : 1

const isUnresolved = (state: AnnotationAnchorState | undefined): boolean =>
  state === 'ambiguous' || state === 'unlocated'

function unresolvedCount(annotations: Annotation[]): number {
  return annotations.filter(annotation => isUnresolved(annotation.anchorState)).length
}

function limitMessage(annotations: Annotation[], scope: 'document' | 'source'): string {
  const unresolved = unresolvedCount(annotations)
  if (scope === 'document') {
    return `单篇文档最多 ${ANNOTATION_MAX_PER_FILE} 条标注；当前 ${annotations.length} 条，其中 ${unresolved} 条未解决，请清理后重试`
  }
  return `单个原文来源最多 ${ANNOTATION_MAX_PER_FILE} 条标注；当前 ${annotations.length} 条，请清理后重试`
}

function canonicalAnchor(anchor: AnnotationAnchor): string {
  return JSON.stringify({
    exact: anchor.exact,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    occurrence: anchor.occurrence ?? null,
    offsetHint: anchor.offsetHint ?? null
  })
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
  now: number,
  scope: 'document' | 'source' = 'document'
): Annotation[] {
  const byId = new Map(existing.map(item => [item.id, item]))
  for (const item of incoming) {
    assertUuid(item.id)
    const previous = byId.get(item.id)
    if (!previous || item.updatedAt >= previous.updatedAt) byId.set(item.id, item)
  }
  const values = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  if (values.length > ANNOTATION_MAX_PER_FILE) {
    throw new AnnotationLimitError(limitMessage(values, scope))
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

/** 文档指纹：contentHash 判断“正文是否变过”，size/mtime 只用于外部改名预筛；二进制或超大文件跳过全文读取。 */
async function fingerprintOf(
  workspaceRoot: string,
  relativePath: string
): Promise<{ contentHash?: string; size?: number; mtime?: number } | undefined> {
  try {
    const absolute = path.join(workspaceRoot, relativePath)
    const info = await stat(absolute)
    if (!info.isFile()) return undefined
    const mtime = Math.round(info.mtimeMs)
    const category = getFileCategory(relativePath)
    const isTextAnnotatable = category === 'markdown' || category === 'code' || category === 'text'
    if (!isTextAnnotatable || info.size > MAX_ANNOTATION_TEXT_BYTES) {
      return { size: info.size, mtime }
    }
    const content = await readFile(absolute, 'utf8')
    return {
      contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      size: info.size,
      mtime
    }
  } catch {
    // 文档暂时不可读时不认领，保留旁路文件
    return undefined
  }
}

export async function createDocumentAnnotation(
  ref: DocumentAnnotationRef,
  annotation: Annotation,
  fingerprint?: { contentHash?: string; size?: number; mtime?: number }
): Promise<Annotation> {
  const relativePath = posix(ref.relativePath)
  assertUuid(annotation.id)
  const now = Date.now()
  const normalized = normalizeAnnotation(
    {
      ...annotation,
      originalQuote: annotation.originalQuote || annotation.quote,
      anchorState: annotation.anchorState ?? 'anchored',
      anchorReason: undefined,
      anchorRevision: annotation.anchorRevision ?? 1,
      orphanedAt: undefined,
      lastAnchoredAt: annotation.lastAnchoredAt ?? now
    },
    'document',
    now
  )
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  return serial(key, async () => {
    const filePath = documentFile(ref.workspaceRoot, relativePath)
    const current = await readJson<DocumentAnnotationFile>(filePath)
    if (current?.annotations.some(item => item.id === normalized.id)) {
      throw new Error('标注已存在，请刷新后重试')
    }
    const writeTime = Date.now()
    // 调用方没给指纹时按磁盘现状补一次，保证外部改名后仍能按内容哈希找回。
    const nextFingerprint = fingerprint ?? (await fingerprintOf(ref.workspaceRoot, relativePath))
    const next: DocumentAnnotationFile = {
      version: 1,
      document: {
        relativePath,
        contentHash: nextFingerprint?.contentHash ?? current?.document.contentHash,
        size: nextFingerprint?.size ?? current?.document.size,
        mtime: nextFingerprint?.mtime ?? current?.document.mtime,
        updatedAt: writeTime
      },
      annotations: mergeAnnotations(current?.annotations ?? [], [normalized], writeTime)
    }
    await atomicWrite(filePath, next)
    setDocPathIndex(ref.workspaceRoot, relativePath, path.basename(filePath))
    return normalized
  })
}

/** 评论编辑只 patch comment，禁止整条覆盖锚点状态。 */
export async function updateDocumentAnnotationComment(
  ref: DocumentAnnotationRef,
  id: string,
  comment: string,
  baseUpdatedAt: number
): Promise<Annotation> {
  assertUuid(id)
  const relativePath = posix(ref.relativePath)
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  return serial(key, async () => {
    const filePath = documentFile(ref.workspaceRoot, relativePath)
    const current = await readJson<DocumentAnnotationFile>(filePath)
    const item = current?.annotations.find(annotation => annotation.id === id)
    if (!current || !item) throw new Error('标注不存在，请刷新后重试')
    if (Number.isFinite(baseUpdatedAt) && item.updatedAt > baseUpdatedAt) {
      throw new Error('STALE_ANNOTATION')
    }
    const now = Date.now()
    const next: Annotation = {
      ...item,
      comment: String(comment || '').slice(0, ANNOTATION_MAX_TEXT),
      updatedAt: now
    }
    await atomicWrite(filePath, {
      ...current,
      annotations: current.annotations.map(annotation => (annotation.id === id ? next : annotation))
    })
    return next
  })
}

/** 用户显式重新选择范围后改写锚点；修订号不匹配时拒绝覆盖。 */
export async function reanchorDocumentAnnotation(
  ref: DocumentAnnotationRef,
  id: string,
  quote: string,
  anchor: AnnotationAnchor,
  baseAnchorRevision: number
): Promise<Annotation> {
  assertUuid(id)
  const relativePath = posix(ref.relativePath)
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  return serial(key, async () => {
    const filePath = documentFile(ref.workspaceRoot, relativePath)
    const current = await readJson<DocumentAnnotationFile>(filePath)
    const item = current?.annotations.find(annotation => annotation.id === id)
    if (!current || !item) throw new Error('标注不存在，请刷新后重试')
    if (annotationRevision(item) !== Math.max(1, Math.floor(baseAnchorRevision))) {
      throw new Error('STALE_ANNOTATION')
    }
    const now = Date.now()
    const next = normalizeAnnotation(
      {
        ...item,
        quote,
        anchor,
        originalQuote: item.originalQuote ?? item.quote,
        anchorState: 'anchored',
        anchorReason: undefined,
        anchorRevision: annotationRevision(item) + 1,
        orphanedAt: undefined,
        lastAnchoredAt: now,
        updatedAt: now
      },
      'document',
      now
    )
    await atomicWrite(filePath, {
      ...current,
      annotations: current.annotations.map(annotation => (annotation.id === id ? next : annotation))
    })
    return next
  })
}

/**
 * 兼容旧调用：新记录按创建处理；已有记录只更新评论。
 * 锚点变化必须走 reconcile 或 reanchor，防止旧窗口整条覆盖新状态。
 */
export async function upsertDocumentAnnotation(
  ref: DocumentAnnotationRef,
  annotation: Annotation,
  fingerprint?: { contentHash?: string; size?: number; mtime?: number }
): Promise<Annotation> {
  const relativePath = posix(ref.relativePath)
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  const exists = await serial(key, async () => {
    const current = await readJson<DocumentAnnotationFile>(documentFile(ref.workspaceRoot, relativePath))
    return current?.annotations.some(item => item.id === annotation.id) ?? false
  })
  if (!exists) return createDocumentAnnotation(ref, annotation, fingerprint)
  return updateDocumentAnnotationComment(
    ref,
    annotation.id,
    annotation.comment,
    annotation.updatedAt
  )
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
    deleteDocPathIndex(workspaceRoot, from)
    setDocPathIndex(workspaceRoot, to, path.basename(targetPath))
  })
}

/** 删除文档时删除 document 旁路；source 不受影响。 */
export async function removeDocumentAnnotations(
  workspaceRoot: string,
  relativePath: string
): Promise<void> {
  const normalized = posix(relativePath)
  deleteDocPathIndex(workspaceRoot, normalized)
  await rm(documentFile(workspaceRoot, normalized), { force: true })
}

/**
 * 文档跨工作区移动时搬 document 旁路：源文件删除，目标侧按新路径重写。
 * 目标已存在时按 id 合并，不覆盖既有标注。
 */
export async function moveDocumentAnnotationsAcrossWorkspaces(
  sourceWorkspaceRoot: string,
  targetWorkspaceRoot: string,
  sourceRelativePath: string,
  targetRelativePath: string
): Promise<number> {
  const from = posix(sourceRelativePath)
  const to = posix(targetRelativePath)
  if (!from || !to) return 0
  return serial(`document\n${rootKey(targetWorkspaceRoot)}\n${to}`, async () => {
    const sourcePath = documentFile(sourceWorkspaceRoot, from)
    const source = await readJson<DocumentAnnotationFile>(sourcePath)
    if (!source || !Array.isArray(source.annotations) || !source.annotations.length) {
      await rm(sourcePath, { force: true })
      return 0
    }
    const targetPath = documentFile(targetWorkspaceRoot, to)
    const target = await readJson<DocumentAnnotationFile>(targetPath)
    const now = Date.now()
    const fingerprint = await fingerprintOf(targetWorkspaceRoot, to)
    await atomicWrite(targetPath, {
      version: 1,
      document: {
        relativePath: to,
        contentHash: fingerprint?.contentHash ?? source.document.contentHash,
        size: fingerprint?.size ?? source.document.size,
        mtime: fingerprint?.mtime ?? source.document.mtime,
        updatedAt: now
      },
      annotations: mergeAnnotations(target?.annotations ?? [], source.annotations, now)
    })
    await rm(sourcePath, { force: true })
    deleteDocPathIndex(sourceWorkspaceRoot, from)
    setDocPathIndex(targetWorkspaceRoot, to, path.basename(targetPath))
    return source.annotations.length
  })
}

/**
 * 外部改名找回：新路径 hash → 内存索引 / 单遍扫描（relativePath 与 contentHash+size+mtime 同步收集）。
 * 返回命中的文件内容；不唯一时返回 null，绝不猜测。
 */
export async function findDocumentAnnotationFile(
  workspaceRoot: string,
  relativePath: string,
  fingerprint?: { contentHash?: string; size?: number; mtime?: number }
): Promise<DocumentAnnotationFile | null> {
  const target = posix(relativePath)
  const directPath = documentFile(workspaceRoot, target)
  const direct = await readJson<DocumentAnnotationFile>(directPath)
  if (direct) {
    setDocPathIndex(workspaceRoot, target, path.basename(directPath))
    // 同一路径就是同一篇文档：正文编辑必然改变 contentHash，不能因此丢掉已有标注。
    // contentHash 只用于“文档被改名/移动后按内容找回”，不参与同路径认领。
    const needsSync =
      direct.document.relativePath !== target ||
      (fingerprint?.contentHash && direct.document.contentHash !== fingerprint.contentHash) ||
      (fingerprint?.size !== undefined && direct.document.size !== fingerprint.size) ||
      (fingerprint?.mtime !== undefined && direct.document.mtime !== fingerprint.mtime)
    if (needsSync) {
      const key = `document\n${rootKey(workspaceRoot)}\n${target}`
      return serial(key, async () => {
        const latest = (await readJson<DocumentAnnotationFile>(directPath)) ?? direct
        const latestNeedsSync =
          latest.document.relativePath !== target ||
          (fingerprint?.contentHash && latest.document.contentHash !== fingerprint.contentHash) ||
          (fingerprint?.size !== undefined && latest.document.size !== fingerprint.size) ||
          (fingerprint?.mtime !== undefined && latest.document.mtime !== fingerprint.mtime)
        if (!latestNeedsSync) return latest
        const updated: DocumentAnnotationFile = {
          ...latest,
          document: {
            ...latest.document,
            relativePath: target,
            contentHash: fingerprint?.contentHash ?? latest.document.contentHash,
            size: fingerprint?.size ?? latest.document.size,
            mtime: fingerprint?.mtime ?? latest.document.mtime,
            updatedAt: Date.now()
          }
        }
        await atomicWrite(directPath, updated)
        return updated
      })
    }
    return direct
  }

  const dir = path.join(workspaceRoot, ANNOTATION_DIR, 'documents')
  const indexedFileName = docPathIndex.get(rootKey(workspaceRoot))?.get(target)
  let hit: { file: DocumentAnnotationFile; filePath: string } | null = null

  if (indexedFileName && indexedFileName !== path.basename(directPath)) {
    const indexedPath = path.join(dir, indexedFileName)
    try {
      const indexedFile = await readJson<DocumentAnnotationFile>(indexedPath)
      if (indexedFile && posix(indexedFile.document?.relativePath ?? '') === target) {
        hit = { file: indexedFile, filePath: indexedPath }
      } else {
        deleteDocPathIndex(workspaceRoot, target)
      }
    } catch {
      deleteDocPathIndex(workspaceRoot, target)
    }
  }

  if (!hit) {
    let names: string[]
    try {
      names = (await readdir(dir)).filter(name => name.endsWith('.json'))
    } catch {
      return null
    }

    const pathMatches: Array<{ file: DocumentAnnotationFile; filePath: string }> = []
    const hashMatches: Array<{ file: DocumentAnnotationFile; filePath: string }> = []
    const freshIndex = new Map<string, string>()

    for (const name of names) {
      const filePath = path.join(dir, name)
      try {
        const file = await readJson<DocumentAnnotationFile>(filePath)
        if (!file) continue
        if (file.document?.relativePath) {
          freshIndex.set(posix(file.document.relativePath), name)
        }
        // direct 分支已处理同路径；这里只收集改名前的旧旁路。
        if (filePath === directPath) continue
        if (posix(file.document?.relativePath ?? '') === target) {
          pathMatches.push({ file, filePath })
        } else if (
          !pathMatches.length &&
          fingerprint?.contentHash &&
          file.document?.contentHash === fingerprint.contentHash &&
          (fingerprint.size === undefined || file.document.size === undefined || file.document.size === fingerprint.size) &&
          (fingerprint.mtime === undefined || file.document.mtime === undefined || file.document.mtime === fingerprint.mtime)
        ) {
          hashMatches.push({ file, filePath })
        }
      } catch {
        // 单个损坏文件不影响其他文档
      }
    }
    docPathIndex.set(rootKey(workspaceRoot), freshIndex)

    const candidates = pathMatches.length ? pathMatches : hashMatches
    if (candidates.length !== 1) return null
    hit = candidates[0]
  }

  const resolvedHit = hit
  const key = `document\n${rootKey(workspaceRoot)}\n${target}`
  return serial(key, async () => {
    const next: DocumentAnnotationFile = {
      ...resolvedHit.file,
      document: {
        ...resolvedHit.file.document,
        relativePath: target,
        contentHash: fingerprint?.contentHash ?? resolvedHit.file.document.contentHash,
        size: fingerprint?.size ?? resolvedHit.file.document.size,
        mtime: fingerprint?.mtime ?? resolvedHit.file.document.mtime,
        updatedAt: Date.now()
      }
    }
    await atomicWrite(directPath, next)
    if (resolvedHit.filePath !== directPath) {
      await rm(resolvedHit.filePath, { force: true }).catch(() => undefined)
    }
    setDocPathIndex(workspaceRoot, target, path.basename(directPath))
    return next
  })
}

/** 重新对账：更新 document 标注的解析状态与锚点，不碰 source。 */
export async function reconcileDocumentAnnotations(
  ref: DocumentAnnotationRef,
  resolutions: DocumentResolution[]
): Promise<DocumentReconcileResult> {
  const relativePath = posix(ref.relativePath)
  const key = `document\n${rootKey(ref.workspaceRoot)}\n${relativePath}`
  return serial(key, async () => {
    const filePath = documentFile(ref.workspaceRoot, relativePath)
    const current = await readJson<DocumentAnnotationFile>(filePath)
    if (!current) {
      return { applied: [], stale: resolutions.map(item => item.id), skipped: [], annotations: [] }
    }
    const incoming = new Map(resolutions.map(item => [item.id, item]))
    const applied: string[] = []
    const stale: string[] = []
    const skipped: string[] = []
    const now = Date.now()
    const annotations = current.annotations.map(item => {
      if (item.scope !== 'document') return item
      const resolution = incoming.get(item.id)
      if (!resolution) return item
      const currentRevision = annotationRevision(item)
      if (
        !Number.isFinite(resolution.baseAnchorRevision) ||
        Math.max(1, Math.floor(resolution.baseAnchorRevision)) !== currentRevision
      ) {
        stale.push(item.id)
        return item
      }
      if (
        resolution.state === 'shifted' &&
        (!resolution.quote || !resolution.anchor)
      ) {
        stale.push(item.id)
        return item
      }

      const state = resolution.state
      const nextQuote =
        state === 'anchored' || state === 'shifted'
          ? String(resolution.quote ?? item.quote).slice(0, ANNOTATION_MAX_TEXT)
          : item.quote
      const normalized = normalizeAnnotation(
        {
          ...item,
          quote: nextQuote,
          anchor: resolution.anchor ?? item.anchor
        },
        'document',
        now
      )
      const nextAnchor = normalized.anchor
      const anchorChanged = canonicalAnchor(nextAnchor) !== canonicalAnchor(item.anchor)
      const quoteChanged = nextQuote !== item.quote
      const stateChanged = item.anchorState !== state
      const nextReason =
        state === 'ambiguous' || state === 'unlocated' ? resolution.reason : undefined
      const reasonChanged = item.anchorReason !== nextReason
      const wasResolved = item.anchorState === 'anchored' || item.anchorState === 'shifted'
      const nextResolved = state === 'anchored' || state === 'shifted'
      const orphanedAt =
        state === 'unlocated' ? item.orphanedAt ?? now : undefined
      const orphanedChanged = item.orphanedAt !== orphanedAt
      let lastAnchoredAt = item.lastAnchoredAt
      if (nextResolved && (anchorChanged || !wasResolved || stateChanged)) {
        lastAnchoredAt = now
      }
      const lastAnchoredChanged = item.lastAnchoredAt !== lastAnchoredAt
      const changed =
        stateChanged ||
        reasonChanged ||
        anchorChanged ||
        quoteChanged ||
        orphanedChanged ||
        lastAnchoredChanged

      if (!changed) {
        skipped.push(item.id)
        return item
      }
      applied.push(item.id)
      return {
        ...item,
        quote: nextQuote,
        anchor: nextAnchor,
        anchorState: state,
        anchorReason: nextReason,
        anchorRevision: currentRevision + 1,
        orphanedAt,
        lastAnchoredAt,
        updatedAt: now
      }
    })
    if (applied.length) {
      try {
        await atomicWrite(filePath, {
          ...current,
          document: { ...current.document, updatedAt: now },
          annotations
        })
      } catch (error) {
        if (error instanceof AnnotationLimitError) {
          throw new AnnotationLimitError(
            `${error.message}；当前 ${annotations.length} 条，其中 ${unresolvedCount(annotations)} 条未解决，请清理后重试`
          )
        }
        throw error
      }
    }
    return { applied, stale, skipped, annotations }
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
    if (current) {
      const existing = current.annotations.find(item => item.id === annotation.id)
      if (existing) {
        const now = Date.now()
        const patched: Annotation = {
          ...existing,
          comment: normalized.comment,
          updatedAt: now
        }
        await atomicWrite(filePath, {
          ...current,
          source,
          annotations: current.annotations.map(item => (item.id === patched.id ? patched : item))
        })
        return patched
      }
    }
    // 同一 annotationId 不允许跨会话复用：重试必须落在同一个 sourceKey 上。
    const owner = await findSourceKeyForAnnotationId(defaultWorkspaceRoot, annotation.id, sourceKey)
    if (owner) throw new Error('该标注 ID 已属于另一个会话')
    const now = Date.now()
    const next: SourceAnnotationFile = {
      version: 1,
      source: source,
      annotations: mergeAnnotations(current?.annotations ?? [], [normalized], now, 'source')
    }
    await atomicWrite(filePath, next)
    if (typeof snapshot === 'string' && snapshot.trim()) {
      await writeFile(sourceSnapshotFile(defaultWorkspaceRoot, sourceKey), snapshot, 'utf8').catch(() => undefined)
    }
    return normalized
  })
}

/** 原文评论只 patch comment；原文锚点由原文页面维护，不跟随文档编辑。 */
export async function updateSourceAnnotationComment(
  defaultWorkspaceRoot: string,
  sourceKey: string,
  id: string,
  comment: string,
  baseUpdatedAt: number
): Promise<Annotation> {
  assertSourceKey(sourceKey)
  assertUuid(id)
  const key = `source\n${rootKey(defaultWorkspaceRoot)}\n${sourceKey}`
  return serial(key, async () => {
    const filePath = sourceFile(defaultWorkspaceRoot, sourceKey)
    const current = await readJson<SourceAnnotationFile>(filePath)
    const item = current?.annotations.find(annotation => annotation.id === id)
    if (!current || !item) throw new Error('原文标注不存在，请刷新后重试')
    if (Number.isFinite(baseUpdatedAt) && item.updatedAt > baseUpdatedAt) {
      throw new Error('STALE_ANNOTATION')
    }
    const next: Annotation = {
      ...item,
      comment: String(comment || '').slice(0, ANNOTATION_MAX_TEXT),
      updatedAt: Date.now()
    }
    await atomicWrite(filePath, {
      ...current,
      annotations: current.annotations.map(annotation => (annotation.id === id ? next : annotation))
    })
    return next
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
