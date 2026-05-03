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
  turns: ConversationTurn[]
  urls?: Record<string, string>
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
}

// 发送结果类型
export interface SendResult {
  modelId: string
  success: boolean
  error?: string
}

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
  // 显示模式：单列、双列、三列、四窗口（田字格）
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

  // 只输入文字到所有模型的输入框，不发送
  insertTextToAll: (message: string) => Promise<SendResult[]>

  // 清空所有模型的输入框
  clearInputToAll: () => Promise<SendResult[]>

  // 发送消息到所有启用的模型（从已输入的文本发送）
  sendMessageToAll: (message: string) => Promise<SendResult[]>

  // 获取所有模型的最新回复
  getAllResponses: () => Promise<Record<string, string>>

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

  // 会话状态
  isNewSession: boolean
  setNewSession: (isNew: boolean) => void

  // 报告数据
  reportData: Record<string, string>
  setReportData: (data: Record<string, string>) => void
}

/**
 * 根据显示模式获取要显示的模型列表
 */
export function getDisplayedModels(models: ModelConfig[], displayMode: DisplayMode): ModelConfig[] {
  let displayCount: number
  switch (displayMode) {
    case 'one': displayCount = 1; break
    case 'two': displayCount = 2; break
    case 'four': displayCount = 4; break
    case 'three':
    default: displayCount = 3; break
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
  'doubao'
])

export const DEEP_RESEARCH_UNSUPPORTED_ERROR = '此模型不支持深度研究'

