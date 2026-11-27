/** 标注：旁路数据，不写入 Markdown 正文或 frontmatter。 */
export type AnnotationScope = 'document' | 'source'

export type CaptureContext = 'workbench' | 'global'

export type AnnotationAnchorState = 'anchored' | 'shifted' | 'ambiguous' | 'unlocated'

export type AnnotationAnchorReason = 'not-found' | 'cross-block' | 'unsupported' | 'overlap'

export interface AnnotationAnchor {
  exact: string
  prefix: string
  suffix: string
  /** 同一段引文多次出现时的序号消歧。 */
  occurrence?: number
  /** 近似位置，只用于同分候选。 */
  offsetHint?: number
}

export interface AnnotationSource {
  key: string
  url: string
  platform: string
  title?: string
}

export interface Annotation {
  id: string
  scope: AnnotationScope
  quote: string
  anchor: AnnotationAnchor
  comment: string
  source?: AnnotationSource
  createdAt: number
  updatedAt: number
  /** 创建时的原始引文，只用于展示，不参与自动重定位。 */
  originalQuote?: string
  /** 仅 document 标注持久化；source 投影状态留在渲染层。 */
  anchorState?: AnnotationAnchorState
  anchorReason?: AnnotationAnchorReason
  /** 每次持久化解析状态或锚点变化时递增。 */
  anchorRevision?: number
  /** 首次进入未定位的时间；恢复定位时清除。 */
  orphanedAt?: number
  /** 最后一次新建、恢复或真正改写锚点的时间。 */
  lastAnchoredAt?: number
}

export interface DocumentResolution {
  id: string
  state: AnnotationAnchorState
  reason?: AnnotationAnchorReason
  quote?: string
  anchor?: AnnotationAnchor
  baseAnchorRevision: number
}

export interface DocumentReconcileResult {
  applied: string[]
  stale: string[]
  skipped: string[]
  annotations: Annotation[]
}

export interface SourceAnnotationFile {
  version: 1
  source: AnnotationSource | null
  annotations: Annotation[]
}

export interface DocumentAnnotationFile {
  version: 1
  document: {
    relativePath: string
    contentHash?: string
    size?: number
    mtime?: number
    updatedAt: number
  }
  annotations: Annotation[]
}

export interface ResolvedAnnotationAnchor {
  id: string
  start: number
  end: number
  /** 是否只靠 exact 命中，缺少上下文或 occurrence 的“可能位置”。 */
  ambiguous?: boolean
}

export interface DocumentAnnotationRef {
  workspaceRoot: string
  relativePath: string
}

export interface CapturedDocumentRef {
  workspaceRoot: string
  relativePath: string
}

export type DocumentCaptureError =
  | 'NO_ACTIVE_WORKSPACE'
  | 'WORKSPACE_UNAVAILABLE'
  | 'SCAN_INCOMPLETE'
  | 'OVERSIZE'
  | 'WRITE_FAILED'
  | 'SOURCE_NOT_FOUND'
  | 'MULTIPLE_DOCUMENTS'

export interface CaptureSourceInput {
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

export interface CaptureSourceResult {
  annotation: Annotation
  document?: CapturedDocumentRef
  documentError?: DocumentCaptureError
  documentCandidates?: CapturedDocumentRef[]
}

export interface EnsureDocumentInput {
  sourceKey: string
  captureContext: CaptureContext
  workspaceRoot?: string
}

export interface EnsureDocumentResult {
  document?: CapturedDocumentRef
  documentError?: DocumentCaptureError
}

export interface CaptureExcerptInput {
  captureContext: CaptureContext
  workspaceRoot?: string
  platform: string
  title: string
  url: string
  quote: string
  comment?: string
}

export interface CaptureExcerptResult {
  document?: CapturedDocumentRef
  documentError?: DocumentCaptureError
}

export interface AnnotationChangedEvent {
  scope: AnnotationScope
  workspaceRoot?: string
  relativePath?: string
  sourceKey?: string
}

/** 主进程从 Webview 读取选区后发给渲染层的采集请求；评论由渲染层补齐。 */
export interface AnnotationCaptureRequest {
  mode: 'annotate' | 'excerpt'
  annotationId?: string
  webContentsId: number
  platform: string
  title: string
  url: string
  snapshot: string
  quote: string
  anchor: AnnotationAnchor
  rect?: { left: number; top: number; right: number; bottom: number }
}

export interface ConversationDirSetting {
  conversationDir: string
  warning?: string
}

export interface WorkbenchWorkspaceSession {
  activeWorkspaceRoot: string
  generation: number
  legacyDefaultPath?: string
}

export interface DefaultWorkspaceInfo {
  path: string
  writable: boolean
  legacyPath?: string
}

export interface ConversationSourceSummary {
  relativePath: string
  title: string
  platform: string
  sourceKey: string
  updatedAt: number
}

export interface ConversationScanResult {
  complete: boolean
  documents: ConversationSourceSummary[]
}

export type MigrationBlockedReason =
  | 'oversize'
  | 'empty-snapshot'
  | 'unlocatable-source'
  | 'annotation-overflow'
  | 'mindmap-conflict'
  | 'verify-failed'

export type LegacyMigrationStatus = 'running' | 'paused' | 'completed' | 'abandoned'

export interface LegacyMigrationJob {
  jobId: string
  targetWorkspaceRoot: string
  targetRootKey: string
  targetConversationDir: string
  startedAt: number
  status: LegacyMigrationStatus
  total: number
  completed: number
}

export interface LegacyMigrationProgress {
  jobId: string
  targetWorkspaceRoot: string
  targetConversationDir: string
  total: number
  completed: number
  currentTitle?: string
  blocked: number
  failed: number
}

export interface LegacyMigrationReportEntry {
  id: string
  title: string
  status: 'migrated' | 'blocked' | 'failed'
  reason?: MigrationBlockedReason
  targetWorkspaceRoot?: string
  relativePath?: string
  message?: string
}

export interface LegacyMigrationResult {
  jobId: string
  targetWorkspaceRoot: string
  targetConversationDir: string
  total: number
  migrated: number
  blocked: number
  failed: number
  cancelled: boolean
  report: LegacyMigrationReportEntry[]
  /** 旧迁移文档的 frontmatter 收敛结果；正文不改。 */
  frontmatterRepair?: {
    scanned: number
    rewritten: number
    unchanged: number
    failed: number
  }
}

export interface LegacyMigrationPendingSummary {
  pendingConversations: number
  /** 已阻塞、需要用户处理或重试的记录数；只展示，不自动重跑。 */
  blockedConversations: number
  /** 阻塞记录明细：用户确认后可清除阻塞并重新迁移。 */
  blockedRecords: Array<{
    id: string
    title: string
    reason: MigrationBlockedReason
  }>
  pendingAnnotations: number
  pendingMindmaps: number
  defaultWorkspacePath: string
  job?: LegacyMigrationJob
}
