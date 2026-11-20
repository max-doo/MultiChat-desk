import { randomUUID, createHash } from 'crypto'
import { isDeepStrictEqual } from 'util'
import type { DataImportResult } from '../shared/types/history'
import { constants } from 'fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type Store from 'electron-store'
import type { ConversationNote, ConversationMindmap, NoteConversation, NoteDraft, NoteHighlight, NoteSourceDraft, MindmapGenerationSession } from '../shared/types/notes'
import { noteConversationKey } from '../shared/utils/noteIdentity'
import { normalizeNoteTranscriptMarkdown } from '../shared/utils/noteTranscript'

type LegacyNote = ConversationNote & { snapshot?: string }
type StoredConversation = Omit<Partial<NoteConversation>, 'notes'> & { id: string; notes: LegacyNote[] }
const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim()
// 工作台文档身份由「工作区 + 相对路径」推导，与对话的 sourceKey 共用一套查找逻辑。
const workbenchRootKey = (workspaceRoot: string): string =>
  process.platform === 'win32' ? workspaceRoot.replace(/\\/g, '/').toLowerCase() : workspaceRoot.replace(/\\/g, '/')
const workbenchSourceKey = (workspaceRoot: string, relativePath: string): string =>
  `workbench:${createHash('sha256').update(`${workbenchRootKey(workspaceRoot)}\n${relativePath}`).digest('hex')}`
export const workbenchContentHash = (content: string): string =>
  createHash('sha256').update(content.replace(/\r\n?/g, '\n')).digest('hex')
const newPathFor = (path: string, oldRelativePath: string, newRelativePath: string): string =>
  path === oldRelativePath ? newRelativePath : `${newRelativePath}${path.slice(oldRelativePath.length)}`
const coverage = (snapshot: string, notes: ConversationNote[]): number => {
  const text = normalized(snapshot)
  return notes.filter(note => text.includes(normalized(note.quote))).length
}

export class NoteManager {
  private readonly directory: string
  private cache: Map<string, NoteConversation> | null = null
  private unreadable = false
  private saveQueue: Promise<unknown> = Promise.resolve()
  /** 本轮进程内对账发现的改名映射，供生成中的任务在保存时跟上新路径。 */
  private readonly relinks = new Map<string, string>()

