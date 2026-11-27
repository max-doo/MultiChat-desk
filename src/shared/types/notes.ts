export interface NoteAnchor {
  exact: string
  prefix: string
  suffix: string
  occurrence?: number
  offsetHint?: number
}

export interface ConversationNote {
  id: string
  quote: string
  comment: string
  anchor: NoteAnchor
  createdAt: number
  updatedAt: number
}

export interface NoteConversation {
  version: 2
  id: string
  sourceKey: string
  platform: string
  title: string
  url: string
  updatedAt: number
  snapshot: string
  snapshotRevision: number
  mindmaps: ConversationMindmap[]
  notes: ConversationNote[]
  /** 迁移完成标记；与 migrationBlocked 互斥。 */
  migratedAt?: number
  /** 旧记录实际迁移到的根，仅用于旧页展示。 */
  migratedTo?: string
  /** 迁移被阻塞的首要原因；阻塞记录旧页只读。 */
  migrationBlocked?: 'oversize' | 'empty-snapshot' | 'unlocatable-source' | 'annotation-overflow' | 'mindmap-conflict' | 'verify-failed'
  /** 工作台文档来源；存在时该记录不属于对话笔记，只在工作台导图中使用。 */
  workbench?: WorkbenchNoteSource
}

export interface WorkbenchNoteSource {
  workspaceRoot: string
  relativePath: string
  /** 最近一次同步的文档正文哈希，用于判断导图是否基于旧版本。 */
  contentHash: string
  /** 最近一次同步时的文件字节数，用于改名判定（先按大小筛候选）。 */
  size?: number
  /** 最近一次同步时的 mtime，改名不改 mtime，可作第二判据。 */
  mtime?: number
}

export interface ConversationMindmap {
  id: string
  title: string
  markdown: string
  platform: string
  sourceRevision: number
  createdAt: number
  updatedAt: number
  generationSession?: MindmapGenerationSession
  /** 由工作台文档生成时记录生成范围，用于提示“基于旧版本”与重生成。 */
  workbenchScope?: WorkbenchMindmapScope
  /** 仅工作台导图：上次确认绑定的文档相对路径。 */
  source?: string
  /** 仅工作台导图：导出文件在工作区内的相对路径（位于 .multichat/mindmaps）。 */
  fileSync?: MindmapFileSync
}

export interface MindmapFileSync { relativePath: string }

/** 工作台导图索引项：由 `.multichat/mindmaps/*.mindmap.md` 扫描派生，不落盘。 */
export interface WorkbenchMindmapIndexEntry {
  id: string
  /** 绑定的文档相对路径（POSIX 分隔）。 */
  source: string
  title: string
  markdown: string
  fileSync?: MindmapFileSync
  updatedAt: number
}

/** 导图文件异常：多份同 id 文件或无法解析；正常文件恒为 synced。 */
export type MindmapFileState = 'invalid' | 'synced'
export type MindmapFileReason = 'duplicate' | 'content' | 'overflow'

export interface WorkbenchMindmapScope {
  scope: 'document' | 'selection'
  contentHash: string
  selectionText?: string
  headingPath?: string[]
}

/** 思维导图材料：对话/文本使用 text，PDF、Word、演示文稿使用工作区文件。 */
export type MindmapMaterialKind = 'conversation' | 'document' | 'selection' | 'pdf' | 'word' | 'presentation' | 'html'

export interface MindmapMaterial {
  kind: MindmapMaterialKind
  fileName: string
  text?: string
  /** 文件材料：渲染层只提交工作区相对路径，主进程校验后补 filePath。 */
  workspaceRoot?: string
  relativePath?: string
  filePath?: string
  scope?: WorkbenchMindmapScope
}

export interface MindmapGenerationSession {
  platformId: string
  conversationUrl?: string
}

export interface MindmapTextEdit { oldText: string; newText: string }
export type MindmapModifyResponse =
  | { kind: 'edits'; edits: MindmapTextEdit[] }
  | { kind: 'rewrite'; markdown: string }
export interface MindmapModifyRequest {
  conversationId: string
  mindmapId: string
  expectedUpdatedAt: number
  instructions: string
  platformId: string
  candidateId?: string
  newSession?: boolean
  includeSourceContext?: boolean
  source?: { webContentsId?: number; platformId: string; name: string }
}
export interface MindmapSourceContext {
  snapshot: string
  origin: 'live' | 'snapshot' | 'file'
  /** 文件来源：主进程校验后的绝对路径与展示名。 */
  filePath?: string
  fileName?: string
}
export interface MindmapCandidate {
  id: string
  conversationId: string
  mindmapId: string
  baseMarkdown: string
  baseTitle: string
  baseUpdatedAt: number
  candidateMarkdown: string
  generationSession: MindmapGenerationSession
}
export interface MindmapSelection {
  text: string
  url: string
  title: string
  webContentsId: number
}

export type NoteSourceDraft = Pick<NoteDraft, 'platform' | 'title' | 'url' | 'snapshot'>

export interface MindmapTask {
  id: string
  conversationId: string
  sourceTitle: string
  platform: string
  phase: 'loading' | 'generating' | 'saving' | 'done' | 'error' | 'cancelled'
  mindmapId?: string
  error?: string
  kind?: 'generate' | 'modify'
  candidateId?: string
  baseUpdatedAt?: number
  outcome?: 'candidate' | 'unchanged'
  contextSource?: 'live' | 'snapshot' | 'file'
}

export interface NoteNavigation {
  conversationId: string
  mindmapId?: string
}

export interface NoteDraft {
  sourceKey: string
  platform: string
  title: string
  url: string
  snapshot: string
  quote: string
  anchor: NoteAnchor
}

export interface NoteHighlight extends Pick<ConversationNote, 'id' | 'quote' | 'anchor' | 'comment'> {
  conversationId: string
}

export interface NoteSelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}

export const NOTE_CLICK_PREFIX = '__MULTICHAT_NOTE_CLICK__:'
export const NOTE_DISMISS_PREFIX = '__MULTICHAT_NOTE_DISMISS__:'
