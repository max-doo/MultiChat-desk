import { randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type Store from 'electron-store'
import type { NoteConversation, NoteDraft, NoteHighlight } from '../shared/types/notes'
import { noteConversationKey } from '../shared/utils/noteIdentity'
import { normalizeNoteTranscriptMarkdown } from '../shared/utils/noteTranscript'

export class NoteManager {
  private readonly directory: string
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(store: Store<Record<string, unknown>>) {
    this.directory = join(dirname(store.path), 'notes')
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
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  async list(): Promise<NoteConversation[]> {
    await mkdir(this.directory, { recursive: true })
    const files = (await readdir(this.directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
    const items = await Promise.all(files.map(async name => {
      try {
        const value: unknown = JSON.parse(await readFile(join(this.directory, name), 'utf8'))
        if (value && typeof value === 'object' && 'notes' in value && Array.isArray(value.notes)) {
          return value as NoteConversation
        }
      } catch (error) {
        console.error('[Notes] 无法读取笔记文件:', name, error)
      }
      return null
    }))
    const groups = new Map<string, NoteConversation>()
    for (const item of items.filter((value): value is NoteConversation => value !== null).sort((a, b) => a.updatedAt - b.updatedAt)) {
      let key: string
      try { key = noteConversationKey(item.url, item.title) } catch { key = item.sourceKey }
      const existing = groups.get(key)
      if (existing) {
        existing.notes.push(...item.notes.filter(note => !existing.notes.some(saved => saved.id === note.id)))
        existing.updatedAt = Math.max(existing.updatedAt, item.updatedAt)
        if (item.url.startsWith('https://')) existing.url = item.url
        await this.write(existing)
        await rm(this.file(item.id))
      } else {
        const changed = item.sourceKey !== key
        item.sourceKey = key
        groups.set(key, item)
        if (changed) await this.write(item)
      }
    }
    for (const conversation of groups.values()) {
      const unique = new Map<string, typeof conversation.notes[number]>()
      let changed = false
      for (const note of conversation.notes) {
        const key = note.quote.replace(/\s+/g, ' ').trim()
        const kept = unique.get(key)
        if (!kept) { unique.set(key, note); continue }
        if (note.comment.trim() && !kept.comment.includes(note.comment.trim())) {
          kept.comment = [kept.comment.trim(), note.comment.trim()].filter(Boolean).join('\n\n')
        }
        if (note.snapshot.length > kept.snapshot.length) kept.snapshot = note.snapshot
        kept.updatedAt = Math.max(kept.updatedAt, note.updatedAt)
      }
      if (unique.size !== conversation.notes.length) {
        conversation.notes = [...unique.values()]
        changed = true
      }
      if (changed) await this.write(conversation)
    }
    return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async anchorsForUrl(url: string): Promise<NoteHighlight[]> {
    const source = new URL(url)
    return (await this.list())
      .filter(item => {
        try { return new URL(item.url).origin === source.origin && noteConversationKey(item.url, item.title) === noteConversationKey(url, item.title) }
        catch { return false }
      })
      .flatMap(item => item.notes.map(note => ({ id: note.id, conversationId: item.id, quote: note.quote, anchor: note.anchor, comment: note.comment })))
  }

  async save(draft: NoteDraft, comment: string): Promise<NoteConversation> {
    const operation = this.saveQueue.then(() => this.saveUnlocked(draft, comment))
    this.saveQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async saveUnlocked(draft: NoteDraft, comment: string): Promise<NoteConversation> {
    if (!draft || !draft.quote?.trim() || !draft.snapshot?.trim() || !draft.url?.startsWith('https://')) {
      throw new Error('选区、对话内容或来源地址无效')
    }
    if (draft.snapshot.length > 20_000_000 || draft.quote.length > 100_000 || comment.length > 100_000) {
      throw new Error('笔记内容过大，未保存')
    }
    const now = Date.now()
    const sourceKey = noteConversationKey(draft.url, draft.title)
    const existing = (await this.list()).find(item => item.sourceKey === sourceKey)
    const conversation: NoteConversation = existing ?? {
      id: randomUUID(),
      sourceKey,
      platform: draft.platform,
      title: draft.title,
      url: draft.url,
      updatedAt: now,
      notes: []
    }
    const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim()
    const duplicate = conversation.notes.find(note => normalized(note.quote) === normalized(draft.quote))
    if (duplicate) {
      const formatted = normalizeNoteTranscriptMarkdown(draft.snapshot)
      if (formatted.length > duplicate.snapshot.length) {
        duplicate.snapshot = formatted
        duplicate.updatedAt = now
        conversation.updatedAt = now
        conversation.url = draft.url
        await this.write(conversation)
      }
      return conversation
    }
    conversation.platform = draft.platform
    conversation.title = draft.title
    conversation.url = draft.url
    conversation.updatedAt = now
    conversation.notes.push({
      id: randomUUID(),
      quote: draft.quote,
      comment,
      snapshot: normalizeNoteTranscriptMarkdown(draft.snapshot),
      anchor: draft.anchor,
      createdAt: now,
      updatedAt: now
    })
    await this.write(conversation)
    return conversation
  }

  async updateNote(conversationId: string, noteId: string, comment: string): Promise<NoteConversation> {
    if (comment.length > 100_000) throw new Error('笔记内容过大')
    const conversation = JSON.parse(await readFile(this.file(conversationId), 'utf8')) as NoteConversation
    const note = conversation.notes.find(item => item.id === noteId)
    if (!note) throw new Error('笔记不存在')
    note.comment = comment
    note.updatedAt = Date.now()
    conversation.updatedAt = note.updatedAt
    await this.write(conversation)
    return conversation
  }

  async deleteNote(conversationId: string, noteId: string): Promise<void> {
    const conversation = JSON.parse(await readFile(this.file(conversationId), 'utf8')) as NoteConversation
    if (!conversation.notes.some(item => item.id === noteId)) throw new Error('笔记不存在')
    conversation.notes = conversation.notes.filter(item => item.id !== noteId)
    if (conversation.notes.length === 0) {
      await rm(this.file(conversationId))
    } else {
      conversation.updatedAt = Date.now()
      await this.write(conversation)
    }
  }
}
