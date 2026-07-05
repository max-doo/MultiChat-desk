import { create } from 'zustand'
import type { WebviewCardRef, FileUploadData } from '../components/WebviewCard'
import synthesizerPrompt from './summary-prompts-defaults/综合最佳.md?raw'
import criticPrompt from './summary-prompts-defaults/裁判找茬.md?raw'
import debatePrompt from './summary-prompts-defaults/辩论裁决.md?raw'
import synthesisPrompt from './summary-prompts-defaults/成稿汇总.md?raw'

function stripFrontmatter(raw: string): string {
  const yamlMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/i)
  if (yamlMatch) {
    return raw.slice(yamlMatch[0].length).trim()
  }
  const htmlMatch = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*(?:\r?\n)?/i)
  if (htmlMatch) {
    return raw.slice(htmlMatch[0].length).trim()
  }
  return raw.trim()
}

// AI 平台 logo 本地资源
import chatgptLogo from '../assets/logos/chatgpt.svg'
import geminiLogo from '../assets/logos/gemini.png'
import grokLogo from '../assets/logos/grok.png'
import claudeLogo from '../assets/logos/claude.svg'
import perplexityLogo from '../assets/logos/perplexity.png'
import arenaLogo from '../assets/logos/arena.png'
import doubaoLogo from '../assets/logos/doubao.png'
import yuanbaoLogo from '../assets/logos/yuanbao.png'
import qwenLogo from '../assets/logos/qwen.svg'
import deepseekLogo from '../assets/logos/deepseek.png'
import kimiLogo from '../assets/logos/kimi.ico'
import chatglmLogo from '../assets/logos/chatglm.ico'
import yiyanLogo from '../assets/logos/yiyan.ico'

// 监控配置常量
const MONITOR_CONFIG = {
  pollIntervalMs: 3000,                 // 每 3 秒轮询一次
  stableThreshold: 3,                   // 连续 3 次不变即判定完成（约 9 秒）
  maxMonitorDurationMs: 5 * 60 * 1000,  // 最长监控 5 分钟（防死等）
}

// saveCurrentTurn 写盘节流：监控期间每 10s 落盘一次，避免每轮（~3s）全量写盘放大。
// forceFlush=true（监控结束/中止/完成）时绕过节流立即写。
let historyPersistLastTs = 0
const HISTORY_PERSIST_MIN_INTERVAL = 10_000

// 模型配置类型
export interface ModelConfig {
  id: string
  name: string
  url: string
  logo: string
  enabled: boolean
}

// 总结提示词配置类型
export interface SummaryPrompt {
  id: string
  name: string
  description?: string
  prompt: string
  isDefault?: boolean  // 是否为系统预设
  schemaVersion?: number
}

// API 供应商配置
export interface ApiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  validated?: boolean // 是否校验通过（旧字段，保留兼容）
  /** 校验三态：unknown 未校验 / valid 通过 / invalid 失败。读取时若 validated===true 视为 valid */
  validatedStatus?: 'unknown' | 'valid' | 'invalid'
  /** 校验失败时的错误摘要（validatedStatus === 'invalid' 时填充） */
  validatedError?: string
}

// 模型配置（用于总结 Agent）
export interface SummaryModel {
  id: string
  name: string
  providerId: string // 关联供应商
}

// API 配置类型
export interface ApiConfig {
  providers: ApiProvider[] // 供应商列表
  activeProviderId?: string // 当前选中的供应商 ID
  lastSelectedAgentId?: string // 上次选中的总结模型 ID
  summaryPrompts?: SummaryPrompt[] // 用户配置的总结提示词
  exportDirectory?: string
  systemPrompt?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  includeReasoning?: boolean
  contextRounds?: number  // 多轮对话的上下文轮数，0 表示不保留上下文
  favoriteModelIds?: string[] // 收藏的模型 ID 列表
  /** 'api'（接 OpenAI 兼容）或 'webview'（嵌入式厂商页面） */
  summarySource?: 'api' | 'webview'
  /** Webview 模式下上次选中的目标平台 id */
  lastWebviewSummaryPlatform?: string
}

// 对话轮次（一问一答）
export interface ConversationTurn {
  turnId: string
  userMessage: string
  timestamp: number
  responses: Record<string, string>  // modelId -> Markdown
}

// 历史记录（新格式，替代现有 HistoryItem）
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
  // —— 仅辩论模式 ——
  debateTurns?: DebateTurnRecord[]       // 各轮正/反方发言
  slotUrls?: Record<number, string>      // slotIndex -> 最终 URL（避开同 modelId 冲突）
}

// 总结历史记录类型
export interface SummaryHistoryItem {
  id: string
  title: string // 总结对话的标题（通常是第一条用户消息的摘要）
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
  /** 'api' 或 'webview'，缺省视为 'api'（兼容旧记录） */
  summarySource?: 'api' | 'webview'
  /** summarySource = 'webview' 时记录目标平台 id */
  webviewPlatformId?: string
  /** summarySource = 'webview' 时记录总结会话的 URL */
  webviewUrl?: string
  /** 主界面对话时各模型的 URL（用于追溯原始对话） */
  urls?: Record<string, string>
}

/** 从主界面导航到总结页时携带的一次性初始化数据 */
export interface SummarySessionInit {
  modelResponses: Record<string, string>
  urls?: Record<string, string>
  sourceHistoryId?: string
  timestamp: number
  /** 哪些模型的回复来自本地历史快照兜底（实时页面不可用），供总结页标注 */
  snapshotModelIds?: string[]
  /** 预选的总结模板 id（如从辩论模式进入时预选 '5' 辩论对决）。useSummaryPanel 在首次挂载时读取。 */
  presetSummaryMode?: string
}

// 发送结果类型
export interface SendResult {
  modelId: string
  success: boolean
  error?: string
}

// 产品模式类型：多AI（默认）、任务分配（支持多个窗口选择同一AI）、辩论（目前支持2个AI）
export type ProductMode = 'multi_ai' | 'task_assignment' | 'debate'

// 显示模式类型：单列、双列、三列、四窗口（田字格）
export type DisplayMode = 'one' | 'two' | 'three' | 'four'

// 任务分配模式状态机
export type TaskPhase = 'idle' | 'split' | 'inserted' | 'sent'
export interface TaskSubtask {
  text: string
  modelId: string // 派生展示用：= taskAssignmentSlots[slotIndex] 对应的模型 id
  slotIndex: number // 目标窗口槽位（0..slotCount-1），一键派发按此分发
}
export interface TaskState {
  phase: TaskPhase
  query: string
  subtasks: TaskSubtask[]
  collapsed: boolean // 子任务弹层是否折叠
}

// 辩论模式状态机
export type DebatePhase = 'idle' | 'running' | 'paused' | 'finished'
export interface DebateRound {
  proponent?: string  // 正方发言
  opponent?: string   // 反方发言
}
// 辩论一轮的落库结构（与运行态 DebateRound 区分：落库带 modelId 与时间戳）
export interface DebateTurnRecord {
  round: number          // 第几轮（0-based）
  proponent?: { modelId: string; speech: string; timestamp: number }
  opponent?:  { modelId: string; speech: string; timestamp: number }
}
export interface DebateState {
  phase: DebatePhase
  topic: string
  totalRounds: number
  currentRound: number // 已完成的全轮数
  currentTurn: 0 | 1   // 0=正方发言中, 1=反方发言中
  rounds: DebateRound[]
}

// 监控状态类型（内部使用，不对外暴露）
interface PlatformMonitorState {
  lastContent: string
  stableCount: number
  isComplete: boolean
}

interface TurnMonitor {
  turnId: string
  userMessage: string
  platforms: Record<string, PlatformMonitorState>
}

interface MonitorState {
  isMonitoring: boolean
  currentConversationId: string | null
  currentTurn: TurnMonitor | null
  intervalId: ReturnType<typeof setInterval> | null
  startTime: number
}

// 应用状态类型
interface AppState {
  // 产品运行模式
  productMode: ProductMode
  setProductMode: (mode: ProductMode) => void

  // 多AI模式和辩论模式下的各个槽位选中的模型 ID 列表
  multiAiSlots: string[]
  setMultiAiSlots: (slots: string[]) => void

  // 任务分配模式下的各个槽位选中的模型 ID 列表
  taskAssignmentSlots: string[]
  setTaskAssignmentSlot: (slotIndex: number, modelId: string) => void
  setTaskAssignmentSlots: (slots: string[]) => void

  // 任务分配状态机（不持久化）
  taskState: TaskState
  setTaskPhase: (phase: TaskPhase) => void
  setTaskQuery: (query: string) => void
  setTaskSubtasks: (subtasks: TaskSubtask[]) => void
  updateSubtask: (index: number, patch: Partial<TaskSubtask>) => void
  addSubtask: () => void
  removeSubtask: (index: number) => void
  toggleTaskCollapsed: () => void
  resetTask: () => void

