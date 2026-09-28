export interface NoteAnchor {
  exact: string
  prefix: string
  suffix: string
}

export interface ConversationNote {
  id: string
  quote: string
  comment: string
  snapshot: string
  anchor: NoteAnchor
  createdAt: number
  updatedAt: number
}

export interface NoteConversation {
  id: string
  sourceKey: string
  platform: string
  title: string
  url: string
  updatedAt: number
  notes: ConversationNote[]
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
