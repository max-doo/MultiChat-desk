import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import type { SummaryResult, ChatMessage, MessageVersion } from '../types/summary'

interface UseSummaryPanelProps {
  selectedModels: string[]
  modelResponses: Record<string, string>
  restoreHistoryData?: {
    historyId?: string
    messages: ChatMessage[]
    selectedModels: string[]
    modelResponses: Record<string, string>
  } | null
}

/**
 * SummaryPanel 的自定义 Hook
 * 管理总结面板的所有状态和业务逻辑
 */
export function useSummaryPanel({ selectedModels, modelResponses, restoreHistoryData }: UseSummaryPanelProps) {
  const [summaryMode, setSummaryMode] = useState('1')
  const [customPrompt, setCustomPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState('')

  // 对话消息列表
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // 当前流式生成的内容（正文）
  const [streamingContent, setStreamingContent] = useState('')
  // 当前流式生成的思考内容
  const [streamingReasoningContent, setStreamingReasoningContent] = useState('')
  // 使用 ref 追踪最新的内容，解决闭包问题
  const streamingContentRef = useRef('')
  const streamingReasoningContentRef = useRef('')
  // 是否已发送过第一条消息（用于区分首次总结和追问）
  const [hasStartedChat, setHasStartedChat] = useState(false)
  // 思考内容展开状态（用于流式输出时）
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(false)
  // 已完成消息的思考内容展开状态
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(new Set())
  // 快照：在首次生成总结时捕获的 modelResponses，后续重新生成均使用此快照
  // 避免新对话的模型输出覆盖历史总结中的模型输出
  const [capturedModelResponses, setCapturedModelResponses] = useState<Record<string, string>>({})

  // 导出对话框状态
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportFileName, setExportFileName] = useState('')
  const [exportDirectory, setExportDirectory] = useState('')
  const [exportContent, setExportContent] = useState('')

  // 重新生成编辑状态
  const [editingRegenerateMessageId, setEditingRegenerateMessageId] = useState<string | null>(null)
  const [editingRegenerateText, setEditingRegenerateText] = useState('')

  // 消息列表滚动引用
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { models, apiConfig, summaryModels: allSummaryModels, setApiConfig, addSummaryHistory, updateSummaryHistory } = useAppStore()
  const currentSummaryHistoryIdRef = useRef<string | null>(null)
  // 标记是否已为此对话生成过 AI 标题（避免重复生成）
  const hasGeneratedTitleRef = useRef<boolean>(false)

  const serializeMessages = (source: ChatMessage[]) => {
    return source.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      reasoningContent: msg.reasoningContent,
      timestamp: msg.timestamp,
      modeName: msg.modeName,
      versions: msg.versions,
      currentVersionIndex: msg.currentVersionIndex
    }))
  }

  const getSummaryTitle = (source: ChatMessage[]) => {
    const firstUserMessage = source.find(msg => msg.role === 'user')
    if (!firstUserMessage) return '未命名对话'
    return firstUserMessage.content.length > 15
      ? firstUserMessage.content.substring(0, 15) + '...'
      : firstUserMessage.content
  }

  const persistSummaryHistory = (
    source: ChatMessage[],
    extra?: { summarySource?: 'api' | 'webview'; webviewPlatformId?: string }
  ) => {
    if (source.length === 0) return

    let title = getSummaryTitle(source)
    const now = Date.now()

    // 更新已有记录时，保留用户可能手动重命名的标题
    const existingId = currentSummaryHistoryIdRef.current
    if (existingId) {
      const existing = useAppStore.getState().summaryHistory.find(h => h.id === existingId)
      if (existing?.title) {
        title = existing.title
      }
    }

    const updates = {
      title,
      timestamp: now,
      messages: serializeMessages(source),
      selectedModels: [...selectedModels],
      modelResponses: { ...capturedModelResponses },
      ...extra
    }

    if (existingId) {
      updateSummaryHistory(existingId, { ...updates })
      return
    }

    const id = now.toString()
    addSummaryHistory({
      id,
      ...updates
    })
    currentSummaryHistoryIdRef.current = id
  }

  /**
   * 异步生成 AI 标题并更新历史记录
   * 仅在首次总结成功后调用，不阻塞主流程
   */
  const generateAITitle = async (summaryContent: string): Promise<void> => {
    if (!activeProvider || !activeProvider.apiKey || !selectedAgent) return
    if (hasGeneratedTitleRef.current) return

    const historyId = currentSummaryHistoryIdRef.current
    if (!historyId) return

    // 截取前 500 字作为标题生成素材，避免过长
    const truncatedContent = summaryContent.length > 500
      ? summaryContent.substring(0, 500) + '...'
      : summaryContent

    const titleSystemPrompt = '你是一个标题生成助手。请根据用户提供的对话内容，生成一个简短、准确的中文标题。标题不超过15个字，不要加引号，不要添加任何解释。'
    const titleUserContent = `请为以下对话生成一个简短的中文标题（不超过15字）：\n\n${truncatedContent}`

    try {
      console.log('[SummaryPanel] 开始异步生成 AI 标题...')
      const result = await window.api.generateSummary({
        apiKey: activeProvider.apiKey,
        baseUrl: activeProvider.baseUrl,
        model: selectedAgent,
        systemPrompt: titleSystemPrompt,
        userContent: titleUserContent,
        temperature: 0.3,
        topP: 1.0,
        maxTokens: 50,
        includeReasoning: false
      })

      if (result.success && result.data) {
        // 清理生成的标题：去除引号、换行、多余空格
        let generatedTitle = result.data.trim()
          .replace(/^[""''`]+|[""''`]+$/g, '')
          .replace(/\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()

        // 限制长度
        if (generatedTitle.length > 20) {
          generatedTitle = generatedTitle.substring(0, 20)
        }

        if (generatedTitle) {
          console.log('[SummaryPanel] AI 标题生成成功:', generatedTitle)
          updateSummaryHistory(historyId, { title: generatedTitle })
          hasGeneratedTitleRef.current = true
        } else {
          console.log('[SummaryPanel] AI 标题生成结果为空，保留默认标题')
        }
      } else {
        console.log('[SummaryPanel] AI 标题生成失败:', result.error || '未知错误')
      }
    } catch (err) {
      console.error('[SummaryPanel] AI 标题生成异常:', err)
      // 失败时静默处理，保留默认的截断标题
    }
  }

  // 模型参数状态 - 优先使用 apiConfig 中的配置，否则使用默认值
  const [temperature, setTemperature] = useState(apiConfig.temperature ?? 0.7)
  const [topP, setTopP] = useState(apiConfig.topP ?? 1.0)
  const [maxTokens, setMaxTokens] = useState(apiConfig.maxTokens ?? 8000)
  const [includeReasoning, setIncludeReasoning] = useState(apiConfig.includeReasoning ?? false)
  const [contextRounds, setContextRounds] = useState(apiConfig.contextRounds ?? 5)  // 默认保留5轮对话
  const [showSettings, setShowSettings] = useState(false)

  // 当配置变更时，同步更新 store
  const updateStoreConfig = (updates: Partial<typeof apiConfig>) => {
    setApiConfig({
      ...apiConfig,
      ...updates
    })
  }

  // 获取用户配置的提示词列表
  const agentPrompts = apiConfig.agentPrompts || []

  // 确保 summaryMode 在提示词列表更新后仍然有效
  useEffect(() => {
    if (agentPrompts.length > 0 && !agentPrompts.find(p => p.id === summaryMode)) {
      setSummaryMode(agentPrompts[0].id)
    }
  }, [agentPrompts, summaryMode])

  // 获取已启用的供应商
  const providers = (apiConfig.providers || []).filter(p => p.enabled)
  const activeProvider = providers.find(p => p.id === selectedProviderId) || providers[0]

  // 获取当前供应商对应的总结模型列表
  const summaryModels = (allSummaryModels || []).filter(m => m.providerId === (activeProvider?.id || ''))

  // 检查是否已配置 API
  const isApiConfigured = providers.length > 0 && providers.some(p => p.apiKey)

  // 初始化选择 - 从 store 恢复上次的选择
  useEffect(() => {
    if (providers.length > 0) {
      // 优先使用保存的供应商 ID，否则使用第一个
      const savedProviderId = apiConfig.activeProviderId
      const providerToUse = savedProviderId && providers.find(p => p.id === savedProviderId)
        ? savedProviderId
        : providers[0].id

      if (!selectedProviderId || selectedProviderId !== providerToUse) {
        setSelectedProviderId(providerToUse)
      }
    }
  }, [providers, apiConfig.activeProviderId, selectedProviderId])

  useEffect(() => {
    if (summaryModels.length > 0) {
      // 优先使用保存的模型 ID，否则使用第一个
      const savedAgentId = apiConfig.lastSelectedAgentId
      const agentToUse = savedAgentId && summaryModels.find(m => m.id === savedAgentId)
        ? savedAgentId
        : summaryModels[0].id

      if (!selectedAgent || selectedAgent !== agentToUse) {
        setSelectedAgent(agentToUse)
      }
    } else {
      setSelectedAgent('')
    }
  }, [summaryModels, apiConfig.lastSelectedAgentId, selectedAgent])

  // 恢复历史记录
  useEffect(() => {
    if (restoreHistoryData) {
      if (restoreHistoryData.historyId) {
        currentSummaryHistoryIdRef.current = restoreHistoryData.historyId
      }
      setMessages(restoreHistoryData.messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        reasoningContent: msg.reasoningContent,
        timestamp: msg.timestamp,
        modeName: msg.modeName,
        versions: msg.versions,
        currentVersionIndex: msg.currentVersionIndex
      })))
      setHasStartedChat(restoreHistoryData.messages.length > 0)
      // 恢复历史记录时，从历史数据中捕获 modelResponses 快照
      if (restoreHistoryData.modelResponses) {
        setCapturedModelResponses({ ...restoreHistoryData.modelResponses })
      }
    }
  }, [restoreHistoryData])

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // 重置对话
  const handleResetChat = () => {
    doResetChat()
  }

  // 执行重置对话
  const doResetChat = () => {
    // 在重置之前，如果有对话内容，保存到历史记录
    if (messages.length > 0 && hasStartedChat) {
      persistSummaryHistory(messages)
    }

    setMessages([])
    setStreamingContent('')
    setStreamingReasoningContent('')
    streamingContentRef.current = ''
    streamingReasoningContentRef.current = ''
    setHasStartedChat(false)
    setCustomPrompt('')
    setError(null)
    setIsReasoningExpanded(false)
    currentSummaryHistoryIdRef.current = null
    hasGeneratedTitleRef.current = false
    setCapturedModelResponses({})
  }

  // 生成总结或追问
  const handleGenerateSummary = async (): Promise<void> => {
    // 首次发送需要验证更多条件
    if (!hasStartedChat) {
      if (selectedModels.length === 0) {
        setError('请至少选择一个模型的输出')
        return
      }
    }

    // 追问时需要有输入内容
    if (hasStartedChat && !customPrompt.trim()) {
      setError('请输入追问内容')
      return
    }

    if (!activeProvider || !activeProvider.apiKey) {
      setError('当前选择的供应商未配置 API Key')
      return
    }

    if (!selectedAgent) {
      setError('请选择一个总结模型')
      return
    }

    // 获取当前模式配置
    const selectedPromptConfig = agentPrompts.find(p => p.id === summaryMode)
    const currentModeName = selectedPromptConfig?.name || '总结'
    const agentPromptContent = selectedPromptConfig?.prompt || ''

    const extractUserRequirementFromDisplay = (content: string): string => {
      const trimmed = (content || '').trim()
      if (!trimmed) return ''
      const marker = '，采用'
      const idx = trimmed.indexOf(marker)
      if (idx > 0) return trimmed.slice(0, idx).trim()
      return ''
    }

    // 构建用户显示消息和实际发送内容
    let userDisplayMessage: string
    let systemPrompt: string
    let userContent: string
    let modelOutputs: Array<{ name: string; content: string }> | undefined
    let userRequirement: string | undefined

    if (!hasStartedChat) {
      // 首次发送：捕获当前 modelResponses 快照，后续重新生成均使用此快照
      const snapshot = { ...modelResponses }
      setCapturedModelResponses(snapshot)

      // 首次发送：显示 agent 提示词内容，发送完整的模型回答分析
      modelOutputs = selectedModels
        .map(id => {
          const model = models.find(m => m.id === id)
          const response = snapshot[id]
          if (model && response) {
            return { name: model.name, content: response }
          }
          return null
        })
        .filter((x): x is { name: string; content: string } => Boolean(x))

      if (modelOutputs.length === 0) {
        setError('所选模型暂无回复内容')
        return
      }

      const modelNames = modelOutputs.map(m => m.name).join('、')
      const requirement = (customPrompt || '').trim()
      userDisplayMessage = requirement
        ? `${requirement}，采用【${currentModeName}】模式，根据${modelNames}的回答生成报告。`
        : `采用${currentModeName}模式，根据${modelNames}的回答生成报告。`

      systemPrompt = agentPromptContent
      if (apiConfig.systemPrompt) {
        systemPrompt += `\n\n额外要求：${apiConfig.systemPrompt}`
      }

      userContent = ''
      userRequirement = customPrompt || undefined
    } else {
      // 追问：只发送用户的提示词
      userDisplayMessage = customPrompt

      // 追问时使用简单的系统提示
      systemPrompt = '你是一个专业的AI助手，请根据之前的对话上下文回答用户的问题。'
      if (apiConfig.systemPrompt) {
        systemPrompt += `\n\n额外要求：${apiConfig.systemPrompt}`
      }

      userContent = customPrompt
    }

    // 添加用户消息
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userDisplayMessage,
      timestamp: Date.now(),
      modeName: currentModeName
    }
    const messagesAfterUser = [...messages, userMessage]
    setMessages(messagesAfterUser)

    setIsGenerating(true)
    setStreamingContent('')
    setStreamingReasoningContent('')
    streamingContentRef.current = ''  // 重置 ref
    streamingReasoningContentRef.current = ''
    setIsReasoningExpanded(false)
    setError(null)

    console.log('\n========== [SummaryPanel] 发起总结请求 ==========')
    console.log('[SummaryPanel] 供应商:', activeProvider.name)
    console.log('[SummaryPanel] 模型:', selectedAgent)
    console.log('[SummaryPanel] Base URL:', activeProvider.baseUrl)
    console.log('[SummaryPanel] 参数:', { temperature, topP, maxTokens, includeReasoning, contextRounds })
    console.log('[SummaryPanel] 三明治参数:', { modelOutputs: modelOutputs?.length || 0, userRequirement: userRequirement || '', userContentLength: userContent.length })

    // 构建对话历史（仅在追问时且 contextRounds > 0 时包含）
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
    if (hasStartedChat && contextRounds > 0) {
      // 获取最近的 N 轮对话（一轮 = 一对 user + assistant 消息）
      const recentMessages = messages.slice(-(contextRounds * 2))
      conversationHistory = recentMessages.map(m => ({
        role: m.role,
        content: m.role === 'user' ? (extractUserRequirementFromDisplay(m.content) || m.content) : m.content
      }))
      console.log('[SummaryPanel] 包含对话历史:', conversationHistory.length, '条消息')
    }

    try {
      // 流式输出回调
      const result = await window.api.generateSummary({
        apiKey: activeProvider.apiKey,
        baseUrl: activeProvider.baseUrl,
        model: selectedAgent,
        systemPrompt,
        userContent,
        modelOutputs,
        userRequirement,
        messages: conversationHistory.length > 0 ? conversationHistory : undefined,
        temperature,
        topP,
        maxTokens,
        includeReasoning
      }, (chunk: string, isReasoning?: boolean) => {
        if (isReasoning) {
          // 思考内容
          setStreamingReasoningContent(prev => {
            const newContent = prev + chunk
            streamingReasoningContentRef.current = newContent
            return newContent
          })
        } else {
          // 正文内容
          setStreamingContent(prev => {
            const newContent = prev + chunk
            streamingContentRef.current = newContent
            return newContent
          })
        }
      }) as SummaryResult

      console.log('[SummaryPanel] 请求结果:', result.success ? '成功' : (result.aborted ? '已终止' : '失败'))
      if (!result.success && !result.aborted) {
        console.error('[SummaryPanel] 错误信息:', result.error)
      }

      if (result.success && result.data) {
        console.log('[SummaryPanel] ✓ 生成完成，内容长度:', result.data.length)
        if (result.reasoningContent) {
          console.log('[SummaryPanel] 思考内容长度:', result.reasoningContent.length)
        }
        // 获取当前模型名称
        const currentModel = summaryModels.find(m => m.id === selectedAgent)
        const modelName = currentModel?.name || selectedAgent

        // 添加助手消息（带版本信息和思考内容）
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: result.data,
          reasoningContent: result.reasoningContent,
          timestamp: Date.now(),
          versions: [{
            content: result.data,
            reasoningContent: result.reasoningContent,
            timestamp: Date.now(),
            modelId: selectedAgent,
            modelName: modelName
          }],
          currentVersionIndex: 0
        }
        const finalMessages = [...messagesAfterUser, assistantMessage]
        setMessages(finalMessages)
        persistSummaryHistory(finalMessages)
        setStreamingContent('')
        setStreamingReasoningContent('')
        streamingContentRef.current = ''
        streamingReasoningContentRef.current = ''
        setCustomPrompt('')  // 清空输入

        // 标记已开始对话
        if (!hasStartedChat) {
          setHasStartedChat(true)
          // 首次总结成功后，异步生成 AI 标题（不阻塞主流程）
          generateAITitle(result.data)
        }
      } else if (result.aborted) {
        // 用户主动终止，保留已生成的内容作为消息（如果有的话）
        console.log('[SummaryPanel] ⏹️ 用户终止生成')
        // 使用 ref 获取最新的内容，避免闭包问题
        const partialContent = streamingContentRef.current
        const partialReasoning = streamingReasoningContentRef.current
        console.log('[SummaryPanel] 已生成内容长度:', partialContent.length)
        console.log('[SummaryPanel] 已生成思考长度:', partialReasoning.length)
        if (partialContent || partialReasoning) {
          const currentModel = summaryModels.find(m => m.id === selectedAgent)
          const modelName = currentModel?.name || selectedAgent
          const finalContent = (partialContent || '（无正文内容）') + '\n\n---\n*（生成已终止）*'

          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: finalContent,
            reasoningContent: partialReasoning || undefined,
            timestamp: Date.now(),
            versions: [{
              content: finalContent,
              reasoningContent: partialReasoning || undefined,
              timestamp: Date.now(),
              modelId: selectedAgent,
              modelName: modelName
            }],
            currentVersionIndex: 0
          }
          const finalMessages = [...messagesAfterUser, assistantMessage]
          setMessages(finalMessages)
          persistSummaryHistory(finalMessages)
          if (!hasStartedChat) {
            setHasStartedChat(true)
          }
        } else {
          persistSummaryHistory(messagesAfterUser)
        }
        setStreamingContent('')
        setStreamingReasoningContent('')
        streamingContentRef.current = ''
        streamingReasoningContentRef.current = ''
        // 不显示错误，因为是用户主动终止
      } else {
        const errorMsg = result.error || '生成失败，未知错误'
        console.error('[SummaryPanel] ❌ 生成失败:', errorMsg)
        setError(errorMsg)
        setStreamingContent('')
        setStreamingReasoningContent('')
        streamingContentRef.current = ''
        streamingReasoningContentRef.current = ''
      }
    } catch (err) {
      console.error('[SummaryPanel] ❌ 请求异常:', err)
      setError(`请求异常: ${String(err)}`)
      setStreamingContent('')
      streamingContentRef.current = ''
    } finally {
      setIsGenerating(false)
      console.log('========== [SummaryPanel] 请求结束 ==========\n')
    }
  }

  // 终止生成
  const handleAbortGeneration = async (): Promise<void> => {
    console.log('[SummaryPanel] 用户点击终止按钮')
    try {
      const result = await window.api.abortSummary()
      console.log('[SummaryPanel] 终止请求结果:', result)
    } catch (err) {
      console.error('[SummaryPanel] 终止请求失败:', err)
    }
  }

  // 开始编辑重新生成的要求
  const startEditingRegenerate = (messageId: string): void => {
    const messageIndex = messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) return

    // 找到这条助手消息对应的用户消息（前一条）
    let userMessageIndex = messageIndex - 1
    while (userMessageIndex >= 0 && messages[userMessageIndex].role !== 'user') {
      userMessageIndex--
    }
    if (userMessageIndex < 0) return

    const originalUserMessage = messages[userMessageIndex]
    const isFirstSummary = userMessageIndex === 0

    const extractUserRequirementFromDisplay = (content: string): string => {
      const trimmed = (content || '').trim()
      if (!trimmed) return ''
      const marker = '，采用'
      const idx = trimmed.indexOf(marker)
      if (idx > 0) return trimmed.slice(0, idx).trim()
      return trimmed
    }

    const originalRequirement = isFirstSummary
      ? extractUserRequirementFromDisplay(originalUserMessage.content)
      : originalUserMessage.content

    setEditingRegenerateMessageId(messageId)
    setEditingRegenerateText(originalRequirement)
  }

  // 取消编辑重新生成
  const cancelEditingRegenerate = (): void => {
    setEditingRegenerateMessageId(null)
    setEditingRegenerateText('')
  }

  // 重新生成助手消息（添加新版本，保留原版本）
  const handleRegenerate = async (messageId: string, editedRequirement?: string): Promise<void> => {
    // 找到要重新生成的消息及其之前的用户消息
    const messageIndex = messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) return

    const _targetMessage = messages[messageIndex]

    // 找到这条助手消息对应的用户消息（前一条）
    let userMessageIndex = messageIndex - 1
    while (userMessageIndex >= 0 && messages[userMessageIndex].role !== 'user') {
      userMessageIndex--
    }

    if (userMessageIndex < 0) {
      console.error('[SummaryPanel] 找不到对应的用户消息')
      return
    }

    if (!activeProvider || !activeProvider.apiKey) {
      setError('当前选择的供应商未配置 API Key')
      return
    }

    if (!selectedAgent) {
      setError('请选择一个总结模型')
      return
    }

    console.log('[SummaryPanel] 重新生成消息，添加新版本')

    // 构建重新生成所需的参数
    const isFirstSummary = userMessageIndex === 0
    let systemPrompt: string
    let userContent: string
    let modelOutputs: Array<{ name: string; content: string }> | undefined
    let userRequirement: string | undefined
    let userDisplayMessage: string

    const extractUserRequirementFromDisplay = (content: string): string => {
      const trimmed = (content || '').trim()
      if (!trimmed) return ''
      const marker = '，采用'
      const idx = trimmed.indexOf(marker)
      if (idx > 0) return trimmed.slice(0, idx).trim()
      return ''
    }

    if (isFirstSummary) {
      // 首次总结的重新生成：使用原始的模型回答
      const selectedPromptConfig = agentPrompts.find(p => p.id === summaryMode)
      const agentPromptContent = selectedPromptConfig?.prompt || ''
      const currentModeName = selectedPromptConfig?.name || '总结'
      const originalUserMessage = messages[userMessageIndex]

      modelOutputs = selectedModels
        .map(id => {
          const model = models.find(m => m.id === id)
          const response = capturedModelResponses[id] ?? modelResponses[id]
          if (model && response) {
            return { name: model.name, content: response }
          }
          return null
        })
        .filter((x): x is { name: string; content: string } => Boolean(x))

      if (modelOutputs.length === 0) {
        setError('所选模型暂无回复内容，无法重新生成')
        return
      }

      systemPrompt = agentPromptContent
      if (apiConfig.systemPrompt) {
        systemPrompt += `\n\n额外要求：${apiConfig.systemPrompt}`
      }
      userContent = ''
      // 优先使用用户编辑后的要求，否则提取原始要求
      const originalRequirement = extractUserRequirementFromDisplay(originalUserMessage?.content || '')
      userRequirement = (editedRequirement !== undefined ? editedRequirement : originalRequirement) || undefined

      const modelNames = modelOutputs.map(m => m.name).join('、')
      userDisplayMessage = userRequirement
        ? `${userRequirement}，采用【${currentModeName}】模式，根据${modelNames}的回答生成报告。`
        : `采用${currentModeName}模式，根据${modelNames}的回答生成报告。`
    } else {
      // 追问的重新生成：使用原始追问内容（或编辑后的）
      const originalUserMessage = messages[userMessageIndex]
      systemPrompt = '你是一个专业的AI助手，请根据之前的对话上下文回答用户的问题。'
      if (apiConfig.systemPrompt) {
        systemPrompt += `\n\n额外要求：${apiConfig.systemPrompt}`
      }
      // 优先使用用户编辑后的要求，否则使用原始内容
      userContent = editedRequirement !== undefined ? editedRequirement : originalUserMessage.content
      userDisplayMessage = userContent
    }

    // 如果用户编辑了要求，更新对应的用户消息显示内容
    let messagesToUse = messages
    if (editedRequirement !== undefined) {
      messagesToUse = messages.map((m, idx) => {
        if (idx === userMessageIndex) {
          return { ...m, content: userDisplayMessage }
        }
        return m
      })
      setMessages(messagesToUse)
    }

    // 清除编辑状态
    setEditingRegenerateMessageId(null)
    setEditingRegenerateText('')

    // 构建对话历史
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
    if (!isFirstSummary && contextRounds > 0) {
      const historyMessages = messagesToUse.slice(0, userMessageIndex)
      const recentMessages = historyMessages.slice(-(contextRounds * 2))
      conversationHistory = recentMessages.map(m => ({
        role: m.role,
        content: m.role === 'assistant'
          ? (m.versions?.[m.currentVersionIndex || 0]?.content || m.content)
          : (extractUserRequirementFromDisplay(m.content) || m.content)
      }))
    }

    setIsGenerating(true)
    setStreamingContent('')
    setStreamingReasoningContent('')
    streamingContentRef.current = ''
    streamingReasoningContentRef.current = ''
    setIsReasoningExpanded(false)
    setError(null)

    // 记录当前重新生成的消息 ID，用于流式更新
    const regeneratingMessageId = messageId

    try {
      console.log('[SummaryPanel] 三明治参数(重新生成):', { modelOutputs: modelOutputs?.length || 0, userRequirement: userRequirement || '', userContentLength: userContent.length })
      const result = await window.api.generateSummary({
        apiKey: activeProvider.apiKey,
        baseUrl: activeProvider.baseUrl,
        model: selectedAgent,
        systemPrompt,
        userContent,
        modelOutputs,
        userRequirement,
        messages: conversationHistory.length > 0 ? conversationHistory : undefined,
        temperature,
        topP,
        maxTokens,
        includeReasoning
      }, (chunk: string, isReasoning?: boolean) => {
        if (isReasoning) {
          setStreamingReasoningContent(prev => {
            const newContent = prev + chunk
            streamingReasoningContentRef.current = newContent
            return newContent
          })
        } else {
          setStreamingContent(prev => {
            const newContent = prev + chunk
            streamingContentRef.current = newContent
            return newContent
          })
        }
      }) as SummaryResult

      const currentModel = summaryModels.find(m => m.id === selectedAgent)
      const modelName = currentModel?.name || selectedAgent

      if (result.success && result.data) {
        // 添加新版本到消息（包含思考内容）
        const newContent = result.data
        const newVersion: MessageVersion = {
          content: newContent,
          reasoningContent: result.reasoningContent,
          timestamp: Date.now(),
          modelId: selectedAgent,
          modelName: modelName
        }

        const updatedMessages = messagesToUse.map(m => {
          if (m.id === regeneratingMessageId) {
            const existingVersions = m.versions || [{
              content: m.content,
              reasoningContent: m.reasoningContent,
              timestamp: m.timestamp,
              modelId: '',
              modelName: '未知'
            }]
            const newVersions = [...existingVersions, newVersion]
            return {
              ...m,
              content: newContent,
              reasoningContent: result.reasoningContent,
              versions: newVersions,
              currentVersionIndex: newVersions.length - 1
            }
          }
          return m
        })
        setMessages(updatedMessages)
        persistSummaryHistory(updatedMessages)
        setStreamingContent('')
        setStreamingReasoningContent('')
        streamingContentRef.current = ''
        streamingReasoningContentRef.current = ''
        console.log('[SummaryPanel] ✓ 重新生成完成，新版本已添加')
      } else if (result.aborted) {
        const partialContent = streamingContentRef.current
        const partialReasoning = streamingReasoningContentRef.current
        if (partialContent || partialReasoning) {
          const finalContent = (partialContent || '（无正文内容）') + '\n\n---\n*（生成已终止）*'
          const newVersion: MessageVersion = {
            content: finalContent,
            reasoningContent: partialReasoning || undefined,
            timestamp: Date.now(),
            modelId: selectedAgent,
            modelName: modelName
          }

          const updatedMessages = messagesToUse.map(m => {
            if (m.id === regeneratingMessageId) {
              const existingVersions = m.versions || [{
                content: m.content,
                reasoningContent: m.reasoningContent,
                timestamp: m.timestamp,
                modelId: '',
                modelName: '未知'
              }]
              const newVersions = [...existingVersions, newVersion]
              return {
                ...m,
                content: finalContent,
                reasoningContent: partialReasoning || undefined,
                versions: newVersions,
                currentVersionIndex: newVersions.length - 1
              }
            }
            return m
          })
          setMessages(updatedMessages)
          persistSummaryHistory(updatedMessages)
        }
        setStreamingContent('')
        setStreamingReasoningContent('')
        streamingContentRef.current = ''
        streamingReasoningContentRef.current = ''
      } else {
        setError(result.error || '重新生成失败')
        setStreamingContent('')
        setStreamingReasoningContent('')
        streamingContentRef.current = ''
        streamingReasoningContentRef.current = ''
      }
    } catch (err) {
      console.error('[SummaryPanel] 重新生成异常:', err)
      setError(`重新生成异常: ${String(err)}`)
      setStreamingContent('')
    } finally {
      setIsGenerating(false)
    }
  }

  // 切换消息版本
  const handleSwitchVersion = (messageId: string, direction: 'prev' | 'next'): void => {
    setMessages(prev => prev.map(m => {
      if (m.id === messageId && m.versions && m.versions.length > 1) {
        const currentIndex = m.currentVersionIndex || 0
        let newIndex: number

        if (direction === 'prev') {
          newIndex = currentIndex > 0 ? currentIndex - 1 : m.versions.length - 1
        } else {
          newIndex = currentIndex < m.versions.length - 1 ? currentIndex + 1 : 0
        }

        return {
          ...m,
          content: m.versions[newIndex].content,
          currentVersionIndex: newIndex
        }
      }
      return m
    }))
  }

  // 打开导出对话框
  const handleOpenExportDialog = (content: string): void => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const currentPromptName = agentPrompts.find(p => p.id === summaryMode)?.name || summaryMode

    const fullReport = `# ModelMash AI 验证报告

**生成时间**: ${new Date().toLocaleString('zh-CN')}
**总结模式**: ${currentPromptName}
**使用模型**: ${selectedAgent}

---

${content}

---

*由 ModelMash 生成*
`

    setExportFileName(`ModelMash_Report_${timestamp}.md`)
    setExportDirectory(apiConfig.exportDirectory || '')
    setExportContent(fullReport)
    setShowExportDialog(true)
  }

  // 选择导出目录
  const handleSelectExportDirectory = async (): Promise<void> => {
    try {
      const dir = await window.api.selectDirectory()
      if (dir) {
        setExportDirectory(dir)
      }
    } catch (err) {
      console.error('选择目录失败:', err)
    }
  }

  // 确认导出
  const handleConfirmExport = async (): Promise<void> => {
    try {
      const result = await window.api.exportReport({
        content: exportContent,
        fileName: exportFileName,
        directory: exportDirectory || undefined
      })

      if (result.success) {
        setShowExportDialog(false)
        alert(`报告已导出至：${result.filePath}`)
      } else if (result.error !== '用户取消') {
        setError(`导出失败：${result.error}`)
      }
    } catch (err) {
      setError(`导出失败：${err}`)
    }
  }

  return {
    // 状态
    summaryMode,
    setSummaryMode,
    customPrompt,
    setCustomPrompt,
    isGenerating,
    error,
    selectedAgent,
    setSelectedAgent,
    selectedProviderId,
    setSelectedProviderId,
    messages,
    setMessages,
    streamingContent,
    streamingReasoningContent,
    hasStartedChat,
    isReasoningExpanded,
    setIsReasoningExpanded,
    expandedReasoningIds,
    setExpandedReasoningIds,
    showExportDialog,
    setShowExportDialog,
    exportFileName,
    setExportFileName,
    exportDirectory,
    setExportDirectory,
    exportContent,
    messagesEndRef,
    temperature,
    setTemperature,
    topP,
    setTopP,
    maxTokens,
    setMaxTokens,
    includeReasoning,
    setIncludeReasoning,
    contextRounds,
    setContextRounds,
    showSettings,
    setShowSettings,

    // 计算值
    agentPrompts,
    providers,
    activeProvider,
    summaryModels,
    allSummaryModels,
    isApiConfigured,

    // 重新生成编辑
    editingRegenerateMessageId,
    setEditingRegenerateMessageId,
    editingRegenerateText,
    setEditingRegenerateText,
    startEditingRegenerate,
    cancelEditingRegenerate,

    // 方法
    updateStoreConfig,
    handleResetChat,
    handleGenerateSummary,
    handleAbortGeneration,
    handleRegenerate,
    handleSwitchVersion,
    handleOpenExportDialog,
    handleSelectExportDirectory,
    handleConfirmExport,

    // Webview summary 需要
    persistSummaryHistory
  }
}
