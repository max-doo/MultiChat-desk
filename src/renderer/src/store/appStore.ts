import { create } from 'zustand'
import type { WebviewCardRef, FileUploadData } from '../components/WebviewCard'
import synthesizerPrompt from './agent-prompts-defaults/综合最佳.md?raw'
import criticPrompt from './agent-prompts-defaults/裁判找茬.md?raw'
import academicPrompt from './agent-prompts-defaults/学术分析.md?raw'
import brainstormPrompt from './agent-prompts-defaults/创意发散.md?raw'
import debatePrompt from './agent-prompts-defaults/辩论对决.md?raw'
import practicalPrompt from './agent-prompts-defaults/实践指南.md?raw'

// 监控配置常量
const MONITOR_CONFIG = {
  pollIntervalMs: 3000,                 // 每 3 秒轮询一次
  stableThreshold: 3,                   // 连续 3 次不变即判定完成（约 9 秒）
  maxMonitorDurationMs: 5 * 60 * 1000,  // 最长监控 5 分钟（防死等）
}

// 模型配置类型
export interface ModelConfig {
  id: string
  name: string
  url: string
  logo: string
  enabled: boolean
}

// Agent 提示词配置类型
export interface AgentPrompt {
  id: string
  name: string
  description?: string
  prompt: string
  isDefault?: boolean  // 是否为系统预设
}

// API 供应商配置
export interface ApiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  validated?: boolean // 是否校验通过
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
  agentPrompts?: AgentPrompt[] // 用户配置的 Agent 提示词
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
  /** 主界面对话时各模型的 URL（用于追溯原始对话） */
  urls?: Record<string, string>
}

/** 从主界面导航到总结页时携带的一次性初始化数据 */
export interface SummarySessionInit {
  modelResponses: Record<string, string>
  urls?: Record<string, string>
  sourceHistoryId?: string
  timestamp: number
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
  unregisterWebviewRef: (id: string) => void

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

  // 发送消息到所有启用的模型（从已输入的文本发送）
  sendMessageToAll: (message: string) => Promise<SendResult[]>

