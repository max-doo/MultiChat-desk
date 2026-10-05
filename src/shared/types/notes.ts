export interface NoteAnchor {
  exact: string
  prefix: string
  suffix: string
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
}

export interface MindmapGenerationSession {
  platformId: string
  conversationUrl?: string
}

export interface MindmapTextEdit { oldText: string; newText: string }
export interface MindmapEditResponse { edits: MindmapTextEdit[] }
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
export interface MindmapSourceContext { snapshot: string; origin: 'live' | 'snapshot' }
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
  contextSource?: 'live' | 'snapshot'
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
