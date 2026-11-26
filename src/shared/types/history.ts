export interface ConversationTurn {
  turnId: string
  userMessage: string
  timestamp: number
  responses: Record<string, string>  // modelId -> Markdown
}

export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: ConversationTurn[]
  urls?: Record<string, string>
  productMode?: ProductMode
  displayMode?: DisplayMode
  // 仅辩论模式
  debateTurns?: DebateTurnRecord[]
  slotUrls?: Record<number, string>      // slotIndex -> 最终 URL（避开同 modelId 冲突）
}

export interface SummaryHistoryItem {
  id: string
  title: string // 通常是第一条用户消息的摘要
  timestamp: number
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    reasoningContent?: string
    timestamp: number
    modeName?: string
    versions?: Array<{
      content: string
      reasoningContent?: string
      timestamp: number
      modelId: string
      modelName: string
    }>
    currentVersionIndex?: number
  }>
  selectedModels: string[] // 参与总结的模型 ID 列表
  modelResponses?: Record<string, string> // 各模型的原始回复
  /** 保留历史来源，兼容已有 API 总结记录 */
  summarySource?: 'api' | 'webview'
  /** Webview 总结记录的目标平台 id */
  webviewPlatformId?: string
  /** Webview 总结记录的会话 URL */
  webviewUrl?: string
  /** 主界面对话时各模型的 URL（用于追溯原始对话） */
  urls?: Record<string, string>
}


export type ProductMode = 'multi_ai' | 'task_assignment' | 'debate' | 'workbench'

// one/two/three 为列数，four 为田字格
export type DisplayMode = 'one' | 'two' | 'three' | 'four'


// 辩论一轮的落库结构（与运行态 DebateRound 区分：落库带 modelId 与时间戳）
export interface DebateTurnRecord {
  round: number          // 0-based
  proponent?: { modelId: string; speech: string; timestamp: number }
  opponent?:  { modelId: string; speech: string; timestamp: number }
}

export interface HistoryListItem {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  models: string[]
  productMode?: ProductMode
  displayMode?: DisplayMode
  turnCount: number
  hasSnapshot: boolean
}

export interface SummaryHistoryListItem {
  id: string
  title: string
  timestamp: number
  selectedModels: string[]
  preview: string
}

export type HistoryKind = 'conversation' | 'summary'
export type HistoryRecord = HistoryItem | SummaryHistoryItem
export interface DataImportResult { added: number; unchanged: number; conflicts: number }
