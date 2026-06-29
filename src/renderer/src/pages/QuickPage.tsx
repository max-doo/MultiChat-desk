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

  // 已挂载的模型集合（只增不减，实现懒加载缓存）
  const [mountedModelIds, setMountedModelIds] = useState<Set<string>>(new Set())
  // 待注入到目标模型的文本（切换时携带）
  const pendingTextRef = useRef<string>('')

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

  const handleModelChange = async (newModelId: string): Promise<void> => {
    const oldModelId = selectedModelId

    // 1. 从当前 webview 提取未发送的输入文本
    if (oldModelId) {
      const oldRef = cardRefs.current.get(oldModelId)
      if (oldRef) {
        try {
          const result = await oldRef.getInputText()
          if (result.success && result.text) {
            pendingTextRef.current = result.text
            // 提取后清空原输入框，避免用户回切时看到重复内容
            await oldRef.clearInput()
          } else {
            pendingTextRef.current = ''
          }
        } catch {
          pendingTextRef.current = ''
        }
      }
    }

    // 2. 切换到新模型
    setSelectedModelId(newModelId)
    selectedModelIdRef.current = newModelId
    window.api.storeSet('quickModelId', newModelId)

    // 3. 确保新模型被加入已挂载集合
    setMountedModelIds(prev => {
      if (prev.has(newModelId)) return prev
      return new Set(prev).add(newModelId)
    })
  }

  // 当选中模型变化且有待注入文本时，尝试注入到目标 webview
  useEffect(() => {
    if (!selectedModelId || !pendingTextRef.current) return

    const text = pendingTextRef.current
    pendingTextRef.current = '' // 立即清空，防止重复注入

    const tryInject = async (attempts = 0): Promise<void> => {
      if (attempts >= 20) {
        console.warn('[QuickPage] 文本携带注入超时')
        return
      }

      const ref = cardRefs.current.get(selectedModelId)
      if (ref) {
        const result = await ref.insertText(text)
        if (result.success) {
          console.log('[QuickPage] 成功携带文本到新模型输入框')
          return
        }
      }

      // webview 可能还未就绪，等待后重试
      await new Promise(r => setTimeout(r, 300))
      return tryInject(attempts + 1)
    }

    void tryInject()
  }, [selectedModelId])

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