  // 获取所有模型的最新回复
  getAllResponses: (options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<Record<string, string>>

  // 监控状态（不持久化）
  monitor: MonitorState
  startMonitoring: (conversationId: string, turnId: string, userMessage: string, models: string[]) => void
  stopMonitoring: () => void
  pollPlatforms: () => Promise<void>
  saveCurrentTurn: () => void

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

  // 会话状态
  isNewSession: boolean
  setNewSession: (isNew: boolean) => void

  // 页面导航状态
  currentPage: 'main' | 'summary' | 'quick'
  setCurrentPage: (page: 'main' | 'summary' | 'quick') => void

  // UI 抽屉状态
  isSettingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  isHistoryOpen: boolean
  setHistoryOpen: (open: boolean) => void

  // 一次性导航数据：从主界面进入总结页时携带，消费后立即清空
  pendingSummarySession: SummarySessionInit | null
  setPendingSummarySession: (data: SummarySessionInit | null) => void
}

/**
 * 根据显示模式和产品运行模式获取要显示的模型列表
 */
export function getDisplayedModels(
  models: ModelConfig[],
  displayMode: DisplayMode,
  productMode?: ProductMode,
  taskAssignmentSlots?: string[],
  multiAiSlots?: string[]
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

// 默认模型配置
const defaultModels: ModelConfig[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', logo: 'https://cdn.oaistatic.com/assets/favicon-o20kmmos.svg', enabled: true },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', logo: 'https://www.gstatic.com/lamda/images/gemini_favicon_f069958c85030456e93de685481c559f160ea06b.png', enabled: true },
  { id: 'grok', name: 'Grok', url: 'https://grok.com', logo: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png/light/grok.png', enabled: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%23d97757"><path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"></path></svg>', enabled: false },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', logo: 'https://cdn-avatars.huggingface.co/v1/production/uploads/64b89bf66b5ee8c38859cbd6/l_27fD52uFMZUXdFdY9fR.png', enabled: false },
  { id: 'arena', name: 'Arena', url: 'https://arena.ai/', logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAAAAABXZoBIAAAAp0lEQVR4AdWSLwjEIBSH7Xm9l/WyaGdlzWIXLphWbOvtFatRLiy/ZjILdjAJ9uod3LG5O1gc7OO1j/eHH4/UE24oM+HsACd572TosMEha8YW7L3b8D2WdudK5WND0rU9KKgIGr5oiCo2EsKAquSU31UUDgEOnRaNpHWaKpUGrQrtTjt2SVi/LN6I1I3PnxBMFOYjo/lLSO9SXyUhcO3m2Wke4K4/dMIL1Ne5UmnGphQAAAAASUVORK5CYII=', enabled: false },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat', logo: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/logo-doubao-overflow.png', enabled: false },
  { id: 'yuanbao', name: '元宝', url: 'https://yuanbao.tencent.com/chat', logo: 'https://cdn-bot.hunyuan.tencent.com/logo.png', enabled: false },
  { id: 'qwen', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen', logo: 'https://img.alicdn.com/imgextra/i3/O1CN01utrBy31Tu1t8oOgUy_!!6000000002441-55-tps-32-32.svg', enabled: false },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/deepseek-color.png', enabled: false },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn', logo: 'https://statics.moonshot.cn/kimi-chat/favicon.ico', enabled: false },
  { id: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail?lang=zh', logo: 'https://chatglm.cn/favicon.ico', enabled: false },
  { id: 'yiyan', name: '文心一言', url: 'https://chat.baidu.com/', logo: 'https://chat.baidu.com/favicon.ico', enabled: false }
]

export const DEFAULT_MODEL_ORDER = defaultModels.map(m => m.id)

// 默认 Agent 提示词预设
export const defaultAgentPrompts: AgentPrompt[] = [
  {
    id: '1',
    name: '综合最佳',
    description: '综合多模型共识与差异，输出最佳答案。',
    isDefault: true,
    prompt: synthesizerPrompt
  },
  {
    id: '2',
    name: '裁判找茬',
    description: '审查错误与漏洞，提炼最可靠信息与改进建议。',
    isDefault: true,
    prompt: criticPrompt
  },
  {
    id: '3',
    name: '学术分析',
    description: '以学术方式评估来源、方法论、证据强度，并给出总结与延伸阅读。',
    isDefault: true,
    prompt: academicPrompt
  },
  {
    id: '4',
    name: '创意发散',
    description: '基于回答进行头脑风暴，拓展场景与创新方案。',
    isDefault: true,
    prompt: brainstormPrompt
  },
  {
    id: '5',
    name: '辩论对决',
    description: '把回答当作辩手观点，评分论证强度并给出裁决。',
    isDefault: true,
    prompt: debatePrompt
  },
  {
    id: '6',
    name: '实践指南',
    description: '提炼可执行行动点，给出步骤、障碍与成功标准。',
    isDefault: true,
    prompt: practicalPrompt
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
  unregisterWebviewRef: (id) => get().webviewRefs.delete(id),

  apiConfig: {
    providers: defaultProviders,
    activeProviderId: undefined,
    agentPrompts: defaultAgentPrompts
  },
  setApiConfig: (config) => {
    set({ apiConfig: config })
    if (window.api?.storeSet) {
      const { agentPrompts: _agentPrompts, ...persisted } = (config || {}) as any
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
    const newHistory = [item, ...state.history].slice(0, 1000)
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
    return { history: newHistory }
  }),
  removeHistories: (ids: string[]) => set((state) => {
    const newHistory = state.history.filter(item => !ids.includes(item.id))
    if (window.api?.storeSet) window.api.storeSet('history', newHistory)
    return { history: newHistory }
  }),

  summaryHistory: [],
  addSummaryHistory: (item) => set((state) => {
    const newHistory = [item, ...state.summaryHistory].slice(0, 1000)
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

  isSending: false,
  lastSendResults: [],
  textInserted: false,
  setTextInserted: (inserted: boolean) => set({ textInserted: inserted }),
  activeModels: [],
  setActiveModels: (models: ModelConfig[]) => set({ activeModels: models }),
  isNewSession: true,
  setNewSession: (isNew: boolean) => {
    set({ isNewSession: isNew })
    if (isNew) set({ activeModels: [], textInserted: false })
  },

  insertTextToAll: async (message: string): Promise<SendResult[]> => {
    const state = get()
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = state
    const isSessionActive = !state.isNewSession || state.textInserted
    const targetModels = isSessionActive && state.activeModels.length > 0
      ? state.activeModels
      : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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

  sendMessageToAll: async (message: string): Promise<SendResult[]> => {
    const state = get()
    const { models, webviewRefs, addHistory, updateHistory, history, isNewSession, setNewSession, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = state
    set({ isSending: true, lastSendResults: [] })
    const isSessionActive = !state.isNewSession || state.textInserted
    const targetModels = isSessionActive && state.activeModels.length > 0
      ? state.activeModels
      : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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

      const lastItem = history.length > 0 ? history[0] : null
      const isNewConv = shouldStartNewConversation(
        currentUrls,
        lastItem?.urls,
        isNewSession
      )

      let conversationId: string

      if (isNewConv) {
        // 新对话
        conversationId = Date.now().toString()
        const newItem: HistoryItem = {
          id: conversationId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          models: successModels,
          turns: [],
          urls: currentUrls,
          productMode,
          displayMode,
        }
        addHistory(newItem)
        setNewSession(false)
      } else {
        // 继续现有对话
        conversationId = lastItem!.id
        const updatedUrls = { ...lastItem!.urls, ...currentUrls }
        updateHistory(conversationId, {
          urls: updatedUrls,
          updatedAt: Date.now(),
        })
      }

      // 创建新 turn 并启动监控
      const turnId = `${conversationId}-${Date.now()}`
      get().startMonitoring(conversationId, turnId, message, successModels)

      // 异步获取可保存的 URL（兼容现有 Gemini URL 处理逻辑）
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

      const waitForSavableUrl = async (modelId: string, ref: WebviewCardRef): Promise<string> => {
        const timeoutMs = modelId === 'gemini' ? 30000 : 10000
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const currentUrl = ref.getCurrentUrl()
          if (currentUrl && currentUrl !== 'about:blank') {
            if (modelId === 'gemini') {
              if (isGeminiConversationUrl(currentUrl)) {
                return normalizeGeminiConversationUrl(currentUrl) || currentUrl
              }
            } else {
              return currentUrl
            }
          }
          await sleep(1000)
        }
        return ''
      }

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

  getAllResponses: async (options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<Record<string, string>> => {
    const state = get()
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = state
    const responses: Record<string, string> = {}
    const isSessionActive = !state.isNewSession || state.textInserted
    const targetModels = isSessionActive && state.activeModels.length > 0
      ? state.activeModels
      : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
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


  currentPage: 'main',
  setCurrentPage: (page: 'main' | 'summary' | 'quick') => set({ currentPage: page }),

  isSettingsOpen: false,
  setSettingsOpen: (open: boolean) => set({ isSettingsOpen: open }),
  isHistoryOpen: false,
  setHistoryOpen: (open: boolean) => set({ isHistoryOpen: open }),

  pendingSummarySession: null,
  setPendingSummarySession: (data: SummarySessionInit | null) => set({ pendingSummarySession: data }),

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

    // 如果已有轮询器在运行，先停止
    if (monitor.intervalId) {
      clearInterval(monitor.intervalId)
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
    })
  },

  stopMonitoring: () => {
    const { monitor } = get()
    if (monitor.intervalId) {
      clearInterval(monitor.intervalId)
    }
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
    const { monitor, webviewRefs, models, displayMode, productMode, taskAssignmentSlots, multiAiSlots } = get()
    if (!monitor.isMonitoring || !monitor.currentTurn) return

    // 超时检测
    if (Date.now() - monitor.startTime > MONITOR_CONFIG.maxMonitorDurationMs) {
      get().saveCurrentTurn()
      get().stopMonitoring()
      return
    }

    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots)
    let allComplete = true

    for (let index = 0; index < displayedModels.length; index++) {
      const model = displayedModels[index]
      const state = monitor.currentTurn.platforms[model.id]
      if (!state || state.isComplete) continue

      const ref = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!ref) {
        state.isComplete = true
        continue
      }

      try {
        const content = await ref.getLatestResponse()

        if (content !== state.lastContent) {
          state.lastContent = content
          state.stableCount = 0
        } else {
          state.stableCount++
          if (state.stableCount >= MONITOR_CONFIG.stableThreshold) {
            state.isComplete = true
          }
        }
      } catch {
        // 获取失败，不影响其他平台，继续轮询
      }

      if (!state.isComplete) {
        allComplete = false
      }
    }

    // 保存当前进度（即使未全部完成）
    get().saveCurrentTurn()

    if (allComplete) {
      get().stopMonitoring()
    }
  },

  saveCurrentTurn: () => {
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

    set({ history: newHistory })
    if (window.api?.storeSet) {
      window.api.storeSet('history', newHistory)
    }
  },
}))

// 初始化：从本地存储加载配置
export async function initializeStore(): Promise<void> {
  if (typeof window === 'undefined' || !window.api) return

  try {
    const refreshAgentPromptsFromDisk = async (): Promise<void> => {
      if (!window.api?.agentPromptsList) return
      const prompts = await window.api.agentPromptsList() as AgentPrompt[]
      const currentApiConfig = useAppStore.getState().apiConfig
      useAppStore.setState({ apiConfig: { ...currentApiConfig, agentPrompts: prompts } })
    }

    const storedDisplayMode = await window.api.storeGet('displayMode') as DisplayMode | undefined
    const storedMultiAiDisplayMode = await window.api.storeGet('multiAiDisplayMode') as DisplayMode | undefined
    const storedTaskAssignmentDisplayMode = await window.api.storeGet('taskAssignmentDisplayMode') as DisplayMode | undefined
    const storedProductMode = await window.api.storeGet('productMode') as ProductMode | undefined
    const storedTaskAssignmentSlots = await window.api.storeGet('taskAssignmentSlots') as string[] | undefined
    const storedMultiAiSlots = await window.api.storeGet('multiAiSlots') as string[] | undefined

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

    const storedApiConfig = await window.api.storeGet('apiConfig') as any
    const seedAgentPrompts = (storedApiConfig?.agentPrompts && Array.isArray(storedApiConfig.agentPrompts) && storedApiConfig.agentPrompts.length > 0)
      ? storedApiConfig.agentPrompts
      : defaultAgentPrompts
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
          agentPrompts: defaultAgentPrompts,
          exportDirectory: storedApiConfig.exportDirectory,
          systemPrompt: storedApiConfig.systemPrompt
        }
        useAppStore.setState({ apiConfig: migratedConfig })
        if (window.api?.storeSet) {
          const { agentPrompts: _agentPrompts, ...persisted } = migratedConfig as any
          window.api.storeSet('apiConfig', persisted)
        }
      } else {
        // 确保 agentPrompts 存在，如果不存在则使用默认值
        const apiConfig = storedApiConfig as ApiConfig
        const migratedConfig: ApiConfig = { ...apiConfig, agentPrompts: defaultAgentPrompts }
        useAppStore.setState({ apiConfig: migratedConfig })
        if (window.api?.storeSet) {
          const { agentPrompts: _agentPrompts, ...persisted } = migratedConfig as any
          window.api.storeSet('apiConfig', persisted)
        }
      }
    }

    if (window.api?.agentPromptsBootstrap) {
      await window.api.agentPromptsBootstrap(seedAgentPrompts)
      await refreshAgentPromptsFromDisk()
      if (window.api?.onAgentPromptsChanged) {
        window.api.onAgentPromptsChanged(() => {
          refreshAgentPromptsFromDisk().catch(() => { })
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
        }))
        useAppStore.setState({ history: migratedHistory })
        // 立即持久化新格式
        window.api?.storeSet('history', migratedHistory)
        console.log('[Store] History migrated from old format to turns-based format')
      } else {
        useAppStore.setState({ history: storedHistory as HistoryItem[] })
      }
    }

    const storedSummaryHistory = await window.api.storeGet('summaryHistory') as SummaryHistoryItem[] | undefined
    if (storedSummaryHistory) useAppStore.setState({ summaryHistory: storedSummaryHistory })

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
