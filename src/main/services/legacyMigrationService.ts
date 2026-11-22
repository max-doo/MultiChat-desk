/**
 * 旧 NoteConversation 迁移：可见、可暂停、可重试，永不删除旧 JSON。
 * 迁移读取走 NoteManager.rawLegacyRecords()，绕开 list() 的合并/去重/rm。
 */

import type Store from 'electron-store'
import { randomUUID } from 'crypto'
import { constants } from 'fs'
import { access, readFile, stat } from 'fs/promises'
import os from 'os'
import path from 'path'
import type {
  Annotation,
  LegacyMigrationJob,
  LegacyMigrationProgress,
  LegacyMigrationReportEntry,
  LegacyMigrationResult,
  LegacyMigrationPendingSummary
} from '../../shared/types/annotations'
import type { ConversationMindmap, NoteConversation } from '../../shared/types/notes'
import { noteConversationKey } from '../../shared/utils/noteIdentity'
import { resolveAnchors } from '../../shared/utils/annotationAnchors'
import { ensureDefaultWorkspace, getWorkspaceSettings } from './workbenchService'
import {
  listDocumentAnnotations,
  listSourceAnnotations,
  upsertDocumentAnnotation,
  upsertSourceAnnotation
} from './annotationService'
import { createDocumentForSource, findUntrackedDocumentByTitle } from './conversationDocumentService'
import { repairMigratedConversationFrontmatter } from './conversationFrontmatterRepair'
import { allocateMindmapFileName, writeMindmapFile, scanMindmapFiles } from './mindmapFileService'
import type { NoteManager } from '../noteManager'

const JOB_KEY = 'legacyMigrationJob'
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