  // 辩论状态机（不持久化）
  debateSlots: [string, string] // [正方 modelId, 反方 modelId]
  setDebateSlot: (side: 0 | 1, modelId: string) => void
  debateTotalRounds: number
  setDebateTotalRounds: (n: number) => void
  debateState: DebateState
  setDebatePhase: (phase: DebatePhase) => void
  setDebateTopic: (topic: string) => void
  appendDebateSpeech: (round: number, turn: 0 | 1, speech: string) => void
  advanceDebateTurn: () => void
  resetDebate: () => void

  // 专属模式窗口布局记录
  multiAiDisplayMode: DisplayMode
  taskAssignmentDisplayMode: DisplayMode

  // 当前激活的显示模式
  displayMode: DisplayMode
  setDisplayMode: (mode: DisplayMode) => void

  paneRatios: number[] | null
  setPaneRatios: (ratios: number[]) => void
  resetPaneRatios: () => void

  // 模型配置
  models: ModelConfig[]
  updateModel: (id: string, config: Partial<ModelConfig>) => void
  toggleModel: (id: string) => void
  reorderModels: (newOrder: string[]) => void
  swapModelInSlot: (slotIndex: number, newModelId: string) => void

  // Webview 引用（用于发送消息）
  webviewRefs: Map<string, WebviewCardRef>
  registerWebviewRef: (id: string, ref: WebviewCardRef) => void
  unregisterWebviewRef: (id: string, ref: WebviewCardRef) => void

  // API 配置
  apiConfig: ApiConfig
  setApiConfig: (config: ApiConfig) => void

  // 总结模型列表 (独立存储以方便管理)
  summaryModels: SummaryModel[]
  setSummaryModels: (models: SummaryModel[]) => void

  // 历史记录
  history: HistoryItem[]
  addHistory: (item: HistoryItem) => void
  updateHistory: (id: string, updates: Partial<HistoryItem>) => void
  removeHistory: (id: string) => void
  removeHistories: (ids: string[]) => void

  // 总结历史记录
  summaryHistory: SummaryHistoryItem[]
  addSummaryHistory: (item: SummaryHistoryItem) => void
  updateSummaryHistory: (id: string, updates: Partial<SummaryHistoryItem>) => void
  removeSummaryHistory: (id: string) => void
  removeSummaryHistories: (ids: string[]) => void

  // History 分页：磁盘总量 + 加载更多
  historyTotalCount: number
  summaryHistoryTotalCount: number
  // 已从磁盘加载到内存（含被裁剪掉的）的条数游标，用作 loadMore 的 offset。
  // 内存只保留最新 100，用 history.length 作 offset 会重复取已裁剪的旧页。
  historyLoadedCount: number
  summaryHistoryLoadedCount: number
  loadMoreHistory: () => Promise<void>
  loadMoreSummaryHistory: () => Promise<void>

  // 发送状态
  isSending: boolean
  lastSendResults: SendResult[]
  textInserted: boolean // 文字是否已输入到 webview
  setTextInserted: (inserted: boolean) => void
  activeModels: ModelConfig[]
  setActiveModels: (models: ModelConfig[]) => void


  // 只输入文字到所有模型的输入框，不发送
  insertTextToAll: (message: string) => Promise<SendResult[]>

  // 清空所有模型的输入框
  clearInputToAll: () => Promise<SendResult[]>

  // 共享历史原语：判定新/旧对话并写入历史头部，返回 conversationId。
  // turnId 由调用方自行生成，本方法只管会话生命周期。
  beginConversation: (input: {
    successModelIds: string[]
    currentUrls: Record<string, string>
    productMode: ProductMode
    displayMode: DisplayMode
  }) => Promise<{ conversationId: string; isNew: boolean; lastItem: HistoryItem | null }>

  // 发送消息到所有启用的模型（从已输入的文本发送）
  sendMessageToAll: (message: string) => Promise<SendResult[]>

  // 单槽位 webview 编排（辩论轮转用）
  sendToSlot: (slotIndex: number, message: string) => Promise<{ success: boolean; error?: string }>
  insertTextToSlot: (slotIndex: number, message: string) => Promise<{ success: boolean; error?: string }>
  getResponseFromSlot: (slotIndex: number, timeoutMs?: number, baseline?: string) => Promise<string>
  clearInputOfSlot: (slotIndex: number) => Promise<void>

  // 获取所有模型的最新回复
  getAllResponses: (options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<Record<string, string>>

  // 监控状态（不持久化）
  monitor: MonitorState
  startMonitoring: (conversationId: string, turnId: string, userMessage: string, models: string[]) => void
  stopMonitoring: () => void
  pollPlatforms: () => Promise<void>
  saveCurrentTurn: (forceFlush?: boolean) => void
  updatePlatformAnswer: (modelId: string, text: string, isComplete?: boolean) => void

  // 文件上传状态
  isUploading: boolean
  uploadProgress: Record<string, 'pending' | 'uploading' | 'success' | 'error'>

  // 上传文件到所有模型
  uploadFileToAll: (fileData: FileUploadData) => Promise<SendResult[]>

  // Deep Research 模式
  isDeepResearch: boolean
  setDeepResearch: (enabled: boolean) => void
  enableDeepResearchForAll: () => Promise<SendResult[]>
  disableDeepResearchForAll: () => Promise<SendResult[]>

  // AI 生图模式
  isImageGeneration: boolean
  setImageGeneration: (enabled: boolean) => void
  enableImageGenerationForAll: () => Promise<SendResult[]>
  disableImageGenerationForAll: () => Promise<SendResult[]>

  // 一键提取所有窗口生图
  extractImagesFromAll: () => Promise<ExtractImagesResult[]>

  // 会话状态
  isNewSession: boolean
  setNewSession: (isNew: boolean) => void
  chatSessionVersion: number
  // 持久化的"当前对话"锚点：监控结束后仍存活，所有"当前对话"查询走 ID 查找而非 history[0]。
  // 与 monitor.currentConversationId（监控态，监控结束即清空）语义不同但同源——
  // startMonitoring 时两者同步写入，stopMonitoring 时只清 monitor 字段，本字段保留。
  currentConversationId: string | null
  setCurrentConversationId: (id: string | null) => void

  // 页面导航状态
  currentPage: 'main' | 'summary' | 'quick' | 'diagnostics'
  setCurrentPage: (page: 'main' | 'summary' | 'quick' | 'diagnostics') => void

  // UI 抽屉状态
  isSettingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  isHistoryOpen: boolean
  setHistoryOpen: (open: boolean) => void

  // 一次性导航数据：从主界面进入总结页时携带，消费后立即清空
  pendingSummarySession: SummarySessionInit | null
  setPendingSummarySession: (data: SummarySessionInit | null) => void

  // 自动化 IPC 核心（供 CLI 驱动场景使用，不覆盖 UI Webview 递法）
  /** 向指定平台发送 prompt 并延迟收集结果 */
  automationSendPrompt: (platformId: string, prompt: string, collectDelayMs?: number) => Promise<{ success: boolean; data?: string; error?: string }>
  /** 仅收集指定平台的最新回复 */
  automationCollect: (platformId: string) => Promise<{ success: boolean; data?: string; error?: string }>

  // 诊断窗口透传监听
  registerDiagnosticsRelay: () => () => void
}

/**
 * 根据显示模式和产品运行模式获取要显示的模型列表
 */
export function getDisplayedModels(
  models: ModelConfig[],
  displayMode: DisplayMode,
  productMode?: ProductMode,
  taskAssignmentSlots?: string[],
  multiAiSlots?: string[],
  debateSlots?: [string, string]
): ModelConfig[] {
  let displayCount: number
  if (productMode === 'debate') {
    displayCount = 2
  } else {
    switch (displayMode) {
      case 'one': displayCount = 1; break
      case 'two': displayCount = 2; break
      case 'four': displayCount = 4; break
      case 'three':
      default: displayCount = 3; break
    }
  }

  if (productMode === 'debate' && debateSlots) {
    return Array.from({ length: 2 }, (_, index) => {
      const slotId = debateSlots[index]
      return models.find(m => m.id === slotId) || models[index % models.length]
    })
  }

  if (productMode === 'task_assignment' && taskAssignmentSlots) {
    return Array.from({ length: displayCount }, (_, index) => {
      const slotId = taskAssignmentSlots[index]
      return models.find(m => m.id === slotId) || models[index % models.length]
    })
  }

  if (multiAiSlots) {
    return Array.from({ length: displayCount }, (_, index) => {
      const slotId = multiAiSlots[index]
      return models.find(m => m.id === slotId) || models[index % models.length]
    })
  }

  return models.slice(0, displayCount)
}

export const DEEP_RESEARCH_SUPPORTED_MODEL_IDS = new Set([
  'gemini',
  'grok',
  'chatgpt',
  'perplexity',
  'chatglm',
  'qwen',
  'doubao',
  'deepseek'
])

export const DEEP_RESEARCH_UNSUPPORTED_ERROR = '此模型不支持深度研究'

export const IMAGE_GENERATION_SUPPORTED_MODEL_IDS = new Set([
  'gemini',
  'grok',
  'chatgpt',
  'qwen',
  'kimi',
  'doubao',
  'yuanbao',
  'chatglm',
  'yiyan'
])

export const IMAGE_GENERATION_UNSUPPORTED_ERROR = '此模型不支持 AI 生图'

export interface ExtractedImage {
  src: string
  mime?: string
}

export interface ExtractImagesResult {
  modelId: string
  wcId: number | null
  images: ExtractedImage[]
  error?: string
}

// 默认模型配置
const defaultModels: ModelConfig[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', logo: chatgptLogo, enabled: true },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', logo: geminiLogo, enabled: true },
  { id: 'grok', name: 'Grok', url: 'https://grok.com', logo: grokLogo, enabled: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', logo: claudeLogo, enabled: false },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', logo: perplexityLogo, enabled: false },
  { id: 'arena', name: 'Arena', url: 'https://arena.ai/', logo: arenaLogo, enabled: false },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat', logo: doubaoLogo, enabled: false },
  { id: 'yuanbao', name: '元宝', url: 'https://yuanbao.tencent.com/chat', logo: yuanbaoLogo, enabled: false },
  { id: 'qwen', name: '千问', url: 'https://tongyi.aliyun.com/qianwen', logo: qwenLogo, enabled: false },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', logo: deepseekLogo, enabled: false },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn', logo: kimiLogo, enabled: false },
  { id: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail?lang=zh', logo: chatglmLogo, enabled: false },
  { id: 'yiyan', name: '文心一言', url: 'https://chat.baidu.com/', logo: yiyanLogo, enabled: false }
]

