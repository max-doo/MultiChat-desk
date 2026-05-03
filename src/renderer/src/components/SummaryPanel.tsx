import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { useAppStore } from '../store/appStore'
import CustomDropdown from './CustomDropdown'
import { useSummaryPanel } from '../hooks/useSummaryPanel'
import { useWebviewSummary } from '../hooks/useWebviewSummary'
import WebviewCard, { WebviewCardRef } from './WebviewCard'
import { defaultSelectors } from '../config/selectors'
import type { SummaryPanelProps, ChatMessage } from '../types/summary'

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
})
turndownService.use(gfm)

const htmlTagRegex = /<\s*[a-z][\w-]*(\s[^>]*)?>/i

function toMarkdown(content: string): string {
  const normalized = (content || '').replace(/\r\n/g, '\n').trimEnd()
  if (!normalized) return ''
  if (!htmlTagRegex.test(normalized)) return normalized
  try {
    return turndownService.turndown(normalized).trimEnd()
  } catch {
    return normalized
  }
}

/**
 * 总结面板组件
 * 对话形式显示 AI 总结结果
 */
function SummaryPanel({ selectedModels, modelResponses, restoreHistoryData }: SummaryPanelProps): JSX.Element {
  const {
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
    editingRegenerateMessageId,
    editingRegenerateText,
    setEditingRegenerateText,

    // 计算值
    agentPrompts,
    providers,
    summaryModels,
    allSummaryModels,
    isApiConfigured,

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
    startEditingRegenerate,
    cancelEditingRegenerate
  } = useSummaryPanel({ selectedModels, modelResponses, restoreHistoryData })

  const { apiConfig, models, setApiConfig, addSummaryHistory, updateSummaryHistory } = useAppStore()

  // 从 store 读取当前模式，缺省 'webview'
  const summarySource: 'api' | 'webview' = apiConfig.summarySource ?? 'webview'
  const firstEnabledModel = models.find(m => m.enabled)
  const lastWebviewPlatform = apiConfig.lastWebviewSummaryPlatform ?? firstEnabledModel?.id ?? 'chatgpt'
  const [webviewPlatformId, setWebviewPlatformId] = useState<string>(lastWebviewPlatform)
  // Webview composer 锁定标记：首次发送后置 true，组件卸载或 phase 进入 error/aborted 时归零
  const [summaryFired, setSummaryFired] = useState(false)

  const webviewSummaryRef = useRef<WebviewCardRef>(null)
  const webviewHistoryIdRef = useRef<string | null>(null)

  const webviewPlatformInfo = useMemo(() => {
    const m = models.find(x => x.id === webviewPlatformId)
    const sel = defaultSelectors.models[webviewPlatformId]
    return {
      name: m?.name || webviewPlatformId,
      logo: m?.logo,
      url: sel?.newConversationUrl || m?.url || ''
    }
  }, [models, webviewPlatformId])

  const setLastWebviewPlatform = (id: string) => {
    setWebviewPlatformId(id)
    setApiConfig({ ...apiConfig, lastWebviewSummaryPlatform: id })
  }

  const buildWebviewPrompt = useCallback(() => {
    const agentTemplate = (apiConfig.agentPrompts || []).find(a => a.id === summaryMode)
    const systemPrompt = agentTemplate?.prompt || apiConfig.systemPrompt || ''
    const contextBlock = selectedModels
      .map(id => {
        const name = models.find(m => m.id === id)?.name || id
        const content = modelResponses[id] || ''
        return `<model_output name="${name}">\n${content}\n</model_output>`
      })
      .join('\n')
    const requirement = customPrompt?.trim() || '请生成标准总结报告。'
    return [
      '[系统指令]',
      systemPrompt,
      '',
      '[待分析内容]',
      '<context>',
      contextBlock,
      '</context>',
      '',
      '[用户要求]',
      requirement
    ].join('\n')
  }, [summaryMode, apiConfig.agentPrompts, apiConfig.systemPrompt, selectedModels, models, modelResponses, customPrompt])

  const handleWebviewAssistantMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      const updated = [...prev, msg]
      const historyId = webviewHistoryIdRef.current
      if (historyId) {
        updateSummaryHistory(historyId, {
          messages: updated.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            reasoningContent: m.reasoningContent,
            timestamp: m.timestamp,
            modeName: m.modeName,
            versions: m.versions,
            currentVersionIndex: m.currentVersionIndex
          }))
        })
      }
      return updated
    })
  }, [setMessages, updateSummaryHistory])

  const webviewSummary = useWebviewSummary({
    webviewRef: webviewSummaryRef,
    buildPrompt: buildWebviewPrompt,
    onAssistantMessage: handleWebviewAssistantMessage
  })

  // phase 进入 error / aborted 时解锁 composer，允许重试；'done' 不解锁，引导用户去 WebView 自带输入框追问
  useEffect(() => {
    if (webviewSummary.phase === 'error' || webviewSummary.phase === 'aborted') {
      setSummaryFired(false)
    }
  }, [webviewSummary.phase])

  const handleWebviewSend = useCallback(() => {
    if (selectedModels.length === 0) return

    const agentTemplate = agentPrompts.find(a => a.id === summaryMode)
    const modeName = agentTemplate?.name || '总结'
    const modelNames = selectedModels
      .map(id => models.find(m => m.id === id)?.name || id)
      .join('、')
    const requirement = customPrompt?.trim() || ''

    const userContent = requirement
      ? `${requirement}，采用【${modeName}】模式，根据${modelNames}的回答生成报告。`
      : `采用${modeName}模式，根据${modelNames}的回答生成报告。`

    const userMessage: ChatMessage = {
      id: `webview-user-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
      modeName
    }

    setMessages(prev => [...prev, userMessage])

    const historyId = Date.now().toString()
    webviewHistoryIdRef.current = historyId

    addSummaryHistory({
      id: historyId,
      title: userContent.length > 15 ? userContent.substring(0, 15) + '...' : userContent,
      timestamp: Date.now(),
      messages: [{
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        timestamp: userMessage.timestamp,
        modeName: userMessage.modeName
      }],
      selectedModels: [...selectedModels],
      modelResponses: { ...modelResponses },
      summarySource: 'webview',
      webviewPlatformId
    })

    webviewSummary.startSummary()
    setSummaryFired(true)
  }, [summaryMode, agentPrompts, selectedModels, models, customPrompt, setMessages, addSummaryHistory, webviewPlatformId, webviewSummary, modelResponses, setSummaryFired])

  // 获取收藏的模型ID列表
  const favoriteModelIds = apiConfig.favoriteModelIds || []

  // 切换模型收藏状态
  const toggleFavoriteModel = (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation() // 阻止事件冒泡，避免触发模型选择
    const isFavorite = favoriteModelIds.includes(modelId)
    const newFavoriteIds = isFavorite
      ? favoriteModelIds.filter(id => id !== modelId)
      : [...favoriteModelIds, modelId]
    updateStoreConfig({ favoriteModelIds: newFavoriteIds })
  }

  const handleCopyMessageMarkdown = async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(toMarkdown(content))
    } catch (error) {
      console.error('[SummaryPanel] 复制 Markdown 失败:', error)
    }
  }

  // Markdown 渲染样式
  const markdownStyles = `prose prose-invert prose-sm max-w-none
    prose-headings:text-gray-200 prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
    prose-p:text-gray-300 prose-p:leading-relaxed prose-p:my-2
    prose-a:text-primary prose-a:no-underline hover:prose-a:underline
    prose-strong:text-gray-200
    prose-code:text-primary prose-code:bg-gray-800/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
    prose-pre:bg-gray-900/50 prose-pre:border prose-pre:border-gray-700/50 prose-pre:rounded-lg
    prose-ul:text-gray-300 prose-ol:text-gray-300 prose-ul:my-2 prose-ol:my-2
    prose-li:marker:text-gray-500 prose-li:my-0.5
    prose-table:text-gray-300 prose-table:border-collapse prose-table:my-4
    prose-th:text-gray-200 prose-th:font-semibold prose-th:border prose-th:border-gray-600 prose-th:px-3 prose-th:py-2 prose-th:bg-gray-800/30
    prose-td:text-gray-300 prose-td:border prose-td:border-gray-700 prose-td:px-3 prose-td:py-2
    prose-tr:border-b prose-tr:border-gray-700`

  /**
   * 自定义链接组件：处理外部链接点击，在新窗口（BrowserPage）中打开
   */
  const customLinkComponent: Components['a'] = ({ href, children, ...props }) => {
    const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
      // 如果没有 href，使用默认行为
      if (!href) return

      // 检查是否是外部链接（http/https 协议）
      const isExternalLink = href.startsWith('http://') || href.startsWith('https://')

      if (isExternalLink) {
        e.preventDefault()
        e.stopPropagation()

        // 通过 IPC 调用主进程，在新窗口中打开链接
        try {
          await window.api.openBrowserWindow(href)
          console.log('[SummaryPanel] 打开外部链接:', href)
        } catch (error) {
          console.error('[SummaryPanel] 打开外部链接失败:', error)
        }
      }
      // 内部链接（如锚点链接）使用默认行为
    }

    return (
      <a
        href={href}
        onClick={handleClick}
        className="text-primary no-underline hover:underline"
        {...props}
      >
        {children}
      </a>
    )
  }

  // ReactMarkdown 自定义组件配置
  const markdownComponents: Components = {
    a: customLinkComponent
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部：供应商和模型选择 — API 模式 */}
      {summarySource === 'api' && (
      <div className="flex items-center gap-2 relative shrink-0 mb-4">
        {/* 供应商选择 */}
        <CustomDropdown
          value={selectedProviderId}
          onChange={(providerId) => {
            setSelectedProviderId(providerId)
            // 切换供应商时，检查保存的模型是否在新供应商的模型列表中
            const newProviderModels = (allSummaryModels || []).filter(m => m.providerId === providerId)
            const savedAgentId = apiConfig.lastSelectedAgentId
            const isSavedModelValid = savedAgentId && newProviderModels.find(m => m.id === savedAgentId)

            updateStoreConfig({
              activeProviderId: providerId,
              // 如果保存的模型不在新供应商的列表中，清除保存的模型 ID
              lastSelectedAgentId: isSavedModelValid ? savedAgentId : undefined
            })
          }}
          placeholder="选择供应商"
          className="min-w-[100px]"
          dropdownWidth="min-w-[200px]"
          buttonClassName={`w-full px-3 py-1.5 rounded-md text-sm flex items-center justify-between gap-2 transition-colors ${selectedProviderId
            ? 'bg-primary/10 border border-primary/50 text-primary hover:border-primary'
            : 'bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-600'
            }`}
          displayText={providers.find(p => p.id === selectedProviderId)?.name || '选择供应商'}
          renderContent={(onClose) => {
            const handleProviderSelect = (providerId: string) => {
              setSelectedProviderId(providerId)
              // 切换供应商时，检查保存的模型是否在新供应商的模型列表中
              const newProviderModels = (allSummaryModels || []).filter(m => m.providerId === providerId)
              const savedAgentId = apiConfig.lastSelectedAgentId
              const isSavedModelValid = savedAgentId && newProviderModels.find(m => m.id === savedAgentId)

              updateStoreConfig({
                activeProviderId: providerId,
                // 如果保存的模型不在新供应商的列表中，清除保存的模型 ID
                lastSelectedAgentId: isSavedModelValid ? savedAgentId : undefined
              })
              onClose()
            }

            return (
              <>
                {/* 供应商列表 */}
                {providers.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleProviderSelect(p.id)}
                    className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-700 whitespace-nowrap ${selectedProviderId === p.id ? 'text-primary bg-primary/5' : 'text-gray-300'
                      }`}
                  >
                    {p.name}
                  </button>
                ))}
                {providers.length === 0 && (
                  <div className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">请先启用供应商</div>
                )}

                {/* 常用模型列表（收藏的模型） */}
                {favoriteModelIds.length > 0 && providers.length > 0 && (() => {
                  const favoriteModels = favoriteModelIds
                    .map(modelId => allSummaryModels.find(m => m.id === modelId))
                    .filter((model): model is NonNullable<typeof model> => {
                      // 只显示已启用供应商下的收藏模型
                      return model !== undefined && providers.some(p => p.id === model.providerId)
                    })

                  if (favoriteModels.length === 0) return null

                  return (
                    <>
                      <div className="border-t border-gray-700 my-1"></div>
                      <div className="px-3 py-1.5 text-xs text-gray-500 font-medium">常用模型</div>
                      {favoriteModels.map(model => {
                        const provider = providers.find(p => p.id === model.providerId)
                        return (
                          <button
                            key={model.id}
                            onClick={() => {
                              // 切换到该模型所属的供应商
                              if (provider) {
                                handleProviderSelect(provider.id)
                                updateStoreConfig({
                                  activeProviderId: provider.id,
                                  lastSelectedAgentId: model.id
                                })
                                setSelectedAgent(model.id)
                              }
                            }}
                            className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-700 group"
                          >
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-yellow-500 text-base shrink-0">star</span>
                              <span className="text-gray-300 flex-1 truncate">{model.name}</span>
                              <span className="text-gray-500 text-xs shrink-0">{provider?.name}</span>
                            </div>
                          </button>
                        )
                      })}
                    </>
                  )
                })()}
              </>
            )
          }}
        />

        {/* 模型选择 */}
        <CustomDropdown
          value={selectedAgent}
          onChange={(modelId) => {
            setSelectedAgent(modelId)
            updateStoreConfig({ lastSelectedAgentId: modelId })
          }}
          placeholder="选择模型"
          className="min-w-[120px]"
          dropdownWidth="min-w-[200px]"
          buttonClassName={`w-full px-3 py-1.5 rounded-md text-sm flex items-center justify-between gap-2 transition-colors ${selectedAgent
            ? 'bg-primary/10 border border-primary/50 text-primary hover:border-primary'
            : 'bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-600'
            }`}
          displayText={summaryModels.find(m => m.id === selectedAgent)?.name || '选择模型'}
          renderContent={(onClose) => (
            <>
              {summaryModels.map(model => {
                const isFavorite = favoriteModelIds.includes(model.id)
                return (
                  <div
                    key={model.id}
                    className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-700 group ${selectedAgent === model.id ? 'bg-primary/5' : ''
                      }`}
                  >
                    <button
                      onClick={() => {
                        setSelectedAgent(model.id)
                        updateStoreConfig({ lastSelectedAgentId: model.id })
                        onClose()
                      }}
                      className={`flex-1 text-left whitespace-nowrap ${selectedAgent === model.id ? 'text-primary' : 'text-gray-300'
                        }`}
                    >
                      {model.name}
                    </button>
                    <button
                      onClick={(e) => toggleFavoriteModel(model.id, e)}
                      className={`shrink-0 p-0.5 rounded transition-colors ${isFavorite
                        ? 'text-yellow-500 hover:text-yellow-400'
                        : 'text-gray-500 hover:text-yellow-500 opacity-0 group-hover:opacity-100'
                        }`}
                      title={isFavorite ? '取消收藏' : '收藏'}
                    >
                      <span className="material-symbols-outlined text-base">
                        {isFavorite ? 'star' : 'star_border'}
                      </span>
                    </button>
                  </div>
                )
              })}
              {summaryModels.length === 0 && (
                <div className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">无可用模型</div>
              )}
            </>
          )}
        />

        {/* 开启新对话按钮 */}
        <button
          onClick={handleResetChat}
          disabled={messages.length === 0 && !streamingContent}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ml-auto"
          title="开启新对话"
        >
          <span className="material-symbols-outlined text-2xl">add_circle</span>
        </button>

        {/* 参数设置按钮 */}
        <div className="relative">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded-md transition-colors flex items-center justify-center ${showSettings
              ? 'bg-primary/20 text-primary'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            title="模型参数设置"
          >
            <span className="material-symbols-outlined text-2xl">settings</span>
          </button>

          {showSettings && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowSettings(false)} />
              <div className="absolute top-full right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-30 p-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-gray-200">模型参数设置</span>
                  <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-300">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Temperature */}
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-xs text-gray-400">Temperature (温度)</label>
                      <span className="text-xs text-primary font-mono">{temperature.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value)
                        setTemperature(val)
                        updateStoreConfig({ temperature: val })
                      }}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-gray-600">精确 (0)</span>
                      <span className="text-[10px] text-gray-600">创造 (2)</span>
                    </div>
                  </div>

                  {/* Top P */}
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-xs text-gray-400">Top P (核采样)</label>
                      <span className="text-xs text-primary font-mono">{topP.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={topP}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value)
                        setTopP(val)
                        updateStoreConfig({ topP: val })
                      }}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>

                  {/* Max Tokens */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">最大 Token 数</label>
                    <input
                      type="number"
                      value={maxTokens}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0
                        setMaxTokens(val)
                        updateStoreConfig({ maxTokens: val })
                      }}
                      className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-primary/50 font-mono"
                    />
                  </div>

                  {/* Include Reasoning */}
                  <div className="pt-2 border-t border-gray-700">
                    <label className="flex items-center justify-between cursor-pointer group">
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-300 group-hover:text-white transition-colors">显示思考过程</span>
                        <span className="text-[10px] text-gray-500">支持拥有推理能力的模型</span>
                      </div>
                      <div className="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={includeReasoning}
                          onChange={(e) => {
                            const val = e.target.checked
                            setIncludeReasoning(val)
                            updateStoreConfig({ includeReasoning: val })
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                      </div>
                    </label>
                  </div>

                  {/* Context Rounds - 多轮对话 */}
                  <div className="pt-2 border-t border-gray-700">
                    <div className="flex justify-between mb-1.5">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">对话轮数</label>
                        <span className="text-[10px] text-gray-500">追问时保留的上下文轮数</span>
                      </div>
                      <span className="text-xs text-primary font-mono">{contextRounds}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={contextRounds}
                      onChange={(e) => {
                        const val = parseInt(e.target.value)
                        setContextRounds(val)
                        updateStoreConfig({ contextRounds: val })
                      }}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-gray-600">无记忆 (0)</span>
                      <span className="text-[10px] text-gray-600">20轮</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-700 flex justify-end">
                  <button
                    onClick={() => {
                      setTemperature(0.7)
                      setTopP(1.0)
                      setMaxTokens(8000)
                      setIncludeReasoning(false)
                      setContextRounds(5)
                      updateStoreConfig({
                        temperature: 0.7,
                        topP: 1.0,
                        maxTokens: 8000,
                        includeReasoning: false,
                        contextRounds: 5
                      })
                    }}
                    className="text-[10px] text-gray-500 hover:text-primary transition-colors"
                  >
                    重置为默认值
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 px-4 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}

      {summarySource === 'api' && (
        <>
          {/* 对话消息区域 */}
          <div className="flex-1 mb-4 overflow-y-auto">
            {messages.length === 0 && !isGenerating && (
              <div className="flex flex-col items-center justify-center text-gray-500 h-full">
                <span className="material-symbols-outlined text-5xl mb-3 opacity-50">forum</span>
                <p className="text-sm">选择模型和总结模式，开始对话</p>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id}>
                {message.role === 'user' ? (
                  // 用户消息 - 右侧气泡
                  <div className="flex justify-end mb-4">
                    <div className="max-w-[80%] bg-primary/20 border border-primary/30 rounded-2xl rounded-tr-sm px-4 py-3">
                      <p className="text-gray-200 text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                ) : (
                  // 助手消息 - 带机器人头像
                  <div className="flex gap-3 mb-4">
                    {/* 机器人头像 */}
                    <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary text-lg">smart_toy</span>
                    </div>
                    {/* 消息内容 */}
                    <div className="flex-1 min-w-0">
                      {/* 模型名称 */}
                      {message.versions && message.versions.length > 0 && (
                        <div className="mb-2 text-xs text-gray-500">
                          <span className="text-gray-400">
                            {message.versions[message.currentVersionIndex || 0]?.modelName || '未知模型'}
                          </span>
                        </div>
                      )}
                      {/* 思考内容 - 可折叠 */}
                      {(() => {
                        const currentVersion = message.versions?.[message.currentVersionIndex || 0]
                        const reasoningToShow = currentVersion?.reasoningContent || message.reasoningContent
                        if (!reasoningToShow) return null

                        const isExpanded = expandedReasoningIds.has(message.id)
                        return (
                          <div className="mb-3 bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
                            <button
                              onClick={() => {
                                setExpandedReasoningIds(prev => {
                                  const newSet = new Set(prev)
                                  if (isExpanded) {
                                    newSet.delete(message.id)
                                  } else {
                                    newSet.add(message.id)
                                  }
                                  return newSet
                                })
                              }}
                              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                            >
                              <span className="material-symbols-outlined text-base transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                                chevron_right
                              </span>
                              <span className="material-symbols-outlined text-base text-yellow-500">psychology</span>
                              <span>思考过程</span>
                              <span className="text-gray-500">({reasoningToShow.length} 字)</span>
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 text-xs text-gray-400 leading-relaxed max-h-64 overflow-y-auto border-t border-gray-700">
                                <div className="pt-2 whitespace-pre-wrap">{reasoningToShow}</div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      <div className={markdownStyles}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      {/* 操作按钮 */}
                      <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3">
                        <div className="flex items-center gap-3">
                          {!isGenerating && messages.filter(m => m.role === 'assistant').slice(-1)[0]?.id === message.id && (
                            <button
                              onClick={() => startEditingRegenerate(message.id)}
                              className="p-1 text-gray-400 hover:text-white transition-colors"
                              title="重新生成"
                              aria-label="重新生成"
                            >
                              <span className="material-symbols-outlined text-xl">refresh</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleCopyMessageMarkdown(message.content)}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                            title="复制 Markdown"
                            aria-label="复制 Markdown"
                          >
                            <span className="material-symbols-outlined text-xl">content_copy</span>
                          </button>
                          <button
                            onClick={() => handleOpenExportDialog(message.content)}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                            title="导出 Markdown"
                            aria-label="导出 Markdown"
                          >
                            <span className="material-symbols-outlined text-xl">download</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          {message.versions && message.versions.length > 1 && (
                            <div className="flex items-center gap-1 text-gray-400">
                              <button
                                onClick={() => handleSwitchVersion(message.id, 'prev')}
                                className="p-1.5 hover:text-white transition-colors"
                                title="上一个版本"
                                aria-label="上一个版本"
                              >
                                <span className="material-symbols-outlined text-lg">chevron_left</span>
                              </button>
                              <span className="text-gray-300 font-mono min-w-[44px] text-center text-base">
                                {(message.currentVersionIndex || 0) + 1}/{message.versions.length}
                              </span>
                              <button
                                onClick={() => handleSwitchVersion(message.id, 'next')}
                                className="p-1.5 hover:text-white transition-colors"
                                title="下一个版本"
                                aria-label="下一个版本"
                              >
                                <span className="material-symbols-outlined text-lg">chevron_right</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* 重新生成编辑区域 */}
                      {editingRegenerateMessageId === message.id && (
                        <div className="mt-3 bg-gray-800/80 border border-gray-600 rounded-lg p-3">
                          <label className="block text-xs text-gray-400 mb-1.5">
                            修改要求后重新生成
                          </label>
                          <textarea
                            value={editingRegenerateText}
                            onChange={(e) => setEditingRegenerateText(e.target.value)}
                            placeholder="输入新的要求..."
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleRegenerate(message.id, editingRegenerateText)
                              }
                            }}
                            className="w-full h-16 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary/50 resize-none"
                            autoFocus
                          />
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <button
                              onClick={cancelEditingRegenerate}
                              className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleRegenerate(message.id, editingRegenerateText)}
                              className="px-3 py-1 bg-primary text-black text-xs font-medium rounded hover:opacity-90 transition-colors"
                            >
                              重新生成
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* 流式输出中的内容 */}
            {isGenerating && (streamingContent || streamingReasoningContent) && (
              <div className="flex gap-3 mb-4">
                {/* 机器人头像 */}
                <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-lg">smart_toy</span>
                </div>
                {/* 流式内容 */}
                <div className="flex-1 min-w-0">
                  {/* 思考内容 - 可折叠 */}
                  {streamingReasoningContent && (
                    <div className="mb-3 bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
                        className="w-full px-3 py-2 flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-base transition-transform" style={{ transform: isReasoningExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                          chevron_right
                        </span>
                        <span className="material-symbols-outlined text-base text-yellow-500">psychology</span>
                        <span>思考过程</span>
                        <span className="text-gray-500">({streamingReasoningContent.length} 字)</span>
                        {!streamingContent && (
                          <div className="ml-auto flex items-center gap-1">
                            <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></div>
                            <span className="text-yellow-500/70">思考中...</span>
                          </div>
                        )}
                      </button>
                      {isReasoningExpanded && (
                        <div className="px-3 pb-3 text-xs text-gray-400 leading-relaxed max-h-64 overflow-y-auto border-t border-gray-700">
                          <div className="pt-2 whitespace-pre-wrap">{streamingReasoningContent}</div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* 正文内容 */}
                  {streamingContent && (
                    <div className={markdownStyles}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-gray-500 text-xs">
                    <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                    <span>{streamingContent ? '正在生成...' : '正在思考...'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 加载指示器（无内容时） */}
            {isGenerating && !streamingContent && !streamingReasoningContent && (
              <div className="flex gap-3 mb-4">
                {/* 机器人头像 */}
                <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-lg">smart_toy</span>
                </div>
                {/* 加载状态 */}
                <div className="flex items-center gap-3 text-gray-400">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm">正在思考...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 底部：输入和控制 */}
          <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-lg focus-within:border-primary/50 transition-colors shrink-0">
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={hasStartedChat ? "继续追问..." : "输入额外的分析要求（可选），按 Enter 发送"}
              disabled={!isApiConfigured || isGenerating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleGenerateSummary()
                }
              }}
              className="w-full h-20 px-3 py-2 bg-transparent text-gray-300 placeholder-gray-500 focus:outline-none disabled:opacity-50 resize-none text-sm border-none rounded-t-lg"
            />
            <div className="flex items-center justify-between p-2 bg-gray-800/50 border-t border-gray-700/30 gap-3 rounded-b-lg">
              {/* 模式选择 */}
              {!hasStartedChat ? (
                <CustomDropdown
                  options={agentPrompts.map(p => ({ value: p.id, label: p.name, description: p.description }))}
                  value={summaryMode}
                  onChange={setSummaryMode}
                  placeholder="总结模式"
                  disabled={!isApiConfigured}
                  direction="up"
                  dropdownWidth="min-w-max"
                  className="min-w-max"
                  buttonClassName={`px-3 py-1.5 rounded-full text-sm flex items-center justify-between gap-2 transition-colors disabled:opacity-50 min-w-max ${summaryMode && agentPrompts.find(p => p.id === summaryMode)
                    ? 'bg-primary/10 border border-primary/50 text-primary hover:border-primary'
                    : 'bg-gray-700/50 border border-gray-600 text-gray-300 hover:border-gray-500'
                    }`}
                  renderOption={(option, isSelected, onSelect) => (
                    <button
                      onClick={onSelect}
                      className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-gray-700 ${isSelected ? 'text-primary bg-primary/5' : 'text-gray-300'
                        }`}
                    >
                      <div className="flex flex-col items-start">
                        <div className="whitespace-nowrap">{option.label}</div>
                        {option.description && (
                          <div className={`text-[11px] ${isSelected ? 'text-primary/70' : 'text-gray-500'}`}>
                            {option.description}
                          </div>
                        )}
                      </div>
                    </button>
                  )}
                />
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-700/30 border border-gray-700 text-gray-400 text-sm select-none">
                  <span className="whitespace-nowrap">
                    {agentPrompts.find(p => p.id === summaryMode)?.name || '总结模式'}
                  </span>
                </div>
              )}

              {isGenerating ? (
                // 生成中显示终止按钮
                <button
                  onClick={handleAbortGeneration}
                  className="flex items-center justify-center gap-2 px-4 py-1.5 bg-red-600 text-white font-medium rounded-md hover:bg-red-500 transition-all text-sm shrink-0"
                  title="终止生成"
                >
                  <span className="material-symbols-outlined text-lg">stop</span>
                  <span>终止</span>
                </button>
              ) : (
                <button
                  onClick={handleGenerateSummary}
                  disabled={(!hasStartedChat && selectedModels.length === 0) || !isApiConfigured || summaryModels.length === 0 || (hasStartedChat && !customPrompt.trim())}
                  className={`flex items-center justify-center bg-primary text-black font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all
                    text-sm shrink-0 gap-2 px-4 py-1.5`}
                  title={hasStartedChat ? '发送' : '生成总结'}
                >
                  {hasStartedChat ? (
                    <>
                      <span>发送</span>
                      <span className="material-symbols-outlined text-2xl">send</span>
                    </>
                  ) : (
                    <>
                      <span>生成总结</span>
                      <span className="material-symbols-outlined text-2xl">send</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {summarySource === 'webview' && (
        <div className="flex-1 flex flex-col overflow-hidden gap-3 min-h-0">
          {/* 模式选择器和用户指令 */}
          <div className="shrink-0 flex flex-col gap-2">
            <CustomDropdown
              options={agentPrompts.map(p => ({ value: p.id, label: p.name, description: p.description }))}
              value={summaryMode}
              onChange={setSummaryMode}
              placeholder="总结模式"
              dropdownWidth="min-w-max"
              className="min-w-max"
              buttonClassName={`px-3 py-1.5 rounded-full text-sm flex items-center justify-between gap-2 transition-colors min-w-max ${summaryMode && agentPrompts.find(p => p.id === summaryMode)
                ? 'bg-primary/10 border border-primary/50 text-primary hover:border-primary'
                : 'bg-gray-700/50 border border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              renderOption={(option, isSelected, onSelect) => (
                <button
                  onClick={onSelect}
                  className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-gray-700 ${isSelected ? 'text-primary bg-primary/5' : 'text-gray-300'
                    }`}
                >
                  <div className="flex flex-col items-start">
                    <div className="whitespace-nowrap">{option.label}</div>
                    {option.description && (
                      <div className={`text-[11px] ${isSelected ? 'text-primary/70' : 'text-gray-500'}`}>
                        {option.description}
                      </div>
                    )}
                  </div>
                </button>
              )}
            />
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="输入额外的分析要求（可选）"
              className="w-full h-16 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:border-primary/50 resize-none text-sm"
            />
          </div>

          {/* WebviewCard */}
          <div className="flex-1 min-h-0">
            <WebviewCard
              ref={webviewSummaryRef}
              id={webviewPlatformId}
              name={webviewPlatformInfo.name}
              url={webviewPlatformInfo.url}
              logo={webviewPlatformInfo.logo || ''}
              enabled={true}
              slotIndex={0}
              compact
              onModelChange={(modelId) => setLastWebviewPlatform(modelId)}
            />
          </div>

          {/* 操作栏 */}
          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={handleWebviewSend}
              disabled={webviewSummary.isGenerating || selectedModels.length === 0}
              className="px-4 py-2 rounded bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-medium"
            >
              {webviewSummary.isGenerating ? '已发送' : '开始 Webview 总结'}
            </button>
            <span className="text-xs text-gray-500">{`已选 ${selectedModels.length} 个模型`}</span>
            {webviewSummary.phase === 'uploading-file' && (
              <span className="text-xs text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">upload_file</span>
                正在上传文件...
              </span>
            )}
            {webviewSummary.phase === 'sending' && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">send</span>
                正在发送...
              </span>
            )}
            {webviewSummary.phase === 'streaming' && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">psychology</span>
                正在生成回复...
              </span>
            )}
          </div>
        </div>
      )}

      {/* 导出确认对话框 */}
      {showExportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-[480px] max-w-[90vw] p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary text-xl">download</span>
              </div>
              <h3 className="text-lg font-semibold text-white">导出报告</h3>
            </div>

            {/* 文件名输入 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">文件名</label>
              <input
                type="text"
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-primary/50"
                placeholder="输入文件名"
              />
            </div>

            {/* 导出目录选择 */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-2">导出目录</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={exportDirectory}
                  onChange={(e) => setExportDirectory(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-primary/50"
                  placeholder="选择导出目录（留空将弹出选择框）"
                />
                <button
                  onClick={handleSelectExportDirectory}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-gray-300 text-sm transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-lg">folder_open</span>
                  <span>浏览</span>
                </button>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowExportDialog(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-gray-300 text-sm transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmExport}
                disabled={!exportFileName.trim()}
                className="px-4 py-2 bg-primary hover:opacity-90 text-black font-medium rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-lg">check</span>
                <span>确认导出</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default SummaryPanel
