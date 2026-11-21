/**
 * 会话文档：把会话快照写成普通 Markdown。
 * 文档目标由 captureContext 决定；source 标注不归文档所有。
 */

import { app } from 'electron'
import type Store from 'electron-store'
import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import path from 'path'
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationSource,
  CaptureContext,
  CaptureSourceResult,
  CapturedDocumentRef,
  ConversationScanResult,
  EnsureDocumentResult,
  SourceAnnotationFile
} from '../../shared/types/annotations'
import { noteConversationKey } from '../../shared/utils/noteIdentity'
import { sanitizeMindmapFileName } from '../../shared/utils/mindmapFile'
import { snapshotToDocumentMarkdown } from '../../shared/utils/noteTranscript'
import {
  getActiveWorkspaceRoot,
  getWorkspaceSettings,
  ensureDefaultWorkspace
} from './workbenchService'
import {
  hasSourceAnnotations,
  listSourceAnnotations,
  readSourceSnapshot,
  upsertSourceAnnotation
} from './annotationService'

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
const SCAN_TIME_LIMIT_MS = 3000
const SCAN_FILE_LIMIT = 2000
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

const posix = (value: string): string => value.split(path.sep).join('/')
const rootKey = (root: string): string => {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const unquote = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  return trimmed
}

const yamlScalar = (value: string): string => {
  if (!value) return '""'
  return /[:#[\]{},&*!|>'"%@`]|^[-?] | $|^ /.test(value) || /["\\]/.test(value)
    ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : value
}

interface FrontmatterInfo {
  sourceKey?: string
  sourceUrl?: string
  platform?: string
  title?: string
  updatedAt?: number
  sourceKind?: string
}

function parseFrontmatter(content: string): FrontmatterInfo {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return {}
  const info: FrontmatterInfo = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = unquote(m[2])
    if (key === 'source_key') info.sourceKey = value
    else if (key === 'source_url') info.sourceUrl = value
    else if (key === 'source') info.sourceUrl = value
    else if (key === 'platform') info.platform = value
    else if (key === 'title') info.title = value
    else if (key === 'updated_at' && /^\d+$/.test(value)) info.updatedAt = Number(value)
    else if (key === 'source_kind') info.sourceKind = value
  }
  return info
}

const isMarkdown = (name: string): boolean => /\.md$/i.test(name)

async function scanMarkdownFiles(
  root: string,
  onFile: (relativePath: string, content: string, mtime: number) => void
): Promise<boolean> {
  const startedAt = Date.now()
  let count = 0
  let complete = true

  const walk = async (dir: string): Promise<void> => {
    if (!complete) return
    if (Date.now() - startedAt > SCAN_TIME_LIMIT_MS) { complete = false; return }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!complete) return
      if (count >= SCAN_FILE_LIMIT) { complete = false; return }
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile() || !isMarkdown(entry.name)) continue
      count += 1
      try {
        const info = await stat(full)
        const content = await readFile(full, 'utf8')
        onFile(posix(path.relative(root, full)), content, info.mtimeMs)
      } catch {
        // 单个文件读失败不阻断扫描
      }
    }
  }
  await walk(root)
  return complete
}

