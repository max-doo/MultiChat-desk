import { randomUUID, createHash } from 'crypto'
import { isDeepStrictEqual } from 'util'
import type { DataImportResult } from '../shared/types/history'
import { constants } from 'fs'
import { realpathSync, watch, type FSWatcher } from 'fs'
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, parse as parsePath } from 'path'
import type Store from 'electron-store'
import type { ConversationNote, ConversationMindmap, NoteConversation, NoteDraft, NoteHighlight, NoteSourceDraft, MindmapGenerationSession, WorkbenchMindmapIndexEntry, MindmapFileState, MindmapFileReason } from '../shared/types/notes'
import { noteConversationKey } from '../shared/utils/noteIdentity'
import { normalizeNoteTranscriptMarkdown } from '../shared/utils/noteTranscript'
import { scanMindmapFiles, readMindmapFile, writeMindmapFile, removeMindmapFile, allocateMindmapFileName, renameMindmapFile, rewriteMindmapFileSource, validateImportedBody, mindmapFileNameOf, type MindmapScanResult } from './services/mindmapFileService'
import { MINDMAPS_DIR, MINDMAP_FILE_SUFFIX } from '../shared/utils/mindmapFile'
import { normalizeMindmapNewlines } from '../shared/utils/mindmapEdits'
import { realpath } from 'fs/promises'

type LegacyNote = ConversationNote & { snapshot?: string }
type StoredConversation = Omit<Partial<NoteConversation>, 'notes'> & { id: string; notes: LegacyNote[] }

/** 由导图文件派生的只读索引视图：文件是唯一权威，没有独立的索引文件。 */
interface MindmapIndex {
  version: 1
  mindmaps: WorkbenchMindmapIndexEntry[]
}

/** 导图目录扫描缓存条目：结果 + 有效期。 */
interface MindmapScanCache {
  scan: MindmapScanResult
  expiresAt: number
}

// 外部改动由目录 watcher 置脏，TTL 只兜底漏事件（Windows 上偶发）。
const MINDMAP_SCAN_TTL_MS = 500
// 外部改动通知面板的去抖：批量写入（如多文件复制）只刷新一次。
const MINDMAP_NOTIFY_DEBOUNCE_MS = 300

const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim()
// 工作台文档身份由「工作区 + 相对路径」推导，与对话的 sourceKey 共用一套查找逻辑。
const workbenchRootKey = (workspaceRoot: string): string =>
  process.platform === 'win32' ? workspaceRoot.replace(/\\/g, '/').toLowerCase() : workspaceRoot.replace(/\\/g, '/')
const workbenchSourceKey = (workspaceRoot: string, relativePath: string): string =>
  `workbench:${createHash('sha256').update(`${workbenchRootKey(workspaceRoot)}\n${relativePath}`).digest('hex')}`
export const workbenchContentHash = (content: string): string =>
  createHash('sha256').update(content.replace(/\r\n?/g, '\n')).digest('hex')
/** 二进制文档没有可读正文，用大小与 mtime 组成版本指纹。 */
export const workbenchBinaryHash = (size: number, mtime: number): string =>
  `binary:${createHash('sha256').update(`${size}:${mtime}`).digest('hex')}`

/** 导图文件被外部软件改过：保存必须由用户显式选择覆盖或载入，不能静默覆盖。 */
export class MindmapFileChangedError extends Error {
  constructor(message = '导图文件已在外部修改') {
    super(message)
    this.name = 'MindmapFileChangedError'
  }
}
const BINARY_DOCUMENT_EXTENSIONS = /\.(?:pdf|docx?|docm|pptx?|pptm)$/i
const isBinaryWorkbenchDocument = (relativePath: string): boolean => BINARY_DOCUMENT_EXTENSIONS.test(relativePath)
const newPathFor = (path: string, oldRelativePath: string, newRelativePath: string): string =>
  path === oldRelativePath ? newRelativePath : `${newRelativePath}${path.slice(oldRelativePath.length)}`