const rootKey = (root: string): string => {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
/** 系统临时目录下的工作区属于一次性会话，不能按“用户主动删除工作区”处理。 */
const isEphemeralWorkspace = (root: string): boolean => {
  const relative = path.relative(os.tmpdir(), path.resolve(root))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
const deterministicId = (conversationId: string, noteId: string | undefined, index: number): string => {
  if (noteId && UUID_RE.test(noteId)) return noteId
  const base = `${conversationId}:${noteId || index}`
  let hash = 0
  for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) | 0
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(1, 4)}-${hex}${hex}`.slice(0, 36)
}

export class LegacyMigrationService {
  private snapshot: NoteConversation[] | null = null
  private frontmatterRepairDone = false

  constructor(
    private readonly store: Store<Record<string, unknown>>,
    private readonly notes: NoteManager,
    private readonly progress: (value: LegacyMigrationProgress) => void
  ) {}

  private job(): LegacyMigrationJob | null {
    const value = this.store.get(JOB_KEY)
    return value && typeof value === 'object' ? value as LegacyMigrationJob : null
  }

  private saveJob(job: LegacyMigrationJob): void {
    this.store.set(JOB_KEY, job)
  }

  isActive(): boolean {
    const job = this.job()
    return job?.status === 'running' || job?.status === 'paused'
  }

  /** 迁移期旧读接口走只读快照；快照不可用时由调用方明确报错。 */
  async readOnlySnapshot(): Promise<NoteConversation[] | null> {
    if (!this.isActive()) return null
    if (this.snapshot) return this.snapshot.map(item => structuredClone(item))
    try {
      this.snapshot = (await this.notes.rawLegacyRecords()).map(item => item.conversation)
      return this.snapshot.map(item => structuredClone(item))
    } catch {
      return null
    }
  }

  /** 只收敛旧迁移文档的 frontmatter；正文、旁路标注和旧 JSON 都不动。 */
  private async repairCompletedDocuments(
    records: Array<{ conversation: NoteConversation }>,
    fallbackRoot: string
  ): Promise<void> {
    if (this.frontmatterRepairDone) return
    this.frontmatterRepairDone = true
    try {
      const result = await repairMigratedConversationFrontmatter(
        records.map(item => item.conversation),
        fallbackRoot,
        (await getWorkspaceSettings(fallbackRoot)).conversationDir
      )
      if (result.failed) {
        console.warn('[Migration] frontmatter 收敛部分失败:', result.errors)
      }
    } catch (error) {
      console.warn('[Migration] 会话文档 frontmatter 收敛失败:', error)
    }
  }

  async pendingSummary(): Promise<LegacyMigrationPendingSummary> {
    const records = await this.notes.rawLegacyRecords()
    const pending = records.map(item => item.conversation).filter(item => !item.migratedAt)
    const defaultWorkspace = await ensureDefaultWorkspace(this.store)
    // 迁移入口打开时顺手收敛旧版迁移文档的头部。已经完成迁移的用户不会
    // 再跑一次迁移，否则 id/source_url/updated_at 会一直留在默认库里。
    // 该操作幂等，只改 frontmatter，失败不影响迁移统计。
    if (!this.isActive()) void this.repairCompletedDocuments(records, defaultWorkspace.path)
    return {
      pendingConversations: pending.filter(item => !item.migrationBlocked).length,
      blockedConversations: pending.filter(item => item.migrationBlocked).length,
      blockedRecords: pending
        .filter(item => item.migrationBlocked)
        .map(item => ({
          id: item.id,
          title: item.title,
          reason: item.migrationBlocked!,
          targetWorkspaceRoot: item.workbench?.workspaceRoot,
          relativePath: item.workbench?.relativePath
        })),
      pendingAnnotations: pending.reduce((sum, item) => sum + item.notes.length, 0),
      pendingMindmaps: pending.reduce((sum, item) => sum + item.mindmaps.length, 0),
      defaultWorkspacePath: defaultWorkspace.path,
      job: this.job() ?? undefined
    }
  }

  /** 阻塞记录的人工重试入口：清除标记后由下一次 migrate 重新处理。 */
  async retryBlocked(id: string): Promise<void> {
    if (this.job()?.status === 'running') throw new Error('迁移进行中，请先暂停')
    const record = (await this.notes.rawLegacyRecords()).find(item => item.conversation.id === id)?.conversation
    if (!record?.migrationBlocked) throw new Error('该旧笔记没有阻塞标记')
    await this.notes.clearMigrationBlock(id)
    this.snapshot = null
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.job()
    if (!job || job.jobId !== jobId) throw new Error('迁移任务不匹配')
    if (job.status !== 'running') return
    job.status = 'paused'
    this.saveJob(job)
    this.emit(job, 0, 0, 0)
  }

  /** 恢复暂停的任务：只把状态改回 running，真正执行仍由 migrate(jobId) 推进。 */
  async resume(jobId: string): Promise<{ jobId: string; targetWorkspaceRoot: string; targetConversationDir: string }> {
    const job = this.job()
    if (!job || job.jobId !== jobId) throw new Error('迁移任务不匹配')
    if (job.status === 'abandoned' || job.status === 'completed') throw new Error('迁移任务已结束')
    job.status = 'running'
    this.saveJob(job)
    this.snapshot = null
    return {
      jobId: job.jobId,
      targetWorkspaceRoot: job.targetWorkspaceRoot,
      targetConversationDir: job.targetConversationDir
    }
  }

  async abandon(jobId: string): Promise<void> {
    const job = this.job()
    if (!job || job.jobId !== jobId) throw new Error('迁移任务不匹配')
    job.status = 'abandoned'
    this.saveJob(job)
    this.snapshot = null
    this.emit(job, job.completed, 0, 0)
  }

  private emit(job: LegacyMigrationJob, completed: number, blocked: number, failed: number, currentTitle?: string): void {
    this.progress({
      jobId: job.jobId,
      targetWorkspaceRoot: job.targetWorkspaceRoot,
      targetConversationDir: job.targetConversationDir,
      total: job.total,
      completed,
      currentTitle,
      blocked,
      failed
    })
  }

  /**
   * 历史上“工作台记录 + 无批注/无导图”会被无条件标记完成，但目标文档可能早已随
   * 临时工作区一起删除。只有系统临时目录下的工作区、且文档已不存在时才重开；
   * 普通工作区里用户主动删除文档视为已处理，避免每次迁移都反复打扰。
   */
  private async reopenStaleWorkbenchRecords(
    records: Array<{ conversation: NoteConversation }>
  ): Promise<void> {
    for (const { conversation } of records) {
      const workbench = conversation.workbench
      if (!conversation.migratedAt || !workbench) continue
      const hasContent =
        conversation.notes.length > 0 ||
        conversation.mindmaps.length > 0 ||
        conversation.snapshot.trim().length > 0
      if (!hasContent) continue
      // 旧版在写入标记时不校验目标文档；新版正常迁移也会先校验。这里只处理
      // “标记存在但目标已随临时工作区消失”的历史数据；正常文档被用户删除时不复活。
      const documentAvailable = await stat(path.join(workbench.workspaceRoot, workbench.relativePath)).then(
        info => info.isFile(),
        () => false
      )
      if (documentAvailable) continue
      // 父目录不存在通常意味着整个卷没挂载（移动盘/网络盘离线），
      // 不能把这种临时不可达当成“用户删了工作区”而反复重开已完成记录。
      const parentAvailable = await stat(path.dirname(workbench.workspaceRoot)).then(
        info => info.isDirectory(),
        () => false
      )
      if (!parentAvailable) continue
      // 只有系统临时目录下的一次性工作区才自动重开：这类目录被清理时，
      // 旧快照往往是唯一副本。用户主动删除普通工作区或文档时不复活。
      if (!isEphemeralWorkspace(workbench.workspaceRoot)) continue
      await this.notes.clearMigrationBlock(conversation.id)
      delete conversation.migratedAt
      delete conversation.migratedTo
    }
  }

  async migrate(jobId?: string): Promise<LegacyMigrationResult> {
    const defaultWorkspace = await ensureDefaultWorkspace(this.store)
    const settings = await getWorkspaceSettings(defaultWorkspace.path)
    const currentJob = this.job()
    if (jobId && currentJob && currentJob.jobId !== jobId) throw new Error('迁移任务不匹配')
    if (currentJob && (currentJob.status === 'running' || currentJob.status === 'paused')) {
      if (rootKey(currentJob.targetWorkspaceRoot) !== rootKey(defaultWorkspace.path)) {
        currentJob.status = 'paused'
        this.saveJob(currentJob)
        throw new Error('默认库路径不一致，迁移已暂停')
      }
    }
    const records = await this.notes.rawLegacyRecords()
    // 早期版本对没有批注/导图的工作台记录直接写了 migratedAt，没有校验目标文档。
    // 如果整个工作区已不存在（典型是临时目录被清理），旧快照就是唯一副本；
    // 重新纳入迁移，让下面的分支把它标成阻塞，而不是继续显示“已完成”。
    await this.reopenStaleWorkbenchRecords(records)
    const total = records.length
    // 早期迁移只写了标记，没有留下备份；开跑前为这些记录补齐迁移前快照。
    for (const { conversation } of records) {
      if (conversation.migratedAt || conversation.migrationBlocked) {
        await this.notes.ensureMigrationBackup(conversation.id).catch(error => {
          console.warn('[Migration] 备份旧笔记失败:', conversation.id, error)
        })
      }
    }
    const job: LegacyMigrationJob = currentJob && currentJob.status !== 'abandoned' && currentJob.status !== 'completed'
      ? currentJob
      : {
        jobId: randomUUID(),
        targetWorkspaceRoot: defaultWorkspace.path,
        targetRootKey: rootKey(defaultWorkspace.path),
        targetConversationDir: settings.conversationDir,
        startedAt: Date.now(),
        status: 'running',
        total,
        completed: 0
      }
    // 紧贴落盘前再读一次：读取与写入之间没有 await，暂停只能发生在
    // 这次读取之前，因此不会再用旧对象覆盖 paused/abandoned。
    const startState = this.job()
    if (startState && startState.jobId === job.jobId) {
      if (startState.status === 'paused' || startState.status === 'abandoned') {
        this.snapshot = null
        // 暂停发生在启动读取阶段：沿用当前待处理统计，避免返回“阻塞 0”。
        const pending = records.map(item => item.conversation).filter(item => !item.migratedAt)
        return {
          jobId: startState.jobId,
          targetWorkspaceRoot: startState.targetWorkspaceRoot,
          targetConversationDir: startState.targetConversationDir,
          total: startState.total,
          migrated: startState.completed,
          blocked: pending.filter(item => item.migrationBlocked).length,
          failed: 0,
          cancelled: true,
          report: []
        }
      }
      startState.status = 'running'
      startState.total = total
      this.saveJob(startState)
      // 后续循环用最新的 jobId 判断；继续任务时 job 与 startState 是同一 jobId。
      job.total = total
    } else {
      job.status = 'running'
      job.total = total
      this.saveJob(job)
    }
    this.snapshot = records.map(item => item.conversation)
    const report: LegacyMigrationReportEntry[] = []
    let completed = 0
    let blocked = 0
    let failed = 0
    let cancelled = false

    for (const { conversation } of records) {
      const latest = this.job()
      if (!latest || latest.jobId !== job.jobId || latest.status !== 'running') {
        cancelled = true
        // 取消/放弃由另一个 IPC 改写状态；只补进度，不能把本地 running 写回去。
        if (latest && latest.jobId === job.jobId) {
          latest.completed = completed
          this.saveJob(latest)
        }
        break
      }
      if (conversation.migratedAt) {
        completed += 1
      } else if (conversation.migrationBlocked) {
        blocked += 1
        report.push({ id: conversation.id, title: conversation.title, status: 'blocked', reason: conversation.migrationBlocked })
      } else {
        try {
          const outcome = await this.migrateOne(conversation, job)
          report.push(outcome)
          if (outcome.status === 'migrated') completed += 1
          else if (outcome.status === 'blocked') blocked += 1
          else failed += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // 默认库在迁移途中不可用时继续跑只会把剩余记录逐个记成失败；
          // 暂停任务保留进度，恢复可写后仍从同一 jobId 继续。
          if (/CONVERSATION_LIBRARY_UNAVAILABLE|ENOENT|EACCES|EPERM|ENOTDIR|EBUSY/.test(message)) {
            const pausedJob = this.job()
            if (pausedJob && pausedJob.jobId === job.jobId) {
              // 用户已经放弃时保持 abandoned，只补进度。
              if (pausedJob.status === 'running') pausedJob.status = 'paused'
              pausedJob.completed = completed
              this.saveJob(pausedJob)
              this.emit(pausedJob, completed, blocked, failed, conversation.title)
            }
            this.snapshot = null
            return {
              jobId: job.jobId,
              targetWorkspaceRoot: job.targetWorkspaceRoot,
              targetConversationDir: job.targetConversationDir,
              total,
              migrated: completed,
              blocked,
              failed,
              cancelled: true,
              report
            }
          }
          failed += 1
          report.push({
            id: conversation.id,
            title: conversation.title,
            status: 'failed',
            message
          })
        }
      }
      // migrateOne 期间用户可能点了暂停/放弃。必须重新读取磁盘状态再落进度，
      // 否则本地 running 对象会把 paused/abandoned 覆盖回去，任务继续往下跑。
      const afterRecord = this.job()
      if (!afterRecord || afterRecord.jobId !== job.jobId) {
        cancelled = true
        break
      }
      afterRecord.completed = completed
      this.saveJob(afterRecord)
      this.emit(afterRecord, completed, blocked, failed, conversation.title)
      if (afterRecord.status !== 'running') {
        cancelled = true
        break
      }
    }

    if (!cancelled) {
      const latest = this.job()
      if (latest && latest.jobId === job.jobId) {
        latest.completed = completed
        latest.status = 'completed'
        this.saveJob(latest)
        job.status = 'completed'
      }
    }
    // 终态进度事件：界面据此收起“迁移中”，并显示阻塞/失败统计。
    const finalJob = this.job()
    this.emit(
      finalJob && finalJob.jobId === job.jobId ? finalJob : job,
      completed,
      blocked,
      failed
    )
    this.snapshot = null
    // 迁移任务完成后再收敛历史文档头部：旧版本写出的 id/source_url/updated_at
    // 不应继续留在默认库里。只改 frontmatter，正文与旁路标注不动。
    const frontmatterRepair = cancelled
      ? undefined
      : await repairMigratedConversationFrontmatter(
        records.map(item => item.conversation),
        job.targetWorkspaceRoot,
        job.targetConversationDir
      )
        .catch(error => {
          console.warn('[Migration] 会话文档 frontmatter 收敛失败:', error)
          return undefined
        })
    return {
      jobId: job.jobId,
      targetWorkspaceRoot: job.targetWorkspaceRoot,
      targetConversationDir: job.targetConversationDir,
      total,
      migrated: completed,
      blocked,
      failed,
      cancelled,
      report,
      ...(frontmatterRepair
        ? {
          frontmatterRepair: {
            scanned: frontmatterRepair.scanned,
            rewritten: frontmatterRepair.rewritten,
            unchanged: frontmatterRepair.unchanged,
            failed: frontmatterRepair.failed
          }
        }
        : {})
    }
  }

  private async migrateOne(
    conversation: NoteConversation,
    job: LegacyMigrationJob
  ): Promise<LegacyMigrationReportEntry> {
    if (conversation.workbench) {
      return this.migrateWorkbenchRecord(conversation)
    }
    let sourceKey = ''
    try {
      if (conversation.url) sourceKey = noteConversationKey(conversation.url, conversation.title)
    } catch {
      sourceKey = conversation.sourceKey || ''
    }
    if (!sourceKey) sourceKey = conversation.sourceKey || ''
    // 没有来源身份时仍可创建普通文档；能定位的旧标注写成文档标注，定位不到的阻塞。
    const unlocatable = !sourceKey && conversation.notes.length > 0
    if (sourceKey) {
      const annotations = this.toSourceAnnotations(conversation, sourceKey)
      // 与 atomicWrite 一致：按包含 wrapper 的 pretty JSON 计算最终文件大小，
      // 否则接近 2MB 时会先写入一部分再失败，留下半套标注。
      const bytes = Buffer.byteLength(JSON.stringify({
        version: 1,
        source: {
          key: sourceKey,
          url: conversation.url,
          platform: conversation.platform,
          title: conversation.title
        },
        annotations
      }, null, 2), 'utf8')
      if (annotations.length > 500 || bytes > MAX_SOURCE_BYTES) {
        await this.notes.markMigrated(conversation.id, { migrationBlocked: 'annotation-overflow' })
        return {
          id: conversation.id,
          title: conversation.title,
          status: 'blocked',
          reason: 'annotation-overflow',
          message: `${annotations.length} 条标注，${bytes} 字节`
        }
      }
      if (annotations.length) {
        for (const annotation of annotations) {
          await upsertSourceAnnotation(job.targetWorkspaceRoot, sourceKey, {
            key: sourceKey,
            url: conversation.url,
            platform: conversation.platform,
            title: conversation.title
          }, annotation)
        }
      }
    }
    if (!conversation.snapshot.trim()) {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'empty-snapshot' })
      return { id: conversation.id, title: conversation.title, status: 'blocked', reason: 'empty-snapshot' }
    }
    // 没有来源身份时按标题认领已迁移文档，重试不会不断新建副本。
    const untracked = sourceKey
      ? null
      : await findUntrackedDocumentByTitle(job.targetWorkspaceRoot, conversation.title)
    const document = untracked
      ? { document: untracked }
      : await createDocumentForSource(this.store, {
        captureContext: 'global',
        platform: conversation.platform,
        title: conversation.title,
        url: conversation.url,
        sourceKey: sourceKey || '',
        snapshot: conversation.snapshot,
        // 迁移固定使用任务开始时的归档目录，外部改动设置也不会把同一批文档拆到两处。
        conversationDir: job.targetConversationDir
      })
    if (document.error === 'OVERSIZE') {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'oversize' })
      return { id: conversation.id, title: conversation.title, status: 'blocked', reason: 'oversize' }
    }
    if (!document.document) {
      // 默认库在迁移途中被删除/断盘时，后续记录都会失败；按任务级阻塞暂停，
      // 恢复可写后从同一 jobId 继续，而不是把每条都记成单条失败。
      if (document.error === 'WRITE_FAILED') {
        const available = await stat(job.targetWorkspaceRoot).then(
          info => info.isDirectory(),
          () => false
        )
        const writable = available
          ? await access(job.targetWorkspaceRoot, constants.W_OK).then(() => true, () => false)
          : false
        if (!available || !writable) throw new Error('CONVERSATION_LIBRARY_UNAVAILABLE')
      }
      return { id: conversation.id, title: conversation.title, status: 'failed', message: document.error }
    }
    if (unlocatable) {
      // 无 sourceKey 时不能写 sources/，只能把能在正文里定位的标注写成 document 标注。
      let located = 0
      try {
        const content = await readFile(path.join(document.document.workspaceRoot, document.document.relativePath), 'utf8')
        for (const note of conversation.notes) {
          const hit = resolveAnchors(content, [{ id: note.id, anchor: note.anchor }])[0]
          if (!hit) continue
          await upsertDocumentAnnotation(
            { workspaceRoot: document.document.workspaceRoot, relativePath: document.document.relativePath },
            {
              id: deterministicId(conversation.id, note.id, located),
              scope: 'document',
              quote: note.quote,
              anchor: note.anchor,
              comment: note.comment,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt
            }
          )
          located += 1
        }
      } catch {
        // 文档刚写入后读取失败按失败处理，保留旧 JSON
      }
      if (located < conversation.notes.length) {
        await this.notes.markMigrated(conversation.id, { migrationBlocked: 'unlocatable-source' })
        return {
          id: conversation.id,
          title: conversation.title,
          status: 'blocked',
          reason: 'unlocatable-source',
          relativePath: document.document.relativePath,
          targetWorkspaceRoot: document.document.workspaceRoot
        }
      }
    }
    const mindmapFailure = await this.migrateMindmaps(
      job.targetWorkspaceRoot,
      document.document.relativePath,
      conversation.mindmaps
    )
    if (mindmapFailure) {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'mindmap-conflict' })
      return { id: conversation.id, title: conversation.title, status: 'blocked', reason: 'mindmap-conflict' }
    }
    // 写入调用成功不等于目标真的落盘：标记完成前回读三项，避免“已迁移但文件不存在”。
    const verified = await this.verifyMigratedTargets(
      { workspaceRoot: job.targetWorkspaceRoot, relativePath: document.document.relativePath },
      conversation,
      {
      sourceIds: sourceKey ? this.toSourceAnnotations(conversation, sourceKey).map(item => item.id) : undefined,
      documentIds: unlocatable
        ? conversation.notes.map((note, index) => deterministicId(conversation.id, note.id, index))
        : undefined,
      mindmapIds: conversation.mindmaps.map(item => item.id)
      }
    )
    if (!verified) {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'verify-failed' })
      return {
        id: conversation.id,
        title: conversation.title,
        status: 'blocked',
        reason: 'verify-failed',
        targetWorkspaceRoot: document.document.workspaceRoot,
        relativePath: document.document.relativePath,
        message: '迁移目标回读校验失败'
      }
    }
    await this.notes.markMigrated(conversation.id, {
      migratedAt: Date.now(),
      migratedTo: document.document.workspaceRoot
    })
    return {
      id: conversation.id,
      title: conversation.title,
      status: 'migrated',
      targetWorkspaceRoot: document.document.workspaceRoot,
      relativePath: document.document.relativePath
    }
  }

  private async migrateWorkbenchRecord(conversation: NoteConversation): Promise<LegacyMigrationReportEntry> {
    const workbench = conversation.workbench
    if (!workbench) return { id: conversation.id, title: conversation.title, status: 'failed' }
    if (!conversation.notes.length) {
      // 纯导图/无旁路来源：不创建文档、不写默认库，导图按文件化方案留在原工作区。
      // 但目标文档是否还在决定这条记录能否算“完成”：文档已消失且仍有快照时，
      // 快照是用户内容的唯一副本，不能静默丢掉。
      const info = await stat(path.join(workbench.workspaceRoot, workbench.relativePath)).catch(() => null)
      if (!conversation.mindmaps.length) {
        if (!info?.isFile() && conversation.snapshot.trim()) {
          await this.notes.markMigrated(conversation.id, { migrationBlocked: 'workbench-unresolved' })
          return {
            id: conversation.id,
            title: conversation.title,
            status: 'blocked',
            reason: 'workbench-unresolved',
            targetWorkspaceRoot: workbench.workspaceRoot,
            relativePath: workbench.relativePath,
            message: '目标文档不存在，旧记录仍有正文快照'
          }
        }
        await this.notes.markMigrated(conversation.id, {
          migratedAt: Date.now(),
          migratedTo: workbench.workspaceRoot
        })
        return {
          id: conversation.id,
          title: conversation.title,
          status: 'migrated',
          targetWorkspaceRoot: workbench.workspaceRoot,
          relativePath: workbench.relativePath
        }
      }
      if (!info?.isFile()) {
        await this.notes.markMigrated(conversation.id, { migrationBlocked: 'workbench-unresolved' })
        return {
          id: conversation.id,
          title: conversation.title,
          status: 'blocked',
          reason: 'workbench-unresolved',
          targetWorkspaceRoot: workbench.workspaceRoot,
          relativePath: workbench.relativePath
        }
      }
      const conflict = await this.migrateMindmaps(
        workbench.workspaceRoot,
        workbench.relativePath,
        conversation.mindmaps
      )
      if (conflict) {
        await this.notes.markMigrated(conversation.id, { migrationBlocked: 'mindmap-conflict' })
        return { id: conversation.id, title: conversation.title, status: 'blocked', reason: 'mindmap-conflict' }
      }
      if (!(await this.verifyMigratedTargets(
        { workspaceRoot: workbench.workspaceRoot, relativePath: workbench.relativePath },
        conversation,
        { mindmapIds: conversation.mindmaps.map(item => item.id) }
      ))) {
        await this.notes.markMigrated(conversation.id, { migrationBlocked: 'workbench-unresolved' })
        return {
          id: conversation.id,
          title: conversation.title,
          status: 'blocked',
          reason: 'workbench-unresolved',
          targetWorkspaceRoot: workbench.workspaceRoot,
          relativePath: workbench.relativePath,
          message: '导图回读校验失败'
        }
      }
      await this.notes.markMigrated(conversation.id, {
        migratedAt: Date.now(),
        migratedTo: workbench.workspaceRoot
      })
      return {
        id: conversation.id,
        title: conversation.title,
        status: 'migrated',
        targetWorkspaceRoot: workbench.workspaceRoot,
        relativePath: workbench.relativePath
      }
    }
    const documentPath = path.join(workbench.workspaceRoot, workbench.relativePath)
    const info = await stat(documentPath).catch(() => null)
    if (!info?.isFile()) {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'workbench-unresolved' })
      return { id: conversation.id, title: conversation.title, status: 'blocked', reason: 'workbench-unresolved' }
    }
    const content = await readFile(documentPath, 'utf8')
    let unlocated = 0
    for (const note of conversation.notes) {
      const resolved = resolveAnchors(content, [{ id: note.id, anchor: note.anchor }])[0]
      if (!resolved) {
        unlocated += 1
        continue
      }
      const annotation: Annotation = {
        id: note.id,
        scope: 'document',
        quote: note.quote,
        anchor: note.anchor,
        comment: note.comment,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      }
      await upsertDocumentAnnotation(
        { workspaceRoot: workbench.workspaceRoot, relativePath: workbench.relativePath },
        annotation
      )
    }
    // 有批注在正文里定位不到时不能宣称迁移完成：旧页一旦只读，这条评论就没有其它入口。
    if (unlocated > 0) {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'unlocatable-source' })
      return {
        id: conversation.id,
        title: conversation.title,
        status: 'blocked',
        reason: 'unlocatable-source',
        targetWorkspaceRoot: workbench.workspaceRoot,
        relativePath: workbench.relativePath,
        message: `${unlocated}/${conversation.notes.length} 条批注在文档中未找到`
      }
    }
    const mindmapConflict = await this.migrateMindmaps(
      workbench.workspaceRoot,
      workbench.relativePath,
      conversation.mindmaps
    )
    if (mindmapConflict) {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'mindmap-conflict' })
      return {
        id: conversation.id,
        title: conversation.title,
        status: 'blocked',
        reason: 'mindmap-conflict',
        targetWorkspaceRoot: workbench.workspaceRoot,
        relativePath: workbench.relativePath
      }
    }
    // workbench 记录要验证文档、documents/ 旁路和导图三项都真的存在。
    if (!(await this.verifyMigratedTargets(
      { workspaceRoot: workbench.workspaceRoot, relativePath: workbench.relativePath },
      conversation,
      {
        documentIds: conversation.notes.map(note => note.id),
        mindmapIds: conversation.mindmaps.map(item => item.id)
      }
    ))) {
      await this.notes.markMigrated(conversation.id, { migrationBlocked: 'workbench-unresolved' })
      return {
        id: conversation.id,
        title: conversation.title,
        status: 'blocked',
        reason: 'workbench-unresolved',
        targetWorkspaceRoot: workbench.workspaceRoot,
        relativePath: workbench.relativePath,
        message: '文档旁路回读校验失败'
      }
    }
    await this.notes.markMigrated(conversation.id, {
      migratedAt: Date.now(),
      migratedTo: workbench.workspaceRoot
    })
    return {
      id: conversation.id,
      title: conversation.title,
      status: 'migrated',
      targetWorkspaceRoot: workbench.workspaceRoot,
      relativePath: workbench.relativePath
    }
  }

  private toSourceAnnotations(conversation: NoteConversation, sourceKey: string): Annotation[] {
    return conversation.notes.map((note, index) => ({
      id: deterministicId(conversation.id, note.id, index),
      scope: 'source',
      quote: note.quote,
      anchor: note.anchor,
      comment: note.comment,
      source: {
        key: sourceKey,
        url: conversation.url,
        platform: conversation.platform,
        title: conversation.title
      },
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }))
  }

  private async migrateMindmaps(
    root: string,
    source: string,
    mindmaps: ConversationMindmap[]
  ): Promise<boolean> {
    if (!mindmaps.length) return false
    const scan = await scanMindmapFiles(root)
    // 扫描溢出时无法确认同 id 文件是否已存在；继续写入可能制造第二份同 id 导图。
    if (scan.overflow) return true
    // 同一批里多个旧导图可能重名；先占位，避免 allocateMindmapFileName 只看到磁盘上的旧文件。
    const plannedNames = new Set<string>()
    // 同一条旧记录里重复出现同一个导图 id 时，以第一次写入为准；
    // 正文相同跳过，不同则视为冲突，不能追加第二份同 id 文件。
    const plannedIds = new Map<string, string>()
    for (const map of mindmaps) {
      const existing = scan.files.find(file => file.id === map.id)
      if (existing) {
        if (existing.body.trim() === map.markdown.trim()) continue
        return true
      }
      const plannedBody = plannedIds.get(map.id)
      if (plannedBody !== undefined) {
        if (plannedBody === map.markdown.trim()) continue
        return true
      }
      plannedIds.set(map.id, map.markdown.trim())
      // 文件名冲突时分配 ` (2)` 后缀，不能覆盖用户已有导图。
      let fileName = await allocateMindmapFileName(root, map.title || '导图', map.id)
      while (plannedNames.has(fileName)) {
        const ext = '.mindmap.md'
        fileName = fileName.endsWith(ext)
          ? `${fileName.slice(0, -ext.length)} (2)${ext}`
          : `${fileName} (2)`
      }
      plannedNames.add(fileName)
      await writeMindmapFile(root, fileName, {
        id: map.id,
        source,
        title: map.title,
        updatedAt: map.updatedAt
      }, map.markdown)
    }
    return false
  }

  /**
   * 完成标记前回读：文档必须存在；旧批注和导图必须能在目标旁路/文件里按 id 找到。
   * 只校验“预期写入了什么”，不要求 source 文件里没有其他会话的标注。
   */
  private async verifyMigratedTargets(
    ref: { workspaceRoot: string; relativePath: string },
    conversation: NoteConversation,
    expected: { sourceIds?: string[]; documentIds?: string[]; mindmapIds: string[] }
  ): Promise<boolean> {
    const info = await stat(path.join(ref.workspaceRoot, ref.relativePath)).catch(() => null)
    if (!info?.isFile()) return false

    if (expected.sourceIds?.length) {
      const sourceKey = conversation.url
        ? noteConversationKey(conversation.url, conversation.title)
        : conversation.sourceKey
      if (!sourceKey) return false
      const { annotations } = await listSourceAnnotations(ref.workspaceRoot, sourceKey)
      const ids = new Set(annotations.map(item => item.id))
      if (!expected.sourceIds.every(id => ids.has(id))) return false
    }
    if (expected.documentIds?.length) {
      const { annotations } = await listDocumentAnnotations(ref)
      const ids = new Set(annotations.map(item => item.id))
      if (!expected.documentIds.every(id => ids.has(id))) return false
    }

    if (expected.mindmapIds.length) {
      const scan = await scanMindmapFiles(ref.workspaceRoot)
      if (scan.overflow) return false
      const ids = new Set(scan.files.map(file => file.id))
      if (!expected.mindmapIds.every(id => ids.has(id))) return false
    }
    return true
  }
}
