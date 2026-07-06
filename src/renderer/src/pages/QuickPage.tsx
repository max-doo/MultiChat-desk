import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import WebviewCard, { type WebviewCardRef } from '../components/WebviewCard'

export default function QuickPage(): JSX.Element {
  const { models, registerWebviewRef, unregisterWebviewRef } = useAppStore()
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const selectedModelIdRef = useRef<string>('')
  const cardRefs = useRef<Map<string, WebviewCardRef>>(new Map())
  const isDraggingRef = useRef(false)
  const [isPinned, setIsPinned] = useState(false)

  // ── 休眠调度（片段 E，决策 R2）──
  // 快捷窗口当前模型永不休眠；被切走的旧模型 30 秒后真卸载（D1）。
  const HIBERNATE_DELAY_QUICK_MS = 30 * 1000 // 30 秒
  const hibernateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // 清理某模型的休眠倒计时
  const clearHibernateTimer = useCallback((modelId: string) => {
    const timer = hibernateTimersRef.current.get(modelId)
    if (timer) {
      clearTimeout(timer)
      hibernateTimersRef.current.delete(modelId)
    }
  }, [])

  // 执行休眠：当前模型保护 —— 定时器触发时再次确认非当前模型，防止竞态
  const executeHibernate = useCallback(async (modelId: string) => {
    if (modelId === selectedModelIdRef.current) {
      console.log(`[QuickPage] ${modelId} 已是当前模型，跳过休眠`)
      return
    }
    const ref = cardRefs.current.get(modelId)
    if (ref && !ref.isHibernated()) {
      console.log(`[QuickPage] 休眠旧模型 webview: ${modelId}`)
      const result = await ref.suspend()
      if (!result.success) {
        console.warn(`[QuickPage] ${modelId} 休眠失败:`, result.error)
      }
    }
  }, [])

  const scheduleHibernate = useCallback((modelId: string) => {
    clearHibernateTimer(modelId)
    const timer = setTimeout(() => {
      void executeHibernate(modelId)
    }, HIBERNATE_DELAY_QUICK_MS)
    hibernateTimersRef.current.set(modelId, timer)
    console.log(`[QuickPage] ${modelId} 休眠倒计时启动: ${HIBERNATE_DELAY_QUICK_MS}ms`)
  }, [clearHibernateTimer, executeHibernate])

  // 唤醒：切回旧模型时立即唤醒
  const wakeModel = useCallback(async (modelId: string) => {
    clearHibernateTimer(modelId)
    const ref = cardRefs.current.get(modelId)
    const store = useAppStore.getState()
    if (ref) {
      if (ref.isHibernated()) {
        console.log(`[QuickPage] 唤醒模型 webview: ${modelId}`)
        const result = await ref.resume()
        if (result.success) {
          store.markWebviewActive(modelId)
          void store.enforceWebviewCapacity()
        } else {
          console.warn(`[QuickPage] ${modelId} 唤醒失败:`, result.error)
        }
      } else {
        store.markWebviewActive(modelId)
      }
    }
  }, [clearHibernateTimer])

  // 已挂载的模型集合（只增不减，实现懒加载缓存）
  const [mountedModelIds, setMountedModelIds] = useState<Set<string>>(new Set())

  // 为每个模型生成稳定的 ref 回调
  const getCardRefCallback = useCallback((modelId: string) => {
    return (ref: WebviewCardRef | null) => {
      if (ref) {
        cardRefs.current.set(modelId, ref)
        registerWebviewRef(modelId, ref)
      } else {
        cardRefs.current.delete(modelId)
        unregisterWebviewRef(modelId)
      }
    }
  }, [registerWebviewRef, unregisterWebviewRef])

  // 获取初始置顶状态
  useEffect(() => {
    if (window.api?.quickGetAlwaysOnTop) {
      window.api.quickGetAlwaysOnTop()
        .then((pinned) => {
          setIsPinned(pinned)
        })
        .catch((err) => {
          console.error('[QuickPage] Failed to get always-on-top state:', err)
        })
    }
  }, [])

  const toggleAlwaysOnTop = async () => {
    if (window.api?.quickSetAlwaysOnTop) {
      const nextState = !isPinned
      try {
        await window.api.quickSetAlwaysOnTop(nextState)
        setIsPinned(nextState)
      } catch (err) {
        console.error('[QuickPage] Failed to set always-on-top state:', err)
      }
    }
  }

  // 窗口拖拽监听
  useEffect(() => {
    const handlePointerMove = (_e: PointerEvent) => {
      if (isDraggingRef.current) {
        window.api.windowDragMove()
      }
    }
    
    const handlePointerUp = (_e: PointerEvent) => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        window.api.windowDragEnd()
      }
    }
    
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  // 卸载时清理所有休眠倒计时，避免卸载后仍触发 suspend
  useEffect(() => {
    return () => {
      for (const [, timer] of hibernateTimersRef.current.entries()) {
        clearTimeout(timer)
      }
      hibernateTimersRef.current.clear()
    }
  }, [])

  const handleModelChange = async (newModelId: string): Promise<void> => {
    const oldModelId = selectedModelId

    // 1. 立即同步更新 UI 和选中的模型，绝不因任何异步操作或旧 webview 未完成加载而阻塞切换
    setSelectedModelId(newModelId)
    selectedModelIdRef.current = newModelId
    window.api.storeSet('quickModelId', newModelId)

    setMountedModelIds(prev => {
      if (prev.has(newModelId)) return prev
      return new Set(prev).add(newModelId)
    })

    // 休眠调度（片段 E）：唤醒新模型；被切走的旧模型 5 分钟后休眠
    void wakeModel(newModelId)
    if (oldModelId && oldModelId !== newModelId) {
      scheduleHibernate(oldModelId)
    }

    // 2. 异步提取旧 webview 的未发送文本（设置 300ms 超时，防止旧 webview 卡住）
    if (oldModelId && oldModelId !== newModelId) {
      const oldRef = cardRefs.current.get(oldModelId)
      if (oldRef) {
        try {
          const result = await Promise.race([
            oldRef.getInputText(),
            new Promise<{ success: boolean; text?: string }>((r) => setTimeout(() => r({ success: false }), 300))
          ])
          if (result.success && result.text) {
            void oldRef.clearInput()
            const textToCarry = result.text

            // 3. 尝试注入到目标新 webview
            const tryInject = async (attempts = 0): Promise<void> => {
              if (selectedModelIdRef.current !== newModelId || attempts >= 20) return
              const newRef = cardRefs.current.get(newModelId)
              if (newRef) {
                const res = await newRef.insertText(textToCarry)
                if (res.success) {
                  console.log('[QuickPage] 成功携带文本到新模型输入框')
                  return
                }
              }
              await new Promise(r => setTimeout(r, 300))
              return tryInject(attempts + 1)
            }
            void tryInject()
          }
        } catch {
          // 忽略提取异常或超时
        }
      }
    }
  }

  // 加载上次选中的快捷模型 ID
  useEffect(() => {
    window.api.storeGet('quickModelId').then((saved) => {
      if (saved && typeof saved === 'string') {
        setSelectedModelId(saved)
        selectedModelIdRef.current = saved
        setMountedModelIds(prev => new Set(prev).add(saved))
      }
    }).catch(() => {})
  }, [])

  const currentModel = models.find(m => m.id === selectedModelId) || models[0]

  useEffect(() => {
    if (currentModel && !selectedModelId) {
      setSelectedModelId(currentModel.id)
      selectedModelIdRef.current = currentModel.id
      setMountedModelIds(prev => new Set(prev).add(currentModel.id))
    }
  }, [currentModel, selectedModelId])

  // 带重试机制的文本注入（确保 Webview 异步加载完成后能成功注入）
  const injectTextWithRetry = async (prompt: string, maxAttempts = 15): Promise<void> => {
    for (let i = 0; i < maxAttempts; i++) {
      const ref = cardRefs.current.get(selectedModelIdRef.current || currentModel?.id || '')
      if (ref) {
        const res = await ref.insertText(prompt)
        if (res.success) {
          console.log('[QuickPage] 成功注入文本至网页输入框')
          return
        }
      }
      await new Promise(r => setTimeout(r, 500))
    }
    console.warn('[QuickPage] 注入文本超时或失败')
  }

  // 监听全局快捷键注入事件
  useEffect(() => {
    const unsub = window.api.onQuickInject(async ({ text, action }) => {
      if (!text) return
      if (action === 'raw' || action === 'quick') {
        void injectTextWithRetry(text)
        return
      }
      const promptMap: Record<string, string> = {
        summarize: `总结以下内容:\n\n${text}`,
        polish: `润色以下文本，使其更流畅自然:\n\n${text}`,
        translate: `你是一名专业翻译官，如果是英文则翻译成中文，如果是中文则翻译成英文，请忠实翻译以下内容:\n\n${text}`,
        search: `搜索以下内容:\n\n${text}`
      }
      const finalPrompt = promptMap[action] || text
      void injectTextWithRetry(finalPrompt)
    })
    return () => unsub()
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden p-0">
      {models.length > 0 ? (
        <>
          {models.map((model) => {
            // 只渲染已挂载的模型
            if (!mountedModelIds.has(model.id)) return null

            const isActive = model.id === currentModel?.id

            return (
              <div
                key={model.id}
                style={{
                  display: isActive ? 'block' : 'none',
                  width: '100%',
                  height: '100%'
                }}
              >
                <WebviewCard
                  id={model.id}
                  name={model.name}
                  url={model.url}
                  logo={model.logo}
                  enabled={true}
                  slotIndex={0}
                  compact={true}
                  isolated={true}
                  draggableHeader={true}
                  flat={true}
                  onDragStart={() => {
                    isDraggingRef.current = true
                  }}
                  onModelChange={(modelId) => void handleModelChange(modelId)}
                  headerActions={
                    <div className="flex items-center gap-2 pl-2 border-l border-gray-200/60 ml-1 no-drag">
                      <button
                        type="button"
                        onClick={toggleAlwaysOnTop}
                        className={`w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200 ${
                          isPinned 
                            ? 'text-primary bg-blue-50 hover:bg-blue-100' 
                            : 'text-text-secondary hover:text-text-primary hover:bg-gray-100'
                        }`}
                        title={isPinned ? '取消固定' : '固定窗口'}
                      >
                        <span 
                          className="material-symbols-outlined text-base"
                          style={isPinned ? { fontVariationSettings: "'FILL' 1" } : undefined}
                        >
                          push_pin
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.api.trayShowMain()}
                        className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 border border-gray-200/60 rounded-md text-text-primary transition-all duration-200 flex items-center gap-1"
                        title="展开至主窗口"
                      >
                        <span className="material-symbols-outlined text-xs">open_in_new</span> 主界面
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.api.quickHide()}
                        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-full transition-all duration-200"
                        title="关闭"
                      >
                        ✕
                      </button>
                    </div>
                  }
                  ref={getCardRefCallback(model.id)}
                />
              </div>
            )
          })}
        </>
      ) : (
        <div className="flex items-center justify-center h-full text-text-secondary text-sm">
          暂无可用模型配置
        </div>
      )}
    </div>
  )
}