// 文档相对路径 → 导图文件基名（去掉目录与扩展名）。
const docBaseOf = (relativePath: string): string =>
  relativePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'mindmap'
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
  /**
   * 导图目录扫描缓存：一次画布保存会引发多轮 notes:changed 广播，
   * 每轮都全量扫目录纯属浪费。缓存按工作区根保存上一次扫描结果，
   * 自己的写入就地更新，外部改动由目录 watcher 置脏，另加 TTL 兜底漏事件。
   */
  private readonly mindmapScanCache = new Map<string, MindmapScanCache>()
  private readonly mindmapWatchers = new Map<string, FSWatcher>()
  private readonly mindmapNotifyTimers = new Map<string, NodeJS.Timeout>()
  /** 应用自己写过的导图文件 → 写入后的文件指纹；null 表示应用刚删掉它。 */
  private readonly mindmapSelfWrites = new Map<string, Map<string, string | null>>()
  /** 导图目录被外部改动时的回调，由 ipcHandlers 注入（用于广播 notes:changed 让面板刷新）。 */
  private onMindmapFilesChanged: (() => void) | null = null

  /** 注入外部改动通知（ipcHandlers 用 notesChanged 广播刷新面板）。 */
  setMindmapFilesChangedHandler(handler: (() => void) | null): void {
    this.onMindmapFilesChanged = handler
  }

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
      let key: string
      if (item.workbench) {
        // 工作台记录不参与同 sourceKey 合并：迁移期会留下同键空壳，合并会 rm 掉其中一条。
        key = `workbench-record:${item.id}`
      } else {
        key = item.sourceKey
        try { if (item.url) key = noteConversationKey(item.url, item.title) } catch { /* 保留旧来源 */ }
      }
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
        if (!item.workbench && item.sourceKey !== key) { item.sourceKey = key; await this.write(item) }
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
   * 工作区整体改名或换盘后，旧记录的绝对根路径失效；相对路径仍是稳定身份。
   * 只在「旧根下这篇文档已不存在、且全库恰好一条同相对路径记录」时复用：
   * 两个工作区同时存在且都有这篇文档时不能互相认领，否则会把另一边的记录搬走。
   * 判断到文档而不是根目录：工作区改名后旧目录可能被留成空壳，此时记录仍是孤儿。
   * 仅供需要认领记录的入口使用：普通查找仍按 root 严格匹配，避免跨工作区误命中。
   */
  private async findWorkbenchByPathUnlocked(workspaceRoot: string, relativePath: string, contentHash: string): Promise<NoteConversation | undefined> {
    const samePath = (await this.cachedValues()).filter(value =>
      value.workbench?.relativePath === relativePath &&
      workbenchRootKey(value.workbench.workspaceRoot) !== workbenchRootKey(workspaceRoot) &&
      // 正文也对得上才认领：旧根只是暂时离线（U 盘未插）时，
      // 不能把另一份同名同路径、但内容不同的文档记录搬走。
      (value.workbench.contentHash === contentHash || workbenchContentHash(value.snapshot) === contentHash))
    const orphaned: NoteConversation[] = []
    for (const candidate of samePath) {
      // Windows 上「旧目录被改名/搬走」和「盘符未挂载」的文件级 stat 都返回 ENOENT，
      // 不能靠它区分。改为看卷根：卷在线说明旧工作区确实不在了，可以认领；
      // 卷离线（U 盘/网络盘未挂载）则跳过，避免把还在使用的记录搬走。
      const oldRootPath = candidate.workbench!.workspaceRoot
      const volumeRoot = parsePath(oldRootPath).root
      const volume = await stat(volumeRoot).then(
        info => ({ info }),
        () => null
      )
      if (!volume?.info.isDirectory()) continue
      const probe = await stat(join(candidate.workbench!.workspaceRoot, relativePath)).then(
        info => ({ info }),
        (error: NodeJS.ErrnoException) => ({ error })
      )
      if ('info' in probe) {
        if (probe.info.isFile()) continue
        orphaned.push(candidate)
        continue
      }
      // 只有 ENOENT 才能判定「这篇文档在旧根下已不存在」。
      // EACCES 等错误不能当成删除，否则会把还在使用的记录搬走。
      if (probe.error.code === 'ENOENT') orphaned.push(candidate)
    }
    return orphaned.length === 1 ? structuredClone(orphaned[0]) : undefined
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

  /**
   * 工作区打开时一次性迁移旧全局记录（§12.1）：
   * 把 `workbench.workspaceRoot` 与当前根 realpath 相同的记录里的导图，
   * 先落成 `.multichat/mindmaps/` 文件、再写入索引、最后清掉全局记录的 mindmaps。
   * 每一步都可重入；正文不一致时保留全局记录，两份内容都不丢。
   */
  migrateWorkspace(workspaceRoot: string): Promise<{ migrated: number }> {
    return this.serial(async () => {
      let rootReal: string
      try {
        rootReal = await realpath(workspaceRoot)
      } catch {
        return { migrated: 0 }
      }
      const candidates = (await this.cachedValues()).filter(value => {
        if (!value.workbench || !value.mindmaps.length) return false
        try {
          return workbenchRootKey(realpathSync(value.workbench.workspaceRoot)) === workbenchRootKey(rootReal)
        } catch {
          return false
        }
      })
      if (!candidates.length) return { migrated: 0 }
      let migrated = 0
      for (const item of candidates) {
        const source = item.workbench!
        const carried: ConversationMindmap[] = []
        for (const map of item.mindmaps) {
          // 每轮重取扫描：同一条旧记录里若有多个同 id 的脏数据，
          // 用循环外的旧快照会把第二张也判成「磁盘没有」，再写一份重复文件。
          this.invalidateMindmapScan(workspaceRoot)
          const scan = await this.mindmapScan(workspaceRoot)
          // 按 id 判断是否已落盘，不能只看按文档名分配的目标路径：
          // 用户可能已经把文件改成别的名字，再按目标名写一份会产生同 id 两份文件。
          const sameId = scan.files.filter(file => file.id === map.id)
          if (sameId.length > 1) {
            // 已有重复副本：不写第三份，留给用户清理。
            console.warn('[MindmapIndex] 迁移跳过同 id 不同正文导图:', map.id)
            carried.push(map)
            continue
          }
          if (sameId.length === 1) {
            if (!this.mindmapBodyEquals(map, sameId[0].body) || sameId[0].source !== source.relativePath) {
              // 正文不同（可能在外部改过）或绑定已指向别的文档：两份都保留，不清理全局记录，
              // 否则清掉记录后这篇文档就再也找不到自己的导图。
              console.warn('[MindmapIndex] 迁移保留未收敛的导图:', map.id)
              carried.push(map)
            } else {
              migrated++
            }
            continue
          }
          const fileName = await allocateMindmapFileName(workspaceRoot, docBaseOf(source.relativePath), map.id)
          await this.writeMindmap(
            workspaceRoot,
            fileName,
            { id: map.id, source: source.relativePath, title: map.title, updatedAt: map.updatedAt },
            map.markdown
          )
          migrated++
        }
        item.mindmaps = carried
        if (!item.mindmaps.length && !item.notes.length) {
          await rm(this.file(item.id), { force: true })
          this.cache?.delete(item.id)
        } else {
          await this.write(item)
        }
      }
      return { migrated }
    })
  }

  // ---- 工作台导图文件（.multichat/mindmaps/*.mindmap.md） ----

  /**
   * 取导图目录扫描结果：命中缓存直接返回，否则扫一次并缓存。
   * 调用方需已持有 serial 队列。
   */
  private async mindmapScan(workspaceRoot: string): Promise<MindmapScanResult> {
    const key = workbenchRootKey(workspaceRoot)
    const cached = this.mindmapScanCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.scan
    const scan = await scanMindmapFiles(workspaceRoot)
    this.mindmapScanCache.set(key, { scan, expiresAt: Date.now() + MINDMAP_SCAN_TTL_MS })
    this.ensureMindmapWatcher(workspaceRoot)
    return scan
  }

  /** 丢弃扫描缓存，下次读取重新扫盘。watcher 事件与外部改动走这里。 */
  private invalidateMindmapScan(workspaceRoot: string): void {
    this.mindmapScanCache.delete(workbenchRootKey(workspaceRoot))
  }

  /**
   * 监听 `.multichat/mindmaps` 单层目录：外部软件改导图文件时置脏。
   * 只监听一层，事件量极小；目录不存在时等首次写入后再建。
   */
  private ensureMindmapWatcher(workspaceRoot: string): void {
    const key = workbenchRootKey(workspaceRoot)
    if (this.mindmapWatchers.has(key)) return
    const dir = join(workspaceRoot, MINDMAPS_DIR)
    try {
      const watcher = watch(dir, { persistent: false }, () => {
        this.invalidateMindmapScan(workspaceRoot)
        // 不在这里按时间窗直接丢弃事件：应用写完 10ms 后外部又改了同一文件时，
        // 事件同样落在窗口里，会被一起吞掉。改为去抖后再读盘，逐文件比内容。
        const timer = this.mindmapNotifyTimers.get(key)
        if (timer) clearTimeout(timer)
        this.mindmapNotifyTimers.set(key, setTimeout(() => {
          this.mindmapNotifyTimers.delete(key)
          void this.notifyExternalMindmapChange(workspaceRoot)
        }, MINDMAP_NOTIFY_DEBOUNCE_MS))
      })
      watcher.on('error', () => {
        this.mindmapWatchers.delete(key)
        try { watcher.close() } catch { /* 已关闭 */ }
      })
      this.mindmapWatchers.set(key, watcher)
    } catch {
      // 目录还不存在：不监听，TTL 兜底。
    }
  }

  /** 关闭全部导图目录监听（应用退出时调用）。 */
  shutdownMindmapWatchers(): void {
    for (const timer of this.mindmapNotifyTimers.values()) clearTimeout(timer)
    this.mindmapNotifyTimers.clear()
    for (const watcher of this.mindmapWatchers.values()) {
      try { watcher.close() } catch { /* 已关闭 */ }
    }
    this.mindmapWatchers.clear()
    this.mindmapScanCache.clear()
  }

  /** 写导图文件并让扫描缓存失效（写后读必须看到新内容）。 */
  private async writeMindmap(workspaceRoot: string, fileName: string, fields: { id: string; source: string; title: string; updatedAt?: number }, body: string): Promise<string> {
    return this.withSelfWrite(workspaceRoot, async () => {
      const result = await writeMindmapFile(workspaceRoot, fileName, fields, body)
      this.invalidateMindmapScan(workspaceRoot)
      await this.recordSelfWrite(workspaceRoot, result, 'file')
      return result
    })
  }

  private async rewriteMindmapSource(workspaceRoot: string, relativePath: string, next: { source: string; title?: string }): Promise<string> {
    return this.withSelfWrite(workspaceRoot, async () => {
      const result = await rewriteMindmapFileSource(workspaceRoot, relativePath, next)
      this.invalidateMindmapScan(workspaceRoot)
      await this.recordSelfWrite(workspaceRoot, relativePath, 'file')
      return result
    })
  }

  private async renameMindmap(workspaceRoot: string, fromRelativePath: string, toFileName: string): Promise<string> {
    return this.withSelfWrite(workspaceRoot, async () => {
      const result = await renameMindmapFile(workspaceRoot, fromRelativePath, toFileName)
      this.invalidateMindmapScan(workspaceRoot)
      await this.recordSelfWrite(workspaceRoot, fromRelativePath, null)
      await this.recordSelfWrite(workspaceRoot, result, 'file')
      return result
    })
  }

  private async removeMindmap(workspaceRoot: string, relativePath: string): Promise<void> {
    return this.withSelfWrite(workspaceRoot, async () => {
      await removeMindmapFile(workspaceRoot, relativePath)
      this.invalidateMindmapScan(workspaceRoot)
      await this.recordSelfWrite(workspaceRoot, relativePath, null)
    })
  }

  /**
   * 应用内写导图后补建 watcher（首次写入会创建目录），并让调用方接着记账。
   *
   * 不能用时间窗抑制自写事件：应用写完几百毫秒内用户在外部又改同一文件，
   * 事件同样落在窗口里，会被误当成自写吞掉，面板就一直停在旧内容。
   * 现在改为写后记录文件指纹，watcher 事件到达时逐个比对。
   */
  private async withSelfWrite<T>(workspaceRoot: string, operation: () => Promise<T>): Promise<T> {
    const result = await operation()
    // 首次写入会创建目录，此前 watcher 建不起来，这里补建。
    this.ensureMindmapWatcher(workspaceRoot)
    return result
  }

  /** 记录本次应用写入的文件指纹；`'file'` 表示按磁盘实际内容读取。 */
  private async recordSelfWrite(workspaceRoot: string, relativePath: string, hash: string | null | 'file'): Promise<void> {
    const resolved = hash === 'file' ? await this.mindmapFileStamp(workspaceRoot, relativePath) : hash
    const key = workbenchRootKey(workspaceRoot)
    const entries = this.mindmapSelfWrites.get(key) ?? new Map<string, string | null>()
    entries.set(relativePath, resolved)
    this.mindmapSelfWrites.set(key, entries)
  }

  /**
   * 导图文件的内容指纹：大小 + mtime + 快速内容哈希。
   * 只读首尾各 4KB：导图正文长度有限，抽样足以区分“外部改写”与“同一次写入的重复事件”；
   * 外部编辑器用“临时文件 + 原子替换”时 mtime 可能不变，内容抽样用于兜底。
   */
  private async mindmapFileStamp(workspaceRoot: string, relativePath: string): Promise<string | null> {
    try {
      const info = await stat(join(workspaceRoot, relativePath))
      if (!info.isFile()) return null
      const handle = await open(join(workspaceRoot, relativePath), 'r')
      try {
        const sample = Buffer.alloc(Math.min(info.size, 8192))
        if (sample.length) {
          const head = Math.min(4096, sample.length)
          await handle.read(sample, 0, head, 0)
          if (sample.length > head) await handle.read(sample, head, sample.length - head, Math.max(0, info.size - (sample.length - head)))
        }
        return `${info.size}:${info.mtimeMs}:${createHash('sha256').update(sample).digest('hex').slice(0, 16)}`
      } finally {
        await handle.close()
      }
    } catch {
      return null
    }
  }

  /**
   * watcher 去抖后判断这次目录变化是否全部来自应用自身。
   * 逐文件比对大小 + mtime：只要有一份与应用写下的不同，或出现未记录的新文件，就广播刷新。
   * 目录最多 500 个文件，且只在防抖后的事件里执行，成本可忽略。
   */
  private async notifyExternalMindmapChange(workspaceRoot: string): Promise<void> {
    const key = workbenchRootKey(workspaceRoot)
    const records = this.mindmapSelfWrites.get(key)
    const dir = join(workspaceRoot, MINDMAPS_DIR)
    let names: string[] = []
    try {
      names = (await readdir(dir)).filter(name => name.endsWith(MINDMAP_FILE_SUFFIX))
    } catch {
      names = []
    }
    const present = new Set(names.map(name => `${MINDMAPS_DIR}/${name}`))
    let changed = !records || records.size === 0
    // 首次见到的文件：这次广播出去，同时记下当前指纹，之后同一文件再变才继续提示。
    let unseen = false
    if (!changed && records) {
      for (const [relativePath, stamp] of records) {
        const exists = present.has(relativePath)
        // 应用删除的文件又出现，或应用写入的文件消失：都是外部改动。
        if (stamp === null) {
          if (exists) { changed = true; break }
          // 应用删掉的文件仍然不存在：这一条不是外部改动，继续检查其余文件，
          // 否则同一去抖窗口里「删 A + 外部改 B」会因先命中 A 而漏掉 B。
          continue
        }
        if (!exists) { changed = true; break }
        if (await this.mindmapFileStamp(workspaceRoot, relativePath) !== stamp) { changed = true; break }
      }
    }
    if (!changed && records) {
      for (const relativePath of present) {
        if (!records.has(relativePath)) { unseen = true; break }
      }
      if (unseen) changed = true
    }
    // 比对完把记录收敛成“磁盘当前快照”：同一次改动只广播一次，
    // 后续事件只有文件真的再变才会再次命中。应用删掉的文件不再占位。
    const kept = new Map<string, string | null>()
    for (const relativePath of present) {
      kept.set(relativePath, await this.mindmapFileStamp(workspaceRoot, relativePath))
    }
    if (kept.size) this.mindmapSelfWrites.set(key, kept)
    else this.mindmapSelfWrites.delete(key)
    if (changed) this.onMindmapFilesChanged?.()
  }

  /**
   * 由导图文件直接派生索引视图。
   *
   * 文件是唯一权威：每个 `.mindmap.md` 就是一条索引项，不再有 index.json。
   * 导图目录里没有对应文件时，该导图就不存在——这也是「删文件即删导图」的语义。
   * 同 id 多文件会派生多条，状态查询据此报 duplicate。
   */
  private async workbenchIndex(workspaceRoot: string): Promise<{ index: MindmapIndex; scan: MindmapScanResult }> {
    const scan = await this.mindmapScan(workspaceRoot)
    // 同一 id 出现多份文件时只派生一条（取 mtime 最新的一份），避免面板出现重复项。
    // 重复本身由 workbenchMindmapFileStatus 依据 scan.files 报 invalid(duplicate)。
    const byId = new Map<string, (typeof scan.files)[number]>()
    for (const file of scan.files) {
      const kept = byId.get(file.id)
      if (!kept || (file.mtimeMs ?? 0) > (kept.mtimeMs ?? 0)) byId.set(file.id, file)
    }
    const index: MindmapIndex = {
      version: 1,
      mindmaps: [...byId.values()].map(file => ({
        id: file.id,
        source: file.source || '',
        title: file.title || '未命名导图',
        markdown: file.body,
        fileSync: { relativePath: file.relativePath },
        // 版本戳优先用 frontmatter，外部软件新建或改写、没有该字段时退回 mtime。
        // 不能把 mtime 也参与取大：写入后 mtime 常比 frontmatter 晚几毫秒，会让下一次保存误判成并发修改。
        updatedAt: file.updatedAt ?? Math.round(file.mtimeMs ?? 0)
      }))
    }
    return { index, scan }
  }

  /** 与 serial 串行的索引读取：IPC/面板统一走这里，避免与迁移/导出交错。 */
  workbenchIndexQueued(workspaceRoot: string): Promise<{ index: MindmapIndex; scan: MindmapScanResult }> {
    return this.serial(() => this.workbenchIndex(workspaceRoot))
  }

  /**
   * 把一份导图落成文件：已有同 id 文件就覆盖它，否则按文档名分配新文件名。
   * 返回文件的相对路径；导图文件本身就是索引项，不需要额外写索引。
   */
  private async materializeMindmap(
    workspaceRoot: string,
    entry: { id: string; source: string; title: string; markdown: string; updatedAt?: number },
    options?: { preserveExternalBody?: boolean }
  ): Promise<string> {
    // 低频率操作（生成、复制、迁移）直接读盘，避免缓存里漏掉刚由外部软件写入的同 id 文件。
    this.invalidateMindmapScan(workspaceRoot)
    const scan = await this.mindmapScan(workspaceRoot)
    const sameId = scan.files.filter(file => file.id === entry.id)
    if (sameId.length > 1) throw new Error('目录里有多份同 id 导图文件，请先清理')
    // 迁移旧记录时，同 id 文件可能是用户在外部软件里改过、或已改绑到另一篇文档的版本；
    // 正文不同、绑定不同都不覆盖，保留记录交给用户裁决。
    if (options?.preserveExternalBody && sameId.length === 1 &&
      (!this.mindmapBodyEquals(entry, sameId[0].body) || sameId[0].source !== entry.source)) {
      throw new Error('同 id 导图文件已被外部修改或改绑')
    }
    const fileName = sameId.length === 1
      ? mindmapFileNameOf(sameId[0].relativePath)
      : null
    const target = fileName ?? await allocateMindmapFileName(workspaceRoot, docBaseOf(entry.source), entry.id)
    return this.writeMindmap(
      workspaceRoot,
      target,
      { id: entry.id, source: entry.source, title: entry.title, updatedAt: entry.updatedAt ?? Date.now() },
      entry.markdown
    )
  }

  /** 按 source 从索引组装导图，供面板读取。 */
  private async workbenchMindmapsFor(workspaceRoot: string, relativePath: string): Promise<ConversationMindmap[]> {
    const { index } = await this.workbenchIndex(workspaceRoot)
    return index.mindmaps
      .filter(entry => entry.source === relativePath)
      .map(entry => ({
        id: entry.id,
        title: entry.title,
        markdown: entry.markdown,
        platform: '工作台',
        sourceRevision: 0,
        createdAt: entry.updatedAt,
        updatedAt: entry.updatedAt,
        source: entry.source,
        fileSync: entry.fileSync
      }))
  }

  findSource(sourceKey: string): Promise<NoteConversation | undefined> { return this.serial(() => this.findSourceUnlocked(sourceKey)) }

  get(id: string): Promise<NoteConversation> { return this.serial(() => this.readWithMindmaps(id)) }

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
  prepareWorkbenchSource(workspaceRoot: string, relativePath: string, title: string, content: string, fingerprint?: { size: number; mtime: number }, contentHash?: string): Promise<NoteConversation> {
    return this.serial(async () => {
      if (!workspaceRoot || !relativePath) throw new Error('工作台文档路径无效')
      const hash = contentHash || workbenchContentHash(content)
      // 工作区换盘/改名后旧记录的根路径失效，按相对路径认领唯一一条孤儿记录。
      const existing = await this.findWorkbenchUnlocked(workspaceRoot, relativePath) ??
        await this.findWorkbenchByPathUnlocked(workspaceRoot, relativePath, hash)
      if (existing) {
        const previous = existing.workbench!
        const contentChanged = existing.snapshot !== content || previous.contentHash !== hash
        const titleChanged = existing.title !== title
        // 工作台导图以文件为唯一权威；清空持久化 mindmaps，避免旧记录覆盖文件。
        const legacyMindmaps = existing.mindmaps
        existing.mindmaps = []
        // 旧记录里残留的导图落成文件；迁完后这段就是空操作。
        if (legacyMindmaps.length) {
          const carried: ConversationMindmap[] = []
          for (const map of legacyMindmaps) {
            try {
              await this.materializeMindmap(
                workspaceRoot,
                { id: map.id, source: relativePath, title: map.title, markdown: map.markdown, updatedAt: map.updatedAt },
                // 同 id 文件可能是外部软件改过的版本：正文不同就不覆盖，保留记录等用户裁决。
                { preserveExternalBody: true }
              )
            } catch (error) {
              console.warn('[MindmapIndex] 迁移保留未覆盖的导图:', map.id, error)
              carried.push(map)
            }
          }
          existing.mindmaps = carried
        }
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
        // 换盘/改名后来源键也必须跟着换：其他入口仍按 sourceKey 找这条记录，
        // 只改 workspaceRoot 会留下一条「能找到文件、找不到记录」的半失联状态。
        if (workbenchRootKey(previous.workspaceRoot) !== workbenchRootKey(workspaceRoot)) {
          existing.sourceKey = workbenchSourceKey(workspaceRoot, relativePath)
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
      // 导图文件跟随改绑：source 从旧路径换到新路径。
      await this.rekeyMindmapSources(workspaceRoot, oldRelativePath, newRelativePath)
      return moved
    })
  }

  /**
   * 文档改名后迁移导图文件：
   * source 等于旧路径/在旧目录前缀下的导图，frontmatter.source 与文件名一起改。
   * 同 id 有多份文件时整项跳过，留给用户先清理重复。
   */
  private async rekeyMindmapSources(workspaceRoot: string, oldRelativePath: string, newRelativePath: string): Promise<void> {
    const { index, scan } = await this.workbenchIndex(workspaceRoot)
    const oldPrefix = `${oldRelativePath}/`
    const touched = index.mindmaps.filter(entry =>
      entry.source === oldRelativePath || entry.source.startsWith(oldPrefix))
    if (!touched.length) return
    let changed = false
    for (const entry of touched) {
      const nextSource = entry.source === oldRelativePath
        ? newRelativePath
        : `${newRelativePath}${entry.source.slice(oldRelativePath.length)}`
      // 按每张导图自己的新来源算文件名：重命名整个目录时，
      // 子文档的导图不能统一退化成「文件夹名 (2)」。
      const newDocBase = docBaseOf(nextSource)
      // 只处理「文件与索引绑定一致」的条目；待确认的跳过。
      let canRewriteFile = false
      if (entry.fileSync) {
        // 按 fileSync 读文件：id 与 source 都要一致，防止把被替换/被改绑的文件改写。
        const file = await this.readFileAtPath(workspaceRoot, entry.fileSync.relativePath).catch(() => null)
        if (!file) {
          // 指针失效：按 id 在同目录找。唯一一份且正文一致 → 认领（文件被外部改名）；
          // 一份都没有 → 文件确实不存在，跳过；多份 → 有歧义，整项跳过。
          const sameId = scan.files.filter(f => f.id === entry.id)
          if (sameId.length === 0) {
            // 无文件可改。
          } else if (sameId.length === 1 && this.mindmapBodyEquals(entry, sameId[0].body)) {
            entry.fileSync = { relativePath: sameId[0].relativePath }
            canRewriteFile = true
          } else {
            continue
          }
        } else {
          // 文件已被替换/改绑时不收敛；正文是否被外部改过由 save 的 expectedMarkdown 判定，
          // 这里只改 frontmatter.source 与文件名，不会碰正文。
          if (file.id !== entry.id || file.source !== entry.source) continue
          if (scan.files.filter(f => f.id === entry.id).length > 1) continue
          canRewriteFile = true
        }
      }
      if (!canRewriteFile || !entry.fileSync) continue
      // 文件存在时把 frontmatter.source 与文件名一起改。
      try {
        const file = await this.readFileAtPath(workspaceRoot, entry.fileSync.relativePath)
        if (!file) continue
        const newName = await allocateMindmapFileName(workspaceRoot, newDocBase, entry.id)
        if (file.relativePath === `${MINDMAPS_DIR}/${newName}`) {
          await this.rewriteMindmapSource(workspaceRoot, entry.fileSync.relativePath, { source: nextSource })
        } else {
          await this.rewriteMindmapSource(workspaceRoot, entry.fileSync.relativePath, { source: nextSource })
          await this.renameMindmap(workspaceRoot, entry.fileSync.relativePath, newName)
        }
        entry.fileSync = { relativePath: `${MINDMAPS_DIR}/${newName}` }
        changed = true
      } catch (error) {
        console.warn('[MindmapIndex] 导图改名失败:', entry.fileSync.relativePath, error)
      }
    }
    if (changed) this.invalidateMindmapScan(workspaceRoot)
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
      const prefix = `${sourceRelativePath}/`
      // 导图在文件里：按 source 从派生索引取，而不是读记录里的 mindmaps。
      const { index } = await this.workbenchIndex(workspaceRoot)
      const sourceMaps = index.mindmaps.filter(entry =>
        entry.source === sourceRelativePath || entry.source.startsWith(prefix))
      if (sourceMaps.length) {
        // 按来源文档分组：复制目录时，每篇子文档各自建记录、各自克隆导图。
        const groups = new Map<string, typeof sourceMaps>()
        for (const entry of sourceMaps) {
          const bucket = groups.get(entry.source)
          if (bucket) bucket.push(entry)
          else groups.set(entry.source, [entry])
        }
        // 记录里尚未迁移的残留导图也参与克隆：否则「文件 + 残留」混合状态会漏图。
        const legacy = (await this.cachedValues()).filter(value =>
          value.workbench &&
          workbenchRootKey(value.workbench.workspaceRoot) === workbenchRootKey(workspaceRoot) &&
          value.mindmaps.length &&
          (value.workbench.relativePath === sourceRelativePath || value.workbench.relativePath.startsWith(prefix)))
        let cloned = 0
        for (const [sourceDoc, maps] of groups) {
          const targetDoc = newPathFor(sourceDoc, sourceRelativePath, targetRelativePath)
          if (await this.findWorkbenchUnlocked(workspaceRoot, targetDoc)) continue
          const record = await this.createWorkbenchRecordUnlocked(workspaceRoot, targetDoc)
          if (!record) continue
          for (const entry of maps) {
            await this.materializeMindmap(workspaceRoot, {
              id: randomUUID(),
              source: targetDoc,
              title: entry.title,
              markdown: entry.markdown
            })
            cloned++
          }
          for (const item of legacy.filter(value => value.workbench!.relativePath === sourceDoc)) {
            for (const map of item.mindmaps) {
              if (maps.some(entry => entry.id === map.id)) continue
              await this.materializeMindmap(workspaceRoot, {
                id: randomUUID(),
                source: targetDoc,
                title: map.title,
                markdown: map.markdown
              })
              cloned++
            }
          }
        }
        // 只有 legacy 导图、还没有落成文件的子文档：也要建副本记录并克隆，
        // 否则目录复制会静默漏掉这些图。
        // 同一来源可能有多条 legacy 记录：按来源分组，只建一次副本记录，
        // 所有记录里的导图合并后克隆。
        const legacyOnly = new Map<string, ConversationMindmap[]>()
        for (const item of legacy) {
          const sourceDoc = item.workbench!.relativePath
          if (groups.has(sourceDoc)) continue
          legacyOnly.set(sourceDoc, [...(legacyOnly.get(sourceDoc) ?? []), ...item.mindmaps])
        }
        for (const [sourceDoc, maps] of legacyOnly) {
          const targetDoc = newPathFor(sourceDoc, sourceRelativePath, targetRelativePath)
          if (await this.findWorkbenchUnlocked(workspaceRoot, targetDoc)) continue
          const record = await this.createWorkbenchRecordUnlocked(workspaceRoot, targetDoc)
          if (!record) continue
          for (const map of maps) {
            await this.materializeMindmap(workspaceRoot, {
              id: randomUUID(),
              source: targetDoc,
              title: map.title,
              markdown: map.markdown
            })
            cloned++
          }
        }
        return cloned
      }
      const source = await this.findWorkbenchUnlocked(workspaceRoot, sourceRelativePath)
      if (!source) return 0
      return this.duplicateOne(workspaceRoot, source, targetRelativePath)
    })
  }

  /** 为已复制到磁盘的文档建立来源记录；读不到文件时返回 null。 */
  private async createWorkbenchRecordUnlocked(workspaceRoot: string, relativePath: string): Promise<NoteConversation | null> {
    let content = ''
    let fingerprint: { size: number; mtime: number } | undefined
    let contentHash = ''
    try {
      const full = join(workspaceRoot, relativePath)
      const info = await stat(full)
      content = isBinaryWorkbenchDocument(relativePath) ? '' : await readFile(full, 'utf8')
      contentHash = content ? workbenchContentHash(content) : workbenchBinaryHash(info.size, info.mtimeMs)
      fingerprint = { size: info.size, mtime: info.mtimeMs }
    } catch { return null }
    const now = Date.now()
    const conversation: NoteConversation = {
      version: 2,
      id: randomUUID(),
      sourceKey: workbenchSourceKey(workspaceRoot, relativePath),
      platform: '工作台',
      title: relativePath.split('/').pop() || relativePath,
      url: '',
      updatedAt: now,
      snapshot: content,
      snapshotRevision: 1,
      notes: [],
      mindmaps: [],
      workbench: { workspaceRoot, relativePath, contentHash, ...fingerprint }
    }
    await this.write(conversation)
    return conversation
  }

  private async duplicateOne(workspaceRoot: string, source: NoteConversation, targetRelativePath: string): Promise<number> {
    const existing = await this.findWorkbenchUnlocked(workspaceRoot, targetRelativePath)
    if (existing) return 0
    // 工作台导图以文件为准：按来源查文件。记录里的 mindmaps 只可能是尚未迁移的残留，
    // 与文件导图合并去重后一起克隆，避免复制时漏掉任何一张。
    const { index } = await this.workbenchIndex(workspaceRoot)
    const maps = index.mindmaps.filter(entry => entry.source === source.workbench?.relativePath)
    // 没有导图就不建记录：复制普通文档不该在笔记库里留下空条目。
    if (!maps.length && !source.mindmaps.length) return 0
    const conversation = await this.createWorkbenchRecordUnlocked(workspaceRoot, targetRelativePath)
    if (!conversation) return 0
    let cloned = 0
    for (const entry of maps) {
      await this.materializeMindmap(workspaceRoot, {
        id: randomUUID(),
        source: targetRelativePath,
        title: entry.title,
        markdown: entry.markdown
      })
      cloned++
    }
    for (const map of source.mindmaps) {
      if (maps.some(entry => entry.id === map.id)) continue
      await this.materializeMindmap(workspaceRoot, {
        id: randomUUID(),
        source: targetRelativePath,
        title: map.title,
        markdown: map.markdown
      })
      cloned++
    }
    return cloned
  }

  /** 删除前的确认信息：文档（含目录下的文档）关联了多少张导图。 */
  workbenchTrashImpact(workspaceRoot: string, relativePaths: string[]): Promise<{ documents: number; mindmaps: number }> {
    return this.serial(async () => {
      const { index } = await this.workbenchIndex(workspaceRoot)
      const sources = new Set(index.mindmaps.map(entry => entry.source))
      const documents = [...sources].filter(source =>
        relativePaths.some(target => source === target || source.startsWith(`${target}/`))).length
      const mindmaps = index.mindmaps.filter(entry =>
        relativePaths.some(target => entry.source === target || entry.source.startsWith(`${target}/`))).length
      return { documents, mindmaps }
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
      // 导图文件一并删除：source 精确等于文档或在目录前缀下。
      const { index } = await this.workbenchIndex(workspaceRoot)
      const doomed = index.mindmaps.filter(entry =>
        relativePaths.some(target => entry.source === target || entry.source.startsWith(`${target}/`)))
      if (doomed.length) {
        for (const entry of doomed) {
          if (!entry.fileSync) continue
          // 按 fileSync 读实际文件：id 与 source 都要对得上才删，防误删被替换成的别的导图。
          const file = await this.readFileAtPath(workspaceRoot, entry.fileSync.relativePath).catch(() => null)
          if (!file || file.id !== entry.id || file.source !== entry.source) continue
          try { await this.removeMindmap(workspaceRoot, entry.fileSync.relativePath) }
          catch (error) { console.warn('[MindmapIndex] 导图文件删除失败:', entry.fileSync.relativePath, error) }
        }
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
    index: Map<string, { size?: number; mtime?: number }>,
    options?: { force?: boolean; targets?: Array<{ conversationId: string }> }
  ): Promise<{ deleted: number; relinked: number; relinks: Array<{ from: string; to: string }>; pendingDeletions: Array<{ conversationId: string; relativePath: string }> }> {
    return this.serial(async () => {
      const root = workbenchRootKey(workspaceRoot)
      const targets = (await this.cachedValues()).filter(value =>
        value.workbench && workbenchRootKey(value.workbench.workspaceRoot) === root)
      if (!targets.length) return { deleted: 0, relinked: 0, relinks: [], pendingDeletions: [] }
      // 工作区根目录不可读（盘符未挂载、目录被外部删除）时整轮跳过，不能把记录全删了。
      const rootStat = await stat(workspaceRoot).catch(() => null)
      if (!rootStat?.isDirectory()) return { deleted: 0, relinked: 0, relinks: [], pendingDeletions: [] }

      // 闸门一：索引为空且有待对账记录 → 整轮跳过（可能是挂载失败或索引被清空）。
      // 显式 targets 例外：待删集合由用户确认固定，后面逐条 ENOENT 直查兜底。
      if (!index.size && !options?.targets?.length) return { deleted: 0, relinked: 0, relinks: [], pendingDeletions: [] }

      let deleted = 0
      let relinked = 0
      const relinks: Array<{ from: string; to: string }> = []
      const pendingDeletions: Array<{ conversationId: string; relativePath: string }> = []
      const allowedIds = options?.targets?.length ? new Set(options.targets.map(t => t.conversationId)) : null

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
          // 外部改名同样要搬导图绑定：只改记录会让索引 source 停在旧路径，
          // 面板按 source 过滤就看不到导图（§6.2）。
          await this.rekeyMindmapSources(workspaceRoot, source.relativePath, moved)
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
        pendingDeletions.push({ conversationId: item.id, relativePath: source.relativePath })
      }
      // 闸门二：删除数 ≥3 且占比 ≥50% → 跳过删除，等用户确认。
      const ratioBlocked = pendingDeletions.length >= 3 && pendingDeletions.length * 2 >= targets.length
      const scoped = allowedIds ? pendingDeletions.filter(p => allowedIds.has(p.conversationId)) : pendingDeletions
      // force 只绕过闸门二：闸门一（索引为空）与 ENOENT 以外错误仍在上面拦住。
      // 用户确认时带上具体 targets，执行时固定为这批，不删新增缺失项。
      const effective = ratioBlocked && !options?.force ? [] : scoped
      for (const pending of effective) {
        const item = missing.find(m => m.id === pending.conversationId)
        if (!item) continue
        await rm(this.file(item.id), { force: true })
        this.cache?.delete(item.id)
        deleted++
      }
      const executedIds = new Set(effective.map(p => p.conversationId))
      const remaining = pendingDeletions.filter(p => !executedIds.has(p.conversationId))
      return { deleted, relinked, relinks, pendingDeletions: remaining }
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
    // 二进制文件没有可读正文，多个同指纹候选无法可靠区分，不猜。
    if (source.contentHash.startsWith('binary:') || isBinaryWorkbenchDocument(source.relativePath)) return null
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
    const conversation = this.convert(JSON.parse(await readFile(this.file(id), 'utf8')) as StoredConversation)
    return conversation
  }

  /**
   * notes:get 专用读路径：工作台记录的导图不持久化在 JSON 里，
   * 只在这条只读路径按索引组装返回；写路径仍用 read()，避免组装值被写回磁盘
   * （写回后 prepareWorkbenchSource 会把已删导图当「未迁移残留」复活）。
   */
  private async readWithMindmaps(id: string): Promise<NoteConversation> {
    const conversation = await this.read(id)
    if (conversation.workbench) {
      conversation.mindmaps = await this.workbenchMindmapsFor(conversation.workbench.workspaceRoot, conversation.workbench.relativePath)
    }
    return conversation
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
      if (workbenchScope) map.workbenchScope = { ...workbenchScope, contentHash: workbenchScope.contentHash || conversation.workbench?.contentHash || workbenchContentHash(conversation.snapshot) }
      if (conversation.workbench) {
        // 工作台导图直接落成文件，不写进全局记录；面板按 source 读取。
        map.source = conversation.workbench.relativePath
        const workspaceRoot = conversation.workbench.workspaceRoot
        // 生成即落盘：导图文件始终是最新版本，也是唯一的索引来源。
        try {
          const relativePath = await this.materializeMindmap(workspaceRoot, {
            id: map.id,
            source: map.source,
            title: map.title,
            markdown: map.markdown,
            updatedAt: map.updatedAt
          })
          map.fileSync = { relativePath }
        } catch (error) {
          // 落盘失败时导图无法持久化；报错让用户重试，而不是留下看不见的副本。
          console.warn('[MindmapIndex] 导图落盘失败:', error)
          throw error
        }
      } else {
        conversation.mindmaps.push(map)
      }
      conversation.updatedAt = now
      await this.write(conversation)
      return { conversationId: conversation.id, mindmap: map }
    })
  }

  updateMindmap(conversationId: string, mapId: string, markdown: string, title: string, expectedUpdatedAt: number, generationSession?: MindmapGenerationSession, expectedMarkdown?: string, force?: boolean): Promise<ConversationMindmap> {
    return this.serial(async () => {
      if (typeof markdown !== 'string' || markdown.length > 200_000 || typeof title !== 'string' || title.length > 200) throw new Error('导图内容无效或过大')
      const conversation = await this.read(conversationId)
      if (conversation.workbench) {
        // 工作台导图在文件里，不在记录的 mindmaps 数组中。
        const workspaceRoot = conversation.workbench.workspaceRoot
        const { index, scan } = await this.workbenchIndex(workspaceRoot)
        const entry = index.mindmaps.find(item => item.id === mapId)
        if (!entry) throw new Error('导图不存在')
        // 导图可能已在外部被改绑到另一篇文档：保存不能把它写进别人的导图。
        if (entry.source !== conversation.workbench.relativePath) {
          throw new Error('导图已改绑到其他文档，请刷新后再编辑')
        }
        // 同 id 多份文件时无法判断该写哪一份，拒绝保存，避免两份内容长期分叉。
        if (scan.files.filter(file => file.id === mapId).length > 1) {
          throw new Error('目录里有多份同 id 导图文件，请先清理')
        }
        // force 是用户对「文件已被外部修改」的显式覆盖确认，此时不再用版本戳拦截。
        if (!force && entry.updatedAt !== expectedUpdatedAt) throw new Error('导图已在其他窗口修改，请保留当前大纲并重新打开后再编辑')

        // 先看文件现状：外部软件改过正文时不能静默覆盖，交给用户裁决。
        if (!entry.fileSync) throw new Error('导图文件路径缺失')
        const pointedFile = await this.readFileAtPath(workspaceRoot, entry.fileSync.relativePath)
        if (!pointedFile) throw new Error('导图文件已不存在')
        if (pointedFile.id !== entry.id || pointedFile.source !== entry.source) {
          throw new Error('导图文件已被替换或改绑到其他文档，请先在菜单里确认绑定')
        }
        // 用编辑前的正文做冲突判定：frontmatter 的 updatedAt 不会被外部软件更新，
        // 仅靠版本戳会把「外部改过正文」误判成没有变化。
        if (!force && expectedMarkdown !== undefined && !this.mindmapBodyEquals({ ...entry, markdown: expectedMarkdown }, pointedFile.body)) {
          throw new MindmapFileChangedError()
        }

        entry.markdown = markdown
        entry.title = title.trim() || '未命名导图'
        entry.updatedAt = Math.max(Date.now(), entry.updatedAt + 1)

        // 无外部改动 → 保存即落盘，文件始终是最新版本（与编辑 Markdown 文本一致）。
        const fileName = mindmapFileNameOf(pointedFile.relativePath)
        if (!fileName) throw new Error('导图文件路径无效')
        await this.writeMindmap(
          workspaceRoot,
          fileName,
          { id: entry.id, source: entry.source, title: entry.title, updatedAt: entry.updatedAt },
          markdown
        )
        entry.fileSync = { relativePath: `${MINDMAPS_DIR}/${fileName}` }

        const map: ConversationMindmap = {
          id: entry.id, title: entry.title, markdown: entry.markdown, platform: '工作台',
          sourceRevision: 0, createdAt: entry.updatedAt, updatedAt: entry.updatedAt,
          source: entry.source, fileSync: entry.fileSync
        }
        if (generationSession) map.generationSession = generationSession
        return map
      }
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
      if (conversation.workbench) {
        // 工作台导图：删除对应文件。
        await this.deleteWorkbenchMindmapUnlocked(conversation.workbench.workspaceRoot, mapId, conversation.workbench.relativePath)
        return
      }
      if (!conversation.mindmaps.some(map => map.id === mapId)) throw new Error('导图不存在')
      conversation.mindmaps = conversation.mindmaps.filter(map => map.id !== mapId)
      await this.saveOrRemove(conversation)
    })
  }

  /**
   * 删除导图（IPC 用）：普通对话导图走记录；工作台导图删文件。
   * 返回 conflict 让前端弹确认（duplicate 等）。
   */
  deleteMindmapExtended(conversationId: string, mapId: string): Promise<{ conflict?: 'duplicate' | 'source-mismatch' }> {
    return this.serial(async () => {
      const conversation = await this.read(conversationId)
      if (conversation.workbench) {
        return this.deleteWorkbenchMindmapUnlocked(conversation.workbench.workspaceRoot, mapId, conversation.workbench.relativePath)
      }
      if (!conversation.mindmaps.some(map => map.id === mapId)) throw new Error('导图不存在')
      conversation.mindmaps = conversation.mindmaps.filter(map => map.id !== mapId)
      await this.saveOrRemove(conversation)
      return {}
    })
  }

  /**
   * 删除工作台导图：文件就是导图本身，删文件即删导图。
   * 同 id 有多份文件时无法判断删哪一份，返回 duplicate 让用户先清理。
   * 调用方需已持有 serial 队列。
   */
  private async deleteWorkbenchMindmapUnlocked(workspaceRoot: string, mapId: string, expectedSource?: string): Promise<{ conflict?: 'duplicate' | 'source-mismatch' }> {
    // 删除是不可逆操作，不能信任 500ms 扫描缓存：先重扫并读实际文件，
    // 缓存窗口内文件被外部替换成另一篇文档的导图时，按缓存路径删会删错文件。
    this.invalidateMindmapScan(workspaceRoot)
    const scan = await this.mindmapScan(workspaceRoot)
    const files = scan.files.filter(file => file.id === mapId)
    if (!files.length) throw new Error('导图不存在')
    if (files.length > 1) return { conflict: 'duplicate' }
    const file = await this.readFileAtPath(workspaceRoot, files[0].relativePath)
    if (!file || file.id !== mapId) throw new Error('导图文件已被替换，请刷新后再操作')
    // 导图可能已在外部被改绑：此时删除会删掉另一篇文档的导图，必须先让用户确认绑定。
    if (expectedSource !== undefined && file.source !== expectedSource) return { conflict: 'source-mismatch' }
    await this.removeMindmap(workspaceRoot, file.relativePath)
    return {}
  }

  /** 读指定相对路径的导图文件；读不到或不是导图文件时返回 null。 */
  private async readFileAtPath(workspaceRoot: string, relativePath: string): Promise<Awaited<ReturnType<typeof readMindmapFile>> | null> {
    try {
      return await readMindmapFile(workspaceRoot, relativePath)
    } catch {
      return null
    }
  }

  /** 两份正文的一致性比对：两侧统一换行、忽略尾部空行后再比。 */
  private mindmapBodyEquals(entry: Pick<WorkbenchMindmapIndexEntry, 'markdown'>, body: string): boolean {
    // 尾部空行不构成内容差异：导出/回读链路对末尾换行的处理不完全对称，
    // 只差一个换行时不该被判成「正文冲突」而卡住绑定修复。
    const strip = (text: string): string => normalizeMindmapNewlines(text).replace(/\n+$/, '')
    return strip(entry.markdown) === strip(body)
  }

  importLegacyMindmap(markdown: string): Promise<NoteConversation> {
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 200_000) return Promise.reject(new Error('旧导图内容无效'))
    return this.standalone(markdown)
  }

  // ---- 工作台导图文件操作（IPC 入口） ----

  /**
   * 面板加载时按文档一次性返回所有导图状态 + 无法识别文件列表。
   * 索引由文件派生，正常文件必然是 synced；这里只报重复、无法解析等异常。
   */
  workbenchMindmapFileStatus(workspaceRoot: string, relativePath: string): Promise<{ files: Record<string, { state: MindmapFileState; reason?: MindmapFileReason; relativePath?: string }>; unreadable: string[]; overflow: boolean }> {
    return this.serial(async () => {
      const { index, scan } = await this.workbenchIndex(workspaceRoot)
      const entries = index.mindmaps.filter(entry => entry.source === relativePath)
      // 溢出时扫描结果为空，必须单独告诉面板「目录太大」，否则看起来就像所有导图都被删了。
      if (scan.overflow) return { files: {}, unreadable: scan.unreadable, overflow: true }
      const filesById = new Map<string, typeof scan.files>()
      for (const file of scan.files) {
        const bucket = filesById.get(file.id)
        if (bucket) bucket.push(file)
        else filesById.set(file.id, [file])
      }
      const out: Record<string, { state: MindmapFileState; reason?: MindmapFileReason; relativePath?: string }> = {}
      for (const entry of entries) {
        const files = filesById.get(entry.id) || []
        if (files.length > 1) {
          out[entry.id] = { state: 'invalid', reason: 'duplicate' }
          continue
        }
        const file = files[0]
        try {
          validateImportedBody(file.body)
        } catch {
          out[entry.id] = { state: 'invalid', reason: 'content', relativePath: file.relativePath }
          continue
        }
        out[entry.id] = { state: 'synced', relativePath: file.relativePath }
      }
      return { files: out, unreadable: scan.unreadable, overflow: false }
    })
  }

}
