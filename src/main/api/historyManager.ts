import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { isDeepStrictEqual } from 'util'
import type Store from 'electron-store'
import type { HistoryItem, SummaryHistoryItem, HistoryKind, HistoryRecord, HistoryListItem, SummaryHistoryListItem, DataImportResult } from '../../shared/types/history'

export const DISK_LIMIT = 1000
const STORAGE_VERSION = 1
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const textRecord = (value: unknown): boolean => object(value) && Object.values(value).every(item => typeof item === 'string')

export function normalizeHistory(value: unknown, kind: HistoryKind, index = 0): HistoryRecord {
  if (!object(value)) throw new Error('历史记录格式无效')
  const id = typeof value.id === 'string' && value.id ? value.id : `legacy-${createHash('sha256').update(JSON.stringify(value) + ':' + index).digest('hex')}`
  if (kind === 'summary') {
    if (typeof value.title !== 'string' || !Array.isArray(value.messages) || !strings(value.selectedModels) || typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) throw new Error('总结历史格式无效')
    if (!value.messages.every(message => object(message) && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')) throw new Error('总结消息格式无效')
    return { ...value, id } as unknown as SummaryHistoryItem
  }
  if (!strings(value.models)) throw new Error('对话模型格式无效')
  const timestamp = typeof value.timestamp === 'number' ? value.timestamp : 0
  const turns = Array.isArray(value.turns) ? value.turns : typeof value.message === 'string' ? [{ turnId: `${id}-0`, userMessage: value.message, timestamp, responses: value.responses ?? {} }] : null
  if (!turns || !turns.every(turn => object(turn) && typeof turn.turnId === 'string' && typeof turn.userMessage === 'string' && typeof turn.timestamp === 'number' && Number.isFinite(turn.timestamp) && textRecord(turn.responses))) throw new Error('对话轮次格式无效')
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : timestamp
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : createdAt
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || (value.urls !== undefined && !textRecord(value.urls))) throw new Error('对话时间或来源格式无效')
  return { ...value, id, createdAt, updatedAt, turns } as unknown as HistoryItem
}

export class HistoryManager {
  readonly directory: string
  private queue: Promise<unknown> = Promise.resolve()
  private lists = { conversation: new Map<string, HistoryListItem>(), summary: new Map<string, SummaryHistoryListItem>() }
  private searchText = new Map<string, string>()
  private loaded = false
  private migrationError = ''
  readonly ready: Promise<void>
  private warnings = new Set<string>()
  private unreadable = false

  constructor(private store: Store<Record<string, unknown>>) {
    this.directory = join(dirname(store.path), 'history', ...(basename(store.path).includes('-dev') ? ['dev'] : []))
    this.ready = this.initialize().catch(() => { this.migrationError = '历史迁移未完成，旧数据与备份已保留。请检查数据文件或磁盘权限后重启；当前历史只读。' })
  }

  private folder(kind: HistoryKind): string { return join(this.directory, kind === 'conversation' ? 'conversations' : 'summaries') }
  private file(kind: HistoryKind, id: string): string {
    if (typeof id !== 'string' || !id || id.length > 1000) throw new Error('历史 ID 无效')
    return join(this.folder(kind), `${createHash('sha256').update(id).digest('hex')}.json`)
  }
  private async atomic(target: string, data: unknown): Promise<void> {
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(data), 'utf8'); await rename(temporary, target) }
    finally { await rm(temporary, { force: true }).catch(() => undefined) }
  }
  private async read(kind: HistoryKind, id: string): Promise<HistoryRecord> {
    const envelope: unknown = JSON.parse(await readFile(this.file(kind, id), 'utf8'))
    if (!object(envelope) || envelope.version !== STORAGE_VERSION) throw new Error('历史文件版本无效')
    const item = normalizeHistory(envelope.data, kind)
    if (item.id !== id) throw new Error('历史文件 ID 不匹配')
    return item
  }
  private async initialize(): Promise<void> {
    const version = this.store.get('historyStorageVersion')
    if (typeof version === 'number' && version > STORAGE_VERSION) throw new Error('历史版本高于当前应用')
    if (version !== STORAGE_VERSION) {
      const legacy = { history: this.store.get('history') ?? [], summaryHistory: this.store.get('summaryHistory') ?? [] }
      if ((Array.isArray(legacy.history) && legacy.history.length) || (Array.isArray(legacy.summaryHistory) && legacy.summaryHistory.length) || !Array.isArray(legacy.history) || !Array.isArray(legacy.summaryHistory)) {
        const fingerprint = createHash('sha256').update(JSON.stringify(legacy)).digest('hex').slice(0, 16)
        const backup = join(dirname(this.store.path), 'backups', `${basename(this.store.path, '.json')}-history-${fingerprint}.json`)
        await this.atomic(backup, { version: STORAGE_VERSION, ...legacy })
      }
      if (!Array.isArray(legacy.history) || !Array.isArray(legacy.summaryHistory)) throw new Error('旧历史不是数组')
      for (const kind of ['conversation', 'summary'] as const) {
        const values = kind === 'conversation' ? legacy.history : legacy.summaryHistory
        const ids = new Set<string>()
        for (const [index, value] of values.entries()) {
          const item = normalizeHistory(value, kind, index)
          if (ids.has(item.id)) throw new Error('旧历史存在重复 ID')
          ids.add(item.id)
          let existing: HistoryRecord | undefined
          try { existing = await this.read(kind, item.id) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          if (existing && !isDeepStrictEqual(existing, item)) throw new Error('迁移目标存在冲突')
          if (!existing) await this.atomic(this.file(kind, item.id), { version: STORAGE_VERSION, data: item })
          if (!isDeepStrictEqual(await this.read(kind, item.id), item)) throw new Error('迁移核验失败')
        }
      }
      this.store.set('historyStorageVersion', STORAGE_VERSION)
    }
    // 完成标记优先：即使上次清理中断，也绝不重新导入旧数组。
    try { this.store.delete('history'); this.store.delete('summaryHistory') }
    catch { this.warnings.add('旧历史字段暂未清理，将在下次启动重试；新历史目录已生效') }
  }
  private async serial<T>(operation: () => Promise<T>, writing = false): Promise<T> {
    const result = this.queue.then(async () => {
      await this.ready
      if (writing && this.migrationError) throw new Error(this.migrationError)
      return operation()
    })
    this.queue = result.catch(() => undefined)
    return result
  }
  private remember(kind: HistoryKind, record: HistoryRecord): void {
    if (kind === 'conversation') {
      const item = record as HistoryItem
      this.searchText.set(`conversation:${item.id}`, `${item.title || ''} ${item.turns[0]?.userMessage || ''}`.toLowerCase())
      this.lists.conversation.set(item.id, { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, title: (item.title || item.turns[0]?.userMessage || (item.productMode === 'debate' ? '辩论' : '未命名会话')).slice(0, 200), models: item.models, productMode: item.productMode, displayMode: item.displayMode, turnCount: item.productMode === 'debate' ? item.debateTurns?.length ?? 0 : item.turns.length, hasSnapshot: item.turns.some(turn => Object.values(turn.responses).some(Boolean)) || !!item.debateTurns?.length })
    } else {
      const item = record as SummaryHistoryItem
      this.searchText.set(`summary:${item.id}`, `${item.title} ${item.messages.map(message => message.content).join(' ')}`.toLowerCase())
      this.lists.summary.set(item.id, { id: item.id, title: item.title, timestamp: item.timestamp, selectedModels: item.selectedModels, preview: item.messages.find(message => message.role === 'user')?.content.slice(0, 100) || '' })
    }
  }
  private async load(): Promise<void> {
    if (this.loaded) return
    if (this.migrationError) {
      for (const kind of ['conversation', 'summary'] as const) {
        const legacy = this.store.get(kind === 'conversation' ? 'history' : 'summaryHistory')
        if (Array.isArray(legacy)) for (const [index, value] of legacy.entries()) {
          try { this.remember(kind, normalizeHistory(value, kind, index)) } catch { this.warnings.add('部分旧历史无法解析') }
        }
      }
    } else {
      for (const kind of ['conversation', 'summary'] as const) {
        await mkdir(this.folder(kind), { recursive: true })
        for (const name of await readdir(this.folder(kind))) {
          if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
          try {
            const envelope: unknown = JSON.parse(await readFile(join(this.folder(kind), name), 'utf8'))
            if (!object(envelope) || envelope.version !== STORAGE_VERSION) throw new Error('版本无效')
            const record = normalizeHistory(envelope.data, kind)
            if (basename(this.file(kind, record.id)) !== name) throw new Error('文件名无效')
            this.remember(kind, record)
          } catch { this.unreadable = true; this.warnings.add(`无法读取历史文件：${name}`) }
        }
      }
    }
    this.loaded = true
  }
  private sorted(kind: HistoryKind): (HistoryListItem | SummaryHistoryListItem)[] {
    return [...this.lists[kind].values()].sort((a, b) => ('updatedAt' in b ? b.updatedAt : b.timestamp) - ('updatedAt' in a ? a.updatedAt : a.timestamp) || a.id.localeCompare(b.id))
  }
  page(kind: HistoryKind, offset: number, limit: number): Promise<(HistoryListItem | SummaryHistoryListItem)[]> {
    return this.serial(async () => { await this.load(); return this.sorted(kind).slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(0, limit), 1000)) })
  }
  search(kind: HistoryKind, query: string): Promise<(HistoryListItem | SummaryHistoryListItem)[]> {
    return this.serial(async () => { await this.load(); return this.sorted(kind).filter(item => this.searchText.get(`${kind}:${item.id}`)?.includes(query.trim().toLowerCase())) })
  }
  count(kind: HistoryKind): Promise<number> { return this.serial(async () => { await this.load(); return this.lists[kind].size }) }
  status(): Promise<{ error: string; warnings: string[] }> { return this.serial(async () => { await this.load(); return { error: this.migrationError, warnings: [...this.warnings] } }) }
  get(kind: HistoryKind, id: string): Promise<HistoryRecord> {
    return this.serial(async () => {
      if (this.migrationError) {
        const values = this.store.get(kind === 'conversation' ? 'history' : 'summaryHistory')
        if (Array.isArray(values)) for (const [index, value] of values.entries()) { try { const item = normalizeHistory(value, kind, index); if (item.id === id) return item } catch { /* 保留损坏记录，其他有效历史仍可读取。 */ } }
        throw new Error('历史不存在')
      }
      return this.read(kind, id)
    })
  }
  create(kind: HistoryKind, value: unknown): Promise<HistoryRecord> {
    return this.serial(async () => {
      await this.load()
      const item = normalizeHistory(value, kind)
      try { const existing = await this.read(kind, item.id); if (isDeepStrictEqual(existing, item)) return existing; throw new Error('会话已存在，请更新该会话') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await this.atomic(this.file(kind, item.id), { version: STORAGE_VERSION, data: item })
      this.remember(kind, item)
      for (const older of this.sorted(kind).slice(DISK_LIMIT)) { await rm(this.file(kind, older.id)); this.lists[kind].delete(older.id); this.searchText.delete(`${kind}:${older.id}`) }
      return item
    }, true)
  }
  update(kind: HistoryKind, id: string, patch: unknown): Promise<HistoryRecord> {
    return this.serial(async () => {
      await this.load()
      if (!object(patch) || 'id' in patch) throw new Error('历史更新格式无效')
      const previous = await this.read(kind, id)
      const next: Record<string, unknown> = { ...previous, ...patch }
      if (kind === 'conversation') {
        const old = previous as HistoryItem
        next.updatedAt = Date.now()
        if (patch.urls && object(patch.urls)) next.urls = { ...old.urls, ...patch.urls }
        if (Array.isArray(patch.turns)) {
          const merged = new Map(old.turns.map(turn => [turn.turnId, turn]))
          for (const turn of patch.turns) {
            if (!object(turn) || typeof turn.turnId !== 'string' || !textRecord(turn.responses)) throw new Error('轮次更新无效')
            const saved = merged.get(turn.turnId)
            merged.set(turn.turnId, { ...saved, ...turn, responses: { ...saved?.responses, ...Object.fromEntries(Object.entries(turn.responses as Record<string, string>).filter(([, text]) => text.trim())) } } as HistoryItem['turns'][number])
          }
          next.turns = [...merged.values()]
        }
        if (Array.isArray(patch.debateTurns)) {
          const merged = new Map((old.debateTurns || []).map(turn => [turn.round, turn]))
          for (const turn of patch.debateTurns) { if (!object(turn) || typeof turn.round !== 'number') throw new Error('辩论记录无效'); merged.set(turn.round, { ...merged.get(turn.round), ...turn } as NonNullable<HistoryItem['debateTurns']>[number]) }
          next.debateTurns = [...merged.values()]
        }
      }
      const item = normalizeHistory(next, kind)
      await this.atomic(this.file(kind, id), { version: STORAGE_VERSION, data: item })
      this.remember(kind, item)
      return item
    }, true)
  }
  remove(kind: HistoryKind, ids: string[]): Promise<void> {
    return this.serial(async () => { await this.load(); if (!strings(ids)) throw new Error('历史 ID 无效'); for (const id of ids) { await rm(this.file(kind, id), { force: true }); this.lists[kind].delete(id); this.searchText.delete(`${kind}:${id}`) } }, true)
  }
  all(kind: HistoryKind): Promise<HistoryRecord[]> {
    return this.serial(async () => { await this.load(); const items: HistoryRecord[] = []; if (this.migrationError) throw new Error(this.migrationError); if (this.unreadable) throw new Error('部分历史文件损坏，请修复后再导出完整备份'); for (const item of this.sorted(kind)) items.push(await this.read(kind, item.id)); return items })
  }
  import(kind: HistoryKind, values: unknown, overwrite = false): Promise<DataImportResult> {
    return this.serial(async () => {
      await this.load()
      if (!Array.isArray(values)) throw new Error('导入历史必须为数组')
      const records = values.map((value, index) => normalizeHistory(value, kind, index))
      if (new Set(records.map(item => item.id)).size !== records.length) throw new Error('导入存在重复 ID')
      const result: DataImportResult = { added: 0, unchanged: 0, conflicts: 0 }
      for (const record of records) {
        let existing: HistoryRecord | undefined
        try { existing = await this.read(kind, record.id) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (existing && isDeepStrictEqual(existing, record)) { result.unchanged++; continue }
        if (existing) { result.conflicts++; if (!overwrite) continue }
        else result.added++
        await this.atomic(this.file(kind, record.id), { version: STORAGE_VERSION, data: record }); this.remember(kind, record)
      }
      return result
    }, true)
  }
}
