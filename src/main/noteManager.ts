import { randomUUID } from 'crypto'
import { constants } from 'fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type Store from 'electron-store'
import type { ConversationNote, ConversationMindmap, NoteConversation, NoteDraft, NoteHighlight, NoteSourceDraft } from '../shared/types/notes'
import { noteConversationKey } from '../shared/utils/noteIdentity'
import { normalizeNoteTranscriptMarkdown } from '../shared/utils/noteTranscript'

type LegacyNote = ConversationNote & { snapshot?: string }
type StoredConversation = Omit<Partial<NoteConversation>, 'notes'> & { id: string; notes: LegacyNote[] }
const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim()
const coverage = (snapshot: string, notes: ConversationNote[]): number => {
  const text = normalized(snapshot)
  return notes.filter(note => text.includes(normalized(note.quote))).length
}

export class NoteManager {
  private readonly directory: string
  private saveQueue: Promise<unknown> = Promise.resolve()

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
    return {
      version: 2, id: item.id, sourceKey: item.sourceKey || '', platform: item.platform || '',
      title: item.title || '未命名会话', url: item.url || '', updatedAt: item.updatedAt || 0,
      snapshot: candidates[0]?.snapshot || '', snapshotRevision: item.snapshotRevision ?? 1,
      mindmaps: item.mindmaps || [],
      notes: item.notes.map(({ snapshot: _snapshot, ...note }) => note)
    }
  }

  private async listUnlocked(): Promise<NoteConversation[]> {
    await mkdir(this.directory, { recursive: true })
    const files = (await readdir(this.directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
    const items: NoteConversation[] = []
    for (const name of files) {
      let value: StoredConversation
      try {
        value = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as StoredConversation
      } catch { console.error('[Notes] 无法读取笔记文件:', name); continue }
      if (!value || !Array.isArray(value.notes) || !value.id) continue
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
    return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  list(): Promise<NoteConversation[]> { return this.serial(() => this.listUnlocked()) }

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
    const conversation = (await this.listUnlocked()).find(item => item.sourceKey === sourceKey) || {
      version: 2 as const, id: randomUUID(), sourceKey, platform: draft.platform, title: draft.title,
      url: draft.url, updatedAt: now, notes: [], mindmaps: [], snapshot: '', snapshotRevision: 0
    }
    this.updateSnapshot(conversation, draft.snapshot)
    conversation.platform = draft.platform
    conversation.title = draft.title
    conversation.url = draft.url
    conversation.updatedAt = now
    await this.write(conversation)
    return conversation
  }

  saveSource(draft: NoteSourceDraft): Promise<NoteConversation> { return this.serial(() => this.sourceUnlocked(draft)) }

  save(draft: NoteDraft, comment: string): Promise<NoteConversation> {
    return this.serial(async () => {
      if (!draft?.quote?.trim() || draft.quote.length > 100_000 || typeof comment !== 'string' || comment.length > 100_000) throw new Error('选区或评论无效')
      const conversation = await this.sourceUnlocked(draft)
      if (!conversation.notes.some(note => normalized(note.quote) === normalized(draft.quote))) {
        const now = Date.now()
        conversation.notes.push({ id: randomUUID(), quote: draft.quote, comment, anchor: draft.anchor, createdAt: now, updatedAt: now })
        await this.write(conversation)
      }
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
    if (!conversation.notes.length && !conversation.mindmaps.length) await rm(this.file(conversation.id))
    else { conversation.updatedAt = Date.now(); await this.write(conversation) }
  }

  addMindmap(conversationId: string, markdown: string, platform: string, sourceRevision: number): Promise<ConversationMindmap> {
    return this.serial(async () => {
      if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 200_000) throw new Error('导图内容无效或过大')
      const conversation = await this.read(conversationId)
      const now = Date.now()
      const map: ConversationMindmap = { id: randomUUID(), title: markdown.match(/^#\s+(.+)$/m)?.[1] || '未命名导图', markdown, platform, sourceRevision, createdAt: now, updatedAt: now }
      conversation.mindmaps.push(map)
      conversation.updatedAt = now
      await this.write(conversation)
      return map
    })
  }

  updateMindmap(conversationId: string, mapId: string, markdown: string, title: string, expectedUpdatedAt: number): Promise<ConversationMindmap> {
    return this.serial(async () => {
      if (typeof markdown !== 'string' || markdown.length > 200_000 || typeof title !== 'string' || title.length > 200) throw new Error('导图内容无效或过大')
      const conversation = await this.read(conversationId)
      const map = conversation.mindmaps.find(item => item.id === mapId)
      if (!map) throw new Error('导图不存在')
      if (map.updatedAt !== expectedUpdatedAt) throw new Error('导图已在其他窗口修改，请保留当前大纲并重新打开后再编辑')
      map.markdown = markdown
      map.title = title.trim() || '未命名导图'
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
    return this.serial(async () => {
      const existing = (await this.listUnlocked()).find(item => item.sourceKey === 'local-mindmap-legacy')
      if (existing) return existing
      if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 200_000) throw new Error('旧导图内容无效')
      const now = Date.now()
      const conversation: NoteConversation = { version: 2, id: randomUUID(), sourceKey: 'local-mindmap-legacy', platform: '本地', title: '未关联对话的导图', url: '', updatedAt: now, snapshot: '', snapshotRevision: 0, notes: [], mindmaps: [{ id: randomUUID(), title: markdown.match(/^#\s+(.+)$/m)?.[1] || '旧导图', markdown, platform: '本地', sourceRevision: 0, createdAt: now, updatedAt: now }] }
      await this.write(conversation)
      return conversation
    })
  }
}
