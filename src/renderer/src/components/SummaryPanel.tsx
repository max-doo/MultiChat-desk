import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { useAppStore, waitForSavableUrl } from '../store/appStore'
import CustomDropdown from './CustomDropdown'
import { useWebviewSummary } from '../hooks/useWebviewSummary'
import WebviewCard, { WebviewCardRef } from './WebviewCard'
import { defaultSelectors } from '../config/selectors'
import type { SummaryPanelProps, ChatMessage } from '../types/summary'

/**
 * 总结面板组件
 * 在嵌入式平台页面中生成总结
 */
function SummaryPanel({ selectedModels, modelResponses, restoreHistoryData, isActive = true, presetSummaryMode }: SummaryPanelProps): JSX.Element {
  const { apiConfig, models, setApiConfig, addSummaryHistory, updateSummaryHistory, removeSummaryHistory, history, currentConversationId, registerWebviewRef, unregisterWebviewRef } = useAppStore()

  const firstEnabledModel = models.find(m => m.enabled)
  const lastWebviewPlatform = apiConfig.lastWebviewSummaryPlatform ?? firstEnabledModel?.id ?? 'chatgpt'
  const [webviewPlatformId, setWebviewPlatformId] = useState<string>(lastWebviewPlatform)
  // Webview composer 锁定标记：首次注入后置 true，组件卸载或 phase 进入 error/aborted 时归零
  const [summaryFired, setSummaryFired] = useState(false)

  // 平台回复显示在 Webview 内；这里只记录用户输入以保存历史。
  const webviewMessagesRef = useRef<ChatMessage[]>([])
  const [webviewCustomPrompt, setWebviewCustomPrompt] = useState('')
  const [summaryMode, setSummaryMode] = useState(() => presetSummaryMode ?? '1')
  const summaryPrompts = apiConfig.summaryPrompts || []
  const presetConsumedRef = useRef(false)
  useEffect(() => {
    if (presetConsumedRef.current || !presetSummaryMode || !summaryPrompts.some(p => p.id === presetSummaryMode)) return
    presetConsumedRef.current = true
    setSummaryMode(presetSummaryMode)
  }, [presetSummaryMode, summaryPrompts])
  useEffect(() => {
    if (summaryPrompts.length > 0 && !summaryPrompts.some(p => p.id === summaryMode)) setSummaryMode(summaryPrompts[0].id)
  }, [summaryPrompts, summaryMode])

  const webviewSummaryRef = useRef<WebviewCardRef>(null)
  const webviewHistoryIdRef = useRef<string | null>(null)
  const webviewComposerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const handleResetChat = () => {
    if (webviewSummary.isGenerating) webviewSummary.abortSummary()
    webviewSummary.resetUploadedDoc()
    webviewSummaryRef.current?.resetToInitial()
    webviewHistoryIdRef.current = null
    webviewMessagesRef.current = []
    setWebviewCustomPrompt('')
    setSummaryFired(false)
  }

  const webviewPlatformInfo = useMemo(() => {
    const m = models.find(x => x.id === webviewPlatformId)
    const sel = defaultSelectors.models[webviewPlatformId]
    return {
      name: m?.name || webviewPlatformId,
      logo: m?.logo,
      url: sel?.newConversationUrl || m?.url || ''
    }
  }, [models, webviewPlatformId])

  const currentWebviewUrl = useMemo(() => {
    if (restoreHistoryData && restoreHistoryData.summarySource === 'webview' && restoreHistoryData.webviewPlatformId === webviewPlatformId && restoreHistoryData.webviewUrl) {
      return restoreHistoryData.webviewUrl
    }
    return webviewPlatformInfo.url
  }, [restoreHistoryData, webviewPlatformId, webviewPlatformInfo.url])

  const setLastWebviewPlatform = (id: string) => {
    webviewSummary.resetUploadedDoc()
    setWebviewPlatformId(id)
    setApiConfig({ ...apiConfig, lastWebviewSummaryPlatform: id })
  }

  const buildWebviewPrompt = useCallback(() => {
    const summaryTemplate = (apiConfig.summaryPrompts || []).find(a => a.id === summaryMode)
    const systemPrompt = summaryTemplate?.prompt || apiConfig.systemPrompt || ''
    const contextBlock = selectedModels
      .map(id => {
        const name = models.find(m => m.id === id)?.name || id
        const content = modelResponses[id] || ''
        return `<model_output name="${name}">\n${content}\n</model_output>`
      })
      .join('\n')
    const requirement = webviewCustomPrompt?.trim() || '请生成标准总结报告。'
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
  }, [summaryMode, apiConfig.summaryPrompts, apiConfig.systemPrompt, selectedModels, models, modelResponses, webviewCustomPrompt])

  const webviewSummary = useWebviewSummary({
    webviewRef: webviewSummaryRef,
    buildPrompt: buildWebviewPrompt
  })

  // phase 进入 error / aborted 时解锁 composer，允许重试；'done' 表示已注入，等待用户在 Webview 中手动发送
  useEffect(() => {
    if (webviewSummary.phase === 'error' || webviewSummary.phase === 'aborted') {
      setSummaryFired(false)
    }
  }, [webviewSummary.phase])

  // ── 休眠调度（片段 D，决策 R3）──
  // 切走总结页 30 秒后休眠 Webview，切回立即唤醒。
  const HIBERNATE_DELAY_SUMMARY_MS = 30 * 1000 // 30 秒
  const summaryHibernateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const executeSummaryHibernate = useCallback(async () => {
    // 注入中不休眠，避免打断操作。
    if (webviewSummary.isGenerating) {
      console.log('[SummaryPanel] 总结进行中，跳过休眠')
      return
    }
    const ref = webviewSummaryRef.current
    if (ref && !ref.isHibernated()) {
      console.log('[SummaryPanel] 休眠总结页 webview')
      const result = await ref.suspend()
      if (!result.success) {
        console.warn('[SummaryPanel] 总结页 webview 休眠失败:', result.error)
      }
    }
  }, [webviewSummary.isGenerating])

  const scheduleSummaryHibernate = useCallback(() => {
    if (summaryHibernateTimerRef.current) {
      clearTimeout(summaryHibernateTimerRef.current)
    }
    summaryHibernateTimerRef.current = setTimeout(() => {
      void executeSummaryHibernate()
    }, HIBERNATE_DELAY_SUMMARY_MS)
    console.log(`[SummaryPanel] 总结页 webview 休眠倒计时启动: ${HIBERNATE_DELAY_SUMMARY_MS}ms`)
  }, [executeSummaryHibernate])

  const wakeSummaryWebview = useCallback(async () => {
    if (summaryHibernateTimerRef.current) {
      clearTimeout(summaryHibernateTimerRef.current)
      summaryHibernateTimerRef.current = null
    }
    const ref = webviewSummaryRef.current
    const store = useAppStore.getState()
    if (ref) {
      if (ref.isHibernated()) {
        console.log('[SummaryPanel] 唤醒总结页 webview')
        const result = await ref.resume()
        if (result.success) {
          store.markWebviewActive('summary')
          void store.enforceWebviewCapacity()
        } else {
          console.warn('[SummaryPanel] 总结页 webview 唤醒失败:', result.error)
        }
      } else {
        store.markWebviewActive('summary')
      }
    }
  }, [])

  // 页面激活态变化：切回唤醒；切走启动 30秒 倒计时
  useEffect(() => {
    if (isActive) {
      void wakeSummaryWebview()
    } else {
      scheduleSummaryHibernate()
    }
    // 切回时若之前在倒计时，wakeSummaryWebview 已清理；这里再兜底清理
    if (isActive && summaryHibernateTimerRef.current) {
      clearTimeout(summaryHibernateTimerRef.current)
      summaryHibernateTimerRef.current = null
    }
  }, [isActive, scheduleSummaryHibernate, wakeSummaryWebview])

  // 监听主窗口 hide/show 事件：隐藏后 5 分钟休眠总结页 webview，重新显示且 isActive 时立即唤醒。
  const isWindowVisibleRef = useRef(true)
  useEffect(() => {
    const off = window.api.onWindowVisibility((visible) => {
      isWindowVisibleRef.current = visible
      if (visible) {
        if (isActive) {
          void wakeSummaryWebview()
        }
      } else {
        if (summaryHibernateTimerRef.current) {
          clearTimeout(summaryHibernateTimerRef.current)
        }
        summaryHibernateTimerRef.current = setTimeout(() => {
          void executeSummaryHibernate()
        }, 5 * 60 * 1000) // 5 分钟
        console.log('[SummaryPanel] 窗口隐藏，总结页 webview 5 分钟休眠倒计时启动')
      }
    })
    return () => { off() }
  }, [isActive, executeSummaryHibernate, wakeSummaryWebview])

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (summaryHibernateTimerRef.current) {
        clearTimeout(summaryHibernateTimerRef.current)
        summaryHibernateTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (restoreHistoryData) {
      if (restoreHistoryData.webviewPlatformId) {
        setWebviewPlatformId(restoreHistoryData.webviewPlatformId)
      }
      if (restoreHistoryData.historyId) {
        webviewHistoryIdRef.current = restoreHistoryData.historyId
      }
      if (restoreHistoryData.summarySource === 'webview') {
        setSummaryFired(restoreHistoryData.messages.length > 0)
        webviewMessagesRef.current = restoreHistoryData.messages.map(msg => ({
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
    }
  }, [restoreHistoryData])

  useEffect(() => {
    if (restoreHistoryData && restoreHistoryData.summarySource === 'webview' && restoreHistoryData.webviewPlatformId === webviewPlatformId && restoreHistoryData.webviewUrl) {
      webviewSummary.resetUploadedDoc()
      webviewSummaryRef.current?.loadURL(restoreHistoryData.webviewUrl)
    }
  }, [restoreHistoryData, webviewPlatformId])

  useEffect(() => {
    if (webviewSummary.phase === 'done' && webviewPlatformId && webviewHistoryIdRef.current) {
      const historyId = webviewHistoryIdRef.current
      const ref = webviewSummaryRef.current
      if (ref) {
        waitForSavableUrl(webviewPlatformId, ref).then((url) => {
          if (url && webviewHistoryIdRef.current === historyId) {
            console.log(`[SummaryPanel] 记录 webview 会话 URL: ${url}`)
            updateSummaryHistory(historyId, { webviewUrl: url })
          }
        }).catch(e => console.error('[SummaryPanel] 获取 webview 会话 URL 失败:', e))
      }
    }
  }, [webviewSummary.phase, webviewPlatformId, updateSummaryHistory])

  // 让 Webview 模式 composer 的 textarea 高度跟随内容增长，最多 5 行（120px）
  useEffect(() => {
    const ta = webviewComposerTextareaRef.current
    if (!ta) return
    if (!webviewCustomPrompt) {
      ta.style.height = '32px'
      ta.style.overflowY = 'hidden'
      return
    }
    ta.style.height = 'auto'
    const newHeight = Math.min(Math.max(ta.scrollHeight, 32), 72)
    ta.style.height = `${newHeight}px`
    ta.style.overflowY = ta.scrollHeight > 72 ? 'auto' : 'hidden'
  }, [webviewCustomPrompt])

  const handleWebviewInject = useCallback(() => {
    if (selectedModels.length === 0) return

    const summaryTemplate = summaryPrompts.find(a => a.id === summaryMode)
    const modeName = summaryTemplate?.name || '总结'
    const modelNames = selectedModels
      .map(id => models.find(m => m.id === id)?.name || id)
      .join('、')
    const requirement = webviewCustomPrompt?.trim() || ''

    const userContent = requirement
      ? `${requirement}，采用【${modeName}】模式，根据${modelNames}的回答生成报告。`
      : `采用${modeName}模式，根据${modelNames}的回答生成报告。`

    const now = Date.now()
    const userMessage: ChatMessage = {
      id: `webview-user-${crypto.randomUUID()}`,
      role: 'user',
      content: userContent,
      timestamp: now,
      modeName
    }

    webviewMessagesRef.current = [...webviewMessagesRef.current, userMessage]

    const historyId = crypto.randomUUID()
    webviewHistoryIdRef.current = historyId

    addSummaryHistory({
      id: historyId,
      title: userContent.length > 15 ? userContent.substring(0, 15) + '...' : userContent,
      timestamp: now,
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
      webviewPlatformId,
      urls: history.find(h => h.id === currentConversationId)?.urls
    })

    webviewSummary.startSummary()
    setSummaryFired(true)
  }, [summaryMode, summaryPrompts, selectedModels, models, webviewCustomPrompt, addSummaryHistory, webviewPlatformId, webviewSummary, modelResponses, setSummaryFired, history, currentConversationId])

  // 撤回操作：只撤回 Webview 页面中已注入的提示词，解锁输入框并保留用户草稿以供重新编辑
  const handleRevoke = useCallback(async () => {
    if (webviewSummary.isGenerating) {
      webviewSummary.abortSummary()
    }

    const ref = webviewSummaryRef.current
    if (ref) {
      try {
        await ref.clearInput()
      } catch (e) {
        console.warn('[SummaryPanel] 撤回清空 webview 输入框失败:', e)
      }
    }

    if (webviewHistoryIdRef.current) {
      try {
        await removeSummaryHistory(webviewHistoryIdRef.current)
      } catch (e) {
        console.warn('[SummaryPanel] 移除历史草稿失败:', e)
      }
      webviewHistoryIdRef.current = null
    }

    webviewMessagesRef.current = []
    setSummaryFired(false)

    setTimeout(() => {
      webviewComposerTextareaRef.current?.focus()
    }, 50)
  }, [webviewSummary, removeSummaryHistory])

  return (
    <div className="flex flex-col h-full gap-3.5">
      <div className="flex-1 min-h-0">
        <WebviewCard
          ref={(ref) => {
            (webviewSummaryRef as React.MutableRefObject<WebviewCardRef | null>).current = ref
            if (ref) {
              registerWebviewRef('summary', ref)
            } else {
              const lastRef = webviewSummaryRef.current
              if (lastRef) unregisterWebviewRef('summary', lastRef)
            }
          }}
          id={webviewPlatformId}
          name={webviewPlatformInfo.name}
          url={currentWebviewUrl}
          logo={webviewPlatformInfo.logo || ''}
          enabled={true}
          slotIndex={0}
          compact
          isolated
          onModelChange={(modelId) => setLastWebviewPlatform(modelId)}
          onNewConversation={handleResetChat}
        />
      </div>

      {(() => {
        const composerLocked = summaryFired || webviewSummary.isGenerating
        const showLockedHint = summaryFired && !webviewSummary.isGenerating
        const placeholder = showLockedHint
          ? '已注入，可在上方发送或点击撤回'
          : '输入补充要求（可选）...'
        const sendDisabled = composerLocked || selectedModels.length === 0

        return (
          <div className="shrink-0">
            {/* 底部单行 composer */}
            <div
              className={`flex items-end gap-2.5 p-2 bg-white/85 backdrop-blur-xl border border-gray-200/80 rounded-2xl shadow-soft transition-all duration-200 ${
                composerLocked
                  ? 'bg-gray-50/75 border-gray-200/60 shadow-none'
                  : 'focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 focus-within:bg-white'
              }`}
            >
              {/* 模式选择 pill */}
              <CustomDropdown
                options={summaryPrompts.map(p => ({ value: p.id, label: p.name, description: p.description }))}
                value={summaryMode}
                onChange={setSummaryMode}
                placeholder="总结模式"
                disabled={composerLocked}
                direction="up"
                dropdownWidth="min-w-max"
                className="min-w-max shrink-0"
                buttonClassName={`h-8 px-3 rounded-full text-xs font-medium flex items-center justify-between gap-1.5 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed min-w-max ${
                  summaryMode && summaryPrompts.find(p => p.id === summaryMode)
                    ? 'bg-primary/10 border border-primary/30 text-primary hover:bg-primary/15'
                    : 'bg-gray-100/70 border border-transparent text-text-secondary hover:bg-gray-100 hover:text-text-primary'
                }`}
                renderOption={(option, isSelected, onSelect) => (
                  <button
                    onClick={onSelect}
                    className={`block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-gray-100/80 rounded-lg ${
                      isSelected ? 'text-primary bg-primary/5 font-medium' : 'text-text-secondary'
                    }`}
                  >
                    <div className="flex flex-col items-start gap-0.5">
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

              {/* 输入框 - 自动增长，单行 → 最多 5 行 */}
              <textarea
                ref={webviewComposerTextareaRef}
                value={webviewCustomPrompt}
                onChange={(e) => setWebviewCustomPrompt(e.target.value)}
                onKeyDown={(e) => {
                  const isEnterSend = (e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
                  if (isEnterSend && !isComposingRef.current) {
                    e.preventDefault()
                    if (!sendDisabled) handleWebviewInject()
                  }
                }}
                onCompositionStart={() => {
                  isComposingRef.current = true
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false
                }}
                placeholder={placeholder}
                disabled={composerLocked}
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-secondary/50 placeholder:truncate focus:outline-none focus:ring-0 disabled:cursor-not-allowed leading-5 py-1.5 px-1 max-h-[72px]"
              />

              {/* 清空按钮（仅在有输入内容且未锁定时显示） */}
              {webviewCustomPrompt && !composerLocked && (
                <button
                  type="button"
                  onClick={() => {
                    setWebviewCustomPrompt('')
                    webviewComposerTextareaRef.current?.focus()
                  }}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-text-secondary/50 hover:text-text-primary hover:bg-gray-100/80 transition-colors shrink-0 mb-1"
                  title="清空输入"
                  aria-label="清空输入"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              )}

              {/* 操作按钮：已注入状态原位替换为撤回按钮，否则为发送/注入按钮 */}
              {showLockedHint ? (
                <button
                  type="button"
                  onClick={handleRevoke}
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-text-secondary hover:text-text-primary shadow-sm transition-all duration-200 active:scale-95"
                  title="撤回已注入的提示词，返回编辑"
                  aria-label="撤回提示词"
                >
                  <span className="material-symbols-outlined text-[18px]">undo</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleWebviewInject}
                  disabled={sendDisabled}
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
                    sendDisabled
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-primary text-white hover:bg-blue-600 shadow-sm active:scale-95"
                  }`}
                  title={
                    webviewSummary.isGenerating
                      ? "正在注入..."
                      : selectedModels.length === 0
                        ? "请至少选择一个模型"
                        : "注入到 Webview"
                  }
                  aria-label="注入到 Webview"
                >
                  <span className={`material-symbols-outlined text-[18px] ${webviewSummary.isGenerating ? "animate-spin" : ""}`}>
                    {webviewSummary.isGenerating ? "sync" : "arrow_upward"}
                  </span>
                </button>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default SummaryPanel
