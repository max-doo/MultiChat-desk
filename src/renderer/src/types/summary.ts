/**
 * 总结面板相关的类型定义
 */

// API 返回结果类型
export interface SummaryResult {
  success: boolean
  data?: string
  reasoningContent?: string
  error?: string
  aborted?: boolean
}

// 助手消息的单个版本
export interface MessageVersion {
  content: string
  reasoningContent?: string  // 思考内容
  timestamp: number
  modelId: string      // 生成该版本的模型 ID
  modelName: string    // 生成该版本的模型名称
}

// 对话消息类型
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string  // 思考内容
  timestamp: number
  modeName?: string  // 用户消息时记录选择的模式名称
  // 助手消息支持多版本
  versions?: MessageVersion[]
  currentVersionIndex?: number
}

// SummaryPanel 组件的 Props
export interface SummaryPanelProps {
  selectedModels: string[]
  modelResponses: Record<string, string>
  restoreHistoryData?: {
    historyId?: string
    messages: ChatMessage[]
    selectedModels: string[]
    modelResponses: Record<string, string>
  } | null
  /** 总结页是否处于前台（用于休眠调度，决策 R3） */
  isActive?: boolean
}