  constructor(store: Store<Record<string, unknown>>) {
    this.directory = join(dirname(store.path), 'notes')
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.saveQueue.then(operation)
    this.saveQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private file(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的笔记 ID')
    return join(this.directory, `${id}.json`)
  }

  private async write(conversation: NoteConversation): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const target = this.file(conversation.id)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(conversation), 'utf8')
      await rename(temporary, target)
      this.cache?.set(conversation.id, structuredClone(conversation))
    } finally { await rm(temporary, { force: true }).catch(() => undefined) }
  }

  private async backup(id: string): Promise<void> {
    try { await copyFile(this.file(id), `${this.file(id)}.migration-backup`, constants.COPYFILE_EXCL) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }

  private convert(item: StoredConversation): NoteConversation {
    const candidates = [
      { snapshot: item.snapshot || '', updatedAt: item.updatedAt || 0 },
      ...item.notes.map(note => ({ snapshot: note.snapshot || '', updatedAt: note.updatedAt }))
    ].map(candidate => ({ ...candidate, snapshot: normalizeNoteTranscriptMarkdown(candidate.snapshot) })).filter(candidate => candidate.snapshot.trim())
    candidates.sort((a, b) => coverage(b.snapshot, item.notes) - coverage(a.snapshot, item.notes) || b.updatedAt - a.updatedAt || b.snapshot.length - a.snapshot.length)
    const conversation: NoteConversation = {
      version: 2, id: item.id, sourceKey: item.sourceKey || '', platform: item.platform || '',
      title: item.title || '未命名会话', url: item.url || '', updatedAt: item.updatedAt || 0,
      snapshot: candidates[0]?.snapshot || '', snapshotRevision: item.snapshotRevision ?? 1,
      mindmaps: item.mindmaps || [],
      notes: item.notes.map(({ snapshot: _snapshot, ...note }) => note)
    }
    // 工作台来源必须随读盘保留，否则记录会被当成普通对话笔记。
    if (item.workbench) conversation.workbench = item.workbench
    return conversation
  }

  private async listUnlocked(): Promise<NoteConversation[]> {
    if (this.cache) return [...this.cache.values()].map(item => structuredClone(item)).sort((a, b) => b.updatedAt - a.updatedAt)
    await mkdir(this.directory, { recursive: true })
    const files = (await readdir(this.directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
    const items: NoteConversation[] = []
    for (const name of files) {
      let value: StoredConversation
      try {
        value = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as StoredConversation
      } catch { this.unreadable = true; console.error('[Notes] 无法读取笔记文件:', name); continue }
      if (!value || !Array.isArray(value.notes) || !value.id) { this.unreadable = true; continue }
      const item = this.convert(value)
      if (value.version !== 2 || value.notes.some(note => 'snapshot' in note)) {
        await this.backup(item.id)
        await this.write(item)
      }
      items.push(item)
    }
    const groups = new Map<string, NoteConversation>()
    for (const item of items.sort((a, b) => a.updatedAt - b.updatedAt)) {
      let key = item.sourceKey
      try { if (item.url) key = noteConversationKey(item.url, item.title) } catch { /* 保留旧来源 */ }
      const existing = groups.get(key)
      if (existing) {
        existing.notes.push(...item.notes.filter(note => !existing.notes.some(saved => saved.id === note.id)))
        existing.mindmaps.push(...item.mindmaps.filter(map => !existing.mindmaps.some(saved => saved.id === map.id)))
        this.updateSnapshot(existing, item.snapshot)
        existing.updatedAt = Math.max(existing.updatedAt, item.updatedAt)
        if (item.url.startsWith('https://')) existing.url = item.url
        await this.backup(item.id)
        await this.write(existing)
        await rm(this.file(item.id))
      } else {
        if (item.sourceKey !== key) { item.sourceKey = key; await this.write(item) }
        groups.set(key, item)
      }
    }
    for (const conversation of groups.values()) {
      const unique = new Map<string, ConversationNote>()
      for (const note of conversation.notes) {
        const key = normalized(note.quote)
        const kept = unique.get(key)
        if (!kept) { unique.set(key, note); continue }
        if (note.comment.trim() && !kept.comment.includes(note.comment.trim())) {
          kept.comment = [kept.comment.trim(), note.comment.trim()].filter(Boolean).join('\n\n')
        }
        kept.updatedAt = Math.max(kept.updatedAt, note.updatedAt)
      }
      if (unique.size !== conversation.notes.length) {
        conversation.notes = [...unique.values()]
        await this.write(conversation)
      }
    }
    this.cache = new Map([...groups.values()].map(item => [item.id, structuredClone(item)]))
    return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  list(): Promise<NoteConversation[]> { return this.serial(() => this.listUnlocked()) }

  private async cachedValues(): Promise<NoteConversation[]> {
    if (!this.cache) await this.listUnlocked()
    return [...(this.cache?.values() || [])]
  }

  private async findSourceUnlocked(sourceKey: string): Promise<NoteConversation | undefined> {
    const item = (await this.cachedValues()).find(value => value.sourceKey === sourceKey)
    return item ? structuredClone(item) : undefined
  }

  private async findWorkbenchUnlocked(workspaceRoot: string, relativePath: string): Promise<NoteConversation | undefined> {
    const root = workbenchRootKey(workspaceRoot)
    const item = (await this.cachedValues()).find(value =>
      value.workbench && workbenchRootKey(value.workbench.workspaceRoot) === root && value.workbench.relativePath === relativePath)
    return item ? structuredClone(item) : undefined
  }

  /**
   * 生成期间文档被改名/移动时，记录已被对账改绑到新路径，旧的来源键就找不到了。
   * 直接查对账留下的映射，比用内容猜更准，也不会误挂到同内容的另一篇文档上。
   */
  private async findRelinkedWorkbenchUnlocked(workspaceRoot: string, relativePath: string): Promise<NoteConversation | undefined> {
    const root = workbenchRootKey(workspaceRoot)
    // 连续改名（a→b→c）时沿映射链走到最新路径；visited 防止脏数据成环。
    let current = relativePath
    const visited = new Set([current])
    for (;;) {
      const to = this.relinks.get(`${root}\n${current}`)
      if (!to || visited.has(to)) return undefined
      const found = await this.findWorkbenchUnlocked(workspaceRoot, to)
      if (found) {
        // 链已走到头，顺手把中间步骤收敛到最终路径，避免映射无限增长。
        this.relinks.set(`${root}\n${relativePath}`, to)
        return found
      }
      visited.add(to)
      current = to
    }
  }

  /** 只读查找，不建记录；面板打开文档时用它判断是否需要显示空状态。 */
  findWorkbenchSource(workspaceRoot: string, relativePath: string): Promise<NoteConversation | undefined> {
    return this.serial(() => this.findWorkbenchUnlocked(workspaceRoot, relativePath))
  }

  findSource(sourceKey: string): Promise<NoteConversation | undefined> { return this.serial(() => this.findSourceUnlocked(sourceKey)) }

  get(id: string): Promise<NoteConversation> { return this.serial(() => this.read(id)) }

  // 工作台导图由工作台面板自行读取；不混入对话笔记列表，避免“工作台”出现在平台筛选中。
  summaries(query = ''): Promise<NoteConversation[]> {
    return this.serial(async () => (await this.cachedValues()).filter(item => !item.workbench).filter(item => !query.trim() || [item.title, item.platform, ...item.notes.flatMap(note => [note.quote, note.comment]), ...item.mindmaps.flatMap(map => [map.title, map.markdown])].some(text => text.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(item => ({ ...item, snapshot: '', mindmaps: item.mindmaps.map(map => ({ ...map, markdown: '' })) })))
  }

  async exportAll(): Promise<NoteConversation[]> {
    const values = await this.list()
    if (this.unreadable) throw new Error('存在无法读取的笔记文件，请修复后再备份')
    return values
  }

  validateImport(values: unknown): NoteConversation[] {
    if (!Array.isArray(values)) throw new Error('笔记备份必须为数组')
    const items = values.map(value => {
      if (!value || typeof value !== 'object') throw new Error('笔记格式无效')
      const item = value as NoteConversation
      this.file(item.id)
      if (item.version !== 2 || typeof item.sourceKey !== 'string' || typeof item.platform !== 'string' || typeof item.title !== 'string' || typeof item.url !== 'string' || typeof item.snapshot !== 'string' || item.snapshot.length > 20_000_000 || !Number.isFinite(item.updatedAt) || !Number.isFinite(item.snapshotRevision) || !Array.isArray(item.notes) || !Array.isArray(item.mindmaps)) throw new Error('笔记备份格式无效')
      if (!item.notes.every(note => note && typeof note.id === 'string' && typeof note.quote === 'string' && typeof note.comment === 'string' && note.anchor && ['exact', 'prefix', 'suffix'].every(key => typeof note.anchor[key as keyof typeof note.anchor] === 'string') && Number.isFinite(note.createdAt) && Number.isFinite(note.updatedAt))) throw new Error('批注备份格式无效')
      if (!item.mindmaps.every(map => map && typeof map.id === 'string' && typeof map.title === 'string' && typeof map.markdown === 'string' && map.markdown.length <= 200_000 && typeof map.platform === 'string' && Number.isFinite(map.sourceRevision) && Number.isFinite(map.createdAt) && Number.isFinite(map.updatedAt))) throw new Error('导图备份格式无效')
      for (const map of item.mindmaps) {
        const binding = map.generationSession
        if (binding !== undefined && (!binding || typeof binding !== 'object' || typeof binding.platformId !== 'string' || !binding.platformId || binding.platformId.length > 200 || (binding.conversationUrl !== undefined && (typeof binding.conversationUrl !== 'string' || binding.conversationUrl.length > 4000 || !/^https:\/\//.test(binding.conversationUrl))))) throw new Error('生成会话绑定格式无效')
        const scope = map.workbenchScope
        if (scope !== undefined && (!scope || (scope.scope !== 'document' && scope.scope !== 'selection') || typeof scope.contentHash !== 'string' || (scope.selectionText !== undefined && typeof scope.selectionText !== 'string') || (scope.headingPath !== undefined && (!Array.isArray(scope.headingPath) || scope.headingPath.some(part => typeof part !== 'string'))))) throw new Error('导图来源范围格式无效')
      }
      const workbench = item.workbench
      if (workbench !== undefined && (!workbench || typeof workbench.workspaceRoot !== 'string' || !workbench.workspaceRoot || typeof workbench.relativePath !== 'string' || !workbench.relativePath || typeof workbench.contentHash !== 'string')) throw new Error('工作台来源格式无效')
      return structuredClone(item)
    })
    if (new Set(items.map(item => item.id)).size !== items.length || new Set(items.map(item => item.sourceKey)).size !== items.length) throw new Error('备份存在重复笔记 ID 或来源')
    return items
  }

  import(values: unknown, overwrite = false): Promise<DataImportResult> {
    return this.serial(async () => {
      const items = this.validateImport(values)
      const local = await this.listUnlocked()
      const result: DataImportResult = { added: 0, unchanged: 0, conflicts: 0 }
      for (const item of items) {
        const existing = local.find(saved => saved.id === item.id || saved.sourceKey === item.sourceKey)
        if (existing && isDeepStrictEqual(existing, item)) { result.unchanged++; continue }
        if (existing) {
          result.conflicts++
          if (!overwrite || existing.id !== item.id || existing.sourceKey !== item.sourceKey) continue
        } else result.added++
        await this.write(item)
      }
      return result
    })
  }

  standalone(markdown?: string): Promise<NoteConversation> {
    return this.serial(async () => {
      if (markdown !== undefined && (typeof markdown !== 'string' || markdown.length > 200_000)) throw new Error('导图内容无效')
      const existing = await this.findSourceUnlocked('local-mindmap-legacy')
      if (existing) {
        if (markdown && existing.mindmaps.every(map => map.markdown !== markdown)) {
          // 不覆盖其他窗口已保存的内容；旧内容作为一份可找回导图迁入。
          existing.mindmaps.push({ id: createHash('sha256').update(markdown).digest('hex'), title: '迁入的本地导图', markdown, platform: '本地', sourceRevision: 0, createdAt: Date.now(), updatedAt: Date.now() })
          existing.updatedAt = Date.now()
          await this.write(existing)
        }
        return existing
      }
      const now = Date.now()
      const content = markdown?.trim() ? markdown : '# 思维导图\n'
      if (content.length > 200_000) throw new Error('导图内容过大')
      const conversation: NoteConversation = { version: 2, id: randomUUID(), sourceKey: 'local-mindmap-legacy', platform: '本地', title: '未关联对话的导图', url: '', updatedAt: now, snapshot: '', snapshotRevision: 0, notes: [], mindmaps: [{ id: randomUUID(), title: content.match(/^#\s+(.+)$/m)?.[1] || '本地导图', markdown: content, platform: '本地', sourceRevision: 0, createdAt: now, updatedAt: now }] }
      await this.write(conversation)
      return conversation
    })
  }

  async anchorsForUrl(url: string): Promise<NoteHighlight[]> {
    const source = new URL(url)
    return (await this.list()).filter(item => {
      try { return new URL(item.url).origin === source.origin && noteConversationKey(item.url, item.title) === noteConversationKey(url, item.title) }
      catch { return false }
    }).flatMap(item => item.notes.map(note => ({ id: note.id, conversationId: item.id, quote: note.quote, anchor: note.anchor, comment: note.comment })))
  }

  private updateSnapshot(conversation: NoteConversation, snapshot: string): void {
    const next = normalizeNoteTranscriptMarkdown(snapshot)
    if (!next || next === conversation.snapshot) return
    const previous = conversation.snapshot
    if (previous && (next.length < previous.length || coverage(next, conversation.notes) < coverage(previous, conversation.notes))) return
    conversation.snapshot = next
    conversation.snapshotRevision += 1
  }

  private async sourceUnlocked(draft: NoteSourceDraft): Promise<NoteConversation> {
    if (!draft?.snapshot?.trim() || !draft.url?.startsWith('https://') || typeof draft.title !== 'string' || typeof draft.platform !== 'string') throw new Error('对话内容或来源无效')
    if (draft.snapshot.length > 20_000_000) throw new Error('对话内容过大，未保存')
    const sourceKey = noteConversationKey(draft.url, draft.title)
    const parsed = new URL(draft.url)
    if ((parsed.pathname === '/' || /^\/(?:app|chat)\/?$/.test(parsed.pathname)) && !parsed.search && /^(?:chatgpt|claude|gemini|grok|deepseek|kimi|豆包|千问|元宝|new chat|新对话)(?:\s*[-–|].*)?$/i.test(draft.title.trim())) {
      throw new Error('当前页面尚未形成可识别的会话，请先在网页中完成一次对话')
    }
    const now = Date.now()
    const conversation = await this.findSourceUnlocked(sourceKey) || {
      version: 2 as const, id: randomUUID(), sourceKey, platform: draft.platform, title: draft.title,
      url: draft.url, updatedAt: now, notes: [], mindmaps: [], snapshot: '', snapshotRevision: 0
    }
    this.updateSnapshot(conversation, draft.snapshot)
    conversation.platform = draft.platform
    conversation.title = draft.title
    conversation.url = draft.url
    conversation.updatedAt = now
    return conversation
  }

  // 生成前只准备输入；快照和导图在生成成功后一起写入。
  prepareSource(draft: NoteSourceDraft): Promise<NoteConversation> { return this.serial(() => this.sourceUnlocked(draft)) }

  /**
   * 取或建一篇工作台文档的来源记录。
   * 文档可以随意删减内容，所以这里不走 updateSnapshot 的「只增不减」保护，直接替换正文。
   */
  prepareWorkbenchSource(workspaceRoot: string, relativePath: string, title: string, content: string, fingerprint?: { size: number; mtime: number }): Promise<NoteConversation> {
    return this.serial(async () => {
      if (!workspaceRoot || !relativePath) throw new Error('工作台文档路径无效')
      const hash = workbenchContentHash(content)
      const existing = await this.findWorkbenchUnlocked(workspaceRoot, relativePath)
      if (existing) {
        const previous = existing.workbench!
        const contentChanged = existing.snapshot !== content
        const titleChanged = existing.title !== title
        // 大小与 mtime 也参与比对：生成导图时会带 stat 进来，值没变就不重复落盘。
        const metaChanged =
          previous.contentHash !== hash ||
          workbenchRootKey(previous.workspaceRoot) !== workbenchRootKey(workspaceRoot) ||
          previous.relativePath !== relativePath ||
          (fingerprint !== undefined && (previous.size !== fingerprint.size || previous.mtime !== fingerprint.mtime))
        if (!contentChanged && !metaChanged && !titleChanged) return existing
        existing.workbench = {
          ...previous,
          workspaceRoot,
          relativePath,
          contentHash: hash,
          ...(fingerprint ?? {})
        }
        if (contentChanged) {
          existing.snapshot = content
          existing.snapshotRevision += 1
        }
        if (titleChanged) existing.title = title
        if (contentChanged || titleChanged) existing.updatedAt = Date.now()
        await this.write(existing)
        return existing
      }
      const now = Date.now()
      const conversation: NoteConversation = {
        version: 2,
        id: randomUUID(),
        sourceKey: workbenchSourceKey(workspaceRoot, relativePath),
        platform: '工作台',
        title,
        url: '',
        updatedAt: now,
        snapshot: content,
        snapshotRevision: 1,
        notes: [],
        mindmaps: [],
        workbench: { workspaceRoot, relativePath, contentHash: hash, ...fingerprint }
      }
      await this.write(conversation)
      return conversation
    })
  }

  /** 应用内重命名/移动后改写绑定；目录按前缀批量迁移。 */
  rekeyWorkbenchSource(workspaceRoot: string, oldRelativePath: string, newRelativePath: string): Promise<number> {
    return this.serial(async () => {
      const root = workbenchRootKey(workspaceRoot)
      const oldPrefix = `${oldRelativePath}/`
      const matches = (await this.cachedValues()).filter(value =>
        value.workbench &&
        workbenchRootKey(value.workbench.workspaceRoot) === root &&
        (value.workbench.relativePath === oldRelativePath || value.workbench.relativePath.startsWith(oldPrefix)))
      let moved = 0
      for (const item of matches) {
        const next = newPathFor(item.workbench!.relativePath, oldRelativePath, newRelativePath)
        if (next === item.workbench!.relativePath) continue
        item.workbench = { ...item.workbench!, relativePath: next }
        item.sourceKey = workbenchSourceKey(workspaceRoot, next)
        // 记录标题就是文件名，跟着改，避免面板继续显示旧名。
        item.title = next.split('/').pop() || item.title
        await this.write(item)
        moved++
      }
      return moved
    })
  }

  /**
   * 保存成功后同步哈希与大小/mtime，供外部改名判定使用。
   * 只更新已存在的记录：没生成过导图的文档不因为一次保存就多出一条笔记。
   * 不动快照与修订号：保存很频繁，推进快照会让导图面板反复刷新；
   * 生成导图时 prepareWorkbenchSource 会用当时的正文补上快照。
   */
  refreshWorkbenchSource(
    workspaceRoot: string,
    relativePath: string,
    content: string,
    fingerprint?: { size: number; mtime: number }
  ): Promise<boolean> {
    return this.serial(async () => {
      const existing = await this.findWorkbenchUnlocked(workspaceRoot, relativePath)
      if (!existing?.workbench) return false
      const hash = workbenchContentHash(content)
      const metaChanged =
        existing.workbench.contentHash !== hash ||
        (fingerprint !== undefined && (existing.workbench.size !== fingerprint.size || existing.workbench.mtime !== fingerprint.mtime))
      if (!metaChanged) return false
      existing.workbench = { ...existing.workbench, contentHash: hash, ...(fingerprint ?? {}) }
      await this.write(existing)
      return true
    })
  }

  /**
   * 复制文档后克隆导图。副本是独立记录：新的 id、新的来源键，之后两份互不影响。
   * 源文档没有导图时不建空记录，避免复制产生无意义的笔记。
   */
  duplicateWorkbenchSource(workspaceRoot: string, sourceRelativePath: string, targetRelativePath: string): Promise<number> {
    return this.serial(async () => {
      // 目录复制：源是目录时按前缀逐篇配对，子文档各自克隆。
      const prefix = `${sourceRelativePath}/`
      const nested = (await this.cachedValues()).filter(value =>
        value.workbench &&
        value.mindmaps.length > 0 &&
        workbenchRootKey(value.workbench.workspaceRoot) === workbenchRootKey(workspaceRoot) &&
        value.workbench.relativePath.startsWith(prefix))
      if (nested.length) {
        let cloned = 0
        for (const item of nested) {
          const target = `${targetRelativePath}${item.workbench!.relativePath.slice(sourceRelativePath.length)}`
          cloned += await this.duplicateOne(workspaceRoot, item, target)
        }
        return cloned
      }
      const source = await this.findWorkbenchUnlocked(workspaceRoot, sourceRelativePath)
      if (!source?.mindmaps.length) return 0
      return this.duplicateOne(workspaceRoot, source, targetRelativePath)
    })
  }

  private async duplicateOne(workspaceRoot: string, source: NoteConversation, targetRelativePath: string): Promise<number> {
    const existing = await this.findWorkbenchUnlocked(workspaceRoot, targetRelativePath)
    if (existing) return 0
    let content = ''
    let fingerprint: { size: number; mtime: number } | undefined
    try {
      const full = join(workspaceRoot, targetRelativePath)
      content = await readFile(full, 'utf8')
      const info = await stat(full)
      fingerprint = { size: info.size, mtime: info.mtimeMs }
    } catch { return 0 }
    const title = targetRelativePath.split('/').pop() || targetRelativePath
    const now = Date.now()
    const conversation: NoteConversation = {
      version: 2,
      id: randomUUID(),
      sourceKey: workbenchSourceKey(workspaceRoot, targetRelativePath),
      platform: '工作台',
      title,
      url: '',
      updatedAt: now,
      snapshot: content,
      snapshotRevision: 1,
      notes: [],
      workbench: { workspaceRoot, relativePath: targetRelativePath, contentHash: workbenchContentHash(content), ...fingerprint },
      mindmaps: source.mindmaps.map(map => ({ ...structuredClone(map), id: randomUUID(), generationSession: undefined }))
    }
    await this.write(conversation)
    return conversation.mindmaps.length
  }

  /** 删除前的确认信息：文档（含目录下的文档）关联了多少张导图。 */
  workbenchTrashImpact(workspaceRoot: string, relativePaths: string[]): Promise<{ documents: number; mindmaps: number }> {
    return this.serial(async () => {
      const root = workbenchRootKey(workspaceRoot)
      // 没有导图的记录不计入，否则提示里的文档数会和导图数对不上。
      const documents = (await this.cachedValues()).filter(value => {
        if (!value.workbench) return false
        if (!value.mindmaps.length) return false
        if (workbenchRootKey(value.workbench.workspaceRoot) !== root) return false
        const path = value.workbench.relativePath
        return relativePaths.some(target => path === target || path.startsWith(`${target}/`))
      })
      return { documents: documents.length, mindmaps: documents.reduce((sum, item) => sum + item.mindmaps.length, 0) }
    })
  }

  /**
   * 删除文档时同步删除导图记录。
   * 文档本身进系统回收站，导图不保留：还原文件不会恢复导图，删除提示里已明确说明。
   */
  purgeWorkbenchSource(workspaceRoot: string, relativePaths: string[]): Promise<number> {
    return this.serial(async () => {
      const root = workbenchRootKey(workspaceRoot)
      const matches = (await this.cachedValues()).filter(value => {
        if (!value.workbench) return false
        if (workbenchRootKey(value.workbench.workspaceRoot) !== root) return false
        const path = value.workbench.relativePath
        return relativePaths.some(target => path === target || path.startsWith(`${target}/`))
      })
      for (const item of matches) {
        await rm(this.file(item.id), { force: true })
        this.cache?.delete(item.id)
      }
      return matches.length
    })
  }

  /**
   * 对账：以磁盘为准，判定路径消失的文档是「改名」还是「删除」。
   *
   * 应用外改名和删除在文件系统层面无法区分，只能靠内容判定：
   * 1. 先处理路径仍在的记录：同步大小/mtime，并占住这个路径；
   * 2. 再处理路径消失的记录：在未被占用的文件里找大小与 mtime 都相同的候选，
   *    多个候选时用内容哈希再分一次；
   * 3. 仍找不到 → 判定为删除，直接删记录。
   *
   * index 由渲染层传入（文件树重扫时已经拿到 size/mtime），对账本身不再额外扫盘。
   */
  reconcileWorkbenchSources(
    workspaceRoot: string,
    index: Map<string, { size?: number; mtime?: number }>
  ): Promise<{ deleted: number; relinked: number; relinks: Array<{ from: string; to: string }> }> {
    return this.serial(async () => {
      const root = workbenchRootKey(workspaceRoot)
      const targets = (await this.cachedValues()).filter(value =>
        value.workbench && workbenchRootKey(value.workbench.workspaceRoot) === root)
      if (!targets.length) return { deleted: 0, relinked: 0, relinks: [] }
      // 工作区根目录不可读（盘符未挂载、目录被外部删除）时整轮跳过，不能把记录全删了。
      const rootStat = await stat(workspaceRoot).catch(() => null)
      if (!rootStat?.isDirectory()) return { deleted: 0, relinked: 0, relinks: [] }

      let deleted = 0
      let relinked = 0
      const relinks: Array<{ from: string; to: string }> = []

      // 按 size+mtime 建一次索引：整目录被删时不必让每篇文档都遍历一遍全量文件。
      const byFingerprint = new Map<string, string[]>()
      for (const [path, info] of index) {
        if (info.size === undefined || info.mtime === undefined) continue
        const key = `${info.size}:${info.mtime}`
        const bucket = byFingerprint.get(key)
        if (bucket) bucket.push(path)
        else byFingerprint.set(key, [path])
      }

      // 第一轮：路径还在的记录先占住自己的文件，后面的改名判定不能抢。
      const missing: NoteConversation[] = []
      const claimed = new Set<string>()
      for (const item of targets) {
        const source = item.workbench!
        const current = index.get(source.relativePath)
        if (!current) { missing.push(item); continue }
        claimed.add(source.relativePath)
        if (current.size !== source.size || current.mtime !== source.mtime) {
          item.workbench = { ...source, size: current.size, mtime: current.mtime }
          await this.write(item)
        }
      }

      // 第二轮：路径消失的记录逐个找原文件；找到就改绑，找不到才删。
      for (const item of missing) {
        const source = item.workbench!
        const moved = await this.findRenamedTarget(workspaceRoot, byFingerprint, source, claimed)
        if (moved) {
          claimed.add(moved)
          item.workbench = { ...source, relativePath: moved, size: index.get(moved)?.size, mtime: index.get(moved)?.mtime }
          item.sourceKey = workbenchSourceKey(workspaceRoot, moved)
          item.title = moved.split('/').pop() || item.title
          await this.write(item)
          relinked++
          relinks.push({ from: source.relativePath, to: moved })
          this.relinks.set(`${root}\n${source.relativePath}`, moved)
          continue
        }
        // 删除前单独 stat 一次：文件树可能因目录暂时不可读而漏项，文件还在就不能删记录。
        const direct = await stat(join(workspaceRoot, source.relativePath)).then(
          info => ({ info }),
          (error: NodeJS.ErrnoException) => ({ error })
        )
        if ('info' in direct) {
          claimed.add(source.relativePath)
          if (direct.info.size !== source.size || direct.info.mtimeMs !== source.mtime) {
            item.workbench = { ...source, size: direct.info.size, mtime: direct.info.mtimeMs }
            await this.write(item)
          }
          continue
        }
        // 只有“确实不存在”才删；权限等其他错误按保留处理，等下次对账再判。
        if (direct.error.code !== 'ENOENT') continue
        await rm(this.file(item.id), { force: true })
        this.cache?.delete(item.id)
        deleted++
      }
      return { deleted, relinked, relinks }
    })
  }

  /**
   * 在现存文件里找被改名/移动的原文件。
   * 改名与移动保留大小和 mtime，按这两个值在内存里筛候选：唯一候选直接认，零额外 IO；
   * 多个候选（例如同名副本）才读文件比哈希，仍不唯一就不猜，避免把导图绑到副本上。
   */
  private async findRenamedTarget(
    workspaceRoot: string,
    byFingerprint: Map<string, string[]>,
    source: { relativePath: string; contentHash: string; size?: number; mtime?: number },
    claimed: Set<string>
  ): Promise<string | null> {
    // 旧记录没有指纹时无法判定，等下次路径仍在时补上，不在这里猜。
    if (source.size === undefined || source.mtime === undefined) return null
    const candidates = (byFingerprint.get(`${source.size}:${source.mtime}`) ?? []).filter(path => !claimed.has(path))
    if (candidates.length === 1) return candidates[0]
    if (!candidates.length) return null
    const matched: string[] = []
    for (const candidate of candidates) {
      try {
        const content = await readFile(join(workspaceRoot, candidate), 'utf8')
        if (workbenchContentHash(content) === source.contentHash) matched.push(candidate)
      } catch {
        // 读不到的文件不参与判定
      }
    }
    return matched.length === 1 ? matched[0] : null
  }

  save(draft: NoteDraft, comment: string): Promise<NoteConversation> {
    return this.serial(async () => {
      if (!draft?.quote?.trim() || draft.quote.length > 100_000 || typeof comment !== 'string' || comment.length > 100_000) throw new Error('选区或评论无效')
      const conversation = await this.sourceUnlocked(draft)
      if (!conversation.notes.some(note => normalized(note.quote) === normalized(draft.quote))) {
        const now = Date.now()
        conversation.notes.push({ id: randomUUID(), quote: draft.quote, comment, anchor: draft.anchor, createdAt: now, updatedAt: now })
      }
      await this.write(conversation)
      return conversation
    })
  }

  private async read(id: string): Promise<NoteConversation> {
    return this.convert(JSON.parse(await readFile(this.file(id), 'utf8')) as StoredConversation)
  }

  updateNote(conversationId: string, noteId: string, comment: string): Promise<NoteConversation> {
    return this.serial(async () => {
      if (typeof comment !== 'string' || comment.length > 100_000) throw new Error('笔记内容过大')
      const conversation = await this.read(conversationId)
      const note = conversation.notes.find(item => item.id === noteId)
      if (!note) throw new Error('笔记不存在')
      note.comment = comment
      note.updatedAt = Date.now()
      conversation.updatedAt = note.updatedAt
      await this.write(conversation)
      return conversation
    })
  }

  deleteNote(conversationId: string, noteId: string): Promise<void> {
    return this.serial(async () => {
      const conversation = await this.read(conversationId)
      if (!conversation.notes.some(item => item.id === noteId)) throw new Error('笔记不存在')
      conversation.notes = conversation.notes.filter(item => item.id !== noteId)
      await this.saveOrRemove(conversation)
    })
  }

  private async saveOrRemove(conversation: NoteConversation): Promise<void> {
    if (!conversation.notes.length && !conversation.mindmaps.length) { await rm(this.file(conversation.id)); this.cache?.delete(conversation.id) }
    else { conversation.updatedAt = Date.now(); await this.write(conversation) }
  }

  addMindmap(source: NoteConversation, markdown: string, platform: string, generationSession?: MindmapGenerationSession, workbenchScope?: ConversationMindmap['workbenchScope']): Promise<{ conversationId: string; mindmap: ConversationMindmap }> {
    return this.serial(async () => {
      if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 200_000) throw new Error('导图内容无效或过大')
      // 生成期间可能新增笔记、删除旧图或合并同源记录，保存时以最新文档为准。
      const saved = await this.findSourceUnlocked(source.sourceKey) ||
        (source.workbench ? await this.findRelinkedWorkbenchUnlocked(
          source.workbench.workspaceRoot,
          source.workbench.relativePath
        ) : undefined)
      // 生成期间文档被删掉（应用内或外部）时不再写回，否则会留下指向已删除文件的记录。
      if (!saved && source.workbench) {
        const alive = await stat(join(source.workbench.workspaceRoot, source.workbench.relativePath)).catch(() => null)
        if (!alive) throw new Error('文档已被删除，未保存导图')
      }
      const conversation = saved || { ...source, notes: [], mindmaps: [] }
      // 文档允许删减，直接替换；对话沿用「只增不减」的保护，避免采集不完整时回退快照。
      if (conversation.workbench) {
        if (conversation.snapshot !== source.snapshot) {
          conversation.snapshot = source.snapshot
          conversation.snapshotRevision += 1
        }
      } else {
        this.updateSnapshot(conversation, source.snapshot)
      }
      // 更新后的快照未采用本次输入时，标记此图基于旧内容，避免误报为最新版本。
      const sourceRevision = conversation.snapshot === source.snapshot ? conversation.snapshotRevision : 0
      const now = Date.now()
      const map: ConversationMindmap = { id: randomUUID(), title: markdown.match(/^#\s+(.+)$/m)?.[1] || '未命名导图', markdown, platform, sourceRevision, createdAt: now, updatedAt: now }
      if (generationSession) map.generationSession = generationSession
      // 内容哈希在保存时统一按当前文档正文计算，调用方无需重复实现。
      if (workbenchScope) map.workbenchScope = { ...workbenchScope, contentHash: workbenchScope.contentHash || workbenchContentHash(conversation.snapshot) }
      conversation.mindmaps.push(map)
      conversation.updatedAt = now
      await this.write(conversation)
      return { conversationId: conversation.id, mindmap: map }
    })
  }

  updateMindmap(conversationId: string, mapId: string, markdown: string, title: string, expectedUpdatedAt: number, generationSession?: MindmapGenerationSession): Promise<ConversationMindmap> {
    return this.serial(async () => {
      if (typeof markdown !== 'string' || markdown.length > 200_000 || typeof title !== 'string' || title.length > 200) throw new Error('导图内容无效或过大')
      const conversation = await this.read(conversationId)
      const map = conversation.mindmaps.find(item => item.id === mapId)
      if (!map) throw new Error('导图不存在')
      if (map.updatedAt !== expectedUpdatedAt) throw new Error('导图已在其他窗口修改，请保留当前大纲并重新打开后再编辑')
      map.markdown = markdown
      map.title = title.trim() || '未命名导图'
      if (generationSession) map.generationSession = generationSession
      map.updatedAt = Math.max(Date.now(), map.updatedAt + 1)
      conversation.updatedAt = map.updatedAt
      await this.write(conversation)
      return map
    })
  }

  deleteMindmap(conversationId: string, mapId: string): Promise<void> {
    return this.serial(async () => {
      const conversation = await this.read(conversationId)
      if (!conversation.mindmaps.some(map => map.id === mapId)) throw new Error('导图不存在')
      conversation.mindmaps = conversation.mindmaps.filter(map => map.id !== mapId)
      await this.saveOrRemove(conversation)
    })
  }

  importLegacyMindmap(markdown: string): Promise<NoteConversation> {
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 200_000) return Promise.reject(new Error('旧导图内容无效'))
    return this.standalone(markdown)
  }
}