export const DEFAULT_MODEL_ORDER = defaultModels.map(m => m.id)

// 默认总结提示词预设
export const defaultSummaryPrompts: SummaryPrompt[] = [
  {
    id: '1',
    name: '综合最佳',
    description: '多模型去重互补纠错，输出最可信答案。',
    isDefault: true,
    schemaVersion: 1,
    prompt: stripFrontmatter(synthesizerPrompt)
  },
  {
    id: '2',
    name: '裁判找茬',
    description: '事实核查与逻辑纠错，剔除幻觉废话。',
    isDefault: false,
    schemaVersion: 1,
    prompt: stripFrontmatter(criticPrompt)
  },
  {
    id: '3',
    name: '辩论裁决',
    description: '多轮辩论后的主席裁决（仅辩论模式用）。',
    isDefault: false,
    schemaVersion: 1,
    prompt: stripFrontmatter(debatePrompt)
  },
  {
    id: '4',
    name: '成稿汇总',
    description: '任务拆解后多子任务结果合成可交付成品。',
    isDefault: false,
    schemaVersion: 1,
    prompt: synthesisPrompt
  }
]

// 默认总结模型
export const defaultSummaryModels: SummaryModel[] = []

// 默认供应商
const defaultProviders: ApiProvider[] = []

/**
 * 归一化 URL：只保留 origin + pathname，忽略 query 参数
 */
function normalizeUrl(url: string): string {
  if (!url || url === 'about:blank') return ''
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url
  }
}

/**
 * 判定是否应该开始新对话
 * @param currentUrls 当前各平台 URL
 * @param previousUrls 上次保存的 URL
 * @param isNewSession 是否显式标记为新会话
 */
function shouldStartNewConversation(
  currentUrls: Record<string, string>,
  previousUrls: Record<string, string> | undefined,
  isNewSession: boolean
): boolean {
  if (isNewSession) return true
  if (!previousUrls || Object.keys(previousUrls).length === 0) return true

  const currentKeys = Object.keys(currentUrls)
  const previousKeys = Object.keys(previousUrls)

  if (currentKeys.length !== previousKeys.length) return true
  if (!currentKeys.every(k => previousKeys.includes(k))) return true

  for (const modelId of currentKeys) {
    const curr = normalizeUrl(currentUrls[modelId])
    const prev = normalizeUrl(previousUrls[modelId])
    if (curr && prev && curr !== prev) return true
  }

  return false
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const isGeminiConversationUrl = (rawUrl: string): boolean => {
  try {
    const u = new URL(rawUrl)
    if (u.origin !== 'https://gemini.google.com') return false
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'app' && typeof parts[1] === 'string' && parts[1].length > 0) return true
    if (parts[0] === 'u' && parts[2] === 'app' && typeof parts[3] === 'string' && parts[3].length > 0) return true
    return false
  } catch {
    return false
  }
}

const normalizeGeminiConversationUrl = (rawUrl: string): string => {
  try {
    const u = new URL(rawUrl)
    const parts = u.pathname.split('/').filter(Boolean)
    let conversationId: string | undefined
    if (parts[0] === 'app') {
      conversationId = parts[1]
    } else if (parts[0] === 'u' && parts[2] === 'app') {
      conversationId = parts[3]
    }
    if (!conversationId) return ''
    return `https://gemini.google.com/app/${conversationId}`
  } catch {
    return ''
  }
}

function isSavableSessionUrl(modelId: string, url: string): boolean {
  if (!url || url === 'about:blank') return false
  if (modelId === 'gemini') {
    return isGeminiConversationUrl(url)
  }

  const cleanUrl = url.split('?')[0].replace(/\/+$/, '')

  // 排除各个平台的典型新建对话初始页路径
  if (modelId === 'claude' && cleanUrl.endsWith('/new')) return false
  if (modelId === 'doubao' && cleanUrl.endsWith('/chat')) return false
  if (modelId === 'yuanbao' && cleanUrl.endsWith('/chat')) return false
  if (modelId === 'chatglm' && cleanUrl.endsWith('/alltoolsdetail')) return false

  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')
    // 如果只有域名首页（如 https://chatgpt.com 或 https://chat.deepseek.com 等），非历史独立会话
    if (!path || path === '') return false
    // 排除通用新建对话页面
    if (path === '/new' || path === '/chat' || path === '/app' || path === '/main/alltoolsdetail') return false
  } catch {
    return false
  }

  return true
}

export const waitForSavableUrl = async (modelId: string, ref: WebviewCardRef): Promise<string> => {
  const timeoutMs = modelId === 'gemini' ? 30000 : 20000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const currentUrl = ref.getCurrentUrl()
    if (currentUrl && isSavableSessionUrl(modelId, currentUrl)) {
      if (modelId === 'gemini') {
        return normalizeGeminiConversationUrl(currentUrl) || currentUrl
      }
      return currentUrl
    }
    await sleep(1000)
  }
  return ''
}