// 默认模型配置
const defaultModels: ModelConfig[] = [
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', logo: 'https://www.gstatic.com/lamda/images/gemini_favicon_f069958c85030456e93de685481c559f160ea06b.png', enabled: true },
  { id: 'grok', name: 'Grok', url: 'https://grok.com', logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.74.0/files/dark/grok.png', enabled: true },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', logo: 'https://cdn.oaistatic.com/assets/favicon-o20kmmos.svg', enabled: false },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', logo: 'https://cdn-avatars.huggingface.co/v1/production/uploads/64b89bf66b5ee8c38859cbd6/l_27fD52uFMZUXdFdY9fR.png', enabled: false },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', logo: 'https://www.anthropic.com/images/icons/apple-touch-icon.png', enabled: true },
  { id: 'qwen', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen', logo: 'https://img.alicdn.com/imgextra/i3/O1CN01utrBy31Tu1t8oOgUy_!!6000000002441-55-tps-32-32.svg', enabled: false },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat', logo: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/logo-doubao-overflow.png', enabled: false },
  { id: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail?lang=zh', logo: 'https://chatglm.cn/favicon.ico', enabled: false },
  { id: 'yuanbao', name: '元宝', url: 'https://yuanbao.tencent.com/chat', logo: 'https://cdn-bot.hunyuan.tencent.com/logo.png', enabled: false },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn', logo: 'https://statics.moonshot.cn/kimi-chat/favicon.ico', enabled: false },
  { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com/', logo: 'https://eb-static.cdn.bcebos.com/logo/favicon.ico', enabled: false }
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
  displayMode: 'three',
  setDisplayMode: (mode) => {
    set({ displayMode: mode, paneRatios: null })
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
    const newModels = [...state.models]
    const currentModel = newModels[slotIndex]
    const targetModelIndex = newModels.findIndex(m => m.id === newModelId)
    if (!currentModel || targetModelIndex === -1) return state
    const targetModel = newModels[targetModelIndex]
    newModels[slotIndex] = { ...targetModel, enabled: currentModel.enabled }
    newModels[targetModelIndex] = { ...currentModel, enabled: targetModel.enabled }
    if (window.api?.storeSet) window.api.storeSet('models', newModels)
    return { models: newModels }
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

  insertTextToAll: async (message: string): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode } = get()
    const displayedModels = getDisplayedModels(models, displayMode)
    const results: SendResult[] = []
    const insertPromises = displayedModels.map(async (model) => {
      const webviewRef = webviewRefs.get(model.id)
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
    const { models, webviewRefs, displayMode } = get()
    const displayedModels = getDisplayedModels(models, displayMode)
    const results: SendResult[] = []
    const clearPromises = displayedModels.map(async (model) => {
      const webviewRef = webviewRefs.get(model.id)
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
    const { models, webviewRefs, addHistory, updateHistory, history, isNewSession, setNewSession, displayMode } = get()
    set({ isSending: true, lastSendResults: [] })
    const displayedModels = getDisplayedModels(models, displayMode)
    const results: SendResult[] = []
    const sendPromises = displayedModels.map(async (model) => {
      const webviewRef = webviewRefs.get(model.id)
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
    const successModels = sendResults.filter((r) => r.success).map((r) => r.modelId)

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

  getAllResponses: async (): Promise<Record<string, string>> => {
    const { models, webviewRefs, displayMode } = get()
    const responses: Record<string, string> = {}
    const displayedModels = getDisplayedModels(models, displayMode)
    await Promise.all(
      displayedModels.map(async (model) => {
        const webviewRef = webviewRefs.get(model.id)
        if (webviewRef) {
          try {
            const response = await webviewRef.getLatestResponse()
            if (response) responses[model.id] = response
          } catch (error) {
            console.error(`获取 ${model.name} 回复失败:`, error)
          }
        }
      })
    )
    return responses
  },

  isUploading: false,
  uploadProgress: {},

  uploadFileToAll: async (fileData: FileUploadData): Promise<SendResult[]> => {
    const { models, webviewRefs, displayMode } = get()
    const displayedModels = getDisplayedModels(models, displayMode)
    const results: SendResult[] = []
    const initialProgress: Record<string, 'pending' | 'uploading' | 'success' | 'error'> = {}
    displayedModels.forEach((model) => { initialProgress[model.id] = 'pending' })
    set({ isUploading: true, uploadProgress: initialProgress })
    const uploadPromises = displayedModels.map(async (model) => {
      const webviewRef = webviewRefs.get(model.id)
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
    const { models, webviewRefs, displayMode } = get()
    const displayedModels = getDisplayedModels(models, displayMode)
    const results: SendResult[] = []
    const enablePromises = displayedModels.map(async (model) => {
      if (!DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)) {
        return { modelId: model.id, success: false, error: DEEP_RESEARCH_UNSUPPORTED_ERROR }
      }
      const webviewRef = webviewRefs.get(model.id)
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
    const { models, webviewRefs, displayMode } = get()
    const displayedModels = getDisplayedModels(models, displayMode)
    const results: SendResult[] = []
    const disablePromises = displayedModels.map(async (model) => {
      if (!DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)) {
        return { modelId: model.id, success: false, error: DEEP_RESEARCH_UNSUPPORTED_ERROR }
      }
      const webviewRef = webviewRefs.get(model.id)
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

  isNewSession: true,
  setNewSession: (isNew: boolean) => set({ isNewSession: isNew }),

  reportData: {},
  setReportData: (data: Record<string, string>) => set({ reportData: data }),

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
    const { monitor, webviewRefs, models, displayMode } = get()
    if (!monitor.isMonitoring || !monitor.currentTurn) return

    // 超时检测
    if (Date.now() - monitor.startTime > MONITOR_CONFIG.maxMonitorDurationMs) {
      get().saveCurrentTurn()
      get().stopMonitoring()
      return
    }

    const displayedModels = getDisplayedModels(models, displayMode)
    let allComplete = true

    for (const model of displayedModels) {
      const state = monitor.currentTurn.platforms[model.id]
      if (!state || state.isComplete) continue

      const ref = webviewRefs.get(model.id)
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
    if (storedDisplayMode) useAppStore.setState({ displayMode: storedDisplayMode })

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

    const storedHistory = await window.api.storeGet('history') as HistoryItem[] | undefined
    if (storedHistory) useAppStore.setState({ history: storedHistory })

    const storedSummaryHistory = await window.api.storeGet('summaryHistory') as SummaryHistoryItem[] | undefined
    if (storedSummaryHistory) useAppStore.setState({ summaryHistory: storedSummaryHistory })

    const storedSummaryModels = await window.api.storeGet('summaryModels') as SummaryModel[] | undefined
    if (storedSummaryModels) useAppStore.setState({ summaryModels: storedSummaryModels })

    const storedModels = await window.api.storeGet('models') as ModelConfig[] | undefined
    if (storedModels) {
      const mergedModels: ModelConfig[] = []
      const defaultModelMap = new Map(defaultModels.map(m => [m.id, m]))
      storedModels.forEach(storedModel => {
        const defaultModel = defaultModelMap.get(storedModel.id)
        if (defaultModel) {
          mergedModels.push({ ...defaultModel, enabled: storedModel.enabled })
          defaultModelMap.delete(storedModel.id)
        }
      })
      defaultModelMap.forEach(model => mergedModels.push(model))
      useAppStore.setState({ models: mergedModels })
    }

    // 加载保存的 Gemini 账号 URL
    const geminiAccountUrl = await window.api.storeGet('geminiAccountUrl') as string | undefined
    if (geminiAccountUrl) {
      console.log('[AppStore] 加载保存的 Gemini 账号 URL:', geminiAccountUrl)
      // 更新 Gemini 模型的 URL
      const currentModels = useAppStore.getState().models
      const updatedModels = currentModels.map(m =>
        m.id === 'gemini' ? { ...m, url: geminiAccountUrl } : m
      )
      useAppStore.setState({ models: updatedModels })
    }

    // 监听 Gemini 账号切换事件
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