export async function scanConversationDocuments(root: string): Promise<ConversationScanResult> {
  const documents: ConversationScanResult['documents'] = []
  const complete = await scanMarkdownFiles(root, (relativePath, content, mtime) => {
    const frontmatter = parseFrontmatter(content)
    const rawKey = frontmatter.sourceKey || frontmatter.sourceUrl
    if (!rawKey || !/^https:\/\//i.test(rawKey)) return
    if (frontmatter.sourceKind && frontmatter.sourceKind !== 'conversation') return
    const heading = content.split('\n').find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim()
    const title = frontmatter.title || heading || path.basename(relativePath, path.extname(relativePath))
    // 旧格式 `source: https://...` 存的是原始 URL，新格式存的是 noteConversationKey；
    // 统一归一到会话身份，避免同一会话被判定为两篇文档。
    let sourceKey = rawKey
    try {
      sourceKey = noteConversationKey(rawKey, title)
    } catch {
      return
    }
    documents.push({
      relativePath,
      title,
      platform: frontmatter.platform || '',
      sourceKey,
      updatedAt: frontmatter.updatedAt ?? mtime
    })
  })
  return { complete, documents }
}

function buildDocumentFrontmatter(input: {
  platform: string
  title: string
  url: string
  sourceKey: string
  now: number
}): string {
  const lines = [
    '---',
    `id: ${randomUUID()}`,
    `platform: ${yamlScalar(input.platform)}`,
    `title: ${yamlScalar(input.title)}`,
    `captured_at: ${input.now}`,
    `updated_at: ${input.now}`,
    '---',
    ''
  ]
  // 没有来源身份时不写 source_key/source_url，避免伪造一个无法回显的会话身份。
  if (input.sourceKey) {
    lines.splice(2, 0, 'source_kind: conversation', `source_key: ${yamlScalar(input.sourceKey)}`)
    if (input.url) lines.splice(4, 0, `source_url: ${yamlScalar(input.url)}`)
  }
  return lines.join('\n')
}

async function resolveDocumentTarget(
  store: Store<Record<string, unknown>>,
  captureContext: CaptureContext,
  workspaceRoot?: string
): Promise<{ root: string; relativeDir: string } | { error: 'NO_ACTIVE_WORKSPACE' | 'WORKSPACE_UNAVAILABLE' }> {
  let root: string | null = null
  if (captureContext === 'global') {
    root = (await ensureDefaultWorkspace(store)).path
  } else {
    root = getActiveWorkspaceRoot()
    if (!root) return { error: 'NO_ACTIVE_WORKSPACE' }
    if (workspaceRoot && rootKey(workspaceRoot) !== rootKey(root)) {
      return { error: 'WORKSPACE_UNAVAILABLE' }
    }
  }
  try {
    const info = await stat(root)
    if (!info.isDirectory()) return { error: 'WORKSPACE_UNAVAILABLE' }
  } catch {
    return { error: 'WORKSPACE_UNAVAILABLE' }
  }
  const settings = await getWorkspaceSettings(root)
  return { root, relativeDir: settings.conversationDir }
}

async function resolveFreeDocumentPath(
  root: string,
  relativeDir: string,
  title: string,
  sourceKey: string
): Promise<string> {
  const safeBase = sanitizeMindmapFileName(title || '会话')
  const dir = path.join(root, relativeDir)
  await mkdir(dir, { recursive: true })
  let counter = 1
  for (;;) {
    const fileName = counter === 1 ? `${safeBase}.md` : `${safeBase} (${counter}).md`
    const relativePath = posix(path.relative(root, path.join(dir, fileName)))
    try {
      const content = await readFile(path.join(dir, fileName), 'utf8')
      // 没有来源身份的摘录文档：同名即视为占用，绝不覆盖。
      if (!sourceKey) {
        counter += 1
        continue
      }
      const frontmatter = parseFrontmatter(content)
      const existingKey = frontmatter.sourceKey || frontmatter.sourceUrl
      if (existingKey) {
        try {
          if (noteConversationKey(existingKey, frontmatter.title || title) === sourceKey) return relativePath
        } catch {
          // 无法解析的历史来源不当作命中
        }
      }
    } catch {
      return relativePath
    }
    counter += 1
  }
}

export async function findDocumentForSource(
  store: Store<Record<string, unknown>>,
  captureContext: CaptureContext,
  sourceKey: string,
  workspaceRoot?: string
): Promise<{ document?: CapturedDocumentRef; error?: 'NO_ACTIVE_WORKSPACE' | 'WORKSPACE_UNAVAILABLE' | 'SCAN_INCOMPLETE'; scan?: ConversationScanResult; root?: string }> {
  const target = await resolveDocumentTarget(store, captureContext, workspaceRoot)
  if ('error' in target) return { error: target.error }
  const scan = await scanConversationDocuments(target.root)
  const hits = scan.documents.filter(item => item.sourceKey === sourceKey)
  if (!scan.complete) return { error: 'SCAN_INCOMPLETE', scan, root: target.root }
  if (hits.length) {
    hits.sort((a, b) => {
      const aInDir = a.relativePath.startsWith(target.relativeDir + '/')
      const bInDir = b.relativePath.startsWith(target.relativeDir + '/')
      if (aInDir !== bInDir) return aInDir ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
    return {
      document: { workspaceRoot: target.root, relativePath: hits[0].relativePath },
      scan,
      root: target.root
    }
  }
  return { scan, root: target.root }
}

/**
 * 迁移重试用：没有来源身份的旧记录按标题认领默认库里的同标题普通文档，
 * 避免同一记录反复重试时不断新建副本。只认没有 source_key 的文档。
 */
export async function findUntrackedDocumentByTitle(
  root: string,
  title: string
): Promise<CapturedDocumentRef | null> {
  const wanted = title.trim()
  if (!wanted) return null
  let hit: CapturedDocumentRef | null = null
  await scanMarkdownFiles(root, (relativePath, content) => {
    if (hit) return
    const frontmatter = parseFrontmatter(content)
    if (frontmatter.sourceKey || frontmatter.sourceUrl) return
    const heading = content.split('\n').find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim()
    const documentTitle = frontmatter.title || heading
    if (documentTitle === wanted) hit = { workspaceRoot: root, relativePath }
  })
  return hit
}

export async function createDocumentForSource(
  store: Store<Record<string, unknown>>,
  input: {
    captureContext: CaptureContext
    workspaceRoot?: string
    platform: string
    title: string
    url: string
    sourceKey: string
    snapshot: string
    /** 迁移任务固定归档目录；普通捕捉不传，按工作区当前设置解析。 */
    conversationDir?: string
  }
): Promise<{ document?: CapturedDocumentRef; error?: 'NO_ACTIVE_WORKSPACE' | 'WORKSPACE_UNAVAILABLE' | 'SCAN_INCOMPLETE' | 'OVERSIZE' | 'WRITE_FAILED' }> {
  const found = await findDocumentForSource(store, input.captureContext, input.sourceKey, input.workspaceRoot)
  if (found.error) return { error: found.error }
  if (found.document) return { document: found.document }
  const root = found.root
  if (!root) return { error: 'WORKSPACE_UNAVAILABLE' }
  const settings = await getWorkspaceSettings(root)
  const conversationDir = input.conversationDir || settings.conversationDir
  const markdown = snapshotToDocumentMarkdown(input.snapshot, input.platform, input.title, input.url)
  if (!markdown.trim()) return { error: 'WRITE_FAILED' }
  const now = Date.now()
  const content = `${buildDocumentFrontmatter({
    platform: input.platform,
    title: input.title,
    url: input.url,
    sourceKey: input.sourceKey,
    now
  })}${markdown}`
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) return { error: 'OVERSIZE' }
  try {
    const relativePath = await resolveFreeDocumentPath(root, conversationDir, input.title, input.sourceKey)
    await writeFile(path.join(root, relativePath), content, 'utf8')
    return { document: { workspaceRoot: root, relativePath } }
  } catch {
    return { error: 'WRITE_FAILED' }
  }
}

/** 摘录为独立文档：正文是引用块，不创建标注、不绑定来源。 */
export async function captureExcerptDocument(
  store: Store<Record<string, unknown>>,
  input: {
    captureContext: CaptureContext
    workspaceRoot?: string
    platform: string
    title: string
    url: string
    quote: string
    comment?: string
  }
): Promise<{ document?: CapturedDocumentRef; error?: 'NO_ACTIVE_WORKSPACE' | 'WORKSPACE_UNAVAILABLE' | 'WRITE_FAILED' | 'OVERSIZE' }> {
  const target = await resolveDocumentTarget(store, input.captureContext, input.workspaceRoot)
  if ('error' in target) return { error: target.error }
  const quote = input.quote.trim()
  if (!quote) return { error: 'WRITE_FAILED' }
  const settings = await getWorkspaceSettings(target.root)
  const safeTitle = sanitizeMindmapFileName(input.title || '摘录')
  const lines = [`# ${safeTitle}`, '', '> ' + quote.split(/\r?\n/).join('\n> ')]
  const comment = (input.comment || '').trim()
  if (comment) lines.push('', comment)
  if (/^https:\/\//i.test(input.url)) lines.push('', `来源：${input.platform || ''} · ${input.url}`)
  const content = `${lines.join('\n').trim()}\n`
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) return { error: 'OVERSIZE' }
  try {
    const relativePath = await resolveFreeDocumentPath(target.root, settings.conversationDir, safeTitle, '')
    await writeFile(path.join(target.root, relativePath), content, 'utf8')
    return { document: { workspaceRoot: target.root, relativePath } }
  } catch {
    return { error: 'WRITE_FAILED' }
  }
}

export async function captureSourceAnnotation(
  store: Store<Record<string, unknown>>,
  input: {
    annotationId: string
    captureContext: CaptureContext
    workspaceRoot?: string
    platform: string
    title: string
    url: string
    snapshot: string
    quote: string
    anchor: AnnotationAnchor
    comment: string
  }
): Promise<CaptureSourceResult> {
  if (!UUID_RE.test(input.annotationId)) throw new Error('标注 ID 必须是 UUID')
  if (!/^https:\/\//i.test(input.url)) throw new Error('来源地址必须是 https://')
  const defaultWorkspace = await requireDefaultWorkspace(store)
  const sourceKey = noteConversationKey(input.url, input.title)
  const source: AnnotationSource = {
    key: sourceKey,
    url: input.url,
    platform: input.platform,
    title: input.title
  }
  const now = Date.now()
  const annotation: Annotation = {
    id: input.annotationId,
    scope: 'source',
    quote: input.quote,
    anchor: input.anchor,
    comment: input.comment,
    source,
    createdAt: now,
    updatedAt: now
  }
  const saved = await upsertSourceAnnotation(
    defaultWorkspace.path,
    sourceKey,
    source,
    annotation,
    input.snapshot
  )
  const documentResult = await createDocumentForSource(store, {
    captureContext: input.captureContext,
    workspaceRoot: input.workspaceRoot,
    platform: input.platform,
    title: input.title,
    url: input.url,
    sourceKey,
    snapshot: input.snapshot
  })
  return {
    annotation: saved,
    document: documentResult.document,
    documentError: documentResult.error
  }
}

export async function ensureDocumentForSource(
  store: Store<Record<string, unknown>>,
  input: { sourceKey: string; captureContext: CaptureContext; workspaceRoot?: string }
): Promise<EnsureDocumentResult> {
  let defaultWorkspace: Awaited<ReturnType<typeof ensureDefaultWorkspace>>
  try {
    defaultWorkspace = await requireDefaultWorkspace(store)
  } catch {
    return { documentError: 'SOURCE_NOT_FOUND' }
  }
  if (!(await hasSourceAnnotations(defaultWorkspace.path, input.sourceKey))) {
    return { documentError: 'SOURCE_NOT_FOUND' }
  }
  const { source, annotations } = await listSourceAnnotations(defaultWorkspace.path, input.sourceKey)
  if (!source) return { documentError: 'SOURCE_NOT_FOUND' }
  const found = await findDocumentForSource(store, input.captureContext, input.sourceKey, input.workspaceRoot)
  if (found.error) return { documentError: found.error }
  if (found.document) return { document: found.document }
  // 只复用 capture 时保存的原始 XML 快照；没有快照就明确失败，绝不生成空文档，
  // 也不能把默认库里已转换的 Markdown 当成 snapshot 再包一层标题。
  const snapshot = await findSnapshotForSource(store, input.sourceKey)
  if (!snapshot.trim()) {
    void annotations
    return { documentError: 'SOURCE_NOT_FOUND' }
  }
  const created = await createDocumentForSource(store, {
    captureContext: input.captureContext,
    workspaceRoot: input.workspaceRoot,
    platform: source.platform,
    title: source.title || '未命名会话',
    url: source.url,
    sourceKey: input.sourceKey,
    snapshot
  })
  return { document: created.document, documentError: created.error }
}

/**
 * 补文档时没有新的页面快照；从默认库已有 source 文件旁边的来源文档或旧笔记取正文。
 * 找不到正文就不伪造空文档。
 */
async function findSnapshotForSource(store: Store<Record<string, unknown>>, sourceKey: string): Promise<string> {
  const defaultWorkspace = await ensureDefaultWorkspace(store)
  return readSourceSnapshot(defaultWorkspace.path, sourceKey)
}

/** 默认会话库不可用时明确报错，禁止退回当前仓库。 */
async function requireDefaultWorkspace(
  store: Store<Record<string, unknown>>
): Promise<Awaited<ReturnType<typeof ensureDefaultWorkspace>>> {
  try {
    return await ensureDefaultWorkspace(store)
  } catch {
    throw new Error('CONVERSATION_LIBRARY_UNAVAILABLE')
  }
}

export async function listConversationSources(root: string): Promise<ConversationScanResult> {
  return scanConversationDocuments(root)
}

export async function readConversationSourceFile(filePath: string): Promise<SourceAnnotationFile | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as SourceAnnotationFile
  } catch {
    return null
  }
}

export function defaultConversationDir(): string {
  return path.join(app.getPath('documents'), 'MultiChat Vault', 'conversations')
}