// 创建状态存储
export const useAppStore = create<AppState>((set, get) => ({
  productMode: 'multi_ai',
  setProductMode: (mode) => {
    const currentMode = get().productMode
    if (currentMode === mode) return
    
    // 只要切换模式，就重置当前会话锁，防止锁机制污染其他模式
    get().setNewSession(true)

    // 读取目标模式保存的布局偏好
    let targetDisplayMode = get().displayMode
    if (mode === 'multi_ai') {
      targetDisplayMode = get().multiAiDisplayMode
    } else if (mode === 'task_assignment') {
      targetDisplayMode = get().taskAssignmentDisplayMode
      if (targetDisplayMode === 'one') targetDisplayMode = 'two' // 任务分发不能是单窗口
    } else if (mode === 'debate') {
      targetDisplayMode = 'two' // 辩论模式强制双窗口
    }

    set({ productMode: mode, displayMode: targetDisplayMode, paneRatios: null })
    
    if (window.api?.storeSet) {
      window.api.storeSet('productMode', mode)
      window.api.storeSet('displayMode', targetDisplayMode)
    }
  },

  multiAiSlots: ['chatgpt', 'gemini', 'grok', 'claude'],
  setMultiAiSlots: (slots) => set((state) => {
    if (window.api?.storeSet) window.api.storeSet('multiAiSlots', slots)
    return { multiAiSlots: slots }
  }),

  taskAssignmentSlots: ['chatgpt', 'gemini', 'grok', 'claude'],
  setTaskAssignmentSlot: (slotIndex, modelId) => set((state) => {
    const newSlots = [...state.taskAssignmentSlots]
    newSlots[slotIndex] = modelId
    if (window.api?.storeSet) window.api.storeSet('taskAssignmentSlots', newSlots)
    return { taskAssignmentSlots: newSlots }
  }),
  setTaskAssignmentSlots: (slots) => set((state) => {
    if (window.api?.storeSet) window.api.storeSet('taskAssignmentSlots', slots)
    return { taskAssignmentSlots: slots }
  }),

  taskState: { phase: 'idle', query: '', subtasks: [], collapsed: false },
  setTaskPhase: (phase) => set((s) => ({ taskState: { ...s.taskState, phase } })),
  setTaskQuery: (query) => set((s) => ({ taskState: { ...s.taskState, query } })),
  setTaskSubtasks: (subtasks) => set((s) => ({ taskState: { ...s.taskState, subtasks } })),
  updateSubtask: (index, patch) => set((s) => {
    const subtasks = s.taskState.subtasks.map((st, i) => i === index ? { ...st, ...patch } : st)
    return { taskState: { ...s.taskState, subtasks } }
  }),
  addSubtask: () => set((s) => {
    // 默认指派到当前 webview 槽位模型（与分解指派、cycle 一致），fallback 用第一个模型
    const slotModels = getDisplayedModels(s.models, s.displayMode, 'task_assignment', s.taskAssignmentSlots)
    const slotCount = Math.max(1, slotModels.length)
    const slotIndex = s.taskState.subtasks.length % slotCount
    const modelId = (slotModels[slotIndex] || s.models[0])?.id || ''
    return { taskState: { ...s.taskState, subtasks: [...s.taskState.subtasks, { text: '新增子任务', modelId, slotIndex }] } }
  }),
  removeSubtask: (index) => set((s) => ({
    taskState: { ...s.taskState, subtasks: s.taskState.subtasks.filter((_, i) => i !== index) }
  })),
  toggleTaskCollapsed: () => set((s) => ({ taskState: { ...s.taskState, collapsed: !s.taskState.collapsed } })),
  resetTask: () => set({ taskState: { phase: 'idle', query: '', subtasks: [], collapsed: false } }),

  debateSlots: ['chatgpt', 'gemini'],
  setDebateSlot: (side, modelId) => set((s) => {
    const slots = [...s.debateSlots] as [string, string]
    slots[side] = modelId
    if (window.api?.storeSet) window.api.storeSet('debateSlots', slots)
    return { debateSlots: slots }
  }),
  debateTotalRounds: 3,
  setDebateTotalRounds: (n) => set({ debateTotalRounds: Math.max(1, Math.min(10, Math.floor(n) || 1)) }),
  debateState: { phase: 'idle', topic: '', totalRounds: 3, currentRound: 0, currentTurn: 0, rounds: [] },
  setDebatePhase: (phase) => set((s) => ({ debateState: { ...s.debateState, phase } })),
  setDebateTopic: (topic) => set((s) => ({ debateState: { ...s.debateState, topic } })),
  appendDebateSpeech: (round, turn, speech) => set((s) => {
    const rounds = [...s.debateState.rounds]
    if (!rounds[round]) rounds[round] = {}
    rounds[round] = { ...rounds[round], [turn === 0 ? 'proponent' : 'opponent']: speech }
    return { debateState: { ...s.debateState, rounds } }
  }),
  advanceDebateTurn: () => set((s) => {
    const { currentTurn, currentRound, totalRounds } = s.debateState
    if (currentTurn === 0) {
      return { debateState: { ...s.debateState, currentTurn: 1 } }
    }
    const nextRound = currentRound + 1
    if (nextRound >= totalRounds) {
      return { debateState: { ...s.debateState, currentTurn: 0, currentRound: totalRounds, phase: 'finished' } }
    }
    return { debateState: { ...s.debateState, currentTurn: 0, currentRound: nextRound } }
  }),
  resetDebate: () => set((s) => ({
    debateState: { phase: 'idle', topic: '', totalRounds: s.debateTotalRounds, currentRound: 0, currentTurn: 0, rounds: [] }
  })),

  multiAiDisplayMode: 'three',
  taskAssignmentDisplayMode: 'two',
  displayMode: 'three',
  setDisplayMode: (mode) => {
    const currentProductMode = get().productMode
    if (currentProductMode === 'task_assignment' && mode === 'one') {
      return
    }
    if (currentProductMode === 'debate' && mode !== 'two') {
      return
    }
    
    const updates: Partial<AppState> = { displayMode: mode, paneRatios: null }
    if (currentProductMode === 'multi_ai') {
      updates.multiAiDisplayMode = mode
      if (window.api?.storeSet) window.api.storeSet('multiAiDisplayMode', mode)
    } else if (currentProductMode === 'task_assignment') {
      updates.taskAssignmentDisplayMode = mode
      if (window.api?.storeSet) window.api.storeSet('taskAssignmentDisplayMode', mode)
    }

    set(updates)
    if (window.api?.storeSet) window.api.storeSet('displayMode', mode)
  },

  paneRatios: null,
  setPaneRatios: (ratios) => set({ paneRatios: ratios }),
  resetPaneRatios: () => set({ paneRatios: null }),

  models: defaultModels,
  updateModel: (id, config) => set((state) => ({
    models: state.models.map((model) =>
      model.id === id ? { ...model, ...config } : model
    )
  })),
  toggleModel: (id) => set((state) => {
    const newModels = state.models.map((model) =>
      model.id === id ? { ...model, enabled: !model.enabled } : model
    )
    if (window.api?.storeSet) window.api.storeSet('models', newModels)
    return { models: newModels }
  }),
  reorderModels: (newOrder: string[]) => set((state) => {
    const modelMap = new Map(state.models.map(m => [m.id, m]))
    const reorderedModels = newOrder.map(id => modelMap.get(id)).filter(Boolean) as ModelConfig[]
    state.models.forEach(model => {
      if (!newOrder.includes(model.id)) reorderedModels.push(model)
    })
    if (window.api?.storeSet) window.api.storeSet('models', reorderedModels)
    return { models: reorderedModels }
  }),
  swapModelInSlot: (slotIndex: number, newModelId: string) => set((state) => {
    if (state.productMode === 'debate') {
      const slots = [...state.debateSlots] as [string, string]
      if (slotIndex === 0 || slotIndex === 1) slots[slotIndex] = newModelId
      if (window.api?.storeSet) window.api.storeSet('debateSlots', slots)
      return { debateSlots: slots }
    }
    if (state.productMode === 'task_assignment') {
      const newSlots = [...state.taskAssignmentSlots]
      newSlots[slotIndex] = newModelId
      if (window.api?.storeSet) window.api.storeSet('taskAssignmentSlots', newSlots)
      return { taskAssignmentSlots: newSlots }
    } else {
      const newSlots = [...state.multiAiSlots]
      const existingIndex = newSlots.findIndex(id => id === newModelId)

      if (existingIndex !== -1 && existingIndex !== slotIndex) {
        // 模型已在其他槽位，执行对调
        const oldModelId = newSlots[slotIndex]
        newSlots[existingIndex] = oldModelId
        newSlots[slotIndex] = newModelId
      } else {
        // 模型不在槽位中，直接替换
        newSlots[slotIndex] = newModelId
      }

      if (window.api?.storeSet) window.api.storeSet('multiAiSlots', newSlots)
      return { multiAiSlots: newSlots }
    }
  }),

  webviewRefs: new Map(),
  registerWebviewRef: (id, ref) => get().webviewRefs.set(id, ref),
  unregisterWebviewRef: (id, ref) => {
    // 仅当当前注册的 ref 就是要注销的那个才删，避免新 ref 已覆盖后旧回调误删新 ref
    if (get().webviewRefs.get(id) === ref) get().webviewRefs.delete(id)
  },

  apiConfig: {
    providers: defaultProviders,
    activeProviderId: undefined,
    summaryPrompts: defaultSummaryPrompts
  },
  setApiConfig: (config) => {
    set({ apiConfig: config })
    if (window.api?.storeSet) {
      const { summaryPrompts: _summaryPrompts, ...persisted } = (config || {}) as any
      window.api.storeSet('apiConfig', persisted)
    }
  },

  summaryModels: defaultSummaryModels,
  setSummaryModels: (models) => {
    set({ summaryModels: models })
    if (window.api?.storeSet) window.api.storeSet('summaryModels', models)
  },

  history: [],
  addHistory: (item) => set((state) => {
    const newHistory = [item, ...state.history].slice(0, 100)
    if (window.api?.storeSet) window.api.storeSet('history', newHistory)
    return { history: newHistory }
  }),
  updateHistory: (id, updates) => set((state) => {
    const newHistory = state.history.map(item =>
      item.id === id ? { ...item, ...updates } : item
    )
    if (window.api?.storeSet) window.api.storeSet('history', newHistory)
    return { history: newHistory }
  }),
  removeHistory: (id: string) => set((state) => {
    const newHistory = state.history.filter(item => item.id !== id)
    if (window.api?.storeSet) window.api.storeSet('history', newHistory)
    // 删除的恰是当前对话锚点时清空，避免残留脏 ID 触发 find 不到退回 null（无串台但语义更干净）
    const cleared = state.currentConversationId === id
    return { history: newHistory, ...(cleared ? { currentConversationId: null } : {}) }
  }),
  removeHistories: (ids: string[]) => set((state) => {
    const newHistory = state.history.filter(item => !ids.includes(item.id))
    if (window.api?.storeSet) window.api.storeSet('history', newHistory)
    const cleared = state.currentConversationId !== null && ids.includes(state.currentConversationId)
    return { history: newHistory, ...(cleared ? { currentConversationId: null } : {}) }
  }),

  summaryHistory: [],
  historyTotalCount: 0,
  summaryHistoryTotalCount: 0,
  historyLoadedCount: 0,
  summaryHistoryLoadedCount: 0,
  addSummaryHistory: (item) => set((state) => {
    const newHistory = [item, ...state.summaryHistory].slice(0, 100)
    if (window.api?.storeSet) window.api.storeSet('summaryHistory', newHistory)
    return { summaryHistory: newHistory }
  }),
  updateSummaryHistory: (id, updates) => set((state) => {
    const newHistory = state.summaryHistory.map(item =>
      item.id === id ? { ...item, ...updates } : item
    )
    if (window.api?.storeSet) window.api.storeSet('summaryHistory', newHistory)
    return { summaryHistory: newHistory }
  }),
  removeSummaryHistory: (id: string) => set((state) => {
    const newHistory = state.summaryHistory.filter(item => item.id !== id)
    if (window.api?.storeSet) window.api.storeSet('summaryHistory', newHistory)
    return { summaryHistory: newHistory }
  }),
  removeSummaryHistories: (ids: string[]) => set((state) => {
    const newHistory = state.summaryHistory.filter(item => !ids.includes(item.id))
    if (window.api?.storeSet) window.api.storeSet('summaryHistory', newHistory)
    return { summaryHistory: newHistory }
  }),

  loadMoreHistory: async () => {
    const state = get()
    if (!window.api?.historyGetPage) return
    // 用“已加载游标”作 offset，而非 history.length——内存只保留最新 100，
    // 用 history.length 会重复取已被裁剪的旧页
    const offset = state.historyLoadedCount
    const result = await window.api.historyGetPage(offset, 100)
    if (result.success && result.data && result.data.length > 0) {
      set((s) => {
        // 拼接后裁剪：内存硬上限 100，超出从最旧端裁掉（更旧的仍可再次 loadMore 翻页取回）
        const merged = [...s.history, ...result.data!]
        const trimmed = merged.length > 100 ? merged.slice(merged.length - 100) : merged
        return {
          history: trimmed,
          historyLoadedCount: s.historyLoadedCount + result.data!.length
        }
      })
      // 刷新 totalCount，防止边界变化导致按钮态错位
      const countResult = await window.api.historyGetTotalCount()
      if (countResult.success && countResult.data !== undefined) {
        set({ historyTotalCount: countResult.data })
      }
    }
  },

  loadMoreSummaryHistory: async () => {
    const state = get()
    if (!window.api?.summaryHistoryGetPage) return
    const offset = state.summaryHistoryLoadedCount
    const result = await window.api.summaryHistoryGetPage(offset, 100)
    if (result.success && result.data && result.data.length > 0) {
      set((s) => {
        const merged = [...s.summaryHistory, ...result.data!]
        const trimmed = merged.length > 100 ? merged.slice(merged.length - 100) : merged
        return {
          summaryHistory: trimmed,
          summaryHistoryLoadedCount: s.summaryHistoryLoadedCount + result.data!.length
        }
      })
      const countResult = await window.api.summaryHistoryGetTotalCount()
      if (countResult.success && countResult.data !== undefined) {
        set({ summaryHistoryTotalCount: countResult.data })
      }
    }
  },


  isSending: false,
  lastSendResults: [],
  textInserted: false,
  setTextInserted: (inserted: boolean) => set({ textInserted: inserted }),
  activeModels: [],
  setActiveModels: (models: ModelConfig[]) => set({ activeModels: models }),
  isNewSession: true,
  chatSessionVersion: Date.now(),
  currentConversationId: null,
  setCurrentConversationId: (id) => set({ currentConversationId: id }),
  setNewSession: (isNew: boolean) => {
    // 新会话标记时同步清空当前对话锚点，防止 history[0] 兜底串台（症状 6 根因）
    set({ isNewSession: isNew, ...(isNew ? { currentConversationId: null } : {}) })
    if (isNew) set({ activeModels: [], textInserted: false, chatSessionVersion: Date.now() })
  },

  insertTextToAll: async (message: string): Promise<SendResult[]> => {
    const state = get()
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = state
    const isSessionActive = !state.isNewSession || state.textInserted
    const targetModels = isSessionActive && state.activeModels.length > 0
      ? state.activeModels
      : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    if (state.activeModels.length === 0) state.setActiveModels(targetModels)
    const results: SendResult[] = []
    const insertPromises = targetModels.map(async (model, index) => {
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        const result = await webviewRef.insertText(message)
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const insertResults = await Promise.all(insertPromises)
    results.push(...insertResults)
    const successCount = results.filter((r) => r.success).length
    set({ textInserted: successCount > 0 })
    return results
  },

  clearInputToAll: async (): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const results: SendResult[] = []
    const clearPromises = displayedModels.map(async (model, index) => {
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        const result = await webviewRef.clearInput()
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const clearResults = await Promise.all(clearPromises)
    results.push(...clearResults)
    set({ textInserted: false })
    return results
  },

  beginConversation: async ({ successModelIds, currentUrls, productMode, displayMode }) => {
    const state = get()
    const { addHistory, updateHistory, history, isNewSession, setNewSession } = state

    // 续写判定基准：按 currentConversationId 查找当前对话，而非 history[0]。
    const lastItem = state.currentConversationId
      ? history.find(h => h.id === state.currentConversationId) ?? null
      : null
    const isNewConv = shouldStartNewConversation(
      currentUrls,
      lastItem?.urls,
      isNewSession
    )

    if (isNewConv) {
      const conversationId = crypto.randomUUID()
      const newItem: HistoryItem = {
        id: conversationId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        models: successModelIds,
        turns: [],
        urls: currentUrls,
        productMode,
        displayMode,
      }
      addHistory(newItem)
      setNewSession(false)
      set({ currentConversationId: conversationId })
      return { conversationId, isNew: true, lastItem: null }
    }

    const conversationId = lastItem!.id
    const updatedUrls = { ...lastItem!.urls, ...currentUrls }
    updateHistory(conversationId, {
      urls: updatedUrls,
      updatedAt: Date.now(),
    })
    set({ currentConversationId: conversationId })
    return { conversationId, isNew: false, lastItem }
  },

  sendMessageToAll: async (message: string): Promise<SendResult[]> => {
    const state = get()
    const { models, webviewRefs, updateHistory, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = state
    set({ isSending: true, lastSendResults: [] })
    const isSessionActive = !state.isNewSession || state.textInserted
    const targetModels = isSessionActive && state.activeModels.length > 0
      ? state.activeModels
      : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    if (state.activeModels.length === 0) state.setActiveModels(targetModels)
    const results: SendResult[] = []
    const sendPromises = targetModels.map(async (model, index) => {
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        const result = await webviewRef.sendMessage(message)
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const sendResults = await Promise.all(sendPromises)
    results.push(...sendResults)
    const successModels = Array.from(new Set(sendResults.filter((r) => r.success).map((r) => r.modelId)))

    if (successModels.length > 0) {
      // 立即获取当前各平台 URL（用于判定新/旧对话）
      const currentUrls: Record<string, string> = {}
      await Promise.all(
        successModels.map(async (modelId) => {
          const ref = webviewRefs.get(modelId)
          if (!ref) return
          try {
            const url = ref.getCurrentUrl()
            if (url && url !== 'about:blank') {
              currentUrls[modelId] = url
            }
          } catch {
            // 忽略获取失败
          }
        })
      )

      // 共享原语：判定新/旧对话 + 写历史头部
      const { conversationId } = await get().beginConversation({
        successModelIds: successModels,
        currentUrls,
        productMode,
        displayMode,
      })

      // 创建新 turn 并启动监控
      const turnId = `${conversationId}-${crypto.randomUUID()}`
      get().startMonitoring(conversationId, turnId, message, successModels)

      ;(async () => {
        await sleep(5000)
        const { webviewRefs: currentRefs } = get()
        const urls: Record<string, string> = {}

        await Promise.all(
          successModels.map(async (modelId) => {
            const ref = currentRefs.get(modelId)
            if (!ref) return
            try {
              const savableUrl = await waitForSavableUrl(modelId, ref)
              if (savableUrl) urls[modelId] = savableUrl
            } catch (error) {
              console.error(`获取模型 ${modelId} 的 URL 失败:`, error)
            }
          })
        )

        if (Object.keys(urls).length > 0) {
          updateHistory(conversationId, { urls })
        }
      })().catch((error) => console.error('异步获取 URL 失败:', error))
    }

    set({ isSending: false, lastSendResults: results })
    return results
  },

  sendToSlot: async (slotIndex, message) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return { success: false, error: `slot-${slotIndex} 未注册` }
    try {
      const r = await ref.sendMessage(message)
      return { success: r.success, error: r.error }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  insertTextToSlot: async (slotIndex, message) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return { success: false, error: `slot-${slotIndex} 未注册` }
    try {
      const r = await ref.insertText(message)
      return { success: r.success, error: r.error }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  getResponseFromSlot: async (slotIndex, timeoutMs = 120000, baseline) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return ''
    const base = (baseline ?? '').trim()
    const deadline = Date.now() + timeoutMs
    const pollInterval = 500
    const stableThreshold = 3 // 连续 3 次相同 ≈ 1.5s 无变化
    let last = ''
    let stableCount = 0
    while (Date.now() < deadline) {
      const cur = (await ref.getLatestResponse().catch(() => '')).trim()
      // 仅当 cur 非空且与基线不同才视为新回复候选，避免把上一轮旧回复（或瞬时空值）
      // 误判为新回复。基线为空时要求 cur 非空；基线为旧回复时 cur===base 不计入稳定。
      if (cur && cur !== base) {
        if (cur === last) {
          stableCount++
          if (stableCount >= stableThreshold) return cur
        } else {
          stableCount = 0
        }
      } else {
        // cur 为空或等于基线：尚未出现新回复，重置稳定计数继续等
        stableCount = 0
      }
      last = cur
      await new Promise((r) => setTimeout(r, pollInterval))
    }
    // 超时：到 deadline 仍未出现「不同于基线且稳定」的新回复 → 一律返回空，交由调用方中止
    return ''
  },
  clearInputOfSlot: async (slotIndex) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (ref) await ref.clearInput().catch(() => {})
  },

  getAllResponses: async (options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<Record<string, string>> => {
    const state = get()
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = state
    const responses: Record<string, string> = {}
    const isSessionActive = !state.isNewSession || state.textInserted
    const targetModels = isSessionActive && state.activeModels.length > 0
      ? state.activeModels
      : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const timeoutMs = options?.timeoutMs ?? 10000
    const signal = options?.signal

    await Promise.all(
      targetModels.map(async (model) => {
        if (signal?.aborted) return
        const webviewRef = webviewRefs.get(model.id)
        if (webviewRef) {
          try {
            const fetchPromise = webviewRef.getLatestResponse()
            const timeoutPromise = new Promise<string>((_, reject) => {
              const timer = setTimeout(() => reject(new Error(`获取 ${model.name} 回复超时`)), timeoutMs)
              if (signal) {
                const abortHandler = () => {
                  clearTimeout(timer)
                  reject(new Error('已取消获取'))
                }
                signal.addEventListener('abort', abortHandler, { once: true })
              }
            })
            const response = await Promise.race([fetchPromise, timeoutPromise])
            if (!signal?.aborted && response) {
              responses[model.id] = response
            }
          } catch (error) {
            if (!signal?.aborted) {
              console.error(`获取 ${model.name} 回复失败或超时:`, error)
            }
          }
        }
      })
    )
    return responses
  },

  isUploading: false,
  uploadProgress: {},

  uploadFileToAll: async (fileData: FileUploadData): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const results: SendResult[] = []
    const initialProgress: Record<string, 'pending' | 'uploading' | 'success' | 'error'> = {}
    displayedModels.forEach((model) => { initialProgress[model.id] = 'pending' })
    set({ isUploading: true, uploadProgress: initialProgress })
    const uploadPromises = displayedModels.map(async (model, index) => {
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        set((state) => ({ uploadProgress: { ...state.uploadProgress, [model.id]: 'uploading' } }))
        const result = await webviewRef.uploadFile(fileData)
        set((state) => ({ uploadProgress: { ...state.uploadProgress, [model.id]: result.success ? 'success' : 'error' } }))
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        set((state) => ({ uploadProgress: { ...state.uploadProgress, [model.id]: 'error' } }))
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const uploadResults = await Promise.all(uploadPromises)
    results.push(...uploadResults)
    set({ isUploading: false })
    return results
  },

  isDeepResearch: false,
  setDeepResearch: (enabled: boolean) => set({ isDeepResearch: enabled }),

  enableDeepResearchForAll: async (): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const results: SendResult[] = []
    const enablePromises = displayedModels.map(async (model, index) => {
      if (!DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)) {
        return { modelId: model.id, success: false, error: DEEP_RESEARCH_UNSUPPORTED_ERROR }
      }
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        const result = await webviewRef.enableDeepResearch()
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const enableResults = await Promise.all(enablePromises)
    results.push(...enableResults)
    return results
  },

  disableDeepResearchForAll: async (): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const results: SendResult[] = []
    const disablePromises = displayedModels.map(async (model, index) => {
      if (!DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)) {
        return { modelId: model.id, success: false, error: DEEP_RESEARCH_UNSUPPORTED_ERROR }
      }
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        const result = await webviewRef.disableDeepResearch()
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const disableResults = await Promise.all(disablePromises)
    results.push(...disableResults)
    return results
  },

  isImageGeneration: false,
  setImageGeneration: (enabled: boolean) => set({ isImageGeneration: enabled }),

  enableImageGenerationForAll: async (): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const results: SendResult[] = []
    const enablePromises = displayedModels.map(async (model, index) => {
      if (!IMAGE_GENERATION_SUPPORTED_MODEL_IDS.has(model.id)) {
        return { modelId: model.id, success: false, error: IMAGE_GENERATION_UNSUPPORTED_ERROR }
      }
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        const result = await webviewRef.enableImageGeneration()
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const enableResults = await Promise.all(enablePromises)
    results.push(...enableResults)
    return results
  },

  disableImageGenerationForAll: async (): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const results: SendResult[] = []
    const disablePromises = displayedModels.map(async (model, index) => {
      if (!IMAGE_GENERATION_SUPPORTED_MODEL_IDS.has(model.id)) {
        return { modelId: model.id, success: false, error: IMAGE_GENERATION_UNSUPPORTED_ERROR }
      }
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, success: false, error: 'Webview 未注册' }
      try {
        const result = await webviewRef.disableImageGeneration()
        return { modelId: model.id, success: result.success, error: result.error }
      } catch (error) {
        return { modelId: model.id, success: false, error: String(error) }
      }
    })
    const disableResults = await Promise.all(disablePromises)
    results.push(...disableResults)
    return results
  },

  extractImagesFromAll: async (): Promise<ExtractImagesResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const extractPromises = displayedModels.map(async (model, index) => {
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, wcId: null, images: [], error: 'Webview 未注册' }
      try {
        const result = await webviewRef.extractGeneratedImages()
        return { modelId: model.id, wcId: result.wcId, images: result.images, error: result.error }
      } catch (error) {
        return { modelId: model.id, wcId: null, images: [], error: String(error) }
      }
    })
    return Promise.all(extractPromises)
  },


  currentPage: 'main',
  setCurrentPage: (page: 'main' | 'summary' | 'quick' | 'diagnostics') => set({ currentPage: page }),

  isSettingsOpen: false,
  setSettingsOpen: (open: boolean) => set({ isSettingsOpen: open }),
  isHistoryOpen: false,
  setHistoryOpen: (open: boolean) => set({ isHistoryOpen: open }),

  pendingSummarySession: null,
  setPendingSummarySession: (data: SummarySessionInit | null) => set({ pendingSummarySession: data }),

  // 自动化 IPC 核心实现（供 CLI 驱动场景使用，不影响 UI Webview 发送路径）
  automationSendPrompt: async (platformId: string, prompt: string, collectDelayMs?: number): Promise<{ success: boolean; data?: string; error?: string }> => {
    if (!window.api?.automationSendPrompt) {
      return { success: false, error: 'automationSendPrompt IPC 未就绪' }
    }
    return window.api.automationSendPrompt(platformId, prompt, collectDelayMs)
  },

  automationCollect: async (platformId: string): Promise<{ success: boolean; data?: string; error?: string }> => {
    if (!window.api?.automationCollect) {
      return { success: false, error: 'automationCollect IPC 未就绪' }
    }
    return window.api.automationCollect(platformId)
  },


  // 监控状态（不持久化）
  monitor: {
    isMonitoring: false,
    currentConversationId: null,
    currentTurn: null,
    intervalId: null,
    startTime: 0,
  },

  startMonitoring: (conversationId: string, turnId: string, userMessage: string, models: string[]) => {
    const { monitor } = get()

    // 如果已有轮询器在运行，先停止并兜底写上一轮
    // stopMonitoring 读取的是旧 monitor.currentConversationId（指向旧会话），
    // 在下方 set 新 turn 之前调用，故能正确定位旧 historyItem 落盘
    if (monitor.intervalId) {
      get().stopMonitoring()
    }

    // 初始化各平台监控状态
    const platforms: Record<string, PlatformMonitorState> = {}
    for (const modelId of models) {
      platforms[modelId] = {
        lastContent: '',
        stableCount: 0,
        isComplete: false,
      }
    }

    const turnMonitor: TurnMonitor = {
      turnId,
      userMessage,
      platforms,
    }

    // 启动轮询
    const intervalId = setInterval(() => {
      get().pollPlatforms()
    }, MONITOR_CONFIG.pollIntervalMs)

    set({
      monitor: {
        isMonitoring: true,
        currentConversationId: conversationId,
        currentTurn: turnMonitor,
        intervalId,
        startTime: Date.now(),
      },
      // 持久态锚点与监控态同步：监控结束后 monitor.currentConversationId 会清空，
      // 但本字段保留，供后续"当前对话"查询（替代 history[0] 兜底）
      currentConversationId: conversationId,
    })
  },

  stopMonitoring: () => {
    const { monitor } = get()
    if (monitor.intervalId) {
      clearInterval(monitor.intervalId)
    }
    // 兜底：停止前补写一次当前 turn，防止最后一次内容变化未落盘
    // 必须在 set 重置 currentTurn=null 之前调用；saveCurrentTurn 对 currentTurn 为 null 时安全 early return
    // forceFlush=true：停止/中止时绕过节流立即落盘，不丢数据
    get().saveCurrentTurn(true)
    set({
      monitor: {
        isMonitoring: false,
        currentConversationId: null,
        currentTurn: null,
        intervalId: null,
        startTime: 0,
      },
    })
  },

  pollPlatforms: async () => {
    const { monitor, webviewRefs, models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    if (!monitor.isMonitoring || !monitor.currentTurn) return

    // 超时检测：统一收口到 stopMonitoring（其内部已兜底写），避免双写
    if (Date.now() - monitor.startTime > MONITOR_CONFIG.maxMonitorDurationMs) {
      get().stopMonitoring()
      return
    }

    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    let allComplete = true
    let anyChanged = false // 脏标记：本轮是否有平台内容/完成态变化

    for (let index = 0; index < displayedModels.length; index++) {
      const model = displayedModels[index]
      const state = monitor.currentTurn.platforms[model.id]
      if (!state || state.isComplete) continue

      const ref = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!ref) {
        state.isComplete = true
        anyChanged = true // 完成态翻转也视为变化，需落盘
        continue
      }

      try {
        const content = await ref.getLatestResponse()

        if (content !== state.lastContent) {
          state.lastContent = content
          state.stableCount = 0
          anyChanged = true
        } else {
          state.stableCount++
          if (state.stableCount >= MONITOR_CONFIG.stableThreshold) {
            state.isComplete = true
            anyChanged = true // 完成态翻转也视为变化，需落盘
          }
        }
      } catch {
        // 获取失败，不影响其他平台，继续轮询
      }

      if (!state.isComplete) {
        allComplete = false
      }
    }

    // 仅本轮有内容/完成态变化时才落盘，稳定等待期跳过冗余全量写
    if (anyChanged) {
      get().saveCurrentTurn()
    }

    if (allComplete) {
      get().saveCurrentTurn(true) // 完成时显式写终态，保证最后一帧落盘
      get().stopMonitoring()
    }
  },

  updatePlatformAnswer: (modelId: string, text: string, isComplete?: boolean) => {
    const { monitor, saveCurrentTurn } = get()
    if (!monitor.isMonitoring || !monitor.currentTurn) return
    const platform = monitor.currentTurn.platforms[modelId]
    if (!platform) return

    set({
      monitor: {
        ...monitor,
        currentTurn: {
          ...monitor.currentTurn,
          platforms: {
            ...monitor.currentTurn.platforms,
            [modelId]: {
              ...platform,
              lastContent: text,
              isComplete: isComplete ?? platform.isComplete,
              stableCount: 0 // Reset stable count since it just updated via network
            }
          }
        }
      }
    })
    saveCurrentTurn()
  },

  saveCurrentTurn: (forceFlush) => {
    const { monitor, history } = get()
    if (!monitor.currentTurn || !monitor.currentConversationId) return

    const { currentConversationId, currentTurn } = monitor
    const historyItem = history.find(h => h.id === currentConversationId)
    if (!historyItem) return

    // 构建 responses（只包含有内容的平台）
    const responses: Record<string, string> = {}
    for (const [modelId, state] of Object.entries(currentTurn.platforms)) {
      if (state.lastContent) {
        responses[modelId] = state.lastContent
      }
    }

    // 查找是否已有同 turn
    const existingTurnIndex = historyItem.turns.findIndex(
      t => t.turnId === currentTurn.turnId
    )

    const turn: ConversationTurn = {
      turnId: currentTurn.turnId,
      userMessage: currentTurn.userMessage,
      timestamp: Date.now(),
      responses,
    }

    const newTurns = existingTurnIndex >= 0
      ? historyItem.turns.map((t, i) => (i === existingTurnIndex ? turn : t))
      : [...historyItem.turns, turn]

    const updatedItem: HistoryItem = {
      ...historyItem,
      turns: newTurns,
      updatedAt: Date.now(),
    }

    const newHistory = history.map(h =>
      h.id === currentConversationId ? updatedItem : h
    )

    // 内存始终更新（UI 需要实时反映最新内容）
    set({ history: newHistory })

    // 节流写盘：流式中每 10s 落盘一次；forceFlush=true（监控结束/中止/完成）时立即写
    const now = Date.now()
    const shouldPersist = forceFlush || (now - historyPersistLastTs >= HISTORY_PERSIST_MIN_INTERVAL)
    if (shouldPersist && window.api?.storeSet) {
      window.api.storeSet('history', newHistory)
      historyPersistLastTs = now
    }
  },

  registerDiagnosticsRelay: () => {
    const offProbe = window.api.onDiagnosticsProbeRequest(async ({ reqId, modelId, type, options }) => {
      const { webviewRefs } = get()
      const ref = webviewRefs.get(modelId)
      let result: unknown
      if (!ref) {
        result = { ok: false, error: '平台未加载' }
      } else {
        try {
          if (type === 'message') {
            result = await ref.probeMessageContainer()
          } else if (type === 'research') {
            result = await ref.probeResearchMode()
          } else {
            // type === 'pick'：进入检拾模式，options 透传给 picker（缺省 ancestorDepth:8 / childDepth:3）
            result = await ref.probeDomStructure('pick', options)
          }
        } catch (error) {
          result = { ok: false, error: String(error) }
        }
      }
      window.api.diagnosticsProbeResponse(reqId, result)
    })
    const offRun = window.api.onDiagnosticsRunResearchRequest(async ({ reqId, modelId }) => {
      const { webviewRefs } = get()
      const ref = webviewRefs.get(modelId)
      let result: { success: boolean; error?: string }
      if (!ref) {
        result = { success: false, error: '平台未加载' }
      } else {
        try {
          result = await ref.enableDeepResearch()
        } catch (error) {
          result = { success: false, error: String(error) }
        }
      }
      window.api.diagnosticsRunResearchResponse(reqId, result)
    })
    return () => { offProbe(); offRun() }
  },
}))

// 初始化：从本地存储加载配置
export async function initializeStore(): Promise<void> {
  if (typeof window === 'undefined' || !window.api) return

  try {
    const refreshSummaryPromptsFromDisk = async (): Promise<void> => {
      if (!window.api?.summaryPromptsList) return
      const prompts = await window.api.summaryPromptsList() as SummaryPrompt[]
      const currentApiConfig = useAppStore.getState().apiConfig
      useAppStore.setState({ apiConfig: { ...currentApiConfig, summaryPrompts: prompts } })
    }

    const storedDisplayMode = await window.api.storeGet('displayMode') as DisplayMode | undefined
    const storedMultiAiDisplayMode = await window.api.storeGet('multiAiDisplayMode') as DisplayMode | undefined
    const storedTaskAssignmentDisplayMode = await window.api.storeGet('taskAssignmentDisplayMode') as DisplayMode | undefined
    const storedProductMode = await window.api.storeGet('productMode') as ProductMode | undefined
    const storedTaskAssignmentSlots = await window.api.storeGet('taskAssignmentSlots') as string[] | undefined
    const storedMultiAiSlots = await window.api.storeGet('multiAiSlots') as string[] | undefined
    const storedDebateSlots = await window.api.storeGet('debateSlots') as [string, string] | undefined

    let initialDisplayMode = storedDisplayMode || useAppStore.getState().displayMode
    if (storedProductMode === 'task_assignment' && initialDisplayMode === 'one') {
      initialDisplayMode = 'two'
    } else if (storedProductMode === 'debate') {
      initialDisplayMode = 'two'
    }

    if (storedProductMode) useAppStore.setState({ productMode: storedProductMode })
    if (initialDisplayMode) useAppStore.setState({ displayMode: initialDisplayMode })
    if (storedMultiAiDisplayMode) useAppStore.setState({ multiAiDisplayMode: storedMultiAiDisplayMode })
    if (storedTaskAssignmentDisplayMode) useAppStore.setState({ taskAssignmentDisplayMode: storedTaskAssignmentDisplayMode })
    if (storedTaskAssignmentSlots && Array.isArray(storedTaskAssignmentSlots)) {
      useAppStore.setState({ taskAssignmentSlots: storedTaskAssignmentSlots })
    }
    if (storedMultiAiSlots && Array.isArray(storedMultiAiSlots)) {
      useAppStore.setState({ multiAiSlots: storedMultiAiSlots })
    }
    if (storedDebateSlots && Array.isArray(storedDebateSlots) && storedDebateSlots.length === 2) {
      useAppStore.setState({ debateSlots: storedDebateSlots as [string, string] })
    }

    const storedApiConfig = await window.api.storeGet('apiConfig') as any
    const seedSummaryPrompts = (storedApiConfig?.summaryPrompts && Array.isArray(storedApiConfig.summaryPrompts) && storedApiConfig.summaryPrompts.length > 0)
      ? storedApiConfig.summaryPrompts
      : defaultSummaryPrompts
    if (storedApiConfig) {
      if (!storedApiConfig.providers) {
        // 迁移旧版配置：如果没有 providers，创建一个默认的
        const providers: ApiProvider[] = []
        let activeProviderId = undefined

        if (storedApiConfig.apiKey) {
          const defaultProviderId = 'migrated-default'
          providers.push({
            id: defaultProviderId,
            name: '已迁移供应商',
            baseUrl: storedApiConfig.baseUrl || 'https://api.openai.com/v1',
            apiKey: storedApiConfig.apiKey,
            enabled: true
          })
          activeProviderId = defaultProviderId
        }

        const migratedConfig: ApiConfig = {
          providers: providers,
          activeProviderId: activeProviderId,
          summaryPrompts: defaultSummaryPrompts,
          exportDirectory: storedApiConfig.exportDirectory,
          systemPrompt: storedApiConfig.systemPrompt
        }
        useAppStore.setState({ apiConfig: migratedConfig })
        if (window.api?.storeSet) {
          const { summaryPrompts: _summaryPrompts, ...persisted } = migratedConfig as any
          window.api.storeSet('apiConfig', persisted)
        }
      } else {
        // 确保 summaryPrompts 存在，如果不存在则使用默认值
        const apiConfig = storedApiConfig as ApiConfig
        const migratedConfig: ApiConfig = { ...apiConfig, summaryPrompts: defaultSummaryPrompts }
        useAppStore.setState({ apiConfig: migratedConfig })
        if (window.api?.storeSet) {
          const { summaryPrompts: _summaryPrompts, ...persisted } = migratedConfig as any
          window.api.storeSet('apiConfig', persisted)
        }
      }
    }

    if (window.api?.summaryPromptsBootstrap) {
      await window.api.summaryPromptsBootstrap(seedSummaryPrompts)
      await refreshSummaryPromptsFromDisk()
      if (window.api?.onSummaryPromptsChanged) {
        window.api.onSummaryPromptsChanged(() => {
          refreshSummaryPromptsFromDisk().catch(() => { })
        })
      }
    }

    const storedHistory = await window.api.storeGet('history') as any[] | undefined
    if (storedHistory && storedHistory.length > 0) {
      // 检测是否为旧格式并迁移
      const isOldFormat = storedHistory.some(
        (item) => item && typeof item.message === 'string' && !Array.isArray(item.turns)
      )

      if (isOldFormat) {
        const migratedHistory: HistoryItem[] = storedHistory.map((old: any) => ({
          id: old.id || Date.now().toString(),
          createdAt: old.timestamp || Date.now(),
          updatedAt: old.timestamp || Date.now(),
          models: old.models || [],
          turns: [
            {
              turnId: `${old.id || Date.now()}-0`,
              userMessage: old.message || '',
              timestamp: old.timestamp || Date.now(),
              responses: old.responses || {},
            },
          ],
          urls: old.urls,
        })).slice(0, 100)
        useAppStore.setState({ history: migratedHistory, historyLoadedCount: migratedHistory.length })
        // 立即持久化新格式
        window.api?.storeSet('history', migratedHistory)
        console.log('[Store] History migrated from old format to turns-based format')
      } else {
        // 内存热区上限 100；磁盘上限 1000 由 store-set handler 的 enforceDiskLimit 兜底，启动不再回写裁剪磁盘。
        const hotHistory = (storedHistory as HistoryItem[]).slice(0, 100)
        useAppStore.setState({ history: hotHistory, historyLoadedCount: hotHistory.length })
      }
    }

    // 读取磁盘历史总量（用于"加载更多"按钮可见性）
    const historyCountResult = await window.api.historyGetTotalCount()
    if (historyCountResult.success && historyCountResult.data !== undefined) {
      useAppStore.setState({ historyTotalCount: historyCountResult.data })
    }

    const storedSummaryHistory = await window.api.storeGet('summaryHistory') as SummaryHistoryItem[] | undefined
    if (storedSummaryHistory) {
      // 内存热区上限 100；磁盘上限 1000 由 store-set handler 兜底，启动不再回写裁剪磁盘。
      const hotSummary = storedSummaryHistory.slice(0, 100)
      useAppStore.setState({ summaryHistory: hotSummary, summaryHistoryLoadedCount: hotSummary.length })
    }

    // 读取磁盘总结历史总量
    const summaryCountResult = await window.api.summaryHistoryGetTotalCount()
    if (summaryCountResult.success && summaryCountResult.data !== undefined) {
      useAppStore.setState({ summaryHistoryTotalCount: summaryCountResult.data })
    }

    const storedSummaryModels = await window.api.storeGet('summaryModels') as SummaryModel[] | undefined
    if (storedSummaryModels) useAppStore.setState({ summaryModels: storedSummaryModels })

    // 同时加载 storedModels 和 geminiAccountUrl，合并成一次 setState
    // 避免两次 setState({ models }) 导致 webview src 中途变化而白屏
    const [storedModels, geminiAccountUrl] = await Promise.all([
      window.api.storeGet('models') as Promise<ModelConfig[] | undefined>,
      window.api.storeGet('geminiAccountUrl') as Promise<string | undefined>
    ])

    let finalModels: ModelConfig[] | null = null
    if (storedModels) {
      const mergedModels: ModelConfig[] = []
      const storedModelMap = new Map(storedModels.map(m => [m.id, m]))
      // 强制使用 defaultModels 的顺序，只从 storedModels 继承 enabled 等持久化状态
      defaultModels.forEach(defaultModel => {
        const storedModel = storedModelMap.get(defaultModel.id)
        if (storedModel) {
          mergedModels.push({ ...defaultModel, enabled: storedModel.enabled })
        } else {
          mergedModels.push(defaultModel)
        }
      })
      finalModels = mergedModels
    }

    // 将 Gemini 账号 URL 合并到同一批 models 中
    if (geminiAccountUrl) {
      console.log('[AppStore] 加载保存的 Gemini 账号 URL:', geminiAccountUrl)
      const base = finalModels ?? defaultModels
      finalModels = base.map(m =>
        m.id === 'gemini' ? { ...m, url: geminiAccountUrl } : m
      )
    }

    // 一次性 setState，避免 webview src 中途变化
    if (finalModels) {
      useAppStore.setState({ models: finalModels })
    }

    if (window.api?.onGeminiAccountSwitched) {
      window.api.onGeminiAccountSwitched((url: string) => {
        console.log('[AppStore] 收到 Gemini 账号切换通知，保存 URL:', url)
        // 保存到持久化存储
        if (window.api?.storeSet) {
          window.api.storeSet('geminiAccountUrl', url)
        }
        // 更新当前模型配置
        const currentModels = useAppStore.getState().models
        const updatedModels = currentModels.map(m =>
          m.id === 'gemini' ? { ...m, url } : m
        )
        useAppStore.setState({ models: updatedModels })
      })
    }
  } catch (error) {
    console.error('初始化 store 失败:', error)
  }
}

// 跨窗口状态同步
let isApplyingRemote = false
if (typeof window !== 'undefined') {
  useAppStore.subscribe((state, prevState) => {
    if (isApplyingRemote) return
    if (!window.api?.stateSync) return
    const keysToSync: (keyof typeof state)[] = ['activeModels', 'currentModelId']
    const diff: Record<string, unknown> = {}
    let changed = false
    for (const k of keysToSync) {
      if (state[k] !== prevState[k]) {
        diff[k] = state[k]
        changed = true
      }
    }
    if (changed) {
      window.api.stateSync(diff)
    }
  })

  // 延迟监听，确保 api 就绪
  setTimeout(() => {
    if (window.api?.onStateChangedRemote) {
      window.api.onStateChangedRemote((remoteDiff) => {
        isApplyingRemote = true
        useAppStore.setState(remoteDiff)
        isApplyingRemote = false
      })
    }
  }, 100)
}
